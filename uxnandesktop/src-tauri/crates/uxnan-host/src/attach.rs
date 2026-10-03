//! `uxnan-host attach`: the desktop's way in.
//!
//! The desktop runs this over an SSH `exec` channel. It joins that channel's
//! stdin/stdout to the daemon's local channel byte for byte — the frames are
//! the daemon's business, not this process's — starting the daemon first when
//! none is running. It prints [`READY_LINE`] once joined, because a login shell
//! may have printed anything before it: a banner, a profile's echo, a warning.
//!
//! The daemon it starts is detached: when this channel ends, this process
//! ends, and the daemon with its terminals does not. On Unix that is
//! `serve --detached` leaving the session (`setsid`); on Windows the daemon is
//! created out of the SSH session's job — Win32-OpenSSH ends every process in
//! a session's job when the session closes, unless it was created to break
//! away from it.
//!
//! The daemon's channel is a Unix socket in a folder only the user can open,
//! or on Windows a named pipe whose access list names the user alone.

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use uxnan_host_protocol::{PROTOCOL, READY_LINE};

use crate::paths;

/// How long to wait for a daemon this call started to begin listening.
const START_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

pub async fn attach() -> std::io::Result<()> {
    // This build is in use for as long as the connection lasts.
    let _in_use = crate::versions::hold();
    crate::agent_socket::follow_this_connection();
    let stream = match connect().await {
        Ok(stream) => stream,
        Err(_) => {
            start_daemon()?;
            wait_for().await?
        }
    };
    join(stream).await
}

/// Print the ready line, then copy both ways until either side ends.
async fn join<S: AsyncRead + AsyncWrite>(stream: S) -> std::io::Result<()> {
    let mut stdout = tokio::io::stdout();
    stdout
        .write_all(format!("{READY_LINE} {PROTOCOL}\n").as_bytes())
        .await?;
    stdout.flush().await?;

    let (mut from_daemon, mut to_daemon) = tokio::io::split(stream);
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

/// Wait for a daemon this call started to begin listening.
async fn wait_for() -> std::io::Result<Channel> {
    let deadline = tokio::time::Instant::now() + START_WAIT;
    loop {
        match connect().await {
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

#[cfg(unix)]
type Channel = tokio::net::UnixStream;

#[cfg(unix)]
async fn connect() -> std::io::Result<Channel> {
    tokio::net::UnixStream::connect(paths::socket()).await
}

#[cfg(unix)]
fn start_daemon() -> std::io::Result<()> {
    use std::process::{Command, Stdio};
    paths::ensure_private_dir(&paths::home())?;
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

#[cfg(windows)]
type Channel = tokio::net::windows::named_pipe::NamedPipeClient;

#[cfg(windows)]
async fn connect() -> std::io::Result<Channel> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;
    let name = paths::pipe_name();
    loop {
        match ClientOptions::new().open(&name) {
            Ok(client) => return Ok(client),
            // Every instance is serving someone this instant; the daemon
            // makes a new one as it accepts.
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(windows)]
fn start_daemon() -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use windows_sys::Win32::System::Threading::{
        CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS,
    };
    paths::ensure_private_dir(&paths::home())?;
    paths::ensure_private_dir(&paths::run_dir())?;
    let exe = std::env::current_exe()?;
    let spawn = |flags: u32| {
        Command::new(&exe)
            .args(["serve", "--detached"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(flags)
            .spawn()
    };
    let detached = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    match spawn(detached | CREATE_BREAKAWAY_FROM_JOB) {
        Ok(_) => Ok(()),
        // A job that does not allow breaking away: the daemon still starts,
        // and lives as long as this session — the log says so.
        Err(_) => {
            crate::log::line("could not leave the SSH session's job; this daemon ends with it");
            spawn(detached).map(|_| ())
        }
    }
}
