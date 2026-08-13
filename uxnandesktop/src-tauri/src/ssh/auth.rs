//! Proving who you are to a host, in the order OpenSSH would.
//!
//! **No secret is ever stored by the app.** A credential here is a *reference*:
//! "the system's agent", or "the key at this path". Passphrases live in memory
//! for the duration of one attempt and are never written anywhere. That is the
//! whole reason `ForwardAgent` matters later — it lets git on the remote host use
//! the keys held here without a private key leaving this machine.
//!
//! The order — agent first, then identity files — is not cosmetic. The agent
//! holds keys the user has already unlocked, so trying it first is what makes
//! connecting to several hosts not turn into several passphrase prompts. Only
//! when it has nothing to offer do we touch key files, and an encrypted one
//! stops the attempt with [`AuthOutcome::NeedsPassphrase`] rather than failing
//! opaquely: "wrong key" and "I could not open your key" are different problems
//! with different fixes.

// FOR-DEV: no caller yet — the host registry drives this once it exists.
// Remove with the same change that removes the marker in `conn.rs`.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};

use super::conn::Connection;
use crate::error::AppError;

/// The named pipe Windows' OpenSSH agent listens on. Fixed by OpenSSH, not
/// configurable, and the reason agent auth works on Windows at all despite there
/// being no Unix socket.
#[cfg(windows)]
const WINDOWS_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// Something that can prove identity. Never a secret — always a reference to one
/// held somewhere the user already controls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    /// The system's ssh-agent: Windows' named pipe, or `SSH_AUTH_SOCK`.
    Agent,
    /// A private key file. `passphrase` is supplied only for the duration of one
    /// attempt, after the user has been asked for it.
    IdentityFile {
        path: PathBuf,
        passphrase: Option<String>,
    },
}

impl Credential {
    /// How this credential is named in logs and in the UI. Deliberately never
    /// includes the passphrase, and for a file only its path.
    pub fn label(&self) -> String {
        match self {
            Credential::Agent => "ssh-agent".to_string(),
            Credential::IdentityFile { path, .. } => path.display().to_string(),
        }
    }
}

/// How an authentication attempt ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthOutcome {
    /// Authenticated. `method` says which credential worked, so the UI can tell
    /// the user *how* they got in — useful when a host has several keys.
    Success { method: String },
    /// A key file is encrypted and no passphrase was supplied. Ask for one and
    /// retry that credential; this is not a failure of the key.
    NeedsPassphrase { path: String },
    /// Everything offered was rejected. `attempted` is what we tried, in order,
    /// so the message can be specific instead of "authentication failed".
    Failed { attempted: Vec<String> },
    /// Nothing could be offered at all: no agent, no key files configured.
    NoCredentials,
}

/// Build the credential list for a host, in the order they will be tried.
///
/// `identity_files` come from the host's resolved OpenSSH configuration
/// (`ssh -G`), already in OpenSSH's own preference order. Files that do not
/// exist are dropped here rather than attempted: OpenSSH lists a set of defaults
/// whether or not they are present, and trying each missing one would turn a
/// clean "no credentials" into a list of confusing failures.
pub fn credentials_for(use_agent: bool, identity_files: &[String]) -> Vec<Credential> {
    let mut out = Vec::new();
    if use_agent {
        out.push(Credential::Agent);
    }
    for raw in identity_files {
        let path = expand_home(raw);
        if path.is_file() {
            out.push(Credential::IdentityFile {
                path,
                passphrase: None,
            });
        }
    }
    out
}

/// Expand a leading `~` the way OpenSSH does. `ssh -G` emits paths in that form,
/// and `Path::is_file` does not understand it.
fn expand_home(raw: &str) -> PathBuf {
    let trimmed = raw.trim().trim_matches('"');
    if let Some(rest) = trimmed.strip_prefix("~/").or(trimmed.strip_prefix("~\\")) {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(trimmed)
}

/// Try each credential in order until one authenticates.
///
/// Stops early on [`AuthOutcome::NeedsPassphrase`]: continuing past a key we
/// could not even open would report "authentication failed" for a key that may
/// well be the right one, sending the user to debug the wrong problem.
pub async fn authenticate(
    conn: &mut Connection,
    user: &str,
    credentials: &[Credential],
) -> Result<AuthOutcome, AppError> {
    if credentials.is_empty() {
        return Ok(AuthOutcome::NoCredentials);
    }
    let mut attempted = Vec::new();

    for credential in credentials {
        attempted.push(credential.label());
        match credential {
            Credential::Agent => {
                if try_agent(conn, user).await? {
                    return Ok(AuthOutcome::Success {
                        method: credential.label(),
                    });
                }
            }
            Credential::IdentityFile { path, passphrase } => {
                match try_identity_file(conn, user, path, passphrase.as_deref()).await? {
                    IdentityAttempt::Authenticated => {
                        return Ok(AuthOutcome::Success {
                            method: credential.label(),
                        })
                    }
                    IdentityAttempt::Encrypted => {
                        return Ok(AuthOutcome::NeedsPassphrase {
                            path: path.display().to_string(),
                        })
                    }
                    IdentityAttempt::Rejected => {}
                }
            }
        }
    }

    Ok(AuthOutcome::Failed { attempted })
}

enum IdentityAttempt {
    Authenticated,
    /// The key file is encrypted and the passphrase was absent or wrong.
    Encrypted,
    /// The key loaded and the server said no.
    Rejected,
}

/// Offer every identity the system agent holds.
///
/// A missing or empty agent is not an error — it is simply nothing to offer, and
/// the next credential gets its turn.
async fn try_agent(conn: &mut Connection, user: &str) -> Result<bool, AppError> {
    #[cfg(windows)]
    let agent = russh::keys::agent::client::AgentClient::connect_named_pipe(WINDOWS_AGENT_PIPE)
        .await
        .ok();
    #[cfg(not(windows))]
    let agent = russh::keys::agent::client::AgentClient::connect_env()
        .await
        .ok();

    let Some(mut agent) = agent else {
        return Ok(false);
    };
    let Ok(identities) = agent.request_identities().await else {
        return Ok(false);
    };

    for identity in identities {
        // Only plain public keys: an OpenSSH *certificate* in the agent is a
        // different auth method with its own principals and validity, and
        // offering it as if it were a bare key would fail in a way that looks
        // like a rejected key. Certificates get their own path or none at all.
        let russh::keys::agent::AgentIdentity::PublicKey { key, .. } = identity else {
            continue;
        };
        match conn
            .handle_mut()
            .authenticate_publickey_with(user, key, None, &mut agent)
            .await
        {
            Ok(res) if res.success() => return Ok(true),
            Ok(_) => continue,
            // A broken agent conversation is not an authentication verdict;
            // stop using it and let the next credential have its turn.
            Err(_) => return Ok(false),
        }
    }
    Ok(false)
}

async fn try_identity_file(
    conn: &mut Connection,
    user: &str,
    path: &Path,
    passphrase: Option<&str>,
) -> Result<IdentityAttempt, AppError> {
    let key = match load_secret_key(path, passphrase) {
        Ok(key) => key,
        // Encrypted, or the supplied passphrase was wrong. Either way what the
        // user must do next is provide one, not pick a different key.
        Err(_) => return Ok(IdentityAttempt::Encrypted),
    };

    let hash_alg = conn
        .handle_mut()
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();

    let result = conn
        .handle_mut()
        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
        .await
        .map_err(|e| AppError::Invalid(format!("authentication failed: {e}")))?;

    if result.success() {
        Ok(IdentityAttempt::Authenticated)
    } else {
        Ok(IdentityAttempt::Rejected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_comes_first_so_one_unlock_serves_every_host() {
        let creds = credentials_for(true, &[]);
        assert_eq!(creds, vec![Credential::Agent]);
    }

    #[test]
    fn identity_files_that_do_not_exist_are_dropped_not_attempted() {
        // `ssh -G` lists OpenSSH's default key paths whether or not they exist.
        // Attempting each missing one would turn "you have no credentials" into
        // a list of failures that mean nothing to the user.
        let creds = credentials_for(
            false,
            &[
                "C:/definitely/not/here/id_ed25519".to_string(),
                "~/.ssh/id_nonexistent_for_tests".to_string(),
            ],
        );
        assert!(creds.is_empty(), "{creds:?}");
    }

    #[test]
    fn an_existing_identity_file_is_offered_after_the_agent() {
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join("id_ed25519");
        std::fs::write(&key_path, b"not a real key, only its presence matters here").unwrap();

        let creds = credentials_for(true, &[key_path.display().to_string()]);
        assert_eq!(creds.len(), 2);
        assert_eq!(creds[0], Credential::Agent);
        assert!(matches!(creds[1], Credential::IdentityFile { .. }));
    }

    #[test]
    fn a_label_never_leaks_a_passphrase() {
        // Labels reach logs and the UI; a passphrase must not ride along.
        let c = Credential::IdentityFile {
            path: PathBuf::from("C:/keys/id_ed25519"),
            passphrase: Some("hunter2".into()),
        };
        let label = c.label();
        assert!(!label.contains("hunter2"), "{label}");
        assert!(label.contains("id_ed25519"));
    }

    /// Live checks against the SSH server on this machine. Ignored by default.
    /// They connect to loopback and deliberately authenticate with a key the
    /// server has never been told about: the point is that a rejection is
    /// reported cleanly, not that we can get in.
    ///
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored ssh::auth`
    mod live {
        use super::*;
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

        async fn verified_connection() -> crate::ssh::conn::Connection {
            let endpoint = Endpoint::new("127.0.0.1", 22);
            let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
                panic!("expected an unknown host on an empty known_hosts");
            };
            let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
            match connect(endpoint, &trusted).await {
                Ok(Handshake::Ready(conn)) => conn,
                _ => panic!("the key we just recorded should verify"),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn offering_no_credentials_is_reported_as_such() {
            let mut conn = verified_connection().await;
            let outcome = authenticate(&mut conn, "nobody", &[]).await.unwrap();
            assert_eq!(outcome, AuthOutcome::NoCredentials);
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn an_unauthorized_key_is_rejected_cleanly_and_says_what_it_tried() {
            // Generate a real key the server has never heard of. A rejection has
            // to come back as a verdict naming what was offered — not as a
            // transport error, which would send the user to debug the network.
            let dir = tempfile::tempdir().unwrap();
            let key_path = dir.path().join("id_ed25519");
            let status = std::process::Command::new("ssh-keygen")
                .args(["-t", "ed25519", "-N", "", "-q", "-f"])
                .arg(&key_path)
                .status()
                .expect("ssh-keygen should be available alongside a running sshd");
            assert!(status.success(), "ssh-keygen failed");

            let creds = credentials_for(false, &[key_path.display().to_string()]);
            assert_eq!(creds.len(), 1, "the generated key should be offered");

            let mut conn = verified_connection().await;
            let outcome = authenticate(&mut conn, "uxnan-no-such-user", &creds)
                .await
                .unwrap();

            match outcome {
                AuthOutcome::Failed { attempted } => {
                    assert_eq!(attempted.len(), 1);
                    assert!(attempted[0].contains("id_ed25519"), "{attempted:?}");
                    println!("live: rejected as expected, offered {}", attempted[0]);
                }
                other => panic!("expected a clean rejection, got {other:?}"),
            }
        }
    }

    #[test]
    fn tilde_paths_expand_the_way_openssh_writes_them() {
        let expanded = expand_home("~/.ssh/id_ed25519");
        assert!(!expanded.to_string_lossy().starts_with('~'), "{expanded:?}");
        assert!(expanded
            .to_string_lossy()
            .replace('\\', "/")
            .ends_with(".ssh/id_ed25519"));
        // A quoted absolute path survives untouched.
        assert_eq!(expand_home("\"C:/keys/k\""), PathBuf::from("C:/keys/k"));
    }
}
