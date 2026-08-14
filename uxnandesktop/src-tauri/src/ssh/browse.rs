//! Listing directories on a host, so a project that lives there can be found and
//! added.
//!
//! **Over SFTP, like the file tree — not by asking a shell.** This used to send
//! a script and parse what came back, POSIX first and PowerShell as the
//! fallback, which meant a host running PowerShell paid for *two* remote
//! commands per click. Each of those starts a shell and its profile on the far
//! machine: measured at **2.1 s each** on a real host over a tailnet, and 336 ms
//! against this machine's own `sshd` — where the same listing over SFTP took
//! **6.6 ms**. Same answer, ~50x cheaper on loopback and far more than that
//! across a network, and it needs nothing installed there.
//!
//! The `.git` badge on each folder is one extra request per folder, which is
//! only affordable because they **pipeline on the one channel**: 63 folders cost
//! 44 ms asked one after another and **3.3 ms** asked together, so the listing
//! is one round trip's worth of waiting rather than one per folder.
//!
//! Only directories are returned, and hidden ones are left out. Adding a project
//! means choosing a folder, and neither thousands of files nor a `.cache` is
//! something a user is picking here — unlike the file tree, which keeps them
//! because `.github` and `.env` are exactly what someone opens a tree to find.

use futures_util::future::join_all;

use super::sftp::{RemoteFiles, SftpFailure};

/// Most entries one listing returns. A home directory with ten thousand folders
/// is unusual but not impossible, and neither the wire nor a picker gains
/// anything from the rest.
const MAX_ENTRIES: usize = 500;

/// A directory on a host.
///
/// Deliberately the same shape as the local [`crate::browse::DirEntry`], so one
/// picker renders either machine: a folder on a host should look and behave like
/// a folder here, git badge included.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDir {
    /// Just the folder name, for display.
    pub name: String,
    /// Absolute path on that machine, which is what gets registered.
    pub path: String,
    /// Whether it holds a `.git` — answered by the host inside the same command,
    /// because a per-folder round trip would cost seconds each.
    pub is_repo: bool,
}

/// What a listing produced. Mirrors [`crate::browse::DirListing`] field for
/// field, plus [`RemoteListing::truncated`], which only a remote listing needs.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListing {
    /// The directory that was listed, absolute and as the host spells it.
    pub path: String,
    /// The parent, or `None` at the root — so a picker knows whether "up" exists
    /// without having to parse paths for two different operating systems.
    pub parent: Option<String>,
    /// Whether the listed directory is itself a repository.
    pub is_repo: bool,
    pub entries: Vec<RemoteDir>,
    /// True when the listing was cut at [`MAX_ENTRIES`]. Said out loud, because
    /// a picker that silently shows 500 of 3,000 folders is a picker that
    /// cannot find the one you want and will not tell you why.
    pub truncated: bool,
}

/// List the directories inside `path` on a host. An empty `path` means the
/// user's home, which is where a picker should start.
pub async fn list_dirs(files: &RemoteFiles, path: &str) -> Result<RemoteListing, SftpFailure> {
    let path = path.trim();
    let dir = if path.is_empty() {
        files.home().await?
    } else {
        path.replace(char::from(92), "/")
    };

    let mut entries: Vec<RemoteDir> = files
        .list_dir(&dir)
        .await?
        .into_iter()
        .filter(|e| e.is_dir && !e.name.starts_with('.'))
        .map(|e| RemoteDir {
            name: e.name,
            path: e.path,
            is_repo: false,
        })
        .collect();
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);

    // Every `.git` at once. Asked one at a time this would be a round trip per
    // folder; asked together they pipeline on the session's single channel. The
    // paths are built first because each future borrows the one it is asking
    // about for as long as it is in flight.
    let probe_paths: Vec<String> = entries
        .iter()
        .map(|e| format!("{}/.git", e.path))
        .chain(std::iter::once(format!("{dir}/.git")))
        .collect();
    let mut answers = join_all(probe_paths.iter().map(|p| files.exists(p))).await;
    // A folder whose `.git` could not be looked at is reported as an ordinary
    // folder: it is still a folder, and refusing the listing over a badge would
    // trade the whole picker for a decoration.
    let self_is_repo = answers.pop().and_then(Result::ok).unwrap_or(false);
    for (entry, answer) in entries.iter_mut().zip(answers) {
        entry.is_repo = answer.unwrap_or(false);
    }

    Ok(RemoteListing {
        parent: parent_of(&dir),
        path: dir,
        is_repo: self_is_repo,
        entries,
        truncated,
    })
}

/// Whether a folder on the host is a git repository.
///
/// `.git` existing is the test, not `git rev-parse`: in a worktree or a
/// submodule `.git` is a **file**, and either way the answer costs one request
/// on a session that is already open instead of starting a shell to run git.
/// A failure to look is answered `false` — a project that works minus its
/// branches beats refusing to add it.
pub async fn is_git_repo(files: &RemoteFiles, path: &str) -> bool {
    let path = path.replace(char::from(92), "/");
    files.exists(&format!("{path}/.git")).await.unwrap_or(false)
}

/// The parent of an absolute, forward-slash path — or `None` at a root, so a
/// picker knows whether "up" exists without parsing paths for two operating
/// systems. Both roots are recognised: `/` and a Windows drive (`C:/`).
fn parent_of(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    // `C:` (a drive with no trailing slash) is still a root.
    if trimmed.is_empty() || is_drive_root(trimmed) {
        return None;
    }
    let (head, _) = trimmed.rsplit_once('/')?;
    if head.is_empty() {
        return Some("/".to_string());
    }
    if is_drive_root(head) {
        return Some(format!("{head}/"));
    }
    Some(head.to_string())
}

/// Whether `path` is a bare Windows drive (`C:`), which has no parent.
fn is_drive_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A path as this module hands them out: forward slashes, no trailing one.
    fn normalize_for_test(path: &std::path::Path) -> String {
        path.to_string_lossy().replace(char::from(92), "/")
    }

    /// Against the sshd on this machine: list the home directory, then walk into
    /// one of its folders. Ignored by default.
    ///
    /// Also prints what it cost. The point of moving this off the host's shell
    /// was speed, and a number here is what keeps that claim honest.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn browse_live_lists_this_machines_home() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

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

        let files = crate::ssh::sftp::open(&conn)
            .await
            .expect("an SFTP session");
        let started = std::time::Instant::now();
        let home = list_dirs(&files, "").await.expect("the home directory");
        println!("live: listed home in {:?}", started.elapsed());
        assert!(!home.path.is_empty());
        println!(
            "live: {} has {} folders (truncated={}), parent={:?}",
            home.path,
            home.entries.len(),
            home.truncated,
            home.parent
        );
        assert!(home.parent.is_some(), "a home directory has a parent");
        // Repo detection is only worth anything if it survives a real host's
        // filesystem, so say what it found rather than trusting the parser.
        println!(
            "live: repos here: {:?}",
            home.entries
                .iter()
                .filter(|d| d.is_repo)
                .map(|d| d.name.as_str())
                .collect::<Vec<_>>()
        );

        // A folder that really is a repository must be badged — and this asserts
        // the case that decided how the check is written: this crate is checked
        // out as a git **worktree**, where `.git` is a file, not a directory.
        // `git rev-parse` or a directory test would both miss it.
        let mut repo = std::env::current_dir().unwrap();
        while !repo.join(".git").exists() {
            assert!(repo.pop(), "expected to be running inside a checkout");
        }
        let repo_name = repo.file_name().unwrap().to_string_lossy().to_string();
        let above = normalize_for_test(repo.parent().unwrap());
        let listing = list_dirs(&files, &above)
            .await
            .expect("the folder above it");
        let badged = listing
            .entries
            .iter()
            .find(|d| d.name == repo_name)
            .unwrap_or_else(|| panic!("{repo_name} is missing from {above}"));
        assert!(
            badged.is_repo,
            "{repo_name} is a git worktree; its .git is a file and must still count"
        );
        println!("live: {above} badged {repo_name} as a repository");

        // Walking into a child must produce a listing of *that* folder — the
        // paths we hand back have to be openable on the host, not merely
        // plausible on this one.
        if let Some(child) = home.entries.first() {
            let inside = list_dirs(&files, &child.path).await.expect("a subfolder");
            let normalize = |p: &str| p.replace([std::path::MAIN_SEPARATOR, '\\'], "/");
            assert_eq!(normalize(&inside.path), normalize(&child.path));
            println!(
                "live: walked into {} ({} folders)",
                inside.path,
                inside.entries.len()
            );
        }
    }

    #[test]
    fn a_posix_root_has_no_parent_and_its_children_do() {
        // A picker asks "is there an up from here?", and the answer must not
        // depend on which operating system the host runs.
        assert_eq!(parent_of("/"), None);
        assert_eq!(parent_of("/home"), Some("/".to_string()));
        assert_eq!(parent_of("/home/dev/code"), Some("/home/dev".to_string()));
    }

    #[test]
    fn a_windows_drive_is_a_root_too() {
        // `C:/` is where "up" stops on a Windows host; treating it as an
        // ordinary segment would offer a parent that cannot be listed.
        assert_eq!(parent_of("C:/"), None);
        assert_eq!(parent_of("C:"), None);
        assert_eq!(parent_of("C:/Users"), Some("C:/".to_string()));
        assert_eq!(
            parent_of("C:/Users/gamas/code"),
            Some("C:/Users/gamas".to_string())
        );
    }

    #[test]
    fn a_trailing_slash_is_not_a_child() {
        // The host spells its own paths; a trailing separator must not add a
        // phantom level to the walk.
        assert_eq!(parent_of("/home/dev/"), Some("/home".to_string()));
    }
}
