//! What the person typed to reach a host, kept **in memory for the app's
//! session** and nowhere else.
//!
//! Nothing here is ever written to disk, logged or sent to the interface. It
//! exists so a dropped connection — a laptop lid, a Wi-Fi handover — can come
//! back without asking the same password again, which is what makes a host
//! that needs one usable at all. Closing the app forgets everything, and every
//! value is wiped from memory when it is replaced or dropped.
//!
//! Answers to second-factor questions are deliberately **not** kept: a one-time
//! code is spent the moment it is used, and replaying it would only burn the
//! next attempt.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use zeroize::Zeroizing;

use super::auth::Secrets;

#[derive(Default)]
pub struct SecretStore {
    /// Passwords by hop identity (`user@hostname:port`), so a bastion shared by
    /// two hosts is asked once.
    passwords: HashMap<String, Zeroizing<String>>,
    /// Passphrases by key file.
    passphrases: HashMap<PathBuf, Zeroizing<String>>,
}

impl SecretStore {
    /// What is known for one hop: its password, and the passphrase of any of
    /// `key_files` that was unlocked earlier.
    pub fn secrets_for(&self, hop_key: &str, key_files: &[PathBuf]) -> Secrets {
        Secrets {
            password: self.passwords.get(hop_key).map(|p| p.to_string()),
            passphrases: key_files
                .iter()
                .filter_map(|path| {
                    self.passphrases
                        .get(path)
                        .map(|p| (path.clone(), p.to_string()))
                })
                .collect(),
        }
    }

    pub fn put_password(&mut self, hop_key: &str, password: String) {
        self.passwords
            .insert(hop_key.to_string(), Zeroizing::new(password));
    }

    pub fn put_passphrase(&mut self, path: &Path, passphrase: String) {
        self.passphrases
            .insert(path.to_path_buf(), Zeroizing::new(passphrase));
    }

    /// Forget a password that was refused, so the next attempt asks instead of
    /// replaying it.
    pub fn forget_password(&mut self, hop_key: &str) {
        self.passwords.remove(hop_key);
    }

    pub fn forget_passphrase(&mut self, path: &Path) {
        self.passphrases.remove(path);
    }

    pub fn has_password(&self, hop_key: &str) -> bool {
        self.passwords.contains_key(hop_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_handed_out_per_hop_and_forgotten_when_refused() {
        let mut store = SecretStore::default();
        store.put_password("me@box:22", "hunter2".into());
        store.put_passphrase(Path::new("/k/id"), "open sesame".into());

        let s = store.secrets_for(
            "me@box:22",
            &[PathBuf::from("/k/id"), PathBuf::from("/k/other")],
        );
        assert_eq!(s.password.as_deref(), Some("hunter2"));
        assert_eq!(
            s.passphrases,
            vec![(PathBuf::from("/k/id"), "open sesame".to_string())]
        );

        // Another hop gets nothing of this one's.
        assert!(store.secrets_for("ops@edge:22", &[]).password.is_none());

        store.forget_password("me@box:22");
        assert!(!store.has_password("me@box:22"));
        store.forget_passphrase(Path::new("/k/id"));
        assert!(store
            .secrets_for("me@box:22", &[PathBuf::from("/k/id")])
            .passphrases
            .is_empty());
    }
}
