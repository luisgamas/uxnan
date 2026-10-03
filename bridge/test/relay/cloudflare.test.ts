import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudflareError,
  deployRelay,
  isAccountId,
  relayVersion,
  removeHost,
  type FetchLike,
} from '../../src/index.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-token-that-must-never-leak-0123456789';
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const SCRIPT = `/accounts/${ACCOUNT}/workers/scripts/uxnan-relay`;

interface Call {
  method: string;
  path: string;
  auth: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * A fake of the Cloudflare REST API that answers in its real envelope
 * (`{ success, result, errors }`), with a Worker that may or may not exist.
 */
function fakeCloudflare(options: {
  subdomain?: string | null;
  deployedKeys?: string[];
  fail?: { status: number; errors: { code: number; message: string }[] };
}): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let deployedKeys = options.deployedKeys;
  const reply = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn: FetchLike = async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/client/v4', '');
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const call: Call = { method, path, auth: headers.get('authorization') };
    if (init.body instanceof FormData) {
      const meta = init.body.get('metadata');
      if (meta instanceof Blob)
        call.metadata = JSON.parse(await meta.text()) as Record<string, unknown>;
    }
    calls.push(call);
    if (options.fail)
      return reply(options.fail.status, { success: false, errors: options.fail.errors });
    if (path === `/accounts/${ACCOUNT}/workers/subdomain`) {
      return options.subdomain === null
        ? reply(404, { success: false, errors: [{ code: 10007, message: 'not found' }] })
        : reply(200, { success: true, result: { subdomain: options.subdomain ?? 'demo' } });
    }
    if (path === `${SCRIPT}/settings`) {
      if (!deployedKeys)
        return reply(404, { success: false, errors: [{ code: 10007, message: 'x' }] });
      return reply(200, {
        success: true,
        result: {
          bindings: [
            { type: 'durable_object_namespace', name: 'RELAY', class_name: 'RelayRoom' },
            { type: 'plain_text', name: 'UXNAN_HOST_KEYS', text: deployedKeys.join(',') },
          ],
        },
      });
    }
    if (path === SCRIPT && method === 'PUT') {
      const bindings = (call.metadata?.['bindings'] ?? []) as { name: string; text?: string }[];
      deployedKeys = (bindings.find((b) => b.name === 'UXNAN_HOST_KEYS')?.text ?? '').split(',');
      return reply(200, { success: true, result: {} });
    }
    if (path === SCRIPT && method === 'DELETE') {
      deployedKeys = undefined;
      return reply(200, { success: true, result: {} });
    }
    if (path === `${SCRIPT}/subdomain`) return reply(200, { success: true, result: {} });
    return reply(404, { success: false, errors: [{ code: 7003, message: 'unknown route' }] });
  };
  return { fetch: fetchFn, calls };
}

test('isAccountId accepts 32 lowercase hex characters only', () => {
  assert.ok(isAccountId(ACCOUNT));
  assert.ok(!isAccountId(ACCOUNT.toUpperCase()));
  assert.ok(!isAccountId('acct'));
});

test('a first deploy creates the Durable Object class and serves this host key', async () => {
  const cf = fakeCloudflare({ subdomain: 'gamas' });
  const result = await deployRelay(
    { accountId: ACCOUNT, apiToken: TOKEN, fetch: cf.fetch },
    'js',
    KEY_A,
  );
  assert.equal(result.url, 'wss://uxnan-relay.gamas.workers.dev');
  const upload = cf.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(upload?.metadata?.['migrations'], {
    new_tag: 'v1',
    new_sqlite_classes: ['RelayRoom'],
  });
  const bindings = upload?.metadata?.['bindings'] as { name: string; text?: string }[];
  assert.equal(bindings.find((b) => b.name === 'UXNAN_HOST_KEYS')?.text, KEY_A);
  assert.ok(cf.calls.some((c) => c.path === `${SCRIPT}/subdomain` && c.method === 'POST'));
  assert.ok(cf.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
});

test('a redeploy keeps the other PCs and does not repeat the migration', async () => {
  const cf = fakeCloudflare({ deployedKeys: [KEY_B] });
  await deployRelay({ accountId: ACCOUNT, apiToken: TOKEN, fetch: cf.fetch }, 'js', KEY_A);
  const upload = cf.calls.find((c) => c.method === 'PUT');
  assert.equal(upload?.metadata?.['migrations'], undefined);
  const bindings = upload?.metadata?.['bindings'] as { name: string; text?: string }[];
  assert.equal(bindings.find((b) => b.name === 'UXNAN_HOST_KEYS')?.text, `${KEY_B},${KEY_A}`);
});

test('an account without a workers.dev subdomain gets an actionable error', async () => {
  const cf = fakeCloudflare({ subdomain: null });
  await assert.rejects(
    deployRelay({ accountId: ACCOUNT, apiToken: TOKEN, fetch: cf.fetch }, 'js', KEY_A),
    (err: unknown) => err instanceof CloudflareError && /workers\.dev subdomain/.test(err.message),
  );
});

test('a rejected token is explained, and the token never appears in the error', async () => {
  const cf = fakeCloudflare({
    fail: { status: 400, errors: [{ code: 10000, message: `Authentication error ${TOKEN}` }] },
  });
  await assert.rejects(
    deployRelay({ accountId: ACCOUNT, apiToken: TOKEN, fetch: cf.fetch }, 'js', KEY_A),
    (err: unknown) =>
      err instanceof CloudflareError &&
      /rejected the API token/.test(err.message) &&
      !err.message.includes(TOKEN),
  );
});

test('a Cloudflare message that echoes the token is shown without it', async () => {
  const cf = fakeCloudflare({
    fail: { status: 400, errors: [{ code: 1234, message: `Invalid header: Bearer ${TOKEN}` }] },
  });
  await assert.rejects(
    deployRelay({ accountId: ACCOUNT, apiToken: TOKEN, fetch: cf.fetch }, 'js', KEY_A),
    (err: unknown) =>
      err instanceof CloudflareError &&
      err.message.includes('[token]') &&
      !err.message.includes(TOKEN),
  );
});

test('a bad account id is refused before any request', async () => {
  const cf = fakeCloudflare({});
  await assert.rejects(
    deployRelay({ accountId: 'nope', apiToken: TOKEN, fetch: cf.fetch }, 'js', KEY_A),
    /32 hexadecimal/,
  );
  assert.equal(cf.calls.length, 0);
});

test('removeHost deletes the Worker with the last host, else keeps the others', async () => {
  const last = fakeCloudflare({ deployedKeys: [KEY_A] });
  assert.equal(
    await removeHost({ accountId: ACCOUNT, apiToken: TOKEN, fetch: last.fetch }, 'js', KEY_A),
    'deleted',
  );
  assert.ok(last.calls.some((c) => c.method === 'DELETE'));

  const shared = fakeCloudflare({ deployedKeys: [KEY_A, KEY_B] });
  assert.equal(
    await removeHost({ accountId: ACCOUNT, apiToken: TOKEN, fetch: shared.fetch }, 'js', KEY_A),
    'updated',
  );
  const upload = shared.calls.find((c) => c.method === 'PUT');
  const bindings = upload?.metadata?.['bindings'] as { name: string; text?: string }[];
  assert.equal(bindings.find((b) => b.name === 'UXNAN_HOST_KEYS')?.text, KEY_B);

  const none = fakeCloudflare({});
  assert.equal(
    await removeHost({ accountId: ACCOUNT, apiToken: TOKEN, fetch: none.fetch }, 'js', KEY_A),
    'absent',
  );
});

test('relayVersion reads /v1/version and rejects anything that is not the relay', async () => {
  const answer =
    (body: unknown, status = 200): FetchLike =>
    async () =>
      new Response(JSON.stringify(body), { status });
  assert.deepEqual(
    await relayVersion(
      'wss://r.example',
      answer({ name: 'uxnan-relay', protocol: 1, version: '0.1.0' }),
    ),
    { name: 'uxnan-relay', protocol: 1, version: '0.1.0' },
  );
  assert.equal(await relayVersion('wss://r.example', answer({ name: 'other' })), undefined);
  assert.equal(await relayVersion('wss://r.example', answer({}, 404)), undefined);
  assert.equal(
    await relayVersion('wss://r.example', async () => {
      throw new Error('offline');
    }),
    undefined,
  );
});
