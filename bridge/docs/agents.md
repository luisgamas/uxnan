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

Prompts are passed as argv elements with `shell:false` (no shell injection); stdin
is closed (a one-shot CLI hangs on an open stdin pipe). **Claude Code and pi are
the exceptions among the one-shot agents**: both are run in a mode that reads a
real message stream (`claude --input-format stream-json`, `pi --mode rpc`), so
their prompt is written to a stdin pipe that stays open for the length of the
turn — which is what lets a follow-up reach them mid-run (see below). The
server-based adapters are the other exception: **Codex** speaks
JSON-RPC over a long-lived
`codex app-server` stdio, **Zero** and **Grok** speak JSON-RPC (the Agent Client
Protocol, NDJSON) over a long-lived `zero acp` / `grok agent stdio` process, and
**OpenCode** speaks HTTP + SSE to a long-lived `opencode serve` process (their
prompts travel in the request body / session request, never argv).

### One turn per thread, and the queue that follows from it

The bridge drives **one turn per thread**, and this is a hard constraint, not a
policy: half the agents below are spawned fresh for every turn and resume their
own session (`claude -p --resume`, pi, antigravity), so two concurrent
turns would be two CLI processes writing to the same session file.

So a `turn/send` that arrives while a turn is in flight is **queued** rather than
started — the same thing the CLIs themselves do when you type a follow-up while
they work. It runs on its own once the current turn completes, through the
identical code path a normal turn takes, which means **queueing behaves the same
for all seven active agents** regardless of how their CLI is driven.

### …and when it doesn't wait at all

Waiting for the whole turn is not what the CLIs do. They take what you type at
the next tool boundary, *inside* the running turn — which is what lets you
correct an agent's course without stopping it. The bridge does the same
wherever the agent's CLI actually allows it: the follow-up is handed straight
over, its turn is marked `delivered` (terminal and successful — the message was
received; the reply belongs to the turn it joined) and `turn/send` answers
`{ delivered: true }`.

It is deliberately narrow, so a thread's order can never be rearranged. The
hand-off is only attempted when the adapter advertises `steering`, a turn is
really in flight, and the queue is **empty** (anything already waiting was sent
first) and **not paused** (the queue pauses precisely because the user stopped
the agent or it broke). **Every refusal falls back to the queue**, so a message
is never lost — at worst it waits, exactly as before.

Which agents can, and why — verified against the real CLIs:

| Agent | Mid-turn? | Mechanism |
|---|---|---|
| **Claude Code** | yes | `-p --input-format stream-json`; the message is written to the open stdin |
| **OpenCode** | yes | another `prompt_async` on the session that is already busy |
| **Codex** | yes | app-server `turn/steer { threadId, expectedTurnId, input }` |
| **pi** | yes | RPC `steer` command, drained by its agent loop at the next boundary |
| **Antigravity** | no | `agy -p` is one-shot with no input channel at all |
| **Zero** | no | its ACP serializes prompts per session (`turnMu`) — and its own TUI does not inject either: it launches a queued message only once the turn ended |
| **Grok** | no | ACP defines no steer method and advertises none on `initialize` |

Zero is the instructive case: it **already behaves like the bridge's queue**, so
there is no native behaviour to match there.

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
| **OpenCode** | `opencode run` (no `--session`/`--continue`) | CLI default |
| **pi** | `pi -p --no-session` | CLI default |
| **Antigravity** | `agy -p` (no `--conversation`) | `gemini-3.6-flash-low` |
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
structurally by the `AgentManager` like `nativeSessionId`), so agents without a
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
| **OpenCode** | `opencode serve` | local HTTP + SSE | yes |
| **Claude Code** | `claude -p` | NDJSON both ways (`--input-format`/`--output-format stream-json`), prompt + follow-ups on an open stdin | yes |
| **Codex** | `codex app-server` | JSON-RPC 2.0 over NDJSON stdio | yes — on its **own notification**, `thread/tokenUsage/updated` (a completed turn carries none), which also brings `modelContextWindow` |
| **pi** | `pi --mode rpc` | JSON-RPC over stdio | yes |
| **Grok** | `grok agent stdio` | ACP (JSON-RPC over stdio) **plus `_x.ai/*` extension methods** | yes — on `_x.ai/session_notification`, **not** on ACP's own `session/update`; the `turn_completed` update carries the `usage` block |
| **Zero** | `zero acp` | ACP (JSON-RPC over stdio) | **no** — see below |
| **Antigravity** | `agy -p` | one process per turn, plain text on stdout | **not on this surface** — see below |

Two agents report no usage, and in both cases the CLI *can* report it somewhere
else — which is exactly the trap:

- **Zero.** It appends a `provider_usage` event per turn to its session store,
  but only for a session driven by `zero exec`. Verified by running the adapter
  and reading the store it wrote: an **ACP-driven** session holds `message`
  events and nothing else. `reportsContextUsage` is false so the phone hides the
  meter rather than showing one pinned at zero.
- **Antigravity.** `agy` reports `{input_tokens, output_tokens, thinking_tokens,
  cache_read_tokens, total_tokens}` on its `result` event — but only under
  `--output-format stream-json`, while the turn runs on `text`. Surfacing it
  means migrating the turn's whole stream parse to the JSON events (tracked in
  [`../FOR-DEV.md`](../FOR-DEV.md)).

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

**Model lists follow the same read-the-source rule.** Every agent's list is
**discovered live** from the CLI — `opencode models`, `model/list`,
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
| **OpenCode** (default) | `opencode serve` (local HTTP + SSE) | persisted server session id | `accessMode` → per-session permission ruleset: `ask` on `edit`/`bash`/`webfetch`/`external_directory` (real `permission.asked` approvals) / `allow` for approveForMe·fullAccess | `opencode models` (real list) |
| **Claude Code** | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` (prompt on stdin) | `--resume <session_id>` | `permissionMode` → `--permission-mode acceptEdits` / none / `--dangerously-skip-permissions` | `fable`/`opus`/`sonnet`/`haiku` aliases (latest) **+ `agents.claude-code.models`** |
| **Codex** | `codex app-server` (JSON-RPC over stdio), **one process per turn** | persisted app-server thread id: `thread/start` once, `thread/resume` on every later turn | `accessMode` → app-server `approvalPolicy` + `sandbox`, re-applied on **every** `thread/start`/`thread/resume` (so a mid-conversation change lands on the next turn); approval requests route to the phone | `model/list` (account-aware) → `~/.codex/config.toml` fallback |
| **pi** | `pi --mode rpc` (prompt + follow-ups as RPC commands on stdin) | `--session-id <id>` | `permissionMode` → built-in read/bash/edit/write / `--tools read,grep,find,ls` / `--approve` | `pi --list-models` (real list; reasoning knob per model) |
| **Antigravity** | `agy --conversation <uuid> --add-dir <cwd> (--dangerously-skip-permissions \| --mode plan) -p <text>` | client-owned `--conversation <uuid>` (create + resume) | `accessMode` → `--dangerously-skip-permissions` (approveForMe·fullAccess) / `--mode plan` (requestApproval → read-only, since headless can't prompt) | `agy models` (real list; the Gemini family + hosted others), read as `<id>⟨TAB⟩<label>` — the id routes, the label is shown |
| **Zero** | `zero acp` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | `accessMode` → ACP session mode: `ask` (real `session/request_permission` approvals) / `auto` for approveForMe·fullAccess | `zero models list` (real list; `contextWindow` from `ctx=`) |
| **Grok** | `grok agent stdio` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | `accessMode` → ACP `session/request_permission` answered per posture: interactive (asks the phone) / auto for approveForMe·fullAccess | `initialize` `_meta.modelState` (context window + reasoning-effort knob per model) |

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
| OpenCode | `session.compacted` | reason unknown |
| pi | successful `compaction_end` | reason + before/estimated-after tokens |
| Zero / Grok | ACP exposes no compaction update | no marker |
| Antigravity | text-only one-shot output exposes no structured signal | no marker |

Never infer a compaction from prose, an overflow error or a token-count drop;
that would put a false event into durable history.

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

### Native-session history convergence

`turn/list` is more than a bridge-store read. When the bridge is not currently
driving a turn for that thread, it reads the matching agent-owned transcript and
merges completed native-only turns before paging the result. This makes a prompt
written in an agent's desktop app or CLI appear back in Uxnan Mobile.

| Agent | Native history source | Cross-client behavior |
|---|---|---|
| Codex | `~/.codex/sessions/.../rollout-*-<sessionId>.jsonl` | Codex Desktop/CLI completed turns converge |
| OpenCode | `GET /session/:id/message` from the per-workspace `opencode serve` process; legacy JSON store fallback | OpenCode Desktop/CLI completed turns converge |
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

Each agent runs in the thread's `cwd`. Codex turns and model discovery both use
`codex app-server` (`thread/start` / `turn/start` and `initialize` →
`model/list`), each on its own short-lived process — see
*Codex holds one writer per thread* below. Binary resolution
(`resolve-*.ts`) prefers a directly-spawnable executable (native binary or
`node <cli.js>`) so `shell:false` always holds.

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
| **OpenCode** | its own `opencode serve` (the desktop app's model) | works with the bridge's server still running: it lists the session, reads it, and posts a new turn into it. The store is shared, not owned by a process |

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
| A **protocol event** | Claude (`result`), Codex (`turn/completed`), OpenCode (`session.idle`), Pi (`stopReason`), Grok / Zero (the ACP `session/prompt` reply) | **Yes** — the process is still alive when the event arrives |
| **Process exit** | Antigravity | No — the turn cannot end before the process does |

That distinction matters because **Claude Code really does come back**. When the
model starts a background task (`Bash` with `run_in_background`) and ends its
turn, the CLI emits its `result` and keeps running; if the work finishes within
its grace period the CLI **wakes the model** and a second, complete turn follows
on the same process. Timed against the real CLI, the grace period is about
**4–6 seconds**, after which the CLI **kills** the task (`status:"stopped"`) and
exits with that work unfinished.

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
| **leaves** work running and ends its turn | held open by the adapter until the CLI's follow-up turn or its exit | ~4–6 s, then the CLI kills the work and the turn reports it |

So `claude-adapter.ts` tracks live background tasks (`system` lines with
`subtype:"task_started"` / `"task_notification"` — the reason `system` is no
longer parsed as one event kind) and **holds the completion** while any is live,
emitting exactly one `turn_completed` carrying both replies. Work the CLI killed
is reported to the user as a warning block rather than passing as a clean turn.

Two guards make this safe for **every** adapter, present and future, since the
first table row is where the hazard lives:

- `ThreadStore` ignores appends and a second `completeTurn` once a turn is in a
  terminal status — a late completion used to overwrite the reply the user had
  already read.
- `AgentManager` ignores a duplicate terminal event, so the message queue is
  never drained twice (which would start a queued follow-up against a CLI that
  is still running).

Claude Code is the only one that comes back. Every agent was probed the same
way — asked to leave a shell command running and end its turn — and timed:

| Agent | Wakes the model after its turn? | What happens to the deferred work |
|---|---|---|
| **Claude Code** | **Yes** | ~4–6 s of grace. Finishes in time → the CLI wakes the model and a second turn reports it. Otherwise **killed** (`status:"stopped"`), work lost |
| **OpenCode** | No | **Survives — the CLI waits for it.** A `sleep 100` kept the process alive 108 s |
| Codex | No (nothing after `turn.completed`; exits ~0.7 s later) | Dies with the CLI |
| Grok | No (exited in 17 s with a 40 s job pending) | Dies with the CLI |
| Pi | No — no background tool, no wake-up path | Killed on shutdown (tracked pids exist for exactly that) |
| Zero | No — same | Killed: *"a backgrounded child cannot outlive the command"* |
| Antigravity | No — the turn ends on process exit | n/a |

Two consequences worth keeping straight, because they need different answers:

- **Claude Code** genuinely defers and returns, so its turn must stay open —
  that is what the adapter now does.
- **Everyone else** ends for real. An agent there can still *say* it will report
  back, and nobody ever will: with Codex, Grok, Pi and Zero the work is already
  dead, and with **OpenCode it is worse** — the work really does keep running
  (the CLI waits for it), so it completes and is never reported. There is no
  deferred state to model in those cases, only a promise not to take at face
  value.

None of this makes the guards Claude-specific: the hazard is structural for
every adapter in the first table above, today or after any upstream change.

Per-thread selection: `thread/start { agentId, model, cwd }`; `agent/list` reports
availability/capabilities; `agent/models` lists models (`AgentModel[]` with
`id`/`displayName`/`description?`/`version?`/`isDefault?`/`options?`/`contextWindow?`);
`thread/setModel` repoints a thread's model mid-conversation. The id the phone
sends back is passed verbatim to the CLI's `--model`/`-m` flag. Per-model
**run-option knobs** (reasoning effort) are advertised in `AgentModel.options` and
the phone renders them generically — Codex discovers them from the app-server
`model/list` (`supportedReasoningEfforts`), Claude/pi from their own flag sets.

**Interactive approvals** are wired for Echo, Claude Code (`PreToolUse` hook),
Codex (`app-server` elicitations), OpenCode (`opencode serve` `permission.asked`),
Zero and Grok (ACP `session/request_permission`);
**pi** and **Antigravity** have no headless pre-tool channel (both run
autonomously — Antigravity's `agy -p` auto-denies any tool that needs a prompt,
so a `requestApproval` thread runs read-only `--mode plan` instead — see
[`../FOR-DEV.md`](../FOR-DEV.md)).

**Interactive questions** — OpenCode's `question` tool (the agent asks a
multiple-choice question) surfaces as a `question` content block the phone answers
via `turn/send { questionResponse }`; the bridge (`AgentManager.requestQuestion`)
replies to `/question/{id}/reply` so the agent continues with the choice. The
`permission.v2.asked` elicitation shape is routed through the same approval path as
`permission.asked`.

## Agent commands (`agent/commands` + `turn/send` `command`)

The bridge discovers each agent's special ("slash") commands (`agent/commands` →
`AgentCommand[]`) and runs them via the normal streaming turn (`turn/send`
`command: { name, args? }`). There are **two classes**, unified through one path —
`AgentManager.sendTurn` resolves a `command` to the prompt the agent runs (the
`/name args` form is what history persists):

| Agent | How commands are discovered | How they run |
|---|---|---|
| **Claude Code** | `slash_commands` from the `system/init` line (cached per turn) ∪ curated headless-safe built-ins (`compact`, `context`, `status`, `cost`, `usage`) ∪ `.claude/commands/*.md` scan | native — sent as `/name args`, resolved against the thread's `--resume` session |
| **Zero**, **Grok** (ACP) | the ACP `available_commands_update` notification (captured, previously dropped) | native — via `session/prompt` |
| **Codex** | scan `~/.codex/prompts/*.md` | bridge expands the template (`expandCommand`) — the app-server has no slash/compaction RPC |
| **OpenCode** | scan `.opencode/command(s)/*.md` (+ `~/.config/opencode/command`) | bridge expands |
| **pi**, **Antigravity** | — (no documented command surface) | — |

Custom prompt-template scanning + expansion is shared in
`src/adapters/command-scan.ts` (dependency-free markdown-front-matter + minimal
TOML parsers; argument substitution only — `@file`/`` !`shell` `` placeholders
are passed through literally). The five command-capable adapters set
`capabilities.commands = true`; `cwd` on `agent/commands`/`listCommands` scopes
discovery to a project's own custom commands.

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
2. **The directory is removed when the turn ends**, and the persisted history
   shows `[N image attachments]` — no temp path leaks into the conversation.

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

## Claude Code models: latest aliases + pinned versions

Claude Code has **no enumerate command** — `--model` accepts either a stable
alias (`fable`/`opus`/`sonnet`/`haiku`) or a full id (e.g. `claude-opus-5`). The
bridge exposes both, so users get plug-and-play "latest" *and* explicit version
control:

- **Aliases (always present):** `fable`/`opus`/`sonnet`/`haiku` are shown as
  `Fable (latest)` / `Opus (latest)` / `Sonnet (latest)` / `Haiku (latest)`. They
  auto-track the newest model of that tier the account can use — nothing to
  maintain. After a turn runs, the concrete version the alias resolved to (e.g.
  `claude-opus-5`) is reported via the `model_resolved` event and shown in the
  phone's session status sheet.
- **Pinned concrete versions (built-in baseline + your extras):** the bridge
  ships a curated list of concrete versions in code (`DEFAULT_DAEMON_CONFIG`) and
  **unions** it with anything you add in `agents.claude-code.models`, deduped by
  id. So the built-in list stays current with the app automatically (a new
  version adds models to every install — see the "live baseline" note below),
  and your entries extend it: a new id is appended, and an entry whose id matches
  a built-in one overrides its `displayName`. An entry may be a bare id string or
  `{ id, displayName?, description? }`. Ids equal to an alias are dropped (the
  alias is the canonical "latest" entry).

```jsonc
// ~/.uxnan/daemon-config.json
{
  "agents": {
    "claude-code": {
      "model": "opus",                 // default: the latest Opus alias
      "models": [                       // extra concrete versions in the picker
        { "id": "claude-fable-5",   "displayName": "Fable 5" },
        { "id": "claude-opus-5",    "displayName": "Opus 5" },
        { "id": "claude-opus-4-8",  "displayName": "Opus 4.8" },
        { "id": "claude-opus-4-7",  "displayName": "Opus 4.7" },
        { "id": "claude-opus-4-6",  "displayName": "Opus 4.6" },
        { "id": "claude-opus-4-5",  "displayName": "Opus 4.5" },
        { "id": "claude-sonnet-5",  "displayName": "Sonnet 5" },
        { "id": "claude-sonnet-4-6","displayName": "Sonnet 4.6" },
        { "id": "claude-sonnet-4-5","displayName": "Sonnet 4.5" },
        { "id": "claude-haiku-4-5", "displayName": "Haiku 4.5" },
        "claude-opus-4-1"               // bare id — displayName falls back to the id
      ]
    }
  }
}
```

**Live baseline (why you never have to edit this file to get new models):** the
built-in list is a *code* default (`DEFAULT_DAEMON_CONFIG`), unioned in at load
time — it is **not** frozen into `~/.uxnan/daemon-config.json`. `initConfig`
persists the seed *without* the `agents` block, and `resolveDaemonConfig` unions
the code seed with whatever is on disk. So when a new app version adds a model to
the seed, every existing install picks it up automatically; your own `models`
entries are preserved on top. (Because the two are unioned, an empty
`"models": []` no longer clears the list — the baseline always stays.) The
aliases cover "latest" regardless, so pinning is purely for explicit/older-version
selection. Use only ids Claude Code accepts (`claude --model <id>` validates
them). The same `models` field works for any agent the adapter honors it for;
today that's Claude Code (OpenCode and Codex enumerate their own models).

### Maintaining the built-in list — it has a twin in the desktop app

Claude Code cannot enumerate its models, so the concrete versions are hand-kept
in **two** places. **Both must be updated whenever Anthropic ships or retires a
model** — updating only one silently leaves that surface a version behind:

| List | Where | Feeds |
|---|---|---|
| Bridge seed | `bridge/src/daemon-config.ts` → `DEFAULT_DAEMON_CONFIG.agents['claude-code'].models` | the phone's model picker (`agent/models`) |
| Desktop table | `uxnandesktop/src-tauri/src/agentcli.rs` → `CLAUDE_MODELS` | the desktop's AI commit-message / PR-body drafting picker |

Keep the **same ids, labels and order** in both (newest/most capable first). Use
canonical ids only: never append a date suffix or a routing variant (`…[1m]`,
`…-fast`) to a concrete id, and never put a bare alias in either list. Context
windows need no edit for a model in an existing tier — `claudeContextWindow()`
(`src/adapters/claude-adapter.ts`) maps by tier (`fable`/`opus`/`sonnet` → 1M,
`haiku` → 200K), which is what drives the phone's context-usage percentage.

## Adding a new agent

Follow the recipe in [`../FOR-DEV.md`](../FOR-DEV.md) (Agent adapters): capture the
real CLI's machine-readable stream once, then copy the closest template — a
**one-shot per-turn CLI** (`pi-adapter.ts`, which spawns the CLI
once per turn) or a **server the adapter talks to** (`codex-adapter.ts`/
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
