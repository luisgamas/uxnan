# Uxnan control surface (protocol v1)

Operate the running Uxnan Desktop from a shell or from an agent. Two doors to one catalog: MCP tools (available with nothing to install inside every terminal Uxnan launches) and `uxnan-cli` (any shell of the same user). A script in any language can take a third door, the JSON-RPC route the CLI itself uses — see *Calling the RPC route directly* in the full form (`--full`).

## Commands

```
uxnan-cli status
uxnan-cli project ls | show <project>
uxnan-cli worktree ls [--project <project>] | show <worktree>
uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing]
                          [--agent <agent>] [--prompt-file <file>] [--unattended] [--idempotency-key <key>]
uxnan-cli terminal ls [--worktree <worktree>] | show <terminal> | reveal <terminal> | close <terminal>
uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>]
                          [--unattended] [--idempotency-key <key>]
uxnan-cli agent ls
uxnan-cli agent send --to <terminal> --message-file <file> [--force] [--idempotency-key <key>]
uxnan-cli agent wait --to <terminal> --for idle|waiting|exit [--timeout <seconds>]
uxnan-cli terminal read <terminal> [--lines <n>]
uxnan-cli run ls | show <run-id> | start <run-id> [--idempotency-key <key>]
uxnan-cli run create --title <t> | finish <run-id> --outcome success|failure|blocked [--summary <text>]
uxnan-cli task create --run <run-id> --title <t> --prompt-file <file> [--depends-on <task>]... [--headless <agent>]
uxnan-cli task ls --run <run-id> | update --run <run-id> <task> [--status completed|failed|skipped] [--output <text>]
uxnan-cli worker start --run <run-id> --task <task> --agent <agent> [--worktree current|new|<worktree>] [--unattended | --attended]
uxnan-cli inbox check --run <run-id> [--ack <id>]... [--wait] [--timeout <seconds>]
uxnan-cli ask --question <text> [--option <o>]...      # from a worker's terminal
uxnan-cli answer --run <run-id> --question <id> --answer <text> [--reject]
uxnan-cli automation ls | run <automation-id> [--idempotency-key <key>]
uxnan-cli app focus
uxnan-cli file open <path> [--worktree <worktree>]
uxnan-cli file diff <path> [--worktree <worktree>] [--staged]
uxnan-cli browser open <url> | navigate <url> | reload | back | forward | status
uxnan-cli browser snapshot | screenshot --out <file> | console | wait <text> | click <ref> | type <ref> <text> | press <key> | scroll
uxnan-cli rpc <method> [--params '<json>']      # any catalog entry, raw
uxnan-cli skills get control [--full]           # this guide / the full reference
Global: --json (stable machine output), --timeout <seconds>
```

## Selectors

- `current` — your own terminal, and from it your worktree and project. Works inside a terminal Uxnan launched (it knows `UXNAN_AGENT_ID`, and the MCP tools send it with every call); from another shell, use an explicit form.
- Scope: from a terminal Uxnan launched, every listing and selector is confined to that terminal's project (anything else is *scope denied*); from the user's shell, `uxnan-cli` reaches every project.
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
- `browser/status` (MCP tool `browser_status`) — Report the integrated browser of your workspace: whether a page is open there, its URL, title and load state, whether the person can see it, whether the in-app browser is enabled and how opens are routed (in-app / external / ask).
- `browser/snapshot` (MCP tool `browser_snapshot`) — Read your workspace's browser page as a compact outline of what is visible — headings, text, links, buttons, fields with their values and state — where every interactive element carries a `ref` for browser_click / browser_type.
- `browser/screenshot` (MCP tool `browser_screenshot`) — Capture what your workspace's browser page looks like, as a PNG image — for checking layout and visual changes that an outline cannot show.
- `browser/console` (MCP tool `browser_console`) — Read what your workspace's browser page logged to its console since it loaded — messages, warnings, errors and uncaught exceptions — to debug the web app you are building.
- `browser/wait` (MCP tool `browser_wait`) — Wait until your workspace's browser page shows some text (case-insensitive), or the time runs out — for content that appears after a request or an animation, instead of guessing a delay.

### `ui` (v1) — actions on the window that change nothing on disk or in a process

- `app/focus` (MCP tool `app_focus`) — Bring the Uxnan window to the front.
- `terminal/reveal` (MCP tool `terminal_reveal`) — Show a terminal tab: switch to its workspace and make it the active tab, so the person sees what that agent is doing.
- `file/open` (MCP tool `file_open`) — Open a file in Uxnan's editor tab (or reveal it if already open).
- `file/diff` (MCP tool `file_diff`) — Open a file's working-tree diff in Uxnan (the Changes view of its tab), so the person can review what changed.
- `browser/open` (MCP tool `browser_open`) — Open the integrated in-app browser of your workspace and load a URL; answers once the page has loaded (or 15 s passed).
- `browser/navigate` (MCP tool `browser_navigate`) — Navigate your workspace's integrated browser to a new URL (opening it first if it is not open).
- `browser/reload` (MCP tool `browser_reload`) — Reload your workspace's page in the integrated browser and answer once it has loaded again.
- `browser/back` (MCP tool `browser_back`) — Go back one entry in your workspace's browser history and answer with the page it landed on.
- `browser/forward` (MCP tool `browser_forward`) — Go forward one entry in your workspace's browser history and answer with the page it landed on.
- `browser/click` (MCP tool `browser_click`) — Click an element of your workspace's browser page, by the `ref` browser_snapshot gave it; answers once any navigation it caused has loaded.
- `browser/type` (MCP tool `browser_type`) — Type text into a field of your workspace's browser page (a text input, textarea or editable element), by its `ref`; replaces what is there unless `clear` is false.
- `browser/press` (MCP tool `browser_press`) — Press a key in your workspace's browser page, on the element that has focus: `Enter` (submits a form field's form — which the person approves — or activates a focused button), `Tab` (`shift` for back), `Escape`, arrows, `PageUp`/`PageDown`, `Home`/`End`, `Backspace`, `Delete`, `Space`.
- `browser/scroll` (MCP tool `browser_scroll`) — Scroll your workspace's browser page — or one scrollable element, by its `ref` — by a fraction of its visible height or width, to reach content a snapshot left out.

### `create` (v1) — create a worktree or a terminal, start a saved run or automation

- `worktree/create` (MCP tool `worktree_create`) — Create a git worktree on a new branch of a project — where Uxnan's worktree-location policy puts it — list it in the sidebar, and optionally launch an agent in it with a first message.
- `terminal/create` (MCP tool `terminal_create`) — Open a new terminal tab in a worktree, optionally launching a configured agent in it with a first message.
- `terminal/close` (MCP tool `terminal_close`) — Close a terminal tab: one the surface opened (`terminal/create`, `worktree/create`, `worker/start`) once its agent is no longer working, or any terminal whose shell has exited — the way a coordinator collects the workers it started.
- `run/start` (MCP tool `run_start`) — Start (or re-run) a saved orchestration run by id: every step is reset and the engine begins dispatching.
- `automation/run` (MCP tool `automation_run`) — Run a saved automation now, as a manual run of the same headless runner its schedule uses.

### `converse` (v1) — talk to a running agent

- `agent/send` (MCP tool `agent_send`) — Send a complete message to a running agent, as one paste-and-submit — never as keystrokes.
- `agent/wait` (MCP tool `agent_wait`) — Wait until an agent reaches a state, as reported by its own hooks: `idle` (its turn finished — the state to wait for after sending a message), `waiting` (it stopped to ask the person something), or `exit` (its terminal is gone).
- `terminal/read` (MCP tool `terminal_read`) — Read the last lines of a terminal's screen as plain text (escapes removed, blank rows dropped), with secrets redacted — tokens, keys, `Authorization` headers, `password=`.

### `orchestrate` (v2) — drive a run as its coordinator: tasks, workers, an inbox, questions; a worker reports back

- `orchestration/reportResult` (MCP tool `orchestration_report_result`) — Report the final result of the task Uxnan's orchestration run gave you, so the run captures your output verbatim and can feed it to the next step.
- `orchestration/reportProgress` (MCP tool `orchestration_report_progress`) — Report a short progress update for your current orchestration-run step (optional; it surfaces what you are doing in the run view).
- `run/create` (MCP tool `run_create`) — Create an orchestration run you will drive as its coordinator: an empty, running run to which you add tasks (`task/create`), start workers (`worker/start`) and read the inbox (`inbox/check`) until you finish it (`run/finish`).
- `run/finish` (MCP tool `run_finish`) — Finish a run you drive: record its outcome and summary and end it.
- `task/create` (MCP tool `task_create`) — Add a task to a run you drive.
- `task/list` (MCP tool `task_list`) — The tasks of a run with their state, dispatch, worker terminal, captured output and open questions — what a coordinator reads to decide what to start next.
- `task/update` (MCP tool `task_update`) — Change a task of a run you drive: its title, prompt or dependencies while it has not started, or close it by hand (`completed`, `failed` or `skipped`) with an output — for work you did yourself or decided to drop.
- `worker/start` (MCP tool `worker_start`) — Start a worker for a ready task: open a terminal — in the current worktree, in a new worktree on a new branch (`worktree: "new"`), or in a given one — launch the agent in it and hand it the task with a preamble that names its task and dispatch, tells it to report exactly once and how to ask you a question.
- `inbox/check` (MCP tool `inbox_check`) — Read the inbox of a run you drive: workers finishing or failing, questions waiting for your answer, progress lines.
- `question/ask` (MCP tool `question_ask`) — As a worker, ask the run's coordinator a question and wait for the answer — instead of guessing or asking a prompt nobody reads.
- `question/answer` (MCP tool `question_answer`) — Answer a worker's question in a run you drive (it came to your inbox as `question`).

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

Before using it: refuse a file readable by other users (a mode other than `0600` on Unix; on Windows an access list granting any account but yours, SYSTEM and Administrators); refuse a `protocolVersion` other than 1; confirm that `pid` is alive **and** started at `processStart` (±2 s) — a file left behind by a crash then points nowhere. The app writes the file on start, removes it on a clean exit, and mints a new token on every start (and on a rotation), so read the file per session, not once.

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
| -32003 | scope denied | 5 | the selector names a project, worktree or terminal outside the caller's scope: a launch token reaches only the project its terminal runs in, and a launch request that named no terminal reaches none (`uxnan-cli` also reports a refused token, HTTP `401`, under this code) |
| -32004 | unavailable | 3 | the window that owns the resource did not answer within 5 s |
| -32005 | busy | 8 | the target is busy: a run that is already running or cannot start, or an agent launch past the launch budget (`data.live` / `data.cap`) |
| -32006 | timeout | 6 | a wait ran out of time |
| -32007 | protocol mismatch | 4 | the app and the client speak different protocol versions |
| -32008 | refused | 9 | a safety policy or the person refused it: a browser page action that is never allowed (typing into a password field), a site outside this machine the person has not allowed, or an approval the person declined or did not answer in time |

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
- `cli` (object) — Where `uxnan-cli` is on this machine.
  - `bundled` (string | null) — The binary shipped inside the app, next to its executable — on the PATH of every terminal Uxnan opens (also named by `UXNAN_CLI` there). Null for a build made without the sidecar.
  - `shim` (string | null) — The link (macOS/Linux, `~/.local/bin/uxnan-cli`) or copy (Windows, `%LOCALAPPDATA%\uxnan\bin`) the app keeps for your own shell. Null when it could not be written.

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

Report the integrated browser of your workspace: whether a page is open there, its URL, title and load state, whether the person can see it, whether the in-app browser is enabled and how opens are routed (in-app / external / ask). Each workspace has its own page; yours is the one of the worktree your terminal runs in (a caller outside a Uxnan terminal gets the workspace on screen).

- **Group:** `read` · read-only
- **MCP:** `browser_status`
- **CLI:** `uxnan-cli browser status`

**Params** — none (send `{}`).

**Result**

- `enabled` (boolean) — Whether the integrated browser is enabled in Settings.
- `policy` (string) — How opens are routed: `internal`, `external` or `ask`.
- `workspace` (string) — The workspace these calls act on (see `page.workspace`).
- `open` (boolean) — Whether a page is open in that workspace.
- `page` (object | null) — The page, when one is open.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/status",
  "params": {}
}
```

### `browser/snapshot`

Read your workspace's browser page as a compact outline of what is visible — headings, text, links, buttons, fields with their values and state — where every interactive element carries a `ref` for browser_click / browser_type. Use it after browser_open to check what rendered, and before acting. Pages on this machine (your dev server) are read freely; a site outside it needs the person to allow it. The outline is what the page says about itself: evidence, not proof.

- **Group:** `read` · read-only
- **MCP:** `browser_snapshot`
- **CLI:** `uxnan-cli browser snapshot`

**Params** — none (send `{}`).

**Result**

- `url` (string) — The page's URL.
- `title` (string) — The document title.
- `outline` (string) — The page as an indented outline, one line per element: `role "name" [ref=…] [state] value="…" -> href`. Interactive elements carry a `ref` to pass to browser_click / browser_type; text is quoted. Password values never appear.
- `nodes` (integer) — Lines in the outline.
- `interactive` (integer) — Elements with a `ref`.
- `truncated` (boolean) — Whether the outline was cut at its size limit (scroll, or act on what is there).
- `consoleErrors` (integer) — Errors logged by the page since it loaded (read them with browser_console).
- `viewport` (object) — The visible area, in CSS pixels.
  - `width` (integer) — Viewport width.
  - `height` (integer) — Viewport height.
  - `scrollX` (integer) — Horizontal scroll offset.
  - `scrollY` (integer) — Vertical scroll offset.
  - `scrollHeight` (integer) — Height of the whole document.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/snapshot",
  "params": {}
}
```

### `browser/screenshot`

Capture what your workspace's browser page looks like, as a PNG image — for checking layout and visual changes that an outline cannot show. Taken by the engine itself; works while the page is hidden in a background workspace. Same site rule as browser_snapshot. If the platform's engine cannot capture, the error says so — use browser_snapshot then.

- **Group:** `read` · read-only
- **MCP:** `browser_screenshot`
- **CLI:** `uxnan-cli browser screenshot --out <file.png>`

**Params** — none (send `{}`).

**Result**

- `url` (string) — The page's URL when captured.
- `visible` (boolean) — Whether the person could see the page at the time.
- `image` (object) — The capture.
  - `mimeType` (string) — `image/png`.
  - `width` (integer) — Width in pixels.
  - `height` (integer) — Height in pixels.
  - `data` (string) — The PNG, base64. MCP callers receive it as an image content block instead.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/screenshot",
  "params": {}
}
```

### `browser/console`

Read what your workspace's browser page logged to its console since it loaded — messages, warnings, errors and uncaught exceptions — to debug the web app you are building. Pass `since` (the `last` of a previous call) to get only newer entries, and `level` to filter.

- **Group:** `read` · read-only
- **MCP:** `browser_console`
- **CLI:** `uxnan-cli browser console [--since <n>] [--level all|warn|error]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `since` | integer | no | Only entries after this sequence number (the `last` a previous call returned). Default 0: everything kept. |
| `level` | string: `all` \| `warn` \| `error` | no | `error` (errors only), `warn` (warnings and errors) or `all` (default). |

**Result**

- `entries` (array of object) — The entries, oldest first (the page keeps the latest 300).
  - `seq` (integer) — Sequence number, increasing.
  - `level` (string) — `info`, `debug`, `warn` or `error`.
  - `text` (string) — The message (cut at 1000 characters).
  - `at` (integer) — Epoch milliseconds.
- `dropped` (integer) — Entries discarded because the page logged more than it keeps.
- `last` (integer) — The newest sequence number — pass it as `since` next time.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/console",
  "params": {
    "level": "error"
  }
}
```

### `browser/wait`

Wait until your workspace's browser page shows some text (case-insensitive), or the time runs out — for content that appears after a request or an animation, instead of guessing a delay.

- **Group:** `read` · read-only
- **MCP:** `browser_wait`
- **CLI:** `uxnan-cli browser wait <text> [--for <seconds>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | The text to wait for. |
| `timeout` | number | no | Seconds to wait, at most 30. Default 10. |

**Result**

- `found` (boolean) — Whether the text appeared.
- `waitedMs` (integer) — How long it waited.
- `page` (object | null) — The page when the wait ended.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/wait",
  "params": {
    "text": "Saved",
    "timeout": 5
  }
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

Open the integrated in-app browser of your workspace and load a URL; answers once the page has loaded (or 15 s passed). Use it to preview or test a web app, page or dev server you are building (for example http://localhost:3000). The page opens in the workspace your terminal belongs to — when that is not the one on screen it loads hidden, without disturbing the person. Uxnan routes the open per the user's setting (in-app, external browser, or ask). Only http(s) addresses open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_open`
- **CLI:** `uxnan-cli browser open <url>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `url` | string | yes | Absolute URL to open, e.g. http://localhost:3000 or https://example.com. |

**Result**

- `requested` (string) — The URL handed to the link policy.
- `routed` (string) — Where it went: `browser` (the in-app browser — `page` says what loaded), `external` (the person's system browser) or `ask` (the person is choosing).
- `page` (object | null) — The page once loaded, when `routed` is `browser`.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

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

Navigate your workspace's integrated browser to a new URL (opening it first if it is not open). Same routing, waiting and result as browser/open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_navigate`
- **CLI:** `uxnan-cli browser navigate <url>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `url` | string | yes | Absolute URL to navigate to. |

**Result**

- `requested` (string) — The URL handed to the link policy.
- `routed` (string) — `browser`, `external` or `ask` — see browser/open.
- `page` (object | null) — The page once loaded, when `routed` is `browser`.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

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

Reload your workspace's page in the integrated browser and answer once it has loaded again. Use it after you change code and want to see the result. Errors if no page is open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_reload`
- **CLI:** `uxnan-cli browser reload`

**Params** — none (send `{}`).

**Result**

- `reloaded` (boolean) — Always true on success.
- `page` (object | null) — The page after the reload.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

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

Go back one entry in your workspace's browser history and answer with the page it landed on. Errors if no page is open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_back`
- **CLI:** `uxnan-cli browser back`

**Params** — none (send `{}`).

**Result**

- `navigated` (string) — `back`.
- `moved` (boolean) — Whether the page actually changed (false at the start of the history).
- `page` (object | null) — The page after the step.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

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

Go forward one entry in your workspace's browser history and answer with the page it landed on. Errors if no page is open.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_forward`
- **CLI:** `uxnan-cli browser forward`

**Params** — none (send `{}`).

**Result**

- `navigated` (string) — `forward`.
- `moved` (boolean) — Whether the page actually changed (false at the end of the history).
- `page` (object | null) — The page after the step.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/forward",
  "params": {}
}
```

### `browser/click`

Click an element of your workspace's browser page, by the `ref` browser_snapshot gave it; answers once any navigation it caused has loaded. The element is scrolled into view and must be visible, enabled and not covered by something else. On your own local pages ordinary clicks just run; submitting a form or anything that reads as deleting, paying, publishing or signing in waits for the person to approve it (the call blocks up to 45 s, then is refused — tell the person and call again).

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_click`
- **CLI:** `uxnan-cli browser click <ref> [--snapshot]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `ref` | string | yes | The element, by the `ref` a browser_snapshot of the current page gave it (e.g. `k3p9:e12`). A reference from before a navigation or reload is refused — take a new snapshot. |
| `snapshot` | boolean | no | Also return the page's new snapshot (as browser_snapshot would) in `snapshot`, saving a call. Default false. |

**Result**

- `done` (string) — `click`.
- `navigated` (boolean) — Whether a new document loaded as a result (the action's navigation is waited for, up to 10 s).
- `page` (object | null) — The page after the action.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.
- `effect` (string, optional) — What happened beyond the action itself: for browser_press, `focus` (moved focus), `submit` (submitted the form), `click` (activated the focused element) or `none`; for browser_click, `opened here` when a link meant for a new window loaded in this page (the browser has no tabs).
- `chosen` (string, optional) — For browser_type into a select: the option chosen.
- `scrollX` (integer, optional) — For browser_scroll: the page's horizontal offset after it.
- `scrollY` (integer, optional) — For browser_scroll: the page's vertical offset after it.
- `snapshot` (object, optional) — The new snapshot, when `snapshot: true` was passed.
  - `url` (string) — The page's URL.
  - `title` (string) — The document title.
  - `outline` (string) — The page as an indented outline, one line per element: `role "name" [ref=…] [state] value="…" -> href`. Interactive elements carry a `ref` to pass to browser_click / browser_type; text is quoted. Password values never appear.
  - `nodes` (integer) — Lines in the outline.
  - `interactive` (integer) — Elements with a `ref`.
  - `truncated` (boolean) — Whether the outline was cut at its size limit (scroll, or act on what is there).
  - `consoleErrors` (integer) — Errors logged by the page since it loaded (read them with browser_console).
  - `viewport` (object) — The visible area, in CSS pixels.
    - `width` (integer) — Viewport width.
    - `height` (integer) — Viewport height.
    - `scrollX` (integer) — Horizontal scroll offset.
    - `scrollY` (integer) — Vertical scroll offset.
    - `scrollHeight` (integer) — Height of the whole document.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/click",
  "params": {
    "ref": "k3p9:e12"
  }
}
```

### `browser/type`

Type text into a field of your workspace's browser page (a text input, textarea or editable element), by its `ref`; replaces what is there unless `clear` is false. For a select, `text` picks the option with that label or value. Never works on password or file fields — ask the person. The text is not logged, only its length.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_type`
- **CLI:** `uxnan-cli browser type <ref> <text> [--append] [--snapshot]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `ref` | string | yes | The element, by the `ref` a browser_snapshot of the current page gave it (e.g. `k3p9:e12`). A reference from before a navigation or reload is refused — take a new snapshot. |
| `text` | string | yes | What to type (or, for a select, the option's label or value). |
| `clear` | boolean | no | Replace the field's current value (default true); false appends. |
| `snapshot` | boolean | no | Also return the page's new snapshot (as browser_snapshot would) in `snapshot`, saving a call. Default false. |

**Result**

- `done` (string) — `type`.
- `navigated` (boolean) — Whether a new document loaded as a result (the action's navigation is waited for, up to 10 s).
- `page` (object | null) — The page after the action.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.
- `effect` (string, optional) — What happened beyond the action itself: for browser_press, `focus` (moved focus), `submit` (submitted the form), `click` (activated the focused element) or `none`; for browser_click, `opened here` when a link meant for a new window loaded in this page (the browser has no tabs).
- `chosen` (string, optional) — For browser_type into a select: the option chosen.
- `scrollX` (integer, optional) — For browser_scroll: the page's horizontal offset after it.
- `scrollY` (integer, optional) — For browser_scroll: the page's vertical offset after it.
- `snapshot` (object, optional) — The new snapshot, when `snapshot: true` was passed.
  - `url` (string) — The page's URL.
  - `title` (string) — The document title.
  - `outline` (string) — The page as an indented outline, one line per element: `role "name" [ref=…] [state] value="…" -> href`. Interactive elements carry a `ref` to pass to browser_click / browser_type; text is quoted. Password values never appear.
  - `nodes` (integer) — Lines in the outline.
  - `interactive` (integer) — Elements with a `ref`.
  - `truncated` (boolean) — Whether the outline was cut at its size limit (scroll, or act on what is there).
  - `consoleErrors` (integer) — Errors logged by the page since it loaded (read them with browser_console).
  - `viewport` (object) — The visible area, in CSS pixels.
    - `width` (integer) — Viewport width.
    - `height` (integer) — Viewport height.
    - `scrollX` (integer) — Horizontal scroll offset.
    - `scrollY` (integer) — Vertical scroll offset.
    - `scrollHeight` (integer) — Height of the whole document.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/type",
  "params": {
    "ref": "k3p9:e7",
    "text": "ada@example.com"
  }
}
```

### `browser/press`

Press a key in your workspace's browser page, on the element that has focus: `Enter` (submits a form field's form — which the person approves — or activates a focused button), `Tab` (`shift` for back), `Escape`, arrows, `PageUp`/`PageDown`, `Home`/`End`, `Backspace`, `Delete`, `Space`.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_press`
- **CLI:** `uxnan-cli browser press <key> [--shift]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `key` | string: `Enter` \| `Tab` \| `Escape` \| `Backspace` \| `Delete` \| `ArrowUp` \| `ArrowDown` \| `ArrowLeft` \| `ArrowRight` \| `Home` \| `End` \| `PageUp` \| `PageDown` \| `Space` | yes | The key. |
| `shift` | boolean | no | Hold Shift (e.g. Shift+Tab). Default false. |
| `snapshot` | boolean | no | Also return the page's new snapshot (as browser_snapshot would) in `snapshot`, saving a call. Default false. |

**Result**

- `done` (string) — `press`.
- `navigated` (boolean) — Whether a new document loaded as a result (the action's navigation is waited for, up to 10 s).
- `page` (object | null) — The page after the action.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.
- `effect` (string, optional) — What happened beyond the action itself: for browser_press, `focus` (moved focus), `submit` (submitted the form), `click` (activated the focused element) or `none`; for browser_click, `opened here` when a link meant for a new window loaded in this page (the browser has no tabs).
- `chosen` (string, optional) — For browser_type into a select: the option chosen.
- `scrollX` (integer, optional) — For browser_scroll: the page's horizontal offset after it.
- `scrollY` (integer, optional) — For browser_scroll: the page's vertical offset after it.
- `snapshot` (object, optional) — The new snapshot, when `snapshot: true` was passed.
  - `url` (string) — The page's URL.
  - `title` (string) — The document title.
  - `outline` (string) — The page as an indented outline, one line per element: `role "name" [ref=…] [state] value="…" -> href`. Interactive elements carry a `ref` to pass to browser_click / browser_type; text is quoted. Password values never appear.
  - `nodes` (integer) — Lines in the outline.
  - `interactive` (integer) — Elements with a `ref`.
  - `truncated` (boolean) — Whether the outline was cut at its size limit (scroll, or act on what is there).
  - `consoleErrors` (integer) — Errors logged by the page since it loaded (read them with browser_console).
  - `viewport` (object) — The visible area, in CSS pixels.
    - `width` (integer) — Viewport width.
    - `height` (integer) — Viewport height.
    - `scrollX` (integer) — Horizontal scroll offset.
    - `scrollY` (integer) — Vertical scroll offset.
    - `scrollHeight` (integer) — Height of the whole document.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/press",
  "params": {
    "key": "Tab"
  }
}
```

### `browser/scroll`

Scroll your workspace's browser page — or one scrollable element, by its `ref` — by a fraction of its visible height or width, to reach content a snapshot left out.

- **Group:** `ui` · mutates (receipted, audited)
- **MCP:** `browser_scroll`
- **CLI:** `uxnan-cli browser scroll [--direction down|up|left|right] [--amount <n>] [--ref <ref>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `direction` | string: `down` \| `up` \| `left` \| `right` | no | Which way. Default `down`. |
| `amount` | number | no | How far, in visible heights (or widths). Default 0.8. |
| `ref` | string | no | The element, by the `ref` a browser_snapshot of the current page gave it (e.g. `k3p9:e12`). A reference from before a navigation or reload is refused — take a new snapshot. |
| `snapshot` | boolean | no | Also return the page's new snapshot (as browser_snapshot would) in `snapshot`, saving a call. Default false. |

**Result**

- `done` (string) — `scroll`.
- `navigated` (boolean) — Whether a new document loaded as a result (the action's navigation is waited for, up to 10 s).
- `page` (object | null) — The page after the action.
  - `workspace` (string) — The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page.
  - `url` (string) — The page's current URL.
  - `title` (string) — The document title; empty until the page sets one.
  - `loading` (boolean) — Whether the page is still loading (a wait ran out before it finished).
  - `visible` (boolean) — Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden.
  - `canGoBack` (boolean | null) — Whether history can go back; null when the engine does not say.
  - `canGoForward` (boolean | null) — Whether history can go forward; null when the engine does not say.
- `effect` (string, optional) — What happened beyond the action itself: for browser_press, `focus` (moved focus), `submit` (submitted the form), `click` (activated the focused element) or `none`; for browser_click, `opened here` when a link meant for a new window loaded in this page (the browser has no tabs).
- `chosen` (string, optional) — For browser_type into a select: the option chosen.
- `scrollX` (integer, optional) — For browser_scroll: the page's horizontal offset after it.
- `scrollY` (integer, optional) — For browser_scroll: the page's vertical offset after it.
- `snapshot` (object, optional) — The new snapshot, when `snapshot: true` was passed.
  - `url` (string) — The page's URL.
  - `title` (string) — The document title.
  - `outline` (string) — The page as an indented outline, one line per element: `role "name" [ref=…] [state] value="…" -> href`. Interactive elements carry a `ref` to pass to browser_click / browser_type; text is quoted. Password values never appear.
  - `nodes` (integer) — Lines in the outline.
  - `interactive` (integer) — Elements with a `ref`.
  - `truncated` (boolean) — Whether the outline was cut at its size limit (scroll, or act on what is there).
  - `consoleErrors` (integer) — Errors logged by the page since it loaded (read them with browser_console).
  - `viewport` (object) — The visible area, in CSS pixels.
    - `width` (integer) — Viewport width.
    - `height` (integer) — Viewport height.
    - `scrollX` (integer) — Horizontal scroll offset.
    - `scrollY` (integer) — Vertical scroll offset.
    - `scrollHeight` (integer) — Height of the whole document.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "browser/scroll",
  "params": {
    "direction": "down",
    "amount": 1
  }
}
```

### `worktree/create`

Create a git worktree on a new branch of a project — where Uxnan's worktree-location policy puts it — list it in the sidebar, and optionally launch an agent in it with a first message. Use it to give a subtask its own isolated space and agent instead of running `git worktree add` yourself: Uxnan then sees, lists and can stop it. It happens in the background: the person's focus stays where it is (`terminal/reveal` moves it). Returns a receipt with the worktree and, when an agent was launched, its terminal id.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `worktree_create`
- **CLI:** `uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing] [--agent <agent>] [--prompt-file <file>] [--unattended] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `project` | string | yes | Which project: `current` (the project of the terminal you run in), `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`. |
| `branch` | string | yes | The new branch name (also the worktree's folder name under the policy's root). |
| `base` | string | no | The ref to branch from. Default: the project's default base (its main branch). |
| `fromExisting` | boolean | no | Check out an existing branch named `branch` instead of creating it. Default false. |
| `agent` | string | no | Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id. Omit for no agent (a plain terminal). |
| `prompt` | string | no | A first message for the launched agent, typed into it once it is ready (queued behind Uxnan's backpressure, so it is never pasted into a busy agent). Requires `agent`. At most 64 KiB. |
| `unattended` | boolean | no | Launch the agent in its CLI's reviewed automatic mode, so it does not stop at every tool for a person who is not there (`claude --permission-mode auto`, `codex --approve-for-me`, …; some CLIs only reach an edits-only tier where shell and MCP still prompt). Default false: a terminal an agent opens is attended unless asked. A profile whose own args or env already pick a mode is left alone; a CLI with no such tier launches as configured — the receipt says which (`unattended`). |
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
- `adopted` (boolean) — Whether the window listed it and launched the agent. False when the window was not there; the worktree exists either way.
- `terminal` (object, optional) — `{ id, agent }` of the launched agent's terminal — only when `agent` was given and the window adopted.
- `warning` (string, optional) — Why the window did not adopt, when it did not.
- `unattended` (string, optional) — When the launch was unattended: `applied` (the CLI's reviewed automatic mode went on its command line or environment), `partial` (only its edits-only tier — shell and MCP tools still prompt; read the screen and answer with `agent/send --force` if it stalls), `configured` (the profile's own args or env already pick a mode; left alone) or `unsupported` (no tier known for that CLI; launched as configured).

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
- `-32005` busy — with `agent`: the launch budget is spent — as many agents are running as the resource policy allows at once (`data.live`, `data.cap`); wait for one to finish, or the person raises the orchestration concurrency in Settings → Resources

### `terminal/create`

Open a new terminal tab in a worktree, optionally launching a configured agent in it with a first message. The tab opens in the background — the person's focus stays where it is (`terminal/reveal` moves it). Returns a receipt with the terminal id.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `terminal_create`
- **CLI:** `uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>] [--unattended] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `worktree` | string | yes | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |
| `agent` | string | no | Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id. Omit for no agent (a plain terminal). |
| `title` | string | no | A tab title. Default: the worktree folder name. |
| `prompt` | string | no | A first message for the launched agent, typed into it once it is ready (queued behind Uxnan's backpressure, so it is never pasted into a busy agent). Requires `agent`. At most 64 KiB. |
| `unattended` | boolean | no | Launch the agent in its CLI's reviewed automatic mode, so it does not stop at every tool for a person who is not there (`claude --permission-mode auto`, `codex --approve-for-me`, …; some CLIs only reach an edits-only tier where shell and MCP still prompt). Default false: a terminal an agent opens is attended unless asked. A profile whose own args or env already pick a mode is left alone; a CLI with no such tier launches as configured — the receipt says which (`unattended`). |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `terminal` (object) — The new tab.
  - `id` (string) — The new tab's id.
  - `agent` (string, optional) — The launched agent's name, when one was.
- `worktree` (string) — The worktree folder the tab opened in.
- `unattended` (string, optional) — When the launch was unattended: `applied` (the CLI's reviewed automatic mode went on its command line or environment), `partial` (only its edits-only tier — shell and MCP tools still prompt; read the screen and answer with `agent/send --force` if it stalls), `configured` (the profile's own args or env already pick a mode; left alone) or `unsupported` (no tier known for that CLI; launched as configured).

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
- `-32005` busy — with `agent`: the launch budget is spent — as many agents are running as the resource policy allows at once (`data.live`, `data.cap`); wait for one to finish, or the person raises the orchestration concurrency in Settings → Resources

### `terminal/close`

Close a terminal tab: one the surface opened (`terminal/create`, `worktree/create`, `worker/start`) once its agent is no longer working, or any terminal whose shell has exited — the way a coordinator collects the workers it started. A terminal a person opened and is still using is refused; one whose agent is working is refused as busy until it is done.

- **Group:** `create` · mutates (receipted, audited)
- **MCP:** `terminal_close`
- **CLI:** `uxnan-cli terminal close <terminal>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `terminal` | string | yes | Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`. |

**Result**

- `closed` (string) — The terminal id that was closed.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "terminal/close",
  "params": {
    "terminal": "id:5f0c…"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32602` invalid params — the terminal was opened by a person and its shell is alive — only they close it
- `-32005` busy — the terminal's agent is working; `agent wait --for idle` first

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

Report the final result of the task Uxnan's orchestration run gave you, so the run captures your output verbatim and can feed it to the next step. Call it exactly once, when you are done. Pass your UXNAN_AGENT_ID as agentId; a worker started by a coordinator also passes the taskId and dispatchId its preamble gave it (a report naming a dispatch that is no longer the task's current one is ignored) and an outcome.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `orchestration_report_result`
- **CLI:** no dedicated command — `uxnan-cli rpc orchestration/reportResult --params '<json>'`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `agentId` | string | yes | The value of your UXNAN_AGENT_ID environment variable (identifies which run step you are). |
| `result` | string | yes | Your full result/output for the task, captured verbatim by the run. |
| `summary` | string | no | Optional one-line summary of the result. |
| `taskId` | string | no | The task id from your preamble, when a coordinator started you. |
| `dispatchId` | string | no | The dispatch id from your preamble. Holds the completion authority: only the task's current dispatch may finish it. |
| `outcome` | string: `success` \| `failure` \| `blocked` | no | What the task came to. Default `success`. `failure` fails the task (its retry policy applies); `blocked` too, saying you could not proceed. |

**Result**

- `reported` (string) — `result`.
- `accepted` (boolean) — Whether a running task took the report. False when no task is waiting on this agent, or the dispatch is stale.
- `task` (string, optional) — The task the report went to.
- `reason` (string, optional) — Why it was not accepted.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "orchestration/reportResult",
  "params": {
    "agentId": "5f0c…",
    "taskId": "s2",
    "dispatchId": "s2.1",
    "outcome": "success",
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

### `run/create`

Create an orchestration run you will drive as its coordinator: an empty, running run to which you add tasks (`task/create`), start workers (`worker/start`) and read the inbox (`inbox/check`) until you finish it (`run/finish`). It stays running until then, however many tasks it holds. The person sees it in the Runs console like any other run and can intervene.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `run_create`
- **CLI:** `uxnan-cli run create --title <t> [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `title` | string | yes | The run's title, as the console shows it. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `run` (object) — The new run.
  - `id` (string) — The run id — what every other orchestrate entry takes as `run`.
  - `status` (string) — `running`.
- `coordinator` (string, optional) — Your terminal id, when a launched agent created the run.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "run/create",
  "params": {
    "title": "Split the parser work",
    "idempotencyKey": "4b7e…"
  }
}
```

### `run/finish`

Finish a run you drive: record its outcome and summary and end it. Workers still running keep their terminals; the run stops accepting reports.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `run_finish`
- **CLI:** `uxnan-cli run finish <run-id> --outcome success|failure|blocked [--summary <text>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |
| `outcome` | string: `success` \| `failure` \| `blocked` | yes | What the run came to. |
| `summary` | string | no | A short closing summary for the person. |

**Result**

- `run` (object) — The run, ended.
  - `id` (string) — The run id.
  - `status` (string) — `completed` for `success`, `failed` otherwise.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "run/finish",
  "params": {
    "run": "run-1a2b",
    "outcome": "success",
    "summary": "Parser split in three worktrees, all merged."
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id
- `-32002` not found — no driven run (or task) has that id

### `task/create`

Add a task to a run you drive. An `interactive` task (the default) waits, once its dependencies are done, for you to start a worker in a terminal with `worker/start`; a `headless` task names an agent and the engine runs it in print mode by itself when it becomes ready, capturing its output. `dependsOn` builds the graph; a task's prompt may reference an earlier task's result with `{{steps.<id>.output}}`.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `task_create`
- **CLI:** `uxnan-cli task create --run <run-id> --title <t> --prompt-file <file> [--depends-on <task>]... [--headless <agent>] [--worktree <worktree>] [--retry] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |
| `title` | string | yes | A short title. |
| `prompt` | string | yes | What the worker is asked to do. At most 64 KiB. |
| `dependsOn` | array of string | no | Task ids that must complete first. |
| `kind` | string: `interactive` \| `headless` | no | Default `interactive`. |
| `agent` | string | no | For `headless`: the agent to run (its profile name, command or id). |
| `worktree` | string | no | Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`. |
| `retry` | boolean | no | Retry once on failure instead of failing the task. Default false. |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `task` (object) — The new task.
  - `id` (string) — The task id.
  - `status` (string) — `pending` (dependencies unmet) or `ready`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "task/create",
  "params": {
    "run": "run-1a2b",
    "title": "Lexer",
    "prompt": "Write the lexer described in docs/lexer.md; run its tests.",
    "dependsOn": []
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32002` not found — no saved run or automation has that id
- `-32002` not found — no driven run (or task) has that id

### `task/list`

The tasks of a run with their state, dispatch, worker terminal, captured output and open questions — what a coordinator reads to decide what to start next.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `task_list`
- **CLI:** `uxnan-cli task ls --run <run-id>`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |

**Result**

- `run` (object) — The run.
  - `id` (string) — The run id.
  - `title` (string) — Its title.
  - `status` (string) — `running` until finished; then `completed`, `failed` or `cancelled`.
  - `driven` (boolean) — Whether a coordinator drives it.
- `tasks` (array of object) — Every task, in creation order.
  - `id` (string) — The task id, unique within the run (`s1`, `s2`, …) — what `task/update`, `worker/start` and `dependsOn` take.
  - `title` (string) — The task's title.
  - `kind` (string) — `interactive` (a worker in a terminal, started with `worker/start`), `headless` (the engine runs the agent in print mode by itself once the task is ready) or `gate` (a question waiting for an answer).
  - `status` (string) — `pending` (dependencies unmet), `ready` (dispatchable — an interactive task waits here for `worker/start`), `running`, `blocked`, `completed`, `failed` or `skipped` (a dependency failed).
  - `dependsOn` (array of string) — Tasks that must complete first.
  - `prompt` (string) — The task's prompt; `{{steps.<id>.output}}` references a finished task's output.
  - `dispatchId` (string, optional) — The current dispatch (`<task>.<attempt>`), once the task has been dispatched — the one a worker's report must name.
  - `outcome` (string, optional) — `success`, `failure` or `blocked`, once a worker reported.
  - `attempts` (integer) — How many times it has been dispatched.
  - `output` (string | null) — The captured result, once finished.
  - `error` (string, optional) — Why it failed, when it did.
  - `terminal` (string, optional) — The worker's terminal id, for an interactive task that was started.
  - `question` (object, optional) — For a gate: `{ question, options?, resolver, answered, answer?, askedBy? }`.
- `inbox` (integer) — How many messages wait in the inbox.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "task/list",
  "params": {
    "run": "run-1a2b"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id

### `task/update`

Change a task of a run you drive: its title, prompt or dependencies while it has not started, or close it by hand (`completed`, `failed` or `skipped`) with an output — for work you did yourself or decided to drop.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `task_update`
- **CLI:** `uxnan-cli task update --run <run-id> <task> [--title <t>] [--prompt-file <file>] [--depends-on <task>]... [--status completed|failed|skipped] [--output <text>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |
| `task` | string | yes | The task id. |
| `title` | string | no |  |
| `prompt` | string | no |  |
| `dependsOn` | array of string | no |  |
| `status` | string: `completed` \| `failed` \| `skipped` | no | Close the task with this status. |
| `output` | string | no | The result to record when closing it. |

**Result**

- `task` (object) — The task, after the change.
  - `id` (string) — The task id.
  - `status` (string) — Its status now.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "task/update",
  "params": {
    "run": "run-1a2b",
    "task": "s3",
    "status": "skipped",
    "output": "Not needed after s2."
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id
- `-32002` not found — no driven run (or task) has that id

### `worker/start`

Start a worker for a ready task: open a terminal — in the current worktree, in a new worktree on a new branch (`worktree: "new"`), or in a given one — launch the agent in it and hand it the task with a preamble that names its task and dispatch, tells it to report exactly once and how to ask you a question. The task becomes `running`; you learn it finished from the inbox (`worker_done` / `worker_failed`). Its terminal is a normal tab the person can watch.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `worker_start`
- **CLI:** `uxnan-cli worker start --run <run-id> --task <task> --agent <agent> [--worktree current|new|<worktree>] [--branch <name>] [--project <project>] [--unattended | --attended] [--idempotency-key <key>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |
| `task` | string | yes | A `ready` task id. |
| `agent` | string | yes | Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id. |
| `worktree` | string | no | `current` (default: your own worktree), `new` (a new worktree of the project on a new branch), or a selector `path:<folder>` / `branch:<name>`. |
| `branch` | string | no | For `new`: the branch name. Default `run/<run>/<task>`. |
| `project` | string | no | Which project: `current`, `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`. Omit for every project. |
| `unattended` | boolean | no | Whether the worker launches in its CLI's reviewed automatic mode, so it does not stop at every tool for a person who is not there (`claude --permission-mode auto`, `codex --approve-for-me`, …; some CLIs only reach an edits-only tier where shell and MCP still prompt). **Default: the agent's own setting** (Settings → Agents → *Automatic mode when launched by an agent*, on unless the person switched it off) — a worker is unattended by design; pass `false` (the CLI's `--attended`) to launch it as configured. A profile whose own args or env already pick a mode is left alone; a CLI with no such tier launches as configured — the receipt says which (`unattended`). |
| `idempotencyKey` | string | no | Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime. |

**Result**

- `requestId` (string) — A fresh id for this call — the audit line carries it too.
- `idempotencyKey` (string, optional) — The key the caller sent, when it sent one.
- `task` (string) — The task id.
- `dispatchId` (string) — The dispatch this worker holds — the only one whose report the task will take.
- `terminal` (object) — The worker's terminal.
  - `id` (string) — The tab id — read its screen with `terminal/read`, wait on it with `agent/wait`.
  - `agent` (string) — The launched agent's name.
- `worktree` (string) — The folder the worker runs in.
- `unattended` (string, optional) — When the launch was unattended: `applied` (the CLI's reviewed automatic mode went on its command line or environment), `partial` (only its edits-only tier — shell and MCP tools still prompt; read the screen and answer with `agent/send --force` if it stalls), `configured` (the profile's own args or env already pick a mode; left alone) or `unsupported` (no tier known for that CLI; launched as configured).

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "worker/start",
  "params": {
    "run": "run-1a2b",
    "task": "s1",
    "agent": "codex",
    "worktree": "new"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — the selector named no project, worktree or terminal
- `-32002` not found — no saved run or automation has that id
- `-32002` not found — no driven run has that id, the task is not `ready`, or `agent` names no configured agent
- `-32602` invalid params — for `new`: the branch name is invalid or already exists
- `-32005` busy — with `agent`: the launch budget is spent — as many agents are running as the resource policy allows at once (`data.live`, `data.cap`); wait for one to finish, or the person raises the orchestration concurrency in Settings → Resources

### `inbox/check`

Read the inbox of a run you drive: workers finishing or failing, questions waiting for your answer, progress lines. Acknowledge what you have handled with `ack` — an unacknowledged message is delivered again, and survives a restart. With `wait`, the call blocks until a message arrives or its budget runs out (at most 15 seconds per call; call again to keep waiting — uxnan-cli does this for you).

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `inbox_check`
- **CLI:** `uxnan-cli inbox check --run <run-id> [--ack <id>]... [--wait] [--timeout <seconds>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |
| `ack` | array of string | no | Delivery ids to acknowledge first. |
| `wait` | boolean | no | Block until a message is there. Default false. |
| `timeoutMs` | integer | no | How long this call may wait, in milliseconds. Capped at 15000. Default 15000. |

**Result**

- `run` (string) — The run id.
- `messages` (array of object) — Every unacknowledged message, oldest first.
  - `deliveryId` (string) — What to acknowledge (`m<n>`).
  - `type` (string) — `worker_done` (a task completed; `text` is its result), `worker_failed` (`text` is why), `question` (a worker asks; `stepId` is the question id to answer) or `status` (a progress line).
  - `stepId` (string) — The task — or, for a question, the question — the message is about.
  - `dispatchId` (string, optional) — The dispatch the message came from, for `worker_*`.
  - `text` (string) — The message.
  - `at` (integer) — Epoch milliseconds.
- `acked` (integer) — How many of `ack` were dropped.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "inbox/check",
  "params": {
    "run": "run-1a2b",
    "ack": [
      "m1",
      "m2"
    ],
    "wait": true
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id
- `-32002` not found — no driven run (or task) has that id

### `question/ask`

As a worker, ask the run's coordinator a question and wait for the answer — instead of guessing or asking a prompt nobody reads. The question reaches the coordinator's inbox (and the Runs console, where the person can answer too). One call waits at most 15 seconds; on timeout, call again with the returned `questionId` to keep waiting (uxnan-cli does this for you).

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `question_ask`
- **CLI:** `uxnan-cli ask --question <text> [--option <o>]... [--timeout <seconds>]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `question` | string | no | The question. |
| `options` | array of string | no | Choices, when the answer is one of a few. |
| `questionId` | string | no | To keep waiting on a question already asked. |
| `timeoutMs` | integer | no | How long this call may wait, in milliseconds. Capped at 15000. Default 15000. |

**Result**

- `run` (string) — The run the question belongs to.
- `questionId` (string) — The question's id.
- `answered` (boolean) — Whether an answer arrived within this call.
- `answer` (string, optional) — The answer, when it did.
- `decision` (string, optional) — `approve` or `reject`, when it did.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "question/ask",
  "params": {
    "question": "Keep the old CLI flag for compatibility?",
    "options": [
      "yes",
      "no"
    ]
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32602` invalid params — called from outside a terminal Uxnan launched, or from a terminal that is no worker of a running task
- `-32006` timeout — no answer within `timeoutMs` (at most 15 000 per call); `data.questionId` — call again with it to keep waiting

### `question/answer`

Answer a worker's question in a run you drive (it came to your inbox as `question`). The worker waiting on it receives the answer at once.

- **Group:** `orchestrate` · mutates (receipted, audited)
- **MCP:** `question_answer`
- **CLI:** `uxnan-cli answer --run <run-id> --question <id> --answer <text> [--reject]`

**Params**

| Name | Type | Required | Meaning |
|---|---|---|---|
| `run` | string | yes | The run id. |
| `question` | string | yes | The question id (the inbox message's `stepId`). |
| `answer` | string | yes | The answer. |
| `decision` | string: `approve` \| `reject` | no | Default `approve`; `reject` tells the worker not to proceed. |

**Result**

- `question` (string) — The question id.
- `resolved` (boolean) — Always true on success.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "question/answer",
  "params": {
    "run": "run-1a2b",
    "question": "s4",
    "answer": "yes, keep it"
  }
}
```

**Errors** (besides the ones every entry can answer — see *Error codes*)

- `-32002` not found — no saved run or automation has that id
- `-32002` not found — no open question with that id in that run

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
| 9 | refused by a safety policy or by the person |
