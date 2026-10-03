//! The whole remote stack, run against a **Linux** host.
//!
//! Every other live test in this module talks to the `sshd` of the machine
//! running the tests, which on this project has always been Windows with `cmd`.
//! So the POSIX half of everything here — `shellkind`'s classification, the
//! inventory's `sh -lc` script, the git script's `;` sequencing, SFTP paths that
//! start at `/` — had never actually executed. "It works on any OS" was a claim
//! with no evidence behind it.
//!
//! The host is a container (`docker/ssh-test-host/`, `scripts/ssh-test-host.mjs`),
//! so it is reproducible and can run in CI. Point the tests at it with:
//!
//! ```text
//! node scripts/ssh-test-host.mjs up
//! $env:UXNAN_SSH_TEST_HOST='127.0.0.1:2222'
//! $env:UXNAN_SSH_TEST_USER='uxnan'; $env:UXNAN_SSH_TEST_PASSWORD='uxnan'
//! cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored posix_host --nocapture
//! ```
//!
//! They are `#[ignore]` like the rest: without the container there is nothing to
//! talk to, and a suite that fails when Docker is absent would be a suite people
//! learn to ignore.

#![cfg(test)]

use super::auth::{authenticate, AuthOutcome, Credential};
use super::conn::{connect, Connection, Endpoint, Handshake};
use super::hostkey;
use super::shellkind::ShellKind;

/// Where the test host is, from the environment. `None` when it was not set, so
/// each test can skip with a message rather than fail.
fn endpoint() -> Option<(Endpoint, String, String)> {
    let spec = std::env::var("UXNAN_SSH_TEST_HOST").ok()?;
    let user = std::env::var("UXNAN_SSH_TEST_USER").ok()?;
    let password = std::env::var("UXNAN_SSH_TEST_PASSWORD").ok()?;
    let (host, port) = match spec.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            (h.to_string(), p.parse().unwrap_or(22))
        }
        _ => (spec, 22u16),
    };
    Some((Endpoint::new(host, port), user, password))
}

/// Connect and authenticate with a password, trusting the key the host presents.
///
/// Trust-on-first-use is deliberate here and *only* here: this is a container
/// rebuilt on demand, so its key changes, and the key decision has its own live
/// coverage in `conn`. What this helper exists to reach is everything *after*
/// the handshake.
async fn reach_host() -> Option<(Connection, String)> {
    let (endpoint, user, password) = endpoint()?;
    let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
        panic!("expected an unknown host at {endpoint:?}; is the container up?");
    };
    let trusted = hostkey::trust_line(&endpoint.hostname, endpoint.port, &key);
    let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
        panic!("the key just recorded should verify");
    };
    match authenticate(&mut conn, &user, &[Credential::Password(password)])
        .await
        .expect("the password attempt should complete")
    {
        AuthOutcome::Success { method } => Some((*conn, method)),
        other => panic!("the container accepts a password; got {other:?}"),
    }
}

/// Skip politely when the container is not up, so a developer without Docker
/// sees a reason rather than a failure.
macro_rules! host_or_skip {
    () => {
        match reach_host().await {
            Some(pair) => pair,
            None => {
                println!("skipped: set UXNAN_SSH_TEST_{{HOST,USER,PASSWORD}} (scripts/ssh-test-host.mjs up)");
                return;
            }
        }
    };
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_accepts_a_password_and_says_which_shell_it_runs() {
    let (conn, method) = host_or_skip!();
    println!("linux: authenticated by {method}");

    // The classification everything shell-shaped depends on. On this host it
    // must be POSIX — the branch that had never run against a POSIX machine.
    let kind = super::shellkind::classify(&conn).await;
    assert_eq!(kind, ShellKind::Posix, "a Debian host runs a POSIX shell");
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_reports_its_inventory() {
    let (conn, _) = host_or_skip!();
    let kind = super::shellkind::classify(&conn).await;

    let inventory = super::inventory::probe(&conn, &["git".to_string()], kind)
        .await
        .expect("the host should answer");

    println!(
        "linux: os={} home={} git={:?} shell={}",
        inventory.os, inventory.home, inventory.git, inventory.shell
    );
    assert_eq!(inventory.shell, "posix", "asked through the POSIX script");
    assert_eq!(inventory.os, "linux");
    assert!(inventory.home.starts_with('/'), "{}", inventory.home);
    assert!(inventory.git.contains("git version"), "{}", inventory.git);
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_says_how_many_channels_it_allows_when_it_runs_out() {
    let (conn, _) = host_or_skip!();

    // Hold file sessions open — each one is a channel, exactly like a terminal —
    // until the host refuses. `MaxSessions` defaults to 10 in OpenSSH, but the
    // point is that the app does not assume that: it counts, and learns the
    // number from the machine itself.
    let mut held = Vec::new();
    let mut refusal = None;
    for _ in 0..40 {
        match super::sftp::open(&conn).await {
            Ok(session) => held.push(session),
            Err(e) => {
                refusal = Some(e.to_string());
                break;
            }
        }
    }

    let message = refusal.expect("a host refuses eventually; it did not in 40 channels");
    println!("linux: {} channels held, then: {message}", held.len());
    assert!(
        message.contains("already open")
            && message.contains("Each terminal on it takes one")
            && message.contains("MaxSessions"),
        "the refusal says what is holding them and what to do: {message}"
    );
    // The number is what the host enforced, not a guess and not one more than
    // it: this caught an off-by-one that would have told the user to raise a
    // setting to the value it already had.
    assert!(
        message.contains(&format!("with {} already open", held.len())),
        "the message quotes what was actually open ({}), not a guess at the host's setting: {message}",
        held.len()
    );

    // Give the channels back and the connection works again — the budget is a
    // count of what is open, not a fuse that stays blown.
    //
    // With a wait, because **the host releases a channel asynchronously**: our
    // side knows the session is dropped the instant it is, and the machine has
    // not necessarily processed the close yet. This found a second bug — a
    // refusal at that moment was being recorded as "this host allows 1
    // channel", which would have crippled the connection for the rest of its
    // life.
    held.clear();
    let mut reopened = false;
    for _ in 0..20 {
        if super::sftp::open(&conn).await.is_ok() {
            reopened = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(
        reopened,
        "closing the sessions frees their slots on the host"
    );
}
