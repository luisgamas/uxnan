//! The services behind the catalog — the one implementation each entry has.
//!
//! A service is a plain async function over the app handle; the Tauri command
//! the webview calls, the MCP tool and the RPC method all end here. A service
//! that answers from backend state (projects, worktrees, the agent cache) does
//! so directly; one that needs the window (tabs, open files, runs) asks it
//! through `control::bridge`. Results are JSON values shaped for the caller
//! and stable across versions: a field may be added, never renamed or removed
//! without a protocol bump.

pub mod agent;
pub mod automation;
pub mod browser;
pub mod chat;
pub mod host;
pub mod orchestration;
pub mod project;
pub mod run;
pub mod status;
pub mod terminal;
pub mod ui;
pub mod worktree;
