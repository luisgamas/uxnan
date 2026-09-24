/**
 * The production build must not break the terminal it ships.
 *
 * `build-target.js` pins the syntax the frontend is compiled down to, because
 * Vite's default target made esbuild lower-then-minify xterm.js's DECRQM handler
 * into a ReferenceError: the first TUI that queried a mode (OpenCode 2 does, at
 * startup) killed that tab's parser and every later byte was dropped.
 *
 * This runs xterm.js exactly as the app ships it — the package's ESM build,
 * minified with esbuild under `BUILD_TARGET` — and asks it the questions such a
 * TUI asks. A target that brings the lowering back fails here instead of on a
 * user's frozen tab. (The browser build parses and answers without `open()`, so
 * plain Node is enough — and esbuild itself refuses to run under jsdom.)
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformWithEsbuild } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUILD_TARGET } from "../build-target.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Minify `code` the way the production build does. */
async function shipped(code, name) {
  const out = await transformWithEsbuild(code, name, {
    minify: true,
    format: "esm",
    target: BUILD_TARGET,
  });
  return out.code;
}

describe("build target", () => {
  it("never lowers logical assignment", async () => {
    // The shape TypeScript compiles an enum declared inside a method to — the
    // exact construct esbuild mangled in xterm.js.
    const code = shipped(
      'export function f(){ let r; (P=>(P[P.X=0]="X"))(r||={}); return r.X; }',
      "enum.js",
    );
    expect(await code).toContain("||=");
  });
});

describe("xterm.js as the app ships it", () => {
  let dir;
  let Terminal;

  beforeAll(async () => {
    const entry = require.resolve("@xterm/xterm/lib/xterm.mjs", { paths: [path.resolve(HERE, "..")] });
    const code = await shipped(fs.readFileSync(entry, "utf8"), "xterm.mjs");
    // Inside the project, not the OS temp dir: on Windows that is an 8.3 short
    // path (`RUNNER~1`), whose `~` Vite URL-encodes and then cannot load.
    const cache = path.resolve(HERE, "..", "node_modules", ".cache");
    fs.mkdirSync(cache, { recursive: true });
    dir = fs.mkdtempSync(path.join(cache, "uxnan-xterm-"));
    const file = path.join(dir, "xterm.min.mjs");
    fs.writeFileSync(file, code);
    ({ Terminal } = await import(/* @vite-ignore */ pathToFileURL(file).href));
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write `data`; reject if xterm never finishes parsing it — the symptom of a
   *  handler that threw, which leaves the write queue stalled for good. */
  function write(term, data) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the write never completed")), 2000);
      term.write(data, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Write `data` to a fresh terminal; resolve with what it answered. */
  async function ask(data) {
    const term = new Terminal({ allowProposedApi: true });
    const replies = [];
    term.onData((d) => replies.push(d));
    try {
      await write(term, data);
      return replies.join("");
    } finally {
      term.dispose();
    }
  }

  it("answers a DEC private mode request (DECRQM)", async () => {
    // Synchronized output, which xterm.js 6 supports and reports as reset.
    expect(await ask("\x1b[?2026$p")).toBe("\x1b[?2026;2$y");
  });

  it("answers an ANSI mode request", async () => {
    // Insert mode (IRM), off by default.
    expect(await ask("\x1b[4$p")).toBe("\x1b[4;2$y");
  });

  it("keeps parsing after the questions a TUI asks at startup", async () => {
    // What OpenCode 2 sends before drawing, then ordinary output after it.
    const startup = "\x1b[?1016$p\x1b[?2027$p\x1b[?2031$p\x1b[?1004$p\x1b[?2004$p\x1b[?2026$p";
    const term = new Terminal({ allowProposedApi: true, cols: 40, rows: 5 });
    try {
      await write(term, `${startup}still alive`);
      expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("still alive");
    } finally {
      term.dispose();
    }
  });
});
