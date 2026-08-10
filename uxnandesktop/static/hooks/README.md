# Bundled hook assets for the ADE

The ADE writes these scripts to `<app-data-dir>/hooks/` on every startup
(overwriting if changed), and exposes their absolute paths via the
`get_hook_install` Tauri command. They are the "ready-made per-agent hook
configs" referenced in `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md`.

Each reporter is chosen for maximum shell-robustness (the agent's own hook
runner executes it, so it must work regardless of the user's interactive shell):

| File | Agent(s) | Purpose |
|---|---|---|
| `uxnan-status-relay.cjs` | Claude Code | A dependency-free Node relay. Claude guarantees `node` on its PATH, and exec-form invocation resolves identically under cmd / PowerShell / Git Bash / WSL / bash / zsh / fish. It forwards raw hook events to the local hook server for normalization. |
| `uxnan-codex-hook.sh` / `.cmd` | Codex | Codex is a Rust binary (no Node guarantee), so it uses `curl` — POSIX `.sh` (run by Codex's `/bin/sh` hook runner) and Windows `.cmd` (system `curl.exe`). Forwards the raw event as the body; agent id/kind ride in headers so the script never builds JSON. |
| `uxnan-event-hook.sh` / `.cmd` | Grok, Antigravity, and every declaratively-wired CLI (Cursor, Copilot, Droid, Devin, Qwen Code, Auggie, Kiro, Kimi, Command Code, OpenClaude) | The same job as the Codex hook with the agent kind passed as `$1` instead of baked in, so one reporter serves every CLI whose hook runner executes a command and pipes it the raw event JSON. Answers `{}` on stdout: several of these CLIs parse it, and Cursor **gates tool use on it** — a reporter that printed nothing would block the agent's file reads, not merely fail to report. |
| `uxnan-opencode-status-plugin.js` | OpenCode, MiMo Code, Kilo Code | An in-process ES-module plugin (installed into each CLI's own plugin dir). Re-labels the bus events to the hook server's vocabulary and POSTs directly. MiMo is a fork of OpenCode and Kilo reimplemented the same bus, so all three run this one source: the installer rewrites the agent kind it declares and, for Kilo, the default-export descriptor its loader requires. |
| `uxnan-amp-status.js` | Amp | An in-process plugin (installed into `~/.config/amp/plugins/`). Amp's plugin API is its own — a default-exported function receiving `amp.on(...)` — so this is its own source rather than a variant of the OpenCode one. Its `tool.call` handler answers `allow`, because that event gates the tool. |
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
