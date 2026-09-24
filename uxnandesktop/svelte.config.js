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
      // The bridge contract, straight from its source of truth. Imported for
      // TYPES only (`import type`), so it is erased at build time and adds no
      // runtime dependency: the chat panel draws the very Thread / Turn /
      // Message model the bridge and the phone use, instead of a copy that
      // would drift (plan 030: one model, no private one).
      $shared: "../shared/src",
    },
  },
};

export default config;
