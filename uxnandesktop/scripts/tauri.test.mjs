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
    // `path.join` uses the host's separator: match either, the test runs on all three.
    const sep = "[\\\\/]";
    const mac = paths("aarch64-apple-darwin");
    expect(mac.built).toMatch(new RegExp(`src-tauri${sep}target${sep}aarch64-apple-darwin${sep}release${sep}uxnan-cli$`));
    expect(mac.sidecar).toMatch(new RegExp(`src-tauri${sep}binaries${sep}uxnan-cli-aarch64-apple-darwin$`));
    const win = paths("x86_64-pc-windows-msvc");
    expect(win.built).toMatch(new RegExp(`release${sep}uxnan-cli\\.exe$`));
    expect(win.sidecar).toMatch(new RegExp(`binaries${sep}uxnan-cli-x86_64-pc-windows-msvc\\.exe$`));
  });
});
