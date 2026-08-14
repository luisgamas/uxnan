//! Git on a host: the branch a worktree is on, and how dirty it is.
//!
//! Unlike files (which go over SFTP, a subsystem — see [`super::sftp`]), git has
//! to be *run*, so this is reached through `exec` and therefore through that
//! machine's shell. The difference from every earlier attempt is that the shell
//! is not assumed: [`super::shellkind`] asked the host which one it starts, and
//! every argument is quoted for that answer. A host whose shell could not be
//! named is not sent anything at all — the sidebar then says the branch was not
//! read, which is true, instead of showing one it invented.
//!
//! **One command, delimited output.** A remote command costs seconds because the
//! host starts a shell for it (§5.3), so branch, upstream distance and the change
//! count are asked together and the answer is read between markers. That also
//! makes a chatty or failing shell profile impossible to mistake for data — the
//! same technique as [`super::inventory`].

use super::conn::Connection;
use super::shellkind::{quote_arg, ShellKind};
use crate::git::WorktreeStatus;

const BEGIN: &str = "__UXNAN_GIT_BEGIN__";
const END: &str = "__UXNAN_GIT_END__";

/// What a host reported about one worktree.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteGitStatus {
    /// The branch, or `None` when detached — or when the host could not be asked.
    pub branch: Option<String>,
    /// Changed entries, commits ahead and behind, in the local layer's own shape
    /// so the sidebar badges render identically for either machine.
    #[serde(flatten)]
    pub status: WorktreeStatus,
    /// Whether the folder is a git worktree at all. `false` also covers "git is
    /// not installed there", which the UI must not report as "no changes".
    pub is_repo: bool,
}

/// The one command. `git -C <path>` rather than a `cd`, because it needs no shell
/// syntax beyond quoting — the fewer shell-shaped things sent to a host, the
/// fewer ways it can differ.
fn script(kind: ShellKind, path: &str) -> String {
    let p = quote_arg(kind, path);
    // `@{u}` is quoted because PowerShell reads `@{…}` as a hashtable literal.
    let upstream = quote_arg(kind, "@{u}...HEAD");
    // **Unconditional sequencing, not `&&`.** A branch with no upstream makes
    // `rev-list` fail, and with `&&` that swallowed everything after it — the end
    // marker included — so a real checkout came back as "not a repository". A
    // live test caught that; the unit tests were happy, because they never ran a
    // shell. cmd separates statements with `&`, POSIX and PowerShell with `;`.
    let sep = if kind == ShellKind::Cmd { " & " } else { " ; " };
    [
        format!("echo {BEGIN}"),
        format!("git -C {p} rev-parse --abbrev-ref HEAD"),
        format!("git -C {p} rev-list --left-right --count {upstream}"),
        format!("git -C {p} status --porcelain"),
        format!("echo {END}"),
    ]
    .join(sep)
}

/// Read the answer. Absent pieces stay absent: an empty change list is zero
/// changes, but a *missing* section is not "clean", it is "not answered".
fn parse(stdout: &str) -> Option<RemoteGitStatus> {
    let start = stdout.find(BEGIN)? + BEGIN.len();
    let end = stdout[start..].find(END)? + start;
    let body = &stdout[start..end];
    let mut lines = body.lines().map(str::trim).filter(|l| !l.is_empty());

    let branch = lines.next()?.to_string();
    let mut rest: Vec<&str> = lines.collect();
    // `rev-list --left-right --count` prints "<behind>  <ahead>". With no
    // upstream git fails and prints nothing, so what follows the branch is
    // already the change list — plenty of branches have no upstream, and that is
    // not an error. Only a bare "<n> <n>" pair is taken as the distance; anything
    // else stays a change, which is what it is.
    let distance = rest.first().and_then(|l| {
        let mut parts = l.split_whitespace();
        let behind: u32 = parts.next()?.parse().ok()?;
        let ahead: u32 = parts.next()?.parse().ok()?;
        parts.next().is_none().then_some((behind, ahead))
    });
    let (behind, ahead) = match distance {
        Some(pair) => {
            rest.remove(0);
            pair
        }
        None => (0, 0),
    };
    let dirty = rest.len() as u32;

    Some(RemoteGitStatus {
        branch: (branch != "HEAD").then_some(branch),
        status: WorktreeStatus {
            dirty,
            ahead,
            behind,
        },
        is_repo: true,
    })
}

/// Ask a host about a worktree. A shell nobody could name, a folder that is not a
/// repository, or a host without git all answer the same way — `is_repo: false`
/// and nothing else — because the interface must not turn any of them into "no
/// changes".
pub async fn status(conn: &Connection, kind: ShellKind, path: &str) -> RemoteGitStatus {
    if kind == ShellKind::Unknown {
        return RemoteGitStatus::default();
    }
    match conn.exec(&script(kind, path)).await {
        Ok(out) => parse(&out.stdout).unwrap_or_default(),
        Err(_) => RemoteGitStatus::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Against the sshd of this machine, on a folder that really is a git
    /// worktree: the branch and the change count come back from git itself.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn git_live_reads_a_real_worktree() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use crate::ssh::shellkind::classify;

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        // The shell is asked, exactly as the app does it.
        let kind = classify(&conn).await;
        assert_ne!(kind, ShellKind::Unknown, "the host must be classifiable");

        // This worktree is a real checkout, so git has something true to say.
        let here = std::env::current_dir().expect("cwd");
        let repo = here
            .parent()
            .and_then(|p| p.parent())
            .expect("the worktree root");
        let repo = repo.to_string_lossy().replace('\\', "/");

        let got = status(&conn, kind, &repo).await;
        println!(
            "live: {repo} → branch={:?} dirty={} ahead={} behind={} isRepo={}",
            got.branch, got.status.dirty, got.status.ahead, got.status.behind, got.is_repo
        );
        assert!(got.is_repo, "a real checkout must be recognised");
        assert!(
            got.branch.is_some(),
            "this worktree is on a branch, so one must come back"
        );

        // A folder that is not a repository answers "not a repository" — never
        // "clean", which is what the sidebar would otherwise show.
        let plain = status(&conn, kind, "/").await;
        assert!(!plain.is_repo, "a filesystem root is not a worktree");
    }

    #[test]
    fn a_path_with_a_space_survives_every_shell() {
        // The argument the user actually has: a project under "My Documents".
        let path = "/home/dev/My Projects/app";
        assert!(script(ShellKind::Posix, path).contains("'/home/dev/My Projects/app'"));
        assert!(script(ShellKind::Cmd, path).contains("\"/home/dev/My Projects/app\""));
        assert!(script(ShellKind::PowerShell, path).contains("\"/home/dev/My Projects/app\""));
    }

    #[test]
    fn the_upstream_revision_is_quoted_for_powershell() {
        // `@{u}` unquoted is a hashtable literal there, which turns the whole
        // command into a parser error.
        let s = script(ShellKind::PowerShell, "/app");
        assert!(s.contains("\"@{u}...HEAD\""), "{s}");
    }

    #[test]
    fn a_real_answer_is_read_whole() {
        let out = format!("{BEGIN}\nmain\n2\t3\n M src/main.rs\n?? notes.txt\n{END}\n");
        let got = parse(&out).expect("an answer");
        assert_eq!(got.branch.as_deref(), Some("main"));
        assert_eq!(got.status.behind, 2);
        assert_eq!(got.status.ahead, 3);
        assert_eq!(got.status.dirty, 2);
        assert!(got.is_repo);
    }

    #[test]
    fn a_detached_head_has_no_branch() {
        // `HEAD` is what git prints when there is no branch; reporting it *as* a
        // branch would put the word "HEAD" in the sidebar.
        let out = format!("{BEGIN}\nHEAD\n0\t0\n{END}");
        let got = parse(&out).expect("an answer");
        assert_eq!(got.branch, None);
        assert!(got.is_repo);
    }

    #[test]
    fn no_upstream_is_zero_distance_not_a_failure() {
        // A fresh branch has no upstream: git prints nothing for that line and
        // the rest of the answer still stands.
        let out = format!("{BEGIN}\nfeature/x\n M a.txt\n{END}");
        let got = parse(&out).expect("an answer");
        assert_eq!(got.branch.as_deref(), Some("feature/x"));
        assert_eq!((got.status.ahead, got.status.behind), (0, 0));
    }

    #[test]
    fn a_chatty_profile_around_the_answer_changes_nothing() {
        let out = format!("Welcome!\nMOTD: main is protected\n{BEGIN}\nmain\n0\t0\n{END}\nbye\n");
        assert_eq!(parse(&out).unwrap().branch.as_deref(), Some("main"));
    }

    #[test]
    fn silence_is_not_a_clean_repository() {
        // The failure that matters: no markers means the question was not
        // answered, and the sidebar must not read that as "no changes".
        assert_eq!(parse(""), None);
        assert_eq!(parse("git: command not found"), None);
        assert!(!RemoteGitStatus::default().is_repo);
    }
}
