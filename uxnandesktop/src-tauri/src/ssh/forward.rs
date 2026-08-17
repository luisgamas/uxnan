//! A port on the host, reachable from this machine.
//!
//! **What this is.** A dev server started on a host listens on *that* machine's
//! loopback, where nothing here can reach it — the whole point of `localhost` is
//! that it is not shared. A forward is a socket opened here that carries every
//! connection to that port over the SSH connection the host already has, which
//! is what `ssh -L` does and what makes a remote project feel like a local one:
//! the integrated browser opens `http://127.0.0.1:<port>` and gets the page
//! running there.
//!
//! **Loopback only, deliberately.** The listener binds `127.0.0.1`, never
//! `0.0.0.0`. Binding the wildcard would republish someone else's development
//! server to every machine on this network, which is a decision no user asked
//! for by clicking "open".
//!
//! **The same port number when it can.** Web applications write their own
//! address into redirects, cookies and generated asset URLs, so a page served on
//! 5173 and opened on 49871 breaks in ways that look like the app is broken. So
//! the same number is taken when it is free, and when it is not the one actually
//! used is reported rather than silently substituted.
//!
//! **Channels, and why these do not queue.** Everything else on a connection
//! goes through [`Connection::open_channel`], which counts against what the host
//! allows, because `MaxSessions` limits *sessions* — shells, exec, subsystems.
//! A forward opens `direct-tcpip` channels instead, one per TCP connection, and
//! OpenSSH explicitly does not apply `MaxSessions` to those. Counting them in
//! the same budget would let one page load (dozens of parallel requests) report
//! the host as out of terminals. Measured rather than believed: the live test
//! below carries twelve simultaneous connections over one forward against a host
//! whose `MaxSessions` is the default ten, and all twelve are answered.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, Notify};

use super::conn::Connection;
use crate::error::AppError;

/// One live forward, as the UI knows it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInfo {
    /// Stable within a run: `<host id>:<remote port>`. A host cannot forward the
    /// same remote port twice, so the pair *is* the identity.
    pub id: String,
    pub host_id: String,
    /// The port as it is on the host — what the user sees in their dev server.
    pub remote_port: u16,
    /// The port on this machine. Equal to `remote_port` whenever it was free.
    pub local_port: u16,
    /// Which incarnation of the connection carries it, so a forward left over
    /// from a previous connection is recognisable rather than merely stale
    /// (`crate::target`).
    pub generation: u64,
    /// Connections carried since it opened — the only honest sign of life a
    /// tunnel has. A forward with zero has never been used, which is worth
    /// telling apart from one that is working.
    pub connections: u64,
    /// Connections the host would not carry.
    pub failures: u64,
    /// Whether the host could reach that port the last time it was tried. A
    /// tunnel can exist perfectly well with nothing at the far end.
    pub reachable: bool,
    /// Why the host said no, when it did.
    pub refusal: Option<Refusal>,
    /// Where on the host the tunnel actually knocks. `127.0.0.1` for the normal
    /// case; another address when the service is pinned to one interface there
    /// and the host's own loopback answers nothing (`ssh::ports`).
    pub address: String,
}

/// Why a host would not carry a connection to one of its own ports.
///
/// **The two cases are genuinely different, and SSH tells them apart** — the
/// channel-open failure carries a reason code, which the first version of this
/// threw away into a log line. One is a server setting the user can change; the
/// other says the port is not where we looked. Reporting either as "could not
/// open" makes the user guess between them.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Refusal {
    /// A stable id the interface translates (`forwardingDisabled`,
    /// `nothingListening`, `other`) — the words belong to the UI's language,
    /// not to this layer.
    pub kind: RefusalKind,
    /// What SSH actually said, kept for the tooltip and the log. Never the only
    /// thing shown: it is protocol wording, not an explanation.
    pub detail: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefusalKind {
    /// `SSH_OPEN_ADMINISTRATIVELY_PROHIBITED`: that machine's `sshd` refuses to
    /// forward at all (`AllowTcpForwarding no`). Nothing about the port.
    ForwardingDisabled,
    /// `SSH_OPEN_CONNECT_FAILED`: the host tried and nothing answered on its own
    /// `127.0.0.1:<port>`. The usual cause is a service bound to one specific
    /// address (a VPN interface, a LAN address) rather than to every one.
    NothingListening,
    /// Anything else, shown as-is.
    Other,
}

impl Refusal {
    /// Read a channel-open failure for what it means.
    fn from_error(error: &russh::Error) -> Self {
        let detail = error.to_string();
        let kind = match error {
            russh::Error::ChannelOpenFailure(
                russh::ChannelOpenFailure::AdministrativelyProhibited,
            ) => RefusalKind::ForwardingDisabled,
            russh::Error::ChannelOpenFailure(russh::ChannelOpenFailure::ConnectFailed) => {
                RefusalKind::NothingListening
            }
            _ => RefusalKind::Other,
        };
        Self { kind, detail }
    }
}

/// The id every caller uses for a forward, derived rather than generated so the
/// frontend can name one it has not been told about yet.
pub fn forward_id(host_id: &str, remote_port: u16) -> String {
    format!("{host_id}:{remote_port}")
}

/// What a forward has actually done, shared between the accept loop, the
/// connections it spawned, and whoever lists them.
///
/// It exists because the first version of this reported a tunnel as if opening
/// the socket were the whole story. It is not: a forward can sit there while
/// every connection through it is refused at the far end, and the only record of
/// that was a log line nobody reads at the moment it matters.
#[derive(Default)]
struct Stats {
    connections: AtomicU64,
    failures: AtomicU64,
    /// The last thing the host said no with. Cleared by a connection that works,
    /// so a tunnel that started failing and then recovered does not keep
    /// accusing the host.
    refusal: std::sync::Mutex<Option<Refusal>>,
}

impl Stats {
    fn carried(&self) {
        self.connections.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut refusal) = self.refusal.lock() {
            *refusal = None;
        }
    }

    fn refused(&self, refusal: Refusal) {
        self.failures.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut held) = self.refusal.lock() {
            *held = Some(refusal);
        }
    }

    fn last_refusal(&self) -> Option<Refusal> {
        self.refusal.lock().ok().and_then(|r| r.clone())
    }
}

struct Live {
    info: ForwardInfo,
    /// What it has carried and what was refused; read into [`ForwardInfo`] on
    /// listing.
    stats: Arc<Stats>,
    /// The accept loop, which **owns the listener**. Closing aborts it and waits
    /// for it to be gone, because that drop is what frees the socket.
    ///
    /// Measured, not assumed: signalling the loop and letting it notice was not
    /// enough — the operating system completes the handshake for anything in the
    /// backlog while the socket exists, so a connection made right after "close"
    /// was still accepted. A closed forward has to *stop listening*.
    accept: tokio::task::JoinHandle<()>,
    /// Notified when the forward is closed, which ends the connections it is
    /// still carrying. Those are their own tasks, so aborting the accept loop
    /// says nothing to them.
    cancel: Arc<Notify>,
}

#[derive(Default)]
pub struct ForwardManager {
    open: Mutex<HashMap<String, Live>>,
}

fn log(message: &str) {
    crate::diagnostics::log(crate::diagnostics::Level::Info, "ssh-forward", message);
}

impl ForwardManager {
    /// Open a forward from this machine to `remote_port` on `host_id`, and say
    /// whether the host can actually reach that port.
    ///
    /// **The reachability check is the point of asking twice.** Opening a socket
    /// here always works; whether anything answers on the other side is a
    /// different question, and the browser answering it is the worst way to find
    /// out — a webview error page cannot say *why*. So one probe channel is
    /// opened and closed before returning, which costs milliseconds on a
    /// connection that already exists, and its refusal is reported as itself.
    ///
    /// Asking for one that already exists re-probes rather than answering from
    /// memory: the second click is usually someone retrying because the first
    /// did not work, and the service may well have started since.
    pub async fn open(
        &self,
        host_id: &str,
        conn: &Arc<Connection>,
        remote_port: u16,
        addresses: &[String],
    ) -> Result<ForwardInfo, AppError> {
        let id = forward_id(host_id, remote_port);
        let (address, refusal) = reachable_address(conn, remote_port, addresses).await;
        if let Some(refusal) = &refusal {
            log(&format!(
                "{host_id} will not carry a connection to {address}:{remote_port}: {}",
                refusal.detail
            ));
        }

        if let Some(live) = self.open.lock().await.get(&id) {
            match &refusal {
                Some(refusal) => live.stats.refused(refusal.clone()),
                // A probe that worked is proof the far end is there, so a stale
                // refusal must not outlive it.
                None => {
                    if let Ok(mut held) = live.stats.refusal.lock() {
                        *held = None;
                    }
                }
            }
            return Ok(live.snapshot());
        }

        let listener = bind_loopback(remote_port).await?;
        let local_port = listener
            .local_addr()
            .map_err(|e| AppError::Invalid(format!("could not name the local port: {e}")))?
            .port();

        let cancel = Arc::new(Notify::new());
        let stats = Arc::new(Stats::default());
        if let Some(refusal) = refusal {
            stats.refused(refusal);
            // Not counted as a failed connection: nobody asked for one yet.
            stats.failures.store(0, Ordering::Relaxed);
        }
        let info = ForwardInfo {
            id: id.clone(),
            host_id: host_id.to_string(),
            remote_port,
            local_port,
            generation: conn.generation(),
            connections: 0,
            failures: 0,
            reachable: true,
            refusal: None,
            address: address.clone(),
        };

        let accept = tokio::spawn(accept_loop(
            listener,
            Arc::clone(conn),
            Destination {
                address,
                port: remote_port,
            },
            local_port,
            Arc::clone(&cancel),
            Arc::clone(&stats),
        ));

        log(&format!(
            "forwarding 127.0.0.1:{local_port} to port {remote_port} on {host_id}"
        ));
        let live = Live {
            info,
            stats,
            accept,
            cancel,
        };
        let snapshot = live.snapshot();
        self.open.lock().await.insert(id, live);
        Ok(snapshot)
    }

    /// Close one forward. `false` when there was none — closing twice is a
    /// no-op, not an error, for the same reason opening twice is.
    ///
    /// Returns once the socket is really gone: the caller's next act is often to
    /// tell the user it is closed, and a port that still answers after that is
    /// worse than one that took a moment to go.
    pub async fn close(&self, id: &str) -> bool {
        let Some(live) = self.open.lock().await.remove(id) else {
            return false;
        };
        live.stop().await;
        log(&format!("closed the forward {id}"));
        true
    }

    /// Close every forward on a host. Called when its connection goes away:
    /// a tunnel over a connection that no longer exists cannot carry anything,
    /// and leaving its socket open here would accept connections into nothing.
    pub async fn close_host(&self, host_id: &str) {
        let doomed: Vec<Live> = {
            let mut open = self.open.lock().await;
            let ids: Vec<String> = open
                .iter()
                .filter(|(_, live)| live.info.host_id == host_id)
                .map(|(id, _)| id.clone())
                .collect();
            ids.iter().filter_map(|id| open.remove(id)).collect()
        };
        if doomed.is_empty() {
            return;
        }
        let closed = doomed.len();
        for live in doomed {
            live.stop().await;
        }
        log(&format!("closed {closed} forward(s) on {host_id}"));
    }

    /// Every live forward, newest first by nothing in particular — the frontend
    /// sorts by port, which is the order a person looks for one in.
    pub async fn list(&self) -> Vec<ForwardInfo> {
        self.open
            .lock()
            .await
            .values()
            .map(Live::snapshot)
            .collect()
    }
}

impl Live {
    /// End it: the listener first (dropping it is what frees the port), then the
    /// connections it was carrying.
    async fn stop(self) {
        self.accept.abort();
        // Awaiting the abort is the difference between "asked to stop" and
        // "stopped": until this returns, the task still owns its listener.
        let _ = self.accept.await;
        self.cancel.notify_waiters();
    }

    fn snapshot(&self) -> ForwardInfo {
        let refusal = self.stats.last_refusal();
        ForwardInfo {
            connections: self.stats.connections.load(Ordering::Relaxed),
            failures: self.stats.failures.load(Ordering::Relaxed),
            reachable: refusal.is_none(),
            refusal,
            ..self.info.clone()
        }
    }
}

/// Bind the same port number when it is free, any free port when it is not.
///
/// `AddrInUse` is the only failure worth a second attempt: everything else
/// (permission on a privileged port, a loopback that is not there) would fail
/// again on port 0 and is better reported as itself.
async fn bind_loopback(preferred: u16) -> Result<TcpListener, AppError> {
    match TcpListener::bind(("127.0.0.1", preferred)).await {
        Ok(listener) => Ok(listener),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| {
                AppError::Invalid(format!("no port on this machine could be opened: {e}"))
            })
        }
        Err(e) => Err(AppError::Invalid(format!(
            "port {preferred} could not be opened on this machine: {e}"
        ))),
    }
}

/// Where on the host a tunnel knocks: an address as **that machine** sees it,
/// and a port.
#[derive(Debug, Clone)]
struct Destination {
    address: String,
    port: u16,
}

/// Accept connections until the forward is closed, carrying each one over its
/// own `direct-tcpip` channel.
async fn accept_loop(
    listener: TcpListener,
    conn: Arc<Connection>,
    destination: Destination,
    local_port: u16,
    cancel: Arc<Notify>,
    stats: Arc<Stats>,
) {
    // Ending this task is what closes the forward, because it owns the listener
    // and dropping it is what frees the port (see [`Live::stop`]). It therefore
    // watches for nothing: a cancellation flag here would only decide *when* the
    // loop stops asking, while the socket kept answering.
    loop {
        let Ok((socket, _)) = listener.accept().await else {
            // The listener itself failed, which it does not recover from.
            log(&format!(
                "the forward on 127.0.0.1:{local_port} stopped accepting"
            ));
            return;
        };
        tokio::spawn(carry(
            socket,
            Arc::clone(&conn),
            destination.clone(),
            local_port,
            Arc::clone(&cancel),
            Arc::clone(&stats),
        ));
    }
}

/// Carry one accepted connection to the host's port and back.
async fn carry(
    mut socket: TcpStream,
    conn: Arc<Connection>,
    destination: Destination,
    local_port: u16,
    cancel: Arc<Notify>,
    stats: Arc<Stats>,
) {
    let channel = match open_to_host(&conn, &destination, local_port).await {
        Ok(channel) => {
            stats.carried();
            channel
        }
        Err(refusal) => {
            // Recorded on the forward, not only in the log. A tunnel whose every
            // connection is refused used to look identical to one that works,
            // and the only place that said otherwise was a log line — read after
            // the fact, if at all.
            log(&format!(
                "the host refused a connection to {}:{}: {}",
                destination.address, destination.port, refusal.detail
            ));
            stats.refused(refusal);
            return;
        }
    };

    let mut stream = channel.into_stream();
    tokio::select! {
        _ = cancel.notified() => {}
        result = tokio::io::copy_bidirectional(&mut socket, &mut stream) => {
            if let Err(e) = result {
                // Ordinary: a page load ends by one side hanging up. Only worth
                // the log line, never the user's attention.
                log(&format!("a forwarded connection ended: {e}"));
            }
        }
    }
}

/// Open one channel to `destination` on the host, reading a refusal for what it
/// means.
async fn open_to_host(
    conn: &Connection,
    destination: &Destination,
    local_port: u16,
) -> Result<russh::Channel<russh::client::Msg>, Refusal> {
    conn.handle()
        .channel_open_direct_tcpip(
            destination.address.clone(),
            destination.port as u32,
            "127.0.0.1",
            local_port as u32,
        )
        .await
        .map_err(|e| Refusal::from_error(&e))
}

/// The host's own loopback: where a forward knocks unless the port is known to
/// be somewhere else on that machine.
const HOST_LOOPBACK: &str = "127.0.0.1";

/// Pick the address on the host that actually answers, trying its loopback first
/// and then whatever the port scan reported.
///
/// **Why more than one address.** A forward exists to reach what a machine keeps
/// on its own loopback, and that is the normal case. But a service bound to one
/// specific address of that machine — a VPN interface, a LAN address — answers
/// nothing on `127.0.0.1` there, so a tunnel aimed at it reaches nothing and the
/// user is told their dev server is broken. The scan already knows that address
/// (`ssh::ports::ListeningPort::address`), so it is tried rather than guessed at.
///
/// Returns the address that answered, or the last one tried with the refusal it
/// gave — a tunnel is opened either way, since the service may start later.
async fn reachable_address(
    conn: &Connection,
    port: u16,
    addresses: &[String],
) -> (String, Option<Refusal>) {
    let mut candidates: Vec<String> = vec![HOST_LOOPBACK.to_string()];
    for address in addresses {
        let address = address.trim();
        // Only what a scan could have produced: an address, never a shell word.
        // Nothing here reaches a shell, but a destination with spaces in it is
        // not an address either way.
        if address.is_empty() || address.contains(char::is_whitespace) {
            continue;
        }
        if !candidates.iter().any(|c| c == address) {
            candidates.push(address.to_string());
        }
    }

    let mut last = (HOST_LOOPBACK.to_string(), None);
    for candidate in candidates {
        let destination = Destination {
            address: candidate.clone(),
            port,
        };
        match probe(conn, &destination).await {
            None => return (candidate, None),
            Some(refusal) => last = (candidate, Some(refusal)),
        }
    }
    last
}

/// How long a probe waits to see whether the channel it just opened survives.
///
/// Long enough for one round trip on a link that goes through a VPN, short
/// enough to sit inside a click. What is being waited for is a channel dying,
/// which the host reports as soon as its own connect fails.
const PROBE_GRACE: std::time::Duration = std::time::Duration::from_millis(600);

/// Ask the host, once, whether it can reach that port at all — the check that
/// turns "it did not work" into a sentence.
///
/// **Opening the channel is not the answer, and assuming it was is what made the
/// first version useless.** Measured against a real `sshd`: asking for a port
/// with nothing behind it does **not** fail the channel open. The server accepts
/// the channel and then closes it the moment its own `connect()` fails — so a
/// probe that only looked at the open call reported every dead port as fine, the
/// browser got a connection that ended with no bytes, and the app had nothing to
/// say about it. So the probe opens the channel and waits briefly to see whether
/// it dies.
///
/// `0` as the originating port is honest: no local socket is involved here.
async fn probe(conn: &Connection, destination: &Destination) -> Option<Refusal> {
    let mut channel = match open_to_host(conn, destination, 0).await {
        Ok(channel) => channel,
        // The host refused outright: `AllowTcpForwarding no`, or a server that
        // does resolve the destination before answering.
        Err(refusal) => return Some(refusal),
    };

    let died = matches!(
        tokio::time::timeout(PROBE_GRACE, channel.wait()).await,
        Ok(Some(russh::ChannelMsg::Eof | russh::ChannelMsg::Close) | None)
    );
    let _ = channel.eof().await;
    died.then(|| Refusal {
        kind: RefusalKind::NothingListening,
        detail: format!(
            "the host opened the tunnel and closed it at once — nothing answered on {}:{} there",
            destination.address, destination.port
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_forward_is_named_by_its_host_and_port() {
        // The frontend derives this id before the backend has answered, so it
        // can show the row as pending. It must not be a random one.
        assert_eq!(forward_id("h1", 5173), "h1:5173");
    }

    #[tokio::test]
    async fn it_takes_the_same_port_number_when_it_is_free() {
        // Same number matters: an app writes its own address into redirects and
        // cookies, so a different one breaks pages that are working fine.
        let probe = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let free = probe.local_addr().unwrap().port();
        drop(probe);

        let listener = bind_loopback(free).await.unwrap();
        assert_eq!(listener.local_addr().unwrap().port(), free);
    }

    #[tokio::test]
    async fn a_taken_port_falls_back_to_a_free_one_instead_of_failing() {
        // The failure this rules out: "open" doing nothing because something
        // unrelated on this machine happens to hold that number.
        let held = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let taken = held.local_addr().unwrap().port();

        let listener = bind_loopback(taken).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_ne!(port, taken, "it cannot have taken the held port");
        assert_ne!(port, 0, "and it has to be a real port");
    }

    #[tokio::test]
    async fn it_listens_on_loopback_only() {
        // Never the wildcard: forwarding is not publishing someone else's dev
        // server to the network this machine is on.
        let listener = bind_loopback(0).await.unwrap();
        assert_eq!(listener.local_addr().unwrap().ip().to_string(), "127.0.0.1");
    }

    #[tokio::test]
    async fn closing_one_that_is_not_open_is_a_no_op() {
        let manager = ForwardManager::default();
        assert!(!manager.close("h1:5173").await);
        assert!(manager.list().await.is_empty());
    }

    /// The whole tunnel, against the `sshd` of this machine: a server nothing
    /// here would otherwise reach, opened as a forward, and answered through it.
    ///
    /// It is deliberately end to end. The unit tests above cover which port is
    /// bound; what they cannot show is the part that only a real server does —
    /// that a `direct-tcpip` channel carries bytes both ways and that closing
    /// the forward actually stops it.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn forward_live_carries_a_connection_and_stops_on_close() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        // A server on loopback, standing in for a dev server on the host.
        let served = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let served_port = served.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = served.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4];
                    if socket.read_exact(&mut buf).await.is_ok() {
                        let _ = socket.write_all(b"pong").await;
                    }
                });
            }
        });

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

        let manager = ForwardManager::default();
        let info = manager
            .open("live", &Arc::new(conn), served_port, &[])
            .await
            .expect("a forward");
        // The preferred number is held by the server itself here, so this also
        // exercises the fallback — and it must not have silently reused it.
        assert_ne!(info.local_port, served_port);
        println!(
            "live: 127.0.0.1:{} carries port {}",
            info.local_port, info.remote_port
        );

        let mut client = TcpStream::connect(("127.0.0.1", info.local_port))
            .await
            .expect("the forward accepts a connection");
        client.write_all(b"ping").await.unwrap();
        let mut answer = [0u8; 4];
        client.read_exact(&mut answer).await.unwrap();
        assert_eq!(&answer, b"pong", "the bytes crossed both ways");

        // More at once than `MaxSessions` allows — its default is 10 — because
        // this is the claim the design rests on: `direct-tcpip` channels are not
        // sessions, so a page load's worth of parallel requests must not run the
        // connection out of terminals. One page opens far more than twelve.
        let mut carried = Vec::new();
        for _ in 0..12 {
            let port = info.local_port;
            carried.push(tokio::spawn(async move {
                let mut socket = TcpStream::connect(("127.0.0.1", port)).await?;
                socket.write_all(b"ping").await?;
                let mut answer = [0u8; 4];
                socket.read_exact(&mut answer).await?;
                Ok::<[u8; 4], std::io::Error>(answer)
            }));
        }
        for task in carried {
            assert_eq!(
                &task.await.unwrap().expect("a concurrent request"),
                b"pong",
                "twelve at once, on a host that allows ten sessions"
            );
        }

        // Listed while it is open, with every connection it carried counted.
        let listed = manager.list().await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].connections, 13);

        // And closed means closed: the socket is gone, so a new connection is
        // refused rather than accepted into a tunnel nobody is carrying.
        assert!(manager.close(&info.id).await);
        assert!(manager.list().await.is_empty());
        let refused = TcpStream::connect(("127.0.0.1", info.local_port)).await;
        assert!(refused.is_err(), "a closed forward stops listening");
    }

    /// A port with nothing behind it must say **that**, before a browser is sent
    /// at it.
    ///
    /// This is the case a real host hit: the tunnel opened, the preview showed a
    /// generic "cannot reach this site", and the only record of why was a log
    /// line. SSH distinguishes "forwarding is disabled here" from "I tried and
    /// nothing answered"; the app now carries the difference to the user.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn forward_live_says_when_the_host_has_nothing_on_that_port() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

        // A port that is free *on the host* — which here is this machine.
        let probe = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let empty = probe.local_addr().unwrap().port();
        drop(probe);

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

        let manager = ForwardManager::default();
        let info = manager
            .open("live", &Arc::new(conn), empty, &[])
            .await
            .expect("the tunnel still opens — the port here is ours to bind");
        println!(
            "live: port {empty} reported {:?}",
            info.refusal.as_ref().map(|r| r.kind)
        );

        assert!(!info.reachable, "nothing is listening on that port");
        assert_eq!(
            info.refusal.map(|r| r.kind),
            Some(RefusalKind::NothingListening),
            "and the reason is the host's, not a guess"
        );
        manager.close(&info.id).await;
    }
}
