// The two scripts behind `npm run tauri`: which commands get the sidecar
// overlay, and where the sidecar is built to and copied from.
import { describe, expect, it } from "vitest";
import { withOverlay } from "./tauri.mjs";
import { paths, targetTriple } from "./build-cli.mjs";

describe("the tauri wrapper", () => {
  it("applies the sidecar overlay to dev and build only", () => {
    expect(withOverlay(["dev"])).toEqual(["dev", "--config", "src-tauri/tauri.cli.conf.json"]);
    expect(withOverlay(["build", "--target", "x86_64-apple-darwin"])).toEqual([
      "build",
      "--config",
      "src-tauri/tauri.cli.conf.json",
      "--target",
      "x86_64-apple-darwin",
    ]);
    // The benchmarks build the bare executable: no bundle, no sidecar.
    expect(withOverlay(["build", "--no-bundle"])).toEqual(["build", "--no-bundle"]);
    expect(withOverlay(["info"])).toEqual(["info"]);
    expect(withOverlay([])).toEqual([]);
  });
});

describe("the sidecar build", () => {
  it("takes the triple Tauri hands its before-commands", () => {
    expect(targetTriple({ TAURI_ENV_TARGET_TRIPLE: "x86_64-pc-windows-msvc" })).toBe(
      "x86_64-pc-windows-msvc",
    );
  });

  it("names the sidecar the way externalBin expects, per platform", () => {
    const mac = paths("aarch64-apple-darwin");
    expect(mac.built).toMatch(/src-tauri\/target\/aarch64-apple-darwin\/release\/uxnan-cli$/);
    expect(mac.sidecar).toMatch(/src-tauri\/binaries\/uxnan-cli-aarch64-apple-darwin$/);
    const win = paths("x86_64-pc-windows-msvc");
    expect(win.built).toMatch(/release\/uxnan-cli\.exe$/);
    expect(win.sidecar).toMatch(/binaries\/uxnan-cli-x86_64-pc-windows-msvc\.exe$/);
  });
});
