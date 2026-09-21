//! Orchestration: the cooperative agent → run-engine channel (spec `02d` §3)
//! and, on top of it, a run **driven by a coordinator agent** — tasks, workers,
//! an inbox and questions (§1.6, group `orchestrate`).
//!
//! The run model lives 100 % in the window (`orchestrationRun.svelte.ts`), so
//! every entry here is a question to the window over the bridge, plus what
//! only the backend can do: create the worker's worktree, launch its
//! terminal, and **wait** (`inbox/check --wait`, `question/ask`) on the app's
//! change notifier instead of polling — the window pings `control_notify`
//! whenever a run changes.

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::bridge::Bridge;
use crate::control::receipts;
use crate::control::resolve::Resolver;
use crate::control::Caller;
use crate::state::AppState;

/// The most one `inbox/check --wait` or `question/ask` call blocks — the same
/// budget as `agent/wait`, for the same reason (any HTTP client's timeout).
pub const WAIT_MAX: Duration = super::agent::WAIT_MAX;

fn field<'a>(params: &'a Value, name: &str) -> Result<&'a str, RpcError> {
    params
        .get(name)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            RpcError::new(
                ErrorCode::InvalidParams,
                format!("missing required argument `{name}`"),
            )
        })
}

fn budget(params: &Value) -> Duration {
    params
        .get("timeoutMs")
        .and_then(|v| v.as_u64())
        .map(Duration::from_millis)
        .unwrap_or(WAIT_MAX)
        .min(WAIT_MAX)
}

/// The caller's own terminal id, when it is a launched agent.
fn own_terminal(caller: &Caller) -> Option<String> {
    match caller {
        Caller::Launch { agent_id } => agent_id.clone(),
        Caller::Control => None,
    }
}

/// Ask the window, turning its `{ "error": "…" }` answer into a *not found*.
async fn window<R: tauri::Runtime>(
    app: &AppHandle<R>,
    method: &str,
    params: Value,
) -> Result<Value, RpcError> {
    let answer = Bridge::ask(app, method, params).await?;
    if let Some(refusal) = crate::control::bridge::refused(&answer) {
        return Err(refusal);
    }
    Ok(answer)
}

/// `orchestration/reportResult`: the window's engine takes the report and says
/// whether a running task did — a stale dispatch is refused there.
pub async fn report_result<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let agent_id = field(params, "agentId")?;
    let result = field(params, "result")?;
    let answer = Bridge::ask(
        app,
        "orchestration/report",
        json!({
            "agentId": agent_id,
            "type": "result",
            "text": result,
            "summary": params.get("summary"),
            "taskId": params.get("taskId"),
            "dispatchId": params.get("dispatchId"),
            "outcome": params.get("outcome"),
        }),
    )
    .await?;
    let mut out = json!({
        "reported": "result",
        "accepted": answer.get("accepted").and_then(|v| v.as_bool()).unwrap_or(false),
    });
    if let Some(task) = answer.get("stepId").filter(|v| !v.is_null()) {
        out["task"] = task.clone();
    }
    if let Some(reason) = answer.get("reason").filter(|v| !v.is_null()) {
        out["reason"] = reason.clone();
    }
    Ok(out)
}

/// `orchestration/reportProgress`.
pub async fn report_progress<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let agent_id = field(params, "agentId")?;
    let message = field(params, "message")?;
    Bridge::ask(
        app,
        "orchestration/report",
        json!({ "agentId": agent_id, "type": "progress", "text": message }),
    )
    .await?;
    Ok(json!({ "reported": "progress" }))
}

/// `run/create`.
pub async fn run_create<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let title = field(params, "title")?;
    let coordinator = own_terminal(caller);
    let answer = window(
        app,
        "run/create",
        json!({ "title": title, "coordinator": coordinator }),
    )
    .await?;
    let mut body = json!({ "run": answer });
    if let Some(c) = coordinator {
        body["coordinator"] = json!(c);
    }
    Ok(receipts::receipt(receipts::key_of(params).as_deref(), body))
}

/// `run/finish`.
pub async fn run_finish<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    let outcome = field(params, "outcome")?;
    let answer = window(
        app,
        "run/finish",
        json!({ "run": run, "outcome": outcome, "summary": params.get("summary") }),
    )
    .await?;
    Ok(json!({ "run": answer }))
}

/// `task/create`.
pub async fn task_create<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    let title = field(params, "title")?;
    let prompt = field(params, "prompt")?;
    super::terminal::check_prompt(Some("worker"), Some(prompt))?;
    // A headless task runs somewhere: the caller's own worktree unless told.
    let worktree = match params.get("worktree").and_then(|v| v.as_str()) {
        Some(sel) => Some(Resolver::new(app, caller).worktree(sel).await?.1.path),
        None => match own_terminal(caller) {
            Some(_) => Resolver::new(app, caller)
                .worktree("current")
                .await
                .ok()
                .map(|(_, e)| e.path),
            None => None,
        },
    };
    let answer = window(
        app,
        "task/create",
        json!({
            "run": run,
            "title": title,
            "prompt": prompt,
            "dependsOn": params.get("dependsOn"),
            "kind": params.get("kind"),
            "agent": params.get("agent"),
            "worktree": worktree,
            "retry": params.get("retry"),
        }),
    )
    .await?;
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({ "task": answer }),
    ))
}

/// `task/list`.
pub async fn task_list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    window(app, "task/list", json!({ "run": run })).await
}

/// `task/update`.
pub async fn task_update<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    let task = field(params, "task")?;
    let answer = window(
        app,
        "task/update",
        json!({
            "run": run,
            "task": task,
            "title": params.get("title"),
            "prompt": params.get("prompt"),
            "dependsOn": params.get("dependsOn"),
            "status": params.get("status"),
            "output": params.get("output"),
        }),
    )
    .await?;
    Ok(json!({ "task": answer }))
}

/// `worker/start`: the worktree (existing, the caller's own, or a new one on a
/// new branch), then the terminal with the agent, then the window binds the
/// task to that terminal, mints the dispatch and queues the preamble + prompt.
pub async fn worker_start<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    let task = field(params, "task")?;
    let agent = field(params, "agent")?;
    let resolver = Resolver::new(app, caller);
    let where_ = params
        .get("worktree")
        .and_then(|v| v.as_str())
        .unwrap_or("current");
    let (project, entry) = if where_ == "new" {
        let project_sel = params
            .get("project")
            .and_then(|v| v.as_str())
            .unwrap_or("current");
        let project = resolver.project(project_sel).await?;
        let branch = params
            .get("branch")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("run/{}/{task}", short(run)));
        let spec = super::worktree::CreateSpec {
            branch,
            base: None,
            from_existing: false,
            path: None,
        };
        let entry = super::worktree::create(app, &project.repo(), spec)
            .await
            .map_err(|e| RpcError::new(ErrorCode::InvalidParams, e.to_string()))?;
        // Listed and active in the window, like the dialog's creation; no agent
        // here — the worker's terminal is opened below with its preamble.
        let _ = Bridge::ask(
            app,
            "worktree/adopt",
            json!({ "projectId": project.id, "worktree": entry, "agent": Value::Null, "prompt": Value::Null }),
        )
        .await;
        (project, entry)
    } else {
        resolver.worktree(where_).await?
    };
    let opened = window(
        app,
        "terminal/create",
        json!({
            "worktree": entry.path,
            "target": project.target,
            "agent": agent,
            "title": format!("{task} · {run}", run = short(run)),
            "prompt": Value::Null,
            "unattended": params.get("unattended"),
        }),
    )
    .await?;
    let terminal = opened.get("terminal").cloned().unwrap_or(Value::Null);
    let tab_id = terminal
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcError::new(ErrorCode::Unavailable, "the window opened no terminal"))?
        .to_string();
    let bound = window(
        app,
        "worker/start",
        json!({
            "run": run,
            "task": task,
            "terminal": tab_id,
            "agent": agent,
            "worktree": entry.path,
        }),
    )
    .await?;
    let mut body = json!({
        "task": task,
        "dispatchId": bound.get("dispatchId").cloned().unwrap_or(Value::Null),
        "terminal": terminal,
        "worktree": entry.path,
    });
    if let Some(mode) = opened.get("unattended") {
        body["unattended"] = mode.clone();
    }
    Ok(receipts::receipt(receipts::key_of(params).as_deref(), body))
}

/// `inbox/check`: acknowledge, read, and with `wait` sleep on the change
/// notifier until something is there or the budget runs out.
pub async fn inbox_check<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    let wait = params
        .get("wait")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let budget = budget(params);
    let started = Instant::now();
    let state = app.state::<AppState>();
    let mut ack = params.get("ack").cloned().unwrap_or(Value::Null);
    loop {
        let notified = state.agent_changes.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let answer = window(app, "inbox/check", json!({ "run": run, "ack": ack })).await?;
        // The ack is spent on the first read; a later loop turn must not re-ack.
        ack = Value::Null;
        let empty = answer
            .get("messages")
            .and_then(|m| m.as_array())
            .is_none_or(|m| m.is_empty());
        if !wait || !empty {
            return Ok(answer);
        }
        let left = budget.saturating_sub(started.elapsed());
        if left.is_zero() {
            return Ok(answer);
        }
        let _ = tokio::time::timeout(left, notified).await;
    }
}

/// `question/ask`: the caller's own terminal identifies the task it works on;
/// the window files the question (a gate the coordinator or the person
/// answers) and this call waits on it.
pub async fn question_ask<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let terminal = own_terminal(caller).ok_or_else(|| {
        RpcError::new(
            ErrorCode::InvalidParams,
            "`question/ask` is for a worker: call it from the terminal Uxnan launched you in (uxnan-cli does this by itself there)",
        )
    })?;
    let budget = budget(params);
    let started = Instant::now();
    let state = app.state::<AppState>();
    let (run, question_id) = match params.get("questionId").and_then(|v| v.as_str()) {
        Some(id) => {
            let located = window(app, "question/status", json!({ "question": id })).await?;
            (
                located
                    .get("run")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                id.to_string(),
            )
        }
        None => {
            let question = field(params, "question")?;
            let filed = window(
                app,
                "question/ask",
                json!({ "terminal": terminal, "question": question, "options": params.get("options") }),
            )
            .await?;
            (
                filed
                    .get("run")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                filed
                    .get("questionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            )
        }
    };
    loop {
        let notified = state.agent_changes.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let status = window(app, "question/status", json!({ "question": question_id })).await?;
        let mut out = json!({
            "run": run,
            "questionId": question_id,
            "answered": status.get("answered").and_then(|v| v.as_bool()).unwrap_or(false),
        });
        if out["answered"] == true {
            for k in ["answer", "decision"] {
                if let Some(v) = status.get(k).filter(|v| !v.is_null()) {
                    out[k] = v.clone();
                }
            }
            return Ok(out);
        }
        let left = budget.saturating_sub(started.elapsed());
        if left.is_zero() {
            return Err(RpcError::new(
                ErrorCode::Timeout,
                format!(
                    "no answer to question {question_id} within {} ms; call again with `questionId` to keep waiting",
                    budget.as_millis()
                ),
            )
            .with_data(json!({ "run": run, "questionId": question_id })));
        }
        let _ = tokio::time::timeout(left, notified).await;
    }
}

/// `question/answer`.
pub async fn question_answer<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let run = field(params, "run")?;
    let question = field(params, "question")?;
    let answer = field(params, "answer")?;
    window(
        app,
        "question/answer",
        json!({
            "run": run,
            "question": question,
            "answer": answer,
            "decision": params.get("decision"),
        }),
    )
    .await?;
    Ok(json!({ "question": question, "resolved": true }))
}

/// The first eight characters of a run id, for a branch or a tab title.
fn short(run: &str) -> &str {
    let end = run
        .char_indices()
        .nth(8)
        .map(|(i, _)| i)
        .unwrap_or(run.len());
    &run[..end]
}
