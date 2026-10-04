//! The system's own `ssh` as a connection's carrier (`02g` §5.20).
//!
//! The built-in client (`conn.rs`, russh) reproduces what most configurations
//! ask for — keys, agents, passwords, second factors, bastions, a
//! `ProxyCommand` — and reports every step of it to the interface. Some
//! configurations it cannot reproduce at all: Kerberos (`GSSAPIAuthentication`),
//! FIDO2 security keys (`sk-*` keys, a `SecurityKeyProvider`), smartcards
//! (`PKCS11Provider`), host-based authentication, a `ProxyUseFdpass` proxy, a
//! `KnownHostsCommand`. For those, the machine's own OpenSSH client does the
//! connecting, exactly as `ssh <host>` would in a terminal, and this module
//! carries the same channels over it:
//!
//! - **One login, many channels.** Where the platform has OpenSSH connection
//!   sharing (macOS, Linux), a master (`ssh -M -S <socket> -N`) logs in once
//!   and every channel is a client of it (`ssh -S <socket> …`) — a command,
//!   the engine's stream, SFTP (`-s sftp`, so nothing is lost: the engine is
//!   uploaded the same way), a TCP stream (`-W`, for forwarded ports and the
//!   host's bridge). Windows' OpenSSH has no connection sharing, so there each
//!   channel is its own `ssh`, and its own login.
//! - **Never a prompt it cannot show.** Every invocation runs with
//!   `BatchMode=yes`: a host that wants a password, a passphrase or a host key
//!   decision this app was not asked to make fails with OpenSSH's own sentence
//!   instead of hanging on a terminal nobody sees. What needs no prompt — a
//!   Kerberos ticket, a security key's touch, an agent — just works.
//! - **The user's configuration, untouched.** The host is named the way the
//!   user would name it (the alias, or the flags a typed host stands for), so
//!   `~/.ssh/config`, `known_hosts`, the agent and every option OpenSSH knows
//!   apply as they do in a terminal. Host keys are OpenSSH's to check.

use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::config::ResolvedHost;
use super::conn::{CommandOutput, Endpoint, TcpRefusal, TcpRefusalKind, Unreachable};
use crate::error::AppError;

/// How long the system `ssh` may take to log in: long enough to touch a
/// security key or wait on a slow Kerberos KDC, short enough that a host that
/// will never answer is not waited on forever.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(90);

/// How long one command may take — the same bound the built-in client keeps.
const EXEC_TIMEOUT: Duration = Duration::from_secs(60);

/// The most of a client's stderr kept for the sentence a failure shows.
const STDERR_CAP: usize = 8 * 1024;

/// Why a host is carried by the system `ssh`, and whether logging in there
/// needs the person — a security key waits for a touch.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNeed {
    /// What asks for it, as the interface words it: `kerberos`, `smartcard`,
    /// `securityKeyProvider`, `hostbased`, `fdpass`, `knownHostsCommand`,
    /// `securityKey` (with `file`), or `chosen` — the person picked it.
    pub code: &'static str,
    /// The key file, for `securityKey`.
    pub file: Option<String>,
    #[serde(skip)]
    pub needs_presence: bool,
}

impl SystemNeed {
    fn quiet(code: &'static str) -> Self {
        Self {
            code,
            file: None,
            needs_presence: false,
        }
    }

    fn present(code: &'static str) -> Self {
        Self {
            needs_presence: true,
            ..Self::quiet(code)
        }
    }

    /// The reason in a sentence, for the log.
    pub fn sentence(&self) -> String {
        match self.code {
            "kerberos" => "it signs in with Kerberos (GSSAPIAuthentication)".to_string(),
            "smartcard" => "its key is on a smartcard (PKCS11Provider)".to_string(),
            "securityKeyProvider" => {
                "its key is on a security key (SecurityKeyProvider)".to_string()
            }
            "hostbased" => "it signs in host-based (HostbasedAuthentication)".to_string(),
            "fdpass" => "its ProxyCommand passes a socket (ProxyUseFdpass)".to_string(),
            "knownHostsCommand" => "its host keys come from a KnownHostsCommand".to_string(),
            "securityKey" => format!(
                "its key {} is a FIDO2 security key",
                self.file.as_deref().unwrap_or("")
            ),
            _ => "it is set to connect with the system ssh".to_string(),
        }
    }
}

/// Why the built-in client cannot carry `resolved` — and the system `ssh`
/// must — or `None` when it can.
pub fn needs_system(resolved: &ResolvedHost) -> Option<SystemNeed> {
    if resolved.gssapi_authentication {
        return Some(SystemNeed::quiet("kerberos"));
    }
    if resolved.pkcs11_provider.is_some() {
        return Some(SystemNeed::present("smartcard"));
    }
    if resolved.security_key_provider.is_some() {
        return Some(SystemNeed::present("securityKeyProvider"));
    }
    if resolved.hostbased_authentication {
        return Some(SystemNeed::quiet("hostbased"));
    }
    if resolved.proxy_use_fdpass {
        return Some(SystemNeed::quiet("fdpass"));
    }
    if resolved.known_hosts_command.is_some() {
        return Some(SystemNeed::quiet("knownHostsCommand"));
    }
    resolved
        .identity_files
        .iter()
        .find(|f| is_security_key(&super::auth::expand_path(f)))
        .map(|file| SystemNeed {
            file: Some(file.clone()),
            ..SystemNeed::present("securityKey")
        })
}

/// Whether the system `ssh` carries `host`, and why — what the person pinned
/// on its page, or else what its route's configuration asks for. `None` is
/// the built-in client.
pub fn carrier_for(host: &crate::model::SshHost, route: &super::dial::Route) -> Option<SystemNeed> {
    use crate::model::SshCarrier;
    let asked = || {
        route
            .hops
            .iter()
            .find_map(|hop| needs_system(&hop.resolved))
    };
    match host.carrier {
        SshCarrier::Builtin => None,
        SshCarrier::Auto => asked(),
        SshCarrier::System => Some(
            asked()
                .unwrap_or_else(|| SystemNeed::quiet("it is set to connect with the system ssh")),
        ),
    }
}

/// What follows `ssh` to name `host` the way the person would: its alias, or
/// for a host typed by hand the flags it stands for and then its name.
pub fn destination_for(host: &crate::model::SshHost) -> Result<Vec<String>, AppError> {
    use crate::model::SshHostSource;
    if let (SshHostSource::SshConfig, Some(alias)) = (&host.source, &host.config_host) {
        let alias = alias.trim();
        if alias.is_empty() || alias.starts_with('-') || alias.contains(char::is_whitespace) {
            return Err(AppError::Invalid(format!("invalid ssh alias: {alias}")));
        }
        return Ok(vec![alias.to_string()]);
    }
    super::config::typed_args(&super::config::TypedHost {
        hostname: &host.hostname,
        port: host.port,
        user: &host.user,
        identity_files: &host.identity_files,
        proxy_jump: host.proxy_jump.as_deref(),
        proxy_command: host.proxy_command.as_deref(),
        forward_agent: host.forward_agent,
    })
}

/// Whether the identity at `path` exists and is a FIDO2 (`sk-`) key — by its
/// public half, or by the name OpenSSH gives one (`id_ed25519_sk`). `ssh -G`
/// lists the default `_sk` names whether or not they exist, so a file that is
/// not there says nothing.
fn is_security_key(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let public = PathBuf::from(format!("{}.pub", path.display()));
    if let Ok(text) = std::fs::read_to_string(&public) {
        return text.trim_start().starts_with("sk-");
    }
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with("_sk"))
}

/// How a dial over the system `ssh` ended.
pub enum Dialled {
    Ready(SystemSsh),
    /// The machine could not be reached, as the built-in client would say it.
    Unreachable {
        why: Unreachable,
        detail: String,
    },
    /// It was reached and OpenSSH stopped: a key it does not know, a login it
    /// refused, a prompt it was not allowed to show. `detail` is its sentence.
    Refused {
        detail: String,
    },
}

/// A host reached through the system `ssh`.
pub struct SystemSsh {
    /// Why the system `ssh` carries this host.
    need: Option<SystemNeed>,
    /// What follows `ssh` to name the host: the alias, or a typed host's flags
    /// and then its name. The name is always last.
    destination: Vec<String>,
    /// The master's control socket, where the platform shares connections.
    socket: Option<PathBuf>,
    /// Set when the master has ended — the connection is gone.
    closed: Arc<AtomicBool>,
    /// What the master has written lately. Through a shared connection a
    /// channel's own `ssh` only says "refused by peer"; the master says why.
    master_said: Option<Arc<Mutex<String>>>,
    /// The `ssh` processes carrying this connection's open channels. Without a
    /// master (Windows) each is its own login, so hanging up ends them one by
    /// one; with one, they end with it anyway.
    channels: Arc<Mutex<std::collections::HashSet<u32>>>,
    /// Dropping this ends the master.
    _master: Option<tokio::sync::oneshot::Sender<()>>,
}

impl SystemSsh {
    /// Why the system `ssh` carries this host — for the host's page.
    pub fn need(&self) -> Option<&SystemNeed> {
        self.need.as_ref()
    }

    /// Whether the connection has ended. Without a master (Windows) there is
    /// no one connection to end; each channel stands alone.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Run one command on the host and collect what it printed.
    pub async fn exec(&self, command: &str) -> Result<CommandOutput, AppError> {
        let output = self.output(command).await?;
        Ok(CommandOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().map(|c| c as u32),
        })
    }

    /// Run one command and keep its stdout as bytes; a non-zero exit is "the
    /// host has nothing there", as for the built-in client.
    pub async fn exec_bytes(&self, command: &str) -> Result<Vec<u8>, AppError> {
        let output = self.output(command).await?;
        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(AppError::NotFound(
                "the host has nothing at that revision".to_string(),
            ))
        }
    }

    async fn output(&self, command: &str) -> Result<std::process::Output, AppError> {
        self.live()?;
        let mut cmd = self.client(&["-T"]);
        cmd.arg(command)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let child = cmd
            .spawn()
            .map_err(|e| AppError::Invalid(format!("could not run the system ssh: {e}")))?;
        tokio::time::timeout(EXEC_TIMEOUT, child.wait_with_output())
            .await
            .map_err(|_| {
                AppError::Invalid(format!(
                    "the host did not answer within {}s",
                    EXEC_TIMEOUT.as_secs()
                ))
            })?
            .map_err(AppError::from)
    }

    /// A command's stdin and stdout as one stream — what the host engine
    /// speaks its protocol over.
    pub async fn exec_stream(&self, command: &str) -> Result<ProcessStream, AppError> {
        self.live()?;
        let mut cmd = self.client(&["-T"]);
        cmd.arg(command);
        self.track(ProcessStream::spawn(cmd)?)
    }

    /// The host's SFTP server, over its own channel.
    pub async fn sftp_stream(&self) -> Result<ProcessStream, AppError> {
        self.live()?;
        let mut cmd = self.client(&["-s"]);
        cmd.arg("sftp");
        self.track(ProcessStream::spawn(cmd)?)
    }

    /// A TCP stream to `host:port`, opened by the host (`-W`, the system
    /// client's `direct-tcpip`).
    pub async fn tcp_stream(&self, host: &str, port: u16) -> Result<ProcessStream, TcpRefusal> {
        self.live().map_err(|e| TcpRefusal {
            kind: TcpRefusalKind::Other,
            detail: e.to_string(),
        })?;
        let target = format!("{host}:{port}");
        let cmd = self.client(&["-W", &target]);
        let mut stream = ProcessStream::spawn(cmd).map_err(|e| TcpRefusal {
            kind: TcpRefusalKind::Other,
            detail: e.to_string(),
        })?;
        stream.master = self
            .master_said
            .as_ref()
            .map(|said| (Arc::clone(said), said.lock().unwrap().len()));
        self.track(stream).map_err(|e| TcpRefusal {
            kind: TcpRefusalKind::Other,
            detail: e.to_string(),
        })
    }

    /// Count `stream` among this connection's channels until it is dropped.
    fn track(&self, mut stream: ProcessStream) -> Result<ProcessStream, AppError> {
        if let Some(pid) = stream.child.id() {
            self.channels.lock().unwrap().insert(pid);
            stream.registry = Some((Arc::clone(&self.channels), pid));
        }
        Ok(stream)
    }

    /// End the connection: the master is told to exit, then stopped, and any
    /// channel still open is ended with it.
    pub async fn hang_up(&self) {
        if let Some(socket) = &self.socket {
            let mut cmd = crate::winproc::command("ssh");
            cmd.arg("-S")
                .arg(socket)
                .args(["-O", "exit"])
                .args(&self.destination)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            if let Ok(child) = cmd.spawn() {
                let _ =
                    tokio::time::timeout(Duration::from_secs(5), child.wait_with_output()).await;
            }
        }
        self.closed.store(true, Ordering::SeqCst);
        let open: Vec<u32> = self.channels.lock().unwrap().drain().collect();
        for pid in open {
            uxnan_workspace_engine::procscan::kill_tree(pid);
        }
    }

    fn live(&self) -> Result<(), AppError> {
        // A client of a master that is gone would quietly log in on its own —
        // a second login nobody asked for (another touch of the key).
        if self.is_closed() {
            return Err(AppError::Invalid(
                "the connection to this host has ended".to_string(),
            ));
        }
        Ok(())
    }

    /// An `ssh` invocation for one channel: through the master where there is
    /// one, never prompting, then `kind` (`-T`, `-s`, `-W …`) and the host.
    fn client(&self, kind: &[&str]) -> Command {
        let mut cmd = crate::winproc::command("ssh");
        if let Some(socket) = &self.socket {
            cmd.arg("-S").arg(socket).args(["-o", "ControlMaster=no"]);
        }
        cmd.args(common_options())
            .args(kind)
            .args(&self.destination);
        cmd
    }
}

/// What every invocation carries: never a prompt, and a bounded connect.
fn common_options() -> [&'static str; 4] {
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]
}

/// Log in to the host named by `destination` with the system `ssh`.
pub async fn dial(
    destination: Vec<String>,
    endpoint: &Endpoint,
    need: SystemNeed,
) -> Result<Dialled, AppError> {
    dial_as(!cfg!(windows), destination, endpoint, need).await
}

/// [`dial`], sharing one login among the channels or not. Only Windows lacks
/// sharing; the choice is open here so the unshared way is proved on any
/// machine.
pub(crate) async fn dial_as(
    shared: bool,
    destination: Vec<String>,
    endpoint: &Endpoint,
    need: SystemNeed,
) -> Result<Dialled, AppError> {
    let dialled = if shared {
        dial_shared(destination, endpoint).await?
    } else {
        dial_unshared(destination, endpoint).await?
    };
    Ok(match dialled {
        Dialled::Ready(mut ssh) => {
            ssh.need = Some(need);
            Dialled::Ready(ssh)
        }
        other => other,
    })
}

/// Where the platform shares connections: start the master and wait until it
/// answers on its socket — or ends, saying why.
async fn dial_shared(destination: Vec<String>, endpoint: &Endpoint) -> Result<Dialled, AppError> {
    let socket = socket_path()?;
    let mut cmd = crate::winproc::command("ssh");
    cmd.args(["-M", "-N"])
        .arg("-S")
        .arg(&socket)
        .args(["-o", "ControlPersist=no"])
        // The master is the connection: it notices a dead link and ends, which
        // is what tells the app the host is gone.
        .args([
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
        ])
        .args(common_options())
        .args(&destination)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut master = cmd.spawn().map_err(|e| missing_ssh(&e))?;
    let stderr = collect(master.stderr.take());
    let master_said = Arc::clone(&stderr);

    let deadline = tokio::time::Instant::now() + LOGIN_TIMEOUT;
    loop {
        if let Ok(Some(_)) = master.try_wait() {
            // Give the reader the last words the master wrote.
            tokio::time::sleep(Duration::from_millis(50)).await;
            let said = stderr.lock().unwrap().clone();
            let _ = std::fs::remove_file(&socket);
            return Ok(failure(&said, endpoint));
        }
        if check(&socket, &destination).await {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            let _ = master.start_kill();
            let _ = std::fs::remove_file(&socket);
            return Ok(Dialled::Unreachable {
                why: Unreachable::Timeout,
                detail: format!(
                    "the system ssh did not log in to {} within {}s",
                    endpoint.hostname,
                    LOGIN_TIMEOUT.as_secs()
                ),
            });
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    let closed = Arc::new(AtomicBool::new(false));
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let flag = Arc::clone(&closed);
    let held = socket.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = master.wait() => {}
            // The connection was dropped: end the master with it.
            _ = stopped => {
                let _ = master.start_kill();
                let _ = master.wait().await;
            }
        }
        flag.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_file(&held);
        let said = stderr.lock().unwrap().clone();
        if !said.trim().is_empty() {
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "ssh-system",
                &format!("the system ssh master ended: {}", last_line(&said)),
            );
        }
    });
    // What it said while logging in is not what a channel will want to read.
    master_said.lock().unwrap().clear();
    Ok(Dialled::Ready(SystemSsh {
        need: None,
        destination,
        socket: Some(socket),
        closed,
        master_said: Some(master_said),
        channels: Arc::default(),
        _master: Some(stop),
    }))
}

/// Windows: no connection sharing, so a login is proved once by running
/// `exit` there, and every channel logs in on its own.
async fn dial_unshared(destination: Vec<String>, endpoint: &Endpoint) -> Result<Dialled, AppError> {
    let mut cmd = crate::winproc::command("ssh");
    cmd.args(common_options())
        .arg("-T")
        .args(&destination)
        .arg("exit")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| missing_ssh(&e))?;
    let output = match tokio::time::timeout(LOGIN_TIMEOUT, child.wait_with_output()).await {
        Ok(output) => output?,
        Err(_) => {
            return Ok(Dialled::Unreachable {
                why: Unreachable::Timeout,
                detail: format!(
                    "the system ssh did not log in to {} within {}s",
                    endpoint.hostname,
                    LOGIN_TIMEOUT.as_secs()
                ),
            })
        }
    };
    if output.status.success() {
        return Ok(Dialled::Ready(SystemSsh {
            need: None,
            destination,
            socket: None,
            closed: Arc::new(AtomicBool::new(false)),
            master_said: None,
            channels: Arc::default(),
            _master: None,
        }));
    }
    Ok(failure(&String::from_utf8_lossy(&output.stderr), endpoint))
}

fn missing_ssh(e: &std::io::Error) -> AppError {
    AppError::Invalid(format!(
        "could not run the system ssh — is the OpenSSH client installed and on the PATH? ({e})"
    ))
}

/// Whether the master on `socket` is up and logged in.
async fn check(socket: &Path, destination: &[String]) -> bool {
    let mut cmd = crate::winproc::command("ssh");
    cmd.arg("-S")
        .arg(socket)
        .args(["-O", "check"])
        .args(destination)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match cmd.spawn() {
        Ok(child) => matches!(
            tokio::time::timeout(Duration::from_secs(5), child.wait_with_output()).await,
            Ok(Ok(out)) if out.status.success()
        ),
        Err(_) => false,
    }
}

/// A new control socket's path, in a folder only this user can enter — one
/// per build, so a development build never touches the installed app's
/// masters. Under the home rather than the temporary folder: a Unix socket's
/// path is capped at ~104 bytes, and macOS's per-user temporary folder alone
/// takes half.
fn socket_path() -> Result<PathBuf, AppError> {
    let home = dirs_home()
        .ok_or_else(|| AppError::Invalid("could not find the home folder".to_string()))?;
    let name = if cfg!(debug_assertions) {
        "ssh-mux-dev"
    } else {
        "ssh-mux"
    };
    let dir = home.join(".uxnan").join(name);
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    sweep_once(&dir);
    let name = uuid::Uuid::new_v4().simple().to_string();
    Ok(dir.join(&name[..12]))
}

/// Once per run of the app, clear what an earlier run left in `dir`: the
/// socket of a master that is gone is removed, and a master still answering
/// is an orphan of a run that ended without hanging up (a crash) — nothing in
/// this one started it — so it is told to exit rather than left holding a
/// login to someone's server.
fn sweep_once(dir: &Path) {
    static SWEPT: AtomicBool = AtomicBool::new(false);
    if SWEPT.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        #[cfg(unix)]
        {
            if std::os::unix::net::UnixStream::connect(&path).is_err() {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            let _ = std::process::Command::new("ssh")
                .arg("-S")
                .arg(&path)
                .args(["-O", "exit", "orphan"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            crate::diagnostics::log(
                crate::diagnostics::Level::Info,
                "ssh-system",
                "ended a system ssh master an earlier run of the app left behind",
            );
        }
    }
}

fn dirs_home() -> Option<PathBuf> {
    crate::agent_hooks::home_dir()
}

/// What OpenSSH said when it stopped, read for the part that decides what
/// happens next — the same split the built-in client makes.
fn failure(said: &str, endpoint: &Endpoint) -> Dialled {
    let lower = said.to_ascii_lowercase();
    let why = if lower.contains("could not resolve hostname")
        || lower.contains("name or service not known")
        || lower.contains("nodename nor servname")
    {
        Some(Unreachable::UnknownAddress)
    } else if lower.contains("connection refused") {
        Some(Unreachable::Refused)
    } else if lower.contains("timed out")
        || lower.contains("no route to host")
        || lower.contains("network is unreachable")
        || lower.contains("host is down")
    {
        Some(Unreachable::Timeout)
    } else {
        None
    };
    match why {
        Some(why) => Dialled::Unreachable {
            why,
            detail: why.explain(endpoint),
        },
        None => Dialled::Refused {
            detail: if said.trim().is_empty() {
                "the system ssh stopped without saying why".to_string()
            } else {
                meaningful(said)
            },
        },
    }
}

/// OpenSSH's own sentences, without its banner noise (`Warning: Permanently
/// added …`) and capped.
fn meaningful(said: &str) -> String {
    let lines: Vec<&str> = said
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter(|l| !l.starts_with("Warning: Permanently added"))
        .collect();
    let text = lines.join(" — ");
    text.chars().take(600).collect()
}

fn last_line(said: &str) -> String {
    said.lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

/// Read a child's stderr in the background into a capped buffer.
fn collect(stderr: Option<tokio::process::ChildStderr>) -> Arc<Mutex<String>> {
    let buffer = Arc::new(Mutex::new(String::new()));
    if let Some(mut stderr) = stderr {
        let sink = Arc::clone(&buffer);
        tokio::spawn(async move {
            let mut chunk = [0u8; 1024];
            while let Ok(n) = stderr.read(&mut chunk).await {
                if n == 0 {
                    break;
                }
                let mut text = sink.lock().unwrap();
                text.push_str(&String::from_utf8_lossy(&chunk[..n]));
                // Keep the latest words: a long-lived master writes on.
                if text.len() > STDERR_CAP {
                    let mut cut = text.len() - STDERR_CAP;
                    while !text.is_char_boundary(cut) {
                        cut += 1;
                    }
                    text.drain(..cut);
                }
            }
        });
    }
    buffer
}

/// A child `ssh`'s stdin and stdout as one byte stream — a channel, as the
/// rest of the app sees one. Dropping it ends the process.
pub struct ProcessStream {
    child: Child,
    /// `None` once shut down: dropping it closes the pipe, which is what the
    /// far end reads as end-of-file — tokio's own shutdown of a child's stdin
    /// only flushes, and the other side would wait for more forever.
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    stderr: Arc<Mutex<String>>,
    /// The master's words, and how much of them came before this stream.
    master: Option<(Arc<Mutex<String>>, usize)>,
    /// Where this stream is counted among its connection's channels.
    registry: Option<(Arc<Mutex<std::collections::HashSet<u32>>>, u32)>,
}

impl Drop for ProcessStream {
    fn drop(&mut self) {
        if let Some((channels, pid)) = &self.registry {
            channels.lock().unwrap().remove(pid);
        }
    }
}

impl ProcessStream {
    fn spawn(mut cmd: Command) -> Result<Self, AppError> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| missing_ssh(&e))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("stdout is piped");
        let stderr = collect(child.stderr.take());
        Ok(Self {
            child,
            stdin,
            stdout,
            stderr,
            master: None,
            registry: None,
        })
    }

    /// Whether the channel ended within `grace` — what a forward's probe asks,
    /// since the far end closing at once is how "nothing answered" arrives.
    /// The reason, read from what `ssh` said, when it did.
    pub async fn closed_within(&mut self, grace: Duration) -> Option<TcpRefusal> {
        let _ = tokio::time::timeout(grace, self.child.wait()).await.ok()?;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let mut said = self.stderr.lock().unwrap().clone();
        if let Some((master, from)) = &self.master {
            let master = master.lock().unwrap();
            // The rolling buffer may have moved on; then all of it is recent.
            let since = master.get(*from..).unwrap_or(&master);
            said = format!("{since}\n{said}");
        }
        let lower = said.to_ascii_lowercase();
        let kind = if lower.contains("administratively prohibited") {
            TcpRefusalKind::Prohibited
        } else if lower.contains("connect failed") || lower.contains("open failed") {
            TcpRefusalKind::ConnectFailed
        } else {
            TcpRefusalKind::Other
        };
        Some(TcpRefusal {
            kind,
            detail: meaningful(&said),
        })
    }
}

impl AsyncRead for ProcessStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProcessStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.stdin.as_mut() {
            Some(stdin) => Pin::new(stdin).poll_write(cx, buf),
            None => Poll::Ready(Err(std::io::ErrorKind::BrokenPipe.into())),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.stdin.as_mut() {
            Some(stdin) => Pin::new(stdin).poll_flush(cx),
            None => Poll::Ready(Ok(())),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        if let Some(stdin) = self.stdin.as_mut() {
            std::task::ready!(Pin::new(stdin).poll_flush(cx))?;
        }
        self.stdin = None;
        Poll::Ready(Ok(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint() -> Endpoint {
        Endpoint::new("build-box", 22)
    }

    #[test]
    fn what_the_built_in_client_cannot_do_is_named() {
        let plain = ResolvedHost {
            hostname: "h".into(),
            port: 22,
            ..Default::default()
        };
        assert_eq!(needs_system(&plain), None);
        let kerberos = ResolvedHost {
            gssapi_authentication: true,
            ..plain.clone()
        };
        let need = needs_system(&kerberos).unwrap();
        assert_eq!(need.code, "kerberos");
        assert!(need.sentence().contains("Kerberos"));
        // A ticket needs nobody: such a host comes back on its own.
        assert!(!need.needs_presence);
        let card = ResolvedHost {
            pkcs11_provider: Some("/usr/lib/opensc-pkcs11.so".into()),
            ..plain.clone()
        };
        let need = needs_system(&card).unwrap();
        assert_eq!(need.code, "smartcard");
        assert!(need.needs_presence);
        let fdpass = ResolvedHost {
            proxy_use_fdpass: true,
            ..plain
        };
        assert_eq!(needs_system(&fdpass).unwrap().code, "fdpass");
    }

    #[test]
    fn a_security_key_is_known_by_its_public_half_and_only_when_it_exists() {
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("work_key");
        std::fs::write(&key, "private").unwrap();
        std::fs::write(
            dir.path().join("work_key.pub"),
            "sk-ssh-ed25519@openssh.com AAAA me@laptop\n",
        )
        .unwrap();
        assert!(is_security_key(&key));
        let plain = dir.path().join("id_ed25519");
        std::fs::write(&plain, "private").unwrap();
        std::fs::write(dir.path().join("id_ed25519.pub"), "ssh-ed25519 AAAA\n").unwrap();
        assert!(!is_security_key(&plain));
        // `ssh -G` lists `id_ed25519_sk` whether or not it exists.
        assert!(!is_security_key(&dir.path().join("id_ed25519_sk")));
        let named = dir.path().join("id_ecdsa_sk");
        std::fs::write(&named, "private").unwrap();
        assert!(is_security_key(&named));
    }

    #[test]
    fn a_failure_is_read_the_way_the_built_in_client_reads_one() {
        assert!(matches!(
            failure(
                "ssh: Could not resolve hostname nope: nodename nor servname provided\n",
                &endpoint()
            ),
            Dialled::Unreachable {
                why: Unreachable::UnknownAddress,
                ..
            }
        ));
        assert!(matches!(
            failure(
                "ssh: connect to host h port 22: Connection refused\n",
                &endpoint()
            ),
            Dialled::Unreachable {
                why: Unreachable::Refused,
                ..
            }
        ));
        let Dialled::Refused { detail } = failure(
            "Warning: Permanently added 'h' (ED25519) to the list of known hosts.\nme@h: Permission denied (publickey,gssapi-with-mic).\n",
            &endpoint(),
        ) else {
            panic!("a refusal");
        };
        assert_eq!(
            detail,
            "me@h: Permission denied (publickey,gssapi-with-mic)."
        );
        let Dialled::Refused { detail } = failure("Host key verification failed.\n", &endpoint())
        else {
            panic!("a refusal");
        };
        assert_eq!(detail, "Host key verification failed.");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_process_is_a_stream_both_ways_and_says_when_it_ended() {
        use tokio::io::AsyncWriteExt;
        let mut cmd = Command::new("cat");
        cmd.arg("-");
        let mut stream = ProcessStream::spawn(cmd).unwrap();
        stream.write_all(b"ping").await.unwrap();
        stream.shutdown().await.unwrap();
        let mut back = Vec::new();
        stream.read_to_end(&mut back).await.unwrap();
        assert_eq!(back, b"ping");
        assert!(stream.closed_within(Duration::from_secs(2)).await.is_some());

        let mut slow = Command::new("sleep");
        slow.arg("5");
        let mut alive = ProcessStream::spawn(slow).unwrap();
        assert!(alive
            .closed_within(Duration::from_millis(100))
            .await
            .is_none());
    }

    #[test]
    fn a_host_is_named_the_way_its_owner_would_name_it() {
        use crate::model::{SshHost, SshHostSource};
        let mut host = SshHost {
            id: "h1".into(),
            label: "build".into(),
            config_host: Some("build-box".into()),
            hostname: "10.0.0.5".into(),
            port: 2222,
            user: "dev".into(),
            identity_files: vec![],
            identity_agent: None,
            identities_only: false,
            forward_agent: false,
            proxy_command: None,
            proxy_jump: None,
            source: SshHostSource::SshConfig,
            needs_prompt: false,
            carrier: Default::default(),
        };
        // An imported host is its alias: the configuration says the rest.
        assert_eq!(destination_for(&host).unwrap(), ["build-box"]);
        host.source = SshHostSource::Manual;
        host.forward_agent = true;
        assert_eq!(
            destination_for(&host).unwrap(),
            [
                "-p",
                "2222",
                "-l",
                "dev",
                "-o",
                "ForwardAgent=yes",
                "10.0.0.5"
            ]
        );
        host.source = SshHostSource::SshConfig;
        host.config_host = Some("-oProxyCommand=evil".into());
        assert!(destination_for(&host).is_err());
    }
}
