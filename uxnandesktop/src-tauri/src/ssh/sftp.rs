//! Files on a host, over SFTP.
//!
//! **Why SFTP and not commands.** Everything else this layer sends to a host has
//! to survive whatever shell that machine starts, because its owner switches
//! between cmd, PowerShell, WSL and Git Bash as they please. SFTP sidesteps the
//! question entirely: it is an SSH *subsystem* — a program the server runs, with
//! a binary protocol — so listing a directory or reading a file behaves the same
//! on every host, and needs nothing installed there.
//!
//! That is the whole argument for building remote files on it rather than on
//! `ls` / `dir` / `Get-ChildItem`: no syntax to choose, no quoting to get wrong,
//! no output to parse, and no shell to blame.
//!
//! **Shape.** The results are the local file layer's own types
//! ([`crate::fs::FsEntry`], [`crate::fs::FileContent`]), so the file tree and the
//! editor render a host's files with the components they already have — the same
//! reason the folder picker reuses the local browser.
//!
//! **What is deliberately missing.** Git-ignored marking (`ignored`) is always
//! `false` here: it is computed by asking git about a working tree, and remote
//! git is its own piece of work. A tree that dims nothing is honest; a tree that
//! guessed would be quietly wrong.

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;

use super::conn::Connection;
use crate::error::AppError;
use crate::fs::{FileContent, FsEntry, MAX_EDIT_BYTES};

/// Open an SFTP session on a host's existing connection.
///
/// One channel, like everything else here (§5.3): the connection is already
/// authenticated, so this costs a channel rather than a handshake.
pub async fn open(conn: &Connection) -> Result<SftpSession, AppError> {
    let channel = conn
        .handle()
        .channel_open_session()
        .await
        .map_err(|e| AppError::Invalid(format!("could not open a file channel: {e}")))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| AppError::Invalid(format!("this host does not offer SFTP: {e}")))?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| AppError::Invalid(format!("the host's SFTP session did not start: {e}")))
}

/// Normalize a path the way the rest of the app expects to see one: forward
/// slashes, no trailing separator. The host spelled it, so the *content* is left
/// alone — only the separators are unified, because every consumer (the tree,
/// the editor, git-status matching) compares forward-slash paths.
fn normalize(path: &str) -> String {
    let out = path.replace('\\', "/");
    let trimmed = out.trim_end_matches('/');
    if trimmed.is_empty() {
        out
    } else {
        trimmed.to_string()
    }
}

/// Join a directory and a child name in the normalized form.
fn join(dir: &str, name: &str) -> String {
    let base = normalize(dir);
    if base.is_empty() {
        name.to_string()
    } else {
        format!("{base}/{name}")
    }
}

/// List a directory on the host.
///
/// Hidden entries are kept: this is a project tree, and `.github`, `.env` and
/// `.gitignore` are exactly the files someone opens a tree to find. Sorting
/// matches the local layer — directories first, then case-insensitive by name —
/// so the same folder does not reorder itself when it happens to live elsewhere.
pub async fn list_dir(sftp: &SftpSession, path: &str) -> Result<Vec<FsEntry>, AppError> {
    let dir = normalize(path);
    let mut entries: Vec<FsEntry> = Vec::new();
    let read = sftp
        .read_dir(&dir)
        .await
        .map_err(|e| AppError::Invalid(format!("could not list {dir} on that host: {e}")))?;
    for item in read {
        let name = item.file_name();
        if name == "." || name == ".." {
            continue;
        }
        // A symlink to a directory is a directory to anyone browsing.
        let is_dir = match item.file_type() {
            FileType::Dir => true,
            FileType::Symlink => sftp
                .metadata(join(&dir, &name))
                .await
                .map(|m| m.is_dir())
                .unwrap_or(false),
            _ => false,
        };
        entries.push(FsEntry {
            path: join(&dir, &name),
            name,
            is_dir,
            // Only git can answer this, and git on a host is its own work.
            ignored: false,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Read a file for the editor, honouring the same guards as the local layer: a
/// file that is not UTF-8 text, or is over the edit cap, comes back flagged
/// rather than truncated or mangled.
pub async fn read_file(sftp: &SftpSession, path: &str) -> Result<FileContent, AppError> {
    let file = normalize(path);
    let size = sftp
        .metadata(&file)
        .await
        .map_err(|e| AppError::Invalid(format!("could not open {file} on that host: {e}")))?
        .size
        .unwrap_or_default();
    if size > MAX_EDIT_BYTES {
        return Ok(FileContent {
            content: String::new(),
            binary: false,
            too_large: true,
        });
    }
    let bytes = sftp
        .read(&file)
        .await
        .map_err(|e| AppError::Invalid(format!("could not read {file} on that host: {e}")))?;
    // NUL is the same "this is not text" signal the local reader uses, so a file
    // opens (or refuses to) identically on either machine.
    if bytes.contains(&0) {
        return Ok(FileContent {
            content: String::new(),
            binary: true,
            too_large: false,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(FileContent {
            content,
            binary: false,
            too_large: false,
        }),
        Err(_) => Ok(FileContent {
            content: String::new(),
            binary: true,
            too_large: false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Against the sshd of this machine: list a directory and read a file back.
    ///
    /// The point of the test is *portability*, not plumbing: SFTP is a subsystem,
    /// so this same code path runs identically on a host whose shell is cmd,
    /// PowerShell, WSL or Git Bash — the thing that broke every other approach.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn sftp_live_lists_and_reads() {
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

        let sftp = open(&conn).await.expect("an SFTP session");

        // A directory this repository is checked out in, so the listing has
        // known contents and the paths can be opened again.
        let here = std::env::current_dir().expect("cwd");
        let dir = here.to_string_lossy().replace('\\', "/");
        let entries = list_dir(&sftp, &dir).await.expect("a listing");
        println!("live: {} entries under {dir}", entries.len());
        assert!(!entries.is_empty(), "a source directory is not empty");
        assert!(
            entries
                .iter()
                .all(|e| e.path.starts_with(&dir) && !e.path.contains('\\')),
            "paths must come back absolute and forward-slashed"
        );
        // Directories sort first, as the local tree does.
        let first_file = entries.iter().position(|e| !e.is_dir);
        let last_dir = entries.iter().rposition(|e| e.is_dir);
        if let (Some(f), Some(d)) = (first_file, last_dir) {
            assert!(d < f, "directories come first");
        }

        // Read something known back and check it is the real content.
        let manifest = format!("{dir}/Cargo.toml");
        let file = read_file(&sftp, &manifest).await.expect("the manifest");
        assert!(
            !file.binary && !file.too_large,
            "a manifest is editable text"
        );
        assert!(
            file.content.contains("uxnan-desktop"),
            "read the actual file, not an empty buffer"
        );
        println!("live: read {} bytes of Cargo.toml", file.content.len());
    }

    #[test]
    fn paths_come_back_forward_slashed() {
        // Every consumer compares forward-slash paths — the tree, the editor and
        // the git-status matching — so a Windows host's own spelling is unified
        // here rather than in each of them.
        assert_eq!(normalize(r"C:\Users\dev\code"), "C:/Users/dev/code");
        assert_eq!(normalize("/home/dev/code/"), "/home/dev/code");
        assert_eq!(join(r"C:\Users\dev", "main.rs"), "C:/Users/dev/main.rs");
        assert_eq!(join("/home/dev/", "main.rs"), "/home/dev/main.rs");
    }

    #[test]
    fn a_root_keeps_its_separator() {
        // Trimming a root to nothing would turn "/" into a relative path.
        assert_eq!(normalize("/"), "/");
    }
}
