#!/usr/bin/env node
/**
 * Why a WebDriver session refuses to start on a machine where the app is fine.
 *
 * The nightly E2E workflow has never been green: every spec dies identically in
 * `session not created: DevToolsActivePort file doesn't exist`, before a single
 * assertion runs. That message is about the **attach**, not the app — and on the
 * same runner, the resource benchmarks launch the same release binary and record
 * a full WebView2 process tree, so "the app cannot run there" is already ruled
 * out.
 *
 * What is *not* ruled out is everything between: whether WebView2 exposes a
 * remote-debugging endpoint at all under that session, and whether
 * `msedgedriver` looks for the port file where WebView2 actually writes it. This
 * script answers both, on whatever machine it runs on, without the suite in the
 * way:
 *
 *   **A. the app's own endpoint** — launch the release binary with the same
 *   automation environment `tauri-driver` gives it, then ask
 *   `http://127.0.0.1:<port>/json/version` who answers. If nothing answers, no
 *   driver could ever have attached and the problem is below WebDriver.
 *
 *   **B. a session, driven directly** — run `msedgedriver` ourselves (verbose,
 *   logging to `.artifacts/`) and POST the exact capabilities `tauri-driver`
 *   sends, then the same ones plus `webviewOptions.userDataFolder` pointing at
 *   the folder Tauri forces the webview to use. If the plain attempt fails and
 *   the second succeeds, the fix is a capability the suite can pass, and this
 *   run proved it rather than guessed it.
 *
 * It changes nothing and asserts nothing — it prints what happened and exits 0
 * whenever it managed to run the experiment. A verdict a human reads is the
 * whole product here, so a failed attach is a *result*, not an error.
 *
 *   npm run test:e2e:diagnose
 *
 * It refuses to run beside another uxnan, for the reason the whole harness does
 * (one WebView2 browser process per user-data folder: a second instance attaches
 * to the first one's), and it reaps only what it started.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DRIVER_PATH, driverStatus, installedWebViewVersion } from "./setup-driver.mjs";
import { findBinary, launchApp } from "../../scripts/resources/lib/app.mjs";
import { checkNoForeignInstance } from "../../scripts/resources/lib/preflight.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, "..", "..");
const ARTIFACTS = path.join(HERE, ".artifacts");

/** Tauri forces the webview's user-data folder to `LocalData/<identifier>`
 *  (`EBWebView` inside it) unless a window config names one, and none does. That
 *  is where WebView2 writes `DevToolsActivePort`, so it is also the folder
 *  `msedgedriver` has to be watching. */
function webviewUserDataFolder() {
  const identifier = JSON.parse(
    fs.readFileSync(path.join(DESKTOP_ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
  ).identifier;
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, identifier, "EBWebView");
}

/** A port nothing is listening on right now. Bound and released rather than
 *  guessed: a hard-coded 9222 is exactly the port another Chromium on the
 *  machine already took. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function httpJson(url, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text), text };
  } catch {
    return { status: res.status, json: null, text };
  }
}

/** Poll until `url` answers or the budget runs out; report how long it took. */
async function waitForEndpoint(url, { timeoutMs, pollMs = 250 }) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await httpJson(url, { timeoutMs: 2_000 });
      if (res.status === 200) return { ok: true, ms: Date.now() - started, body: res.json ?? res.text };
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, ms: Date.now() - started, error: lastError ? String(lastError) : "timed out" };
}

/**
 * A. Does the app expose a remote-debugging endpoint at all?
 *
 * The environment is the one `tauri-driver` arranges: `TAURI_WEBVIEW_AUTOMATION`
 * (wry enables automation on it) and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
 * (how a WebView2 host passes Chromium switches). Nothing here is special to the
 * test suite — it is what `msedgedriver` does, minus `msedgedriver`.
 */
async function probeAppEndpoint(binary, report) {
  const port = await freePort();
  const dataDir = path.join(HERE, ".profile", "diagnose");
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const app = launchApp(binary, {
    dataDir,
    env: {
      TAURI_AUTOMATION: "true",
      TAURI_WEBVIEW_AUTOMATION: "true",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });

  const endpoint = await waitForEndpoint(`http://127.0.0.1:${port}/json/version`, {
    timeoutMs: 90_000,
  });

  const portFile = path.join(webviewUserDataFolder(), "DevToolsActivePort");
  const portFileContents = fs.existsSync(portFile)
    ? fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/)
    : null;

  report.app = {
    requestedPort: port,
    exited: app.exited,
    exitCode: app.exitCode,
    endpointAnswered: endpoint.ok,
    endpointMs: endpoint.ms,
    endpointBody: endpoint.ok ? endpoint.body : null,
    endpointError: endpoint.ok ? null : endpoint.error,
    devToolsActivePort: { path: portFile, exists: portFileContents !== null, contents: portFileContents },
  };

  await app.quit({ graceMs: 8_000 });
  return report.app;
}

/**
 * B. Can `msedgedriver` start a session against that binary?
 *
 * Run verbatim what `tauri-driver` forwards (`browserName: "webview2"`, the app
 * as `binary`) so a failure here is the failure the nightly hits, and then the
 * same request carrying the webview's real user-data folder — the one variable
 * that plausibly differs between a developer's machine, where this suite is
 * green, and a runner that has never launched the app before.
 */
async function trySession(binary, variant, report) {
  const port = await freePort();
  const log = path.join(ARTIFACTS, `msedgedriver-${variant.name}.log`);
  const driver = spawn(DRIVER_PATH, [`--port=${port}`, "--verbose", `--log-path=${log}`], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    // The app is a grandchild of this process and inherits its environment.
    // `TAURI_WEBVIEW_AUTOMATION` is what makes wry turn automation on — without
    // it there is nothing for a session to attach to — and `UXNAN_DATA_DIR` is
    // the same isolation the suite learned to enforce here rather than through
    // `tauri:options.env`, which never reached the app: a diagnosis is not worth
    // running against someone's real profile.
    env: {
      ...process.env,
      TAURI_AUTOMATION: "true",
      TAURI_WEBVIEW_AUTOMATION: "true",
      UXNAN_DATA_DIR: path.join(HERE, ".profile", "diagnose"),
    },
  });

  const result = { variant: variant.name, capabilities: variant.webviewOptions ?? null };
  try {
    const up = await waitForEndpoint(`http://127.0.0.1:${port}/status`, { timeoutMs: 20_000 });
    if (!up.ok) {
      result.driverStarted = false;
      result.error = `msedgedriver never answered /status: ${up.error}`;
      return result;
    }
    result.driverStarted = true;

    const edgeOptions = { binary, args: [] };
    if (variant.webviewOptions) edgeOptions.webviewOptions = variant.webviewOptions;

    const started = Date.now();
    const res = await httpJson(`http://127.0.0.1:${port}/session`, {
      method: "POST",
      timeoutMs: 180_000,
      body: {
        capabilities: {
          alwaysMatch: {
            "ms:edgeChromium": true,
            browserName: "webview2",
            "ms:edgeOptions": edgeOptions,
          },
        },
      },
    });
    result.ms = Date.now() - started;

    const sessionId = res.json?.value?.sessionId ?? res.json?.sessionId ?? null;
    result.created = Boolean(sessionId);
    result.error = sessionId
      ? null
      : (res.json?.value?.message ?? res.text ?? "").split("\n")[0].slice(0, 400);

    if (sessionId) {
      // Close it the way a suite would, so the app gets its own shutdown path.
      try {
        await httpJson(`http://127.0.0.1:${port}/session/${sessionId}`, {
          method: "DELETE",
          timeoutMs: 30_000,
        });
      } catch {
        /* the reaper below is the backstop */
      }
    }
  } catch (error) {
    result.created = false;
    result.error = String(error);
  } finally {
    killTree(driver.pid);
    reapStrayApps();
    result.driverLog = fs.existsSync(log) ? path.relative(DESKTOP_ROOT, log) : null;
    // In `finally`, so the "the driver itself never came up" path is reported
    // too — that is a result, and the early return would have dropped it.
    report.sessions.push(result);
  }
  return result;
}

/** Kill a process and its children, by pid — never by name. */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/**
 * Latched by the foreign-instance guard, and the only thing that lets the
 * name-based reaper below run.
 *
 * Without it, any failure *before* the guard — no release binary, an unreadable
 * config — would land in the top-level error handler, call the reaper, and kill
 * whatever `uxnan-desktop.exe` the operator had open. Quite possibly the one
 * hosting the terminal this was started from.
 */
let mayReapByName = false;

/**
 * Reap an app instance `msedgedriver` left behind.
 *
 * By executable name, which is safe **only** once the guard above has confirmed
 * no other `uxnan-desktop.exe` was alive: whatever is running now is what this
 * run launched. The suite's teardown carries the same reasoning and the same
 * caveat — if that guard goes, this must go with it.
 */
function reapStrayApps() {
  if (!mayReapByName) return [];
  if (process.platform !== "win32") return [];
  const script =
    "Get-CimInstance Win32_Process -Property ProcessId,Name | " +
    "Where-Object { $_.Name -eq 'uxnan-desktop.exe' } | ForEach-Object { $_.ProcessId }";
  try {
    const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = (out.stdout ?? "").split(/\r?\n/).map((l) => Number(l.trim())).filter(Boolean);
    for (const pid of pids) killTree(pid);
    return pids;
  } catch {
    return [];
  }
}

function verdict(report) {
  const lines = [];
  const plain = report.sessions.find((s) => s.variant === "plain");
  const scoped = report.sessions.find((s) => s.variant === "userdatafolder");

  if (report.app && !report.app.endpointAnswered) {
    lines.push(
      "The app never exposed a remote-debugging endpoint, so no WebDriver could have attached.",
      "The problem is below WebDriver: WebView2 automation is not coming up in this environment.",
    );
  } else if (plain?.created) {
    lines.push(
      "A plain session — the exact capabilities tauri-driver sends — was created here.",
      "So this machine is not where the nightly fails; compare its report with the runner's.",
    );
  } else if (scoped?.created) {
    lines.push(
      "A plain session failed and one carrying webviewOptions.userDataFolder succeeded.",
      "The suite can pass that capability through tauri:options.webviewOptions — that is the fix.",
    );
  } else {
    lines.push(
      "The app answers on its debugging port but no session could be created either way.",
      `Read the verbose driver logs in ${path.relative(DESKTOP_ROOT, ARTIFACTS)} — they name the step that timed out.`,
    );
  }
  return lines;
}

async function main() {
  if (process.platform !== "win32") {
    process.stderr.write("This diagnosis is Windows-only, like the suite it explains.\n");
    return 1;
  }

  const problem = driverStatus();
  if (problem) {
    process.stderr.write(`${problem}\nRun: node tests/e2e/setup-driver.mjs\n`);
    return 1;
  }

  const binary = findBinary({ root: DESKTOP_ROOT });
  const foreign = checkNoForeignInstance(binary);
  if (foreign) {
    process.stderr.write(
      `${foreign}\n\nThe diagnosis cannot run alongside another instance: a second app shares the\n` +
        "first one's WebView2 browser process, and every reading below would be about that one.\n",
    );
    return 1;
  }
  // Only now: nothing named `uxnan-desktop.exe` is alive that this run did not
  // start, so teardown may match on the name (see `reapStrayApps`).
  mayReapByName = true;

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const report = {
    binary,
    webview2: installedWebViewVersion(),
    msedgedriver: spawnSync(DRIVER_PATH, ["--version"], { encoding: "utf8", windowsHide: true })
      .stdout?.trim(),
    userDataFolder: webviewUserDataFolder(),
    userDataFolderExisted: fs.existsSync(webviewUserDataFolder()),
    sessions: [],
  };

  process.stderr.write("A. asking the app for a remote-debugging endpoint…\n");
  const app = await probeAppEndpoint(binary, report);
  process.stderr.write(
    app.endpointAnswered
      ? `   answered in ${app.endpointMs} ms\n`
      : `   no answer after ${app.endpointMs} ms (${app.endpointError})\n`,
  );

  for (const variant of [
    { name: "plain" },
    { name: "userdatafolder", webviewOptions: { userDataFolder: report.userDataFolder } },
  ]) {
    process.stderr.write(`B. creating a session — ${variant.name}…\n`);
    const result = await trySession(binary, variant, report);
    process.stderr.write(
      result.created
        ? `   created in ${result.ms} ms\n`
        : `   refused: ${result.error}\n`,
    );
  }

  const out = path.join(ARTIFACTS, "diagnose-session.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");

  process.stderr.write(`\n${verdict(report).join("\n")}\n\nfull report: ${path.relative(DESKTOP_ROOT, out)}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    reapStrayApps();
    process.exit(1);
  },
);
