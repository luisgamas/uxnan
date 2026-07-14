# Agent hooks — precise agent states

![States](https://img.shields.io/badge/states-working_%7C_blocked_%7C_waiting_%7C_done-2ea44f?style=for-the-badge)
![Server](https://img.shields.io/badge/hook_server-127.0.0.1_(loopback)-0a0a0a?style=for-the-badge)
![Agents](https://img.shields.io/badge/precise-Claude_%7C_Codex_%7C_Gemini_%7C_OpenCode_%7C_Pi-D97757?style=for-the-badge)
![Others](https://img.shields.io/badge/other_agents-generic_wrapper-blue?style=for-the-badge)

The ADE infers a coarse **working / idle** state from terminal output with no
setup. To get **precise** states — `working`, `blocked`, `waiting`, `done` — an
agent must actively report them to the ADE's local **hook server** (Layer 1 of
the monitoring design, spec `architecture/02d-agent-monitoring.md` §1.1).

The ADE ships a reporter for each of its five most-used agents — **Claude Code,
Codex, Gemini CLI, OpenCode and Pi** — and installs them **automatically on
startup** (you can turn that off any time). Each reporter is picked to be robust
across every shell you might launch the agent from (cmd, PowerShell, PowerShell
7, Git Bash, WSL, bash, zsh, fish), because the agent's *own* hook runner
executes it. Any other agent is **opt-in**: point it at the generic wrapper.

> **TL;DR.** Open **Settings → Agents → Hooks**:
> - **Claude Code / Codex / Gemini / OpenCode / Pi** → already installed (auto on
>   startup). The **Install agent hooks** switch turns them off (and keeps them
>   off next launch) or back on; each agent also has its own Install/Uninstall.
> - **Anything else** → use the **generic wrapper** as the agent's launch
>   command (full step-by-step per OS below).

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

The reporters (one per agent, plus the generic wrapper) — full table in
[`static/hooks/README.md`](../static/hooks/README.md):

| File | Agent(s) | What it's for |
|---|---|---|
| `uxnan-status-relay.cjs` | Claude Code, Gemini CLI | Node relay (both agents *are* Node, so `node` is guaranteed → works from any shell). Forwards the raw event; the server normalizes it. |
| `uxnan-codex-hook.{sh,cmd}` | Codex | `curl` hook (Codex is a Rust binary — no Node). Paired with a `trusted_hash` in `~/.codex/config.toml`. |
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
| `UXNAN_ENDPOINT_FILE` | Path to `endpoint.env` / `endpoint.cmd` — a file the ADE rewrites every launch with the live url + token. Reporters prefer it, so a terminal that outlived an app restart still reaches the live server. |

You never need to set these by hand — the reporters pick them up from the
environment, and so does anything else you write against the contract.

> **WSL note (basic support).** The `UXNAN_*` vars are added to `WSLENV` so they
> cross into a WSL shell (with `/p` path-translation for the endpoint file).
> However, in **WSL2** `127.0.0.1` points at the WSL VM, not the Windows host, so
> a hook running *inside* WSL2 can't reach the host's hook server — a known
> limitation. WSL1 and native Windows/macOS/Linux shells work.

---

## Install — the five built-in agents (automatic)

On every startup (unless you turned it off) the ADE installs the managed reporter
for each of Claude Code, Codex, Gemini CLI, OpenCode and Pi:

- **Per-event merge, user-preserving.** For the JSON-config agents (Claude,
  Codex, Gemini) the reporter is merged into each event of the agent's config
  (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/settings.json`)
  **without touching your existing hooks**. A managed entry is recognised by the
  script/relay it references, so re-installing self-heals a moved path and
  Uninstall removes only ours.
- **Codex trust.** Codex 0.129+ only runs a hook whose exact identity is trusted;
  the ADE also writes the reproduced `trusted_hash` into `~/.codex/config.toml`,
  so the hook actually fires (a raw `hooks.json` alone would sit un-run).
- **OpenCode / Pi** install a plugin / extension file into the agent's own
  plugin / extension directory (only overwriting a file the ADE itself manages).
- **Restart the agent afterward** so it re-reads its config (Claude picks up
  `settings.json` changes via a file watcher, but restarting is the sure path).

In **Settings → Agents → Hooks**, a master **Install agent hooks** switch installs
/ removes all five and persists the choice (`AppSettings.autoInstallHooks`); each
agent card also has its own **Install** / **Uninstall** and an honest status
badge. Every agent card has a **Show config** disclosure that inspects/copies the
exact config the ADE installs — the `hooks` block for **Claude Code** / **Gemini
CLI**, the `~/.codex/hooks.json` body for **Codex** (its `trusted_hash` in
`config.toml` is managed automatically), and the plugin / extension source for
**OpenCode** / **Pi**.

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
