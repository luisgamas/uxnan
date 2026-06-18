# Agent hooks — precise agent states

The ADE infers a coarse **working / idle** state from terminal output with no
setup. To get **precise** states — `working`, `blocked`, `waiting`, `done` — an
agent must actively report them to the ADE's local **hook server** (Layer 1 of
the monitoring design, spec `architecture/02d-agent-monitoring.md` §1.1).

This is opt-in, per-agent configuration: the ADE provides the endpoint, you point
your agent's hook at it.

## How it works

At startup the ADE binds an HTTP server to an ephemeral port on `127.0.0.1`.
Every terminal it spawns gets three environment variables (inherited by any agent
you run inside that terminal):

| Variable | Meaning |
|---|---|
| `UXNAN_HOOK_URL` | Full `POST` endpoint, e.g. `http://127.0.0.1:51234/hook`. |
| `UXNAN_HOOK_TOKEN` | Shared secret for this ADE launch. |
| `UXNAN_AGENT_ID` | This terminal's id — echo it back as `agentId`. |

An agent (or a wrapper hook) reports a state change by POSTing JSON:

```bash
curl -fsS -X POST "$UXNAN_HOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Uxnan-Token: $UXNAN_HOOK_TOKEN" \
  -d "{\"agentId\":\"$UXNAN_AGENT_ID\",\"status\":\"working\",\"agentType\":\"claude\",\"tool\":\"bash\"}"
```

The ADE caches the report (surviving restarts, pruned after 7 days) and updates
the sidebar/tab indicators live.

## Request contract

`POST $UXNAN_HOOK_URL` with header `X-Uxnan-Token: $UXNAN_HOOK_TOKEN` and a JSON
body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `agentId` | string | yes | Echo `UXNAN_AGENT_ID`. |
| `status` | string | yes | One of `working`, `blocked`, `waiting`, `done`. |
| `agentType` | string | no | `claude`, `codex`, … (shown in the UI). |
| `prompt` | string | no | The prompt being processed. |
| `tool` | string | no | Tool in use: `file_edit`, `bash`, `web_search`, … |
| `interrupted` | bool | no | Whether the agent was interrupted. |

Responses: `204 No Content` on success, `401` if the token is missing/wrong,
`400`/`422` for a malformed body. A `GET /health` endpoint returns `ok`.

## Wiring specific agents

The exact wiring depends on the agent's hook/extension system. The ADE ships
**ready-made configs** that wire the most common agents for you — no manual
JSON needed. Open **Settings → Agents → Hooks** to install them.

### Ready-made configs (Settings → Agents → Hooks)

On every startup the ADE writes four scripts to `<app-data>/hooks/`:

- `uxnan-claude-hook.cjs` — the Node CJS script Claude Code invokes on every
  event. No deps, cross-platform, maps `UserPromptSubmit` / `PreToolUse` /
  `PreCompact` / `Notification` / `PermissionRequest` / `Stop` / `SessionEnd`
  to the ADE's `working` / `waiting` / `done` / `blocked` states.
- `uxnan-hook-wrapper.sh` — Bash wrapper for any CLI agent (Unix + Git Bash +
  WSL). Posts `working` before exec and `done` on exit.
- `uxnan-hook-wrapper.ps1` — PowerShell wrapper (Windows).
- `uxnan-hook-wrapper.cmd` — cmd / batch fallback (Windows, no PowerShell).

**Claude Code** — open Settings → Agents → Hooks and click **Install**. The
ADE merges the ready-made `hooks` block into `~/.claude/settings.json`,
preserving every other key. Uninstall reverses the change (only the ADE
block is removed; any user-installed `hooks` survive). The pane also
discloses the exact JSON it would write, in case you prefer to paste it by
hand.

**Any other agent** — use the generic wrapper. The script is installed at
the path the pane shows; use it as the agent's launch command:

```bash
# In Settings → Agents → Your agents → Add custom agent
Command:  /…/hooks/uxnan-hook-wrapper.sh
Args:     codex -- <your normal args>
```

(Windows: `…\hooks\uxnan-hook-wrapper.ps1`; on cmd-only hosts, the `.cmd`
fallback.) The wrapper then exec's the real CLI and the ADE gets
`working` / `done` for that terminal, the same as for Claude Code's hooks.

The shell hook, the wrapper, and the Claude script are **all driven by the
same env vars** the ADE already injects into every terminal
(`UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN` / `UXNAN_AGENT_ID`) — nothing to
configure per machine.

### Manual / custom agents

If the ready-made configs don't fit (or you prefer to wire things by hand),
the contract is the same:

- **Claude Code** — point its `hooks` config at a small script that reads
  the JSON Claude sends on stdin and POSTs it to `$UXNAN_HOOK_URL` (using
  `$UXNAN_HOOK_TOKEN` in `X-Uxnan-Token` and `$UXNAN_AGENT_ID` as
  `agentId`). The shipped `uxnan-claude-hook.cjs` is the reference.
- **Generic / any CLI** — wrap the agent in a shell script that posts
  `working` before launch and `done` after it exits (use the shipped
  `uxnan-hook-wrapper.{sh,ps1,cmd}` as a starting point).

> **Security.** The server only listens on `127.0.0.1` and requires the
> per-launch token, so other machines can't reach it and stray local processes
> can't spoof reports. The token is never logged or persisted to disk.
