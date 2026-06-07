/**
 * JSON-RPC 2.0 error codes used across the Uxnan ecosystem.
 *
 * Standard codes (-32700..-32603) plus Uxnan-specific codes (-32000..-32008).
 * Source: architecture/02b-contracts-and-requirements.md.
 */
export const JsonRpcErrorCode = {
  // Standard JSON-RPC 2.0
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Uxnan-specific
  BridgeError: -32000,
  AuthenticationRequired: -32001,
  AgentNotRunning: -32002,
  GitOperationFailed: -32003,
  WorkspaceAccessDenied: -32004,
  BridgeVersionIncompatible: -32005,
  SessionExpired: -32006,
  ConfirmationRequired: -32007,
  ResourceNotFound: -32008,
} as const;

export type JsonRpcErrorCode = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

/** Human-readable default messages for each error code. */
export const JSON_RPC_ERROR_MESSAGES: Record<JsonRpcErrorCode, string> = {
  [JsonRpcErrorCode.ParseError]: 'Parse error',
  [JsonRpcErrorCode.InvalidRequest]: 'Invalid request',
  [JsonRpcErrorCode.MethodNotFound]: 'Method not found',
  [JsonRpcErrorCode.InvalidParams]: 'Invalid params',
  [JsonRpcErrorCode.InternalError]: 'Internal error',
  [JsonRpcErrorCode.BridgeError]: 'Bridge error',
  [JsonRpcErrorCode.AuthenticationRequired]: 'Authentication required',
  [JsonRpcErrorCode.AgentNotRunning]: 'Agent not running',
  [JsonRpcErrorCode.GitOperationFailed]: 'Git operation failed',
  [JsonRpcErrorCode.WorkspaceAccessDenied]: 'Workspace access denied',
  [JsonRpcErrorCode.BridgeVersionIncompatible]: 'Bridge version incompatible',
  [JsonRpcErrorCode.SessionExpired]: 'Session expired',
  [JsonRpcErrorCode.ConfirmationRequired]: 'Confirmation required',
  [JsonRpcErrorCode.ResourceNotFound]: 'Resource not found',
};

/** Shape of the `error` member of a JSON-RPC error response. */
export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Error carrying a JSON-RPC error code, so handlers can throw a typed error
 * that the transport layer maps to a JSON-RPC error response.
 */
export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message?: string, data?: unknown) {
    const resolved = message ?? JSON_RPC_ERROR_MESSAGES[code as JsonRpcErrorCode] ?? 'Bridge error';
    super(resolved);
    this.name = 'RpcError';
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }

  toErrorObject(): JsonRpcErrorObject {
    const obj: JsonRpcErrorObject = { code: this.code, message: this.message };
    if (this.data !== undefined) {
      obj.data = this.data;
    }
    return obj;
  }

  static methodNotFound(method: string): RpcError {
    return new RpcError(JsonRpcErrorCode.MethodNotFound, `Method not found: ${method}`);
  }

  static invalidParams(detail?: string, data?: unknown): RpcError {
    const message = detail ? `Invalid params: ${detail}` : 'Invalid params';
    return new RpcError(JsonRpcErrorCode.InvalidParams, message, data);
  }
}
