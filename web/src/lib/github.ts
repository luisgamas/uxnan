/**
 * Repository counters, read once at build time.
 *
 * The site is a static export, so these numbers are baked into the HTML by
 * `next build` — no request happens in the visitor's browser. Every deploy
 * refreshes them. If GitHub is unreachable or rate-limits the build, the
 * caller gets `null` and the page simply omits the row rather than showing a
 * number nobody can vouch for.
 */

const REPO = "luisgamas/uxnan";

export type RepoStats = { stars: number; downloads: number };

type Release = {
  tag_name?: string;
  assets?: { name?: string; download_count?: number }[];
};

/**
 * Why this number is not "every asset in every release".
 *
 * The in-app updater polls a rolling release (`desktop-updater-stable` /
 * `-nightly`) for a `latest.json` manifest, and the release workflow re-uploads
 * that file with `gh release upload --clobber` on every version. Clobbering
 * deletes the asset and creates a new one, so its `download_count` — which by
 * then holds every update check every installed app has made — resets to zero.
 * A naive total therefore *drops* by that amount each time a release ships,
 * which is what the shields.io badge in the README shows.
 *
 * Update pings are not downloads of the product anyway, so the total counts
 * **installers only** — the artifacts a person actually installs. Manifests,
 * signatures and updater bundles are excluded, which both stabilises the number
 * and makes it mean what the label says. Add an extension here when a release
 * starts shipping a new installable format.
 */
const INSTALLER = /\.(exe|msi|dmg|deb|rpm|AppImage|apk|aab)$/i;

export async function getRepoStats(): Promise<RepoStats | null> {
  /* Anonymous calls are capped at 60/hour per IP, which a CI runner can burn
     through. `GITHUB_TOKEN` is present on Actions and lifts that to 1000. */
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "uxnan-site",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  /* One hour of cache keeps `next dev` from re-hitting the API on every reload. */
  const init = { headers, next: { revalidate: 3600 } };

  try {
    const [repoRes, releasesRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}`, init),
      fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, init),
    ]);

    if (!repoRes.ok || !releasesRes.ok) return null;

    const repo = (await repoRes.json()) as { stargazers_count?: number };
    const releases = (await releasesRes.json()) as Release[];

    if (typeof repo.stargazers_count !== "number") return null;

    const downloads = releases.reduce(
      (total, release) =>
        total +
        (release.assets ?? [])
          .filter((asset) => INSTALLER.test(asset.name ?? ""))
          .reduce((sum, asset) => sum + (asset.download_count ?? 0), 0),
      0,
    );

    return { stars: repo.stargazers_count, downloads };
  } catch {
    return null;
  }
}

/** 1_204 → "1,204"; 12_400 → "12.4k". */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return value.toLocaleString("en-US");
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
