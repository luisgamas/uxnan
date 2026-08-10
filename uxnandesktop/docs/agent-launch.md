# Agent launch & configuration

![Shell](https://img.shields.io/badge/default_launch_shell-cmd_on_Windows-0a0a0a?style=for-the-badge)
![Env](https://img.shields.io/badge/per--agent-env_vars-2ea44f?style=for-the-badge)
![Quoting](https://img.shields.io/badge/arguments-shell--aware_quoting-blue?style=for-the-badge)

How to register CLI coding agents in the ADE and tune **how** they launch:
per-agent **environment variables**, the **shell** they run in (Command Prompt by
default on Windows), **auto-launch** when you create a worktree, and the
**shell-aware quoting** that keeps arguments intact.

For getting **precise** working/done states out of an agent, see
[agent hooks](./agent-hooks.md). For driving several agents at once, see
[orchestration](./orchestration.md).

> **TL;DR.** **Settings → Agents**:
> - **Add** an installed agent from the catalog, or **Add custom agent**.
> - Per agent, set its **command**, **arguments**, **Launch in** (shell),
>   **Environment variables**, and **logo**.
> - **Default agent** auto-launches into new worktrees; **Agent launch shell**
>   picks the default shell agents run in (Command Prompt on Windows by default).

---

## Registering agents

In **Settings → Agents**:

- **Available agents** lists the known catalog (Claude Code, Codex, Antigravity,
  OpenCode, …). The ADE detects which are **installed** on your `PATH`; click the
  **+** to add an installed one. **Add all installed** adds them in one click.
  Detection re-runs each time you open the pane, and the **refresh** button in the
  agents header re-runs it on demand — so an agent installed (or uninstalled)
  while uxnan is open appears (or disappears) without restarting the app.
- **Add custom agent** registers anything else by hand (a command on your `PATH`,
  or an absolute path to a script — e.g. a [hook wrapper](./agent-hooks.md)).

Each agent's logo resolves in a chain: a custom image you set → a bundled SVG
(`static/agents/`) → the product's favicon → a generic glyph. The favicon step is
fetched by the **backend** and inlined as a `data:` URL, because the app's CSP
allows no remote image host — a URL rendered directly by the webview is simply
blocked (`src/lib/agentLogoCache.ts`). That step needs network the first time per
app run; a bundled SVG never does.

Only four marks ship as assets — Claude Code, Codex, OpenClaude and Zero. Every
other agent resolves through its `favicon` domain, which is what lets a CLI we
have never heard of still show a real logo the moment someone registers it, so
**a new catalog entry needs `favicon`, not an SVG**. A bundled mark drawn in a
single dark colour (Codex uses `currentColor`, which an `<img>` resolves to
black) sets `mono: true` in the catalog, and `AgentLogo` inverts it on dark
themes so it reads white there and stays dark on light ones — favicons and
custom logos are never inverted, because their colours are not ours to flip.

Each agent profile has:

| Field | What it does |
|---|---|
| **Name** | Display name (e.g. *Claude Code*). |
| **Command** | The executable to run (e.g. `claude`). |
| **Arguments** | Space-separated args (e.g. `--model opus`). Quoted automatically — see [quoting](#argument-quoting). |
| **Launch in** | The shell this agent runs in. *Default agent shell* = the global setting below; or pin a specific terminal profile. |
| **Environment variables** | Extra env set on the agent's shell — see [below](#per-agent-environment-variables). |
| **Logo** | Optional custom image; otherwise the catalog logo resolves from the command. |

Launch an agent from the **Bot menu** on any project or worktree header in the
left sidebar, or have one launch automatically (see
[auto-launch](#auto-launch-on-worktree-create)).

---

## Per-agent environment variables

Each agent can carry its own environment variables, set on the shell it launches
in (and therefore inherited by the agent process). Use them for model overrides,
proxies, API hosts, feature flags — anything the agent reads from the environment.

**Set them:** Settings → Agents → expand an agent → **Environment variables** →
**＋ Add variable**, then fill the `NAME` and `value` boxes. Remove a row with the
**✕**.

Examples:

| `NAME` | `value` | Effect |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | Pin the model an agent uses. |
| `HTTPS_PROXY` | `http://127.0.0.1:8080` | Route the agent through a proxy. |
| `NO_COLOR` | `1` | Disable ANSI color in the agent's output. |

Notes:

- Variables apply **at launch** — relaunch the agent after changing them.
- They're scoped to **that agent's** terminals, not your other terminals.
- The ADE's own hook variables (`UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN` /
  `UXNAN_AGENT_ID`) always **win** over a variable you set with the same name, so
  you can't accidentally break [hooks](./agent-hooks.md).
- Blank names are ignored.

---

## Agent launch shell

Agents run **inside an interactive shell** (so `PATH`/`PATHEXT` shims like
`claude.cmd` / `codex.ps1` resolve). You control which shell:

- **Per agent** — the agent's **Launch in** field. *Default agent shell* uses the
  global setting; or pick a specific terminal profile.
- **Globally** — **Settings → Agents → Agent launch shell** sets the default for
  every agent that doesn't pin its own.

The global default is **Smart default**, which means:

- **Windows → Command Prompt (`cmd.exe`).** Agent CLIs start faster and quote more
  predictably under cmd than under PowerShell (whose default execution policy and
  quoting rules trip up some npm-installed shims). This is the recommended
  default.
- **macOS / Linux → your default terminal profile** (your login shell).

Prefer PowerShell, Git Bash, WSL, or a specific profile? Pick it in **Agent launch
shell** — or pin it on individual agents via **Launch in**. (Manage the available
shells in **Settings → Terminal → Profiles**.)

> This only affects **agent** launches. Plain terminals you open yourself still
> use **Settings → Terminal → Default profile**.

---

## Auto-launch on worktree create

You don't have to launch an agent by hand for every new branch:

- **Settings → Agents → Default agent** picks an agent to **auto-launch whenever
  you create a worktree**. Leave it on **None** to never start one automatically.
- The **New worktree** dialog pre-selects that default but lets you **override it
  per worktree** — choose a different agent, or **None** for that one worktree.
- The project card's **"+" launcher** takes a different route: when its target is
  **New worktree**, the **"What to open" selection is the only source of truth** —
  the default agent is deliberately *not* auto-launched, so you get exactly the
  terminals / profiles / agents (one or several) you ticked, and nothing if you
  ticked nothing.

When the worktree is created, the chosen agent starts in its own terminal in that
worktree, using the launch shell and env vars from its profile.

---

## Argument quoting

You don't need to quote agent arguments yourself. The ADE builds the launch
command line and **quotes each argument for the shell it lands in** — PowerShell,
Command Prompt, or POSIX — so arguments with **spaces or special characters**
survive intact. For example an argument `fix the bug` is sent as `'fix the bug'`
in a POSIX shell and `"fix the bug"` under cmd. Just type the raw values in the
**Arguments** field (space-separated); the ADE handles the escaping.

---

## Sessions named at launch

For the CLIs that accept a caller-chosen session id, the ADE picks one and adds
it to the command line it launches — `claude --session-id <uuid>`,
`grok --session-id <uuid>`, `pi --session-id <id>`,
`agy --conversation <uuid>` — and stamps it on the terminal tab straight away.
That is what lets the tab come back after a restart **even if you never wrote a
message**: session capture through hooks only learns an id once the agent has
done something. Codex and OpenCode expose no such flag and stay hook-captured.

Your own arguments always win: if they already choose a session (`--resume`,
`--continue`, `--session`, `--session-id`, `--fork`, `--conversation`, …) the
command line is left exactly as you configured it. Turn the behavior off in
**Settings → Agents → Name agent sessions at launch** (on by default) — the only
cost of leaving it on is one extra flag in the launched command.

How a named session is reopened — and how one is captured for the CLIs that
can't be told an id — is in [`agent-hooks.md`](agent-hooks.md#reference).

---

## Curated model lists (Claude)

Most agent CLIs enumerate their own models and the ADE asks them directly
(`opencode models`, `agy models`, `grok models`, `pi --list-models`,
`codex app-server` `model/list`). **Claude Code cannot**, so the ADE ships a
hand-kept table — `CLAUDE_MODELS` in
[`src-tauri/src/agentcli.rs`](../src-tauri/src/agentcli.rs) — that fills the model
pickers in **Settings → AI commit** and **Settings → GitHub → AI PR body**.

**That table has a twin in the bridge, and both are maintained by hand.** When
Anthropic ships or retires a model, update **both** sides in the same change set —
updating one leaves the other surface a version behind:

| Model list | Where | Feeds |
|---|---|---|
| Desktop Claude | `uxnandesktop/src-tauri/src/agentcli.rs` → `CLAUDE_MODELS` | the ADE's AI commit-message / PR-body pickers |
| Bridge Claude | `bridge/src/daemon-config.ts` → `DEFAULT_DAEMON_CONFIG.agents['claude-code'].models` | the mobile app's model picker (`agent/models`) |

Keep the **same ids, labels and order** across a pair, newest/most capable first.
Use canonical ids only: never append a date suffix or a routing variant (`…[1m]`,
`…-fast`) to a concrete id, and never put a bare `fable`/`opus`/`sonnet`/`haiku`
alias in a desktop table — it pins an exact version so a generated commit message
stays reproducible. The bridge documents the same rule from its side in
[`bridge/docs/agents.md`](../../bridge/docs/agents.md).

---

## Conversation names

A session's card and tab show a generated name instead of the first words the
user typed, so two sessions opened with a similar phrase stay distinguishable.
It runs in `src-tauri/src/convtitle.rs` through the same one-shot headless runner
as the AI commit message — no provider API and no keys, just the agent's own CLI
under the account it is already authenticated with.

**The input is the session's terminal transcript**, not the prompt. That is a
deliberate correction: measured against a real run of all seven agents, only
`claude` reports a prompt or a reply through the hook (`codex`, `opencode` and
`pi` send empty strings), so a prompt-shaped input named two agents and silently
skipped the rest. The transcript is the one material every agent has. It is
clipped to its **tail**, because a terminal opens with a banner and the
conversation is at the bottom — clipping from the front would hand the model the
boilerplate and cut off the task.

Two agents need care beyond that:

- **Antigravity reports as `antigravity` but its CLI is `agy`.** The hook kind
  and the runnable id are different vocabularies; mapping between them is what
  makes its naming work at all.
- **Zero emits no hook**, so it is named from its own poll instead. Its
  `"ACP session"` label is a placeholder Zero writes itself, not a misread.

Naming happens **once per session** and is best-effort: a missing CLI, no credit
or a timeout leaves the existing label alone and is not retried, because a retry
loop would spend real quota on a cosmetic feature. A hand-renamed tab always
wins.

Each agent names on the cheapest model we can name for it (`title_model`);
anything else runs on its CLI default rather than guessing an id the CLI would
reject. Verify a new id against the account's real `model/list` — a wrong one is
not a cosmetic mistake, the run fails and the session silently keeps its label.

**On the wait.** Measured on Windows: CLI startup is ~140 ms, the floor for any
model round-trip is ~3.3 s, and a full transcript names in ~7.5–9 s. Shrinking
the transcript does *not* speed it up (1800 / 900 / 500 chars all land in the
same range) and makes the title worse — at 500 chars it lost the subject
entirely. The time is the model's, so the input stays at the size that names
best.

---

## See also

- [Orchestration](./orchestration.md) — drive multiple running agents at once.
- [Agent hooks — precise states](./agent-hooks.md) — `working`/`waiting`/`done`
  indicators and tighter orchestration backpressure.
- Spec: [`architecture/02d-agent-monitoring.md`](../architecture/02d-agent-monitoring.md).
