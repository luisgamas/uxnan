//! The keys a remote host's own bridge seals its secrets with (`02g` §3,
//! §5.18).
//!
//! A host's only keyring is usually the kernel's, which a reboot clears — and
//! with it the bridge's identity, unpairing every phone. So the bridge there
//! keeps its secrets in a file sealed with AES-256-GCM, under a key it is handed
//! at every start and never stores. The key is made here, one per host, and
//! kept in this machine's OS keychain: the one secret this app persists, and
//! only in the store the platform encrypts. The host engine is handed it at
//! each connect (`BridgeCall::Unlock`), holds it in memory, and gives it to the
//! bridge on standard input. The bridge only ever starts while this app is
//! connected — the engine itself is started by a connect — so the key is always
//! there when it is needed.
//!
//! A key is named by the machine and account it unlocks (`user@hostname:port`),
//! not by the host's id here, so forgetting a host and adding it again finds
//! the same key; and by this app's profile, so a development build never takes
//! the installed app's keys.

use std::collections::HashMap;
use std::sync::Mutex;

/// Where the keys live.
pub trait KeyStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
}

/// This machine's OS keychain.
pub struct OsKeychain {
    service: String,
}

impl OsKeychain {
    pub fn new() -> Self {
        Self {
            service: "dev.luisgamas.uxnandesktop".to_string(),
        }
    }
}

impl Default for OsKeychain {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyStore for OsKeychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(&self.service, account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(&self.service, account).map_err(|e| e.to_string())?;
        entry.set_password(value).map_err(|e| e.to_string())
    }
}

/// Keys in memory — what tests use, so they never touch the real keychain.
#[derive(Default)]
pub struct MemoryKeys(Mutex<HashMap<String, String>>);

impl KeyStore for MemoryKeys {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .insert(account.to_string(), value.to_string());
        Ok(())
    }
}

/// The keychain account of the key for `user@hostname:port`, in `profile`.
pub fn account(profile: &str, user: &str, hostname: &str, port: u16) -> String {
    format!(
        "host-bridge-key/{profile}/{}@{}:{port}",
        user,
        hostname.to_ascii_lowercase()
    )
}

/// The key for `account`, made (32 random bytes, as 64 hex digits) and stored
/// the first time it is asked for.
pub fn key_for(store: &dyn KeyStore, account: &str) -> Result<String, String> {
    if let Some(key) = store.get(account)? {
        if key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Ok(key);
        }
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    let key = hex::encode(bytes);
    store.set(account, &key)?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_made_once_and_found_again() {
        let store = MemoryKeys::default();
        let account = account("desktop-abc", "dev", "Build-Box", 22);
        let first = key_for(&store, &account).unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(key_for(&store, &account).unwrap(), first);
        // Another host, another key.
        let other = key_for(&store, &super::account("desktop-abc", "dev", "other", 22)).unwrap();
        assert_ne!(other, first);
    }

    #[test]
    fn a_key_is_named_by_the_machine_and_the_profile_not_the_host_id() {
        assert_eq!(
            account("desktop-abc", "dev", "Build-Box", 2222),
            "host-bridge-key/desktop-abc/dev@build-box:2222"
        );
        assert_ne!(
            account("desktop-abc", "dev", "h", 22),
            account("desktop-dev", "dev", "h", 22)
        );
    }
}
