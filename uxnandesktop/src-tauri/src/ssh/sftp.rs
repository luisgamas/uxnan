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
    fn a_root_keeps_its_separator() {
        // Trimming a root to nothing would turn "/" into a relative path.
        assert_eq!(normalize("/"), "/");
    }
}
