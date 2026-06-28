//! Uxnan Desktop (ADE) — Tauri backend entry point.
//!
//! Wires the shared [`AppState`] (loaded from disk at startup) and registers the
//! Phase 0 command surface. The three-actor architecture (Rust core ⇄ Svelte
//! webview ⇄ PTY processes) is documented in
//! `architecture/02a-system-architecture.md`.

mod agent_hooks;
mod agentcli;
mod aicommit;
mod browse;
mod commands;
mod error;
mod fs;
mod fswatch;
mod git;
mod gitfast;
mod hooks;
mod model;
mod persistence;
mod power;
mod procscan;
mod pty;
mod state;
mod updater;
mod which;
mod wsl;

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{Emitter, Manager, WindowEvent};

use crate::commands::{AgentDetectedEvent, GitStatusEvent};
use crate::model::AppData;
use crate::persistence::PersistenceManager;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        // In-app auto-updater (Settings → Updates). Endpoints are set per channel
        // at runtime in `updater.rs`; the pubkey for signature verification comes
        // from `tauri.conf.json`. Desktop-only — harmless until signed releases
        // exist (check just finds nothing / fails to verify; the app runs fine).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Restore the main window's last size/position/maximized state on launch
        // and save it on exit (so the app reopens where the user left it). The
        // window config provides the first-run defaults.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // Resolve the OS-specific app data directory and load (or default)
            // the persisted state, then publish it as managed state.
            let data_dir = app.path().app_data_dir()?;
            let persistence = PersistenceManager::new(&data_dir);
            let mut data = persistence.load().unwrap_or_else(|err| {
                eprintln!("[uxnan-desktop] failed to load persisted state ({err}); starting fresh");
                AppData::default()
            });
            // Seed terminal profiles when missing (state persisted before they
            // existed, or a fresh install where load() returned defaults anyway).
            data.settings.ensure_terminal_profiles();
            // Drop agent cache entries past their 7-day TTL (spec 02d §1.5).
            data.prune_agent_cache(crate::hooks::now_secs());
            // Whether to auto-install the Claude hooks block this launch (off once
            // the user uninstalls). Captured before `data` moves into the state.
            let auto_install_hooks = data.settings.auto_install_hooks;
            let state = AppState::new(persistence, data);
            let git_watch = state.git_watch.clone();
            let focused = state.focused.clone();
            let hook_slot = state.hook.clone();
            let hook_install_slot = state.hook_install.clone();
            app.manage(state);

            // Start the local agent hook server (Layer 1). On success, publish its
            // url + token so `pty_create` can inject them into every terminal.
            let hook_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let token = uuid::Uuid::new_v4().to_string();
                match crate::hooks::start(hook_handle, token).await {
                    Ok(info) => *hook_slot.write().await = Some(info),
                    Err(err) => {
                        eprintln!("[uxnan-desktop] agent hook server failed to start: {err}");
                    }
                }
            });

            // Write the bundled per-agent hook scripts to <data>/hooks/ so the
            // Settings → Agents → Hooks pane can install the ready-made configs.
            // Best-effort: a failure here doesn't break the app (precise hook
            // reporting still works; the one-click install is just unavailable).
            let hooks_dir = data_dir.join("hooks");
            match crate::agent_hooks::install_scripts_to(&hooks_dir) {
                Ok(install) => {
                    // Auto-install the Claude hooks block (idempotent: re-points it
                    // at the current script path) unless the user opted out.
                    if auto_install_hooks {
                        let script = std::path::PathBuf::from(&install.claude_hook_script);
                        if let Err(e) = crate::agent_hooks::install_claude_hooks(&script) {
                            eprintln!("[uxnan-desktop] auto-install of Claude hooks failed: {e}");
                        }
                    }
                    let slot = hook_install_slot;
                    tauri::async_runtime::spawn(async move {
                        *slot.write().await = Some(install);
                    });
                }
                Err(err) => {
                    eprintln!("[uxnan-desktop] hook scripts not installed at {hooks_dir:?}: {err}");
                }
            }

            // Pause the git watcher while the window is unfocused.
            if let Some(window) = app.get_webview_window("main") {
                let focused_for_event = focused.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(is_focused) = event {
                        focused_for_event.store(*is_focused, Ordering::Relaxed);
                    }
                });
            }

            // Background git watcher: poll the watched worktree every 3 s (paused
            // when unfocused) and emit `git:status-changed` only when it changes.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(3));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut last: Option<String> = None;
                loop {
                    interval.tick().await;
                    if !focused.load(Ordering::Relaxed) {
                        continue;
                    }
                    let Some(path) = git_watch.read().await.clone() else {
                        continue;
                    };
                    let files = crate::git::status_files(&path).await.unwrap_or_default();
                    let status = crate::git::worktree_status(&path).await.unwrap_or_default();
                    let payload = GitStatusEvent {
                        path,
                        files,
                        ahead: status.ahead,
                        behind: status.behind,
                    };
                    let snapshot = serde_json::to_string(&payload).ok();
                    if snapshot != last {
                        last = snapshot;
                        let _ = handle.emit("git:status-changed", &payload);
                    }
                }
            });

            // Background agent watcher: every 2 s scan each terminal's process
            // tree for a known agent command and emit `agent:detected` on change,
            // so a terminal that runs (or stops running) any agent updates its
            // sidebar row + tab name — even one the user typed by hand.
            let agent_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(2));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut sys = sysinfo::System::new();
                let mut last: std::collections::HashMap<String, Option<String>> =
                    std::collections::HashMap::new();
                loop {
                    interval.tick().await;
                    let state = agent_handle.state::<AppState>();
                    let pids = state.pty.live_pids();
                    if pids.is_empty() {
                        last.clear();
                        continue;
                    }
                    let commands = state.agent_commands.read().await.clone();
                    // Refresh WITH command lines — the default refresh only gives
                    // the exe name (`node`), so node-shim agents (codex/gemini/…)
                    // would never match without their `…/agent.js` argument.
                    sys.refresh_processes_specifics(
                        sysinfo::ProcessesToUpdate::All,
                        true,
                        sysinfo::ProcessRefreshKind::nothing()
                            .with_cmd(sysinfo::UpdateKind::Always),
                    );
                    let mut live = std::collections::HashSet::new();
                    for (pty_id, pid) in pids {
                        live.insert(pty_id.clone());
                        let command = crate::procscan::detect_agent(&sys, pid, &commands);
                        if last.get(&pty_id) != Some(&command) {
                            last.insert(pty_id.clone(), command.clone());
                            let _ = agent_handle
                                .emit("agent:detected", AgentDetectedEvent { pty_id, command });
                        }
                    }
                    last.retain(|id, _| live.contains(id));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::update_settings,
            commands::ping,
            commands::pty_create,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::pty_snapshot,
            commands::repo_add,
            commands::repo_remove,
            commands::repo_list,
            commands::branch_list,
            commands::worktree_create,
            commands::worktree_remove,
            commands::worktree_list,
            commands::worktree_status,
            commands::browse_dirs,
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_set_watch,
            commands::reveal_path,
            commands::git_diff_head,
            commands::set_terminal_layout,
            commands::agents_detect,
            commands::git_status,
            commands::git_numstat,
            commands::git_diff,
            commands::git_image_diff,
            commands::git_stage,
            commands::git_unstage,
            commands::git_stage_all,
            commands::git_unstage_all,
            commands::git_discard,
            commands::git_apply,
            commands::git_commit,
            commands::git_log,
            commands::git_show,
            commands::git_set_watch,
            commands::git_push,
            commands::git_pull,
            commands::git_generate_commit_message,
            commands::ai_commit_agents,
            commands::ai_commit_models,
            commands::set_agent_commands,
            commands::get_hook_info,
            commands::agent_states,
            commands::set_prevent_sleep,
            commands::get_hook_install,
            commands::get_claude_hooks_status,
            commands::install_claude_hooks,
            commands::uninstall_claude_hooks,
            commands::get_hook_scripts,
            updater::app_version,
            updater::updater_check,
            updater::updater_download,
            updater::updater_staged,
            updater::updater_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill every live PTY child when the app exits, so no shell/agent
            // is left running in the background.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    state.pty.close_all();
                    // Release any keep-awake helper (kills caffeinate /
                    // systemd-inhibit on macOS/Linux) so none is left running.
                    state.power.set(false);
                }
            }
        });
}
