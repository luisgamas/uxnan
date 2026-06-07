/**
 * Small validators for untrusted JSON-RPC params. They throw a typed
 * {@link RpcError} (-32602) the router maps to a proper error response.
 */
import { RpcError } from '@uxnan/shared';

export function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw RpcError.invalidParams('params must be an object');
  }
  return params as Record<string, unknown>;
}

export function requireString(params: unknown, key: string): string {
  const value = asObject(params)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw RpcError.invalidParams(`expected non-empty string '${key}'`);
  }
  return value;
}

export function optionalString(params: unknown, key: string): string | undefined {
  const value = asObject(params)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw RpcError.invalidParams(`'${key}' must be a string`);
  }
  return value;
}

export function optionalBoolean(params: unknown, key: string): boolean | undefined {
  const value = asObject(params)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw RpcError.invalidParams(`'${key}' must be a boolean`);
  }
  return value;
}

export function optionalNumber(params: unknown, key: string): number | undefined {
  const value = asObject(params)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw RpcError.invalidParams(`'${key}' must be a number`);
  }
  return value;
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A string safe to pass as a git argument or a path: non-empty, no leading dash
 * (option injection) and no control characters. Spaces are allowed (paths).
 */
export function requireSafe(params: unknown, key: string): string {
  const value = requireString(params, key);
  if (value.startsWith('-') || hasControlChars(value)) {
    throw RpcError.invalidParams(`invalid '${key}'`);
  }
  return value;
}

export function requireArray(params: unknown, key: string): unknown[] {
  const value = asObject(params)[key];
  if (!Array.isArray(value)) {
    throw RpcError.invalidParams(`expected array '${key}'`);
  }
  return value;
}
