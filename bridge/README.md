# uxnan-bridge

Local control-plane daemon that connects the Uxnan mobile app to the developer's
PC over an end-to-end-encrypted channel. It runs Git, reads the workspace, and
drives AI coding agents on behalf of the phone, routing JSON-RPC methods to
per-domain handlers.

> **Status: ALPHA-FUNCTIONAL on the primary path (LAN/Tailscale-direct, bridge-
> direct push).** The bridge is the **heart of the product** — the product is
> bridge-first: the mobile app pairs with the bridge and tries direct LAN/
> Tailscale addresses first; the relay is an optional, self-hosted off-LAN
> fallback. Background push is sent **by the bridge** (FCM HTTP v1) over any
> transport, so the phone keeps getting notifications whether the bridge is
> reached via direct LAN, Tailscale, or relay.
>
> **DONE:**
> - **E2EE transport** (relay `mac` client + direct-LAN `http+ws` server,
>   handshake, AES-256-GCM channel, byte-for-byte compatible with the mobile
>   app; background reconnect loop; stable pairing session; mDNS discovery
>   `_uxnan._tcp.local`; manual-code pairing `GET /pair/resolve?code=`).
> - **OS-keychain identity persistence** + single-instance lock.
> - **Real Git + Workspace handlers** (path-traversal-safe, working-tree
>   checkpoints with **true restore** + retention pruning, `git/revert`,
>   `git/deleteBranch`, `git/removeWorktree`, `workspace/exists`,
>   `workspace/browseDirs`).
> - **Conversation engine** (threads/turns + streaming, per-thread
>   `Message.blocks`/`Message.thinking`/`Message.usage`).
> - **5 real agents wired:** OpenCode (default), Claude Code, Codex, pi, and
>   **Gemini CLI**. Each spawns its **official local CLI** over stdio with
>   `shell:false`, parses the native stream, and emits structured
>   `stream/content/block` events (command / diff / tool) plus
>   `stream/thinking/delta` (reasoning). **Aider** is the only remaining
>   agent (recipe in [`FOR-DEV.md`](FOR-DEV.md)).
> - **Per-thread agent/project selection** + per-project agent/model pins
>   (`projectAgents` config); per-model run-option knobs advertised on
>   `agent/models`; per-turn token usage on `stream/turn/completed`.
> - **Full thread lifecycle** (`thread/rename|archive|unarchive|delete`).
> - **Plug-and-play folder browsing** (`workspace/browseDirs`) with
>   `browseRoots` config.
> - **Direct FCM push from the bridge** (primary path, persisted across
>   restarts, per-phone target, prune-on-untrust). `firebase-admin` is an
>   `optionalDependency` — no creds = silent no-op, foreground local
>   notifications still work.
> - **Sanitized per-agent `auth/status`** (never tokens, login detected by
>   auth-file existence only).
> - **Interactive approval intake** (Echo demo + Claude Code opt-in
>   `PreToolUse` hook + Codex via the `codex app-server` turn protocol
>   — `applyPatchApproval` / `execCommandApproval` elicitations routed
>   through the same `requestApproval` round-trip; all validated
>   end-to-end).
> - **Image attachments** (CLI-agnostic file-path, sandbox-safe).
> - **On-disk `turn/list` history fallback** for Claude/Codex/OpenCode/pi/Gemini
>   JSONL/JSON stores.
> - **Bridge control:** `bridge/status` (real `relayConnected`),
>   `bridge/removeTrustedDevice` (revokes + drops session + prunes push
>   registration), `bridge/trustedDevices`, `bridge/connectedPhones`,
>   `bridge/generatePairingQr`.
> - **Autostart** (`install-service`/`uninstall-service` per platform,
>   never elevated), file logging with secret redaction, CLI
>   (`start`/`stop`/`status`/`qr`/`code`/`install-service`).
>
> **PENDING that matters for a public release (not LAN alpha):** Aider
> adapter, packaging + `npm publish` (pin `@uxnan/shared`), real-device push
> validation. **Optional / blocked-on-mobile:** seq catch-up + key rotation
> (await a mobile trigger), desktop embedded IPC (desktop Phase 6), Aider in
> the history reader (no per-session log shipped), log size-rotation. See
> [`FOR-DEV.md`](./FOR-DEV.md).
>
> **How the bridge talks to agents:** it spawns each agent's **official local
> CLI** (`opencode`, `claude`, `codex`, `pi`, `gemini`) as a child process
> and drives it over stdio — exactly as you would in a terminal. It does
> **not** use any provider HTTP API, API key, or language SDK; each CLI runs
> under the account/subscription you already authenticated it with. Prompts
> are passed as argv elements with `shell:false` (no shell injection). See
> [`FOR-HUMAN.md`](./FOR-HUMAN.md) for the per-agent install/login
> prerequisites.

## Docs

Detailed docs live in [`docs/`](./docs/):
[installation & autostart](./docs/installation.md) ·
[configuration](./docs/configuration.md) ·
[connectivity (LAN/Tailscale/relay)](./docs/connectivity.md) ·
[how agents are driven](./docs/agents.md) ·
[testing](./docs/testing.md) ·
[packaging & deploy](./docs/deploy.md) ·
[push notifications](./docs/push-notifications.md).

## Install (later, as a global package)

```bash
npm install -g uxnan-bridge
```

## CLI

```bash
uxnan-bridge start            # start the daemon: LAN server + (optional) relay pairing session
uxnan-bridge status           # print current status as JSON
uxnan-bridge qr               # print the pairing QR in the terminal (with the manual code)
uxnan-bridge code             # print just the current pairing code
uxnan-bridge stop             # stop the running daemon (via the lock file)
uxnan-bridge install-service  # autostart at logon (Task Scheduler / LaunchAgent / systemd --user)
uxnan-bridge uninstall-service
```

Logs are written to `~/.uxnan/logs/bridge-YYYY-MM-DD.log` (daily rotation, with a
secret-redaction pass) and to stderr. Autostart at login is configured by the
platform scripts under `scripts/`.

The Ed25519 identity is stored in the OS keychain (Windows Credential Manager /
macOS Keychain / Linux Secret Service) via `@napi-rs/keyring`. If no keychain
is available the bridge still runs with an in-memory identity (not persisted
across restarts).

## Architecture

- **Contracts:** consumes [`@uxnan/shared`](../shared) for JSON-RPC and E2EE
  types and runtime validators. The bridge exposes **60 JSON-RPC methods +
  8 streaming notifications** (see `shared/src/jsonrpc/`). The mobile app
  keeps manually-synced Dart equivalents of the same shapes.
- **State:** non-secret JSON under `~/.uxnan/` (atomic writes): `daemon-config.json`,
  `pairing-session.json`, `threads.json`, `trusted-phones.json`,
  `push-state.json`, `agent-cache/`, `logs/`. The Ed25519 identity is a
  secret and is kept in a `SecretStore`, never written in plaintext.
- **Routing:** `HandlerRouter.dispatchRaw()` validates the envelope and
  routes to registered handlers; errors map to JSON-RPC error codes
  (`-32000..-32008` + standard).
- **Agents:** `IAgentAdapter` per agent (OpenCode / Claude Code / Codex /
  pi / Gemini CLI); `AgentManager` orchestrates streaming and broadcasts
  `stream/*` notifications to connected phones.
- **Push:** `PushService` (persisted by relay `sessionId`) delivers FCM
  HTTP v1 directly via `createBridgePushSender` (lazy `firebase-admin`),
  with the relay `/push/notify` as a fallback.

See `architecture/02a-system-architecture.md` §5.8 and
`uxnandesktop/architecture/02e-bridge-integration.md`.

## Develop

```bash
# from the repo root (workspaces):
npm run build      # build @uxnan/shared then uxnan-bridge
npm test           # build + run all node:test suites (357 bridge + 29 shared + 27 relay)
npm run typecheck  # tsc --noEmit across packages
npm run format     # prettier --write
```

Requires Node ≥18. ESM-only. Test runner uses `--test-concurrency=1` on
Windows (see CHANGELOG for why).
