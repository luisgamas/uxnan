import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANIFEST,
  NODE,
  NODE_VERSION,
  buildManifest,
  hostTriple,
  layoutFor,
  listFiles,
  lockedClosure,
  packageDir,
  stagingPackage,
  tarCommand,
  targetOf,
  verify,
} from "./build-bridge-runtime.mjs";

describe("build-bridge-runtime", () => {
  it("pins a verified Node for every installer the release builds", () => {
    for (const triple of [
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
      "x86_64-unknown-linux-gnu",
      "x86_64-pc-windows-msvc",
    ]) {
      expect(NODE[triple]).toBeDefined();
    }
    for (const spec of Object.values(NODE)) {
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.keyring).toMatch(/^@napi-rs\/keyring-/);
    }
    expect(NODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names this machine's triple and refuses an unknown one", () => {
    expect(hostTriple("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(hostTriple("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
    expect(hostTriple("win32", "x64")).toBe("x86_64-pc-windows-msvc");
    expect(hostTriple("aix", "ppc64")).toBeNull();
    expect(targetOf(["--target", "x86_64-apple-darwin"])).toBe("x86_64-apple-darwin");
    expect(() => targetOf(["--target", "riscv64-unknown-linux-gnu"])).toThrow(/no bridge runtime/);
  });

  it("lays out the runtime the way the bridge recognizes it", () => {
    expect(layoutFor("aarch64-apple-darwin")).toEqual({
      node: "node/bin/node",
      cli: "app/node_modules/uxnan-bridge/dist/src/cli.js",
    });
    expect(layoutFor("x86_64-pc-windows-msvc").node).toBe("node/node.exe");
  });

  it("pins the bridge's production closure to the lockfile, never a workspace or a split name", () => {
    const lock = {
      packages: {
        bridge: { dependencies: { "@uxnan/shared": "*", ws: "^8", ajv: "^8", dup: "^1" } },
        shared: { dependencies: { ajv: "^8" } },
        "node_modules/@uxnan/shared": { link: true, resolved: "shared" },
        "node_modules/ws": { version: "8.21.0" },
        "node_modules/ajv": { version: "8.20.0", dependencies: { "fast-uri": "^3", dup: "^1" } },
        "node_modules/fast-uri": { version: "3.1.2" },
        "node_modules/dup": { version: "1.0.0" },
        "node_modules/ajv/node_modules/dup": { version: "2.0.0" },
        "node_modules/typescript": { version: "5.9.3", dev: true },
      },
    };
    expect(lockedClosure(lock)).toEqual({ ajv: "8.20.0", "fast-uri": "3.1.2", ws: "8.21.0" });
  });

  it("never pins a direct dependency of the runtime as an override", () => {
    const pkg = stagingPackage({
      sharedTgz: "/t/s.tgz",
      bridgeTgz: "/t/b.tgz",
      keyringVersion: "1.3.0",
      pins: { ws: "8.21.0", "@napi-rs/keyring": "1.2.0" },
    });
    expect(pkg.dependencies["uxnan-bridge"]).toBe("file:/t/b.tgz");
    expect(pkg.dependencies["@napi-rs/keyring"]).toBe("1.3.0");
    // The target's native build is added after the install, never by npm:
    // npm refuses another CPU's package (the Intel DMG builds on Apple Silicon).
    expect(Object.keys(pkg.dependencies).some((d) => d.startsWith("@napi-rs/keyring-"))).toBe(false);
    expect(pkg.overrides).toEqual({ ws: "8.21.0" });
  });

  it("places a scoped package under node_modules by its name", () => {
    expect(packageDir("@napi-rs/keyring-darwin-x64")).toEqual(["node_modules", "@napi-rs", "keyring-darwin-x64"]);
    expect(packageDir("ws")).toEqual(["node_modules", "ws"]);
  });

  it("hashes every file, and a changed or missing one fails verification", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-runtime-"));
    const { node, cli } = layoutFor("aarch64-apple-darwin");
    for (const file of [node, cli]) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), file);
    }
    const manifest = buildManifest(dir, { triple: "aarch64-apple-darwin", bridgeVersion: "0.0.54" });
    expect(manifest.files.map((f) => f.path).sort()).toEqual([cli, node].sort());
    expect(manifest.files.find((f) => f.path === node)?.executable).toBe(true);
    writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest));
    expect(verify(dir, "aarch64-apple-darwin")).toEqual([]);
    expect(verify(dir, "x86_64-apple-darwin")).toEqual(["built for aarch64-apple-darwin, not x86_64-apple-darwin"]);
    writeFileSync(join(dir, cli), "changed");
    expect(verify(dir, "aarch64-apple-darwin")).toEqual([`changed ${cli}`]);
  });

  it("unpacks with Windows' own tar, never the GNU tar a bash step finds first", () => {
    const env = { SystemRoot: "C:\\Windows" };
    const system = join("C:\\Windows", "System32", "tar.exe");
    expect(tarCommand("win32", env, (p) => p === system)).toBe(system);
    expect(tarCommand("win32", env, () => false)).toBe("tar");
    expect(tarCommand("linux", env, () => true)).toBe("tar");
    expect(tarCommand("darwin", {}, () => true)).toBe("tar");
  });

  it("refuses a symbolic link in the tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-runtime-link-"));
    writeFileSync(join(dir, "a"), "a");
    symlinkSync(join(dir, "a"), join(dir, "b"));
    expect(() => listFiles(dir)).toThrow(/symbolic link/);
  });
});
