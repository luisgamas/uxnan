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
is closed (the one-shot CLIs hang on an open stdin pipe). **Claude Code is the
exception among the one-shot agents**: it is run with `--input-format
stream-json`, so its prompt is written to a real stdin pipe that stays open for
the length of the turn — which is what lets a follow-up reach it mid-run (see
below). The server-based adapters are the other exception: **Codex** speaks
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

## Wired agents

| Agent | CLI invocation | Continuity | Permission posture | Models |
|---|---|---|---|---|
| **OpenCode** (default) | `opencode serve` (local HTTP + SSE) | persisted server session id | `accessMode` → per-session permission ruleset: `ask` on `edit`/`bash`/`webfetch`/`external_directory` (real `permission.asked` approvals) / `allow` for approveForMe·fullAccess | `opencode models` (real list) |
| **Claude Code** | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` (prompt on stdin) | `--resume <session_id>` | `permissionMode` → `--permission-mode acceptEdits` / none / `--dangerously-skip-permissions` | `fable`/`opus`/`sonnet`/`haiku` aliases (latest) **+ `agents.claude-code.models`** |
| **Codex** | long-lived `codex app-server` (JSON-RPC over stdio) | persisted app-server thread id via `thread/start` | `accessMode` → app-server `approvalPolicy` + `sandbox` on `thread/start`; approval requests route to the phone | `model/list` (account-aware) → `~/.codex/config.toml` fallback |
| **pi** | `pi -p --mode json` | `--session-id <id>` | `permissionMode` → built-in read/bash/edit/write / `--tools read,grep,find,ls` / `--approve` | `pi --list-models` (real list; reasoning knob per model) |
| ~~Gemini CLI~~ (deprecated legacy) | retained adapter only; new turns rejected | legacy history only | unavailable (`deprecated:true`) | none exposed |
| **Antigravity** | `agy --conversation <uuid> --add-dir <cwd> (--dangerously-skip-permissions \| --mode plan) -p <text>` | client-owned `--conversation <uuid>` (create + resume) | `accessMode` → `--dangerously-skip-permissions` (approveForMe·fullAccess) / `--mode plan` (requestApproval → read-only, since headless can't prompt) | `agy models` (real list; the Gemini family + hosted others) |
| **Zero** | `zero acp` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | `accessMode` → ACP session mode: `ask` (real `session/request_permission` approvals) / `auto` for approveForMe·fullAccess | `zero models list` (real list; `contextWindow` from `ctx=`) |
| **Grok** | `grok agent stdio` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | `accessMode` → ACP `session/request_permission` answered per posture: interactive (asks the phone) / auto for approveForMe·fullAccess | `initialize` `_meta.modelState` (context window + reasoning-effort knob per model) |

Seven agents are active; the eighth registered adapter (Gemini) is non-runnable
legacy. No further agent is planned right now (the recipe for
wiring a new one is in [`../FOR-DEV.md`](../FOR-DEV.md)).

> **Gemini CLI is deprecated — don't spend work on it.** It is discontinued
> upstream; its successor is **Antigravity** (`agy`), wired above as a real agent
> that enumerates its own models. The phone removes every Gemini product surface,
> and its curated `GEMINI_MODELS` table (`src/adapters/gemini-adapter.ts`) is
> **frozen**: don't add models, don't track upstream changes, don't build new
> features against the adapter. What remains is reference/history code only:
> `agent/list` marks it unavailable/deprecated and `AgentManager` rejects new
> turns. It will be removed from the project in a later pass.

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

Bridge-created turns keep their public UUID and richer ordered segments, queue
state and usage. A deterministic native-history id is stored only as a private
link, preventing the same turn from being imported twice. Native-only turns are
refreshed on later reads, but absent native rows never delete bridge history.
This is completed-turn convergence: external token deltas are not streamed.

Each agent runs in the thread's `cwd`. Codex turns and model discovery both use
the long-lived `codex app-server` (`thread/start` / `turn/start` and
`initialize` → `model/list`). Binary resolution
(`resolve-*.ts`) prefers a directly-spawnable executable (native binary or
`node <cli.js>`) so `shell:false` always holds.

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
once per turn) or a **long-lived server** (`codex-adapter.ts`/`zero-adapter.ts`/
`grok-adapter.ts` over stdio JSON-RPC, `opencode-adapter.ts` over `opencode serve`
HTTP/SSE, when the CLI exposes a pre-tool approval channel). Adjust the args/request builder + event parser, register it in
`startBridge`, then wire it into `agent/models` (discovery), the `*-tools.ts` block
mapper (structured content), `SessionHistoryReader` (native-session `turn/list`
convergence),
and approvals if the CLI exposes a pre-tool channel. Test it like the existing
adapters and validate per [`testing.md`](./testing.md).
