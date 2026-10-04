//! A host's own bridge, reached from here (`02g` §5.18).
//!
//! Conversations, headless runs and the phone belong to the bridge, and on a
//! host that is **the host's bridge** — the same `uxnan-bridge` this machine
//! runs, installed there. The desktop talks to it exactly as it talks to its own:
//! the local control channel (`02a` §5.8.15), a WebSocket on that machine's
//! loopback guarded by a token in `~/.uxnan/local-control.json`.
//!
//! Two things make that work from here, and neither adds a listener anywhere:
//!
//! - **The record is read by the host engine**, from the account the bridge runs
//!   as. It is the only place the token exists, and it never touches this
//!   machine's disk: it lives in memory for as long as the link does.
//! - **The socket is an SSH `direct-tcpip` channel to the host's `127.0.0.1`.**
//!   `sshd` opens it from that machine's loopback, which is the peer the bridge
//!   requires, so the channel's authorization is unchanged — loopback, no
//!   `Origin`, the bearer token — and nothing on this machine listens for it.

use crate::bridgeclient::discovery::{self, Discovery};
use crate::error::AppError;
use crate::ssh::conn::{Connection, HostStream};
use crate::ssh::engine::HostEngine;

/// Where the bridge of the account at `home` writes its discovery record —
/// the same path `discovery::default_path` names here, on that machine.
pub fn discovery_path(home: &str) -> String {
    let home = home.trim_end_matches(['/', '\\']);
    format!("{home}/.uxnan/{}", discovery::FILE_NAME)
}

/// The bridge's discovery record on a host, read by its engine.
///
/// `Ok(None)` when there is none — no bridge installed, or one that is not
/// running (it removes the record when it stops). A record that is there but
/// is not one is an error: it says something is wrong on that machine, which
/// "no bridge" would hide.
pub async fn discover(engine: &HostEngine, path: &str) -> Result<Option<Discovery>, AppError> {
    let read: Result<uxnan_workspace_engine::fs::FileContent, AppError> = engine
        .fs(uxnan_host_protocol::FsCall::Read {
            path: path.to_string(),
        })
        .await;
    let file = match read {
        Ok(file) => file,
        Err(AppError::Io(_) | AppError::NotFound(_)) => return Ok(None),
        Err(e) => return Err(e),
    };
    if file.binary || file.too_large {
        return Err(AppError::Invalid(
            "the bridge's discovery record on that host is not one".to_string(),
        ));
    }
    match discovery::parse(&file.content) {
        Ok(found) => Ok(Some(found)),
        Err(discovery::DiscoveryError::Missing) => Ok(None),
        Err(discovery::DiscoveryError::Invalid(why)) => Err(AppError::Invalid(format!(
            "the bridge's record on that host is unusable: {why}"
        ))),
    }
}

/// A byte stream to the host bridge's control port, carried by `conn`.
pub async fn dial(conn: &Connection, discovery: &Discovery) -> Result<HostStream, AppError> {
    let channel = conn
        .tcp("127.0.0.1", discovery.port, 0)
        .await
        .map_err(|e| {
            AppError::Invalid(format!(
                "could not reach the bridge on that host: {}",
                e.detail
            ))
        })?;
    Ok(channel.into_stream())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_record_is_where_the_bridge_writes_it_on_either_kind_of_host() {
        assert_eq!(
            discovery_path("/home/dev"),
            "/home/dev/.uxnan/local-control.json"
        );
        assert_eq!(
            discovery_path("/home/dev/"),
            "/home/dev/.uxnan/local-control.json"
        );
        // A Windows home as the engine reports it: forward slashes work there.
        assert_eq!(
            discovery_path("C:/Users/dev"),
            "C:/Users/dev/.uxnan/local-control.json"
        );
    }
}
