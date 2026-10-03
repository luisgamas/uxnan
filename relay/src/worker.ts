/**
 * Uxnan relay — a Cloudflare Worker the bridge deploys into the user's OWN
 * account. It pairs a phone with that user's bridge when they are on different
 * networks and then forwards their frames blindly: everything after the relay's
 * own auth step is the E2EE handshake and AES-256-GCM envelopes, which the
 * relay cannot read.
 *
 * One Durable Object ({@link RelayRoom}) per bridge `routingId` holds that
 * bridge's sockets. Routes and frames: `@uxnan/shared` relay protocol
 * (architecture/02a §5.10).
 */
import { RELAY_PROTOCOL_VERSION, RELAY_WORKER_NAME, parseRelayPath } from '@uxnan/shared/relay';
import type { RelayEnv } from './room.js';

export { RelayRoom } from './room.js';

/** Injected by the build (`scripts/build.mjs`) from `relay/package.json`. */
declare const RELAY_BUILD_VERSION: string;

export default {
  fetch(request: Request, env: RelayEnv): Promise<Response> | Response {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/v1/version') {
      return Response.json({
        name: RELAY_WORKER_NAME,
        protocol: RELAY_PROTOCOL_VERSION,
        version: RELAY_BUILD_VERSION,
      });
    }
    const route = parseRelayPath(url.pathname);
    if (!route) return new Response('Not Found', { status: 404 });
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const room = env.RELAY.get(env.RELAY.idFromName(route.routingId));
    return room.fetch(request);
  },
} satisfies ExportedHandler<RelayEnv>;
