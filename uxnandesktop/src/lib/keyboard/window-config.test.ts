import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The main window is built in Rust (`lib.rs` setup) so its web inspector exists
// only in development builds. Tauri must therefore not also create it from the
// config — in every config that declares it, since a platform overlay replaces
// the whole `windows` array.
describe("the main window's config", () => {
  for (const file of ["tauri.conf.json", "tauri.macos.conf.json"]) {
    it(`leaves creating it to the app (${file})`, () => {
      const config = JSON.parse(
        readFileSync(new URL(`../../../src-tauri/${file}`, import.meta.url), "utf8"),
      ) as { app: { windows: { label?: string; create?: boolean }[] } };
      const main = config.app.windows.find((w) => (w.label ?? "main") === "main");
      expect(main?.create).toBe(false);
    });
  }
});
