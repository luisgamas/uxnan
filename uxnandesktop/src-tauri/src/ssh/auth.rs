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

/// Something that can prove identity. Never a stored secret — a reference to one
/// the user already controls, or a value they just typed and that lives only for
/// this attempt.
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
    /// A password the user just typed. This is the path that makes a first
    /// connection possible with **no setup at all** on the remote machine — no
    /// key to generate, nothing to append to `authorized_keys` — which for most
    /// people is the difference between "I connected" and "I gave up".
    Password(String),
}

impl Credential {
    /// How this credential is named in logs and in the UI. Deliberately never
    /// includes the passphrase or the password, and for a file only its path.
    pub fn label(&self) -> String {
        match self {
            Credential::Agent => "ssh-agent".to_string(),
            Credential::IdentityFile { path, .. } => path.display().to_string(),
            Credential::Password(_) => "password".to_string(),
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
    /// The server accepts a password and we have none. Ask for one and retry
    /// with [`Credential::Password`] added — on a first connection to a machine
    /// that has never seen your key, this is the normal path, not a failure.
    ///
    /// `attempted` carries whatever was offered and rejected first, so the
    /// message can be both things at once: *the key at X was refused, and this
    /// host also takes a password*. Collapsing that into a bare "type a
    /// password" would hide a rejected key the user may well want to fix.
    NeedsPassword { attempted: Vec<String> },
    /// Everything offered was rejected. `attempted` is what we tried, in order,
    /// so the message can be specific instead of "authentication failed".
    Failed { attempted: Vec<String> },
    /// The server accepts nothing we can offer: no keys, no password. Rare, and
    /// worth saying plainly rather than reporting as a rejection.
    NoUsableMethod,
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

/// Authenticate, trying what the **server says it accepts** in OpenSSH's order.
///
/// The exchange opens with a `none` attempt. That is not a shortcut hoping for
/// an open server: it is how SSH asks "what do you take?", and the answer is
/// what keeps us from offering keys to a password-only host — or, worse, from
/// telling a user "authentication failed" when the real answer is "this machine
/// wants a password and you have not been asked for one yet".
///
/// Stops early on [`AuthOutcome::NeedsPassphrase`]: continuing past a key we
/// could not even open would report a failure for a key that may well be the
/// right one, sending the user to debug the wrong problem.
pub async fn authenticate(
    conn: &mut Connection,
    user: &str,
    credentials: &[Credential],
) -> Result<AuthOutcome, AppError> {
    let accepted = match conn
        .handle_mut()
        .authenticate_none(user)
        .await
        .map_err(|e| AppError::Invalid(format!("authentication failed: {e}")))?
    {
        // A server configured to let anyone in. Vanishingly rare, but the
        // protocol allows it and pretending otherwise would be a lie.
        russh::client::AuthResult::Success => {
            return Ok(AuthOutcome::Success {
                method: "none".to_string(),
            })
        }
        russh::client::AuthResult::Failure {
            remaining_methods, ..
        } => remaining_methods,
    };

    let takes = |kind: russh::MethodKind| accepted.contains(&kind);
    let takes_public_key = takes(russh::MethodKind::PublicKey);
    let takes_password =
        takes(russh::MethodKind::Password) || takes(russh::MethodKind::KeyboardInteractive);

    let mut attempted = Vec::new();

    if takes_public_key {
        for credential in credentials {
            match credential {
                Credential::Agent => {
                    attempted.push(credential.label());
                    if try_agent(conn, user).await? {
                        return Ok(AuthOutcome::Success {
                            method: credential.label(),
                        });
                    }
                }
                Credential::IdentityFile { path, passphrase } => {
                    attempted.push(credential.label());
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
                Credential::Password(_) => {}
            }
        }
    }

    if takes_password {
        if let Some(Credential::Password(password)) = credentials
            .iter()
            .find(|c| matches!(c, Credential::Password(_)))
        {
            attempted.push("password".to_string());
            if try_password(conn, user, password).await? {
                return Ok(AuthOutcome::Success {
                    method: "password".to_string(),
                });
            }
        } else {
            // Nothing else worked and the server takes a password: ask for one.
            // Reporting a failure here would hide the one action that works.
            return Ok(AuthOutcome::NeedsPassword { attempted });
        }
    }

    if attempted.is_empty() {
        return Ok(AuthOutcome::NoUsableMethod);
    }
    Ok(AuthOutcome::Failed { attempted })
}

/// Offer a password, falling back to keyboard-interactive.
///
/// Both are tried because servers disagree about which one a plain password
/// belongs to: OpenSSH commonly answers `password`, while others (and anything
/// with PAM in the way) only expose `keyboard-interactive`. To the person typing
/// it, it is the same password either way.
///
/// The keyboard-interactive side answers **only** a single-prompt request. A
/// server asking two things is asking for a second factor, and replaying the
/// password into it would be both wrong and a way to burn an OTP attempt; that
/// needs a real prompt-by-prompt UI, which is deferred rather than faked.
async fn try_password(conn: &mut Connection, user: &str, password: &str) -> Result<bool, AppError> {
    let direct = conn
        .handle_mut()
        .authenticate_password(user, password)
        .await
        .map_err(|e| AppError::Invalid(format!("authentication failed: {e}")))?;
    if direct.success() {
        return Ok(true);
    }

    use russh::client::KeyboardInteractiveAuthResponse as Ki;
    let mut response = conn
        .handle_mut()
        .authenticate_keyboard_interactive_start(user, None)
        .await
        .map_err(|e| AppError::Invalid(format!("authentication failed: {e}")))?;

    loop {
        match response {
            Ki::Success => return Ok(true),
            Ki::Failure { .. } => return Ok(false),
            Ki::InfoRequest { ref prompts, .. } => {
                let answers = match prompts.len() {
                    // An empty request is the server's way of saying "continue".
                    0 => Vec::new(),
                    1 => vec![password.to_string()],
                    // More than one prompt is a second factor, not a password.
                    _ => return Ok(false),
                };
                response = conn
                    .handle_mut()
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| AppError::Invalid(format!("authentication failed: {e}")))?;
            }
        }
    }
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
        async fn a_password_server_with_no_password_asks_for_one() {
            // The first-connection case, and the reason this outcome exists:
            // with nothing to offer against a server that takes a password,
            // "authentication failed" would hide the one action that works.
            let mut conn = verified_connection().await;
            let outcome = authenticate(&mut conn, "nobody", &[]).await.unwrap();
            assert_eq!(outcome, AuthOutcome::NeedsPassword { attempted: vec![] });
        }

        /// A real remote host plus credentials, so the one thing loopback cannot
        /// prove — that an authenticated session carries many channels over a
        /// single connection — can be checked against a real machine.
        ///
        /// The password is read from the environment and never printed. Run it
        /// from your own shell so it never leaves your process:
        ///
        /// ```powershell
        /// $env:UXNAN_SSH_TEST_HOST='10.0.0.5'; $env:UXNAN_SSH_TEST_USER='you'
        /// $env:UXNAN_SSH_TEST_PASSWORD='...'
        /// cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored many_channels --nocapture
        /// ```
        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_{HOST,USER,PASSWORD}; run with --ignored"]
        async fn one_connection_carries_many_channels() {
            let (Ok(host), Ok(user), Ok(password)) = (
                std::env::var("UXNAN_SSH_TEST_HOST"),
                std::env::var("UXNAN_SSH_TEST_USER"),
                std::env::var("UXNAN_SSH_TEST_PASSWORD"),
            ) else {
                panic!("set UXNAN_SSH_TEST_HOST, _USER and _PASSWORD to run this");
            };

            // Trust whatever the host presents: this test is about channels, and
            // the key decision has its own live coverage in `conn`.
            let endpoint = crate::ssh::conn::Endpoint::new(host.clone(), 22);
            let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
                panic!("could not reach {host}");
            };
            let trusted = hostkey::trust_line(&host, 22, &key);
            let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
                panic!("the key just recorded should verify");
            };

            let creds = vec![Credential::Password(password)];
            match authenticate(&mut conn, &user, &creds).await.unwrap() {
                AuthOutcome::Success { method } => println!("authenticated via {method}"),
                other => panic!("authentication did not succeed: {other:?}"),
            }

            // The point of an in-process client: many concurrent channels on one
            // connection, with no second handshake and no second login. Eight is
            // the floor the transport gate asks for; OpenSSH's own default
            // MaxSessions is 10.
            const CHANNELS: usize = 8;
            let started = std::time::Instant::now();
            let commands: Vec<String> =
                (0..CHANNELS).map(|i| format!("echo channel-{i}")).collect();
            let results = futures::future::join_all(commands.iter().map(|c| conn.exec(c))).await;
            let elapsed = started.elapsed();

            for (i, result) in results.iter().enumerate() {
                let out = result
                    .as_ref()
                    .unwrap_or_else(|e| panic!("channel {i}: {e}"));
                assert!(
                    out.stdout.contains(&format!("channel-{i}")),
                    "channel {i} returned {:?} (stderr {:?})",
                    out.stdout,
                    out.stderr
                );
                assert_eq!(out.exit_code, Some(0), "channel {i} exit code");
            }
            println!(
                "{CHANNELS} concurrent channels on one connection in {} ms",
                elapsed.as_millis()
            );
        }

        #[tokio::test]
        #[ignore = "needs a local sshd and a key loaded in the agent; run with --ignored"]
        async fn the_system_agent_is_reached_and_its_identities_are_offered() {
            // Transport gate item 3: on Windows this is a named-pipe
            // conversation, which either works or silently offers nothing.
            // Authorization is a separate matter — what is asserted here is that
            // the agent was actually consulted and its keys put on the wire.
            let mut conn = verified_connection().await;
            let outcome = authenticate(&mut conn, "uxnan-no-such-user", &[Credential::Agent])
                .await
                .unwrap();
            let attempted = match outcome {
                AuthOutcome::NeedsPassword { attempted } => attempted,
                AuthOutcome::Failed { attempted } => attempted,
                AuthOutcome::Success { method } => {
                    println!("live: agent authenticated via {method}");
                    return;
                }
                other => panic!("unexpected outcome {other:?}"),
            };
            assert!(
                attempted.contains(&"ssh-agent".to_string()),
                "the agent should have been consulted: {attempted:?}"
            );
            println!("live: agent reached and its identities offered");
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn a_wrong_password_is_a_rejection_not_a_transport_error() {
            let mut conn = verified_connection().await;
            let creds = vec![Credential::Password("definitely-not-the-password".into())];
            match authenticate(&mut conn, "uxnan-no-such-user", &creds)
                .await
                .unwrap()
            {
                AuthOutcome::Failed { attempted } => {
                    assert!(attempted.contains(&"password".to_string()), "{attempted:?}");
                    println!("live: wrong password rejected cleanly, tried {attempted:?}");
                }
                other => panic!("expected a clean rejection, got {other:?}"),
            }
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

            // The key is refused *and* this server takes a password, so the
            // useful answer says both: what was rejected, and what to try next.
            match outcome {
                AuthOutcome::NeedsPassword { attempted } => {
                    assert_eq!(attempted.len(), 1);
                    assert!(attempted[0].contains("id_ed25519"), "{attempted:?}");
                    println!(
                        "live: key refused ({}), password offered next",
                        attempted[0]
                    );
                }
                other => panic!("expected the key refused + password offered, got {other:?}"),
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
