# Bridge — configuration

The daemon reads `~/.uxnan/daemon-config.json`. Every field has a default, so the
file is optional; create it to override. Defaults live in
[`../src/daemon-config.ts`](../src/daemon-config.ts).

## Fields

| Field | Default | Purpose |
|---|---|---|
| `relayUrl` | built-in default | WebSocket URL of the relay (remote/off-LAN fallback). |
| `relayEnabled` | `false` | **Off by default** — the bridge is LAN/Tailscale-direct (no hosting) and the pairing QR carries only the direct `hosts`. The relay is **optional and self-hosted**: set `true` and point `relayUrl` at your own relay to also fall back through it (for users without a mesh VPN). See [`connectivity.md`](./connectivity.md) and [`../../relay/docs/deploy.md`](../../relay/docs/deploy.md). |
| `lanEnabled` | `true` | Serve the LAN WebSocket so the phone can connect directly. Its non-internal IPv4s (LAN + Tailscale `100.x`) are advertised as `hosts` in the pairing QR. |
| `lanPort` | built-in default | LAN server port. |
| `autoReconnect` | `true` | Keep re-arming the relay session after a phone disconnects. |
| `maxConcurrentSessions` | `1` | Concurrent phone sessions. |
| `sessionTimeoutMinutes` | `30` | Idle session timeout. |
| `defaultAgent` | `opencode` | Agent used when a thread doesn't pick one. |
| `workspaceRoots` | `[]` | Absolute project dirs exposed via `project/list` (empty → the bridge cwd). |
| `browseRoots` | `[]` | Absolute base dirs the phone may **browse** under (`workspace/browseDirs`). Empty → falls back to `workspaceRoots`, then the **bridge's launch directory** (`process.cwd()`). So with nothing configured, the phone browses from wherever you started the bridge — zero-config plug-and-play. |
| `agents.<id>` | `{}` | Per-agent overrides (see below). |
| `pushEnabled` / `pushOnAgentDone` / `pushOnAgentError` | `true` | Push-notification toggles (delivery is gated on relay Firebase/APNs creds). |

### Per-agent overrides (`agents.<id>`)

`<id>` is one of `opencode`, `claude-code`, `codex`.

| Field | Purpose |
|---|---|
| `binaryPath` | Absolute path to the agent CLI (else auto-resolved). |
| `model` | Default model for that agent (an alias like `opus`, or an exact id). |
| `models` | Extra explicit models to show in the picker **alongside** the ones the agent reports itself. Each entry is a bare id string or `{ id, displayName?, description? }`. For **Claude Code** this pins concrete versions (e.g. `claude-opus-4-7`) next to the auto-updating `opus`/`sonnet`/`haiku` aliases — see [agents.md](./agents.md#claude-code-models-latest-aliases--pinned-versions). Ignored by agents that enumerate their own models (OpenCode, Codex). |
| `permissionMode` | Headless posture for agents that gate tools: `acceptEdits` (default — edits auto-apply), `default` (read-only/no-edit), `bypassPermissions` (full autonomy). Maps to each CLI's flag (Claude `--permission-mode`/`--dangerously-skip-permissions`; Codex `-s workspace-write`/`read-only`/`--dangerously-bypass-approvals-and-sandbox`). |

## Example

```json
{
  "browseRoots": ["C:\\Users\\you\\Documents"],
  "defaultAgent": "claude-code",
  "agents": {
    "claude-code": {
      "permissionMode": "acceptEdits",
      "model": "opus",
      "models": [
        { "id": "claude-opus-4-8", "displayName": "Opus 4.8" },
        { "id": "claude-sonnet-4-6", "displayName": "Sonnet 4.6" },
        "claude-haiku-4-5"
      ]
    },
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
