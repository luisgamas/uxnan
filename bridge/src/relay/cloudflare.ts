/**
 * Deploys the relay Worker into the user's own Cloudflare account through the
 * REST API — no CLI, no repository, nothing hosted by Uxnan. The token is used
 * for the calls it is passed to and never stored, logged or echoed here (the
 * relay service decides whether the keyring keeps it).
 *
 * One Worker (`uxnan-relay`) serves every PC of the account: each bridge adds
 * its identity public key to the Worker's `UXNAN_HOST_KEYS` and has its own
 * room (routing id). Removing a bridge removes its key; the Worker is deleted
 * only when no key is left.
 */
import { RELAY_COMPATIBILITY_DATE, RELAY_WORKER_NAME } from '@uxnan/shared/relay';

const API = 'https://api.cloudflare.com/client/v4';

/** Binding names the Worker expects (`relay/src/room.ts`). */
const DO_BINDING = 'RELAY';
const DO_CLASS = 'RelayRoom';
const HOST_KEYS_BINDING = 'UXNAN_HOST_KEYS';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudflareTarget {
  accountId: string;
  apiToken: string;
  fetch?: FetchLike;
}

export interface DeployResult {
  /** `wss://uxnan-relay.<subdomain>.workers.dev` */
  url: string;
}

/** A Cloudflare API failure, phrased for the person who has to fix it. */
export class CloudflareError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
  }
}

/** Account ids are 32 lowercase hex characters. */
export function isAccountId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

/**
 * Upload [bundle] as the relay Worker, adding [hostKey] to the hosts it serves
 * (keeping any other PC's key), and make it reachable on `workers.dev`.
 */
export async function deployRelay(
  target: CloudflareTarget,
  bundle: string,
  hostKey: string,
): Promise<DeployResult> {
  const subdomain = await workersSubdomain(target);
  const existing = await existingHostKeys(target);
  const hostKeys = [...new Set([...(existing ?? []), hostKey])];
  await uploadWorker(target, bundle, hostKeys, existing === undefined);
  await call(target, `/workers/scripts/${RELAY_WORKER_NAME}/subdomain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  return { url: `wss://${RELAY_WORKER_NAME}.${subdomain}.workers.dev` };
}

/**
 * Take [hostKey] off the relay. Deletes the Worker when it was the last host,
 * otherwise re-uploads [bundle] serving only the remaining PCs.
 */
export async function removeHost(
  target: CloudflareTarget,
  bundle: string,
  hostKey: string,
): Promise<'deleted' | 'updated' | 'absent'> {
  const existing = await existingHostKeys(target);
  if (existing === undefined) return 'absent';
  const remaining = existing.filter((k) => k !== hostKey);
  if (remaining.length === 0) {
    await call(target, `/workers/scripts/${RELAY_WORKER_NAME}?force=true`, { method: 'DELETE' });
    return 'deleted';
  }
  await uploadWorker(target, bundle, remaining, false);
  return 'updated';
}

async function workersSubdomain(target: CloudflareTarget): Promise<string> {
  const result = await call<{ subdomain?: string }>(target, '/workers/subdomain', {}, [404]);
  const subdomain = result?.subdomain;
  if (!subdomain) {
    throw new CloudflareError(
      'This Cloudflare account has no workers.dev subdomain yet. Open Workers & Pages in the ' +
        'Cloudflare dashboard once to choose one, then try again.',
      404,
    );
  }
  return subdomain;
}

/** The host keys the deployed Worker serves, or `undefined` if it is not deployed. */
async function existingHostKeys(target: CloudflareTarget): Promise<string[] | undefined> {
  const settings = await call<{ bindings?: { type: string; name: string; text?: string }[] }>(
    target,
    `/workers/scripts/${RELAY_WORKER_NAME}/settings`,
    {},
    [404],
  );
  if (settings === undefined) return undefined;
  const binding = settings.bindings?.find((b) => b.name === HOST_KEYS_BINDING);
  return (binding?.text ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => /^[0-9a-f]{64}$/.test(k));
}

async function uploadWorker(
  target: CloudflareTarget,
  bundle: string,
  hostKeys: string[],
  firstDeploy: boolean,
): Promise<void> {
  const metadata = {
    main_module: 'uxnan-relay.js',
    compatibility_date: RELAY_COMPATIBILITY_DATE,
    bindings: [
      { type: 'durable_object_namespace', name: DO_BINDING, class_name: DO_CLASS },
      { type: 'plain_text', name: HOST_KEYS_BINDING, text: hostKeys.join(',') },
    ],
    // The Durable Object class is created once; later uploads must not repeat it.
    ...(firstDeploy ? { migrations: { new_tag: 'v1', new_sqlite_classes: [DO_CLASS] } } : {}),
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append(
    'uxnan-relay.js',
    new Blob([bundle], { type: 'application/javascript+module' }),
    'uxnan-relay.js',
  );
  await call(target, `/workers/scripts/${RELAY_WORKER_NAME}`, { method: 'PUT', body: form });
}

interface ApiEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
}

/**
 * One account-scoped API call. Resolves the `result`, `undefined` for a status
 * in [absentOk] (e.g. 404 "not deployed"), and throws a {@link CloudflareError}
 * otherwise. Error text comes from Cloudflare's own messages — never from the
 * request, so the token cannot leak into it.
 */
async function call<T = unknown>(
  target: CloudflareTarget,
  path: string,
  init: RequestInit = {},
  absentOk: number[] = [],
): Promise<T | undefined> {
  if (!isAccountId(target.accountId)) {
    throw new CloudflareError(
      'The Cloudflare account id should be 32 hexadecimal characters.',
      400,
    );
  }
  const doFetch = target.fetch ?? ((url, options) => fetch(url, options));
  let res: Response;
  try {
    res = await doFetch(`${API}/accounts/${target.accountId}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${target.apiToken}` },
    });
  } catch {
    throw new CloudflareError('Could not reach Cloudflare. Check the connection and try again.', 0);
  }
  if (absentOk.includes(res.status)) return undefined;
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (res.ok && body.success !== false) return body.result;
  const message = explain(res.status, body.errors ?? []);
  // Cloudflare's own text is shown as is — minus the token, should it ever echo it.
  throw new CloudflareError(message.split(target.apiToken).join('[token]'), res.status);
}

function explain(status: number, errors: { code?: number; message?: string }[]): string {
  const codes = errors.map((e) => e.code);
  if (status === 401 || codes.includes(10000) || codes.includes(9109)) {
    return 'Cloudflare rejected the API token. Create one with the "Edit Cloudflare Workers" template and paste it again.';
  }
  if (status === 403) {
    return 'The API token cannot edit Workers on this account. Create it with the "Edit Cloudflare Workers" template, scoped to this account.';
  }
  if (status === 404 && codes.includes(7003)) {
    return 'Cloudflare does not know this account id. Copy it from the Workers & Pages overview.';
  }
  const detail = errors
    .map((e) => e.message)
    .filter((m): m is string => typeof m === 'string' && m.length > 0)
    .join('; ');
  return detail.length > 0
    ? `Cloudflare said: ${detail}`
    : `Cloudflare answered with an error (${status}).`;
}

/** Ask a relay what it runs (`GET /v1/version`); `undefined` if it does not answer. */
export async function relayVersion(
  url: string,
  fetchImpl: FetchLike = (u, o) => fetch(u, o),
): Promise<{ name: string; protocol: number; version: string } | undefined> {
  try {
    const res = await fetchImpl(`${url.replace(/^ws/, 'http')}/v1/version`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    if (
      body['name'] === RELAY_WORKER_NAME &&
      typeof body['protocol'] === 'number' &&
      typeof body['version'] === 'string'
    ) {
      return { name: body['name'], protocol: body['protocol'], version: body['version'] };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
