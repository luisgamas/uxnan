# Bridge — how agents are driven

![Agents](https://img.shields.io/badge/active_agents-7-2ea44f?style=for-the-badge)
![Transport](https://img.shields.io/badge/driven_via-official_local_CLI-339933?style=for-the-badge&logo=gnometerminal&logoColor=white)
![No keys](https://img.shields.io/badge/no_API_%7C_no_SDK_%7C_no_keys-0a0a0a?style=for-the-badge)

## Execution model (no provider API, no SDK, no keys)

For each agent, the bridge spawns that vendor's **official local CLI** as a child
process and talks to it over stdio — exactly as you would in a terminal. It does
**not**:

- call any provider HTTP API,
- store or use an API key,
- embed a language/Agent SDK,
- reuse/scrape the CLI's auth token, or proxy/resell access.

Each supported CLI runs under whatever account/subscription **you** already authenticated it
with (`claude`, `codex login`, OpenCode, `pi`, `agy`, Zero or Grok). The bridge stores no tokens;
auth and billing are the CLI's own. This is the supported *headless* use of each
CLI (`claude -p`, `codex app-server`, `opencode serve`) — so it does not require a
separate paid account beyond what that CLI already has, and it is not an unofficial
API wrapper. Rate limits are whatever your plan allows.

Every spawn is `shell:false` (no shell injection), and a prompt never travels as
an argv element on the turn path: the three process-driven agents write it to a
stdin pipe as one message of the CLI's own stream, and the server-based ones put
it in a request body. What differs is how long a process lives:

- **Claude Code** is **one process per turn**: `claude -p --input-format
  stream-json` reads the prompt from stdin, keeps the pipe open for the length of
  the turn — which is what lets a follow-up reach it mid-run (see below) — and
  exits with the turn; `--resume` joins the next process to the same session.
- **pi** and **Antigravity** are **one resident process per thread**: `pi --mode
  rpc` and `agy --input-format stream-json --output-format stream-json` both read
  one turn at a time from an open stdin, so the same authenticated process, with
  the session already in memory, answers turn after turn. That is what removes
  the per-turn cold start (`agy` re-ran its Google sign-in check on every turn:
  2.5 s cold vs 1.0 s warm, measured; pi re-read its session JSONL from disk).
  The process is torn down after 24 hours without a turn
  (`DEFAULT_PI_IDLE_TIMEOUT_MS` / `DEFAULT_ANTIGRAVITY_IDLE_TIMEOUT_MS`, re-armed
  by every completed turn), when a spawn argument changes (cwd, model, effort or
  posture — a new process resumes the same session), on cancel, and when the
  thread is archived or deleted (`thread/archive` / `thread/delete` call
  `AgentManager.closeThreadSession`). A later turn simply spawns a new process
  on the same session id, so a teardown costs one cold start, never history.
- The **server-based** adapters talk to a long-lived server: **Codex** speaks
  JSON-RPC over `codex app-server` stdio, **Zero** and **Grok** speak JSON-RPC
  (the Agent Client Protocol, NDJSON) over `zero acp` / `grok agent stdio`, and
  **OpenCode** speaks HTTP + SSE to `opencode serve` — OpenCode 1 and 2
  alike, through one adapter over two protocol clients (see *OpenCode 1 and
  OpenCode 2* below).

The one-shot **side errands** (naming a thread, listing models) still pass their
prompt as an argv element, still `shell:false`.

### One turn per thread, and the queue that follows from it

The bridge drives **one turn per thread**, and this is a hard constraint, not a
policy: the one-shot agent resumes its own session per turn (`claude -p
--resume`), so two concurrent turns would be two CLI processes writing to the
same session file; the resident-process agents (pi, Antigravity) read one turn
at a time from stdin, so a second message would be queued by the CLI itself as
the *next* turn, streaming into a turn the bridge already closed; and the
server-backed agents serialize prompts per session.

So a `turn/send` that arrives while a turn is in flight is **queued** rather than
started — the same thing the CLIs themselves do when you type a follow-up while
they work. It runs on its own once the current turn completes, through the
identical code path a normal turn takes, which means **queueing behaves the same
for all seven active agents** regardless of how their CLI is driven.

### …and when it goes at the end of the agent's step

Waiting for the whole turn is not what the CLIs do. They take what you type at
the next tool boundary, *inside* the running turn — which is what lets you
correct an agent's course without stopping it — and they show it waiting until
then. The bridge does the same wherever the agent's CLI actually allows it:

- the follow-up **always waits in the queue first**, where it can be edited,
  cancelled or sent now — the first one too — however long the agent's current
  step takes, even if it hangs;
- the **first** queued message goes to the agent when the step it is in (a
  command, a tool, a subagent reported `running`) **ends** and none is left
  running (`#deliverAtPause`, `agent-manager.ts`). From that hand-over until
  the agent takes it, it stays in the queue marked `deliveringTurnId` and can
  no longer be taken back (`turn/cancel` refuses);
- it is placed in the conversation when the agent **reads** it — Claude Code
  echoes it (`--replay-user-messages`; written as a step ends, it may read it
  there or at its next pause), and the others accept it at once. The turn that
  was answering ends there, with what the agent had said, and the follow-up's
  turn carries the rest of the same agent run — so what the agent says after
  reading the message shows under it, on every client, exactly like a queue
  that drained early (`turn/completed`, then `turn/started`);
- one at a time, in order, one per step end; a message that meets no step end
  before the turn ends (the agent was only writing) runs as the next turn.

**`queue/sendNow` forces it, on every agent.** While a turn runs it **stops**
that turn and the chosen message runs as soon as the stop lands, first in line
(`#sendNextAfterStop`; that stop does not pause the queue, even when the agent
reports it as an error). It is the one thing that reaches an agent stuck in a
step: no agent reads a message before its step ends. What the agent had done
stays in the stopped turn; the rest of the queue keeps its order. With nothing
running (a paused queue) it runs the message at once. So that the forced
message starts on a clean session, **OpenCode does not report a stop until its
server closed the stopped run** (`idle` on 1.x, `interrupted` or a failure on
2.x; 5 s at most) and drops whatever that run still sends — found live, where
the cut-short tool and the run's end landed on the next turn and aborted it.

The adapter keeps naming the run by the id it started with; the manager maps it
to the turn now showing its output. Automatic delivery never happens while the
queue is **paused** (the user stopped the agent, or it broke), while the agent
waits on an approval or a question, or for another agent than the one running.
**Every refusal leaves the message in the queue**, so it is never lost — at
worst it waits for the turn to end.

Which agents can, and why — verified against the real CLIs:

| Agent | Mid-turn? | Mechanism |
|---|---|---|
| **Claude Code** | yes | `-p --input-format stream-json`; the message is written to the open stdin |
| **OpenCode** | yes | 1.x: another `prompt_async` on the session that is already busy; 2.x: `POST /api/session/:id/prompt` with `delivery: "steer"` (both verified live: the turn answered the new message and ended once) |
| **Codex** | yes | app-server `turn/steer { threadId, expectedTurnId, input }` |
| **pi** | yes | RPC `steer` command, drained by its agent loop at the next boundary |
| **Antigravity** | no | `--input-format stream-json` "runs a turn for each" stdin message — a second one is queued as the next turn, not steered into this one; the CLI has no steer message |
| **Zero** | no | its ACP serializes prompts per session (`turnMu`) — and its own TUI does not inject either: it launches a queued message only once the turn ended |
| **Grok** | no | ACP defines no steer method and advertises none on `initialize` |

Zero is the instructive case: it **already behaves like the bridge's queue**, so
there is no native behaviour to match there.

**"Taken" means the running run will answer it.** `steerTurn` returns `true`
only then, and each adapter holds to it with what its CLI really says (all
verified live on 2026-09-28):

- **Claude Code** writes every stdin message with a `uuid` and runs with
  `--replay-user-messages`: the CLI echoes each one (`isReplay: true`) as it
  reads it. A `result` ends the turn only once every message written was read,
  so a wake-up the CLI runs on its own (background work that finished, or a
  `<task-notification>` a resumed session still owed) or the model turn a late
  message missed never closes it — the case that closed a real turn in a second
  while the agent worked on for 13 minutes. `steerTurn` resolves when the echo
  arrives, so the message is placed when Claude read it. A CLI that exits
  without a `result`, without reading the prompt, or because the bridge is
  stopping fails the turn with the tail of its stderr instead of completing it;
  a follow-up it never read goes back to the queue.
- **pi** waits for its RPC `response` to the `steer` (pi 0.85.1 answers
  `success` in ~20 ms, busy or idle); a refusal leaves the message queued.
- **OpenCode**: an `idle` that lands while a message is being handed over waits
  for the answer; one the server accepted runs as another run (OpenCode 2.0.16:
  its reply, then a second `idle`), and the turn stays open until that `idle`.
- **Codex**: `turn/steer` with `expectedTurnId` only lands on the active turn.
- The **manager** holds a run's end while a hand-over is in flight (and an end
  releases a hand-over waiting for steps), so a message accepted just as the
  run finished is answered in its turn and never sent twice.

Verified live on 2026-10-01 with every wired agent, through the real manager
and adapters: a follow-up sent during a 20 s command stayed an ordinary queued
message until the command ended — then Claude Code, Codex, OpenCode and pi took
it and answered it in the same run, and Antigravity, Grok and Zero ran it next;
and *send now* during a `sleep 300` stopped the turn and the message was
answered at once, on all seven.

The turn a hand-off ended names the next one (`Turn.continuedIn`, and
`continuedIn` on its `stream/turn/completed`), so clients show its reply as the
answer so far rather than a closing one.

The phone must read *both* signals before promising anything: `bridge/status`
→ `features.midTurnDelivery` (this bridge can) and `agent/list` →
`capabilities.steering` (this agent allows it).

Behaviour details (cap, pausing after a stop, cancelling a queued turn) are in
[`../../architecture/02b-contracts-and-requirements.md`](../../architecture/02b-contracts-and-requirements.md)
§1.2.

### Naming a conversation

No agent CLI hands a client a title. Every one of them leaves it to its own
client — Codex Desktop, the OpenCode TUI and Claude's picker all name
conversations themselves — and the headless surfaces expose none: a thread uxnan
creates comes back from `codex thread/list` with `name: null`, a fresh OpenCode
session stays `"New session - <timestamp>"`, and Claude's session `name` is
derived from the folder, not the content. uxnan is the client, so uxnan names
them, in two stages: the opening message titles a thread instantly, and once its
first turn has an answer the agent writes the real one.

That second step is a **side errand, not a turn** — a one-shot with no session
id, so nothing enters the conversation's history — on the agent's **cheapest**
model, because a six-word title is not work for the model the user is paying
attention to.

| Agent | One-shot used | Title model |
|---|---|---|
| **Claude Code** | `-p` with no `--resume` | `haiku` |
| **Codex** | `codex exec --ephemeral -s read-only --skip-git-repo-check -o <file>` | `gpt-5.6-luna` at `-c model_reasoning_effort=low` |
| **OpenCode** | `opencode run` (no `--session`/`--continue`); on 2.x `opencode run --standalone`, so a title never starts the shared background service | CLI default |
| **pi** | `pi -p --no-session` | CLI default |
| **Antigravity** | `agy -p --mode plan` (no `--conversation`) | `gemini-3.6-flash-low` |
| **Grok** | `grok -p` | CLI default |
| **Zero** | `zero exec` | CLI default |

**Cheap means cheapest on the bill, measured — not the smallest-sounding name.**
Codex names on `gpt-5.6-luna` rather than the `mini` tier because Luna wins on
both halves ($0.20/$1.20 per 1M tokens against mini's $0.75/$4.50) *and* spent
fewer tokens naming the same conversation (13.4k vs 18.3k) — about 5× cheaper
per title. Its effort is pinned to `low` because Luna's own default is `medium`,
and reasoning tokens are exactly what can make a cheap model cost more than an
expensive one on a task this small; `-c` keys are validated, so a typo fails the
run instead of quietly naming on the default tier.

**Each pinned id has a twin in the desktop app** (`uxnandesktop/src-tauri/src/
convtitle.rs` → `title_model` / `title_effort_args`), which names terminal tabs
the same way. Move both halves in the same change set — the bridge once passed
**no** model for Antigravity while both the spec and the desktop said it named
on the cheap flash tier, so every phone-side title quietly ran on the account's
frontier model.

Codex needs all three flags: `--ephemeral` writes no session file, `read-only`
denies the sandbox any write, and `-o` yields the final message **alone** — its
stdout carries a banner, hook lines and a token count, so parsing that would be
guesswork.

Six are verified live; **Zero is not** (not installed, no credits) — its form is
confirmed against Zero's own source, which drives itself that way in its eval
harness. OpenCode, pi and Grok route through many providers, so there is no
fixed cheap-tier id to pin and they title on their own default.

**Model ids are checked against each account's real list, never assumed.** A
wrong id is not cosmetic: the CLI rejects the run and the thread silently keeps
its provisional name. That is how the desktop's `agy` mapping was caught —
`agy models` lists `gemini-3.6-flash-*`, not `gemini-2.0-flash`.

The whole path is best-effort and bounded (30s): no credit, a missing CLI or a
timeout leaves the provisional title in place and never disturbs the thread.

**The name is mirrored back onto the agent's own session when its CLI keeps
one.** Codex does (`thread/name/set`), so a conversation started on the phone
shows the same title in Codex Desktop and `codex resume` instead of appearing
untitled. It is an optional adapter capability (`setNativeTitle`, read
structurally by the `AgentManager`), so agents without a
name concept are unaffected, and it needs no loaded thread — verified against
codex-cli 0.147.0 from a process that never resumed it: the name lands in
`~/.codex/session_index.jsonl`, which is the list those clients read.

## Drive surface (read this before touching an adapter)

Every wired CLI exposes **more than one** headless surface, and they do not
behave alike — the same CLI can report token usage on one and nothing on
another. This table is the record of which surface the bridge actually drives,
so a future change is validated against the right one.

**This has bitten us twice.** Usage was once read from `zero exec`'s session
store and from the transcript `grok -p` writes; both are real, and both are
invisible to the surface the bridge uses. **Never validate an adapter against a
surface it does not drive.**

| Agent | Surface the bridge drives | Transport / framing | Reports usage |
|---|---|---|---|
| **OpenCode** | `opencode serve` — 1.x: V1 routes, no password; 2.x: `/api/*` routes behind a per-process password (see *OpenCode 1 and OpenCode 2*) | local HTTP + SSE | yes — 1.x on `step-finish` parts / the assistant `message.updated`; 2.x on `session.step.ended`. The context window comes from `opencode models --verbose` (1.x) or `GET /api/model` (2.x) |
| **Claude Code** | `claude -p` | NDJSON both ways (`--input-format`/`--output-format stream-json`), prompt + follow-ups on an open stdin; `--replay-user-messages` echoes each message as the CLI reads it | yes |
| **Codex** | `codex app-server` | JSON-RPC 2.0 over NDJSON stdio | yes — on its **own notification**, `thread/tokenUsage/updated` (a completed turn carries none), which also brings `modelContextWindow` |
| **pi** | `pi --mode rpc`, one resident process per thread | JSON-RPC over stdio (`prompt` / `steer` / `get_state` commands in, JSON events out) | yes — `message_end` `usage.totalTokens`; the model's `contextWindow` comes from the `get_state` response |
| **Grok** | `grok agent stdio` | ACP (JSON-RPC over stdio) **plus `_x.ai/*` extension methods** | yes — on `_x.ai/session_notification`, **not** on ACP's own `session/update`; the `turn_completed` update carries the `usage` block |
| **Zero** | `zero acp` | ACP (JSON-RPC over stdio) | **no** — see below |
| **Antigravity** | `agy --input-format stream-json --output-format stream-json`, one resident process per thread | NDJSON both ways (a `user` message in, `init` / `step_update` / `result` events out) | yes — on the **last `agent_response` `step_update`** of the turn, NOT on `result.usage`: see below |

One agent reports no usage, and one reports two different numbers — both are
the same trap, a real signal that is not the one the meter wants:

- **Zero.** It appends a `provider_usage` event per turn to its session store,
  but only for a session driven by `zero exec`. Verified by running the adapter
  and reading the store it wrote: an **ACP-driven** session holds `message`
  events and nothing else. `reportsContextUsage` is false so the phone hides the
  meter rather than showing one pinned at zero.
- **Antigravity.** Under `stream-json`, `agy` attaches `{input_tokens,
  output_tokens, thinking_tokens, cache_read_tokens, total_tokens}` in two
  places, and only one of them is a context size. Every `DONE` `agent_response`
  `step_update` carries **that model call's** usage, and the last one of a turn
  is what the conversation occupies: the adapter emits `input + cache_read +
  output` from it (`thinking_tokens` are inside `output_tokens`; `total_tokens`
  leaves the cache part out). The `result` event's `usage` is **summed over the
  whole conversation** — captured live on `agy` 1.2.7, turn 2 reported 18 324
  input tokens = 13 184 from turn 1 + 5 140 of its own, with `num_turns: 2`, and
  a resumed turn 3 kept adding — so a meter fed from it climbs forever. And the
  surface carries **no reasoning text**: `thinking_tokens` is a count, the
  model's thoughts never appear on stdout (they live in `agy`'s private
  transcript on disk, which the bridge does not read — [`../FOR-DEV.md`](../FOR-DEV.md),
  *Antigravity native-session history*), so Antigravity emits no `thinking`
  event.

Session ids follow the same rule — take them from what the driven surface says,
not from what a flag suggests:

- **Antigravity.** `agy` owns the conversation id. Since 1.2.x a client-minted
  `--conversation <uuid>` is answered with `warning: conversation "<uuid>" not
  found` and a **new** conversation — on `main` before the resident session this
  meant the thread silently lost its history on every turn (verified: the second
  turn answered "None" when asked what it had just said). The adapter therefore
  runs a thread's first process **without** `--conversation`, adopts the id
  `agy` announces on its `init` event, and passes that id back on every later
  spawn for the thread.
- **pi.** `--mode rpc` emits **no** `session` event (`-p --mode json` does, which
  is where the id used to be read — and why, after the move to RPC, no id was
  captured at all and every turn started a new session). The adapter sends
  `get_state` right after spawning and reads `sessionId` (and the model's
  `contextWindow`) from the response; a later spawn passes `--session-id <id>`,
  which resumes the session, "creating it if missing".

### The environment an agent is spawned with

Every spawn passes an **explicit** environment, never the implicit inherited one:
the bridge's own, minus the keys the desktop ADE injects into one terminal of one
launch (`UXNAN_AGENT_ID`, its hook server's url/token, the endpoint file, the
browser / MCP endpoints), plus whatever the adapter sets deliberately — which
wins. `agentEnv` in `src/adapters/spawn.ts` is the one place that decides this;
a new spawn site must use it.

The reason is that environment variables are inherited by the whole process tree.
Start the bridge **inside** an ADE terminal and it is handed that terminal's
identity; without the scrub every agent it spawned inherited it too, and their
hooks reported to the ADE as if they *were* that terminal — an agent card on a
terminal where nobody launched an agent, with a session stamped on the tab. The
bridge's own approval hook is unaffected: it uses three of those names
(`UXNAN_HOOK_URL` / `_TOKEN` / `_THREAD_ID`) for its own server, but it **sets**
them per turn and a value it sets survives. Only an inherited one is dropped.

### Which agents are installed (one rule, shared with Uxnan Desktop)

Every agent CLI is found with `locateAgent` (`@uxnan/shared`) over the table in
`shared/agent-locations.json` — the same file Uxnan Desktop compiles into its
Rust resolver, so the phone, the desktop's chat and its terminals agree on what
is installed. Per agent, in order: native install paths, then the npm entry
under each npm root (including the running node's own prefix — nvm, fnm,
Homebrew, a custom npm prefix), then the command on `PATH` (on Windows only a
real `.exe`/`.com`). A path configured in `agents.<id>.binaryPath` always wins.

`uxnan-bridge start` first adds the user's login-shell `PATH` to its own
(`login-path.ts`), because a service or a GUI launch starts with a minimal one.
Detection is live: `agent/list` re-checks at most every 10 s, an agent
installed while the bridge runs gets its adapter built where it was found, and
every client hears it (`stream/agents/updated`). `agent/doctor` lists, per
agent, the command it runs and every location it checked.

### MCP servers for every run: the bridge's own and the desktop's

Every turn carries one ordered list, `SendTurnOptions.mcpServers`
(`AgentMcpServer { name, url, token }`):

- **`uxnan` — the bridge's own server, always.** A minimal Streamable HTTP MCP
  server on `127.0.0.1` (random port, `/mcp`), with a fresh 32-byte bearer
  token per daemon start (`src/views/mcp-server.ts`). It serves `view_show`
  (see *Agent views* below), so it is there with or without a desktop.
- **`uxnan-browser` — Uxnan Desktop's server, while one is attached.** The
  desktop attaches the server it hands the agents in its terminals (browser,
  terminals, other agents, the control catalog) with
  `desktop/attach { mcpUrl, token }` — accepted only from a local client and
  only for a loopback `/mcp` endpoint. A turn sent by a desktop gets that
  desktop's; a phone's turn gets the one attached longest; a client's entry
  goes when it disconnects.

An adapter registers **every server of the list for its own conversation
only**, under the server's `name`, with the token never in argv or a file (only
in the environment or in a message on the agent's stdin) and the conversation's
folder in the `x-uxnan-cwd` header (`UXNAN_CWD_HEADER`), percent-encoded
(`encodeCwdHeader`) so any path is a valid header value. A changed list
(attached, detached, a new token) reaches the next turn: resident processes
recycle, server-backed agents get the new per-thread config.

| Agent | Mechanism | Verified |
|---|---|---|
| **Claude Code** | `--mcp-config '<json>'` per run, one entry per server; `${UXNAN_MCP_TOKEN_<n>}` / `${UXNAN_THREAD_CWD}` in its headers expanded from the env at load | claude 2.1.282: connects, lists and calls, both headers expanded. 2026-10-08, claude 2.1.293 through a scratch bridge: `view_show` called, `view` block out |
| **Codex** | per-thread `config` on `thread/start` / `thread/resume` (`mcp_servers.<name>` with `http_headers`) — one app-server serves every thread, so the override is per thread, not per process | codex-cli 0.156.1: connects for that thread only; the token reaches neither the rollout, the state DB nor the logs. 2026-10-08, 0.161.0: `view_show` called, `view` block out |
| **OpenCode** | `OPENCODE_CONFIG_CONTENT` on the folder's `opencode serve` (merged over the user's config), one entry per server, tokens by reference (`{env:UXNAN_MCP_TOKEN_<n>}`); an idle server restarts when the list changes | opencode 2.0.16: connects once the folder loads, sends both headers, calls. 2026-10-08, 2.0.24 (`opencode/mimo-v2.6-flash-free`): the model reaches the tool from its code-mode `execute` (`tools.uxnan.view_show(...)`) — the result still carries the marker, so the step becomes the view |
| **pi** | the bridge's extension, `-e dist/src/adapters/pi-desktop-extension.js` (Streamable HTTP over `fetch`, one pi tool per MCP tool), fed `UXNAN_MCP_SERVERS` / `UXNAN_THREAD_CWD` through the env, so nothing is written to pi's own MCP config (pi 1.1.0 does ship a client of its own — `pi mcp add`, `~/.pi/agent/mcp.json` — which the bridge leaves alone); the resident process recycles on a change. **Not in the read-only posture** (`--tools` is a strict allowlist, and the tools act) | pi 0.85.1, through the bridge: the model is offered the tools, a call with arguments reaches the server and its answer ends the turn; the token reaches no session file. 2026-10-08, pi 1.1.0 (`openrouter/cohere/north-mini-code:free`): `view_show` called, `view` block out |
| **Grok** | ACP `mcpServers` (http variant, one per server) on `session/new` / `session/load`, sent only when `initialize` advertises `agentCapabilities.mcpCapabilities.http` | 2026-10-08, grok 1.0.46 through a scratch bridge: the model finds `uxnan__view_show` with its `SearchTool` and calls it with `UseTool`; the result arrives only in the update's `rawOutput` (`{ type: 'MCP', output: { OkayOutput } }`), which the bridge now reads when `content` has no text |
| **Antigravity** | `agy` reads MCP servers only from its user-global `~/.gemini/config/mcp_config.json`, so the running bridge keeps ONE secret-free entry there (`agy mcp add uxnan-browser -- <node> <cli.js> mcp-proxy`, `agents/global-mcp-entry.ts`): a stdio proxy (`adapters/mcp-proxy.ts`) that fronts every server of `UXNAN_MCP_SERVERS` from the environment the bridge gives `agy` (and, for an `agy` Uxnan Desktop launches in a terminal, the desktop's `UXNAN_MCP_URL` / `UXNAN_MCP_TOKEN` pair), and outside either answers as a server with no tools. The resident process recycles on a change. Removed by `uninstall-service` | agy 1.2.10, real turn: the tools are discovered through the proxy and a call answers, token and folder on every request. **`view_show` not yet run live** — the global entry belongs to the installed daemon and points at its proxy (`bridge/FOR-DEV.md`) |
| **Zero** | **not reachable.** `zero acp` ignores ACP `mcpServers` (the bridge still sends them the moment it advertises HTTP MCP — same code path as Grok), and its stdio MCP servers run inside its macOS sandbox with the network denied, so a proxy cannot reach either server. No views on Zero (`bridge/FOR-DEV.md`) | zero 0.9.0: `initialize` advertises no `mcpCapabilities`; a stdio server's loopback HTTP and Unix-socket connections fail with `EPERM` (`ZERO_SANDBOXED=1`) |

The proxy entry is only ever written by the long-running daemon (`uxnan-bridge
start`), never by a test or a short-lived command, and is left alone once it
already points at this bridge. Launched from one of Uxnan Desktop's own
terminals, the same proxy forwards that terminal's `UXNAN_AGENT_ID`, so the
desktop scopes it like any agent it launched.

### Agent views (`view_show`)

`view_show { title, html? | path?, height? }` lets an agent show a
self-contained HTML page — a chart, table, diagram, comparison, mockup or small
tool — inline in the chat, on the desktop and on the phone. The tool's
description and the server's `instructions` are how the agent learns it has it
and how to use it (self-contained, no network, light, the theme variables).
`path` is read from the conversation's folder with the workspace path guard;
pages are capped at 512 KiB, prepared (the no-network CSP, charset, viewport
and the view bootstrap put first, before anything the agent wrote — a `<meta>`
policy only governs what follows it) and stored in `~/.uxnan/views/` (newest
500 / 256 MiB kept). The answer carries `uxnan-view:<viewId>`.

**How an agent knows to show one.** The person never names the tool, so the
tool's description and the server's `instructions` state the rule — numbers to
compare, a trend, a breakdown, a ranking, a schedule, a diagram or a mockup go
in a view, on the agent's own initiative — rather than allowing it as an
option. Codex does not put an MCP server's `instructions` in front of its model,
so for Codex they travel as the thread's `developerInstructions` on
`thread/start` / `thread/resume` (`AgentMcpServer.instructions`,
`codexDeveloperInstructions`); nothing is ever added to the person's message.
Measured on 2026-10-08 with an ordinary question ("this week I spent these
tokens per day: …; how does my week look? compare them"), a view shown without
being asked:

| Agent (model) | Optional wording | Rule, MCP channel only | Rule + Codex developer instructions |
|---|---|---|---|
| Claude Code (haiku 5.5) | 0/1 | 1/1 | — |
| Codex (gpt-6-luna) | 0/1 | 0/3 | 3/3 |
| OpenCode (`space-bunny-free` / `mimo-v2.6-flash-free`) | 0/1 | 7/10 (tool description only) | with the `uxnan-views` skill: mimo 3/3, space-bunny about half (see below) |
| pi (`openrouter/cohere/north-mini-code:free`) | — | 1/1 | — |
| Grok | — | 1/1 | — |

**OpenCode 2 needs a skill.** Its model never sees an MCP tool directly — they
sit behind its code-mode `execute` tool — and it is handed neither an MCP
server's `instructions` nor a prompt's `system` field (accepted, ignored;
asked, the model says it sees neither; opencode 2.0.24). It does list every
skill, name and description, in its `skill` tool. So the bridge writes a skill
of its own, `uxnan-views`, into its state folder
(`<state>/agent-skills/uxnan-views/SKILL.md`, `views/view-skill.ts`) and hands
OpenCode that folder as an extra skills path in the run's config
(`AgentMcpServer.skills` → `skills.paths` in `OPENCODE_CONFIG_CONTENT`); the
person's own skills stay listed beside it. Measured: `opencode/mimo-v2.6-flash-free`
3/3, `opencode/space-bunny-free` about half — that model follows instructions
loosely (`FOR-DEV.md`).

The step becomes the view in **one place**, `views/convert-view-block.ts`, run
by the `AgentManager` on every adapter's blocks: a finished, non-error tool
block whose output carries the marker of a view this bridge just made becomes a
`view` block (same `blockId`) — **whatever the tool is called**, because agents
reach it under their own names and wrappers (`mcp__uxnan__view_show`, Codex's
`view_show`, OpenCode's code-mode `execute`, Grok's `UseTool`). Each view is
claimed once, so a later step that merely prints an old marker stays a step. A
`view_show` step that is running, failed or names no live view stays a tool
step, with its `html` replaced by `htmlBytes`. Clients fetch the page with
`view/read`.

The probe that verified the table above (2026-10-08) is a scratch bridge from
`bridge/dist` (`startBridge({ baseDir: <tmp>, secretStore: new
InMemorySecretStore() })`, no LAN, relay or global entries) that sends each
agent "call view_show once" through `thread/start` + `turn/send` and checks for
a `view` block and a `view/read` page that starts with the policy — the real
CLIs with the user's own sign-ins, nothing written to their configs.

**Model lists follow the same read-the-source rule.** Every agent's list is
**discovered live** from the CLI — `opencode models` (`GET /api/model` on
OpenCode 2), `model/list`,
`pi --list-models`, `agy models`, `zero models list`, Grok's `initialize`
handshake. **Claude Code is the only curated, hand-maintained list** (see
*Claude Code models* below); it is the one place a new model has to be added by
hand, and it has a matching half in the desktop app.

**A discovered list is only as stable as the CLI's output format — re-capture it
before trusting a parser.** `agy models` changed shape between 1.1.4 and 1.1.13:
it now prints a progress line first and then two TAB-separated columns.

```text
Fetching available models...
gemini-3.7-flash-high⟨TAB⟩Gemini 3.7 Flash (High)
```

The **first column is the `--model` routing key** (it already carries the
reasoning tier — `--model gemini-3.5-flash` alone is refused with "requires
`--effort`", so the bridge never passes `--effort`), and the second is the label
the phone shows. A parser written for the old one-value-per-line shape kept
"working" silently: it sent the *whole line* as `--model`, which `agy` rejects,
and it offered `Fetching available models...` as a model — the first entry, so
also the default. Both were verified live against `agy` 1.1.13: `--model
gemini-3.5-flash-low` and `--model "Gemini 3.5 Flash (Low)"` run, the whole line
does not. The desktop app parses the same output ([`../../uxnandesktop/docs/agent-launch.md`](../../uxnandesktop/docs/agent-launch.md)),
so a format change there is a **two-app** fix.

## Wired agents

| Agent | CLI invocation | Continuity | Permission posture | Models |
|---|---|---|---|---|
| **OpenCode** (default) | `opencode serve` (local HTTP + SSE), 1.x or 2.x | persisted server session id | per-session permission rules + its `plan` agent — see *Access modes*; the rules are re-applied before a turn whose mode changed (`PATCH /session/:id` on 1.x, `PATCH /api/session/:id` on 2.x) | `opencode models` (1.x) / `GET /api/model` (2.x) |
| **Claude Code** | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --replay-user-messages` (prompt and uuid-tagged follow-ups on stdin) | `--resume <session_id>` | per-turn flags — see *Access modes* | `initialize` `models`: aliases (latest), what each runs, older ids **+ `agents.claude-code.models`** |
| **Codex** | `codex app-server` (JSON-RPC over stdio), **one process per turn** | persisted app-server thread id: `thread/start` once, `thread/resume` on every later turn | `approvalPolicy` + `approvalsReviewer` + sandbox on `thread/start`, every `thread/resume` and every `turn/start` — see *Access modes*; approval requests route to the phone | `model/list` (account-aware) → `~/.codex/config.toml` fallback |
| **pi** | `pi --mode rpc` — one resident process per thread; prompt + follow-ups as RPC commands on stdin | `--session-id <id>`, the id read from `get_state` on the first process, passed on every later spawn for the thread | no access modes: `permissionMode` → built-in read/bash/edit/write / `--tools read,grep,find,ls` / `--approve` | `pi --list-models` (real list; reasoning knob per model) |
| **Antigravity** | `agy [--conversation <id>] --add-dir <cwd> (--dangerously-skip-permissions \| --mode plan) --input-format stream-json --output-format stream-json --print-timeout 2h` — one resident process per thread; the turn is a `user` message on stdin | `--conversation <id>`, the id `agy` announced on the first process's `init`, passed on every later spawn for the thread (never client-minted: 1.2.x refuses an unknown id and starts a new conversation) | no access modes (headless `agy` cannot ask): `permissionMode` → `--dangerously-skip-permissions` (default) / `--mode plan` | `agy models` (real list; the Gemini family + hosted others), read as `<id>⟨TAB⟩<label>` — the id routes, the label is shown |
| **Zero** | `zero acp` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | ACP session mode `ask`/`auto`/`plan` — see *Access modes* | `zero models list` (real list; `contextWindow` from `ctx=`) |
| **Grok** | `grok agent stdio` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | only *request approval* and *full access* (see *Access modes*): each ACP `session/request_permission` asks the phone / is allowed; a request for no turn of the bridge's is refused. **Grok decides by itself whether to ask**, from its `[ui] permission_mode` and the `defaultMode` of the Claude settings it also reads; under `auto` its classifier runs tools without asking (measured: `rm -rf` ran on a thread set to request approval), and ACP offers no per-session way to turn that off, so such a thread gets a warning once per session naming the mode and the file (`grokPermissionSource`). Verified: with Grok asking, the round-trip reaches the phone and `reject-once` blocks the command | `initialize` `_meta.modelState` (context window + reasoning-effort knob per model); the chosen effort is set with `session/set_config_option` on the session's `thought_level` option (`reasoning_effort`) — `session/set_mode` accepts anything and changes nothing |


### Access modes

A conversation's access mode means the same on every agent; each adapter
declares the modes it can honor (`capabilities.accessModes`) and its default
(`defaultAccessMode`), and the apps offer only those. The bridge runs a stored
mode the agent does not offer as its default (the apps say so), refuses a
`thread/setAccessMode` the agent cannot keep, and starts a new conversation in
the agent's default. Verified live on 2026-10-02 (claude 2.1.287, codex-cli
0.157.1, opencode 2.0.19 and 1.18.34, zero 0.9.0) with the same probe: write a
file in the project, touch one outside it.

| Agent | Request approval | Approve for me | Full access | Plan only | Default |
|---|---|---|---|---|---|
| **Claude Code** | `PreToolUse` hook to the phone + `--permission-mode default` — offered only when the bridge serves the hook (LAN on); a turn before its URL exists fails rather than run unasked | `--permission-mode auto` (Claude's own reviewer). Not every model has it: **Haiku 4.5** starts in `default` and declines what needs approval (its `initialize` entry carries no `supportsAutoMode`) — the turn says so (`system/init` reports the mode). Every other model, Haiku 5.5 included, reports `supportsAutoMode: true` | `--dangerously-skip-permissions` | `--permission-mode plan` | full access |
| **Codex** | `untrusted` + reviewer `user` + `workspace-write` | `on-request` + reviewer `auto_review` + `workspace-write` (its own reviewer decides sandbox escapes; measured: a write outside the workspace was approved without asking) | `never` + `danger-full-access` | `never` + `read-only` | full access |
| **OpenCode** | every gated action `ask` | `edit`/`shell` allow, `webfetch`/`external_directory` ask — OpenCode checks paths on its file tools, not on shell commands, so a command can still reach outside | everything `allow` | its `plan` agent (v1 `agent` on the prompt, v2 `POST /api/session/:id/agent`) + every action `ask` as a backstop. Not `deny` rules: OpenCode's free models refuse a session that denies tools ("free tier can only be used from within OpenCode") | full access |
| **Zero** | ACP mode `ask` | ACP mode `auto` (runs safe tools, asks before risky ones — those questions go to the person) | **not offered**: `zero acp` cannot run outside its sandbox (no ACP mode, no flag; only the user's global config) | ACP mode `plan` | approve for me |
| **Grok** | ACP requests go to the phone (when Grok's own configuration asks at all) | **not offered** (no reviewer of its own) | ACP requests allowed | **not offered** (no ACP modes) | full access |
| **pi**, **Antigravity** | — | — | — | — | no modes: run as configured (`permissionMode`) |

Approval replies are sent in each request's own shape: Codex's v2 item
approvals take `accept` / `acceptForSession` / `decline` (the legacy v1 names
keep `approved` / `approved_for_session` / `denied`); a reply in the other
shape is ignored and Codex asks again.

Seven agents are active. No further agent is planned right now (the recipe for
wiring a new one is in [`../FOR-DEV.md`](../FOR-DEV.md)).

> **Do not reintroduce the standalone Gemini CLI.** It was removed in August
> 2026. Google's supported integration is Antigravity (`agy`). Gemini-family
> model names returned by Antigravity or Pi remain valid model data.

### Context compaction

Compactions use the ordinary structured-content path and therefore persist in
`Message.segments` and replay through `turn/list`:

| Agent | Native signal | Marker metadata |
|---|---|---|
| Codex | completed `contextCompaction` item | reason unknown |
| Claude Code | `system/compact_boundary` | trigger + pre-compaction tokens |
| OpenCode | `session.compacted` (1.x) / `session.compaction.ended` (2.x), once the session holds context (see below) | reason unknown |
| pi | successful `compaction_end` | reason + before/estimated-after tokens |
| Zero / Grok | ACP exposes no compaction update | no marker |
| Antigravity | the stream-json surface exposes no compaction event | no marker |

Never infer a compaction from prose, an overflow error or a token-count drop;
that would put a false event into durable history.

**OpenCode compacts on its own, sometimes before the first step.** The bridge
never asks it to. OpenCode compacts automatically once its estimate of what it
will send reaches the model's window minus a reserve (20,000 tokens on 2.0.16),
and what it always sends — its prompt, the tools, the project's instructions —
can already be past that on a small model: measured through the adapter with a
36,864-token model and a ~23k-token prompt, a brand-new session was compacted
before its first step (`session.compaction.started` → `.ended`, `reason:
"auto"`, `recent: ""`). That rewrites the prompt just sent; there is no earlier
conversation. So the adapter marks a compaction only once the session holds
context: after the session's first model output (text, a tool, usage, …), or
from the start on a session resumed from an earlier turn or process. When a
later instruction update (an MCP server's tool catalog arriving mid-turn) puts
it past the threshold again with nothing left to compact, OpenCode fails the
execution (`session.compaction.failed` then `session.execution.failed`, both
`{ type: "compaction.unavailable", message: "Nothing to compact yet" }`); the
turn fails, with an error naming the model's window as too small for OpenCode.
No retry helps — the fixed part is what does not fit.

### What a turn's work looks like, for every agent

Every agent names its tools its own way; the bridge turns each call into the
same blocks, so a client draws one row for "read a file" whichever agent read
it. Shell commands become `command_execution`, edits become `diff`, the to-do
list becomes `plan`, a delegated task becomes `subagent`, and every other call
becomes a `tool` block that `toolBlock` classifies (`describeTool` in
`content-blocks.ts`) into a `kind` — `read`, `search`, `list`, `fetch`,
`web_search`, `mcp` or `other` — with a `target` to show. The agent manager
then shows every path from the project (`withProjectPaths`). Measured on a
real turn of each agent (2026-09-25):

| Agent | Tool names the bridge maps | Diffs | Plan | Subagent |
|---|---|---|---|---|
| Claude Code | `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `mcp__*` (`ToolSearch` is not shown) | from the edit's old/new strings | `TodoWrite` | `Agent` / `Task` |
| Codex | app-server items: `commandExecution` (the login-shell wrapper removed), `mcpToolCall` (`server/tool`), `dynamicToolCall`, `webSearch`, `imageView` | the item's unified diff; an added file's content | `turn/plan/updated` | `collabAgentToolCall` (`spawnAgent`, `followupTask`) |
| OpenCode | `read`, `grep`, `glob`, `list`, `webfetch`, … | from the edit's old/new strings | `todowrite` | `task` |
| pi | `read`, `grep`, `find`, `ls` | from the edit's old/new texts | — | — |
| Antigravity | `view_file`, `grep_search`, `find_by_name`, `list_dir`, `read_url_content`, `search_web` | `agy` 1.2.x reports only the file, once changed: the adapter diffs it against the text the agent last read or wrote this turn, else the committed file | — | `invoke_subagent`, `browser_subagent` |
| Zero / Grok (ACP) | the ACP `kind`, and the tool's name from Grok's `rawInput.variant` or the first word of Zero's title | ACP `diff` content: real hunks when it is the whole file on disk, else the snippet | the ACP `plan` update (the call that wrote it is not shown twice) | a `task` / `agent` call |

**A step shows while it runs.** Every adapter emits a call's row as it starts —
`status: 'running'` (a subagent's `state.status`), carrying a `blockId` — and
its result replaces that row in place (same `blockId`; `runningBlock` /
`withBlockId` in `content-blocks.ts`, `LiveBlock` in `shared/`). The start
events, measured on each: Claude's `tool_use` (the id), Codex's `item/started`
(the item id), OpenCode's `session.tool.called` on 2.x and a `running` tool
part on 1.x (the call/part id), pi's `tool_execution_start` (`toolCallId`), an
ACP `tool_call` not yet finished (`toolCallId`; Grok puts the kind in
`_meta["x.ai/tool"]`), Antigravity's `ACTIVE` step (`<tool>_<step_index>`).
An edit shows only its diff, and the to-do list only as the plan. The store
replaces by `blockId`, and a turn that ends settles any step still running, so
nothing spins after the agent stopped.

### Multiple assistant responses in one turn

Codex app-server may complete several `agentMessage` items before the turn ends;
Claude and pi may likewise close multiple native assistant envelopes. The bridge
keeps every response as ordered text and inserts a zero-text
`assistant_response_boundary` block between them. Codex preserves its native
`commentary` / `final_answer` phase and item id; Claude and pi use `unknown` when
their stream exposes no equivalent semantic phase.

Terminal payloads are reconciled additively: repeated or extending text is
deduplicated, while divergent final text becomes another response instead of
replacing content already streamed. Mobile excludes boundary metadata from
copy/previews and uses it only to collapse earlier responses after completion.

### Listing an agent's sessions

`agent/sessions` (architecture/02a §5.8.19) asks each adapter for its CLI's
sessions in a folder (`listNativeSessions`), through what that CLI offers —
measured 2026-09-27 against the installed CLIs:

| Agent | Listed from | A person's session vs. a program's |
|---|---|---|
| Claude Code | `~/.claude/projects/<cwd, non-alphanumerics → '-'>/*.jsonl`, 64 KB from each end (`cwd`, `entrypoint`, first prompt, latest `ai-title`) | `entrypoint: 'cli'` is its terminal UI, `'sdk-cli'` a headless `-p` run |
| Codex | app-server `thread/list { cwd, limit: 30, sortKey: 'updated_at' }` (`name`, else `preview`) | the `originator` of a thread the bridge started is its client name, `uxnan-bridge` |
| OpenCode | its server: `GET /api/session?directory=&limit=` (2.x), `GET /session` filtered here (1.x) | a session the bridge opens is titled with the conversation's id |
| pi | `<$PI_CODING_AGENT_DIR or ~/.pi/agent>/sessions/--<cwd, '/' → '-'>--/*.jsonl` (header `{type:'session', id, cwd}`, first user message) | not recorded: every session counts |
| Grok | `~/.grok/sessions/<cwd, URL-encoded>/<id>/updates.jsonl` (first `user_message_chunk`s); its ACP `session/list` carries no title and lists empty sessions too | every session with a prompt counts |
| Zero | ACP `session/list { cwd }` (Zero 0.9.0 announces `sessionCapabilities.list`) | a session opened over ACP keeps the title `ACP session` |
| Antigravity | — (`agy` has no listing) | continued from the terminal that holds it |

The bridge lists a program's session only when a conversation continues it,
never Uxnan's own one-shots (how their prompt opens:
`shared/src/agents/one-shot.ts`), each CLI bounded to 10 s. Where a CLI can run
a one-shot without keeping a session, Uxnan does: Claude Code
`--no-session-persistence`, Codex `exec --ephemeral`, pi `--no-session`.

`thread/start` with `agentSessionId` stores the session on the new thread, so
the first turn adopts it (below) and `turn/list` imports its history. Verified
2026-09-27 for all seven agents with a session each CLI made on its own: every
continued conversation recalled a word from the session (Antigravity included,
though its history cannot be read).

### Native-session history convergence

`turn/list` is more than a bridge-store read. When the bridge is not currently
driving a turn for that thread, it reads the matching agent-owned transcript and
merges completed native-only turns before paging the result. This makes a prompt
written in an agent's desktop app or CLI appear back in Uxnan Mobile.

What the transcript holds of a run the bridge itself drove is never native-only:
a native turn starting inside a bridge-recorded turn's run is that run and is
not imported (rows an older read imported that way are dropped on the next
read). For Claude Code, only a genuine prompt opens a turn — the `isMeta` lines
it writes on its own (an image's size note, a loaded skill, a hook's context)
and a compaction's `isCompactSummary` line do not.

| Agent | Native history source | Cross-client behavior |
|---|---|---|
| Codex | `~/.codex/sessions/.../rollout-*-<sessionId>.jsonl` | Codex Desktop/CLI completed turns converge |
| OpenCode | the per-workspace `opencode serve`: `GET /session/:id/message` (1.x) or `GET /api/session/:id/message?order=asc`, following its cursor (2.x), normalized by the protocol client; legacy JSON store fallback | OpenCode Desktop/CLI completed turns converge (2.x verified across server processes: a session one process wrote, another reads) |
| Claude Code | `~/.claude/projects/.../<sessionId>.jsonl` | completed CLI turns converge |
| pi | `~/.pi/agent/sessions/..._<sessionId>.jsonl` | completed CLI turns converge |
| Zero | `~/.local/share/zero/sessions/<sessionId>/events.jsonl` | completed ACP turns converge |
| Grok | `~/.grok/sessions/.../<sessionId>/updates.jsonl` | only turns closed by ACP `turn_completed` converge |
| Antigravity | no reliable source | unsupported: the SQLite step payloads are opaque and `agy` has no history/export command |

The session id that locates those files is the agent's own, persisted per thread
(`nativeSessionId` → `ThreadStore.setAgentSession`) and **handed back to the
adapter before a turn** (`adoptNativeSession`, offered only when the stored
session belongs to the same agent). Both halves matter: without the second one a
restarted bridge opens a new agent session under a conversation whose history
the phone still shows, so the agent has lost the context the user can see.

Both live once, in `BaseAgentAdapter` — the one thread → session map every
adapter reads and writes (`setNativeSession` when the CLI announces or the
adapter opens a session, `refuseNativeSession` when the CLI cannot resume one).
How each CLI continues an adopted session, and what it does with one it no
longer has — verified 2026-09-27 by stopping each adapter mid-conversation and
asking a fresh one for a word given before the stop:

| Agent | Continues an adopted session with | A session the CLI no longer has |
|---|---|---|
| Claude Code | `claude -p --resume <id>` | the CLI answers `No conversation found with session ID: <id>` before running anything; the same turn runs again without `--resume` |
| Codex | app-server `thread/resume` | `thread/resume` fails; the turn starts a new thread (a thread *held* by another Codex client is not refused: the turn says so and stops) |
| OpenCode | the same `ses_…` id on `opencode serve` | asked once per process (`GET /api/session/:id` → 404, `GET /session/:id` on 1.x); a fresh session is created |
| pi | `--session-id <id>` on the resident process | pi creates the session under that id |
| Grok | ACP `session/load` | `session/load` fails; `session/new` |
| Zero | ACP `session/load` | `session/load` fails; `session/new` |
| Antigravity | `--conversation <id>` | `agy` answers with a new conversation on `init`, which the thread takes |

A refused id is never adopted again for that thread (the store still holds it
until the fresh session's first turn is persisted). A fork does not inherit
the original's session — `thread/fork` drops `agentSessionId` — so two
conversations never write into one transcript.

Bridge-created turns keep their public UUID and richer ordered segments, queue
state and usage. A deterministic native-history id is stored only as a private
link, preventing the same turn from being imported twice. Native-only turns are
refreshed on later reads, but absent native rows never delete bridge history.
This is completed-turn convergence: external token deltas are not streamed.

**A turn is recognized by content identity, not message-by-message.** The prompt
and the reply are each concatenated across however many messages carry them and
compared ignoring whitespace, because these logs split one reply into several
messages — one per tool step, most carrying no prose — where the bridge
accumulated a single message. Comparing them one to one mismatched every turn
that used a tool and imported it a second time, so the phone showed the whole
exchange twice, permanently. A store already holding such a pair converges on
the next idle read: the imported copy is dropped once its bridge-created twin is
recognized.

**A row already imported is refreshed, not imported again.** A transcript turn
with the same prompt and the same start as an imported row — or the same reply
— is that row, even under an id an older reader gave it or read while the agent
was still answering: the row is refreshed in place and kept once
(`sameExchange`), and a second copy left by an older read is dropped.

**A turn that ended with no reply gets it from the transcript.** When the
bridge closed a turn before receiving any of its reply (a crash, or an older
bridge that ended a Claude Code turn on a wake-up's `result`) and the agent went
on to answer in its own log, there is nothing to compare: the same prompt and a
native start inside that turn's run window identify it, and the reply is filled
into the bridge's turn in place (`fillEmptyReply`, `thread-store.ts`). A copy an
older read imported at the end of the conversation folds back into it.

Each agent runs in the thread's `cwd`. Codex turns and model discovery both use
`codex app-server` (`thread/start` / `turn/start` and `initialize` →
`model/list`), each on its own short-lived process — see
*Codex holds one writer per thread* below. Binary resolution
(`resolve-*.ts`) prefers a directly-spawnable executable (native binary or
`node <cli.js>`) so `shell:false` always holds.

### One app-server carries every Codex conversation — route by thread

While any Codex turn is in flight, **one** `codex app-server` process carries
every Codex conversation the bridge drives, so two chats running at once share
it. Every notification (`item/agentMessage/delta`, `item/started`,
`item/completed`, `turn/started`, `turn/completed`, `turn/plan/updated`,
`thread/tokenUsage/updated`, `error`) and every approval request names the
Codex thread it belongs to — `threadId`, or `conversationId` on the legacy
`execCommandApproval` / `applyPatchApproval` — verified against the protocol
`codex app-server generate-ts` emits for codex-cli 0.157.1. `codex-adapter.ts`
matches each one to the in-flight turn on that thread (`#runFor`), and drops one
for a thread it has no turn on. It used to hand every notification to whichever
turn was first in flight, and two concurrent chats swapped their answers,
steps, plans and approval prompts.

### Codex holds one writer per thread — so the bridge lets go between turns

Convergence has a second half: a conversation the **phone** started must open in
Codex Desktop, `codex resume` or an IDE. That is not a read; it needs the
thread's writer, and **Codex grants exactly one**, held for as long as the thread
is loaded in a process. A bridge that kept one long-lived `codex app-server`
therefore locked every conversation the phone had ever touched — for days — and
those clients answered `thread <id> already has an active writer`, which the
Codex app shows as *this conversation is not available*.

So `codex-adapter.ts` spawns the app-server for a turn and **ends it as soon as
no turn is in flight**, then re-attaches on the next turn with `thread/resume`.
Measured against codex-cli 0.147.0 by running two app-servers against one thread:

| Attempt | Result |
|---|---|
| Second client resumes while the bridge holds the thread | `already has an active writer` |
| Holder calls `thread/unsubscribe`, second client retries | **still refused** — the reply is `{status:'unsubscribed'}` but the thread stays in `thread/loaded/list` and the writer stays held |
| Holder's **process exits**, second client retries | resumes immediately |

Ending the process is the only handover. It costs ~250ms to respawn plus
~200–750ms to `thread/resume` (upper end measured on a 7 166-line rollout),
paid once per turn against a model call that runs for seconds to minutes.

**This is a Codex-specific constraint, not a general one — do not "fix" the
other adapters for it.** Measured on this machine (August 2026) by starting a
conversation through each adapter and then continuing it from a second client:

| Agent | Second client continuing the phone's conversation | Verdict |
|---|---|---|
| **Codex** | `thread/resume` from another app-server | refused while the bridge held it → **needed the release above** |
| **Claude Code** | `claude -p --resume <sessionId>` from the same cwd | works, and appends to the SAME `<sessionId>.jsonl`, so the turn converges back to the phone. Nothing to hold: the adapter spawns one process per turn |
| **OpenCode** | its own `opencode serve` (the desktop app's model) | works with the bridge's server still running: it lists the session, reads it, and posts a new turn into it. The store is shared, not owned by a process (measured on 1.x; on 2.x a session written by one server process is read by another) |

pi, Zero, Grok and Antigravity ship no desktop app; their continuity is the
per-CLI session flag in the *Wired agents* table.

Two consequences worth knowing:

- **The other direction is a real conflict.** If the Codex app has the
  conversation open when the phone sends, `thread/resume` is refused and the turn
  reports *open in another Codex client — close it there*. There is nothing to
  fall back to: one writer is one writer.
- **A deleted rollout is not an error.** If the session was removed from another
  client, the resume fails with `no rollout found` and the conversation continues
  in a fresh Codex thread instead of dead-ending.

### When a turn ends (and when it only looks like it has)

An adapter must decide when the agent is done. There are two kinds:

| Ends on | Adapters | Can the CLI emit after that? |
|---|---|---|
| A **protocol event** | Claude (`result`), Codex (`turn/completed`), OpenCode (`session.idle` on 1.x, `session.execution.succeeded` on 2.x), Pi (`agent_settled` — **not** `agent_end`, which ends one *run*: pi retries a run after a retryable provider error, `willRetry: true`, and a prompt sent in between is refused as "already processing"), Grok / Zero (the ACP `session/prompt` reply), Antigravity (`result`) | **Yes** — the process is still alive when the event arrives |

That distinction matters because **Claude Code really does come back**. When the
model starts a background task (`Bash` with `run_in_background`) and ends its
turn, the CLI emits its `result` and keeps running; when the work finishes the
CLI **wakes the model** and a second, complete turn follows on the same process.
How long it waits depends on its input, which the bridge controls: **while the
input is open it waits for as long as the work takes** (a `sleep 240` left
running after the turn was waited for in full), and **once the input closes**
it gives the work about **4–6 seconds** and then **stops** it
(`status:"stopped"`), exiting with that work unfinished. The bridge keeps the
input open while any task is live, so the work gets its time — and **between
wake-ups**: a wake-up may start more work, and the CLI waits for that only
while its input is still open.

#### A long wait is not the same thing (and is not limited)

The grace period applies to exactly one shape: work left running **after** the
model ends its turn. It says nothing about **long work the agent waits for**,
which is the common case — "open the PR and wait for CI", a build, a test suite.
There the tool call blocks *inside* the turn: no `result` has been emitted, so
there is nothing to expire and nothing to kill.

Measured on the real CLI: a 75-second foreground wait ran as **one turn lasting
100 seconds**, with `tool_progress` events at +35 s and +65 s, the work
completing normally, and `result` arriving only afterwards. There is also **no
turn-level timeout anywhere in the bridge** — the only timers in `AgentManager`
bound how long it waits for *the user* to answer an approval or a question, not
how long a turn may run. A turn can take minutes or hours.

So the two cases split cleanly:

| The agent… | Turn state | Bounded? |
|---|---|---|
| **waits** for long work (CI, build, tests) | still running; deltas and tool progress keep flowing | **No limit** |
| **leaves** work running and ends its turn | held open by the adapter (input open) until the work ends and a follow-up turn completes with nothing left running — however many wake-ups that takes | **No limit** while the input is open |

So `claude-adapter.ts` tracks live background tasks (`system` lines with
`subtype:"task_started"` / `"task_notification"` — the reason `system` is no
longer parsed as one event kind) and **holds the completion** while any is live,
emitting exactly one `turn_completed` carrying every reply. Work the CLI killed
is reported to the user as a warning block rather than passing as a clean turn.

**The input stays open from one wake-up to the next.** When the last live task
ends, the adapter does not close the input: the CLI is about to wake the model,
and that wake-up's own `result` decides — the turn completes if nothing is left
running, and stays held if the wake-up started more background work ("CI is
green; now I wait for the release"). Closing the input there, as the adapter
once did to let the CLI exit, cut every wake-up after the first: the work the
wake-up started was stopped ~5 s later and the model never came back. Measured
on the real CLI with two background waits in a row: with the input open, each
wake-up's `init` follows its `task_notification` in ~0.2 s and the third reply
arrives; with it closed after the first, the second wait is `stopped`. If no
wake-up shows within `WAKE_GRACE_MS` (30 s) of the last task ending, the input
closes so a CLI that does not wake cannot hang the turn.

How a task ended decides whether that is so. The CLI reports `completed` (exit
0), `failed` (exit ≠ 0 — its work finished, and the model reads the result like
any other) or `stopped`, which means two different things: the model or the
user ended it while the run went on (a server the model starts and then stops
itself), or the CLI ended it because its input had closed. Only the last is
lost work, so only a `stopped` after the adapter closed the input — or a task
still live when the process exits — is reported. Counting every non-`completed`
end, as the adapter once did, put "interrupted when the turn ended" on turns
whose tests had simply failed.

Two guards make this safe for **every** adapter, present and future, since the
first table row is where the hazard lives:

- `ThreadStore` ignores appends and a second `completeTurn` once a turn is in a
  terminal status — a late completion used to overwrite the reply the user had
  already read.
- `AgentManager` ignores a duplicate terminal event, so the message queue is
  never drained twice (which would start a queued follow-up against a CLI that
  is still running).

Two agents come back: **Claude Code** and **OpenCode 2**. Every agent was
probed the same way through its own adapter — asked to start a command in the
background, end its turn, and report when the command finished — and timed.
Re-measured 2026-10-02 (claude 2.1.287, opencode 2.0.19, codex-cli 0.157.1,
grok 1.0.46, pi 0.85.1, zero 0.9.0, agy 1.2.14):

| Agent | Wakes the model after its turn? | What happens to the deferred work |
|---|---|---|
| **Claude Code** | **Yes** | Waited for while its input is open (the bridge keeps it open while tasks run and between wake-ups) → the CLI wakes the model and a second turn reports it — and a third, if the second started more work. Once the input closes, ~4–6 s and then **stopped**, work lost |
| **OpenCode 2** | **Yes** — its shell tool takes `background: true`, tells the model it *will be notified*, and when the shell exits the server queues a `synthetic` note and runs the model again on the same session | Survives; the wake-up reports it. The adapter holds the turn through it (below) |
| OpenCode 1 | No — no background shell; a `&` job is left to the OS | Survives, and is never reported |
| Codex | No (nothing after `turn/completed`) | Dies: a `nohup` job did not outlive the app-server the adapter ends after the turn |
| Grok | No | Survives while the session's process lives, and is never reported |
| Pi | No — no background tool | Its shell waits for a `&` job's output to close, so the "background" command ran inside the turn (25 s) and was reported in it |
| Zero | No | Survived the turn (finished after it), and is never reported |
| Antigravity | No | Like pi: the command ran inside the turn and was reported in it |

**OpenCode 2 is held the same way as Claude.** Its stream says what is running:
the shell tool reports its shell as `session.tool.progress` (`metadata.shellID`),
and `shell.exited` / `shell.deleted` end it. When the session's execution
succeeds with a background shell of the run still live, the adapter does not
complete the turn: the wake-up — a new `session.execution.started` the moment
the shell exits, then the model's report — is set apart with a response
boundary, and its own `execution.succeeded` decides again (held if it left more
running). If no wake-up shows within 30 s of the last shell ending, the turn
completes with what it has. A command that ends inside the step (its shell exits
before the execution does) holds nothing.

Two consequences worth keeping straight, because they need different answers:

- **Claude Code and OpenCode 2** genuinely defer and return, so their turn must
  stay open — that is what both adapters do.
- **Everyone else** ends for real. An agent there can still *say* it will report
  back, and nobody ever will: with Codex the work is already dead, and with
  Grok, Zero and OpenCode 1 it is worse — the work keeps running, completes and
  is never reported. There is no deferred state to model in those cases, only a
  promise not to take at face value.

None of this makes the guards Claude-specific: the hazard is structural for
every adapter in the first table above, today or after any upstream change.

Per-thread selection: `thread/start { agentId, model, cwd }`; `agent/list` reports
availability/capabilities; `agent/models` lists models (`AgentModel[]` with
`id`/`displayName`/`description?`/`version?`/`isDefault?`/`options?`/`contextWindow?`);
`thread/setModel` repoints a thread's model mid-conversation. The id the phone
sends back is passed verbatim to the CLI's `--model`/`-m` flag. Per-model
**run-option knobs** (reasoning effort) are advertised in `AgentModel.options` and
both apps render them generically. Each knob carries the level the model runs at
when nobody picks one (`default`), and **the bridge sends that default itself**
(`AgentManager` fills every unpicked knob before the turn starts), so the level a
picker shows as the default is the level the turn runs at, whatever the CLI's own
configuration would choose:

| Agent | Levels | Default |
|---|---|---|
| **Codex** | the app-server `model/list` (`supportedReasoningEfforts`) | the model's `defaultReasoningEffort` |
| **Claude Code** | `--effort` low…max, on every model but **Haiku 4.5** (Claude's `initialize` lists it without `supportsEffort`; Haiku 5.5 reports `supportsEffort: true`, verified on 2.1.293) | `high` — Claude decides its own at run time (remote configuration, then the model's capabilities) and no headless surface reports it, so the bridge names one and sends it |
| **pi** | `--thinking` off…max, on models whose `thinking` column is `yes` | what pi itself would use: `settings.json` `modelThinkingLevels["provider/model"]`, then `defaultThinkingLevel`, then `medium` |
| **Grok** | ACP `_meta.reasoningEfforts` | the entry flagged `default` |
| **OpenCode** 2 | the model's `variants` (sent as `variant`) | none named: an untouched turn runs at the provider's own |
| **Antigravity** | none (the tier is part of the model id) | — |
| **Zero** | none | — |

**Interactive approvals** are wired for Echo, Claude Code (`PreToolUse` hook),
Codex (`app-server` elicitations), OpenCode (`opencode serve` `permission.asked`, both versions),
Zero and Grok (ACP `session/request_permission`);
**pi** and **Antigravity** have no headless pre-tool channel (both run
autonomously — Antigravity's headless surface auto-denies any tool that needs a prompt,
so a `requestApproval` thread runs read-only `--mode plan` instead — see
[`../FOR-DEV.md`](../FOR-DEV.md)).

**Interactive questions** — OpenCode's `question` tool (the agent asks a
multiple-choice question) surfaces as a `question` content block the phone answers
via `turn/send { questionResponse }`; the bridge (`AgentManager.requestQuestion`)
answers it so the agent continues with the choice — on 1.x `/question/{id}/reply`
(or `/reject` to skip), on 2.x the question arrives as a **form** (`form.created`,
one field per question) answered per field key at
`/api/session/:id/form/:id/reply` (or dismissed with `DELETE`). OpenCode 1's
`permission.v2.asked` shape is routed through the same approval path as
`permission.asked`.

### OpenCode 1 and OpenCode 2

OpenCode 2 kept the `opencode serve` command and replaced everything on the
wire, so the adapter is split along that seam — one layer, not a patch on top of
the 1.x code:

| Module | Holds |
|---|---|
| `opencode-protocol.ts` | The contract the adapter speaks: sessions, turns, neutral events (`text` / `reasoning` / `tool` / `usage` / `plan` / `permission` / `question` / `idle` / `interrupted` / `error`), normalized history, models |
| `opencode-transport.ts` | What both versions share: the `serve` process on a port the bridge picked free, the optional password, SSE, JSON requests |
| `opencode-v1.ts` / `opencode-v2.ts` | Each version's routes and the translation of its events and history into the contract |
| `opencode-version.ts` | `opencode --version` (`1.18.32` / `opencode v2.0.16`) → which client serves a directory, read each time a server is started |
| `opencode-adapter.ts` | Only what a turn is — which session runs which bridge turn, the reply, the plan card, usage, the approval and question round-trips |

What differs, as measured on 1.17.20 – 1.18.32 and 2.0.16:

| | OpenCode 1.x | OpenCode 2.x |
|---|---|---|
| Server auth | none | required: the bridge sets `OPENCODE_SERVER_PASSWORD` per process and sends Basic `opencode:<password>` |
| Routes | `/event`, `/session` (`PATCH /session/:id` replaces its `permission` rules), `/session/:id/prompt_async`, `/abort`, `/permission/:id/reply`, `/question/:id/reply` | `/api/event`, `/api/session` (with `location`, `model`, `permissions`; `PATCH /api/session/:id` replaces the `permissions`), `/api/session/:id/prompt`, `/interrupt`, `/permission/:id/reply`, `/form/:id/reply`; the OpenAPI document is at `/openapi.json` |
| Turn stream | message parts (`message.part.delta` / `.updated`, a role per message) | `session.text.*`, `session.reasoning.*`, `session.tool.*` (assistant only) |
| Turn end | `session.idle` | `session.execution.succeeded` / `interrupted` / `failed` |
| Model | per prompt | per session (`POST /api/session/:id/model` when it changes) |
| Tools | `bash`, file tools take `filePath` | `shell`, file tools take `path` — both map to the same blocks |
| Models + windows | `opencode models` / `opencode models --verbose` | `GET /api/model` (loads a moment after the server boots) |
| History | `{ info, parts }[]` | typed messages, paginated with a cursor |

**Port.** No OpenCode 1 release checked honours `--port 0` — each binds its
default 4096 — so the bridge picks a free loopback port and passes it: a second
project's server, or anything else on 4096, no longer kills a turn with
"exited before listening".

**Validated live** (the adapter itself, sandboxed config, a free model): on
OpenCode 2.0.16 and 1.18.32 — models with context windows, a turn with usage, a
shell permission approved from the approval path, a question answered, a
mid-turn message (steer), a cancel, history, a title, and two projects' servers
at once.

## Agent commands (`agent/commands` + `turn/send` `command`)

The bridge discovers each agent's special ("slash") commands (`agent/commands` →
`AgentCommand[]`) and runs them via the normal streaming turn (`turn/send`
`command: { name, args? }`). There are **two classes**, unified through one path —
`AgentManager.sendTurn` resolves a `command` to the prompt the agent runs (the
`/name args` form is what history persists):

| Agent | How commands are discovered | How they run |
|---|---|---|
| **Claude Code** | **asked of the CLI itself**: a stream-json `initialize` control request (no turn, no tokens; ~0.5 s, reused per folder for a minute) lists every command it has in the thread's folder — built-ins, custom commands (project and user `.claude/commands`), skills and plugins — with descriptions and argument hints. Hidden: what its own `system/init` `terminal_slash_commands` says only its TUI runs (`doctor`, `color`, `focus`, `reload-plugins`), and what the bridge owns or must not touch (`clear`, `rename`, `model`, `effort`, `fast`, `config`, `status` — which fails headless —, account and internal ones) | native — sent as `/name args`, resolved against the thread's `--resume` session |
| **Codex** | a native `compact` + the **skills the app-server lists** in the thread's folder (`skills/list { cwds: [cwd] }`: repository, user and system skills, enabled only, short description; reused per folder for a minute) + the user's custom prompts (`~/.codex/prompts/*.md`; a prompt keeps its name over a skill) | natively: a skill as a `{ type: 'skill', name, path }` input item beside the arguments' text; `compact` as `thread/compact/start` (its own turn, rendered as a compaction block); a custom prompt is expanded by the bridge (`expandCommand`) and sent as text |
| **OpenCode** | **asked of its server** in the thread's folder — v1 `GET /command` (commands and skills, told apart by `source`), v2 `GET /api/command` + `GET /api/skill`, waiting for a freshly booted catalog to settle (it loads in stages over ~1 s); includes its own `init`/`review`, the config's `command` key, `.opencode/command(s)` (project and user) and skills; reused per folder for a minute | **native** — v2 `POST /api/session/:id/command {name, text}`, a skill as a prompt with the skill attached; v1 `POST /session/:id/command {command, arguments, model}`, not awaited (it answers only when the turn ends). The server expands the template; the turn streams like a prompt |
| **pi** | **asked of pi itself**: `get_commands` on a short-lived `pi --mode rpc --no-session` in the thread's folder, started with the turn's posture flags, so a project's own prompts and skills are listed exactly when pi trusts the project for the turn (`--approve`, or its saved `trust.json` decision); prompt templates as `custom`, skills as `skill` (`skill:<name>`); extension commands left out, because their dialogs would block with nobody to answer; reused per folder for a minute | native — sent as `/name args` on the `prompt` command, which pi expands |
| **Antigravity** | its **skills**, from `agy -p /skills --add-dir <cwd>` in the thread's folder (a command the CLI answers itself; the workspace's skills come from `--add-dir`; ~4 s cold); built-ins are never listed because they fail on stream-json; reused per folder for a minute | native — sent as `/name args` in the user message, which `agy` expands |
| **Zero** | its **own skills**, from `zero skills list --json` in the thread's folder — only those in Zero's skills folder (`~/.local/share/zero/skills`): the list also shows the shared `~/.agents/skills`, but the skill tool of a Zero run over ACP never looks there (asked for one, it answers "no skills are available"), so those are left out; its ACP server sends no `available_commands_update` and its slash commands are its TUI's; reused per folder for a minute | expanded by the bridge (`expandCommand`) into a prompt asking Zero to load the skill with its skill tool, then the arguments — verified: the run calls `skill` and follows it |
| **Grok** (ACP) | the ACP `available_commands_update` a session announces in the thread's folder: its built-ins (`compact`, `review`, `goal`, `deep-research`, …, with their argument hints) and the skills it finds (labelled `skill` when a `SKILL.md` of that name is in `~/.agents/skills`, `~/.grok/skills` or the folder's own). A folder no thread has opened gets a short session of its own — `session/new`, no prompt, no tokens, the list ~2.5 s later — closed afterwards; reused per folder for a minute, refreshed by a thread's session. Left out: `always-approve` (the thread's access mode is the bridge's), `statusline` and `memory` (screens of its terminal UI) | native — sent as `/name args` through `session/prompt` (verified: `/session-info` answers with the session's context, no model call) |

The rule behind every row: **ask the agent**, on the surface the bridge drives,
what commands it has in the thread's folder, and let it run them natively; the
bridge expands a template itself only where the agent offers no way to (Codex's
custom prompts, through `src/adapters/command-scan.ts` — its only user now).
Sources: `builtin` (the CLI's own), `custom` (the user's commands and prompt
templates), `skill` (an agent skill invoked by name), `acp` (advertised over
ACP). Every row was verified by running the CLI through its adapter (Claude
2.1.282, Codex 0.156.1, OpenCode 1.18.32 and 2.0.16, pi 0.85.1, agy 1.2.11,
Zero 0.9.x, Grok 2026-09-25).

## Image attachments (`turn/send { attachments }`)

The phone sends images inline (base64). No agent CLI accepts inline base64 over
the headless path, but every wired agent can **open a local file** with its own
file/vision tools — so the bridge materializes each attachment and references
its path in the prompt (`src/agents/attachments.ts`). No per-adapter image code.

One adapter opts out of that path: **Zero** takes attachments natively
(`IAgentAdapter.handlesAttachments()`), so the bridge writes nothing and adds no
path note for it — see the table below.

Two rules make the file-path delivery work, both verified against the real CLIs:

1. **The file lands inside the directory the CLI actually runs in**
   (`<cwd>/.uxnan-attachments/<turnId>/`) and is referenced **relative to that
   cwd**. Agents are confined to their workspace: given the same image under the
   OS temp dir, Claude answers *"the read was blocked by a permission prompt"*.
   A turn without its own `cwd` therefore falls back to the adapter's
   (`IAgentAdapter.defaultCwd()`), never to the temp dir.
2. **The directory is removed when the turn ends**; no temp path leaks into the
   conversation. The images themselves are kept **with the message**: the
   thread store writes them to `~/.uxnan/attachments/<threadId>/`, names them in
   `Message.attachments`, and serves each with `turn/attachment`, so every
   client shows them in the user's bubble.

`capabilities.images` decides whether the phone offers the "+" attach action:

| Agent | `images` | What actually happens |
|---|:--:|---|
| **Claude Code** | ✅ | reads the file with `Read` (native vision) |
| **Codex** | ✅ | reads it natively |
| **Antigravity** | ✅ | `agy` opens it with its file tools (multimodal Gemini models) |
| **Grok** | ✅ | opens it with its file tools — its ACP `promptCapabilities.image` is false, but that only rules out an *inline* image block, not a workspace file |
| **Zero** | ✅ | **natively**: the attachment rides as an inline ACP image block (`{ type: "image", mimeType, data }`), because Zero's ACP advertises `promptCapabilities.image` while its `read_file` is line-oriented text — a path reference would have it read a PNG as garbage. No file is written for it |
| **pi**, **OpenCode** | ✅ | the CLI opens it; whether the *model* sees pixels depends on the selected model — a non-multimodal one still answers by inspecting the file with tools |

A non-multimodal model is not a bug: the attachment is delivered either way, the
agent just reasons about the bytes instead of the picture. Pick a multimodal
model when you need real vision.

## Claude Code models: what `initialize` reports

Claude Code lists its models itself: the stream-json `initialize` control
request — the same one `agent/commands` asks, answered in ~0.5 s without
running a turn or spending a token — carries a `models` array (verified on
claude 2.1.293). Each entry has the `value` `--model` takes, the
`resolvedModel` it runs today, a `displayName`, a `description`,
`supportsEffort` and `supportedEffortLevels`. It is **account-aware**: it lists
only what this account can use. The bridge keeps no table of its own;
`claudeModels()` (`src/adapters/claude-adapter.ts`) turns that list into
`agent/models` the way the CLI offers it — each model once, in its order:

1. **Current models, by alias** (`opus`, `fable`, `sonnet`, `haiku` — any
   `value` that is not its own `resolvedModel`), under the CLI's label
   (`Opus 5.5`), flagged `isLatestAlias`, with the concrete model as `version`.
   The CLI lists its newest models only this way: picking one follows the tier
   to its next release. After a turn, the concrete id it ran on is also
   reported through `model_resolved`.
2. **Older models**: the concrete ids the CLI lists that no alias runs today
   (dated snapshots included — `claude-haiku-4-5-20251001` is the id the CLI
   takes for Haiku 4.5), flagged `isLegacy`. Every picker folds them under
   *Older models*. No other wired CLI marks its models this way (checked
   2026-10-08: Codex's `hidden` hides internal models, OpenCode only dates
   them), so only Claude's list folds.
3. **Pinned models** from `agents.claude-code.models` the CLI did not list.

The CLI's own `default` entry is not a row: picking nothing runs it, and every
client already offers that. It marks `isDefault` instead, on the first entry
that runs the same concrete model — unless `agents.claude-code.model` is set,
which wins.

**Effort** is offered per model with exactly the levels it reports: Opus 4.6
and Sonnet 4.6 stop at `high`/`max` without `xhigh`, and Haiku 4.5 reports
neither field, so it has no knob. The default the knob shows (and the bridge
sends when nobody picks one) is `high`, offered only where the model lists it.

**Context window** comes from the turn, not the list: `initialize` carries
none, but the `result` closing every turn has `modelUsage[<model>].contextWindow`
(`1000000` for Haiku 5.5, `200000` for Haiku 4.5). The turn's own entry is
picked by the id `system/init` resolved; that is what the phone's context
percentage divides by.

**Caching.** The list is the account's, not a folder's: it is asked once
(`agent/commands` answers bring it along) and reused for a minute; after that
the last list is still answered while a fresh one is asked behind it, so only
the very first listing waits for the CLI. A CLI that will not answer leaves
only the pinned models.

```jsonc
// ~/.uxnan/daemon-config.json
{
  "agents": {
    "claude-code": {
      "model": "opus",                // default when a thread picks none
      "models": [                     // ids the CLI does not list (yet), if any
        { "id": "claude-opus-4-5", "displayName": "Opus 4.5" },
        "claude-sonnet-4-5"           // bare id — displayName falls back to the id
      ]
    }
  }
}
```

`models` is only for an id the account does not list but `--model` accepts;
an id the CLI does list keeps the CLI's entry. Nothing else is configured:
a new Claude model appears in every picker, phone and desktop, the moment the
installed CLI knows it.

**The desktop asks the same request.** Its AI commit-message / PR-body picker
(`uxnandesktop/src-tauri/src/aicommit.rs` → `claude_models`, parsed by
`parse_claude_initialize_models` in `crates/workspace-engine/src/agentcli.rs`)
shows concrete ids rather than aliases, since a commit message names the model
that wrote it: what each alias runs today, under its label, then the older ids,
folded the same way.

**The one table left is the price** (`src/usage/usage-prices.ts` →
`CLAUDE_PRICES`, pinned to Anthropic's published rates by
`test/usage/transcript-usage.test.ts`). Spend is read from the transcripts
(`src/usage/transcript-usage.ts`, architecture `02a` §5.8.10), which record
tokens per response but cost only per CLI process (`cost-state`), so a new generation still needs an entry there, keyed
on the model id rather than its family. A model without one is shown as
unpriced tokens, never a guess.

## Plan limits (`agent/usageStats`)

The bridge is the one reader of each provider's plan limits
(`src/usage/usage-reader.ts`, architecture `02a` §5.8.10); the phone and Uxnan
Desktop only render what it returns (`ProviderUsage` in
`shared/src/models/usage.ts`).

| Provider | Asked | Fills |
|---|---|---|
| Claude Code | `claude` itself (`initialize` + `get_usage`, `src/usage/cli-usage.ts`) | windows, plan, email/organization, `credit` from `extra_usage` once it is enabled |
| Codex | `codex app-server` itself (`account/read` + `account/rateLimits/read`) | windows, plan, email, `credit` once the account has credits, `resetCredits` |
| GitHub Copilot | `gh auth token` → GitHub's `copilot_internal/user` | quotas, plan, login |
| Grok | the `key` in `~/.grok/auth.json` → `cli-chat-proxy.grok.com/v1`: `billing?format=credits` and `user?include=subscription` (5 s) | the `creditUsagePercent` window when there is one; `credit` in USD from the `{val}` amounts; plan from `subscriptionTier` |

**Grok's money.** On-demand spend of its cap (`onDemandUsed` / `onDemandCap`,
`period: "On-demand"`, `limit`, `available = cap − used`, resetting at
`billingPeriodEnd`) once a cap is set or anything was spent; otherwise a
`prepaidBalance` above zero (`period: "Prepaid"`, `available`); otherwise no
`credit`. A free account answers every amount as `{val: 0}` and has no
`creditUsagePercent`, so it reads `ok` with no window, no credit and the
"no quota window" message. The contract carries one balance, so when an account
has both, on-demand (what it is spending now) is the one shown.

**Grok's plan.** The billing answer carries no tier: the Grok CLI takes it from
the signed-in user, and so does the bridge. A tier is labelled as xAI writes it
(`supergrok_heavy` → `SuperGrok Heavy`); `null` on a personal account (no
`teamId` / `organizationId`) reads `Free`, as the CLI calls it; a team or
organization member without a tier of their own claims no plan. The user
request failing only drops the plan — never the rest.

Verified live (grok 1.0.41, a free account): `ok`, plan `Free`, no window, no
credit. The paid shapes (`{val}` amounts above zero, a non-null tier) are taken
from the CLI's own billing and subscription code, not yet from a paid account.

## Adding a new agent

Follow the recipe in [`../FOR-DEV.md`](../FOR-DEV.md) (Agent adapters): capture the
real CLI's machine-readable stream once, then copy the closest template — a
**resident process per thread** (`pi-adapter.ts` / `antigravity-adapter.ts`:
the CLI reads one turn at a time from an open stdin, so one process answers
turn after turn), a **one-shot per-turn CLI** (`claude-adapter.ts`, which
spawns the CLI once per turn) or a **server the adapter talks to** (`codex-adapter.ts`/
`zero-adapter.ts`/`grok-adapter.ts` over stdio JSON-RPC,
`opencode-adapter.ts` over `opencode serve` HTTP/SSE, when the CLI exposes a
pre-tool approval channel). If that server takes an exclusive claim on the
conversation (Codex's one-writer-per-thread), hold it **only while a turn is in
flight** — see *Codex holds one writer per thread* above. Adjust the args/request builder + event parser, register it in
`startBridge`, then wire it into `agent/models` (discovery), the `*-tools.ts` block
mapper (structured content), `SessionHistoryReader` (native-session `turn/list`
convergence),
and approvals if the CLI exposes a pre-tool channel. Test it like the existing
adapters and validate per [`testing.md`](./testing.md).
