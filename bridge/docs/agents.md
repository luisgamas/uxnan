# Bridge — how agents are driven

![Agents](https://img.shields.io/badge/wired_agents-5-2ea44f?style=for-the-badge)
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
CLI (`claude -p`, `codex exec`, `opencode run`) — so it does not require a separate
paid account beyond what that CLI already has, and it is not an unofficial API
wrapper. Rate limits are whatever your plan allows.

Prompts are passed as argv elements with `shell:false` (no shell injection); stdin
is closed (these CLIs hang on an open stdin pipe).

## Wired agents

| Agent | CLI invocation | Continuity | Permission posture | Models |
|---|---|---|---|---|
| **OpenCode** (default) | `opencode run --format json` | `--session <id>` | n/a | `opencode models` (real list) |
| **Claude Code** | `claude -p --output-format stream-json --verbose --include-partial-messages` | `--resume <session_id>` | `permissionMode` → `--permission-mode acceptEdits` / none / `--dangerously-skip-permissions` | `opus`/`sonnet`/`haiku` aliases (latest) **+ `agents.claude-code.models`** |
| **Codex** | `codex exec --json --skip-git-repo-check` | `exec resume <thread_id>` | `permissionMode` → `-s workspace-write` / `-s read-only` / `--dangerously-bypass-approvals-and-sandbox` (+ `interactive` via `codex app-server`) | `codex app-server` → `model/list` (account-aware) → `~/.codex/config.toml` fallback |
| **pi** | `pi -p --mode json` | `--session-id <id>` | `permissionMode` → built-in read/bash/edit/write / `--tools read,grep,find,ls` / `--approve` | `pi --list-models` (real list; reasoning knob per model) |
| **Gemini CLI** | `gemini -p --output-format stream-json --approval-mode <mode> --skip-trust` | `--resume <uuid>` | `permissionMode` → `--approval-mode auto_edit` / `plan` / `yolo` (+ `interactive` via a `BeforeTool` hook) | curated set (the `auto` alias + the CLI's `VALID_GEMINI_MODELS`) |

All five agents are wired; **Aider** is the only remaining planned adapter
(recipe in [`../FOR-DEV.md`](../FOR-DEV.md)).

Each runs in the thread's `cwd`. Codex's `exec-server`/`mcp-server` modes are
**not** used for turns — the one-shot `codex exec` entry point drives them — but
the bridge does spawn `codex app-server` once to enumerate models (`initialize`
→ `model/list`, the same source the desktop app uses). Binary resolution
(`resolve-*.ts`) prefers a directly-spawnable executable (native binary or
`node <cli.js>`) so `shell:false` always holds.

Per-thread selection: `thread/start { agentId, model, cwd }`; `agent/list` reports
availability/capabilities; `agent/models` lists models (`AgentModel[]` with
`id`/`displayName`/`description?`/`version?`/`isDefault?`/`options?`/`contextWindow?`);
`thread/setModel` repoints a thread's model mid-conversation. The id the phone
sends back is passed verbatim to the CLI's `--model`/`-m` flag. Per-model
**run-option knobs** (reasoning effort) are advertised in `AgentModel.options` and
the phone renders them generically — Codex discovers them from the app-server
`model/list` (`supportedReasoningEfforts`), Claude/pi from their own flag sets.

**Interactive approvals** are wired for Echo, Claude Code (`PreToolUse` hook),
Codex (`app-server` elicitations) and Gemini (`BeforeTool` hook); OpenCode/pi have
no headless pre-tool channel yet (see [`../FOR-DEV.md`](../FOR-DEV.md)).

## Claude Code models: latest aliases + pinned versions

Claude Code has **no enumerate command** — `--model` accepts either a stable
alias (`opus`/`sonnet`/`haiku`) or a full id (e.g. `claude-opus-4-8`). The bridge
exposes both, so users get plug-and-play "latest" *and* explicit version control:

- **Aliases (always present):** `opus`/`sonnet`/`haiku` are shown as
  `Opus (latest)` / `Sonnet (latest)` / `Haiku (latest)`. They auto-track the
  newest model of that tier the account can use — nothing to maintain. After a
  turn runs, the concrete version the alias resolved to (e.g. `claude-opus-4-8`)
  is reported via the `model_resolved` event and shown in the phone's session
  status sheet.
- **Pinned concrete versions (declared in config):** add exact, versioned ids in
  `agents.claude-code.models` to make them selectable alongside the aliases —
  e.g. to use an older-but-still-available model. They show their exact id in the
  picker. An entry may be a bare id string or `{ id, displayName?, description? }`.
  Ids equal to an alias are dropped (the alias is the canonical "latest" entry).

```jsonc
// ~/.uxnan/daemon-config.json
{
  "agents": {
    "claude-code": {
      "model": "opus",                 // default: the latest Opus alias
      "models": [                       // extra concrete versions in the picker
        { "id": "claude-fable-5",   "displayName": "Fable 5" },
        { "id": "claude-opus-4-8",  "displayName": "Opus 4.8" },
        { "id": "claude-opus-4-7",  "displayName": "Opus 4.7" },
        { "id": "claude-sonnet-4-6","displayName": "Sonnet 4.6" },
        { "id": "claude-haiku-4-5", "displayName": "Haiku 4.5" },
        "claude-opus-4-1"               // bare id — displayName falls back to the id
      ]
    }
  }
}
```

The bridge ships this list as the **default** (see `DEFAULT_DAEMON_CONFIG`), so a
fresh install already shows those versions. Curate it as models are released or
retired — the aliases cover "latest" regardless, so pinning is purely for
explicit/older-version selection. Use only ids Claude Code accepts (the alias
resolves to one such id; `claude --model <id>` validates them). The same
`models` field works for any agent the adapter honors it for; today that's
Claude Code (OpenCode and Codex enumerate their own models).

## Adding a new agent (e.g. Aider)

Follow the recipe in [`../FOR-DEV.md`](../FOR-DEV.md) (Agent adapters): capture the
real CLI's machine-readable stream once, copy `claude-adapter.ts`/`opencode-adapter.ts`,
adjust the args builder + line parser, register it in `startBridge`, then wire it
into `agent/models` (discovery), the `*-tools.ts` block mapper (structured content),
`SessionHistoryReader` (on-disk `turn/list` fallback), and approvals if the CLI
exposes a pre-tool channel. Test it like the existing adapters and validate per
[`testing.md`](./testing.md).
