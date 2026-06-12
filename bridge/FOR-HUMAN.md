# FOR-HUMAN — uxnan-bridge

Assets only a human can provide (credentials, signing keys, binaries). The bridge
must always build and run without them.

## Open items

_The bridge's own identity needs no secrets_ — its Ed25519 key is generated and
stored in the OS keychain at runtime (no key files to provide).

### ◑ Push credentials — Firebase service account (for the bridge to send push)

DIRECTION (2026-06-12): background push is moving to be sent **by the bridge**
directly (so it works on any transport — direct LAN, Tailscale, or relay — not
only via a hosted relay; the relay is now optional/self-hosted). Once the
bridge-side FCM sender lands (`FOR-DEV.md` → Direct FCM from the bridge), the
**Firebase service account** moves here:

- A Firebase service-account JSON from the **same** Firebase project the mobile
  app uses (`uxnan-app`), placed at `~/.uxnan/firebase-service-account.json`
  (gitignored — **never committed**).
- Env var `UXNAN_FCM_SERVICE_ACCOUNT` → that path (Windows *User* scope).

Without it (and without a relay holding it), background push is a silent no-op —
foreground local notifications still work, relay-free. The credential is local
to the PC, never committed; push payloads carry only a title + thread id (no
conversation plaintext). iOS still needs the APNs key uploaded to Firebase
(`uxnanmobile/FOR-HUMAN.md`).

### Agent CLIs — install + login (per agent you want to use)

The bridge does **not** embed any AI model or call a provider API. For each agent
it drives, it spawns that vendor's **official local CLI** as a child process and
talks to it over stdio — exactly as you would in a terminal. So each agent you
want available must be **installed and logged in by you, with your own account /
subscription**, on the PC running the bridge. The bridge stores **no** API keys or
tokens; auth and billing are entirely the CLI's own (its existing login). This is
the supported "headless" use of each official CLI (`claude -p`, `codex exec`,
`opencode run`) — it is **not** an unofficial API wrapper, token re-use, SDK
embedding, or reselling, and it does not require a separate paid account beyond
whatever that CLI is already authenticated with.

| Agent | CLI | Install | Login | Notes |
|---|---|---|---|---|
| OpenCode | `opencode` | vendor installer / npm | per OpenCode | default agent; native `opencode.exe` resolved on Windows |
| Claude Code | `claude` | native installer (`~/.local/bin/claude`) or npm `@anthropic-ai/claude-code` | `claude` (Anthropic account / subscription) | runs `claude -p`; default permission posture `acceptEdits` (configurable) |
| Codex | `codex` | npm `@openai/codex` (or native) | `codex login` (your OpenAI/ChatGPT account) | runs `codex exec`; default sandbox `workspace-write` (configurable). Codex's `app-server`/`exec-server` are **not** needed |

A missing or logged-out CLI does not break the bridge: that agent simply shows as
`available: false` in `agent/list`, and the others keep working. Optional per-agent
overrides live in `~/.uxnan/daemon-config.json` under `agents.<id>`
(`binaryPath`, `model`, `permissionMode`).

> This is operational guidance, not a secret asset — no credentials are ever
> committed or stored by the bridge.

### Browse root & what the agent can reach (operational)

Set `browseRoots` in `~/.uxnan/daemon-config.json` to the folder you want the
phone to browse, e.g. your `Documents`:

```json
{ "browseRoots": ["C:\\Users\\you\\Documents"] }
```

The phone can then navigate sub-folders under that root, pick any directory as a
thread, and start an agent rooted there — **without ever browsing above the root**
(the `workspace/browseDirs` API rejects `..`/escape attempts).

**Important scope caveat:** that "can't go above the root" confinement applies to
the **phone's browse/read API**. The **agent process** (Claude/Codex/OpenCode) is a
normal child process: once you start a thread in a directory, the agent runs there
and can act on that directory and its sub-folders; its **writes** are bounded by
the agent's sandbox posture (`permissionMode` — Codex `workspace-write`, Claude
`acceptEdits`), but a hard OS-level read-confinement to the subtree is not provided
(it would need a container/sandbox; tracked in `FOR-DEV.md`). Choose a `browseRoots`
folder you are comfortable giving a coding agent access to.

### Cross-references (assets owned by other components)
- **Push credentials** (Firebase service account / APNs key) are moving from the
  **relay** to the **bridge** (above) — the relay's copy
  ([`../relay/FOR-HUMAN.md`](../relay/FOR-HUMAN.md)) stays valid for a
  self-hosted hosted-relay setup.
- **Firebase client config** (`google-services.json`,
  `GoogleService-Info.plist`) belongs to the **mobile app** (`uxnanmobile`) so
  the phone can obtain an FCM token.
