/**
 * @uxnan/shared — JSON-RPC and E2EE contracts shared across the Uxnan
 * ecosystem (bridge, relay, and the mobile app's manually-synced Dart types).
 */

export * from './constants.js';

// JSON-RPC
export * from './jsonrpc/envelope.js';
export * from './jsonrpc/errors.js';
export * from './jsonrpc/methods.js';
export * from './jsonrpc/method-registry.js';

// E2EE
export * from './e2ee/handshake.js';
export * from './e2ee/envelope.js';
export * from './e2ee/pairing-payload.js';

// Agents
export * from './agents/agent-capabilities.js';
export * from './agents/agent-config.js';
export * from './agents/agent-adapter.js';

// Notifications
export * from './notifications/push-payload.js';

// Models
export * from './models/thread.js';
export * from './models/git.js';
export * from './models/workspace.js';
export * from './models/project.js';
export * from './models/session.js';

// Validators
export * from './validators/validate.js';
export * from './validators/json-schema/schemas.js';
