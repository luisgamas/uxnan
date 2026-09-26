//! Reading the bridge's local-control discovery file
//! (`~/.uxnan/local-control.json`, architecture/02a §5.8.15).
//!
//! A running `uxnan-bridge start` writes it, owner-only, with the loopback port
//! it listens on and a bearer token minted for that run. The file is the
//! credential, so this module treats it as untrusted input (size cap, strict
//! shape) and never lets the token reach a log, an error message or the
//! frontend — [`Discovery`]'s `Debug` redacts it.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Wire revision this client speaks (`LOCAL_CONTROL_PROTOCOL` in `shared/`).
pub const PROTOCOL: u32 = 1;

/// File name under the bridge's state directory (`LOCAL_CONTROL_FILE`).
pub const FILE_NAME: &str = "local-control.json";

/// A discovery file is a few hundred bytes; anything past this is not one.
const MAX_FILE_BYTES: u64 = 64 * 1024;

/// How to reach a running bridge's local control channel.
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub protocol: u32,
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub bridge_version: String,
    pub instance_id: String,
}

impl std::fmt::Debug for Discovery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Discovery")
            .field("protocol", &self.protocol)
            .field("port", &self.port)
            .field("token", &"<redacted>")
            .field("pid", &self.pid)
            .field("bridge_version", &self.bridge_version)
            .field("instance_id", &self.instance_id)
            .finish()
    }
}

/// Why no usable discovery record could be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryError {
    /// No file: no bridge is serving the channel (not running, or started with
    /// `localControlEnabled: false`).
    Missing,
    /// A file exists but is not a record this client can use.
    Invalid(String),
}

/// `~/.uxnan/local-control.json` — the bridge's default state directory
/// (`DaemonState` in `bridge/src/daemon-state.ts`).
pub fn default_path() -> Option<PathBuf> {
    Some(
        crate::agent_hooks::home_dir()?
            .join(".uxnan")
            .join(FILE_NAME),
    )
}

/// Reads and validates the discovery file at `path`.
pub fn read(path: &Path) -> Result<Discovery, DiscoveryError> {
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(DiscoveryError::Missing)
        }
        Err(err) => return Err(DiscoveryError::Invalid(err.kind().to_string())),
    };
    if meta.len() > MAX_FILE_BYTES {
        return Err(DiscoveryError::Invalid("file too large".into()));
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| DiscoveryError::Invalid(err.kind().to_string()))?;
    parse(&raw)
}

/// Validates the contents of a discovery file.
pub fn parse(raw: &str) -> Result<Discovery, DiscoveryError> {
    let discovery: Discovery = serde_json::from_str(raw)
        .map_err(|_| DiscoveryError::Invalid("not a discovery record".into()))?;
    if discovery.protocol != PROTOCOL {
        return Err(DiscoveryError::Invalid(format!(
            "unsupported protocol {}",
            discovery.protocol
        )));
    }
    if discovery.port == 0 {
        return Err(DiscoveryError::Invalid("port 0".into()));
    }
    if discovery.token.is_empty() || discovery.token.len() > 512 {
        return Err(DiscoveryError::Invalid("bad token".into()));
    }
    if !discovery
        .token
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        // The token rides in an HTTP header; anything outside base64url could
        // smuggle a header break.
        return Err(DiscoveryError::Invalid("bad token".into()));
    }
    Ok(discovery)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(extra: &str) -> String {
        format!(
            r#"{{"protocol":1,"port":51234,"token":"abcDEF_123-x","pid":42,"bridgeVersion":"0.0.27","instanceId":"i-1"{extra}}}"#
        )
    }

    #[test]
    fn parses_a_well_formed_record() {
        let parsed = parse(&record("")).unwrap();
        assert_eq!(parsed.port, 51234);
        assert_eq!(parsed.pid, 42);
        assert_eq!(parsed.instance_id, "i-1");
    }

    #[test]
    fn debug_never_prints_the_token() {
        let parsed = parse(&record("")).unwrap();
        let shown = format!("{parsed:?}");
        assert!(!shown.contains("abcDEF_123-x"));
        assert!(shown.contains("<redacted>"));
    }

    #[test]
    fn rejects_other_protocols_ports_and_tokens() {
        assert!(parse(&record("").replace("\"protocol\":1", "\"protocol\":2")).is_err());
        assert!(parse(&record("").replace("51234", "0")).is_err());
        assert!(parse(&record("").replace("abcDEF_123-x", "")).is_err());
        assert!(parse(&record("").replace("abcDEF_123-x", "a\\r\\nX-Evil: 1")).is_err());
        assert!(parse("not json").is_err());
    }

    #[test]
    fn a_missing_file_reads_as_missing() {
        let path = std::env::temp_dir().join(format!("uxnan-lc-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(read(&path), Err(DiscoveryError::Missing));
    }

    #[test]
    fn reads_a_file_from_disk() {
        let path = std::env::temp_dir().join(format!("uxnan-lc-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, record("")).unwrap();
        assert_eq!(read(&path).unwrap().port, 51234);
        let _ = std::fs::remove_file(&path);
    }
}
