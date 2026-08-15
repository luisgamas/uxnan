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
        files
            .read_file(&format!("{repo}/a.txt"))
            .await
            .expect("a.txt")
            .content,
        "one\ntwo\n",
        "the committed content is what came back"
    );

    // A patch, applied to the working tree — the per-hunk path, over SFTP.
    let patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n one\n two\n+three\n";
    super::git::apply_patch(&conn, &files, kind, &repo, patch, false, false)
        .await
        .expect("apply");
    assert_eq!(
        files
            .read_file(&format!("{repo}/a.txt"))
            .await
            .expect("a.txt")
            .content,
        "one\ntwo\nthree\n"
    );
    // And reversed, which is how "discard this hunk" is spelled.
    super::git::apply_patch(&conn, &files, kind, &repo, patch, false, true)
        .await
        .expect("reverse");
    assert_eq!(
        files
            .read_file(&format!("{repo}/a.txt"))
            .await
            .expect("a.txt")
            .content,
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
async fn posix_host_creates_renames_duplicates_and_deletes() {
    let (conn, _) = host_or_skip!();
    let files = super::sftp::open(&conn).await.expect("an SFTP session");
    let home = files.home().await.expect("the host's home");

    // Its own folder: these tests remove things, and the fixture the read tests
    // assert on has to survive them.
    let base = format!("{home}/tree-ops");
    let _ = conn.exec(&format!("rm -rf {base}")).await;
    conn.exec(&format!("mkdir -p {base}"))
        .await
        .expect("a folder to work in");

    // A bare name, and an intercalated path whose parents do not exist yet.
    let file = files
        .create_file(&base, "notes.md")
        .await
        .expect("a new file");
    assert_eq!(file, format!("{base}/notes.md"));
    let nested = files
        .create_file(&base, "src/deep/main.rs")
        .await
        .expect("an intercalated file");
    assert_eq!(nested, format!("{base}/src/deep/main.rs"));
    assert!(files.exists(&format!("{base}/src/deep")).await.unwrap());

    let folder = files
        .create_dir(&base, "assets/icons")
        .await
        .expect("a new folder");
    assert_eq!(folder, format!("{base}/assets/icons"));

    // The server refuses the second one — `EXCLUDE` is SFTP's own "must not
    // exist", so nothing here has to look first and lose the race.
    assert!(files.create_file(&base, "notes.md").await.is_err());
    assert!(files.create_dir(&base, "assets/icons").await.is_err());

    // A name that could escape the folder never reaches the host.
    assert!(files.create_file(&base, "../escape.txt").await.is_err());
    assert!(files.create_file(&base, "  ").await.is_err());

    // Rename, and the refusal to land on a sibling that is already there.
    files
        .write_file(&file, "hello\n")
        .await
        .expect("something to move");
    let renamed = files.rename(&file, "README.md").await.expect("a rename");
    assert_eq!(renamed, format!("{base}/README.md"));
    assert_eq!(files.read_file(&renamed).await.unwrap().content, "hello\n");
    files
        .create_file(&base, "taken.md")
        .await
        .expect("a sibling");
    assert!(files.rename(&renamed, "taken.md").await.is_err());
    // A case-only rename is a real rename on a case-sensitive host, and the
    // two-step path is what covers the hosts where it is not.
    let cased = files
        .rename(&renamed, "readme.md")
        .await
        .expect("a case-only rename");
    assert_eq!(cased, format!("{base}/readme.md"));
    assert_eq!(files.read_file(&cased).await.unwrap().content, "hello\n");

    // Duplicate: byte for byte, under the local layer's own naming sequence.
    let copy = files.duplicate(&cased).await.expect("a duplicate");
    assert_eq!(copy, format!("{base}/readme copy.md"));
    assert_eq!(files.read_file(&copy).await.unwrap().content, "hello\n");
    let second = files.duplicate(&cased).await.expect("a second duplicate");
    assert_eq!(second, format!("{base}/readme copy 2.md"));
    assert!(files.duplicate(&base).await.is_err(), "a folder is refused");

    // Delete: a file, then a folder that is not empty — `rmdir` alone cannot,
    // so this is the walk.
    files.delete(&copy).await.expect("delete a file");
    assert!(!files.exists(&copy).await.unwrap());
    files
        .delete(&format!("{base}/src"))
        .await
        .expect("delete a tree");
    assert!(!files.exists(&format!("{base}/src")).await.unwrap());
    assert!(!files
        .exists(&format!("{base}/src/deep/main.rs"))
        .await
        .unwrap());

    // What is gone is gone: no trash on a host, which is why the dialog says so.
    assert!(files.delete(&format!("{base}/nothing-here")).await.is_err());
    // And a filesystem root is refused before anything is sent.
    assert!(files.delete("/").await.is_err());

    files.delete(&base).await.expect("clean up");
    assert!(!files.exists(&base).await.unwrap());
}
