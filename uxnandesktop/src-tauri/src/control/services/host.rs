//! Hosts: the remote machines projects live on, and the sessions they are
//! reached through.
//!
//! The record comes from the settings; everything that matters to a caller —
//! connected or not, which shell, how many channels are left — comes from the
//! live session in `AppState`, because a host that dropped still looks perfect
//! in the settings.
//!
//! # What a caller may see
//!
//! A launch token is scoped to one project (`control::resolve::Scope`), and
//! hosts follow that scope rather than relaxing it: a caller sees the host its
//! own project lives on, and nothing else. The person's own shell — the control
//! token — sees every registered machine. An inventory of someone's machines
//! (their names, users and ports) is not something a project's agent needs, and
//! the scope is the app's answer to "needs" everywhere else.
//!
//! **Today that means this is, in practice, the person's surface.** A terminal
//! on a host is a remote PTY and carries none of the `UXNAN_*` launch
//! variables, so an agent running *there* cannot call this API at all; and a
//! local terminal's project is local, so its scope names no host. The rule is
//! written for what happens when that changes (the remote agent runner, plan
//! 013) rather than being relaxed now and tightened later.
//!
//! # What is deliberately absent
//!
//! No identity files, no `identityAgent`, no proxy command, no fingerprints —
//! and [`connect`] accepts no credential at all. A host that wants a password,
//! a key passphrase or a decision about its host key is reported as such and
//! left to the person; the API never answers those questions on their behalf.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uxnan_control_protocol::rpc::{ErrorCode, RpcError};

use crate::control::receipts;
use crate::control::resolve::{Resolver, Scope};
use crate::control::Caller;
use crate::model::SshHost;
use crate::state::AppState;
use crate::target::TargetId;

/// The hosts this caller may name, in registration order — or the scope error,
/// which says why rather than answering with an empty list. "No hosts" and "not
/// yours to see" are different facts, and a caller that cannot tell them apart
/// goes looking for a machine that is right there.
async fn visible<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
) -> Result<Vec<SshHost>, RpcError> {
    let resolver = Resolver::new(app, caller);
    let scope = resolver.scope().await;
    let hosts = {
        let state = app.state::<AppState>();
        let data = state.data.read().await;
        data.settings.ssh_hosts.clone()
    };
    match scope {
        Scope::All => Ok(hosts),
        Scope::Project { project, .. } => {
            let target = TargetId::parse(&project.target).ok();
            match target.as_ref().and_then(|t| t.ssh_host_id()) {
                Some(own) => Ok(hosts.into_iter().filter(|h| h.id == own).collect()),
                None => Err(denied(&format!(
                    "your token is scoped to the project {}, which is on this machine",
                    project.name
                ))),
            }
        }
        Scope::None => Err(denied(
            "your token names no project (its terminal is not inside one, or the request sent no agent-id header)",
        )),
    }
}

/// The scope refusal, in the terms the rest of the surface uses.
fn denied(because: &str) -> RpcError {
    RpcError::new(
        ErrorCode::ScopeDenied,
        format!("hosts are listed to the person's own shell and to a token whose project lives on one: {because}"),
    )
}

/// One host, or the error a caller outside its scope gets — the same "no host
/// matches" either way, so the scope does not answer questions about machines
/// it is meant to hide.
async fn one<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<SshHost, RpcError> {
    let id = params
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    visible(app, caller)
        .await?
        .into_iter()
        .find(|h| h.id == id)
        .ok_or_else(|| RpcError::new(ErrorCode::NotFound, format!("no host matches `{id}`")))
}

/// The record plus what its live session says. Kept in one place so `host/list`
/// and `host/show` can never disagree about the same machine.
async fn view<R: tauri::Runtime>(app: &AppHandle<R>, host: &SshHost) -> Value {
    let state = app.state::<AppState>();
    // A session whose transport has ended is not a connection: it answers
    // nothing and can open no channel, so reporting it as connected would send
    // a caller to a host that is not there.
    let session = state
        .ssh_sessions
        .read()
        .await
        .get(&host.id)
        .filter(|conn| !conn.handle().is_closed())
        .cloned();
    let shell = state
        .ssh_shells
        .read()
        .await
        .get(&host.id)
        .map(|k| k.as_str().to_string());
    let mut out = json!({
        "id": host.id,
        "label": host.label,
        "hostname": host.hostname,
        "port": host.port,
        "user": host.user,
        "source": serde_json::to_value(host.source).unwrap_or(Value::Null),
        "needsPrompt": host.needs_prompt,
        "connected": session.is_some(),
    });
    if let Some(conn) = session {
        let (open, limit) = conn.channels();
        out["generation"] = json!(conn.generation());
        out["channels"] = json!({ "open": open, "limit": limit });
        if let Some(shell) = shell {
            out["shell"] = json!(shell);
        }
    }
    out
}

/// `host/list`.
pub async fn list<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    _params: &Value,
) -> Result<Value, RpcError> {
    let mut hosts = Vec::new();
    for host in visible(app, caller).await? {
        hosts.push(view(app, &host).await);
    }
    Ok(json!({ "hosts": hosts }))
}

/// `host/show`: the record, the projects registered on the machine and the
/// terminals open against its session — each one filtered by the same scope.
pub async fn show<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let host = one(app, caller, params).await?;
    let mut out = view(app, &host).await;
    let target = TargetId::Ssh(host.id.clone()).to_string();
    let resolver = Resolver::new(app, caller);
    let projects: Vec<Value> = resolver
        .projects()
        .await
        .into_iter()
        .filter(|p| p.target == target)
        .map(|p| serde_json::to_value(&p).unwrap_or(Value::Null))
        .collect();
    let tabs: Vec<_> = resolver
        .tabs()
        .await?
        .into_iter()
        .filter(|t| t.target == target)
        .collect();
    out["projects"] = json!(projects);
    out["terminals"] = json!(super::terminal::enrich(app, tabs).await);
    Ok(out)
}

/// `host/connect`: open a session on a host that has none.
///
/// The same call the person's Connect button makes, minus the one thing this
/// surface must never take — a password. Everything that needs a human (a
/// passphrase, a password, an unknown or changed host key) comes back as a
/// status, and nothing is trusted or stored on the way.
pub async fn connect<R: tauri::Runtime>(
    app: &AppHandle<R>,
    caller: &Caller,
    params: &Value,
) -> Result<Value, RpcError> {
    let host = one(app, caller, params).await?;
    let report = crate::commands::ssh_host_connect(
        app.clone(),
        app.state::<AppState>(),
        host.id.clone(),
        None,
    )
    .await
    .map_err(|e| RpcError::new(ErrorCode::Internal, e.message))?;
    let mut out = json!({
        "id": host.id,
        "connected": report.status == "connected",
        "status": report.status,
    });
    if let Some(generation) = report.generation {
        out["generation"] = json!(generation);
    }
    if let Some(shell) = report.shell {
        out["shell"] = json!(shell);
    }
    if let Some(reason) = report.reason {
        out["reason"] = serde_json::to_value(reason).unwrap_or(Value::Null);
    }
    if let Some(detail) = report.detail {
        out["detail"] = json!(detail);
    }
    Ok(receipts::receipt(
        receipts::key_of(params).as_deref(),
        json!({ "host": out }),
    ))
}
