//! How a client that was not launched by Uxnan finds the running app.
//!
//! The app writes one small JSON file under its data directory when its local
//! server is up, readable only by the user who runs the app (`0600`; on Windows
//! the per-user profile ACL), and removes it on a clean exit. The client reads
//! it, checks that the process it names is still the one that wrote it (the
//! pid **and** its start time, so a recycled pid is not mistaken for the app),
//! checks the protocol version, and only then talks to the endpoint.
//!
//! The token in this file is the **control** token: distinct from the per-launch
//! token the app injects into the terminals it spawns, rotated on every start,
//! and never written anywhere else.

use serde::{Deserialize, Serialize};

/// The discovery file's name, under the app's data directory.
pub const FILE_NAME: &str = "control.json";

/// The contents of `control.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    /// The protocol the app speaks. A client whose [`crate::PROTOCOL_VERSION`]
    /// differs must not proceed.
    pub protocol_version: u32,
    /// The app's own version, for the client's `status` output and error text.
    pub app_version: String,
    /// The app's process id.
    pub pid: u32,
    /// When that process started, as seconds since the Unix epoch. Together
    /// with `pid` it identifies one incarnation of the app.
    pub process_start: u64,
    /// The server's origin, e.g. `http://127.0.0.1:51234` (no path).
    pub endpoint: String,
    /// The control token.
    pub token: String,
}

impl Discovery {
    /// The full URL of the RPC route.
    pub fn rpc_url(&self) -> String {
        format!("{}{}", self.endpoint.trim_end_matches('/'), crate::RPC_PATH)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_in_camel_case_and_round_trips() {
        let d = Discovery {
            protocol_version: 1,
            app_version: "0.0.50".into(),
            pid: 4242,
            process_start: 1_700_000_000,
            endpoint: "http://127.0.0.1:51234".into(),
            token: "t".into(),
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["protocolVersion"], 1);
        assert_eq!(v["processStart"], 1_700_000_000u64);
        let back: Discovery = serde_json::from_value(v).unwrap();
        assert_eq!(back, d);
        assert_eq!(back.rpc_url(), "http://127.0.0.1:51234/control/v1/rpc");
    }

    #[test]
    fn rpc_url_tolerates_a_trailing_slash() {
        let d = Discovery {
            protocol_version: 1,
            app_version: String::new(),
            pid: 0,
            process_start: 0,
            endpoint: "http://127.0.0.1:1/".into(),
            token: String::new(),
        };
        assert_eq!(d.rpc_url(), "http://127.0.0.1:1/control/v1/rpc");
    }
}
