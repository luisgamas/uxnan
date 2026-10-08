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
}

#[derive(Default)]
struct StoreInner {
    docs: HashMap<String, Arc<Vec<u8>>>,
    lru: VecDeque<String>,
    bytes: usize,
}

impl ViewStore {
    fn insert(&self, key: String, html: String) -> Result<(), String> {
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
        inner.lru.retain(|item| item != &key);
        inner.bytes += bytes.len();
        inner.docs.insert(key.clone(), Arc::new(bytes));
        inner.lru.push_back(key);
        while inner.docs.len() > MAX_DOCUMENTS || inner.bytes > MAX_BYTES {
            let Some(oldest) = inner.lru.pop_front() else {
                break;
            };
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
    response_for(method, path.strip_prefix('/').unwrap_or(""), store)
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
}
