# Bridge — configuration

![Config](https://img.shields.io/badge/file-~%2F.uxnan%2Fdaemon--config.json-0a0a0a?style=for-the-badge&logo=json&logoColor=white)
![Optional](https://img.shields.io/badge/every_field-has_a_default-2ea44f?style=for-the-badge)

The daemon reads `~/.uxnan/daemon-config.json`. Every field has a default, so the
file is optional; create it to override. Defaults live in
[`../src/daemon-config.ts`](../src/daemon-config.ts).

## Fields

| Field | Default | Purpose |
|---|---|---|
| `relay` | *(absent)* | **Your own relay** — `{ "url": "wss://…", "routingId": "<32 hex>", "enabled": true }`, how phones reach this PC from another network. **Absent by default**: the bridge is LAN/Tailscale-direct and the pairing QR carries only the direct `hosts`. **Do not write it by hand** — `uxnan-bridge relay setup` (deploys the relay into your Cloudflare account) or `relay use <wss-url>` sets it, `relay enable`/`disable` flips `enabled`, `relay rotate` changes `routingId`, `relay remove` deletes it. It is shared with every client as `BridgeSettings.relay`. An entry that is not a valid endpoint is ignored, and the retired `relayUrl` / `relayEnabled` keys are dropped when the config is read. How it was set up lives beside it in `~/.uxnan/relay.json`; a remembered Cloudflare token only in the system keyring. See [`connectivity.md`](./connectivity.md#3-your-own-relay) and [`../../relay/docs/deploy.md`](../../relay/docs/deploy.md). |
| `lanEnabled` | `true` | Serve the LAN WebSocket so the phone can connect directly. Its non-internal IPv4s (LAN + Tailscale `100.x`) are advertised as `hosts` in the pairing QR. With `false` the bridge's HTTP endpoint still runs — on `127.0.0.1` only, on a port the OS picks — for the agents' approval hook, and is published nowhere (no QR hosts, no mDNS): the phone then reaches the bridge through the relay. This is how Uxnan starts a bridge it installs on a remote host. |
| `lanPort` | built-in default | LAN server port. |
| `mdnsEnabled` | `true` | Advertise the bridge on the LAN via mDNS/Bonjour (`_uxnan._tcp`) so the phone can **discover** it for manual-code pairing without typing the host. Effective only when `lanEnabled`. On multi-homed hosts, the bridge joins and emits on every eligible advertised IPv4 rather than trusting the OS multicast route. Best-effort — an unavailable UDP 5353 interface is logged and pairing still works by QR or by typing the host. Discovery never advertises the pairing code and never creates trust. |
| `localControlEnabled` | `true` | Serve the **local control channel** Uxnan Desktop uses on this machine: a WebSocket bound to `127.0.0.1` only, on a free port, authorized by a token written with the port to `~/.uxnan/local-control.json` (owner-only, fresh every start, removed on stop). Only `uxnan-bridge start` opens it. Set `false` to refuse the desktop entirely. See [connectivity](connectivity.md#4-uxnan-desktop-on-the-same-machine-local-control-channel). |
| `autoReconnect` | `true` | Not read by the current bridge: the relay control socket always reconnects (2 s → 60 s backoff) while a relay is enabled. |
| `maxConcurrentSessions` | `1` | Concurrent phone sessions. |
| `sessionTimeoutMinutes` | `30` | Idle session timeout. |
| `defaultAgent` | `opencode` | Agent used when a thread doesn't pick one. |
| `checkpointMaxPerProject` | `25` | Keep at most N newest workspace checkpoints per project (`cwd`); older ones are pruned (ref + metadata) on the next capture. `0` = unlimited. |
| `checkpointTtlDays` | `0` | Delete workspace checkpoints older than N days on capture. `0` = no TTL. |
| `home` | *(your home directory)* | The **start folder** shared with every client: where exploring for a new project begins and the boundary a phone may register projects under — **whatever directory `start` ran in**. Change it with `uxnan-bridge config set home <folder>`, from the phone or from Uxnan Desktop; every client hears the change (`stream/settings/updated`). |
| `name` | *(the machine's name)* | What **every client calls this PC**: the name the pairing QR carries, the desktop's presence and the origin of its conversations. Change it with `uxnan-bridge config set name <name>`, from the phone or from Uxnan Desktop; empty goes back to the machine's name. |
| `workspaceRoots` | `[]` | Absolute project dirs registered as projects on start (`source: config`). The projects list itself is the persistent registry in `~/.uxnan/projects.json` (below). |
| `browseRoots` | `[]` | Extra absolute base dirs the phone may **browse** under (`workspace/browseDirs`), after `home` and `workspaceRoots`. |
| `worktrees` | `{ "location": "managed" }` | Where `git/createWorktree` puts a worktree when the client sends no `path` (see below). |
| `agents.<id>` | `{}` | Per-agent overrides (see below). |
| `projectAgents` | `[]` | Per-project agent/model pins (see below). |
| `pushEnabled` / `pushOnAgentDone` / `pushOnAgentError` | `true` | Push-notification toggles (background delivery is gated on the bridge's Firebase service account — see [`push-notifications.md`](./push-notifications.md)). |

## Projects: one registry every client mirrors

`~/.uxnan/projects.json` holds the projects the phone and Uxnan Desktop both
show (architecture/02a §5.8.17). A project is a canonical folder; a git
worktree belongs to its repository's project. It is registered by
`project/add` (from the phone, only inside the browse roots; from the desktop,
which publishes its own projects, anywhere), by starting a conversation in its
folder, or from `workspaceRoots`; `project/remove` takes it out and never
deletes a conversation. The first time the registry is created it is seeded
with the folders of every conversation you already had, so nothing done on the
phone alone is lost when the desktop connects. Every change carries a sync
revision (`~/.uxnan/sync.json`) and reaches every client, including one that
was away (`sync/changes`).

> **`browseRoots` bounds browsing, not reading.** A paired phone already reads
> any `cwd` it names (`workspace/readFile` confines the read to that `cwd`, not
> to a global allowlist), so `workspace/resolveFileLink` follows the same
> posture: it resolves a file the agent cited wherever it actually is — which is
> the point, since an agent working in one worktree routinely writes into
> another. What it never does is serve `.git` internals or a sensitive name
> (`.env*`, `*.pem`/`*.key`, `id_rsa*`, `credentials.json`, `.npmrc`) in any
> segment of the path, and it refuses anything that is not an existing regular
> file. The trust boundary is the pairing itself.

### Worktree location (`worktrees`)

Where a worktree goes when `git/createWorktree` is called **without** a `path`.
A client that sends one still gets exactly that path.

| `location` | Result | |
|---|---|---|
| `managed` (default) | `<home>/uxnan/worktrees/<repo>/<branch>` | Grouped by project under a folder uxnan owns |
| `sibling` | `<parent>/<repo>--<branch>` | The layout used before the managed root |
| `custom` | `<worktrees.root>/<repo>/<branch>` | The managed layout under a root you name |

```json
{ "worktrees": { "location": "custom", "root": "D:/trees" } }
```

This mirrors the desktop's **Settings → Git → Worktree location** on purpose:
both apps place worktrees for the same repositories, and the two derivations had
drifted into different folder names for the same repository and branch. The
layout lives in `src/git/worktree-location.ts` here and in
`uxnandesktop/src-tauri/src/worktreeloc.rs` there, driven by one shared table of
cases — including the digest that keeps two projects with the same folder name
apart, which both sides pin to the same value.

The rules it applies: the group is measured from the repository's **main**
worktree (creating one from inside another must not nest); branch names are
folded into folder names valid on every OS (Windows-invalid characters, trailing
dots and spaces, reserved device names like `CON`, length capped at 60 on a word
boundary); a taken destination takes the next free `-2`/`-3`; and nothing is ever
placed inside the repository's own work tree.

Worktrees the bridge placed itself are recorded in `~/.uxnan/managed-worktrees.json`,
so a later cleanup can tell them from checkouts that were already on disk. A
client-supplied path is not recorded — that is the client's own arrangement.

Clients discover support through `features.managedWorktrees` on `bridge/status`:
absent means the bridge still requires `path`.

### Per-agent overrides (`agents.<id>`)

`<id>` is one of the active agent ids: `opencode`, `claude-code`, `codex`,
`antigravity-cli`, `pi-agent`, `zero`, `grok`. These are the canonical `AgentId`
values — note `antigravity-cli` and `pi-agent` (not `antigravity` / `pi`). The
same id strings are used for `defaultAgent` and `projectAgents[].agentId`.
An old `gemini-cli` default, settings block or project pin is removed when the
config is loaded.

| Field | Purpose |
|---|---|
| `binaryPath` | Absolute path to the agent CLI (else auto-resolved). |
| `model` | Default model for that agent (an alias like `opus`, or an exact id). |
| `models` | Extra explicit models to show in the picker, **unioned on top of** the project's built-in (seeded) list — the built-in list is a live code default that stays current with the app automatically, and your entries extend/override it by id (a same-id entry wins its `displayName`; an empty `[]` does **not** clear the baseline). Each entry is a bare id string or `{ id, displayName?, description? }`. For **Claude Code** this pins concrete versions (e.g. `claude-opus-4-7`) next to the auto-updating `fable`/`opus`/`sonnet`/`haiku` aliases — see [agents.md](./agents.md#claude-code-models-latest-aliases--pinned-versions). Currently consumed only by the Claude Code adapter; ignored by active agents that enumerate their own models (OpenCode, Codex, pi, Antigravity, Zero, Grok). |
| `permissionMode` | The posture of an agent that offers **no access modes** — pi and Antigravity: `acceptEdits`, `default` (read-only) or `bypassPermissions`. Every other agent runs in the conversation's access mode, chosen in the apps; see [agents.md → *Access modes*](./agents.md#access-modes). Claude Code's "request approval" works with the LAN on or off (its approval hook calls the bridge's local HTTP endpoint, which listens on loopback when the LAN is off). |

### Per-project agent/model pins (`projectAgents`)

Pin a default agent (and optionally model) for specific projects, so opening a
thread there does not require the phone to choose every time. Each entry's `cwd`
is the project's absolute directory; `agentId` is the pinned agent and `model` an
optional default model for it.

| Field | Purpose |
|---|---|
| `cwd` | Absolute project directory the pin applies to (matched by resolved path). |
| `agentId` | Active agent the project defaults to (`opencode` / `claude-code` / `codex` / `antigravity-cli` / `pi-agent` / `zero` / `grok`). |
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
      "model": "opus",
      "models": [
        { "id": "claude-fable-5-1", "displayName": "Fable 5.1" },
        { "id": "claude-fable-5", "displayName": "Fable 5" },
        { "id": "claude-opus-5-5", "displayName": "Opus 5.5" },
        { "id": "claude-opus-5", "displayName": "Opus 5" },
        { "id": "claude-opus-4-8", "displayName": "Opus 4.8" },
        { "id": "claude-sonnet-5", "displayName": "Sonnet 5" },
        { "id": "claude-sonnet-4-6", "displayName": "Sonnet 4.6" },
        "claude-haiku-4-5"
      ]
    },
    "pi-agent": { "permissionMode": "acceptEdits" },
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
only write-bounded by the conversation's access mode — see
[`../FOR-HUMAN.md`](../FOR-HUMAN.md) (browse root & agent scope).

## State files in `~/.uxnan/`

`daemon-config.json`, `pairing-session.json`, `trusted-phones.json`,
`threads/<threadId>.json`, `metrics.json`, `checkpoints.json`, `bridge.lock`,
`agent-processes.json`, `logs/bridge-YYYY-MM-DD.log`. The Ed25519 identity and
the metrics sealing key live in the OS keychain, not on disk — for the bridge
the CLI starts (`uxnan-bridge start`, `qr`). A bridge started from code
(`startBridge()` in a test or a scratch run) keeps them in memory unless it
passes `useKeychain: true`, so it can never come up as your real bridge.

`agent-processes.json` is the running daemon's record of the agent processes it
started — `{ "version": 1, "processes": [{ pid, command, args, cwd, startedAt,
ownerPid, ownerStartedAt }] }` — added as each one starts and removed when it
exits (`adapters/child-ledger.ts`). Only `uxnan-bridge start` writes it, after it
holds `bridge.lock`. When a bridge is killed hard its children are left running;
the next `start` reads this file before it serves anything and ends each recorded
process that is still running, no longer that bridge's child, and still the
recorded command started at the recorded time (`adapters/orphan-reaper.ts`),
then starts a fresh record. A process that fails any check — a pid the system has
since given to another program — is left alone. Like `threads/`, it can hold a
prompt (a one-shot agent run takes it as an argument).

**`~/.uxnan/` is the product's home on the machine, not the bridge's alone.**
Uxnan Desktop writes one sibling here — `hooks/`, the agent reporters each
CLI's own config points at — because that config is itself one file per machine
and naming a path inside any one app profile is what let a second instance take
the machine's agents over (`uxnandesktop/docs/agent-hooks.md` → *Why not inside
the app's profile*). The bridge owns everything listed above and touches
nothing else here; the desktop owns `hooks/` and touches nothing of the
bridge's.

`metrics.json` is a versioned, global-per-PC activity ledger. It retains
conversation, message/day, reported-token, connection-session and mutating-Git
rows even after mutable thread history is deleted. Existing conversation
history is backfilled idempotently at startup and before reads/exports. Five
local generations (`metrics.json.bak1` … `.bak5`) are rotated on writes and the
newest readable generation is used if the primary is missing or malformed.
