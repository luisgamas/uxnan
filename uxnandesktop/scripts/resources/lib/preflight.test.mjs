import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkBinaryEmbedsFrontend, checkExpectedShells, checkWebviewInTree } from "./preflight.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uxnan-preflight-test-"));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

function sample(ownProcs, managedProcs = ownProcs) {
  const bucket = { procs: ownProcs, rssMb: 27, privateMb: 5, threads: 27, handles: 330, cpuPct: 0 };
  return {
    t: 0,
    own: bucket,
    managed: { ...bucket, procs: managedProcs },
    external: { ...bucket, procs: 0, rssMb: 0 },
  };
}

describe("checkWebviewInTree", () => {
  it("accepts a run whose webview is inside the tree", () => {
    expect(checkWebviewInTree([sample(1), sample(7)], { os: "win32" })).toBeNull();
  });

  it("rejects a run that only ever saw the main process", () => {
    // The exact failure the harness hit: 27 MB and no webview, because another
    // instance owned the shared WebView2 browser process.
    const reason = checkWebviewInTree([sample(1), sample(1)], { os: "win32" });
    expect(reason).toMatch(/never appeared inside the measured process tree/);
    expect(reason).toMatch(/close every other uxnan instance/i);
  });

  it("says so when there are no samples at all", () => {
    expect(checkWebviewInTree([], { os: "win32" })).toMatch(/no samples/);
  });

  it("stays quiet on macOS, where the content process is outside the tree by design", () => {
    expect(checkWebviewInTree([sample(1)], { os: "darwin" })).toBeNull();
  });
});

describe("checkExpectedShells", () => {
  it("accepts a run where the seeded shells came back", () => {
    expect(checkExpectedShells([sample(7, 7), sample(7, 11)], 4)).toBeNull();
  });

  it("rejects a run that restored fewer terminals than it seeded", () => {
    const reason = checkExpectedShells([sample(7, 9)], 4);
    expect(reason).toMatch(/seeded 4 live terminal\(s\) but at most 2/);
  });

  it("catches the session not restoring at all", () => {
    // The exact shape of the dev-mode-binary failure: webview up, no shells.
    expect(checkExpectedShells([sample(7, 7)], 1)).toMatch(/did not restore/);
  });

  it("has nothing to say when a scenario seeds no terminals", () => {
    expect(checkExpectedShells([sample(7, 7)], 0)).toBeNull();
  });
});

describe("checkBinaryEmbedsFrontend", () => {
  const write = (name, contents) => {
    const file = path.join(TMP, name);
    fs.writeFileSync(file, contents);
    return file;
  };

  it("accepts a binary containing the built asset keys", () => {
    const blob = Buffer.concat([
      Buffer.alloc(3_000_000, 0x41),
      Buffer.from("/_app/immutable/entry/start.abc123.js"),
      Buffer.alloc(1000, 0x42),
    ]);
    expect(checkBinaryEmbedsFrontend(write("good.exe", blob))).toBeNull();
  });

  it("finds a marker straddling a read-chunk boundary", () => {
    // 1 MiB chunks: place the marker so it spans the first boundary.
    const marker = "_app/immutable";
    const head = Buffer.alloc((1 << 20) - 5, 0x41);
    const blob = Buffer.concat([head, Buffer.from(marker), Buffer.alloc(100, 0x42)]);
    expect(checkBinaryEmbedsFrontend(write("split.exe", blob))).toBeNull();
  });

  it("rejects a dev-mode binary and names the build command", () => {
    const reason = checkBinaryEmbedsFrontend(write("dev.exe", Buffer.alloc(2_000_000, 0x41)));
    expect(reason).toMatch(/no embedded frontend/);
    expect(reason).toMatch(/localhost:1420/);
    expect(reason).toMatch(/npm run bench:build/);
  });

  it("reports a binary it cannot read", () => {
    expect(checkBinaryEmbedsFrontend(path.join(TMP, "missing.exe"))).toMatch(/cannot read/);
  });
});
