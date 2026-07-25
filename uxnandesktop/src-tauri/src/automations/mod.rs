//! Automations — unattended, **recurring** multi-agent tasks.
//!
//! An automation runs on its own schedule, in its own working folder (a repo or
//! any plain folder), **whether or not uxnan is open**. It drives a small graph
//! of steps, each step a headless agent CLI run, so several providers can work
//! in parallel and a later agent can consume their outputs.
//!
//! # Why this engine is in Rust
//!
//! The interactive orchestration console's engine lives in TypeScript inside the
//! webview, which cannot exist when the app is closed. Rather than duplicate the
//! scheduler in two languages (and guarantee drift), automations get their own
//! engine here, and there is exactly **one execution path**: the OS scheduler and
//! the app's "Run now" both spawn the same headless runner subprocess. The
//! TypeScript engine keeps its own job — live agents in real terminals — and the
//! two never overlap.
//!
//! # Why there are no human gates
//!
//! An unattended task that blocks at 3 AM waiting for a click is a broken task.
//! Automations finish and leave their result for you (a branch, a report, the
//! captured output) plus a native notification. Anything that needs live
//! approval belongs in the interactive console.
//!
//! Layout of the module: [`schedule`] describes recurrence, [`template`] carries
//! outputs between steps, `store` owns the on-disk layout, `graph` executes, and
//! `runner` is the `--automation-run` entry point.

pub mod commands;
pub mod graph;
pub mod oscheduler;
pub mod runner;
pub mod schedule;
pub mod store;
pub mod template;

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub use schedule::{Schedule, TimeUnit};
pub use store::AutomationStore;

/// Wall-clock milliseconds since the Unix epoch. The only clock the backend
/// needs: every *calendar* decision belongs to the OS scheduler (see
/// [`schedule`]), so this is used purely to stamp records.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// What to do when a scheduled run starts while the previous one is still going.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Overlap {
    /// Drop the new run (the default, and what every OS scheduler does best).
    #[default]
    Skip,
    /// Let the new run wait for the previous one to finish.
    Queue,
    /// Stop the previous run and start fresh.
    CancelPrevious,
}

/// Which outcomes raise a native notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NotifyOn {
    Completed,
    Failed,
}

/// A shell command that decides whether a run proceeds at all: exit 0 = go
/// ahead, anything else = the run is skipped and says why. Cheap way to express
/// "only if there are new commits" without burning an agent turn on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Precondition {
    pub command: String,
    /// Hard cap so a hung precondition can never wedge the run.
    pub timeout_seconds: u32,
}

/// Run-level policy: everything about *how* a run behaves that isn't the graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    /// Recover a run whose scheduled moment passed while the machine was off,
    /// instead of silently losing it. Emitted to the OS as `StartWhenAvailable`
    /// (Windows) / `Persistent` (systemd).
    #[serde(default = "default_true")]
    pub catch_up: bool,
    #[serde(default)]
    pub overlap: Overlap,
    #[serde(default)]
    pub precondition: Option<Precondition>,
    /// Wall-clock ceiling for the whole run.
    #[serde(default = "default_max_run_minutes")]
    pub max_run_minutes: u32,
    /// How many past runs to keep on disk before the oldest are pruned.
    #[serde(default = "default_keep_runs")]
    pub keep_runs: u32,
    #[serde(default = "default_notify_on")]
    pub notify_on: Vec<NotifyOn>,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            catch_up: true,
            overlap: Overlap::default(),
            precondition: None,
            max_run_minutes: default_max_run_minutes(),
            keep_runs: default_keep_runs(),
            notify_on: default_notify_on(),
        }
    }
}

const fn default_true() -> bool {
    true
}
const fn default_max_run_minutes() -> u32 {
    60
}
const fn default_keep_runs() -> u32 {
    30
}
fn default_notify_on() -> Vec<NotifyOn> {
    vec![NotifyOn::Failed]
}
const fn default_max_attempts() -> u32 {
    1
}

/// What to do when a step fails.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnFailure {
    /// Fail the run; dependents are skipped.
    #[default]
    Stop,
    /// Re-dispatch up to `max_attempts` before giving up.
    Retry,
}

/// One node of an automation's graph: a headless agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// Short id, unique within the automation (`s1`, `s2`, …), so it reads
    /// cleanly inside a `{{steps.s1.output}}` reference.
    pub id: String,
    #[serde(default)]
    pub title: String,
    /// Agent id as understood by `agentcli` (`claude`, `codex`, …).
    pub agent: String,
    /// Model id; empty means the CLI's own default.
    #[serde(default)]
    pub model: String,
    /// Prompt template — see [`template`].
    pub prompt: String,
    /// Steps that must complete before this one starts. Parallel + fan-in fall
    /// out of this: independent steps run at once, a step listing several
    /// dependencies waits for all of them.
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub on_failure: OnFailure,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    /// Per-step wall-clock cap; `None` uses the runner's default.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// A saved automation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Optional icon, same catalog the projects and branches use.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Free-form labels — the "task type" the list groups and filters by.
    #[serde(default)]
    pub tags: Vec<String>,
    /// The folder the run executes in. Any folder, repo or not; deliberately
    /// **not** tied to whatever project is selected in the sidebar.
    pub working_dir: String,
    /// When `working_dir` is a git repo, give every run its own worktree so
    /// unattended work never touches the tree you are using.
    #[serde(default)]
    pub worktree_per_run: bool,
    /// Base branch for `worktree_per_run`; `None` uses the repo's HEAD.
    #[serde(default)]
    pub base_branch: Option<String>,
    pub schedule: Schedule,
    #[serde(default)]
    pub policy: Policy,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

/// How a run was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunTrigger {
    /// Fired by the OS scheduler.
    Scheduled,
    /// Started by hand from the app ("Run now").
    Manual,
}

/// Lifecycle of a whole run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    /// The precondition command said no.
    SkippedPrecondition,
    /// A previous run was still going and the policy is `Skip`.
    SkippedOverlap,
    /// The working folder or an agent CLI was not available.
    SkippedUnavailable,
}

impl RunStatus {
    /// Whether nothing further will change this run — the only states safe to
    /// prune from history.
    pub const fn is_final(self) -> bool {
        !matches!(self, RunStatus::Running)
    }
}

/// Lifecycle of one step within a run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    /// A dependency failed or was skipped, so this can never run.
    Skipped,
}

/// The captured result of running the precondition command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreconditionResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

impl PreconditionResult {
    /// Only a clean exit 0 lets the run proceed.
    pub fn passed(&self) -> bool {
        !self.timed_out && self.exit_code == Some(0)
    }
}

/// What one step did during a run — kept verbose on purpose, because this is
/// the only account of an execution nobody watched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRun {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub model: String,
    /// Copied from the definition so a run record can draw its own graph even
    /// after the automation is edited or deleted.
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub status: StepStatus,
    /// The prompt **as actually sent**, after substitution — so a surprising
    /// result can be explained without guessing what the agent received.
    #[serde(default)]
    pub prompt: String,
    /// References that resolved to nothing (a thin hand-off).
    #[serde(default)]
    pub missing_refs: Vec<String>,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub stderr: String,
    /// The verified completion signal: 0 = done, anything else = failed.
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
}

/// One execution of an automation. Written only by the runner that owns it, to
/// its own file — so the app can read history while a run is in flight without
/// any locking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    /// Snapshotted so history stays readable after the automation is renamed or
    /// deleted.
    pub automation_name: String,
    pub trigger: RunTrigger,
    pub status: RunStatus,
    pub working_dir: String,
    /// The per-run worktree, when `worktree_per_run` created one.
    #[serde(default)]
    pub worktree_path: Option<String>,
    pub started_at: i64,
    #[serde(default)]
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub precondition: Option<PreconditionResult>,
    #[serde(default)]
    pub steps: Vec<StepRun>,
    #[serde(default)]
    pub error: Option<String>,
}

impl AutomationRun {
    /// Start a fresh record for `automation`.
    pub fn start(automation: &Automation, id: String, trigger: RunTrigger) -> Self {
        Self {
            id,
            automation_id: automation.id.clone(),
            automation_name: automation.name.clone(),
            trigger,
            status: RunStatus::Running,
            working_dir: automation.working_dir.clone(),
            worktree_path: None,
            started_at: now_ms(),
            finished_at: None,
            precondition: None,
            steps: automation
                .steps
                .iter()
                .map(|s| StepRun {
                    id: s.id.clone(),
                    title: s.title.clone(),
                    agent: s.agent.clone(),
                    model: s.model.clone(),
                    depends_on: s.depends_on.clone(),
                    status: StepStatus::Pending,
                    prompt: String::new(),
                    missing_refs: Vec::new(),
                    output: String::new(),
                    stderr: String::new(),
                    exit_code: None,
                    attempts: 0,
                    error: None,
                    started_at: None,
                    finished_at: None,
                })
                .collect(),
            error: None,
        }
    }

    /// The `{{steps.*}}` values a later step can plant, built from what has
    /// completed so far in this run.
    pub fn step_vars(&self) -> HashMap<String, String> {
        let mut vars = HashMap::new();
        for s in &self.steps {
            vars.insert(format!("steps.{}.title", s.id), s.title.clone());
            if s.status == StepStatus::Completed {
                vars.insert(format!("steps.{}.output", s.id), s.output.clone());
            }
        }
        vars
    }
}

/// Everything wrong with `automation`, in messages meant for a log or a run
/// record. Empty means it is safe to schedule. The frontend re-checks the same
/// rules for live feedback; this is the backstop that also guards a hand-edited
/// file or an imported automation.
pub fn validate(automation: &Automation) -> Vec<String> {
    let mut errors = Vec::new();

    if automation.name.trim().is_empty() {
        errors.push("The automation needs a name.".into());
    }
    if automation.working_dir.trim().is_empty() {
        errors.push("The automation needs a working folder.".into());
    }
    if let Err(e) = automation.schedule.validate() {
        errors.push(format!("Invalid schedule: {e}."));
    }
    if let Some(p) = &automation.policy.precondition {
        if p.command.trim().is_empty() {
            errors.push("The precondition command is empty.".into());
        }
        if p.timeout_seconds == 0 {
            errors.push("The precondition needs a timeout.".into());
        }
    }
    if automation.steps.is_empty() {
        errors.push("An automation needs at least one step.".into());
        return errors;
    }

    let mut seen: Vec<&str> = Vec::new();
    for step in &automation.steps {
        let label = if step.title.trim().is_empty() {
            step.id.as_str()
        } else {
            step.title.as_str()
        };
        if step.id.trim().is_empty() {
            errors.push("A step has no id.".into());
        } else if seen.contains(&step.id.as_str()) {
            errors.push(format!("Duplicate step id \"{}\".", step.id));
        } else {
            seen.push(step.id.as_str());
        }
        if step.agent.trim().is_empty() {
            errors.push(format!("Step \"{label}\" has no agent."));
        }
        if step.prompt.trim().is_empty() {
            errors.push(format!("Step \"{label}\" has no prompt."));
        }
        if step.max_attempts == 0 {
            errors.push(format!("Step \"{label}\" allows zero attempts."));
        }
    }

    let ids: Vec<&str> = automation.steps.iter().map(|s| s.id.as_str()).collect();
    for step in &automation.steps {
        let label = if step.title.trim().is_empty() {
            step.id.as_str()
        } else {
            step.title.as_str()
        };
        for dep in &step.depends_on {
            if dep == &step.id {
                errors.push(format!("Step \"{label}\" depends on itself."));
            } else if !ids.contains(&dep.as_str()) {
                errors.push(format!(
                    "Step \"{label}\" depends on a missing step ({dep})."
                ));
            }
        }
    }

    if has_cycle(&automation.steps) {
        errors.push("The steps form a dependency cycle.".into());
    }

    errors
}

/// Whether the dependency edges contain a cycle (which would deadlock the
/// executor). Depth-first search with an explicit recursion stack; unknown
/// dependency ids are ignored here because [`validate`] reports them separately.
pub fn has_cycle(steps: &[Step]) -> bool {
    let by_id: HashMap<&str, &Step> = steps.iter().map(|s| (s.id.as_str(), s)).collect();
    // 1 = on the current stack, 2 = fully explored.
    let mut state: HashMap<&str, u8> = HashMap::new();
    steps
        .iter()
        .any(|s| visit(s.id.as_str(), &by_id, &mut state))
}

fn visit<'a>(
    id: &'a str,
    by_id: &HashMap<&'a str, &'a Step>,
    state: &mut HashMap<&'a str, u8>,
) -> bool {
    match state.get(id) {
        Some(1) => return true, // back edge
        Some(_) => return false,
        None => {}
    }
    state.insert(id, 1);
    if let Some(step) = by_id.get(id) {
        for dep in &step.depends_on {
            if let Some((key, _)) = by_id.get_key_value(dep.as_str()) {
                if visit(key, by_id, state) {
                    return true;
                }
            }
        }
    }
    state.insert(id, 2);
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(id: &str, deps: &[&str]) -> Step {
        Step {
            id: id.into(),
            title: format!("Step {id}"),
            agent: "claude".into(),
            model: String::new(),
            prompt: "do the thing".into(),
            depends_on: deps.iter().map(|d| (*d).to_string()).collect(),
            on_failure: OnFailure::Stop,
            max_attempts: 1,
            timeout_ms: None,
        }
    }

    fn automation(steps: Vec<Step>) -> Automation {
        Automation {
            id: "a1".into(),
            name: "Nightly triage".into(),
            description: String::new(),
            icon: None,
            enabled: true,
            tags: vec![],
            working_dir: "C:/work/repo".into(),
            worktree_per_run: false,
            base_branch: None,
            schedule: Schedule::DailyAt { hour: 3, minute: 0 },
            policy: Policy::default(),
            steps,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn a_fan_in_graph_is_valid() {
        // s1 and s2 in parallel, s3 waits for both — the shape the whole feature
        // exists for.
        let a = automation(vec![
            step("s1", &[]),
            step("s2", &[]),
            step("s3", &["s1", "s2"]),
        ]);
        assert!(validate(&a).is_empty(), "{:?}", validate(&a));
    }

    #[test]
    fn cycles_are_caught() {
        let a = automation(vec![step("s1", &["s2"]), step("s2", &["s1"])]);
        assert!(has_cycle(&a.steps));
        assert!(validate(&a).iter().any(|e| e.contains("cycle")));
    }

    #[test]
    fn self_dependency_is_caught_without_hanging() {
        let a = automation(vec![step("s1", &["s1"])]);
        let errors = validate(&a);
        assert!(errors.iter().any(|e| e.contains("depends on itself")));
    }

    #[test]
    fn missing_and_duplicate_ids_are_reported() {
        let a = automation(vec![step("s1", &["nope"]), step("s1", &[])]);
        let errors = validate(&a);
        assert!(errors.iter().any(|e| e.contains("missing step")));
        assert!(errors.iter().any(|e| e.contains("Duplicate step id")));
    }

    #[test]
    fn an_empty_graph_is_rejected() {
        let a = automation(vec![]);
        assert!(validate(&a).iter().any(|e| e.contains("at least one step")));
    }

    #[test]
    fn step_vars_expose_only_completed_output() {
        let a = automation(vec![step("s1", &[]), step("s2", &[])]);
        let mut run = AutomationRun::start(&a, "r1".into(), RunTrigger::Scheduled);
        run.steps[0].status = StepStatus::Completed;
        run.steps[0].output = "FINDINGS".into();
        let vars = run.step_vars();
        assert_eq!(
            vars.get("steps.s1.output").map(String::as_str),
            Some("FINDINGS")
        );
        // s2 hasn't run, so its output must not be plantable yet.
        assert!(!vars.contains_key("steps.s2.output"));
        // Titles are known up front and always available.
        assert_eq!(
            vars.get("steps.s2.title").map(String::as_str),
            Some("Step s2")
        );
    }

    #[test]
    fn run_status_finality_gates_pruning() {
        assert!(!RunStatus::Running.is_final());
        assert!(RunStatus::Completed.is_final());
        assert!(RunStatus::SkippedPrecondition.is_final());
    }

    #[test]
    fn policy_defaults_are_conservative() {
        // Defaults must never surprise: recover missed runs, never pile up
        // concurrent runs, and only shout when something failed.
        let p = Policy::default();
        assert!(p.catch_up);
        assert_eq!(p.overlap, Overlap::Skip);
        assert_eq!(p.notify_on, vec![NotifyOn::Failed]);
        assert!(p.keep_runs > 0);
    }

    #[test]
    fn automation_serde_round_trips_camel_case() {
        let a = automation(vec![step("s1", &[])]);
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"workingDir\""), "{json}");
        assert!(json.contains("\"worktreePerRun\""), "{json}");
        assert_eq!(serde_json::from_str::<Automation>(&json).unwrap(), a);
    }
}
