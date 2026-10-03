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

/// Whether git reports this file as staged. The status codes are the porcelain
/// `XY` pair: an index column that is neither blank nor `?` means the index
/// differs from HEAD.
fn is_staged(file: &crate::git::FileChange) -> bool {
    !matches!(file.index.as_str(), "" | " " | "?")
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_reviews_diffs_and_shows_its_history() {
    let (conn, _) = host_or_skip!();
    let kind = super::shellkind::classify(&conn).await;
    let files = super::sftp::open(&conn).await.expect("an SFTP session");
    let home = files.home().await.expect("the host's home");

    // Its own repository rather than the image's: the SFTP test rewrites the
    // fixture's README while it runs, and a test that reads someone else's file
    // mid-write fails for a reason that has nothing to do with what it checks.
    let repo = format!("{home}/review");
    conn.exec(&format!(
        "rm -rf {repo} && mkdir -p {repo}/src && cd {repo} && git init -q          && printf 'hello' > README.md && git add README.md && git commit -qm first          && printf 'dirty' >> README.md && printf 'fn main() {{}}' > src/main.rs"
    ))
    .await
    .expect("a repository to review");

    // The Changes panel's one round trip: everything it draws, at once.
    let review = super::git::review(&conn, kind, &repo).await;
    println!(
        "linux: head={:?} files={:?} numstat={}",
        review.head,
        review
            .files
            .iter()
            .map(|f| (&f.path, &f.index, &f.worktree))
            .collect::<Vec<_>>(),
        review.numstat.len()
    );
    assert!(review.is_repo);
    assert!(
        review.head.as_ref().is_some_and(|h| h.len() >= 7),
        "a repository with a commit has a HEAD: {:?}",
        review.head
    );

    let readme = review
        .files
        .iter()
        .find(|f| f.path == "README.md")
        .expect("the modified file is listed");
    assert!(!is_staged(readme), "it was never added");
    // The untracked file the image leaves behind, which is the case a status
    // parser is most likely to drop.
    assert!(
        review.files.iter().any(|f| f.path == "src/main.rs"),
        "untracked files are part of a review: {:?}",
        review.files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );
    assert!(
        review.numstat.iter().any(|n| n.path == "README.md"),
        "the modified file has line counts"
    );

    // A file's diff, unstaged.
    let diff = super::git::diff(&conn, kind, &repo, "README.md", false)
        .await
        .expect("a diff");
    assert!(diff.contains("+hellodirty"), "{diff}");
    assert!(
        super::git::diff(&conn, kind, &repo, "README.md", true)
            .await
            .expect("a staged diff")
            .is_empty(),
        "nothing is staged in the fixture"
    );

    // History, and the patch of the commit it names.
    let log = super::git::log(&conn, kind, &repo, 10, 0)
        .await
        .expect("a log");
    assert_eq!(log.len(), 1, "the image makes exactly one commit");
    assert_eq!(log[0].subject, "first");
    assert_eq!(
        log[0].author_name, "uxnan test",
        "the host's own git identity"
    );

    let patch = super::git::show(&conn, kind, &repo, &log[0].hash)
        .await
        .expect("the commit's patch");
    assert!(patch.contains("+hello"), "{patch}");

    // A hash that is not one never reaches the host.
    assert!(
        super::git::show(&conn, kind, &repo, "HEAD; rm -rf /")
            .await
            .is_err(),
        "only hex is accepted"
    );

    let _ = conn.exec(&format!("rm -rf {repo}")).await;
}

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_stages_commits_and_discards() {
    let (conn, _) = host_or_skip!();
    let kind = super::shellkind::classify(&conn).await;
    let files = super::sftp::open(&conn).await.expect("an SFTP session");
    let home = files.home().await.expect("the host's home");

    // Its own repository, so the fixture the read tests assert on is left as the
    // image built it however this one ends.
    let repo = format!("{home}/mutations");
    conn.exec(&format!(
        "rm -rf {repo} && mkdir -p {repo} && cd {repo} && git init -q && printf 'one\\n' > a.txt && git add a.txt && git commit -qm base"
    ))
    .await
    .expect("a scratch repository");

    // Change one file and add another, then stage exactly one of them.
    files
        .write_file(&format!("{repo}/a.txt"), "one\ntwo\n")
        .await
        .expect("edit");
    files
        .write_file(&format!("{repo}/b.txt"), "new\n")
        .await
        .expect("add");

    super::git::stage(&conn, kind, &repo, "a.txt")
        .await
        .expect("stage");
    let review = super::git::review(&conn, kind, &repo).await;
    let a = review.files.iter().find(|f| f.path == "a.txt").unwrap();
    let b = review.files.iter().find(|f| f.path == "b.txt").unwrap();
    assert!(is_staged(a), "a.txt was staged");
    assert!(!is_staged(b), "b.txt was not");

    super::git::unstage(&conn, kind, &repo, "a.txt")
        .await
        .expect("unstage");
    assert!(
        !is_staged(
            super::git::review(&conn, kind, &repo)
                .await
                .files
                .iter()
                .find(|f| f.path == "a.txt")
                .unwrap()
        ),
        "unstaging puts it back"
    );

    super::git::stage_all(&conn, kind, &repo)
        .await
        .expect("stage all");
    assert!(
        super::git::review(&conn, kind, &repo)
            .await
            .files
            .iter()
            .all(is_staged),
        "add -A stages the untracked one too"
    );

    // A message with the two things that would break if it went through a
    // shell: a newline, and quotes. It travels over SFTP instead.
    let message = "commit from a test\n\nwith a \"quoted\" second line and a $VAR";
    super::git::commit(&conn, &files, kind, &repo, message, false, false)
        .await
        .expect("commit");

    let log = super::git::log(&conn, kind, &repo, 10, 0)
        .await
        .expect("a log");
    assert_eq!(log.len(), 2, "base plus the one just made");
    assert_eq!(log[0].subject, "commit from a test");
    assert!(
        log[0].body.contains("\"quoted\"") && log[0].body.contains("$VAR"),
        "the message arrived verbatim: {:?}",
        log[0].body
    );
    assert!(
        super::git::review(&conn, kind, &repo)
            .await
            .files
            .is_empty(),
        "committing everything leaves a clean tree"
    );

    // The scratch file the commit used must not survive it.
    assert!(
        !files
            .exists(&format!("{repo}/.git/UXNAN_COMMIT_MSG"))
            .await
            .unwrap_or(true),
        "the message file is removed afterwards"
    );

    // Discard, tracked and untracked.
    files
        .write_file(&format!("{repo}/a.txt"), "wrong\n")
        .await
        .expect("edit again");
    files
        .write_file(&format!("{repo}/c.txt"), "unwanted\n")
        .await
        .expect("stray file");
    super::git::discard(&conn, kind, &repo, "a.txt", false)
        .await
        .expect("discard tracked");
    super::git::discard(&conn, kind, &repo, "c.txt", true)
        .await
        .expect("discard untracked");
    assert!(
        super::git::review(&conn, kind, &repo)
            .await
            .files
            .is_empty(),
        "both are gone"
    );
    assert_eq!(
        String::from_utf8(
            files
                .read_bytes(&format!("{repo}/a.txt"))
                .await
                .expect("a.txt")
        )
        .unwrap(),
        "one\ntwo\n",
        "the committed content is what came back"
    );

    // A patch, applied to the working tree — the per-hunk path, over SFTP.
    let patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n one\n two\n+three\n";
    super::git::apply_patch(&conn, &files, kind, &repo, patch, false, false)
        .await
        .expect("apply");
    assert_eq!(
        String::from_utf8(
            files
                .read_bytes(&format!("{repo}/a.txt"))
                .await
                .expect("a.txt")
        )
        .unwrap(),
        "one\ntwo\nthree\n"
    );
    // And reversed, which is how "discard this hunk" is spelled.
    super::git::apply_patch(&conn, &files, kind, &repo, patch, false, true)
        .await
        .expect("reverse");
    assert_eq!(
        String::from_utf8(
            files
                .read_bytes(&format!("{repo}/a.txt"))
                .await
                .expect("a.txt")
        )
        .unwrap(),
        "one\ntwo\n"
    );

    // A patch that does not apply must fail loudly rather than report success.
    assert!(
        super::git::apply_patch(&conn, &files, kind, &repo, "not a patch\n", false, false)
            .await
            .is_err(),
        "a refused apply is an error"
    );

    let _ = conn.exec(&format!("rm -rf {repo}")).await;
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

#[tokio::test]
#[ignore = "needs the Linux container: node scripts/ssh-test-host.mjs up"]
async fn posix_host_returns_an_image_diff_byte_for_byte() {
    let (conn, _) = host_or_skip!();
    let kind = super::shellkind::classify(&conn).await;
    let files = super::sftp::open(&conn).await.expect("an SFTP session");
    let home = files.home().await.expect("the host's home");

    // Bytes that are not text, and specifically not valid UTF-8 (0x80..0xFF):
    // the text path answers `from_utf8_lossy`, which would replace every one of
    // them and hand the viewer a picture that is not the file.
    let repo = format!("{home}/images");
    conn.exec(&format!(
        "rm -rf {repo} && mkdir -p {repo} && cd {repo} && git init -q \
         && printf '\\x89PNG\\r\\n\\x1a\\n\\xde\\xad\\xbe\\xef' > logo.png \
         && git add -A && git commit -qm first \
         && printf '\\x89PNG\\r\\n\\x1a\\n\\xca\\xfe\\xba\\xbe\\xff' > logo.png"
    ))
    .await
    .expect("a repository with an image");

    let diff = super::git::image_diff(&conn, &files, kind, &repo, "logo.png", false)
        .await
        .expect("an image diff");

    use base64::Engine as _;
    let decode = |d: &crate::git::ImageData| {
        base64::engine::general_purpose::STANDARD
            .decode(&d.base64)
            .expect("valid base64")
    };
    let old = decode(diff.old.as_ref().expect("the committed side"));
    let new = decode(diff.new.as_ref().expect("the working side"));
    println!("linux: image diff {} -> {} bytes", old.len(), new.len());

    assert_eq!(diff.old.as_ref().unwrap().mime, "image/png");
    assert_eq!(old, b"\x89PNG\r\n\x1a\n\xde\xad\xbe\xef");
    assert_eq!(new, b"\x89PNG\r\n\x1a\n\xca\xfe\xba\xbe\xff");

    // A file that is not in the commit has no old side, and the viewer draws one
    // panel — the same shape the local layer answers with.
    conn.exec(&format!(
        "cd {repo} && printf '\\x89PNG\\x00\\xff' > added.png"
    ))
    .await
    .expect("an untracked image");
    let added = super::git::image_diff(&conn, &files, kind, &repo, "added.png", false)
        .await
        .expect("an image diff");
    assert!(added.old.is_none(), "nothing is committed under that name");
    assert!(added.new.is_some(), "but it is there on the host");

    let _ = conn.exec(&format!("rm -rf {repo}")).await;
}
