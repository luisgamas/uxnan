//! Reaching a host: the TCP connection, the SSH handshake, and the host-key
//! decision that gates everything after it.
//!
//! Two properties this module is built around.
//!
//! **An unverified host is never connected to — not even to ask.** When
//! `known_hosts` has nothing for a host, the handshake is refused and the caller
//! gets [`Handshake::Unknown`] carrying the fingerprint to show. Trusting is a
//! separate, explicit act by the user, after which the caller connects again.
//! The alternative — completing the connection and asking afterwards — would
//! mean a man-in-the-middle has already spoken to us.
//!
//! **Every connection carries a generation.** It is what `target::check` compares
//! a mutation's expectation against, so an operation prepared before a reconnect
//! cannot execute after it: same host, new connection, possibly a different
//! working directory and certainly a different set of live processes.
//!
//! Authentication is deliberately *not* here yet — see `FOR-DEV.md`.

// FOR-DEV: no caller yet; the host registry and the inventory probe are what
// will use this. Landing it separately keeps the host-key decision reviewable
// on its own. Remove this allow, and its FOR-DEV.md entry, once wired.
#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client;

use super::hostkey::{self, PresentedKey, Verdict};
use crate::error::AppError;

/// How long to wait for the TCP connection and the SSH handshake. Short on
/// purpose: an unreachable host should report quickly, and a slow one is better
/// surfaced as an error the user can retry than as a UI that hangs.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

/// Drops the connection when neither side has spoken for this long. The upper
/// layers keep it alive while a session is in use; this only reaps forgotten
/// ones so an idle host costs nothing.
const INACTIVITY_TIMEOUT: Duration = Duration::from_secs(300);

/// Monotonic connection counter. Never reset, never reused: a generation
/// identifies one *incarnation* of a connection for the lifetime of the process,
/// which is exactly what fencing needs.
static GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst)
}

/// Where to reach a host. Not a host *record* — that lives in settings; this is
/// only what the transport needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub hostname: String,
    pub port: u16,
}

impl Endpoint {
    pub fn new(hostname: impl Into<String>, port: u16) -> Self {
        Self {
            hostname: hostname.into(),
            port,
        }
    }

    fn socket_addr(&self) -> (String, u16) {
        (self.hostname.clone(), self.port)
    }
}

/// What happened when we tried to reach a host.
///
/// Every non-`Ready` variant means **nothing is connected**: the socket is
/// closed and no credential was offered.
pub enum Handshake {
    /// Host key verified against `known_hosts`. The transport is up and waiting
    /// for authentication.
    Ready(Connection),
    /// Nothing on file for this host. Show the fingerprint, ask, and — only if
    /// the user agrees — record `trust_line` and connect again.
    Unknown {
        fingerprint: String,
        key: PresentedKey,
    },
    /// A key is on file and it is not this one. Refuse; show both fingerprints.
    Changed {
        presented_fingerprint: String,
        stored_fingerprint: String,
    },
    /// The host is `@revoked` in `known_hosts`.
    Revoked { fingerprint: String },
}

/// A live, host-key-verified transport to one host.
pub struct Connection {
    handle: client::Handle<Client>,
    endpoint: Endpoint,
    generation: u64,
}

impl Connection {
    /// The incarnation this connection is. Travels with every mutation prepared
    /// against it (`target::TargetExpectation`).
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub fn handle(&self) -> &client::Handle<Client> {
        &self.handle
    }

    /// Mutable access, needed by the authentication exchange.
    pub fn handle_mut(&mut self) -> &mut client::Handle<Client> {
        &mut self.handle
    }
}

/// The russh client handler. Its only job is the host-key decision; it records
/// the verdict so [`connect`] can report *why* a refused handshake was refused
/// rather than collapsing every failure into "could not connect".
pub struct Client {
    known_hosts: String,
    endpoint: Endpoint,
    seen: Arc<Mutex<Option<(Verdict, PresentedKey)>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let presented = match PresentedKey::from_ssh_key(server_public_key) {
            Ok(k) => k,
            // An unreadable key is not a host we can identify, so it is not a
            // host we connect to.
            Err(_) => return Ok(false),
        };
        let verdict = hostkey::verify(
            &self.known_hosts,
            &self.endpoint.hostname,
            self.endpoint.port,
            &presented,
        );
        let accept = matches!(verdict, Verdict::Trusted);
        if let Ok(mut slot) = self.seen.lock() {
            *slot = Some((verdict, presented));
        }
        Ok(accept)
    }
}

/// Reach `endpoint` and decide, from `known_hosts`, whether to keep the
/// connection.
///
/// Errors are reserved for *transport* failures (unreachable, timed out,
/// protocol error). A host-key refusal is not an error — it is a
/// [`Handshake`] variant, because the caller has something to show the user and
/// possibly an action to offer.
pub async fn connect(endpoint: Endpoint, known_hosts: &str) -> Result<Handshake, AppError> {
    let seen: Arc<Mutex<Option<(Verdict, PresentedKey)>>> = Arc::new(Mutex::new(None));
    let handler = Client {
        known_hosts: known_hosts.to_string(),
        endpoint: endpoint.clone(),
        seen: Arc::clone(&seen),
    };

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(INACTIVITY_TIMEOUT),
        ..Default::default()
    });

    let attempt = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        client::connect(config, endpoint.socket_addr(), handler),
    )
    .await;

    // Read the verdict first: when the handshake failed *because we refused the
    // key*, that is the real answer and the transport error is just its echo.
    let observed = seen.lock().ok().and_then(|s| s.clone());
    if let Some((verdict, key)) = observed {
        match verdict {
            Verdict::Changed { stored_fingerprint } => {
                return Ok(Handshake::Changed {
                    presented_fingerprint: key.fingerprint(),
                    stored_fingerprint,
                })
            }
            Verdict::Revoked => {
                return Ok(Handshake::Revoked {
                    fingerprint: key.fingerprint(),
                })
            }
            Verdict::Unknown => {
                return Ok(Handshake::Unknown {
                    fingerprint: key.fingerprint(),
                    key,
                })
            }
            Verdict::Trusted => {}
        }
    }

    let handle = match attempt {
        Ok(Ok(handle)) => handle,
        Ok(Err(e)) => return Err(AppError::Invalid(format!("ssh handshake failed: {e}"))),
        Err(_) => {
            return Err(AppError::Invalid(format!(
                "no answer from {}:{} within {}s",
                endpoint.hostname,
                endpoint.port,
                HANDSHAKE_TIMEOUT.as_secs()
            )))
        }
    };

    Ok(Handshake::Ready(Connection {
        handle,
        endpoint,
        generation: next_generation(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The port the tests use to reach an SSH server on this machine.
    const LOCAL_SSHD: u16 = 22;

    #[test]
    fn generations_are_monotonic_and_never_repeat() {
        // Fencing leans entirely on this: a reused number would let a mutation
        // prepared before a reconnect execute after it.
        let a = next_generation();
        let b = next_generation();
        let c = next_generation();
        assert!(a < b && b < c, "{a} {b} {c}");
    }

    #[tokio::test]
    async fn an_unreachable_port_is_a_transport_error_not_a_key_verdict() {
        // Port 1 is reserved and nothing listens on it; this must not be
        // reported as "unknown host", which would offer the user a trust
        // prompt for a host that never answered.
        let out = connect(Endpoint::new("127.0.0.1", 1), "").await;
        assert!(out.is_err(), "expected a transport error");
    }

    /// Live checks against the SSH server running on this machine. Ignored by
    /// default (they need a listening sshd); they connect to loopback only, and
    /// stop at the host-key decision — no credential is ever offered.
    ///
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored ssh::conn`
    mod live {
        use super::*;

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn an_unknown_host_is_refused_and_reports_a_usable_fingerprint() {
            match connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), "").await {
                Ok(Handshake::Unknown { fingerprint, key }) => {
                    assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
                    assert!(!key.algorithm.is_empty());
                    println!(
                        "live: unknown host, fingerprint {fingerprint} ({})",
                        key.algorithm
                    );
                }
                Ok(_) => panic!("an empty known_hosts must never verify a host"),
                Err(e) => panic!("could not reach the local sshd: {e}"),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn trusting_the_real_key_makes_the_same_host_verify() {
            // The round trip that matters: take the key a real server presented,
            // write the line we would append to `known_hosts`, and connect
            // again. If this failed, a user who confirmed a host would be asked
            // again on every connection.
            let Ok(Handshake::Unknown { key, .. }) =
                connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), "").await
            else {
                panic!("expected an unknown host on an empty known_hosts");
            };

            let trusted = hostkey::trust_line("127.0.0.1", LOCAL_SSHD, &key);
            match connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), &trusted).await {
                Ok(Handshake::Ready(conn)) => {
                    assert_eq!(conn.endpoint().port, LOCAL_SSHD);
                    assert!(conn.generation() >= 1);
                    println!("live: verified, generation {}", conn.generation());
                }
                other => panic!(
                    "the key we just recorded should verify, got {}",
                    describe(&other)
                ),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn a_key_that_does_not_match_is_reported_as_changed_not_unknown() {
            // The man-in-the-middle shape, against a real server: a `known_hosts`
            // entry exists for this host but holds a different key.
            let Ok(Handshake::Unknown { key, .. }) =
                connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), "").await
            else {
                panic!("expected an unknown host on an empty known_hosts");
            };

            let impostor = PresentedKey {
                algorithm: key.algorithm.clone(),
                blob: vec![0xAB; key.blob.len()],
            };
            let stored = hostkey::trust_line("127.0.0.1", LOCAL_SSHD, &impostor);

            match connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), &stored).await {
                Ok(Handshake::Changed {
                    presented_fingerprint,
                    stored_fingerprint,
                }) => {
                    assert_eq!(presented_fingerprint, key.fingerprint());
                    assert_eq!(stored_fingerprint, impostor.fingerprint());
                    assert_ne!(presented_fingerprint, stored_fingerprint);
                    println!("live: changed key detected, {stored_fingerprint} → {presented_fingerprint}");
                }
                other => panic!(
                    "a mismatching key must be Changed, got {}",
                    describe(&other)
                ),
            }
        }

        /// A real remote host to test against, as `host` or `host:port`.
        /// Loopback proves the protocol; only a second machine proves the
        /// network path — a tailnet address, a LAN address, whatever the
        /// operator points this at.
        const REMOTE_ENV: &str = "UXNAN_SSH_TEST_HOST";

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_HOST=<host[:port]>; run explicitly with --ignored"]
        async fn a_real_remote_host_completes_the_trust_cycle() {
            let Ok(spec) = std::env::var(REMOTE_ENV) else {
                panic!("set {REMOTE_ENV}=<host[:port]> to run this against a real remote host");
            };
            let (host, port) = match spec.rsplit_once(':') {
                Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
                    (h.to_string(), p.parse().unwrap_or(22))
                }
                _ => (spec.clone(), 22u16),
            };

            // 1. Never seen → refused, with a fingerprint to show the user.
            let Ok(Handshake::Unknown { key, fingerprint }) =
                connect(Endpoint::new(host.clone(), port), "").await
            else {
                panic!("an empty known_hosts must refuse {host}:{port}");
            };
            println!("remote {host}:{port} → {fingerprint} ({})", key.algorithm);

            // 2. Recorded → verifies, and the transport is up.
            let trusted = hostkey::trust_line(&host, port, &key);
            let Ok(Handshake::Ready(conn)) =
                connect(Endpoint::new(host.clone(), port), &trusted).await
            else {
                panic!("the key just recorded should verify");
            };
            assert_eq!(conn.endpoint().hostname, host);
            println!("remote verified, generation {}", conn.generation());

            // 3. Someone else's key on file → refused as changed, not as new.
            let impostor = PresentedKey {
                algorithm: key.algorithm.clone(),
                blob: vec![0x5A; key.blob.len()],
            };
            let stored = hostkey::trust_line(&host, port, &impostor);
            match connect(Endpoint::new(host, port), &stored).await {
                Ok(Handshake::Changed {
                    presented_fingerprint,
                    stored_fingerprint,
                }) => {
                    assert_eq!(presented_fingerprint, key.fingerprint());
                    assert_ne!(presented_fingerprint, stored_fingerprint);
                    println!("remote mismatch correctly reported as changed");
                }
                other => panic!(
                    "a mismatching key must be Changed, got {}",
                    describe(&other)
                ),
            }
        }

        fn describe(outcome: &Result<Handshake, AppError>) -> String {
            match outcome {
                Ok(Handshake::Ready(_)) => "Ready".into(),
                Ok(Handshake::Unknown { .. }) => "Unknown".into(),
                Ok(Handshake::Changed { .. }) => "Changed".into(),
                Ok(Handshake::Revoked { .. }) => "Revoked".into(),
                Err(e) => format!("Err({e})"),
            }
        }
    }
}
