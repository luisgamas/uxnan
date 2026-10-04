//! A host's automation run, carried from the runner to the app.
//!
//! The runner is a windowless process the OS scheduler starts; it has no SSH
//! connection, and standing one up would mean a second session beside the
//! window's, with prompts nobody is there to answer. The window already holds
//! the connection, so the runner asks it — the rule for every short-lived
//! process here: talk to the running one, never stand up a second.
//!
//! The way in is the app's local server, found through the same discovery file
//! `uxnan-cli` uses and authorized by its **control** token, on a route of its
//! own ([`PATH`]) that is not part of the published control catalog: it starts
//! a run the user already scheduled, and nothing else.
//!
//! The app then owns the run: it records it — started, or unavailable because
//! the host is not connected — and executes it with the runner's own sequence
//! (`runner::run`) on [`Place::Host`].

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::place::Place;
use super::store::AutomationStore;
use super::{runner, RunTrigger};
use crate::error::AppError;
use crate::state::AppState;

/// The route on the app's local server.
pub const PATH: &str = "/automations/v1/handoff";

/// How long the runner waits for the app to accept. Accepting is immediate —
/// the run itself goes on in the app.
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(15);

/// What the runner sends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub automation: String,
    pub trigger: RunTrigger,
}

/// Runner side: hand the run of `automation` to the running app. The error
/// is the end of a sentence — "this automation works on the host X, and …".
pub fn send(automation: &str, trigger: RunTrigger) -> Result<(), String> {
    let endpoint = uxnan_control_client::from_discovery_file()
        .map_err(|_| "Uxnan Desktop was not open to reach it".to_string())?;
    let body = serde_json::to_vec(&Handoff {
        automation: automation.to_string(),
        trigger,
    })
    .map_err(|e| e.to_string())?;
    let (status, reply) = uxnan_control_client::post(&endpoint, PATH, &body, ACCEPT_TIMEOUT)
        .map_err(|e| format!("Uxnan Desktop did not take the run ({})", e.message))?;
    if (200..300).contains(&status) {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&reply).trim().to_string();
    Err(if status == 404 {
        "the Uxnan Desktop that is open predates runs on hosts; update it".to_string()
    } else {
        format!("Uxnan Desktop refused the run ({status}: {detail})")
    })
}

/// App side: run `automation` on the host it works on, through that host's
/// engine, or record why it cannot. Returns once the run is under way (or
/// recorded); the run itself goes on in the background.
pub async fn start<R: tauri::Runtime>(
    app: &AppHandle<R>,
    automation: &str,
    trigger: RunTrigger,
) -> Result<(), AppError> {
    let store = AutomationStore::open_default()?;
    let Some(automation) = store.get(automation)? else {
        return Err(AppError::NotFound(format!(
            "automation '{automation}' no longer exists"
        )));
    };
    let Some(host_id) = automation.target.ssh_host_id().map(str::to_string) else {
        return Err(AppError::Invalid(format!(
            "'{}' works on this machine, not on a host",
            automation.name
        )));
    };
    let state = app.state::<AppState>();
    let label = state
        .data
        .read()
        .await
        .settings
        .ssh_hosts
        .iter()
        .find(|h| h.id == host_id)
        .map(|h| h.label.clone())
        .unwrap_or_else(|| host_id.clone());
    // FOR-DEV: with this app closed or the host not connected, a host's run
    // cannot happen — running it with this machine off needs something on the
    // host that keeps time (its engine, or its own bridge), a decision for the
    // maintainer. See FOR-DEV.md → Remote hosts → the host engine, item 3.
    let Some(engine) = crate::commands::connected_engine(app, &state, &host_id).await else {
        runner::record_unavailable(
            &store,
            &automation,
            trigger,
            format!(
                "it works on {label}, which was not connected — a host's automation runs while Uxnan is open and connected to it"
            ),
        );
        return Ok(());
    };
    let place = Place::Host { host_id, engine };
    tauri::async_runtime::spawn(async move {
        runner::run(&store, automation, trigger, &place).await;
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_handoff_names_the_automation_and_how_it_was_started() {
        let wire = serde_json::to_value(Handoff {
            automation: "a1".into(),
            trigger: RunTrigger::Scheduled,
        })
        .unwrap();
        assert_eq!(
            wire,
            serde_json::json!({ "automation": "a1", "trigger": "scheduled" })
        );
    }
}
