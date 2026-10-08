//! Staged, isolated agent views served through the `uxnan-view` scheme.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{
    http::{Response, StatusCode},
    State,
};

const MAX_DOCUMENTS: usize = 24;
const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const VIEW_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

#[derive(Default)]
pub struct ViewStore {
    inner: Mutex<StoreInner>,
    render_lock: tokio::sync::Mutex<()>,
}

#[derive(Default)]
struct StoreInner {
    docs: HashMap<String, Arc<Vec<u8>>>,
    lru: VecDeque<String>,
    bytes: usize,
    pinned: Option<String>,
}

impl ViewStore {
    fn insert(&self, key: String, html: String) -> Result<(), String> {
        self.insert_with_pin(key, html, false)
    }

    fn insert_with_pin(&self, key: String, html: String, pin: bool) -> Result<(), String> {
        if !valid_key(&key) {
            return Err("invalid view key".into());
        }
        let bytes = html.into_bytes();
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err("view document exceeds the staging limit".into());
        }
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "view store unavailable".to_string())?;
        if let Some(old) = inner.docs.remove(&key) {
            inner.bytes -= old.len();
        }
        if !pin && inner.pinned.as_deref() == Some(key.as_str()) {
            inner.pinned = None;
        }
        inner.lru.retain(|item| item != &key);
        inner.bytes += bytes.len();
        inner.docs.insert(key.clone(), Arc::new(bytes));
        inner.lru.push_back(key.clone());
        if pin {
            inner.pinned = Some(key);
        }
        while inner.docs.len() > MAX_DOCUMENTS || inner.bytes > MAX_BYTES {
            let Some(index) = inner
                .lru
                .iter()
                .position(|candidate| inner.pinned.as_ref() != Some(candidate))
            else {
                break;
            };
            let oldest = inner.lru.remove(index).expect("index came from the queue");
            if let Some(doc) = inner.docs.remove(&oldest) {
                inner.bytes -= doc.len();
            }
        }
        Ok(())
    }

    fn get(&self, key: &str) -> Option<Arc<Vec<u8>>> {
        let mut inner = self.inner.lock().ok()?;
        let doc = inner.docs.get(key)?.clone();
        inner.lru.retain(|item| item != key);
        inner.lru.push_back(key.to_owned());
        Some(doc)
    }

    pub(crate) fn remove(&self, key: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(doc) = inner.docs.remove(key) {
                inner.bytes -= doc.len();
            }
            inner.lru.retain(|item| item != key);
            if inner.pinned.as_deref() == Some(key) {
                inner.pinned = None;
            }
        }
    }

    pub(crate) async fn serialize_render(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.render_lock.lock().await
    }
}

fn valid_key(key: &str) -> bool {
    key.len() == 32
        && key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageViewArgs {
    key: String,
    html: String,
}

#[tauri::command]
pub fn view_stage(args: StageViewArgs, store: State<'_, ViewStore>) -> Result<String, String> {
    stage(args, &store)
}

fn stage(args: StageViewArgs, store: &ViewStore) -> Result<String, String> {
    store.insert(args.key.clone(), args.html)?;
    #[cfg(target_os = "windows")]
    let url = format!("http://uxnan-view.localhost/{}", args.key);
    #[cfg(not(target_os = "windows"))]
    let url = format!("uxnan-view://localhost/{}", args.key);
    Ok(url)
}

/// Stage a page for `view/render` and return the URL of its render frame:
/// [`RENDER_FRAME`], our own page, which holds the agent's page in an
/// `allow-scripts` iframe. A webview's main frame gets Tauri's IPC bridge
/// injected; the sandboxed child, with its opaque origin, gets none — so the
/// agent's code never runs where the app's commands are in reach.
pub(crate) fn stage_render(key: &str, html: String, store: &ViewStore) -> Result<String, String> {
    store.insert_with_pin(key.to_owned(), html, true)?;
    Ok(scheme_url(key)?.replacen(&format!("/{key}"), &format!("/render/{key}"), 1))
}

/// The page a render webview loads: the agent's page (`./<key>` on this
/// scheme) in a sandboxed iframe, and the protocol host it needs — it answers
/// `ui/initialize`, keeps the height the page reports and the console lines it
/// forwards (`uxnan/log`), and once the page has loaded and settled writes
/// `{ contentHeight, console }` into its own URL's hash, which is how the
/// report leaves a page that has no network and no IPC.
const RENDER_FRAME: &str = r#"<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}iframe{display:block;border:0;width:100%;height:100vh}</style>
</head><body><iframe sandbox="allow-scripts" src="../__KEY__"></iframe><script>
(() => {
  const frame = document.querySelector('iframe');
  const entries = [];
  let contentHeight = 0, done = false;
  const clip = (v) => Array.from(String(v)).slice(0, 500).join('');
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.method === 'ui/initialize' && m.id !== undefined) {
      frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { hostContext: { theme: 'light', platform: 'desktop', displayMode: 'inline' } } }, '*');
    } else if (m.method === 'ui/notifications/size-changed' && m.params && Number.isFinite(m.params.height)) {
      contentHeight = Math.max(0, Math.min(10000000, Math.ceil(m.params.height)));
    } else if (m.method === 'uxnan/log' && m.params && entries.length < 50) {
      const level = ['error', 'warning', 'log'].includes(m.params.level) ? m.params.level : 'log';
      entries.push({ level, text: clip(m.params.text) });
    }
  });
  const report = () => {
    if (done) return;
    done = true;
    history.replaceState(null, '', '#uxnan-render=' + encodeURIComponent(JSON.stringify({ contentHeight, console: entries })));
  };
  // A timer, not animation frames: the render webview is hidden and gets none.
  frame.addEventListener('load', () => setTimeout(report, 600), { once: true });
})();
</script></body></html>"#;

/// The render frame's own policy: inline script and style, frames from this
/// scheme only, and nothing else.
const RENDER_FRAME_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src uxnan-view: http://uxnan-view.localhost; base-uri 'none'; form-action 'none'";

fn scheme_url(key: &str) -> Result<String, String> {
    if !valid_key(key) {
        return Err("invalid view key".into());
    }
    #[cfg(target_os = "windows")]
    let url = format!("http://uxnan-view.localhost/{key}");
    #[cfg(not(target_os = "windows"))]
    let url = format!("uxnan-view://localhost/{key}");
    Ok(url)
}

pub(crate) fn render_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn response_for(method: &str, key: &str, store: &ViewStore) -> Response<Vec<u8>> {
    if method != "GET" || !valid_key(key) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap();
    }
    let Some(body) = store.get(key) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap();
    };
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", VIEW_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(body.as_ref().clone())
        .unwrap()
}

pub fn response_for_uri(method: &str, path: &str, store: &ViewStore) -> Response<Vec<u8>> {
    let path = path.strip_prefix('/').unwrap_or("");
    if let Some(key) = path.strip_prefix("render/") {
        return render_frame_response(method, key, store);
    }
    response_for(method, path, store)
}

/// [`RENDER_FRAME`] for a staged page, or 404.
fn render_frame_response(method: &str, key: &str, store: &ViewStore) -> Response<Vec<u8>> {
    if method != "GET" || !valid_key(key) || store.get(key).is_none() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap();
    }
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", RENDER_FRAME_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(RENDER_FRAME.replace("__KEY__", key).into_bytes())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn stores_and_reads_a_document() {
        let store = ViewStore::default();
        store.insert(KEY.into(), "<h1>view</h1>".into()).unwrap();
        assert_eq!(store.get(KEY).unwrap().as_slice(), b"<h1>view</h1>");
    }

    #[test]
    fn generated_keys_are_fresh_lowercase_hex() {
        let a = render_key();
        let b = render_key();
        assert_eq!(a.len(), 32);
        assert!(valid_key(&a));
        assert_ne!(a, b);
    }

    #[test]
    fn removes_a_staged_document() {
        let store = ViewStore::default();
        store.insert(KEY.into(), "x".into()).unwrap();
        store.remove(KEY);
        assert!(store.get(KEY).is_none());
    }

    #[test]
    fn regular_view_staging_does_not_evict_the_active_render() {
        let store = ViewStore::default();
        let pinned = "f".repeat(32);
        store
            .insert_with_pin(pinned.clone(), "render".into(), true)
            .unwrap();
        for i in 0..=MAX_DOCUMENTS {
            store.insert(format!("{i:032x}"), "chat".into()).unwrap();
        }
        assert!(store.get(&pinned).is_some());
    }

    #[test]
    fn staging_command_returns_the_platform_scheme_url() {
        let store = ViewStore::default();
        let url = stage(
            StageViewArgs {
                key: KEY.into(),
                html: "<p>view</p>".into(),
            },
            &store,
        )
        .unwrap();
        #[cfg(target_os = "windows")]
        assert_eq!(url, format!("http://uxnan-view.localhost/{KEY}"));
        #[cfg(not(target_os = "windows"))]
        assert_eq!(url, format!("uxnan-view://localhost/{KEY}"));
    }

    #[test]
    fn evicts_oldest_document_at_capacity() {
        let store = ViewStore::default();
        for i in 0..=MAX_DOCUMENTS {
            store.insert(format!("{i:032x}"), "x".into()).unwrap();
        }
        assert!(store.get(&format!("{:032x}", 0)).is_none());
        assert!(store.get(&format!("{:032x}", MAX_DOCUMENTS)).is_some());
    }

    #[test]
    fn response_has_isolation_headers_and_rejects_other_requests() {
        let store = ViewStore::default();
        store.insert(KEY.into(), "<p>safe</p>".into()).unwrap();
        let response = response_for_uri("GET", &format!("/{KEY}"), &store);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["Content-Security-Policy"], VIEW_CSP);
        assert_eq!(response.headers()["X-Content-Type-Options"], "nosniff");
        assert_eq!(response.headers()["Cache-Control"], "no-store");
        assert_eq!(response.body(), b"<p>safe</p>");
        assert_eq!(
            response_for_uri("POST", &format!("/{KEY}"), &store).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            response_for_uri("GET", "/not-a-key", &store).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn a_render_holds_the_page_in_a_sandboxed_frame_of_its_own() {
        let store = ViewStore::default();
        let url = stage_render(KEY, "<p>agent page</p>".into(), &store).unwrap();
        assert!(url.ends_with(&format!("/render/{KEY}")), "{url}");
        let frame = response_for_uri("GET", &format!("/render/{KEY}"), &store);
        assert_eq!(frame.status(), StatusCode::OK);
        let body = String::from_utf8(frame.body().clone()).unwrap();
        assert!(body.contains(&format!(
            r#"<iframe sandbox="allow-scripts" src="../{KEY}">"#
        )));
        assert!(
            !body.contains("agent page"),
            "the agent's page is not in the frame itself"
        );
        let csp = frame.headers()["Content-Security-Policy"].to_str().unwrap();
        assert!(csp.contains("frame-src uxnan-view: http://uxnan-view.localhost"));
        assert!(!csp.contains("connect-src") || csp.contains("default-src 'none'"));
        // The page itself is served as before, with its own policy.
        let page = response_for_uri("GET", &format!("/{KEY}"), &store);
        assert_eq!(page.headers()["Content-Security-Policy"], VIEW_CSP);
        // Nothing for a key that is not staged, or a malformed one.
        let other = "f".repeat(32);
        assert_eq!(
            response_for_uri("GET", &format!("/render/{other}"), &store).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            response_for_uri("GET", "/render/../x", &store).status(),
            StatusCode::NOT_FOUND
        );
    }
}
