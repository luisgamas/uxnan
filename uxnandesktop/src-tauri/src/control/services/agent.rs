//! Agents: what the hook reports have told the backend about each one.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::bridge::Bridge;
use crate::control::receipts;
use crate::control::resolve::{path_within, Resolver};
use crate::control::Caller;
use crate::model::{AgentStateEntry, AgentStatus};
use crate::state::AppState;

/// The most one `agent/wait` call blocks. A client that wants longer calls
/// again — which keeps every call short enough for any HTTP client's timeout
/// and lets the CLI print a heartbeat between calls.
pub const WAIT_MAX: Duration = Duration::from_millis(15_000);

/// One tracked agent, as the catalog describes it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    /// The terminal it runs in (its `UXNAN_AGENT_ID`).
    pub terminal_id: String,
    /// `claude`, `codex`, … when the hook said; absent for an agent whose hooks
    /// never reported a kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// `working`, `blocked`, `waiting` or `done`.
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub interrupted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// The provider's own session id, when captured — what `--resume` takes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// The worktree folder the terminal was opened in, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Epoch seconds.
    pub first_seen: i64,
    pub last_update: i64,
}

impl AgentView {
    fn of(entry: &AgentStateEntry, cwd: Option<String>) -> Self {
        AgentView {
            terminal_id: entry.agent_id.clone(),
            kind: entry.agent_type.clone(),
            status: entry.status,
            prompt: entry.prompt.clone(),
            tool: entry.tool.clone(),
            interrupted: entry.interrupted,
            summary: entry.summary.clone(),
            session_id: entry.session.as_ref().map(|s| s.id.clone()),
            cwd,
            first_seen: entry.first_seen,
            last_update: entry.last_update,
        }
    }
}

/// Every agent in the cache whose terminal is still alive. The cache keeps an
/// entry for a while after its terminal closes (so a restored tab can resume);
/// a caller asking "who is running" is told only about live ones.
pub async fn all<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<AgentView> {
    let state = app.state::<AppState>();
    let live: std::collections::HashMap<String, String> =
        state.pty.live_sessions().into_iter().collect();
    let data = state.data.read().await;
    data.agent_cache
        .iter()
        .filter_map(|e| {
            live.get(&e.agent_id)
                .map(|cwd| AgentView::of(e, Some(cwd.clone())))
        })
        .collect()
}

/// The live agents whose terminal was opened inside `worktree_path`.
pub async fn in_worktree<R: tauri::Runtime>(
    app: &AppHandle<R>,
    worktree_path: &str,
) -> Vec<AgentView> {
    all(app)
        .await
        .into_iter()
        .filter(|a| {
            a.cwd
                .as_deref()
                .is_some_and(|c| path_within(c, worktree_path))
        })
        .collect()
}

/// `agent/send`: a whole message to a running agent's terminal — through the
/// window's backpressure queue unless `force`, in which case it is pasted
/// now. The window does the typing (the queue and the PTY paste are its), and
/// refuses a terminal that has no agent in it.
pub async fn send<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params
        .get("terminal")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tab = Resolver::new(app, caller).terminal(sel).await?;
    let message = params.get("message").and_then(|v| v.as_str()).unwrap_or("");
    super::terminal::check_prompt(Some("agent"), Some(message))?;
    if tab.agent_name.is_none() {
        return Err(RpcError::new(
            ErrorCode::InvalidParams,
            format!(
                "terminal {} runs no agent; a message needs an agent's terminal (see `terminal/list`)",
                tab.id
            ),
        ));
    }
    if tab.exited {
        return Err(RpcError::new(
            ErrorCode::NotFound,
            format!("terminal {} has exited", tab.id),
        ));
    }
    let force = params
        .get("force")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let answer = Bridge::ask(
        app,
        "agent/send",
        json!({ "terminal": tab.id, "message": message, "force": force }),
    )
    .await?;
    if let Some(message) = answer.get("error").and_then(|v| v.as_str()) {
        return Err(RpcError::new(ErrorCode::NotFound, message));
    }
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({
            "terminal": tab.id,
            "delivery": answer.get("delivery").cloned().unwrap_or(json!("queued")),
            "bytes": message.len(),
        }),
    ))
}

/// What `agent/wait` waits for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WaitFor {
    /// The agent's turn finished (`done`).
    Idle,
    /// The agent stopped to ask the person something (`waiting`).
    Waiting,
    /// The terminal is gone.
    Exit,
}

/// The agent's current state for a terminal, as the wait sees it: `None`
/// when the terminal is gone, `Some(None)` when it is alive but its agent has
/// not reported yet, `Some(Some(status))` otherwise. `starting` is the
/// window's word that the tab is open and not exited: a tab just created has
/// no PTY for a moment, and that moment must read as *not reported yet*, not
/// as *gone* — or a wait right after `terminal/create` would answer `exit`.
fn observe(
    state: &AppState,
    data: &crate::model::AppData,
    terminal: &str,
    starting: bool,
) -> Option<Option<AgentStatus>> {
    let alive = starting
        || state
            .pty
            .live_sessions()
            .iter()
            .any(|(id, _)| id == terminal);
    if !alive {
        return None;
    }
    Some(
        data.agent_cache
            .iter()
            .find(|e| e.agent_id == terminal)
            .map(|e| e.status),
    )
}

fn reached(want: WaitFor, seen: Option<Option<AgentStatus>>) -> Option<&'static str> {
    match (want, seen) {
        (WaitFor::Exit, None) => Some("exit"),
        (_, None) => Some("exit"),
        (WaitFor::Idle, Some(Some(AgentStatus::Done))) => Some("idle"),
        (WaitFor::Waiting, Some(Some(AgentStatus::Waiting))) => Some("waiting"),
        _ => None,
    }
}

/// `agent/wait`: block until the terminal's agent reaches the asked state, or
/// this call's budget runs out. Sleeps on the app's agent-change notifier; no
/// polling. A terminal that exits satisfies every wait — the caller learns the
/// agent is gone rather than waiting for a turn that will never end.
pub async fn wait<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let sel = params
        .get("terminal")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tab = Resolver::new(app, caller).terminal(sel).await?;
    let want = match params.get("for").and_then(|v| v.as_str()).unwrap_or("") {
        "idle" => WaitFor::Idle,
        "waiting" => WaitFor::Waiting,
        "exit" => WaitFor::Exit,
        other => {
            return Err(RpcError::new(
                ErrorCode::InvalidParams,
                format!("`for` must be `idle`, `waiting` or `exit`, not `{other}`"),
            ))
        }
    };
    let budget = params
        .get("timeoutMs")
        .and_then(|v| v.as_u64())
        .map(Duration::from_millis)
        .unwrap_or(WAIT_MAX)
        .min(WAIT_MAX);
    let state = app.state::<AppState>();
    match wait_for(&state, &tab.id, want, budget, !tab.exited).await {
        Ok((reached, waited)) => Ok(json!({
            "terminal": tab.id,
            "reached": reached,
            "waitedMs": waited.as_millis() as u64,
        })),
        Err((current, waited)) => Err(RpcError::new(
            ErrorCode::Timeout,
            format!(
                "terminal {} did not reach `{}` within {} ms (it is `{}`); call again to keep waiting",
                tab.id,
                params.get("for").and_then(|v| v.as_str()).unwrap_or(""),
                budget.as_millis(),
                current
            ),
        )
        .with_data(json!({ "current": current, "waitedMs": waited.as_millis() as u64 }))),
    }
}

/// The wait itself, over the app state alone: `Ok((state reached, waited))`
/// or `Err((the state it is in, waited))` when the budget ran out.
async fn wait_for(
    state: &AppState,
    terminal: &str,
    want: WaitFor,
    budget: Duration,
    starting: bool,
) -> Result<(&'static str, Duration), (String, Duration)> {
    let started = Instant::now();
    loop {
        // Arm the wake-up *before* looking, so a change between the look and
        // the sleep is not missed.
        let notified = state.agent_changes.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let seen = {
            let data = state.data.read().await;
            observe(state, &data, terminal, starting)
        };
        if let Some(reached) = reached(want, seen) {
            return Ok((reached, started.elapsed()));
        }
        let left = budget.saturating_sub(started.elapsed());
        if left.is_zero() {
            let current = match seen {
                None => "exit".to_string(),
                Some(None) => "unreported".to_string(),
                Some(Some(s)) => serde_json::to_value(s)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default(),
            };
            return Err((current, started.elapsed()));
        }
        let _ = tokio::time::timeout(left, notified).await;
    }
}

/// `agent/list`: the live agents within the caller's scope (a launch caller
/// sees the agents of its own project, itself included).
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    Ok(json!({ "agents": visible(app, caller).await }))
}

/// [`all`], narrowed to the caller's scope.
pub async fn visible<R: tauri::Runtime>(app: &AppHandle<R>, caller: &Caller) -> Vec<AgentView> {
    let resolver = Resolver::new(app, caller);
    let scope = resolver.scope().await;
    let own = match caller {
        Caller::Launch { agent_id } => agent_id.clone(),
        Caller::Control => None,
    };
    all(app)
        .await
        .into_iter()
        .filter(|a| {
            own.as_deref() == Some(a.terminal_id.as_str()) || scope.admits_folder(a.cwd.as_deref())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AgentReport, AppData};
    use crate::persistence::PersistenceManager;
    use crate::pty::PtySpec;

    fn state_with_shell() -> (AppState, String, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(
            PersistenceManager::new(dir.path()),
            AppData::default(),
            dir.path().to_path_buf(),
        );
        let id = "t-wait".to_string();
        state
            .pty
            .create(
                PtySpec {
                    id: id.clone(),
                    cwd: None,
                    shell: None,
                    args: Vec::new(),
                    env: Vec::new(),
                    cols: 80,
                    rows: 24,
                },
                |_| {},
                || {},
            )
            .unwrap();
        (state, id, dir)
    }

    fn report(id: &str, status: AgentStatus) -> AgentReport {
        AgentReport {
            agent_id: id.to_string(),
            status,
            agent_type: Some("claude".into()),
            prompt: None,
            tool: None,
            interrupted: false,
            summary: None,
            session: None,
        }
    }

    /// A working agent makes the wait run out, saying what it is; a `done`
    /// report wakes it at once; a terminal that is gone satisfies any wait.
    #[tokio::test]
    async fn waits_wake_on_reports_and_say_why_they_ran_out() {
        let (state, id, _dir) = state_with_shell();
        state
            .data
            .write()
            .await
            .upsert_agent_state(report(&id, AgentStatus::Working), 1);
        let err = wait_for(
            &state,
            &id,
            WaitFor::Idle,
            Duration::from_millis(150),
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, "working");

        // Flip to done while a wait is pending.
        let waiter = wait_for(&state, &id, WaitFor::Idle, Duration::from_secs(5), false);
        let flipper = async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            state
                .data
                .write()
                .await
                .upsert_agent_state(report(&id, AgentStatus::Done), 2);
            state.agent_changes.notify_waiters();
        };
        let (reached, _) = tokio::join!(waiter, flipper);
        assert_eq!(reached.unwrap().0, "idle");

        // `waiting` is its own state; and an unknown terminal is `exit`.
        state
            .data
            .write()
            .await
            .upsert_agent_state(report(&id, AgentStatus::Waiting), 3);
        assert_eq!(
            wait_for(
                &state,
                &id,
                WaitFor::Waiting,
                Duration::from_millis(50),
                false
            )
            .await
            .unwrap()
            .0,
            "waiting"
        );
        assert_eq!(
            wait_for(
                &state,
                "gone",
                WaitFor::Idle,
                Duration::from_millis(50),
                false
            )
            .await
            .unwrap()
            .0,
            "exit"
        );
        // A tab the window says is open but whose PTY is not up yet is
        // "not reported", never "exit": the wait keeps waiting.
        let err = wait_for(
            &state,
            "gone",
            WaitFor::Idle,
            Duration::from_millis(50),
            true,
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, "unreported");
        // A live terminal whose agent never reported: the wait runs out and says so.
        state.pty.close(&id).unwrap();
    }

    #[test]
    fn reached_maps_states_to_the_asked_outcome() {
        assert_eq!(
            reached(WaitFor::Idle, Some(Some(AgentStatus::Done))),
            Some("idle")
        );
        assert_eq!(
            reached(WaitFor::Idle, Some(Some(AgentStatus::Working))),
            None
        );
        assert_eq!(reached(WaitFor::Idle, Some(None)), None);
        assert_eq!(
            reached(WaitFor::Waiting, Some(Some(AgentStatus::Waiting))),
            Some("waiting")
        );
        assert_eq!(
            reached(WaitFor::Waiting, Some(Some(AgentStatus::Done))),
            None
        );
        assert_eq!(reached(WaitFor::Exit, None), Some("exit"));
        assert_eq!(reached(WaitFor::Idle, None), Some("exit"));
    }
}
