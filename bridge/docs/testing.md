# Bridge — testing & validation

How to run the automated tests and validate the parts they can't fully cover on a
dev machine (real-device E2EE, real agent CLIs, push). Relay-specific testing is in
[`../../relay/docs/testing.md`](../../relay/docs/testing.md).

## 1. Automated tests

```bash
# repo root — builds shared → relay → bridge, then runs every suite:
npm test

# one package at a time:
npm run test -w @uxnan/shared
npm run test -w uxnan-relay
npm run test -w uxnan-bridge

# quality gates:
npm run typecheck      # tsc --noEmit across packages
npm run format:check   # prettier
```

Runner: Node's built-in `node:test` over the compiled output (`dist/test`), with
**`--test-concurrency=1`** (serialized — see flakes below). Requires Node ≥ 18
(developed/tested on Node 24, Windows).

Covered: JSON-RPC contracts + validators; E2EE crypto/handshake/replay; pairing
payload; relay forwarding/rate-limit/health; daemon state, identity (keychain via a
fake backend), lock file; the **autostart** plan per platform; git + workspace +
**directory browsing** + checkpoints (real git in temp repos); conversation store;
the AgentManager + echo agent end-to-end; the OpenCode/Claude Code/Codex adapter
parsers + streaming against fake spawns; and router-level wiring/error mapping.

### Environment notes / known flakes (Windows)
- **Serialized runner:** several suites boot a full bridge or spawn real child
  processes (git, fake agents); running them in parallel starved the conversation
  tests' `waitFor` polling, so `npm test` uses `--test-concurrency=1` and the
  `waitFor` guards are 30 s. Keep new boot/spawn-heavy tests tolerant.
- **File locking:** a just-spawned `git` briefly holds its cwd; temp cleanup uses
  the retry helper `test/helpers/fs.ts` (`rmrf`). Use it for new temp-dir cleanup.
- **Line endings:** git tests set `core.autocrlf false` so snapshots compare
  byte-for-byte; the repo itself is `autocrlf=true`, so the Prettier gate is
  effectively content-only (CRLF in the working tree is normalized to LF on commit).
- **Linux keychain:** without a running Secret Service the identity store falls
  back to in-memory (see [`../FOR-DEV.md`](../FOR-DEV.md)).

## 2. Manual validation: real mobile ↔ bridge over E2EE

The suite proves bridge-side correctness with an independent Node "fake phone"
(`test/helpers/fake-phone.ts`) that follows the documented byte contract. Before a
release, validate against the real Flutter app (`uxnanmobile` branch):

1. Run a relay locally: `node relay/dist/src/cli.js 8787`.
2. Point the bridge at it: `relayUrl: "ws://<pc-ip>:8787"` in
   `~/.uxnan/daemon-config.json` (or use the deployed relay).
3. Start the bridge + show the QR: `node bridge/dist/src/cli.js qr` (or `start`).
4. Scan with the app and confirm: pairing/handshake completes; trusted reconnect
   works without re-scan; a JSON-RPC round-trip (Git panel → `git/status`);
   streaming (`stream/message/delta` + `stream/turn/completed`, using the `echo`
   agent until a real CLI is configured); and the LAN path (same Wi-Fi, no relay).

### Byte contracts to re-check if either side changes
Handshake transcript encoding (`buildHandshakeTranscript` — hex for byte fields,
decimal for ints, `sessionId` raw, in order); HKDF salt = raw
`clientNonce || serverNonce`, info `uxnan-e2ee-v1`; `SecureEnvelope` (`nonce` hex,
`ciphertext`/`tag` base64; phone `seq` 1-based; replay = reject `seq <= lastApplied`);
pairing QR = Base64 of the UTF-8 JSON.

## 3. Validating agent adapters

- **Echo:** fully tested; use it for the streaming path with no creds.
- **OpenCode / Claude Code / Codex (wired):** see [`agents.md`](./agents.md) for how
  each is driven. To run for real, set a working `model` (and `permissionMode`) in
  `agents.<id>` + a real project dir, then drive a turn from the app and watch the
  streamed deltas. Capture a CLI stream directly with stdin closed, e.g.
  `cmd /c "<cli> ... < NUL"` (these CLIs hang on an open stdin pipe). Adapter unit
  tests live in `test/adapters/`.
- **Next (Gemini):** follow the recipe in [`../FOR-DEV.md`](../FOR-DEV.md).

## 4. Push notifications (implemented, gated)

The push path is implemented but gated on Firebase/APNs creds. Test the logic
without devices: bridge `test/push/push-service.test.ts` (register + turn-end notify
+ gating); relay side + live smoke in
[`../../relay/docs/testing.md`](../../relay/docs/testing.md). Real delivery needs the
user's Firebase project — setup in `relay/FOR-HUMAN.md` and `uxnanmobile/FOR-HUMAN.md`.
