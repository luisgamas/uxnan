# Bridge — how agents are driven

## Execution model (no provider API, no SDK, no keys)

For each agent, the bridge spawns that vendor's **official local CLI** as a child
process and talks to it over stdio — exactly as you would in a terminal. It does
**not**:

- call any provider HTTP API,
- store or use an API key,
- embed a language/Agent SDK,
- reuse/scrape the CLI's auth token, or proxy/resell access.

Each CLI runs under whatever account/subscription **you** already authenticated it
with (`claude` login, `codex login`, OpenCode login). The bridge stores no tokens;
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
| **Claude Code** | `claude -p --output-format stream-json --verbose --include-partial-messages` | `--resume <session_id>` | `permissionMode` → `--permission-mode acceptEdits` / none / `--dangerously-skip-permissions` | `opus`/`sonnet`/`haiku` aliases |
| **Codex** | `codex exec --json --skip-git-repo-check` | `exec resume <thread_id>` | `permissionMode` → `-s workspace-write` / `-s read-only` / `--dangerously-bypass-approvals-and-sandbox` | none (set `agents.codex.model`) |

Each runs in the thread's `cwd`. Codex's `app-server`/`exec-server`/`mcp-server`
modes are **not** used — the one-shot `codex exec` entry point is what the bridge
drives. Binary resolution (`resolve-*.ts`) prefers a directly-spawnable executable
(native binary or `node <cli.js>`) so `shell:false` always holds.

Per-thread selection: `thread/start { agentId, model, cwd }`; `agent/list` reports
availability/capabilities; `agent/models` lists models; `thread/setModel` repoints
a thread's model mid-conversation.

## Adding a new agent (e.g. Gemini)

Follow the recipe in [`../FOR-DEV.md`](../FOR-DEV.md) (Agent adapters): capture the
real CLI's machine-readable stream once, copy `claude-adapter.ts`/`opencode-adapter.ts`,
adjust the args builder + line parser, register it in `startBridge`, and test it
like the existing adapters. Validate per [`testing.md`](./testing.md).
