# Uxnan control surface (protocol v1)

Operate the running Uxnan Desktop from a shell or from an agent. Two doors to one catalog: MCP tools (available with nothing to install inside every terminal Uxnan launches) and `uxnan-cli` (any shell of the same user). A script in any language can take a third door, the JSON-RPC route the CLI itself uses — see *Calling the RPC route directly* in the full form (`--full`).

## Commands

```
uxnan-cli status
uxnan-cli project ls | show <project>
uxnan-cli worktree ls [--project <project>] | show <worktree>
uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing]
                          [--agent <agent>] [--prompt-file <file>] [--idempotency-key <key>]
uxnan-cli terminal ls [--worktree <worktree>] | show <terminal> | reveal <terminal>
uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>]
                          [--idempotency-key <key>]
uxnan-cli agent ls
uxnan-cli agent send --to <terminal> --message-file <file> [--force] [--idempotency-key <key>]
uxnan-cli agent wait --to <terminal> --for idle|waiting|exit [--timeout <seconds>]
uxnan-cli terminal read <terminal> [--lines <n>]
uxnan-cli run ls | show <run-id> | start <run-id> [--idempotency-key <key>]
uxnan-cli automation ls | run <automation-id> [--idempotency-key <key>]
uxnan-cli app focus
uxnan-cli file open <path> [--worktree <worktree>]
uxnan-cli file diff <path> [--worktree <worktree>] [--staged]
uxnan-cli browser open <url> | navigate <url> | reload | back | forward | status
uxnan-cli rpc <method> [--params '<json>']      # any catalog entry, raw
uxnan-cli skills get control [--full]           # this guide / the full reference
Global: --json (stable machine output), --timeout <seconds>
```

## Selectors

- `current` — your own terminal, and from it your worktree and project. Works inside a terminal Uxnan launched (it knows `UXNAN_AGENT_ID`); from another shell, use an explicit form.
- `id:<id>` — a project id or a terminal id (from `ls`).
- `path:<absolute path>` — a project or worktree folder. A bare absolute path is accepted too.
- `branch:<name>` — a worktree by its branch.
- `name:<project name>` — a project by its name (must be unique).

## Catalog

### `read` (v1) — reads with no effect

- `status` (MCP tool `uxnan_status`) — Report the running Uxnan Desktop: its version, the control protocol version, which capability groups are enabled, and how many projects, terminals and live agents it holds.
- `project/list` (MCP tool `project_list`) — List the projects registered in Uxnan: id, name, folder, whether it is a git repository, the machine it lives on, and its worktrees with branch and change counts.
- `project/show` (MCP tool `project_show`) — Describe one project: the same record `project/list` gives, for the project you select.
- `worktree/list` (MCP tool `worktree_list`) — List worktrees: path, branch, HEAD, whether it is the main checkout, and which live agents run in it.
- `worktree/show` (MCP tool `worktree_show`) — Describe one worktree: path, branch, HEAD, the project it belongs to, its dirty/ahead/behind counts and the agents running in it.
- `terminal/list` (MCP tool `terminal_list`) — List the terminal tabs open in Uxnan: id, title, working directory, the worktree it belongs to, and — when an agent runs in it — the agent, its model and its live state (working, waiting, blocked, done).
- `terminal/show` (MCP tool `terminal_show`) — Describe one terminal tab, including the agent state Uxnan knows for it.
- `agent/list` (MCP tool `agent_list`) — List the agents Uxnan is currently tracking: terminal id, agent kind, state (working, waiting, blocked, done), the prompt and tool last reported, and the worktree they run in.
- `run/list` (MCP tool `run_list`) — List the orchestration runs (multi-step, multi-agent plans) with their status and step counts.
- `run/show` (MCP tool `run_show`) — Describe one orchestration run: every step with its kind, target, dependencies, status and captured output.
- `automation/list` (MCP tool `automation_list`) — List the saved automations (unattended, recurring agent runs): id, name, whether it is enabled, its schedule and its working folder.
- `browser/status` (MCP tool `browser_status`) — Report the integrated browser's state: whether a page is open, the current URL, whether the in-app browser is enabled, and how opens are routed (in-app / external / ask).

### `ui` (v1) — actions on the window that change nothing on disk or in a process

- `app/focus` (MCP tool `app_focus`) — Bring the Uxnan window to the front.
- `terminal/reveal` (MCP tool `terminal_reveal`) — Show a terminal tab: switch to its workspace and make it the active tab, so the person sees what that agent is doing.
- `file/open` (MCP tool `file_open`) — Open a file in Uxnan's editor tab (or reveal it if already open).
- `file/diff` (MCP tool `file_diff`) — Open a file's working-tree diff in Uxnan (the Changes view of its tab), so the person can review what changed.
- `browser/open` (MCP tool `browser_open`) — Open the integrated in-app browser and load a URL.
- `browser/navigate` (MCP tool `browser_navigate`) — Navigate the integrated browser to a new URL (opening the panel first if it is not open).
- `browser/reload` (MCP tool `browser_reload`) — Reload the current page in the integrated browser.
- `browser/back` (MCP tool `browser_back`) — Go back one entry in the integrated browser's history.
- `browser/forward` (MCP tool `browser_forward`) — Go forward one entry in the integrated browser's history.

### `create` (v1) — create a worktree or a terminal, start a saved run or automation

- `worktree/create` (MCP tool `worktree_create`) — Create a git worktree on a new branch of a project — where Uxnan's worktree-location policy puts it — make it the active worktree, and optionally launch an agent in it with a first message.
- `terminal/create` (MCP tool `terminal_create`) — Open a new terminal tab in a worktree, optionally launching a configured agent in it with a first message.
- `run/start` (MCP tool `run_start`) — Start (or re-run) a saved orchestration run by id: every step is reset and the engine begins dispatching.
- `automation/run` (MCP tool `automation_run`) — Run a saved automation now, as a manual run of the same headless runner its schedule uses.

### `converse` (v1) — talk to a running agent

- `agent/send` (MCP tool `agent_send`) — Send a complete message to a running agent, as one paste-and-submit — never as keystrokes.
- `agent/wait` (MCP tool `agent_wait`) — Wait until an agent reaches a state, as reported by its own hooks: `idle` (its turn finished — the state to wait for after sending a message), `waiting` (it stopped to ask the person something), or `exit` (its terminal is gone).
- `terminal/read` (MCP tool `terminal_read`) — Read the last lines of a terminal's screen as plain text (escapes removed, blank rows dropped), with secrets redacted — tokens, keys, `Authorization` headers, `password=`.

### `orchestrate` (v1) — a step of a run reports back to it

- `orchestration/reportResult` (MCP tool `orchestration_report_result`) — Report the final result of the task Uxnan's orchestration run gave you, so the run captures your output verbatim and can feed it to the next step.
- `orchestration/reportProgress` (MCP tool `orchestration_report_progress`) — Report a short progress update for your current orchestration-run step (optional; it surfaces what you are doing in the run view).

## Calling the RPC route directly

For a script in any language, or an agent runtime with an HTTP client, on the **same machine** as the app: the server listens on loopback only, so nothing reaches it from another host. Everything here is what `uxnan-cli` does internally.

### Find the app

Inside a terminal Uxnan launched, the environment already says: `UXNAN_HOOK_URL` (`http://127.0.0.1:<port>/hook` — the server's origin is that URL without the path), `UXNAN_HOOK_TOKEN` (the per-launch token) and `UXNAN_AGENT_ID` (this terminal's id — send it back and `current` resolves to it).

Anywhere else, read `control.json` under the app's data directory — `~/Library/Application Support/dev.luisgamas.uxnandesktop` on macOS, `%APPDATA%\dev.luisgamas.uxnandesktop` on Windows, `$XDG_DATA_HOME/dev.luisgamas.uxnandesktop` (or `~/.local/share/dev.luisgamas.uxnandesktop`) on Linux; `UXNAN_DATA_DIR` overrides it, and a development build uses the `dev.luisgamas.uxnandesktop-dev` sibling:

```json
{
  "protocolVersion": 1,
  "appVersion": "<the app version>",
  "pid": 4242,
  "processStart": 1789840953,
  "endpoint": "http://127.0.0.1:56606",
  "token": "…"
}
```

Before using it: refuse a file readable by other users (a mode other than `0600` on Unix); refuse a `protocolVersion` other than 1; confirm that `pid` is alive **and** started at `processStart` (±2 s) — a file left behind by a crash then points nowhere. The app writes the file on start, removes it on a clean exit, and mints a new token on every start (and on a rotation), so read the file per session, not once.

### Post a request

`POST {endpoint}/control/v1/rpc` with one JSON-RPC 2.0 request per call. The token goes in `Authorization: Bearer <token>` (the `x-uxnan-token` header is accepted too); inside a Uxnan terminal add `x-uxnan-agent-id: <UXNAN_AGENT_ID>` so `current` means your terminal.

```http
POST /control/v1/rpc HTTP/1.1
Host: 127.0.0.1
Content-Type: application/json
Authorization: Bearer <token>

{"jsonrpc":"2.0","id":1,"method":"worktree/list","params":{"project":"name:uxnan"}}
```

The reply is `200` with a result — `{"jsonrpc":"2.0","id":1,"result":{"worktrees":[…]}}` — or, still `200`, an error: `{"jsonrpc":"2.0","id":1,"error":{"code":-32002,"message":"no project matches `name:uxnan`","data":…}}` (`data` only when the entry has something structured to add). `params` is always an object and is validated against the entry's schema: an unknown argument, a missing required one or a wrong type is `-32602` with a message that names the accepted arguments. No batches, no notifications: every request has an `id` and gets one reply.

At the HTTP layer: `400` with a JSON-RPC error means the body was not JSON (`-32700`) or not a JSON-RPC 2.0 request with an id and a method (`-32600`); `401` means the token was refused — the app restarted or rotated it, re-read the discovery file; `403` means the request's `Host`/`Origin` was not loopback; `404` means the app predates the control surface.

### Error codes

| Code | Name | Exit in `uxnan-cli` | Meaning |
|---|---|---|---|
| -32700 | parse error | 1 | the body was not JSON |
| -32600 | invalid request | 1 | not a JSON-RPC 2.0 request with an id and a method |
| -32601 | method not found | 2 | no catalog entry has this name |
| -32602 | invalid params | 2 | an argument or a selector was rejected; the message names what is accepted |
| -32603 | internal | 1 | the app failed while carrying the request out |
| -32001 | group disabled | 5 | the entry's capability group is switched off (`settings.control.disabledGroups`), or the project opted out of terminal reads |
| -32002 | not found | 7 | a selector named nothing |
| -32003 | scope denied | 5 | the token was refused — missing, wrong, or replaced by a restart or a rotation (`uxnan-cli` reports the HTTP `401` under this code) |
| -32004 | unavailable | 3 | the window that owns the resource did not answer within 5 s |
| -32005 | busy | 8 | the target is busy: a run that is already running, or cannot start |
| -32006 | timeout | 6 | a wait ran out of time |
| -32007 | protocol mismatch | 4 | the app and the client speak different protocol versions |

### The MCP door

The same server serves MCP (Streamable HTTP, request/response only) at `{endpoint}/mcp` with the same tokens and gates. `tools/list` is the catalog: each tool's `name` is the entry's tool name (`domain_verb`), its `description` the entry's summary, its `inputSchema` the entry's params schema and its `outputSchema` the entry's result schema — the same two schemas this reference prints. A failed call is reported in-band (`isError: true`, the reason as text). Agents Uxnan launches are already pointed at it; a script may use it too, but the RPC route above is the simpler one for a script.

## Reference

One section per entry. **CLI** is the `uxnan-cli` form; **MCP** the tool name an agent Uxnan launched calls; **Request** the JSON-RPC body a script posts (the `params` shown are an example, not the only valid ones). Every result is an object. A field typed `string | null` is always there but may be `null`; one marked *optional* is left out when there is nothing to say — read it with a default. Fields may be added over time, never renamed or removed without a protocol bump.

### `status`

Report the running Uxnan Desktop: its version, the control protocol version, which capability groups are enabled, and how many projects, terminals and live agents it holds. Call this first to learn what you may ask for.

- **Group:** `read` · read-only
- **MCP:** `uxnan_status`
- **CLI:** `uxnan-cli status`

**Params** — none (send `{}`).

**Result**

- `app` (string) — `uxnan-desktop`.
- `version` (string) — The app version.
- `protocolVersion` (integer) — The control protocol version the app speaks.
- `pid` (integer) — The app's process id.
- `groups` (array of object) — Every capability group, in trust order.
  - `name` (string) — `read`, `ui`, `create`, `converse` or `orchestrate`.
  - `version` (integer) — The group's feature version.
  - `enabled` (boolean) — Whether the group is switched on.
- `caller` (object) — Who the app takes you for, from the token you presented.
  - `kind` (string) — `launch` (a process the app started) or `control` (the user's shell).
  - `terminalId` (string, optional) — For a launch caller: the terminal it said it is (null when it did not say).
- `counts` (object) — What the app holds right now.
  - `projects` (integer) — Registered projects.
  - `terminals` (integer) — Live terminals.
  - `agents` (integer) — Live agents.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "status",
  "params": {}
}
```

### `project/list`

List the projects registered in Uxnan: id, name, folder, whether it is a git repository, the machine it lives on, and its worktrees with branch and change counts.

- **Group:** `read` · read-only
- **MCP:** `project_list`
- **CLI:** `uxnan-cli project ls`

**Params** — none (send `{}`).

**Result**

- `projects` (array of object) — Every registered project.
  - `id` (string) — The project id — what `id:<projectId>` selects.
  - `name` (string) — The display name — what `name:<project name>` selects.
  - `path` (string) — Absolute folder of the project.
  - `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
  - `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
  - `worktrees` (array of object, optional) — The project's worktrees.
    - `path` (string) — Absolute folder of the worktree — what `path:` selects.
    - `branch` (string | null) — The checked-out branch — what `branch:` selects; null when detached or not a repository.
    - `head` (string | null) — The HEAD commit, when known.
    - `isMain` (boolean) — Whether this is the project's primary checkout.
    - `project` (object) — The project it belongs to.
      - `id` (string) — The project id — what `id:<projectId>` selects.
      - `name` (string) — The display name — what `name:<project name>` selects.
      - `path` (string) — Absolute folder of the project.
      - `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
      - `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
    - `agents` (array of object) — The live agents whose terminal was opened inside this worktree.
      - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
      - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
      - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
      - `prompt` (string, optional) — The prompt it is working on, when reported.
      - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
      - `interrupted` (boolean) — Whether it reported being interrupted.
      - `summary` (string, optional) — A short preview of its latest reply, when reported.
      - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
      - `cwd` (string, optional) — The folder its terminal was opened in, when known.
      - `firstSeen` (integer) — Epoch seconds of its first report.
      - `lastUpdate` (integer) — Epoch seconds of its latest report.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "project/list",
  "params": {}
}
```

### `project/show`

Describe one project: the same record `project/list` gives, for the project you select.

- **Group:** `read` · read-only
- **MCP:** `project_show`
- **CLI:** `uxnan-cli project show <project>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `project` | string | yes | Which project: `current` (the project of the terminal you run in), `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`. |

**Result**

- `id` (string) — The project id — what `id:<projectId>` selects.
- `name` (string) — The display name — what `name:<project name>` selects.
- `path` (string) — Absolute folder of the project.
- `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
- `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
- `worktrees` (array of object, optional) — The project's worktrees.
  - `path` (string) — Absolute folder of the worktree — what `path:` selects.
  - `branch` (string | null) — The checked-out branch — what `branch:` selects; null when detached or not a repository.
  - `head` (string | null) — The HEAD commit, when known.
  - `isMain` (boolean) — Whether this is the project's primary checkout.
  - `project` (object) — The project it belongs to.
    - `id` (string) — The project id — what `id:<projectId>` selects.
    - `name` (string) — The display name — what `name:<project name>` selects.
    - `path` (string) — Absolute folder of the project.
    - `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
    - `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
  - `agents` (array of object) — The live agents whose terminal was opened inside this worktree.
    - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
    - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
    - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
    - `prompt` (string, optional) — The prompt it is working on, when reported.
    - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
    - `interrupted` (boolean) — Whether it reported being interrupted.
    - `summary` (string, optional) — A short preview of its latest reply, when reported.
    - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
    - `cwd` (string, optional) — The folder its terminal was opened in, when known.
    - `firstSeen` (integer) — Epoch seconds of its first report.
    - `lastUpdate` (integer) — Epoch seconds of its latest report.
  - `status` (object, optional) — The change counts of a local repository; a plain folder and a host's worktree have none.
    - `dirty` (integer) — Changed entries in the working tree.
    - `ahead` (integer) — Commits ahead of the upstream.
    - `behind` (integer) — Commits behind the upstream.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "project/show",
  "params": {
    "project": "name:uxnan"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal

### `worktree/list`

List worktrees: path, branch, HEAD, whether it is the main checkout, and which live agents run in it. Filter by project or list them all.

- **Group:** `read` · read-only
- **MCP:** `worktree_list`
- **CLI:** `uxnan-cli worktree ls [--project <project>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `project` | string | no | Which project: `current`, `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`. Omit for every project. |

**Result**

- `worktrees` (array of object) — The worktrees, of one project or of all.
  - `path` (string) — Absolute folder of the worktree — what `path:` selects.
  - `branch` (string | null) — The checked-out branch — what `branch:` selects; null when detached or not a repository.
  - `head` (string | null) — The HEAD commit, when known.
  - `isMain` (boolean) — Whether this is the project's primary checkout.
  - `project` (object) — The project it belongs to.
    - `id` (string) — The project id — what `id:<projectId>` selects.
    - `name` (string) — The display name — what `name:<project name>` selects.
    - `path` (string) — Absolute folder of the project.
    - `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
    - `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
  - `agents` (array of object) — The live agents whose terminal was opened inside this worktree.
    - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
    - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
    - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
    - `prompt` (string, optional) — The prompt it is working on, when reported.
    - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
    - `interrupted` (boolean) — Whether it reported being interrupted.
    - `summary` (string, optional) — A short preview of its latest reply, when reported.
    - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
    - `cwd` (string, optional) — The folder its terminal was opened in, when known.
    - `firstSeen` (integer) — Epoch seconds of its first report.
    - `lastUpdate` (integer) — Epoch seconds of its latest report.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "worktree/list",
  "params": {
    "project": "current"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal

### `worktree/show`

Describe one worktree: path, branch, HEAD, the project it belongs to, its dirty/ahead/behind counts and the agents running in it.

- **Group:** `read` · read-only
- **MCP:** `worktree_show`
- **CLI:** `uxnan-cli worktree show <worktree>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `worktree` | string | yes | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |

**Result**

- `path` (string) — Absolute folder of the worktree — what `path:` selects.
- `branch` (string | null) — The checked-out branch — what `branch:` selects; null when detached or not a repository.
- `head` (string | null) — The HEAD commit, when known.
- `isMain` (boolean) — Whether this is the project's primary checkout.
- `project` (object) — The project it belongs to.
  - `id` (string) — The project id — what `id:<projectId>` selects.
  - `name` (string) — The display name — what `name:<project name>` selects.
  - `path` (string) — Absolute folder of the project.
  - `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
  - `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
- `agents` (array of object) — The live agents whose terminal was opened inside this worktree.
  - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
  - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
  - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
  - `prompt` (string, optional) — The prompt it is working on, when reported.
  - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
  - `interrupted` (boolean) — Whether it reported being interrupted.
  - `summary` (string, optional) — A short preview of its latest reply, when reported.
  - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
  - `cwd` (string, optional) — The folder its terminal was opened in, when known.
  - `firstSeen` (integer) — Epoch seconds of its first report.
  - `lastUpdate` (integer) — Epoch seconds of its latest report.
- `status` (object, optional) — The change counts of a local repository; a plain folder and a host's worktree have none.
  - `dirty` (integer) — Changed entries in the working tree.
  - `ahead` (integer) — Commits ahead of the upstream.
  - `behind` (integer) — Commits behind the upstream.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "worktree/show",
  "params": {
    "worktree": "branch:feat/x"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal

### `terminal/list`

List the terminal tabs open in Uxnan: id, title, working directory, the worktree it belongs to, and — when an agent runs in it — the agent, its model and its live state (working, waiting, blocked, done).

- **Group:** `read` · read-only
- **MCP:** `terminal_list`
- **CLI:** `uxnan-cli terminal ls [--worktree <worktree>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `worktree` | string | no | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |

**Result**

- `terminals` (array of object) — Every terminal tab, optionally only those in a worktree.
  - `id` (string) — The tab id — also the PTY id and the agent id; what `id:<terminalId>` selects.
  - `title` (string) — The tab title (a custom one when the person renamed it).
  - `workspace` (string) — The workspace key: the worktree folder, prefixed `ssh:<hostId>::` on a host, empty for the Global space.
  - `cwd` (string, optional) — The folder the shell was opened in.
  - `target` (string) — `local`, or `ssh:<hostId>`.
  - `agentName` (string, optional) — The configured agent launched in this tab, when one was.
  - `agentCommand` (string, optional) — That agent's command (`claude`, `codex`, …).
  - `agentModel` (string, optional) — The model the launch pinned, when the profile pins one.
  - `exited` (boolean) — Whether the shell has exited.
  - `asleep` (boolean) — Whether the tab is asleep (its PTY released, restorable).
  - `agent` (object, optional) — The agent tracked in this tab, once one has reported.
    - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
    - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
    - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
    - `prompt` (string, optional) — The prompt it is working on, when reported.
    - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
    - `interrupted` (boolean) — Whether it reported being interrupted.
    - `summary` (string, optional) — A short preview of its latest reply, when reported.
    - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
    - `cwd` (string, optional) — The folder its terminal was opened in, when known.
    - `firstSeen` (integer) — Epoch seconds of its first report.
    - `lastUpdate` (integer) — Epoch seconds of its latest report.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "terminal/list",
  "params": {
    "worktree": "current"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal

### `terminal/show`

Describe one terminal tab, including the agent state Uxnan knows for it. Use `current` to learn about your own terminal.

- **Group:** `read` · read-only
- **MCP:** `terminal_show`
- **CLI:** `uxnan-cli terminal show <terminal>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `terminal` | string | yes | Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`. |

**Result**

- `id` (string) — The tab id — also the PTY id and the agent id; what `id:<terminalId>` selects.
- `title` (string) — The tab title (a custom one when the person renamed it).
- `workspace` (string) — The workspace key: the worktree folder, prefixed `ssh:<hostId>::` on a host, empty for the Global space.
- `cwd` (string, optional) — The folder the shell was opened in.
- `target` (string) — `local`, or `ssh:<hostId>`.
- `agentName` (string, optional) — The configured agent launched in this tab, when one was.
- `agentCommand` (string, optional) — That agent's command (`claude`, `codex`, …).
- `agentModel` (string, optional) — The model the launch pinned, when the profile pins one.
- `exited` (boolean) — Whether the shell has exited.
- `asleep` (boolean) — Whether the tab is asleep (its PTY released, restorable).
- `agent` (object, optional) — The agent tracked in this tab, once one has reported.
  - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
  - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
  - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
  - `prompt` (string, optional) — The prompt it is working on, when reported.
  - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
  - `interrupted` (boolean) — Whether it reported being interrupted.
  - `summary` (string, optional) — A short preview of its latest reply, when reported.
  - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
  - `cwd` (string, optional) — The folder its terminal was opened in, when known.
  - `firstSeen` (integer) — Epoch seconds of its first report.
  - `lastUpdate` (integer) — Epoch seconds of its latest report.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "terminal/show",
  "params": {
    "terminal": "current"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal

### `agent/list`

List the agents Uxnan is currently tracking: terminal id, agent kind, state (working, waiting, blocked, done), the prompt and tool last reported, and the worktree they run in.

- **Group:** `read` · read-only
- **MCP:** `agent_list`
- **CLI:** `uxnan-cli agent ls`

**Params** — none (send `{}`).

**Result**

- `agents` (array of object) — Every live agent the app tracks.
  - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
  - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
  - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
  - `prompt` (string, optional) — The prompt it is working on, when reported.
  - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
  - `interrupted` (boolean) — Whether it reported being interrupted.
  - `summary` (string, optional) — A short preview of its latest reply, when reported.
  - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
  - `cwd` (string, optional) — The folder its terminal was opened in, when known.
  - `firstSeen` (integer) — Epoch seconds of its first report.
  - `lastUpdate` (integer) — Epoch seconds of its latest report.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "agent/list",
  "params": {}
}
```

### `run/list`

List the orchestration runs (multi-step, multi-agent plans) with their status and step counts.

- **Group:** `read` · read-only
- **MCP:** `run_list`
- **CLI:** `uxnan-cli run ls`

**Params** — none (send `{}`).

**Result**

- `runs` (array of object) — Every saved orchestration run.
  - `id` (string) — The run id — what `run/show` and `run/start` take.
  - `title` (string) — The run's title.
  - `status` (string) — `draft`, `running`, `paused`, `completed`, `failed` or `cancelled`.
  - `createdAt` (integer) — Epoch milliseconds.
  - `updatedAt` (integer) — Epoch milliseconds.
  - `steps` (integer) — How many steps the run has.
  - `completed` (integer) — How many of them are completed.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "run/list",
  "params": {}
}
```

### `run/show`

Describe one orchestration run: every step with its kind, target, dependencies, status and captured output.

- **Group:** `read` · read-only
- **MCP:** `run_show`
- **CLI:** `uxnan-cli run show <run-id>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id from `run/list`. |

**Result**

- `id` (string) — The run id.
- `title` (string) — The run's title.
- `status` (string) — `draft`, `running`, `paused`, `completed`, `failed` or `cancelled`.
- `createdAt` (integer) — Epoch milliseconds.
- `updatedAt` (integer) — Epoch milliseconds.
- `steps` (array of object) — Every step of the run.
  - `id` (string) — The step id, unique within the run (`s1`, `s2`, …).
  - `title` (string) — The step's title.
  - `kind` (string) — `interactive`, `headless` or `gate`.
  - `target` (object) — Where the step runs (an agent type or a specific terminal).
  - `dependsOn` (array of string) — Steps that must complete first.
  - `status` (string) — `pending`, `ready`, `running`, `blocked`, `completed`, `failed` or `skipped`.
  - `prompt` (string) — The step's prompt template.
  - `output` (string | null) — The captured output, once the step ran.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "run/show",
  "params": {
    "run": "run-1a2b"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id

### `automation/list`

List the saved automations (unattended, recurring agent runs): id, name, whether it is enabled, its schedule and its working folder.

- **Group:** `read` · read-only
- **MCP:** `automation_list`
- **CLI:** `uxnan-cli automation ls`

**Params** — none (send `{}`).

**Result**

- `automations` (array of object) — Every saved automation.
  - `id` (string) — The automation id — what `automation/run` takes.
  - `name` (string) — Its name.
  - `description` (string) — Its description, possibly empty.
  - `enabled` (boolean) — Whether its schedule is active.
  - `tags` (array of string) — Free-form labels the list groups by.
  - `workingDir` (string) — The folder a run executes in.
  - `worktreePerRun` (boolean) — Whether every run gets its own worktree.
  - `schedule` (object) — Its schedule: `{ kind: "every", n, unit, startsAt }`, `{ kind: "dailyAt", hour, minute }`, `{ kind: "weekdaysAt", hour, minute }` or `{ kind: "weeklyAt", day, hour, minute }`.
  - `steps` (array of object) — Its steps, in order.
    - `id` (string) — The step id.
    - `title` (string) — The step's title.
    - `agent` (string) — The agent it runs (`claude`, `codex`, …).
    - `model` (string) — The model it pins; empty for the CLI's default.
  - `updatedAt` (integer) — Epoch milliseconds of the last edit.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "automation/list",
  "params": {}
}
```

### `browser/status`

Report the integrated browser's state: whether a page is open, the current URL, whether the in-app browser is enabled, and how opens are routed (in-app / external / ask).

- **Group:** `read` · read-only
- **MCP:** `browser_status`
- **CLI:** `uxnan-cli browser status`

**Params** — none (send `{}`).

**Result**

- `open` (boolean) — Whether a page is open in the integrated browser.
- `url` (string | null) — The page's URL, when one is open.
- `enabled` (boolean) — Whether the integrated browser is enabled in Settings.
- `policy` (string) — How opens are routed: `internal`, `external` or `ask`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/status",
  "params": {}
}
```

### `app/focus`

Bring the Uxnan window to the front.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `app_focus`
- **CLI:** `uxnan-cli app focus`

**Params** — none (send `{}`).

**Result**

- `focused` (boolean) — Always true on success.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "app/focus",
  "params": {}
}
```

### `terminal/reveal`

Show a terminal tab: switch to its workspace and make it the active tab, so the person sees what that agent is doing.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `terminal_reveal`
- **CLI:** `uxnan-cli terminal reveal <terminal>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `terminal` | string | yes | Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`. |

**Result**

- `revealed` (string) — The terminal id now active.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "terminal/reveal",
  "params": {
    "terminal": "id:5f0c…"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal

### `file/open`

Open a file in Uxnan's editor tab (or reveal it if already open). The path must be inside a registered worktree.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `file_open`
- **CLI:** `uxnan-cli file open <path> [--worktree <worktree>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `path` | string | yes | Absolute path of the file, or a path relative to the selected worktree. |
| `worktree` | string | no | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |

**Result**

- `opened` (string) — The absolute path now open in the editor.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "file/open",
  "params": {
    "path": "src/app.ts",
    "worktree": "current"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32002` not found — the path is not inside the worktree, or does not exist

### `file/diff`

Open a file's working-tree diff in Uxnan (the Changes view of its tab), so the person can review what changed. `staged` shows the index-vs-HEAD diff instead.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `file_diff`
- **CLI:** `uxnan-cli file diff <path> [--worktree <worktree>] [--staged]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `path` | string | yes | Path of the file relative to the worktree, or absolute. |
| `worktree` | string | no | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |
| `staged` | boolean | no | Show the staged diff instead of the unstaged one. Default false. |

**Result**

- `opened` (string) — The absolute path whose diff is now shown.
- `staged` (boolean) — Which diff: staged (index vs HEAD) or unstaged.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "file/diff",
  "params": {
    "path": "src/app.ts",
    "worktree": "branch:feat/x",
    "staged": false
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32002` not found — the path is not inside the worktree, or does not exist

### `browser/open`

Open the integrated in-app browser and load a URL. Use it to preview or test a web app, page or dev server you are building (for example http://localhost:3000). Uxnan routes the open per the user's setting (in-app, external browser, or ask).

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_open`
- **CLI:** `uxnan-cli browser open <url>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `url` | string | yes | Absolute URL to open, e.g. http://localhost:3000 or https://example.com. |

**Result**

- `requested` (string) — The URL handed to the link policy.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/open",
  "params": {
    "url": "http://localhost:3000"
  }
}
```

### `browser/navigate`

Navigate the integrated browser to a new URL (opening the panel first if it is not open). Same routing as browser/open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_navigate`
- **CLI:** `uxnan-cli browser navigate <url>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `url` | string | yes | Absolute URL to navigate to. |

**Result**

- `requested` (string) — The URL handed to the link policy.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/navigate",
  "params": {
    "url": "http://localhost:3000/settings"
  }
}
```

### `browser/reload`

Reload the current page in the integrated browser. Use it after you change code and want to see the result. Errors if no page is open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_reload`
- **CLI:** `uxnan-cli browser reload`

**Params** — none (send `{}`).

**Result**

- `reloaded` (boolean) — Always true on success.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/reload",
  "params": {}
}
```

### `browser/back`

Go back one entry in the integrated browser's history. Errors if no page is open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_back`
- **CLI:** `uxnan-cli browser back`

**Params** — none (send `{}`).

**Result**

- `navigated` (string) — `back`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/back",
  "params": {}
}
```

### `browser/forward`

Go forward one entry in the integrated browser's history. Errors if no page is open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_forward`
- **CLI:** `uxnan-cli browser forward`

**Params** — none (send `{}`).

**Result**

- `navigated` (string) — `forward`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/forward",
  "params": {}
}
```

### `worktree/create`

Create a git worktree on a new branch of a project — where Uxnan's worktree-location policy puts it — make it the active worktree, and optionally launch an agent in it with a first message. Use it to give a subtask its own isolated space and agent instead of running `git worktree add` yourself: Uxnan then sees, lists and can stop it. Returns a receipt with the worktree and, when an agent was launched, its terminal id.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `worktree_create`
- **CLI:** `uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing] [--agent <agent>] [--prompt-file <file>] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `project` | string | yes | Which project: `current` (the project of the terminal you run in), `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`. |
| `branch` | string | yes | The new branch name (also the worktree's folder name under the policy's root). |
| `base` | string | no | The ref to branch from. Default: the project's default base (its main branch). |
| `fromExisting` | boolean | no | Check out an existing branch named `branch` instead of creating it. Default false. |
| `agent` | string | no | Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id. Omit for no agent (a plain terminal). |
| `prompt` | string | no | A first message for the launched agent, typed into it once it is ready (queued behind Uxnan's backpressure, so it is never pasted into a busy agent). Requires `agent`. At most 64 KiB. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `worktree` (object) — The worktree, as `worktree/list` describes it.
  - `path` (string) — Absolute folder of the worktree — what `path:` selects.
  - `branch` (string | null) — The checked-out branch — what `branch:` selects; null when detached or not a repository.
  - `head` (string | null) — The HEAD commit, when known.
  - `isMain` (boolean) — Whether this is the project's primary checkout.
  - `project` (object) — The project it belongs to.
    - `id` (string) — The project id — what `id:<projectId>` selects.
    - `name` (string) — The display name — what `name:<project name>` selects.
    - `path` (string) — Absolute folder of the project.
    - `target` (string) — `local`, or `ssh:<hostId>` for a project on a host.
    - `isGit` (boolean) — Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches.
  - `agents` (array of object) — The live agents whose terminal was opened inside this worktree.
    - `terminalId` (string) — The terminal it runs in — its `UXNAN_AGENT_ID`.
    - `kind` (string, optional) — `claude`, `codex`, … when its hooks said.
    - `status` (string) — `working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished).
    - `prompt` (string, optional) — The prompt it is working on, when reported.
    - `tool` (string, optional) — The tool in use (`file_edit`, `bash`, …), when reported.
    - `interrupted` (boolean) — Whether it reported being interrupted.
    - `summary` (string, optional) — A short preview of its latest reply, when reported.
    - `sessionId` (string, optional) — The provider's own session id, when captured — what its `--resume` takes.
    - `cwd` (string, optional) — The folder its terminal was opened in, when known.
    - `firstSeen` (integer) — Epoch seconds of its first report.
    - `lastUpdate` (integer) — Epoch seconds of its latest report.
- `adopted` (boolean) — Whether the window listed it, made it active and launched the agent. False when the window was not there; the worktree exists either way.
- `terminal` (object, optional) — `{ id, agent }` of the launched agent's terminal — only when `agent` was given and the window adopted.
- `warning` (string, optional) — Why the window did not adopt, when it did not.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "worktree/create",
  "params": {
    "project": "current",
    "branch": "feat/subtask",
    "agent": "claude",
    "prompt": "Implement the parser described in TASK.md.",
    "idempotencyKey": "3d1f…"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32602` invalid params — the branch name is invalid, the base does not exist, or `prompt` was given without `agent`

### `terminal/create`

Open a new terminal tab in a worktree, optionally launching a configured agent in it with a first message. Returns a receipt with the terminal id.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `terminal_create`
- **CLI:** `uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `worktree` | string | yes | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |
| `agent` | string | no | Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id. Omit for no agent (a plain terminal). |
| `title` | string | no | A tab title. Default: the worktree folder name. |
| `prompt` | string | no | A first message for the launched agent, typed into it once it is ready (queued behind Uxnan's backpressure, so it is never pasted into a busy agent). Requires `agent`. At most 64 KiB. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `terminal` (object) — The new tab.
  - `id` (string) — The new tab's id.
  - `agent` (string, optional) — The launched agent's name, when one was.
- `worktree` (string) — The worktree folder the tab opened in.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "terminal/create",
  "params": {
    "worktree": "branch:feat/subtask",
    "title": "build",
    "idempotencyKey": "9c2e…"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32002` not found — `agent` names no configured agent, or the agent has no command to launch

### `run/start`

Start (or re-run) a saved orchestration run by id: every step is reset and the engine begins dispatching. Refused with the validation errors when the run is not runnable. Only saved runs can be started; there is no way to inject steps from here.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `run_start`
- **CLI:** `uxnan-cli run start <run-id> [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id from `run/list`. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `run` (object) — The run, now started.
  - `id` (string) — The run id.
  - `status` (string) — `running` once started.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "run/start",
  "params": {
    "run": "run-1a2b",
    "idempotencyKey": "77aa…"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id
- `-32005` busy — the run cannot start (already running, or invalid); `data.errors` lists why

### `automation/run`

Run a saved automation now, as a manual run of the same headless runner its schedule uses. Only saved definitions can be run.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `automation_run`
- **CLI:** `uxnan-cli automation run <automation-id> [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `automation` | string | yes | The automation id from `automation/list`. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `automation` (object) — The automation, now running.
  - `id` (string) — The automation id.
  - `started` (boolean) — Always true on success: the headless runner was started.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "automation/run",
  "params": {
    "automation": "nightly-lint"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id

### `agent/send`

Send a complete message to a running agent, as one paste-and-submit — never as keystrokes. By default the message waits in Uxnan's backpressure queue until that agent is free (not working); `force` types it now, which interrupts whatever the agent is doing and should be rare. Only an agent's terminal can receive a message; a plain shell has nobody to read it. Use `agent/wait` afterwards to learn when the agent has finished.

- **Group:** `converse` · mutates (receipted, audited)
- **MCP:** `agent_send`
- **CLI:** `uxnan-cli agent send --to <terminal> --message-file <file> [--force] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `terminal` | string | yes | Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`. |
| `message` | string | yes | The whole message, as the person would type it. At most 64 KiB. |
| `force` | boolean | no | Type it now even if the agent is working. Default false. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `terminal` (string) — The terminal the message was handed to.
- `delivery` (string) — `queued` (waits for the agent to be free), `delivered` (it was free) or `forced`.
- `bytes` (integer) — The message's size.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "agent/send",
  "params": {
    "terminal": "id:5f0c…",
    "message": "Now add tests for the parser."
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32002` not found — the terminal has no live agent to receive the message

### `agent/wait`

Wait until an agent reaches a state, as reported by its own hooks: `idle` (its turn finished — the state to wait for after sending a message), `waiting` (it stopped to ask the person something), or `exit` (its terminal is gone). Returns the state reached and how long it took, or a timeout. One call waits at most 15 seconds; call again to keep waiting (uxnan-cli does this for you and prints a heartbeat).

- **Group:** `converse` · read-only
- **MCP:** `agent_wait`
- **CLI:** `uxnan-cli agent wait --to <terminal> --for idle|waiting|exit [--timeout <seconds>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `terminal` | string | yes | Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`. |
| `for` | string | yes | `idle`, `waiting` or `exit`. |
| `timeoutMs` | integer | no | How long this call may wait, in milliseconds. Capped at 15000. Default 15000. |

**Result**

- `terminal` (string) — The terminal waited on.
- `reached` (string) — `idle`, `waiting` or `exit` — the state reached.
- `waitedMs` (integer) — How long this call waited.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "agent/wait",
  "params": {
    "terminal": "id:5f0c…",
    "for": "idle",
    "timeoutMs": 15000
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32006` timeout — the state was not reached within `timeoutMs` (at most 15 000 per call); `data.current` says where the agent is — call again to keep waiting

### `terminal/read`

Read the last lines of a terminal's screen as plain text (escapes removed, blank rows dropped), with secrets redacted — tokens, keys, `Authorization` headers, `password=`. Use it to see what an agent printed or asked. Every read is written to Uxnan's audit log; a project can be opted out of reads (`settings.control.terminalReadDisabledProjects`).

- **Group:** `converse` · read-only
- **MCP:** `terminal_read`
- **CLI:** `uxnan-cli terminal read <terminal> [--lines <n>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `terminal` | string | yes | Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`. |
| `lines` | integer | no | How many lines from the bottom. Default 120, at most 2000. |

**Result**

- `terminal` (string) — The terminal read.
- `lines` (integer) — How many lines came back.
- `text` (string) — The screen text, escapes removed, blank rows dropped, secrets redacted.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "terminal/read",
  "params": {
    "terminal": "id:5f0c…",
    "lines": 60
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32001` group disabled — the terminal's project is listed in `settings.control.terminalReadDisabledProjects`

### `orchestration/reportResult`

Report the final result of the task Uxnan's orchestration run gave you, so the run captures your output verbatim and can feed it to the next step. Call it once, when you are done. Pass your UXNAN_AGENT_ID as agentId.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `orchestration_report_result`
- **CLI:** no dedicated command — `uxnan-cli rpc orchestration/reportResult --params '<json>'`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `agentId` | string | yes | The value of your UXNAN_AGENT_ID environment variable (identifies which run step you are). |
| `result` | string | yes | Your full result/output for the task, captured verbatim by the run. |
| `summary` | string | no | Optional one-line summary of the result. |

**Result**

- `reported` (string) — `result`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "orchestration/reportResult",
  "params": {
    "agentId": "5f0c…",
    "result": "Done: parser implemented, 12 tests green.",
    "summary": "parser done"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32004` unavailable — the window is not there to receive the report

### `orchestration/reportProgress`

Report a short progress update for your current orchestration-run step (optional; it surfaces what you are doing in the run view). Pass your UXNAN_AGENT_ID as agentId.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `orchestration_report_progress`
- **CLI:** no dedicated command — `uxnan-cli rpc orchestration/reportProgress --params '<json>'`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `agentId` | string | yes | The value of your UXNAN_AGENT_ID environment variable. |
| `message` | string | yes | A one-line progress message. |

**Result**

- `reported` (string) — `progress`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "orchestration/reportProgress",
  "params": {
    "agentId": "5f0c…",
    "message": "Writing tests"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32004` unavailable — the window is not there to receive the report

## Output and exit status

Human-readable output goes to stdout; errors go to stderr. `--json` prints the raw result object, stable across versions: fields may be added, never renamed or removed without a protocol bump. Prefer `--json` from a script or an agent.

`agent send` queues a whole message for a running agent until it is free (`--force` types it now and interrupts); `agent wait --for idle` blocks until the agent's own hooks report its turn finished, printing a heartbeat to stderr every 15 s; `terminal read` returns the screen with secrets redacted and is written to the audit log. Together they are the loop: send, wait, read.

A `create` entry answers with a **receipt**: `{ requestId, idempotencyKey?, … }` plus what was created. Pass `--idempotency-key` (any string you choose, e.g. a UUID) and a retry of the same call returns the first receipt instead of creating a second worktree, terminal or run — so a lost reply is safe to retry. Every `create` call, done or refused, is written to `control-audit.log` in the app's data directory (prompt text is recorded as its length only).

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | the app failed while carrying the request out |
| 2 | usage: unknown method, bad or missing argument, malformed selector |
| 3 | Uxnan Desktop is not running, or its window did not answer |
| 4 | the app and the CLI speak different protocol versions (or the app predates the control surface) |
| 5 | denied: the capability group is switched off, or the token was refused |
| 6 | timed out |
| 7 | the selector named nothing |
| 8 | the target is busy |
