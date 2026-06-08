# Bridge — configuration

The daemon reads `~/.uxnan/daemon-config.json`. Every field has a default, so the
file is optional; create it to override. Defaults live in
[`../src/daemon-config.ts`](../src/daemon-config.ts).

## Fields

| Field | Default | Purpose |
|---|---|---|
| `relayUrl` | built-in default | WebSocket URL of the relay (remote/off-LAN path). |
| `lanEnabled` | `true` | Serve the LAN WebSocket so the phone can connect directly on the same network. |
| `lanPort` | built-in default | LAN server port. |
| `autoReconnect` | `true` | Keep re-arming the relay session after a phone disconnects. |
| `maxConcurrentSessions` | `1` | Concurrent phone sessions. |
| `sessionTimeoutMinutes` | `30` | Idle session timeout. |
| `defaultAgent` | `opencode` | Agent used when a thread doesn't pick one. |
| `workspaceRoots` | `[]` | Absolute project dirs exposed via `project/list` (empty → the bridge cwd). |
| `browseRoots` | `[]` | Absolute base dirs the phone may **browse** under (`workspace/browseDirs`). Empty → falls back to `workspaceRoots`, then your home dir. |
| `agents.<id>` | `{}` | Per-agent overrides (see below). |
| `pushEnabled` / `pushOnAgentDone` / `pushOnAgentError` | `true` | Push-notification toggles (delivery is gated on relay Firebase/APNs creds). |

### Per-agent overrides (`agents.<id>`)

`<id>` is one of `opencode`, `claude-code`, `codex`.

| Field | Purpose |
|---|---|
| `binaryPath` | Absolute path to the agent CLI (else auto-resolved). |
| `model` | Default model for that agent. |
| `permissionMode` | Headless posture for agents that gate tools: `acceptEdits` (default — edits auto-apply), `default` (read-only/no-edit), `bypassPermissions` (full autonomy). Maps to each CLI's flag (Claude `--permission-mode`/`--dangerously-skip-permissions`; Codex `-s workspace-write`/`read-only`/`--dangerously-bypass-approvals-and-sandbox`). |

## Example

```json
{
  "browseRoots": ["C:\\Users\\you\\Documents"],
  "defaultAgent": "claude-code",
  "agents": {
    "claude-code": { "permissionMode": "acceptEdits" },
    "codex": { "permissionMode": "acceptEdits" },
    "opencode": { "model": "provider/model" }
  }
}
```

With `browseRoots` set to `Documents`, the phone browses sub-folders under it,
picks any directory as a thread's working dir, and starts an agent rooted there.
The browse API cannot navigate above the root; note the **agent process** itself is
only write-bounded by its `permissionMode` — see
[`../FOR-HUMAN.md`](../FOR-HUMAN.md) (browse root & agent scope).

## State files in `~/.uxnan/`

`daemon-config.json`, `pairing-session.json`, `trusted-phones.json`,
`threads.json`, `checkpoints.json`, `bridge.lock`, `logs/bridge-YYYY-MM-DD.log`.
The Ed25519 identity lives in the OS keychain, not on disk.
