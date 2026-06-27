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

- **Available agents** lists the known catalog (Claude Code, Codex, Gemini CLI,
  OpenCode, …). The ADE detects which are **installed** on your `PATH`; click the
  **+** to add an installed one. **Add all installed** adds them in one click.
- **Add custom agent** registers anything else by hand (a command on your `PATH`,
  or an absolute path to a script — e.g. a [hook wrapper](./agent-hooks.md)).

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

## See also

- [Orchestration](./orchestration.md) — drive multiple running agents at once.
- [Agent hooks — precise states](./agent-hooks.md) — `working`/`waiting`/`done`
  indicators and tighter orchestration backpressure.
- Spec: [`architecture/02d-agent-monitoring.md`](../architecture/02d-agent-monitoring.md).
