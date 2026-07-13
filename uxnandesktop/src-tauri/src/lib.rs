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
mod browser;
mod codex_trust;
mod commands;
mod error;
mod fonts;
mod fs;
mod fswatch;
mod git;
mod gitfast;
mod github;
mod hooks;
mod mcp;
mod mcpinject;
mod model;
mod persistence;
mod power;
mod procscan;
mod pty;
mod state;
mod updater;
mod usage;
mod which;
mod winproc;
mod wsl;
mod zero;

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
            // url + token (+ the endpoint-file path it writes to `<data>/hooks/`)
            // so `pty_create` can inject them into every terminal.
            let hook_handle = app.handle().clone();
            let hooks_dir = data_dir.join("hooks");
            let hooks_dir_for_server = hooks_dir.clone();
            tauri::async_runtime::spawn(async move {
                let token = uuid::Uuid::new_v4().to_string();
                match crate::hooks::start(hook_handle, token, hooks_dir_for_server).await {
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
            match crate::agent_hooks::install_scripts_to(&hooks_dir) {
                Ok(install) => {
                    // Auto-install the managed hooks for every supported agent
                    // (Claude Code, Codex, Gemini CLI, OpenCode) so precise states
                    // work out of the box. Idempotent; a failure for one agent does
                    // not abort the others. Skipped when the user opted out.
                    if auto_install_hooks {
                        crate::agent_hooks::install_all(&install);
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
            commands::usage_read,
            commands::usage_detect,
            commands::mcp_info,
            commands::pty_create,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::pty_snapshot,
            commands::repo_add,
            commands::repo_remove,
            commands::repo_list,
            commands::repo_update,
            commands::repo_set_branch_icon,
            commands::repo_reorder,
            commands::repo_set_worktree_order,
            commands::repo_remote_owner,
            commands::branch_list,
            commands::worktree_create,
            commands::worktree_remove,
            commands::worktree_list,
            commands::worktree_status,
            commands::browse_dirs,
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::fs_read_data_url,
            commands::fs_write_file,
            commands::fs_rename,
            commands::fs_create_file,
            commands::fs_create_dir,
            commands::fs_delete,
            commands::fs_duplicate,
            commands::fs_search_files,
            commands::zero_session,
            commands::image_fetch_data_url,
            commands::fs_set_watch,
            commands::reveal_path,
            fonts::list_system_fonts,
            commands::open_url,
            commands::open_external,
            browser::browser_window_open,
            browser::browser_window_set_bounds,
            browser::browser_window_navigate,
            browser::browser_window_reload,
            browser::browser_window_back,
            browser::browser_window_forward,
            browser::browser_window_show,
            browser::browser_window_hide,
            browser::browser_window_close,
            browser::browser_window_devtools,
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
            commands::get_codex_hooks_status,
            commands::install_codex_hooks,
            commands::uninstall_codex_hooks,
            commands::get_gemini_hooks_status,
            commands::install_gemini_hooks,
            commands::uninstall_gemini_hooks,
            commands::get_pi_hooks_status,
            commands::install_pi_hooks,
            commands::uninstall_pi_hooks,
            commands::get_opencode_hooks_status,
            commands::install_opencode_hooks,
            commands::uninstall_opencode_hooks,
            commands::install_all_hooks,
            commands::get_hook_scripts,
            updater::app_version,
            updater::updater_check,
            updater::updater_download,
            updater::updater_staged,
            updater::updater_install,
            commands::github_status,
            commands::github_repo_context,
            commands::github_pr_list,
            commands::github_pr_view,
            commands::github_pr_diff,
            commands::github_pr_timeline,
            commands::github_pr_create,
            commands::github_pr_comment,
            commands::github_pr_review,
            commands::github_pr_merge,
            commands::github_pr_checkout,
            commands::github_issue_list,
            commands::github_issue_view,
            commands::github_issue_comment,
            commands::github_issue_create,
            commands::github_issue_develop,
            commands::github_run_list,
            commands::github_run_log,
            commands::github_run_rerun,
            commands::github_run_cancel,
            commands::github_rate_limit,
            commands::github_notifications_count,
            commands::github_clone,
            commands::github_ai_draft_pr,
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
                // Remove any MCP config files we injected into workspaces / global
                // config so nothing stale is left behind (best-effort; see
                // `mcpinject.rs`).
                crate::mcpinject::cleanup(app_handle);
            }
        });
}
