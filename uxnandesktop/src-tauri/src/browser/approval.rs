//! The person's approval of what an agent wants to do in a browser page.
//!
//! When the policy (`policy.rs`) says an action needs the person, the request
//! is pushed to the window as a `browser:approval` event — the browser panel of
//! that workspace shows it, with the element highlighted in the page — and the
//! agent's call waits for the answer, at most [`TIMEOUT`] (45 s). Nothing here is
//! persisted: a restart, the page closing or the time running out all end the
//! request as declined, and an approval never outlives the page it was given
//! for.
//!
//! A site approval ("allow this site") covers reads and low/medium actions on
//! that host for the rest of the page's life; high-risk actions ask every time.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use super::policy::Risk;
use crate::error::CommandError;

/// How long a request waits for the person. Below the tool-call timeout of the
/// agent CLIs (about a minute), so the agent reads *why* its call ended — the
/// person did not answer in time; ask again — rather than a transport timeout.
pub const TIMEOUT: Duration = Duration::from_secs(45);

/// What the person is asked.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub workspace: String,
    /// Who asks: the agent's tab title, or `uxnan-cli`.
    pub agent: String,
    /// `read`, `click`, `type`, `press` or `scroll`.
    pub action: String,
    /// `None` for a read.
    pub risk: Option<Risk>,
    /// The site, or `this machine` for a local page.
    pub host: String,
    pub url: String,
    /// `once` (this action) or `site` (the person may allow the whole site).
    pub scope: &'static str,
    /// The element's role and name, when the action has a target.
    pub target: Option<String>,
    /// What else matters: how much text, which key.
    pub detail: Option<String>,
}

/// The person's answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    Once,
    Site,
    Deny,
}

impl Answer {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "once" => Some(Answer::Once),
            "site" => Some(Answer::Site),
            "deny" => Some(Answer::Deny),
            _ => None,
        }
    }
}

struct Pending {
    request: ApprovalRequest,
    reply: oneshot::Sender<Answer>,
}

/// Pending requests and the sites approved per workspace. Managed state.
#[derive(Default)]
pub struct Approvals {
    pending: Mutex<HashMap<String, Pending>>,
    sites: Mutex<HashSet<(String, String)>>,
}

impl Approvals {
    /// Whether the person approved `host` for `workspace`'s page.
    pub fn site_approved(&self, workspace: &str, host: &str) -> bool {
        self.sites
            .lock()
            .map(|s| s.contains(&(workspace.to_string(), host.to_string())))
            .unwrap_or(false)
    }

    fn approve_site(&self, workspace: &str, host: &str) {
        if let Ok(mut s) = self.sites.lock() {
            s.insert((workspace.to_string(), host.to_string()));
        }
    }

    /// Every request still waiting (the window re-syncs from this).
    pub fn requests(&self) -> Vec<ApprovalRequest> {
        self.pending
            .lock()
            .map(|p| p.values().map(|x| x.request.clone()).collect())
            .unwrap_or_default()
    }

    fn take(&self, id: &str) -> Option<Pending> {
        self.pending.lock().ok().and_then(|mut p| p.remove(id))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    id: String,
    workspace: String,
}

/// Ask the person and wait. `Deny` when they decline, the time runs out or the
/// page goes away first.
pub async fn ask<R: tauri::Runtime>(app: &AppHandle<R>, mut request: ApprovalRequest) -> Answer {
    let approvals = app.state::<Approvals>();
    request.id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    if let Ok(mut p) = approvals.pending.lock() {
        p.insert(
            request.id.clone(),
            Pending {
                request: request.clone(),
                reply: tx,
            },
        );
    }
    let _ = app.emit("browser:approval", &request);
    let answer = match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(answer)) => answer,
        _ => Answer::Deny,
    };
    approvals.take(&request.id);
    if answer == Answer::Site && request.scope == "site" {
        approvals.approve_site(&request.workspace, &request.host);
    }
    let _ = app.emit(
        "browser:approval-done",
        Done {
            id: request.id,
            workspace: request.workspace,
        },
    );
    answer
}

/// Forget everything about a workspace's page: its waiting requests end as
/// declined, its site approvals are gone.
pub fn forget<R: tauri::Runtime>(app: &AppHandle<R>, workspace: &str) {
    let approvals = app.state::<Approvals>();
    if let Ok(mut p) = approvals.pending.lock() {
        // Dropping the senders ends the waits as declined.
        p.retain(|_, x| x.request.workspace != workspace);
    }
    if let Ok(mut s) = approvals.sites.lock() {
        s.retain(|(ws, _)| ws != workspace);
    };
}

/// The person answered a request (`once`, `site` or `deny`).
#[tauri::command]
pub async fn browser_approval_answer<R: tauri::Runtime>(
    app: AppHandle<R>,
    id: String,
    answer: String,
) -> Result<(), CommandError> {
    let answer = Answer::parse(&answer)
        .ok_or_else(|| CommandError::new("BROWSER_BAD_ANSWER", "answer is once, site or deny"))?;
    if let Some(pending) = app.state::<Approvals>().take(&id) {
        let _ = pending.reply.send(answer);
    }
    Ok(())
}

/// Every request still waiting for the person.
#[tauri::command]
pub async fn browser_approvals<R: tauri::Runtime>(app: AppHandle<R>) -> Vec<ApprovalRequest> {
    app.state::<Approvals>().requests()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_parse_strictly() {
        assert_eq!(Answer::parse("once"), Some(Answer::Once));
        assert_eq!(Answer::parse("site"), Some(Answer::Site));
        assert_eq!(Answer::parse("deny"), Some(Answer::Deny));
        assert_eq!(Answer::parse("yes"), None);
    }

    #[test]
    fn site_approvals_are_per_workspace_and_forgettable() {
        let a = Approvals::default();
        a.approve_site("/ws/a", "example.com");
        assert!(a.site_approved("/ws/a", "example.com"));
        assert!(!a.site_approved("/ws/b", "example.com"));
        assert!(!a.site_approved("/ws/a", "other.com"));
        a.sites.lock().unwrap().retain(|(ws, _)| ws != "/ws/a");
        assert!(!a.site_approved("/ws/a", "example.com"));
    }
}
