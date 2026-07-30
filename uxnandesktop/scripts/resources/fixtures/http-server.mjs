#!/usr/bin/env node
/**
 * A local page for the browser scenario.
 *
 * The integrated browser's cost depends on what it loads, so pointing it at a
 * real site would make the measurement depend on that site's ads, fonts and
 * A/B test of the day — and would put the benchmark on the network, which it is
 * not allowed to be. This serves a fixed page from loopback instead: known
 * weight, known DOM, no requests leaving the machine.
 *
 * Prints `{"url":"http://127.0.0.1:<port>/"}` on stdout once listening, so the
 * harness can wait for a line rather than guess a port.
 *
 * Usage: node http-server.mjs [--port 0] [--weight light|heavy]
 */

import http from "node:http";

const argv = process.argv.slice(2);
const portArg = argv.indexOf("--port");
const port = portArg === -1 ? 0 : Number(argv[portArg + 1]);
const weightArg = argv.indexOf("--weight");
const weight = weightArg === -1 ? "light" : argv[weightArg + 1];

/** A deterministic page: N rows of static markup, no scripts, no requests. */
function page(rows) {
  const items = Array.from(
    { length: rows },
    (_, i) =>
      `<li><code>src/mod${String(i % 20).padStart(3, "0")}/file${String(i).padStart(5, "0")}.ts</code> — ${
        (i * 37) % 400
      } lines</li>`,
  ).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>uxnan browser fixture</title>
<style>body{font:14px/1.5 system-ui;margin:2rem;max-width:60rem}li{margin:.15rem 0}</style>
</head><body>
<h1>uxnan browser fixture</h1>
<p>Static page served from loopback for the resource benchmarks. ${rows} rows.</p>
<ul>
${items}
</ul>
</body></html>`;
}

const body = page(weight === "heavy" ? 5000 : 200);

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}/` }));
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
