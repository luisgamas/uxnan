/**
 * Runtime validators built on Ajv. Schemas are compiled once at module load.
 *
 * Each validator returns a discriminated {@link ValidationResult} so callers can
 * narrow to the typed value or inspect the errors.
 *
 * Source: architecture/02e-bridge-integration.md §4.3.
 */
import AjvModule from 'ajv';
import type { ValidateFunction } from 'ajv';

// ajv v8 is a CommonJS package. Under `moduleResolution: nodenext` the default
// import's static type is not seen as constructable even though, at runtime, the
// default export IS the Ajv class. Re-type it to the actual constructor.
const Ajv = AjvModule as unknown as typeof import('ajv').default;
import {
  e2eeEnvelopeSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  pairingPayloadSchema,
  pushPayloadSchema,
} from './json-schema/schemas.js';
import type { JsonRpcRequest, JsonRpcResponse } from '../jsonrpc/envelope.js';
import type { SecureEnvelope } from '../e2ee/envelope.js';
import type { PairingPayload } from '../e2ee/pairing-payload.js';
import type { PushNotifyRequest } from '../notifications/push-payload.js';

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: ValidationError[] };

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const validateRequestFn = ajv.compile(jsonRpcRequestSchema);
const validateResponseFn = ajv.compile(jsonRpcResponseSchema);
const validateEnvelopeFn = ajv.compile(e2eeEnvelopeSchema);
const validatePairingFn = ajv.compile(pairingPayloadSchema);
const validatePushFn = ajv.compile(pushPayloadSchema);

function run<T>(fn: ValidateFunction, data: unknown): ValidationResult<T> {
  if (fn(data)) {
    return { valid: true, data: data as T };
  }
  const errors: ValidationError[] = (fn.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message ?? 'invalid',
  }));
  return { valid: false, errors };
}

export function validateJsonRpcRequest(data: unknown): ValidationResult<JsonRpcRequest> {
  return run<JsonRpcRequest>(validateRequestFn, data);
}

export function validateJsonRpcResponse(data: unknown): ValidationResult<JsonRpcResponse> {
  return run<JsonRpcResponse>(validateResponseFn, data);
}

export function validateE2EEnvelope(data: unknown): ValidationResult<SecureEnvelope> {
  return run<SecureEnvelope>(validateEnvelopeFn, data);
}

export function validatePairingPayloadSchema(data: unknown): ValidationResult<PairingPayload> {
  return run<PairingPayload>(validatePairingFn, data);
}

export function validatePushPayload(data: unknown): ValidationResult<PushNotifyRequest> {
  return run<PushNotifyRequest>(validatePushFn, data);
}
