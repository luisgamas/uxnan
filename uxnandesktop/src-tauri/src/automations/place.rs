//! Where an automation's work happens: this machine, or a host's engine.
//!
//! A run is one sequence — validate, the overlap policy, the folder, the gate,
//! the per-run worktree, the step graph, the history — whichever machine its
//! folder is on (`runner::run`). What differs is only *who does the work*, and
//! that is this type: here, the runner spawns the processes itself; on a host,
//! the same workspace-engine code does it there, asked over the engine's
//! channel (`HostEngine::precondition`, `agent_run`, `git`). A host's run is
//! never started on a path of this machine — a host's folder is not this
//! machine's folder, even when the two spell the same.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use uxnan_host_protocol::{FsCall, GitCall};
use uxnan_workspace_engine::agentrun::HeadlessResult;
use uxnan_workspace_engine::precondition::PreconditionResult;
use uxnan_workspace_engine::worktreeloc::{CreateSpec, WorktreeLocationMode};

use super::store::AutomationStore;
use super::Automation;
use crate::error::AppError;
use crate::ssh::engine::HostEngine;

/// The machine a run works on.
#[derive(Clone)]
pub enum Place {
    /// This machine: the runner subprocess spawns everything itself.
    Here,
    /// A connected host, through its engine — what the app does in process
    /// for a run the runner handed it (`runner::handoff`).
    Host {
        host_id: String,
        engine: Arc<HostEngine>,
    },
}

/// One agent step, as the graph hands it to the place that runs it.
pub struct StepRun<'a> {
    pub agent: &'a str,
    pub model: &'a str,
    pub prompt: &'a str,
    pub cwd: &'a str,
    pub timeout_ms: Option<u64>,
    pub autonomous: bool,
    pub job: &'a str,
    pub memory_limit_mb: u64,
}

impl Place {
    /// Whether `dir` is a folder on this place's machine.
    pub async fn has_folder(&self, dir: &str) -> bool {
        match self {
            Place::Here => std::path::Path::new(dir).is_dir(),
            Place::Host { engine, .. } => engine
                .fs::<serde_json::Value>(FsCall::List {
                    path: dir.to_string(),
                })
                .await
                .is_ok(),
        }
    }

    /// Run the gate in `cwd`, in this place's shell.
    pub async fn precondition(
        &self,
        command: &str,
        timeout_seconds: u32,
        cwd: &str,
    ) -> Result<PreconditionResult, AppError> {
        match self {
            Place::Here => super::graph::run_precondition(command, timeout_seconds, cwd).await,
            Place::Host { engine, .. } => engine.precondition(command, timeout_seconds, cwd).await,
        }
    }

    /// Give the run its own worktree on a branch named after the automation,
    /// so the work is easy to find and review later. Here it goes next to the
    /// store; on a host, under that machine's managed worktree root — the
    /// store is on this machine, so it cannot hold a host's checkout.
    ///
    /// FOR-DEV: these worktrees are intentionally left in place (you want to
    /// inspect what an unattended run did), so nothing garbage-collects them yet
    /// — pruning a run record should also offer to remove its worktree. See
    /// FOR-DEV.md.
    pub async fn create_run_worktree(
        &self,
        store: &AutomationStore,
        automation: &Automation,
        run_id: &str,
    ) -> Result<String, String> {
        let branch = format!("automation/{}-{}", slug(&automation.name), short(run_id));
        match self {
            Place::Here => {
                let dir: PathBuf = store
                    .watch_root()
                    .parent()
                    .unwrap_or(&store.watch_root())
                    .join("worktrees")
                    .join(&automation.id)
                    .join(run_id);
                local_worktree(automation, &dir, &branch).await
            }
            Place::Host { engine, .. } => {
                let spec = CreateSpec {
                    branch,
                    base: automation.base_branch.clone(),
                    from_existing: false,
                    path: None,
                };
                let entry: uxnan_workspace_engine::git::WorktreeEntry = engine
                    .git(GitCall::AddWorktree {
                        path: automation.working_dir.clone(),
                        spec: serde_json::to_value(spec).map_err(|e| e.to_string())?,
                        mode: serde_json::to_value(WorktreeLocationMode::Managed)
                            .map_err(|e| e.to_string())?,
                        root: None,
                    })
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(entry.path)
            }
        }
    }

    /// Run one agent step.
    pub async fn run_step(
        &self,
        step: StepRun<'_>,
    ) -> Result<HeadlessResult, uxnan_workspace_engine::Error> {
        match self {
            Place::Here => {
                crate::agentrun::run_headless(
                    step.agent,
                    step.model,
                    step.prompt,
                    step.cwd,
                    step.timeout_ms,
                    step.autonomous,
                    // A step runs its model as configured, effort included.
                    &[],
                    Some(step.job),
                    step.memory_limit_mb,
                )
                .await
            }
            Place::Host { engine, .. } => engine
                .agent_run(
                    step.agent,
                    step.model,
                    step.prompt,
                    step.cwd,
                    step.timeout_ms,
                    step.autonomous,
                    &[],
                    Some(step.job),
                    step.memory_limit_mb,
                )
                .await
                .map_err(to_engine_error),
        }
    }

    /// Where this place's steps are counted for the concurrency budget. Here,
    /// the ledger every process on this machine shares; on a host, one of that
    /// host's own — its agents use its processors, not this machine's, so they
    /// neither take this machine's slots nor wait for them.
    pub fn ledger_dir(&self, local: PathBuf) -> PathBuf {
        match self {
            Place::Here => local,
            Place::Host { host_id, .. } => local.join("hosts").join(host_id),
        }
    }

    /// The budget a step is admitted under here: this machine's free memory
    /// says nothing about a host's, so a host's steps are bounded by the
    /// concurrency alone.
    pub fn admission(&self, policy: crate::budget::Policy) -> crate::budget::Policy {
        match self {
            Place::Here => policy,
            Place::Host { .. } => crate::budget::Policy {
                min_free_mb: 0,
                ..policy
            },
        }
    }

    /// Whether this place is this machine.
    pub fn is_here(&self) -> bool {
        matches!(self, Place::Here)
    }
}

/// An app error from a host's engine, as the engine's own — what the graph
/// matches a cancelled step on.
fn to_engine_error(e: AppError) -> uxnan_workspace_engine::Error {
    match e {
        AppError::Cancelled => uxnan_workspace_engine::Error::Cancelled,
        AppError::Agent(m) => uxnan_workspace_engine::Error::Agent(m),
        other => uxnan_workspace_engine::Error::Invalid(other.to_string()),
    }
}

/// `git worktree add` on this machine, into `dir`.
async fn local_worktree(
    automation: &Automation,
    dir: &std::path::Path,
    branch: &str,
) -> Result<String, String> {
    let path = dir.to_string_lossy().to_string();
    let base = automation
        .base_branch
        .clone()
        .unwrap_or_else(|| "HEAD".into());

    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut cmd = crate::winproc::command("git");
    cmd.args(["-C", &automation.working_dir])
        .args(["worktree", "add", "-b", branch, &path, &base])
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
pub(crate) fn slug(name: &str) -> String {
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
pub(crate) fn short(run_id: &str) -> String {
    run_id.split('-').next().unwrap_or(run_id).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn this_machine_keeps_the_shared_ledger_and_the_whole_policy() {
        let local = std::path::PathBuf::from("/data");
        assert_eq!(Place::Here.ledger_dir(local.clone()), local);
        let policy = crate::budget::Policy {
            capacity: 3,
            min_free_mb: 2048,
            wait: std::time::Duration::from_secs(1),
        };
        assert_eq!(Place::Here.admission(policy), policy);
    }
}
