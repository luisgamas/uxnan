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
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

export const BRIDGE_VERSION: string = pkg.version;
