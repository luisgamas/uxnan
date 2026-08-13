//! Execution-target identity — *where* a project, worktree or terminal lives.
//!
//! Until now the ADE only ever ran things on the machine it is installed on, so
//! a filesystem path was a sufficient identity: one path, one workspace, one
//! shell. The moment a second execution target exists, that stops being true —
//! `/home/u/repo` names a different folder on every machine, and two of them can
//! be registered at once. Every project, worktree and terminal therefore carries
//! a [`TargetId`], and the pair `(target, path)` — not the path — is the identity
//! the app keys on (`src/lib/pathid.ts` → `workspaceKey`).
//!
//! The wire/on-disk form is a plain string so the persisted JSON stays readable
//! and additive: `local`, or `ssh:<hostId>`. `wsl:<distro>` is reserved for the
//! day WSL stops being detected by sniffing UNC paths (`wsl.rs`) and becomes a
//! target of its own.
//!
//! # Fencing
//!
//! The second job of this module is refusing to run a mutation against the wrong
//! machine. A user clicks "remove worktree" while looking at host A; by the time
//! the command reaches the backend the connection may have dropped, reconnected,
//! or been repointed. Without a check, the operation would execute wherever the
//! app happens to be pointing *now*. [`TargetExpectation`] travels with every
//! mutating command and [`check`] rejects the call outright when it no longer
//! matches — no partial work, no "closest match", and an error that names both
//! sides.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::AppError;

/// Scheme prefix of an SSH target id (`ssh:<hostId>`).
const SSH_PREFIX: &str = "ssh:";
/// Reserved prefix for a future first-class WSL target (`wsl:<distro>`), so the
/// string form is decided once here rather than invented later at two sites.
const WSL_PREFIX: &str = "wsl:";
/// On-disk/wire form of [`TargetId::Local`].
const LOCAL: &str = "local";

/// The connection generation of the local target. Local can never go stale —
/// there is nothing to reconnect — so it is a constant every caller can compare
/// against instead of threading a fake counter.
pub const LOCAL_GENERATION: u64 = 0;

/// Where an operation runs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub enum TargetId {
    /// The machine the ADE runs on. The default, and what every pre-existing
    /// project and worktree migrates to.
    #[default]
    Local,
    /// A registered SSH host, by its stable host id (never its hostname — a
    /// hostname changes, and two hosts can share one).
    Ssh(String),
    /// A target id this build does not understand, kept verbatim.
    ///
    /// Why keep it instead of failing: target kinds are meant to be additive, so
    /// a build that adds one may not bump the persistence schema. Refusing to
    /// deserialize would turn "you opened an older build once" into "the app
    /// won't start". Unknown targets round-trip untouched, are never treated as
    /// local, and never satisfy [`check`], so nothing can run against them.
    Unknown(String),
}

impl TargetId {
    /// Whether this is the local machine.
    pub fn is_local(&self) -> bool {
        matches!(self, TargetId::Local)
    }

    /// The SSH host id, when this is an SSH target. `None` for anything else —
    /// which is how a caller that can only act on a host refuses everything else
    /// without matching on the enum.
    pub fn ssh_host_id(&self) -> Option<&str> {
        match self {
            TargetId::Ssh(id) => Some(id),
            _ => None,
        }
    }

    /// Parse a target id from **input** (a command parameter, a settings value).
    ///
    /// Strict on purpose: unlike deserialization of already-persisted data, an
    /// id arriving from a caller that this build cannot act on is a bug in the
    /// caller, not forward compatibility, and silently accepting it would hide
    /// the bug behind a target that can never be reached.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed == LOCAL {
            return Ok(TargetId::Local);
        }
        if let Some(host) = trimmed.strip_prefix(SSH_PREFIX) {
            if host.is_empty() {
                return Err(AppError::Invalid("ssh target id has no host id".into()));
            }
            return Ok(TargetId::Ssh(host.to_string()));
        }
        if trimmed.starts_with(WSL_PREFIX) {
            return Err(AppError::Invalid(format!(
                "wsl targets are not supported yet: {trimmed}"
            )));
        }
        Err(AppError::Invalid(format!("unknown target id: {trimmed}")))
    }

    /// Lenient parse used for persisted data: anything unrecognized becomes
    /// [`TargetId::Unknown`] rather than an error (see that variant's docs).
    fn parse_persisted(raw: &str) -> Self {
        Self::parse(raw).unwrap_or_else(|_| TargetId::Unknown(raw.trim().to_string()))
    }
}

impl fmt::Display for TargetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TargetId::Local => f.write_str(LOCAL),
            TargetId::Ssh(id) => write!(f, "{SSH_PREFIX}{id}"),
            TargetId::Unknown(raw) => f.write_str(raw),
        }
    }
}

impl FromStr for TargetId {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl Serialize for TargetId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for TargetId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        Ok(TargetId::parse_persisted(&raw))
    }
}

/// The target a caller believed it was acting on, as sent with a mutating
/// command.
///
/// `generation` is the connection generation the caller last saw (see
/// [`check`]); for [`TargetId::Local`] it is always [`LOCAL_GENERATION`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetExpectation {
    pub target_id: String,
    #[serde(default)]
    pub generation: u64,
}

/// Verify that a mutation is still aimed where its caller intended.
///
/// - `expected` is what the caller sent. **`None` only authorizes local work**:
///   a call that carries no expectation cannot be allowed to mutate a remote
///   machine, so an absent expectation is accepted only when `actual` is local.
/// - `actual` / `actual_generation` describe the target the backend would really
///   use right now.
///
/// A generation mismatch is as fatal as a target mismatch: the same host after a
/// reconnect is, for fencing purposes, a different machine — the working
/// directory may be gone, the agent may have died, and the id the caller
/// captured may name something else entirely.
pub fn check(
    expected: Option<&TargetExpectation>,
    actual: &TargetId,
    actual_generation: u64,
) -> Result<(), AppError> {
    let Some(expected) = expected else {
        return if actual.is_local() {
            Ok(())
        } else {
            Err(AppError::TargetMismatch(format!(
                "operation on {actual} arrived without an execution target; refusing to run it"
            )))
        };
    };

    let wanted = TargetId::parse(&expected.target_id)?;
    if &wanted != actual {
        return Err(AppError::TargetMismatch(format!(
            "operation was prepared for {wanted} but would run on {actual}"
        )));
    }
    if expected.generation != actual_generation {
        return Err(AppError::TargetMismatch(format!(
            "connection to {actual} was replaced since this operation was prepared \
             (generation {} → {actual_generation})",
            expected.generation
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_round_trips_through_every_form() {
        assert_eq!(TargetId::parse("local").unwrap(), TargetId::Local);
        assert_eq!(TargetId::parse("").unwrap(), TargetId::Local);
        assert_eq!(TargetId::parse("  local  ").unwrap(), TargetId::Local);
        assert_eq!(TargetId::default(), TargetId::Local);
        assert_eq!(TargetId::Local.to_string(), "local");
        assert!(TargetId::Local.is_local());
    }

    #[test]
    fn ssh_round_trips_and_keeps_its_host_id() {
        let t = TargetId::parse("ssh:h-42").unwrap();
        assert_eq!(t, TargetId::Ssh("h-42".into()));
        assert_eq!(t.to_string(), "ssh:h-42");
        assert_eq!(t.ssh_host_id(), Some("h-42"));
        assert_eq!(TargetId::Local.ssh_host_id(), None);
        assert!(!t.is_local());
        assert_eq!(TargetId::parse(&t.to_string()).unwrap(), t);
    }

    #[test]
    fn parse_rejects_malformed_and_unsupported_ids() {
        assert!(TargetId::parse("ssh:").is_err());
        assert!(TargetId::parse("wsl:Ubuntu").is_err()); // reserved, not wired yet
        assert!(TargetId::parse("nonsense").is_err());
        assert!(TargetId::parse("LOCAL").is_err()); // ids are lowercase, exactly
    }

    #[test]
    fn serde_uses_the_plain_string_form() {
        let json = serde_json::to_string(&TargetId::Ssh("h1".into())).unwrap();
        assert_eq!(json, "\"ssh:h1\"");
        let back: TargetId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, TargetId::Ssh("h1".into()));
        assert_eq!(
            serde_json::from_str::<TargetId>("\"local\"").unwrap(),
            TargetId::Local
        );
    }

    #[test]
    fn unknown_persisted_ids_survive_a_round_trip_without_becoming_local() {
        let back: TargetId = serde_json::from_str("\"wsl:Ubuntu\"").unwrap();
        assert_eq!(back, TargetId::Unknown("wsl:Ubuntu".into()));
        assert!(!back.is_local());
        // Re-serializing must not lose the original spelling.
        assert_eq!(
            serde_json::to_string(&back).unwrap(),
            "\"wsl:Ubuntu\"".to_string()
        );
    }

    #[test]
    fn absent_expectation_authorizes_local_only() {
        assert!(check(None, &TargetId::Local, LOCAL_GENERATION).is_ok());
        assert!(check(None, &TargetId::Ssh("h1".into()), 1).is_err());
        assert!(check(None, &TargetId::Unknown("x:y".into()), 0).is_err());
    }

    #[test]
    fn matching_target_and_generation_passes() {
        let exp = TargetExpectation {
            target_id: "ssh:h1".into(),
            generation: 7,
        };
        assert!(check(Some(&exp), &TargetId::Ssh("h1".into()), 7).is_ok());
        let local = TargetExpectation {
            target_id: "local".into(),
            generation: LOCAL_GENERATION,
        };
        assert!(check(Some(&local), &TargetId::Local, LOCAL_GENERATION).is_ok());
    }

    #[test]
    fn a_different_host_is_refused_and_the_error_names_both() {
        let exp = TargetExpectation {
            target_id: "ssh:h1".into(),
            generation: 1,
        };
        let err = check(Some(&exp), &TargetId::Ssh("h2".into()), 1).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("ssh:h1"), "{msg}");
        assert!(msg.contains("ssh:h2"), "{msg}");
    }

    #[test]
    fn a_reconnect_between_capture_and_send_is_refused() {
        // Same host, connection replaced: the cwd may be gone and the agent dead.
        let exp = TargetExpectation {
            target_id: "ssh:h1".into(),
            generation: 3,
        };
        let err = check(Some(&exp), &TargetId::Ssh("h1".into()), 4).unwrap_err();
        assert!(matches!(err, AppError::TargetMismatch(_)));
    }

    #[test]
    fn a_remote_expectation_can_never_be_satisfied_by_local() {
        // The regression this whole module exists to prevent: a mutation meant
        // for a remote host must not fall back to the user's own machine.
        let exp = TargetExpectation {
            target_id: "ssh:h1".into(),
            generation: 2,
        };
        assert!(check(Some(&exp), &TargetId::Local, LOCAL_GENERATION).is_err());
    }

    #[test]
    fn an_unparsable_expectation_is_an_error_not_a_pass() {
        let exp = TargetExpectation {
            target_id: "garbage".into(),
            generation: 0,
        };
        assert!(check(Some(&exp), &TargetId::Local, LOCAL_GENERATION).is_err());
    }
}
