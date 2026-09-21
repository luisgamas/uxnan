//! The control surface — how anything outside the webview operates the app.
//!
//! One catalog (`uxnan_control_protocol::catalog`), one dispatcher
//! ([`dispatch`]), one set of services, and two transports over the app's one
//! local server ([`server`]): MCP for the agents the app launches ([`mcp`]) and
//! JSON-RPC for `uxnan-cli` and anything else on this machine ([`rpc`]). The
//! webview's own Tauri commands call the same services, so a thing the UI can do
//! and a thing an agent can do are the same code with three doors.
//!
//! What the surface will **not** do, by construction: run a shell, write raw
//! bytes to a terminal, touch the filesystem or git destructively, expose a
//! credential, or edit the persisted state from outside. Nothing outside the
//! catalog is reachable; the catalog's groups can be switched off one by one.
//!
//! Some resources are owned by the webview — terminal tabs, open files, the
//! orchestration runs — because that is where they live. For those the
//! services ask the window through [`bridge`] and wait for its answer, rather
//! than reinterpreting a serialization the backend has always treated as opaque.

pub mod audit;
pub mod bridge;
pub mod cli;
pub mod discovery;
mod dispatch;
pub mod mcp;
mod params;
pub mod receipts;
pub mod redact;
mod resolve;
pub mod rpc;
pub mod server;
pub mod services;
#[cfg(test)]
mod tests;

pub use dispatch::dispatch;
pub use server::Caller;
