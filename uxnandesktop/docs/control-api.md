# The control surface — MCP tools and `uxnan-cli`

![Protocol](https://img.shields.io/badge/control_protocol-v1-2ea44f?style=for-the-badge)
![Transports](https://img.shields.io/badge/transports-MCP_%2B_JSON--RPC-blue?style=for-the-badge)
![Client](https://img.shields.io/badge/client-uxnan--cli-000000?style=for-the-badge)

Uxnan Desktop can be **operated from outside its window**: by the agents it
launches, by a person at a shell, and by scripts. One catalog of entries, two
transports, no shell access and nothing destructive — by construction.

> **TL;DR.** Inside a terminal Uxnan launched, an agent already has the tools
> (`uxnan_status`, `worktree_list`, `terminal_show`, `file_diff`, `browser_*`, …)
> through MCP, with nothing to install. From any shell of the same user,
> `uxnan-cli status` finds the running app by itself. A script in any language
> can post JSON-RPC to the same route — see *Calling from outside Uxnan*.
> Prefer `--json` from a script. **Every entry, with its arguments, its result
> and a request, is in [the API reference](./control-api-reference.md)** —
> generated from the catalog by `uxnan-cli skills get control --full`.

---

## What it is for

An agent that Uxnan launched can, today: learn what Uxnan holds (projects,
worktrees, terminals, the agents in them and their live state), show the person
a file or a diff, drive the integrated browser to test what it built, report
its result to an orchestration run — and **give a subtask its own space**:
create a worktree on a new branch and launch an agent in it with a first
message, open a terminal, start a saved run or automation — and **talk to a
running agent**: send it a whole message, wait until its own hooks say its
turn is over, read its screen — and **drive a run as its coordinator**: create
tasks with dependencies, start a worker for each in its own worktree, read an
inbox where workers finish and ask, answer their questions, finish the run.
A person can do the same from a prompt, and script it.

What it is **not**: a shell. There is no entry that runs a command, writes raw
bytes to a terminal, touches the filesystem or git destructively, reads a
credential, or edits the persisted state from outside. Nothing outside the
catalog is reachable, whatever the transport.

## One catalog, two transports

```
                ┌────────────────────────────────────────────┐
                │  control/v1 — the catalog (Rust, one place) │
                │  services: status, project, worktree,      │
                │  terminal, agent, run, ui, browser, …      │
                └──────┬───────────────────────┬─────────────┘
                       │                       │
            Tauri commands (the window)   the app's local server (loopback)
                                             ├── /mcp              → MCP tools
                                             └── /control/v1/rpc   → JSON-RPC 2.0
                                                        ▲
                                              uxnan-cli (any shell)
```

- **The catalog** lives in the `uxnan-control-protocol` crate
  (`src-tauri/crates/control-protocol`): every entry has a JSON-RPC name
  (`domain/verb`), an MCP tool name (`domain_verb`), a description written for
  the agent that will read it, a closed argument schema, a **result schema**
  (every field with its meaning, which fields may be absent), an example
  request and a group. The app dispatches by the RPC name; the MCP adapter
  (`inputSchema` + `outputSchema` on `tools/list`) and `uxnan-cli` only
  translate, and [the API reference](./control-api-reference.md) is generated
  from the same entries — so a field the reference documents is a field the
  app sends, and a test fails when the committed reference is stale.
- **The services** (`src-tauri/src/control/services/`) are the one
  implementation each entry has. The Tauri command the window calls (for
  example the sidebar's `worktree_list`), the MCP tool and the RPC method all
  end in the same function.
- **The server** (`src-tauri/src/control/server.rs`) is the app's one local
  HTTP server, on an ephemeral `127.0.0.1` port: hook reports (`/hook`), the
  browser shim (`/browser`), MCP (`/mcp`), the control RPC
  (`/control/v1/rpc`) and `/health`.
- **The window bridge** (`src-tauri/src/control/bridge.rs` +
  `src/lib/control/bridge.ts`): terminal tabs, open files and orchestration
  runs are the window's state, so a request about them is forwarded to the
  window as a `control:request` event and answered through one command
  (`control_respond`). A window that does not answer within 5 s yields
  *unavailable* — the caller learns the app is up but its window is not.

## Capability groups

Entries are grouped, and a group is a feature: it has its own version and can
be switched off (`settings.control.disabledGroups`, by name — see *Settings*
below) without touching the others. Trust order:

| Group | What it holds | Today |
|---|---|---|
| `read` | `status`, `project/list|show`, `host/list|show`, `worktree/list|show`, `terminal/list|show`, `agent/list`, `run/list|show`, `automation/list|show`, `browser/status|snapshot|screenshot|console|wait` | shipped |
| `ui` | `app/focus`, `terminal/reveal`, `file/open` (Uxnan's tab, or one of the person's external editors with `with`), `file/diff`, `browser/open|navigate|reload|back|forward`, `browser/click|type|press|scroll` | shipped |
| `create` | `host/connect`, `worktree/create` (+ agent + first message), `terminal/create`, `run/start`, `automation/run` | shipped |
| `converse` | `agent/send`, `agent/wait`, `terminal/read` | shipped |
| `orchestrate` (v2) | `run/create|finish`, `task/create|list|update`, `worker/start`, `inbox/check`, `question/ask|answer`, `orchestration/reportResult|reportProgress` | shipped |

[`docs/control-api-reference.md`](./control-api-reference.md) is every entry
with its arguments, its result and a request — the output of `uxnan-cli skills
get control --full`, generated from the catalog, so it cannot describe
something the app does not do.

### Hosts: the machines the work runs on

A project whose `target` is `ssh:<hostId>` lives on a registered host, and
everything about it — its worktrees, its git, its terminals — goes through one
SSH session the app holds. `host/list` and `host/show` describe those machines
**from that session**, not from the settings: connected or not, the shell it
starts, the channels in use against the limit the host turned out to enforce.
`host/connect` opens a session on one that has none — the same path startup
takes for the hosts that need nothing.

Two things it deliberately does not do:

- **It takes no credential.** A host that wants a password or a key passphrase
  comes back as `needsPassword` / `needsPassphrase` and stops there; so does one
  whose host key is unknown, changed or revoked (`hostUnknown` / `hostChanged` /
  `hostRevoked` — nothing is trusted). Those are the person's to finish in
  Settings → Hosts, and the result carries no fingerprint, key path or
  credential method for a caller to work with.
- **It is scoped like everything else.** A caller sees the host *its own
  project* lives on; the person's own shell (the control token) sees every
  registered machine, and a token scoped to a project on this machine is
  refused with *scope denied* and told why — an empty list would read as "no
  hosts", which is a different fact. In practice that makes this the person's
  surface today: a terminal on a host is a remote PTY with none of the
  `UXNAN_*` variables, so an agent running *there* cannot call the API at all
  (that is the remote agent runner's work, still owed in `FOR-DEV.md`).

### The budget in `status`

`status` reports the budget a new agent faces here: `concurrency`, how many
slots are `live` right now, the `minFreeMemoryMb` a start must leave free,
`freeMemoryMb` on the machine and the advisory `maxAgentMemoryMb` ceiling. It
is the resolved resource mode (Settings → Resources), read from the same place
the gates read it and counted across **every** process that shares it — this
app and each automations runner. A coordinator that does not look starts eight
workers that queue behind each other; one that does, dispatches what fits.

### The `create` group: receipts, idempotency, audit

A `create` entry answers with a **receipt** — `{ requestId, idempotencyKey?, … }`
plus what was created (the worktree, the terminal id, the run) — and it is safe
to retry: pass an `idempotencyKey` (any string the caller chooses, a UUID will
do) and a later call with the same entry and key returns the **first** receipt
without doing the thing again. Keys are held in memory for the app's lifetime
(`AppState.control_receipts`, bounded to the last 1024), because a promise about
"this run of the app" is what a lost reply needs; a worktree created before a
restart is in `worktree/list` anyway.

Every `create` call that reached its service — done or refused by it — writes
one JSON line to **`control-audit.log`** in the app's data directory (rotated
once to `.1` past 1 MiB): the time, the caller (`launch` + terminal id, or
`control`), the entry, its arguments with any prompt reduced to its byte
length, and `ok` with the receipt id or the error. It is what lets the person
read afterwards what was done in their name.

What each entry does, and through which existing path:

- **`worktree/create`** — the branch and folder come from the same policy the
  New-worktree dialog uses (`worktreeloc`, plus the project's own root); the
  service is the one the dialog's `worktree_create` command calls. The new
  worktree is then handed to the window (`worktree/adopt` over the bridge), which
  lists it and — with `agent` — launches that configured agent in it as the
  dialog would, **in the background**: the person's active worktree and tab
  stay where they are. What an agent creates leaves a trace (the sidebar, the
  tab, the unread badge when the agent finishes), it does not take the seat;
  `terminal/reveal` is the entry that moves the focus, and only a caller that
  wants to. A `prompt` is queued for the agent through
  the orchestration broadcast queue, so it is typed only once the agent is free,
  never into a TUI that is still starting. If the window is not there to adopt,
  the receipt still comes back with `adopted: false` and a warning — the
  worktree exists and the next reconcile pass lists it.
- **`terminal/create`** — a tab in a worktree, plain or with an agent (`agent` by
  profile name, command or id; `prompt` as above), opened in the background the
  same way: its workspace is mounted so the shell spawns and the agent runs
  whether or not anyone is looking. The window mints the tab id.
- **`terminal/close`** — the way a coordinator collects what it started. It
  closes a tab the surface itself opened (`terminal/create`,
  `worktree/create`, `worker/start` — the tab carries `origin: control`,
  persisted with the layout) once its agent is no longer working, or **any**
  terminal in scope whose shell has exited (an agent's tab is kept open after
  its shell dies so the person can read it; sweeping it is harmless). A tab a
  person opened and is still using is refused as invalid — closing what
  someone is using is theirs to do — and a tab whose agent the hooks report
  as *working* is refused as busy, before the window is asked: wait for it
  (`agent/wait --for idle`) first.
- **`run/start`** — the run engine validates and starts a **saved** run; a run
  that is not runnable is refused with its validation errors (exit 8 / *busy*).
- **`automation/run`** — the same headless runner the schedule starts, as a
  manual run of a **saved** automation. Nothing can inject a definition.

A `prompt` needs an `agent` and is capped at 64 KiB — a first message, not a
document; the CLI's `--prompt-file` enforces the same cap before sending.

**The launch budget.** Every agent the surface launches — `terminal/create` or
`worktree/create` with `agent`, `worker/start` — counts against the **resource
policy's orchestration concurrency**, the same cap the run engine dispatches
by (Settings → Resources; the preset's number, extended when the machine has
headroom). With as many agents running as the cap allows, the launch is
refused with *busy* (`-32005`, `data.live` and `data.cap`) **before anything
exists** — a worktree is not created for an agent that will not be launched —
and the caller waits for one to finish. A plain terminal is not budgeted, and
neither is a person's click: the budget is for the actor that can loop. It is
the deterministic half of plan 023 applied at the one place all three doors
share; admission by free memory and process-tree limits remain that plan's.

**Unattended launches.** A worker a coordinator starts has nobody at its
terminal to click "Allow", so a CLI that stops at every tool for a person's
approval would stall the run. An unattended launch adds the CLI's **reviewed
automatic mode** — the tier where tools are auto-approved but a reviewer (a
classifier model, a reviewer subagent, a sandbox) still gates what runs — and
never its "skip every check" flag, which stays a deliberate choice for the
person to put in a profile's args. The table lives in
`src/lib/agentUnattended.ts`, per command basename, at two levels:

| Level | Meaning | CLIs |
|---|---|---|
| `reviewed` | every tool auto-approved under a reviewer | `claude --permission-mode auto`, `codex --approve-for-me`, `qwen --approval-mode auto`, `ante --permission-mode auto`, `kimi --yolo` (that CLI's *ask when needed* tier; its skip-all is `--auto`), `devin --permission-mode smart`, `goose` via `GOOSE_MODE=smart_approve` in its environment (it has no flag) |
| `editsOnly` | file edits auto-approved; shell commands and MCP tools still prompt | `agy --mode accept-edits`, `grok --permission-mode acceptEdits`, `command-code --accept-edits` (and its `cmd`/`cmdc`/`commandcode` bins), `vibe --agent accept-edits`, `omp --approval-mode write`, `autohand --yes` |
| — | absent: only a skip-all flag or an allow-list, or the tier exists only on the CLI's one-shot `exec` subcommand and not on the TUI Uxnan launches (`zero`, `droid`), or no approval prompt exists at all | everything else |

What is added flows through the same path as the profile's own configuration:
arguments after the profile's args, an environment variable next to the
profile's env — one launch, not a second launch path.

**Who is unattended.** A **worker is unattended by design**: `worker/start`
with no `unattended` follows the **agent's own setting** — Settings → Agents →
expand the agent → *Automatic mode when launched by an agent*, **on** unless the
person switched it off (a CLI with no tier shows the row disabled, with the
reason). `unattended: false` (the CLI's `--attended`) launches the worker as
configured; `unattended: true` (`--unattended`) asks for the mode even with the
switch off. `terminal/create` and `worktree/create` with an agent stay
**opt-in** (`unattended: true`, the CLI's `--unattended`): a terminal an agent
opens is attended unless asked. Either way a profile whose own args or
environment already pick a mode — any mode: a plan mode, a bypass, an
allow-list, a sandbox — is left alone: the person decided.

The receipt says what happened: `unattended: applied` (the reviewed tier went
on the command line or environment), `partial` (only the edits-only tier — the
worker may still stop at a shell command or an MCP tool, which the caller
answers through `terminal/read` + `agent/send --force`), `configured` (the
profile decided) or `unsupported` (no tier known for that CLI, launched as
configured). The field is absent when the launch was not unattended.

### The `converse` group: send, wait, read

The loop an agent (or a script) runs with another agent:

- **`agent/send`** — a whole message to a running agent's terminal, as one
  paste-and-submit (`pty_paste_submit`: bracketed paste plus a distinct Enter),
  never keystrokes. By default it goes through the same backpressure queue the
  orchestration console uses, so it is typed only when that agent is free;
  `force` types it now, which interrupts the agent and should be rare. A
  terminal with no agent in it is refused — a shell has nobody to read a
  message. Receipted and audited like a `create`; the same 64 KiB cap.
- **`agent/wait`** — blocks until the agent reaches `idle` (its turn finished,
  the `done` its hooks report), `waiting` (it stopped to ask the person
  something) or `exit` (the terminal is gone), or the call's budget runs out
  (at most 15 s per call — the app sleeps on its agent-change notifier, no
  polling). A terminal that exits satisfies every wait, so nobody waits for a
  turn that will never end. The CLI keeps calling until `--timeout` (default
  600 s), printing a heartbeat to stderr with the agent's current state.
  Not audited: it changes nothing.
- **`terminal/read`** — the last `lines` (default 120, at most 2000) of a
  terminal's screen as text, from the window's terminal buffer (escapes gone,
  blank rows dropped), **redacted** before it leaves the app
  (`control/redact.rs`: `Authorization`/`x-api-key` headers, `password=`,
  `token=`, `secret=` and their kin, private-key blocks, tokens recognizable
  by prefix). Every read is audited. A project can opt out with
  `settings.control.terminalReadDisabledProjects` (its terminals then answer
  *group disabled*) — see *Settings* below.

### The `orchestrate` group: a coordinator drives a run

The run engine (`docs/orchestration.md`) is driven by the person at the
console: they author a DAG of steps, start it, answer its gates. This group
puts **an agent in that seat** — typically one Uxnan launched, holding the
tools — without a second engine: a driven run *is* a run, its tasks *are*
steps, a worker's question *is* a gate, and it all shows in the Runs console
where the person can watch and intervene.

- **`run/create`** — an empty run, `running` from the start and marked
  *driven* (with the coordinator's terminal when a launched agent created
  it). It ends only with `run/finish`: an empty or all-done DAG is "waiting
  for the next task", not "done".
- **`task/create`** — a step with a title, a prompt and `dependsOn`. An
  `interactive` task (default) waits as `ready` for a worker; a `headless`
  task names an agent and the engine runs it in print mode by itself when it
  becomes ready — the coordinator only reads its result from the inbox.
  `{{steps.<id>.output}}` in a prompt takes an earlier task's result, as in
  any run.
- **`worker/start`** — the worker: a terminal in the coordinator's worktree,
  in a **new worktree on a new branch** (`worktree: "new"`, the project's
  location policy, default branch `run/<run>/<task>`) or in a given one; the
  agent launched in it; and the task typed in behind a **preamble** that
  names the run, the task and the **dispatch** (`<task>.<attempt>`), tells the
  worker to report exactly once with those ids and an outcome, and how to ask
  a question. The task becomes `running`, bound to that terminal — a normal
  tab, with its full TUI. Retry mints a new dispatch.
- **Completion authority is the dispatch.** `orchestration/reportResult`
  with the task's current `dispatchId` completes the task (or fails it per
  `outcome`, honouring its retry policy) with the worker's structured result;
  a report naming another dispatch is stale and refused, so an old worker's
  late report never closes a retried task. A worker that goes idle without
  reporting still completes on the hook signal — after a **60 s grace**, because
  a CLI often ends a turn a moment before the tool call that carries its
  report; a worker whose terminal exits fails the task.
- **`inbox/check`** — the coordinator's FIFO, durable with the run:
  `worker_done` (with the result), `worker_failed` (with the error),
  `question`, `status` (a progress line, or "attempt n failed; ready again").
  A message stays until acknowledged by `deliveryId` — a restart loses
  nothing. With `wait`, the call sleeps on the app's change notifier (no
  polling), at most 15 s per call; `uxnan-cli inbox check --wait` keeps
  calling with heartbeats. The person sees the same queue in the Runs
  console: a driven run's detail opens with who drives it (the
  coordinator's agent and tab, with a button to show that terminal; "from a
  shell" for `uxnan-cli`; the outcome and summary once finished) and its
  **Inbox** — every message not yet acknowledged, with its kind, step,
  dispatch and text. Empty means read, not idle.
- **`question/ask`** — from a worker's terminal (the caller's own; the app
  finds the task it works on): files a **gate step** on the run addressed to
  the coordinator (or to the person when nobody drives the run), posts it to
  the inbox with its options, and waits for the answer — 15 s per call, then
  a timeout carrying `questionId` to keep waiting with. The gate shows in the
  Runs console like any gate, so the person can answer instead.
  **`question/answer`** resolves it; the waiting worker gets the answer at
  once. `task/update` lets the coordinator close a task by hand.
- **`run/finish`** records the outcome and summary and ends the run; running
  workers keep their terminals.

The loop a coordinator runs, in `uxnan-cli` terms:

```sh
R=$(uxnan-cli run create --title "Split the parser" --json | jq -r .run.id)
uxnan-cli task create --run $R --title Lexer  --prompt-file lexer.md
uxnan-cli task create --run $R --title Parser --prompt-file parser.md --depends-on s1
uxnan-cli worker start --run $R --task s1 --agent codex --worktree new   # unattended by default
uxnan-cli inbox check --run $R --wait            # … worker_done s1
uxnan-cli inbox check --run $R --ack m1          # s2 is ready now
uxnan-cli worker start --run $R --task s2 --agent claude --worktree new --attended   # this one prompts
uxnan-cli inbox check --run $R --wait            # … question s3 → answer it
uxnan-cli answer --run $R --question s3 --answer "keep the old flag"
uxnan-cli inbox check --run $R --wait --ack m2   # … worker_done s2
uxnan-cli run finish $R --outcome success --summary "both merged"
```

An agent does the same with `run_create`, `task_create`, `worker_start`,
`inbox_check`, `question_answer`, `run_finish` — verified live with a Claude
Code coordinator starting a Claude Code worker in a new worktree and
finishing with its result, and with a worker asking through `question_ask`
and receiving the answer the coordinator gave. Every move but the reads and
the waits is receipted and audited with the caller's identity.

## Selectors

A caller names things without copying ids off the sidebar:

- `current` — the caller's own terminal, and from it its worktree and project.
  Only a process Uxnan launched has one (it knows `UXNAN_AGENT_ID`); from the
  user's shell, `current` is an error that says to use an explicit form.
- `id:<id>` — a project id or a terminal id (from a list).
- `path:<absolute path>` — a project or worktree folder. A bare absolute path
  is accepted as `path:` too.
- `branch:<name>` — a worktree by its branch.
- `name:<project name>` — a project by its display name (must be unique).

A bare word is refused rather than guessed: a branch and a project name can
collide, and picking one silently would be worse than the error.

## Who may call, and how the app knows

Every route first refuses a caller whose `Host` or `Origin` is not loopback
(the CSRF / DNS-rebinding vector a web page would use), then requires a token.
Two tokens exist, both minted fresh on every start, neither ever logged:

| Caller | Token | Where it comes from | What `current` means | Scope |
|---|---|---|---|---|
| A process the app launched (an agent's MCP client, or `uxnan-cli` run inside that terminal) | **per-launch** token | injected into the terminal as `UXNAN_HOOK_TOKEN` (named to the agent's MCP config as `UXNAN_MCP_TOKEN`), with `UXNAN_HOOK_URL` and `UXNAN_AGENT_ID` | that terminal | **its terminal's project** |
| The user's own shell, a script, an agent launched elsewhere | **control** token | the discovery file `control.json` under the app's data directory | nothing — use explicit selectors | every project |

**Scope.** The per-launch token travels in agent processes — the least trusted
caller — so it reaches only the project its terminal was opened in: listings
(`project/list`, `worktree/list`, `terminal/list`, `agent/list`, `host/list`,
the counts in `status`) are narrowed to it, and a selector that names a worktree or a
terminal of another project is refused with *scope denied* (`-32003`) —
distinct from *not found*, so an agent learns to stop rather than retry. The
scope is taken from **backend state**: the folder the caller's own PTY runs in
(`control/resolve.rs` → `Scope`), never from anything the request claims. A
folder is a project's when it is inside its checkout, its registered worktree
location, **or any worktree git lists for it** — the linked worktrees the app
cuts under the worktree root live outside the checkout, and they are where a
coordinator's workers run: a worker there is in the project's scope, and the
coordinator sees its terminal. A
launch request that does not say which terminal it is (no
`x-uxnan-agent-id` header) reaches no project at all; one whose terminal is in
the Global space, likewise. The control token — the same OS user that can open
the app and read its data directory — sees every project, so a project list
in a settings pane would add friction, not a boundary.

Every launch config the app writes sends the terminal's id with every MCP
call, expanded from `UXNAN_AGENT_ID` on the terminal the way that CLI expands
variables — `headers` with `${UXNAN_AGENT_ID}` for Claude Code,
`env_http_headers` (header → variable name) for Codex, `headers` with
`{env:UXNAN_AGENT_ID}` for OpenCode — so `current` and the scope work from an
agent's tool calls, not only from `uxnan-cli`. An agent wired by hand from the
manual snippet has the header spelled out to fill in.

The discovery file holds the protocol version, the app version, the app's
**pid and start time**, the server origin and the control token. It is written
atomically and **readable by its owner alone** — `0600` on Unix; on Windows an
explicit, protected DACL with one entry for the current user, so nothing is
inherited from the profile folder (`uxnan_control_protocol::private`, the same
module `uxnan-cli` checks with: on Windows it refuses a file whose access
list grants any account but the user, SYSTEM and Administrators) — and removed
on a clean exit. `uxnan-cli` refuses a file readable by other users, refuses a
protocol version it does not speak, and refuses a file whose
pid is gone or was recycled (the start time no longer matches) — so a file left
behind by a crash points it nowhere.

Rotation: the control token lives in `AppState.control_token` and the server
reads it on every request, so it can be replaced without a restart; today the
one rotation is the new token every start mints. Restarting the app is how a
person cuts every outside client off.

## Settings

The surface has **no settings pane, by design**: the other apps that offer a
surface like this do not ask the person to switch pieces of it off, and a pane
of switches nobody flips is a cost without a benefit. The two knobs that exist
are honoured from `state.json` (`settings.control`), for the rare setup that
needs them:

| Key | Type | Effect |
|---|---|---|
| `disabledGroups` | `string[]` of group names (`read`, `ui`, `create`, `converse`, `orchestrate`) | Every entry of a listed group is refused for every caller with *group disabled* (`-32001`); `status` reports the group as `enabled: false`. Empty by default. |
| `terminalReadDisabledProjects` | `string[]` of project ids | `terminal/read` on a terminal of a listed project answers *group disabled*; everything else about the project stays readable. Empty by default. |

Edit them with the app closed (it rewrites `state.json` on its own saves).
Everything else — whether launched agents get the tools at all, which agents,
the frictionless launch, the manual MCP config — is **Settings → Browser →
Agent tools (MCP)**, where the wiring grew from ([`docs/browser.md`](./browser.md)).
That switch stands on its own: the integrated browser's master switch takes
away the `$BROWSER` shim, never the catalog (`browser_open` then sends the URL
to the system browser and says `routed: "external"`, and the tools that need a
page find none); the storage keys stayed on the browser settings object
(`browser.mcpEnabled`, `mcpDisabledAgents`, `frictionFree`), so nothing a
person set is lost.

## Calling from outside Uxnan

The surface is reachable from **anything on the same machine that runs as the
same user**: a shell, a cron job, an editor task, a CI step on a developer's
box, an agent Uxnan did not launch. It is **not** reachable from another
machine — the server listens on loopback only and refuses a non-loopback
`Host`/`Origin`, and there is no option to bind it wider. To operate a Uxnan on
another machine, run the client there (over SSH, for instance).

`uxnan-cli` is the door for a shell and for anything that can spawn a process:

```sh
uxnan-cli status --json | jq '.groups[] | select(.enabled) | .name'
uxnan-cli worktree ls --project name:uxnan --json | jq -r '.worktrees[].branch'
uxnan-cli terminal create --worktree branch:feat/x --agent claude --prompt-file task.md --json
```

Branch on its exit status (`0` success, `3` app not running, `7` nothing
matched, …) rather than on its text; the whole table is in the reference.

For a program with an HTTP client and no wish to spawn a process, the route the
CLI itself uses: read the discovery file, post JSON-RPC 2.0 to
`{endpoint}/control/v1/rpc` with the token as a bearer. The file's location,
the checks to make before trusting it (mode, protocol version, pid **and**
start time), the envelope, the HTTP statuses and every error code are in
[the reference → *Calling the RPC route directly*](./control-api-reference.md#calling-the-rpc-route-directly).
In Python, the whole client is:

```python
import json, os, urllib.request
from pathlib import Path

home = Path.home()
data_dir = Path(os.environ.get("UXNAN_DATA_DIR") or home / "Library/Application Support/dev.luisgamas.uxnandesktop")
d = json.loads((data_dir / "control.json").read_text())
assert d["protocolVersion"] == 1

def call(method, params=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode()
    req = urllib.request.Request(d["endpoint"] + "/control/v1/rpc", body, {
        "Content-Type": "application/json", "Authorization": f"Bearer {d['token']}"})
    reply = json.load(urllib.request.urlopen(req))
    if "error" in reply:
        raise RuntimeError(f"{reply['error']['code']}: {reply['error']['message']}")
    return reply["result"]

for t in call("terminal/list")["terminals"]:
    print(t["id"], t.get("agentName"), t.get("agent", {}).get("status"))
```

(`%APPDATA%\dev.luisgamas.uxnandesktop` on Windows, `~/.local/share/…` on
Linux; a debug build uses the `-dev` sibling.) The same in Node is `fetch` with
the same body and headers. An MCP client — an agent runtime with its own MCP
support — points at `{endpoint}/mcp` with the same bearer and gets the catalog
as tools, `outputSchema` included.

A few things a caller from outside should know:

- **The token changes on every start** of the app: read the file per session,
  and on a `401` read it again. A file whose `pid` is dead, or alive but with a
  different start time, is a leftover — ignore it.
- **`current` means nothing** from outside: list first, then use `id:`,
  `path:`, `branch:` or `name:`. And the control token reaches every project;
  a per-launch token only its own.
- **Mutations are receipted**: send an `idempotencyKey` you choose with every
  `create` and `agent/send`, and a retry after a lost reply is safe.
- **Everything a `create` or `converse` call does is audited** in
  `control-audit.log` beside the discovery file, with the caller's kind — a
  person can always see what a script did. Message and prompt text is recorded
  as its byte length only.
- **Long text goes through a file** on the CLI (`--prompt-file`,
  `--message-file`) and through the JSON body on the route, capped at 64 KiB
  either way; longer material belongs in a file the agent is told to read.

## `uxnan-cli`

The console client. A separate binary (`src-tauri/crates/uxnan-cli`), built
with the app's workspace, that depends on the protocol crate and nothing of
Tauri. Named `uxnan-cli` on purpose, so it is never mistaken for the app.

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
uxnan-cli host ls | show <host-id> | connect <host-id> [--idempotency-key <key>]
uxnan-cli automation ls | show <automation-id> | run <automation-id> [--idempotency-key <key>]
uxnan-cli app focus
uxnan-cli file open <path> [--worktree <worktree>] [--with <editor>]
uxnan-cli file diff <path> [--worktree <worktree>] [--staged]
uxnan-cli browser open <url> | navigate <url> | reload | back | forward | status
uxnan-cli rpc <method> [--params '<json>']      # any catalog entry, raw
uxnan-cli skills get control [--full]           # the guide / the full reference
Global: --json, --timeout <seconds>
```

**The console contract.** Results on stdout, errors on stderr. `--json` prints
the raw result object and is stable: fields may be added, never renamed or
removed without a protocol bump — prefer it from scripts and agents. Long
content never travels as an argument. The token is never printed. Exit status:

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
| 9 | refused by a safety policy or by the person (a browser page action; see [the browser](./browser.md#agents-reading-and-using-the-page)) |

**How it finds the app.** Inside a terminal Uxnan launched, from the
environment (`UXNAN_HOOK_URL` + `UXNAN_HOOK_TOKEN`, and `UXNAN_AGENT_ID` for
`current`). Anywhere else, from the discovery file in the app's data directory
— the same rules the app uses (`UXNAN_DATA_DIR` override; the platform's
per-user data directory; the `-dev` profile for a debug build, so a debug CLI
finds a debug app and never the installed one).

**Where it is.** `uxnan-cli` ships **inside the app** as a sidecar
([`docs/build.md`](./build.md) → *The `uxnan-cli` sidecar*), next to the main
executable, and from there the app puts it within reach twice:

- **Every terminal Uxnan opens has it on the PATH** — the sidecar's folder is
  put first, and `UXNAN_CLI` names the binary outright. An agent, a worker a
  coordinator started, a script in that shell: nothing to install, nothing to
  configure, and the same version as the app that launched it.
- **Your own shell gets a shim**, refreshed on every start: on macOS and Linux a
  symlink `~/.local/bin/uxnan-cli` (if that folder is not on your `PATH`, add
  `export PATH="$HOME/.local/bin:$PATH"` to your shell's profile once); on
  Windows a copy in `%LOCALAPPDATA%\uxnan\bin`, which the app adds to your
  user `PATH` once (new consoles see it). A file already at that path that is
  not ours is left alone. `uxnan-cli status` reports both locations
  (`cli.bundled`, `cli.shim`).

To build it by hand (a checkout without the app): `cargo build -p uxnan-cli
--release` in `src-tauri/` produces `target/release/uxnan-cli`.

**The reference is its output.** `uxnan-cli skills get control --full >
docs/control-api-reference.md` (from `uxnandesktop/`) regenerates
[`docs/control-api-reference.md`](./control-api-reference.md); the same text is
the published skill's `references/catalog.md`. A test in the CLI crate
(`the_committed_reference_is_current`) compares the committed file with the
generator byte for byte, so a catalog change that forgets the doc fails
`cargo test`.

## For the agent

An agent Uxnan launches needs no instructions: the MCP server's `initialize`
tells it what the tools are for, and each tool describes itself. The published
`uxnan-control` skill is for an agent that runs **outside** Uxnan and reaches the
app through `uxnan-cli`: a short `SKILL.md` (purpose, commands, selectors, exit
codes) with `references/catalog.md` — which **is** the output of `uxnan-cli
skills get control --full`, every entry with its arguments and result plus the
wire contract for a script, so when the catalog grows the reference is
regenerated, never hand-edited — and `references/workflows.md` (recipes).

## Verifying

- **Protocol crate** (`cargo test -p uxnan-control-protocol`): the catalog's
  names are unique and well-formed, every schema is a closed object, reads never
  mutate, selectors parse every form and refuse a bare word, error codes are
  distinct and round-trip, the discovery record serializes in camelCase.
- **App** (`cargo test --lib control::`): the argument validator, the
  dispatcher-vs-catalog agreement, the two gates, the bearer/legacy token
  parsing, the discovery file's mode and removal, the window bridge, and
  **end-to-end tests over a real loopback socket** with Tauri's mock app: both
  gates on the RPC route, `status` for either token, the envelope's error codes
  (unknown method, misspelled argument, missing selector, `current` from a
  shell, non-JSON-RPC body), a switched-off group refusing only its entries,
  the MCP route listing the catalog and calling through the same dispatcher,
  a hook report needing the launch token, live control-token rotation, **the
  launch token's scope** (a real PTY in one of two projects and a stand-in
  window answering the tab list: listings narrowed, the other project's
  worktree and terminal *scope denied*, a headerless launch request reaching
  nothing, the control token seeing all; and a worker in a **linked worktree
  outside the checkout** resolving `current` and seen by the coordinator) — and, for `create`: a worktree created on a **real temporary repository** where
  the project's policy puts it, receipted, written to the audit log, not
  created twice under the same key, a prompt refused before anything exists,
  and saved-only refusals for runs and automations; for `converse`: a message
  over the cap refused and audited as its byte length only, and the wait core
  (`wait_for`) on a **real PTY** — running out while the agent works and saying
  so, woken at once by a `done` report, `waiting` as its own state, an unknown
  terminal as `exit`, a tab the window says is open but whose PTY is not up
  yet as *not reported* rather than `exit`. Receipts, the audit log and the redaction have their
  own unit tests. For `orchestrate`: over the real server with a stand-in
  window, `inbox/check --wait` waking on the change notifier the moment a
  message lands, `question/ask` refused from the user's shell, timing out
  with its `questionId` and answered on the next wait, and the audit log
  holding the moves but not the reads.
- **CLI** (`cargo test -p uxnan-cli`): the HTTP client's round trip against a
  stand-in server, response parsing, the origin derivation, the process
  start-time check, the reference naming every entry, every error code and
  exit status, every CLI form resolving to a real clap subcommand, `worker
  start` saying `unattended` only when `--unattended`/`--attended` does (and
  refusing both), every result
  field rendering with a meaning, the committed
  `docs/control-api-reference.md` equal to the generator's output, the table
  and record renderers.
- **Window** (`npm run test:dom`, `src/lib/control/bridge.svelte.test.ts`):
  the tab listing, reveal/open/diff, run list/show, an unknown method answered
  with an error, the reply through `control_respond`; and for `create`: a
  worktree adopted in the background (listed, its workspace mounted, the agent
  launched and its prompt queued — the person's worktree, workspace and tab
  untouched), an unknown agent refused with the known ones, a terminal opened
  plain or with an agent named three ways (never as the active tab), a run started or refused with its
  validation errors; for `converse`: a message queued or forced through the
  paste, a shell refused, a screen read that says when there is none; for
  `orchestrate`: the whole coordinator loop (a driven run that stays running
  while empty, tasks promoted as their dependencies finish, a worker bound
  with its dispatch and its preamble queued, a stale dispatch's report refused
  and the current one taken, the inbox delivering until acknowledged, a task
  closed by hand, the run finished), and a worker's question filed as a
  coordinator-addressed gate, posted to the inbox and answered; for unattended
  launches: the reviewed mode added on request (on the command line, or in the
  environment for the CLI that reads it there), an edits-only tier reported
  `partial`, a profile that already picks a mode left `configured`, a CLI with
  no tier `unsupported`, and a worker's launch unattended by default — the
  explicit `false` and the agent's Settings switch both turning it off, a
  terminal an agent opens staying attended. The table itself
  (`agentUnattended.ts`: every tier, the bypass flags it never carries, the
  per-CLI detection of `--mode`/`--agent`/`--force`, the environment
  variables) is pure and tested in `src/lib/agentUnattended.test.ts`; the
  Settings switch (on by default, disabled with the reason for a CLI with no
  tier, the edits-only wording, what it writes) in
  `src/lib/components/AgentProfileEditor.svelte.test.ts`. The model
  (`dispatchIdFor`, `postInbox`/`ackInbox`, `workerPreamble`) is pure and
  tested in `src/lib/orchestration/run.test.ts`. The pump's readiness rule (`readyToReceive`: a terminal that has drawn and
  settled, the busy hold, the cap) is pure and tested in
  `src/lib/orchestration.test.ts`.
- **By hand**: run the app (`npm run tauri dev`), then in another shell
  `uxnan-cli status`, `uxnan-cli terminal ls`, `uxnan-cli file diff <path>
  --worktree path:<folder>`, `uxnan-cli worktree create --project name:<p>
  --branch feat/x --agent claude --prompt-file task.md --idempotency-key k1`
  (then the same call again: same receipt, one worktree); `uxnan-cli agent send
  --to id:<terminal> --message-file msg.md`, `uxnan-cli agent wait --to
  id:<terminal> --for idle`, `uxnan-cli terminal read id:<terminal>`; and from
  inside a Uxnan terminal, `uxnan-cli terminal show current`.
