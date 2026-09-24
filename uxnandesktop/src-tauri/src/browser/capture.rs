//! A browser page's screenshot, taken by the engine itself.
//!
//! What the page *looks like* is only knowable from the engine that renders it
//! — a DOM snapshot is not visual evidence — so each platform has its own
//! capture, all ending in PNG bytes:
//!
//! - **macOS** — `WKWebView takeSnapshotWithConfiguration:`, encoded by AppKit.
//! - **Windows** — WebView2's `ICoreWebView2::CapturePreview` into an in-memory
//!   stream.
//! - **Linux** — WebKitGTK's `webkit_web_view_get_snapshot`, written by cairo.
//!
//! Every platform runs the capture on the main thread (`with_webview`) and
//! hands the bytes back through a channel with a timeout, so a page that never
//! renders fails the call instead of hanging it.
//!
//! FOR-DEV: the Windows and Linux captures compile on CI but have not run on a
//! real machine yet — see `FOR-DEV.md` → *Integrated developer browser*.

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
    cfg!(any(target_os = "macos", windows, target_os = "linux"))
}

/// How long the engine is given to render a capture.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

fn failed(message: impl Into<String>) -> CommandError {
    CommandError::new("BROWSER_CAPTURE_FAILED", message)
}

/// The pixel size a PNG declares in its header (`IHDR`), or `None` when the
/// bytes are not a PNG.
pub fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    if png.len() < 24 || png[..8] != SIGNATURE || &png[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(png[20..24].try_into().ok()?);
    Some((width, height))
}

/// A capture from PNG bytes, refusing anything that is not one.
#[cfg(any(windows, target_os = "linux"))]
fn from_png(png: Vec<u8>) -> Result<Capture, String> {
    let (width, height) =
        png_size(&png).ok_or("the engine returned something that is not a PNG")?;
    Ok(Capture { png, width, height })
}

/// What a platform capture ends in.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
type Outcome = Result<Capture, String>;

/// A one-shot reply slot a platform callback can fill from wherever it runs.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn reply() -> (
    impl Fn(Outcome) + Clone + Send + Sync + 'static,
    tokio::sync::oneshot::Receiver<Outcome>,
) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let send = move |outcome: Outcome| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(outcome);
        }
    };
    (send, rx)
}

/// Wait for a platform capture's reply.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
async fn wait(rx: tokio::sync::oneshot::Receiver<Outcome>) -> Result<Capture, CommandError> {
    tokio::time::timeout(TIMEOUT, rx)
        .await
        .map_err(|_| failed("the page did not render a capture in time"))?
        .map_err(|_| failed("the page went away"))?
        .map_err(failed)
}

/// Capture what `webview` shows now, as PNG.
pub async fn png<R: tauri::Runtime>(webview: &Webview<R>) -> Result<Capture, CommandError> {
    #[cfg(target_os = "macos")]
    {
        macos::png(webview).await
    }
    #[cfg(windows)]
    {
        windows_capture::png(webview).await
    }
    #[cfg(target_os = "linux")]
    {
        linux::png(webview).await
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = webview;
        Err(CommandError::new(
            "BROWSER_UNSUPPORTED",
            "page screenshots are not available on this platform",
        ))
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{MainThreadMarker, NSDictionary, NSError};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use tauri::Webview;

    use super::{failed, png_size, reply, wait, Capture};
    use crate::error::CommandError;

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
        let png = data.to_vec();
        let (width, height) = png_size(&png).ok_or("the snapshot is not a PNG")?;
        Ok(Capture { png, width, height })
    }

    pub async fn png<R: tauri::Runtime>(webview: &Webview<R>) -> Result<Capture, CommandError> {
        let (send, rx) = reply();
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
        wait(rx).await
    }
}

#[cfg(windows)]
mod windows_capture {
    use tauri::Webview;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;

    use super::{failed, from_png, reply, wait, Capture};
    use crate::error::CommandError;

    /// Read a whole in-memory stream from its start.
    fn read_all(stream: &IStream) -> Result<Vec<u8>, String> {
        // SAFETY: plain COM calls on a stream this module created and owns.
        unsafe {
            stream
                .Seek(0, STREAM_SEEK_SET, None)
                .map_err(|e| e.message())?;
            let mut stat = STATSTG::default();
            stream
                .Stat(&mut stat, STATFLAG_NONAME)
                .map_err(|e| e.message())?;
            let len = u32::try_from(stat.cbSize).map_err(|_| "the capture is too large")?;
            let mut bytes = vec![0u8; len as usize];
            let mut read = 0u32;
            stream
                .Read(bytes.as_mut_ptr().cast(), len, Some(&mut read))
                .ok()
                .map_err(|e| e.message())?;
            bytes.truncate(read as usize);
            Ok(bytes)
        }
    }

    pub async fn png<R: tauri::Runtime>(webview: &Webview<R>) -> Result<Capture, CommandError> {
        let (send, rx) = reply();
        webview
            .with_webview(move |platform| {
                let fail = send.clone();
                let run = move || -> Result<(), String> {
                    // SAFETY: WebView2 is called on the main (UI) thread, which
                    // is where `with_webview` runs this closure.
                    unsafe {
                        let core = platform
                            .controller()
                            .CoreWebView2()
                            .map_err(|e| e.message())?;
                        let stream = SHCreateMemStream(None).ok_or("no memory stream")?;
                        let target = stream.clone();
                        let handler =
                            CapturePreviewCompletedHandler::create(Box::new(move |result| {
                                send(
                                    result
                                        .map_err(|e| e.message())
                                        .and_then(|()| read_all(&target))
                                        .and_then(from_png),
                                );
                                Ok(())
                            }));
                        core.CapturePreview(
                            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                            &stream,
                            &handler,
                        )
                        .map_err(|e| e.message())
                    }
                };
                if let Err(e) = run() {
                    fail(Err(e));
                }
            })
            .map_err(|e| failed(e.to_string()))?;
        wait(rx).await
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use tauri::Webview;
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    use super::{failed, from_png, reply, wait, Capture};
    use crate::error::CommandError;

    pub async fn png<R: tauri::Runtime>(webview: &Webview<R>) -> Result<Capture, CommandError> {
        let (send, rx) = reply();
        webview
            .with_webview(move |platform| {
                platform.inner().snapshot(
                    SnapshotRegion::Visible,
                    SnapshotOptions::NONE,
                    None::<&webkit2gtk::gio::Cancellable>,
                    move |result| {
                        let outcome = result.map_err(|e| e.to_string()).and_then(|surface| {
                            let mut png = Vec::new();
                            surface.write_to_png(&mut png).map_err(|e| e.to_string())?;
                            from_png(png)
                        });
                        send(outcome);
                    },
                );
            })
            .map_err(|e| failed(e.to_string()))?;
        wait(rx).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_size_a_png_declares() {
        // The first 24 bytes of a 1040 x 1688 PNG.
        let mut png = vec![
            0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 13,
        ];
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&1040u32.to_be_bytes());
        png.extend_from_slice(&1688u32.to_be_bytes());
        assert_eq!(png_size(&png), Some((1040, 1688)));
    }

    #[test]
    fn refuses_what_is_not_a_png() {
        assert_eq!(png_size(b"GIF89a............................"), None);
        assert_eq!(png_size(&[0x89, b'P']), None);
    }

    #[test]
    fn every_desktop_platform_can_capture() {
        assert!(supported());
    }
}
