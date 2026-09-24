//! What only the engine behind a browser page can answer or do, per platform:
//! the page's session history, and its DevTools in a window of their own.
//!
//! Every call runs on the main thread (`with_webview`) and reports back over a
//! channel, like `capture.rs`.

use std::time::Duration;

use tauri::Webview;

/// How long to wait for the engine to answer.
const ANSWER: Duration = Duration::from_secs(1);

/// Run `ask` against the page's platform webview on the main thread and wait
/// for its answer (`None` if the page went away or did not answer in time).
async fn ask<R, T, F>(webview: &Webview<R>, ask: F) -> Option<T>
where
    R: tauri::Runtime,
    T: Send + 'static,
    F: FnOnce(tauri::webview::PlatformWebview) -> Option<T> + Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            let _ = tx.send(ask(platform));
        })
        .ok()?;
    tokio::time::timeout(ANSWER, rx).await.ok()?.ok()?
}

/// Whether the page can go back and forward — its whole session history, as
/// the engine keeps it. (The page's own Navigation API only counts entries of
/// its current origin: after a search result on another site it said "no way
/// back", and the toolbar's Back went dead.)
pub async fn history<R: tauri::Runtime>(webview: &Webview<R>) -> Option<(bool, bool)> {
    ask(webview, |platform| {
        #[cfg(target_os = "macos")]
        {
            use objc2::rc::Retained;
            use objc2::runtime::AnyObject;
            let raw = platform.inner() as *mut AnyObject;
            // SAFETY: on macOS `inner()` is the page's live `WKWebView`, on the
            // main thread; `canGoBack` / `canGoForward` are its public
            // properties.
            unsafe {
                let view = Retained::retain(raw)?;
                let back: bool = objc2::msg_send![&*view, canGoBack];
                let forward: bool = objc2::msg_send![&*view, canGoForward];
                Some((back, forward))
            }
        }
        #[cfg(windows)]
        {
            // SAFETY: WebView2 calls on the UI thread `with_webview` runs on.
            unsafe {
                let core = platform.controller().CoreWebView2().ok()?;
                let mut back = windows::core::BOOL::default();
                let mut forward = windows::core::BOOL::default();
                core.CanGoBack(&mut back).ok()?;
                core.CanGoForward(&mut forward).ok()?;
                Some((back.as_bool(), forward.as_bool()))
            }
        }
        #[cfg(target_os = "linux")]
        {
            use webkit2gtk::WebViewExt;
            let view = platform.inner();
            Some((view.can_go_back(), view.can_go_forward()))
        }
    })
    .await
}

/// Open the page's DevTools in a window of their own.
///
/// WebKit docks its inspector into the view the page is attached to — and the
/// page is a child of the *app's* window, so a docked inspector took the whole
/// window over and stretched the page across it, on top of the app. The
/// inspector opens asynchronously (it has to load its own page first), so it
/// is detached once it is up; WebKit remembers the choice and opens it detached
/// from then on. The page's bounds are put back afterwards — docking and
/// undocking both resize it. WebView2 always opens DevTools in a window.
pub async fn open_devtools<R: tauri::Runtime>(webview: &Webview<R>) {
    #[cfg(windows)]
    webview.open_devtools();
    #[cfg(not(windows))]
    {
        let bounds = webview.bounds().ok();
        webview.open_devtools();
        // Until the inspector is up (≈ 2 s at most), then undock it.
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if webview.is_devtools_open() {
                detach(webview).await;
                break;
            }
        }
        // Put the page back where it belongs — now, and once more after the
        // engine has finished laying the undocked inspector out.
        if let Some(bounds) = bounds {
            let _ = webview.set_bounds(bounds);
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = webview.set_bounds(bounds);
        }
    }
}

/// Undock an open inspector.
#[cfg(not(windows))]
async fn detach<R: tauri::Runtime>(webview: &Webview<R>) {
    let _: Option<()> = ask(webview, |platform| {
        #[cfg(target_os = "macos")]
        {
            use objc2::rc::Retained;
            use objc2::runtime::AnyObject;
            use objc2::sel;
            let raw = platform.inner() as *mut AnyObject;
            // SAFETY: on macOS `inner()` is the page's live `WKWebView`, on the
            // main thread. `_inspector` is its (private) inspector object — the
            // one wry's `open_devtools` shows; `detach` is asked for first, so a
            // WebKit without it is left alone rather than sent an unknown
            // message.
            unsafe {
                let view = Retained::retain(raw)?;
                let inspector: Option<Retained<AnyObject>> = objc2::msg_send![&*view, _inspector];
                let inspector = inspector?;
                let can: bool = objc2::msg_send![&*inspector, respondsToSelector: sel!(detach)];
                if can {
                    let () = objc2::msg_send![&*inspector, detach];
                }
            }
            Some(())
        }
        #[cfg(target_os = "linux")]
        {
            use webkit2gtk::{WebInspectorExt, WebViewExt};
            if let Some(inspector) = platform.inner().inspector() {
                inspector.detach();
            }
            Some(())
        }
    })
    .await;
}
