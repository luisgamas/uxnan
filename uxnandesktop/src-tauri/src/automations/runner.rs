//! The headless runner — the process that actually executes an automation.
//!
//! This is the whole point of the feature: `main.rs` inspects its arguments
//! **before** Tauri builds a window, and when it sees `--automation-run <id>` it
//! takes this path instead — a plain Tokio program with no webview, no window
//! and (on Windows, where the binary is a GUI subsystem executable) no console
//! flash. That is what lets an automation fire while uxnan is closed.
//!
//! There is exactly **one** execution path: the OS scheduler and the app's
//! "Run now" both spawn this same subprocess, so scheduled and manual runs can
//! never drift apart in behavior.
//!
//! Order of business for a run: load and validate → refuse to pile up on a live
//! run (the overlap policy) → optional precondition gate → optional per-run
//! worktree → execute the graph → prune old history. Every outcome, including
//! every refusal, is written to the run record — an execution nobody watched
//! must still be able to explain itself afterwards.

use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

use super::store::AutomationStore;
use super::{graph, now_ms, validate, Automation, AutomationRun, Overlap, RunStatus, RunTrigger};

/// Exit code: the run finished, or was skipped for a legitimate reason.
pub const EXIT_OK: i32 = 0;
/// Exit code: the run executed but a step failed.
pub const EXIT_RUN_FAILED: i32 = 1;
/// Exit code: the automation could not be run at all (missing, invalid, disabled).
pub const EXIT_NOT_RUNNABLE: i32 = 2;

/// What the runner was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunnerArgs {
    pub automation_id: String,
    pub trigger: RunTrigger,
}

/// The flag that switches the binary into runner mode.
const FLAG: &str = "--automation-run";
const TRIGGER_FLAG: &str = "--trigger";

/// Recognize runner mode from the command line, or `None` to start the app
/// normally. Kept pure so the argument contract is unit-tested rather than
/// discovered in production.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Option<RunnerArgs> {
    let args: Vec<String> = args.into_iter().collect();
    let idx = args.iter().position(|a| a == FLAG)?;
    let automation_id = args.get(idx + 1)?.trim().to_string();
    if automation_id.is_empty() || automation_id.starts_with("--") {
        return None;
    }
    let trigger = args
        .iter()
        .position(|a| a == TRIGGER_FLAG)
        .and_then(|i| args.get(i + 1))
        .map(|v| {
            if v.eq_ignore_ascii_case("manual") {
                RunTrigger::Manual
            } else {
                RunTrigger::Scheduled
            }
        })
        .unwrap_or(RunTrigger::Scheduled);
    Some(RunnerArgs {
        automation_id,
        trigger,
    })
}

/// Entry point from `main`. Owns its Tokio runtime (the app's is never built in
/// this mode) and returns the process exit code.
pub fn run_blocking(args: RunnerArgs) -> i32 {
    // A run launched by the OS scheduler inherits an even barer environment than
    // a GUI launch does (launchd hands a job the minimal `/usr/bin:/bin:…`), so
    // every agent CLI would resolve as "not installed". Same fix the app applies
    // at startup, and just as necessary here — this call is the difference
    // between a scheduled run working and failing at 3 AM with nobody watching.
    crate::path_env::enrich_for_gui_launch();

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("uxnan: could not start the automation runtime: {e}");
            return EXIT_NOT_RUNNABLE;
        }
    };
    runtime.block_on(execute(args))
}

async fn execute(args: RunnerArgs) -> i32 {
    let store = match AutomationStore::open_default() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("uxnan: {e}");
            return EXIT_NOT_RUNNABLE;
        }
    };

    let automation = match store.get(&args.automation_id) {
        Ok(Some(a)) => a,
        Ok(None) => {
            eprintln!(
                "uxnan: automation '{}' no longer exists",
                args.automation_id
            );
            return EXIT_NOT_RUNNABLE;
        }
        Err(e) => {
            eprintln!("uxnan: {e}");
            return EXIT_NOT_RUNNABLE;
        }
    };

    // A disabled automation may still have a live OS task (the user paused it,
    // or removal of the task failed) — refusing here is the backstop.
    if !automation.enabled && args.trigger == RunTrigger::Scheduled {
        return EXIT_OK;
    }

    let errors = validate(&automation);
    if !errors.is_empty() {
        let run_id = new_run_id();
        let mut run = AutomationRun::start(&automation, run_id, args.trigger);
        finish(
            &store,
            &mut run,
            RunStatus::SkippedUnavailable,
            Some(errors.join(" ")),
        );
        return EXIT_NOT_RUNNABLE;
    }

    let run_id = new_run_id();
    let log = store.log_path(&run_id);
    let mut run = AutomationRun::start(&automation, run_id.clone(), args.trigger);
    log_line(
        &log,
        &format!(
            "start {} ({})",
            automation.name,
            automation.schedule.describe()
        ),
    );

    // Never pile runs on top of each other unless the policy asks for it.
    if automation.policy.overlap == Overlap::Skip
        && store
            .has_live_run(&automation.id, automation.policy.max_run_minutes, now_ms())
            .unwrap_or(false)
    {
        log_line(&log, "skipped: a previous run is still in flight");
        finish(
            &store,
            &mut run,
            RunStatus::SkippedOverlap,
            Some("a previous run of this automation was still running".into()),
        );
        return EXIT_OK;
    }

    if !std::path::Path::new(&automation.working_dir).is_dir() {
        log_line(&log, "skipped: the working folder is gone");
        finish(
            &store,
            &mut run,
            RunStatus::SkippedUnavailable,
            Some(format!(
                "the working folder no longer exists: {}",
                automation.working_dir
            )),
        );
        return EXIT_NOT_RUNNABLE;
    }

    let _ = store.write_run(&run);

    // The gate: a cheap shell command decides whether this run is worth an agent.
    if let Some(pre) = &automation.policy.precondition {
        match graph::run_precondition(&pre.command, pre.timeout_seconds, &automation.working_dir)
            .await
        {
            Ok(result) => {
                let passed = result.passed();
                log_line(
                    &log,
                    &format!(
                        "precondition exit={:?} timedOut={}",
                        result.exit_code, result.timed_out
                    ),
                );
                run.precondition = Some(result);
                if !passed {
                    finish(
                        &store,
                        &mut run,
                        RunStatus::SkippedPrecondition,
                        Some("the precondition did not pass".into()),
                    );
                    return EXIT_OK;
                }
            }
            Err(e) => {
                log_line(&log, &format!("precondition error: {e}"));
                finish(
                    &store,
                    &mut run,
                    RunStatus::SkippedUnavailable,
                    Some(e.to_string()),
                );
                return EXIT_NOT_RUNNABLE;
            }
        }
    }

    // Optional isolation: give the run its own worktree so unattended work never
    // touches the tree the user is in.
    let mut cwd = automation.working_dir.clone();
    if automation.worktree_per_run {
        match create_run_worktree(&store, &automation, &run_id).await {
            Ok(path) => {
                log_line(&log, &format!("worktree {path}"));
                run.worktree_path = Some(path.clone());
                cwd = path;
            }
            Err(e) => {
                log_line(&log, &format!("worktree failed: {e}"));
                finish(&store, &mut run, RunStatus::SkippedUnavailable, Some(e));
                return EXIT_NOT_RUNNABLE;
            }
        }
    }
    seed_codex_trust(&automation, &cwd, &log);
    let _ = store.write_run(&run);

    let prev_vars = graph::previous_run_vars(&store, &automation.id);
    graph::execute(&store, &automation, &mut run, &prev_vars, &cwd).await;
    log_line(&log, &format!("finished {:?}", run.status));

    // FOR-DEV: notify the user natively when a run fails. The runner has no
    // Tauri app handle, so it needs a per-OS notification path of its own
    // (`notify.rs` is webview-side). Until then the outcome is visible in the
    // app's Automations section. See FOR-DEV.md.
    let _ = store.prune_runs(&automation.id, automation.policy.keep_runs);

    if run.status == RunStatus::Failed {
        EXIT_RUN_FAILED
    } else {
        EXIT_OK
    }
}

/// Pre-seed Codex's per-folder trust for the run's directory when the graph uses
/// Codex at all.
///
/// Codex refuses to execute in a folder it doesn't trust ("Not inside a trusted
/// directory"), and it asks interactively — which nobody can answer at 3 AM, so
/// every scheduled Codex step would fail forever. The app already seeds the same
/// trust when it launches Codex into a workspace ([`crate::mcpinject`]); doing it
/// here keeps the two paths consistent. The underlying write is non-destructive
/// and idempotent: an explicit decision the user already made for this folder —
/// including "untrusted" — is left alone.
fn seed_codex_trust(automation: &Automation, cwd: &str, log: &std::path::Path) {
    if !automation.steps.iter().any(|s| s.agent == "codex") {
        return;
    }
    let Some(home) = crate::agent_hooks::home_dir() else {
        return;
    };
    let config = home.join(".codex").join("config.toml");
    if let Err(e) = crate::codex_trust::ensure_project_trust(&config, std::path::Path::new(cwd)) {
        // Best-effort: Codex simply falls back to its own prompt/refusal, which
        // the run records like any other step failure.
        log_line(log, &format!("codex trust seed skipped: {e}"));
    }
}

/// Close a run that never reached the graph, recording *why*.
fn finish(
    store: &AutomationStore,
    run: &mut AutomationRun,
    status: RunStatus,
    error: Option<String>,
) {
    run.status = status;
    run.error = error;
    run.finished_at = Some(now_ms());
    let _ = store.write_run(run);
}

/// Create the run's own worktree next to the store, on a branch named after the
/// automation so the work is easy to find and review later.
///
/// FOR-DEV: these worktrees are intentionally left in place (you want to inspect
/// what an unattended run did), so nothing garbage-collects them yet — pruning a
/// run record should also offer to remove its worktree. See FOR-DEV.md.
async fn create_run_worktree(
    store: &AutomationStore,
    automation: &Automation,
    run_id: &str,
) -> Result<String, String> {
    let dir: PathBuf = store
        .watch_root()
        .parent()
        .unwrap_or(&store.watch_root())
        .join("worktrees")
        .join(&automation.id)
        .join(run_id);
    let path = dir.to_string_lossy().to_string();
    let branch = format!("automation/{}-{}", slug(&automation.name), short(run_id));
    let base = automation
        .base_branch
        .clone()
        .unwrap_or_else(|| "HEAD".into());

    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut cmd = crate::winproc::command("git");
    cmd.args(["-C", &automation.working_dir])
        .args(["worktree", "add", "-b", &branch, &path, &base])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = cmd
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?
        .wait_with_output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "git could not create the run worktree".into()
        } else {
            detail
        });
    }
    Ok(path)
}

/// Branch-safe form of an automation name.
fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "automation".into()
    } else {
        trimmed.chars().take(40).collect()
    }
}

/// First segment of a uuid, enough to disambiguate a branch name.
fn short(run_id: &str) -> String {
    run_id.split('-').next().unwrap_or(run_id).to_string()
}

fn new_run_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Append one line to the run log. Best-effort by design: losing a log line must
/// never change what the run does.
fn log_line(path: &std::path::Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "[{}] {message}", now_ms());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn normal_startup_is_not_runner_mode() {
        assert!(parse_args(argv(&[])).is_none());
        assert!(parse_args(argv(&["--some-tauri-flag"])).is_none());
    }

    #[test]
    fn the_flag_selects_an_automation_and_defaults_to_scheduled() {
        let args = parse_args(argv(&["--automation-run", "a1"])).unwrap();
        assert_eq!(args.automation_id, "a1");
        assert_eq!(args.trigger, RunTrigger::Scheduled);
    }

    #[test]
    fn manual_runs_are_tagged_as_such() {
        let args = parse_args(argv(&["--automation-run", "a1", "--trigger", "manual"])).unwrap();
        assert_eq!(args.trigger, RunTrigger::Manual);
        // Anything else is a scheduled run — the OS never passes junk, but a
        // typo must not silently become "manual".
        let args = parse_args(argv(&["--automation-run", "a1", "--trigger", "nonsense"])).unwrap();
        assert_eq!(args.trigger, RunTrigger::Scheduled);
    }

    #[test]
    fn a_missing_or_malformed_id_is_refused() {
        // Better to start the app than to run "--trigger" as an automation id.
        assert!(parse_args(argv(&["--automation-run"])).is_none());
        assert!(parse_args(argv(&["--automation-run", "--trigger"])).is_none());
        assert!(parse_args(argv(&["--automation-run", "   "])).is_none());
    }

    #[test]
    fn slugs_are_branch_safe() {
        assert_eq!(slug("Nightly triage"), "nightly-triage");
        assert_eq!(slug("  Revisión de PR  "), "revisi-n-de-pr");
        assert_eq!(slug("***"), "automation");
        assert!(slug(&"x".repeat(100)).len() <= 40);
    }

    #[test]
    fn short_run_id_takes_the_first_uuid_segment() {
        assert_eq!(short("6f1c2b3a-dead-beef-0000-111122223333"), "6f1c2b3a");
        assert_eq!(short("plain"), "plain");
    }
}
