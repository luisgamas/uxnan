# Bridge — configuration

![Config](https://img.shields.io/badge/file-~%2F.uxnan%2Fdaemon--config.json-0a0a0a?style=for-the-badge&logo=json&logoColor=white)
![Optional](https://img.shields.io/badge/every_field-has_a_default-2ea44f?style=for-the-badge)

The daemon reads `~/.uxnan/daemon-config.json`. Every field has a default, so the
file is optional; create it to override. Defaults live in
[`../src/daemon-config.ts`](../src/daemon-config.ts).

## Fields

| Field | Default | Purpose |
|---|---|---|
| `relayUrl` | built-in default (placeholder) | WebSocket URL of the relay (remote/off-LAN fallback). The built-in default is a **placeholder** — set this to **your own** self-hosted relay's `wss://…` URL *before* you flip `relayEnabled`, so turning the relay on is a one-line change with nothing else to wire. |
| `relayEnabled` | `false` | **Off by default** — the bridge is LAN/Tailscale-direct (no hosting) and the pairing QR carries only the direct `hosts`. The relay is **optional and self-hosted**: pre-set `relayUrl` to your relay, then flip this to `true` and re-pair (or regenerate the QR) — the QR then carries your `relay` as a fallback after the direct `hosts`. Needed only for off-LAN access without a mesh VPN, and for **background push** (FCM). See [`connectivity.md`](./connectivity.md), [`push-notifications.md`](./push-notifications.md) and [`../../relay/docs/deploy.md`](../../relay/docs/deploy.md). |
| `lanEnabled` | `true` | Serve the LAN WebSocket so the phone can connect directly. Its non-internal IPv4s (LAN + Tailscale `100.x`) are advertised as `hosts` in the pairing QR. |
| `lanPort` | built-in default | LAN server port. |
| `mdnsEnabled` | `true` | Advertise the bridge on the LAN via mDNS/Bonjour (`_uxnan._tcp`) so the phone can **discover** it for manual-code pairing without typing the host. Effective only when `lanEnabled`. Best-effort — a failed bind (UDP 5353 busy) degrades silently; pairing still works by QR or by typing the host. |
| `autoReconnect` | `true` | Keep re-arming the relay session after a phone disconnects. |
| `maxConcurrentSessions` | `1` | Concurrent phone sessions. |
| `sessionTimeoutMinutes` | `30` | Idle session timeout. |
| `defaultAgent` | `opencode` | Agent used when a thread doesn't pick one. |
| `checkpointMaxPerProject` | `25` | Keep at most N newest workspace checkpoints per project (`cwd`); older ones are pruned (ref + metadata) on the next capture. `0` = unlimited. |
| `checkpointTtlDays` | `0` | Delete workspace checkpoints older than N days on capture. `0` = no TTL. |
| `workspaceRoots` | `[]` | Absolute project dirs exposed via `project/list` (empty → the bridge cwd). |
| `browseRoots` | `[]` | Absolute base dirs the phone may **browse** under (`workspace/browseDirs`). Empty → falls back to `workspaceRoots`, then the **bridge's launch directory** (`process.cwd()`). So with nothing configured, the phone browses from wherever you started the bridge — zero-config plug-and-play. |
| `agents.<id>` | `{}` | Per-agent overrides (see below). |
| `projectAgents` | `[]` | Per-project agent/model pins (see below). |
| `pushEnabled` / `pushOnAgentDone` / `pushOnAgentError` | `true` | Push-notification toggles (delivery is gated on relay Firebase/APNs creds). |

### Per-agent overrides (`agents.<id>`)

`<id>` is one of the wired agent ids: `opencode`, `claude-code`, `codex`,
`gemini-cli`, `pi-agent`. These are the canonical `AgentId` values — note
`gemini-cli` and `pi-agent` (not `gemini` / `pi`). The same id strings are used
for `defaultAgent` and `projectAgents[].agentId`.

| Field | Purpose |
|---|---|
| `binaryPath` | Absolute path to the agent CLI (else auto-resolved). |
| `model` | Default model for that agent (an alias like `opus`, or an exact id). |
| `models` | Extra explicit models to show in the picker, **unioned on top of** the project's built-in (seeded) list — the built-in list is a live code default that stays current with the app automatically, and your entries extend/override it by id (a same-id entry wins its `displayName`; an empty `[]` does **not** clear the baseline). Each entry is a bare id string or `{ id, displayName?, description? }`. For **Claude Code** this pins concrete versions (e.g. `claude-opus-4-7`) next to the auto-updating `opus`/`sonnet`/`haiku` aliases — see [agents.md](./agents.md#claude-code-models-latest-aliases--pinned-versions). Currently consumed only by the Claude Code adapter; ignored by agents that enumerate their own models (OpenCode, Codex, pi, Gemini CLI). |
| `permissionMode` | Headless posture for agents that gate tools: `acceptEdits` (default — edits auto-apply), `default` (read-only/no-edit), `bypassPermissions` (full autonomy). Mapped to each CLI's own flags — Claude (`--permission-mode` / `--dangerously-skip-permissions`), Codex (`-s workspace-write` / `read-only` / `--dangerously-bypass-approvals-and-sandbox`), Gemini (`--approval-mode auto_edit` / `plan` / `yolo`), and pi (its built-in tool posture / `--tools` / `--approve`). OpenCode does not gate tools, so it ignores this field. |
| `interactiveApprovals` | Opt-in interactive tool approvals for **Claude Code and Gemini CLI** (default false; requires `lanEnabled`). When true, every tool the agent runs prompts you **on the phone** (Approve / Reject) before it executes: the bridge injects a `PreToolUse` hook for Claude (and a `BeforeTool` hook for Gemini) that holds the tool until you answer (5-min timeout → deny). For Claude it overrides `permissionMode` (forcing `--permission-mode default` so the hook is the gate). Leave it off for unattended runs. |

### Per-project agent/model pins (`projectAgents`)

Pin a default agent (and optionally model) for specific projects, so opening a
thread there does not require the phone to choose every time. Each entry's `cwd`
is the project's absolute directory; `agentId` is the pinned agent and `model` an
optional default model for it.

| Field | Purpose |
|---|---|
| `cwd` | Absolute project directory the pin applies to (matched by resolved path). |
| `agentId` | Agent the project defaults to (`opencode` / `claude-code` / `codex` / `gemini-cli` / `pi-agent`). |
| `model` | Optional default model for that agent. |

When the phone starts a thread (`thread/start`) **without** an explicit
`agentId`, the bridge uses the project's pinned agent, then the global
`defaultAgent`. The pinned `model` is applied only when the resolved agent is the
pinned one — an explicit agent override never inherits a foreign model.
`project/list`/`project/resolve` also report the pin on each `Project`, so the
phone can pre-select it. (`binaryPath`/`extraArgs` on a `projectAgents` entry are
reserved and not yet consumed.)

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
        { "id": "claude-fable-5", "displayName": "Fable 5" },
        { "id": "claude-opus-4-8", "displayName": "Opus 4.8" },
        { "id": "claude-sonnet-5", "displayName": "Sonnet 5" },
        { "id": "claude-sonnet-4-6", "displayName": "Sonnet 4.6" },
        "claude-haiku-4-5"
      ]
    },
    "codex": { "permissionMode": "acceptEdits" },
    "opencode": { "model": "provider/model" }
  },
  "projectAgents": [
    { "cwd": "C:\\Users\\you\\Documents\\my-repo", "agentId": "codex" },
    { "cwd": "C:\\Users\\you\\Documents\\docs-site", "agentId": "claude-code", "model": "opus" }
  ]
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
