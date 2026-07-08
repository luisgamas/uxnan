# Bundled hook assets for the ADE

The ADE writes these scripts to `<app-data-dir>/hooks/` on every startup
(overwriting if changed), and exposes their absolute paths via the
`get_hook_install` Tauri command. They are the "ready-made per-agent hook
configs" referenced in `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md`.

Each reporter is chosen for maximum shell-robustness (the agent's own hook
runner executes it, so it must work regardless of the user's interactive shell):

| File | Agent(s) | Purpose |
|---|---|---|
| `uxnan-status-relay.cjs` | Claude Code, Gemini CLI | A dependency-free Node relay. Both agents *are* Node programs, so `node` is guaranteed on their PATH — `node "<relay>"` (or Claude's exec-form `node`) resolves identically under cmd / PowerShell / Git Bash / WSL / bash / zsh / fish. Forwards the raw hook event to the local hook server; the server normalizes it. Echoes `{}` on stdout only for Gemini (which parses hook stdout as JSON). |
| `uxnan-codex-hook.sh` / `.cmd` | Codex | Codex is a Rust binary (no Node guarantee), so it uses `curl` — POSIX `.sh` (run by Codex's `/bin/sh` hook runner) and Windows `.cmd` (system `curl.exe`). Forwards the raw event as the body; agent id/kind ride in headers so the script never builds JSON. |
| `uxnan-opencode-status-plugin.js` | OpenCode | An in-process ES-module plugin (installed into OpenCode's `plugins/` dir). Re-labels OpenCode's bus events to the hook server's vocabulary and POSTs directly. |
| `uxnan-pi-status.js` | Pi / OMP | An in-process extension (installed into `~/.pi/agent/extensions/`). Registers `pi.on(...)` handlers and POSTs directly. |
| `uxnan-hook-wrapper.{sh,ps1,cmd,fish}` | any CLI agent | The generic launcher wrapper for agents with no native hook surface. Reports `working` before the agent runs and `done` on exit (with `interrupted` on a non-zero exit / Ctrl-C). State rides in an `X-Uxnan-Status` header — no JSON building. |
| `uxnan-browser.{sh,cmd}` | — | The integrated-browser shim (`$BROWSER` points here). |

The ADE also injects these environment variables into **every** terminal it
spawns (inherited by any agent run inside it):

| Variable | Meaning |
|---|---|
| `UXNAN_HOOK_URL` | Full POST endpoint, e.g. `http://127.0.0.1:51234/hook` |
| `UXNAN_HOOK_TOKEN` | Shared secret for this ADE launch (sent as `X-Uxnan-Token`) |
| `UXNAN_AGENT_ID` | This terminal's id — echoed back as the report's `agentId` |
| `UXNAN_ENDPOINT_FILE` | Path to `endpoint.env` / `endpoint.cmd`, a file the ADE rewrites every launch with the live url + token. Reporters prefer it so a terminal that outlived an app restart still reaches the live server. |

These are the source of truth — the Rust backend embeds the same contents
(`src-tauri/src/agent_hooks.rs`) and writes them to disk on startup, so an
installed app does not need to serve `static/` at runtime.
