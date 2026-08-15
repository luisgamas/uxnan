//! Uxnan Desktop (ADE) — Tauri backend entry point.
//!
//! Wires the shared [`AppState`] (loaded from disk at startup) and registers the
//! Phase 0 command surface. The three-actor architecture (Rust core ⇄ Svelte
//! webview ⇄ PTY processes) is documented in
//! `architecture/02a-system-architecture.md`.

mod agent_hooks;
mod agentcli;
mod agentrun;
mod aicommit;
// Public so the binary's headless runner mode (`main.rs`) can reach it without
// starting Tauri — an automation must run with the app closed.
pub mod automations;
mod browse;
mod browser;
mod codex_trust;
mod commands;
mod convtitle;
// Public so the headless runner (`main.rs` → `automations::store`) resolves the
// data directory through exactly the same override the app does.
pub mod datadir;
// Public so the headless runner can record its own lifecycle into the same log.
pub mod diagnostics;
mod editors;
// Public so the GitHub integration tests (`tests/github_cli.rs`, offline, and
// `tests/github_live.rs`, the ignored supervised sandbox suite) can match on
// the crate's own error type.
pub mod error;
mod fonts;
mod fs;
mod fswatch;
mod git;
mod gitfast;
// Public for the same integration tests: they drive the *production* gh layer —
// against a scripted fake `gh` in the mandatory suite, and against the
// allowlisted sandbox repository in the ignored live suite.
pub mod github;
mod hooks;
mod mcp;
mod mcpinject;
mod model;
mod path_env;
mod persistence;
mod pets;
mod power;
mod procscan;
mod pty;
// Public so the resource-observability integration tests (`tests/`) can drive
// the monitor against real spawned processes through the crate's own API.
pub mod resources;
// Remote hosts: reading the user's own OpenSSH configuration today; the
// connection, inventory and remote PTY land on top of it.
mod ssh;
mod state;
// Execution-target identity (`local`, `ssh:<host>`) plus the fencing that stops
// a mutation prepared for one machine from running on another.
mod target;
mod updater;
mod usage;
mod which;
mod winproc;
mod worktreeclean;
mod worktreeloc;
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
    // Enrich `PATH` for a macOS GUI launch (Finder/Dock omit the login-shell
    // `PATH`, so Homebrew/npm/version-manager CLIs would otherwise be invisible
    // to agent/`gh`/editor detection and to PTY shells). Must run first, before
    // any child is spawned or any thread reads `PATH`. A no-op off macOS.
    crate::path_env::enrich_for_gui_launch();

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
            // Resolve the app data directory (the OS-specific one, unless
            // `UXNAN_DATA_DIR` points the process at a disposable profile) and
            // load (or default) the persisted state, then publish it as managed
            // state.
            let data_dir = crate::datadir::resolve(app.path().app_data_dir()?);
            // Arm post-mortem diagnostics before anything else can fail: this is
            // what turns "the app went black and I had to force-close it" from an
            // unanswerable report into a log line. Also reports whether the
            // previous session ever reached its clean exit path.
            crate::diagnostics::init(&data_dir, &crate::updater::app_version());
            crate::diagnostics::install_panic_hook();
            let persistence = PersistenceManager::new(&data_dir);
            let mut data = persistence.load().unwrap_or_else(|err| {
                let message = format!("failed to load persisted state ({err}); starting fresh");
                crate::diagnostics::log(crate::diagnostics::Level::Error, "persistence", &message);
                eprintln!("[uxnan-desktop] {message}");
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
            let resources = state.resources.clone();
            app.manage(state);

            // Resource observability sampler (`resources.rs`). Fully parked —
            // no timer, no process-table walks — until a consumer subscribes
            // (the backend popover) or the opt-in orphan sweep is enabled.
            crate::resources::spawn_collector(app.handle().clone(), resources);

            // Delete worktree folders a previous run moved aside but never
            // finished deleting (a crash, or the app closing mid-delete). Only
            // entries this app named, inside a trash folder inside a managed
            // root — so a leftover costs disk, never data.
            let sweep_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let roots = {
                    let state = sweep_handle.state::<AppState>();
                    crate::commands::managed_roots(&state).await
                };
                let swept = crate::worktreeclean::sweep_trash(&roots).await;
                // Also drop group folders left holding nothing but their marker:
                // a marker that outlives its repository is read as a live claim
                // by the next project of the same name.
                let pruned = crate::worktreeclean::prune_empty_groups(&roots).await;
                if swept > 0 || pruned > 0 {
                    crate::diagnostics::log(
                        crate::diagnostics::Level::Info,
                        "worktrees",
                        &format!(
                            "swept {swept} leftover worktree folder(s) and {pruned} empty group(s)"
                        ),
                    );
                }
            });

            // Upgrade cleanup: versions before the per-launch MCP registration
            // wrote a `uxnan-browser` server into each CLI's user-global config,
            // where it outlived the app and made agents launched *outside* uxnan
            // report a broken MCP server. Remove any that are still there (and any
            // stale per-window launch config). Removal-only and best-effort.
            let mcp_sweep_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    crate::mcpinject::sweep_legacy(&mcp_sweep_handle);
                })
                .await;
            });

            // Start the local agent hook server (Layer 1). On success, publish its
            // url + token (+ the endpoint-file path it writes to `<data>/hooks/`)
            // so `pty_create` can inject them into every terminal.
            let hook_handle = app.handle().clone();
            let hooks_dir = data_dir.join("hooks");
            let hooks_dir_for_server = hooks_dir.clone();
            let mcp_config_handle = hook_handle.clone();
            tauri::async_runtime::spawn(async move {
                let token = uuid::Uuid::new_v4().to_string();
                match crate::hooks::start(hook_handle, token, hooks_dir_for_server).await {
                    Ok(info) => {
                        // Write Claude Code's per-launch MCP config for this
                        // window now that the endpoint is known, so it is on disk
                        // before the first agent is launched (`mcpinject.rs`).
                        let endpoint = crate::mcpinject::mcp_endpoint(&info.url);
                        crate::mcpinject::ensure_claude_config(&mcp_config_handle, &endpoint);
                        *hook_slot.write().await = Some(info);
                    }
                    Err(err) => {
                        let message = format!("agent hook server failed to start: {err}");
                        crate::diagnostics::log(
                            crate::diagnostics::Level::Error,
                            "hooks",
                            &message,
                        );
                        eprintln!("[uxnan-desktop] {message}");
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
                    // (Claude Code, Codex, OpenCode, Pi, Grok, Antigravity, …) so precise states
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
                    let message = format!("hook scripts not installed at {hooks_dir:?}: {err}");
                    crate::diagnostics::log(crate::diagnostics::Level::Warn, "hooks", &message);
                    eprintln!("[uxnan-desktop] {message}");
                }
            }

            // Pause the git watcher while the window is unfocused, and take the
            // desktop pet window down with the main window — with the pet still
            // open the app would keep running, headless but for the pet, after
            // the main window is gone.
            if let Some(window) = app.get_webview_window("main") {
                let focused_for_event = focused.clone();
                let handle_for_close = app.handle().clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(is_focused) => {
                        focused_for_event.store(*is_focused, Ordering::Relaxed);
                    }
                    WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                        if let Some(pet) =
                            handle_for_close.get_webview_window(crate::commands::PET_WINDOW_LABEL)
                        {
                            let _ = pet.destroy();
                        }
                    }
                    _ => {}
                });
            }

            // Background git watcher: poll the watched worktree every 3 s (paused
            // when unfocused) and emit `git:status-changed` only when it changes.
            let handle = app.handle().clone();
            let focused_for_agent = focused.clone();
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
                    // One working-tree scan per tick: `status_with_summary`
                    // returns the file list, ahead/behind and HEAD from a single
                    // `git2` walk plus a ref lookup instead of two tree scans.
                    let (files, status, head) = crate::git::status_with_summary(&path)
                        .await
                        .unwrap_or_default();
                    let payload = GitStatusEvent {
                        path,
                        files,
                        ahead: status.ahead,
                        behind: status.behind,
                        head,
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
            // sidebar row + tab name — even one the user typed by hand. Paused
            // while the window is unfocused (like the git watcher); a re-scan
            // happens on the first tick after focus returns.
            let agent_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(2));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut sys = sysinfo::System::new();
                let mut last: std::collections::HashMap<String, Option<String>> =
                    std::collections::HashMap::new();
                loop {
                    interval.tick().await;
                    if !focused_for_agent.load(Ordering::Relaxed) {
                        continue;
                    }
                    let state = agent_handle.state::<AppState>();
                    let pids = state.pty.live_pids();
                    if pids.is_empty() {
                        last.clear();
                        continue;
                    }
                    let commands = state.agent_commands.read().await.clone();
                    // Refresh WITH command lines — the default refresh only gives
                    // the exe name (`node`), so node-shim agents (Codex/Pi/…)
                    // would never match without their `…/agent.js` argument. The
                    // scan is a blocking, syscall-heavy walk of the whole process
                    // table, so run it on a blocking thread (moving `sys` in and
                    // back out) instead of stalling this Tokio worker.
                    sys = tokio::task::spawn_blocking(move || {
                        sys.refresh_processes_specifics(
                            sysinfo::ProcessesToUpdate::All,
                            true,
                            sysinfo::ProcessRefreshKind::nothing()
                                .with_cmd(sysinfo::UpdateKind::Always),
                        );
                        sys
                    })
                    .await
                    .expect("agent scan task panicked");
                    let mut live = std::collections::HashSet::new();
                    for (pty_id, pid) in pids {
                        live.insert(pty_id.clone());
                        let command = crate::procscan::detect_agent(&sys, pid, &commands);
                        if last.get(&pty_id) != Some(&command) {
                            last.insert(pty_id.clone(), command.clone());
                            // Keep the resource monitor's terminal link in step,
                            // so that terminal's subtree is attributed to the
                            // agent (by kind) on the next resource sample.
                            state.resources.set_terminal_agent(&pty_id, command.clone());
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
            // Automations (spec 02f): the definition on disk and the OS task
            // always move together, so every mutation returns the resulting
            // scheduler status.
            automations::commands::automations_list,
            automations::commands::automations_save,
            automations::commands::automations_set_enabled,
            automations::commands::automations_delete,
            automations::commands::automations_seed_examples,
            automations::commands::automations_runs,
            automations::commands::automations_runs_dir,
            automations::commands::automations_run_now,
            automations::commands::automations_scheduler_status,
            automations::commands::automations_scheduler_supported,
            commands::get_app_state,
            commands::update_settings,
            commands::quick_commands_set,
            commands::pets_list,
            commands::pets_sheet,
            commands::pets_scan,
            commands::pets_codex_dir,
            commands::pets_import,
            commands::pets_delete,
            commands::pet_window_show,
            commands::pet_window_hide,
            commands::pet_focus_main,
            commands::ping,
            commands::resources_summary,
            commands::resources_subscribe,
            commands::resources_unsubscribe,
            commands::resources_set_policy,
            commands::resources_export,
            commands::usage_read,
            commands::usage_detect,
            commands::usage_codex_redeem_reset,
            commands::mcp_info,
            commands::pty_create,
            commands::pty_write,
            commands::pty_paste_submit,
            commands::pty_resize,
            commands::pty_close,
            commands::repo_add,
            commands::repo_remove,
            commands::repo_list,
            commands::repo_update,
            commands::repo_set_branch_icon,
            commands::repo_reorder,
            commands::repo_set_worktree_order,
            commands::repo_set_worktree_root,
            commands::repo_remote_owner,
            commands::repos_missing,
            commands::worktree_stale_scan,
            commands::worktree_prune,
            commands::branch_list,
            commands::git_identity,
            commands::worktree_preview_path,
            commands::worktree_cleanup_count,
            commands::worktree_cleanup_scan,
            commands::worktree_cleanup_sizes,
            commands::worktree_cleanup_remove,
            commands::worktree_create,
            commands::worktree_remove,
            commands::worktree_list,
            commands::worktree_status,
            commands::branch_integrated,
            commands::ssh_config_hosts,
            commands::ssh_config_resolve,
            commands::ssh_hosts_list,
            commands::ssh_host_add,
            commands::ssh_host_remove,
            commands::ssh_host_probe,
            commands::ssh_host_trust,
            commands::ssh_host_connect,
            commands::ssh_host_disconnect,
            commands::ssh_hosts_connected,
            commands::ssh_hosts_resumable,
            commands::ssh_host_inventory,
            commands::ssh_browse_dirs,
            commands::ssh_git_status,
            commands::ssh_git_review,
            commands::ssh_git_diff,
            commands::ssh_git_log,
            commands::ssh_git_show,
            commands::ssh_git_stage,
            commands::ssh_git_unstage,
            commands::ssh_git_stage_all,
            commands::ssh_git_unstage_all,
            commands::ssh_git_discard,
            commands::ssh_git_apply,
            commands::ssh_git_commit,
            commands::ssh_fs_list,
            commands::ssh_fs_read,
            commands::ssh_fs_write,
            commands::ssh_repo_add,
            commands::browse_dirs,
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::fs_read_data_url,
            commands::fs_write_file,
            commands::fs_path_exists,
            commands::term_buffers_get,
            commands::term_buffers_set,
            commands::fs_rename,
            commands::fs_create_file,
            commands::fs_create_dir,
            commands::fs_delete,
            commands::fs_duplicate,
            commands::fs_search_files,
            commands::fs_search_content,
            commands::zero_session,
            commands::image_fetch_data_url,
            commands::fs_set_watch,
            commands::browse_set_watch,
            commands::reveal_path,
            commands::editors_detect,
            commands::native_text_editor,
            commands::open_in_editor,
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
            commands::set_orchestration_runs,
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
            commands::git_fetch,
            commands::git_push,
            commands::git_pull,
            commands::git_generate_commit_message,
            commands::generate_conversation_title,
            commands::ai_commit_agents,
            commands::ai_commit_models,
            commands::agent_run_headless,
            commands::set_agent_commands,
            commands::get_hook_info,
            commands::agent_states,
            commands::set_prevent_sleep,
            commands::get_hook_install,
            commands::list_agent_hooks,
            commands::install_agent_hooks,
            commands::uninstall_agent_hooks,
            commands::render_agent_hooks_config,
            commands::install_all_hooks,
            commands::get_hook_scripts,
            updater::app_version,
            updater::updater_check,
            updater::updater_download,
            updater::updater_staged,
            updater::updater_discard_staged,
            updater::updater_install,
            commands::github_status,
            commands::github_repo_context,
            commands::github_work_item_kind,
            commands::github_pr_list,
            commands::github_pr_view,
            commands::github_pr_diff,
            commands::github_pr_timeline,
            commands::github_pr_create,
            commands::github_branches,
            commands::github_merge_info,
            commands::github_pr_update_branch,
            commands::github_pr_ready,
            commands::github_pr_disable_auto_merge,
            commands::github_pr_edit,
            commands::github_issue_edit,
            commands::github_pr_add_reviewers,
            commands::github_labels,
            commands::github_assignees,
            commands::github_pr_comment,
            commands::github_pr_review,
            commands::github_pr_close,
            commands::github_pr_reopen,
            commands::github_pr_merge,
            commands::github_pr_checkout,
            commands::github_issue_list,
            commands::github_issue_view,
            commands::github_issue_comment,
            commands::github_issue_close,
            commands::github_issue_reopen,
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
            commands::diagnostics_log,
            commands::diagnostics_report,
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
                // The browser MCP needs no teardown: it is registered per launch,
                // inside the process uxnan spawns, and never in a config file the
                // user keeps — so an unclean exit leaves nothing behind either
                // (see `mcpinject.rs`).
                //
                // Last: disarm the session marker. Reaching this point is what
                // makes the next launch report a *clean* previous session, so it
                // runs after the other teardown rather than before it.
                if let Some(sink) = crate::diagnostics::sink() {
                    sink.mark_clean_shutdown();
                }
            }
        });
}
