#!/usr/bin/env node
/**
 * The one source of truth for Uxnan Desktop release-tag channels.
 *
 * Stable:  desktop-stable-v0.0.PATCH
 * Nightly: desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N
 *
 * The numeric base must advance for every build because Windows MSI and the
 * Tauri updater compare that base, not the descriptive nightly suffix.
 */

import { pathToFileURL } from "node:url";

const NUM = "(?:0|[1-9]\\d*)";
const BASE = `(${NUM}\\.${NUM}\\.${NUM})`;
const STABLE = new RegExp(`^desktop-stable-v${BASE}$`);
const NIGHTLY = new RegExp(`^desktop-nightly-v${BASE}-nightly\\.(\\d{8})\\.([1-9]\\d*)$`);

/** @param {string} value */
function isCalendarDate(value) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Parse and validate a Desktop release tag.
 * @param {string} tag
 */
export function parseDesktopReleaseTag(tag) {
  const stable = tag.match(STABLE);
  if (stable) {
    return {
      channel: "stable",
      prerelease: false,
      version: stable[1],
    };
  }

  const nightly = tag.match(NIGHTLY);
  if (nightly && isCalendarDate(nightly[2])) {
    return {
      channel: "nightly",
      prerelease: true,
      version: `${nightly[1]}-nightly.${nightly[2]}.${nightly[3]}`,
    };
  }

  throw new Error(
    `Invalid Desktop release tag '${tag}'. Expected ` +
      "desktop-stable-v0.0.PATCH or desktop-nightly-v0.0.PATCH-nightly.YYYYMMDD.N.",
  );
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    throw new Error("Usage: node scripts/desktop-release-tag.mjs <tag>");
  }
  const release = parseDesktopReleaseTag(tag);
  // GitHub Actions consumes these lines through $GITHUB_OUTPUT.
  console.log(`version=${release.version}`);
  console.log(`channel=${release.channel}`);
  console.log(`prerelease=${release.prerelease}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
