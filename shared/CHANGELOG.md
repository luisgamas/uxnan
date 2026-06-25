# Changelog — @uxnan/shared

All notable changes to the shared contracts package are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **`TurnList.activeTurnId?`** (`models/thread.ts`): the `turn/list` result now
  carries the turn currently in-flight for the thread (the bridge's live
  AgentManager state), when one exists. Distinct from a stored turn's
  `streaming` status — which can dangle after a bridge restart — so the phone
  uses it to re-attach its streaming view to a turn it stopped tracking while
  backgrounded (instead of treating the turn as ended). Wire-additive; older
  clients ignore it. Consumed by bridge (`turn/list` handler) and mobile
  (resync re-attach).

### Changed
- **`git/log` pagination is now an opaque offset cursor** (`models/git.ts`):
  `GitLogParams.cursor` / `GitLogResult.nextCursor` are documented as an opaque
  token (an offset over a topologically-ordered log) instead of a commit SHA —
  the bridge switched off the `<cursor>^` scheme that dropped commits across
  merge boundaries. Wire shape is unchanged (still a `string`).

### Added
- **Git commit refs + a `git/commitShow` method** (`models/git.ts`,
  `jsonrpc/methods.ts`, `jsonrpc/method-registry.ts`): `GitCommit.refs?:
  GitRef[]` carries the per-commit decoration (HEAD / local branch / remote
  branch / tag) for the history graph; a new `GitRef`/`GitRefType` model backs
  it. New `git/commitShow { cwd, sha } → GitCommitDetails` returns a commit's
  metadata (incl. `refs`), the `GitCommitFile[]` it touched (status, `oldPath`
  on renames, per-file additions/deletions, `binary`), and the full unified
  `diff` (with `diffTruncated` when capped).
- **`SendTurnOptions.accessMode`** (`agents/agent-adapter.ts`): the per-thread
  access mode is now carried into each turn so adapters can map it to their
  permission posture (Claude wired; others ignore it for now).
- **Agent session id + per-thread access mode on the wire** (`models/thread.ts`,
  `jsonrpc/methods.ts`, `jsonrpc/method-registry.ts`): `Thread.agentSessionId?`
  (the agent CLI's native session id, for "resume from the CLI"), a new
  `AccessMode` union (`requestApproval | approveForMe | fullAccess`) +
  `Thread.accessMode?`, and a `thread/setAccessMode { threadId, mode }` method
  (returns the updated `Thread`) so the per-thread approval mode persists
  server-side.
- **`turn/list` newest-first pagination** (`jsonrpc/methods.ts`,
  `models/thread.ts`): `TurnListParams.fromEnd?: boolean` (return the newest
  `limit` turns) and `TurnList.total?: number` (full turn count). Lets a client
  open a long thread at its most recent messages and page backward by computing
  offsets, instead of pulling the whole thread. Backward-compatible (both
  optional; an older client/bridge ignores them).
- **Git revert + safe branch/worktree deletion + cwd probe** (`jsonrpc/methods.ts`,
  `jsonrpc/method-registry.ts`, `models/workspace.ts`): `git/revert`
  (`GitRevertParams`), `git/deleteBranch` (`GitDeleteBranchParams`, `force`),
  `git/removeWorktree` (`GitRemoveWorktreeParams`, `force`) and `workspace/exists`
  (`WorkspaceExistsParams` → `WorkspaceExistsResult { exists, isGitRepo? }`).
  Deletion is fail-safe by default (git refuses an unmerged branch / dirty
  worktree unless `force`); the probe lets the phone detect a thread whose `cwd`
  vanished.
- **Interactive approval contracts** (`models/approval.ts`, `jsonrpc/methods.ts`,
  `agents/agent-adapter.ts`): `ApprovalDecision`
  (`approve | reject | approveSession`), `ApprovalResponse`
  (`{ approvalId, decision }`) and `ApprovalRequestBlock` (the `approval`
  content-block payload the phone renders). `TurnSendParams.approvalResponse?`
  lets the phone answer a pending approval on `turn/send` (no new turn), and
  `IAgentAdapter.respondApproval?(threadId, approvalId, decision)` routes the
  decision to the agent adapter. The request side reuses the existing
  `stream/content/block` channel (an `approval` block) — no new notification.
- **Turn image attachments** (`models/workspace.ts`, `jsonrpc/methods.ts`,
  `agents/agent-adapter.ts`): a new tolerant `TurnAttachment`
  (`{ type?, mimeType, base64Data?, path?, width?, height? }`) plus
  `TurnSendParams.attachments?` and `SendTurnOptions.attachments?` so the phone
  can ride inline images on `turn/send`. `TurnSendParams.text` is now **optional**
  (an image-only message is valid); the bridge rejects only a turn with neither
  text nor attachments. Unblocks the mobile "Attach" composer end-to-end.
- **`AgentCapabilities.reportsContextUsage`** (`agents/agent-capabilities.ts`):
  optional per-agent flag for whether the agent reports per-turn token/context
  usage (`usage` on `turn/completed`), so the phone can show a context meter at
  0 before the first turn. Optional/back-compat (absent = false). Set by the
  Claude and Codex adapters; OpenCode leaves it false.
- **Per-model run-option knobs** (`agents/agent-capabilities.ts`,
  `jsonrpc/methods.ts`, `agents/agent-adapter.ts`): a new `AgentModelOption`
  (`{ key, kind: 'enum'|'toggle', label, values?, default? }`) plus an optional
  `AgentModel.options` so `agent/models` can advertise the run-option knobs a
  model supports (today: a `reasoning` effort enum). `TurnSendParams.options`
  and `SendTurnOptions.options` (`Record<string, string|boolean>`) carry the
  user's chosen values back on `turn/send`; the bridge maps them to each CLI's
  flag. The legacy flat `effort` still works as a fallback for `reasoning`.
  Consumers must ignore unknown `kind`s (forward-compatible). Phase 2 of the
  per-model run-options seam.
- **Per-project agent/model pin fields** (`agents/agent-config.ts`,
  `models/project.ts`): `AgentConfig` gains an optional `model` (a project's
  pinned default model, alongside the existing `agentId`/`cwd`), and `Project`
  gains an optional `model` next to `agentId`. The bridge fills these from its
  `projectAgents` config so `project/list` advertises a project's pinned
  agent/model and `thread/start` can default to them when the phone omits them.
- **Thread lifecycle methods** (`jsonrpc/methods.ts`, `jsonrpc/method-registry.ts`):
  `thread/rename` (`ThreadRenameParams { threadId, title }` → `Thread`),
  `thread/archive` / `thread/unarchive` (`{ threadId }` → `Thread`) and
  `thread/delete` (`{ threadId }` → `void`). The mobile app already called these
  best-effort; they are now part of the contract so the bridge can implement them
  and the changes survive a reinstall or a second device.
- **Token usage on `turn/completed`** (`jsonrpc/notifications.ts`): new
  `TurnUsage { tokens, contextWindow? }` and optional `usage` on
  `TurnCompletedParams`, so the bridge can report a turn's context consumption
  (and the model's window when known) for the phone's context indicator.
- **`stream/model/resolved` notification** (`jsonrpc/notifications.ts`):
  `StreamNotification.ModelResolved` + `ModelResolvedParams { threadId, turnId,
  model }`. Carries the concrete model an agent resolved an alias to for a turn
  (e.g. `opus` → `claude-opus-4-8`), and a `'model_resolved'` `AgentStreamEvent`
  kind for adapters to emit it.

### Changed
- **`auth/status` is now per-agent** (`jsonrpc/methods.ts`): its params changed
  from `void` to `{ agentId }`, matching the spec's per-agent `getAuthStatus`
  (the phone queries the active project's agent). The `AuthStatus` result is
  unchanged and remains sanitized — it never carries tokens/keys.
- **`agent/models` now returns structured models** (`jsonrpc/methods.ts`,
  `agents/agent-capabilities.ts`): `AgentModelsResult.models` changed from
  `string[]` to **`AgentModel[]`** (`{ id, displayName, description?, version?,
  isDefault? }`). `id` is the routing key (Claude alias, `provider/model`, or a
  Codex model id); the rest are presentation hints. The adapter contract
  `IAgentAdapter.listModels?()` returns `AgentModel[]` accordingly. Lets the
  phone show readable names, the default model, and an alias's resolved version.
- **Pairing payload transports** (`e2ee/pairing-payload.ts` + Ajv schema): `relay`
  is now **optional** and a new optional **`hosts: string[]`** carries the bridge's
  direct `host:port` addresses (LAN + Tailscale `100.x`). Validation requires **at
  least one** transport (`relay` or `hosts`) and adds the `missing_transport` error.
  Enables LAN/Tailscale-direct pairing with no hosted relay. The mobile parser must
  tolerate a missing `relay` and prefer `hosts` (try direct → relay).

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
