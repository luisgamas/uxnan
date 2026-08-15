//! The list of registered hosts, and what happens to projects when one is
//! removed.
//!
//! Pure functions over the settings vectors — no I/O, no connections — so the
//! part that can lose the user's data is testable without a network.
//!
//! # Why removal needs a tombstone
//!
//! A project stores only its target id (`ssh:<hostId>`). Remove the host and
//! every project on it points at an id that no longer exists; re-add the same
//! machine and it gets a *new* id, so those projects stay stranded on the dead
//! one. The fix is to remember what was removed.
//!
//! What this module does with that memory is the part worth reading: re-adding a
//! machine that matches a tombstone **reuses the old id** rather than minting a
//! new one and rewriting every project. Nothing else has to be touched, so there
//! is no partially-migrated state to get wrong — the projects were never broken,
//! they were just pointing at something absent.
//!
//! The trade is honest and worth stating: if the "same" host is really a
//! different machine that happens to share a hostname and user, its projects
//! come back pointing at paths that may not exist. That surfaces as a path that
//! is not there, which is visible and recoverable — and a genuinely different
//! machine trips the host-key check first ([`super::hostkey`]), which refuses the
//! connection outright.

use crate::model::{SshHost, SshHostSource, SshHostTombstone};

/// How many removed hosts to remember. Generous — a tombstone is a few dozen
/// bytes and the whole point is to still be there weeks later — but bounded, so
/// a user who adds and removes hosts all day does not grow the settings file
/// without limit.
pub const MAX_TOMBSTONES: usize = 100;

/// What the user filled in (or an import resolved) before an id exists.
///
/// Deserialized straight from the form: the frontend never invents an id, so
/// there is one place ids come from and no way for the UI to overwrite a record
/// by guessing one.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDraft {
    pub label: String,
    #[serde(default)]
    pub config_host: Option<String>,
    pub hostname: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub identity_files: Vec<String>,
    #[serde(default)]
    pub identity_agent: Option<String>,
    #[serde(default)]
    pub identities_only: bool,
    #[serde(default)]
    pub forward_agent: bool,
    #[serde(default)]
    pub proxy_command: Option<String>,
    #[serde(default)]
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub source: SshHostSource,
}

/// The result of adding a host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddOutcome {
    pub host: SshHost,
    /// True when this reused a removed host's id, so its projects are live again.
    /// The UI says so — silently resurrecting projects would be spooky.
    pub recovered: bool,
    /// True when an already-registered host was updated instead of added.
    pub updated_existing: bool,
}

/// The parts of a host that decide whether two records mean the same machine.
///
/// Extracted as a type rather than compared field-by-field at each call site:
/// there are three kinds of record to compare (a registered host, a draft, a
/// tombstone) and the rule must not drift between them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MachineKey<'a> {
    config_host: Option<&'a str>,
    hostname: &'a str,
    port: u16,
    user: &'a str,
}

impl MachineKey<'_> {
    /// Whether these name the same machine *for our purposes*.
    ///
    /// A shared `config_host` alias wins outright: it is the user's own name for
    /// the machine and the most stable thing we have — a laptop's address changes
    /// with the network, the alias does not. Otherwise the triple
    /// `(hostname, port, user)` has to match, user included, because two accounts
    /// on one machine are two different homes, two different sets of agent
    /// credentials and two different sets of paths.
    fn same(&self, other: &MachineKey<'_>) -> bool {
        if let (Some(a), Some(b)) = (self.config_host, other.config_host) {
            if a.eq_ignore_ascii_case(b) {
                return true;
            }
        }
        self.hostname.eq_ignore_ascii_case(other.hostname)
            && self.port == other.port
            && self.user == other.user
    }
}

impl SshHost {
    fn machine_key(&self) -> MachineKey<'_> {
        MachineKey {
            config_host: self.config_host.as_deref(),
            hostname: &self.hostname,
            port: self.port,
            user: &self.user,
        }
    }
}

impl HostDraft {
    fn machine_key(&self) -> MachineKey<'_> {
        MachineKey {
            config_host: self.config_host.as_deref(),
            hostname: &self.hostname,
            port: self.port,
            user: &self.user,
        }
    }
}

impl SshHostTombstone {
    fn machine_key(&self) -> MachineKey<'_> {
        MachineKey {
            config_host: self.config_host.as_deref(),
            hostname: &self.hostname,
            port: self.port,
            user: &self.user,
        }
    }
}

/// Add (or update) a host, recovering a removed one's id when it matches.
///
/// `new_id` supplies a fresh id — passed in rather than generated here so the
/// function stays pure and its tests deterministic.
pub fn add_host(
    hosts: &mut Vec<SshHost>,
    tombstones: &mut Vec<SshHostTombstone>,
    draft: HostDraft,
    new_id: impl FnOnce() -> String,
) -> AddOutcome {
    // Already registered → update it in place, keeping its id so nothing that
    // points at it breaks. An import must not clobber a hand-written record.
    let wanted = draft.machine_key();
    if let Some(index) = hosts.iter().position(|h| h.machine_key().same(&wanted)) {
        let existing = &mut hosts[index];
        let hand_written = existing.source == SshHostSource::Manual;
        let from_import = draft.source == SshHostSource::SshConfig;
        if !(hand_written && from_import) {
            let id = existing.id.clone();
            let needs_prompt = existing.needs_prompt;
            *existing = host_from(draft, id);
            existing.needs_prompt = needs_prompt;
        }
        return AddOutcome {
            host: hosts[index].clone(),
            recovered: false,
            updated_existing: true,
        };
    }

    // Not registered, but was it removed before? Reuse that id and its projects
    // come back with it.
    let recovered_id = tombstones
        .iter()
        .position(|t| t.machine_key().same(&wanted))
        .map(|i| tombstones.remove(i).host_id);

    let recovered = recovered_id.is_some();
    let host = host_from(draft, recovered_id.unwrap_or_else(new_id));
    hosts.push(host.clone());
    AddOutcome {
        host,
        recovered,
        updated_existing: false,
    }
}

fn host_from(draft: HostDraft, id: String) -> SshHost {
    SshHost {
        id,
        label: draft.label,
        config_host: draft.config_host,
        hostname: draft.hostname,
        port: draft.port,
        user: draft.user,
        identity_files: draft.identity_files,
        identity_agent: draft.identity_agent,
        identities_only: draft.identities_only,
        forward_agent: draft.forward_agent,
        proxy_command: draft.proxy_command,
        proxy_jump: draft.proxy_jump,
        source: draft.source,
        needs_prompt: false,
    }
}

/// Remove a host, remembering it. Returns the removed record, or `None` when no
/// such id is registered (idempotent: removing twice is not an error).
pub fn remove_host(
    hosts: &mut Vec<SshHost>,
    tombstones: &mut Vec<SshHostTombstone>,
    host_id: &str,
    now_ms: i64,
) -> Option<SshHost> {
    let index = hosts.iter().position(|h| h.id == host_id)?;
    let host = hosts.remove(index);

    // One tombstone per machine: re-adding and re-removing must not accumulate
    // rows that all claim the same host.
    let removed_key = host.machine_key();
    tombstones.retain(|t| !t.machine_key().same(&removed_key));
    tombstones.push(SshHostTombstone {
        host_id: host.id.clone(),
        config_host: host.config_host.clone(),
        hostname: host.hostname.clone(),
        port: host.port,
        user: host.user.clone(),
        label: host.label.clone(),
        removed_at: now_ms,
    });
    // Oldest first, so pruning drops the least likely to be re-added.
    if tombstones.len() > MAX_TOMBSTONES {
        tombstones.sort_by_key(|t| t.removed_at);
        let excess = tombstones.len() - MAX_TOMBSTONES;
        tombstones.drain(0..excess);
    }
    Some(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(host: &str, user: &str) -> HostDraft {
        HostDraft {
            label: format!("{user}@{host}"),
            config_host: None,
            hostname: host.to_string(),
            port: 22,
            user: user.to_string(),
            identity_files: vec![],
            identity_agent: None,
            identities_only: false,
            forward_agent: false,
            proxy_command: None,
            proxy_jump: None,
            source: SshHostSource::Manual,
        }
    }

    fn add(
        hosts: &mut Vec<SshHost>,
        tombs: &mut Vec<SshHostTombstone>,
        d: HostDraft,
        id: &str,
    ) -> AddOutcome {
        let id = id.to_string();
        add_host(hosts, tombs, d, || id)
    }

    #[test]
    fn adding_a_host_gives_it_the_supplied_id() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        let out = add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        assert_eq!(out.host.id, "h1");
        assert!(!out.recovered && !out.updated_existing);
        assert_eq!(hosts.len(), 1);
    }

    #[test]
    fn adding_the_same_machine_twice_updates_instead_of_duplicating() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        let mut again = draft("10.0.0.5", "dev");
        again.label = "renamed".into();
        let out = add(&mut hosts, &mut tombs, again, "h2");
        assert_eq!(hosts.len(), 1);
        assert!(out.updated_existing);
        assert_eq!(out.host.id, "h1", "the id must survive an update");
        assert_eq!(hosts[0].label, "renamed");
    }

    #[test]
    fn a_different_user_on_the_same_machine_is_a_different_host() {
        // Two accounts are two homes, two sets of credentials, two sets of paths.
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "ops"), "h2");
        assert_eq!(hosts.len(), 2);
    }

    #[test]
    fn a_shared_config_alias_identifies_the_machine_even_if_its_address_changed() {
        // A laptop's address changes with the network; the user's own alias for
        // it does not.
        let (mut hosts, mut tombs) = (vec![], vec![]);
        let mut first = draft("10.0.0.5", "dev");
        first.config_host = Some("build-box".into());
        add(&mut hosts, &mut tombs, first, "h1");

        let mut moved = draft("192.168.1.9", "dev");
        moved.config_host = Some("BUILD-BOX".into()); // case-insensitive
        let out = add(&mut hosts, &mut tombs, moved, "h2");
        assert!(out.updated_existing);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname, "192.168.1.9");
    }

    #[test]
    fn an_import_never_overwrites_a_host_the_user_typed() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        let mut manual = draft("10.0.0.5", "dev");
        manual.label = "my careful label".into();
        add(&mut hosts, &mut tombs, manual, "h1");

        let mut imported = draft("10.0.0.5", "dev");
        imported.label = "from config".into();
        imported.source = SshHostSource::SshConfig;
        let out = add(&mut hosts, &mut tombs, imported, "h2");

        assert!(out.updated_existing);
        assert_eq!(hosts[0].label, "my careful label");
        assert_eq!(hosts[0].source, SshHostSource::Manual);
    }

    #[test]
    fn removing_a_host_leaves_a_tombstone() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        let removed = remove_host(&mut hosts, &mut tombs, "h1", 1_000).unwrap();
        assert_eq!(removed.id, "h1");
        assert!(hosts.is_empty());
        assert_eq!(tombs.len(), 1);
        assert_eq!(tombs[0].host_id, "h1");
    }

    #[test]
    fn removing_an_unknown_id_is_a_no_op_not_an_error() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        assert!(remove_host(&mut hosts, &mut tombs, "nope", 1).is_none());
        assert!(tombs.is_empty());
    }

    #[test]
    fn re_adding_a_removed_machine_recovers_its_id_so_its_projects_come_back() {
        // The whole reason tombstones exist. Projects store `ssh:h1`; if the
        // re-added host got `h2`, they would stay stranded.
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        remove_host(&mut hosts, &mut tombs, "h1", 1_000);

        let out = add(
            &mut hosts,
            &mut tombs,
            draft("10.0.0.5", "dev"),
            "brand-new",
        );
        assert_eq!(out.host.id, "h1", "the old id must be reused");
        assert!(out.recovered, "and the UI must be able to say so");
        assert!(tombs.is_empty(), "the tombstone is consumed");
    }

    #[test]
    fn a_recovered_host_is_matched_by_its_alias_too() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        let mut first = draft("10.0.0.5", "dev");
        first.config_host = Some("build-box".into());
        add(&mut hosts, &mut tombs, first, "h1");
        remove_host(&mut hosts, &mut tombs, "h1", 1_000);

        let mut later = draft("172.16.0.2", "dev"); // moved networks
        later.config_host = Some("build-box".into());
        let out = add(&mut hosts, &mut tombs, later, "new");
        assert_eq!(out.host.id, "h1");
        assert!(out.recovered);
    }

    #[test]
    fn an_unrelated_machine_does_not_inherit_someone_elses_id() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        remove_host(&mut hosts, &mut tombs, "h1", 1_000);

        let out = add(&mut hosts, &mut tombs, draft("10.0.0.9", "dev"), "h2");
        assert_eq!(out.host.id, "h2");
        assert!(!out.recovered);
        assert_eq!(
            tombs.len(),
            1,
            "the tombstone is still waiting for its host"
        );
    }

    #[test]
    fn removing_the_same_machine_twice_keeps_one_tombstone() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        remove_host(&mut hosts, &mut tombs, "h1", 1_000);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "ignored");
        remove_host(&mut hosts, &mut tombs, "h1", 2_000);

        assert_eq!(tombs.len(), 1, "{tombs:?}");
        assert_eq!(tombs[0].removed_at, 2_000);
    }

    #[test]
    fn tombstones_are_capped_dropping_the_oldest_first() {
        let (mut hosts, mut tombs) = (vec![], vec![]);
        for i in 0..(MAX_TOMBSTONES + 5) {
            let id = format!("h{i}");
            add(
                &mut hosts,
                &mut tombs,
                draft(&format!("10.0.0.{i}"), "dev"),
                &id,
            );
            remove_host(&mut hosts, &mut tombs, &id, i as i64);
        }
        assert_eq!(tombs.len(), MAX_TOMBSTONES);
        // The five oldest are gone; the newest survives.
        assert!(tombs.iter().all(|t| t.removed_at >= 5));
        assert!(tombs
            .iter()
            .any(|t| t.removed_at == (MAX_TOMBSTONES + 4) as i64));
    }

    #[test]
    fn updating_a_host_keeps_whether_it_needed_a_prompt() {
        // Learned at connect time, not something an edit should forget: losing it
        // means the next startup prompts for a host it knew was silent.
        let (mut hosts, mut tombs) = (vec![], vec![]);
        add(&mut hosts, &mut tombs, draft("10.0.0.5", "dev"), "h1");
        hosts[0].needs_prompt = true;

        let mut again = draft("10.0.0.5", "dev");
        again.label = "edited".into();
        add(&mut hosts, &mut tombs, again, "h2");
        assert!(hosts[0].needs_prompt);
        assert_eq!(hosts[0].label, "edited");
    }
}
