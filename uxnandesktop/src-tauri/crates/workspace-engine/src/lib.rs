//! The workspace engine: the part of Uxnan Desktop that does the work on a
//! machine — its terminals, the screen each one shows, watching the folder a
//! project is in, and wiring the agents' hooks so they report their state.
//!
//! It is **one** implementation used in two places. On this machine the app
//! links it in process; on a remote host the `uxnan-host` daemon links the same
//! code and serves it over SSH. A capability built here therefore reaches both
//! machines at once, instead of being written twice and drifting apart.
//!
//! Nothing here knows about Tauri, windows or events: output and exits go to
//! caller-supplied sinks, so the engine is testable on its own and each host —
//! the desktop, the daemon — wires the sinks to its own transport.

pub mod agent_hooks;
pub mod agentstop;
pub mod browse;
pub mod codex_trust;
pub mod error;
pub mod fs;
pub mod git;
pub mod gitfast;
pub mod mcp_launch;
pub mod ports;
pub mod procscan;
pub mod pty;
pub mod screen;
pub mod transcript;
pub mod watch;
pub mod winproc;
pub mod worktreeloc;
pub mod wsl;

pub use error::Error;
