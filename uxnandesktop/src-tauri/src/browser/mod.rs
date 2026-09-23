//! Integrated developer browser.
//!
//! Three concerns, one module each:
//!
//! - **Link routing** (here): the one decision every link in the app funnels
//!   through — open in the integrated browser, hand to the OS browser, or ask —
//!   per the user's [`crate::model::BrowserSettings`]. Shared by the `open_url`
//!   command, the agent `/browser` hook route and the control surface.
//! - **The URL gate** (here): which addresses a browser page may load. Only
//!   `http(s)` — and never the app's own origin, which Tauri treats as trusted.
//! - **The host** ([`host`]): the pages themselves. Each workspace owns at most
//!   one page, a child webview *inside* the main window (not a separate
//!   window), so it moves, minimizes and changes desktop with the app and is
//!   shown only while its workspace is the one on screen.

pub mod host;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::CommandError;
use crate::model::BrowserLinkPolicy;
use crate::state::AppState;

pub use host::BrowserHost;

// --- Link routing ----------------------------------------------------------

/// Where a link should open, resolved from [`BrowserLinkPolicy`] and the master
/// switch. Pure decision (see [`resolve_link_target`]) so it can be unit-tested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkTarget {
    /// Open in the integrated browser.
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

/// Event telling the frontend to open `url` in the integrated browser. `ask`
/// asks it to prompt internal-vs-external (the `Ask` policy); `workspace` names
/// the workspace whose browser should load it — `None` means the one on screen.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenUrlEvent {
    url: String,
    ask: bool,
    workspace: Option<String>,
}

/// The link policy in effect.
pub async fn link_target<R: tauri::Runtime>(app: &AppHandle<R>) -> LinkTarget {
    let state = app.state::<AppState>();
    let data = state.data.read().await;
    resolve_link_target(
        data.settings.browser.enabled,
        data.settings.browser.link_policy,
    )
}

/// Open `url` in the OS default browser.
pub fn open_external<R: tauri::Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| CommandError::new("OPEN_URL_FAILED", e.to_string()))
}

/// Open `url` per the user's [`crate::model::BrowserSettings`]: the integrated
/// browser of `workspace` (the one on screen when `None`), the OS default
/// browser, or a per-link prompt. A disabled browser always goes external.
pub async fn route_url<R: tauri::Runtime>(
    app: &AppHandle<R>,
    url: String,
    workspace: Option<String>,
) -> Result<LinkTarget, CommandError> {
    let target = link_target(app).await;
    match target {
        LinkTarget::External => open_external(app, &url)?,
        LinkTarget::Internal | LinkTarget::Ask => app
            .emit(
                "browser:open-url",
                OpenUrlEvent {
                    url,
                    ask: target == LinkTarget::Ask,
                    workspace,
                },
            )
            .map_err(|e| CommandError::new("EMIT_FAILED", e.to_string()))?,
    }
    Ok(target)
}

// --- URL gate --------------------------------------------------------------

/// Hosts the app itself is served from on platforms where Tauri's custom
/// protocols are spelled `http(s)://<protocol>.localhost` (Windows, Android).
/// Tauri treats a page on one of them as **local** — trusted with the app's own
/// commands without an ACL check — so a browser page must never load one.
const APP_HOSTS: [&str; 3] = ["tauri.localhost", "ipc.localhost", "asset.localhost"];

/// Whether `url` is the app's own origin: one of [`APP_HOSTS`], or — in a debug
/// build, where the frontend is served from the dev server — `dev_origin`.
fn is_app_origin(url: &tauri::Url, dev_origin: Option<&tauri::Url>) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if APP_HOSTS.contains(&host.as_str()) {
        return true;
    }
    dev_origin.is_some_and(|dev| {
        dev.scheme() == url.scheme()
            && dev.host_str() == url.host_str()
            && dev.port_or_known_default() == url.port_or_known_default()
    })
}

/// The dev server origin the app is served from in a debug build; `None` in a
/// release build, whose frontend comes from the bundled assets.
fn dev_origin<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<tauri::Url> {
    if cfg!(debug_assertions) {
        app.config().build.dev_url.clone()
    } else {
        None
    }
}

/// Whether an address can be *opened* (typed, clicked, asked for by an agent):
/// `http(s)` or the empty page, and never the app's own origin.
fn open_allowed(url: &tauri::Url, dev: Option<&tauri::Url>) -> bool {
    match url.scheme() {
        "http" | "https" => !is_app_origin(url, dev),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Whether a navigation the page starts may proceed — in the main frame or an
/// iframe. On top of [`open_allowed`], an iframe's `about:srcdoc` and `blob:`
/// documents are fine (they inherit their creator's origin); `file:`, `data:`,
/// `javascript:`, `tauri:` and every other scheme are refused, so a page or an
/// open redirect can never steer a browser page onto a local or privileged
/// origin.
fn nav_allowed(url: &tauri::Url, dev: Option<&tauri::Url>) -> bool {
    open_allowed(url, dev) || url.as_str() == "about:srcdoc" || url.scheme() == "blob"
}

/// Parse an address for the integrated browser, refusing anything
/// [`open_allowed`] refuses (`BROWSER_BAD_URL`). Every open/navigate entry
/// point funnels through this.
pub fn parse_url<R: tauri::Runtime>(
    app: &AppHandle<R>,
    raw: &str,
) -> Result<tauri::Url, CommandError> {
    let url = tauri::Url::parse(raw.trim())
        .map_err(|e| CommandError::new("BROWSER_BAD_URL", e.to_string()))?;
    if !open_allowed(&url, dev_origin(app).as_ref()) {
        return Err(CommandError::new(
            "BROWSER_BAD_URL",
            "only http(s) addresses outside the app itself can open in the integrated browser",
        ));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> tauri::Url {
        tauri::Url::parse(s).unwrap()
    }

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

    #[test]
    fn opens_http_https_and_the_empty_page() {
        assert!(open_allowed(&url("http://localhost:5173"), None));
        assert!(open_allowed(&url("https://example.com/p?q=1"), None));
        assert!(open_allowed(&url("about:blank"), None));
    }

    #[test]
    fn refuses_local_privileged_and_inline_schemes() {
        for s in [
            "file:///etc/hosts",
            "tauri://localhost",
            "data:text/html,<h1>x</h1>",
            "javascript:alert(1)",
            "about:config",
            "ipc://localhost/cmd",
        ] {
            assert!(!open_allowed(&url(s), None), "{s} must be refused");
            assert!(!nav_allowed(&url(s), None), "{s} must be refused in-page");
        }
    }

    #[test]
    fn refuses_the_apps_own_origin() {
        // Tauri trusts these as local: a page there would reach the app's
        // commands with no ACL check.
        assert!(!open_allowed(&url("http://tauri.localhost/"), None));
        assert!(!open_allowed(
            &url("https://TAURI.localhost/index.html"),
            None
        ));
        assert!(!open_allowed(&url("http://ipc.localhost/plugin"), None));
        assert!(!open_allowed(&url("http://asset.localhost/x.png"), None));
        let dev = url("http://localhost:1420");
        assert!(!open_allowed(&url("http://localhost:1420/"), Some(&dev)));
        // Another port on the same host is the person's own dev server.
        assert!(open_allowed(&url("http://localhost:5173/"), Some(&dev)));
        // A `*.localhost` dev host that is not a Tauri protocol is fine.
        assert!(open_allowed(&url("http://app.localhost:3000/"), Some(&dev)));
    }

    #[test]
    fn iframes_may_use_srcdoc_and_blob() {
        assert!(nav_allowed(&url("about:srcdoc"), None));
        assert!(nav_allowed(
            &url("blob:http://localhost:5173/6f1c7a3e-0000-4000-8000-000000000000"),
            None
        ));
        assert!(!open_allowed(&url("about:srcdoc"), None));
    }
}
