//! `uxnan-host` — the daemon Uxnan Desktop runs on a remote machine.
//!
//! A terminal opened over a plain SSH channel dies with the channel: a laptop
//! lid, a Wi-Fi handover or an app update ends it, and the agent running in it
//! with it. This daemon owns the host's terminals instead. It runs detached from
//! any SSH session, keeps each terminal's screen, and lets the desktop come
//! back and pick up exactly where it was.
//!
//! Subcommands:
//!
//! - `version` — what this build is, as one JSON line (the installer's check
//!   that the binary actually runs on this machine).
//! - `attach` — join stdin/stdout to the daemon's socket, starting the daemon
//!   if it is not running. This is what the desktop `exec`s over SSH.
//! - `serve` — be the daemon (normally started by `attach`, detached).

mod agent_socket;
mod agents;
mod attach;
mod cleanup;
mod daemon;
mod endpoint;
mod files;
mod log;
mod paths;
mod repo;
mod versions;

use uxnan_host_protocol::{PROTOCOL, PROTOCOL_MIN};

/// How long a daemon with nothing to do — no client, no live terminal — waits
/// before it exits. It costs nothing while it waits, but a machine should not
/// keep a process of ours forever after the last terminal on it ended.
const DEFAULT_IDLE_SECS: u64 = 30 * 60;

fn main() {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_default();
    let code = match command.as_str() {
        "version" | "--version" | "-V" => {
            println!("{}", version_json());
            0
        }
        "attach" => run(attach::attach()),
        "serve" => {
            // A terminal's identity must never be inherited: started from
            // inside one of our own terminals, the daemon would hand that
            // terminal's coordinates to every terminal it opens.
            for key in uxnan_workspace_engine::pty::PER_TERMINAL_KEYS {
                std::env::remove_var(key);
            }
            agent_socket::hand_on_the_stable_path();
            let detached = args.any(|a| a == "--detached");
            if detached {
                daemon::detach_from_session();
            }
            let idle = std::env::var("UXNAN_HOST_IDLE_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_IDLE_SECS);
            run(daemon::serve(std::time::Duration::from_secs(idle)))
        }
        _ => {
            eprintln!("usage: uxnan-host version | attach | serve [--detached]");
            2
        }
    };
    std::process::exit(code);
}

fn run<F: std::future::Future<Output = std::io::Result<()>>>(future: F) -> i32 {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("uxnan-host: could not start: {e}");
            return 1;
        }
    };
    match runtime.block_on(future) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("uxnan-host: {e}");
            1
        }
    }
}

/// The account's home, as its terminals see it.
fn paths_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

fn version_json() -> String {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL,
        "protocolMin": PROTOCOL_MIN,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
    .to_string()
}
