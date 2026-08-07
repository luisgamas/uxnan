# Agent hooks — precise agent states

![States](https://img.shields.io/badge/states-working_%7C_blocked_%7C_waiting_%7C_done-2ea44f?style=for-the-badge)
![Server](https://img.shields.io/badge/hook_server-127.0.0.1_(loopback)-0a0a0a?style=for-the-badge)
![Agents](https://img.shields.io/badge/precise-20_agents-D97757?style=for-the-badge)
![Others](https://img.shields.io/badge/other_agents-generic_wrapper-blue?style=for-the-badge)

The ADE infers a coarse **working / idle** state from terminal output with no
setup. To get **precise** states — `working`, `blocked`, `waiting`, `done` — an
agent must actively report them to the ADE's local **hook server** (Layer 1 of
the monitoring design, spec `architecture/02d-agent-monitoring.md` §1.1).

The ADE ships a managed reporter for **twenty** agents and installs them
**automatically on startup** (you can turn that off any time):

| Agent | Where its reporter is installed |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Codex | `~/.codex/hooks.json` (+ the trust hash in `config.toml`) |
| OpenCode | its `plugins/` dir |
| Pi / OMP | `~/.pi/agent/extensions/` |
| Grok | `~/.grok/hooks/uxnan-status.json` |
| Antigravity | `~/.gemini/config/hooks.json` |
| OpenClaude | `~/.openclaude/settings.json` |
| Qwen Code | `~/.qwen/settings.json` |
| Droid (Factory) | `~/.factory/settings.json` |
| Devin | `%APPDATA%\devin\config.json` · `~/.config/devin/config.json` |
| Command Code | `~/.commandcode/settings.json` |
| Auggie | `~/.augment/settings.json` |
| Cursor | `~/.cursor/hooks.json` |
| GitHub Copilot | `~/.copilot/hooks/uxnan-status.json` |
| Kiro | `~/.kiro/hooks/uxnan-status.json` |
| Kimi Code | `~/.kimi-code/config.toml` (a marked block) |
| Goose | `~/.agents/plugins/uxnan-status/hooks/hooks.json` |
| MiMo Code | its `plugins/` dir (`~/.config/mimocode/plugins/`) |
| Kilo Code | its `plugin/` dir (`~/.config/kilo/plugin/`) |
| Amp | its `plugins/` dir (`~/.config/amp/plugins/`) |

The **Gemini CLI** reporter is still wired but no longer installed or offered,
since Google discontinued that CLI in favour of Antigravity; if you already have
it installed, its card stays in the panel so you can turn it off. Each reporter
is picked to be robust across every shell you might launch the agent from (cmd,
PowerShell, PowerShell 7, Git Bash, WSL, bash, zsh, fish), because the agent's
*own* hook runner executes it. Any other agent is **opt-in**: point it at the
generic wrapper.

**Only the agents you actually have are wired at startup** — an executable on
`PATH`, or a config file already there. The ADE knows how to report for more CLIs
than any one machine runs, and creating another product's config folder unasked
is not its business. Installing one by hand from Settings is never gated: asking
for it is answer enough.

> **TL;DR.** Open **Settings → Agents → Hooks**:
> - The agents on your machine are listed first and are **already installed**
>   (auto on startup). The **Install agent hooks** switch turns them off (and
>   keeps them off next launch) or back on; each agent also has its own
>   Install/Uninstall and a **Show config** disclosure with the exact bytes the
>   ADE writes.
> - **Anything else** → use the **generic wrapper** as the agent's launch
>   command (full step-by-step per OS below).

**The rest of the catalog has no usable surface yet, and the ADE says so rather
than pretending.** An agent only earns a reporter when its CLI can tell us a turn
*ended* — without that the card could start a spinner it can never stop:

| Agent | Why not |
|---|---|
| Crush | Hooks exist but only `PreToolUse` ships so far — enough to say "working", never "done". |
| Cline | Its CLI hooks are documented as macOS/Linux only, and the registration format isn't published. |
| Rovo Dev | Has event hooks (`/hooks`, `~/.rovodev/config.yml`) but Atlassian documents no event list or payload shape. |
| Aider | The lifecycle hooks belong to AiderDesk (a separate GUI); the CLI has an open request for them. |
| Continue · Mistral Vibe · Codebuff · Autohand · Ante | No turn-lifecycle hook or plugin surface published. `codebuff.json` covers file-change and startup processes, not turns. |

Any of them still works in uxnan — they just fall back to the coarse
working/idle inference, or you can point them at the generic wrapper below.

---

## What are agent hooks and what do they get me?

Without hooks, the ADE shows a single green pulsing dot on agent terminals
(working / idle, inferred from output). With hooks, the ADE shows **four
distinct, precise states** plus a derived idle:

| State | Meaning | Color |
|---|---|---|
| `working` | Actively processing a task | Green, pulsing |
| `blocked` | Waiting on an external system (API, network) | Amber |
| `waiting` | Waiting for user input | Orange, pulsing |
| `done` | Finished (clean exit) | Blue |
| `idle` *(derived)* | Agent at rest, no precise report | Gray |
| `stale` *(any)* | No update in > 30 min | Same color, dimmed (`opacity-40`) |

> **Opening a session is not work.** Most of these CLIs fire a `SessionStart`
> when their TUI opens or resumes — before you have asked for anything. Reading
> it as `working` painted a green pulsing dot the instant the terminal opened,
> and since the next event only arrives when you finally type, **nothing could
> move it**: the tab claimed to be busy for as long as it went unused (measured
> on Codex, which emits exactly `SessionStart {"source":"startup"}` and then
> nothing). It is treated as a **boundary** instead: the tab's cached turn is
> dropped — a new session owns it, so the old prompt, tool, reply and sub-agents
> describe nothing — while the session identity the event carries is kept for
> resume, and the tab shows the neutral `idle` until the agent really works. A
> `SessionStart` fired *mid-turn* by a compaction is excluded by its `source`, so
> a live turn is never wiped.
>
> **`done` vs `waiting`.** A finished turn reads as **`done`** (the resting state) —
> even though the agent is technically idle at its prompt waiting for your next
> message. `waiting` is reserved for a genuine **mid-turn** prompt where the agent
> needs your answer to continue (a permission / question / elicitation). So Claude's
> post-turn idle notification maps to `done`, not `waiting` — the card shows "Done"
> + an unread badge, and only a real mid-turn prompt pins it in the **Needs you**
> lane. A stale `waiting`/`blocked` (no update in > 30 min, no closing event) decays
> to a neutral `idle` so nothing sits in **Needs you** forever.
>
> **Identity from the hook.** A hook report is self-declared (it carries the agent
> type), so an agent you start **by hand** in any ADE terminal shows its brand +
> precise state as soon as its first hook lands — even a wrapper / renamed /
> `node`-launched agent that process detection can't name. Process detection is only
> the fallback for agents that report no hook.
>
> **Sub-agents.** When an agent spawns children — **Claude Code's Task tool** or
> **OpenCode's `task`** (which runs as a child session) — they show as **nested
> rows** under the parent with a count badge (active / total), and the parent won't
> read "Done" while a child is still working. Children ride the same
> `SubagentStart` / `SubagentStop` lifecycle (OpenCode's plugin maps its child
> sessions to it), keyed by the child's id so a background child never flips the
> parent. Codex / Gemini / Pi have no sub-agent concept.

These states show up everywhere you track an agent:

- **Sidebar** — a colored dot next to each agent terminal, on the project /
  worktree header (and on the project header even when collapsed).
- **Terminal tab bar** — a colored dot on each tab. If the state is *not*
  coming from the hook server (you have no hook installed for that agent), a
  small **Webhook** icon appears next to the dot and clicking it takes you
  straight to **Settings → Hooks** so you can wire up the ready-made
  config.
- **Unread / done badges** — a worktree is flagged (red dot on the card +
  dock/taskbar count) when an agent finishes while you're not looking.
- **Native notifications** — fired only when an agent goes idle / done while
  the ADE is unfocused (or you're on a different terminal / workspace).

---

## What does the ADE provide out of the box?

On every startup the ADE writes its reporter scripts to `<app-data>/hooks/`. The
exact path is shown in **Settings → Agents → Hooks** ("Installed at …"):

| OS | `<app-data>` |
|---|---|
| Windows | `%APPDATA%\dev.luisgamas.uxnandesktop\hooks\` |
| macOS | `~/Library/Application Support/dev.luisgamas.uxnandesktop/hooks/` |
| Linux | `~/.local/share/dev.luisgamas.uxnandesktop/hooks/` |

Setting **`UXNAN_DATA_DIR`** to an absolute path moves `<app-data>` — and with it
everything below it — for that one process. It exists so a launch can be given a
disposable profile: the [resource benchmarks](resource-benchmarks.md) use it, and
an E2E driver will. A relative path is ignored, since it would resolve against
whatever the working directory happened to be.

The reporters (one per agent, plus the generic wrapper) — full table in
[`static/hooks/README.md`](../static/hooks/README.md):

| File | Agent(s) | What it's for |
|---|---|---|
| `uxnan-status-relay.cjs` | Claude Code, Gemini CLI | Node relay (both agents *are* Node, so `node` is guaranteed → works from any shell). Forwards the raw event; the server normalizes it. |
| `uxnan-codex-hook.{sh,cmd}` | Codex | `curl` hook (Codex is a Rust binary — no Node). Paired with a `trusted_hash` in `~/.codex/config.toml`. |
| `uxnan-event-hook.{sh,cmd}` | Grok, Antigravity + every declaratively-wired CLI | `curl` reporter with the agent kind as its argument, so one script serves every CLI whose hook runner executes a command and pipes it the raw event JSON. It answers `{}` on stdout, because several of these CLIs parse it and **Cursor gates tool use on it** — a reporter that printed nothing would block the agent's file reads and shell commands, not merely fail to report. On Windows its command is written with **backslashes**: a CLI that hands the command to `cmd.exe` splits a forward-slashed path at the first `/` (`…oaming is not recognized as an internal or external command` — measured against the real Cursor CLI). |
| `uxnan-opencode-status.js` | OpenCode | In-process plugin. |
| `uxnan-pi-status.js` | Pi / OMP | In-process extension. |
| `uxnan-hook-wrapper.{sh,ps1,cmd,fish}` | any CLI agent | Generic wrapper: `working` before exec, `done` on exit. |

The ADE also injects these environment variables into **every** terminal it
spawns (inherited by any agent run inside that terminal):

| Variable | Meaning |
|---|---|
| `UXNAN_HOOK_URL` | Full POST endpoint, e.g. `http://127.0.0.1:51234/hook` |
| `UXNAN_HOOK_TOKEN` | Shared secret for this ADE launch (sent as `X-Uxnan-Token`) |
| `UXNAN_AGENT_ID` | This terminal's id — echo it back as `agentId` |
| `UXNAN_ENDPOINT_FILE` | Path to `endpoint.env` / `endpoint.cmd` — a file the ADE rewrites every launch with the live url + token. It is the **rescue**, not the first choice: a reporter uses the terminal's own environment and falls back to this file only when that fails, which is what a terminal that outlived an app restart needs. |

You never need to set these by hand — the reporters pick them up from the
environment, and so does anything else you write against the contract.

> **WSL note (basic support).** The `UXNAN_*` vars are added to `WSLENV` so they
> cross into a WSL shell (with `/p` path-translation for the endpoint file).
> However, in **WSL2** `127.0.0.1` points at the WSL VM, not the Windows host, so
> a hook running *inside* WSL2 can't reach the host's hook server — a known
> limitation. WSL1 and native Windows/macOS/Linux shells work.

### More than one uxnan window

Every window runs its own hook server on its own port with its own token, and
each terminal is given its window's coordinates in its environment. That is what
makes a report land in the window that launched the agent.

The endpoint file cannot do that job: it lives at **one shared path**, so a
second window overwrites it with its own coordinates. Reporters used to prefer
it, which meant the moment you opened a second window every agent in the first
one started reporting to the second — its cards stopped moving, and a finished
turn never showed its check. Now the environment wins and the file is only tried
when the environment's server does not answer, so both windows work at once and
an agent that outlived a restart is still rescued.

One thing genuinely does not survive two windows: the **browser MCP** entry in
each CLI's config holds a URL, and a config file has no per-window environment to
read it from, so the last window to start owns it. A window whose entry was
overwritten simply gets no browser tools (the token is per-window, so a
cross-window call is refused rather than misrouted). Closing a window no longer
deletes the other's entry, so reopening it restores its own.

---

## Install — the built-in agents (automatic)

On every startup (unless you turned it off) the ADE installs the managed reporter
for each agent in the table above that this machine actually has.

**How a new agent gets wired.** Ten of them (Cursor, Copilot, Droid, Devin, Qwen
Code, Auggie, Kiro, Kimi, Command Code, OpenClaude) are pure data —
`agent_hooks.rs` → `TABLE_AGENTS` names the config file, the shape our entry
takes in it, and the events to register; the shared `uxnan-event-hook` reporter
does the rest. Adding one is a table row plus a `normalize_event` arm in
`hooks.rs` (their ids must match — a test enforces it, because a typo there
installs perfectly and then discards every report), plus its one-line
description in `en.ts`/`es.ts`. The six above it each needed machinery of their
own — a Node relay, a trust hash, an in-process plugin, a dot-relative command —
which is why they are still hand-written.

The per-agent notes below are what each CLI made us learn the hard way:

- **Grok** gets a file of its own, `~/.grok/hooks/uxnan-status.json`. Grok merges
  every `*.json` in that folder, so nothing of yours is ever read or rewritten,
  and global hooks need no folder-trust grant. Its event *set* is Claude Code's,
  so it reports the full range — including a genuine `blocked` from
  `StopFailure` (a turn that died on an API error), which only OpenCode could
  report before.

  **Its spelling is not Claude's, though, and the two directions differ.** Grok
  accepts the PascalCase keys uxnan writes into the config as aliases, but it
  *dispatches* in snake_case — its `HookEventName` carries
  `#[serde(rename_all = "snake_case")]` — so the payload that comes back says
  `stop`, not `Stop`. A normalizer that matched only PascalCase dropped every
  Grok report and left the card stuck on **working** forever, since nothing else
  could move it. Both spellings are accepted; if you add an event, add it to the
  snake_case path too.
- **What the card's second line can say depends on the agent.** While an agent
  works it shows the current tool; once the turn ends it shows the reply. That
  reply has to come from somewhere, and measured across a real run of every
  wired agent **only Claude fills the hook's `summary`** (15 of 34 reports;
  codex, opencode, pi, grok and antigravity report none). Antigravity and Grok are covered
  because they hand us a `transcriptPath` and the reader understands their
  record shapes (Antigravity's flat records; Grok's ACP chunks, which are
  reassembled per turn, excluding its `agent_thought_chunk` thinking). Everything else keeps showing its **status**, which is the honest
  fallback — and the one that scales, since any CLI can be driven here. To add
  an agent, give it a transcript root in `transcript_base_for` and teach the
  reader its records; never scrape the terminal, which renders a UI, not data.
- **Antigravity names no event in its payload.** Measured against the real CLI,
  its bodies carry `invocationNum` / `fullyIdle` / `terminationReason` and no
  event field, so a report had nothing to identify it and was dropped — the
  session never reached `done`, and so never got a generated name. Its
  registration is per event, so the event name is passed as the reporter's
  **second argument** (`uxnan-event-hook.cmd antigravity Stop`) and forwarded as
  `X-Uxnan-Event`, which the server prefers over anything derived from the body.
  If you add an Antigravity event, register it with its name in the command.
- **Antigravity** gets one named entry, `uxnan-status`, in
  `~/.gemini/config/hooks.json`; other named hooks in that file are untouched.
  It exposes only its execution loop (`PreInvocation`, `PostInvocation`,
  `PreToolUse`, `PostToolUse`, `Stop`) — there is no prompt, permission or
  notification event — so it reports **working** and **done** precisely and can
  never claim to be waiting on you. Its reporter is copied next to that config and
  invoked **dot-relative** (`.\uxnan-event-hook.cmd antigravity`), because
  Antigravity parses a hook command as a literal path and honours no quoting: a
  command holding an absolute path would break for anyone whose account name has
  a space in it. Grok has the same limitation, so on Windows its command falls
  back to the path's **8.3 short form** when needed; if the OS won't produce one,
  the panel says so instead of installing a hook that would never fire.

- **Per-event merge, user-preserving.** For every agent whose hooks live in a
  config file you also own (Claude, Codex, Gemini, OpenClaude, Qwen, Droid,
  Devin, Command Code, Auggie, Cursor), the reporter is merged event by event
  **without touching your existing hooks**. A managed entry is recognised by the
  reporter it references *and* the agent kind passed to it, so re-installing
  self-heals a moved path, Uninstall removes only ours, and two of our own
  reporters can share one config file without either uninstall taking the other
  down with it.
- **Cursor's schema puts the command on the definition** (Claude nests it under
  `hooks`), names its events in camelCase, and requires a `version`. Both shapes
  are swept on install, so a repeat never stacks a second entry.
- **A file of our own** is used where the CLI merges everything in a directory:
  Grok (`~/.grok/hooks/`), Copilot (`~/.copilot/hooks/`) and Kiro
  (`~/.kiro/hooks/`). Nothing of yours is read or rewritten, and uninstall is a
  single delete.
- **Kimi Code keeps its settings in TOML**, and the ADE vendors no TOML writer,
  so its reporter is a marker-delimited block appended to `~/.kimi-code/config.toml`.
  Everything outside those markers is left byte-for-byte alone; a hand-deleted
  end marker is still recovered on the next install rather than accumulating.
- **Codex trust.** Codex 0.129+ only runs a hook whose exact identity is trusted;
  the ADE also writes the reproduced `trusted_hash` into `~/.codex/config.toml`,
  so the hook actually fires (a raw `hooks.json` alone would sit un-run).
- **OpenCode / Pi** install a plugin / extension file into the agent's own
  plugin / extension directory (only overwriting a file the ADE itself manages).
- **Restart the agent afterward** so it re-reads its config (Claude picks up
  `settings.json` changes via a file watcher, but restarting is the sure path).

In **Settings → Agents → Hooks**, a master **Install agent hooks** switch installs
/ removes every agent and persists the choice (`AppSettings.autoInstallHooks`).
The pane lists the agents on this machine first and everything else after; each
one has its own **Install** / **Uninstall**, an honest status badge, the path its
reporter is written to, and a **Show config** disclosure rendering the exact
bytes the ADE writes (for OpenCode and Pi — whose reporter *is* a file — its
source).

**Verify.** Launch Claude Code in any terminal. The tab should show a colored
dot from a precise state (working while it's thinking / using a tool, waiting
when it asks you something, done when it finishes). If the dot is the gray
fallback `idle` with a Webhook icon next to it, the install didn't take — see
[Troubleshooting](#troubleshooting).

---

## Install — any other agent (generic wrapper)

For agents that don't have their own hook system (or whose hooks you don't
want to wire by hand), the ADE ships a generic wrapper that posts `working`
before exec and `done` on exit. You register the wrapper **as the agent's
launch command** in **Settings → Agents**.

> The pane in **Settings → Agents → Hooks → "Generic wrapper"** shows the
> exact installed path on your machine and a Bash / PowerShell / cmd toggle
> — copy from there to be sure.

### Common pattern (all platforms)

In **Settings → Agents**:

1. Click **Add custom agent**.
2. Fill in:
   - **Name** — anything you'll recognize (e.g. `Codex (hooked)`).
   - **Command** — the absolute path to the wrapper for your platform (see
     below).
   - **Arguments** — `<agent-type> -- <agent-cli> [your-normal-args]`
     (PowerShell uses a different syntax — see below).
   - **Launch in** — the terminal profile to run it in (default = the
     default profile).
   - **Logo** — optional; the catalog logo resolves from the command name.
3. Save. Launch the agent from a worktree's Bot menu.

The wrapper then `exec`s the real CLI and the ADE gets `working` / `done`
for that terminal, the same as for Claude Code's hooks.

### Windows — PowerShell

Use `uxnan-hook-wrapper.ps1`. PowerShell uses named parameters, so the
arguments look slightly different.

**Settings → Agents → Add custom agent:**

- **Command:** `C:\Users\<you>\AppData\Roaming\dev.luisgamas.uxnandesktop\hooks\uxnan-hook-wrapper.ps1`
- **Arguments** *(space-separated)*: `-Type codex -Command codex -Args --version`

Then launch from the worktree's Bot menu. The wrapper invokes `codex
--version` (replace with the real args for your use case), posts `working`
to the hook server, and `done` on exit.

**Argument shape:** `-Type <agent-type> -Command <agent-cli> -Args <arg1>, <arg2>, …`

> PowerShell's quoting is finicky around `--`. If your agent's args contain
> `--` or quoted strings, pass them via `-Args` and let the wrapper pass
> them through `Start-Process -ArgumentList`. The shipped `.ps1` uses
> `-NoNewWindow -PassThru -Wait`, so the agent owns the terminal until it
> exits, and the ADE sees the real exit code.

### Windows — cmd / batch (no PowerShell)

Use `uxnan-hook-wrapper.cmd`. Only needed on hosts without PowerShell
(rare on modern Windows — `powershell.exe` ships with Windows 7+).

**Settings → Agents → Add custom agent:**

- **Command:** `C:\Users\<you>\AppData\Roaming\dev.luisgamas.uxnandesktop\hooks\uxnan-hook-wrapper.cmd`
- **Arguments:** `codex -- --version`

(Or `codex --` followed by whatever your agent's normal CLI args are.)

The `.cmd` script only forwards `%2`–`%9` to the inner command — keep the
arg list short (≤ 8 args). For longer arg lists, prefer the `.ps1`
wrapper.

### macOS / Linux — Bash

Use `uxnan-hook-wrapper.sh`.

**Settings → Agents → Add custom agent:**

- **Command:** `/Users/<you>/Library/Application Support/dev.luisgamas.uxnandesktop/hooks/uxnan-hook-wrapper.sh`
  (Linux: `/home/<you>/.local/share/dev.luisgamas.uxnandesktop/hooks/uxnan-hook-wrapper.sh`)
- **Arguments:** `codex -- --version`

Or with no args (most common interactive use):

- **Arguments:** `codex -- codex`

The wrapper exec's `codex` directly, so signals (Ctrl+C, etc.) reach the
real agent.

### WSL on Windows

The wrapper for WSL depends on which shell WSL is configured to use:

- **Default (most distros):** use the Bash wrapper (`uxnan-hook-wrapper.sh`)
  at the WSL-side path — the ADE injects `UXNAN_HOOK_URL` / `_TOKEN` /
  `_AGENT_ID` into the Linux process when you launch through WSL.
- **WSLg / WSL with PowerShell:** use the PowerShell wrapper from inside
  PowerShell.

If your ADE terminal profile is configured to launch a WSL shell (e.g.
`wsl.exe -- …`), the env vars flow through WSL into Linux processes
unchanged — Bash works.

### Git Bash on Windows

Use the Bash wrapper (`uxnan-hook-wrapper.sh`). Git Bash is a real Bash, so
the script runs unchanged. Pick a Git Bash terminal profile in
**Launch in**.

### Verify (all platforms)

Launch the agent through the ADE's Bot menu (project / worktree header) and
watch the tab. You should see a green pulsing **Working** dot while the
agent runs, then **Done** (blue) when it exits cleanly, or **Done with
`interrupted: true`** if the exit code is non-zero. If you only see a gray
`idle` dot with a Webhook icon next to it, the wrapper isn't being used as
the launch command — re-check **Command** and **Arguments** in the agent
profile.

---

## Uninstall / revert

- **Claude Code** — **Settings → Agents → Hooks** → **Uninstall**. Removes
  only the ADE-managed `hooks` block; your own `hooks` survive.
- **Generic wrapper** — delete the custom agent profile you added in
  **Settings → Agents**. There's nothing on disk to remove (the wrapper
  scripts themselves stay, in case you want to wire another agent later).

To turn off the wrapper *temporarily* for one launch, run the agent's
command directly in a terminal instead of going through the ADE's Bot menu.

---

## Manual / custom agents

If the ready-made configs don't fit (you want richer states, a different
agent type, or just want to write it yourself), the contract is the same.

**Generic / any CLI** — write a small script that:

1. Reads `UXNAN_HOOK_URL` / `UXNAN_HOOK_TOKEN` / `UXNAN_AGENT_ID` from the
   environment.
2. Before exec: POST `{"agentId":"…","status":"working","agentType":"…"}` to
   `$UXNAN_HOOK_URL` with header `X-Uxnan-Token: $UXNAN_HOOK_TOKEN`.
3. On exit: POST `{"agentId":"…","status":"done","agentType":"…",
   "interrupted": <true if exit code != 0>}`.

The shipped `uxnan-hook-wrapper.{sh,ps1,cmd}` are the reference
implementations.

**Claude Code** — point its `hooks` config at a small script that reads
the JSON Claude sends on stdin and POSTs it to `$UXNAN_HOOK_URL` (using
`$UXNAN_HOOK_TOKEN` in `X-Uxnan-Token` and `$UXNAN_AGENT_ID` as
`agentId`). The shipped `uxnan-claude-hook.cjs` is the reference.

---

## Reference

### Environment variables

Every terminal spawned by the ADE inherits:

| Variable | Meaning |
|---|---|
| `UXNAN_HOOK_URL` | Full POST endpoint, e.g. `http://127.0.0.1:51234/hook` |
| `UXNAN_HOOK_TOKEN` | Shared secret for this ADE launch |
| `UXNAN_AGENT_ID` | This terminal's id — echo it back as `agentId` |

The server binds an ephemeral `127.0.0.1` port at startup; the ADE writes
the resolved URL + token into the spawned terminal's env. The token is
**per-launch** (rotates on every ADE restart).

### Request contract

`POST $UXNAN_HOOK_URL` with header `X-Uxnan-Token: $UXNAN_HOOK_TOKEN` and a
JSON body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `agentId` | string | yes | Echo `UXNAN_AGENT_ID`. |
| `status` | string | yes | One of `working`, `blocked`, `waiting`, `done`. |
| `agentType` | string | no | `claude`, `codex`, … (shown in the UI). |
| `prompt` | string | no | The prompt being processed. |
| `tool` | string | no | Tool in use: `file_edit`, `bash`, `web_search`, … |
| `interrupted` | bool | no | Whether the agent was interrupted. |
| `summary` | string | no | Short preview of the latest response; sent on `done` to enrich the completion notification. |

Responses:

- `204 No Content` on success.
- `403` if the caller isn't loopback (a non-loopback `Host`/`Origin` header).
- `401` if the token is missing or wrong.
- `400` / `422` for a malformed body.
- `GET /health` returns `ok`.

Example:

```bash
curl -fsS -X POST "$UXNAN_HOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Uxnan-Token: $UXNAN_HOOK_TOKEN" \
  -d "{\"agentId\":\"$UXNAN_AGENT_ID\",\"status\":\"working\",\"agentType\":\"claude\",\"tool\":\"bash\"}"
```

The ADE caches the report (survives restarts, pruned after 7 days; a report
older than 30 min shows dimmed) and updates the sidebar / tab indicators
live.

**Provider session capture (resume).** When a provider-event payload carries
the provider's own session identity, the server also extracts it: the id from
`session_id` / `sessionID` / `sessionId` / `session-id` / `conversation_id` /
`conversationId` / `conversationID` / `conversation-id`, and an optional
session/transcript file from `session_file` / `sessionFile` /
`transcript_path`. The bundled reporters
forward it themselves: the Claude/Gemini relay passes the raw hook JSON
through untouched, the OpenCode plugin attaches the ROOT session's
`sessionID` to every state event (a sub-agent child session never overwrites
it), the Pi extension rides the explicit `session_id`/`session_file`
fields it observes on its event payloads, and Grok/Antigravity's per-event
`curl` hook forwards their raw payload (Grok's `session_id`, Antigravity's
camel-case `conversationId`). The broadcast
`agent:status-changed` event mirrors the cached entry **including** the
session — the frontend stamps the owning tab from that event. The id is validated as hostile input at ingestion (bounded
length, conservative charset, no leading `-`) because it later reaches a shell
command line: a restored or woken terminal tab runs the CLI's own resume
command (`claude --resume <id>`, `codex resume <id>`, `opencode --session
<id>`, `grok --resume <id>`, `agy --conversation <id>`,
`pi --session <file|id>`) as its startup command — **auto-run when the
agent's TUI was still alive at close/sleep** (the workspace comes back with
its TUIs open), only pre-typed when the agent had already exited. Liveness is
tracked by process detection, and only an **observed** exit lowers it: right
after a restore the detector reports "no agent" once for every tab, before the
resumed TUI has started, and taking that at face value used to mark the
restored sessions dead. Captured session **ids are identifiers, not
credentials**; they
are cached with the agent state in `state.json` (same 7-day TTL) and persisted
on the owning tab with the terminal layout.

Two wired agents are deliberately **not** resumable: **Gemini CLI** exposes no
session resume (and is deprecated — see `AGENTS.md`), and **Zero** resumes only in
its headless one-shot mode (`zero exec --resume [id]`); the interactive TUI a
terminal tab runs rejects the flag. Both still have their sessions captured.

**Sessions named at launch.** Capture-by-hook only learns an id once the agent
has done something, so a tab you opened and never wrote to had nothing to bring
back. For the CLIs that accept a caller-chosen id, uxnan names the session as it
launches the agent and stamps the tab immediately
(`src/lib/agentSessionId.ts`) — verified against each CLI's own help:
`claude --session-id <uuid>`, `grok --session-id <uuid>`,
`pi --session-id <id>`, `agy --conversation <uuid>`. Codex and OpenCode expose
no equivalent and stay hook-captured. Such an id is marked `pending` until the
provider reports it back, because the flags are exact complements —
`claude --resume <unwritten-id>` answers "No conversation found" and
`claude --session-id <written-id>` answers "Session ID … is already in use" — so
a `pending` tab is reopened by **claiming** an id rather than resuming one, and
it claims a freshly minted one (claiming the same id twice is the case that
fails; an unused conversation has no history to lose). The user's own agent args
win: if they already carry `--resume`, `--continue`, `--session*`, `--fork*` or
`--conversation`, the command line is left exactly as configured. Turn the whole
behavior off in **Settings → Agents → Name agent sessions at launch**
(`pinAgentSessions`, on by default).

A session **already persisted** under an unusable agent type (see the sweep
below) is repaired when its tab comes back: the transcript path captured
alongside it names the CLI it belongs to (`~/.codex/sessions/…`,
`~/.claude/projects/…`, `~/.pi/…`, `~/.grok/…`, `~/.gemini/…`), which restores
both the agent and its resume command. One that can't be placed is left alone —
running another CLI's command line on a guess is worse than offering nothing.

**Reporters from older builds are swept.** On startup the ADE deletes every
`uxnan-*` file in its hooks dir that the current build did not just write: the dir
is app-data it owns, so anything else in it is a leftover — which means a reporter
renamed in some future version cleans itself up, with no list to remember to
update. Files it doesn't own, including the `endpoint.*` coordinates file and
anything you put there yourself, are untouched.

The *config* side can't be derived that way, so the retired reporter names
(`uxnan-agent-status-hook`, `uxnan-claude-hook`, `uxnan-opencode-hook`) are
matched by a hand-kept list and stripped from every agent config the ADE writes —
**renaming a reporter means adding its old name to that list**. The pre-relay
bridge that made this necessary did real damage while it lingered: it read its
agent type from a `UXNAN_AGENT_TYPE` env var the ADE no longer injects and so
reported the literal `"agent"`, which the server now rejects outright.

---

## Troubleshooting

**Tab still shows the gray `idle` dot with a Webhook icon next to it.**
The hook isn't installed (or isn't being invoked) for that agent.

- **Claude Code:** confirm **Settings → Agents → Hooks** says *Installed at …*.
  If it says *Not installed*, click **Install**. If it says *Installed*, the
  block was merged but Claude Code might be running an older session — quit
  and restart Claude Code so it re-reads `~/.claude/settings.json`.
- **Wrapper (custom agent):** open the agent profile in **Settings →
  Agents** and confirm **Command** is the wrapper script's absolute path and
  **Arguments** matches the wrapper's signature for your OS (Bash / cmd:
  `<agent-type> -- <agent-cli> [args]`; PowerShell:
  `-Type <agent-type> -Command <agent-cli> -Args <args>`). Launch the agent
  through the ADE's Bot menu — running it manually in a terminal doesn't go
  through the wrapper.
- **Wrapper script missing:** if `<app-data>/hooks/` is empty, the ADE
  couldn't write them at startup (sandbox / permissions). Check the ADE's
  console for the error; restart the ADE with a writable app-data dir.

**Dot shows `done` immediately after launch.** The wrapper ran, but the
inner command either wasn't found or exited with a non-zero status before
the agent started. Check the terminal output — the wrapper prints usage
information when its args are wrong.

**Dot never changes from `working`.** The agent is still running, or the
wrapper couldn't reach the hook server. Check that
`$UXNAN_HOOK_URL` is reachable (from a terminal inside the ADE:
`curl -fsS -X GET "$UXNAN_HOOK_URL/health"` should return `ok`). If it
doesn't, the ADE isn't running anymore — restart it; the port + token
rotate on every launch.

**"401" in the wrapper / curl output.** The `X-Uxnan-Token` is wrong or
stale. The token rotates on every ADE launch — restart the agent inside a
freshly-spawned terminal (so it picks up the new env vars).

**Reports from a previous session are stale (dimmed).** Expected — restart
the agent so it re-reports. Reports older than 30 min are dimmed; older than
7 days are pruned from the cache.

---

## Security

The hook server only listens on `127.0.0.1` (loopback) and requires the
**per-launch** token in the `X-Uxnan-Token` header, so:

- Other machines can't reach it.
- Stray local processes can't spoof reports without reading the token.
- The token is never logged or persisted to disk — it lives only in the
  ADE's process memory and the spawned terminals' environment.

Defense-in-depth on top of that baseline:

- **Loopback `Host`/`Origin` gate.** Every state-changing route (`/hook`,
  `/browser`, `/mcp`) first rejects (`403`) a request whose `Host` isn't
  absent-or-loopback, or whose `Origin` isn't absent-or-a-loopback
  `http(s)` origin — a guard against browser-driven CSRF / DNS-rebinding that
  doesn't rely on the token or CORS-preflight behavior.
- **Constant-time token check.** The token is compared via SHA-256 digests of
  both sides, not `==` on the raw secret, so a comparison can't leak the token
  through timing.
- **No arbitrary file reads.** A Claude `done` report's `transcript_path` is
  read only when it's a `.jsonl` file inside the user's `~/.claude` home
  (canonicalized, so `..` can't escape); any other path is ignored and the
  report still succeeds.

If you need to rotate the token, restart the ADE — a fresh token is
generated on every launch.

---

## See also

- **UI:** Settings → Agents → Hooks (install / uninstall Claude Code,
  inspect the rendered JSON, copy the wrapper script for your platform).
- [Agent launch & configuration](./agent-launch.md) — register agents, env vars,
  the launch shell, auto-launch.
- [Multi-agent orchestration](./orchestration.md) — precise hook states make its
  backpressure exact instead of best-effort.
- **Spec:** [`architecture/02d-agent-monitoring.md`](../architecture/02d-agent-monitoring.md)
  §1 (the three monitoring layers), §2 (notifications), §3 (multi-agent
  orchestration).
- **Reference implementations:** `static/hooks/` — bundled into the binary
  at compile time and written to `<app-data>/hooks/` on every startup.
