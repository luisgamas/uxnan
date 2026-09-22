//! The global agent budget, exercised the way it is actually used: from more
//! than one process at a time.
//!
//! An in-process test can prove the arithmetic; it cannot prove the thing that
//! matters here — that two processes asking at the same instant cannot both be
//! told yes. These tests therefore spawn **real** competitors (this same test
//! binary, re-entered through a helper test) against a shared directory.

use std::path::{Path, PathBuf};
use std::time::Duration;

use uxnan_desktop_lib::budget::{self, Policy, Refused};

fn policy(capacity: usize) -> Policy {
    Policy {
        capacity,
        // Memory is not what these tests are about, and a CI machine's free
        // memory is not ours to predict.
        min_free_mb: 0,
        wait: Duration::from_millis(0),
    }
}

/// The env var a spawned competitor reads: where the shared ledger lives.
const DIR_VAR: &str = "UXNAN_BUDGET_TEST_DIR";
/// How many slots the competitor should try to take, and for how long to hold.
const TAKE_VAR: &str = "UXNAN_BUDGET_TEST_TAKE";
const HOLD_VAR: &str = "UXNAN_BUDGET_TEST_HOLD_MS";

/// Re-entry point: when the env says so, this "test" is a competitor process.
/// It takes what it can, prints how many it got, and holds them while it
/// sleeps — so the parent can observe the ledger with the slots genuinely held.
#[test]
fn budget_competitor_helper() {
    let Ok(dir) = std::env::var(DIR_VAR) else {
        return; // an ordinary test run: nothing to do
    };
    let take: usize = std::env::var(TAKE_VAR)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);
    let hold: u64 = std::env::var(HOLD_VAR)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1500);
    let capacity: usize = std::env::var("UXNAN_BUDGET_TEST_CAPACITY")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2);
    let dir = PathBuf::from(dir);
    let mut held = Vec::new();
    for _ in 0..take {
        match budget::try_acquire(&dir, policy(capacity), "competitor") {
            Ok(slot) => held.push(slot),
            Err(_) => break,
        }
    }
    println!("GOT {}", held.len());
    std::thread::sleep(Duration::from_millis(hold));
    drop(held);
}

/// Start a competitor process and wait for it to report what it took.
fn spawn_competitor(dir: &Path, take: usize, capacity: usize, hold_ms: u64) -> std::process::Child {
    let exe = std::env::current_exe().expect("test binary");
    std::process::Command::new(exe)
        .args(["budget_competitor_helper", "--exact", "--nocapture"])
        .env(DIR_VAR, dir)
        .env(TAKE_VAR, take.to_string())
        .env(HOLD_VAR, hold_ms.to_string())
        .env("UXNAN_BUDGET_TEST_CAPACITY", capacity.to_string())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn a competitor")
}

/// What a competitor reported taking (blocks until it exits).
fn took(child: std::process::Child) -> usize {
    let out = child.wait_with_output().expect("competitor output");
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .find_map(|l| l.strip_prefix("GOT "))
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or_else(|| panic!("competitor said nothing about slots:\n{text}"))
}

#[test]
fn the_cap_holds_across_processes() {
    // Two processes, two slots, each asking for both: between them they may
    // hold two — never four. This is the whole point of the ledger; an
    // in-process counter cannot see another process at all.
    let dir = tempfile::tempdir().unwrap();
    let a = spawn_competitor(dir.path(), 2, 2, 1_500);
    let b = spawn_competitor(dir.path(), 2, 2, 1_500);
    let got = took(a) + took(b);
    assert_eq!(
        got, 2,
        "the two processes together took {got} slots, cap is 2"
    );
}

#[test]
fn a_slot_comes_back_when_its_holder_exits() {
    let dir = tempfile::tempdir().unwrap();
    // One process takes the only slot and holds it briefly.
    let holder = spawn_competitor(dir.path(), 1, 1, 800);
    // While it holds, nobody else can have one.
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while budget::live(dir.path()) == 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the holder never took its slot"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        budget::try_acquire(dir.path(), policy(1), "mine").is_err(),
        "the only slot was taken by another process"
    );
    assert_eq!(took(holder), 1);
    // Once it is gone, the slot is free again — released on drop, and the
    // ledger no longer counts it.
    assert_eq!(budget::live(dir.path()), 0);
    assert!(budget::try_acquire(dir.path(), policy(1), "mine").is_ok());
}

#[test]
fn a_slot_held_by_a_process_that_died_is_reclaimed() {
    // The crash case: a runner that is killed (or loses power) cannot release
    // anything. Its lease must not hold a slot hostage for ever — the next
    // caller that looks reclaims it, because the owner is not running.
    let dir = tempfile::tempdir().unwrap();
    let mut holder = spawn_competitor(dir.path(), 1, 1, 60_000);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while budget::live(dir.path()) == 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the holder never took its slot"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    // Kill it outright: no unwinding, no Drop, no release.
    holder.kill().expect("kill the holder");
    let _ = holder.wait();
    assert_eq!(
        budget::live(dir.path()),
        0,
        "a lease whose owner is gone must be reclaimed"
    );
    assert!(budget::try_acquire(dir.path(), policy(1), "mine").is_ok());
}

#[test]
fn the_refusal_says_what_is_in_the_way() {
    let dir = tempfile::tempdir().unwrap();
    let held = budget::try_acquire(dir.path(), policy(1), "first").expect("the first slot");
    match budget::try_acquire(dir.path(), policy(1), "second") {
        Err(Refused::NoSlot { live, capacity }) => {
            assert_eq!((live, capacity), (1, 1));
        }
        other => panic!("expected a no-slot refusal, got {other:?}"),
    }
    drop(held);
    // Memory is the other gate: ask for more than any machine has and the
    // refusal names memory, not slots.
    let hungry = Policy {
        min_free_mb: u64::MAX / 2,
        ..policy(1)
    };
    match budget::try_acquire(dir.path(), hungry, "hungry") {
        Err(Refused::LowMemory { needed_mb, .. }) => assert_eq!(needed_mb, u64::MAX / 2),
        other => panic!("expected a memory refusal, got {other:?}"),
    }
}

#[tokio::test]
async fn waiting_gets_the_slot_the_moment_it_is_free() {
    let dir = tempfile::tempdir().unwrap();
    // Another process holds the only slot for a moment.
    let holder = spawn_competitor(dir.path(), 1, 1, 600);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while budget::live(dir.path()) == 0 {
        assert!(
            std::time::Instant::now() < deadline,
            "the holder never took its slot"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let waited = Policy {
        wait: Duration::from_secs(20),
        ..policy(1)
    };
    let started = std::time::Instant::now();
    let slot = budget::acquire(dir.path(), waited, "patient")
        .await
        .expect("the slot frees up and the wait takes it");
    assert!(
        started.elapsed() >= Duration::from_millis(200),
        "it should have had to wait"
    );
    drop(slot);
    assert_eq!(took(holder), 1);
}
