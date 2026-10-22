// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    alias: {
      // The bridge contract, straight from its source of truth: the chat panel
      // draws the very Thread / Turn / Message model the bridge and the phone
      // use, instead of a copy that would drift (architecture/02a §5.8.16: one
      // model, no private one). Imported for TYPES (`import type`, erased at
      // build time), plus the pure, dependency-free history helpers
      // (`models/history.ts`: how a run of steps is summarized, when a step
      // failed or runs) — so the desktop counts a run exactly as the bridge
      // and the phone do.
      $shared: "../shared/src",
    },
  },
};

export default config;
