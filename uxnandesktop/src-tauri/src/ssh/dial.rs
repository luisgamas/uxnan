//! Reaching a host along the route its configuration describes.
//!
//! A host is rarely just "TCP to port 22". The user's configuration may say to
//! go through one or more bastions (`ProxyJump`), to have a command carry the
//! bytes (`ProxyCommand`), to judge its key under another name (`HostKeyAlias`)
//! against other files (`UserKnownHostsFile`), to use a particular agent
//! (`IdentityAgent`) or only certain keys (`IdentitiesOnly`). Every one of those
//! changes *where* we connect or *who* we are when we do, so getting any of them
//! wrong connects somewhere the user's own `ssh` would not — or fails where it
//! would succeed.
//!
//! So nothing is guessed: the route is built from `ssh -G`, resolved **at every
//! connection** (a config edited since the host was added takes effect on the
//! next connect, as it would for `ssh`), and each hop is reached, verified and
//! authenticated in turn, inside this process. A bastion is an SSH connection
//! of its own; the next hop is a `direct-tcpip` channel on it, carrying a
//! complete SSH session — the same thing `ssh -J` does, without a process per
//! hop and on Windows too.
//!
//! A dial can stop at any hop for the person: a key to confirm, a password, a
//! passphrase, the questions of a second factor. It reports which hop asked, so
//! the dialog can say "the bastion wants a code" rather than "the host". For a
//! second factor the dial **pauses** with the conversation open and resumes on
//! the same connection when the answers come back.

use std::path::PathBuf;

use super::auth::{AuthOutcome, AuthPlan, Authenticator, Challenge, Secrets};
use super::config::{self, ResolvedHost, StrictHostKeys};
use super::conn::{self, Connection, Endpoint, Handshake, KeyPolicy, Unreachable};
use super::hostkey::{self, PresentedKey};
use crate::error::AppError;
use crate::model::{SshHost, SshHostSource};

/// Most hops one route may have. Bastions chain in practice to two or three; a
/// configuration that nests deeper is almost certainly a loop the cycle check
/// did not see by name.
const MAX_HOPS: usize = 8;

/// One machine along a route.
#[derive(Debug, Clone)]
pub struct Hop {
    /// What the person sees: the alias, or `user@host:port`.
    pub label: String,
    /// Stable identity for this hop's secrets: `user@hostname:port`. The same
    /// bastion reached on the way to two hosts is one hop, with one password.
    pub key: String,
    pub resolved: ResolvedHost,
}

impl Hop {
    fn new(label: String, resolved: ResolvedHost) -> Self {
        let key = format!("{}@{}:{}", resolved.user, resolved.hostname, resolved.port);
        Self {
            label,
            key,
            resolved,
        }
    }

    /// A hop built directly from resolved settings, for the transport tests.
    #[cfg(test)]
    pub fn for_test(label: &str, resolved: ResolvedHost) -> Self {
        Self::new(label.to_string(), resolved)
    }

    fn endpoint(&self) -> Endpoint {
        Endpoint::new(self.resolved.hostname.clone(), self.resolved.port)
    }

    /// The name this hop's key is filed under.
    fn key_name(&self) -> String {
        self.resolved
            .host_key_alias
            .clone()
            .unwrap_or_else(|| self.resolved.hostname.clone())
    }

    /// Every `known_hosts` file this hop's configuration names, readable ones
    /// first-to-last, concatenated. Missing files read as empty: a first-ever
    /// connection is "unknown", not an error.
    fn known_hosts(&self) -> String {
        let mut text = String::new();
        for file in self.known_hosts_files() {
            if let Ok(body) = hostkey::read_known_hosts(&file) {
                text.push_str(&body);
                if !text.ends_with('\n') && !text.is_empty() {
                    text.push('\n');
                }
            }
        }
        text
    }

    fn known_hosts_files(&self) -> Vec<PathBuf> {
        self.user_known_hosts_files()
            .into_iter()
            .chain(
                self.resolved
                    .global_known_hosts_files
                    .iter()
                    .map(|f| super::auth::expand_path(f)),
            )
            .collect()
    }

    /// The files a key may be written to. `ssh -G` always prints at least one;
    /// when it could not run, the user's default file is the answer.
    pub fn user_known_hosts_files(&self) -> Vec<PathBuf> {
        let named: Vec<PathBuf> = self
            .resolved
            .user_known_hosts_files
            .iter()
            .filter(|f| !f.eq_ignore_ascii_case("none"))
            .map(|f| super::auth::expand_path(f))
            .collect();
        if !named.is_empty() || !self.resolved.user_known_hosts_files.is_empty() {
            return named;
        }
        vec![super::auth::expand_path("~/.ssh/known_hosts")]
    }

    fn policy(&self) -> KeyPolicy {
        KeyPolicy {
            known_hosts: self.known_hosts(),
            name: self.key_name(),
            port: self.resolved.port,
            accept_new: self.resolved.strict_host_key_checking == StrictHostKeys::AcceptNew,
        }
    }

    fn plan(&self) -> AuthPlan {
        AuthPlan::new(
            &self.resolved.user,
            self.resolved.identity_agent.as_deref(),
            self.resolved.identities_only,
            &self.resolved.identity_files,
            &self.resolved.certificate_files,
        )
    }

    /// Whether reaching this hop could go through without asking anything about
    /// its key: one is on file, or the configuration accepts new ones.
    pub fn key_is_settled(&self) -> bool {
        self.resolved.strict_host_key_checking == StrictHostKeys::AcceptNew
            || hostkey::is_known(&self.known_hosts(), &self.key_name(), self.resolved.port)
    }
}

/// The whole way to a host: bastions first, the host itself last.
#[derive(Debug, Clone)]
pub struct Route {
    pub hops: Vec<Hop>,
}

impl Route {
    pub fn target(&self) -> &Hop {
        self.hops.last().expect("a route always ends at its host")
    }
}

/// Build the route to `host` from the user's configuration, as it is now.
///
/// A host imported from `~/.ssh/config` is resolved by its alias. One typed by
/// hand is resolved as the matching command line would be (`ssh -p … -l … host`),
/// so it still picks up the user's `Host *` defaults.
///
/// When `ssh` itself cannot run — no OpenSSH client on this machine — the
/// record's own fields are the only knowledge there is, and they are used as
/// they are, without a route through any bastion they name.
pub async fn route_for(host: &SshHost) -> Result<Route, AppError> {
    let resolved = match (&host.source, &host.config_host) {
        (SshHostSource::SshConfig, Some(alias)) => config::resolve(alias).await,
        _ => {
            config::resolve_typed(&config::TypedHost {
                hostname: &host.hostname,
                port: host.port,
                user: &host.user,
                identity_files: &host.identity_files,
                proxy_jump: host.proxy_jump.as_deref(),
                proxy_command: host.proxy_command.as_deref(),
                forward_agent: host.forward_agent,
            })
            .await
        }
    };
    let resolved = match resolved {
        Ok(resolved) => resolved,
        Err(e) if is_missing_ssh(&e) => {
            crate::diagnostics::log(
                crate::diagnostics::Level::Warn,
                "ssh",
                "no OpenSSH client to resolve the configuration; using the host record as written",
            );
            from_record(host)
        }
        Err(e) => return Err(e),
    };

    let mut hops = Vec::new();
    let mut visiting = vec![hop_identity(&resolved)];
    if let Some(jumps) = resolved.proxy_jump.clone() {
        expand_jumps(&jumps, &mut hops, &mut visiting, 0).await?;
    }
    hops.push(Hop::new(host.label.clone(), resolved));
    if hops.len() > MAX_HOPS {
        return Err(AppError::Invalid(format!(
            "the route to {} has more than {MAX_HOPS} hops",
            host.label
        )));
    }
    Ok(Route { hops })
}

/// Resolve a `ProxyJump` list into hops, each one through the user's
/// configuration — and, like OpenSSH, a bastion with its own `ProxyJump` is
/// reached through that first.
fn expand_jumps<'a>(
    value: &'a str,
    hops: &'a mut Vec<Hop>,
    visiting: &'a mut Vec<String>,
    depth: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + 'a>> {
    Box::pin(async move {
        if depth >= MAX_HOPS {
            return Err(AppError::Invalid(
                "the ProxyJump chain is too deep — is it a loop?".to_string(),
            ));
        }
        for spec in config::parse_jumps(value)? {
            let resolved = config::resolve_jump(&spec).await?;
            let identity = hop_identity(&resolved);
            if visiting.contains(&identity) {
                return Err(AppError::Invalid(format!(
                    "the ProxyJump chain loops back to {}",
                    spec.host
                )));
            }
            visiting.push(identity);
            if let Some(nested) = resolved.proxy_jump.clone() {
                expand_jumps(&nested, hops, visiting, depth + 1).await?;
            }
            hops.push(Hop::new(spec.host.clone(), resolved));
        }
        Ok(())
    })
}

fn hop_identity(resolved: &ResolvedHost) -> String {
    format!("{}@{}:{}", resolved.user, resolved.hostname, resolved.port)
}

fn is_missing_ssh(e: &AppError) -> bool {
    matches!(e, AppError::Invalid(m) if m.starts_with("could not run `ssh -G`"))
}

/// The record as the only description of the host, when `ssh -G` cannot run.
fn from_record(host: &SshHost) -> ResolvedHost {
    ResolvedHost {
        hostname: host.hostname.clone(),
        port: host.port,
        user: host.user.clone(),
        identity_files: if host.identity_files.is_empty() {
            ["~/.ssh/id_ed25519", "~/.ssh/id_ecdsa", "~/.ssh/id_rsa"]
                .iter()
                .map(|s| s.to_string())
                .collect()
        } else {
            host.identity_files.clone()
        },
        identity_agent: host.identity_agent.clone(),
        identities_only: host.identities_only,
        forward_agent: host.forward_agent,
        ..Default::default()
    }
}

/// Which hop a report is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HopRef {
    pub label: String,
    pub key: String,
    /// The host itself, as opposed to a bastion on the way.
    pub is_target: bool,
}

/// Why a dial stopped short of a connection. Nothing stays open behind one of
/// these.
#[derive(Debug, Clone)]
pub enum Stop {
    Unreachable {
        hop: HopRef,
        why: Unreachable,
        detail: String,
    },
    /// No key on file. `strict` is `StrictHostKeyChecking yes`: the host's
    /// configuration does not allow trusting a new key from here at all.
    HostUnknown {
        hop: HopRef,
        pending: PendingKey,
        strict: bool,
    },
    HostChanged {
        hop: HopRef,
        pending: PendingKey,
        stored_fingerprint: String,
    },
    HostRevoked {
        hop: HopRef,
        fingerprint: String,
    },
    NeedsPassword {
        hop: HopRef,
        attempted: Vec<String>,
    },
    NeedsPassphrase {
        hop: HopRef,
        path: String,
        wrong: bool,
    },
    Failed {
        hop: HopRef,
        attempted: Vec<String>,
    },
    NoUsableMethod {
        hop: HopRef,
    },
    /// A `ProxyCommand` that could not be started.
    ProxyFailed {
        hop: HopRef,
        detail: String,
    },
}

/// A host key waiting for the person's decision, with everything needed to
/// record it exactly where `ssh` would look for it.
#[derive(Debug, Clone)]
pub struct PendingKey {
    pub key: PresentedKey,
    /// The name it is filed under (`HostKeyAlias`, or the hostname).
    pub name: String,
    pub port: u16,
    /// The user's `known_hosts` files, the first of which is written.
    pub files: Vec<PathBuf>,
}

impl PendingKey {
    pub fn fingerprint(&self) -> String {
        self.key.fingerprint()
    }
}

/// Where a dial got to.
pub enum Step {
    /// Every hop is up and authenticated; the host's connection carries the
    /// bastions it travels through.
    Ready(Ready),
    /// Stopped; nothing is open.
    Stopped(Stop),
    /// The hop asked questions only the person can answer. Keep the [`Dial`]
    /// and call [`Dial::answer`] with their answers.
    Paused { hop: HopRef, challenge: Challenge },
}

/// A finished dial.
pub struct Ready {
    pub connection: Connection,
    /// How the host itself was authenticated.
    pub method: String,
    /// Whether any hop needed something the person typed. Such a route cannot
    /// be dialled again silently once the app forgets those answers.
    pub needed_secrets: bool,
    /// Whether any hop asked second-factor questions, which can never be
    /// replayed.
    pub answered_challenges: bool,
    /// Keys recorded without asking under `accept-new`, by hop, for the log.
    pub learned: Vec<(String, String)>,
}

/// A dial in progress: the hops already up, and the one being authenticated.
pub struct Dial {
    route: Route,
    /// Index of the hop being reached or authenticated.
    index: usize,
    established: Vec<Connection>,
    /// The hop whose authentication is paused on a challenge.
    current: Option<(Connection, Authenticator)>,
    proxy: Option<tokio::process::Child>,
    needed_secrets: bool,
    answered_challenges: bool,
    learned: Vec<(String, String)>,
    /// How the host itself let us in, once it has.
    method: Option<String>,
}

impl Dial {
    pub fn new(route: Route) -> Self {
        Self {
            route,
            index: 0,
            established: Vec::new(),
            current: None,
            proxy: None,
            needed_secrets: false,
            answered_challenges: false,
            learned: Vec::new(),
            method: None,
        }
    }

    pub fn route(&self) -> &Route {
        &self.route
    }

    fn hop_ref(&self, index: usize) -> HopRef {
        let hop = &self.route.hops[index];
        HopRef {
            label: hop.label.clone(),
            key: hop.key.clone(),
            is_target: index + 1 == self.route.hops.len(),
        }
    }

    /// Reach every remaining hop. `secrets` says what the person has given for
    /// a hop so far (by [`Hop::key`]), and is asked once per hop.
    pub async fn run(
        &mut self,
        secrets: &(dyn Fn(&Hop) -> Secrets + Sync),
    ) -> Result<Step, AppError> {
        while self.index < self.route.hops.len() {
            let hop = self.route.hops[self.index].clone();
            let mut connection = match self.reach(&hop).await? {
                Ok(conn) => conn,
                Err(stop) => return Ok(Step::Stopped(stop)),
            };
            let mut auth = Authenticator::new(hop.plan(), secrets(&hop));
            let outcome = auth.run(&mut connection).await?;
            if let Some(step) = self.after_auth(connection, auth, outcome) {
                return Ok(step);
            }
        }
        Ok(Step::Ready(self.finish()))
    }

    /// Hand the person's answers to the paused hop, and carry on.
    pub async fn answer(
        &mut self,
        answers: Vec<String>,
        secrets: &(dyn Fn(&Hop) -> Secrets + Sync),
    ) -> Result<Step, AppError> {
        let Some((mut connection, mut auth)) = self.current.take() else {
            return Err(AppError::Invalid(
                "this host is not waiting for answers".to_string(),
            ));
        };
        let outcome = auth.answer(&mut connection, answers).await?;
        if let Some(step) = self.after_auth(connection, auth, outcome) {
            return Ok(step);
        }
        self.run(secrets).await
    }

    /// Decide what one hop's authentication means for the dial. `None` means
    /// "that hop is in; go on to the next".
    fn after_auth(
        &mut self,
        mut connection: Connection,
        auth: Authenticator,
        outcome: AuthOutcome,
    ) -> Option<Step> {
        let hop = self.hop_ref(self.index);
        match outcome {
            AuthOutcome::Success { method } => {
                self.needed_secrets |= auth.used_secrets();
                self.answered_challenges |= auth.answered_challenges();
                if let Some(key) = connection.take_learned_key() {
                    self.record_learned(&key);
                }
                if hop.is_target {
                    self.method = Some(method);
                }
                self.established.push(connection);
                self.index += 1;
                None
            }
            AuthOutcome::NeedsAnswers(challenge) => {
                self.current = Some((connection, auth));
                Some(Step::Paused { hop, challenge })
            }
            AuthOutcome::NeedsPassword { attempted } => {
                Some(Step::Stopped(Stop::NeedsPassword { hop, attempted }))
            }
            AuthOutcome::NeedsPassphrase { path, wrong } => {
                Some(Step::Stopped(Stop::NeedsPassphrase { hop, path, wrong }))
            }
            AuthOutcome::Failed { attempted } => {
                Some(Step::Stopped(Stop::Failed { hop, attempted }))
            }
            AuthOutcome::NoUsableMethod => Some(Step::Stopped(Stop::NoUsableMethod { hop })),
        }
    }

    /// Write a key accepted under `accept-new` where `ssh` would have.
    fn record_learned(&mut self, key: &PresentedKey) {
        let hop = &self.route.hops[self.index];
        let pending = PendingKey {
            key: key.clone(),
            name: hop.key_name(),
            port: hop.resolved.port,
            files: hop.user_known_hosts_files(),
        };
        match record_key(&pending) {
            Ok(()) => self.learned.push((hop.label.clone(), key.fingerprint())),
            Err(e) => crate::diagnostics::log(
                crate::diagnostics::Level::Warn,
                "ssh",
                &format!("could not record the new key of {}: {e}", hop.label),
            ),
        }
    }

    fn finish(&mut self) -> Ready {
        let mut connection = self
            .established
            .pop()
            .expect("a finished dial has the host's connection last");
        let jumps = std::mem::take(&mut self.established);
        connection = connection.carried_by(jumps, self.proxy.take());
        let forwards = self.route.target().resolved.forward_agent;
        connection.set_forwards_agent(forwards);
        Ready {
            connection,
            method: self.method.take().unwrap_or_default(),
            needed_secrets: self.needed_secrets,
            answered_challenges: self.answered_challenges,
            learned: std::mem::take(&mut self.learned),
        }
    }

    /// Open the transport to one hop and run its handshake.
    async fn reach(&mut self, hop: &Hop) -> Result<Result<Connection, Stop>, AppError> {
        let hop_ref = self.hop_ref(self.index);
        let endpoint = hop.endpoint();
        let policy = hop.policy();
        let forward = (hop_ref.is_target && hop.resolved.forward_agent)
            .then(|| super::auth::AgentSource::from_config(hop.resolved.identity_agent.as_deref()));

        let outcome = if let Some(previous) = self.established.last() {
            // Through the bastion before it: a `direct-tcpip` channel, opened
            // *by the bastion* to this hop's address — which is why a name only
            // the bastion can resolve works.
            match previous
                .handle()
                .channel_open_direct_tcpip(
                    hop.resolved.hostname.clone(),
                    u32::from(hop.resolved.port),
                    "127.0.0.1",
                    0,
                )
                .await
            {
                Ok(channel) => {
                    conn::handshake(channel.into_stream(), endpoint, policy, forward).await?
                }
                Err(e) => {
                    return Ok(Err(Stop::Unreachable {
                        detail: format!(
                            "{} could not open a tunnel to {}:{} — {e}",
                            self.route.hops[self.index - 1].label,
                            hop.resolved.hostname,
                            hop.resolved.port
                        ),
                        hop: hop_ref,
                        why: Unreachable::Refused,
                    }))
                }
            }
        } else if let Some(command) = hop.resolved.proxy_command.clone() {
            match spawn_proxy(&command, hop) {
                Ok((child, stream)) => {
                    self.proxy = Some(child);
                    conn::handshake(stream, endpoint, policy, forward).await?
                }
                Err(detail) => {
                    return Ok(Err(Stop::ProxyFailed {
                        hop: hop_ref,
                        detail,
                    }))
                }
            }
        } else {
            match conn::dial_tcp(&endpoint).await {
                Ok(stream) => conn::handshake(stream, endpoint, policy, forward).await?,
                Err((why, detail)) => Handshake::Unreachable { why, detail },
            }
        };

        let pending = |key: PresentedKey| PendingKey {
            key,
            name: hop.key_name(),
            port: hop.resolved.port,
            files: hop.user_known_hosts_files(),
        };
        Ok(match outcome {
            Handshake::Ready(connection) => Ok(*connection),
            Handshake::Unreachable { why, detail } => Err(Stop::Unreachable {
                hop: hop_ref,
                why,
                detail,
            }),
            Handshake::Unknown { key, .. } => Err(Stop::HostUnknown {
                hop: hop_ref,
                pending: pending(key),
                strict: hop.resolved.strict_host_key_checking == StrictHostKeys::Yes,
            }),
            Handshake::Changed {
                stored_fingerprint,
                key,
                ..
            } => Err(Stop::HostChanged {
                hop: hop_ref,
                pending: pending(key),
                stored_fingerprint,
            }),
            Handshake::Revoked { fingerprint } => Err(Stop::HostRevoked {
                hop: hop_ref,
                fingerprint,
            }),
        })
    }
}

/// Start a `ProxyCommand` and use its pipes as the connection.
///
/// The command comes from the user's own configuration and runs exactly as
/// `ssh` would run it — through the shell, with `%h`, `%p`, `%r`, `%n` and `%%`
/// expanded. Its stderr goes to the log: it is where a proxy says why it could
/// not connect, and it never carries anything of ours.
fn spawn_proxy(
    command: &str,
    hop: &Hop,
) -> Result<
    (
        tokio::process::Child,
        impl tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    ),
    String,
> {
    let line = expand_tokens(command, hop);
    #[cfg(windows)]
    let mut cmd = {
        let mut c = crate::winproc::command("cmd");
        c.arg("/C").arg(&line);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("/bin/sh");
        c.arg("-c").arg(format!("exec {line}"));
        c
    };
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start the ProxyCommand: {e}"))?;
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err("the ProxyCommand has no pipes".to_string());
    };
    if let Some(stderr) = child.stderr.take() {
        let label = hop.label.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                crate::diagnostics::log(
                    crate::diagnostics::Level::Info,
                    "ssh",
                    &format!("ProxyCommand for {label}: {line}"),
                );
            }
        });
    }
    Ok((child, tokio::io::join(stdout, stdin)))
}

/// Expand OpenSSH's tokens in a `ProxyCommand`.
fn expand_tokens(command: &str, hop: &Hop) -> String {
    let mut out = String::with_capacity(command.len());
    let mut chars = command.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('h') => out.push_str(&hop.resolved.hostname),
            Some('p') => out.push_str(&hop.resolved.port.to_string()),
            Some('r') => out.push_str(&hop.resolved.user),
            Some('n') => out.push_str(&hop.label),
            Some('%') => out.push('%'),
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    out
}

/// Append a confirmed key to the first of the user's `known_hosts` files,
/// creating `~/.ssh` if this is the first host ever trusted. Appends — never
/// rewrites — so entries the user or their own `ssh` put there are untouched.
pub fn record_key(pending: &PendingKey) -> Result<(), AppError> {
    use std::io::Write;
    let Some(path) = pending.files.first() else {
        return Err(AppError::Invalid(
            "this host's configuration names no known_hosts file to record its key in".to_string(),
        ));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // A file that does not end in a newline would otherwise glue our entry onto
    // the last one and corrupt both.
    let needs_newline = std::fs::read_to_string(path)
        .map(|s| !s.is_empty() && !s.ends_with('\n'))
        .unwrap_or(false);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    if needs_newline {
        file.write_all(b"\n")?;
    }
    writeln!(
        file,
        "{}",
        hostkey::trust_line(&pending.name, pending.port, &pending.key)
    )?;
    Ok(())
}

/// Replace the key on file for a host whose key **the person confirmed** was
/// rotated (the machine was reinstalled, its keys regenerated).
///
/// Only the entries for that name, port and algorithm go — in every user file
/// that has one, each backed up first to `<file>.old` the way `ssh-keygen -R`
/// does — and then the presented key is recorded. A stale entry that lives in a
/// **global** file cannot be replaced from here (it belongs to the machine's
/// administrator), and saying so is the honest answer.
pub fn replace_key(pending: &PendingKey) -> Result<usize, AppError> {
    let mut removed = 0;
    for path in &pending.files {
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let (kept, gone) =
            hostkey::remove_entries(&text, &pending.name, pending.port, &pending.key.algorithm);
        if gone == 0 {
            continue;
        }
        let backup = PathBuf::from(format!("{}.old", path.display()));
        std::fs::write(&backup, &text)?;
        let staging = PathBuf::from(format!("{}.uxnan-tmp", path.display()));
        std::fs::write(&staging, kept)?;
        std::fs::rename(&staging, path)?;
        removed += gone;
    }
    if removed == 0 {
        return Err(AppError::Invalid(format!(
            "the key on file for {} is not in your own known_hosts (it may be in a system-wide \
             file), so it cannot be replaced from here",
            hostkey::host_pattern(&pending.name, pending.port)
        )));
    }
    record_key(pending)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hop(user: &str, hostname: &str, port: u16) -> Hop {
        Hop::new(
            hostname.to_string(),
            ResolvedHost {
                hostname: hostname.into(),
                port,
                user: user.into(),
                ..Default::default()
            },
        )
    }

    #[test]
    fn proxy_command_tokens_expand_like_openssh() {
        let h = hop("dev", "box.lan", 2222);
        assert_eq!(
            expand_tokens("nc -X 5 -x proxy:1080 %h %p # %r %n %% %q", &h),
            "nc -X 5 -x proxy:1080 box.lan 2222 # dev box.lan % %q"
        );
    }

    #[test]
    fn a_hop_is_one_identity_whatever_route_reaches_it() {
        // The same bastion on the way to two hosts shares its secrets.
        assert_eq!(hop("ops", "edge", 22).key, "ops@edge:22");
    }

    #[test]
    fn the_key_is_judged_under_its_alias_when_one_is_configured() {
        let mut h = hop("dev", "10.0.0.5", 22);
        assert_eq!(h.key_name(), "10.0.0.5");
        h.resolved.host_key_alias = Some("build-box".into());
        assert_eq!(h.key_name(), "build-box");
    }

    #[test]
    fn a_confirmed_key_is_written_where_ssh_reads_it_and_rotation_replaces_only_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        std::fs::write(&file, "other ssh-ed25519 AAAA\nbox ssh-ed25519 OLD").unwrap();
        let pending = PendingKey {
            key: PresentedKey {
                algorithm: "ssh-ed25519".into(),
                blob: vec![9; 32],
            },
            name: "box".into(),
            port: 22,
            files: vec![file.clone()],
        };
        assert_eq!(replace_key(&pending).unwrap(), 1);
        let now = std::fs::read_to_string(&file).unwrap();
        assert!(now.starts_with("other ssh-ed25519 AAAA\n"), "{now}");
        assert!(!now.contains("OLD"), "{now}");
        assert_eq!(
            hostkey::verify(&now, "box", 22, &pending.key),
            hostkey::Verdict::Trusted
        );
        // The previous file is kept, as `ssh-keygen -R` keeps it.
        let backup = std::fs::read_to_string(dir.path().join("known_hosts.old")).unwrap();
        assert!(backup.contains("OLD"));
        // Nothing left to replace is an honest error, not a silent append.
        let other = PendingKey {
            name: "nowhere".into(),
            ..pending
        };
        assert!(replace_key(&other).is_err());
    }

    #[test]
    fn a_new_key_goes_to_the_first_user_file_with_a_clean_line_break() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("a").join("known_hosts");
        let second = dir.path().join("known_hosts2");
        let pending = PendingKey {
            key: PresentedKey {
                algorithm: "ssh-ed25519".into(),
                blob: vec![3; 32],
            },
            name: "box".into(),
            port: 2222,
            files: vec![first.clone(), second.clone()],
        };
        record_key(&pending).unwrap();
        let text = std::fs::read_to_string(&first).unwrap();
        assert!(text.starts_with("[box]:2222 ssh-ed25519 "), "{text}");
        assert!(!second.exists());
    }

    /// Against a real machine, through the user's own configuration and agent:
    /// the route `ssh` would take, read-only (`echo`, `uname`), writing nothing
    /// — a key that is not on file stops the test rather than being trusted.
    ///
    /// `UXNAN_SSH_TEST_ALIAS=<alias> cargo test --manifest-path
    /// uxnandesktop/src-tauri/Cargo.toml -- --ignored real_alias --nocapture`
    mod live {
        use super::*;
        use crate::model::{SshHost, SshHostSource};

        fn imported(alias: &str) -> SshHost {
            SshHost {
                id: "live".into(),
                label: alias.into(),
                config_host: Some(alias.into()),
                hostname: String::new(),
                port: 22,
                user: String::new(),
                identity_files: vec![],
                identity_agent: None,
                identities_only: false,
                forward_agent: false,
                proxy_command: None,
                proxy_jump: None,
                source: SshHostSource::SshConfig,
                needs_prompt: false,
            }
        }

        async fn ready(route: Route) -> Ready {
            match Dial::new(route).run(&|_| Secrets::default()).await.unwrap() {
                Step::Ready(ready) => ready,
                Step::Stopped(stop) => panic!("stopped: {stop:?}"),
                Step::Paused { challenge, .. } => panic!("asked for {challenge:?}"),
            }
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS naming a host the agent can reach"]
        async fn a_real_alias_connects_through_its_own_route() {
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let route = route_for(&imported(&alias)).await.unwrap();
            let ready = ready(route).await;
            let out = ready.connection.exec("uname -sm").await.unwrap();
            println!("live: {alias} via {} → {}", ready.method, out.stdout.trim());
            assert_eq!(out.exit_code, Some(0));
        }

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_ALIAS naming a host the agent can reach"]
        async fn a_real_host_is_reached_again_through_itself_as_a_bastion() {
            // The bastion path against a real `sshd`: the alias is the jump
            // host, and the target is that same machine's loopback, reached by
            // a `direct-tcpip` channel the bastion opens. The target's key is
            // the bastion's own, so it is judged under the bastion's name
            // (`HostKeyAlias`) — nothing new is trusted.
            let Ok(alias) = std::env::var("UXNAN_SSH_TEST_ALIAS") else {
                panic!("set UXNAN_SSH_TEST_ALIAS=<alias from ~/.ssh/config>");
            };
            let bastion = route_for(&imported(&alias)).await.unwrap();
            let bastion_hop = bastion.target().clone();
            let mut target = bastion_hop.clone();
            target.label = format!("{alias} (loopback)");
            target.resolved.hostname = "127.0.0.1".into();
            target.resolved.host_key_alias = Some(bastion_hop.resolved.hostname.clone());
            target.key = format!("{}@127.0.0.1:22", target.resolved.user);
            let ready = ready(Route {
                hops: vec![bastion_hop, target],
            })
            .await;
            let out = ready.connection.exec("echo through-myself").await.unwrap();
            assert_eq!(out.stdout.trim(), "through-myself");
            println!("live: {alias} → 127.0.0.1 through {alias} as a bastion");
        }
    }
}
