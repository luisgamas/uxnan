import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared helpers for the journeys.
 *
 * Two rules the assertions follow, both learned from getting them wrong:
 *
 * **Ask the backend, not the screen, for facts.** The UI is localised — it
 * renders in Spanish on the machine this was written on — so an assertion on
 * visible text is an assertion on a translation. Anything the backend knows
 * (projects, worktrees, git status, agent state) is read over IPC, which is also
 * what makes these end-to-end rather than DOM tests: the answer travelled
 * through the real command layer.
 *
 * **Use the DOM only for what is genuinely visual**, and prefer structure over
 * words: how many terminals are mounted, whether a tab the journey itself named
 * is present.
 */

/** Call a Tauri command from inside the app, exactly as the app would. */
export async function invoke(command, args = {}) {
  const result = await browser.executeAsync(
    (cmd, a, done) => {
      window.__TAURI_INTERNALS__.invoke(cmd, a)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args,
  );
  if (!result.ok) throw new Error(`invoke("${command}") failed: ${result.error}`);
  return result.value;
}

/** The app's persisted state, straight from the backend. */
export function appState() {
  return invoke("get_app_state");
}

/** How many terminals are mounted right now. */
export function terminalCount() {
  return browser.execute(() => document.querySelectorAll(".xterm").length);
}

/** Wait for `n` terminals to be mounted (they appear a beat after hydration,
 *  because the workspace binds to its worktree asynchronously). */
export async function waitForTerminals(n, { timeout = 45_000 } = {}) {
  await browser.waitUntil(async () => (await terminalCount()) >= n, {
    timeout,
    interval: 500,
    timeoutMsg: `expected ${n} terminal(s) to mount; saw ${await terminalCount()}`,
  });
}

/**
 * Processes running underneath the app, by executable name.
 *
 * Reading a terminal's *contents* is not available here: xterm paints through
 * WebGL, so `.xterm-rows` is empty in the DOM and any assertion on its text
 * would pass or fail for reasons unrelated to whether a shell is alive. The
 * observable that actually answers "is there a process behind this pane" is the
 * process tree, so that is what the journeys assert on.
 *
 * How the app is located is explained at the top of the function; it is not the
 * obvious way, and the obvious way is wrong.
 */
export function appDescendants() {
  // The app cannot be found by its command line: `UXNAN_DATA_DIR` is an
  // *environment* variable and never appears there. (Matching on it looked like
  // it worked, but what it matched was the PowerShell process running the query
  // — whose own command line contains the path.)
  //
  // So the app is identified by name, which is safe **only** because of the
  // pre-flight in `wdio.conf.mjs`: it refuses to start while any other
  // `uxnan-desktop.exe` is alive, so the one running now is necessarily the one
  // this suite launched. If that guard is ever removed, this must change too.
  const script = `
$app = Get-CimInstance Win32_Process -Property ProcessId,Name |
  Where-Object { $_.Name -eq 'uxnan-desktop.exe' } | Select-Object -First 1
if (-not $app) { ''; exit }
$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name
$ids = New-Object System.Collections.ArrayList
$q = New-Object System.Collections.Queue; [void]$q.Enqueue([int]$app.ProcessId)
while ($q.Count -gt 0) {
  $id = $q.Dequeue(); [void]$ids.Add($id)
  foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $id })) { [void]$q.Enqueue([int]$c.ProcessId) }
}
($all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { $_.Name }) -join ','`;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    return out.trim().split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Wait until `predicate` holds over the app's process tree.
 *
 * Polled here rather than through `browser.waitUntil` so the failure can name
 * what it actually saw. A timeout that says only "condition timed out" sends the
 * next person back to reproduce it by hand, which is most of the cost of a
 * failing test.
 */
export async function waitForProcesses(predicate, { timeout = 60_000, label } = {}) {
  const deadline = Date.now() + timeout;
  let seen = [];
  for (;;) {
    seen = appDescendants();
    if (predicate(seen)) return seen;
    if (Date.now() > deadline) {
      throw new Error(
        `never saw ${label ?? "the expected processes"} within ${timeout}ms.\n` +
          `The app's process tree held: ${seen.join(", ") || "nothing (the app was not found)"}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Ask the app to close the way clicking the X does, and wait for its whole tree
 * to go.
 *
 * `taskkill` without `/F` posts WM_CLOSE, so the app runs its own shutdown —
 * flushing, stopping watchers, reaping PTYs. That last part is the point: a
 * child process the app forgets outlives it forever.
 */
export async function closeAppAndWait({ timeout = 30_000 } = {}) {
  const pid = appPid();
  if (!pid) return true;
  spawnSync("taskkill.exe", ["/PID", String(pid)], { stdio: "ignore", windowsHide: true });

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (appDescendants().length === 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** The app's pid, or `null`. Same identification rule as `appDescendants`. */
export function appPid() {
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_Process -Property ProcessId,Name | Where-Object { $_.Name -eq 'uxnan-desktop.exe' } | Select-Object -First 1).ProcessId",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    const pid = Number(out.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** How many of `names` appear in a process list. */
export function countOf(names, list) {
  const wanted = names.map((n) => n.toLowerCase());
  return list.filter((n) => wanted.includes(n)).length;
}

/** Tab labels currently rendered. The journeys name their own tabs, so this is
 *  locale-independent. */
export function tabTitles() {
  return browser.execute(() =>
    [...document.querySelectorAll("[data-pane-container] button")]
      .map((b) => (b.textContent || "").trim())
      .filter(Boolean),
  );
}

/** The disposable profile this run is using — the same fixed path the config
 *  computes, so a spec can locate the app without the config exporting it. */
export const PROFILE_DATA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".profile",
  "data",
);
