//! The daemon, as the real binary, over its real socket: open a terminal, lose
//! the connection, come back and find the same screen; and the lifecycle around
//! it — the version check, refusing a client it cannot speak to, attach
//! starting a daemon, and exiting once there is nothing left to do.
//!
//! Every test points `UXNAN_HOST_HOME` and `HOME` at a temporary directory:
//! nothing here touches `~/.uxnan`, nor the agents' own configs (wiring the
//! hooks writes there).

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use tokio::net::UnixStream;
use uxnan_host_protocol::{
    read_frame, write_frame, Call, ClientMessage, Event, Frame, Outcome, Reply, ServerMessage,
    PROTOCOL, PROTOCOL_MIN,
};

const BIN: &str = env!("CARGO_BIN_EXE_uxnan-host");

struct Daemon {
    child: Child,
    home: tempfile::TempDir,
}

impl Daemon {
    fn start(idle_secs: u64) -> Self {
        Self::start_with(idle_secs, &[])
    }

    /// As `attach` starts it in production: detached from the session.
    fn start_detached(idle_secs: u64) -> Self {
        Self::start_with(idle_secs, &["--detached"])
    }

    fn start_with(idle_secs: u64, flags: &[&str]) -> Self {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join("user")).unwrap();
        Self::spawn(Path::new(BIN), home, idle_secs, flags)
    }

    /// Started from `exe`, in a home prepared beforehand.
    fn spawn(exe: &Path, home: tempfile::TempDir, idle_secs: u64, flags: &[&str]) -> Self {
        let child = Command::new(exe)
            .arg("serve")
            .args(flags)
            .env("UXNAN_HOST_HOME", home.path())
            .env("HOME", home.path().join("user"))
            .env("UXNAN_HOST_IDLE_SECS", idle_secs.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        Self { child, home }
    }

    fn socket(&self) -> PathBuf {
        socket_in(self.home.path())
    }

    /// The `HOME` the daemon and its terminals see.
    fn user_home(&self) -> PathBuf {
        self.home.path().join("user")
    }
}

/// The reporter the agents' hooks run — the real script, not a stand-in.
fn reporter() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../workspace-engine/hooks/uxnan-event-hook.sh")
        .canonicalize()
        .unwrap()
}

/// The next agent report on this connection, skipping everything else.
async fn next_hook(client: &mut Client) -> (u32, Vec<(String, String)>, String) {
    loop {
        if let ServerMessage::Event(Event::Hook {
            session,
            headers,
            body,
        }) = client.control().await
        {
            return (session, headers, body);
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn socket_in(home: &Path) -> PathBuf {
    home.join("run").join("engine.sock")
}

async fn connect(path: &Path) -> UnixStream {
    for _ in 0..200 {
        if let Ok(stream) = UnixStream::connect(path).await {
            return stream;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("the daemon never listened at {}", path.display());
}

struct Client {
    stream: UnixStream,
    next_id: u64,
}

impl Client {
    async fn hello(path: &Path) -> (Self, ServerMessage) {
        let mut stream = connect(path).await;
        write_frame(
            &mut stream,
            &Frame::control(&ClientMessage::Hello {
                protocol_min: PROTOCOL_MIN,
                protocol: PROTOCOL,
                client: "test".into(),
            }),
        )
        .await
        .unwrap();
        let mut client = Self { stream, next_id: 1 };
        let welcome = client.control().await;
        (client, welcome)
    }

    async fn frame(&mut self) -> Frame {
        tokio::time::timeout(Duration::from_secs(10), read_frame(&mut self.stream))
            .await
            .expect("the daemon answered in time")
            .unwrap()
            .expect("the stream is still open")
    }

    async fn control(&mut self) -> ServerMessage {
        loop {
            if let Frame::Control(json) = self.frame().await {
                return serde_json::from_slice(&json).unwrap();
            }
        }
    }

    async fn call(&mut self, call: Call) -> Outcome {
        let id = self.next_id;
        self.next_id += 1;
        write_frame(
            &mut self.stream,
            &Frame::control(&ClientMessage::Request { id, call }),
        )
        .await
        .unwrap();
        loop {
            if let ServerMessage::Response { id: got, outcome } = self.control().await {
                assert_eq!(got, id, "responses answer the request they belong to");
                return outcome;
            }
        }
    }

    async fn type_in(&mut self, session: u32, text: &str) {
        write_frame(
            &mut self.stream,
            &Frame::Data {
                session,
                bytes: text.as_bytes().to_vec(),
            },
        )
        .await
        .unwrap();
    }

    /// Read output for `session` until it contains `needle`.
    async fn until_output(&mut self, session: u32, needle: &str) -> String {
        let mut seen = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while tokio::time::Instant::now() < deadline {
            if let Frame::Data { session: s, bytes } = self.frame().await {
                if s == session {
                    seen.push_str(&String::from_utf8_lossy(&bytes));
                    if seen.contains(needle) {
                        return seen;
                    }
                }
            }
        }
        panic!("never saw {needle:?}; saw {seen:?}");
    }
}

fn sh(script: &str) -> Option<Vec<String>> {
    Some(vec!["/bin/sh".into(), "-c".into(), script.into()])
}

#[tokio::test]
async fn version_reports_what_the_installer_checks() {
    let out = Command::new(BIN).arg("version").output().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["protocol"], PROTOCOL);
    assert_eq!(v["protocolMin"], PROTOCOL_MIN);
    assert_eq!(v["os"], std::env::consts::OS);
    assert_eq!(v["arch"], std::env::consts::ARCH);
}

#[tokio::test]
async fn a_terminal_outlives_its_connection_and_repaints_the_next_one() {
    let daemon = Daemon::start(600);
    let (mut first, welcome) = Client::hello(&daemon.socket()).await;
    let ServerMessage::Welcome(welcome) = welcome else {
        panic!("expected a welcome, got {welcome:?}");
    };
    assert_eq!(welcome.protocol, PROTOCOL);

    let opened = first
        .call(Call::Open {
            cols: 80,
            rows: 24,
            cwd: None,
            command: sh("printf 'ready\\n'; exec cat"),
            env: vec![],
            label: "test".into(),
        })
        .await;
    let Outcome::Ok {
        reply: Reply::Opened { session, .. },
    } = opened
    else {
        panic!("expected opened, got {opened:?}");
    };
    first.until_output(session, "ready").await;
    first.type_in(session, "before the drop\n").await;
    first.until_output(session, "before the drop").await;

    // The connection goes away — the network, a closed lid — without a word.
    drop(first);

    let (mut second, _) = Client::hello(&daemon.socket()).await;
    let listed = second.call(Call::List).await;
    let Outcome::Ok {
        reply: Reply::Sessions { sessions },
    } = listed
    else {
        panic!("expected the session list, got {listed:?}");
    };
    assert_eq!(
        sessions.len(),
        1,
        "the terminal is still there: {sessions:?}"
    );
    assert!(sessions[0].alive);

    let attached = second
        .call(Call::Attach {
            session,
            cols: 80,
            rows: 24,
            history: false,
        })
        .await;
    assert_eq!(
        attached,
        Outcome::Ok {
            reply: Reply::Attached {
                session,
                alive: true
            }
        }
    );
    // The snapshot comes first, and it holds what was on the screen.
    let Frame::Data { bytes, .. } = second.frame().await else {
        panic!("the snapshot follows the attach");
    };
    let snapshot = String::from_utf8_lossy(&bytes).to_string();
    assert!(snapshot.contains("before the drop"), "{snapshot:?}");

    // And live output carries on after it.
    second.type_in(session, "after the return\n").await;
    second.until_output(session, "after the return").await;

    // Closing is explicit, and ends the program.
    let closed = second.call(Call::Close { session }).await;
    assert_eq!(closed, Outcome::Ok { reply: Reply::Done });
    let listed = second.call(Call::List).await;
    assert_eq!(
        listed,
        Outcome::Ok {
            reply: Reply::Sessions { sessions: vec![] }
        }
    );
}

#[tokio::test]
async fn an_ended_program_is_reported_and_its_last_screen_kept() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let Outcome::Ok {
        reply: Reply::Opened { session, .. },
    } = client
        .call(Call::Open {
            cols: 40,
            rows: 5,
            cwd: None,
            command: sh("printf 'last words\\n'"),
            env: vec![],
            label: "short".into(),
        })
        .await
    else {
        panic!("expected opened");
    };
    loop {
        if let ServerMessage::Event(Event::Exited { session: s, .. }) = client.control().await {
            assert_eq!(s, session);
            break;
        }
    }
    let attached = client
        .call(Call::Attach {
            session,
            cols: 40,
            rows: 5,
            history: false,
        })
        .await;
    assert_eq!(
        attached,
        Outcome::Ok {
            reply: Reply::Attached {
                session,
                alive: false
            }
        }
    );
    let Frame::Data { bytes, .. } = client.frame().await else {
        panic!("the last screen follows");
    };
    assert!(String::from_utf8_lossy(&bytes).contains("last words"));
}

#[tokio::test]
async fn a_client_outside_the_protocol_window_is_refused_with_a_reason() {
    let daemon = Daemon::start(600);
    let mut stream = connect(&daemon.socket()).await;
    write_frame(
        &mut stream,
        &Frame::control(&ClientMessage::Hello {
            protocol_min: PROTOCOL + 1,
            protocol: PROTOCOL + 5,
            client: "from the future".into(),
        }),
    )
    .await
    .unwrap();
    let Some(Frame::Control(json)) = read_frame(&mut stream).await.unwrap() else {
        panic!("expected an answer");
    };
    match serde_json::from_slice::<ServerMessage>(&json).unwrap() {
        ServerMessage::Refused { reason } => assert!(reason.contains("protocol"), "{reason}"),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn a_daemon_with_nothing_to_do_exits_and_cleans_up_its_socket() {
    let mut daemon = Daemon::start(1);
    let socket = daemon.socket();
    // It listens…
    drop(connect(&socket).await);
    // …and with no client and no terminal, leaves within its idle time.
    let mut exited = false;
    for _ in 0..80 {
        if let Ok(Some(_)) = daemon.child.try_wait() {
            exited = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(exited, "the idle daemon is still running");
    assert!(!socket.exists(), "it removed its socket on the way out");
}

#[tokio::test]
async fn attach_starts_a_daemon_and_joins_stdio_to_it() {
    let home = tempfile::tempdir().unwrap();
    let mut attach = tokio::process::Command::new(BIN)
        .arg("attach")
        .env("UXNAN_HOST_HOME", home.path())
        .env("UXNAN_HOST_IDLE_SECS", "2")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut stdout = attach.stdout.take().unwrap();
    let mut stdin = attach.stdin.take().unwrap();

    // The ready line, then frames.
    use tokio::io::AsyncReadExt;
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    while line.last() != Some(&b'\n') {
        stdout.read_exact(&mut byte).await.unwrap();
        line.push(byte[0]);
    }
    assert_eq!(
        String::from_utf8_lossy(&line).trim(),
        format!("{} {PROTOCOL}", uxnan_host_protocol::READY_LINE)
    );
    write_frame(
        &mut stdin,
        &Frame::control(&ClientMessage::Hello {
            protocol_min: PROTOCOL_MIN,
            protocol: PROTOCOL,
            client: "attach-test".into(),
        }),
    )
    .await
    .unwrap();
    let Some(Frame::Control(json)) = read_frame(&mut stdout).await.unwrap() else {
        panic!("expected the welcome through attach");
    };
    assert!(matches!(
        serde_json::from_slice::<ServerMessage>(&json).unwrap(),
        ServerMessage::Welcome(_)
    ));
    // The daemon it started is detached: ending attach leaves it to its own
    // idle timer, which then removes the socket.
    drop(stdin);
    let _ = attach.wait().await;
    let socket = socket_in(home.path());
    for _ in 0..100 {
        if !socket.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the detached daemon never wound down");
}

#[tokio::test]
async fn a_daemon_never_removes_a_socket_that_is_not_its_own() {
    // The case: this daemon's socket was replaced (it was frozen, judged dead,
    // and another daemon took the path). When it finally winds down, the
    // socket at that path belongs to someone else and must stay.
    let mut daemon = Daemon::start(1);
    let socket = daemon.socket();
    drop(connect(&socket).await);
    std::fs::remove_file(&socket).unwrap();
    std::fs::write(&socket, b"another daemon's").unwrap();
    for _ in 0..80 {
        if let Ok(Some(_)) = daemon.child.try_wait() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(socket.exists(), "the other daemon's socket was removed");
}

#[tokio::test]
async fn a_watched_folder_reports_what_changed_in_it_but_not_in_git() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let folder = tempfile::tempdir().unwrap();
    // macOS reports `/private/var/...` for a `/var/...` temp dir.
    let root = std::fs::canonicalize(folder.path()).unwrap();
    std::fs::create_dir(root.join(".git")).unwrap();
    let watched = client
        .call(Call::Watch {
            root: root.display().to_string(),
        })
        .await;
    assert_eq!(watched, Outcome::Ok { reply: Reply::Done });
    tokio::time::sleep(Duration::from_millis(200)).await;

    std::fs::write(root.join(".git").join("index"), b"git churn").unwrap();
    std::fs::write(root.join("notes.md"), b"hello").unwrap();
    // Changes can arrive over more than one batch; every batch is held to the
    // watched folder and keeps git's churn out of its paths, and the new file
    // shows up in one of them.
    let notes = root.join("notes.md").display().to_string();
    let inside = format!("{}", root.display());
    let mut heard_git = false;
    let mut heard_notes = false;
    let seen = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ServerMessage::Event(Event::Changed {
                root: r,
                paths,
                overflow,
                git,
            }) = client.control().await
            else {
                continue;
            };
            assert_eq!(r, inside);
            assert!(!overflow);
            heard_git |= git;
            assert!(
                paths.iter().all(|p| p.starts_with(&inside)),
                "nothing outside the folder is reported: {paths:?}"
            );
            assert!(
                paths.iter().all(|p| !p.contains("/.git")),
                "git's own churn is not a path: {paths:?}"
            );
            heard_notes |= paths.contains(&notes);
            if heard_notes && heard_git {
                return;
            }
        }
    })
    .await;
    assert!(
        seen.is_ok(),
        "never heard both the new file ({heard_notes}) and the git flag ({heard_git})"
    );
}

#[tokio::test]
async fn a_call_this_daemon_does_not_know_is_answered_and_the_connection_stays() {
    // A newer app asking an older daemon for something added since. Hanging up
    // would take every terminal on the connection down for a feature none of
    // them use.
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    write_frame(
        &mut client.stream,
        &Frame::Control(
            br#"{"type":"request","id":77,"call":{"method":"teleport","to":"mars"}}"#.to_vec(),
        ),
    )
    .await
    .unwrap();
    loop {
        if let ServerMessage::Response { id, outcome } = client.control().await {
            assert_eq!(id, 77);
            assert!(matches!(outcome, Outcome::Error { .. }), "{outcome:?}");
            break;
        }
    }
    let listed = client.call(Call::List).await;
    assert_eq!(
        listed,
        Outcome::Ok {
            reply: Reply::Sessions { sessions: vec![] }
        }
    );
}

async fn open_shell(client: &mut Client, agent_id: &str) -> u32 {
    let opened = client
        .call(Call::Open {
            cols: 100,
            rows: 30,
            cwd: None,
            command: Some(vec!["/bin/sh".into()]),
            env: vec![("UXNAN_AGENT_ID".into(), agent_id.into())],
            label: agent_id.into(),
        })
        .await;
    match opened {
        Outcome::Ok {
            reply: Reply::Opened { session, .. },
        } => session,
        other => panic!("open failed: {other:?}"),
    }
}

#[tokio::test]
async fn an_agents_report_reaches_its_own_terminal_and_waits_while_nobody_watches() {
    let daemon = Daemon::start(600);
    let (mut a, _) = Client::hello(&daemon.socket()).await;
    let (mut b, _) = Client::hello(&daemon.socket()).await;
    let mine = open_shell(&mut a, "tab-1").await;
    let _theirs = open_shell(&mut b, "tab-2").await;

    // The coordinates are on disk too, for the user alone.
    let endpoint = daemon.home.path().join("run").join("endpoint.env");
    let text = std::fs::read_to_string(&endpoint).unwrap();
    assert!(
        text.starts_with("UXNAN_HOOK_URL=http://127.0.0.1:"),
        "{text}"
    );
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&endpoint).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // What an agent's hook runner does: pipe the raw event to the reporter.
    let event = r#"{"hook_event_name":"Stop","session_id":"s-1"}"#;
    let script = reporter().display().to_string();
    a.type_in(
        mine,
        &format!("printf '%s' '{event}' | sh '{script}' claude\n"),
    )
    .await;
    let (session, headers, body) = next_hook(&mut a).await;
    assert_eq!(session, mine);
    assert_eq!(body, event);
    let header = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    };
    assert_eq!(header("x-uxnan-agent-id"), Some("tab-1"));
    assert_eq!(header("x-uxnan-agent-type"), Some("claude"));
    assert_eq!(
        header("x-uxnan-token"),
        None,
        "the token never leaves the host"
    );

    // Another client's connection never hears it.
    let other = tokio::time::timeout(Duration::from_millis(800), async {
        next_hook(&mut b).await
    })
    .await;
    assert!(
        other.is_err(),
        "a report reached a terminal it did not come from"
    );

    // Nobody watching: the report waits, and comes after the screen.
    a.type_in(
        mine,
        &format!("sleep 1; printf '%s' '{event}' | sh '{script}' claude\n"),
    )
    .await;
    assert_eq!(
        a.call(Call::Detach { session: mine }).await,
        Outcome::Ok { reply: Reply::Done }
    );
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let attached = a
        .call(Call::Attach {
            session: mine,
            cols: 100,
            rows: 30,
            history: false,
        })
        .await;
    assert!(matches!(
        attached,
        Outcome::Ok {
            reply: Reply::Attached { alive: true, .. }
        }
    ));
    let mut saw_screen = false;
    let held = loop {
        match a.frame().await {
            Frame::Data { session, .. } if session == mine => saw_screen = true,
            Frame::Control(json) => {
                if let ServerMessage::Event(Event::Hook { session, body, .. }) =
                    serde_json::from_slice(&json).unwrap()
                {
                    break (session, body);
                }
            }
            _ => {}
        }
    };
    assert!(saw_screen, "the held report came before the screen");
    assert_eq!(held, (mine, event.to_string()));
}

#[tokio::test]
async fn wiring_hooks_registers_the_reporters_with_the_agents_this_host_has() {
    let daemon = Daemon::start(600);
    let home = daemon.user_home();
    // Claude has been used here: its folder exists, with a setting of the
    // person's own that wiring must keep.
    std::fs::create_dir(home.join(".claude")).unwrap();
    std::fs::write(
        home.join(".claude").join("settings.json"),
        r#"{"theme":"dark"}"#,
    )
    .unwrap();

    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let wired = client.call(Call::WireHooks).await;
    let Outcome::Ok {
        reply: Reply::HooksWired { agents },
    } = wired
    else {
        panic!("wiring failed: {wired:?}");
    };
    assert!(agents.contains(&"claude".to_string()), "{agents:?}");

    let settings = std::fs::read_to_string(home.join(".claude").join("settings.json")).unwrap();
    assert!(settings.contains("uxnan-status-relay.cjs"), "{settings}");
    assert!(
        settings.contains("\"theme\""),
        "the person's own setting stays"
    );
    assert!(home
        .join(".uxnan")
        .join("hooks")
        .join("uxnan-event-hook.sh")
        .is_file());

    // Idempotent: wiring again changes nothing.
    let again = client.call(Call::WireHooks).await;
    assert!(matches!(
        again,
        Outcome::Ok {
            reply: Reply::HooksWired { .. }
        }
    ));
    assert_eq!(
        std::fs::read_to_string(home.join(".claude").join("settings.json")).unwrap(),
        settings
    );
}

#[tokio::test]
async fn a_terminal_keeps_the_accounts_umask() {
    // The daemon is a long-lived process every terminal inherits from; a
    // private umask of its own would make every file made in them unreadable
    // to the person's group, unlike any other SSH session.
    let daemon = Daemon::start_detached(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let session = open_shell(&mut client, "tab-umask").await;
    client
        .type_in(session, "echo UMASK_$(umask)_$((6*7))\n")
        .await;
    let seen = client.until_output(session, "_42").await;
    let line = seen
        .split("UMASK_")
        .filter_map(|rest| rest.split("_42").next())
        .find(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or_else(|| panic!("no umask in {seen:?}"));
    assert_ne!(
        line.trim_start_matches('0'),
        "77",
        "the daemon's terminals got umask 077"
    );
}

/// Make `dir` look `secs` old.
fn age(dir: &Path, secs: u64) {
    let when = std::time::SystemTime::now() - Duration::from_secs(secs);
    std::fs::File::open(dir)
        .unwrap()
        .set_modified(when)
        .unwrap();
}

#[tokio::test]
async fn a_new_daemon_removes_the_old_builds_nothing_runs_from() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join("user")).unwrap();
    let versions = home.path().join("versions");
    for name in ["current", "old-unused", "old-held", "just-uploaded"] {
        std::fs::create_dir_all(versions.join(name)).unwrap();
    }
    // The daemon runs from a build folder, as `attach` starts it.
    let exe = versions.join("current").join("uxnan-host");
    std::fs::copy(BIN, &exe).unwrap();
    // Another process runs from this one: it holds the shared lock.
    let held = std::fs::File::create(versions.join("old-held").join(".in-use")).unwrap();
    {
        use std::os::unix::io::AsRawFd;
        assert_eq!(unsafe { libc::flock(held.as_raw_fd(), libc::LOCK_SH) }, 0);
    }
    for name in ["current", "old-unused", "old-held"] {
        age(&versions.join(name), 3600);
    }

    let daemon = Daemon::spawn(&exe, home, 600, &[]);
    let _ = connect(&daemon.socket()).await;
    for _ in 0..100 {
        if !versions.join("old-unused").exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        !versions.join("old-unused").exists(),
        "an old build nothing runs is removed"
    );
    assert!(
        versions.join("old-held").exists(),
        "a build a process runs from stays"
    );
    assert!(
        versions.join("just-uploaded").exists(),
        "a fresh upload stays"
    );
    assert!(
        versions.join("current").exists(),
        "the daemon's own build stays"
    );
    drop(held);
}

/// Whether `row-1` itself (not `row-10`…) is in what was seen.
fn has_row_one(seen: &str) -> bool {
    seen.match_indices("row-1")
        .any(|(i, m)| !seen[i + m.len()..].starts_with(|c: char| c.is_ascii_digit()))
}

/// Everything a session's screen-and-after sends, until `needle` shows up.
async fn attach_and_read(client: &mut Client, session: u32, history: bool, needle: &str) -> String {
    let attached = client
        .call(Call::Attach {
            session,
            cols: 100,
            rows: 30,
            history,
        })
        .await;
    assert!(matches!(
        attached,
        Outcome::Ok {
            reply: Reply::Attached { .. }
        }
    ));
    client.until_output(session, needle).await
}

#[tokio::test]
async fn a_viewer_that_starts_empty_gets_the_history_above_the_screen() {
    let daemon = Daemon::start(600);
    let (mut first, _) = Client::hello(&daemon.socket()).await;
    let session = open_shell(&mut first, "tab-history").await;
    first
        .type_in(
            session,
            "i=1; while [ $i -le 200 ]; do echo row-$i; i=$((i+1)); done; echo END_$((5*5))\n",
        )
        .await;
    first.until_output(session, "END_25").await;
    drop(first);

    // The app restarted: the tab is empty, so it asks for the history.
    let (mut fresh, _) = Client::hello(&daemon.socket()).await;
    let seen = attach_and_read(&mut fresh, session, true, "END_25").await;
    assert!(has_row_one(&seen), "the oldest rows come back");
    assert!(seen.contains("row-200"));
    drop(fresh);

    // Only the connection dropped: the tab kept its own, so none is resent.
    let (mut kept, _) = Client::hello(&daemon.socket()).await;
    let seen = attach_and_read(&mut kept, session, false, "END_25").await;
    assert!(
        !seen.contains("row-1\r"),
        "the history is not printed twice"
    );
}

#[tokio::test]
async fn closing_a_terminals_agent_leaves_its_shell_running() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let opened = client
        .call(Call::Open {
            cols: 100,
            rows: 30,
            cwd: None,
            command: Some(vec!["bash".into(), "--norc".into()]),
            env: vec![],
            label: "tab-stop".into(),
        })
        .await;
    let Outcome::Ok {
        reply: Reply::Opened { session, .. },
    } = opened
    else {
        panic!("open failed: {opened:?}");
    };
    // A stand-in agent, named like one, as the terminal's foreground job.
    client.type_in(session, "(exec -a claude sleep 30)\n").await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let commands = vec!["claude".to_string()];
    let stopped = client
        .call(Call::StopAgent {
            session,
            commands: commands.clone(),
        })
        .await;
    assert_eq!(
        stopped,
        Outcome::Ok {
            reply: Reply::AgentStopped {
                outcome: uxnan_host_protocol::AgentStop::Exited
            }
        }
    );
    // The shell is still there, taking the next command.
    client.type_in(session, "echo ALIVE_$((3+3))\n").await;
    client.until_output(session, "ALIVE_6").await;
    let again = client.call(Call::StopAgent { session, commands }).await;
    assert_eq!(
        again,
        Outcome::Ok {
            reply: Reply::AgentStopped {
                outcome: uxnan_host_protocol::AgentStop::NotRunning
            }
        }
    );
}

#[tokio::test]
async fn a_transcript_on_the_host_is_read_there_and_only_an_agents_own() {
    let daemon = Daemon::start(600);
    let home = daemon.user_home();
    let dir = home.join(".claude").join("projects").join("p");
    std::fs::create_dir_all(&dir).unwrap();
    let transcript = dir.join("s.jsonl");
    std::fs::write(
        &transcript,
        concat!(
            r#"{"message":{"role":"user","content":"what is this repo"}}"#,
            "\n",
            r#"{"message":{"role":"assistant","content":[{"type":"text","text":"A desktop app."}]}}"#,
            "\n"
        ),
    )
    .unwrap();
    let elsewhere = home.join("notes.jsonl");
    std::fs::copy(&transcript, &elsewhere).unwrap();

    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let read = client
        .call(Call::TranscriptPreview {
            agent_type: "claude".into(),
            path: transcript.display().to_string(),
        })
        .await;
    assert_eq!(
        read,
        Outcome::Ok {
            reply: Reply::Transcript {
                prompt: Some("what is this repo".into()),
                summary: Some("A desktop app.".into()),
            }
        }
    );
    let refused = client
        .call(Call::TranscriptPreview {
            agent_type: "claude".into(),
            path: elsewhere.display().to_string(),
        })
        .await;
    assert_eq!(
        refused,
        Outcome::Ok {
            reply: Reply::Transcript {
                prompt: None,
                summary: None
            }
        },
        "a file outside the agent's own transcripts is never read"
    );
}

/// The daemon's endpoint (`http://127.0.0.1:<port>`) and token, from the file
/// it writes for the reporters.
fn endpoint_of(daemon: &Daemon) -> (String, String) {
    let text =
        std::fs::read_to_string(daemon.home.path().join("run").join("endpoint.env")).unwrap();
    let field = |key: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .unwrap()
            .to_string()
    };
    let hook = field("UXNAN_HOOK_URL");
    (
        hook.trim_end_matches("/hook").to_string(),
        field("UXNAN_HOOK_TOKEN"),
    )
}

/// A bare HTTP/1.1 POST, as a CLI on the host makes one: `(status, body)`.
async fn post(base: &str, path: &str, headers: &[(&str, &str)], body: &str) -> (u16, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let addr = base.trim_start_matches("http://");
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let mut request = format!(
        "POST {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (k, v) in headers {
        request.push_str(&format!("{k}: {v}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut raw = String::new();
    stream.read_to_string(&mut raw).await.unwrap();
    let status = raw.split(' ').nth(1).unwrap().parse().unwrap();
    let body = raw
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    (status, body)
}

#[tokio::test]
async fn an_mcp_call_from_a_terminal_is_answered_by_the_app_watching_it() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let session = open_shell(&mut client, "tab-mcp").await;
    let (base, token) = endpoint_of(&daemon);
    let bearer = format!("Bearer {token}");
    let call = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;

    // What Claude does with its launch config: POST the call with the bearer
    // token and the terminal's id.
    let calling = tokio::spawn({
        let base = base.clone();
        let bearer = bearer.clone();
        async move {
            post(
                &base,
                "/mcp",
                &[("Authorization", &bearer), ("X-Uxnan-Agent-Id", "tab-mcp")],
                call,
            )
            .await
        }
    });
    // The app is told, answers with its own server's reply…
    let (ticket, body) = loop {
        if let ServerMessage::Event(Event::Mcp {
            ticket,
            session: s,
            body,
        }) = client.control().await
        {
            assert_eq!(s, session);
            break (ticket, body);
        }
    };
    assert_eq!(body, call);
    write_frame(
        &mut client.stream,
        &Frame::control(&ClientMessage::McpAnswer {
            ticket,
            status: 200,
            body: r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#.into(),
        }),
    )
    .await
    .unwrap();
    // …and that reply is the call's answer.
    let (status, answer) = calling.await.unwrap();
    assert_eq!(status, 200);
    assert_eq!(answer, r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#);

    // The token is required, and a terminal this daemon does not have is not
    // a terminal anyone can answer for.
    let (status, _) = post(
        &base,
        "/mcp",
        &[
            ("Authorization", "Bearer nope"),
            ("X-Uxnan-Agent-Id", "tab-mcp"),
        ],
        call,
    )
    .await;
    assert_eq!(status, 401);
    let (status, _) = post(
        &base,
        "/mcp",
        &[("Authorization", &bearer), ("X-Uxnan-Agent-Id", "tab-gone")],
        call,
    )
    .await;
    assert_eq!(status, 404);

    // The app goes before answering: the call is told so, not left hanging.
    let calling = tokio::spawn({
        let base = base.clone();
        let bearer = bearer.clone();
        async move {
            post(
                &base,
                "/mcp",
                &[("Authorization", &bearer), ("X-Uxnan-Agent-Id", "tab-mcp")],
                call,
            )
            .await
        }
    });
    loop {
        if let ServerMessage::Event(Event::Mcp { .. }) = client.control().await {
            break;
        }
    }
    drop(client);
    let (status, _) = calling.await.unwrap();
    assert_eq!(status, 502);
}

#[tokio::test]
async fn a_url_a_terminal_opens_reaches_the_app_watching_it() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let session = open_shell(&mut client, "tab-url").await;
    let (base, token) = endpoint_of(&daemon);
    // What the `$BROWSER` shim sends.
    let (status, _) = post(
        &base,
        "/browser",
        &[("X-Uxnan-Token", &token), ("X-Uxnan-Agent-Id", "tab-url")],
        r#"{"url":"http://localhost:5173/"}"#,
    )
    .await;
    assert_eq!(status, 204);
    let url = loop {
        if let ServerMessage::Event(Event::OpenUrl { session: s, url }) = client.control().await {
            assert_eq!(s, session);
            break url;
        }
    };
    assert_eq!(url, "http://localhost:5173/");
}

#[tokio::test]
async fn the_agent_tools_name_this_daemons_endpoint_and_this_machines_files() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let (base, token) = endpoint_of(&daemon);
    let tools = client.call(Call::AgentTools).await;
    let Outcome::Ok {
        reply:
            Reply::AgentTools {
                mcp_url,
                browser_url,
                token: given,
                browser_shim,
                claude_config,
                ..
            },
    } = tools
    else {
        panic!("no tools: {tools:?}");
    };
    assert_eq!(mcp_url, format!("{base}/mcp"));
    assert_eq!(browser_url, format!("{base}/browser"));
    assert_eq!(given, token);
    let shim = browser_shim.expect("the shim is written to this machine's hooks folder");
    assert!(
        shim.starts_with(&daemon.user_home().display().to_string()),
        "{shim}"
    );
    let config = std::fs::read_to_string(claude_config.expect("a Claude launch config")).unwrap();
    assert!(config.contains(&mcp_url), "{config}");
    assert!(
        !config.contains(&token),
        "the file names the token's variable, never the token"
    );
}

#[tokio::test]
async fn one_agents_hook_is_read_installed_and_removed_on_the_host() {
    let daemon = Daemon::start(600);
    let home = daemon.user_home();
    std::fs::create_dir(home.join(".claude")).unwrap();
    let (mut client, _) = Client::hello(&daemon.socket()).await;

    let claude_of = |agents: &serde_json::Value| {
        agents
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == "claude")
            .cloned()
            .unwrap()
    };
    let Outcome::Ok {
        reply: Reply::Hooks { agents },
    } = client.call(Call::HooksStatus).await
    else {
        panic!("no status");
    };
    let claude = claude_of(&agents);
    assert_eq!(claude["status"]["installed"], false);
    assert!(claude["configPath"]
        .as_str()
        .unwrap()
        .starts_with(&home.display().to_string()));

    let on = client
        .call(Call::SetHook {
            agent: "claude".into(),
            on: true,
        })
        .await;
    assert!(
        matches!(&on, Outcome::Ok { reply: Reply::Hook { status } } if status["installed"] == true),
        "{on:?}"
    );
    let Outcome::Ok {
        reply: Reply::Text { text },
    } = client
        .call(Call::HookConfig {
            agent: "claude".into(),
        })
        .await
    else {
        panic!("no config");
    };
    assert!(text.contains("uxnan-status-relay.cjs"), "{text}");

    let off = client
        .call(Call::SetHook {
            agent: "claude".into(),
            on: false,
        })
        .await;
    assert!(
        matches!(&off, Outcome::Ok { reply: Reply::Hook { status } } if status["installed"] == false),
        "{off:?}"
    );
    let settings = std::fs::read_to_string(home.join(".claude").join("settings.json")).unwrap();
    assert!(!settings.contains("uxnan-status-relay"), "{settings}");
}

/// One `Fs` call's answer, in the engine's own shape.
async fn fs_call(client: &mut Client, call: uxnan_host_protocol::FsCall) -> serde_json::Value {
    match client.call(Call::Fs(call)).await {
        Outcome::Ok {
            reply: Reply::Value { value },
        } => value,
        other => panic!("fs call failed: {other:?}"),
    }
}

#[tokio::test]
async fn a_projects_files_are_listed_saved_and_searched_on_the_host() {
    use uxnan_host_protocol::FsCall;
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let project = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(project.path())
        .unwrap()
        .display()
        .to_string();
    std::fs::create_dir(project.path().join("src")).unwrap();

    let created = fs_call(
        &mut client,
        FsCall::CreateFile {
            dir: root.clone(),
            path: "src/main.rs".into(),
        },
    )
    .await;
    let file = created.as_str().unwrap().to_string();
    fs_call(
        &mut client,
        FsCall::Write {
            path: file.clone(),
            content: "fn main() { println!(\"needle\"); }\n".into(),
        },
    )
    .await;
    let read = fs_call(&mut client, FsCall::Read { path: file.clone() }).await;
    // A file that is not there is the filesystem's refusal, coded as one so
    // the app reads it as it would its own.
    let Outcome::Error { code, .. } = client
        .call(Call::Fs(FsCall::Read {
            path: format!("{root}/absent.txt"),
        }))
        .await
    else {
        panic!("reading a file that is not there is refused");
    };
    assert_eq!(code, uxnan_host_protocol::ErrorCode::Io);
    assert!(
        read["content"].as_str().unwrap().contains("needle"),
        "{read}"
    );

    let listed = fs_call(
        &mut client,
        FsCall::List {
            path: format!("{root}/src"),
        },
    )
    .await;
    assert_eq!(listed.as_array().unwrap().len(), 1, "{listed}");
    assert_eq!(listed[0]["name"], "main.rs");

    // Search works outside any repository — the engine walks the folder itself.
    let by_name = fs_call(
        &mut client,
        FsCall::SearchFiles {
            root: root.clone(),
            query: "main".into(),
            include_hidden: false,
            filters: serde_json::json!({}),
            limit: 50,
        },
    )
    .await;
    assert!(by_name.to_string().contains("main.rs"), "{by_name}");
    let by_content = fs_call(
        &mut client,
        FsCall::SearchContent {
            root: root.clone(),
            query: serde_json::json!({ "query": "needle" }),
            include_hidden: false,
            filters: serde_json::json!({}),
            limit: 50,
        },
    )
    .await;
    assert!(by_content.to_string().contains("main.rs"), "{by_content}");

    let copy = fs_call(&mut client, FsCall::Duplicate { path: file.clone() }).await;
    let renamed = fs_call(
        &mut client,
        FsCall::Rename {
            path: file.clone(),
            new_name: "lib.rs".into(),
        },
    )
    .await;
    assert!(renamed.as_str().unwrap().ends_with("src/lib.rs"));
    fs_call(
        &mut client,
        FsCall::Delete {
            path: copy.as_str().unwrap().to_string(),
        },
    )
    .await;
    let names: Vec<String> = std::fs::read_dir(project.path().join("src"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names,
        vec!["lib.rs".to_string()],
        "deleted for good, the rest kept"
    );

    // A missing file is reported as missing, not as a broken call.
    let missing = client
        .call(Call::Fs(FsCall::Read {
            path: format!("{root}/nope.txt"),
        }))
        .await;
    assert!(matches!(missing, Outcome::Error { .. }), "{missing:?}");
}

async fn git_call(client: &mut Client, call: uxnan_host_protocol::GitCall) -> serde_json::Value {
    match client.call(Call::Git(call)).await {
        Outcome::Ok {
            reply: Reply::Value { value },
        } => value,
        other => panic!("git call failed: {other:?}"),
    }
}

/// `git` in `dir`, for setting a repository up the way a person would.
fn git_here(dir: &std::path::Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?}");
}

#[tokio::test]
async fn a_projects_git_is_read_staged_and_committed_on_the_host() {
    use uxnan_host_protocol::GitCall;
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let project = tempfile::tempdir().unwrap();
    let root = project.path().display().to_string();

    // A plain folder answers "not a repository", never zeroes that read as clean.
    let review = git_call(&mut client, GitCall::Review { path: root.clone() }).await;
    assert_eq!(review["isRepo"], false);
    let status = git_call(&mut client, GitCall::Status { path: root.clone() }).await;
    assert_eq!(status["isRepo"], false);

    git_here(project.path(), &["init", "-q", "-b", "main"]);
    git_here(project.path(), &["config", "user.name", "Uxnan Test"]);
    git_here(
        project.path(),
        &["config", "user.email", "test@uxnan.invalid"],
    );
    git_here(project.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(project.path().join("a.txt"), "first\n").unwrap();
    git_call(
        &mut client,
        GitCall::Stage {
            path: root.clone(),
            file: "a.txt".into(),
        },
    )
    .await;
    git_call(
        &mut client,
        GitCall::Commit {
            path: root.clone(),
            message: "  the first commit\n".into(),
            amend: false,
            sign_off: false,
        },
    )
    .await;
    let log = git_call(
        &mut client,
        GitCall::Log {
            path: root.clone(),
            limit: 10,
            skip: 0,
        },
    )
    .await;
    assert_eq!(log[0]["subject"], "the first commit", "{log}");

    std::fs::write(project.path().join("a.txt"), "first\nsecond\n").unwrap();
    let review = git_call(&mut client, GitCall::Review { path: root.clone() }).await;
    assert_eq!(review["isRepo"], true);
    assert_eq!(review["files"][0]["path"], "a.txt", "{review}");
    assert_eq!(review["numstat"][0]["added"], 1, "{review}");
    assert!(review["head"].as_str().is_some_and(|h| h.len() >= 7));
    let status = git_call(&mut client, GitCall::Status { path: root.clone() }).await;
    assert_eq!(status["branch"], "main");
    assert_eq!(status["dirty"], 1);
    let diff = git_call(
        &mut client,
        GitCall::Diff {
            path: root.clone(),
            file: "a.txt".into(),
            staged: false,
        },
    )
    .await;
    assert!(diff.as_str().unwrap().contains("+second"), "{diff}");

    // An empty message is the caller's mistake; a file git does not know is
    // git's own no, in its words.
    let Outcome::Error { code, .. } = client
        .call(Call::Git(GitCall::Commit {
            path: root.clone(),
            message: "  ".into(),
            amend: false,
            sign_off: false,
        }))
        .await
    else {
        panic!("an empty commit message is refused");
    };
    assert_eq!(code, uxnan_host_protocol::ErrorCode::Invalid);
    let Outcome::Error { code, message } = client
        .call(Call::Git(GitCall::Stage {
            path: root.clone(),
            file: "absent.txt".into(),
        }))
        .await
    else {
        panic!("staging a file that is not there is refused");
    };
    assert_eq!(code, uxnan_host_protocol::ErrorCode::Git, "{message}");
    assert!(message.contains("absent.txt"), "{message}");

    git_call(
        &mut client,
        GitCall::Discard {
            path: root.clone(),
            file: "a.txt".into(),
            untracked: false,
        },
    )
    .await;
    let review = git_call(&mut client, GitCall::Review { path: root.clone() }).await;
    assert_eq!(review["files"], serde_json::json!([]), "{review}");
    assert_eq!(
        std::fs::read_to_string(project.path().join("a.txt")).unwrap(),
        "first\n"
    );
}

#[tokio::test]
async fn a_projects_worktrees_are_listed_made_and_removed_on_the_host() {
    use uxnan_host_protocol::GitCall;
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let base = tempfile::tempdir().unwrap();
    // As git names it: macOS resolves `/var` to `/private/var`.
    let base_path = std::fs::canonicalize(base.path()).unwrap();
    let repo = base_path.join("app");
    std::fs::create_dir(&repo).unwrap();
    git_here(&repo, &["init", "-q", "-b", "main"]);
    git_here(&repo, &["config", "user.name", "Uxnan Test"]);
    git_here(&repo, &["config", "user.email", "test@uxnan.invalid"]);
    git_here(&repo, &["config", "commit.gpgsign", "false"]);
    std::fs::write(repo.join("a.txt"), "one\n").unwrap();
    git_here(&repo, &["add", "-A"]);
    git_here(&repo, &["commit", "-q", "-m", "first"]);
    let root = repo.display().to_string();
    let worktrees_root = base_path.join("wt").display().to_string();

    let branches = git_call(&mut client, GitCall::Branches { path: root.clone() }).await;
    assert_eq!(
        branches["branches"],
        serde_json::json!(["main"]),
        "{branches}"
    );
    assert_eq!(branches["defaultBase"], "main");

    // Where it would go, by this machine's layout and the root it was given.
    let preview = git_call(
        &mut client,
        GitCall::WorktreeLocation {
            path: root.clone(),
            branch: "feature/x".into(),
            mode: serde_json::json!("custom"),
            root: Some(worktrees_root.clone()),
        },
    )
    .await;
    assert_eq!(preview, format!("{worktrees_root}/app/feature-x"));

    let created = git_call(
        &mut client,
        GitCall::AddWorktree {
            path: root.clone(),
            spec: serde_json::json!({ "branch": "feature/x" }),
            mode: serde_json::json!("custom"),
            root: Some(worktrees_root.clone()),
        },
    )
    .await;
    assert_eq!(created["path"], preview, "{created}");
    assert_eq!(created["branch"], "feature/x");

    let listed = git_call(&mut client, GitCall::Worktrees { path: root.clone() }).await;
    assert_eq!(listed.as_array().unwrap().len(), 2, "{listed}");
    // A branch that never moved has not landed anywhere.
    let finished = git_call(
        &mut client,
        GitCall::BranchIntegrated {
            path: preview.as_str().unwrap().to_string(),
            branch: "feature/x".into(),
        },
    )
    .await;
    assert_eq!(finished, false);

    let outcome = git_call(
        &mut client,
        GitCall::RemoveWorktree {
            path: root.clone(),
            worktree: preview.as_str().unwrap().to_string(),
            branch: Some("feature/x".into()),
            force: false,
            cleanup: serde_json::json!({}),
        },
    )
    .await;
    assert!(outcome.is_object(), "{outcome}");
    let listed = git_call(&mut client, GitCall::Worktrees { path: root.clone() }).await;
    assert_eq!(listed.as_array().unwrap().len(), 1, "{listed}");
    assert!(!std::path::Path::new(preview.as_str().unwrap()).exists());
}

/// The next word on which agent a terminal runs, skipping everything else.
async fn next_agent(client: &mut Client) -> (u32, Option<String>) {
    loop {
        if let ServerMessage::Event(Event::Agent { session, command }) = client.control().await {
            return (session, command);
        }
    }
}

#[tokio::test]
async fn the_agent_a_terminal_runs_is_said_as_it_changes_and_to_who_comes_back() {
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    let opened = client
        .call(Call::Open {
            cols: 100,
            rows: 30,
            cwd: None,
            command: Some(vec!["bash".into(), "--norc".into()]),
            env: vec![],
            label: "tab-agent".into(),
        })
        .await;
    let Outcome::Ok {
        reply: Reply::Opened { session, .. },
    } = opened
    else {
        panic!("open failed: {opened:?}");
    };
    let commands = vec!["claude".to_string()];
    assert_eq!(
        client
            .call(Call::WatchAgents {
                commands: commands.clone()
            })
            .await,
        Outcome::Ok { reply: Reply::Done }
    );

    // A stand-in agent, named like one, as the terminal's foreground job.
    client.type_in(session, "(exec -a claude sleep 30)\n").await;
    assert_eq!(
        next_agent(&mut client).await,
        (session, Some("claude".to_string()))
    );

    // A viewer that comes back is told at once, not on the next change.
    let (mut back, _) = Client::hello(&daemon.socket()).await;
    let attached = back
        .call(Call::Attach {
            session,
            cols: 100,
            rows: 30,
            history: false,
        })
        .await;
    assert!(matches!(attached, Outcome::Ok { .. }), "{attached:?}");
    assert_eq!(
        next_agent(&mut back).await,
        (session, Some("claude".to_string()))
    );

    // And when it ends, both are told the shell is back to itself.
    let stopped = client.call(Call::StopAgent { session, commands }).await;
    assert!(matches!(stopped, Outcome::Ok { .. }), "{stopped:?}");
    assert_eq!(next_agent(&mut client).await, (session, None));
    assert_eq!(next_agent(&mut back).await, (session, None));
}

#[tokio::test]
async fn a_hosts_old_worktrees_are_found_and_removed_there_but_never_one_in_use() {
    use uxnan_host_protocol::CleanupCall;
    use uxnan_workspace_engine::worktreeloc::{repo_key, MARKER_FILE};
    let daemon = Daemon::start(600);
    let (mut client, _) = Client::hello(&daemon.socket()).await;
    // The account's own managed root, where this host's worktrees live.
    // As the account's HOME spells it — what both its terminals and the
    // cleanup's roots start from.
    let home = daemon.user_home();
    let repo_dir = tempfile::tempdir().unwrap();
    let repo = std::fs::canonicalize(repo_dir.path()).unwrap();
    git_here(&repo, &["init", "-q", "-b", "main"]);
    let repo = repo.display().to_string().replace('\\', "/");
    let group = home.join("uxnan/worktrees").join(repo_key(&repo));
    std::fs::create_dir_all(&group).unwrap();
    std::fs::write(group.join(MARKER_FILE), &repo).unwrap();
    // Two leftovers git does not own; a terminal stands in the second.
    let stray = group.join("stray");
    let held = group.join("held");
    std::fs::create_dir_all(&stray).unwrap();
    std::fs::create_dir_all(&held).unwrap();
    let held_path = held.display().to_string().replace('\\', "/");
    let opened = client
        .call(Call::Open {
            cols: 80,
            rows: 24,
            cwd: Some(held_path.clone()),
            command: Some(vec!["sh".into()]),
            env: vec![],
            label: "tab-held".into(),
        })
        .await;
    assert!(matches!(opened, Outcome::Ok { .. }), "{opened:?}");

    let call = |op: CleanupCall| Call::Cleanup(op);
    let Outcome::Ok {
        reply: Reply::Value { value: found },
    } = client
        .call(call(CleanupCall::Scan {
            roots: vec![],
            projects: vec![repo.clone()],
        }))
        .await
    else {
        panic!("the scan answers");
    };
    let kind_of = |name: &str| {
        found
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .map(|c| c["kind"].as_str().unwrap().to_string())
    };
    assert_eq!(kind_of("stray").as_deref(), Some("orphaned"), "{found}");
    assert_eq!(kind_of("held").as_deref(), Some("blocked"), "{found}");

    let stray_path = stray.display().to_string().replace('\\', "/");
    let Outcome::Ok {
        reply: Reply::Value { value: outcome },
    } = client
        .call(call(CleanupCall::Remove {
            roots: vec![],
            projects: vec![repo.clone()],
            paths: vec![stray_path.clone(), held_path.clone()],
        }))
        .await
    else {
        panic!("the removal answers");
    };
    assert_eq!(
        outcome["removed"],
        serde_json::json!([stray_path]),
        "{outcome}"
    );
    assert_eq!(outcome["refused"][0]["path"], held_path, "{outcome}");
    assert!(!stray.exists());
    assert!(
        held.exists(),
        "a folder a terminal stands in is never taken"
    );
}
