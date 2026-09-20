/**
 * Build-time fallback for the repository counters.
 *
 * The static export uses these numbers for the first paint. After hydration,
 * `components/repo-stats.tsx` refreshes them from the same-origin Pages
 * Function. If GitHub is unreachable or rate-limits the build, the caller gets
 * `null`; the live endpoint can still fill the row in the browser.
 */

import { isInstallerAsset, type RepoStats } from "./repo-stats";

const REPO = "luisgamas/uxnan";

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
export async function getRepoStats(): Promise<RepoStats | null> {
  /* Anonymous calls are capped at 60/hour per IP, which a CI runner can burn
     through. `GITHUB_TOKEN` is present on Actions and lifts that to 1000. */
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "uxnan-site",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  /* One hour of cache keeps the static build from re-hitting the API repeatedly. */
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
          .filter((asset) => isInstallerAsset(asset.name))
          .reduce((sum, asset) => sum + (asset.download_count ?? 0), 0),
      0,
    );

    return { stars: repo.stargazers_count, downloads };
  } catch {
    return null;
  }
}
