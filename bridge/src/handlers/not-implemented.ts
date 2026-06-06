/**
 * Helpers for registering not-yet-implemented JSON-RPC methods as clear,
 * greppable stubs. Each stub throws a typed {@link RpcError} so the router maps
 * it to a proper JSON-RPC error instead of crashing.
 */
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import type { HandlerRouter, RpcHandler } from '../handler-router.js';

export function notImplemented(method: string): RpcError {
  return new RpcError(JsonRpcErrorCode.BridgeError, `Method not implemented yet: ${method}`, {
    reason: 'FOR-DEV: handler stubbed in the bridge skeleton increment',
  });
}

/** Register every given method as a stub that throws "not implemented". */
export function registerStubs(router: HandlerRouter, methods: readonly string[]): void {
  for (const method of methods) {
    const handler: RpcHandler = () => {
      throw notImplemented(method);
    };
    router.register(method, handler);
  }
}
