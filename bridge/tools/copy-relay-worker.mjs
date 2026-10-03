// Ships the relay Worker inside the bridge package: the bridge deploys THIS
// bundle into the user's Cloudflare account (`relay/setup`, `relay/update`).
// Built by `npm run build -w uxnan-relay` first (the root `build` does both).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bundle = require.resolve('uxnan-relay/worker-bundle');
const relayPackage = JSON.parse(readFileSync(join(dirname(bundle), '..', '..', 'package.json'), 'utf8'));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'relay-worker');
mkdirSync(out, { recursive: true });
copyFileSync(bundle, join(out, 'uxnan-relay.js'));
writeFileSync(join(out, 'meta.json'), `${JSON.stringify({ version: relayPackage.version })}\n`);
