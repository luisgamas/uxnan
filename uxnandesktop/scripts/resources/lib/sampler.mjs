/**
 * The sampling loop: run a collector, turn its lines into schema samples.
 *
 * Everything here is I/O plumbing around the pure functions in `tree.mjs` and
 * `stats.mjs` — parse a line, fold it into buckets, keep the previous CPU
 * reading so the next fold can produce a rate. A dropped or malformed line is
 * counted and skipped rather than fatal: losing one sample of a five-minute run
 * is noise, aborting the run over it is not.
 */

import { spawn, execFileSync } from "node:child_process";
import readline from "node:readline";

import { aggregate } from "./tree.mjs";
import { collectorCommand, pidsArgs, streamArgs } from "./platform.mjs";

export class Sampler {
  /**
   * @param {number} rootPid PID of the app process the harness spawned.
   * @param {object} opts `intervalMs` (default 1000), `onSample(sample)`.
   */
  constructor(rootPid, { intervalMs = 1000, onSample = null } = {}) {
    this.rootPid = rootPid;
    this.intervalMs = intervalMs;
    this.onSample = onSample;
    /** @type {object[]} schema samples, oldest first. */
    this.samples = [];
    /** Raw rows of the most recent snapshot — the orphan check's "before". */
    this.lastRows = [];
    this.droppedLines = 0;
    this.startedAtMs = null;
    this.child = null;
    this.prevCpuMs = null;
    this.prevT = null;
  }

  /** Spawn the collector and start folding its output. */
  start() {
    const { command, baseArgs, style } = collectorCommand();
    this.child = spawn(command, [...baseArgs, ...streamArgs(style, this.rootPid, this.intervalMs)], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.stderr = "";
    this.child.stderr.on("data", (d) => {
      this.stderr += String(d);
    });
    const rl = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.#ingest(line));
    return this;
  }

  #ingest(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.droppedLines += 1;
      return;
    }
    if (!Number.isFinite(parsed.t) || !Array.isArray(parsed.rows)) {
      this.droppedLines += 1;
      return;
    }
    if (this.startedAtMs === null) this.startedAtMs = parsed.t;

    const elapsedMs = this.prevT === null ? null : parsed.t - this.prevT;
    const folded = aggregate(parsed.rows, this.rootPid, {
      prevCpuMs: this.prevCpuMs,
      elapsedMs,
    });
    const sample = {
      t: parsed.t - this.startedAtMs,
      own: strip(folded.own),
      managed: strip(folded.managed),
      external: strip(folded.external),
    };
    this.samples.push(sample);
    this.lastRows = parsed.rows;
    this.prevCpuMs = folded.cpuMsByPid;
    this.prevT = parsed.t;
    this.onSample?.(sample, parsed.rows);
  }

  /** Stop the collector. Safe to call twice. */
  stop() {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
    this.child = null;
  }

  /** Wait until at least `n` samples have been folded, or `timeoutMs` elapses.
   *  Resolves `true` when the count was reached. */
  async waitForSamples(n, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.samples.length < n) {
      if (Date.now() > deadline) return false;
      await sleep(50);
    }
    return true;
  }
}

/** Drop the fields that only exist to feed the next fold. */
function strip(bucket) {
  return {
    procs: bucket.procs,
    rssMb: round2(bucket.rssMb),
    privateMb: round2(bucket.privateMb),
    threads: bucket.threads,
    handles: bucket.handles,
    cpuPct: round2(bucket.cpuPct),
  };
}

function round2(v) {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/**
 * One-shot snapshot of specific PIDs — used after the app is gone, when there is
 * no tree left to walk and the only question is which of the processes we were
 * responsible for are still running.
 */
export function snapshotPids(pids) {
  if (pids.length === 0) return [];
  const { command, baseArgs, style } = collectorCommand();
  try {
    const raw = execFileSync(command, [...baseArgs, ...pidsArgs(style, pids)], {
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
