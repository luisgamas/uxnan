//! The control protocol of Uxnan Desktop — the one contract behind every way of
//! operating the app from outside its own window.
//!
//! Three things can ask Uxnan to do something: the webview (Tauri commands), an
//! agent the app launched (MCP tools, discovered by that agent with nothing to
//! install), and the console client `uxnan-cli` (a person or a script in any
//! shell, or an agent launched elsewhere). The first is internal; the other two
//! are this protocol. Both name the **same** [`catalog`] entries — an MCP tool
//! `worktree_list` and a JSON-RPC method `worktree/list` are one entry with one
//! argument schema and one result — so the two transports cannot drift apart.
//!
//! This crate holds only the contract: what the entries are, how a request and a
//! response look on the wire, how a client finds the running app, and how a
//! caller names a project, a worktree or a terminal without copying ids off the
//! sidebar. It has no I/O and no runtime; the app implements the entries, the
//! client speaks them.

pub mod catalog;
pub mod datadir;
pub mod discovery;
pub mod rpc;
pub mod selector;

/// The protocol version a client and the app must agree on. Bumped only for a
/// change an old client cannot survive (a renamed entry, a removed field, a
/// changed error shape). Adding entries or result fields keeps the number.
pub const PROTOCOL_VERSION: u32 = 1;

/// The JSON-RPC route on the app's local server.
pub const RPC_PATH: &str = "/control/v1/rpc";

/// The MCP route on the same server (the agent-facing transport).
pub const MCP_PATH: &str = "/mcp";

/// Environment variables the app sets in every terminal it spawns. A client that
/// finds them is running *inside* Uxnan: it may use the per-launch token (which
/// is scoped to that terminal's project) and it knows which terminal it is.
pub mod env {
    /// Base URL of the hook/control server, e.g. `http://127.0.0.1:51234/hook`
    /// (the client derives the RPC route from its origin).
    pub const HOOK_URL: &str = "UXNAN_HOOK_URL";
    /// The per-launch token that authorizes hook reports and MCP calls.
    pub const HOOK_TOKEN: &str = "UXNAN_HOOK_TOKEN";
    /// The terminal (PTY) id of the process, echoed back as the `current`
    /// selector's anchor.
    pub const AGENT_ID: &str = "UXNAN_AGENT_ID";
}

/// HTTP headers the RPC route reads.
pub mod headers {
    /// The token, as `Bearer <token>` — what every supported agent CLI can send.
    pub const AUTHORIZATION: &str = "authorization";
    /// The token, legacy header form (what the hook scripts send).
    pub const TOKEN: &str = "x-uxnan-token";
    /// The caller's own terminal id, so `current` resolves to it.
    pub const AGENT_ID: &str = "x-uxnan-agent-id";
}
