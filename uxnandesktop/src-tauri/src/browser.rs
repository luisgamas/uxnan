//! Integrated developer browser — link routing.
//!
//! The browser itself is rendered in the frontend as a plain `<iframe>` center tab
//! (`BrowserPane.svelte`), so there is no native webview to manage here. This module
//! owns the one decision every link funnels through: open `url` in the in-app
//! browser tab, hand it to the OS default browser, or prompt — per the user's
//! [`crate::model::BrowserSettings`]. Shared by the `open_url` command and the agent
//! `/browser` hook route (`hooks.rs`).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::CommandError;
use crate::model::BrowserLinkPolicy;
use crate::state::AppState;

/// Where a link should open, resolved from [`BrowserLinkPolicy`] and the master
/// switch. Pure decision (see [`resolve_link_target`]) so it can be unit-tested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkTarget {
    /// Open in the integrated browser tab.
    Internal,
    /// Hand off to the OS default browser.
    External,
    /// Let the user choose per link (the frontend prompts).
    Ask,
}

/// Resolve where a link opens. The master switch wins: a disabled browser always
/// routes to the OS browser, regardless of the policy.
pub fn resolve_link_target(enabled: bool, policy: BrowserLinkPolicy) -> LinkTarget {
    if !enabled {
        return LinkTarget::External;
    }
    match policy {
        BrowserLinkPolicy::Internal => LinkTarget::Internal,
        BrowserLinkPolicy::External => LinkTarget::External,
        BrowserLinkPolicy::Ask => LinkTarget::Ask,
    }
}

/// Event telling the frontend to open `url` in the integrated browser. The `ask`
/// flag asks it to prompt internal-vs-external (the `Ask` policy).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenUrlEvent {
    url: String,
    ask: bool,
}

fn emit_open_url(app: &AppHandle, url: &str, ask: bool) -> Result<(), CommandError> {
    app.emit(
        "browser:open-url",
        OpenUrlEvent {
            url: url.to_string(),
            ask,
        },
    )
    .map_err(|e| CommandError::new("EMIT_FAILED", e.to_string()))
}

/// Open `url` per the user's [`crate::model::BrowserSettings`]: the in-app browser
/// tab, the OS default browser, or a per-link prompt. The single decision point
/// shared by the `open_url` command and the agent `/browser` hook route; a disabled
/// browser always goes external.
pub async fn route_url(app: &AppHandle, url: String) -> Result<(), CommandError> {
    let (enabled, policy) = {
        let state = app.state::<AppState>();
        let data = state.data.read().await;
        (
            data.settings.browser.enabled,
            data.settings.browser.link_policy,
        )
    };
    match resolve_link_target(enabled, policy) {
        LinkTarget::External => {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| CommandError::new("OPEN_URL_FAILED", e.to_string()))
        }
        LinkTarget::Internal => emit_open_url(app, &url, false),
        LinkTarget::Ask => emit_open_url(app, &url, true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_always_routes_external() {
        assert_eq!(
            resolve_link_target(false, BrowserLinkPolicy::Internal),
            LinkTarget::External
        );
        assert_eq!(
            resolve_link_target(false, BrowserLinkPolicy::Ask),
            LinkTarget::External
        );
    }

    #[test]
    fn enabled_follows_policy() {
        assert_eq!(
            resolve_link_target(true, BrowserLinkPolicy::Internal),
            LinkTarget::Internal
        );
        assert_eq!(
            resolve_link_target(true, BrowserLinkPolicy::External),
            LinkTarget::External
        );
        assert_eq!(
            resolve_link_target(true, BrowserLinkPolicy::Ask),
            LinkTarget::Ask
        );
    }
}
