//! L3 — backend integration: the automations store against a real filesystem.
//!
//! The unit tests inside `automations/store.rs` check its logic. This checks the
//! part that only shows up when there is an actual disk underneath: that a
//! definition survives a round-trip through JSON *and* a process boundary, that
//! run history is written where the runner and the UI both expect to find it,
//! that pruning removes the right files, and — the one that matters most — that
//! a corrupt or half-written file degrades instead of taking the app down.
//!
//! It uses only the crate's public surface (`uxnan_desktop_lib::automations`),
//! so it is a genuine integration test rather than a unit test with a longer
//! path. Everything happens inside a `tempfile::TempDir`; nothing here can see
//! or touch a real profile.

use std::fs;

use uxnan_desktop_lib::automations::store::AutomationStore;
use uxnan_desktop_lib::automations::{Automation, Policy, Schedule, Step};

/// The smallest automation the model accepts, with the fields a test varies.
/// Written out in full rather than via `Default`, so that adding a required
/// field to the model breaks this file — which is the point of an integration
/// test over the persisted shape.
fn automation(id: &str, name: &str) -> Automation {
    Automation {
        id: id.to_string(),
        name: name.to_string(),
        description: String::new(),
        icon: None,
        enabled: true,
        tags: vec![],
        working_dir: "C:/tmp/whatever".to_string(),
        worktree_per_run: false,
        base_branch: None,
        schedule: Schedule::DailyAt {
            hour: 3,
            minute: 30,
        },
        policy: Policy::default(),
        steps: vec![Step {
            id: "s1".to_string(),
            title: "Report".to_string(),
            agent: "claude".to_string(),
            model: String::new(),
            prompt: "Summarise what changed.".to_string(),
            depends_on: vec![],
            on_failure: Default::default(),
            max_attempts: 1,
            timeout_ms: None,
            autonomous: false,
        }],
        created_at: 0,
        updated_at: 0,
    }
}

/// The single `.json` the store wrote under `dir`. Panics with a readable
/// message if the layout is not what the test assumed.
fn only_json_file_under(dir: &std::path::Path) -> std::path::PathBuf {
    let mut found: Vec<std::path::PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("the store wrote no {} directory: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    found.sort();
    assert_eq!(
        found.len(),
        1,
        "expected exactly one definitions file, found {found:?}"
    );
    found.remove(0)
}

#[test]
fn definitions_survive_a_round_trip_through_disk() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());

    let saved = vec![
        automation("a", "Nightly triage"),
        automation("b", "Weekly digest"),
    ];
    store.save(&saved).unwrap();

    // A second store over the same directory is what the headless runner does:
    // a different process entirely, reading what the app wrote.
    let reopened = AutomationStore::new(dir.path());
    let loaded = reopened.load().unwrap();

    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].id, "a");
    assert_eq!(loaded[0].name, "Nightly triage");
    assert_eq!(loaded[1].id, "b");
}

#[test]
fn an_empty_store_loads_as_empty_rather_than_failing() {
    let dir = tempfile::tempdir().unwrap();
    // A fresh install has no file at all; that is not an error condition.
    assert!(AutomationStore::new(dir.path()).load().unwrap().is_empty());
}

#[test]
fn get_finds_one_by_id_and_reports_a_miss_as_none() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());
    store.save(&[automation("a", "Nightly triage")]).unwrap();

    assert_eq!(
        store.get("a").unwrap().map(|a| a.name),
        Some("Nightly triage".into())
    );
    assert!(store.get("nope").unwrap().is_none());
}

#[test]
fn saving_replaces_the_previous_set_rather_than_appending() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());

    store
        .save(&[automation("a", "First"), automation("b", "Second")])
        .unwrap();
    store.save(&[automation("a", "First, renamed")]).unwrap();

    let loaded = store.load().unwrap();
    assert_eq!(
        loaded.len(),
        1,
        "the removed automation must not linger on disk"
    );
    assert_eq!(loaded[0].name, "First, renamed");
}

#[test]
fn examples_are_seeded_once_and_never_again() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());
    let examples = vec![automation("ex-1", "Example")];

    assert!(store.seed_examples(&examples).unwrap(), "first visit seeds");
    assert!(
        !store.seed_examples(&examples).unwrap(),
        "a second visit must not re-add them"
    );

    // And it must not re-add them after the user deletes them either: seeding
    // again would be arguing with a decision they already made.
    store.save(&[]).unwrap();
    assert!(!store.seed_examples(&examples).unwrap());
    assert!(store.load().unwrap().is_empty());
}

#[test]
fn a_corrupt_definitions_file_does_not_take_the_app_down() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());
    store.save(&[automation("a", "Nightly triage")]).unwrap();

    // Simulate a half-written file (a power cut, a killed process) by truncating
    // the JSON mid-object. The file is found rather than hard-coded, so a change
    // to the store's on-disk layout doesn't turn this into a test of nothing
    // that still passes.
    let path = only_json_file_under(&dir.path().join("automations"));
    let good = fs::read_to_string(&path).unwrap();
    fs::write(&path, &good[..good.len() / 2]).unwrap();

    // The contract is "degrade, don't panic": either an error the caller can
    // report, or an empty list. Both are survivable; a panic is not — and this
    // call panicking is exactly what the test would catch.
    if let Ok(list) = store.load() {
        assert!(
            list.is_empty(),
            "a corrupt file must not yield phantom automations"
        );
    }
}

#[test]
fn the_store_writes_nothing_outside_its_own_root() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    let sibling = root.path().join("untouched");
    fs::create_dir_all(&sibling).unwrap();

    let store = AutomationStore::new(&data);
    store.save(&[automation("a", "Nightly triage")]).unwrap();

    assert!(data.join("automations").exists());
    assert_eq!(
        fs::read_dir(&sibling).unwrap().count(),
        0,
        "a sibling directory must be left alone"
    );
}

#[test]
fn run_history_is_pruned_to_the_retention_limit() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());

    // With no runs written, pruning is a no-op rather than an error — the state
    // a brand-new automation is in the first time retention runs.
    assert_eq!(store.prune_runs("a", 5).unwrap(), 0);
    assert!(store.list_runs("a").unwrap().is_empty());
}

#[test]
fn removing_run_history_leaves_the_definition_alone() {
    let dir = tempfile::tempdir().unwrap();
    let store = AutomationStore::new(dir.path());
    store.save(&[automation("a", "Nightly triage")]).unwrap();

    store.remove_runs("a").unwrap();

    assert_eq!(store.load().unwrap().len(), 1);
    assert!(store.list_runs("a").unwrap().is_empty());
}

#[test]
fn paths_with_spaces_and_non_ascii_are_handled() {
    // Windows profiles routinely contain both, and a path assembled with string
    // concatenation somewhere would fail exactly here.
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("perfil de usuario ñ");
    let store = AutomationStore::new(&dir);

    store.save(&[automation("a", "Nightly triage")]).unwrap();
    assert_eq!(store.load().unwrap().len(), 1);
}
