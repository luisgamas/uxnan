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
export * from './jsonrpc/notifications.js';

// E2EE
export * from './e2ee/handshake.js';
export * from './e2ee/envelope.js';
export * from './e2ee/pairing-payload.js';

// Agents
export * from './agents/agent-capabilities.js';
export * from './agents/agent-config.js';
export * from './agents/agent-adapter.js';
export * from './agents/agent-locations.js';
export * from './agents/one-shot.js';

// Local control channel (desktop ↔ bridge on the same machine)
export * from './local-control/local-control.js';

// Relay (the user's own relay: control frames before the blind pipe)
export * from './relay/protocol.js';

// Version
export * from './version/compare.js';

// Notifications
export * from './notifications/push-payload.js';

// Models
export * from './models/thread.js';
export * from './models/git.js';
export * from './models/workspace.js';
export * from './models/project.js';
export * from './models/sync.js';
export * from './models/session.js';
export * from './models/approval.js';
export * from './models/question.js';
export * from './models/compaction.js';
export * from './models/assistant-response.js';
export * from './models/tool.js';
export * from './models/usage.js';
export * from './models/metrics.js';
export * from './models/agent-session.js';
export * from './models/relay.js';
export * from './models/view.js';

// Agent views: the page <-> host protocol
export * from './views/view-protocol.js';

// Validators
export * from './validators/validate.js';
export * from './validators/json-schema/schemas.js';
