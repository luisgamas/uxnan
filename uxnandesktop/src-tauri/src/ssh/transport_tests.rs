//! The transport against a real SSH peer (`testserver`): every behaviour of a
//! real server that changes what the client must do, proven on each
//! `cargo test` with no Docker and no system `sshd`.

#![cfg(test)]

use std::path::{Path, PathBuf};

use russh::keys::ssh_key::LineEnding;

use super::auth::Secrets;
use super::config::{ResolvedHost, StrictHostKeys};
use super::dial::{self, Dial, Hop, Route, Step, Stop};
use super::testserver::{self, Spec, TestServer};

/// A hop to a test server on loopback, judged against `known_hosts`.
fn hop_to(server: &TestServer, user: &str, known_hosts: &Path) -> Hop {
    Hop::for_test(
        &format!("box-{}", server.port),
        ResolvedHost {
            hostname: "127.0.0.1".into(),
            port: server.port,
            user: user.into(),
            // No agent unless a test asks for one: the developer's own agent
            // must not decide whether a test passes.
            identity_agent: Some("none".into()),
            user_known_hosts_files: vec![known_hosts.display().to_string()],
            ..Default::default()
        },
    )
}

fn trusting(dir: &Path, servers: &[&TestServer]) -> PathBuf {
    let file = dir.join("known_hosts");
    let lines: Vec<String> = servers.iter().map(|s| s.trust_line()).collect();
    std::fs::write(&file, lines.join("\n") + "\n").unwrap();
    file
}

/// A private `ssh-agent` on a socket of its own, killed when dropped — even when
/// the test panics, so a failing run never leaves an agent holding the test
/// runner's output open.
struct TestAgent {
    child: std::process::Child,
    socket: PathBuf,
}

impl TestAgent {
    /// `None` when this machine has no `ssh-agent` (or `ssh-add` will not load
    /// the keys), so the test can skip with a reason.
    async fn start(dir: &Path, keys: &[&Path]) -> Option<Self> {
        let socket = dir.join("agent.sock");
        let child = std::process::Command::new("ssh-agent")
            .arg("-D")
            .arg("-a")
            .arg(&socket)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        let agent = Self { child, socket };
        for _ in 0..100 {
            if agent.socket.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        for key in keys {
            let added = std::process::Command::new("ssh-add")
                .arg("-q")
                .arg(key)
                .env("SSH_AUTH_SOCK", &agent.socket)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            if !added.is_ok_and(|s| s.success()) {
                return None;
            }
        }
        Some(agent)
    }
}

impl Drop for TestAgent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn write_key(dir: &Path, seed: u8) -> PathBuf {
    let path = dir.join(format!("id_{seed}"));
    let pem = testserver::key(seed).to_openssh(LineEnding::LF).unwrap();
    std::fs::write(&path, pem.as_bytes()).unwrap();
    // `ssh-add` refuses a private key others can read, as `ssh` does.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    path
}

async fn run(dial: &mut Dial, secrets: Secrets) -> Step {
    dial.run(&move |_| secrets.clone())
        .await
        .expect("the dial runs")
}

fn password(p: &str) -> Secrets {
    Secrets {
        password: Some(p.into()),
        passphrases: Vec::new(),
    }
}

fn expect_ready(step: Step) -> dial::Ready {
    match step {
        Step::Ready(ready) => ready,
        Step::Paused { challenge, .. } => panic!("paused on {challenge:?}"),
        Step::Stopped(stop) => panic!("stopped: {stop:?}"),
    }
}

#[tokio::test]
async fn a_password_then_a_code_in_two_rounds_pauses_only_for_the_code() {
    // PAM with a second factor: "Password:" then "Verification code:". The
    // password the person gave answers the first round on its own; the code is
    // theirs to type, and the dial waits for it on the same connection.
    let server = testserver::start(
        Spec {
            user: "me".into(),
            password: Some("hunter2".into()),
            code: Some("424242".into()),
            password_then_code: true,
            ..Default::default()
        },
        1,
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let known = trusting(dir.path(), &[&server]);
    let mut dial = Dial::new(Route {
        hops: vec![hop_to(&server, "me", &known)],
    });

    let step = run(&mut dial, password("hunter2")).await;
    let Step::Paused { hop, challenge } = step else {
        panic!("expected to pause for the code");
    };
    assert!(hop.is_target);
    assert_eq!(challenge.prompts.len(), 1);
    assert_eq!(challenge.prompts[0].text, "Verification code: ");
    assert!(
        challenge.prompts[0].echo,
        "a code may be shown as it is typed"
    );

    let ready = expect_ready(
        dial.answer(vec!["424242".into()], &|_| password("hunter2"))
            .await
            .unwrap(),
    );
    assert_eq!(ready.method, "keyboard-interactive");
    assert!(ready.answered_challenges, "a code can never be replayed");
    assert!(server.saw("answer:hunter2") && server.saw("answer:424242"));
    let out = ready.connection.exec("echo still here").await.unwrap();
    assert_eq!(out.stdout.trim(), "still here");
}

#[tokio::test]
async fn a_key_that_is_only_partial_success_carries_on_to_the_code() {
    // `AuthenticationMethods publickey,keyboard-interactive`: the key is right
    // and not enough. Reporting it as refused would send the person to fix a
    // key that works.
    let dir = tempfile::tempdir().unwrap();
    let key_path = write_key(dir.path(), 7);
    let server = testserver::start(
        Spec {
            user: "me".into(),
            authorized: vec![testserver::key(7).public_key().clone()],
            code: Some("1234".into()),
            key_then_code: true,
            ..Default::default()
        },
        2,
    )
    .await;
    let known = trusting(dir.path(), &[&server]);
    let mut hop = hop_to(&server, "me", &known);
    hop.resolved.identity_files = vec![key_path.display().to_string()];
    let mut dial = Dial::new(Route { hops: vec![hop] });

    let Step::Paused { challenge, .. } = run(&mut dial, Secrets::default()).await else {
        panic!("the key alone must not be enough");
    };
    assert_eq!(challenge.prompts[0].text, "Verification code: ");
    assert!(server.saw("publickey:ok"));
    let ready = expect_ready(
        dial.answer(vec!["1234".into()], &|_| Secrets::default())
            .await
            .unwrap(),
    );
    assert_eq!(ready.method, "keyboard-interactive");
}

#[tokio::test]
async fn a_host_behind_a_bastion_is_reached_through_its_tunnel() {
    // `ProxyJump`: the bastion is an SSH connection of its own (here, with a
    // password), and the host is a complete SSH session carried in a
    // `direct-tcpip` channel the bastion opens.
    let dir = tempfile::tempdir().unwrap();
    let key_path = write_key(dir.path(), 9);
    let bastion = testserver::start(
        Spec {
            user: "ops".into(),
            password: Some("gate".into()),
            bastion: true,
            ..Default::default()
        },
        3,
    )
    .await;
    let target = testserver::start(
        Spec {
            user: "me".into(),
            authorized: vec![testserver::key(9).public_key().clone()],
            ..Default::default()
        },
        4,
    )
    .await;
    let known = trusting(dir.path(), &[&bastion, &target]);
    let first = hop_to(&bastion, "ops", &known);
    let mut last = hop_to(&target, "me", &known);
    last.resolved.identity_files = vec![key_path.display().to_string()];
    let bastion_key = first.key.clone();
    let mut dial = Dial::new(Route {
        hops: vec![first, last],
    });

    // Each hop gets its own secrets: the bastion's password is not offered to
    // the host.
    let step = dial
        .run(&|hop| {
            if hop.key == bastion_key {
                password("gate")
            } else {
                Secrets::default()
            }
        })
        .await
        .unwrap();
    let ready = expect_ready(step);
    assert!(bastion.saw(&format!("tunnel:127.0.0.1:{}", target.port)));
    assert!(
        !target.saw("password:gate"),
        "the bastion's password stays with the bastion"
    );
    let out = ready
        .connection
        .exec("echo through the bastion")
        .await
        .unwrap();
    assert_eq!(out.stdout.trim(), "through the bastion");
}

#[tokio::test]
async fn a_bastion_asking_for_a_password_is_named_in_the_report() {
    let bastion = testserver::start(
        Spec {
            user: "ops".into(),
            password: Some("gate".into()),
            bastion: true,
            ..Default::default()
        },
        5,
    )
    .await;
    let target = testserver::start(
        Spec {
            user: "me".into(),
            ..Default::default()
        },
        6,
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let known = trusting(dir.path(), &[&bastion, &target]);
    let mut dial = Dial::new(Route {
        hops: vec![
            hop_to(&bastion, "ops", &known),
            hop_to(&target, "me", &known),
        ],
    });
    match run(&mut dial, Secrets::default()).await {
        Step::Stopped(Stop::NeedsPassword { hop, .. }) => {
            assert!(!hop.is_target, "it is the bastion that asked");
            assert_eq!(hop.key, format!("ops@127.0.0.1:{}", bastion.port));
        }
        _ => panic!("expected the bastion to ask for its password"),
    }
}

#[tokio::test]
async fn an_unknown_key_stops_unless_the_config_accepts_new_ones() {
    let server = testserver::start(
        Spec {
            user: "me".into(),
            password: Some("pw".into()),
            ..Default::default()
        },
        8,
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let known = dir.path().join("known_hosts");

    // Asked: stop with the key held for the person's decision.
    let mut dial = Dial::new(Route {
        hops: vec![hop_to(&server, "me", &known)],
    });
    let pending = match run(&mut dial, password("pw")).await {
        Step::Stopped(Stop::HostUnknown {
            pending, strict, ..
        }) => {
            assert!(!strict);
            pending
        }
        _ => panic!("an unknown host must stop at its key"),
    };
    assert_eq!(pending.name, "127.0.0.1");
    assert!(
        !known.exists(),
        "nothing is written before the person says so"
    );

    // `StrictHostKeyChecking yes`: shown, never trustable from here.
    let mut strict = hop_to(&server, "me", &known);
    strict.resolved.strict_host_key_checking = StrictHostKeys::Yes;
    let mut dial = Dial::new(Route { hops: vec![strict] });
    assert!(matches!(
        run(&mut dial, password("pw")).await,
        Step::Stopped(Stop::HostUnknown { strict: true, .. })
    ));

    // `accept-new`: recorded where ssh would record it, and in.
    let mut lax = hop_to(&server, "me", &known);
    lax.resolved.strict_host_key_checking = StrictHostKeys::AcceptNew;
    let mut dial = Dial::new(Route {
        hops: vec![lax.clone()],
    });
    let ready = expect_ready(run(&mut dial, password("pw")).await);
    assert_eq!(ready.learned.len(), 1);
    let text = std::fs::read_to_string(&known).unwrap();
    assert!(
        text.contains(&format!("[127.0.0.1]:{}", server.port)),
        "{text}"
    );
    // And from then on it is simply trusted.
    lax.resolved.strict_host_key_checking = StrictHostKeys::Ask;
    let mut dial = Dial::new(Route { hops: vec![lax] });
    assert!(expect_ready(run(&mut dial, password("pw")).await)
        .learned
        .is_empty());
}

#[tokio::test]
async fn a_rotated_key_is_refused_until_the_person_replaces_it() {
    let server = testserver::start(
        Spec {
            user: "me".into(),
            password: Some("pw".into()),
            ..Default::default()
        },
        10,
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    // What is on file is another machine's key under this name: the shape of a
    // reinstall — and of a man-in-the-middle.
    let impostor = testserver::key(11);
    let presented = super::hostkey::PresentedKey::from_ssh_key(impostor.public_key()).unwrap();
    let known = dir.path().join("known_hosts");
    std::fs::write(
        &known,
        super::hostkey::trust_line("127.0.0.1", server.port, &presented) + "\n",
    )
    .unwrap();

    let mut dial = Dial::new(Route {
        hops: vec![hop_to(&server, "me", &known)],
    });
    let pending = match run(&mut dial, password("pw")).await {
        Step::Stopped(Stop::HostChanged { pending, .. }) => pending,
        _ => panic!("a different key on file is a change, never a new host"),
    };
    assert!(
        !server.saw("password:pw"),
        "no credential reaches a host whose key changed"
    );

    dial::replace_key(&pending).unwrap();
    let mut dial = Dial::new(Route {
        hops: vec![hop_to(&server, "me", &known)],
    });
    expect_ready(run(&mut dial, password("pw")).await);
}

#[tokio::test]
async fn an_encrypted_key_asks_for_its_passphrase_and_says_when_it_was_wrong() {
    let dir = tempfile::tempdir().unwrap();
    let key_path = dir.path().join("id_locked");
    let made = std::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-q", "-N", "open sesame", "-f"])
        .arg(&key_path)
        .status();
    if !made.is_ok_and(|s| s.success()) {
        println!("skipped: no ssh-keygen to make an encrypted key");
        return;
    }
    let public = std::fs::read_to_string(format!("{}.pub", key_path.display())).unwrap();
    let public = russh::keys::PublicKey::from_openssh(public.trim()).unwrap();
    let server = testserver::start(
        Spec {
            user: "me".into(),
            authorized: vec![public],
            ..Default::default()
        },
        12,
    )
    .await;
    let known = trusting(dir.path(), &[&server]);
    let mut hop = hop_to(&server, "me", &known);
    hop.resolved.identity_files = vec![key_path.display().to_string()];
    let route = Route { hops: vec![hop] };

    let with = |passphrase: Option<&str>| Secrets {
        password: None,
        passphrases: passphrase
            .map(|p| vec![(key_path.clone(), p.to_string())])
            .unwrap_or_default(),
    };

    let mut dial = Dial::new(route.clone());
    assert!(matches!(
        run(&mut dial, with(None)).await,
        Step::Stopped(Stop::NeedsPassphrase { wrong: false, .. })
    ));
    let mut dial = Dial::new(route.clone());
    assert!(matches!(
        run(&mut dial, with(Some("nope"))).await,
        Step::Stopped(Stop::NeedsPassphrase { wrong: true, .. })
    ));
    let mut dial = Dial::new(route);
    let ready = expect_ready(run(&mut dial, with(Some("open sesame"))).await);
    assert!(ready.needed_secrets);
    assert!(
        !ready.answered_challenges,
        "a passphrase can be used again on reconnect"
    );
}

#[tokio::test]
async fn the_agent_is_forwarded_only_when_the_host_is_configured_to_have_it() {
    // A real agent with one key in it, on a socket of its own, so the
    // developer's agent never enters into it.
    let dir = tempfile::tempdir().unwrap();
    let key_path = write_key(dir.path(), 13);
    let Some(agent) = TestAgent::start(dir.path(), &[&key_path]).await else {
        println!("skipped: no ssh-agent / ssh-add to hold the test key");
        return;
    };
    let socket = agent.socket.clone();

    let server = testserver::start(
        Spec {
            user: "me".into(),
            authorized: vec![testserver::key(13).public_key().clone()],
            ..Default::default()
        },
        14,
    )
    .await;
    let known = trusting(dir.path(), &[&server]);
    let mut hop = hop_to(&server, "me", &known);
    // `IdentityAgent <socket>`: the agent the configuration names, not the
    // session's — and it is how the key gets in, with no key file configured.
    hop.resolved.identity_agent = Some(socket.display().to_string());

    // Without ForwardAgent the host never even asks.
    let ready = expect_ready(
        run(
            &mut Dial::new(Route {
                hops: vec![hop.clone()],
            }),
            Secrets::default(),
        )
        .await,
    );
    assert!(ready.method.starts_with("ssh-agent"), "{}", ready.method);
    let out = ready.connection.exec("agent-identities").await.unwrap();
    assert_eq!(out.stdout.trim(), "unknown");
    assert!(!server.saw("agent-forward-requested"));

    // With it, the host reaches our agent and sees its one key.
    hop.resolved.forward_agent = true;
    let ready = expect_ready(
        run(
            &mut Dial::new(Route { hops: vec![hop] }),
            Secrets::default(),
        )
        .await,
    );
    let out = ready.connection.exec("agent-identities").await.unwrap();
    assert_eq!(out.stdout.trim(), "1", "the forwarded agent answered");
    assert!(server.saw("agent-forward-requested"));
    drop(agent);
}

#[tokio::test]
async fn identities_only_keeps_unconfigured_agent_keys_out() {
    // A full agent can spend the server's MaxAuthTries on unrelated keys; with
    // `IdentitiesOnly` only the configured ones are offered. Proven the sharp
    // way: the one key this server authorizes is in the agent but *not* in the
    // configuration, so it gets in without the setting and must not with it.
    let dir = tempfile::tempdir().unwrap();
    let in_agent_only = write_key(dir.path(), 15);
    let configured = write_key(dir.path(), 16);
    let Some(agent) = TestAgent::start(dir.path(), &[&in_agent_only]).await else {
        println!("skipped: no ssh-agent / ssh-add to hold the test key");
        return;
    };
    let socket = agent.socket.clone();
    let server = testserver::start(
        Spec {
            user: "me".into(),
            authorized: vec![testserver::key(15).public_key().clone()],
            ..Default::default()
        },
        17,
    )
    .await;
    let known = trusting(dir.path(), &[&server]);
    let mut hop = hop_to(&server, "me", &known);
    hop.resolved.identity_agent = Some(socket.display().to_string());
    hop.resolved.identity_files = vec![configured.display().to_string()];

    let ready = expect_ready(
        run(
            &mut Dial::new(Route {
                hops: vec![hop.clone()],
            }),
            Secrets::default(),
        )
        .await,
    );
    assert!(ready.method.starts_with("ssh-agent"), "{}", ready.method);

    hop.resolved.identities_only = true;
    match run(
        &mut Dial::new(Route { hops: vec![hop] }),
        Secrets::default(),
    )
    .await
    {
        Step::Stopped(Stop::Failed { attempted, .. }) => {
            assert!(
                attempted.iter().any(|a| a.contains("id_16")),
                "the configured key was the one offered: {attempted:?}"
            );
        }
        Step::Ready(_) => panic!("an unconfigured agent key was offered despite IdentitiesOnly"),
        _ => panic!("expected the configured key to be refused"),
    }
    drop(agent);
}
