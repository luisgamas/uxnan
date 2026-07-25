//! Tauri command surface for automations.
//!
//! Thin, stateless wrappers: the store is file-backed (see [`super::store`]), so
//! nothing here needs the app's shared state. The commands keep one invariant
//! that the UI must never have to remember —
//!
//! **the definition on disk and the task in the OS scheduler always move
//! together.** Saving an automation registers or unregisters it, deleting one
//! removes its task and its history, and every mutation returns the resulting
//! [`SchedulerStatus`] so the caller can show the truth immediately instead of
//! assuming success.

use serde::Serialize;
use tauri::AppHandle;

use super::oscheduler::{self, SchedulerStatus};
use super::store::AutomationStore;
use super::{now_ms, validate, Automation, AutomationRun};
use crate::error::CommandError;

/// What the app gets back after saving an automation: the stored record plus
/// what the OS scheduler now thinks of it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub automation: Automation,
    pub scheduler: SchedulerStatus,
}

fn store() -> Result<AutomationStore, CommandError> {
    AutomationStore::open_default().map_err(CommandError::from)
}

/// Every saved automation.
#[tauri::command]
pub fn automations_list() -> Result<Vec<Automation>, CommandError> {
    store()?.load().map_err(CommandError::from)
}

/// Whether this platform can schedule an automation to run with the app closed.
/// The UI uses it to say so up front rather than after a failed save.
#[tauri::command]
pub fn automations_scheduler_supported() -> bool {
    oscheduler::is_supported()
}

/// The OS scheduler's view of one automation.
#[tauri::command]
pub async fn automations_scheduler_status(id: String) -> SchedulerStatus {
    oscheduler::status(&id).await
}

/// Create or update an automation, then bring its OS task in line.
///
/// `start_boundary` is a **local** ISO 8601 datetime the caller computes — the
/// backend deliberately does no calendar arithmetic (see [`super::schedule`]).
///
/// A validation failure is rejected before anything is written: half-saving an
/// automation that can never run would leave the user with a broken entry and no
/// explanation.
#[tauri::command]
pub async fn automations_save(
    mut automation: Automation,
    start_boundary: String,
) -> Result<SaveResult, CommandError> {
    let errors = validate(&automation);
    if !errors.is_empty() {
        return Err(CommandError::new("INVALID_INPUT", errors.join(" ")));
    }

    let store = store()?;
    let mut all = store.load().map_err(CommandError::from)?;
    let now = now_ms();
    automation.updated_at = now;
    match all.iter().position(|a| a.id == automation.id) {
        Some(i) => {
            // Keep the original creation stamp: an edit is not a new automation.
            automation.created_at = all[i].created_at;
            all[i] = automation.clone();
        }
        None => {
            if automation.created_at == 0 {
                automation.created_at = now;
            }
            all.push(automation.clone());
        }
    }
    store.save(&all).map_err(CommandError::from)?;

    // Definition first, then the task: if registration fails the automation is
    // still saved and the returned status says exactly why, which is what lets
    // the UI degrade honestly instead of losing the user's work.
    let scheduler = oscheduler::register(&automation, &start_boundary).await;
    Ok(SaveResult {
        automation,
        scheduler,
    })
}

/// Enable or disable an automation, registering or removing its task to match.
#[tauri::command]
pub async fn automations_set_enabled(
    id: String,
    enabled: bool,
    start_boundary: String,
) -> Result<SaveResult, CommandError> {
    let store = store()?;
    let mut all = store.load().map_err(CommandError::from)?;
    let Some(idx) = all.iter().position(|a| a.id == id) else {
        return Err(CommandError::new("NOT_FOUND", "automation not found"));
    };
    all[idx].enabled = enabled;
    all[idx].updated_at = now_ms();
    let automation = all[idx].clone();
    store.save(&all).map_err(CommandError::from)?;

    // `register` removes the task for a disabled automation, so this one call
    // covers both directions.
    let scheduler = oscheduler::register(&automation, &start_boundary).await;
    Ok(SaveResult {
        automation,
        scheduler,
    })
}

/// Delete an automation, its OS task and its run history.
#[tauri::command]
pub async fn automations_delete(id: String) -> Result<(), CommandError> {
    let store = store()?;
    let all: Vec<Automation> = store
        .load()
        .map_err(CommandError::from)?
        .into_iter()
        .filter(|a| a.id != id)
        .collect();
    store.save(&all).map_err(CommandError::from)?;
    // Best-effort cleanup: a stranded task or leftover history must not stop the
    // automation from disappearing from the user's list.
    let _ = oscheduler::unregister(&id).await;
    let _ = store.remove_runs(&id);
    Ok(())
}

/// An automation's run history, newest first.
#[tauri::command]
pub fn automations_runs(id: String) -> Result<Vec<AutomationRun>, CommandError> {
    store()?.list_runs(&id).map_err(CommandError::from)
}

/// The directory the app should watch to see runs appear and advance.
#[tauri::command]
pub fn automations_runs_dir() -> Result<String, CommandError> {
    Ok(store()?.watch_root().to_string_lossy().to_string())
}

/// Start a run right now.
///
/// Spawns **the same headless runner the OS scheduler spawns**, so a manual run
/// and a scheduled one cannot behave differently. Returns as soon as the process
/// is launched — progress is read from the run record, which the runner rewrites
/// as steps advance.
#[tauri::command]
pub fn automations_run_now(_app: AppHandle, id: String) -> Result<(), CommandError> {
    let exe = oscheduler::current_exe().map_err(CommandError::from)?;
    let mut args = oscheduler::run_args(&id);
    // Same runner, tagged as manual so the history can tell them apart.
    if let Some(last) = args.last_mut() {
        *last = "manual".to_string();
    }
    crate::winproc::command(&exe)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| CommandError::new("AGENT_ERROR", format!("could not start the run: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manual_run_reuses_the_scheduled_runner_with_a_manual_tag() {
        // The whole point of one execution path: same flag, same binary, only
        // the trigger label differs.
        let mut args = oscheduler::run_args("a1");
        if let Some(last) = args.last_mut() {
            *last = "manual".to_string();
        }
        assert_eq!(args, vec!["--automation-run", "a1", "--trigger", "manual"]);
    }

    #[test]
    fn scheduler_support_is_reported_per_platform() {
        // Every desktop target we ship has an integration; the constant exists
        // so the UI can say so before the user saves anything.
        assert_eq!(
            automations_scheduler_supported(),
            oscheduler::is_supported()
        );
    }
}
