# Uxnan Bridge / Relay / Shared — Implementation Roadmap

Status of the Node.js side of the ecosystem (`shared/`, `bridge/`, `relay/`),
built on the `uxnanbridge` branch. Mobile (`uxnanmobile`) and desktop
(`uxnandesktop`) tracks are separate.

Legend: ✅ done · 🔜 next · ⏳ planned

---

## ✅ Phase 1 — Contracts + bridge skeleton
**Delivered.** 47 `node:test` tests, `tsc --noEmit` and Prettier clean.

- `@uxnan/shared`: JSON-RPC envelopes/errors, typed method registry, E2EE
  handshake types + canonical transcript builder, `SecureEnvelope`,
  `PairingPayload` v2, domain models, agent contracts, push payloads, Ajv
  validators.
- `uxnan-bridge`: daemon state (`~/.uxnan`, atomic writes), Ed25519 identity via
  a `SecretStore` (in-memory), JSON-RPC `HandlerRouter`, real bridge-control
  handlers, stub domain handlers, pairing-QR generation, agent-adapter base +
  Codex/OpenCode stubs, CLI (`start/status/qr/stop/install-service`).
- Tooling: npm workspaces, TypeScript (ESM, Node ≥18), `node:test`, Prettier.

---

## ✅ Phase 2 — Live E2EE transport + relay
**Delivered** (one item carried to Phase 2b). 61 tests across the workspaces.

- `bridge/src/transport/` — bridge-side handshake (clientHello→serverHello→
  clientAuth→ready), session-key derivation (X25519 + HKDF-SHA256), AES-256-GCM
  envelopes with `seq`/replay protection. **Interoperates byte-for-byte with the
  mobile implementation** (verified by an independent Node "phone" in tests).
- `relay-client.ts` (mac) + `lan-server.ts` over `ws`, both adapted via a shared
  `MessageIO`; decrypted payloads pumped through `router.dispatchRaw`.
- Trusted-phone persistence (`trusted-phones.json`) for pairing + reconnect.
- `relay/` package: forwards opaque E2EE envelopes by `sessionId` + `/health`;
  added to the root workspaces.
- Tests: in-memory two-party handshake, real-WebSocket LAN exchange, full
  phone ↔ relay ↔ bridge end-to-end, crypto + replay round-trips, relay routing.

### ✅ Phase 2b — bridge → phone notifications + outbound buffer
- `SessionRegistry` + `bridge.notify()`: push JSON-RPC notifications to a
  connected phone over the established channel.
- `OutboundMessageBuffer` (spec caps): buffer messages sent while a device is
  offline; flush on (re)connect.

> **Deferred (needs mobile support):** the seq-based catch-up of §5.9.2 — where
> the phone sends `resumeState.lastAppliedBridgeOutboundSeq` in `clientHello` and
> the bridge replays envelopes with a greater `seq` — is **not** built yet: the
> mobile `clientHello` does not send `resumeState` today, so implementing the
> bridge half would be speculative. Revisit when the mobile side adds it.
> Key rotation / `keyEpoch` advance is likewise deferred (no mobile trigger yet).

---

## ✅ Phase 3 — Identity persistence + pairing hardening
- OS-keychain `SecretStore` (`@napi-rs/keyring`: Credential Manager / Keychain /
  Secret Service) with graceful in-memory fallback — identity survives restarts.
- Pairing QR encoding verified + fixed to match the mobile `fromQrString`
  (Base64 JSON) in `@uxnan/shared`.
- Single-instance lock (`bridge.lock`) + `stop` via SIGTERM.
- Relay per-IP rate limiting (HTTP + upgrades).

> **Deferred to a later phase (needs protocol/mobile coordination):** relay
> pairing-code resolution (`/trusted-session/resolve`) and multi-session `mac`
> registration. On Linux the keychain needs a running Secret Service (libsecret /
> D-Bus); headless boxes fall back to the in-memory store.

## ✅ Phase 4 — Git + workspace handlers
- Real `git/*` via `child_process` (status, diff, commit, push, pull, checkout,
  createBranch, createWorktree) — failures → `-32003`.
- `workspace/*` reads + listing + `applyPatch`, confined to the project root with
  path-traversal → `-32004`, `.git`/sensitive files excluded, relative paths only.
- Boundary param validation (option-injection safe).

### ✅ Phase 4b — workspace checkpoints
- `workspace/checkpoint` / `diffCheckpoint` / `applyCheckpoint`: full-tree
  snapshots (tracked + untracked) via a temp git index + `commit-tree`, anchored
  in `refs/uxnan/checkpoints/<id>`, metadata in `~/.uxnan/checkpoints.json`.

> **Known limitations (see bridge/FOR-DEV.md):** `apply` restores file contents
> but does not remove files created after the checkpoint; checkpoints are not yet
> garbage-collected/pruned.

## ✅ Phase 5 — Conversation engine + agent adapters
- Persistent `ThreadStore`, real `thread/*` + `turn/*` handlers, `AgentManager`
  (turn routing + persistence + `stream/*` notifications), a `ProcessAgentAdapter`
  CLI-driver framework, and a working `EchoAgentAdapter` reference agent.

> **Deferred — Phase 5b (needs the real CLI contracts, not in the spec):**
> - Codex / OpenCode concrete adapters: translate the real CLI invocation +
>   streaming output into the bridge agent IPC (override `formatTurn`/`parseLine`),
>   then register them in `startBridge`. Currently scaffolded but not wired.
> - JSONL session-history fallback (`session-jsonl-history`) per agent.
> - Per-project/thread agent selection from the project's `AgentConfig`
>   (today a single `defaultAgent: 'echo'`).
> - Then: Claude Code, Gemini CLI, pi-agent, Aider.

## ⏳ Phase 6 — Push notifications
- Relay `/push/*` (APNs/FCM, dedupe); bridge completion tracking + dedupe.
- Add `notifications/*` and `desktop/*` methods to `@uxnan/shared`.
- **Setup (human):** [`relay/FOR-HUMAN.md`](./relay/FOR-HUMAN.md) — Firebase/APNs.
- **Plan + tests:** [`relay/FOR-DEV.md`](./relay/FOR-DEV.md).

## ✅ Phase 7 — Ops & packaging
- File logging with daily rotation + secret redaction (`createFileLogger`).
- Real autostart scripts (Task Scheduler / LaunchAgent / systemd user unit).
- npm packaging metadata (`repository`, `prepublishOnly`); publish checklist in
  `bridge/FOR-DEV.md` (publish `@uxnan/shared` first; pin the `*` deps).

> **Follow-ups (bridge/FOR-DEV.md):** size-based log rotation + retention; have the
> `install-service` CLI run the right script per platform; verify a packed
> `npm install -g` end-to-end.

---

> **Testing & validation guide:** [`TESTING.md`](./TESTING.md) — how to run the
> suites and how to validate the parts automated tests can't (real-device E2EE,
> real agent CLIs, push).

> Per-item detail and code locations live in [`bridge/FOR-DEV.md`](./bridge/FOR-DEV.md).
> Each component's `CHANGELOG.md` records what shipped under `[Unreleased]`.
