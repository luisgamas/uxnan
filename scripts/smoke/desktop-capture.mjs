#!/usr/bin/env node
// Checks the desktop's page capture on the platform it runs on, from outside
// the app, through the control route a script uses (docs/control-api.md →
// "Calling the RPC route directly"): serve a local page, open it in the
// integrated browser, capture it, and save the PNG for a person to look at.
//
//   node scripts/smoke/desktop-capture.mjs <out-dir> [seconds]
//
// Used by .github/workflows/smoke-platforms.yml with an installed release
// running. Exits non-zero when the app never answers or the capture is empty.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'capture';
const seconds = Number(process.argv[3] ?? 180);
const APP_ID = 'dev.luisgamas.uxnandesktop';

function dataDir() {
  if (process.env.UXNAN_DATA_DIR) return process.env.UXNAN_DATA_DIR;
  if (process.platform === 'win32') return join(process.env.APPDATA ?? '', APP_ID);
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', APP_ID);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), APP_ID);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discovery(deadline) {
  const file = join(dataDir(), 'control.json');
  while (Date.now() < deadline) {
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      if (d.endpoint && d.token) return d;
    } catch {
      /* not written yet */
    }
    await sleep(1000);
  }
  throw new Error(`the app never wrote ${file}`);
}

async function call(d, method, params = {}) {
  const res = await fetch(`${d.endpoint}/control/v1/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const reply = await res.json();
  if (reply.error) throw new Error(`${method}: ${reply.error.code} ${reply.error.message}`);
  return reply.result;
}

const page = `<!doctype html><html><head><title>Capture check</title></head>
<body style="margin:0;font:32px sans-serif;background:#1b6ef3;color:#fff">
<div style="height:50vh;display:flex;align-items:center;justify-content:center">Uxnan capture check</div>
<div style="height:50vh;background:#00c896"></div></body></html>`;
const server = createServer((_, res) =>
  res.writeHead(200, { 'content-type': 'text/html' }).end(page),
);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const deadline = Date.now() + seconds * 1000;
try {
  const d = await discovery(deadline);
  console.log(JSON.stringify({ status: await call(d, 'browser/status') }));
  const opened = await call(d, 'browser/open', { url });
  console.log(JSON.stringify({ opened }));
  if (opened.routed !== 'browser') throw new Error(`the page was routed to ${opened.routed}`);
  await call(d, 'browser/wait', { text: 'Uxnan capture check' }).catch(() => undefined);
  const shot = await call(d, 'browser/screenshot');
  const png = Buffer.from(shot.image.data, 'base64');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `capture-${process.platform}.png`), png);
  console.log(
    JSON.stringify({
      url: shot.url,
      visible: shot.visible,
      width: shot.image.width,
      height: shot.image.height,
      bytes: png.length,
    }),
  );
  if (png.length < 100 || !(shot.image.width > 0 && shot.image.height > 0)) {
    throw new Error('the capture is empty');
  }
} finally {
  server.close();
}
