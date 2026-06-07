# Testing & validation — Uxnan bridge / relay / shared

How to run the automated tests and how to validate the parts that automated tests
on this machine can't fully cover (real-device E2EE, real agent CLIs, push).

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

- **Echo (now):** fully tested; use it for the streaming path end-to-end.
- **Codex / OpenCode (Phase 5b):** scaffolded but NOT wired — their real CLI
  stream formats are not in the architecture docs. To implement + validate:
  1. Run the real CLI by hand and capture its streamed output for one turn.
  2. In the adapter (`bridge/src/adapters/{codex,opencode}-adapter.ts`) override
     `formatTurn` (how to send a prompt) and `parseLine` (map each output line to
     `started`/`delta`/`completed`/`error`).
  3. Register it in `startBridge` and set the project's agent.
  4. Test it the same way `ProcessAgentAdapter` is tested
     (`bridge/test/adapters/process-agent-adapter.test.ts`): spawn the real (or a
     recorded fake) CLI, send a turn, assert the mapped events; then an
     end-to-end `turn/send` like `bridge/test/handlers/thread-handlers.test.ts`.
- The generic bridge agent IPC (newline-JSON over stdio) is documented in
  `bridge/src/adapters/process-agent-adapter.ts`.

---

## 4. Push notifications (Phase 6)

Not implemented yet. Setup + how to test without devices: `relay/FOR-HUMAN.md`.
Implementation plan + the testable `PushSender` seam: `relay/FOR-DEV.md`.

---

## 5. Where deferred work and limitations are tracked
- `bridge/FOR-DEV.md` — bridge code TODOs (adapters, JSONL history, checkpoint
  full-revert/GC, per-project agent, etc.).
- `relay/FOR-DEV.md` — relay routing/hardening + Phase 6 push plan.
- `relay/FOR-HUMAN.md` — Firebase/APNs setup for Phase 6.
- `ROADMAP.md` — phase status overview.
