# Changelog — @uxnan/shared

All notable changes to the shared contracts package are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — `grok` in the `AgentId` union
- **`AgentId`** (`src/agents/agent-capabilities.ts`) gains **`'grok'`** — xAI's
  coding CLI, driven by the bridge over the Agent Client Protocol (`grok agent
  stdio`). Additive change; no other contract shape changes (the per-agent config,
  capabilities, model and auth contracts are already keyed generically by
  `AgentId`). Consumers that don't recognize the id degrade gracefully (the mobile
  app maps unknown wire ids to `custom`).

## [0.0.4-alpha.20260703] - 2026-07-03

### Changed — npm releases publish to the `latest` dist-tag
- `release-npm.yml` now publishes to **`latest`** (was `alpha`) and pins
  `@uxnan/shared` for bridge/relay via `dist-tags.latest`, so `npm install`
  resolves the newest release. `alpha`/`beta` are opt-in, added manually. A
  one-time manual `npm dist-tag add` is needed to move the already-published
  packages' `latest` forward — see `VERSIONS.md`.

### Added — version-compare util + `BridgeStatus` update fields
- **`compareVersions(a, b)` / `isNewerVersion(candidate, current)`**
  (`src/version/compare.ts`): dependency-free SemVer 2.0.0 precedence
  comparison (date-stamped `-alpha.YYYYMMDD` prereleases ordered numerically,
  `+build` metadata ignored, unparseable inputs sort lowest). Lets the bridge
  decide "is the published version newer than mine?" without a `semver`
  dependency. Exported from the package root; 7 new tests (`test/version.test.ts`).
- **`BridgeStatus.latestVersion?: string` + `BridgeStatus.updateAvailable?: boolean`**
  (`src/models/session.ts`): the bridge's own background npm update check reports
  the latest published version and whether it is strictly newer than the running
  one, so the phone can surface a "bridge update available" hint **without
  querying npm itself**. Backward-compatible optional fields (absent when the
  check hasn't run or is offline). Reflected in `architecture/02b`
  (`BridgeStatus` contract + `bridge/status` result).

## [0.0.3-alpha.20260702] - 2026-07-02

### Added — `AgentModel.isLatestAlias` (flags moving-target "latest" aliases)
- **`AgentModel.isLatestAlias?: boolean`** (`src/agents/agent-capabilities.ts`):
  a presentation-only flag marking a moving-target "latest" alias — Claude
  Code's `opus`/`sonnet`/`haiku`, each of which always routes to the newest
  version of its tier (the resolved concrete id is on `version`). Concrete /
  pinned models leave it absent. Lets a client (the mobile app) offer to hide
  the aliases and show only exact pinned versions **without hardcoding ids**.
  Backward-compatible optional field; consumers tolerate it being absent.
  Reflected in `architecture/02b` (`AgentModel` contract + the `agent/models`
  field list).

## [0.0.2-alpha.20260628] - 2026-06-28

### Added — `workspace/searchFiles` (repo-wide fuzzy file search)
- **New JSON-RPC method `workspace/searchFiles`** (`SearchFilesParams` →
  `WorkspaceSearchResult` with `WorkspaceMatch[]` + `truncated`) — a fuzzy file
  search across the whole repository that honors `.gitignore` (and excludes
  `.git` + sensitive files, like `workspace/list`). Backs the mobile composer's
  `@`-mention picker; reusable for a future file-browser search. Added to
  `methods.ts`, `models/workspace.ts` and `METHOD_NAMES` (now **61**). See
  `architecture/02a` (workspace §) and `02b` (method list).

## [0.0.1-alpha.20260627] - 2026-06-27

### Added
- **`Message.segments?`** (`models/thread.ts`): the `turn/list` assistant
  message now carries its text runs and structured blocks **in the order the
  agent produced them** (each entry a serialized `MessageContent`; text runs as
  `{ type:'text', text }`). When present, a client renders from this so the work
  log sits inline with the response instead of all activity collapsing above one
  merged paragraph — fixing recovered conversations after a reconnect. `content`
  (the full concatenated text) and `blocks` are retained for older clients and
  for re-sync reconciliation (the segment text runs concatenate to `content`;
  the non-text segments are exactly `blocks`). Wire-additive and emitted only
  when a structured block is present; older clients ignore it and fall back to
  `content` + `blocks`. Produced by the bridge (`thread-store.ts`), consumed by
  mobile (`turn/list` resync + live re-attach).
- **`WorkspaceEntry.ignored?`** (`models/workspace.ts`): optional boolean on
  `workspace/list` entries marking the ones git ignores (a `.gitignore` /
  exclude match), computed by the bridge per-listing via `git check-ignore`.
  Lets the mobile file browser *dim* ignored entries (muted + italic) apart from
  tracked/untracked files. Deliberately **not** a `GitFileStatus` — ignored
  entries never appear in `git/status`, so the flag rides on the listing.
  Backwards-compatible (new optional field, no method change); consumed by the
  bridge (`workspace/list`) and mobile (file browser). Mirrors the desktop ADE's
  own file-tree dimming (its `FsEntry.ignored`, a desktop-local type).
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
- **`WorkspaceEntry.mtime`** (`models/workspace.ts`): optional last-modified
  time as epoch milliseconds on `workspace/list` entries (files only; absent for
  directories / unreadable entries), so the mobile file browser can show a
  "modified" timestamp on each file. The bridge fills it from the same `stat` it
  already runs for `size`. Backwards-compatible — a new optional field, no method
  added, no wire break.
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
