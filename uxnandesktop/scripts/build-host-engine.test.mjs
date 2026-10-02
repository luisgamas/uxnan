import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TARGETS, canBuild, executableName, missing, paths, selected } from "./build-host-engine.mjs";

describe("build-host-engine", () => {
  it("ships an engine for Linux on both architectures and macOS on both", () => {
    expect(TARGETS.map((t) => t.triple).sort()).toEqual([
      "aarch64-apple-darwin",
      "aarch64-unknown-linux-musl",
      "x86_64-apple-darwin",
      "x86_64-unknown-linux-musl",
    ]);
  });

  it("names the bundled file per triple, where the app looks for it", () => {
    const { bundled } = paths("x86_64-unknown-linux-musl", "/r");
    expect(bundled.replaceAll("\\", "/")).toBe("/r/host-engine/x86_64-unknown-linux-musl/uxnan-host");
    expect(executableName("x86_64-pc-windows-msvc")).toBe("uxnan-host.exe");
  });

  it("reports exactly the builds that are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "host-engine-"));
    const present = paths("aarch64-apple-darwin", root).bundled;
    mkdirSync(join(present, ".."), { recursive: true });
    writeFileSync(present, "binary");
    expect(missing(root).sort()).toEqual([
      "aarch64-unknown-linux-musl",
      "x86_64-apple-darwin",
      "x86_64-unknown-linux-musl",
    ]);
  });

  it("builds exactly the targets a runner names, and every buildable one otherwise", () => {
    const triples = (argv, platform) => selected(argv, platform).map((t) => t.triple).sort();
    expect(triples(["--build", "--targets", "aarch64-apple-darwin x86_64-apple-darwin"], "darwin")).toEqual([
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
    ]);
    expect(triples(["--build"], "linux")).toEqual(["aarch64-unknown-linux-musl", "x86_64-unknown-linux-musl"]);
    expect(triples(["--build"], "darwin")).toHaveLength(4);
    expect(() => selected(["--targets", "x86_64-pc-windows-msvc"], "linux")).toThrow(/no engine/);
    expect(() => selected(["--targets"], "linux")).toThrow(/no engine/);
  });

  it("builds the Apple engines only on a Mac", () => {
    const apple = TARGETS.find((t) => t.triple === "aarch64-apple-darwin");
    const linux = TARGETS.find((t) => t.triple === "x86_64-unknown-linux-musl");
    expect(canBuild(apple, "linux")).toBe(false);
    expect(canBuild(apple, "darwin")).toBe(true);
    expect(canBuild(linux, "linux")).toBe(true);
  });
});
