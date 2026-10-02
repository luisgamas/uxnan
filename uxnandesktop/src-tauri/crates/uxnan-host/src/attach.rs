//! `uxnan-host attach`: the desktop's way in.
//!
//! The desktop runs this over an SSH `exec` channel. It joins that channel's
//! stdin/stdout to the daemon's socket byte for byte — the frames are the
//! daemon's business, not this process's — starting the daemon first when none
//! is running. It prints [`READY_LINE`] once joined, because a login shell may
//! have printed anything before it: a banner, a profile's echo, a warning.
//!
//! The daemon it starts is detached (`serve --detached`): when this channel
//! ends, this process ends, and the daemon with its terminals does not.

#[cfg(unix)]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(unix)]
use uxnan_host_protocol::PROTOCOL;
#[allow(unused_imports)] // named in the module docs on every platform
use uxnan_host_protocol::READY_LINE;

#[cfg(unix)]
use crate::paths;

/// How long to wait for a daemon this call started to begin listening.
#[cfg(unix)]
const START_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(unix)]
pub async fn attach() -> std::io::Result<()> {
    let path = paths::socket();
    let stream = match tokio::net::UnixStream::connect(&path).await {
        Ok(stream) => stream,
        Err(_) => {
            start_daemon()?;
            wait_for(&path).await?
        }
    };

    let mut stdout = tokio::io::stdout();
    stdout
        .write_all(format!("{READY_LINE} {PROTOCOL}\n").as_bytes())
        .await?;
    stdout.flush().await?;

    let (mut from_daemon, mut to_daemon) = stream.into_split();
    let mut stdin = tokio::io::stdin();
    let upstream = async {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = stdin.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            to_daemon.write_all(&buf[..n]).await?;
        }
        to_daemon.shutdown().await
    };
    let downstream = async {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = from_daemon.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            // Flushed every time: the other end is a person waiting for a
            // keystroke's echo, not a file.
            stdout.write_all(&buf[..n]).await?;
            stdout.flush().await?;
        }
        Ok::<(), std::io::Error>(())
    };
    tokio::select! {
        r = upstream => r,
        r = downstream => r,
    }
}

#[cfg(not(unix))]
pub async fn attach() -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "this build of uxnan-host does not serve Windows hosts yet",
    ))
}

#[cfg(unix)]
fn start_daemon() -> std::io::Result<()> {
    use std::process::{Command, Stdio};
    paths::ensure_private_dir(&paths::run_dir())?;
    let exe = std::env::current_exe()?;
    Command::new(exe)
        .args(["serve", "--detached"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

#[cfg(unix)]
async fn wait_for(path: &std::path::Path) -> std::io::Result<tokio::net::UnixStream> {
    let deadline = tokio::time::Instant::now() + START_WAIT;
    loop {
        match tokio::net::UnixStream::connect(path).await {
            Ok(stream) => return Ok(stream),
            Err(e) if tokio::time::Instant::now() >= deadline => {
                return Err(std::io::Error::new(
                    e.kind(),
                    format!(
                        "the daemon did not start listening within {}s (see {})",
                        START_WAIT.as_secs(),
                        paths::log().display()
                    ),
                ))
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(50)).await,
        }
    }
}
