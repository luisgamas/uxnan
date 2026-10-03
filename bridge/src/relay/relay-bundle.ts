/**
 * The relay Worker this bridge ships (`dist/relay-worker/`, copied from
 * `relay/` at build time): what `relay/setup` and `relay/update` deploy, and
 * the version they deploy.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const DIR = new URL('../../relay-worker/', import.meta.url);

/** The Worker module source. */
export function readRelayBundle(): Promise<string> {
  return readFile(new URL('uxnan-relay.js', DIR), 'utf8');
}

/** The version of the shipped Worker, or `unknown` if the build did not include it. */
export function bundledRelayVersion(): string {
  try {
    const meta = JSON.parse(readFileSync(new URL('meta.json', DIR), 'utf8')) as {
      version?: unknown;
    };
    return typeof meta.version === 'string' ? meta.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
