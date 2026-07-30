// Remote agent logos are fetched by the backend, never by the webview.
//
// Most catalog agents have no bundled SVG and fall back to their product's
// favicon (`agentCatalog.faviconUrl`). Putting that URL straight into an `<img>`
// could never work: the app ships a deliberately tight CSP whose `img-src` allows
// only `'self' data: blob: asset:`, so every one of those requests was blocked —
// which is why the favicon half of the fallback chain rendered nothing and most
// agents showed the generic Bot glyph. (Widening the CSP wouldn't be enough on
// its own either: the favicon service answers 301 to another host, so the
// allowance would have to cover the redirect target too.)
//
// Fetching through `image_fetch_data_url` — the same Rust command project and
// branch icons already use — sidesteps both: reqwest follows the redirect, and
// what comes back is a `data:` URL, which the existing CSP already allows.
//
// Results are memoized for the session, including failures (a null), so a
// missing logo is attempted once rather than on every render. They are NOT
// persisted: the whole set is a few KB of tiny PNGs, fetched only while a view
// that shows catalog agents is open.

import { invoke } from "@tauri-apps/api/core";

/** Resolved logos: URL → `data:` URL, or `null` when it could not be fetched. */
const cache = new Map<string, string | null>();
/** In-flight fetches, so N components asking for the same logo make one call. */
const inflight = new Map<string, Promise<string | null>>();

/** Whether this candidate has to go through the backend (vs. a bundled asset). */
export function isRemoteLogo(src: string): boolean {
  return /^https?:/i.test(src);
}

/** The already-resolved logo for `url`: a `data:` URL, `null` if it failed, or
 *  `undefined` if it hasn't been fetched yet. Synchronous — for a render that
 *  shouldn't wait. */
export function peekRemoteLogo(url: string): string | null | undefined {
  return cache.get(url);
}

/** Fetch `url` through the backend and memoize it. Never throws: a failure is
 *  cached as `null` so the caller can fall back to its glyph and we don't retry
 *  a dead URL on every render. `fetcher` is injectable for tests only. */
export function resolveRemoteLogo(
  url: string,
  fetcher: (url: string) => Promise<string> = (u) =>
    invoke<string>("image_fetch_data_url", { url: u }),
): Promise<string | null> {
  const hit = cache.get(url);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = fetcher(url)
    .then((dataUrl) => {
      const value = dataUrl?.startsWith("data:") ? dataUrl : null;
      cache.set(url, value);
      return value;
    })
    .catch(() => {
      // Offline, blocked, no backend (web preview) — all the same to the caller.
      cache.set(url, null);
      return null;
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, task);
  return task;
}

/** Forget every resolved logo, so the next render re-fetches. Used by the manual
 *  refresh in Settings → Agents: re-checking what's installed is also the moment
 *  to retry a logo that failed while the machine was offline. */
export function clearRemoteLogoCache(): void {
  cache.clear();
}
