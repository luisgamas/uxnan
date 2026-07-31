import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { fileURLToPath } from "node:url";

/**
 * Component tests: real Svelte 5 components, mounted in jsdom.
 *
 * Deliberately *not* the SvelteKit plugin — these tests mount components
 * directly, so pulling in the router, the server runtime and the `$app/*`
 * modules would buy nothing and cost start-up time. Anything a component needs
 * from SvelteKit is aliased below.
 *
 * `svelteTesting()` wires the Testing Library cleanup between tests, so a
 * forgotten unmount in one file cannot leak a mounted component into the next.
 *
 * Files are `*.svelte.test.ts`, which is also how the `node` project knows to
 * skip them.
 */
export default defineConfig({
  plugins: [
    svelte({
      // Ignore `svelte.config.js`. It is written for SvelteKit and runs
      // `vitePreprocess`, whose CSS step needs a full Vite environment that does
      // not exist in a Vitest worker — it fails on the first `<style>` block in
      // a dependency (`svelte-sonner`'s Toaster) before any test can run.
      configFile: false,
      // Nothing here needs preprocessing: the app's components are plain Svelte
      // 5 with Tailwind classes, no `lang="scss"` and no custom syntax.
      preprocess: [],
      // Styles are irrelevant to behaviour tests — jsdom has no layout engine,
      // so no assertion can depend on them. Skipping extraction is a real
      // speed-up across a suite that compiles a lot of components.
      emitCss: false,
      hot: false,
    }),
    svelteTesting(),
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      $test: fileURLToPath(new URL("./src/test", import.meta.url)),
    },
    // No `conditions` override here on purpose. Svelte 5 does need the `browser`
    // condition under jsdom (otherwise components resolve to their SSR build and
    // nothing ever updates), but setting it by hand *replaces* Vite's default
    // list rather than extending it. `svelteTesting()` adds the condition the
    // correct way, alongside the defaults.
    //
    // `mainFields` prefers `module` over `main`, which is what the app's own
    // build does and what these packages actually ship: `@xterm/addon-ligatures`
    // declares `main: lib/addon-ligatures.js` and publishes only the `.mjs`, so
    // resolving `main` first fails outright. Ordering it this way fixes that
    // class of package rather than special-casing one name.
    mainFields: ["browser", "module", "jsnext:main", "jsnext", "main"],
    // `mainFields` only covers packages *without* an `exports` map. Packages
    // that have one (`runed`, `bits-ui`, `svelte-sonner`) are resolved by
    // condition, and Svelte libraries publish their source under a `svelte`
    // condition. Listing it explicitly — with `browser` and Vite's own defaults
    // alongside, since this replaces the list rather than extending it — is what
    // makes the app's real dependency graph load under test.
    conditions: ["svelte", "browser", "module", "import", "default"],
  },
  ssr: {
    // Vitest resolves node_modules through the SSR pipeline; it needs the same
    // conditions, or a Svelte-only package resolves in the client graph and
    // fails in the server one.
    resolve: {
      conditions: ["svelte", "browser", "module", "import", "default"],
    },
  },
  test: {
    name: "dom",
    environment: "jsdom",
    include: ["src/**/*.svelte.test.ts"],
    setupFiles: ["./src/test/setup.dom.ts"],
    // A component test that hangs is almost always a promise the fake backend
    // never resolved; fail it quickly instead of stalling CI for the default.
    testTimeout: 10_000,
  },
});
