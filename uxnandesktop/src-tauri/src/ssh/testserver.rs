//! An SSH server inside the test process, so the transport can be proven
//! against a real peer on every `cargo test` — no Docker, no system `sshd`, no
//! network beyond loopback.
//!
//! It speaks the actual protocol (it is the same SSH library's server half),
//! which is what makes it worth having: a second factor that arrives in two
//! rounds, a key that is only "partially" enough, a bastion that opens a
//! `direct-tcpip` tunnel to the next machine, a host that asks our agent to
//! sign. Each is a behaviour of real servers the client must handle, and each is
//! configured here per test.
//!
//! What it does not try to be is a shell: `exec` answers a few fixed commands
//! (`echo …`, `agent-identities`) and nothing else.

#![cfg(test)]

use std::sync::{Arc, Mutex};

use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::{PrivateKey, PublicKey};
use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};

/// A deterministic key, so tests need no randomness and no `ssh-keygen`.
pub fn key(seed: u8) -> PrivateKey {
    PrivateKey::from(Ed25519Keypair::from_seed(&[seed; 32]))
}

/// What one test server accepts.
#[derive(Clone, Default)]
pub struct Spec {
    pub user: String,
    pub password: Option<String>,
    /// Public keys that may sign in.
    pub authorized: Vec<PublicKey>,
    /// A one-time code asked for over keyboard-interactive.
    pub code: Option<String>,
    /// `AuthenticationMethods publickey,keyboard-interactive`: an authorized key
    /// is only partial success, and the code is still owed.
    pub key_then_code: bool,
    /// Keyboard-interactive asks the password first, then the code, in two
    /// rounds — how PAM with a second factor behaves.
    pub password_then_code: bool,
    /// Open `direct-tcpip` tunnels to loopback ports (act as a bastion).
    pub bastion: bool,
}

/// A running server and what it observed.
pub struct TestServer {
    pub port: u16,
    pub host_key: PrivateKey,
    pub seen: Arc<Mutex<Vec<String>>>,
}

impl TestServer {
    pub fn saw(&self, what: &str) -> bool {
        self.seen.lock().unwrap().iter().any(|s| s == what)
    }

    /// The `known_hosts` line that trusts this server on loopback.
    pub fn trust_line(&self) -> String {
        let presented =
            super::hostkey::PresentedKey::from_ssh_key(self.host_key.public_key()).unwrap();
        super::hostkey::trust_line("127.0.0.1", self.port, &presented)
    }
}

/// Start a server on a loopback port, with the given host-key seed.
pub async fn start(spec: Spec, host_seed: u8) -> TestServer {
    let host_key = key(host_seed);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let config = Arc::new(server::Config {
        keys: vec![host_key.clone()],
        auth_rejection_time: std::time::Duration::from_millis(1),
        auth_rejection_time_initial: Some(std::time::Duration::from_millis(0)),
        methods: MethodSet::from(
            &[
                MethodKind::PublicKey,
                MethodKind::Password,
                MethodKind::KeyboardInteractive,
            ][..],
        ),
        ..Default::default()
    });
    let spec = Arc::new(spec);
    let seen_by_server = Arc::clone(&seen);
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let handler = Handler {
                spec: Arc::clone(&spec),
                seen: Arc::clone(&seen_by_server),
                key_ok: false,
                round: 0,
                agent_asked: false,
            };
            let config = Arc::clone(&config);
            tokio::spawn(async move {
                if let Ok(session) = server::run_stream(config, socket, handler).await {
                    let _ = session.await;
                }
            });
        }
    });
    TestServer {
        port,
        host_key,
        seen,
    }
}

struct Handler {
    spec: Arc<Spec>,
    seen: Arc<Mutex<Vec<String>>>,
    /// The key half of `key_then_code` succeeded.
    key_ok: bool,
    /// Which keyboard-interactive round this is.
    round: usize,
    agent_asked: bool,
}

impl Handler {
    fn note(&self, what: impl Into<String>) {
        self.seen.lock().unwrap().push(what.into());
    }

    fn methods(&self) -> MethodSet {
        let mut kinds = Vec::new();
        if !self.key_ok && (!self.spec.authorized.is_empty() || self.spec.key_then_code) {
            kinds.push(MethodKind::PublicKey);
        }
        if self.spec.password.is_some() && !self.spec.password_then_code && !self.spec.key_then_code
        {
            kinds.push(MethodKind::Password);
        }
        if self.spec.code.is_some() || self.spec.password_then_code {
            kinds.push(MethodKind::KeyboardInteractive);
        }
        MethodSet::from(&kinds[..])
    }

    fn reject(&self) -> Auth {
        Auth::Reject {
            proceed_with_methods: Some(self.methods()),
            partial_success: false,
        }
    }
}

impl server::Handler for Handler {
    type Error = russh::Error;

    async fn auth_none(&mut self, _user: &str) -> Result<Auth, Self::Error> {
        Ok(self.reject())
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        self.note(format!("password:{password}"));
        if user == self.spec.user && self.spec.password.as_deref() == Some(password) {
            return Ok(Auth::Accept);
        }
        Ok(self.reject())
    }

    async fn auth_publickey_offered(
        &mut self,
        _user: &str,
        _key: &PublicKey,
    ) -> Result<Auth, Self::Error> {
        Ok(Auth::Accept)
    }

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        let known = self
            .spec
            .authorized
            .iter()
            .any(|k| k.key_data() == key.key_data());
        self.note(format!(
            "publickey:{}",
            if known { "ok" } else { "refused" }
        ));
        if user != self.spec.user || !known {
            return Ok(self.reject());
        }
        if self.spec.key_then_code {
            self.key_ok = true;
            return Ok(Auth::Reject {
                proceed_with_methods: Some(MethodSet::from(&[MethodKind::KeyboardInteractive][..])),
                partial_success: true,
            });
        }
        Ok(Auth::Accept)
    }

    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _submethods: &str,
        response: Option<server::Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        if user != self.spec.user || (self.spec.key_then_code && !self.key_ok) {
            return Ok(self.reject());
        }
        let answers: Vec<String> = response
            .map(|r| r.map(|b| String::from_utf8_lossy(&b).to_string()).collect())
            .unwrap_or_default();
        let password_round = self.spec.password_then_code && self.round == 0;
        let ask = |text: &'static str, echo: bool| Auth::Partial {
            name: "".into(),
            instructions: "".into(),
            prompts: vec![(text.into(), echo)].into(),
        };
        if answers.is_empty() {
            return Ok(if password_round {
                ask("Password: ", false)
            } else {
                ask("Verification code: ", true)
            });
        }
        self.note(format!("answer:{}", answers.join("|")));
        if password_round {
            if self.spec.password.as_deref() == answers.first().map(String::as_str) {
                self.round = 1;
                return Ok(ask("Verification code: ", true));
            }
            return Ok(self.reject());
        }
        if self.spec.code.as_deref() == answers.first().map(String::as_str) {
            return Ok(Auth::Accept);
        }
        Ok(self.reject())
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn agent_request(
        &mut self,
        _channel: ChannelId,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.agent_asked = true;
        self.note("agent-forward-requested");
        Ok(true)
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let command = String::from_utf8_lossy(data).to_string();
        let handle = session.handle();
        let agent_asked = self.agent_asked;
        tokio::spawn(async move {
            let out = if let Some(rest) = command.strip_prefix("echo ") {
                format!("{rest}\n")
            } else if command == "agent-identities" && agent_asked {
                // Ask the forwarded agent how many keys it holds:
                // SSH_AGENTC_REQUEST_IDENTITIES, and read the count back.
                match handle.channel_open_agent().await {
                    Ok(agent) => format!("{}\n", count_agent_identities(agent).await),
                    Err(_) => "no-agent\n".to_string(),
                }
            } else {
                "unknown\n".to_string()
            };
            let _ = handle.data(channel, out.into_bytes()).await;
            let _ = handle.exit_status_request(channel, 0).await;
            let _ = handle.eof(channel).await;
            let _ = handle.close(channel).await;
        });
        Ok(())
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if !self.spec.bastion {
            return Ok(());
        }
        self.note(format!("tunnel:{host_to_connect}:{port_to_connect}"));
        let Ok(mut upstream) =
            tokio::net::TcpStream::connect((host_to_connect.to_string(), port_to_connect as u16))
                .await
        else {
            return Ok(());
        };
        reply.accept().await;
        tokio::spawn(async move {
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut upstream).await;
        });
        Ok(())
    }
}

/// Speak just enough of the agent protocol to count identities.
async fn count_agent_identities(agent: Channel<Msg>) -> u32 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = agent.into_stream();
    // uint32 length = 1, byte SSH_AGENTC_REQUEST_IDENTITIES = 11
    if stream.write_all(&[0, 0, 0, 1, 11]).await.is_err() {
        return 0;
    }
    let mut header = [0u8; 9];
    if stream.read_exact(&mut header).await.is_err() {
        return 0;
    }
    // uint32 length, byte SSH_AGENT_IDENTITIES_ANSWER = 12, uint32 nkeys
    if header[4] != 12 {
        return 0;
    }
    u32::from_be_bytes([header[5], header[6], header[7], header[8]])
}
