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
> `uxnan-cli status` finds the running app by itself; `uxnan-cli skills get
> control --full` prints the whole guide. Prefer `--json` from a script.

---

## What it is for

An agent that Uxnan launched can, today: learn what Uxnan holds (projects,
worktrees, terminals, the agents in them and their live state), show the person
a file or a diff, drive the integrated browser to test what it built, and report
its result to an orchestration run. A person can do the same from a prompt, and
script it. Later capability groups (creating worktrees and terminals, sending a
message to an agent and waiting for it to go idle, coordinating several agents)
build on the same surface; the groups and the road are in the spec.

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
  the agent that will read it, a closed argument schema and a group. The app
  dispatches by the RPC name; the MCP adapter and `uxnan-cli` only translate.
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
be switched off in the app's settings (`settings.control.disabledGroups`, by
name) without touching the others. Trust order:

| Group | What it holds | Today |
|---|---|---|
| `read` | `status`, `project/list|show`, `worktree/list|show`, `terminal/list|show`, `agent/list`, `run/list|show`, `browser/status` | shipped |
| `ui` | `app/focus`, `terminal/reveal`, `file/open`, `file/diff`, `browser/open|navigate|reload|back|forward` | shipped |
| `create` | create a worktree or a terminal, start a saved run | planned |
| `converse` | send a complete message to an agent, wait for a state, read its screen | planned |
| `orchestrate` | `orchestration/reportResult|reportProgress` (shipped); tasks, inbox, questions | partly |

`uxnan-cli skills get control --full` lists every entry with its arguments —
generated from the catalog, so it cannot describe something the app does not do.

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

| Caller | Token | Where it comes from | What `current` means |
|---|---|---|---|
| A process the app launched (an agent's MCP client, or `uxnan-cli` run inside that terminal) | **per-launch** token | injected into the terminal as `UXNAN_HOOK_TOKEN` (named to the agent's MCP config as `UXNAN_MCP_TOKEN`), with `UXNAN_HOOK_URL` and `UXNAN_AGENT_ID` | that terminal |
| The user's own shell, a script, an agent launched elsewhere | **control** token | the discovery file `control.json` under the app's data directory | nothing — use explicit selectors |

The discovery file holds the protocol version, the app version, the app's
**pid and start time**, the server origin and the control token. It is written
atomically, `0600` on Unix (on Windows it inherits the per-user profile's ACL),
and removed on a clean exit. `uxnan-cli` refuses a file readable by other
users, refuses a protocol version it does not speak, and refuses a file whose
pid is gone or was recycled (the start time no longer matches) — so a file left
behind by a crash points it nowhere.

Rotation: the control token lives in `AppState.control_token` and the server
reads it on every request, so it can be replaced without a restart (a Settings
control for that is FOR-DEV).

## `uxnan-cli`

The console client. A separate binary (`src-tauri/crates/uxnan-cli`), built
with the app's workspace, that depends on the protocol crate and nothing of
Tauri. Named `uxnan-cli` on purpose, so it is never mistaken for the app.

```
uxnan-cli status
uxnan-cli project ls | show <project>
uxnan-cli worktree ls [--project <project>] | show <worktree>
uxnan-cli terminal ls [--worktree <worktree>] | show <terminal> | reveal <terminal>
uxnan-cli agent ls
uxnan-cli run ls | show <run-id>
uxnan-cli app focus
uxnan-cli file open <path> [--worktree <worktree>]
uxnan-cli file diff <path> [--worktree <worktree>] [--staged]
uxnan-cli browser open <url> | navigate <url> | reload | back | forward | status
uxnan-cli rpc <method> [--params '<json>']      # any catalog entry, raw
uxnan-cli skills get control [--full]           # the guide
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

**How it finds the app.** Inside a terminal Uxnan launched, from the
environment (`UXNAN_HOOK_URL` + `UXNAN_HOOK_TOKEN`, and `UXNAN_AGENT_ID` for
`current`). Anywhere else, from the discovery file in the app's data directory
— the same rules the app uses (`UXNAN_DATA_DIR` override; the platform's
per-user data directory; the `-dev` profile for a debug build, so a debug CLI
finds a debug app and never the installed one).

**Building and running it.** `cargo build -p uxnan-cli --release` in
`src-tauri/` produces `target/release/uxnan-cli`. Put it on the `PATH` by hand
for now; bundling it with the installers and a Settings → Control → *Install
`uxnan-cli`* action are FOR-DEV.

## For the agent

An agent Uxnan launches needs no instructions: the MCP server's `initialize`
tells it what the tools are for, and each tool describes itself. The published
`uxnan-control` skill is for an agent that runs **outside** Uxnan and reaches the
app through `uxnan-cli`: a short `SKILL.md` (purpose, commands, selectors, exit
codes) with `references/catalog.md` — which **is** the output of `uxnan-cli
skills get control --full`, so when the catalog grows the reference is
regenerated, never hand-edited — plus `references/protocol.md` (the wire
contract for scripts) and `references/workflows.md` (recipes).

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
  a hook report needing the launch token, and live control-token rotation.
- **CLI** (`cargo test -p uxnan-cli`): the HTTP client's round trip against a
  stand-in server, response parsing, the origin derivation, the process
  start-time check, the guide naming every entry and exit status, the table
  and record renderers.
- **Window** (`npm run test:dom`, `src/lib/control/bridge.svelte.test.ts`):
  the tab listing, reveal/open/diff, run list/show, an unknown method answered
  with an error, and the reply through `control_respond`.
- **By hand**: run the app (`npm run tauri dev`), then in another shell
  `uxnan-cli status`, `uxnan-cli terminal ls`, `uxnan-cli file diff <path>
  --worktree path:<folder>`; and from inside a Uxnan terminal, `uxnan-cli
  terminal show current`.
