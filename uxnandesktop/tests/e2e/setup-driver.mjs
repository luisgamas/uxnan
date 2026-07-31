#!/usr/bin/env node
/**
 * Fetch the WebDriver that matches this machine's WebView2.
 *
 * Driving a Tauri window on Windows goes through `tauri-driver`, which is a thin
 * intermediary in front of Microsoft's `msedgedriver` — and `msedgedriver` is
 * version-locked to the installed WebView2 runtime. A mismatch does not degrade
 * gracefully: the session simply refuses to start, with a message about browser
 * versions that says nothing about what to do.
 *
 * So the version is *read from the machine* rather than pinned in a config file.
 * Pinning it would be pinning someone else's software: WebView2 updates itself
 * on its own schedule, and a checked-in version would be wrong within weeks and
 * would fail on every machine that isn't this one.
 *
 * The binary lands in `.drivers/`, which is git-ignored — it is a per-machine
 * build artifact, not a project file.
 *
 *   node tests/e2e/setup-driver.mjs            # fetch if missing or mismatched
 *   node tests/e2e/setup-driver.mjs --check    # report only, exit 1 if not ready
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DRIVERS_DIR = path.join(HERE, ".drivers");
export const DRIVER_PATH = path.join(
  DRIVERS_DIR,
  process.platform === "win32" ? "msedgedriver.exe" : "msedgedriver",
);

/** The installed WebView2 runtime version, or `null` if it can't be read. */
export function installedWebViewVersion() {
  if (process.platform !== "win32") return null;
  for (const key of [
    "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  ]) {
    const out = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-ItemProperty -Path '${key}' -EA SilentlyContinue).pv`],
      { encoding: "utf8", windowsHide: true },
    );
    const version = out.stdout?.trim();
    if (version) return version;
  }
  return null;
}

/** The version of the driver already downloaded, or `null`. */
export function localDriverVersion() {
  if (!fs.existsSync(DRIVER_PATH)) return null;
  const out = spawnSync(DRIVER_PATH, ["--version"], { encoding: "utf8", windowsHide: true });
  return out.stdout?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
}

/** `null` when the driver is present and matches; otherwise why not. */
export function driverStatus() {
  if (process.platform !== "win32") {
    return "E2E is Windows-only for now: the driver pairing has not been worked out on macOS/Linux.";
  }
  const want = installedWebViewVersion();
  if (!want) return "could not read the installed WebView2 version from the registry";
  const have = localDriverVersion();
  if (!have) return `no WebDriver in .drivers/ (need ${want})`;
  if (have !== want) return `WebDriver is ${have} but WebView2 is ${want}`;
  return null;
}

function download(version) {
  fs.mkdirSync(DRIVERS_DIR, { recursive: true });
  const zip = path.join(DRIVERS_DIR, "edgedriver.zip");
  const url = `https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`;
  process.stderr.write(`fetching WebDriver ${version}…\n`);
  execFileSync("curl.exe", ["-sSL", "--max-time", "300", "-o", zip, url], { stdio: "inherit" });
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${DRIVERS_DIR}' -Force`],
    { stdio: "inherit", windowsHide: true },
  );
  fs.rmSync(zip, { force: true });
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const problem = driverStatus();

  if (!problem) {
    process.stderr.write(`WebDriver ${localDriverVersion()} matches the installed WebView2.\n`);
    return 0;
  }
  if (checkOnly) {
    process.stderr.write(`${problem}\nRun: node tests/e2e/setup-driver.mjs\n`);
    return 1;
  }
  if (process.platform !== "win32") {
    process.stderr.write(`${problem}\n`);
    return 1;
  }

  const version = installedWebViewVersion();
  if (!version) {
    process.stderr.write("cannot fetch a driver without knowing the WebView2 version\n");
    return 1;
  }
  download(version);

  const after = driverStatus();
  if (after) {
    process.stderr.write(`still not usable after downloading: ${after}\n`);
    return 1;
  }
  process.stderr.write(`WebDriver ${version} ready.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  process.exit(main());
}
