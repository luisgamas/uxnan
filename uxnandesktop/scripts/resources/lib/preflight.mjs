/**
 * The checks that decide whether a measurement is worth believing.
 *
 * Two of these come from a real failure found while building the harness, and
 * both would otherwise produce a *plausible but wrong* number rather than an
 * error — the worst possible outcome for a benchmark:
 *
 * **1. A shared WebView2 browser process.** On Windows, WebView2 keeps one
 * browser process per user-data folder and every client using that folder
 * attaches to it. uxnan's folder is `%LOCALAPPDATA%\<identifier>\EBWebView`, so
 * when a second uxnan starts, its renderers are spawned by the *first*
 * instance's browser process — outside the tree we are sampling. The run then
 * reports the Rust process alone (~27 MB) and silently omits ~90 MB of webview.
 * A launch that never grows a runtime helper inside its own tree is therefore
 * treated as an invalid run, not as a very good result.
 *
 * **2. A browser process outliving the client.** The same sharing means a
 * lingering browser process from repetition *n* can be adopted by repetition
 * *n+1*. So each repetition waits for its own tree to actually be gone before
 * the next one starts — which doubles as the honest way to count orphans:
 * a process still alive after a bounded wait really is orphaned, whereas one
 * sampled a moment after teardown is just being reaped.
 *
 * **3. A binary with no frontend in it.** `cargo build --release` on its own does
 * not enable Tauri's `custom-protocol` feature, so the build stays in *dev* mode:
 * the window opens, the Rust backend runs, the hook server answers — and the
 * webview navigates to `http://localhost:1420`, which nothing is serving. The app
 * shows a browser error page, no terminal is ever restored, and the run reports
 * the cost of an app that did nothing. Every observable the harness would
 * normally trust (a window, a backend, webview processes) is present, so the only
 * honest defence is to check the binary itself for embedded frontend assets.
 *
 * Name matching appears here and **only** here. It answers "is another instance
 * running?", never "is this process ours" — attribution stays structural
 * (`tree.mjs`).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { collectorCommand } from "./platform.mjs";
import { sleep, snapshotPids } from "./sampler.mjs";

/** Every process on the machine with this executable name. */
export function processesNamed(name) {
  const { command, baseArgs, style } = collectorCommand();
  const args =
    style === "powershell" ? ["-Name", name, "-Once"] : ["--name", name, "--once"];
  try {
    const raw = execFileSync(command, [...baseArgs, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    const line = raw.trim().split(/\r?\n/).pop() ?? "{}";
    return JSON.parse(line).rows ?? [];
  } catch {
    return [];
  }
}

/**
 * Refuse to start while another copy of the app under test is running.
 *
 * Returns `null` when the field is clear, or an actionable message. The caller
 * decides whether that is fatal; `run.mjs` treats it as fatal, because every
 * number produced alongside a second instance would be wrong in a way no
 * reader could detect afterwards.
 */
export function checkNoForeignInstance(binary) {
  const name = path.basename(binary);
  const running = processesNamed(name);
  if (running.length === 0) return null;
  return (
    `${running.length} other ${name} process(es) are already running (pid ${running.map((r) => r.pid).join(", ")}).\n` +
    `Close every uxnan window — including a dev build — before measuring: a second instance shares ` +
    `the WebView2 browser process, so this run's webview would be spawned outside the tree being ` +
    `sampled and the result would under-report memory by roughly the whole webview.\n` +
    `If you did not open one, it is probably a benchmark run of your own that was interrupted ` +
    `before it could close its app; that window is safe to close.`
  );
}

/**
 * SvelteKit writes every built asset under this directory, and Tauri embeds the
 * asset *keys* as plain strings even though the payloads are compressed — so
 * their presence in the executable is a reliable "the frontend is in here".
 */
const EMBEDDED_ASSET_MARKER = "_app/immutable";

/**
 * Refuse a binary that was built without its frontend.
 *
 * Returns `null` when the assets are there, or an actionable message naming the
 * build command that produces a measurable binary. Scans in chunks with an
 * overlap, so a marker straddling a boundary is still found and a 30 MB
 * executable never lands in memory whole.
 */
export function checkBinaryEmbedsFrontend(binary) {
  const marker = Buffer.from(EMBEDDED_ASSET_MARKER, "utf8");
  const chunkSize = 1 << 20;
  const overlap = marker.length - 1;
  const buf = Buffer.alloc(chunkSize + overlap);
  let fd;
  try {
    fd = fs.openSync(binary, "r");
  } catch {
    return `cannot read ${binary}`;
  }
  try {
    let carried = 0;
    for (;;) {
      const read = fs.readSync(fd, buf, carried, chunkSize, null);
      if (read <= 0) break;
      if (buf.subarray(0, carried + read).includes(marker)) return null;
      buf.copy(buf, 0, carried + read - overlap, carried + read);
      carried = overlap;
    }
  } finally {
    fs.closeSync(fd);
  }
  return (
    `${path.basename(binary)} contains no embedded frontend, so it would launch in Tauri's dev ` +
    `mode and try to load http://localhost:1420 — the window opens, the backend runs, and the UI ` +
    `is a connection-refused page, which is exactly the kind of run that produces a small, ` +
    `meaningless number. Build it with:\n` +
    `  cd uxnandesktop && npm run bench:build\n` +
    `(equivalently: npm run build && cargo build --release --features tauri/custom-protocol)`
  );
}

/**
 * Wait for a set of PIDs to disappear. Returns the ones still alive at the
 * deadline — the genuine orphans.
 */
export async function waitForExit(pids, { timeoutMs = 15_000, pollMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let alive = pids;
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(pollMs);
    alive = snapshotPids(alive).map((r) => r.pid);
  }
  return alive;
}

/**
 * Did the app's own webview actually land inside the measured tree?
 *
 * `samples` are the folded samples; a healthy Windows/Linux run grows past one
 * `own` process within seconds of the window appearing. Returns `null` when the
 * run looks sound, or the reason it does not.
 */
export function checkWebviewInTree(samples, { os = process.platform } = {}) {
  if (samples.length === 0) return "no samples were collected at all";
  const maxOwnProcs = Math.max(...samples.map((s) => s.own?.procs ?? 0));
  if (maxOwnProcs > 1) return null;
  // macOS runs the WebKit content process outside the app's process tree by
  // design (it is spawned by the system), so one `own` process is expected
  // there and this check cannot say anything.
  if (os === "darwin") return null;
  return (
    "the webview never appeared inside the measured process tree: the run recorded only the " +
    "main process. On Windows this means another WebView2 client is sharing uxnan's browser " +
    "process — close every other uxnan instance and re-run."
  );
}

/**
 * Did the shells the scenario seeded actually come back?
 *
 * A scenario that seeds four terminals and measures three is not measuring that
 * scenario. This also catches the whole class of "the UI never booted" failures
 * from the outside — a dev-mode binary, a frontend that threw during restore, a
 * broken restore path — none of which announce themselves in a memory figure.
 *
 * `null` when the count was met (or none was expected), else the reason.
 */
export function checkExpectedShells(samples, expected) {
  if (!expected) return null;
  const seen = Math.max(
    0,
    ...samples.map((s) => (s.managed?.procs ?? 0) - (s.own?.procs ?? 0)),
  );
  if (seen >= expected) return null;
  return (
    `the scenario seeded ${expected} live terminal(s) but at most ${seen} managed process(es) ` +
    `ever appeared beside the app. Either the session did not restore, or the frontend never ` +
    `ran — check that the binary embeds its frontend and that the profile seeds a valid layout.`
  );
}
