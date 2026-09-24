// The integrated browser's address bar and zoom steps — pure, so they are
// unit-tested directly.

import type { SearchEngine } from "$lib/types";

/** Loopback hosts, which a dev server listens on over plain `http`. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
/** `name.localhost` — also this machine. */
const LOCAL_SUBDOMAIN = /^[a-z0-9-]+\.localhost(?::\d+)?(?:[/?#]|$)/i;
/** A domain name: dotted labels ending in a letters-only top-level one. */
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\.?(?::\d{1,5})?(?:[/?#]\S*)?$/i;
/** An IPv4 address, which on a developer's network is a dev server (`http`). */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#]\S*)?$/;
/** One host name with a port (`devbox:8080`) — a machine on the network. */
const HOST_PORT = /^[a-z0-9-]+:\d{1,5}(?:[/?#]\S*)?$/i;

/** The search engines the address bar can ask, as URL templates (`%s` is the
 *  query). `custom` takes the person's own template. */

export const SEARCH_ENGINES: Record<Exclude<SearchEngine, "custom">, { name: string; template: string }> = {
  google: { name: "Google", template: "https://www.google.com/search?q=%s" },
  duckduckgo: { name: "DuckDuckGo", template: "https://duckduckgo.com/?q=%s" },
  bing: { name: "Bing", template: "https://www.bing.com/search?q=%s" },
  brave: { name: "Brave Search", template: "https://search.brave.com/search?q=%s" },
};

/** Whether a custom search template can be used: an http(s) URL with `%s`. */
export function isSearchTemplate(template: string): boolean {
  return /^https?:\/\/\S+$/i.test(template.trim()) && template.includes("%s");
}

/** The template a search goes to: the chosen engine's, or the custom one when
 *  it is usable — else Google, so a search always lands somewhere. */
export function searchTemplate(engine: SearchEngine | undefined, custom = ""): string {
  if (engine === "custom") return isSearchTemplate(custom) ? custom.trim() : SEARCH_ENGINES.google.template;
  return SEARCH_ENGINES[engine ?? "google"]?.template ?? SEARCH_ENGINES.google.template;
}

/** Turn what the person typed into the address to load (`null` for nothing),
 *  the way a browser's address bar does: an address loads, anything else is
 *  searched. Explicit schemes and `about:` pass through; this machine and the
 *  local network (loopback, `*.localhost`, an IPv4 address, `host:port`) get
 *  `http://` — a dev server; a domain name gets `https://`; words, spaces or
 *  anything else go to `template` (`%s` = the query). */
export function resolveAddress(input: string, template: string = SEARCH_ENGINES.google.template): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^about:/i.test(s)) return s.toLowerCase() === "about:blank" ? "about:blank" : s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s)) {
    if (LOOPBACK.test(s) || LOCAL_SUBDOMAIN.test(s) || IPV4.test(s) || HOST_PORT.test(s)) return `http://${s}`;
    if (DOMAIN.test(s)) return `https://${s}`;
  }
  return template.replace("%s", encodeURIComponent(s));
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
