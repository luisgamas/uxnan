import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, sign } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import {
  RELAY_CLOSE,
  parseRelayServerFrame,
  relayRoutePath,
  relaySigningMessage,
} from '@uxnan/shared/relay';
import type { PairingRelay } from '@uxnan/shared';
import { startLocalRelay, type LocalRelayHandle } from 'uxnan-relay/local';
import { rmrf } from '../helpers/fs.js';
import {
  DEFAULT_DAEMON_CONFIG,
  DaemonState,
  InMemorySecretStore,
  startBridge,
  wsToMessageIO,
  type Bridge,
} from '../../src/index.js';
import { FakePhone, newPhoneIdentity, type PhoneIdentity } from '../helpers/fake-phone.js';

// A real bridge, the real relay Worker on the real Workers runtime (Miniflare),
// and a phone that speaks the relay's phone route and then the E2EE handshake.

async function setup(): Promise<{
  bridge: Bridge;
  relay: LocalRelayHandle;
  cleanup(): Promise<void>;
}> {
  const baseDir = join(tmpdir(), `uxnan-relay-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  await state.writeConfig({ ...DEFAULT_DAEMON_CONFIG, lanEnabled: false });
  const bridge = await startBridge({
    baseDir,
    secretStore: new InMemorySecretStore(),
    logLevel: 'error',
  });
  const relay = await startLocalRelay({
    hostKeys: [bridge.context.deviceState.identity.macIdentityPublicKey],
  });
  await bridge.startRelay();
  await bridge.context.relay().use(relay.url);
  await waitFor(() => bridge.context.relay().status().state === 'connected');
  return {
    bridge,
    relay,
    cleanup: async () => {
      await bridge.stop();
      await relay.close();
      await rmrf(baseDir);
    },
  };
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Dial the relay's phone route as [identity]; resolves the socket once the
 * relay says `ready`, or rejects with the close code it answered instead.
 */
function dialAsPhone(
  relay: PairingRelay,
  identity: PhoneIdentity,
  ticket?: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relay.url}${relayRoutePath('phone', relay.routingId)}`);
    const onMessage = (data: RawData): void => {
      const frame = parseRelayServerFrame(String(data));
      if (frame?.t === 'challenge') {
        const message = relaySigningMessage({
          route: 'phone',
          host: new URL(relay.url).host,
          routingId: relay.routingId,
          nonce: frame.nonce,
        });
        const sig = sign(null, Buffer.from(message), identity.privateKey).toString('hex');
        ws.send(
          JSON.stringify({
            t: 'phone-auth',
            key: identity.publicKeyHex,
            sig,
            ...(ticket ? { ticket } : {}),
          }),
        );
      } else if (frame?.t === 'ready') {
        ws.off('message', onMessage);
        resolve(ws);
      }
    };
    ws.on('message', onMessage);
    ws.once('close', (code) => reject(new Error(`closed ${code}`)));
    ws.once('error', reject);
  });
}

/** Resolves the close code the relay sent (as soon as its close frame lands). */
async function closedWith(ws: WebSocket): Promise<number> {
  const internals = ws as unknown as { _closeFrameReceived?: boolean; _closeCode?: number };
  await waitFor(() => ws.readyState === WebSocket.CLOSED || internals._closeFrameReceived === true);
  return internals._closeCode ?? 0;
}

test('a phone pairs through the relay, reconnects as trusted, and is cut off when removed', async () => {
  const { bridge, cleanup } = await setup();
  try {
    const qr = bridge.generatePairingQr();
    assert.ok(qr.relay, 'the QR carries the relay');
    assert.ok(qr.relay.ticket, 'an open pairing window carries a one-time ticket');

    const identity = newPhoneIdentity();
    const first = await dialAsPhone(qr.relay, identity, qr.relay.ticket);
    const phone = await FakePhone.connect(wsToMessageIO(first), {
      sessionId: qr.sessionId,
      identity,
    });
    const status = await phone.request('bridge/status');
    assert.ok('result' in status);
    await waitFor(() => bridge.context.relay().status().connectedPhones === 1);
    phone.close();

    // Trusted now: no ticket needed, and the relay learned the key from the bridge.
    const again = await dialAsPhone(qr.relay, identity);
    const trusted = await FakePhone.connect(wsToMessageIO(again), {
      sessionId: qr.sessionId,
      identity,
      mode: 'trusted_reconnect',
    });
    assert.ok('result' in (await trusted.request('bridge/status')));

    // Removing the phone on the PC cuts its live channel at the relay.
    await bridge.context.trustStore.remove(identity.deviceId);
    assert.equal(await closedWith(again), RELAY_CLOSE.revoked);
  } finally {
    await cleanup();
  }
});

test('a new phone without a ticket is refused at the relay', async () => {
  const { bridge, cleanup } = await setup();
  try {
    const relay = bridge.context.relay().status().endpoint;
    assert.ok(relay);
    await assert.rejects(
      dialAsPhone({ url: relay.url, routingId: relay.routingId }, newPhoneIdentity()),
      new RegExp(`closed ${RELAY_CLOSE.notAllowed}`),
    );
  } finally {
    await cleanup();
  }
});

test('the relay endpoint is a shared setting, and switching it off disconnects', async () => {
  const { bridge, cleanup } = await setup();
  try {
    const endpoint = bridge.context.settings.get().relay;
    assert.ok(endpoint?.enabled);
    await bridge.context.relay().setEnabled(false, Date.now());
    assert.equal(bridge.context.settings.get().relay?.enabled, false);
    assert.equal(bridge.context.relay().status().state, 'off');
    assert.equal(bridge.generatePairingQr().relay, undefined, 'a disabled relay is not offered');

    const before = endpoint.routingId;
    await bridge.context.relay().setEnabled(true, Date.now());
    await bridge.context.relay().rotate();
    assert.notEqual(bridge.context.settings.get().relay?.routingId, before);
    await waitFor(() => bridge.context.relay().status().state === 'connected');
  } finally {
    await cleanup();
  }
});
