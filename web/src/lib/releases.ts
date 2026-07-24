/**
 * Resolves the right desktop installer for whoever is looking at the page.
 *
 * The site is a static export, so this all runs in the browser against the
 * public GitHub REST API. The asset names below are exactly what
 * `.github/workflows/release-desktop.yml` publishes, and the tag prefixes are
 * the two release channels (`desktop-stable-v*` / `desktop-nightly-v*`).
 *
 * Every lookup is best-effort: if GitHub rate-limits an anonymous visitor (60
 * requests per hour per IP) the UI falls back to the Releases page rather than
 * showing a broken button.
 */

import { REPO_SLUG } from "./site";

export type Channel = "stable" | "nightly";
export type OsKey = "windows" | "macos" | "linux" | "android" | "unknown";

const TAG_PREFIX: Record<Channel, string> = {
  stable: "desktop-stable-v",
  nightly: "desktop-nightly-v",
};

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ResolvedRelease {
  channel: Channel;
  /** Version without the tag prefix, e.g. `0.0.18` or `0.0.21-nightly.20260722.1`. */
  version: string;
  tag: string;
  htmlUrl: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

export interface DownloadOption {
  id: string;
  /** What the button says, e.g. "Download for Windows". */
  label: string;
  /** The format / arch detail under the label, e.g. "64-bit installer · .exe". */
  hint: string;
  filename: string;
  url: string;
  size: number;
}

export interface RepoStats {
  stars: number;
  /** Summed `download_count` of every asset across every published release. */
  downloads: number;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  download_count: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  published_at: string | null;
  assets: GitHubAsset[];
}

const API = "https://api.github.com";
const CACHE_KEY = "uxnan:releases:v1";
const CACHE_TTL_MS = 10 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* OS detection                                                               */
/* -------------------------------------------------------------------------- */

interface UADataLike {
  platform?: string;
}

/**
 * Detects the visitor's platform. `navigator.userAgentData` is preferred and we
 * fall back to the user-agent string, which is still the only signal Safari and
 * Firefox give us. Android is detected before Linux, because every Android UA
 * also says "Linux".
 */
export function detectOs(): OsKey {
  if (typeof navigator === "undefined") return "unknown";

  const uaData = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  const platform = (uaData?.platform ?? "").toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("android")) return "android";
  if (platform.includes("linux") || platform.includes("chrome os")) return "linux";

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux") || ua.includes("x11") || ua.includes("cros")) return "linux";
  return "unknown";
}

export const OS_LABEL: Record<OsKey, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  unknown: "your platform",
};

/**
 * Whether the visitor is probably on Apple Silicon. Browsers deliberately do not
 * expose this (Safari reports Intel even on an M-series Mac), so this is only
 * used to decide which of the two `.dmg` files is offered *first* — both are
 * always listed, and the macOS install guide explains how to check.
 */
export function guessAppleSilicon(): boolean {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  // Rosetta and Safari both lie about the CPU; WebGL's unmasked renderer is the
  // one hint that survives, and "Apple GPU"/"Apple M" only appears on Silicon.
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) {
      const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
      if (/apple\s*(m\d|gpu)/i.test(renderer)) return true;
      if (/intel|radeon/i.test(renderer)) return false;
    }
  } catch {
    /* WebGL unavailable — fall through to the default. */
  }
  // Most Macs sold since 2020 are Apple Silicon, so that is the safer default.
  return true;
}

/* -------------------------------------------------------------------------- */
/* Release lookup                                                             */
/* -------------------------------------------------------------------------- */

interface CachedPayload {
  at: number;
  releases: Record<Channel, ResolvedRelease | null>;
  stats: RepoStats | null;
}

function readCache(): CachedPayload | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(payload: CachedPayload) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* Private mode / storage disabled — caching is an optimisation, not a need. */
  }
}

function toResolved(release: GitHubRelease, channel: Channel): ResolvedRelease {
  return {
    channel,
    version: release.tag_name.slice(TAG_PREFIX[channel].length),
    tag: release.tag_name,
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
    assets: release.assets
      // `.sig` files belong to the in-app updater, and `latest.json` is its
      // manifest — neither is something a human downloads.
      .filter((a) => !a.name.endsWith(".sig") && a.name !== "latest.json")
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
}

export interface ReleaseData {
  releases: Record<Channel, ResolvedRelease | null>;
  stats: RepoStats | null;
}

/** Fetches both channels and the repo counters in two requests, then caches them. */
export async function fetchReleaseData(signal?: AbortSignal): Promise<ReleaseData> {
  const cached = readCache();
  if (cached) return { releases: cached.releases, stats: cached.stats };

  const releases: Record<Channel, ResolvedRelease | null> = {
    stable: null,
    nightly: null,
  };
  let stats: RepoStats | null = null;

  const [listResult, repoResult] = await Promise.allSettled([
    fetch(`${API}/repos/${REPO_SLUG}/releases?per_page=100`, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    }),
    fetch(`${API}/repos/${REPO_SLUG}`, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    }),
  ]);

  let downloads = 0;

  if (listResult.status === "fulfilled" && listResult.value.ok) {
    const list = (await listResult.value.json()) as GitHubRelease[];
    for (const release of list) {
      if (release.draft) continue;
      for (const asset of release.assets) downloads += asset.download_count ?? 0;
      for (const channel of ["stable", "nightly"] as Channel[]) {
        if (!releases[channel] && release.tag_name.startsWith(TAG_PREFIX[channel])) {
          releases[channel] = toResolved(release, channel);
        }
      }
    }
  }

  if (repoResult.status === "fulfilled" && repoResult.value.ok) {
    const repo = (await repoResult.value.json()) as { stargazers_count?: number };
    stats = { stars: repo.stargazers_count ?? 0, downloads };
  } else if (downloads > 0) {
    stats = { stars: 0, downloads };
  }

  writeCache({ at: Date.now(), releases, stats });
  return { releases, stats };
}

/* -------------------------------------------------------------------------- */
/* Asset matching                                                             */
/* -------------------------------------------------------------------------- */

function find(release: ResolvedRelease, test: (name: string) => boolean) {
  return release.assets.find((a) => test(a.name.toLowerCase()));
}

/**
 * The installers to offer for a platform, most-recommended first.
 *
 * Returns an empty array when a channel simply has no build for that OS — the
 * stable channel had no macOS `.dmg` before the macOS target was introduced, and
 * the UI says so instead of pretending otherwise.
 */
export function downloadOptionsFor(
  os: OsKey,
  release: ResolvedRelease | null,
  preferAppleSilicon = true,
): DownloadOption[] {
  if (!release) return [];
  const opts: DownloadOption[] = [];

  const push = (
    id: string,
    label: string,
    hint: string,
    asset: ReleaseAsset | undefined,
  ) => {
    if (asset) {
      opts.push({ id, label, hint, filename: asset.name, url: asset.url, size: asset.size });
    }
  };

  if (os === "windows") {
    push(
      "win-exe",
      "Download for Windows",
      "64-bit installer · .exe",
      find(release, (n) => n.endsWith("-setup.exe")),
    );
    push(
      "win-msi",
      "Windows installer (MSI)",
      "64-bit · .msi",
      find(release, (n) => n.endsWith(".msi")),
    );
    return opts;
  }

  if (os === "macos") {
    const arm = find(release, (n) => n.endsWith("aarch64.dmg"));
    const intel = find(release, (n) => n.endsWith("x64.dmg"));
    const armOption = () =>
      push("mac-arm", "Download for macOS", "Apple Silicon · .dmg", arm);
    const intelOption = () =>
      push("mac-intel", "Download for macOS", "Intel · .dmg", intel);
    if (preferAppleSilicon) {
      armOption();
      intelOption();
    } else {
      intelOption();
      armOption();
    }
    // Only the first entry keeps the headline label; the rest read as alternates.
    return opts.map((o, i) =>
      i === 0 ? o : { ...o, label: `macOS · ${o.hint.split(" · ")[0]}` },
    );
  }

  if (os === "linux") {
    push(
      "linux-appimage",
      "Download for Linux",
      "x86_64 · .AppImage",
      find(release, (n) => n.endsWith(".appimage")),
    );
    push(
      "linux-deb",
      "Debian / Ubuntu",
      "amd64 · .deb",
      find(release, (n) => n.endsWith(".deb")),
    );
    push(
      "linux-rpm",
      "Fedora / RHEL",
      "x86_64 · .rpm",
      find(release, (n) => n.endsWith(".rpm")),
    );
    return opts;
  }

  return opts;
}

/** Every installer in a release, grouped for the downloads page. */
export function allPlatformOptions(release: ResolvedRelease | null) {
  return (["windows", "macos", "linux"] as OsKey[]).map((os) => ({
    os,
    options: downloadOptionsFor(os, release),
  }));
}

/**
 * macOS builds are ad-hoc signed and never notarised, on **either** channel.
 *
 * This is a property of how the project signs, not of how a given build was
 * published, so the warning is a constant rather than something derived from the
 * release — a stable tag does not make the build any less experimental.
 */
export const MACOS_IS_EXPERIMENTAL = true;

export interface BestDownload {
  option: DownloadOption;
  channel: Channel;
  /** True when the preferred channel had no build and we fell back to the other. */
  fallback: boolean;
}

/**
 * The single installer to put behind the primary button.
 *
 * Prefers the requested channel and falls back to the other one when that
 * channel has nothing for this platform — which is exactly the macOS situation
 * today, where the `.dmg` files exist on nightly before they reach stable. The
 * caller is told it fell back so the UI can say so instead of quietly handing
 * over a pre-release build.
 */
export function resolveBestDownload(
  os: OsKey,
  releases: Record<Channel, ResolvedRelease | null>,
  preferred: Channel = "stable",
  preferAppleSilicon = true,
): BestDownload | null {
  const pack = resolveOsDownloads(os, releases, preferred, preferAppleSilicon);
  if (!pack) return null;
  return {
    option: pack.options[0],
    channel: pack.channel,
    fallback: pack.fallback,
  };
}

/**
 * Every installer format for a platform on the best available channel
 * (stable preferred, nightly as fallback). Used by the hero split button so a
 * Windows user can pick .exe vs .msi without leaving the page.
 */
export function resolveOsDownloads(
  os: OsKey,
  releases: Record<Channel, ResolvedRelease | null>,
  preferred: Channel = "stable",
  preferAppleSilicon = true,
): { options: DownloadOption[]; channel: Channel; fallback: boolean } | null {
  if (os !== "windows" && os !== "macos" && os !== "linux") return null;

  const order: Channel[] =
    preferred === "stable" ? ["stable", "nightly"] : ["nightly", "stable"];

  for (const channel of order) {
    const options = downloadOptionsFor(os, releases[channel], preferAppleSilicon);
    if (options.length > 0) {
      return { options, channel, fallback: channel !== preferred };
    }
  }
  return null;
}
