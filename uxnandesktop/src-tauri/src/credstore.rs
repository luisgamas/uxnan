//! Read-only access to credentials **another CLI** keeps in the OS credential
//! store — the one door through which Settings → Providers reaches a token that
//! is not on disk (Claude Code on macOS keeps its OAuth token in the login
//! Keychain instead of `~/.claude/.credentials.json`).
//!
//! The posture that makes this safe to poll:
//!
//! - **The poller never prompts.** A background read runs with OS user
//!   interaction disabled; if the store would have to ask the user (the item's
//!   access-control list does not include Uxnan yet), the read fails with
//!   [`CredStoreError::AccessRequired`] and the UI shows a *Grant access* button
//!   instead of a surprise dialog every refresh interval.
//! - **Consent is explicit and OS-owned.** The one interactive read happens only
//!   when the user clicks that button; macOS then shows its own dialog, and
//!   *Always Allow* records Uxnan in the item's ACL — revocable any time from
//!   Keychain Access. Uxnan stores nothing about the grant.
//! - **The secret is short-lived.** The bytes come back wrapped in [`Secret`],
//!   which zeroizes on drop; callers parse what they need and let it go.
//!
//! Only macOS is implemented: it is the only platform where a wired provider
//! keeps its token in the OS store today (Windows/Linux CLIs write files). The
//! API is platform-neutral so Credential Manager / Secret Service slot in here
//! — not beside it — the day a provider needs them (see `FOR-DEV.md` →
//! *Providers*).

use std::fmt;
use zeroize::Zeroize;

/// Whether a read may let the OS ask the user for permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    /// Background / polling path: never show a dialog; report `AccessRequired`.
    Never,
    /// User-initiated grant: the OS may prompt (once — "Always Allow" persists).
    Ask,
}

/// Why a credential could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredStoreError {
    /// No item with that service/account exists in the store.
    NotFound,
    /// The item exists but the OS will not hand it over without asking the
    /// user, and interaction was [`Interaction::Never`] — or the user denied
    /// the interactive request.
    AccessRequired,
    /// This platform has no store reader (Windows / Linux today). Only the
    /// non-macOS stub constructs it, hence the allowance on macOS.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    /// Any other store failure, with the OS message.
    Other(String),
}

impl fmt::Display for CredStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => f.write_str("no such item in the OS credential store"),
            Self::AccessRequired => {
                f.write_str("the OS credential store requires the user's permission")
            }
            Self::Unsupported => f.write_str("no OS credential store reader on this platform"),
            Self::Other(msg) => write!(f, "OS credential store error: {msg}"),
        }
    }
}

/// A secret's raw bytes, wiped when dropped. Deliberately has no `Debug`
/// output of its contents and no `Clone`.
pub struct Secret(Vec<u8>);

impl Secret {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Secret({} bytes)", self.0.len())
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Read the generic credential stored under `service` / `account`.
///
/// This is a blocking call. With [`Interaction::Ask`] it may block for as long
/// as the OS dialog stays open — run it on a blocking thread.
pub fn read(
    service: &str,
    account: &str,
    interaction: Interaction,
) -> Result<Secret, CredStoreError> {
    platform::read(service, account, interaction)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{CredStoreError, Interaction, Secret};
    use security_framework::os::macos::keychain::SecKeychain;
    use security_framework::passwords::{generic_password, PasswordOptions};
    use std::sync::Mutex;

    // `SecKeychainSetUserInteractionAllowed` is process-global, so two reads
    // must never interleave: one would flip interaction back on while the other
    // still expects it off. Every store read goes through this lock.
    static GATE: Mutex<()> = Mutex::new(());

    // Security.framework error codes this module maps to typed errors.
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    const ERR_SEC_AUTH_FAILED: i32 = -25293;
    const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
    const ERR_SEC_USER_CANCELED: i32 = -128;
    const ERR_SEC_INTERACTION_REQUIRED: i32 = -25315;

    pub(super) fn read(
        service: &str,
        account: &str,
        interaction: Interaction,
    ) -> Result<Secret, CredStoreError> {
        let _gate = GATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // The guard restores user interaction when it drops — including on the
        // error paths below.
        let _quiet = match interaction {
            Interaction::Never => Some(
                SecKeychain::disable_user_interaction()
                    .map_err(|e| CredStoreError::Other(e.to_string()))?,
            ),
            Interaction::Ask => None,
        };
        match generic_password(PasswordOptions::new_generic_password(service, account)) {
            Ok(bytes) => Ok(Secret(bytes)),
            Err(e) => Err(map_error(e.code())),
        }
    }

    fn map_error(code: i32) -> CredStoreError {
        match code {
            ERR_SEC_ITEM_NOT_FOUND => CredStoreError::NotFound,
            ERR_SEC_INTERACTION_NOT_ALLOWED | ERR_SEC_INTERACTION_REQUIRED => {
                CredStoreError::AccessRequired
            }
            // With interaction disabled, an item we are not allowed to read
            // surfaces as an authorization failure rather than the explicit
            // "interaction not allowed" — same meaning for the caller. When the
            // user was asked and declined, the read is also "not granted".
            ERR_SEC_AUTH_FAILED | ERR_SEC_USER_CANCELED => CredStoreError::AccessRequired,
            _ => CredStoreError::Other(format!("OSStatus {code}")),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn maps_security_codes_to_typed_errors() {
            assert_eq!(map_error(ERR_SEC_ITEM_NOT_FOUND), CredStoreError::NotFound);
            assert_eq!(
                map_error(ERR_SEC_INTERACTION_NOT_ALLOWED),
                CredStoreError::AccessRequired
            );
            assert_eq!(
                map_error(ERR_SEC_AUTH_FAILED),
                CredStoreError::AccessRequired
            );
            assert_eq!(
                map_error(ERR_SEC_USER_CANCELED),
                CredStoreError::AccessRequired
            );
            assert!(matches!(map_error(-1), CredStoreError::Other(_)));
        }

        #[test]
        fn quiet_read_of_a_missing_item_never_prompts() {
            // A service nobody registers: the read must come back with an error
            // (not found on a desktop; a CI runner may have no usable keychain
            // at all) — never hang on a dialog — and leave user interaction
            // re-enabled for the rest of the process.
            let r = read(
                "uxnan-credstore-test-no-such-service",
                "nobody",
                Interaction::Never,
            );
            assert!(r.is_err());
            assert_eq!(SecKeychain::user_interaction_allowed().ok(), Some(true));
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{CredStoreError, Interaction, Secret};

    pub(super) fn read(
        _service: &str,
        _account: &str,
        _interaction: Interaction,
    ) -> Result<Secret, CredStoreError> {
        Err(CredStoreError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_debug_hides_contents() {
        let s = Secret(b"hunter2".to_vec());
        assert_eq!(format!("{s:?}"), "Secret(7 bytes)");
        assert_eq!(s.as_bytes(), b"hunter2");
    }

    #[test]
    fn errors_display_without_leaking_anything() {
        for e in [
            CredStoreError::NotFound,
            CredStoreError::AccessRequired,
            CredStoreError::Unsupported,
            CredStoreError::Other("x".into()),
        ] {
            assert!(!e.to_string().is_empty());
        }
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn other_platforms_report_unsupported() {
        assert_eq!(
            read("svc", "acct", Interaction::Never).unwrap_err(),
            CredStoreError::Unsupported
        );
    }
}
