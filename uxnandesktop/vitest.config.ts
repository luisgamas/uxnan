import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal Vitest setup for the pure logic modules (no SvelteKit plugin needed —
// these tests don't render components). The `$lib` alias mirrors the app so the
// modules import exactly as they do in the app.
export default defineConfig({
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
