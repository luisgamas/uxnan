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
use crate::error::AppError;
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

/// One section separator inside a batched answer.
///
/// The sections are marked rather than counted because two of them can be empty
/// and one of them (`--porcelain -z`) contains no newlines at all: splitting on
/// lines would silently merge them, which is how a clean repository would come
/// back looking like a missing one.
const SEP: &str = "__UXNAN_GIT_SEP__";

/// Everything the Changes tab reads, in **one** remote command.
///
/// The local layer asks for this in three calls (`git_status`, `worktree_status`,
/// `git_numstat`) because each is microseconds away. Here each one is a shell
/// start on another machine — ~2s on a real host (§5.3) — so three calls is six
/// seconds of nothing. One command, four sections, one round trip.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReview {
    /// The changed files, in the local layer's own shape so the panel renders
    /// them with the component it already has.
    pub files: Vec<crate::git::FileChange>,
    /// Added/deleted per file, for the same reason.
    pub numstat: Vec<crate::git::FileNumstat>,
    #[serde(flatten)]
    pub status: WorktreeStatus,
    /// `HEAD`, so the History tab knows when it has to reload.
    pub head: Option<String>,
    /// False when the folder is not a repository, or the host could not answer.
    pub is_repo: bool,
}

fn review_script(kind: ShellKind, path: &str) -> String {
    let p = quote_arg(kind, path);
    let upstream = quote_arg(kind, "@{u}...HEAD");
    let sep = if kind == ShellKind::Cmd { " & " } else { " ; " };
    [
        format!("echo {BEGIN}"),
        format!("git -C {p} rev-parse HEAD"),
        format!("echo {SEP}"),
        format!("git -C {p} rev-list --left-right --count {upstream}"),
        format!("echo {SEP}"),
        // `-z` for the file list: a path with a space, a quote or a newline in it
        // is a real thing, and the NUL form is the only one that survives it.
        format!("git -C {p} status --porcelain=v1 -z --untracked-files=all"),
        format!("echo {SEP}"),
        format!("git -C {p} diff --numstat HEAD"),
        format!("echo {END}"),
    ]
    .join(sep)
}

/// Take off the newlines a section marker left, and nothing else.
///
/// Deliberately not `trim`: see the porcelain note in `parse_review`.
fn trim_newlines(section: &str) -> &str {
    section.trim_matches(|c: char| c == '\n' || c == '\r')
}

/// Read the whole review state of a worktree on a host.
///
/// Like [`status`], it never returns `Err`: a host that cannot answer is a
/// repository nobody read, which the panel shows as such. What it must never do
/// is answer *partially* — an empty file list from a failed command would read
/// as "no changes", so a missing section leaves `is_repo` false.
pub async fn review(conn: &Connection, kind: ShellKind, path: &str) -> RemoteReview {
    if kind == ShellKind::Unknown {
        return RemoteReview::default();
    }
    match conn.exec(&review_script(kind, path)).await {
        Ok(out) => parse_review(&out.stdout).unwrap_or_default(),
        Err(_) => RemoteReview::default(),
    }
}

fn parse_review(stdout: &str) -> Option<RemoteReview> {
    let start = stdout.find(BEGIN)? + BEGIN.len();
    let end = stdout[start..].find(END)? + start;
    let body = &stdout[start..end];
    let mut sections = body.split(SEP);
    let head_section = sections.next()?;
    let distance_section = sections.next()?;
    let files_section = sections.next()?;
    let numstat_section = sections.next()?;

    // A 40-char hex line, or nothing at all in a repository with no commits.
    let head = head_section
        .lines()
        .map(str::trim)
        .find(|l| l.len() == 40 && l.chars().all(|c| c.is_ascii_hexdigit()))
        .map(str::to_string);

    // `rev-list --left-right --count` prints "<behind>	<ahead>"; with no
    // upstream git fails and prints nothing, which is zero distance, not an
    // error (the case that once swallowed the end marker).
    let (behind, ahead) = distance_section
        .lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let behind: u32 = parts.next()?.parse().ok()?;
            let ahead: u32 = parts.next()?.parse().ok()?;
            parts.next().is_none().then_some((behind, ahead))
        })
        .unwrap_or((0, 0));

    // The porcelain section is NUL-separated, so it is handed to the local
    // parser whole rather than being split into lines first. Only the newlines
    // the surrounding markers left are taken off it — **not** whitespace: the
    // status code of an unstaged change is a leading *space* (` M README.md`),
    // and a `trim()` here ate it, which shifted every path one character left
    // and had the panel list `EADME.md`. The live Linux test is what caught it.
    let files = crate::git::parse_status_files(trim_newlines(files_section));
    let numstat = crate::git::parse_numstat(numstat_section);

    Some(RemoteReview {
        status: WorktreeStatus {
            dirty: files.len() as u32,
            ahead,
            behind,
        },
        files,
        numstat,
        head,
        is_repo: true,
    })
}

/// A file's diff on the host, staged or unstaged.
///
/// One command, and deliberately **not** batched with anything: the panel asks
/// for this when a row is clicked, one file at a time, which is also how the
/// local layer works. Batching every file's diff into the listing would move
/// seconds of work to a moment when the user asked for none of it.
pub async fn diff(
    conn: &Connection,
    kind: ShellKind,
    path: &str,
    file: &str,
    staged: bool,
) -> Result<String, AppError> {
    if kind == ShellKind::Unknown {
        return Err(unnameable_shell());
    }
    let p = quote_arg(kind, path);
    let f = quote_arg(kind, file);
    let staged_flag = if staged { "--staged " } else { "" };
    let out = conn
        .exec(&format!("git -C {p} diff {staged_flag}-- {f}"))
        .await?;
    Ok(out.stdout)
}

/// The history of a worktree on the host.
///
/// The field separators are git's own (`%x1f` / `%x1e`), so the answer is parsed
/// by the **local** parser rather than a second one written for the remote case:
/// two parsers for one format is two chances to disagree about a commit message
/// that contains a newline.
pub async fn log(
    conn: &Connection,
    kind: ShellKind,
    path: &str,
    limit: u32,
    skip: u32,
) -> Result<Vec<crate::git::CommitInfo>, AppError> {
    if kind == ShellKind::Unknown {
        return Err(unnameable_shell());
    }
    let p = quote_arg(kind, path);
    // The format string carries `%` and control characters, so it is quoted for
    // the host's shell like any other argument.
    let format = quote_arg(kind, crate::git::LOG_FORMAT);
    let out = conn
        .exec(&format!(
            "git -C {p} log --date-order --skip={skip} -n {limit} --decorate=short --pretty={format}"
        ))
        .await?;
    Ok(crate::git::parse_log(&out.stdout))
}

/// One commit's patch, for the History tab's viewer.
pub async fn show(
    conn: &Connection,
    kind: ShellKind,
    path: &str,
    hash: &str,
) -> Result<String, AppError> {
    if kind == ShellKind::Unknown {
        return Err(unnameable_shell());
    }
    // Hex only. This ends up in a command line on someone else's machine, and
    // "it can only ever come from our own list" stops being true after one
    // refactor — the same rule the local `show` applies for the same reason.
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Invalid(format!("{hash} is not a commit hash")));
    }
    let p = quote_arg(kind, path);
    let out = conn
        .exec(&format!("git -C {p} show --format= -p {hash}"))
        .await?;
    Ok(out.stdout)
}

/// What a mutation on the host did, or why it did not.
///
/// Unlike the read paths, these **do** return `Err`: a stage that silently did
/// nothing is worse than one that says it failed, because the user's next act is
/// to commit what they believe is staged.
async fn run(conn: &Connection, kind: ShellKind, args: &str) -> Result<(), AppError> {
    if kind == ShellKind::Unknown {
        return Err(unnameable_shell());
    }
    let out = conn.exec(args).await?;
    match out.exit_code {
        Some(0) => Ok(()),
        // No exit status at all means the channel closed without one — a killed
        // command or a dropped connection, never a success.
        other => Err(AppError::Invalid(format!(
            "the host refused the command (exit {}){}",
            other.map(|c| c.to_string()).unwrap_or_else(|| "?".into()),
            first_line(&out.stderr)
        ))),
    }
}

/// The first line of what the host complained, prefixed for a message. Empty
/// when it said nothing — a bare exit code is still better than a lie.
fn first_line(stderr: &str) -> String {
    match stderr.lines().map(str::trim).find(|l| !l.is_empty()) {
        Some(line) => format!(": {line}"),
        None => String::new(),
    }
}

fn unnameable_shell() -> AppError {
    AppError::Invalid("this host's shell could not be named, so nothing was sent to it".to_string())
}

pub async fn stage(
    conn: &Connection,
    kind: ShellKind,
    path: &str,
    file: &str,
) -> Result<(), AppError> {
    let (p, f) = (quote_arg(kind, path), quote_arg(kind, file));
    run(conn, kind, &format!("git -C {p} add -- {f}")).await
}

pub async fn unstage(
    conn: &Connection,
    kind: ShellKind,
    path: &str,
    file: &str,
) -> Result<(), AppError> {
    let (p, f) = (quote_arg(kind, path), quote_arg(kind, file));
    run(conn, kind, &format!("git -C {p} restore --staged -- {f}")).await
}

pub async fn stage_all(conn: &Connection, kind: ShellKind, path: &str) -> Result<(), AppError> {
    let p = quote_arg(kind, path);
    run(conn, kind, &format!("git -C {p} add -A")).await
}

pub async fn unstage_all(conn: &Connection, kind: ShellKind, path: &str) -> Result<(), AppError> {
    let p = quote_arg(kind, path);
    run(conn, kind, &format!("git -C {p} reset -q")).await
}

/// Throw a file's changes away on the host. The one irreversible read-path
/// neighbour, which is why the command layer fences it like a mutation.
pub async fn discard(
    conn: &Connection,
    kind: ShellKind,
    path: &str,
    file: &str,
    untracked: bool,
) -> Result<(), AppError> {
    let (p, f) = (quote_arg(kind, path), quote_arg(kind, file));
    let args = if untracked {
        format!("git -C {p} clean -fd -- {f}")
    } else {
        format!("git -C {p} restore --source=HEAD --staged --worktree -- {f}")
    };
    run(conn, kind, &args).await
}

/// Commit on the host, with the message delivered as a **file**.
///
/// `git commit -m` would mean putting arbitrary multi-line user text through
/// three different shells' quoting rules, which is the exact class of bug this
/// layer exists to avoid — and the one that already cost a directory listing.
/// `-F` takes a path instead, and the path is written over the SFTP session that
/// is already open (`super::sftp`), so nothing about the message is ever
/// interpreted by a shell.
///
/// The temp file lives beside the repository's `.git`, not in `/tmp`: it is the
/// one directory the user is certainly allowed to write to on that machine, and
/// it is on the same filesystem. It is removed afterwards, and its name is
/// deliberately dull enough to be recognisable if a crash ever leaves one.
pub async fn commit(
    conn: &Connection,
    files: &super::sftp::RemoteFiles,
    kind: ShellKind,
    path: &str,
    message: &str,
    amend: bool,
    sign_off: bool,
) -> Result<(), AppError> {
    if kind == ShellKind::Unknown {
        return Err(unnameable_shell());
    }
    if message.trim().is_empty() {
        return Err(AppError::Invalid("a commit needs a message".to_string()));
    }
    let scratch = format!(
        "{}/.git/UXNAN_COMMIT_MSG",
        path.replace(char::from(92), "/")
    );
    files
        .write_file(&scratch, message)
        .await
        .map_err(AppError::from)?;

    let p = quote_arg(kind, path);
    let f = quote_arg(kind, &scratch);
    let mut flags = String::new();
    if amend {
        flags.push_str(" --amend");
    }
    if sign_off {
        flags.push_str(" -s");
    }
    let outcome = run(conn, kind, &format!("git -C {p} commit{flags} -F {f}")).await;
    // Remove it either way: a failed commit leaves the message in the composer,
    // and a stale file on the host would be read as this one's next time.
    let _ = files.remove_file(&scratch).await;
    outcome
}

/// Apply a patch on the host — the per-hunk stage / unstage / discard action.
///
/// Same reason as the commit message: `git apply` reads its patch from **stdin**,
/// and `Connection::exec` has no stdin at all. The patch goes over SFTP and git
/// is pointed at the file.
pub async fn apply_patch(
    conn: &Connection,
    files: &super::sftp::RemoteFiles,
    kind: ShellKind,
    path: &str,
    patch: &str,
    cached: bool,
    reverse: bool,
) -> Result<(), AppError> {
    if kind == ShellKind::Unknown {
        return Err(unnameable_shell());
    }
    let scratch = format!("{}/.git/UXNAN_PATCH", path.replace(char::from(92), "/"));
    files
        .write_file(&scratch, patch)
        .await
        .map_err(AppError::from)?;

    let p = quote_arg(kind, path);
    let f = quote_arg(kind, &scratch);
    let mut flags = String::new();
    if cached {
        flags.push_str(" --cached");
    }
    if reverse {
        flags.push_str(" --reverse");
    }
    let outcome = run(conn, kind, &format!("git -C {p} apply{flags} -- {f}")).await;
    let _ = files.remove_file(&scratch).await;
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the answer a host's shell would print for `review_script`, so the
    /// parser can be exercised without one.
    fn review_output(head: &str, distance: &str, porcelain: &str, numstat: &str) -> String {
        format!("{BEGIN}\n{head}\n{SEP}\n{distance}\n{SEP}\n{porcelain}\n{SEP}\n{numstat}\n{END}\n")
    }

    /// The bug the Linux host caught: an unstaged change's status is a **leading
    /// space** (` M path`), and trimming the section as whitespace ate it, so
    /// every path arrived one character short — the panel listed `EADME.md` and
    /// staging it would have failed on a file that does not exist.
    #[test]
    fn review_keeps_the_leading_space_of_an_unstaged_status() {
        let porcelain = " M README.md\0?? src/main.rs\0";
        let review = parse_review(&review_output(
            "5ec28e668963b57bf90efd6dfe3a57499ba92082",
            "",
            porcelain,
            "1\t1\tREADME.md",
        ))
        .expect("a parsed review");

        assert_eq!(review.files.len(), 2);
        assert_eq!(review.files[0].path, "README.md");
        assert_eq!(
            (
                review.files[0].index.as_str(),
                review.files[0].worktree.as_str()
            ),
            (" ", "M")
        );
        assert_eq!(review.files[1].path, "src/main.rs");
        assert_eq!(review.status.dirty, 2);
        assert_eq!(review.numstat.len(), 1);
        assert_eq!(
            review.head.as_deref(),
            Some("5ec28e668963b57bf90efd6dfe3a57499ba92082")
        );
        assert!(review.is_repo);
    }

    /// A branch with no upstream: `rev-list` fails and prints nothing, which is
    /// zero distance — not a failure, and not a reason to lose the sections
    /// after it. The same case that once swallowed the end marker.
    #[test]
    fn review_reads_a_branch_with_no_upstream() {
        let review = parse_review(&review_output(
            "5ec28e668963b57bf90efd6dfe3a57499ba92082",
            "",
            "",
            "",
        ))
        .expect("a parsed review");

        assert_eq!((review.status.ahead, review.status.behind), (0, 0));
        assert!(
            review.files.is_empty(),
            "a clean tree is empty, not missing"
        );
        assert!(review.is_repo, "clean is still a repository");
    }

    #[test]
    fn review_reads_ahead_and_behind() {
        let review = parse_review(&review_output(
            "5ec28e668963b57bf90efd6dfe3a57499ba92082",
            "2\t3",
            "",
            "",
        ))
        .expect("a parsed review");

        // git prints "<behind>\t<ahead>" for `--left-right --count @{u}...HEAD`.
        assert_eq!((review.status.behind, review.status.ahead), (2, 3));
    }

    /// A repository with no commits at all: `rev-parse HEAD` fails, and that is
    /// a worktree with no HEAD rather than a folder that is not a repository.
    #[test]
    fn review_survives_a_repository_with_no_commits() {
        let review =
            parse_review(&review_output("", "", "?? first.txt\0", "")).expect("a parsed review");

        assert_eq!(review.head, None);
        assert_eq!(review.files.len(), 1);
        assert!(review.is_repo);
    }

    /// No markers means the host answered with something that is not this
    /// command's output — a shell profile that printed a banner and failed, or a
    /// killed channel. That must not be read as a clean repository.
    #[test]
    fn review_refuses_output_it_did_not_produce() {
        assert!(parse_review("Welcome to Ubuntu 24.04\n").is_none());
        assert!(parse_review(&format!("{BEGIN}\nonly one section\n")).is_none());
    }

    /// Every argument that reaches a host's command line is quoted for the shell
    /// that host reported — including the ones this module writes itself.
    #[test]
    fn review_script_quotes_for_each_shell() {
        let posix = review_script(ShellKind::Posix, "/home/u/my project");
        assert!(posix.contains("'/home/u/my project'"), "{posix}");
        // `@{u}` is a hashtable literal to PowerShell when it is bare, so it is
        // quoted like any other argument (double quotes there, not single —
        // inside them `@{…}` is plain text).
        let pwsh = review_script(ShellKind::PowerShell, "C:/repo");
        assert!(pwsh.contains(r#""@{u}...HEAD""#), "{pwsh}");
        // cmd sequences with `&`; the others with `;`.
        assert!(review_script(ShellKind::Cmd, "C:/repo").contains(" & "));
        assert!(posix.contains(" ; "));
    }

    /// A shell nobody could name is sent nothing at all — the same rule the
    /// status path follows, applied to the paths that can *change* a host.
    #[tokio::test]
    async fn unnamed_shells_are_refused_before_anything_is_sent() {
        assert!(matches!(unnameable_shell(), AppError::Invalid(_)));
    }

    /// The exit-code contract for mutations: only 0 is success, and a channel
    /// that closed without a status is not one.
    #[test]
    fn stderr_is_quoted_back_when_a_command_fails() {
        assert_eq!(
            first_line("\n\nfatal: pathspec 'x' did not match\n"),
            ": fatal: pathspec 'x' did not match"
        );
        assert_eq!(first_line("   \n"), "");
        assert_eq!(first_line(""), "");
    }

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
