/**
 * Bridge package version, read from package.json at runtime so the CLI's
 * reported version can never drift from the published package. Works both
 * from the compiled tree (dist/src/version.js → ../../package.json) and from
 * a published npm install (node_modules/uxnan-bridge/package.json).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string };

export const BRIDGE_VERSION: string = pkg.version;

/** npm package name, read from package.json so the update check can never
 * drift from what's actually published. */
export const BRIDGE_PACKAGE_NAME: string = pkg.name;
