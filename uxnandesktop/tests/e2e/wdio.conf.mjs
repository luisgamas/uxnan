/**
 * WebdriverIO against the real desktop app.
 *
 * This is the only layer that exercises the whole thing at once: a release
 * binary, its Rust backend, a real WebView2, real IPC and real processes. It is
 * also the slowest and the most fragile layer, so it holds a handful of
 * high-value journeys rather than a broad suite — everything that can be proven
 * in jsdom or against a temp directory belongs in the layers below.
 *
 * ## Why this driver
 *
 * `tauri-driver` is the only thing that can drive a Tauri 2 window: it speaks
 * WebDriver and delegates to Microsoft's `msedgedriver`, so the automation
 * reaches the app's own webview *and* the native window around it. Playwright
 * was the alternative and cannot do this job — it drives browsers, and a Tauri
 * app is not one. Playwright could serve the frontend on its own, but a test
 * that never crosses IPC is a component test with a browser attached, and
 * calling it E2E would be the exact self-deception this harness is meant to
 * prevent. The reasoning is recorded in `docs/testing.md`.
 *
 * ## Isolation
 *
 * Every run gets a throwaway `UXNAN_DATA_DIR` (see `src-tauri/src/datadir.rs`),
 * so a journey starts from a known profile and can never touch the developer's
 * real one. Processes are reaped in `after`/`onComplete` even when a test fails,
 * because a leaked app instance breaks the *next* run — and, on Windows, would
 * make the resource benchmarks refuse to start.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DRIVER_PATH, driverStatus } from "./setup-driver.mjs";
import { checkNoForeignInstance, waitForExit } from "../../scripts/resources/lib/preflight.mjs";
import { FAKE_GH_RESPONSES, factsFor, seedFor } from "./journeys.mjs";
import { ghShimDir } from "../fixtures/path-shim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..", "..");
const ARTIFACTS = path.join(HERE, ".artifacts");

/** Where a release build serves the app from: Tauri 2's custom protocol on
 *  Windows. (`tauri://localhost/` redirects here.) */
const APP_ORIGIN = "http://tauri.localhost/";

/** The release binary under test. Release only: a dev-mode build has no
 *  frontend in it and would present a connection-refused page (the same trap
 *  documented for the resource benchmarks). */
function appBinary() {
  const exe = process.platform === "win32" ? "uxnan-desktop.exe" : "uxnan-desktop";
  const candidates = [
    process.env.UXNAN_E2E_BINARY,
    path.join(DESKTOP_ROOT, "src-tauri", "target", "release", exe),
    process.env.CARGO_TARGET_DIR ? path.join(process.env.CARGO_TARGET_DIR, "release", exe) : null,
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(
    `no release binary to test. Build one with:\n  npm run bench:build\nlooked in:\n  ${candidates.join("\n  ")}`,
  );
}

/**
 * The disposable profile for this run.
 *
 * A **fixed** path, not `mkdtemp`, and that matters: WebdriverIO evaluates this
 * config file twice — once in the launcher, once in each worker — so a random
 * directory produces two different profiles. The driver (started by the
 * launcher) then points at one while `beforeSession` (running in the worker)
 * seeds the other, and the app comes up empty no matter what a journey asked
 * for. A deterministic path is the same in both processes.
 *
 * It lives beside the suite rather than in the temp dir so a failed run can be
 * inspected; `.profile` is git-ignored.
 */
function makeProfile() {
  const dir = path.join(HERE, ".profile");
  const data = path.join(dir, "data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(
    path.join(data, "state.json"),
    JSON.stringify(
      {
        version: 1,
        repos: [],
        settings: {
          theme: "system",
          leftSidebarWidth: 280,
          rightSidebarWidth: 350,
          leftSidebarOpen: true,
          rightSidebarOpen: true,
          // Nothing that reaches the network or writes outside this directory.
          updater: { autoCheck: false, channel: "stable", autoDownload: false, installPolicy: "ask" },
          usageProviders: [],
          autoInstallHooks: false,
          pets: { enabled: false },
        },
        agentCache: [],
        terminalLayout: null,
        quickCommands: [],
        orchestrationRuns: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { root: dir, data };
}

/**
 * Where `tauri-driver` lives, as an absolute path.
 *
 * Resolved rather than launched through a shell, and that is not a style
 * preference: spawning it with `shell: true` makes `child.pid` the *shell's*
 * pid, so killing it on teardown orphans `tauri-driver`, `msedgedriver` and the
 * app itself. That leak is what this whole teardown exists to prevent.
 */
function tauriDriverPath() {
  const exe = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  const candidates = [
    process.env.TAURI_DRIVER_PATH,
    path.join(os.homedir(), ".cargo", "bin", exe),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const found = execFileSync(cmd, ["tauri-driver"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/)
      .find(Boolean);
    if (found) return found;
  } catch {
    /* fall through to the error below */
  }
  throw new Error(
    "tauri-driver not found. Install it with:\n  cargo install tauri-driver --locked\n" +
      `looked in:\n  ${candidates.join("\n  ")}`,
  );
}

/**
 * Kill a process **and its children**, by pid.
 *
 * Never by name. This harness runs on developer machines where a real
 * `uxnan-desktop.exe` is very likely open — quite possibly the one hosting the
 * terminal these tests were started from — and a name-based sweep would take it
 * down along with whatever the user had running in it.
 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Reap an app instance that outlived its session. How it is identified, and
 *  why that is safe, is explained inside. */
function killStrayApps() {
  if (process.platform !== "win32") return [];
  // Matched by executable name, which is safe **only** because `preflight`
  // refuses to start while any other `uxnan-desktop.exe` is alive: whatever is
  // running now is what this suite launched. If that guard is ever removed, this
  // must change with it.
  //
  // Matching the profile directory instead — the obvious, apparently safer
  // choice — does not work at all: `UXNAN_DATA_DIR` is an environment variable
  // and never appears in a command line. It silently matched the PowerShell
  // process running the query, whose own command line contains the path, so the
  // reaper spent several runs killing its own query and reporting success.
  const script = `Get-CimInstance Win32_Process -Property ProcessId,Name | Where-Object { $_.Name -eq 'uxnan-desktop.exe' } | ForEach-Object { $_.ProcessId }`;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = out.split(/\r?\n/).map((l) => Number(l.trim())).filter(Boolean);
    for (const pid of pids) killTree(pid);
    return pids;
  } catch {
    return [];
  }
}

/**
 * Everything that makes a run impossible, checked while the config is still
 * loading.
 *
 * Deliberately not in `onPrepare`: a hook that throws still lets WebdriverIO
 * start its workers, which then fail against a driver that was never launched
 * and bury the real reason under a wall of `ECONNREFUSED`. Failing at import
 * time stops the process with the one message that matters.
 */
function preflight() {
  const driverProblem = driverStatus();
  if (driverProblem) {
    throw new Error(`${driverProblem}\nRun: node tests/e2e/setup-driver.mjs`);
  }

  // The same WebView2 constraint the resource benchmarks hit, and it bites
  // harder here. Windows keeps one browser process per user-data folder, so a
  // second uxnan attaches to the first one's — and the automation session then
  // drives a webview that is not this app's. The symptom is not an error: the
  // window opens, the driver connects, and every query returns an empty
  // document (`<html><head></head><body></body></html>`), which reads as "the
  // app renders nothing" rather than "you have another copy open".
  //
  // The check is shared with the benchmarks rather than reimplemented, so both
  // stay honest about the same fact.
  const foreign = checkNoForeignInstance(appBinary());
  if (foreign) throw new Error(`${foreign}\n\nE2E cannot run alongside another instance.`);
}

preflight();

const profile = makeProfile();
/**
 * OPT-IN: route the app's `gh` to the fixture for the GitHub journey.
 *
 * Only when the operator sets `UXNAN_E2E_FAKE_GH=1` (the github-fake spec
 * self-skips without it): a directory holding *only* the fake `gh` shim is
 * prepended to the driver's PATH — the app inherits it, so `gh` resolves to
 * the fixture while every other CLI (shell, git, agents) stays real. The
 * latch (`UXNAN_FIXTURE_GH=1`) arms the fake, and the canned answers are the
 * file the journey writes (captured real payloads from tests/fixtures/github).
 */
function fakeGhEnv() {
  if (process.env.UXNAN_E2E_FAKE_GH !== "1") return {};
  const dir = ghShimDir(path.join(HERE, ".profile", "gh-shim"));
  const PATH = `${dir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
  return {
    PATH,
    Path: PATH, // Windows spells it either way; spawn matching is case-sensitive
    UXNAN_FIXTURE_GH: "1",
    UXNAN_FIXTURE_GH_RESPONSES: FAKE_GH_RESPONSES,
  };
}

let driver = null;

export const config = {
  runner: "local",
  specs: [path.join(HERE, "specs", "**", "*.e2e.mjs")],
  maxInstances: 1, // one app at a time: two would share the WebView2 browser process
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  // A journey that has to launch a release binary is not a unit test; give it
  // room, but not so much that a hang costs ten minutes to notice.
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  waitforTimeout: 20_000,

  capabilities: [
    {
      browserName: "wry",
      "tauri:options": {
        application: appBinary(),
        // The app reads this and keeps every file it writes inside it.
        env: { UXNAN_DATA_DIR: profile.data },
      },
    },
  ],

  hostname: "127.0.0.1",
  port: 4444,

  /**
   * Seed the profile this spec needs, before its app starts.
   *
   * Each spec file is one journey and gets its own session, so this is the last
   * moment the profile can be written — `before` runs after the app has already
   * read it. Setting up a journey by clicking through the UI would be slower and
   * far more brittle; the assertions still go through the real UI and real IPC.
   */
  beforeSession(_config, _capabilities, specs) {
    const { name } = seedFor(specs?.[0], profile.data);
    const written = JSON.parse(fs.readFileSync(path.join(profile.data, "state.json"), "utf8"));
    process.stderr.write(
      `e2e: seeded "${name}" → ${written.repos?.length ?? 0} repo(s), layout=${written.terminalLayout ? "yes" : "no"} at ${profile.data}
`,
    );
  },

  onPrepare() {
    // Preconditions are checked at import time (see `preflight`), so the only
    // job left here is starting the driver — and clearing last run's profile,
    // which only the launcher may do (a worker would wipe its own seed).
    fs.rmSync(profile.root, { recursive: true, force: true });
    fs.mkdirSync(profile.data, { recursive: true });
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    // No shell: see `tauriDriverPath` — the pid has to be the driver's own, or
    // teardown reaps a shell and leaves the real processes running.
    driver = spawn(tauriDriverPath(), ["--native-driver", DRIVER_PATH], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32", // own process group, so we can kill it
      // The app is a grandchild of this process, and it inherits from here.
      //
      // `tauri:options.env` is the documented way to set the app's environment
      // and it did **not** take effect: the app came up reading the developer's
      // real profile — a diagnostic run rendered their actual projects and name.
      // That is an isolation failure, not a cosmetic one; a journey that clicks
      // "delete worktree" would have deleted a real one. Setting it on the
      // driver instead does reach the app, and the suite asserts the profile is
      // the disposable one so this can never regress silently.
      env: { ...process.env, UXNAN_DATA_DIR: profile.data, ...fakeGhEnv() },
    });
    const log = fs.createWriteStream(path.join(ARTIFACTS, "tauri-driver.log"));
    driver.stdout?.pipe(log);
    driver.stderr?.pipe(log);
  },

  /**
   * Point the session at the app before any test runs.
   *
   * `tauri-driver` hands WebdriverIO a webview that sits at **`about:blank`** —
   * it does not attach to the window the app already navigated. Every query
   * then succeeds and returns nothing, so `getPageSource()` is
   * `<html><head></head><body></body></html>` and it reads as "the app rendered
   * nothing" while the app is running perfectly. That cost a long debugging
   * session, so it is written down here: the session had exactly **one** handle,
   * its url was `about:blank`, and `document.readyState` was already
   * `complete`.
   *
   * Navigating that webview to the app's own origin loads the real thing, and
   * — the part that matters — the IPC bridge is live in it: `__TAURI_INTERNALS__`
   * is present and `invoke("ping")` answers `"pong"` from the Rust backend. So
   * these are genuine end-to-end tests, not a frontend rendering against
   * nothing.
   */
  async before() {
    await browser.url(APP_ORIGIN);

    await browser.waitUntil(
      async () => {
        const ready = await browser.execute(() => ({
          hydrated: document.querySelectorAll("[data-tauri-drag-region]").length > 0,
          ipc: typeof window.__TAURI_INTERNALS__?.invoke === "function",
        }));
        return ready.hydrated && ready.ipc;
      },
      {
        timeout: 45_000,
        interval: 250,
        timeoutMsg:
          `the app never hydrated at ${APP_ORIGIN}. Either the binary was built without its ` +
          "frontend (`npm run bench:build`), or another uxnan instance is sharing the WebView2 " +
          "browser process.",
      },
    );

    // Isolation is a precondition, so it is checked rather than assumed — this
    // caught the app reading the developer's real profile once already.
    //
    // Asked over IPC rather than read off the screen: the UI is localised (it
    // renders in Spanish on this machine), so a DOM check would be asserting a
    // translation, and would silently answer "-1 projects" under any locale it
    // did not anticipate.
    const facts = factsFor(profile.data);
    const state = await browser.executeAsync((done) => {
      window.__TAURI_INTERNALS__.invoke("get_app_state", {})
        .then((s) => done({ ok: true, repos: (s.repos || []).map((r) => r.name) }))
        .catch((e) => done({ ok: false, error: String(e) }));
    });
    if (!state.ok) {
      throw new Error(`could not read the app's state over IPC: ${state.error}`);
    }
    const expected = facts.projectName ? [facts.projectName] : [];
    const got = state.repos;
    if (got.length !== expected.length || expected.some((n) => !got.includes(n))) {
      throw new Error(
        `the app has projects [${got.join(", ")}] but this journey seeded [${expected.join(", ")}]. ` +
          `It is not reading the disposable profile at ${profile.data}. Refusing to run — a journey ` +
          "that removes a worktree would remove a real one.",
      );
    }
  },

  /**
   * Close the app through its own window before the session ends.
   *
   * Ending a WebDriver session does not stop a Tauri app — `tauri-driver`
   * leaves it running — so without this every run leaks an instance, and on
   * Windows a leftover instance is exactly what stops the *next* run (and the
   * resource benchmarks) from working. Asking the window to close also
   * exercises the app's real shutdown path, which is worth testing on its own.
   *
   * Best effort: `onComplete` still reaps by pid, because a crashed app cannot
   * close itself politely.
   */
  async after() {
    try {
      await browser.closeWindow();
    } catch {
      // Already gone — a journey may have closed the app itself (the agent one
      // does, to prove nothing outlives it). The reaper below is the backstop
      // either way, so this is not worth reporting.
    }
  },

  /** A failing journey leaves evidence: what was on screen, and the page's DOM. */
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const slug = test.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60);
    try {
      await browser.saveScreenshot(path.join(ARTIFACTS, `${slug}.png`));
    } catch {
      // A crashed app has no screen to capture; the log still tells the story.
    }
    try {
      const html = await browser.getPageSource();
      fs.writeFileSync(path.join(ARTIFACTS, `${slug}.html`), html, "utf8");
    } catch {
      /* same */
    }
  },

  async onComplete() {
    // Reap unconditionally, and by pid. A leaked app instance breaks the next
    // run, and on Windows it also makes the resource benchmarks refuse to start
    // — but a name-based sweep would kill the developer's own uxnan, so the
    // driver goes by its recorded pid and any surviving app is matched on *our*
    // profile directory.
    killTree(driver?.pid);
    driver = null;

    // Ending a WebDriver session does not stop a Tauri app, and neither does
    // `closeWindow()` — `tauri-driver` leaves it running. That is its
    // behaviour, not a bug in the suite, but the instance still has to go: on
    // Windows a leftover one is precisely what stops the next run, and the
    // resource benchmarks, from working. So it is reaped here by pid, matched on
    // this run's own profile directory.
    const reaped = killStrayApps();
    if (reaped.length > 0) {
      // Windows does not retire a pid the instant it is killed, so re-counting
      // immediately reports every process as a survivor. Wait for them to
      // actually go, and only then complain about what is left.
      const survivors = await waitForExit(reaped, { timeoutMs: 10_000 });
      if (survivors.length > 0) {
        process.stderr.write(
          `e2e: ${survivors.length} app process(es) survived teardown (${survivors.join(", ")}).\n` +
            "Close them by hand — the next run and the resource benchmarks will refuse to start.\n",
        );
      }
    }

    // The profile is deliberately left behind: it is the evidence for a failed
    // run, and `onPrepare` clears it at the start of the next one.
  },
};
