//! The daemon, as the real binary, over its real socket: open a terminal, lose
//! the connection, come back and find the same screen; and the lifecycle around
//! it — the version check, refusing a client it cannot speak to, attach
//! starting a daemon, and exiting once there is nothing left to do.
//!
//! Every test points `UXNAN_HOST_HOME` at a temporary directory: nothing here
//! touches `~/.uxnan`.

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
        let home = tempfile::tempdir().unwrap();
        let child = Command::new(BIN)
            .arg("serve")
            .env("UXNAN_HOST_HOME", home.path())
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
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn socket_in(home: &Path) -> PathBuf {
    home.join("run").join(format!("engine-v{PROTOCOL}.sock"))
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
