//! From a method name and its params to the service that answers — the one
//! path every transport takes.
//!
//! In order: the name must be in the catalog; its group must be enabled; the
//! params must match the entry's schema; then the service runs. Nothing else
//! is reachable, whatever the transport, so this is also where the surface's
//! safety properties are enforced, not in each route.

use serde_json::Value;
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::catalog::{self, Group};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use super::Caller;
use super::{audit, receipts, services};
use crate::state::AppState;

/// The groups the user has left on.
pub async fn enabled_groups<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<Group> {
    let state = app.state::<AppState>();
    let disabled = state
        .data
        .read()
        .await
        .settings
        .control
        .disabled_groups
        .clone();
    Group::ALL
        .into_iter()
        .filter(|g| !disabled.iter().any(|d| d == g.name()))
        .collect()
}

/// Run `method` with `params` for `caller`.
pub async fn dispatch<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    let Some(entry) = catalog::by_method(method) else {
        return Err(RpcError::new(
            ErrorCode::MethodNotFound,
            format!("unknown method `{method}`"),
        ));
    };
    if !enabled_groups(app).await.contains(&entry.group) {
        return Err(RpcError::new(
            ErrorCode::GroupDisabled,
            format!(
                "the `{}` capability group is switched off in Uxnan's settings",
                entry.group.name()
            ),
        ));
    }
    super::params::validate(&entry.params, params)?;
    let params = if params.is_null() {
        Value::Object(Default::default())
    } else {
        params.clone()
    };
    // A `create` entry is receipted and audited: the same key returns the first
    // receipt instead of doing the thing twice, and every call that reached the
    // service — done or refused by it — leaves a line the person can read later.
    // `agent/wait` is a read that blocks; it leaves no line. A send and a
    // screen read do.
    // What is receipted and written to the audit log: everything that creates,
    // every conversation turn but the wait, every coordinator move but the
    // reads and waits (`task/list`, `inbox/check`) and the progress line, and
    // every action an agent takes inside a browser page (typed text is logged
    // by length only).
    let audited = entry.group == Group::Create
        || matches!(
            method,
            "browser/click" | "browser/type" | "browser/press" | "browser/scroll"
        )
        || (entry.group == Group::Converse && method != "agent/wait")
        || (entry.group == Group::Orchestrate
            && !matches!(
                method,
                "task/list" | "inbox/check" | "orchestration/reportProgress"
            ));
    if audited {
        if let Some(key) = receipts::key_of(&params) {
            let state = app.state::<AppState>();
            if let Some(receipt) = state.control_receipts.lookup(method, &key) {
                return Ok(receipt);
            }
        }
    }
    let outcome = run(app, caller, method, &params).await;
    if audited {
        let state = app.state::<AppState>();
        let logged = outcome.clone().map_err(|e| e.message);
        audit::append(
            &state.data_dir,
            &audit::line(caller, method, &params, &logged),
        );
        if let (Ok(receipt), Some(key)) = (&outcome, receipts::key_of(&params)) {
            state
                .control_receipts
                .remember(method, &key, receipt.clone());
        }
    }
    outcome
}

/// The service behind `method`, once the entry, its group and its params have
/// been checked.
async fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    match method {
        "status" => services::status::status(app, caller, params).await,
        "project/list" => services::project::list(app, caller, params).await,
        "project/show" => services::project::show(app, caller, params).await,
        "worktree/list" => services::worktree::list(app, caller, params).await,
        "worktree/show" => services::worktree::show(app, caller, params).await,
        "terminal/list" => services::terminal::list(app, caller, params).await,
        "terminal/show" => services::terminal::show(app, caller, params).await,
        "agent/list" => services::agent::list(app, caller, params).await,
        "chat/list" => services::chat::list(app, caller, params).await,
        "chat/open" => services::chat::open(app, caller, params).await,
        "chat/send" => services::chat::send(app, caller, params).await,
        "chat/start" => services::chat::start(app, caller, params).await,
        "chat/read" => services::chat::read(app, caller, params).await,
        "chat/wait" => services::chat::wait(app, caller, params).await,
        "run/list" => services::run::list(app, caller, params).await,
        "run/show" => services::run::show(app, caller, params).await,
        "automation/list" => services::automation::list(app, caller, params).await,
        "automation/show" => services::automation::show(app, caller, params).await,
        "host/list" => services::host::list(app, caller, params).await,
        "host/show" => services::host::show(app, caller, params).await,
        "browser/status" => services::browser::status(app, caller, params).await,
        "browser/snapshot" => services::browser::snapshot(app, caller, params).await,
        "browser/screenshot" => services::browser::screenshot(app, caller, params).await,
        "browser/console" => services::browser::console(app, caller, params).await,
        "browser/wait" => services::browser::wait(app, caller, params).await,
        "app/focus" => services::ui::focus(app, caller, params).await,
        "terminal/reveal" => services::ui::reveal(app, caller, params).await,
        "file/open" => services::ui::open_file(app, caller, params).await,
        "file/diff" => services::ui::open_diff(app, caller, params).await,
        "automation/propose" => services::automation::propose(app, caller, params).await,
        "browser/open" | "browser/navigate" => services::browser::open(app, caller, params).await,
        "browser/reload" => services::browser::reload(app, caller, params).await,
        "browser/back" => services::browser::back(app, caller, params).await,
        "browser/forward" => services::browser::forward(app, caller, params).await,
        "browser/click" => services::browser::click(app, caller, params).await,
        "browser/type" => services::browser::type_text(app, caller, params).await,
        "browser/press" => services::browser::press(app, caller, params).await,
        "browser/scroll" => services::browser::scroll(app, caller, params).await,
        "host/connect" => services::host::connect(app, caller, params).await,
        "worktree/create" => services::worktree::create_entry(app, caller, params).await,
        "terminal/create" => services::terminal::create(app, caller, params).await,
        "terminal/close" => services::terminal::close(app, caller, params).await,
        "run/start" => services::run::start(app, caller, params).await,
        "automation/run" => services::automation::run(app, caller, params).await,
        "agent/send" => services::agent::send(app, caller, params).await,
        "agent/wait" => services::agent::wait(app, caller, params).await,
        "terminal/read" => services::terminal::read(app, caller, params).await,
        "orchestration/reportResult" => {
            services::orchestration::report_result(app, caller, params).await
        }
        "orchestration/reportProgress" => {
            services::orchestration::report_progress(app, caller, params).await
        }
        "run/create" => services::orchestration::run_create(app, caller, params).await,
        "run/finish" => services::orchestration::run_finish(app, caller, params).await,
        "task/create" => services::orchestration::task_create(app, caller, params).await,
        "task/list" => services::orchestration::task_list(app, caller, params).await,
        "task/update" => services::orchestration::task_update(app, caller, params).await,
        "worker/start" => services::orchestration::worker_start(app, caller, params).await,
        "inbox/check" => services::orchestration::inbox_check(app, caller, params).await,
        "question/ask" => services::orchestration::question_ask(app, caller, params).await,
        "question/answer" => services::orchestration::question_answer(app, caller, params).await,
        // The catalog and this table are checked against each other by a test;
        // an entry that reaches here is a bug, not a caller's mistake.
        other => Err(RpcError::new(
            ErrorCode::Internal,
            format!("`{other}` is in the catalog but has no service"),
        )),
    }
}

/// The catalog entries this dispatcher implements. Kept as a list so the test
/// below can prove the catalog and the `match` above agree — a method added to
/// one and not the other would otherwise be found only by a caller.
#[cfg(test)]
const IMPLEMENTED: &[&str] = &[
    "status",
    "project/list",
    "project/show",
    "worktree/list",
    "worktree/show",
    "terminal/list",
    "terminal/show",
    "agent/list",
    "chat/list",
    "chat/open",
    "chat/send",
    "chat/start",
    "chat/read",
    "chat/wait",
    "run/list",
    "run/show",
    "browser/status",
    "browser/snapshot",
    "browser/screenshot",
    "browser/console",
    "browser/wait",
    "app/focus",
    "terminal/reveal",
    "file/open",
    "file/diff",
    "automation/propose",
    "browser/open",
    "browser/navigate",
    "browser/reload",
    "browser/back",
    "browser/forward",
    "browser/click",
    "browser/type",
    "browser/press",
    "browser/scroll",
    "automation/list",
    "automation/show",
    "host/list",
    "host/show",
    "host/connect",
    "worktree/create",
    "terminal/create",
    "terminal/close",
    "run/start",
    "automation/run",
    "agent/send",
    "agent/wait",
    "terminal/read",
    "orchestration/reportResult",
    "orchestration/reportProgress",
    "run/create",
    "run/finish",
    "task/create",
    "task/list",
    "task/update",
    "worker/start",
    "inbox/check",
    "question/ask",
    "question/answer",
];

#[cfg(test)]
mod tests {
    use super::*;

    /// Every catalog entry has a service, and every service is in the catalog.
    #[test]
    fn the_catalog_and_the_dispatcher_agree() {
        let catalog: Vec<&str> = catalog::catalog().iter().map(|e| e.method).collect();
        for m in &catalog {
            assert!(
                IMPLEMENTED.contains(m),
                "{m} is in the catalog but not dispatched"
            );
        }
        for m in IMPLEMENTED {
            assert!(
                catalog.contains(m),
                "{m} is dispatched but not in the catalog"
            );
        }
    }
}
