/**
 * JSON Schemas (draft-07) for runtime validation of messages at system
 * boundaries. Authored as typed TS objects (instead of standalone `.json`
 * files) so they are bundled, type-checked and import-attribute free.
 *
 * Source: architecture/02b-contracts-and-requirements.md §5 (validation).
 */
import type { SchemaObject } from 'ajv';
import { JSONRPC_VERSION, PAIRING_QR_VERSION } from '../../constants.js';

export const jsonRpcRequestSchema: SchemaObject = {
  $id: 'uxnan:jsonrpc-request',
  type: 'object',
  required: ['jsonrpc', 'id', 'method'],
  properties: {
    jsonrpc: { const: JSONRPC_VERSION },
    id: { type: ['string', 'integer'] },
    method: { type: 'string', minLength: 1 },
    params: { type: ['object', 'array'] },
  },
  additionalProperties: false,
};

export const jsonRpcResponseSchema: SchemaObject = {
  $id: 'uxnan:jsonrpc-response',
  type: 'object',
  required: ['jsonrpc', 'id'],
  properties: {
    jsonrpc: { const: JSONRPC_VERSION },
    id: { type: ['string', 'integer', 'null'] },
    result: {},
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'integer' },
        message: { type: 'string' },
        data: {},
      },
      additionalProperties: false,
    },
  },
  oneOf: [{ required: ['result'] }, { required: ['error'] }],
  additionalProperties: false,
};

export const e2eeEnvelopeSchema: SchemaObject = {
  $id: 'uxnan:e2ee-envelope',
  type: 'object',
  required: ['kind', 'sessionId', 'seq', 'nonce', 'ciphertext', 'tag'],
  properties: {
    kind: { const: 'encryptedEnvelope' },
    sessionId: { type: 'string', minLength: 1 },
    seq: { type: 'integer', minimum: 0 },
    nonce: { type: 'string', minLength: 1 },
    ciphertext: { type: 'string' },
    tag: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

export const pairingPayloadSchema: SchemaObject = {
  $id: 'uxnan:pairing-payload',
  type: 'object',
  required: [
    'v',
    'relay',
    'sessionId',
    'macDeviceId',
    'macIdentityPublicKey',
    'expiresAt',
    'displayName',
  ],
  properties: {
    v: { const: PAIRING_QR_VERSION },
    relay: { type: 'string', minLength: 1 },
    sessionId: { type: 'string', minLength: 1 },
    macDeviceId: { type: 'string', minLength: 1 },
    macIdentityPublicKey: { type: 'string', minLength: 1 },
    expiresAt: { type: 'integer' },
    displayName: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

export const pushPayloadSchema: SchemaObject = {
  $id: 'uxnan:push-payload',
  type: 'object',
  required: ['sessionId', 'notificationSecret', 'threadId', 'turnId', 'title', 'body'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    notificationSecret: { type: 'string', minLength: 1 },
    threadId: { type: 'string', minLength: 1 },
    turnId: { type: 'string', minLength: 1 },
    title: { type: 'string' },
    body: { type: 'string' },
  },
  additionalProperties: false,
};
