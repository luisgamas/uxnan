// A shared, coarsely-ticking "current time" so relative timestamps in the UI
// re-render on their own. The agent view's rows only need "now / 5m / 2h / 3d"
// granularity, so a 30 s tick is plenty (and cheap — one interval drives every
// consumer). The pure formatter lives in `relTime.ts` (re-exported here).

export { relTime } from "./relTime";

let nowMs = $state(Date.now());

// Guard against running during SSR/prerender (adapter-static builds in Node); the
// interval only matters in the live webview.
if (typeof window !== "undefined") {
  setInterval(() => (nowMs = Date.now()), 30_000);
}

/** Reactive current epoch-ms. Read it in a `$derived`/template to re-run on tick. */
export const clock = {
  get now(): number {
    return nowMs;
  },
};
