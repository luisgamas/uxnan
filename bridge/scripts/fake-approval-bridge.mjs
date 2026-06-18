/**
 * Spins up a fake bridge HTTP endpoint that ALWAYS returns `allow` after a
 * short delay (so the gemini CLI's tool call gets a real round-trip), then
 * prints the request it received and exits.
 */
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log(`[bridge] ${req.method} ${req.url} body=${body}`);
    // Mimic the real bridge: hold the response for 250 ms (so the hook waits,
    // exercising the same code path the real phone would) then return `allow`.
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'allow' }));
    }, 250);
  });
});
server.listen(19999, '127.0.0.1', () => {
  console.log('[bridge] listening on http://127.0.0.1:19999/agent-hook/approval');
});
