# Bridge — how agents are driven

![Agents](https://img.shields.io/badge/wired_agents-8-2ea44f?style=for-the-badge)
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

Each CLI runs under whatever account/subscription **you** already authenticated it
with (`claude`, `codex login`, OpenCode, `pi`, `gemini`). The bridge stores no tokens;
auth and billing are the CLI's own. This is the supported *headless* use of each
CLI (`claude -p`, `codex app-server`, `opencode serve`) — so it does not require a
separate paid account beyond what that CLI already has, and it is not an unofficial
API wrapper. Rate limits are whatever your plan allows.

Prompts are passed as argv elements with `shell:false` (no shell injection); stdin
is closed (the one-shot CLIs hang on an open stdin pipe). The server-based
adapters are the exception: **Codex** speaks JSON-RPC over a long-lived
`codex app-server` stdio, **Zero** and **Grok** speak JSON-RPC (the Agent Client
Protocol, NDJSON) over a long-lived `zero acp` / `grok agent stdio` process, and
**OpenCode** speaks HTTP + SSE to a long-lived `opencode serve` process (their
prompts travel in the request body / session request, never argv).

### One turn per thread, and the queue that follows from it

The bridge drives **one turn per thread**, and this is a hard constraint, not a
policy: half the agents below are spawned fresh for every turn and resume their
own session (`claude -p --resume`, gemini, pi, antigravity), so two concurrent
turns would be two CLI processes writing to the same session file.

So a `turn/send` that arrives while a turn is in flight is **queued** rather than
started — the same thing the CLIs themselves do when you type a follow-up while
they work. It runs on its own once the current turn completes, through the
identical code path a normal turn takes, which means **queueing behaves the same
for all eight agents** regardless of how their CLI is driven.

What the queue deliberately does *not* do is **steer** — inject a message into
the turn already running, the way Claude Code's TUI does between tool calls. The
one-shot agents have no input channel at all while they run (stdin is closed), so
steering could only ever work for the server-backed ones (Codex, OpenCode, Zero,
Grok). Making it a per-agent capability is a follow-up, tracked in
[`../FOR-DEV.md`](../FOR-DEV.md).

Behaviour details (cap, pausing after a stop, cancelling a queued turn) are in
[`../../architecture/02b-contracts-and-requirements.md`](../../architecture/02b-contracts-and-requirements.md)
§1.2.

## Wired agents

| Agent | CLI invocation | Continuity | Permission posture | Models |
|---|---|---|---|---|
| **OpenCode** (default) | `opencode serve` (local HTTP + SSE) | persisted server session id | `accessMode` → per-session permission ruleset: `ask` on `edit`/`bash`/`webfetch`/`external_directory` (real `permission.asked` approvals) / `allow` for approveForMe·fullAccess | `opencode models` (real list) |
| **Claude Code** | `claude -p --output-format stream-json --verbose --include-partial-messages` | `--resume <session_id>` | `permissionMode` → `--permission-mode acceptEdits` / none / `--dangerously-skip-permissions` | `fable`/`opus`/`sonnet`/`haiku` aliases (latest) **+ `agents.claude-code.models`** |
| **Codex** | `codex exec --json --skip-git-repo-check` | `exec resume <thread_id>` | `permissionMode` → `-s workspace-write` / `-s read-only` / `--dangerously-bypass-approvals-and-sandbox` (+ `interactive` via `codex app-server`) | `codex app-server` → `model/list` (account-aware) → `~/.codex/config.toml` fallback |
| **pi** | `pi -p --mode json` | `--session-id <id>` | `permissionMode` → built-in read/bash/edit/write / `--tools read,grep,find,ls` / `--approve` | `pi --list-models` (real list; reasoning knob per model) |
| **Gemini CLI** | `gemini -p --output-format stream-json --approval-mode <mode> --skip-trust` | `--resume <uuid>` | `permissionMode` → `--approval-mode auto_edit` / `plan` / `yolo` (+ `interactive` via a `BeforeTool` hook) | curated set (the `auto` alias + the CLI's `VALID_GEMINI_MODELS`) |
| **Antigravity** | `agy --conversation <uuid> --add-dir <cwd> (--dangerously-skip-permissions \| --mode plan) -p <text>` | client-owned `--conversation <uuid>` (create + resume) | `accessMode` → `--dangerously-skip-permissions` (approveForMe·fullAccess) / `--mode plan` (requestApproval → read-only, since headless can't prompt) | `agy models` (real list; the Gemini family + hosted others) |
| **Zero** | `zero acp` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | `accessMode` → ACP session mode: `ask` (real `session/request_permission` approvals) / `auto` for approveForMe·fullAccess | `zero models list` (real list; `contextWindow` from `ctx=`) |
| **Grok** | `grok agent stdio` (ACP JSON-RPC over stdio) | persisted ACP session id (`session/load`) | `accessMode` → ACP `session/request_permission` answered per posture: interactive (asks the phone) / auto for approveForMe·fullAccess | `initialize` `_meta.modelState` (context window + reasoning-effort knob per model) |

All eight agents are wired; no further agent is planned right now (the recipe for
wiring a new one is in [`../FOR-DEV.md`](../FOR-DEV.md)).

> **Gemini CLI is deprecated — don't spend work on it.** It is discontinued
> upstream; its successor is **Antigravity** (`agy`), wired above as a real agent
> that enumerates its own models. The phone already hides Gemini from the picker,
> and its curated `GEMINI_MODELS` table (`src/adapters/gemini-adapter.ts`) is
> **frozen**: don't add models, don't track upstream changes, don't build new
> features against the adapter. What remains keeps an existing configuration
> working, nothing more. It will be removed from the project in a later pass —
> until then treat every Gemini path as read-only legacy.

Each runs in the thread's `cwd`. Codex's `exec-server`/`mcp-server` modes are
**not** used for turns — the one-shot `codex exec` entry point drives them — but
the bridge does spawn `codex app-server` once to enumerate models (`initialize`
→ `model/list`, the same source the desktop app uses). Binary resolution
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

Claude Code is the only one that does this today. **Codex**, driven the same way
and timed, emits nothing after `turn.completed` and exits ~0.7 s later, and work
it was asked to leave running did not survive that exit. **Pi** and **Zero**
cannot either: neither exposes a background-task tool or any wake-up path, and
both deliberately kill a backgrounded child rather than let it outlive the
command. (OpenCode and Grok have not been probed this way yet.)

That does not make the guards Claude-specific, for two reasons: the hazard is
structural for every adapter in the first table row, and an agent on *any* of
them can still **say** it will report back — a promise that, without a wake-up
path, is false from the first second. Reporting honestly is the fix there;
there is no deferred state to model.

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
Gemini (`BeforeTool` hook), Zero and Grok (ACP `session/request_permission`);
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
| **Gemini** | scan `.gemini/commands/*.toml` (+ `~/.gemini/commands`) | bridge expands (`--prompt` mode does not) |
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
| **Gemini CLI** | ✅ | supported, but the agent is hidden from the phone's picker (superseded by Antigravity) |

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
**one-shot per-turn CLI** (`gemini-adapter.ts`/`pi-adapter.ts`, which spawn the CLI
once per turn) or a **long-lived server** (`codex-adapter.ts`/`zero-adapter.ts`/
`grok-adapter.ts` over stdio JSON-RPC, `opencode-adapter.ts` over `opencode serve`
HTTP/SSE, when the CLI exposes a pre-tool approval channel). Adjust the args/request builder + event parser, register it in
`startBridge`, then wire it into `agent/models` (discovery), the `*-tools.ts` block
mapper (structured content), `SessionHistoryReader` (on-disk `turn/list` fallback),
and approvals if the CLI exposes a pre-tool channel. Test it like the existing
adapters and validate per [`testing.md`](./testing.md).
