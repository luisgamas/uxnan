# Bundled hook assets for the ADE

The ADE writes these scripts to `<app-data-dir>/hooks/` on every startup
(overwriting if changed), and exposes their absolute paths via the
`get_hook_install` Tauri command. They are the "ready-made per-agent hook
configs" referenced in `docs/agent-hooks.md` and the Phase 4 follow-ups in
`FOR-DEV.md`.

| File | Purpose |
|---|---|
| `uxnan-claude-hook.cjs` | The script Claude Code's `hooks` config invokes on every event. No deps, cross-platform. Maps Claude events to the hook server's `working` / `waiting` / `done` / `blocked` states. |
| `claude-settings.template.json` | The `hooks` block to merge into `~/.claude/settings.json`. `{{HOOK_SCRIPT}}` is replaced with the absolute path to `uxnan-claude-hook.cjs` at install time. |
| `uxnan-hook-wrapper.sh` | Bash wrapper for any CLI agent (Unix + Git Bash + WSL). Posts `working` before exec, `done` on exit. |
| `uxnan-hook-wrapper.ps1` | PowerShell wrapper for any CLI agent (Windows). Same contract as the Bash version. |
| `uxnan-hook-wrapper.cmd` | cmd / batch fallback for any CLI agent (Windows). Only used when PowerShell is unavailable; the `.ps1` version is preferred. |

These are the source of truth — the Rust backend embeds the same contents
(`src-tauri/src/agent_hooks.rs`) and writes them to disk on startup, so an
installed app does not need to serve `static/` at runtime.
