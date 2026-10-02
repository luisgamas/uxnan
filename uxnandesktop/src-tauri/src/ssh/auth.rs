//! Proving who you are to a host, in the order OpenSSH would — and asking the
//! person only when nothing they already unlocked will do.
//!
//! **No secret is ever written by the app.** A credential here is a
//! *reference* — "the agent this host's configuration names", "the key at this
//! path" — or something the user typed, which lives in memory for the app's
//! session (`super::secrets`) and nowhere else.
//!
//! The order is the part that decides how often someone is interrupted:
//!
//! 1. keys the configuration names **that the agent already holds** — unlocked
//!    once, usable everywhere;
//! 2. keys the configuration names that can be opened without asking (not
//!    encrypted, or encrypted with a passphrase given earlier this session);
//! 3. every other key in the agent, unless `IdentitiesOnly` says not to;
//! 4. only then an encrypted key nobody has unlocked — which is the one step
//!    that has to stop and ask. OpenSSH asks for that passphrase as soon as it
//!    meets the key, even when an agent key further down would have worked;
//!    asking last means a working agent never causes a prompt.
//!
//! After keys come password and keyboard-interactive. A keyboard-interactive
//! server may ask anything — a one-time code, a second factor, a question with
//! visible echo — so its prompts are handed to the person exactly as the server
//! sent them ([`AuthOutcome::NeedsAnswers`]), and the conversation waits on the
//! same connection until they answer. Only a single hidden prompt that reads as
//! a password is answered on their behalf, with the password they already gave.
//!
//! "Partial success" is honoured: a server configured to need a key **and** a
//! code accepts the key with "more is needed", and the exchange carries on with
//! whatever it still asks for instead of reporting the key as refused.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use russh::client::{AuthResult, KeyboardInteractiveAuthResponse as Ki};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::keys::{
    load_secret_key, Certificate, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey,
};
use russh::{MethodKind, MethodSet};

use super::conn::Connection;
use crate::error::AppError;

/// The named pipe Windows' OpenSSH agent listens on. Fixed by OpenSSH, not
/// configurable, and the reason agent auth works on Windows at all despite there
/// being no Unix socket.
#[cfg(windows)]
const WINDOWS_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// Rounds of keyboard-interactive one exchange will answer before giving up. A
/// real second factor is one or two; a server that keeps asking is broken, and
/// looping on it forever would hold the connection and the dialog hostage.
const MAX_CHALLENGE_ROUNDS: usize = 8;

/// Which agent to ask, as the host's configuration says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentSource {
    /// `SSH_AUTH_SOCK`, or the OpenSSH named pipe on Windows. What OpenSSH uses
    /// when nothing is configured.
    Environment,
    /// `IdentityAgent <path>` — a password manager's agent, a hardware-token
    /// agent, anything that is not the session default.
    Socket(PathBuf),
    /// `IdentityAgent none`: offer nothing from any agent.
    Disabled,
}

impl AgentSource {
    /// Read `IdentityAgent` as `ssh -G` printed it.
    pub fn from_config(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            None | Some("") => AgentSource::Environment,
            Some(v) if v.eq_ignore_ascii_case("none") => AgentSource::Disabled,
            // The literal name of the variable means "the variable".
            Some("SSH_AUTH_SOCK") | Some("$SSH_AUTH_SOCK") => AgentSource::Environment,
            Some(v) => AgentSource::Socket(expand_path(v)),
        }
    }
}

/// A connected agent, whatever kind of stream it speaks over.
pub type Agent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

/// Reach the agent `source` names. `None` when it is switched off, absent, or
/// not answering — none of which is an error: it is simply nothing to offer.
pub async fn open_agent(source: &AgentSource) -> Option<Agent> {
    match source {
        AgentSource::Disabled => None,
        AgentSource::Environment => {
            #[cfg(windows)]
            {
                AgentClient::connect_named_pipe(WINDOWS_AGENT_PIPE)
                    .await
                    .ok()
                    .map(AgentClient::dynamic)
            }
            #[cfg(not(windows))]
            {
                AgentClient::connect_env()
                    .await
                    .ok()
                    .map(AgentClient::dynamic)
            }
        }
        AgentSource::Socket(path) => {
            #[cfg(windows)]
            {
                AgentClient::connect_named_pipe(path.as_os_str())
                    .await
                    .ok()
                    .map(AgentClient::dynamic)
            }
            #[cfg(not(windows))]
            {
                AgentClient::connect_uds(path)
                    .await
                    .ok()
                    .map(AgentClient::dynamic)
            }
        }
    }
}

/// The raw stream to the agent, for **forwarding** it: a channel the host opens
/// back to us is spliced onto this byte-for-byte, so the host's git can ask our
/// agent to sign without a key ever leaving this machine.
pub async fn open_agent_stream(
    source: &AgentSource,
) -> Option<Box<dyn AgentStream + Send + Unpin + 'static>> {
    open_agent(source).await.map(AgentClient::into_inner)
}

/// Everything about *how* to authenticate to one hop, taken from its resolved
/// configuration. Paths only — never a key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthPlan {
    pub user: String,
    pub agent: AgentSource,
    /// `IdentitiesOnly yes`: offer the configured keys and nothing else the
    /// agent happens to hold. Without it, a full agent can spend the server's
    /// `MaxAuthTries` on unrelated keys and the right one is never reached.
    pub identities_only: bool,
    /// Configured keys that exist on disk, in OpenSSH's order.
    pub identity_files: Vec<PathBuf>,
    /// `CertificateFile`s, matched to their key by the public key they certify.
    pub certificate_files: Vec<PathBuf>,
}

impl AuthPlan {
    /// Build a plan from a host's resolved settings. Key files that do not exist
    /// are dropped here rather than attempted: OpenSSH lists its default paths
    /// whether or not anything is there, and trying each missing one would turn
    /// a clean "no credentials" into a list of confusing failures.
    pub fn new(
        user: &str,
        identity_agent: Option<&str>,
        identities_only: bool,
        identity_files: &[String],
        certificate_files: &[String],
    ) -> Self {
        let existing = |raw: &[String]| -> Vec<PathBuf> {
            let mut out: Vec<PathBuf> = Vec::new();
            for path in raw.iter().map(|r| expand_path(r)) {
                if path.is_file() && !out.contains(&path) {
                    out.push(path);
                }
            }
            out
        };
        Self {
            user: user.to_string(),
            agent: AgentSource::from_config(identity_agent),
            identities_only,
            identity_files: existing(identity_files),
            certificate_files: existing(certificate_files),
        }
    }
}

/// What the person has told the app so far, for this attempt.
#[derive(Debug, Clone, Default)]
pub struct Secrets {
    pub password: Option<String>,
    /// Passphrases by key path, for keys that are encrypted on disk.
    pub passphrases: Vec<(PathBuf, String)>,
}

impl Secrets {
    fn passphrase_for(&self, path: &Path) -> Option<&str> {
        self.passphrases
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, v)| v.as_str())
    }
}

/// One question a keyboard-interactive server asked.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengePrompt {
    /// Shown as the server wrote it ("Verification code:").
    pub text: String,
    /// Whether what is typed may be shown. A one-time code often is; a password
    /// never is.
    pub echo: bool,
}

/// A round of questions from a keyboard-interactive server.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<ChallengePrompt>,
}

/// How an authentication attempt ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthOutcome {
    /// Authenticated. `method` says which credential worked, so the UI can tell
    /// the user *how* they got in — useful when a host has several keys.
    Success { method: String },
    /// A key is encrypted and nothing else worked. Ask for its passphrase and
    /// retry; `wrong` says one was given and did not open it.
    NeedsPassphrase { path: String, wrong: bool },
    /// The server takes a password and we have none. `attempted` carries what
    /// was offered and refused first, so the message can say both things: *the
    /// key at X was refused, and this host also takes a password*.
    NeedsPassword { attempted: Vec<String> },
    /// The server asked questions only the person can answer. The connection
    /// stays open, waiting: answer with [`Authenticator::answer`].
    NeedsAnswers(Challenge),
    /// Everything offered was rejected. `attempted` is what we tried, in order,
    /// so the message can be specific instead of "authentication failed".
    Failed { attempted: Vec<String> },
    /// The server accepts nothing we can offer: no keys, no password. Rare, and
    /// worth saying plainly rather than reporting as a rejection.
    NoUsableMethod,
}

/// One authentication exchange, which may pause for answers and carry on.
///
/// Kept as a value rather than one long function because keyboard-interactive
/// is a *conversation*: the server's question has to reach a person, and their
/// answer must go back on the very same connection.
pub struct Authenticator {
    plan: AuthPlan,
    secrets: Secrets,
    /// What the server still accepts. `None` until the opening `none` request
    /// has asked it.
    remaining: Option<MethodSet>,
    keys_done: bool,
    password_done: bool,
    /// Keyboard-interactive is under way and waiting for answers.
    challenge_open: bool,
    /// The password was already typed into a keyboard-interactive prompt once;
    /// the next hidden prompt is a different question.
    password_spent_on_challenge: bool,
    rounds: usize,
    attempted: Vec<String>,
    /// A configured key was locked while a password was still worth trying;
    /// asked for only if the password does not get us in.
    pending_passphrase: Option<(String, bool)>,
}

/// How offering one key ended.
enum Offer {
    Accepted,
    /// Accepted, but the server wants more (`partial success`).
    Partial(MethodSet),
    Refused,
}

impl Authenticator {
    pub fn new(plan: AuthPlan, secrets: Secrets) -> Self {
        Self {
            plan,
            secrets,
            remaining: None,
            keys_done: false,
            password_done: false,
            challenge_open: false,
            password_spent_on_challenge: false,
            rounds: 0,
            attempted: Vec::new(),
            pending_passphrase: None,
        }
    }

    /// Whether this exchange has typed anything the person gave (a password, a
    /// passphrase, an answer). A host that needed one cannot be reconnected
    /// later without them.
    pub fn used_secrets(&self) -> bool {
        self.secrets.password.is_some() || !self.secrets.passphrases.is_empty() || self.rounds > 0
    }

    /// Whether the person answered keyboard-interactive questions. Those are
    /// typically one-time codes, which can never be replayed: such a host is
    /// never reconnected without them.
    pub fn answered_challenges(&self) -> bool {
        self.rounds > 0
    }

    /// Run the exchange as far as it goes without the person.
    pub async fn run(&mut self, conn: &mut Connection) -> Result<AuthOutcome, AppError> {
        if self.remaining.is_none() {
            match conn
                .handle_mut()
                .authenticate_none(self.plan.user.clone())
                .await
                .map_err(auth_error)?
            {
                // A server configured to let anyone in. Vanishingly rare, but
                // the protocol allows it and pretending otherwise would be a lie.
                AuthResult::Success => return Ok(success("none")),
                AuthResult::Failure {
                    remaining_methods, ..
                } => self.remaining = Some(remaining_methods),
            }
        }

        loop {
            if self.takes(MethodKind::PublicKey) && !self.keys_done {
                self.keys_done = true;
                match self.offer_keys(conn).await? {
                    KeysEnded::Done(outcome) => return Ok(outcome),
                    KeysEnded::Partial(methods) => {
                        // The key was right and the server wants a second
                        // factor: carry on with what it still accepts.
                        self.remaining = Some(methods);
                        continue;
                    }
                    KeysEnded::Exhausted => {}
                    KeysEnded::Passphrase { path, wrong } => {
                        // Before stopping to ask, try what needs no key at all:
                        // a password given earlier still counts.
                        if self.secrets.password.is_none() {
                            return Ok(AuthOutcome::NeedsPassphrase { path, wrong });
                        }
                        self.pending_passphrase = Some((path, wrong));
                    }
                }
            }

            if self.takes(MethodKind::Password) && !self.password_done {
                if let Some(password) = self.secrets.password.clone() {
                    self.password_done = true;
                    self.attempted.push("password".to_string());
                    match conn
                        .handle_mut()
                        .authenticate_password(self.plan.user.clone(), password)
                        .await
                        .map_err(auth_error)?
                    {
                        AuthResult::Success => return Ok(success("password")),
                        AuthResult::Failure {
                            remaining_methods,
                            partial_success: true,
                        } => {
                            self.remaining = Some(remaining_methods);
                            continue;
                        }
                        AuthResult::Failure { .. } => {}
                    }
                }
            }

            if self.takes(MethodKind::KeyboardInteractive) && !self.challenge_open {
                self.challenge_open = true;
                let response = conn
                    .handle_mut()
                    .authenticate_keyboard_interactive_start(self.plan.user.clone(), None)
                    .await
                    .map_err(auth_error)?;
                if !self.attempted.iter().any(|a| a == "keyboard-interactive") {
                    self.attempted.push("keyboard-interactive".to_string());
                }
                match self.follow_challenge(conn, response).await? {
                    ChallengeEnded::Outcome(outcome) => return Ok(outcome),
                    ChallengeEnded::Partial(methods) => {
                        self.remaining = Some(methods);
                        continue;
                    }
                    ChallengeEnded::Refused => {}
                }
            }

            return Ok(self.nothing_left());
        }
    }

    /// Send the person's answers to the questions the server asked, and carry
    /// on from there.
    pub async fn answer(
        &mut self,
        conn: &mut Connection,
        answers: Vec<String>,
    ) -> Result<AuthOutcome, AppError> {
        if !self.challenge_open {
            return Err(AppError::Invalid(
                "this host is not waiting for answers".to_string(),
            ));
        }
        self.rounds += 1;
        let response = conn
            .handle_mut()
            .authenticate_keyboard_interactive_respond(answers)
            .await
            .map_err(auth_error)?;
        match self.follow_challenge(conn, response).await? {
            ChallengeEnded::Outcome(outcome) => Ok(outcome),
            ChallengeEnded::Partial(methods) => {
                self.remaining = Some(methods);
                self.run(conn).await
            }
            ChallengeEnded::Refused => Ok(self.nothing_left()),
        }
    }

    /// Whether the server still accepts `kind`.
    fn takes(&self, kind: MethodKind) -> bool {
        self.remaining
            .as_ref()
            .is_some_and(|set| set.contains(&kind))
    }

    /// What to say once every method has been tried.
    fn nothing_left(&mut self) -> AuthOutcome {
        if let Some((path, wrong)) = self.pending_passphrase.take() {
            return AuthOutcome::NeedsPassphrase { path, wrong };
        }
        let takes_password = self.takes(MethodKind::Password);
        // Nothing else worked and the server takes a password we were never
        // given: ask for one. Reporting a failure here would hide the one
        // action that works.
        if takes_password && self.secrets.password.is_none() {
            return AuthOutcome::NeedsPassword {
                attempted: self.attempted.clone(),
            };
        }
        if self.attempted.is_empty() {
            return AuthOutcome::NoUsableMethod;
        }
        AuthOutcome::Failed {
            attempted: self.attempted.clone(),
        }
    }

    /// Walk a keyboard-interactive conversation until it needs the person, ends,
    /// or hands over to another method.
    async fn follow_challenge(
        &mut self,
        conn: &mut Connection,
        mut response: Ki,
    ) -> Result<ChallengeEnded, AppError> {
        loop {
            match response {
                Ki::Success => {
                    self.challenge_open = false;
                    return Ok(ChallengeEnded::Outcome(success("keyboard-interactive")));
                }
                Ki::Failure {
                    remaining_methods,
                    partial_success,
                } => {
                    self.challenge_open = false;
                    return Ok(if partial_success {
                        ChallengeEnded::Partial(remaining_methods)
                    } else {
                        ChallengeEnded::Refused
                    });
                }
                Ki::InfoRequest {
                    name,
                    instructions,
                    prompts,
                } => {
                    if self.rounds >= MAX_CHALLENGE_ROUNDS {
                        self.challenge_open = false;
                        return Ok(ChallengeEnded::Refused);
                    }
                    let answers = if prompts.is_empty() {
                        // An empty request is the server's way of saying
                        // "continue".
                        Some(Vec::new())
                    } else {
                        self.answer_for_the_person(&prompts)
                    };
                    let Some(answers) = answers else {
                        return Ok(ChallengeEnded::Outcome(AuthOutcome::NeedsAnswers(
                            Challenge {
                                name,
                                instructions,
                                prompts: prompts
                                    .into_iter()
                                    .map(|p| ChallengePrompt {
                                        text: p.prompt,
                                        echo: p.echo,
                                    })
                                    .collect(),
                            },
                        )));
                    };
                    response = conn
                        .handle_mut()
                        .authenticate_keyboard_interactive_respond(answers)
                        .await
                        .map_err(auth_error)?;
                }
            }
        }
    }

    /// Answer a round without asking, when that is unambiguous: one hidden
    /// prompt that reads as a password, and a password the person gave. Anything
    /// else — two prompts, a visible one, a code — is theirs to answer.
    fn answer_for_the_person(&mut self, prompts: &[russh::client::Prompt]) -> Option<Vec<String>> {
        let [only] = prompts else { return None };
        let password = self.secrets.password.as_ref()?;
        if only.echo || self.password_spent_on_challenge || !reads_as_password(&only.prompt) {
            return None;
        }
        self.password_spent_on_challenge = true;
        Some(vec![password.clone()])
    }

    /// Offer every key in the order described at the top of this module.
    async fn offer_keys(&mut self, conn: &mut Connection) -> Result<KeysEnded, AppError> {
        let user = self.plan.user.clone();
        let rsa_hash = conn
            .handle_mut()
            .best_supported_rsa_hash()
            .await
            .ok()
            .flatten()
            .flatten();

        let mut agent = open_agent(&self.plan.agent).await;
        let agent_ids: Vec<AgentIdentity> = match agent.as_mut() {
            Some(a) => a.request_identities().await.unwrap_or_default(),
            None => Vec::new(),
        };
        if agent.is_some() {
            self.attempted.push(agent_label(&self.plan.agent));
        }

        // The public half of each configured key, to recognise it in the agent
        // and to pair it with its certificate.
        let configured: Vec<(PathBuf, Option<PublicKey>)> = self
            .plan
            .identity_files
            .iter()
            .map(|p| (p.clone(), public_half(p)))
            .collect();
        // Certificates: the configured ones, plus `<key>-cert.pub` next to a
        // configured key, which OpenSSH picks up on its own.
        let mut certificate_paths = self.plan.certificate_files.clone();
        for (path, _) in &configured {
            let sibling = PathBuf::from(format!("{}-cert.pub", path.display()));
            if sibling.is_file() && !certificate_paths.contains(&sibling) {
                certificate_paths.push(sibling);
            }
        }
        let certificates: Vec<Certificate> = certificate_paths
            .iter()
            .filter_map(|p| std::fs::read_to_string(p).ok())
            .filter_map(|text| Certificate::from_openssh(text.trim()).ok())
            .collect();

        let in_agent = |key: &PublicKey| {
            agent_ids.iter().any(|id| match id {
                AgentIdentity::PublicKey { key: k, .. } => k.key_data() == key.key_data(),
                AgentIdentity::Certificate { certificate, .. } => {
                    certificate.public_key() == key.key_data()
                }
            })
        };

        // 1. Configured keys the agent already holds.
        let mut offered_from_agent: Vec<russh::keys::ssh_key::public::KeyData> = Vec::new();
        if let Some(agent) = agent.as_mut() {
            for (_, public) in &configured {
                let Some(public) = public.as_ref().filter(|k| in_agent(k)) else {
                    continue;
                };
                offered_from_agent.push(public.key_data().clone());
                match offer_agent_key(conn, &user, public, &certificates, rsa_hash, agent).await {
                    Offer::Accepted => {
                        return Ok(KeysEnded::Done(success(&agent_label(&self.plan.agent))))
                    }
                    Offer::Partial(m) => return Ok(KeysEnded::Partial(m)),
                    Offer::Refused => {}
                }
            }
        }

        // 2. Configured keys that open without asking.
        let mut locked: Vec<(PathBuf, bool)> = Vec::new();
        for (path, public) in &configured {
            if public
                .as_ref()
                .is_some_and(|k| offered_from_agent.contains(k.key_data()))
            {
                continue;
            }
            let given = self.secrets.passphrase_for(path).map(str::to_string);
            let key = match load_secret_key(path, given.as_deref()) {
                Ok(key) => key,
                Err(russh::keys::Error::KeyIsEncrypted) => {
                    locked.push((path.clone(), false));
                    continue;
                }
                // A passphrase was given and did not open it: ask again, saying
                // so. With none given, the file is unreadable as a key — not
                // something a passphrase would fix — so it is skipped.
                Err(_) if given.is_some() => {
                    locked.push((path.clone(), true));
                    continue;
                }
                Err(_) => continue,
            };
            self.attempted.push(path.display().to_string());
            match offer_file_key(conn, &user, key, &certificates, rsa_hash).await? {
                Offer::Accepted => {
                    return Ok(KeysEnded::Done(success(&path.display().to_string())))
                }
                Offer::Partial(m) => return Ok(KeysEnded::Partial(m)),
                Offer::Refused => {}
            }
        }

        // 3. Everything else the agent holds — unless told to offer only what is
        // configured.
        if !self.plan.identities_only {
            if let Some(agent) = agent.as_mut() {
                for id in &agent_ids {
                    let offer = match id {
                        AgentIdentity::PublicKey { key, .. } => {
                            if offered_from_agent.contains(key.key_data()) {
                                continue;
                            }
                            offer_agent_key(conn, &user, key, &[], rsa_hash, agent).await
                        }
                        AgentIdentity::Certificate { certificate, .. } => {
                            match conn
                                .handle_mut()
                                .authenticate_certificate_with(
                                    user.clone(),
                                    certificate.clone(),
                                    rsa_hash,
                                    agent,
                                )
                                .await
                            {
                                Ok(result) => offer_result(result),
                                // A broken agent conversation is not a verdict;
                                // stop using it and let the next key try.
                                Err(_) => break,
                            }
                        }
                    };
                    match offer {
                        Offer::Accepted => {
                            return Ok(KeysEnded::Done(success(&agent_label(&self.plan.agent))))
                        }
                        Offer::Partial(m) => return Ok(KeysEnded::Partial(m)),
                        Offer::Refused => {}
                    }
                }
            }
        }

        // 4. A locked key is all that is left: that is the one thing to ask for.
        match locked.into_iter().next() {
            Some((path, wrong)) => Ok(KeysEnded::Passphrase {
                path: path.display().to_string(),
                wrong,
            }),
            None => Ok(KeysEnded::Exhausted),
        }
    }
}

enum KeysEnded {
    Done(AuthOutcome),
    Partial(MethodSet),
    /// A configured key is locked; asking for it is what is left to do.
    Passphrase {
        path: String,
        wrong: bool,
    },
    Exhausted,
}

enum ChallengeEnded {
    Outcome(AuthOutcome),
    Partial(MethodSet),
    Refused,
}

fn success(method: &str) -> AuthOutcome {
    AuthOutcome::Success {
        method: method.to_string(),
    }
}

fn auth_error(e: russh::Error) -> AppError {
    AppError::Invalid(format!("authentication failed: {e}"))
}

fn offer_result(result: AuthResult) -> Offer {
    match result {
        AuthResult::Success => Offer::Accepted,
        AuthResult::Failure {
            remaining_methods,
            partial_success: true,
        } => Offer::Partial(remaining_methods),
        AuthResult::Failure { .. } => Offer::Refused,
    }
}

/// How the agent is named in "what was tried", without leaking a socket path a
/// user did not write.
fn agent_label(source: &AgentSource) -> String {
    match source {
        AgentSource::Socket(path) => format!("ssh-agent ({})", path.display()),
        _ => "ssh-agent".to_string(),
    }
}

/// Offer one agent-held key — through its certificate first, when one was
/// configured for it, since that is what a host trusting a CA expects.
async fn offer_agent_key(
    conn: &mut Connection,
    user: &str,
    key: &PublicKey,
    certificates: &[Certificate],
    rsa_hash: Option<HashAlg>,
    agent: &mut Agent,
) -> Offer {
    let hash = key.algorithm().is_rsa().then_some(rsa_hash).flatten();
    if let Some(cert) = certificates
        .iter()
        .find(|c| c.public_key() == key.key_data())
    {
        if let Ok(result) = conn
            .handle_mut()
            .authenticate_certificate_with(user.to_string(), cert.clone(), hash, agent)
            .await
        {
            if let offer @ (Offer::Accepted | Offer::Partial(_)) = offer_result(result) {
                return offer;
            }
        }
    }
    match conn
        .handle_mut()
        .authenticate_publickey_with(user.to_string(), key.clone(), hash, agent)
        .await
    {
        Ok(result) => offer_result(result),
        // A broken agent conversation is not an authentication verdict.
        Err(_) => Offer::Refused,
    }
}

/// Offer a key loaded from disk, with its certificate first when it has one.
async fn offer_file_key(
    conn: &mut Connection,
    user: &str,
    key: PrivateKey,
    certificates: &[Certificate],
    rsa_hash: Option<HashAlg>,
) -> Result<Offer, AppError> {
    let key = Arc::new(key);
    let public = key.public_key().clone();
    if let Some(cert) = certificates
        .iter()
        .find(|c| c.public_key() == public.key_data())
    {
        let result = conn
            .handle_mut()
            .authenticate_openssh_cert(user.to_string(), Arc::clone(&key), cert.clone())
            .await
            .map_err(auth_error)?;
        if let offer @ (Offer::Accepted | Offer::Partial(_)) = offer_result(result) {
            return Ok(offer);
        }
    }
    let hash = public.algorithm().is_rsa().then_some(rsa_hash).flatten();
    let result = conn
        .handle_mut()
        .authenticate_publickey(user.to_string(), PrivateKeyWithHashAlg::new(key, hash))
        .await
        .map_err(auth_error)?;
    Ok(offer_result(result))
}

/// The public half of a key file: its `.pub` sibling, or the key itself when it
/// is not encrypted. `None` for an encrypted key with no `.pub` — it can still be
/// unlocked and offered, just not recognised in the agent beforehand.
fn public_half(path: &Path) -> Option<PublicKey> {
    let sibling = PathBuf::from(format!("{}.pub", path.display()));
    if let Ok(text) = std::fs::read_to_string(&sibling) {
        if let Ok(key) = PublicKey::from_openssh(text.trim()) {
            return Some(key);
        }
    }
    load_secret_key(path, None)
        .ok()
        .map(|k| k.public_key().clone())
}

/// Whether a lone hidden prompt is asking for the password (PAM's "Password:",
/// "user@host's password:") rather than for a code.
fn reads_as_password(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    lower.contains("password") || lower.contains("passwort") || lower.contains("contraseña")
}

/// Expand a leading `~` and `${VAR}`/`$VAR` the way OpenSSH does for paths in
/// its configuration. `ssh -G` emits paths in that form, and `Path::is_file`
/// understands neither.
pub fn expand_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim().trim_matches('"');
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let mut expanded = String::new();
    let rest = if let Some(rest) = trimmed.strip_prefix("~/").or(trimmed.strip_prefix("~\\")) {
        if let Some(home) = &home {
            expanded.push_str(&PathBuf::from(home).to_string_lossy());
            expanded.push('/');
            rest
        } else {
            trimmed
        }
    } else {
        trimmed
    };
    let mut chars = rest.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '$' {
            expanded.push(c);
            continue;
        }
        let braced = chars.peek() == Some(&'{');
        if braced {
            chars.next();
        }
        let mut name = String::new();
        while let Some(&n) = chars.peek() {
            if n.is_ascii_alphanumeric() || n == '_' {
                name.push(n);
                chars.next();
            } else {
                break;
            }
        }
        if braced && chars.peek() == Some(&'}') {
            chars.next();
        }
        match std::env::var_os(&name) {
            Some(value) if !name.is_empty() => expanded.push_str(&value.to_string_lossy()),
            _ => {
                expanded.push('$');
                expanded.push_str(&name);
            }
        }
    }
    PathBuf::from(expanded)
}

/// The credentials the live suites sign in with: the session's agent, or a
/// password from the environment. Test-only shorthand over [`Authenticator`] —
/// the app itself always authenticates through a route's [`AuthPlan`].
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    Agent,
    Password(String),
}

/// Sign in with `credentials`, the way the live suites need to.
#[cfg(test)]
pub async fn authenticate(
    conn: &mut Connection,
    user: &str,
    credentials: &[Credential],
) -> Result<AuthOutcome, AppError> {
    let agent = credentials.contains(&Credential::Agent);
    let plan = AuthPlan {
        user: user.to_string(),
        agent: if agent {
            AgentSource::Environment
        } else {
            AgentSource::Disabled
        },
        identities_only: false,
        identity_files: Vec::new(),
        certificate_files: Vec::new(),
    };
    let password = credentials.iter().find_map(|c| match c {
        Credential::Password(p) => Some(p.clone()),
        Credential::Agent => None,
    });
    Authenticator::new(
        plan,
        Secrets {
            password,
            passphrases: Vec::new(),
        },
    )
    .run(conn)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_agent_is_read_the_way_openssh_means_it() {
        assert_eq!(AgentSource::from_config(None), AgentSource::Environment);
        assert_eq!(
            AgentSource::from_config(Some("SSH_AUTH_SOCK")),
            AgentSource::Environment
        );
        assert_eq!(
            AgentSource::from_config(Some("none")),
            AgentSource::Disabled
        );
        assert_eq!(
            AgentSource::from_config(Some("/tmp/agent.sock")),
            AgentSource::Socket(PathBuf::from("/tmp/agent.sock"))
        );
    }

    #[test]
    fn key_files_that_do_not_exist_are_dropped_not_attempted() {
        // `ssh -G` lists OpenSSH's default key paths whether or not they exist.
        let plan = AuthPlan::new(
            "me",
            None,
            false,
            &[
                "C:/definitely/not/here/id_ed25519".to_string(),
                "~/.ssh/id_nonexistent_for_tests".to_string(),
            ],
            &[],
        );
        assert!(plan.identity_files.is_empty(), "{plan:?}");
    }

    #[test]
    fn an_existing_key_file_is_planned_once() {
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join("id_ed25519");
        std::fs::write(&key_path, b"presence only").unwrap();
        let shown = key_path.display().to_string();
        let plan = AuthPlan::new("me", None, false, &[shown.clone(), shown], &[]);
        assert_eq!(plan.identity_files, vec![key_path]);
    }

    #[test]
    fn a_lone_hidden_password_prompt_is_answered_and_a_code_is_not() {
        let mut auth = Authenticator::new(
            AuthPlan::new("me", Some("none"), false, &[], &[]),
            Secrets {
                password: Some("hunter2".into()),
                passphrases: Vec::new(),
            },
        );
        let prompt = |text: &str, echo: bool| russh::client::Prompt {
            prompt: text.to_string(),
            echo,
        };
        // A code is the person's to type, even with a password at hand.
        assert_eq!(
            auth.answer_for_the_person(&[prompt("Verification code: ", false)]),
            None
        );
        // Visible echo is never a password.
        assert_eq!(
            auth.answer_for_the_person(&[prompt("Password: ", true)]),
            None
        );
        // Two questions at once are a second factor.
        assert_eq!(
            auth.answer_for_the_person(&[prompt("Password: ", false), prompt("Code: ", false)]),
            None
        );
        assert_eq!(
            auth.answer_for_the_person(&[prompt("me@box's password: ", false)]),
            Some(vec!["hunter2".to_string()])
        );
        // And only once: a second hidden prompt is a different question, and
        // replaying the password into it would burn an attempt.
        assert_eq!(
            auth.answer_for_the_person(&[prompt("Password: ", false)]),
            None
        );
    }

    #[test]
    fn paths_expand_home_and_variables_the_way_openssh_writes_them() {
        let expanded = expand_path("~/.ssh/id_ed25519");
        assert!(!expanded.to_string_lossy().starts_with('~'), "{expanded:?}");
        assert!(expanded
            .to_string_lossy()
            .replace('\\', "/")
            .ends_with(".ssh/id_ed25519"));
        // A quoted absolute path survives untouched.
        assert_eq!(expand_path("\"C:/keys/k\""), PathBuf::from("C:/keys/k"));
        std::env::set_var("UXNAN_TEST_AGENT_DIR", "/run/agents");
        assert_eq!(
            expand_path("${UXNAN_TEST_AGENT_DIR}/s.sock"),
            PathBuf::from("/run/agents/s.sock")
        );
        assert_eq!(
            expand_path("$UXNAN_TEST_AGENT_DIR/s.sock"),
            PathBuf::from("/run/agents/s.sock")
        );
        // An unknown variable stays as written rather than vanishing.
        assert_eq!(
            expand_path("$UXNAN_NOT_SET_ANYWHERE/x"),
            PathBuf::from("$UXNAN_NOT_SET_ANYWHERE/x")
        );
    }

    /// Live checks against the SSH server on this machine. Ignored by default.
    /// They connect to loopback and deliberately authenticate with a key the
    /// server has never been told about: the point is that a rejection is
    /// reported cleanly, not that we can get in.
    ///
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored ssh::auth`
    mod live {
        use super::*;
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

        async fn verified_connection() -> crate::ssh::conn::Connection {
            let endpoint = Endpoint::new("127.0.0.1", 22);
            let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
                panic!("expected an unknown host on an empty known_hosts");
            };
            let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
            match connect(endpoint, &trusted).await {
                Ok(Handshake::Ready(conn)) => *conn,
                _ => panic!("the key we just recorded should verify"),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn a_password_server_with_no_password_asks_for_one() {
            // The first-connection case, and the reason this outcome exists:
            // with nothing to offer against a server that takes a password,
            // "authentication failed" would hide the one action that works.
            let mut conn = verified_connection().await;
            let outcome = authenticate(&mut conn, "nobody", &[]).await.unwrap();
            assert_eq!(outcome, AuthOutcome::NeedsPassword { attempted: vec![] });
        }

        /// A real remote host plus credentials, so the one thing loopback cannot
        /// prove — that an authenticated session carries many channels over a
        /// single connection — can be checked against a real machine.
        ///
        /// The password is read from the environment and never printed. Run it
        /// from your own shell so it never leaves your process:
        ///
        /// ```powershell
        /// $env:UXNAN_SSH_TEST_HOST='10.0.0.5'; $env:UXNAN_SSH_TEST_USER='you'
        /// $env:UXNAN_SSH_TEST_PASSWORD='...'
        /// cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored many_channels --nocapture
        /// ```
        #[tokio::test]
        #[ignore = "needs UXNAN_SSH_TEST_{HOST,USER,PASSWORD}; run with --ignored"]
        async fn one_connection_carries_many_channels() {
            let (Ok(host), Ok(user), Ok(password)) = (
                std::env::var("UXNAN_SSH_TEST_HOST"),
                std::env::var("UXNAN_SSH_TEST_USER"),
                std::env::var("UXNAN_SSH_TEST_PASSWORD"),
            ) else {
                panic!("set UXNAN_SSH_TEST_HOST, _USER and _PASSWORD to run this");
            };

            // Trust whatever the host presents: this test is about channels, and
            // the key decision has its own live coverage in `conn`.
            let endpoint = crate::ssh::conn::Endpoint::new(host.clone(), 22);
            let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
                panic!("could not reach {host}");
            };
            let trusted = hostkey::trust_line(&host, 22, &key);
            let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
                panic!("the key just recorded should verify");
            };

            let creds = vec![Credential::Password(password)];
            match authenticate(&mut conn, &user, &creds).await.unwrap() {
                AuthOutcome::Success { method } => println!("authenticated via {method}"),
                other => panic!("authentication did not succeed: {other:?}"),
            }

            // The point of an in-process client: many concurrent channels on one
            // connection, with no second handshake and no second login. Eight is
            // the floor the transport gate asks for; OpenSSH's own default
            // MaxSessions is 10.
            const CHANNELS: usize = 8;

            // Time one channel alone first. Without it the concurrent figure is
            // unreadable: eight channels in 3.2 s means "they serialized" if one
            // costs 400 ms, and "they overlapped fine, the remote shell is just
            // expensive to start" if one costs 3 s. Those two call for opposite
            // fixes — batch the work into fewer commands, or stop paying for a
            // shell profile — so the test measures which one it is.
            let single_started = std::time::Instant::now();
            let warm = conn.exec("echo warmup").await.expect("first channel");
            let single = single_started.elapsed();
            assert!(warm.stdout.contains("warmup"), "{:?}", warm);

            let started = std::time::Instant::now();
            let commands: Vec<String> =
                (0..CHANNELS).map(|i| format!("echo channel-{i}")).collect();
            let results = futures::future::join_all(commands.iter().map(|c| conn.exec(c))).await;
            let elapsed = started.elapsed();

            for (i, result) in results.iter().enumerate() {
                let out = result
                    .as_ref()
                    .unwrap_or_else(|e| panic!("channel {i}: {e}"));
                assert!(
                    out.stdout.contains(&format!("channel-{i}")),
                    "channel {i} returned {:?} (stderr {:?})",
                    out.stdout,
                    out.stderr
                );
                assert_eq!(out.exit_code, Some(0), "channel {i} exit code");
            }
            println!(
                "one channel: {} ms | {CHANNELS} concurrent: {} ms | ratio {:.1}x",
                single.as_millis(),
                elapsed.as_millis(),
                elapsed.as_secs_f64() / single.as_secs_f64().max(0.001)
            );
        }

        #[tokio::test]
        #[ignore = "needs a local sshd and a key loaded in the agent; run with --ignored"]
        async fn the_system_agent_is_reached_and_its_identities_are_offered() {
            // Transport gate item 3: on Windows this is a named-pipe
            // conversation, which either works or silently offers nothing.
            // Authorization is a separate matter — what is asserted here is that
            // the agent was actually consulted and its keys put on the wire.
            // The current user, so the test works on any machine whose sshd
            // authorizes a key held by that user's agent.
            let user = std::env::var("UXNAN_SSH_TEST_USER")
                .or_else(|_| std::env::var("USERNAME"))
                .or_else(|_| std::env::var("USER"))
                .expect("a username to authenticate as");

            let mut conn = verified_connection().await;
            let outcome = authenticate(&mut conn, &user, &[Credential::Agent])
                .await
                .unwrap();

            match outcome {
                // The full agent path: the named pipe was spoken to, an identity
                // it holds was offered, and the server took it.
                AuthOutcome::Success { method } => {
                    assert_eq!(method, "ssh-agent");
                    let out = conn.exec("echo agent-session").await.expect("exec");
                    assert!(out.stdout.contains("agent-session"), "{out:?}");
                    assert_eq!(out.exit_code, Some(0));
                    println!("live: agent login succeeded for {user}, session usable");
                }
                // No key of the agent's is authorized here. The transport half
                // is still proven — the agent was consulted and its identities
                // went on the wire — so this is reported, not failed.
                AuthOutcome::NeedsPassword { attempted } | AuthOutcome::Failed { attempted } => {
                    assert!(
                        attempted.contains(&"ssh-agent".to_string()),
                        "the agent should have been consulted: {attempted:?}"
                    );
                    println!(
                        "live: agent reached and its identities offered, none authorized for {user}"
                    );
                }
                other => panic!("unexpected outcome {other:?}"),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn a_wrong_password_is_a_rejection_not_a_transport_error() {
            let mut conn = verified_connection().await;
            let creds = vec![Credential::Password("definitely-not-the-password".into())];
            match authenticate(&mut conn, "uxnan-no-such-user", &creds)
                .await
                .unwrap()
            {
                AuthOutcome::Failed { attempted } => {
                    assert!(attempted.contains(&"password".to_string()), "{attempted:?}");
                    println!("live: wrong password rejected cleanly, tried {attempted:?}");
                }
                other => panic!("expected a clean rejection, got {other:?}"),
            }
        }

        #[tokio::test]
        #[ignore = "needs a local sshd; run explicitly with --ignored"]
        async fn an_unauthorized_key_is_rejected_cleanly_and_says_what_it_tried() {
            // Generate a real key the server has never heard of. A rejection has
            // to come back as a verdict naming what was offered — not as a
            // transport error, which would send the user to debug the network.
            let dir = tempfile::tempdir().unwrap();
            let key_path = dir.path().join("id_ed25519");
            let status = std::process::Command::new("ssh-keygen")
                .args(["-t", "ed25519", "-N", "", "-q", "-f"])
                .arg(&key_path)
                .status()
                .expect("ssh-keygen should be available alongside a running sshd");
            assert!(status.success(), "ssh-keygen failed");

            let plan = AuthPlan::new(
                "uxnan-no-such-user",
                Some("none"),
                false,
                &[key_path.display().to_string()],
                &[],
            );
            assert_eq!(
                plan.identity_files.len(),
                1,
                "the generated key should be offered"
            );

            let mut conn = verified_connection().await;
            let outcome = Authenticator::new(plan, Secrets::default())
                .run(&mut conn)
                .await
                .unwrap();

            // The key is refused *and* this server takes a password, so the
            // useful answer says both: what was rejected, and what to try next.
            match outcome {
                AuthOutcome::NeedsPassword { attempted } => {
                    assert_eq!(attempted.len(), 1);
                    assert!(attempted[0].contains("id_ed25519"), "{attempted:?}");
                    println!(
                        "live: key refused ({}), password offered next",
                        attempted[0]
                    );
                }
                other => panic!("expected the key refused + password offered, got {other:?}"),
            }
        }
    }
}
