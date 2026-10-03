// Bundles the Worker (src/worker.ts + src/room.ts + the shared relay protocol)
// into the single ES module the bridge uploads to the user's account.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [join(root, 'src/worker.ts')],
  outfile: join(root, 'dist/worker/uxnan-relay.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['cloudflare:workers'],
  define: { RELAY_BUILD_VERSION: JSON.stringify(version) },
  legalComments: 'none',
  logLevel: 'warning',
});
