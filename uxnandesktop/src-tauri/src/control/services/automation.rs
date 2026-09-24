//! Automations: the saved, unattended recurring runs. Listing reads the same
//! store the Settings pane reads; running one starts the same headless runner
//! its schedule starts, tagged as a manual run.

use serde_json::{json, Value};
use tauri::AppHandle;
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::automations::commands::{automations_list, automations_run_now};
use crate::automations::Automation;
use crate::control::receipts;
use crate::control::Caller;

/// One automation as the catalog describes it. `full` is `automation/show`:
/// each step's prompt and failure handling, and the run policy — what a caller
/// needs to decide whether running it is what it wants. The list stays the
/// short form, because a caller browsing twenty automations does not want
/// twenty prompts.
fn view(a: &Automation, full: bool) -> Value {
    let steps: Vec<Value> = a
        .steps
        .iter()
        .map(|s| {
            let mut step = json!({
                "id": s.id,
                "title": s.title,
                "agent": s.agent,
                "model": s.model,
            });
            if full {
                step["prompt"] = json!(s.prompt);
                step["dependsOn"] = json!(s.depends_on);
                step["onFailure"] = serde_json::to_value(s.on_failure).unwrap_or(Value::Null);
                step["maxAttempts"] = json!(s.max_attempts);
                step["timeoutMs"] = json!(s.timeout_ms);
                step["autonomous"] = json!(s.autonomous);
            }
            step
        })
        .collect();
    let mut out = json!({
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "enabled": a.enabled,
        "tags": a.tags,
        "workingDir": a.working_dir,
        "worktreePerRun": a.worktree_per_run,
        "schedule": a.schedule,
        "steps": steps,
        "updatedAt": a.updated_at,
    });
    if full {
        out["baseBranch"] = json!(a.base_branch);
        out["createdAt"] = json!(a.created_at);
        out["policy"] = json!({
            "catchUp": a.policy.catch_up,
            "overlap": serde_json::to_value(a.policy.overlap).unwrap_or(Value::Null),
            "maxRunMinutes": a.policy.max_run_minutes,
            "keepRuns": a.policy.keep_runs,
            "notifyOn": a.policy.notify_on,
            "precondition": a.policy.precondition.as_ref().map(|p| json!({
                "command": p.command,
                "timeoutSeconds": p.timeout_seconds,
            })),
        });
    }
    out
}

/// The saved automations, or the error a caller reads.
fn saved() -> Result<Vec<Automation>, RpcError> {
    automations_list().map_err(|e| RpcError::new(ErrorCode::Internal, e.message))
}

/// `automation/list`.
pub async fn list<R: tauri::Runtime>(
    _app: &AppHandle<R>,
    _caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let items: Vec<Value> = saved()?.iter().map(|a| view(a, false)).collect();
    Ok(json!({ "automations": items }))
}

/// `automation/show`.
pub async fn show<R: tauri::Runtime>(
    _app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = selected(params);
    saved()?
        .iter()
        .find(|a| a.id == id)
        .map(|a| view(a, true))
        .ok_or_else(|| RpcError::new(ErrorCode::NotFound, format!("no automation matches `{id}`")))
}

/// The `automation` argument, trimmed.
fn selected(params: &Value) -> String {
    params
        .get("automation")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// `automation/run`.
pub async fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let id = selected(params);
    if !saved()?.iter().any(|a| a.id == id) {
        return Err(RpcError::new(
            ErrorCode::NotFound,
            format!("no automation matches `{id}`"),
        ));
    }
    automations_run_now(app.clone(), id.clone())
        .map_err(|e| RpcError::new(ErrorCode::Internal, e.message))?;
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({ "automation": { "id": id, "started": true } }),
    ))
}

#[cfg(test)]
mod tests {
    use super::view;
    use crate::automations::{Automation, Policy, Precondition, Schedule, Step};

    fn saved() -> Automation {
        Automation {
            id: "nightly-lint".into(),
            name: "Nightly lint".into(),
            description: "runs the linter".into(),
            icon: None,
            enabled: true,
            tags: vec!["quality".into()],
            working_dir: "/srv/app".into(),
            worktree_per_run: true,
            base_branch: Some("main".into()),
            schedule: Schedule::DailyAt { hour: 3, minute: 0 },
            policy: Policy {
                precondition: Some(Precondition {
                    command: "git log -1 --since=1.day".into(),
                    timeout_seconds: 30,
                }),
                ..Policy::default()
            },
            steps: vec![Step {
                id: "s1".into(),
                title: "Lint".into(),
                agent: "claude".into(),
                model: String::new(),
                prompt: "Run the linter and fix what it reports.".into(),
                depends_on: Vec::new(),
                on_failure: Default::default(),
                max_attempts: 2,
                timeout_ms: Some(600_000),
                autonomous: true,
            }],
            created_at: 1,
            updated_at: 2,
        }
    }

    /// The list stays short: a caller browsing twenty automations does not want
    /// twenty prompts, and nothing about *what a run would do* is in it.
    #[test]
    fn the_list_form_leaves_out_what_only_show_answers() {
        let v = view(&saved(), false);
        assert_eq!(v["id"], "nightly-lint");
        assert_eq!(v["steps"][0]["agent"], "claude");
        for absent in ["policy", "baseBranch", "createdAt"] {
            assert!(v.get(absent).is_none(), "{absent} is in the list form");
        }
        assert!(v["steps"][0].get("prompt").is_none());
    }

    /// `automation/show` answers what `automation/run` would actually do: the
    /// prompts, whether a step approves its own tools, and the precondition
    /// that can make the whole run do nothing.
    #[test]
    fn the_full_form_says_what_a_run_would_do() {
        let v = view(&saved(), true);
        assert_eq!(v["baseBranch"], "main");
        assert_eq!(v["createdAt"], 1);
        assert_eq!(
            v["steps"][0]["prompt"],
            "Run the linter and fix what it reports."
        );
        assert_eq!(v["steps"][0]["autonomous"], true);
        assert_eq!(v["steps"][0]["onFailure"], "stop");
        assert_eq!(v["steps"][0]["maxAttempts"], 2);
        assert_eq!(v["steps"][0]["timeoutMs"], 600_000);
        assert_eq!(v["policy"]["overlap"], "skip");
        assert_eq!(v["policy"]["catchUp"], true);
        assert_eq!(
            v["policy"]["precondition"]["command"],
            "git log -1 --since=1.day"
        );
        assert_eq!(v["policy"]["notifyOn"], serde_json::json!(["failed"]));
    }
}
