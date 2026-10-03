// A real relay and a stand-in bridge for the phone's relay tests
// (test/integration/relay_local_test.dart).
//
// Starts the relay Worker on the real Workers runtime (workerd, through
// Miniflare: relay/src/local/start-local-relay.ts), authenticates to it as a
// bridge on the host route, opens a pairing window with a one-time ticket, and
// answers every `dial` by opening the phone's channel and echoing whatever the
// phone sends — so the phone's side of the relay protocol is proven against
// the relay itself, not a stand-in.
//
// Needs the relay built first, from the repository root:
//   npm run build -w uxnan-relay
//
// stdout: one JSON line once ready — {"url", "routingId", "ticket"}.
// stdin:  JSON lines — {"allow": ["<phone key hex>", …]} replaces the phones
//         the relay lets in without a ticket; {"drop": true} closes the
//         bridge's control socket (the PC going offline).
// Exits when stdin closes.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { startLocalRelay } from '../../../relay/dist/src/local/start-local-relay.js';
import {
  parseRelayServerFrame,
  relayRoutePath,
  relaySigningMessage,
} from '../../../shared/dist/src/relay/protocol.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const hostKey = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const routingId = randomBytes(16).toString('hex');
const ticket = randomBytes(32).toString('base64url');

const relay = await startLocalRelay({ hostKeys: [hostKey] });
const relayHost = new URL(relay.url).host;

/** Opens a route, answers the challenge, resolves once the relay says ready. */
function open(route, channelId, onFrame) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relay.url}${relayRoutePath(route, routingId, channelId)}`);
    let ready = false;
    ws.on('error', reject);
    ws.on('message', (data, isBinary) => {
      if (ready) return onFrame(ws, data, isBinary);
      const frame = parseRelayServerFrame(data.toString('utf8'));
      if (frame?.t === 'challenge') {
        const message = relaySigningMessage({
          route,
          host: relayHost,
          routingId,
          ...(channelId ? { channelId } : {}),
          nonce: frame.nonce,
        });
        const sig = sign(null, Buffer.from(message, 'utf8'), privateKey).toString('hex');
        ws.send(
          JSON.stringify(
            route === 'host' ? { t: 'host-auth', key: hostKey, sig } : { t: 'channel-auth', sig },
          ),
        );
      } else if (frame?.t === 'ready') {
        ready = true;
        resolve(ws);
      }
    });
  });
}

const host = await open('host', undefined, (_ws, data) => {
  const frame = parseRelayServerFrame(data.toString('utf8'));
  if (frame?.t !== 'dial') return;
  // The phone's channel: echo every frame back, exactly as it came.
  open('channel', frame.channel, (ws, payload, isBinary) =>
    ws.send(payload, { binary: isBinary }),
  ).catch((error) => process.stderr.write(`channel failed: ${error}\n`));
});

host.send(
  JSON.stringify({
    t: 'ticket',
    hash: createHash('sha256').update(ticket, 'ascii').digest('hex'),
    ttlMs: 10 * 60_000,
  }),
);

process.stdout.write(`${JSON.stringify({ url: relay.url, routingId, ticket })}\n`);

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const command = JSON.parse(line);
  if (Array.isArray(command.allow)) host.send(JSON.stringify({ t: 'allow', keys: command.allow }));
  if (command.drop === true) host.close();
});
input.on('close', async () => {
  host.close();
  await relay.close();
  process.exit(0);
});
