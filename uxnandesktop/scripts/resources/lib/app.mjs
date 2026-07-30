/**
 * Launching, observing and tearing down the app under measurement.
 *
 * Three readiness signals, because "ready" means different things and only one
 * of them exists everywhere:
 *
 * - **backendReady** — the hook server's endpoint file appears inside the
 *   scenario's own profile directory. Cross-platform, and observed by watching a
 *   file the app already writes: nothing is added to the app to report it.
 * - **windowReady** — the process owns a main window (Windows only, via the
 *   collector's `-WindowWatch`). This is the number a user would call "startup
 *   time"; on other platforms it is recorded as `null`, not approximated.
 * - **shellReady** — the first managed shell shows up in the process tree, i.e.
 *   the restored terminal is live. Only meaningful for scenarios that seed one.
 *
 * Teardown asks the window to close and only escalates if it doesn't. That
 * ordering matters: a killed app never runs its flush-on-close path, so the
 * "closing uxnan leaves zero managed processes" check would be measuring the
 * wrong thing.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

import { collectorCommand } from "./platform.mjs";
import { sleep } from "./sampler.mjs";

/**
 * Locate the release binary. Release only, and by default: a debug build's
 * numbers are not comparable with anything, and quietly falling back to one
 * would silently invalidate a whole run.
 */
export function findBinary({ root, profile = "release", explicit = null } = {}) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`binary not found: ${explicit}`);
    return explicit;
  }
  const exe = process.platform === "win32" ? "uxnan-desktop.exe" : "uxnan-desktop";
  const candidates = [
    path.join(root, "src-tauri", "target", profile, exe),
    // A shared CARGO_TARGET_DIR is common on machines that keep several
    // worktrees of this repo.
    process.env.CARGO_TARGET_DIR ? path.join(process.env.CARGO_TARGET_DIR, profile, exe) : null,
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(
    `no ${profile} binary found. Build it first:\n` +
      `  cd uxnandesktop && npm run bench:build\n` +
      `(a bare \`cargo build --release\` leaves Tauri in dev mode and produces a binary that\n` +
      ` loads http://localhost:1420 instead of the app — see docs/resource-benchmarks.md)\n` +
      `looked in:\n  ${candidates.join("\n  ")}`,
  );
}

/** A launched app instance. */
export class AppRun {
  constructor(child, { dataDir }) {
    this.child = child;
    this.pid = child.pid;
    this.dataDir = dataDir;
    this.exited = false;
    this.exitCode = null;
    child.on("exit", (code) => {
      this.exited = true;
      this.exitCode = code;
    });
  }

  /** Resolve once the hook server has written its endpoint file, or `null` on
   *  timeout (recorded as such — a slow boot is a result, not a crash). */
  async waitForBackend(timeoutMs = 120_000) {
    const dir = path.join(this.dataDir, "hooks");
    const names = ["endpoint.cmd", "endpoint.env"];
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.exited) return null;
      for (const n of names) {
        if (fs.existsSync(path.join(dir, n))) return Date.now() - started;
      }
      await sleep(50);
    }
    return null;
  }

  /** Resolve with the ms to a visible main window, or `null` where the platform
   *  can't answer (everything but Windows today). */
  async waitForWindow(timeoutMs = 120_000) {
    if (process.platform !== "win32") return null;
    const { command, baseArgs } = collectorCommand("windows");
    const started = Date.now();
    return await new Promise((resolve) => {
      const child = spawn(
        command,
        [...baseArgs, "-WindowWatch", String(this.pid), "-TimeoutMs", String(timeoutMs)],
        { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );
      let buf = "";
      child.stdout.on("data", (d) => {
        buf += String(d);
      });
      child.on("exit", () => {
        const line = buf.trim().split(/\r?\n/).pop() ?? "";
        try {
          const parsed = JSON.parse(line);
          resolve(parsed.event === "window" ? (parsed.elapsedMs ?? Date.now() - started) : null);
        } catch {
          resolve(null);
        }
      });
      child.on("error", () => resolve(null));
    });
  }

  /**
   * Ask the app to close, then make sure it did.
   *
   * A graceful close first (WM_CLOSE on Windows, SIGTERM elsewhere) so the app
   * runs its own shutdown — flushing scrollback, stopping watchers, reaping
   * PTYs. Only a process still alive after `graceMs` is killed, and the run
   * records that it had to be, because an app that needs killing is itself a
   * finding.
   */
  async quit({ graceMs = 15_000 } = {}) {
    if (this.exited) return { forced: false, exitCode: this.exitCode };
    const started = Date.now();
    let forced = false;

    if (process.platform === "win32") {
      // `taskkill` without /F posts WM_CLOSE to the window — the same thing
      // clicking the X does.
      try {
        execFileSync("taskkill.exe", ["/PID", String(this.pid)], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        /* the window may already be gone */
      }
    } else {
      try {
        process.kill(this.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }

    while (!this.exited && Date.now() - started < graceMs) await sleep(100);

    if (!this.exited) {
      forced = true;
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill.exe", ["/PID", String(this.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          process.kill(this.pid, "SIGKILL");
        }
      } catch {
        /* nothing left to kill */
      }
      while (!this.exited && Date.now() - started < graceMs + 10_000) await sleep(100);
    }

    return { forced, exitCode: this.exitCode, closeMs: Date.now() - started };
  }
}

/**
 * Start the app against a disposable profile.
 *
 * The environment is trimmed to what a launch needs plus the overrides: the goal
 * is that two runs on the same machine differ only by the scenario. `UXNAN_*`
 * hook variables from the operator's own shell are dropped, so a benchmark run
 * can never report into the operator's live uxnan.
 */
export function launchApp(binary, { dataDir, env = {}, cwd = undefined } = {}) {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("UXNAN_")) delete clean[key];
  }
  const child = spawn(binary, [], {
    cwd,
    env: { ...clean, UXNAN_DATA_DIR: dataDir, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
    detached: false,
  });
  // Drain the pipes; a full stdio buffer would block the app being measured.
  child.stdout?.resume();
  child.stderr?.resume();
  return new AppRun(child, { dataDir });
}
