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
id, so nothing enters the conversation's history. One rule picks its model for
every agent: **the agent's cheapest model when its CLI can name one, else the
conversation's own model (for a native session, the model it last ran on),
else the agent's default** — because a six-word title
is not work for the model the user is paying attention to, and for an agent with
no cheap tier to name, spending the model the conversation already runs on beats
guessing one the account may not have (`GenerateTitleOptions.model` carries the
conversation's; `AgentManager` passes the thread's). Measured 2026-10-31, one
real run per adapter in a scratch folder (Claude Code 2.1.312, codex-cli
0.163.0, agy 1.4.12, OpenCode 2.2.0, pi 1.4.0, Grok 1.0.70, Zero 0.10.0):

| Agent | One-shot used | Title model | Measured |
|---|---|---|---|
| **Claude Code** | `-p --no-session-persistence`, no `--resume` | `haiku` (cheapest known) | title in 3.1 s, no session left |
| **Codex** | `codex exec --ephemeral -s read-only --skip-git-repo-check -o <file>` | `gpt-5.6-luna` at `-c model_reasoning_effort=low` (cheapest known) | title in 3.7 s, no session left |
| **Antigravity** | `agy -p --mode plan` (no `--conversation`) | the lowest tier of a `flash` family in `agy models` (else any `-low` id) — read, never pinned (`gemini-3.8-flash-low` on this account); with no cheap tier listed, the conversation's model, else the default | title in 8.2 s |
| **OpenCode** | `opencode run`; on 2.x `opencode run --standalone --title <uuid>` (the run's session is the bridge's, so it is never listed as a person's), with `$PWD` set to the folder (OpenCode takes its project from `$PWD`, not the process's working directory: without it the run's session landed in the bridge's own folder) | no cheap tier it announces → the conversation's `provider/model` (`--model`), else the configured default, else OpenCode's own | with `opencode/big-pickle`: title in 5.7 s. On OpenCode's own default (an OpenRouter model asking 131k max tokens) the run failed for lack of credit — the case the rule exists for |
| **pi** | `pi -p --no-session` | none announced → the conversation's `provider/id` (`--model`), else the default, else pi's own | with `openrouter/cohere/north-mini-code:free`: title in 2.5 s, no session left. pi's own default failed (402, no credit) |
| **Grok** | `grok -p` | none announced (one model on this account) → the conversation's id (`-m`), else the default, else Grok's own | the flag is accepted (`-m grok-4.7`); **no title was produced: the account's free Grok Build usage limit was reached** on 2026-10-31. A title run leaves a Grok session whose first prompt is the naming prompt, which the bridge's session list leaves out by its opening |
| **Zero** | `zero exec --plan` (read-only: a name never needs a write or a shell) | none for the provider the person set up → the conversation's id (`-m`), else the default, else Zero's own | default: title in 4.1–9.9 s, no session left. `-m gpt-4.1-mini` is accepted (it reached the provider, which refused for lack of credit). Zero's `--mode fast` was **not** used: it picks `claude-haiku-4.5` from Zero's own registry, which fails when the configured provider is another one (`zero model claude-haiku-4.5 belongs to anthropic, not openai-compatible`) |

**Cheap means cheapest on the bill, measured — not the smallest-sounding name.**
Codex names on `gpt-5.6-luna` rather than the `mini` tier because Luna wins on
both halves ($0.20/$1.20 per 1M tokens against mini's $0.75/$4.50) *and* spent
fewer tokens naming the same conversation (13.4k vs 18.3k) — about 5× cheaper
per title. Its effort is pinned to `low` because Luna's own default is `medium`,
and reasoning tokens are exactly what can make a cheap model cost more than an
expensive one on a task this small; `-c` keys are validated, so a typo fails the
run instead of quietly naming on the default tier.

**Each pinned id — and Antigravity's rule — has a twin in the desktop app**
(`uxnandesktop/src-tauri/src/convtitle.rs` → `title_model` / `agy_title_model` /
`title_effort_args`), which names terminal tabs the same way (a terminal has no
conversation model to offer, so an agent with no cheap tier names on its default
there — the rule's last step). Move both halves in the same change set — the bridge once passed
**no** model for Antigravity while both the spec and the desktop said it named
on the cheap flash tier, so every phone-side title quietly ran on the account's
frontier model.

Codex needs all three flags: `--ephemeral` writes no session file, `read-only`
denies the sandbox any write, and `-o` yields the final message **alone** — its
stdout carries a banner, hook lines and a token count, so parsing that would be
guesswork.

**Model ids are checked against each account's real list, never assumed.** A
wrong id is not cosmetic: the CLI rejects the run and the thread silently keeps
its provisional name. That is how the desktop's `agy` mapping was caught —
`agy` listed `gemini-3.6-flash-*`, not `gemini-2.0-flash` — and why
Antigravity's is no longer pinned at all: `agy` 1.3.x retired
`gemini-3.6-flash-low` and every title failed until the model was read from the
listing.

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

### Naming the agents' own sessions

`agent/sessions` lists what each CLI keeps, and some CLIs keep no title for a
session (OpenCode never names one it did not title; Codex has none for a thread
with no name or preview). The bridge names those with **the same errand** — one
layer, `IAgentAdapter.generateTitle`, under the rule above — on **the model the
session itself last ran on**, read from the agent's own record where it keeps
one (`NativeSessionInfo.model`: OpenCode 2's session list `model.providerID/id`,
pi's last `model_change`, Grok's `summary.json` `current_model_id`, Zero's
`metadata.json` `modelId`; verified on the real stores 2026-10-31), so a machine
whose default model has no credit still names what it ran. An agent with a cheap
tier (Claude Code, Codex, Antigravity) names on that tier as always; OpenCode 1's
listing carries no model, and a session whose record names none falls to the
agent's default — from the session's **first exchange read from the agent's own history**
(`SessionHistoryReader.readTurns`: OpenCode through its server, Claude Code,
Codex, pi, Zero and Grok from their transcripts). Antigravity's history cannot
be read, so a session of its own stays untitled.

It never makes a listing wait: `agent/sessions` answers at once with the name it
already gave or `titlePending`, the work is queued, and the client asks again
(every 5 s, at most 18 times). `SessionTitles` (`src/agents/session-titles.ts`)
bounds it: **two runs at a time, a queue of 12** (a listing offers the rest
later), **30 runs an hour**, a failed session **twice** and then not again until
the bridge restarts, a session with nothing to read left alone for 10 minutes.
Names are kept in `session-titles.json` (newest 500). Picking a session up
(`thread/start { agentSessionId }`) with no title of the client's own takes the
bridge's.

Reading the first message also finds what Uxnan's own naming runs leave behind
in a CLI that cannot run one without a session — OpenCode keeps them untitled
and *interactive*, which is what the "Untitled session" rows were. A session
whose first message is one of Uxnan's own one-shots (`isOneShotPrompt`) is not
listed. Measured on OpenCode 2.2.0 with a scratch bridge and **no default model
configured**: untitled sessions listed `titlePending` and were named in 10–60 s
on the model each had run on (`opencode/beam-free`, `opencode/big-pickle`), two
runs at a time. pi (`openrouter/cohere/north-mini-code:free` read from the
session's own `model_change`) and OpenCode named on that model in 3–5 s; Grok's
`-m grok-4.7` was refused by the account's usage limit. Zero's `exec` keeps no
session, and an ACP-opened one is the bridge's own, so its `modelId` was checked
on a real `metadata.json` and `zero exec --plan -m openrouter/free` was run.

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
| **pi** | `pi --mode rpc`, one resident process per thread | JSON-RPC over stdio (`prompt` / `steer` / `get_state` commands in, JSON events out; a `prompt` answered `disposition: "handled"` — a command pi resolved itself — starts no run, so the turn ends there) | yes — `message_end` `usage.totalTokens`; the model's `contextWindow` comes from the `get_state` response |
| **Grok** | `grok agent stdio` | ACP (JSON-RPC over stdio) **plus `_x.ai/*` extension methods** | yes — the context is the **`session/prompt` result's `_meta.totalTokens`** (the turn's last model call). The `turn_completed` update on `_x.ai/session_notification` carries a `usage` block **summed over every model call** of the turn (measured on 1.0.50: 43,814 with `modelCalls: 2` against 22,016 in the context), so it is only the fallback for a Grok whose result has no `_meta` |
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
wins. Its stdout is read with the one line reader (`src/json-lines.ts`), split on
`\n` only: Node's `readline` also ends a line at U+2028 / U+2029, which
`JSON.stringify` leaves unescaped, so a reply carrying one would arrive cut in
two and fail to parse. `agentEnv` in `src/adapters/spawn.ts` is the one place that decides this;
a new spawn site must use it.

The reason is that environment variables are inherited by the whole process tree.
Start the bridge **inside** an ADE terminal and it is handed that terminal's
identity; without the scrub every agent it spawned inherited it too, and their
hooks reported to the ADE as if they *were* that terminal — an agent card on a
terminal where nobody launched an agent, with a session stamped on the tab.

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
every client hears it (`stream/agents/updated`). A CLI that *moves* while the
bridge runs gets its adapter rebuilt at the new path too, so no adapter keeps
spawning the one that is gone — the agent list did not change, so nothing is
announced — and never while that agent has a turn running: then nothing is
swapped and the next re-check retries. `agent/doctor` lists, per agent, the
command it runs and every location it checked.

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

`view_show { title, blocks? | html? | path?, height? }` lets an agent show a
chart, table, list, comparison or other page inline in the chat, on the desktop
and on the phone. Exactly one of `blocks`, `html` or `path` is given. The
tool's description and the server's `instructions` are how the agent learns it
has it and how to use it. `path` is read from the conversation's folder with
the workspace path guard; HTML pages are capped at 512 KiB, prepared (the
no-network CSP, charset, viewport, base stylesheet and the view bootstrap put
first, before anything the agent wrote — a `<meta>` policy only governs what
follows it) and stored in `~/.uxnan/views/` (newest 500 / 256 MiB kept). The
answer carries `uxnan-view:<viewId>`.

**Blocks (`src/views/blocks/`).** The agent describes the content as data and
the bridge draws it into one page with one design, so every agent's charts look
alike and follow light and dark mode on every client. The ten types are
`text`, `stats`, `bar-chart`, `line-chart`, `breakdown`, `table`, `list`,
`callout`, `compare` and `choices` (`VIEW_BLOCK_TYPES` in `@uxnan/shared`); a
view takes 1 to 16 blocks (`VIEW_MAX_BLOCKS`) and at most 64 KiB of JSON
(`VIEW_MAX_BLOCKS_BYTES`). `parseViewBlocks` validates them on the bridge, and
its error names the path and the rule (`blocks[2].items[0].value must be a
finite number, …`), which goes back to the agent as the tool error; unknown
fields are dropped. A JSON string of the array is accepted, for a CLI that
passes nested arguments as text. The drawn page uses only the theme variables
and carries its own script for hover readouts, a line-chart crosshair, `choices`
buttons (`window.uxnan.sendMessage`, which only fills the composer) and number
formatting in the host's locale. Its estimated height, clamped to 80–1600 px,
is the first frame height; the page then measures itself as any view does. The
tool step keeps `blockCount` instead of `blocks`, so the blocks never ride the
stream or the thread store.

**The page's theme.** A host sends only what its own theme owns: the surface
the page sits on (`--color-background-primary`), its text, border, focus ring,
fonts and corners — `VIEW_THEME_VARIABLES`, 11 names. The bridge's base
stylesheet (`src/views/view-base-css.ts`) defines every variable a page may use
with a light and a dark value, and alone owns the status colors
(`--color-background-{info,success,warning,danger}` and
`--color-text-{info,success,warning,danger}`) and the chart palette
(`--color-chart-1` to `-6`, `--color-chart-muted`, `--color-chart-grid`):
`VIEW_PAGE_VARIABLES`, the same on every client. Its rules sit in `:where()`,
so the agent's own rules win. The bootstrap sets `data-uxnan-theme` on `:root`
and dispatches the `uxnan-theme` event on every host context, so a canvas
chart can redraw.

**Blocks, measured live (2026-10-15).** Five ordinary questions about numbers
(a 14-day trend, four plans to choose from, a month's spending, before/after
build times, three products' monthly sales), asked of a scratch bridge with each
agent's real CLI, on the release before blocks and then with them:

| Agent (model) | Views before | Views with blocks | Of them as `blocks` |
|---|---|---|---|
| Claude Code (`haiku`) | 5/5, all HTML | 5/5 | 5 |
| Codex (`gpt-6-luna`) | 3/5, all HTML | 4/5 | 4 |
| OpenCode (`opencode/nemotron-3-ultra-free`) | 5/5, all HTML | 5/5 | 5 |
| pi (`openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`) | 1/2, HTML | 2/2 | 2 |
| Grok (default) | 1/2, HTML | 2/2 | 2 |

Ten of the fifteen HTML pages before wrote fixed colors; none of the blocks
views can. Antigravity showed none either time (see `FOR-DEV.md`). One free
model put a Markdown table inside a `text` block; `parseViewBlocks` now refuses
that with the block to use instead (not yet re-measured).

**How an agent knows to show one.** The person never names the tool, so the
tool's description and the server's `instructions` state the rule — numbers to
compare, a trend, a breakdown, a ranking, a schedule, a diagram or a mockup go
in a view, on the agent's own initiative — rather than allowing it as an
option. Codex does not put an MCP server's `instructions` in front of its model,
so for Codex they travel as the thread's `developerInstructions` on
`thread/start` / `thread/resume` (`AgentMcpServer.instructions`,
`codexDeveloperInstructions`); nothing is ever added to the person's message.
Measured on 2026-10-08 (for `html` pages) with an ordinary question ("this week I spent these
tokens per day: …; how does my week look? compare them"), a view shown without
being asked:

| Agent (model) | Optional wording | Rule, MCP channel only | Rule + Codex developer instructions |
|---|---|---|---|
| Claude Code (haiku 5.5) | 0/1 | 1/1 | — |
| Codex (gpt-6-luna) | 0/1 | 0/3 | 3/3 |
| OpenCode (`space-bunny-free` / `mimo-v2.6-flash-free`) | 0/1 | 7/10 (tool description only) | with the session instruction entry: most, not all (see below) |
| pi (`openrouter/cohere/north-mini-code:free`) | — | 1/1 | — |
| Grok | — | 1/1 | — |

**OpenCode gets them per session.** OpenCode 2 never shows its model an MCP
tool directly (they sit behind its code-mode `execute` tool) and drops both an
MCP server's `instructions` and a prompt's `system` field (accepted, ignored —
asked, the model says it sees neither; opencode 2.0.24). It does read a
session **instruction entry**: the bridge keeps the run's servers'
instructions as the `uxnan` entry of each session
(`PUT /api/experimental/session/:id/instructions/entries/uxnan`, sent only when
it changes, removed when the run has none). OpenCode 1 takes them as the
prompt's `system`. Measured with free models on ordinary questions: a view on
most of them, not all — `opencode/space-bunny-free` and
`opencode/mimo-v2.6-flash-free` each skip one now and then; a comparison of a
few options is where every model hesitates most.

**Checking a page first: `view_check`.** Same `blocks` / `html` / `path` as
`view_show`, nothing stored or shown. It prepares the page exactly as `view_show`
would and answers with what will go wrong — what the no-network policy blocks
(remote scripts, styles, images, fonts; `fetch` and friends), whether the page
follows the theme (any theme variable at all; fixed colors written as literals,
hex, `rgb()`, `hsl()`, `oklch()` outside a `var(--x, …)` fallback, are reported),
and whether its height can keep growing (`vh` units, or `height: 100%` on
`html`/`body`) — and, while a desktop is attached, how it renders: the bridge sends
the prepared page to the desktop's `view_render` (control catalog
`view/render`, through its MCP server) and returns its screenshot as an image,
its console errors and its content height (`views/view-check.ts`). With no
desktop, the answer says it checked the source only. The server's instructions
tell agents to check anything beyond a simple page first.

**Bundled libraries, no network.** A page keeps its no-network policy, so it
cannot load a library from a CDN; instead it names one the bridge ships —
`<script src="uxnan:chart.js"></script>` — and the bridge puts the library's
code in its place when it prepares the page (`views/view-libraries.ts`). The
page works offline and over the relay, loads at once, and reaches nothing.
The tool's description lists what there is. Today: Chart.js (MIT, ~200 KB,
global `Chart`). A library is added only when it is permissively licensed,
maintained and small enough to ride in each view that uses it — Mermaid, at
122 MB unpacked, is not (`FOR-DEV.md`). The 512 KiB cap counts the agent's
HTML, not the bundled code.

The step becomes the view in **one place**, `views/convert-view-block.ts`, run
by the `AgentManager` on every adapter's blocks: a finished, non-error tool
block whose output carries the marker of a view this bridge just made becomes a
`view` block (same `blockId`) — **whatever the tool is called**, because agents
reach it under their own names and wrappers (`mcp__uxnan__view_show`, Codex's
`view_show`, OpenCode's code-mode `execute`, Grok's `UseTool`). Each view is
claimed once, so a later step that merely prints an old marker stays a step. A
`view_show` step that is running, failed or names no live view stays a tool
step, with its `html` replaced by `htmlBytes` and its `blocks` by `blockCount`.
Clients fetch the page with `view/read`.

The probe that verified the table above (2026-10-08) is a scratch bridge from
`bridge/dist` (`startBridge({ baseDir: <tmp>, secretStore: new
InMemorySecretStore() })`, no LAN, relay or global entries) that sends each
agent "call view_show once" through `thread/start` + `turn/send` and checks for
a `view` block and a `view/read` page that starts with the policy — the real
CLIs with the user's own sign-ins, nothing written to their configs.

**Model lists follow the same read-the-source rule.** Every agent's list is
**discovered live** from the CLI — `opencode models` (`GET /api/model` on
OpenCode 2), `model/list`,
pi's RPC `get_available_models`, `agy models` (+ `agy -p /model --output-format
json` for the account's default), `zero models list`, Grok's `initialize`
handshake (refreshed by each `session/new` and every `_x.ai/models/update`). **Claude Code is the only curated, hand-maintained list** (see
*Claude Code models* below); it is the one place a new model has to be added by
hand, and it has a matching half in the desktop app.

**A discovered list is only as stable as the CLI's output format — re-capture it
before trusting a parser.** `agy models` changed shape between 1.1.4 and 1.1.13:
it now prints a progress line first and then two TAB-separated columns.

```text
Fetching available models...
gemini-3.7-flash-high⟨TAB⟩Gemini 3.7 Flash (High)
```

The **first column is the `--model` routing key** and carries the reasoning
tier; the second is the label. Since 1.2.11 a tier is also `--effort`, and since
1.3.4 a bare base runs at the account's tier — but a tiered id runs on **every**
version, so that is what the bridge sends. It folds a family of tiers
(`gemini-3.8-flash-{low,medium,high}`, two or more sharing a base) into **one
model with a reasoning knob** over exactly the listed tiers, defaulting to the
account's own tier (`agy -p /model --output-format json`, which answers without
starting a turn), and runs the choice as `<base>-<tier>`; a tiered id a thread
stored earlier runs unchanged. The first row is **not** the account default
(1.3.5 lists High first; the account runs Medium). A parser written for the old one-value-per-line shape kept
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
| **Codex** | `codex app-server` (JSON-RPC over stdio), **one process per turn** | persisted app-server thread id: `thread/start` once, `thread/resume` on every later turn | `approvalPolicy` + `approvalsReviewer` + sandbox on `thread/start`, every `thread/resume` and every `turn/start` — see *Access modes*; approval requests route to the phone | `model/list` (account-aware; every page, following `nextCursor`) → `~/.codex/config.toml` fallback |
| **pi** | `pi --mode rpc` — one resident process per thread; prompt + follow-ups as RPC commands on stdin | `--session-id <id>`, the id read from `get_state` on the first process, passed on every later spawn for the thread | no access modes: `permissionMode` → built-in read/bash/edit/write / `--tools read,grep,find,ls` / `--approve` | RPC `get_available_models` on a short-lived `pi --mode rpc --no-session` (since pi 0.74): exact `contextWindow`, `name`, and the reasoning levels pi itself allows per model (`thinkingLevelMap`: `xhigh`/`max` only when mapped, a level mapped to `null` is unsupported, a model that does not reason has none) |
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
| **Claude Code** | `--permission-mode default`: every gated tool arrives as a stream-json `can_use_tool` control request (`--permission-prompt-tool stdio`) and goes to the person | `--permission-mode auto` (Claude's own reviewer). Not every model has it: **Haiku 4.5** starts in `default` (its `initialize` entry carries no `supportsAutoMode`), so what needs approval goes to the person as in *Request approval* — the turn says so (`system/init` reports the mode). Every other model, Haiku 5.5 included, reports `supportsAutoMode: true` | `--dangerously-skip-permissions` | `--permission-mode plan` | full access |
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
| Antigravity | a `checkpoint` `step_update` (state `DONE`), since 1.3.5's `/compact`; the turn's `result` is then `SUCCESS` with an empty answer, which completes it | reason unknown |

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
| Claude Code | `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `mcp__*` (`ToolSearch`, `AskUserQuestion` and `ExitPlanMode` are not shown: a question card / the plan's text stand for them) | from the edit's old/new strings | `TaskCreate` + `TaskUpdate` (2.x: one list per thread, its ids from `TaskCreate`'s `tool_use_result`; the newest models have no task tool at all), `TodoWrite` on older setups | `Agent` / `Task` |
| Codex | app-server items: `commandExecution` (the login-shell wrapper removed), `mcpToolCall` (`server/tool`), `dynamicToolCall`, `webSearch`, `imageView`, `imageGeneration` (a `generate_image` row naming the saved file) | the item's unified diff; an added file's content | `turn/plan/updated` (its `update_plan` tool, which the models of 0.162.1 do not offer) | `collabAgentToolCall` (`spawnAgent`, `followupTask`) |
| OpenCode | `read`, `grep`, `glob`, `list`, `webfetch`, … (2.x renamed `bash` → `shell`) | from the edit's old/new strings | `todowrite` (1.x only: 2.x has no to-do tool) | `task` (1.x) / `subagent` (2.x, its report unwrapped from `<subagent state="…">`) |
| pi | `read`, `grep`, `find`, `ls` | from the edit's old/new texts | — | — |
| Antigravity | `view_file`, `grep_search`, `find_by_name`, `list_dir`, `read_url_content`, `search_web` | `agy` 1.2.x reports only the file, once changed: the adapter diffs it against the text the agent last read or wrote this turn, else the committed file | a `task.md` / `plan.md` checklist it writes in its own `brain/<conversation>/` folder (`- [ ]`, `- [/]`, `- [x]`), read once written, instead of a diff of a file outside the project | `invoke_subagent`, `browser_subagent` |
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

### Continuing a conversation with another agent

`thread/transfer`, `thread/fork` and `thread/start { continueFrom }`
(architecture/02a §5.8.21) make a new conversation whose **first turn that
runs** carries a context the bridge built from the source — prepended to the
person's text in `AgentManager.#runTurn` (`withTransferContext`), so it reaches
every agent through the same prompt path as any message. No adapter does
anything of its own for it. Measured 2026-10-29 through the real adapters on a
scratch bridge (`thread/start` + `turn/send`, cheapest model, the most
restrictive access mode offered): a first turn carrying a ≈4 KB and a ≈60 KB
context (the selection's ceiling is 64 000 bytes) with one planted fact, then a
second turn asking for it again.

| Agent (CLI) | Model | How the prompt reaches the CLI | 4 KB | 60 KB | 2nd turn recalls | Continue in a terminal |
|---|---|---|---|---|---|---|
| Claude Code 2.1.312 | `haiku` | one stream-json line on stdin | ✓ 4.3 s | ✓ 6.0 s | ✓ (a new process with `--resume`) | `--resume <id>` |
| Codex 0.163.0 | `gpt-6-luna` | app-server `turn/start` (JSON-RPC, stdio) | ✓ 3.2 s | ✓ 3.5 s | ✓ | `codex resume <id>` |
| OpenCode 2.2.0 | `opencode/big-pickle` | HTTP `POST /api/session/:id/prompt` | ✓ 8.8 s | ✓ 3.6 s | ✓ | `opencode --session <id>` |
| pi 1.4.0 | OpenRouter `nemotron-3-ultra:free` | RPC `prompt` on stdin | ✓ 4.5 s | ✓ 4.0 s | ✓ | `--session <id>` |
| Antigravity 1.4.7 | `gemini-3.8-flash` | one NDJSON `user` event on stdin | ✓ 8.5 s | ✓ 4.5 s | ✓ | `agy --conversation <id>` |
| Grok 1.0.67 | `grok-4.7` | ACP `session/prompt` (stdio) | ✓ 8.0 s | ✓ 7.3 s | ✓ | `--resume <id>` |
| Zero 0.10.0 | `openrouter/free` | ACP `session/prompt` (stdio) | ✓ 24.8 s | ✓ 2.6 s | ✓ | — (no interactive resume) |

No prompt travels on a command line, so no length limit applies (only the
auto-title one-shot uses argv, with its text clipped to ≤900 characters). Each
CLI's own session store held the planted fact afterwards, so **continuing in a
terminal** is: deliver the context with a first message through the bridge,
then resume that session with the desktop's existing path (`agentResume.ts`) —
for every agent but Zero. Starting the TUI with the context as its initial
prompt is not used: up to 64 KB on argv breaks on Windows.

End to end on 2026-10-29: a Claude Code (`haiku`) conversation that was told a
codename was continued with Codex and with OpenCode by `thread/transfer`; both
answered it from the carried context, both transfers reached `delivered`, a
retry under the same `clientTransferId` made nothing, and `thread/search` found
the codename in all three conversations.

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

A title is the CLI's own when it keeps one, else the person's first prompt; a
session with neither is named by the bridge (*Naming the agents' own sessions*)
and listed `titlePending` until it is. Claude Code, pi and Grok leave out a
session with no prompt instead.

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

A transcript that is one file (every row below but OpenCode) is only `stat`-ed
when nothing changed: its path, size and modification time
(`SessionHistoryReader.sourceSignature`) are remembered with the thread's shape
when it is merged, and the next read skips reading and merging it while both
are the same (`ThreadStore.nativeHistoryCurrent`). A transcript that grew, or a
thread that gained, lost or ended a turn, is read and merged again in full.

`turn/list` is not the only reader. The read keeps its thread **watched** for the
client that sent it — 15 minutes after its last read, while it stays connected —
and the bridge's `NativeHistoryWatcher` checks every watched thread with no
bridge turn in flight every 2 s: one `stat` of the transcript, a read and merge
only when it changed. OpenCode's history, which has no file to `stat`, is read at
most every 10 s by the watcher (and on every idle `turn/list`). Whenever a merge
changes the stored turns — the watcher's, or the one inside a `turn/list` — the
bridge broadcasts `stream/history/changed { threadId, rev }`, and a client showing
that conversation re-reads its newest page. So a prompt typed in the agent's own
terminal reaches an open conversation within a couple of seconds of the agent
writing it, with no client polling. Antigravity has no readable history, so it
has nothing to watch.

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

**Reasoning stays where it was thought.** A turn read back from a transcript has
the same shape as one the bridge streamed: one assistant message whose
`segments` hold prose, thoughts (`{ type: 'thinking', text }`) and steps in
order. Every reader that finds reasoning finds it in order, and keeps it there
(`ReplySegments`, `src/adapters/reply-segments.ts`):

| Agent | Reasoning in the transcript | Where it lands |
|---|---|---|
| Claude Code | `thinking` content blocks (usually a line of their own) | in line order, before the text or tool call they led to |
| Codex | `reasoning` items (the summary; the body is encrypted) | in rollout order with the tool events, leading the reply they belong to |
| OpenCode | `reasoning` parts | in part order with the text and tool parts |
| pi | `thinking` content blocks; `think` tags inside a text block for some models | in content order |
| Grok | `agent_thought_chunk` updates | in update order with the message chunks (tool calls are not read back) |
| Zero | none — `events.jsonl` keeps only the messages | — |
| Antigravity | no readable history | — |

A Claude Code or pi tool step is paired with its result only on a later line, so
it lands after its own line's prose and thoughts (see `../FOR-DEV.md` →
*Native-session history — order inside one transcript line*).

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

Each agent runs a turn in the thread's `cwd`; agent-wide work — a model
catalog above all — runs in the user's home, the adapter's own folder
(`IAgentAdapter.defaultCwd()`), so renaming or deleting a project folder can
never empty the picker. Codex turns and model discovery both use
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
turn-level timeout anywhere in the bridge**, nor one on how long it waits for
*the user* to answer an approval or a question (see *How long a request can
wait*). A turn can take minutes or hours.

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
| **pi** | `--thinking`, the levels pi allows that model (`get_available_models` → `thinkingLevelMap`; `off…high`, plus `xhigh`/`max` where mapped) | what pi itself would use: `settings.json` `modelThinkingLevels["provider/model"]`, then `defaultThinkingLevel`, then `medium` — clamped to a level the model has |
| **Grok** | ACP `_meta.reasoningEfforts` | the entry flagged `default` |
| **OpenCode** 2 | the model's `variants` (sent as `variant`) | none named: an untouched turn runs at the provider's own |
| **Antigravity** | the tiers `agy models` lists for a family (`-low` / `-medium` / `-high`), sent as the tiered id | the account's own tier (`agy -p /model --output-format json`), else the middle listed one |
| **Zero** | none | — |

**Interactive approvals** are wired for Echo, Claude Code (stream-json
`can_use_tool` control requests, `--permission-prompt-tool stdio`), Codex
(`app-server` elicitations), OpenCode (`opencode serve` `permission.asked`, both
versions), Zero and Grok (ACP `session/request_permission`); **pi** and
**Antigravity** have no headless pre-tool channel and run autonomously.
Antigravity's stream-json surface auto-denies any tool that would prompt
(`result.denied_actions`, verified on 1.3.5); its stdin `control_request` is
reserved but answers "not supported yet" — see [`../FOR-DEV.md`](../FOR-DEV.md).

**Leaving plan mode** is one rule for every agent that asks (Claude Code's
`ExitPlanMode`, Grok's `_x.ai/exit_plan_mode`): the plan is shown as the turn's
text first; then a *Plan only* thread is refused (the agent stays in plan mode
and waits for the person to switch modes), *Full access* and *Approve for me*
go on by themselves, and *Request approval* asks with a card that reads
"Start implementing this plan" (`ApprovalRequestInfo.action`). Replying with an
error is never an answer: Grok ends the prompt `cancelled` and stays in plan
mode.

**Interactive questions** — an agent's own "ask the user" tool surfaces as a
`question` content block the person answers via `turn/send { questionResponse }`;
the bridge (`AgentManager.requestQuestion`) hands the answer back so the agent
continues with it. `QuestionItem.custom` marks a question that also takes an
answer the person types (returned like a label). Per agent:

| Agent | How it asks | How the bridge answers |
|---|---|---|
| **OpenCode** | its `question` tool: 1.x a question, 2.x a **form** (`form.created`, one field per question; `type: "multiselect"` — `array` / `multiple` on early 2.x — for several picks, `custom: true` for typed text) | 1.x `/question/{id}/reply` (or `/reject`); 2.x `/api/session/:id/form/:id/reply` with each chosen option's **`value`** (an array for a multi-select field), or `DELETE` to dismiss. A reply the server refuses dismisses the form, so the turn goes on instead of hanging |
| **Claude Code** | `AskUserQuestion`, offered only with `--permission-prompt-tool stdio`; it arrives as a `can_use_tool` control request (questions, options, `multiSelect`; always `custom`) | `control_response` allow with `updatedInput.answers` keyed by question text (several labels joined with `, `); skipped → deny "The user did not answer." |
| **Grok** | `ask_user_question`, as the server request `_x.ai/ask_user_question` (`{label, description}` options, `multiSelect`) | `{ outcome: "accepted", answers: { <question>: <label> } }`; skipped, or nobody to ask → `{ outcome: "skip_interview" }` — never an error, which the model reads as "could not be delivered" |
| **Codex** | `item/tool/requestUserInput` (`questions: [{ id, header, question, isOther, isSecret, options \| null }]`; `isOther` or no options → `custom`). On 0.162.1 (and 0.163.0, re-checked 2026-10-31) the model only has the tool in the app-server's *plan* collaboration mode, which the bridge does not use, so it is wired for when Codex sends it | `{ answers: { <question id>: { answers: [...] } } }`; skipped → `{ answers: {} }`. A request Codex settles itself (`serverRequest/resolved`) withdraws the card |
| **Zero** | `ask_user` exists, but `zero acp` never sends it to the client: the tool answers itself "No interactive user is available" (0.9.0; still so on 0.10.0) | — (the tool call is shown read-only) |
| **Antigravity** | `ask_question` shows only as `step_type: "unknown"`, and the CLI answers "User Skipped" itself (1.3.5) | — |
| **pi** | no question tool | — | OpenCode 1's
`permission.v2.asked` shape is routed through the same approval path as
`permission.asked`.

### How long a request can wait

An approval or a question **waits for a person, with no clock.** The bridge
keeps it pending — on every client, across reconnects and app restarts — until
someone answers it, the agent withdraws it (an `AbortSignal`: Codex's
`serverRequest/resolved`, Claude's own cancel), or the run that asked ends
(completed, stopped, failed, or its CLI exited: `AgentManager.#forgetRun`
withdraws what it still waited on). The only bound is the CLI process, never a
wall clock; the five-minute auto-reject / auto-skip it replaced is gone. A
withdrawn request is announced with `withdrawn: true` and stored on its card as
`outcome`, so every client says it is no longer waiting rather than inventing a
decision.

Measured 2026-10-31 by running each adapter on a scratch store (the real
`AgentManager`, no CLI timeout shortened), leaving the request unanswered, then
answering it late and checking the agent acted on that answer:

| Agent (version) | Asks on the driven surface | Held unanswered | Withdrawn by the CLI meanwhile | Late answer taken |
|---|---|---|---|---|
| Claude Code 2.1.312 | approval (`can_use_tool`) | 12 min and 30 min | no | yes — the command ran, `DONE` |
| Claude Code 2.1.312 | question (`AskUserQuestion`) | 12 min | no | yes — "Blue it is." |
| Codex 0.163.0 | approval (`item/commandExecution/requestApproval`) | 12 min and 30 min | no | yes — the command ran, `DONE` |
| Codex 0.163.0 | question | — never asked: `request_user_input` exists only in the app-server's *plan* collaboration mode, which the bridge does not use (two prompts naming the tool; the model wrote the question as text) | — | — |
| OpenCode 2.2.0 | approval (`permission.asked`) | 12 min | no | yes — the command ran |
| OpenCode 2.2.0 | question (form) | 12 min and 30 min | no | yes — "You chose blue." |
| Grok 1.0.70 | approval (`session/request_permission`) | 12 min | no | yes — the command ran (exit 0); the model call after it hit the account's free-usage limit (429), unrelated to the wait |
| Grok 1.0.70 | question (`_x.ai/ask_user_question`) | 12 min | no | yes — "You chose blue." |
| Zero 0.10.0 | approval (`session/request_permission`) | 12 min and 30 min | no | yes — `DONE` |
| Zero 0.10.0 | question | — never reaches the client: `ask_user` answers itself "No interactive user is available to answer questions. Proceed with your best assumption" at once — the self-answer the apps used to show as the agent going on alone. No ACP method carries it, so the bridge cannot hold it | — | — |
| Antigravity 1.4.12 | none — `ask_question` is answered "skipped" by the CLI itself (the model replied "You skipped the question"); tools that would prompt are auto-denied | — | — | — |
| pi 1.4.0 | none — no question tool; the model asked in plain text and the turn ended (extension dialogs are declined, see the pi adapter) | — | — | — |

**12/12 holds** (8 at 12 minutes, 4 at 30) kept the request pending and took
the late answer; no CLI times out a pending request on the surface the bridge
drives, so **no client shows a countdown**. Where an agent cannot be held (Zero
and Antigravity questions, Codex questions outside plan mode), it is because
the question never reaches the client at all, not because of a timer — there
is no card to keep open. Re-run this when a CLI's protocol changes: the
harness is a scratch `ThreadStore` + `AgentManager` with the adapter built as
`bridge.ts` builds it, a prompt that makes it ask, and a wait longer than the
longest timeout under test.

Every request is also **announced once** (`AgentManagerOptions.onInputRequested`):
a "needs you" push to every phone that keeps `needsInput` on
([`push-notifications.md`](./push-notifications.md)), a local notification on a
connected phone (removed when the request is answered anywhere) and a toast /
OS notification on the desktop when that chat is not on screen.

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
| **Antigravity** | its **skills**, from `agy -p /skills --add-dir <cwd>` in the thread's folder (a command the CLI answers itself; the workspace's skills come from `--add-dir`; ~4 s cold), plus its built-in `compact` (1.3.5 runs it on stream-json: a `checkpoint` step, then an empty `SUCCESS`); other built-ins are not listed because they fail on stream-json; reused per folder for a minute | native — sent as `/name args` in the user message, which `agy` expands |
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

## Attachments in the sentence (`turn/send { text, attachments }`)

A message is written with its images and files **inside** it — "the shape in
this image ⟨a⟩ belongs to Ana, and the one in ⟨b⟩ to Luis" — and only means
something if the agent knows which picture each part of the sentence is about.
The contract (`@uxnan/shared` `models/inline-attachments.ts`): the text carries
one U+FFFC marker per attachment, in order, and `turn/send` refuses a message
whose markers do not match its attachments one for one (counted in
`command.args` for a command) or an attachment without bytes. The stored
message keeps the markers; the thread store keeps every attachment beside it
under `~/.uxnan/attachments/<threadId>/`, named, and serves each with
`turn/attachment`, so both apps draw each one where it was written.

What the agent gets is built once, for every agent (`src/agents/attachments.ts`):

1. **Every attachment is written into the directory the CLI runs in**
   (`<cwd>/.uxnan-attachments/<turnId>/<n>/<name>`; an unnamed image is
   `image-<k>.<ext>`) and referenced **relative to that cwd**. Agents are
   confined to their workspace: given the same image under the OS temp dir,
   Claude answers *"the read was blocked by a permission prompt"*. A turn
   without its own `cwd` uses the adapter's folder (`defaultCwd()`). The
   directory is removed when the turn ends.
2. **Each marker becomes a numbered label at its place** — `[Image 1: a.png]`,
   `[File 1: b.pdf]`, numbered per kind — also inside a command's arguments,
   before the command is resolved. A closing note maps every label to its file.
3. **An adapter that declares `takesInlineImages()` also gets
   `SendTurnOptions.input`**: the same prompt cut into ordered parts with each
   image right after its label, which it translates into its protocol's own
   image input (`src/adapters/turn-input.ts`), on a mid-turn message too. Its
   note then says the image came with the message and its file is there for
   file work. Only PNG, JPEG, GIF and WebP go inline; any other image is a file
   to open.

| Agent | Delivery on the driven surface | Measured (two different images in one sentence; n/N = each attributed to the right part) |
|---|---|---|
| **Claude Code** 2.1.312 | inline — stream-json `content`: `text` / base64 `image` blocks interleaved | `haiku` (cheapest and weakest): **4/4**, no tool call, ~5 s. The text-only path for comparison: 2/2, one `Read` step |
| **Codex** 0.163.0 | inline — app-server `turn/start` / `turn/steer` `input`: `text` / `image` (data URL) items interleaved | `gpt-5.6-luna`: **4/4**, no tool call, ~3 s |
| **OpenCode** 2.2.0 | inline — `/api/session/:id/prompt` `files[]` (data URI, `name`, `mention` spanning the label in `text`) | `opencode/nemotron-3.5-super-vl-free` (free, the weakest vision model offered): **4/4**, ~3 s. Text-only path: 4/4 but 17–42 s (it opens each file). `opencode/gemini-3.5-flash-lite` could not run: the account answers "Insufficient account funds" |
| OpenCode 1.x | inline — `prompt_async` `parts`: `text` / `file` (data URL) interleaved | **not measured**: only 2.2.0 is installed here ([`../FOR-DEV.md`](../FOR-DEV.md)) |
| **pi** 1.4.0 | inline — RPC `prompt` / `steer` `images[]` in label order after the text (pi does not interleave; each label sits in the text in the same order) | `openrouter/thinkingmachines/inkling-small:free`: **4/4**, ~2 s. `openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (the weakest vision model tried): each picture attributed to the right person **4/4**, though it called the square a "rectangle" in 3 runs. OpenRouter's free Gemma 4 (`google/gemma-4-31b-it:free`, `…-26b-a4b-it:free`) never ran: Google's shared free pool answered `429` to every attempt that session (pi took the prompt with its `images` each time) |
| **Zero** 0.10.0 | inline — ACP `session/prompt`: `text` / `image` blocks interleaved (`promptCapabilities.image`) | `nvidia/nemotron-3.5-super-vl:free` (OpenRouter): **4/4**. Its default `openrouter/free` has no vision: Zero itself prepends *"Model openrouter/free does not support image input; ignoring 2 prompt image(s)"* and the agent says it cannot see them (0/3) |
| **Grok** 1.0.70 | text — labels + note; ACP `promptCapabilities.image` is false, so it opens each file with its own tools | `grok-4.7`: **6/6**, one read step |
| **Antigravity** 1.4.10 | text — labels + note; `agy` stream-json refuses any block but `text` (*"stream input content block type "image" is not supported (only "text")"*, measured), so it opens each file | `gemini-3.8-flash`: **4/4**. `gpt-oss-120b-medium` (no vision): 0/2, it says it cannot view the images and asks for a description |

Measured 2026-10-30 through the real `AgentManager` and adapter on a scratch
bridge, with three different shapes in rotated pairs, file names that say
nothing about their content, and the reply checked for both people.

A model without vision is not a delivery bug: the attachment arrives either
way, labelled where it was written, and the agent says what it can and cannot
do with it. Pick a vision model when the picture matters. `capabilities.images`
still decides whether the apps offer images for an agent; files go to every
agent.

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
3. **Pinned models** from `agents.claude-code.models` the CLI does not already
   offer — not as an entry, not as the model an alias runs, not under a dated
   snapshot id. Bridges before 0.0.49 froze their old built-in list into that
   key whenever they saved the config; an entry identical to one of it is
   dropped when the config is read, so it never reads as the user's pin.

A thread on a concrete id an alias runs (`claude-opus-5-5`, picked before the
list moved to aliases) reads as that alias (`Opus 5.5`) and gets its effort
knob — `modelFor()` in `src/agents/agent-manager.ts`; the desktop and the phone
apply the same rule.

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

**Every provider is asked of its own CLI** (`src/usage/cli-usage.ts`). Each one
answers for the account it is signed in to, from wherever it keeps that
sign-in (the macOS Keychain, the OS keyring, its own file), so the bridge reads
**no credential at all** — no token file, no keychain item, no OS permission
prompt — and every snapshot is `source: "cli"`. Reading a stored token to call
an API directly is the last resort and is used for **no** provider today; one
that needed it would have to go behind an explicit user permission first. All
providers are read side by side, and a provider already being read when
another client asks is answered from that read (`CoalescedUsageReads` in
`src/handlers/usage-handler.ts`), so a phone and a desktop polling together do
not start each CLI twice. An id the bridge does not know is skipped, not
refused, so a newer client still gets the others.

| Provider | Asked | Fills |
|---|---|---|
| Claude Code | `claude --input-format stream-json` → control requests `initialize` + `get_usage` | windows (`rate_limits.limits[]`), plan, email/organization; a balance in `credits` once usage credits are enabled — `spend` (`{amount_minor, currency, exponent}`), else the older `extra_usage` (minor units at `decimal_places`) |
| Codex | `codex app-server` → `account/read` + `account/rateLimits/read` | windows by length, a seat's spend limit (`individualLimit` → `Spend limit`), plan (named as Codex's `PlanType`), email, a balance once the account has credits, `resetCredits` |
| GitHub Copilot | `gh api /copilot_internal/user` — `gh` sends its own sign-in; the bridge only reads the answer | `quota_snapshots` (a quota the plan does not include — `has_quota: false`, entitlement 0 — is skipped, not shown as 100% used), plan (`Copilot Free` from the `access_type_sku`, else `Copilot <copilot_plan>`), login |
| Grok | `grok agent stdio` (the ACP surface it is driven on) → `initialize` + the `_x.ai/billing` extension request | the period window (`creditUsagePercent`; absent with a current period means 0% — the answer is protobuf JSON, which leaves zeros out), balances in USD from the `{val}` amounts, plan from `subscription_tier` |
| Antigravity | `agy -p /usage --output-format json` + `agy -p /credits --output-format json` (agy ≥ 1.1.11) | one window per `groups[].buckets[]` (used = 1 − `remaining_fraction`, `window` `5h`/`weekly`, `reset_time`; `disabled` buckets skipped), `credit` = AI credits once above 0 (in `credits`). No plan: agy does not report one |
| OpenCode 2 | `opencode api --standalone GET /api/experimental/usage/limits` (a private server that exits with the request) | OpenCode Go `rolling`/`weekly`/`monthly` meters, every Console budget as a USD balance (`combined`/`all` first; one for some models names them in `scope`), workspace name as organization; `data: null` → not signed in |
| pi, Zero | — | nothing: pi and Zero run on the user's own provider keys and expose no plan limits (`zero usage report` is local token spend, already counted by `usage/summary`) |

**Antigravity's guard.** Before agy 1.1.11 a print-mode slash command was sent
to the model as a prompt (its own changelog), so the bridge checks
`agy --version` first and never asks an older one. It never passes
`--disable-slash-commands` (which turns the command into a prompt), and it
believes an answer only when it says it ran the command (`status: SUCCESS`,
`command.name`) **and** that no turn ran (`num_turns: 0`, empty
`conversation_id`). An answer that ran a turn latches: that bridge process
never asks agy again. `AGY_CLI_DISABLE_AUTO_UPDATE=true` keeps an update check
out of the probe.

**Grok's money.** On-demand spend of its cap (`onDemandUsed` / `onDemandCap`,
`period: "On-demand"`, `limit`, `available = cap − used`, resetting at
`billingPeriodEnd`) once a cap is set or anything was spent, and a
`prepaidBalance` above zero (`period: "Prepaid"`, `available`) — both when the
account has both, on-demand (what it is spending now) first. Its window's id
is its period (`daily` / `weekly` / `monthly`).

**Ids, not words.** Each window carries a stable `id` (and `model` for a
model-scoped one) and each balance a `period` from a fixed vocabulary; the
English `label` / `period` are fallbacks. The phone and the desktop translate
the ones they know through one formatter each (`usage_format.dart`,
`usageLabels.ts`) — so a label is never written in two languages at once.

### Banked resets

| Provider | See + list | Use |
|---|---|---|
| Codex | `account/rateLimits/read` → `rateLimitResetCredits` (count, each credit's id, title, expiry) | `usage/redeemReset` → `account/rateLimitResetCredit/consume` with an idempotency key — clients call it only after the user confirms |
| Claude Code | `get_usage` → `rate_limits.cedar_ember` (`grants[]` with `resets_left`, `ends_at`, `paused`, `label`) | **not headless**: the CLI spends one only through its interactive `/limit-reset`; `resetCredits.redeemCommand` says so, the clients show it instead of a button, and `usage/redeemReset` refuses with that instruction. Using its token to redeem directly is the credential path this reader never takes |
| Grok, Antigravity, OpenCode, Copilot, pi, Zero | — | none of these CLIs exposes banked resets (searched each binary on this machine) |

The `cedar_ember` key is in every `get_usage` answer; on the maintainer's
account it is `null` (no resets held), so the populated shape is pinned by the
test from the CLI's own parser, not from a live grant.

## Spend (`usage/summary`)

What each agent's CLI records on disk, the bridge's turns and a person's own
terminal sessions alike (`src/usage/transcript-usage.ts`,
`src/usage/antigravity-usage.ts`, `src/usage/usage-scan.ts`):

| Agent | Store | Cost |
|---|---|---|
| Claude Code | `~/.claude/projects/**.jsonl` | estimated at Anthropic's published prices (`CLAUDE_PRICES`) |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | tokens only (no price table) |
| pi | `~/.pi/agent/sessions/**.jsonl` | billed, as pi records it |
| Grok | `~/.grok/sessions/**/updates.jsonl` | billed (`costUsdTicks`) |
| OpenCode 2 | `opencode.db` | billed, as OpenCode records it |
| Zero | `~/.local/share/zero/sessions/*/events.jsonl` | tokens only — and only for `zero exec` sessions: an ACP-driven one records no `provider_usage` (see *Drive surface*), so the bridge's own Zero turns are not counted |
| Antigravity | `~/.gemini/antigravity-cli/conversations/<id>.db` | tokens only: billed against its plan quota |
| GitHub Copilot | — | not an agent the bridge drives; nothing on disk to read |

**Antigravity's store, verified against the driven surface** (agy 1.4.12): a
turn driven over `--input-format stream-json` streamed `input_tokens 10069,
output_tokens 33, thinking_tokens 32, cache_read_tokens 0` on its
`agent_response` `step_update`, and its conversation database stored exactly
those in its `gen_metadata` row (fields documented in
`antigravity-usage.ts`). Across the 227 calls on this machine every row decoded,
and each call's single attempt repeats its usage (counted once). Live 30-day
read: 90 responses, 1.17M tokens.

### Live matrix

Run read-only on the maintainer's Mac (2026-10-30) through `readUsage` with
every real CLI, identities redacted; all six together answered in 4.6 s.

| Provider | CLI | Status | What came back |
|---|---|---|---|
| Claude Code | 2.1.312 | `ok` | plan Claude Max; session 16%, weekly 35%, a model-scoped weekly 0%, each with its reset; usage credits disabled → no balance |
| Codex | 0.163.0 | `ok` | plan Free; one 30-day window 88% with its reset; no credits, no resets |
| GitHub Copilot | gh 2.102.0 | `ok` | plan Copilot Free; chat 0%, completions 0% (monthly reset); premium requests not in the plan → skipped |
| Grok | 1.0.70 | `ok` | plan Free; weekly window 0% with its reset; no money on the account |
| Antigravity | 1.4.12 | `ok` | two weekly windows (Gemini models 9%, Claude and GPT models 0%) with resets; 0 AI credits → no balance; `num_turns: 0` |
| OpenCode | 2.2.0 | `ok` | signed in to a Console workspace with no Go plan and no budget → no window, the "no OpenCode Go plan or budget" message |

Not exercised live (no such account here; the shapes come from each CLI's own
schema — Codex's `generate-json-schema`, OpenCode's `/api` OpenAPI document —
and are pinned by `test/usage/usage-reader.test.ts`): Codex resets and
`individualLimit`, Claude's enabled usage credits, Grok's paid tiers and
money, OpenCode Go meters and budgets, Antigravity AI credits above 0.

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
