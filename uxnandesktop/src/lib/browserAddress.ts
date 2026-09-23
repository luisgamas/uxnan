// The integrated browser's address bar and zoom steps — pure, so they are
// unit-tested directly.

/** Loopback hosts, which a dev server listens on over plain `http`. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/** Turn what the person typed into an address to load, or `null` for nothing.
 *  Explicit schemes and `about:` pass through; a loopback host gets `http://`
 *  (a dev server); anything else gets `https://`. */
export function normalizeAddress(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^about:/i.test(s)) return s.toLowerCase() === "about:blank" ? "about:blank" : s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (LOOPBACK.test(s) || /^[a-z0-9-]+\.localhost(?::\d+)?(?:[/?#]|$)/i.test(s)) return `http://${s}`;
  return `https://${s}`;
}

/** What the address bar shows for a page URL: nothing for the empty page. */
export function displayAddress(url: string): string {
  return url === "about:blank" ? "" : url;
}

/** Whether a page URL is served over TLS (the address bar's lock). */
export function isSecureAddress(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/** The zoom levels the toolbar steps through, as page scale factors. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** The next zoom level from `current` in `direction` (+1 in, -1 out), staying
 *  at the ends. A level between steps moves to the nearest one that way. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  const lower = ZOOM_STEPS.filter((z) => z < current - 1e-6);
  return lower[lower.length - 1] ?? ZOOM_STEPS[0];
}
