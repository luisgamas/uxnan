# Changelog — @uxnan/shared

All notable changes to the shared contracts package are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Plug-and-play directory browsing contracts** (`models/workspace.ts`):
  `BrowseRoot`, `BrowseDirEntry`, `BrowseResult`, and the `workspace/browseDirs`
  method (`{ rootId?, path? }` → `BrowseResult`) added to the method registry +
  `METHOD_NAMES`. Lets the phone navigate sub-directories under a configured base
  root, see which are git repos, and pick any directory as a thread's cwd. Additive
  — existing consumers are unaffected (the mobile Dart side adds it when it builds
  the browser UI).
- Streaming notification contracts (`StreamNotification` + param types:
  turn started/delta/completed/error/aborted) in `jsonrpc/notifications.ts`.
- `'echo'` added to `AgentId` (built-in reference/dev agent).
- **Per-thread agent/project contracts**: `Thread.agentId|model|cwd`
  (`models/thread.ts`), `StartThreadParams.agentId|model|cwd` and
  `SendTurnOptions.cwd` so a thread is pinned to an agent/model/working directory.
- **Agent discovery contracts**: `AgentDescriptor` (`agents/agent-capabilities.ts`)
  plus methods `agent/list` (`AgentListResult`) and `agent/models`
  (`AgentModelsParams` → `AgentModelsResult`); `IAgentAdapter.listModels?()`
  (optional) for runtime model discovery.
- **Project resolution contracts**: methods `project/list` (`Project[]`) and
  `project/resolve` (`{ cwd } → Project`).
- **`thread/setModel`** method (`ThreadSetModelParams`) to repoint a thread's model
  mid-conversation.
- **Push registration contracts**: methods `notifications/register`
  (`RegisterNotificationsParams`), `notifications/update`
  (`UpdateNotificationsParams`) and `notifications/unregister`.

### Changed
- **Pairing QR encoding is now Base64 of the UTF-8 JSON** (was plain JSON), to
  match the mobile `PairingPayload.fromQrString` (`base64.decode` → `jsonDecode`,
  spec 02a §5.5.4). `encodePairingQr` / `parsePairingQr` updated accordingly.

### Added
- Initial `@uxnan/shared` contracts package (TypeScript, ESM, Node ≥18).
- JSON-RPC 2.0 envelope types and constructors (`makeRequest`, `makeNotification`,
  `makeResponse`, `makeErrorResponse`) plus type guards.
- JSON-RPC error codes (`JsonRpcErrorCode`) including Uxnan-specific codes
  (-32000..-32008) and the `RpcError` class.
- Typed method registry (`JsonRpcMethodRegistry`, `MethodParams`, `MethodResult`)
  and a runtime method list (`METHOD_NAMES`, `isKnownMethod`) kept in lock-step
  via a compile-time assertion.
- E2EE types: handshake messages (`clientHello`/`serverHello`/`clientAuth`/`ready`),
  the canonical transcript builder (`buildHandshakeTranscript`), the encrypted
  `SecureEnvelope`, and the v2 `PairingPayload` with validation/parse helpers.
- Protocol constants mirroring the mobile `protocol_constants.dart`.
- Domain models: thread/turn/message, git, workspace, project/auth, session/trust.
- Agent contracts: `IAgentAdapter`, `AgentCapabilities`, `AgentConfig`.
- Push payloads and runtime validators (Ajv) for requests, responses, E2EE
  envelopes, pairing payloads and push payloads.

### Notes
- JSON Schemas are authored as typed TS objects under `src/validators/json-schema/`
  (rather than standalone `.json` files as sketched in the architecture) so they
  are bundled, type-checked, and free of ESM import-attribute friction.
- The pairing QR string uses compact JSON; the exact encoding must be verified
  against the mobile `PairingPayload.fromQrString` before real pairing.
