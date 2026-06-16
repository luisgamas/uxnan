/**
 * Routes JSON-RPC requests to registered handlers.
 *
 * - Unknown methods → -32601 (method not found).
 * - Malformed envelopes → -32600 (invalid request).
 * - Handlers may throw {@link RpcError} (mapped to its code) or any error
 *   (mapped to -32603 internal error).
 *
 * Source: architecture/02a-system-architecture.md §5.8.2 (handler-router).
 */
import {
  JsonRpcErrorCode,
  RpcError,
  isKnownMethod,
  makeErrorResponse,
  makeResponse,
  validateJsonRpcRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '@uxnan/shared';
import type { BridgeContext } from './bridge-context.js';

/**
 * Identity of the phone session a request arrived on (the secure transport knows
 * it after the handshake). Threaded to handlers so per-phone operations (e.g.
 * `notifications/*`) target the right session when several phones are concurrent.
 */
export interface RequestSession {
  /** Relay session id (the push registration key). */
  sessionId: string;
  /** Trusted-device id of the phone. */
  deviceId: string;
}

export type RpcHandler = (
  params: unknown,
  ctx: BridgeContext,
  session?: RequestSession,
) => Promise<unknown> | unknown;

export class HandlerRouter {
  readonly #handlers = new Map<string, RpcHandler>();
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  register(method: string, handler: RpcHandler): void {
    this.#handlers.set(method, handler);
  }

  has(method: string): boolean {
    return this.#handlers.has(method);
  }

  /** Dispatch an already-parsed JSON-RPC request. Never throws. */
  async dispatch(request: JsonRpcRequest, session?: RequestSession): Promise<JsonRpcResponse> {
    const { id, method } = request;
    if (!isKnownMethod(method) || !this.#handlers.has(method)) {
      return makeErrorResponse(id, RpcError.methodNotFound(method).toErrorObject());
    }
    const handler = this.#handlers.get(method)!;
    try {
      const result = await handler(request.params, this.#ctx, session);
      return makeResponse(id, result ?? null);
    } catch (err) {
      return makeErrorResponse(id, this.#toErrorObject(err));
    }
  }

  /** Validate a raw (untrusted) message envelope, then dispatch it. */
  async dispatchRaw(raw: unknown, session?: RequestSession): Promise<JsonRpcResponse> {
    const validation = validateJsonRpcRequest(raw);
    if (!validation.valid) {
      const id = this.#extractId(raw);
      return makeErrorResponse(id, {
        code: JsonRpcErrorCode.InvalidRequest,
        message: 'Invalid request',
        data: validation.errors,
      });
    }
    return this.dispatch(validation.data, session);
  }

  #toErrorObject(err: unknown): { code: number; message: string; data?: unknown } {
    if (err instanceof RpcError) return err.toErrorObject();
    const message = err instanceof Error ? err.message : 'Internal error';
    return { code: JsonRpcErrorCode.InternalError, message };
  }

  #extractId(raw: unknown): string | number | null {
    if (raw && typeof raw === 'object' && 'id' in raw) {
      const id = (raw as { id: unknown }).id;
      if (typeof id === 'string' || typeof id === 'number') return id;
    }
    return null;
  }
}
