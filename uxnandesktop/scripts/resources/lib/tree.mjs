/**
 * Who in the process tree is uxnan's cost, and who is someone else's.
 *
 * The single most misleading number a desktop benchmark can publish is "the app
 * used N MB" when N quietly includes a shell, a `node`, and whatever agent CLI
 * the user happened to launch. So every process the collector reports is placed
 * in exactly one of three buckets:
 *
 * - **own** — the app process plus the helpers its *runtime* creates (the
 *   WebView2/WebKit hosts, the crash handler). This is uxnan's own shell: the
 *   number that has to stay small.
 * - **managed** — own, plus what uxnan spawns *on the user's behalf*: PTY shells
 *   and their ConPTY host, `git`/`gh` invocations, sidecars. Uxnan is
 *   responsible for these existing, so they belong in a "what does uxnan cost me"
 *   answer — but they are not the app's own footprint.
 * - **external** — the program the user ran inside a shell (an agent CLI, a dev
 *   server, a build) and everything under it. Reported, never folded in.
 *
 * The shell is the boundary, and that works because it matches how uxnan
 * actually starts things: every terminal is a *profile* (cmd, PowerShell, bash),
 * and an agent — typed by the user or auto-launched — runs inside it. A program
 * uxnan spawns directly, with no shell in between, is uxnan's own doing (`git`,
 * `gh`, a sidecar) and stays `managed`. A benchmark scenario must therefore
 * launch its fixture agent through a shell too, or it would charge uxnan for the
 * agent (see `profile.shellRunning`).
 *
 * Attribution is by **parent/child relation from a root PID we spawned
 * ourselves**, not by name: a name-only match would claim an unrelated
 * `node.exe` started before the benchmark, and would miss a renamed one. Names
 * are consulted only to answer "is this a shell / a runtime helper", i.e. to
 * decide *which* bucket a descendant lands in — never *whether* it is ours.
 */

export const OWN = "own";
export const MANAGED = "managed";
export const EXTERNAL = "external";

/**
 * Helper processes a webview runtime spawns for the app itself. They exist
 * because the app has a window, so they are part of its own footprint.
 * Extension-stripped, lowercased basenames.
 */
const RUNTIME_HELPERS = new Set([
  "msedgewebview2", // Windows — WebView2 render/GPU/utility children
  "webkitwebprocess", // Linux — WebKitGTK
  "webkitnetworkprocess",
  "webkitgpuprocess",
  "com.apple.webkit.webcontent", // macOS
  "com.apple.webkit.networking",
  "com.apple.webkit.gpu",
  "crashpad_handler", // crash reporter shipped with the webview
]);

/**
 * Console/PTY plumbing the OS inserts between uxnan and a shell. Not a program
 * the user ran, so it stays on uxnan's managed side.
 */
const PTY_HELPERS = new Set(["conhost", "openconsole"]);

/**
 * Shells we look *through*. A program running inside one of these is the user's,
 * not uxnan's — that boundary is what separates `managed` from `external`.
 * Mirrors the shell list `procscan.rs` descends through, so the benchmark and
 * the agent detector agree on what a shell is.
 */
const SHELLS = new Set([
  "cmd",
  "powershell",
  "pwsh",
  "bash",
  "sh",
  "dash",
  "zsh",
  "fish",
  "ksh",
  "nu",
  "wsl",
  "login",
]);

/** Lowercased basename with a known executable extension removed. */
export function normalizeName(name) {
  if (typeof name !== "string") return "";
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const lower = base.toLowerCase();
  for (const ext of [".exe", ".cmd", ".bat", ".ps1", ".com"]) {
    if (lower.endsWith(ext)) return lower.slice(0, -ext.length);
  }
  return lower;
}

export function isShell(name) {
  return SHELLS.has(normalizeName(name));
}

export function isRuntimeHelper(name) {
  return RUNTIME_HELPERS.has(normalizeName(name));
}

export function isPtyHelper(name) {
  return PTY_HELPERS.has(normalizeName(name));
}

/**
 * Walk the tree rooted at `rootPid` and label every reachable process.
 *
 * `rows` is the collector's raw snapshot: `{ pid, ppid, name, ... }`. Returns a
 * `Map<pid, "own"|"managed"|"external">` holding only processes actually
 * descended from `rootPid` — anything else on the machine is invisible to the
 * benchmark by construction.
 *
 * The rules, applied top-down:
 *
 * | parent bucket | this process        | bucket     |
 * |---------------|---------------------|------------|
 * | (root)        | —                   | `own`      |
 * | `own`         | runtime helper      | `own`      |
 * | `own`         | anything else       | `managed`  |
 * | `managed`     | parent is a shell   | `external` unless this is a shell too |
 * | `managed`     | parent is a sidecar | `managed`  |
 * | `external`    | anything            | `external` |
 *
 * The nested-shell exception ("a shell under a shell is still managed") exists
 * because agent CLIs are routinely launched through a `.cmd`/`.ps1` shim; the
 * shim is plumbing, and only what it finally runs is the user's program.
 *
 * A PID recycled onto a *different* subtree cannot smuggle itself in: the walk
 * only follows edges, and a cycle (which a recycled parent PID can forge) is cut
 * by the visited set rather than looping forever.
 */
export function classifyTree(rows, rootPid) {
  const byPid = new Map();
  const children = new Map();
  for (const row of rows ?? []) {
    if (!Number.isInteger(row?.pid)) continue;
    byPid.set(row.pid, row);
    const ppid = Number.isInteger(row.ppid) ? row.ppid : -1;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(row.pid);
  }

  const classes = new Map();
  if (!byPid.has(rootPid)) return classes;

  const queue = [{ pid: rootPid, bucket: OWN, parentName: null }];
  classes.set(rootPid, OWN);

  while (queue.length > 0) {
    const { pid, bucket } = queue.shift();
    const parentName = byPid.get(pid)?.name ?? "";
    for (const childPid of children.get(pid) ?? []) {
      if (classes.has(childPid)) continue; // visited — also cuts a forged cycle
      const child = byPid.get(childPid);
      const childBucket = childClass(bucket, parentName, child?.name ?? "");
      classes.set(childPid, childBucket);
      queue.push({ pid: childPid, bucket: childBucket, parentName });
    }
  }
  return classes;
}

/** The table above, as a function — exported so the rules are unit-testable. */
export function childClass(parentBucket, parentName, childName) {
  if (parentBucket === EXTERNAL) return EXTERNAL;
  if (parentBucket === OWN) {
    return isRuntimeHelper(childName) ? OWN : MANAGED;
  }
  // parentBucket === MANAGED
  if (isShell(parentName)) {
    return isShell(childName) || isPtyHelper(childName) ? MANAGED : EXTERNAL;
  }
  return MANAGED;
}

/**
 * Fold one collector snapshot into per-bucket totals.
 *
 * `prev` is the previous snapshot's per-pid cumulative CPU milliseconds, used to
 * derive a rate; pass `null` for the first sample (its CPU is then `null`, not
 * a fabricated 0). Returns the totals plus the per-pid CPU map to feed the next
 * call.
 */
export function aggregate(rows, rootPid, { prevCpuMs = null, elapsedMs = null } = {}) {
  const classes = classifyTree(rows, rootPid);
  const buckets = {
    [OWN]: emptyBucket(),
    [MANAGED]: emptyBucket(),
    [EXTERNAL]: emptyBucket(),
  };
  const cpuMsByPid = new Map();

  for (const row of rows ?? []) {
    const bucket = classes.get(row.pid);
    if (!bucket) continue;
    if (Number.isFinite(row.cpuMs)) cpuMsByPid.set(row.pid, row.cpuMs);
    const b = buckets[bucket];
    b.procs += 1;
    if (Number.isFinite(row.rssKb)) b.rssKb += row.rssKb;
    if (Number.isFinite(row.privateKb)) b.privateKb += row.privateKb;
    if (Number.isFinite(row.threads)) b.threads += row.threads;
    if (Number.isFinite(row.handles)) b.handles += row.handles;
    if (prevCpuMs && Number.isFinite(row.cpuMs)) {
      const before = prevCpuMs.get(row.pid);
      // A process that appeared since the last sample has no previous reading;
      // counting its whole lifetime CPU as if it burned in this interval would
      // spike the rate, so its first interval contributes nothing.
      if (Number.isFinite(before)) b.cpuDeltaMs += Math.max(0, row.cpuMs - before);
    }
  }

  // `managed` is defined as own + the shells/sidecars — fold `own` in rather
  // than making callers remember to add the two.
  const managed = mergeBuckets(buckets[OWN], buckets[MANAGED]);

  return {
    own: finishBucket(buckets[OWN], prevCpuMs, elapsedMs),
    managed: finishBucket(managed, prevCpuMs, elapsedMs),
    external: finishBucket(buckets[EXTERNAL], prevCpuMs, elapsedMs),
    cpuMsByPid,
    classes,
  };
}

function emptyBucket() {
  return { procs: 0, rssKb: 0, privateKb: 0, threads: 0, handles: 0, cpuDeltaMs: 0 };
}

function mergeBuckets(a, b) {
  return {
    procs: a.procs + b.procs,
    rssKb: a.rssKb + b.rssKb,
    privateKb: a.privateKb + b.privateKb,
    threads: a.threads + b.threads,
    handles: a.handles + b.handles,
    cpuDeltaMs: a.cpuDeltaMs + b.cpuDeltaMs,
  };
}

function finishBucket(b, prevCpuMs, elapsedMs) {
  const measurable = prevCpuMs !== null && Number.isFinite(elapsedMs) && elapsedMs > 0;
  return {
    procs: b.procs,
    rssMb: b.procs === 0 ? 0 : b.rssKb / 1024,
    privateMb: b.privateKb > 0 ? b.privateKb / 1024 : null,
    threads: b.threads > 0 ? b.threads : null,
    handles: b.handles > 0 ? b.handles : null,
    cpuPct: measurable ? Math.max(0, (b.cpuDeltaMs / elapsedMs) * 100) : null,
  };
}

/**
 * Processes that were part of the managed tree at teardown and are still alive
 * afterwards — the "cerrar Uxnan deja cero procesos administrados" check. Takes
 * the last snapshot before quitting and one taken after, and reports the
 * survivors by bucket (names only; see `redact.mjs` for why nothing else).
 */
export function findOrphans(lastRows, rootPid, afterRows) {
  const classes = classifyTree(lastRows, rootPid);
  const alive = new Set((afterRows ?? []).map((r) => r.pid));
  const startTimes = new Map((afterRows ?? []).map((r) => [r.pid, r.startedAt ?? null]));
  const before = new Map((lastRows ?? []).map((r) => [r.pid, r]));
  const orphans = [];
  for (const [pid, bucket] of classes) {
    if (!alive.has(pid)) continue;
    // A PID reused by an unrelated process after teardown would look alive; when
    // the collector reports a start time, require it to match what we saw.
    const wasStartedAt = before.get(pid)?.startedAt ?? null;
    const isStartedAt = startTimes.get(pid) ?? null;
    if (wasStartedAt !== null && isStartedAt !== null && wasStartedAt !== isStartedAt) continue;
    orphans.push({ bucket, name: normalizeName(before.get(pid)?.name ?? "") });
  }
  return orphans;
}
