//! A browser page's screenshot, taken by the engine itself.
//!
//! What the page *looks like* is only knowable from the engine that renders it
//! — a DOM snapshot is not visual evidence — so each platform needs its own
//! capture. Supported today: **macOS** (`WKWebView takeSnapshotWithConfiguration:`
//! encoded to PNG by AppKit). Elsewhere [`supported`] is false and a capture
//! answers `BROWSER_UNSUPPORTED`, so the tools say so instead of pretending.
//!
//! FOR-DEV: Windows (`ICoreWebView2::CapturePreview`) and Linux
//! (`webkit_web_view_get_snapshot`) captures — see `FOR-DEV.md` → *Integrated
//! developer browser*. Each needs a run on that platform before `supported`
//! may say true there.

use tauri::Webview;

use crate::error::CommandError;

/// A captured image.
pub struct Capture {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Whether this platform can capture a page.
pub const fn supported() -> bool {
    cfg!(target_os = "macos")
}

/// Capture what `webview` shows now, as PNG.
pub async fn png<R: tauri::Runtime>(webview: &Webview<R>) -> Result<Capture, CommandError> {
    #[cfg(target_os = "macos")]
    {
        macos::png(webview).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Err(CommandError::new(
            "BROWSER_UNSUPPORTED",
            "page screenshots are not available on this platform yet",
        ))
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::Mutex;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{MainThreadMarker, NSDictionary, NSError};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use tauri::Webview;

    use super::Capture;
    use crate::error::CommandError;

    /// How long WebKit is given to render the snapshot.
    const TIMEOUT: Duration = Duration::from_secs(10);

    fn failed(message: impl Into<String>) -> CommandError {
        CommandError::new("BROWSER_CAPTURE_FAILED", message)
    }

    /// Encode a snapshot as PNG, at the pixel size of its best representation.
    fn encode(image: &NSImage) -> Result<Capture, String> {
        let tiff = image
            .TIFFRepresentation()
            .ok_or("the snapshot has no bitmap")?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("the snapshot is unreadable")?;
        let properties = NSDictionary::new();
        // SAFETY: `representationUsingType:properties:` takes an empty
        // property dictionary and returns new data or nil.
        let data = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        }
        .ok_or("the snapshot could not be encoded")?;
        Ok(Capture {
            png: data.to_vec(),
            width: u32::try_from(rep.pixelsWide()).unwrap_or(0),
            height: u32::try_from(rep.pixelsHigh()).unwrap_or(0),
        })
    }

    pub async fn png<R: tauri::Runtime>(webview: &Webview<R>) -> Result<Capture, CommandError> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<Capture, String>>();
        let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
        let send = move |outcome: Result<Capture, String>| {
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(outcome);
            }
        };
        webview
            .with_webview(move |platform| {
                let raw = platform.inner() as *mut WKWebView;
                // SAFETY: on macOS `inner()` is the page's live `WKWebView`,
                // and this closure runs on the main thread, where WebKit must
                // be called. It is retained for the duration of the call.
                let Some(view) = (unsafe { Retained::retain(raw) }) else {
                    send(Err("the page has no view".into()));
                    return;
                };
                let Some(mtm) = MainThreadMarker::new() else {
                    send(Err("not on the main thread".into()));
                    return;
                };
                // SAFETY: a plain allocation and setter, on the main thread.
                let config = unsafe {
                    let c = WKSnapshotConfiguration::new(mtm);
                    c.setAfterScreenUpdates(true);
                    c
                };
                let send = std::sync::Arc::new(send);
                let block = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                    // SAFETY: WebKit hands either an image or an error, both
                    // valid for the duration of the callback.
                    let outcome = unsafe {
                        if let Some(image) = image.as_ref() {
                            encode(image)
                        } else if let Some(error) = error.as_ref() {
                            Err(error.localizedDescription().to_string())
                        } else {
                            Err("WebKit returned no snapshot".into())
                        }
                    };
                    send(outcome);
                });
                // SAFETY: a valid view, configuration and completion block;
                // WebKit copies the block.
                unsafe {
                    view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &block);
                }
            })
            .map_err(|e| failed(e.to_string()))?;
        tokio::time::timeout(TIMEOUT, rx)
            .await
            .map_err(|_| failed("the page did not render a snapshot in time"))?
            .map_err(|_| failed("the page went away"))?
            .map_err(failed)
    }
}
