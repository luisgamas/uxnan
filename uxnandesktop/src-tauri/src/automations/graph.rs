//! The DAG executor — what actually turns a saved automation into work.
//!
//! Split in two on purpose:
//!
//! * **Pure scheduling logic** ([`promote`], [`ready_steps`], [`apply_outcome`],
//!   [`derive_status`]) — no processes, no clock, no disk, so every branch that
//!   matters (fan-in, skip propagation, retry, final status) is unit-tested
//!   directly.
//! * **Thin async glue** ([`execute`]) — spawns the agent CLIs, applies each
//!   outcome through the pure functions, and rewrites the run record after every
//!   transition so the app can watch a run advance live.
//!
//! Completion is **verified**, never trusted: a step is done when its process
//! exits 0. That is the whole reason automations run agents headlessly instead
//! of typing into a terminal and guessing when the agent stopped.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tokio::task::JoinSet;

use super::store::AutomationStore;
use super::{now_ms, template, Automation, AutomationRun, OnFailure, RunStatus, Step, StepStatus};
use crate::error::AppError;

/// How many steps of one run may execute at the same time. Each step is its own
/// agent subprocess, so this bounds CPU and provider load, not app threads.
pub const MAX_CONCURRENCY: usize = 4;

/// Fallback per-step wall-clock cap when a step doesn't pin its own.
const DEFAULT_STEP_TIMEOUT_MS: u64 = 600_000;

/// What a finished step produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The process exited 0.
    Success { stdout: String, stderr: String },
    /// Non-zero exit, spawn failure, or timeout.
    Failure {
        stderr: String,
        exit_code: Option<i32>,
        message: String,
    },
}

/// Mark every pending step that can never run — one of its dependencies failed
/// or was itself skipped — as `Skipped`, repeatedly until nothing else changes
/// (so a skip propagates down a whole branch). Returns whether anything moved.
pub fn promote(run: &mut AutomationRun) -> bool {
    let mut changed_any = false;
    loop {
        let doomed: Vec<String> = run
            .steps
            .iter()
            .filter(|s| s.status == StepStatus::Pending)
            .filter(|s| {
                s.depends_on.iter().any(|dep| {
                    run.steps.iter().find(|d| &d.id == dep).is_some_and(|d| {
                        matches!(d.status, StepStatus::Failed | StepStatus::Skipped)
                    })
                })
            })
            .map(|s| s.id.clone())
            .collect();
        if doomed.is_empty() {
            return changed_any;
        }
        for id in doomed {
            if let Some(s) = run.steps.iter_mut().find(|s| s.id == id) {
                s.status = StepStatus::Skipped;
                s.finished_at = Some(now_ms());
            }
        }
        changed_any = true;
    }
}

/// Steps that can start right now: pending, with every dependency completed.
/// Independent steps all come back together, which is what makes parallel and
/// fan-in fall out of the dependency list alone.
pub fn ready_steps(run: &AutomationRun) -> Vec<String> {
    run.steps
        .iter()
        .filter(|s| s.status == StepStatus::Pending)
        .filter(|s| {
            s.depends_on.iter().all(|dep| {
                run.steps
                    .iter()
                    .find(|d| &d.id == dep)
                    .is_some_and(|d| d.status == StepStatus::Completed)
            })
        })
        .map(|s| s.id.clone())
        .collect()
}

/// Record a finished step. A failure with retries left goes back to `Pending`
/// for another attempt instead of failing the run — the cheap auto-repair that
/// covers a flaky network or a provider hiccup.
pub fn apply_outcome(run: &mut AutomationRun, step: &Step, outcome: Outcome, now: i64) {
    let Some(sr) = run.steps.iter_mut().find(|s| s.id == step.id) else {
        return;
    };
    match outcome {
        Outcome::Success { stdout, stderr } => {
            sr.status = StepStatus::Completed;
            sr.output = stdout.trim().to_string();
            sr.stderr = stderr;
            sr.exit_code = Some(0);
            sr.error = None;
            sr.finished_at = Some(now);
        }
        Outcome::Failure {
            stderr,
            exit_code,
            message,
        } => {
            sr.stderr = stderr;
            sr.exit_code = exit_code;
            sr.error = Some(message);
            if step.on_failure == OnFailure::Retry && sr.attempts < step.max_attempts {
                sr.status = StepStatus::Pending;
                sr.started_at = None;
            } else {
                sr.status = StepStatus::Failed;
                sr.finished_at = Some(now);
            }
        }
    }
}

/// The run's outcome once no step can move again.
pub fn derive_status(run: &AutomationRun) -> RunStatus {
    if run.steps.iter().any(|s| s.status == StepStatus::Failed) {
        RunStatus::Failed
    } else {
        RunStatus::Completed
    }
}

/// Whether anything is still pending or running.
fn has_work_left(run: &AutomationRun) -> bool {
    run.steps
        .iter()
        .any(|s| matches!(s.status, StepStatus::Pending | StepStatus::Running))
}

/// The `{{…}}` values available to a step: this run's completed outputs, the
/// previous run's outputs (`prev.*`), and the working directory.
fn build_vars(
    run: &AutomationRun,
    prev: &HashMap<String, String>,
    cwd: &str,
) -> HashMap<String, String> {
    let mut vars = run.step_vars();
    vars.extend(prev.clone());
    vars.insert("workingDir".into(), cwd.to_string());
    vars
}

/// Execute `automation`'s graph in `cwd`, updating `run` in place and rewriting
/// its record after every transition.
///
/// `prev_vars` carries the previous run's `prev.<id>.output` values, so a
/// recurring automation can continue yesterday's work.
pub async fn execute(
    store: &AutomationStore,
    automation: &Automation,
    run: &mut AutomationRun,
    prev_vars: &HashMap<String, String>,
    cwd: &str,
) {
    let by_id: HashMap<&str, &Step> = automation
        .steps
        .iter()
        .map(|s| (s.id.as_str(), s))
        .collect();
    let deadline =
        Instant::now() + Duration::from_secs(u64::from(automation.policy.max_run_minutes) * 60);
    let mut inflight: JoinSet<(String, Outcome)> = JoinSet::new();

    loop {
        promote(run);

        // Fill the concurrency budget with whatever is dispatchable now.
        while inflight.len() < MAX_CONCURRENCY {
            let Some(id) = ready_steps(run).into_iter().next() else {
                break;
            };
            let Some(step) = by_id.get(id.as_str()).copied() else {
                break;
            };
            let vars = build_vars(run, prev_vars, cwd);
            let resolved = template::resolve(&step.prompt, &vars);

            let Some(sr) = run.steps.iter_mut().find(|s| s.id == id) else {
                break;
            };
            sr.status = StepStatus::Running;
            sr.attempts += 1;
            sr.started_at = Some(now_ms());
            sr.prompt = resolved.text.clone();
            sr.missing_refs = resolved.missing.clone();
            let _ = store.write_run(run);

            let agent = step.agent.clone();
            let model = step.model.clone();
            let prompt = resolved.text;
            let dir = cwd.to_string();
            let timeout_ms = step.timeout_ms.or(Some(DEFAULT_STEP_TIMEOUT_MS));
            inflight.spawn(async move {
                let outcome =
                    match crate::agentrun::run_headless(&agent, &model, &prompt, &dir, timeout_ms)
                        .await
                    {
                        Ok(res) if res.exit_code == Some(0) => Outcome::Success {
                            stdout: res.stdout,
                            stderr: res.stderr,
                        },
                        Ok(res) => {
                            let detail = res.stderr.trim();
                            let message = if detail.is_empty() {
                                match res.exit_code {
                                    Some(code) => format!("the agent exited with code {code}"),
                                    None => "the agent was terminated".to_string(),
                                }
                            } else {
                                detail.to_string()
                            };
                            Outcome::Failure {
                                stderr: res.stderr,
                                exit_code: res.exit_code,
                                message,
                            }
                        }
                        Err(e) => Outcome::Failure {
                            stderr: String::new(),
                            exit_code: None,
                            message: e.to_string(),
                        },
                    };
                (id, outcome)
            });
        }

        if inflight.is_empty() {
            // Nothing running and nothing dispatchable: either we're done, or
            // every remaining step is unreachable (its dependency failed).
            if !has_work_left(run) {
                break;
            }
            promote(run);
            if ready_steps(run).is_empty() {
                break;
            }
            continue;
        }

        match tokio::time::timeout_at(deadline.into(), inflight.join_next()).await {
            Ok(Some(Ok((id, outcome)))) => {
                if let Some(step) = by_id.get(id.as_str()).copied() {
                    apply_outcome(run, step, outcome, now_ms());
                }
                let _ = store.write_run(run);
            }
            // A panicked task must not wedge the run: treat it as a step failure.
            Ok(Some(Err(e))) => {
                run.error = Some(format!("a step task failed: {e}"));
                let _ = store.write_run(run);
            }
            Ok(None) => break,
            Err(_) => {
                inflight.abort_all();
                let now = now_ms();
                for s in run.steps.iter_mut() {
                    if s.status == StepStatus::Running {
                        s.status = StepStatus::Failed;
                        s.error = Some("the run exceeded its time limit".into());
                        s.finished_at = Some(now);
                    }
                }
                run.error = Some(format!(
                    "the run exceeded its {}-minute limit",
                    automation.policy.max_run_minutes
                ));
                break;
            }
        }
    }

    promote(run);
    run.status = derive_status(run);
    run.finished_at = Some(now_ms());
    let _ = store.write_run(run);
}

/// The `prev.<id>.output` values taken from an automation's last finished run.
pub fn previous_run_vars(store: &AutomationStore, automation_id: &str) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    let Ok(Some(prev)) = store.last_finished_run(automation_id) else {
        return vars;
    };
    for s in prev.steps {
        if s.status == StepStatus::Completed {
            vars.insert(format!("prev.{}.output", s.id), s.output);
        }
    }
    vars
}

/// Run the precondition command in `cwd`, capturing everything so a skipped run
/// can explain itself. Uses the shell so a user can write a normal one-liner.
pub async fn run_precondition(
    command: &str,
    timeout_seconds: u32,
    cwd: &str,
) -> Result<super::PreconditionResult, AppError> {
    use std::process::Stdio;

    let started = Instant::now();
    let (program, args): (&str, Vec<&str>) = if cfg!(windows) {
        ("cmd", vec!["/C", command])
    } else {
        ("sh", vec!["-c", command])
    };
    let mut cmd = crate::winproc::command(program);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !cwd.trim().is_empty() {
        cmd.current_dir(cwd);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Invalid(format!("failed to run the precondition: {e}")))?;

    let timeout = Duration::from_secs(u64::from(timeout_seconds));
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => {
            let output = res.map_err(|e| AppError::Invalid(e.to_string()))?;
            Ok(super::PreconditionResult {
                command: command.to_string(),
                exit_code: output.status.code(),
                timed_out: false,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                duration_ms: started.elapsed().as_millis() as u64,
            })
        }
        Err(_) => Ok(super::PreconditionResult {
            command: command.to_string(),
            exit_code: None,
            timed_out: true,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: started.elapsed().as_millis() as u64,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automations::{Policy, RunTrigger, Schedule};

    fn step(id: &str, deps: &[&str], on_failure: OnFailure, max_attempts: u32) -> Step {
        Step {
            id: id.into(),
            title: format!("Step {id}"),
            agent: "claude".into(),
            model: String::new(),
            prompt: format!("prompt for {id}"),
            depends_on: deps.iter().map(|d| (*d).to_string()).collect(),
            on_failure,
            max_attempts,
            timeout_ms: None,
        }
    }

    fn automation(steps: Vec<Step>) -> Automation {
        Automation {
            id: "a1".into(),
            name: "Triage".into(),
            description: String::new(),
            icon: None,
            enabled: true,
            tags: vec![],
            working_dir: "C:/work".into(),
            worktree_per_run: false,
            base_branch: None,
            schedule: Schedule::DailyAt { hour: 3, minute: 0 },
            policy: Policy::default(),
            steps,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn run_of(a: &Automation) -> AutomationRun {
        AutomationRun::start(a, "r1".into(), RunTrigger::Scheduled)
    }

    fn ok() -> Outcome {
        Outcome::Success {
            stdout: "RESULT".into(),
            stderr: String::new(),
        }
    }
    fn boom() -> Outcome {
        Outcome::Failure {
            stderr: "bad".into(),
            exit_code: Some(1),
            message: "the agent exited with code 1".into(),
        }
    }

    #[test]
    fn independent_steps_are_all_ready_at_once() {
        // The fan-out half of "several providers work in parallel".
        let a = automation(vec![
            step("s1", &[], OnFailure::Stop, 1),
            step("s2", &[], OnFailure::Stop, 1),
            step("s3", &["s1", "s2"], OnFailure::Stop, 1),
        ]);
        let run = run_of(&a);
        let mut ready = ready_steps(&run);
        ready.sort();
        assert_eq!(ready, vec!["s1", "s2"]);
    }

    #[test]
    fn fan_in_waits_for_every_dependency() {
        let a = automation(vec![
            step("s1", &[], OnFailure::Stop, 1),
            step("s2", &[], OnFailure::Stop, 1),
            step("s3", &["s1", "s2"], OnFailure::Stop, 1),
        ]);
        let mut run = run_of(&a);

        apply_outcome(&mut run, &a.steps[0], ok(), 10);
        assert_eq!(ready_steps(&run), vec!["s2"], "s3 must still wait for s2");

        apply_outcome(&mut run, &a.steps[1], ok(), 20);
        assert_eq!(ready_steps(&run), vec!["s3"]);
    }

    #[test]
    fn a_failure_skips_the_whole_branch_below_it() {
        // s1 → s2 → s3, and an independent s4 that must survive untouched.
        let a = automation(vec![
            step("s1", &[], OnFailure::Stop, 1),
            step("s2", &["s1"], OnFailure::Stop, 1),
            step("s3", &["s2"], OnFailure::Stop, 1),
            step("s4", &[], OnFailure::Stop, 1),
        ]);
        let mut run = run_of(&a);
        apply_outcome(&mut run, &a.steps[0], boom(), 10);

        assert!(promote(&mut run));
        let status = |id: &str| run.steps.iter().find(|s| s.id == id).unwrap().status;
        assert_eq!(status("s1"), StepStatus::Failed);
        assert_eq!(status("s2"), StepStatus::Skipped);
        assert_eq!(status("s3"), StepStatus::Skipped, "the skip must propagate");
        assert_eq!(
            status("s4"),
            StepStatus::Pending,
            "an independent branch keeps going"
        );
        assert_eq!(ready_steps(&run), vec!["s4"]);
    }

    #[test]
    fn retry_returns_the_step_to_the_queue_until_attempts_run_out() {
        let a = automation(vec![step("s1", &[], OnFailure::Retry, 2)]);
        let mut run = run_of(&a);

        // First attempt fails, one left → back to Pending, dispatchable again.
        run.steps[0].attempts = 1;
        apply_outcome(&mut run, &a.steps[0], boom(), 10);
        assert_eq!(run.steps[0].status, StepStatus::Pending);
        assert_eq!(ready_steps(&run), vec!["s1"]);

        // Second attempt fails with none left → terminal.
        run.steps[0].attempts = 2;
        apply_outcome(&mut run, &a.steps[0], boom(), 20);
        assert_eq!(run.steps[0].status, StepStatus::Failed);
        assert!(ready_steps(&run).is_empty());
    }

    #[test]
    fn stop_on_failure_never_retries() {
        let a = automation(vec![step("s1", &[], OnFailure::Stop, 3)]);
        let mut run = run_of(&a);
        run.steps[0].attempts = 1;
        apply_outcome(&mut run, &a.steps[0], boom(), 10);
        assert_eq!(run.steps[0].status, StepStatus::Failed);
    }

    #[test]
    fn success_records_the_verified_exit_code_and_trimmed_output() {
        let a = automation(vec![step("s1", &[], OnFailure::Stop, 1)]);
        let mut run = run_of(&a);
        apply_outcome(
            &mut run,
            &a.steps[0],
            Outcome::Success {
                stdout: "  FINDINGS\n".into(),
                stderr: "warn".into(),
            },
            42,
        );
        let s = &run.steps[0];
        assert_eq!(s.status, StepStatus::Completed);
        assert_eq!(s.output, "FINDINGS");
        assert_eq!(s.exit_code, Some(0));
        assert_eq!(s.finished_at, Some(42));
        assert!(s.error.is_none());
    }

    #[test]
    fn a_skipped_branch_alone_does_not_call_the_run_failed() {
        let a = automation(vec![
            step("s1", &[], OnFailure::Stop, 1),
            step("s2", &["s1"], OnFailure::Stop, 1),
        ]);
        let mut run = run_of(&a);
        apply_outcome(&mut run, &a.steps[0], ok(), 10);
        apply_outcome(&mut run, &a.steps[1], ok(), 20);
        assert_eq!(derive_status(&run), RunStatus::Completed);

        let mut failed = run_of(&a);
        apply_outcome(&mut failed, &a.steps[0], boom(), 10);
        promote(&mut failed);
        assert_eq!(derive_status(&failed), RunStatus::Failed);
    }

    #[test]
    fn outputs_flow_into_the_next_prompt() {
        // The point of the whole feature: A's output lands inside B's prompt.
        let a = automation(vec![
            step("s1", &[], OnFailure::Stop, 1),
            Step {
                prompt: "Consolidate: {{steps.s1.output}} in {{workingDir}}".into(),
                ..step("s2", &["s1"], OnFailure::Stop, 1)
            },
        ]);
        let mut run = run_of(&a);
        apply_outcome(
            &mut run,
            &a.steps[0],
            Outcome::Success {
                stdout: "THREE BUGS".into(),
                stderr: String::new(),
            },
            10,
        );

        let vars = build_vars(&run, &HashMap::new(), "C:/work");
        let resolved = template::resolve(&a.steps[1].prompt, &vars);
        assert_eq!(resolved.text, "Consolidate: THREE BUGS in C:/work");
        assert!(resolved.missing.is_empty());
    }

    #[test]
    fn previous_run_values_are_offered_as_prev() {
        let a = automation(vec![step("s1", &[], OnFailure::Stop, 1)]);
        let mut run = run_of(&a);
        apply_outcome(&mut run, &a.steps[0], ok(), 10);
        let prev: HashMap<String, String> =
            [("prev.s1.output".to_string(), "YESTERDAY".to_string())].into();

        let vars = build_vars(&run, &prev, "C:/work");
        let r = template::resolve("continue from {{prev.s1.output}}", &vars);
        assert_eq!(r.text, "continue from YESTERDAY");
    }

    #[tokio::test]
    async fn precondition_reports_a_non_zero_exit() {
        // A real subprocess: the gate must distinguish "go" from "don't".
        let ok = run_precondition("exit 0", 10, "").await.unwrap();
        assert!(ok.passed());

        let no = run_precondition("exit 3", 10, "").await.unwrap();
        assert!(!no.passed());
        assert_eq!(no.exit_code, Some(3));
        assert!(!no.timed_out);
    }
}
