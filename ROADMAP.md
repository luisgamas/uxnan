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

### 🔜 Phase 2b — carry-over  *(next)*
- Outbound buffer + catch-up on trusted reconnect (resend envelopes with
  `seq > resumeState.lastAppliedBridgeOutboundSeq`; caps in `@uxnan/shared`).
- Key rotation / `keyEpoch` advance; bridge → phone notifications (push of
  streamed agent events).

---

## ⏳ Phase 3 — Identity persistence + pairing hardening
- OS-keychain-backed `SecretStore` (Windows Credential Manager / macOS Keychain /
  libsecret) so the bridge identity survives restarts (**required before real
  pairing**).
- Verify the pairing QR encoding against the mobile `PairingPayload.fromQrString`.
- Daemon process manager: lock file (`bridge.lock`) + `stop` via IPC.
- Relay hardening: rate limiting, pairing-code resolution, multi-session `mac`.

## ⏳ Phase 4 — Git + workspace handlers
- Real `git/*` via `child_process`; `workspace/*` with path-traversal protection,
  checkpoints and patch application.

## ⏳ Phase 5 — Agent adapters
- Codex and OpenCode (MVP), with streaming → `AgentStreamEvent`, JSONL history
  fallback; then Claude Code, Gemini CLI, pi-agent, Aider.

## ⏳ Phase 6 — Push notifications
- Relay `/push/*` (APNs/FCM, dedupe); bridge completion tracking + dedupe.
- Add `notifications/*` and `desktop/*` methods to `@uxnan/shared`.

## ⏳ Phase 7 — Ops & packaging
- Autostart scripts (`install-service-*`), file logging with rotation + redaction,
  npm packaging for `npm install -g uxnan-bridge`.

---

> Per-item detail and code locations live in [`bridge/FOR-DEV.md`](./bridge/FOR-DEV.md).
> Each component's `CHANGELOG.md` records what shipped under `[Unreleased]`.
