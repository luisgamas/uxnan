//! Receipts: what a caller gets back from an entry that created something, and
//! the idempotency that makes retrying safe.
//!
//! A `create` entry answers with a receipt — `{ requestId, idempotencyKey?, … }`
//! plus what was created. When the caller supplied an `idempotencyKey`, the
//! receipt is remembered under `method:key` for the app's lifetime, and a later
//! call with the same method and key returns that receipt **without doing the
//! thing again**. That is what lets an agent retry a call whose reply it lost
//! (a timeout, a dropped connection) with no fear of a second worktree.
//!
//! In memory, not persisted: a key is a promise about *this* run of the app,
//! and a worktree created before a restart is visible to `worktree/list`
//! anyway. Bounded, so a caller minting a new key per call cannot grow it
//! without limit.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use serde_json::{json, Value};

/// How many receipts are kept. Oldest out first.
const CAPACITY: usize = 1024;

/// Remembered receipts, keyed by `method:key`.
#[derive(Default)]
pub struct Receipts {
    by_key: Mutex<(HashMap<String, Value>, VecDeque<String>)>,
}

impl Receipts {
    fn compound(method: &str, key: &str) -> String {
        format!("{method}:{key}")
    }

    /// The receipt an earlier call with this method and key produced, if any.
    pub fn lookup(&self, method: &str, key: &str) -> Option<Value> {
        let guard = self.by_key.lock().unwrap();
        guard.0.get(&Self::compound(method, key)).cloned()
    }

    /// Remember `receipt` for this method and key.
    pub fn remember(&self, method: &str, key: &str, receipt: Value) {
        let compound = Self::compound(method, key);
        let mut guard = self.by_key.lock().unwrap();
        let (map, order) = &mut *guard;
        if map.insert(compound.clone(), receipt).is_none() {
            order.push_back(compound);
            while order.len() > CAPACITY {
                if let Some(old) = order.pop_front() {
                    map.remove(&old);
                }
            }
        }
    }
}

/// The idempotency key a call carries, if any (trimmed; an empty one is none).
pub fn key_of(params: &Value) -> Option<String> {
    params
        .get("idempotencyKey")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Build a receipt: a fresh `requestId`, the caller's key when there was one,
/// and the entry's own fields merged in.
pub fn receipt(key: Option<&str>, mut body: Value) -> Value {
    let mut out = json!({ "requestId": uuid::Uuid::new_v4().to_string() });
    if let Some(k) = key {
        out["idempotencyKey"] = json!(k);
    }
    if let (Some(dst), Some(src)) = (out.as_object_mut(), body.as_object_mut()) {
        for (k, v) in src.iter_mut() {
            dst.insert(k.clone(), v.take());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_returns_the_first_receipt_and_only_for_its_method() {
        let r = Receipts::default();
        assert!(r.lookup("worktree/create", "k1").is_none());
        r.remember("worktree/create", "k1", json!({ "a": 1 }));
        assert_eq!(r.lookup("worktree/create", "k1").unwrap()["a"], 1);
        // Another entry with the same key is a different promise.
        assert!(r.lookup("terminal/create", "k1").is_none());
        // Remembering again does not replace: the first receipt is the promise.
        r.remember("worktree/create", "k1", json!({ "a": 2 }));
        assert_eq!(r.lookup("worktree/create", "k1").unwrap()["a"], 2);
    }

    #[test]
    fn the_store_is_bounded_oldest_first() {
        let r = Receipts::default();
        for i in 0..(CAPACITY + 10) {
            r.remember("m", &i.to_string(), json!(i));
        }
        assert!(r.lookup("m", "0").is_none());
        assert!(r.lookup("m", "9").is_none());
        assert!(r.lookup("m", "10").is_some());
        assert!(r.lookup("m", &(CAPACITY + 9).to_string()).is_some());
    }

    #[test]
    fn a_receipt_carries_the_id_the_key_and_the_body() {
        let v = receipt(Some("k"), json!({ "terminal": { "id": "t1" } }));
        assert!(v["requestId"].as_str().unwrap().len() > 10);
        assert_eq!(v["idempotencyKey"], "k");
        assert_eq!(v["terminal"]["id"], "t1");
        let none = receipt(None, json!({}));
        assert!(none.get("idempotencyKey").is_none());
        assert_eq!(key_of(&json!({ "idempotencyKey": " " })), None);
        assert_eq!(
            key_of(&json!({ "idempotencyKey": "x" })).as_deref(),
            Some("x")
        );
    }
}
