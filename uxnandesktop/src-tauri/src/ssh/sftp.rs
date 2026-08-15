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
//!
//! **A session outlives no more than its channel.** An SFTP session is one SSH
//! channel, and a channel can end while its connection lives on: the host's
//! `sftp-server` exits, or the channel is closed under us. From that moment
//! every request on that session answers `session closed` — the session cannot
//! heal, and a cached one turns a working file panel into a permanent error
//! while terminals on the same host (each its own channel) keep working. So
//! failures are classified: [`SftpFailure::Gone`] says *ask again on a new
//! session*, [`SftpFailure::Refused`] is the host's own answer and must be
//! shown as-is. Callers that hold a cached session act on the difference
//! (`commands::with_sftp`).

use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use super::conn::Connection;
use crate::error::AppError;
use crate::fs::{FileContent, FsEntry, MAX_EDIT_BYTES};

/// Why an SFTP call failed, split by what the caller can do about it.
#[derive(Debug)]
pub enum SftpFailure {
    /// The session can no longer carry requests — its transport ended. Nothing
    /// is wrong with the *connection*: a caller holding a cached session should
    /// drop it, open another, and ask once more.
    Gone(String),
    /// The host answered, and the answer was no — no such path, no permission,
    /// a reply we could not read. Asking again on a new session changes nothing,
    /// so this is the user's to see.
    Refused(AppError),
}

impl From<SftpFailure> for AppError {
    /// For callers with nothing to retry with: a session that is gone is still
    /// a failure to report, in the words it failed with.
    fn from(failure: SftpFailure) -> Self {
        match failure {
            SftpFailure::Gone(message) => AppError::Invalid(message),
            SftpFailure::Refused(error) => error,
        }
    }
}

/// Whether a failed request means the *session* is finished rather than the
/// request.
///
/// Two independent facts, because neither alone is enough — both were measured
/// against a real host, not assumed:
///
/// - `usable` is what [`WatchedStream`] saw on the wire. When the host ends the
///   channel, the stream reaches EOF and this is the **only** early signal there
///   is: the request in flight at that moment simply never gets an answer and
///   fails ten seconds later as a plain `Timeout`, which says nothing about a
///   channel. Without this, the first click after a session dies would wait out
///   that timeout and then report the host as slow.
/// - The error still matters once the session has shut itself down, which is not
///   always visible as EOF: `session closed` and `sender dropped` are the
///   library stating outright that it can no longer carry a request, and an
///   `IO` error is its stream failing.
///
/// Everything else is the host's own answer — a status code, a reply that did
/// not parse, or a timeout on a session that is still there (a slow machine
/// asked twice only makes the user wait twice).
fn session_is_gone(usable: bool, error: &SftpError) -> bool {
    !usable || matches!(error, SftpError::UnexpectedBehavior(_) | SftpError::IO(_))
}

/// A host's files: an SFTP session, plus the one fact the library does not
/// expose — whether its transport is still there (see [`session_is_gone`]).
pub struct RemoteFiles {
    session: SftpSession,
    alive: Arc<AtomicBool>,
}

impl RemoteFiles {
    /// Whether this session can still be expected to carry a request. `false` is
    /// certain (the transport ended); `true` is only "nothing has said
    /// otherwise", which is why a failure is classified rather than trusted.
    pub fn usable(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    fn failed(&self, context: &str, error: SftpError) -> SftpFailure {
        let message = format!("{context}: {error}");
        if session_is_gone(self.usable(), &error) {
            SftpFailure::Gone(message)
        } else {
            SftpFailure::Refused(AppError::Invalid(message))
        }
    }

    /// End this session. Only the tests need it — a live one is dropped with the
    /// host's entry, and dropping closes it — but they need it to build the state
    /// this whole module exists for: a connection that works with a file session
    /// that does not.
    #[cfg(test)]
    pub async fn close(&self) {
        let _ = self.session.close().await;
        // We ended it, so there is nothing to observe: record it as the fact it
        // is rather than waiting for the write half to notice.
        self.alive.store(false, Ordering::Relaxed);
    }

    /// Claim a session is fine when it is not — the state a host leaves behind
    /// when it ends a channel between two clicks, which is the case the retry in
    /// `commands::with_sftp` exists for and the only way to reach it on purpose.
    #[cfg(test)]
    pub fn pretend_usable(&self) {
        self.alive.store(true, Ordering::Relaxed);
    }

    /// Delete a file on the host.
    ///
    /// Not a tree operation yet (create/rename/delete from the file tree is still
    /// local-only): its caller is the git layer, which writes a commit message or
    /// a patch to a scratch file and has to take it away again — leaving one
    /// behind would have the next commit read a message nobody wrote.
    pub async fn remove_file(&self, path: &str) -> Result<(), SftpFailure> {
        let file = normalize(path);
        self.session
            .remove_file(file.clone())
            .await
            .map_err(|e| self.failed(&format!("could not remove {file} on that host"), e))
    }

    /// Delete a file, for a test that has to clean up after itself.
    #[cfg(test)]
    async fn remove_for_test(&self, path: &str) -> Result<(), SftpError> {
        self.session.remove_file(normalize(path)).await
    }

    /// Rename, test-only, to hold the protocol fact that `write_file` is built
    /// on: this cannot overwrite an existing path.
    #[cfg(test)]
    async fn rename_for_test(&self, from: &str, to: &str) -> Result<(), SftpError> {
        self.session.rename(normalize(from), normalize(to)).await
    }
}

/// Open an SFTP session on a host's existing connection.
///
/// One channel, like everything else here (§5.3): the connection is already
/// authenticated, so this costs a channel rather than a handshake.
pub async fn open(conn: &Connection) -> Result<RemoteFiles, AppError> {
    let channel = conn
        .handle()
        .channel_open_session()
        .await
        .map_err(|e| AppError::Invalid(format!("could not open a file channel: {e}")))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| AppError::Invalid(format!("this host does not offer SFTP: {e}")))?;
    let alive = Arc::new(AtomicBool::new(true));
    let stream = WatchedStream {
        inner: channel.into_stream(),
        alive: Arc::clone(&alive),
    };
    let session = SftpSession::new(stream)
        .await
        .map_err(|e| AppError::Invalid(format!("the host's SFTP session did not start: {e}")))?;
    Ok(RemoteFiles { session, alive })
}

/// The SFTP stream, with a flag that records the moment it ends.
///
/// The library hands its stream to a background task and never says whether that
/// task is still alive; from outside, a session that died looks exactly like one
/// answering slowly. Watching the stream on the way past costs an atomic store
/// on a path that is already doing I/O, and turns "we waited ten seconds and
/// gave up" into "the channel is gone, open another".
struct WatchedStream<S> {
    inner: S,
    alive: Arc<AtomicBool>,
}

impl<S> WatchedStream<S> {
    fn ended(&self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for WatchedStream<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let had_room = buf.remaining() > 0;
        let before = buf.filled().len();
        let this = self.get_mut();
        let polled = Pin::new(&mut this.inner).poll_read(cx, buf);
        match &polled {
            // Tokio spells EOF as "ready, and nothing was filled in".
            Poll::Ready(Ok(())) if had_room && buf.filled().len() == before => {
                this.alive.store(false, Ordering::Relaxed);
            }
            Poll::Ready(Err(_)) => this.alive.store(false, Ordering::Relaxed),
            _ => {}
        }
        polled
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for WatchedStream<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let polled = Pin::new(&mut this.inner).poll_write(cx, buf);
        if matches!(polled, Poll::Ready(Err(_))) {
            this.ended();
        }
        polled
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let polled = Pin::new(&mut this.inner).poll_flush(cx);
        if matches!(polled, Poll::Ready(Err(_))) {
            this.ended();
        }
        polled
    }

    /// The library shuts the write half down when the session is closing, so
    /// this is that session's last moment either way.
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let polled = Pin::new(&mut this.inner).poll_shutdown(cx);
        if polled.is_ready() {
            this.ended();
        }
        polled
    }
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

/// Undo SFTP's leading slash in front of a Windows drive.
///
/// A Windows host answers `realpath(".")` with `/C:/Users/gamas` — correct
/// inside the protocol, where every path is rooted at `/`, and wrong everywhere
/// else in the app: that string is handed back as a project's path, typed into
/// a terminal and passed to git on that machine, none of which accept it. Found
/// by the live test, which printed it.
fn strip_sftp_drive_root(path: &str) -> String {
    let bytes = path.as_bytes();
    let looks_like_a_drive =
        bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':';
    if looks_like_a_drive {
        path[1..].to_string()
    } else {
        path.to_string()
    }
}

/// Largest file the tree will copy over the connection for a "Duplicate".
///
/// SFTP v3 has no server-side copy, so every byte crosses the link twice. The
/// cap is generous for source files and small enough that a menu item cannot
/// quietly pull a video through someone's uplink.
const MAX_DUPLICATE_BYTES: u64 = 64 * 1024 * 1024;

/// How many "… copy N" names to try before giving up rather than asking the host
/// forever.
const MAX_COPY_ATTEMPTS: u32 = 100;

/// The `n`-th duplicate name for `file_name`: `name copy.ext`, `name copy 2.ext`,
/// … — the local layer's sequence, so the same file duplicated on either machine
/// ends up called the same thing. A leading-dot file (`.env`) has no extension.
fn copy_name(file_name: &str, n: u32) -> String {
    let dot = file_name.rfind('.').filter(|&i| i > 0);
    let (stem, ext) = match dot {
        Some(i) => (&file_name[..i], &file_name[i..]),
        None => (file_name, ""),
    };
    if n <= 1 {
        format!("{stem} copy{ext}")
    } else {
        format!("{stem} copy {n}{ext}")
    }
}

/// The folder a path is in, or `None` when it names a filesystem root — which is
/// what keeps a delete from being aimed at one.
fn parent_of(path: &str) -> Option<String> {
    let normalized = normalize(path);
    let cut = normalized.rfind('/')?;
    if cut == 0 {
        // `/etc` → `/`, a real folder; `/` itself has no parent.
        return (normalized.len() > 1).then(|| "/".to_string());
    }
    let parent = &normalized[..cut];
    // `C:` alone is a drive root, not a folder inside one.
    if parent.len() == 2 && parent.ends_with(':') {
        return None;
    }
    Some(parent.to_string())
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

impl RemoteFiles {
    /// List a directory on the host.
    ///
    /// Hidden entries are kept: this is a project tree, and `.github`, `.env`
    /// and `.gitignore` are exactly the files someone opens a tree to find.
    /// Sorting matches the local layer — directories first, then
    /// case-insensitive by name — so the same folder does not reorder itself
    /// when it happens to live elsewhere.
    pub async fn list_dir(&self, path: &str) -> Result<Vec<FsEntry>, SftpFailure> {
        let dir = normalize(path);
        let mut entries: Vec<FsEntry> = Vec::new();
        let read = self
            .session
            .read_dir(&dir)
            .await
            .map_err(|e| self.failed(&format!("could not list {dir} on that host"), e))?;
        for item in read {
            let name = item.file_name();
            if name == "." || name == ".." {
                continue;
            }
            // A symlink to a directory is a directory to anyone browsing.
            let is_dir = match item.file_type() {
                FileType::Dir => true,
                FileType::Symlink => self
                    .session
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

    /// Save a file on the host, in place.
    ///
    /// **Why in place, when the local writer uses a temp file and a rename.**
    /// Because over SFTP that strategy does not exist. Measured against a real
    /// `sshd`, in this order:
    ///
    /// - `SSH_FXP_RENAME` onto an **existing** path fails (`Status: Failure`).
    ///   That is SFTP v3 behaving as specified, not this server being odd: the
    ///   atomic-overwrite rename is the `posix-rename@openssh.com` extension,
    ///   which the client library does not implement. So "temp file, then
    ///   rename" would fail on every save after the first.
    /// - The fallback — delete the target, then rename — trades a truncated file
    ///   for a *missing* one. That is the worse failure: the editor still holds
    ///   the text after a bad write, and holds nothing after a bad delete.
    /// - A temp file also **loses the destination's permissions and owner**,
    ///   because what survives is the temp's. Writing in place keeps the file
    ///   itself — its mode, its owner, its hard links, whatever a symlink points
    ///   at — which is what the user's host actually cares about.
    ///
    /// So: open with `WRITE | CREATE | TRUNCATE`, write, ask the host to flush,
    /// and then **check the size the host reports**. `TRUNCATE` is not optional —
    /// the library's own `write()` helper opens with `WRITE` alone, which left
    /// `SHORTCONTENT-0123456789` behind when `SHORT` was written over a longer
    /// file. That helper is never used here.
    pub async fn write_file(&self, path: &str, content: &str) -> Result<(), SftpFailure> {
        use russh_sftp::protocol::OpenFlags;
        use tokio::io::AsyncWriteExt;

        let file = normalize(path);
        let bytes = content.as_bytes();
        let mut handle = self
            .session
            .open_with_flags(
                file.clone(),
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| self.failed(&format!("could not open {file} on that host"), e))?;

        if let Err(e) = handle.write_all(bytes).await {
            // Say what state the file is in. It was truncated to open it, so a
            // failure here is not "nothing happened" and must not read like it.
            let _ = handle.close().await;
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "{file} was opened for writing on that host but the write failed \
                 partway ({e}); the file there is incomplete"
            ))));
        }
        // Best effort: `fsync@openssh.com` is an extension, and a host without it
        // is not a reason to fail a save the host has already accepted.
        let _ = handle.sync_all().await;
        if let Err(e) = handle.close().await {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "the host did not finish writing {file}: {e}"
            ))));
        }

        // Ask the host what it ended up with. A save that silently stored fewer
        // bytes than it was given is the one failure the editor cannot notice on
        // its own — it would keep showing text the host does not have.
        let stored = self
            .session
            .metadata(file.clone())
            .await
            .map_err(|e| self.failed(&format!("could not confirm {file} on that host"), e))?
            .size
            .unwrap_or_default();
        if stored != bytes.len() as u64 {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "{file} came back as {stored} bytes on that host, not the {} that were sent",
                bytes.len()
            ))));
        }
        Ok(())
    }

    /// Create an empty file at `rel` inside `dir`, answering its path.
    ///
    /// `rel` may be an intercalated path (`sub/dir/leaf.ts`), the same as the
    /// local tree's: the parent segments are created as folders. The names are
    /// validated by the **local** validator (`crate::fs::split_new_entry_path`),
    /// not a second one written here — a path that cannot escape its folder is
    /// exactly as important on someone else's machine, and two validators is two
    /// chances to disagree about `..`.
    ///
    /// `EXCLUDE` is SFTP's own "fail if it exists", so the *server* decides,
    /// atomically. Checking first and creating after would be a race we would
    /// lose to the agent working in that folder — which is the entire reason
    /// somebody has this tree open.
    pub async fn create_file(&self, dir: &str, rel: &str) -> Result<String, SftpFailure> {
        use russh_sftp::protocol::OpenFlags;

        let (parent, leaf) = self.prepare_new_entry(dir, rel).await?;
        let target = join(&parent, leaf);
        let handle = self
            .session
            .open_with_flags(
                target.clone(),
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
            )
            .await
            .map_err(|e| self.failed(&format!("could not create {target} on that host"), e))?;
        if let Err(e) = handle.close().await {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "the host did not finish creating {target}: {e}"
            ))));
        }
        Ok(target)
    }

    /// Create a folder at `rel` inside `dir` (intercalated parents included).
    pub async fn create_dir(&self, dir: &str, rel: &str) -> Result<String, SftpFailure> {
        let (parent, leaf) = self.prepare_new_entry(dir, rel).await?;
        let target = join(&parent, leaf);
        // The leaf is the one segment that must not already exist: `mkdir` fails
        // on the server when it does, which is the answer we want.
        self.session
            .create_dir(target.clone())
            .await
            .map_err(|e| self.failed(&format!("could not create {target} on that host"), e))?;
        Ok(target)
    }

    /// Validate `rel`, make sure `dir` is a directory on the host, create the
    /// intermediate folders, and answer `(parent, leaf)`.
    async fn prepare_new_entry<'a>(
        &self,
        dir: &str,
        rel: &'a str,
    ) -> Result<(String, &'a str), SftpFailure> {
        let segments = crate::fs::split_new_entry_path(rel).map_err(SftpFailure::Refused)?;
        let base = normalize(dir);
        let meta = self
            .session
            .metadata(base.clone())
            .await
            .map_err(|e| self.failed(&format!("{base} is not there on that host"), e))?;
        if !meta.is_dir() {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "{base} is not a folder on that host"
            ))));
        }
        let (leaf, parents) = segments.split_last().expect("at least one segment");
        let mut parent = base;
        for segment in parents {
            parent = join(&parent, segment);
            // Already there is fine for an intermediate folder — the point of an
            // intercalated path is to fill in what is missing, not to insist that
            // nothing exists.
            if !self.exists(&parent).await? {
                self.session.create_dir(parent.clone()).await.map_err(|e| {
                    self.failed(&format!("could not create {parent} on that host"), e)
                })?;
            }
        }
        Ok((parent, leaf))
    }

    /// Rename an entry within its folder, answering the new path.
    ///
    /// **SFTP v3 cannot rename onto an existing path** (the atomic-overwrite
    /// rename is an OpenSSH extension this client does not implement — the same
    /// protocol fact that made saving write in place). That matches what the
    /// local layer wants anyway: refuse to clobber a sibling. The one case it
    /// costs us is a rename that only changes case on a host whose filesystem
    /// ignores case, where the old and new path are the *same* file — so that
    /// one is done in two steps, through a name nothing else uses, and only
    /// after the direct attempt has failed.
    pub async fn rename(&self, path: &str, new_name: &str) -> Result<String, SftpFailure> {
        let source = normalize(path);
        let name = crate::fs::validate_bare_name(new_name).map_err(SftpFailure::Refused)?;
        let parent = parent_of(&source).ok_or_else(|| {
            SftpFailure::Refused(AppError::Invalid(format!("{source} has no parent folder")))
        })?;
        let target = join(&parent, name);
        if target == source {
            return Ok(target);
        }
        let case_only = target.eq_ignore_ascii_case(&source);
        // Only for a genuinely different name: on a case-only rename the target
        // *is* the source on a case-insensitive host, so this would refuse it.
        if !case_only && self.exists(&target).await? {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "\"{name}\" already exists in this folder on that host"
            ))));
        }
        match self.session.rename(source.clone(), target.clone()).await {
            Ok(()) => Ok(target),
            Err(direct) if case_only => {
                // A case-insensitive host refused it because the two names are
                // one file. Go through a third name; if the second step fails
                // the entry keeps that name, so it is one nothing collides with
                // and it is reported rather than left silent.
                let scratch = format!("{target}.uxnan-rename");
                self.session
                    .rename(source.clone(), scratch.clone())
                    .await
                    .map_err(|_| {
                        self.failed(&format!("could not rename {source} on that host"), direct)
                    })?;
                self.session
                    .rename(scratch.clone(), target.clone())
                    .await
                    .map_err(|e| {
                        self.failed(
                            &format!("{source} is now called {scratch} on that host — the rename could not be finished"),
                            e,
                        )
                    })?;
                Ok(target)
            }
            Err(e) => Err(self.failed(&format!("could not rename {source} on that host"), e)),
        }
    }

    /// Delete a file or folder on the host — **permanently**.
    ///
    /// There is no trash here. The local tree moves an entry to the Recycle Bin
    /// (recoverable by design); SSH offers no such thing, and inventing one — a
    /// hidden `.uxnan-trash` on someone else's machine — would be a folder we
    /// create, never empty, and never mention. So this unlinks, and the dialog
    /// that calls it says which of the two it is about to do.
    ///
    /// A folder is walked depth-first, because SFTP's `rmdir` only removes an
    /// empty one. Symlinked directories are unlinked, never descended into: the
    /// listing distinguishes them, and following one would delete whatever it
    /// points at somewhere else entirely.
    pub async fn delete(&self, path: &str) -> Result<(), SftpFailure> {
        let target = normalize(path);
        if parent_of(&target).is_none() {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "refusing to delete {target}, which is the root of that host's filesystem"
            ))));
        }
        // `symlink_metadata` rather than `metadata`: a symlink to a directory
        // must be removed as the link it is.
        let meta = self
            .session
            .symlink_metadata(target.clone())
            .await
            .map_err(|e| self.failed(&format!("{target} is not there on that host"), e))?;
        if meta.is_dir() {
            self.delete_dir(&target).await
        } else {
            self.session
                .remove_file(target.clone())
                .await
                .map_err(|e| self.failed(&format!("could not delete {target} on that host"), e))
        }
    }

    /// Empty a folder and remove it. Iterative rather than recursive: an `async
    /// fn` that calls itself needs boxing, and a deep tree would grow the stack
    /// for no reason.
    async fn delete_dir(&self, root: &str) -> Result<(), SftpFailure> {
        // Every folder found, deepest last, so they can be removed in reverse.
        let mut folders = vec![root.to_string()];
        let mut queue = vec![root.to_string()];
        while let Some(dir) = queue.pop() {
            let entries = self
                .session
                .read_dir(dir.clone())
                .await
                .map_err(|e| self.failed(&format!("could not read {dir} on that host"), e))?;
            for entry in entries {
                let child = join(&dir, entry.file_name().as_str());
                // A symlink is removed as a file whatever it points at.
                if entry.file_type().is_dir() {
                    folders.push(child.clone());
                    queue.push(child);
                } else {
                    self.session.remove_file(child.clone()).await.map_err(|e| {
                        self.failed(&format!("could not delete {child} on that host"), e)
                    })?;
                }
            }
        }
        for dir in folders.iter().rev() {
            self.session.remove_dir(dir.clone()).await.map_err(|e| {
                self.failed(
                    &format!("could not delete the folder {dir} on that host"),
                    e,
                )
            })?;
        }
        Ok(())
    }

    /// Copy a file next to itself under a free "… copy" name, answering it.
    ///
    /// Bytes, not text: the local layer copies the file whatever is in it, and a
    /// duplicate that mangled a PNG into replacement characters would be worse
    /// than no duplicate at all. The whole file goes through this machine (SFTP
    /// has no server-side copy in v3), so it is capped — a host is reached over
    /// a link the user may be paying for, and silently pulling a gigabyte
    /// through it is not a menu item's business.
    pub async fn duplicate(&self, path: &str) -> Result<String, SftpFailure> {
        use russh_sftp::protocol::OpenFlags;
        use tokio::io::AsyncWriteExt;

        let source = normalize(path);
        let meta = self
            .session
            .metadata(source.clone())
            .await
            .map_err(|e| self.failed(&format!("{source} is not there on that host"), e))?;
        if meta.is_dir() {
            return Err(SftpFailure::Refused(AppError::Invalid(
                "duplicating a folder on a host is not supported".to_string(),
            )));
        }
        if meta.size.unwrap_or(0) > MAX_DUPLICATE_BYTES {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "{source} is larger than {} MB, so it is not copied over the connection",
                MAX_DUPLICATE_BYTES / (1024 * 1024)
            ))));
        }
        let parent = parent_of(&source).ok_or_else(|| {
            SftpFailure::Refused(AppError::Invalid(format!("{source} has no parent folder")))
        })?;
        let name = source.rsplit('/').next().unwrap_or(&source);

        // The free name is found by asking the host, one candidate at a time —
        // the same sequence the local layer produces, so a folder that is
        // duplicated on both machines ends up with the same names.
        let mut candidate = String::new();
        for n in 1..=MAX_COPY_ATTEMPTS {
            candidate = join(&parent, &copy_name(name, n));
            if !self.exists(&candidate).await? {
                break;
            }
            if n == MAX_COPY_ATTEMPTS {
                return Err(SftpFailure::Refused(AppError::Invalid(format!(
                    "there are already {MAX_COPY_ATTEMPTS} copies of {name} in that folder"
                ))));
            }
        }

        let bytes = self
            .session
            .read(source.clone())
            .await
            .map_err(|e| self.failed(&format!("could not read {source} on that host"), e))?;
        let mut handle = self
            .session
            .open_with_flags(
                candidate.clone(),
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
            )
            .await
            .map_err(|e| self.failed(&format!("could not create {candidate} on that host"), e))?;
        if let Err(e) = handle.write_all(&bytes).await {
            let _ = handle.close().await;
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "{candidate} was created on that host but the copy failed partway                  ({e}); the file there is incomplete"
            ))));
        }
        if let Err(e) = handle.close().await {
            return Err(SftpFailure::Refused(AppError::Invalid(format!(
                "the host did not finish writing {candidate}: {e}"
            ))));
        }
        Ok(candidate)
    }

    /// The user's home directory on the host, in the app's forward-slash form.
    ///
    /// Asked of SFTP, not of a shell: `realpath(".")` on a freshly opened
    /// session is where that user lands, which is the same answer `echo $HOME` /
    /// `%USERPROFILE%` gives without needing to know which of the two to ask.
    pub async fn home(&self) -> Result<String, SftpFailure> {
        self.session
            .canonicalize(".")
            .await
            .map(|p| strip_sftp_drive_root(&normalize(&p)))
            .map_err(|e| self.failed("could not ask that host where its home is", e))
    }

    /// Whether a path exists on the host, of any kind.
    ///
    /// Deliberately not "is a directory": the one caller is the "is this folder a
    /// repository?" check, and a worktree's `.git` is a **file**, not a folder.
    pub async fn exists(&self, path: &str) -> Result<bool, SftpFailure> {
        let target = normalize(path);
        self.session
            .try_exists(target.clone())
            .await
            .map_err(|e| self.failed(&format!("could not look at {target} on that host"), e))
    }

    /// Read a file for the editor, honouring the same guards as the local layer:
    /// a file that is not UTF-8 text, or is over the edit cap, comes back
    /// flagged rather than truncated or mangled.
    pub async fn read_file(&self, path: &str) -> Result<FileContent, SftpFailure> {
        let file = normalize(path);
        let size = self
            .session
            .metadata(&file)
            .await
            .map_err(|e| self.failed(&format!("could not open {file} on that host"), e))?
            .size
            .unwrap_or_default();
        if size > MAX_EDIT_BYTES {
            return Ok(FileContent {
                content: String::new(),
                binary: false,
                too_large: true,
            });
        }
        let bytes = self
            .session
            .read(&file)
            .await
            .map_err(|e| self.failed(&format!("could not read {file} on that host"), e))?;
        // NUL is the same "this is not text" signal the local reader uses, so a
        // file opens (or refuses to) identically on either machine.
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
        let entries = sftp.list_dir(&dir).await.expect("a listing");
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
        let file = sftp.read_file(&manifest).await.expect("the manifest");
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

    /// Saving on a host, against a real `sshd` — including the two things that
    /// decided how [`RemoteFiles::write_file`] is built.
    ///
    /// Shortening a file is the case that matters: an in-place write without
    /// `TRUNCATE` leaves the old tail behind, and the editor would show text the
    /// host does not have. And the "atomic" alternative every local writer uses
    /// is shown here to be unavailable, not merely unattractive.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn sftp_live_writes_and_shortens_a_file() {
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
        let files = open(&conn).await.expect("an SFTP session");

        let dir = normalize(&std::env::temp_dir().to_string_lossy());
        let path = format!("{dir}/uxnan-write-live.txt");
        let _ = files.remove_for_test(&path).await;

        // A file that does not exist yet is created, not refused.
        let long = "LONG CONTENT — accents, ñ and a tail 0123456789";
        files.write_file(&path, long).await.expect("the first save");
        assert_eq!(files.read_file(&path).await.unwrap().content, long);

        // The one that would silently corrupt: a shorter body over a longer file.
        let short = "SHORT";
        files.write_file(&path, short).await.expect("a second save");
        let after = files.read_file(&path).await.unwrap().content;
        assert_eq!(after, short, "no tail of the previous content may survive");

        // Empty is a legitimate document, not a no-op.
        files.write_file(&path, "").await.expect("saving empty");
        assert_eq!(files.read_file(&path).await.unwrap().content, "");

        // And the reason none of this goes through a temp file: renaming onto a
        // path that exists is refused by the protocol, so the local writer's
        // strategy cannot be copied here.
        let other = format!("{dir}/uxnan-write-live-2.txt");
        files.write_file(&other, "other").await.expect("a sibling");
        let refused = files.rename_for_test(&other, &path).await;
        assert!(
            refused.is_err(),
            "SFTP v3 rename cannot overwrite; if this ever succeeds, revisit write_file"
        );
        println!("live: rename onto an existing path was refused with {refused:?}");

        let _ = files.remove_for_test(&path).await;
        let _ = files.remove_for_test(&other).await;
    }

    /// The failure the user hit: the panel wedged on `session closed` while the
    /// host's terminals kept working, because a dead session stayed cached.
    ///
    /// Against a real host, because the first version of this fix was written
    /// from *reading* the library and was wrong: a session that has just ended
    /// does not answer `session closed` at all, it answers nothing and times out
    /// ten seconds later. Only running it said so.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn sftp_live_reports_a_dead_session_as_gone() {
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

        let here = std::env::current_dir().expect("cwd");
        let dir = here.to_string_lossy().replace('\\', "/");

        let sftp = open(&conn).await.expect("an SFTP session");
        sftp.list_dir(&dir).await.expect("the first listing works");
        assert!(sftp.usable(), "a session in use is not dead");

        // End it, and the app knows without having to ask the wire.
        sftp.close().await;
        assert!(!sftp.usable(), "a session that ended is not usable");

        match sftp.list_dir(&dir).await {
            Err(SftpFailure::Gone(message)) => println!("live: classified as gone — {message}"),
            Err(SftpFailure::Refused(e)) => {
                panic!("a dead session must not read as the host's answer: {e}")
            }
            Ok(_) => panic!("a closed session cannot list anything"),
        }

        // And the connection is untouched: a new session works, which is exactly
        // what the recovery does and why it is worth doing.
        let fresh = open(&conn)
            .await
            .expect("the connection still opens channels");
        assert!(
            !fresh.list_dir(&dir).await.expect("a listing").is_empty(),
            "a fresh session on the same connection lists again"
        );
    }

    #[test]
    fn a_timeout_means_a_slow_host_only_while_the_transport_is_there() {
        // The measured case: when a session dies, the request in flight is not
        // answered and comes back as a timeout — which on its own reads as "the
        // host is slow" and would leave the panel broken for good.
        assert!(session_is_gone(false, &SftpError::Timeout));
        assert!(!session_is_gone(true, &SftpError::Timeout));
    }

    #[test]
    fn what_the_host_answered_is_never_second_guessed() {
        // A reply is a reply: asking a second time on a new session can only
        // produce the same no, one round trip later.
        assert!(!session_is_gone(true, &SftpError::UnexpectedPacket));
        assert!(!session_is_gone(
            true,
            &SftpError::Limited("packet exceeds server limit".into())
        ));
        // While the library saying it cannot carry a request is not an answer.
        assert!(session_is_gone(
            true,
            &SftpError::UnexpectedBehavior("session closed".into())
        ));
        assert!(session_is_gone(true, &SftpError::IO("broken pipe".into())));
    }

    #[tokio::test]
    async fn a_stream_that_ends_is_noticed_at_once() {
        // What happens when the host ends the channel: the stream reaches EOF,
        // and that is the only warning there is before requests start timing
        // out. Driven over a pipe, so it is the wrapper being tested and not a
        // host's manners.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (ours, theirs) = tokio::io::duplex(64);
        let alive = Arc::new(AtomicBool::new(true));
        let mut stream = WatchedStream {
            inner: ours,
            alive: Arc::clone(&alive),
        };

        let mut theirs = theirs;
        theirs.write_all(b"hello").await.unwrap();
        let mut buf = [0u8; 5];
        stream.read_exact(&mut buf).await.unwrap();
        assert!(alive.load(Ordering::Relaxed), "reading is not dying");

        drop(theirs);
        assert_eq!(stream.read(&mut buf).await.unwrap(), 0, "the peer is gone");
        assert!(
            !alive.load(Ordering::Relaxed),
            "EOF is the end of this session"
        );
    }

    #[tokio::test]
    async fn a_session_we_shut_down_is_over_too() {
        // The library shuts the write half down when a session closes, so that
        // is the same ending seen from the other side.
        use tokio::io::AsyncWriteExt;

        let (ours, theirs) = tokio::io::duplex(64);
        let alive = Arc::new(AtomicBool::new(true));
        let mut stream = WatchedStream {
            inner: ours,
            alive: Arc::clone(&alive),
        };
        drop(theirs);

        stream.shutdown().await.unwrap();
        assert!(!alive.load(Ordering::Relaxed));
    }

    #[test]
    fn a_failure_keeps_its_words_when_there_is_nothing_to_retry_with() {
        // The path that reaches the user when recovery has already been tried:
        // it must still say what went wrong, not lose the message in a cast.
        let AppError::Invalid(message) = AppError::from(SftpFailure::Gone(
            "could not list /tmp: session closed".into(),
        )) else {
            panic!("a gone session reports as an invalid-input error");
        };
        assert!(message.contains("session closed"), "{message}");
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
    fn a_windows_home_loses_the_protocol_slash() {
        // SFTP roots everything at `/`, so a Windows host answers `/C:/Users/x`.
        // Handed on as a project path it would be typed into that machine's
        // terminal and given to its git, and neither accepts it.
        assert_eq!(strip_sftp_drive_root("/C:/Users/gamas"), "C:/Users/gamas");
        assert_eq!(strip_sftp_drive_root("/D:/work"), "D:/work");
    }

    #[test]
    fn a_posix_home_is_left_exactly_as_it_is() {
        // The leading slash *is* the path there — stripping it would turn an
        // absolute path into a relative one.
        assert_eq!(strip_sftp_drive_root("/home/dev"), "/home/dev");
        assert_eq!(strip_sftp_drive_root("/"), "/");
        // And a folder whose name merely starts with a letter is not a drive.
        assert_eq!(strip_sftp_drive_root("/c/code"), "/c/code");
    }

    #[test]
    fn a_root_keeps_its_separator() {
        // Trimming a root to nothing would turn "/" into a relative path.
        assert_eq!(normalize("/"), "/");
    }
}
