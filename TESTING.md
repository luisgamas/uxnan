# Testing & validation — Uxnan bridge / relay / shared

How to run the automated tests and how to validate the parts that automated tests
on this machine can't fully cover (real-device E2EE, real agent CLIs, push).

> This guide covers the **Node** side (`shared`/`bridge`/`relay`). For the
> Flutter app see [`uxnanmobile/docs/testing.md`](uxnanmobile/docs/testing.md).

---

## 1. Automated tests

```bash
# from the repo root (builds shared → relay → bridge, then runs every suite):
npm test

# one package at a time:
npm run test -w @uxnan/shared
npm run test -w uxnan-relay
npm run test -w uxnan-bridge

# quality gates:
npm run typecheck      # tsc --noEmit across packages
npm run format:check   # prettier
```

Runner: Node's built-in `node:test` over the compiled output (`dist/test`).
Requires Node ≥18 (developed/tested on Node 24, Windows).

What's covered: JSON-RPC contracts + validators; E2EE crypto + handshake + replay;
pairing payload; relay forwarding/rate-limit/health; daemon state, identity
(keychain via a fake backend), lock file; git + workspace + checkpoints (real git
in temp repos); conversation store; the AgentManager + echo agent end-to-end; the
`ProcessAgentAdapter` against a fake CLI; and router-level wiring/error mapping.

### Environment notes / known flakes
- **Windows file locking:** a just-spawned `git` briefly holds its cwd, so test
  cleanup uses the retry helper `bridge/test/helpers/fs.ts` (`rmrf`). Use it for
  any new temp-dir cleanup.
- **Heavy parallelism:** `node:test` runs files concurrently; many parallel `git`
  processes can starve the event loop, so async-completion polls use a 10 s
  `waitFor`. If you add streaming tests, give them generous timeouts.
- **Line endings:** git tests set `core.autocrlf false` so snapshots compare
  byte-for-byte on Windows.
- **Linux keychain:** without a running Secret Service the identity store falls
  back to in-memory (see `bridge/FOR-DEV.md`).

---

## 2. Manual validation: real mobile ↔ bridge over E2EE

The automated suite proves bridge-side correctness with an independent Node
"fake phone" (`bridge/test/helpers/fake-phone.ts`) that follows the documented
byte contract. Before a release, validate against the **real** Flutter app
(`uxnanmobile` branch):

1. Build/run a relay locally: `node relay/dist/src/cli.js 8787`.
2. Point the bridge at it: set `relayUrl` to `ws://<pc-ip>:8787` in
   `~/.uxnan/daemon-config.json` (or use the official relay once deployed).
3. Start the bridge and show the QR: `node bridge/dist/src/cli.js qr` (or `start`).
4. Scan the QR with the app and confirm:
   - [ ] **Pairing/handshake** completes (the bridge logs `phone session
     established`); the app reaches the connected state.
   - [ ] **Trusted reconnect** works after disconnect (no re-scan).
   - [ ] **JSON-RPC round-trip** (e.g. the app's Git panel shows `git/status`).
   - [ ] **Streaming**: send a turn; the app receives `stream/message/delta` +
     `stream/turn/completed` (use the `echo` agent until a real CLI is wired).
   - [ ] **LAN path** (same Wi-Fi): the app connects without the relay.

### Contract checks to re-verify when either side changes
These are the byte-level contracts the fake phone encodes; re-check against the
mobile if the protocol moves:
- [ ] Handshake **transcript** encoding (`@uxnan/shared` `buildHandshakeTranscript`)
  — hex for byte fields, decimal for ints, `sessionId` raw, in the documented order.
- [ ] **HKDF salt** = raw `clientNonce || serverNonce`; info `uxnan-e2ee-v1`.
- [ ] **SecureEnvelope** wire shape: `nonce` hex, `ciphertext`/`tag` base64; phone
  `seq` 1-based; replay = reject `seq <= lastApplied`.
- [ ] **Pairing QR** = Base64 of the UTF-8 JSON (matches `PairingPayload.fromQrString`).

---

## 3. Validating agent adapters

- **Echo:** fully tested; use it for the streaming path end-to-end with no creds.
- **OpenCode (WIRED, default agent):** `bridge/src/adapters/opencode-adapter.ts`
  drives `opencode run --format json`. To run it for real:
  1. Set a working model in `~/.uxnan/daemon-config.json` → `agents.opencode.model`
     (a model your `opencode` account can actually call) and a real project dir in
     `workspaceRoots`.
  2. From the app: New conversation → pick the project + OpenCode + a model → send
     a turn; you should see streamed `stream/message/delta` + `stream/turn/completed`.
  3. Diagnose the agent directly (stdin MUST be closed or OpenCode hangs):
     `cmd /c "opencode run --format json --model <m> --dir <repo> \"hi\" < NUL"`.
  4. Tests use a fake spawn: `bridge/test/adapters/opencode-adapter.test.ts`
     (parser + delta/complete/error/session continuity).
- **Codex / Claude Code / Gemini (next):** follow the "Adding the next agent"
  recipe in `bridge/FOR-DEV.md` — capture the real CLI's JSON stream, copy the
  OpenCode adapter, override the args builder + line parser, register in
  `startBridge`, and test like the OpenCode adapter.
- The generic bridge agent IPC (newline-JSON over stdio) is documented in
  `bridge/src/adapters/process-agent-adapter.ts`.

---

## 4. Push notifications (Phase 6 — implemented, gated)

The relay + bridge + mobile push path is implemented but **gated** on Firebase/APNs
credentials. Test the logic WITHOUT devices:
- Relay: `npm run test -w uxnan-relay` covers register/notify/secret/dedupe with a
  fake `PushSender`. Live smoke (noop sender, no creds):
  `curl -X POST http://127.0.0.1:8787/push/register -d '{"sessionId":"s","pushToken":"t","platform":"android"}'`
  then `/push/notify` with the returned `notificationSecret`.
- Bridge: `bridge/test/push/push-service.test.ts` (register + turn-end notify + gating).
- Real delivery needs the user's Firebase project + native config: setup in
  `relay/FOR-HUMAN.md` and `uxnanmobile/FOR-HUMAN.md` (same project on both sides).

---

## 5. Where deferred work and limitations are tracked
- `bridge/FOR-DEV.md` — bridge code TODOs (adapters, JSONL history, checkpoint
  full-revert/GC, per-project agent, etc.).
- `relay/FOR-DEV.md` — relay routing/hardening + Phase 6 push plan.
- `relay/FOR-HUMAN.md` — Firebase/APNs setup for Phase 6.
