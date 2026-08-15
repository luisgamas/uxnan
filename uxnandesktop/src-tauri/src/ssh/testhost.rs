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
        AuthOutcome::Success { method } => Some((conn, method)),
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
async fn posix_host_serves_its_files_over_sftp() {
    let (conn, _) = host_or_skip!();
    let files = super::sftp::open(&conn).await.expect("an SFTP session");

    // Home comes from the protocol, not from a shell variable.
    let home = files.home().await.expect("the host's home");
    assert!(
        home.starts_with('/'),
        "a POSIX home is rooted at / — got {home}"
    );
    println!("linux: home is {home}");

    let listing = files.list_dir(&home).await.expect("a listing");
    let names: Vec<&str> = listing.iter().map(|e| e.name.as_str()).collect();
    assert!(names.contains(&"project"), "{names:?}");

    // Read, write, and read back — the save path, on a filesystem that is not
    // this machine's.
    let path = format!("{home}/project/README.md");
    let original = files.read_file(&path).await.expect("the readme");
    assert!(original.content.contains("hello"), "{:?}", original.content);

    files
        .write_file(&path, "hello\nedited on a linux host\n")
        .await
        .expect("saving on a POSIX host");
    let after = files.read_file(&path).await.expect("the readme again");
    assert_eq!(after.content, "hello\nedited on a linux host\n");

    // Shorten it: the case that silently kept a tail before `TRUNCATE`.
    files.write_file(&path, "hi\n").await.expect("shortening");
    assert_eq!(files.read_file(&path).await.unwrap().content, "hi\n");

    // Put it back so the git test below sees the repository it expects.
    files
        .write_file(&path, "hello\ndirty\n")
        .await
        .expect("restore");
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_browses_and_badges_a_repository() {
    let (conn, _) = host_or_skip!();
    let files = super::sftp::open(&conn).await.expect("an SFTP session");

    let listing = super::browse::list_dirs(&files, "")
        .await
        .expect("the home");
    println!(
        "linux: {} has {:?}",
        listing.path,
        listing
            .entries
            .iter()
            .map(|d| (&d.name, d.is_repo))
            .collect::<Vec<_>>()
    );

    let repo = listing
        .entries
        .iter()
        .find(|d| d.name == "project")
        .expect("the repository is in the listing");
    assert!(repo.is_repo, "a folder with .git is a repository");

    let plain = listing
        .entries
        .iter()
        .find(|d| d.name == "plain-folder")
        .expect("the plain folder is in the listing");
    assert!(!plain.is_repo, "a folder without .git is not");

    // Home has a parent on POSIX (`/home`), which is what "up" needs.
    assert_eq!(listing.parent.as_deref(), Some("/home"));
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_answers_about_its_git() {
    let (conn, _) = host_or_skip!();
    let kind = super::shellkind::classify(&conn).await;
    let files = super::sftp::open(&conn).await.expect("an SFTP session");
    let home = files.home().await.expect("the host's home");

    let status = super::git::status(&conn, kind, &format!("{home}/project")).await;
    println!(
        "linux: branch={:?} dirty={} ahead={} behind={} is_repo={}",
        status.branch,
        status.status.dirty,
        status.status.ahead,
        status.status.behind,
        status.is_repo
    );

    assert!(status.is_repo, "the container ships a real repository");
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(
        status.status.dirty >= 1,
        "README.md is left modified on purpose"
    );
    // No upstream on this repository: that must read as zero distance, not as a
    // failure — the case that once swallowed the end marker.
    assert_eq!((status.status.ahead, status.status.behind), (0, 0));

    // And a folder that is not a repository answers so, rather than erroring.
    let plain = super::git::status(&conn, kind, &format!("{home}/plain-folder")).await;
    assert!(!plain.is_repo, "a plain folder is not a repository");
}
