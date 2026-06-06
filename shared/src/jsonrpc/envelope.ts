/**
 * JSON-RPC 2.0 message envelope types and constructors.
 *
 * Source: architecture/02b-contracts-and-requirements.md (envelope format).
 */
import { JSONRPC_VERSION } from '../constants.js';
import type { JsonRpcErrorObject } from './errors.js';

export type JsonRpcId = string | number;

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: P;
}

export interface JsonRpcSuccessResponse<R = unknown> {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  /** `null` when the request id could not be determined (e.g. parse error). */
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccessResponse<R> | JsonRpcErrorResponse;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function makeRequest<P>(id: JsonRpcId, method: string, params?: P): JsonRpcRequest<P> {
  const msg: JsonRpcRequest<P> = { jsonrpc: JSONRPC_VERSION, id, method };
  if (params !== undefined) {
    msg.params = params;
  }
  return msg;
}

export function makeNotification<P>(method: string, params?: P): JsonRpcNotification<P> {
  const msg: JsonRpcNotification<P> = { jsonrpc: JSONRPC_VERSION, method };
  if (params !== undefined) {
    msg.params = params;
  }
  return msg;
}

export function makeResponse<R>(id: JsonRpcId, result: R): JsonRpcSuccessResponse<R> {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function makeErrorResponse(
  id: JsonRpcId | null,
  error: JsonRpcErrorObject,
): JsonRpcErrorResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg && msg.id !== undefined;
}

export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

export function isJsonRpcResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'result' in msg || 'error' in msg;
}
