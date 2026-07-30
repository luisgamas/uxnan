/**
 * Which collector to run, and the machine facts a result is meaningless
 * without.
 *
 * A memory figure with no OS, no webview version and no core count is not a
 * measurement, it is an anecdote — so the platform block is required by the
 * schema and filled here, once, from the collector's `--info` mode.
 */

import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { tag } from "./redact.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COLLECTORS = path.join(HERE, "..", "collectors");

/** `windows` | `macos` | `linux`; anything else is unsupported. */
export function osKey(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return platform;
}

/** How to invoke the collector for this OS: `{ command, baseArgs, flag }`. */
export function collectorCommand(key = osKey()) {
  if (key === "windows") {
    return {
      command: "powershell.exe",
      baseArgs: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(COLLECTORS, "windows.ps1"),
      ],
      style: "powershell",
    };
  }
  if (key === "macos" || key === "linux") {
    return {
      command: "/bin/sh",
      baseArgs: [path.join(COLLECTORS, "unix.sh")],
      style: "posix",
    };
  }
  throw new Error(`no resource collector for platform ${key} (supported: windows, macos, linux)`);
}

/** Collector arguments for a streaming run. */
export function streamArgs(style, rootPid, intervalMs) {
  return style === "powershell"
    ? ["-RootPid", String(rootPid), "-IntervalMs", String(intervalMs)]
    : ["--root-pid", String(rootPid), "--interval-ms", String(intervalMs)];
}

/** Collector arguments for a one-shot snapshot of specific PIDs. */
export function pidsArgs(style, pids) {
  return style === "powershell"
    ? ["-Pids", pids.join(","), "-Once"]
    : ["--pids", pids.join(","), "--once"];
}

/**
 * Read the static machine facts. Failure is not fatal: a run on a box whose
 * collector can't answer still records what it does know, with the rest `null`
 * so nobody mistakes it for a measured zero.
 */
export function readPlatform() {
  const key = osKey();
  const { command, baseArgs, style } = collectorCommand(key);
  let info = {};
  try {
    const raw = execFileSync(command, [...baseArgs, style === "powershell" ? "-Info" : "--info"], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    info = JSON.parse(raw.trim().split(/\r?\n/).pop() ?? "{}");
  } catch (err) {
    info = { infoError: String(err?.message ?? err) };
  }

  return {
    os: key,
    arch: process.arch,
    osName: info.osName ?? null,
    osVersion: info.osVersion ?? null,
    webview: info.webview ?? null,
    cpuModel: info.cpuModel ?? null,
    cpuCores: Number.isFinite(info.cpuCores) && info.cpuCores > 0 ? info.cpuCores : os.cpus().length,
    totalMemMb: info.totalMemMb ?? Math.round(os.totalmem() / 1024 / 1024),
    powerPlan: info.powerPlan ?? null,
    nodeVersion: process.version,
    // Lets two runs on the same machine be recognised as such without the
    // hostname ever appearing in the document.
    hostId: tag(`${os.hostname()}|${os.userInfo().username}`),
    infoError: info.infoError ?? null,
  };
}
