//! Reaching a host: the TCP connection, the SSH handshake, and the host-key
//! decision that gates everything after it.
//!
//! Two properties this module is built around.
//!
//! **An unverified host is never connected to — not even to ask.** When
//! `known_hosts` has nothing for a host, the handshake is refused and the caller
//! gets [`Handshake::Unknown`] carrying the fingerprint to show. Trusting is a
//! separate, explicit act by the user, after which the caller connects again.
//! The alternative — completing the connection and asking afterwards — would
//! mean a man-in-the-middle has already spoken to us.
//!
//! **Every connection carries a generation.** It is what `target::check` compares
//! a mutation's expectation against, so an operation prepared before a reconnect
//! cannot execute after it: same host, new connection, possibly a different
//! working directory and certainly a different set of live processes.
//!
//! Authentication lives next door in [`super::auth`]: this module stops at the
//! host-key decision, which is the one that must not be conflated with it.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client;

use super::hostkey::{self, PresentedKey, Verdict};
use crate::error::AppError;

/// How long to wait for the TCP connection and the SSH handshake. Short on
/// purpose: an unreachable host should report quickly, and a slow one is better
/// surfaced as an error the user can retry than as a UI that hangs.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

/// Drops the connection when neither side has spoken for this long — the
/// backstop behind the keepalive below, not the way a dead host is noticed.
const INACTIVITY_TIMEOUT: Duration = Duration::from_secs(300);

/// How often to ask a silent host whether it is still there, and how many
/// unanswered asks end the connection.
///
/// Without this the two timers above lied in both directions. A host nobody had
/// typed at for five minutes was **reaped for being quiet** — an SSH connection
/// carries nothing while a shell sits at its prompt — and a host that had really
/// gone away was not noticed until that same five minutes had passed, so its
/// terminals sat there looking alive against a machine that was gone.
///
/// 30 seconds with three tolerated misses is what mature clients settle on
/// (OpenSSH ships `ServerAliveInterval` **off**, and the guidance for editors
/// driving long-lived sessions is 30–60s with 3–5 misses). It also keeps a NAT
/// or firewall from dropping an idle connection out from under us, which is the
/// same reason those clients turn it on. A live host answers each one, which
/// resets both timers; a dead one is reported in ~two minutes instead of five.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
const KEEPALIVE_MAX_MISSED: usize = 3;

/// How long a command waits for a channel when the host's limit is already
/// reached. Short on purpose: commands are brief (§5.3), so a slot usually frees
/// within one, and waiting longer would only turn a clear refusal into a hang.
const CHANNEL_WAIT: Duration = Duration::from_secs(10);

/// How long one remote command may take before it is given up on.
///
/// Generous on purpose: a single `exec` costs ~2s on a real host (§5.3, the
/// remote shell starts a profile for each one), and a git command on a large
/// repository is slower still. What this rules out is not slowness but the
/// command that **never returns** — a shell blocked on input, a wedged
/// filesystem — which otherwise leaves the caller waiting for something that
/// will never arrive.
const EXEC_TIMEOUT: Duration = Duration::from_secs(60);

/// Monotonic connection counter. Never reset, never reused: a generation
/// identifies one *incarnation* of a connection for the lifetime of the process,
/// which is exactly what fencing needs.
static GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst)
}

/// Where to reach a host. Not a host *record* — that lives in settings; this is
/// only what the transport needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub hostname: String,
    pub port: u16,
}

impl Endpoint {
    pub fn new(hostname: impl Into<String>, port: u16) -> Self {
        Self {
            hostname: hostname.into(),
            port,
        }
    }

    fn socket_addr(&self) -> (String, u16) {
        (self.hostname.clone(), self.port)
    }
}

/// What happened when we tried to reach a host.
///
/// Every non-`Ready` variant means **nothing is connected**: the socket is
/// closed and no credential was offered.
pub enum Handshake {
    /// Host key verified against `known_hosts`. The transport is up and waiting
    /// for authentication.
    Ready(Connection),
    /// Nothing on file for this host. Show the fingerprint, ask, and — only if
    /// the user agrees — record `trust_line` and connect again.
    Unknown {
        fingerprint: String,
        key: PresentedKey,
    },
    /// A key is on file and it is not this one. Refuse; show both fingerprints.
    Changed {
        presented_fingerprint: String,
        stored_fingerprint: String,
    },
    /// The host is `@revoked` in `known_hosts`.
    Revoked { fingerprint: String },
    /// It could not be reached at all, and *why* is the part that decides what
    /// happens next (see [`Unreachable`]). This used to be an `Err` carrying one
    /// string, which made "asleep" and "wrong name" indistinguishable to
    /// everything downstream.
    Unreachable { why: Unreachable, detail: String },
}

/// How many channels this connection is holding open, and how many the host
/// turned out to allow.
///
/// **The limit is not ours to guess.** OpenSSH's `MaxSessions` defaults to 10,
/// but it is a per-host setting and plenty of machines change it — hard-coding
/// ten would be this app deciding what someone else's `sshd` is configured to
/// do. So nothing is assumed: channels are counted, and the ceiling is *learned*
/// the first time the host refuses one. From then on the refusal is reported
/// with the number the host actually enforced, instead of the eleventh terminal
/// failing with a library error that reads as "it broke".
///
/// Everything on a connection is a channel — every terminal, the file session,
/// and each command while it runs (§5.3) — so the count is kept here rather than
/// in any one of them.
#[derive(Debug, Default)]
pub struct ChannelBudget {
    open: AtomicUsize,
    /// What the host allowed at the moment it said no. `0` means "never
    /// refused", which is the only honest starting value.
    ceiling: AtomicUsize,
}

impl ChannelBudget {
    fn open(&self) -> usize {
        self.open.load(Ordering::Relaxed)
    }

    /// The host's own limit, once it has shown us. `None` until then.
    pub fn observed_limit(&self) -> Option<usize> {
        match self.ceiling.load(Ordering::Relaxed) {
            0 => None,
            n => Some(n),
        }
    }

    /// Whether another channel is worth attempting. False only when the host has
    /// already refused at this count — never on a guess.
    fn has_room(&self) -> bool {
        match self.observed_limit() {
            Some(limit) => self.open() < limit,
            None => true,
        }
    }

    /// Record what the host enforced. Called with the number of channels that
    /// were open when it refused, which *is* its limit.
    ///
    /// Answers whether this taught us something new, so the discovery is logged
    /// once rather than on every refusal.
    fn refused_at(&self, open: usize) -> bool {
        // A refusal with nothing of ours open says nothing about a channel
        // limit — it is some other failure, or the host has not finished
        // releasing the channels we just closed (it does that asynchronously,
        // which the live test found). Recording it would teach the app that this
        // machine allows one channel, and it would never open two again.
        if open == 0 {
            return false;
        }
        // Never widen: a refusal at 8 after one at 10 means the earlier count
        // included channels that have since closed, and the smaller number is
        // the one that has been proven.
        let previous = self.ceiling.load(Ordering::Relaxed);
        if previous == 0 || open < previous {
            self.ceiling.store(open, Ordering::Relaxed);
            return true;
        }
        false
    }
}

/// One channel's place in the budget, given back when it is dropped.
///
/// A guard rather than a manual decrement, because the alternative is an early
/// return somewhere that leaks a slot — and a leaked slot is invisible until the
/// user cannot open a terminal any more, which is exactly the failure this is
/// here to prevent.
pub struct ChannelLease {
    budget: Arc<ChannelBudget>,
}

impl Drop for ChannelLease {
    fn drop(&mut self) {
        self.budget.open.fetch_sub(1, Ordering::Relaxed);
    }
}

/// A live, host-key-verified transport to one host.
pub struct Connection {
    handle: client::Handle<Client>,
    endpoint: Endpoint,
    generation: u64,
    /// Channels in use, and what this host turned out to allow.
    budget: Arc<ChannelBudget>,
}

impl Connection {
    /// The incarnation this connection is. Travels with every mutation prepared
    /// against it (`target::TargetExpectation`).
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Where this connection is dialled. Nothing reads it yet — the reconnect
    /// ladder (`FOR-DEV.md`) is what will, since coming back needs to know where
    /// to go — and it is kept because it is this connection's *identity*, not a
    /// feature waiting to be written.
    #[allow(dead_code)]
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub fn handle(&self) -> &client::Handle<Client> {
        &self.handle
    }

    /// Mutable access, needed by the authentication exchange.
    pub fn handle_mut(&mut self) -> &mut client::Handle<Client> {
        &mut self.handle
    }

    /// Open a channel on this connection, counted against what the host allows.
    ///
    /// Every channel goes through here — terminals, the file session, each
    /// command — because the limit is per connection and counting in one place
    /// is the only way the number means anything.
    ///
    /// `wait` is what separates the two kinds of caller. A command is brief, so
    /// it queues for a slot rather than failing while another command finishes.
    /// A terminal or a file session holds its channel for as long as it lives,
    /// so it is refused straight away with what the host actually allows — a
    /// spinner that waits ten seconds for a slot that is not coming is worse
    /// than a sentence naming the limit.
    pub async fn open_channel(
        &self,
        purpose: &str,
        wait: bool,
    ) -> Result<(russh::Channel<client::Msg>, ChannelLease), AppError> {
        let deadline = tokio::time::Instant::now() + CHANNEL_WAIT;
        loop {
            if self.budget.has_room() {
                let open = self.budget.open.fetch_add(1, Ordering::Relaxed) + 1;
                let lease = ChannelLease {
                    budget: Arc::clone(&self.budget),
                };
                match self.handle.channel_open_session().await {
                    Ok(channel) => return Ok((channel, lease)),
                    Err(e) => {
                        // The host refused. `lease` is dropped as this scope
                        // ends, so the count goes back to what is really open —
                        // but the number it refused *at* is what it enforces.
                        drop(lease);
                        // `open` counted the attempt itself; what the host
                        // allowed is the number that were already up when it
                        // said no. Measured against a real `sshd`: it refuses
                        // the 11th, so its limit is 10 — quoting 11 would send
                        // the user to change a setting to a value it already
                        // has.
                        if self.budget.refused_at(open.saturating_sub(1)) {
                            // Worth recording once: it is a fact about the
                            // user's machine that the app just learned, and the
                            // next refusal will quote it.
                            crate::diagnostics::log(
                                crate::diagnostics::Level::Info,
                                "ssh",
                                &format!(
                                    "{} allows {} channels at once",
                                    self.endpoint.hostname,
                                    open.saturating_sub(1)
                                ),
                            );
                        }
                        if !wait || tokio::time::Instant::now() >= deadline {
                            return Err(self.no_channel(purpose, e));
                        }
                    }
                }
            } else if !wait || tokio::time::Instant::now() >= deadline {
                return Err(self.at_capacity(purpose));
            }
            // A slot frees when a command finishes or a terminal closes; there
            // is nothing to subscribe to, so this looks again shortly.
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    /// The host said no and has never said how many it allows.
    fn no_channel(&self, purpose: &str, error: russh::Error) -> AppError {
        match self.budget.observed_limit() {
            Some(limit) => self.at_capacity_with(purpose, limit),
            None => AppError::Invalid(format!("could not open a channel for {purpose}: {error}")),
        }
    }

    /// The host's limit is known and reached.
    fn at_capacity(&self, purpose: &str) -> AppError {
        match self.budget.observed_limit() {
            Some(limit) => self.at_capacity_with(purpose, limit),
            None => AppError::Invalid(format!("could not open a channel for {purpose}")),
        }
    }

    /// What to say when the host will not open another channel.
    ///
    /// Two things the first wording got wrong, both reported from a real host.
    /// It asserted that machine's configuration ("this host allows N") when what
    /// we actually know is that it refused *at* N — the two differ, because a
    /// channel we closed is released on the host's own schedule. And it said
    /// "close a terminal" without saying what else holds one, which is
    /// unanswerable from the interface: a user looking at two tabs cannot tell
    /// that the file panel takes a channel too, and so does every command while
    /// it runs.
    fn at_capacity_with(&self, purpose: &str, limit: usize) -> AppError {
        AppError::Invalid(format!(
            "{purpose} could not be opened: this host refused another channel with {limit} \
             already open. Each terminal on it takes one, the file panel takes one, and every \
             command takes one while it runs. Close a terminal on that host — or disconnect it \
             in Settings and connect again, which frees them all — or raise MaxSessions in its \
             sshd configuration."
        ))
    }

    /// Run one command on its own channel and collect what it printed.
    ///
    /// This is the primitive everything non-interactive is built from — the host
    /// inventory, `git` calls, version probes — and it is why the transport is an
    /// in-process client rather than a spawned `ssh` per call: each of these is a
    /// *channel* on the one connection, not a new TCP handshake and a new
    /// authentication.
    ///
    /// `stderr` is captured separately: a remote shell profile that prints noise
    /// (or fails outright, which is common on Windows over a non-interactive
    /// session) must not corrupt the output a caller is parsing.
    ///
    /// **Bounded by [`EXEC_TIMEOUT`].** Every one of these runs through a shell
    /// on someone else's machine, and a shell can stop answering — a profile
    /// that waits for input, a filesystem that hangs, a host that froze. Without
    /// a cap the future simply never completes, and the caller waits forever for
    /// a command that will never end.
    pub async fn exec(&self, command: &str) -> Result<CommandOutput, AppError> {
        tokio::time::timeout(EXEC_TIMEOUT, self.exec_unbounded(command))
            .await
            .unwrap_or_else(|_| {
                Err(AppError::Invalid(format!(
                    "the host did not answer within {}s",
                    EXEC_TIMEOUT.as_secs()
                )))
            })
    }

    /// Run a command and keep its output as **bytes**.
    ///
    /// [`exec`] turns stdout into a `String` with `from_utf8_lossy`, which is
    /// right for everything that is text and destroys anything that is not: an
    /// image blob read that way comes back as replacement characters. The lossy
    /// conversion is *our* choice, not the transport's — the channel carries
    /// bytes — so a caller that wants a file's contents can have them.
    ///
    /// The alternative was asking the host to base64 the blob for us, which
    /// needs a different tool on every OS (`base64`, `certutil`,
    /// `[Convert]::ToBase64String`) and a shell redirect whose encoding differs
    /// per shell. This needs nothing installed and no syntax at all.
    pub async fn exec_bytes(&self, command: &str) -> Result<Vec<u8>, AppError> {
        let (mut channel, _lease) = self.open_channel("this command", true).await?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::Invalid(format!("could not run a remote command: {e}")))?;

        let mut stdout = Vec::new();
        let mut exit = None;
        let collect = async {
            while let Some(msg) = channel.wait().await {
                match msg {
                    russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
                    russh::ChannelMsg::ExitStatus { exit_status } => exit = Some(exit_status),
                    _ => {}
                }
            }
        };
        tokio::time::timeout(EXEC_TIMEOUT, collect)
            .await
            .map_err(|_| {
                AppError::Invalid(format!(
                    "the host did not answer within {}s",
                    EXEC_TIMEOUT.as_secs()
                ))
            })?;
        match exit {
            Some(0) => Ok(stdout),
            // Anything else means the host produced no blob — a path that is not
            // in that revision, most often. The caller renders "no such side",
            // which is the truth, rather than an empty image.
            _ => Err(AppError::NotFound(
                "the host has nothing at that revision".to_string(),
            )),
        }
    }

    async fn exec_unbounded(&self, command: &str) -> Result<CommandOutput, AppError> {
        // A command is brief, so it queues for a slot rather than failing while
        // another one finishes. The lease is held until this returns.
        let (mut channel, _lease) = self.open_channel("this command", true).await?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| AppError::Invalid(format!("could not run a remote command: {e}")))?;

        let mut out = CommandOutput::default();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        while let Some(msg) = channel.wait().await {
            match msg {
                russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
                // Extended data type 1 is stderr; anything else is not defined
                // by the protocol and is ignored rather than merged blindly.
                russh::ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                    stderr.extend_from_slice(data)
                }
                // Do not break here: more output can still arrive after the
                // status, and truncating it would corrupt whatever we parse.
                russh::ChannelMsg::ExitStatus { exit_status } => out.exit_code = Some(exit_status),
                _ => {}
            }
        }
        out.stdout = String::from_utf8_lossy(&stdout).to_string();
        out.stderr = String::from_utf8_lossy(&stderr).to_string();
        Ok(out)
    }
}

/// What a remote command produced.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandOutput {
    pub stdout: String,
    /// Kept apart from stdout on purpose — see [`Connection::exec`].
    pub stderr: String,
    /// `None` when the channel closed without one (killed by a signal, or the
    /// connection dropped mid-command). Absence is information, so it is not
    /// flattened into a zero.
    pub exit_code: Option<u32>,
}

/// The russh client handler. Its only job is the host-key decision; it records
/// the verdict so [`connect`] can report *why* a refused handshake was refused
/// rather than collapsing every failure into "could not connect".
pub struct Client {
    known_hosts: String,
    endpoint: Endpoint,
    seen: Arc<Mutex<Option<(Verdict, PresentedKey)>>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let presented = match PresentedKey::from_ssh_key(server_public_key) {
            Ok(k) => k,
            // An unreadable key is not a host we can identify, so it is not a
            // host we connect to.
            Err(_) => return Ok(false),
        };
        let verdict = hostkey::verify(
            &self.known_hosts,
            &self.endpoint.hostname,
            self.endpoint.port,
            &presented,
        );
        let accept = matches!(verdict, Verdict::Trusted);
        if let Ok(mut slot) = self.seen.lock() {
            *slot = Some((verdict, presented));
        }
        Ok(accept)
    }
}

/// Reach `endpoint` and decide, from `known_hosts`, whether to keep the
/// connection.
///
/// Errors are reserved for *transport* failures (unreachable, timed out,
/// protocol error). A host-key refusal is not an error — it is a
/// [`Handshake`] variant, because the caller has something to show the user and
/// possibly an action to offer.
/// Why a host could not be reached, told apart.
///
/// The whole point is that these lead to **different actions**, and one failure
/// string made them look alike: a machine that is asleep is worth trying again
/// in a moment, a port that answers "no" is not, and a rejected password will
/// never fix itself no matter how many times it is retried. The reconnect ladder
/// reads this to decide whether trying again is honest or just noise, and the
/// interface reads it to say something a user can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unreachable {
    /// Nothing answered in time — asleep, off the network, or a firewall that
    /// drops rather than refuses. Worth trying again.
    Timeout,
    /// The address itself could not be resolved. Retrying rarely helps; it is a
    /// typo or a DNS/VPN that is not up.
    UnknownAddress,
    /// Something answered and said no: nothing listening on that port. Worth
    /// trying again — a machine that is still booting looks exactly like this.
    Refused,
    /// The connection was reached but the handshake failed — a protocol
    /// mismatch, or the transport dropped mid-negotiation.
    Handshake,
}

impl Unreachable {
    /// Whether trying the same thing again could plausibly work.
    ///
    /// `UnknownAddress` is the one that stays no: a name that does not resolve
    /// resolves no better on the fourth attempt, and hammering it only fills the
    /// log. (A VPN coming up would change that — but the user connecting again
    /// by hand is the honest trigger for it, not a background loop.)
    pub fn worth_retrying(self) -> bool {
        !matches!(self, Unreachable::UnknownAddress)
    }

    /// What to tell the user, naming the host so the message stands alone.
    pub fn explain(self, endpoint: &Endpoint) -> String {
        let Endpoint { hostname, port } = endpoint;
        match self {
            Unreachable::Timeout => format!(
                "{hostname}:{port} did not answer within {}s — the machine may be asleep or off \
                 this network",
                HANDSHAKE_TIMEOUT.as_secs()
            ),
            Unreachable::UnknownAddress => {
                format!("{hostname} could not be resolved to an address")
            }
            Unreachable::Refused => {
                format!("{hostname}:{port} refused the connection — nothing is listening there")
            }
            Unreachable::Handshake => {
                format!("{hostname}:{port} answered, but the SSH handshake did not complete")
            }
        }
    }
}

/// Classify a failed dial.
///
/// Matched on the io error kind where there is one, because that is the part
/// the operating system decided; the text of a library error is not a contract
/// and changes between versions.
fn classify_dial(error: &russh::Error) -> Unreachable {
    if let russh::Error::IO(io) = error {
        return match io.kind() {
            std::io::ErrorKind::ConnectionRefused => Unreachable::Refused,
            std::io::ErrorKind::TimedOut => Unreachable::Timeout,
            // No resolver entry. `HostUnreachable`/`NetworkUnreachable` are
            // still unstable as `ErrorKind`s, so the message is the only signal
            // for those and they stay under the timeout arm, which retries.
            std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput => {
                Unreachable::UnknownAddress
            }
            _ => Unreachable::Handshake,
        };
    }
    Unreachable::Handshake
}

pub async fn connect(endpoint: Endpoint, known_hosts: &str) -> Result<Handshake, AppError> {
    let seen: Arc<Mutex<Option<(Verdict, PresentedKey)>>> = Arc::new(Mutex::new(None));
    let handler = Client {
        known_hosts: known_hosts.to_string(),
        endpoint: endpoint.clone(),
        seen: Arc::clone(&seen),
    };

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(INACTIVITY_TIMEOUT),
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: KEEPALIVE_MAX_MISSED,
        ..Default::default()
    });

    let attempt = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        client::connect(config, endpoint.socket_addr(), handler),
    )
    .await;

    // Read the verdict first: when the handshake failed *because we refused the
    // key*, that is the real answer and the transport error is just its echo.
    let observed = seen.lock().ok().and_then(|s| s.clone());
    if let Some((verdict, key)) = observed {
        match verdict {
            Verdict::Changed { stored_fingerprint } => {
                return Ok(Handshake::Changed {
                    presented_fingerprint: key.fingerprint(),
                    stored_fingerprint,
                })
            }
            Verdict::Revoked => {
                return Ok(Handshake::Revoked {
                    fingerprint: key.fingerprint(),
                })
            }
            Verdict::Unknown => {
                return Ok(Handshake::Unknown {
                    fingerprint: key.fingerprint(),
                    key,
                })
            }
            Verdict::Trusted => {}
        }
    }

    let handle = match attempt {
        Ok(Ok(handle)) => handle,
        Ok(Err(e)) => {
            let why = classify_dial(&e);
            return Ok(Handshake::Unreachable {
                why,
                detail: why.explain(&endpoint),
            });
        }
        Err(_) => {
            return Ok(Handshake::Unreachable {
                why: Unreachable::Timeout,
                detail: Unreachable::Timeout.explain(&endpoint),
            })
        }
    };

    Ok(Handshake::Ready(Connection {
        handle,
        endpoint,
        generation: next_generation(),
        budget: Arc::new(ChannelBudget::default()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The port the tests use to reach an SSH server on this machine.
    const LOCAL_SSHD: u16 = 22;

    /// The classification itself, on the error kinds the OS produces. The kind
    /// is what the operating system decided; a library's error *text* is not a
    /// contract and changes between versions, which is why nothing matches on
    /// it.
    #[test]
    fn a_dial_failure_is_classified_by_what_the_os_said() {
        use std::io::{Error, ErrorKind};
        let io = |kind: ErrorKind| classify_dial(&russh::Error::IO(Error::new(kind, "x")));

        assert_eq!(io(ErrorKind::ConnectionRefused), Unreachable::Refused);
        assert_eq!(io(ErrorKind::TimedOut), Unreachable::Timeout);
        assert_eq!(io(ErrorKind::NotFound), Unreachable::UnknownAddress);
        // Anything else is the handshake's problem, not the network's.
        assert_eq!(io(ErrorKind::BrokenPipe), Unreachable::Handshake);

        // And what each one means for trying again: only a name that does not
        // resolve is hopeless — the rest can clear up on their own.
        assert!(Unreachable::Timeout.worth_retrying());
        assert!(Unreachable::Refused.worth_retrying());
        assert!(Unreachable::Handshake.worth_retrying());
        assert!(!Unreachable::UnknownAddress.worth_retrying());
    }

    /// The limit is the host's, and it is learned rather than assumed.
    #[test]
    fn a_host_s_channel_limit_is_learned_from_its_refusal() {
        let budget = ChannelBudget::default();
        // Nothing has been refused, so nothing is known — and every attempt is
        // worth making. Assuming OpenSSH's default of 10 would be this app
        // deciding what someone else's sshd is configured to do.
        assert_eq!(budget.observed_limit(), None);
        assert!(budget.has_room());

        // The host refused with 10 open: that is what it enforces.
        assert!(budget.refused_at(10));
        assert_eq!(budget.observed_limit(), Some(10));
        // Learning the same thing twice is not news.
        assert!(!budget.refused_at(10));

        // A later refusal at a *lower* count is the one that has been proven:
        // the earlier number included channels that have since closed.
        assert!(budget.refused_at(8));
        assert_eq!(budget.observed_limit(), Some(8));
        // And a refusal with nothing of ours open teaches nothing: a host
        // releases a channel asynchronously, so a failure right after closing
        // them all is not a limit of one — recording it would cripple the
        // connection for the rest of its life. The live test found this.
        assert!(!budget.refused_at(0));
        assert_eq!(budget.observed_limit(), Some(8));
        // And it never widens on a higher one.
        assert!(!budget.refused_at(12));
        assert_eq!(budget.observed_limit(), Some(8));
    }

    /// A channel's place comes back when it is dropped, whichever way it ends.
    #[test]
    fn a_lease_returns_its_slot() {
        let budget = Arc::new(ChannelBudget::default());
        budget.refused_at(2);
        budget.open.fetch_add(2, Ordering::Relaxed);
        assert!(!budget.has_room(), "two of two are in use");

        let lease = ChannelLease {
            budget: Arc::clone(&budget),
        };
        drop(lease);
        assert!(budget.has_room(), "a dropped lease frees its slot");
    }

    #[test]
    fn generations_are_monotonic_and_never_repeat() {
        // Fencing leans entirely on this: a reused number would let a mutation
        // prepared before a reconnect execute after it.
        let a = next_generation();
        let b = next_generation();
        let c = next_generation();
        assert!(a < b && b < c, "{a} {b} {c}");
    }

    /// A port with nothing behind it, dialled for real.
    ///
    /// Needs no server and no DNS: a closed port on loopback is the one network
    /// failure that can be produced anywhere. Some environments drop instead of
    /// refusing, so what is asserted is what matters — it is **not** a key
    /// verdict (offering a trust prompt for a machine that never answered would
    /// be inviting the user to trust nothing at all), it is *typed*, and it is
    /// one the reconnect ladder will try again.
    #[tokio::test]
    async fn an_unreachable_port_is_a_transport_error_not_a_key_verdict() {
        // Port 1 is reserved and nothing listens on it.
        match connect(Endpoint::new("127.0.0.1", 1), "").await {
            Ok(Handshake::Unreachable { why, detail }) => {
                assert!(
                    why.worth_retrying(),
                    "a closed port can open later: {why:?}"
                );
                assert!(
                    detail.contains("127.0.0.1:1"),
                    "the sentence names the host and the port: {detail}"
                );
            }
            Ok(Handshake::Ready(_)) => panic!("something is serving SSH on port 1"),
            Ok(_) => panic!("a closed port cannot produce a host-key verdict"),
            Err(e) => panic!("expected a typed Unreachable, got an error: {e}"),
        }
    }

    /// Live checks against the SSH server running on this machine. Ignored by
    /// default (they need a listening sshd); they connect to loopback only, and
    /// stop at the host-key decision — no credential is ever offered.
    ///
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored ssh::conn`
    mod live {
        use super::*;

        /// A connection nobody types at must still be there five minutes later.
        ///
        /// This is the one test that actually proves the keepalive, and it costs
        /// what it measures: it sits idle for longer than `INACTIVITY_TIMEOUT`
        /// and then uses the connection. Without `KEEPALIVE_INTERVAL` it fails —
        /// an SSH connection carries nothing while a shell sits at its prompt,
        /// so the inactivity timer reaped a host whose only crime was being
        /// quiet. Ignored by default for the obvious reason; run it whenever
        /// either timer is touched.
        #[tokio::test]
        #[ignore = "needs a local sshd, and idles for five minutes on purpose"]
        async fn an_idle_connection_outlives_the_inactivity_timeout() {
            use crate::ssh::auth::{authenticate, AuthOutcome, Credential};

            let user = std::env::var("UXNAN_SSH_TEST_USER")
                .or_else(|_| std::env::var("USERNAME"))
                .expect("a username");
            let endpoint = Endpoint::new("127.0.0.1", LOCAL_SSHD);
            let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
                panic!("expected an unknown host");
            };
            let trusted = super::super::hostkey::trust_line("127.0.0.1", LOCAL_SSHD, &key);
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

            let idle = INACTIVITY_TIMEOUT + Duration::from_secs(20);
            println!("live: idling {idle:?} with no traffic at all");
            tokio::time::sleep(idle).await;

            assert!(
                !conn.handle().is_closed(),
                "the connection was reaped while idle; the keepalive is not doing its job"
            );
            conn.handle()
                .channel_open_session()
                .await
                .expect("an idle connection still opens channels");
            println!("live: still usable after {idle:?}");
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn an_unknown_host_is_refused_and_reports_a_usable_fingerprint() {
            match connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), "").await {
                Ok(Handshake::Unknown { fingerprint, key }) => {
                    assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
                    assert!(!key.algorithm.is_empty());
                    println!(
                        "live: unknown host, fingerprint {fingerprint} ({})",
                        key.algorithm
                    );
                }
                Ok(_) => panic!("an empty known_hosts must never verify a host"),
                Err(e) => panic!("could not reach the local sshd: {e}"),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn trusting_the_real_key_makes_the_same_host_verify() {
            // The round trip that matters: take the key a real server presented,
            // write the line we would append to `known_hosts`, and connect
            // again. If this failed, a user who confirmed a host would be asked
            // again on every connection.
            let Ok(Handshake::Unknown { key, .. }) =
                connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), "").await
            else {
                panic!("expected an unknown host on an empty known_hosts");
            };

            let trusted = hostkey::trust_line("127.0.0.1", LOCAL_SSHD, &key);
            match connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), &trusted).await {
                Ok(Handshake::Ready(conn)) => {
                    assert_eq!(conn.endpoint().port, LOCAL_SSHD);
                    assert!(conn.generation() >= 1);
                    println!("live: verified, generation {}", conn.generation());
                }
                other => panic!(
                    "the key we just recorded should verify, got {}",
                    describe(&other)
                ),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn a_key_that_does_not_match_is_reported_as_changed_not_unknown() {
            // The man-in-the-middle shape, against a real server: a `known_hosts`
            // entry exists for this host but holds a different key.
            let Ok(Handshake::Unknown { key, .. }) =
                connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), "").await
            else {
                panic!("expected an unknown host on an empty known_hosts");
            };

            let impostor = PresentedKey {
                algorithm: key.algorithm.clone(),
                blob: vec![0xAB; key.blob.len()],
            };
            let stored = hostkey::trust_line("127.0.0.1", LOCAL_SSHD, &impostor);

            match connect(Endpoint::new("127.0.0.1", LOCAL_SSHD), &stored).await {
                Ok(Handshake::Changed {
                    presented_fingerprint,
                    stored_fingerprint,
                }) => {
                    assert_eq!(presented_fingerprint, key.fingerprint());
                    assert_eq!(stored_fingerprint, impostor.fingerprint());
                    assert_ne!(presented_fingerprint, stored_fingerprint);
                    println!("live: changed key detected, {stored_fingerprint} → {presented_fingerprint}");
                }
                other => panic!(
                    "a mismatching key must be Changed, got {}",
                    describe(&other)
                ),
            }
        }

        /// A real remote host to test against, as `host` or `host:port`.
        /// Loopback proves the protocol; only a second machine proves the
        /// network path — a tailnet address, a LAN address, whatever the
        /// operator points this at.
        const REMOTE_ENV: &str = "UXNAN_SSH_TEST_HOST";

        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_HOST=<host[:port]>; run explicitly with --ignored"]
        async fn a_real_remote_host_completes_the_trust_cycle() {
            let Ok(spec) = std::env::var(REMOTE_ENV) else {
                panic!("set {REMOTE_ENV}=<host[:port]> to run this against a real remote host");
            };
            let (host, port) = match spec.rsplit_once(':') {
                Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
                    (h.to_string(), p.parse().unwrap_or(22))
                }
                _ => (spec.clone(), 22u16),
            };

            // 1. Never seen → refused, with a fingerprint to show the user.
            let Ok(Handshake::Unknown { key, fingerprint }) =
                connect(Endpoint::new(host.clone(), port), "").await
            else {
                panic!("an empty known_hosts must refuse {host}:{port}");
            };
            println!("remote {host}:{port} → {fingerprint} ({})", key.algorithm);

            // 2. Recorded → verifies, and the transport is up.
            let trusted = hostkey::trust_line(&host, port, &key);
            let Ok(Handshake::Ready(conn)) =
                connect(Endpoint::new(host.clone(), port), &trusted).await
            else {
                panic!("the key just recorded should verify");
            };
            assert_eq!(conn.endpoint().hostname, host);
            println!("remote verified, generation {}", conn.generation());

            // 3. Someone else's key on file → refused as changed, not as new.
            let impostor = PresentedKey {
                algorithm: key.algorithm.clone(),
                blob: vec![0x5A; key.blob.len()],
            };
            let stored = hostkey::trust_line(&host, port, &impostor);
            match connect(Endpoint::new(host, port), &stored).await {
                Ok(Handshake::Changed {
                    presented_fingerprint,
                    stored_fingerprint,
                }) => {
                    assert_eq!(presented_fingerprint, key.fingerprint());
                    assert_ne!(presented_fingerprint, stored_fingerprint);
                    println!("remote mismatch correctly reported as changed");
                }
                other => panic!(
                    "a mismatching key must be Changed, got {}",
                    describe(&other)
                ),
            }
        }

        fn describe(outcome: &Result<Handshake, AppError>) -> String {
            match outcome {
                Ok(Handshake::Ready(_)) => "Ready".into(),
                Ok(Handshake::Unknown { .. }) => "Unknown".into(),
                Ok(Handshake::Changed { .. }) => "Changed".into(),
                Ok(Handshake::Revoked { .. }) => "Revoked".into(),
                Ok(Handshake::Unreachable { why, .. }) => format!("Unreachable({why:?})"),
                Err(e) => format!("Err({e})"),
            }
        }
    }
}
