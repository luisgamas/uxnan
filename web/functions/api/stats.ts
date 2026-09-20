import { isInstallerAsset, type RepoStats } from "../../src/lib/repo-stats";

const REPO = "luisgamas/uxnan";
const GITHUB_API = "https://api.github.com";
const CACHE_SECONDS = 900;
const STALE_SECONDS = 86_400;

type GitHubAsset = {
  name?: unknown;
  download_count?: unknown;
};

type GitHubRelease = {
  assets?: unknown;
};

type GitHubContext = {
  request: Request;
};

type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type Runtime = typeof globalThis & {
  caches?: { default: EdgeCache };
};

const edgeCache = (globalThis as Runtime).caches?.default;

function headers(): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "uxnan-site-stats",
  };
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function nextPage(link: string | null): string | null {
  if (!link) return null;

  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1];
  }

  return null;
}

async function fetchReleases(): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  let url: string | null =
    `${GITHUB_API}/repos/${REPO}/releases?per_page=100&page=1`;

  while (url) {
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) throw new Error(`GitHub releases returned ${response.status}`);

    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error("GitHub releases returned invalid data");

    releases.push(...(page as GitHubRelease[]));
    url = nextPage(response.headers.get("link"));
  }

  return releases;
}

function countDownloads(releases: GitHubRelease[]): number {
  return releases.reduce((total, release) => {
    if (!Array.isArray(release.assets)) return total;

    return (
      total +
      release.assets.reduce((releaseTotal, value) => {
        if (typeof value !== "object" || value === null) return releaseTotal;

        const asset = value as GitHubAsset;
        if (!isInstallerAsset(asset.name)) return releaseTotal;
        if (
          typeof asset.download_count !== "number" ||
          !Number.isSafeInteger(asset.download_count) ||
          asset.download_count < 0
        ) {
          return releaseTotal;
        }

        return releaseTotal + asset.download_count;
      }, 0)
    );
  }, 0);
}

async function readStats(): Promise<RepoStats> {
  const repositoryResponse = await fetch(`${GITHUB_API}/repos/${REPO}`, {
    headers: headers(),
  });
  if (!repositoryResponse.ok) {
    throw new Error(`GitHub repository returned ${repositoryResponse.status}`);
  }

  const repository: unknown = await repositoryResponse.json();
  if (
    typeof repository !== "object" ||
    repository === null ||
    typeof (repository as { stargazers_count?: unknown }).stargazers_count !==
      "number" ||
    !Number.isSafeInteger(
      (repository as { stargazers_count: number }).stargazers_count,
    ) ||
    (repository as { stargazers_count: number }).stargazers_count < 0
  ) {
    throw new Error("GitHub repository returned invalid data");
  }

  return {
    stars: (repository as { stargazers_count: number }).stargazers_count,
    downloads: countDownloads(await fetchReleases()),
  };
}

export async function onRequest({ request }: GitHubContext): Promise<Response> {
  if (request.method !== "GET") {
    return json(
      { error: "method_not_allowed" },
      { status: 405, headers: { allow: "GET" } },
    );
  }

  const cacheKey = new Request(new URL("/api/stats", request.url), {
    method: "GET",
  });
  const cached = await edgeCache?.match(cacheKey);
  if (cached) return cached;

  try {
    const response = json(await readStats(), {
      headers: {
        "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    });

    await edgeCache?.put(cacheKey, response.clone());
    return response;
  } catch {
    return json(
      { error: "stats_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
