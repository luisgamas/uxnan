//! This machine's terminals, served by the workspace engine.
//!
//! The PTY manager lives in `crates/workspace-engine` because it is the same
//! code that runs a remote host's terminals inside the host daemon: one
//! implementation, two machines. This module only keeps the path the rest of
//! the app has always imported it from.

pub use uxnan_workspace_engine::pty::{PtyManager, PtySpec};
