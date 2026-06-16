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

The exact wiring depends on the agent's hook/extension system. Examples:

- **Claude Code** — configure `hooks` in its settings to run a small script on
  `PreToolUse` / `Stop` / `Notification` events that curls the payload above
  (mapping the event to a `status`). A ready-made config is tracked in
  `FOR-DEV.md`.
- **Generic / any CLI** — wrap the agent in a shell script that posts `working`
  before launch and `done` after it exits.

> **Security.** The server only listens on `127.0.0.1` and requires the
> per-launch token, so other machines can't reach it and stray local processes
> can't spoof reports. The token is never logged or persisted to disk.
