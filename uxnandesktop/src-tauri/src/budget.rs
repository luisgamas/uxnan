//! The global budget for agent subprocesses: **one gate, every process**.
//!
//! The app dispatches headless steps from its window; each automation run is a
//! **separate process** that dispatches its own, and several can run at once
//! with the app closed. Each of them used to cap itself, so the caps
//! multiplied: three automations at four steps each is twelve agents on a
//! laptop that was promised four.
//!
//! This module is the one place that answers *may another agent start now?*,
//! and it answers for the whole machine — every process that asks holds its
//! slot in the same file. Two questions, one gate:
//!
//! 1. **A slot.** At most `capacity` agent subprocesses at a time, the number
//!    the person's resource policy resolved (`orchestrationConcurrency`).
//! 2. **Memory.** At least `min_free_mb` free when it starts, so a run does not
//!    push the machine into swap to gain a step it will run slowly anyway.
//!
//! **Liveness, not heartbeats.** A lease belongs to a process, and that process
//! is either alive or it is not: a lease whose owner is gone — crashed, killed,
//! power cut — is reclaimed by the next caller that looks (matched on pid *and*
//! its start time, so a recycled pid cannot inherit someone else's slot). No
//! timer to keep, no lease lost because a legitimate step took longer than a
//! heartbeat window. A wall-clock backstop ([`MAX_LEASE_AGE`]) still exists for
//! the one case liveness cannot see: a process alive but wedged forever.
//!
//! **Single writer** without a database: the file is guarded by a lock
//! directory created atomically (`create_new`), carrying its owner's identity
//! so a lock left by a dead process is broken rather than deadlocking the
//! machine. Every read-modify-write of the ledger happens under it.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// How long a lease may live before it is reclaimed even though its owner is
/// still alive. Not a step timeout — that is the runner's, and it is shorter
/// (10 minutes by default). This is the backstop for a process that is alive
/// but will never finish, and it is deliberately far above any real step.
const MAX_LEASE_AGE: Duration = Duration::from_secs(6 * 60 * 60);

/// How long to wait for the lock before giving up. The lock is held only for a
/// read-modify-write of a small file, so anything near this means a holder died
/// in a way liveness could not see.
const LOCK_TIMEOUT: Duration = Duration::from_secs(10);

/// Pause between attempts at the lock.
const LOCK_RETRY: Duration = Duration::from_millis(25);

/// What a caller must satisfy to start an agent. Resolved by the frontend's
/// policy engine and mirrored into the settings for the processes that have no
/// window to ask (see `automations::runner::budget_policy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// How many agent subprocesses may run at once, across every process.
    pub capacity: usize,
    /// Free memory a new agent needs, in MiB. `0` disables the check.
    pub min_free_mb: u64,
    /// How long to wait for room before giving up.
    pub wait: Duration,
}

/// Why admission was refused, in the caller's words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    /// Every slot is taken (and stayed taken for the whole wait).
    NoSlot { live: usize, capacity: usize },
    /// The machine is short of memory (and stayed short for the whole wait).
    LowMemory { free_mb: u64, needed_mb: u64 },
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refused::NoSlot { live, capacity } => write!(
                f,
                "all {capacity} agent slots are in use ({live} running); \
                 raise the orchestration concurrency in Settings → Resources, \
                 or wait for one to finish"
            ),
            Refused::LowMemory { free_mb, needed_mb } => write!(
                f,
                "only {free_mb} MB of memory are free and an agent needs {needed_mb} MB; \
                 waiting would not have helped, so nothing was started"
            ),
        }
    }
}

/// One process's claim on one slot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Lease {
    /// Unique per lease; what release removes.
    id: String,
    /// The process holding it, and when that process started — the pair is the
    /// identity, because a pid alone is recycled.
    owner_pid: u32,
    #[serde(default)]
    owner_start: u64,
    /// What it is for, so the ledger can be read by a person
    /// (`run r1 step s2`, `terminal`, …).
    label: String,
    /// Epoch milliseconds.
    acquired_ms: u64,
}

/// The ledger on disk.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    #[serde(default)]
    leases: Vec<Lease>,
}

/// A held slot. Releasing is [`Drop`] — a caller cannot forget, and a panic
/// cannot leak a slot for the lifetime of the process.
#[derive(Debug)]
pub struct Slot {
    dir: PathBuf,
    id: String,
    released: bool,
}

impl Slot {
    /// Give the slot back now instead of at the end of the scope.
    pub fn release(mut self) {
        self.release_inner();
    }

    fn release_inner(&mut self) {
        if self.released {
            return;
        }
        self.released = true;
        let id = self.id.clone();
        let _ = with_ledger(&self.dir, |ledger| {
            ledger.leases.retain(|l| l.id != id);
            Ok(())
        });
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        self.release_inner();
    }
}

/// Take a slot for `label`, waiting up to `policy.wait` for one.
///
/// Both conditions are re-checked on every attempt, so a caller that waits for
/// a slot does not then start on a machine that ran out of memory while it
/// waited. The refusal says which condition never cleared.
pub async fn acquire(dir: &Path, policy: Policy, label: &str) -> Result<Slot, Refused> {
    let deadline = std::time::Instant::now() + policy.wait;
    let mut last;
    loop {
        match try_acquire(dir, policy, label) {
            Ok(slot) => return Ok(slot),
            Err(refused) => last = refused,
        }
        if std::time::Instant::now() >= deadline {
            return Err(last);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// One attempt, no waiting. The whole check happens under the lock, so two
/// processes cannot both see the last free slot.
pub fn try_acquire(dir: &Path, policy: Policy, label: &str) -> Result<Slot, Refused> {
    // Memory first: it needs no lock, and refusing here keeps the lock free for
    // the callers that can actually proceed.
    if policy.min_free_mb > 0 {
        let free_mb = free_memory_mb();
        if free_mb < policy.min_free_mb {
            return Err(Refused::LowMemory {
                free_mb,
                needed_mb: policy.min_free_mb,
            });
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mine = Lease {
        id: id.clone(),
        owner_pid: std::process::id(),
        owner_start: own_start_time(),
        label: label.to_string(),
        acquired_ms: now_ms(),
    };
    let capacity = policy.capacity.max(1);
    let taken = with_ledger(dir, |ledger| {
        reclaim(ledger);
        if ledger.leases.len() >= capacity {
            return Ok(Some(ledger.leases.len()));
        }
        ledger.leases.push(mine.clone());
        Ok(None)
    });
    match taken {
        // The ledger could not be read or written: never block the machine's
        // work on the bookkeeping — proceed, unbudgeted, rather than refuse.
        Err(_) => Ok(Slot {
            dir: dir.to_path_buf(),
            id,
            released: true, // nothing was written, so nothing to take back
        }),
        Ok(Some(live)) => Err(Refused::NoSlot { live, capacity }),
        Ok(None) => Ok(Slot {
            dir: dir.to_path_buf(),
            id,
            released: false,
        }),
    }
}

/// How many slots are held right now (dead owners already discounted). For
/// status surfaces and tests; a caller deciding whether to start asks
/// [`try_acquire`], which decides under the lock.
pub fn live(dir: &Path) -> usize {
    let mut ledger = read_ledger(dir).unwrap_or_default();
    reclaim(&mut ledger);
    ledger.leases.len()
}

/// Drop every lease whose owner is gone, or that is impossibly old.
fn reclaim(ledger: &mut Ledger) {
    let now = now_ms();
    let max_age = MAX_LEASE_AGE.as_millis() as u64;
    ledger.leases.retain(|lease| {
        if now.saturating_sub(lease.acquired_ms) > max_age {
            return false;
        }
        owner_alive(lease.owner_pid, lease.owner_start)
    });
}

/// Whether the process that took a lease is still the process running under
/// that pid. The start time is what makes a recycled pid a different process.
fn owner_alive(pid: u32, start: u64) -> bool {
    match crate::resources::Collector::probe_start_time(pid) {
        // No start time recorded (a lease from an older build) → trust the pid.
        None => false,
        Some(actual) => start == 0 || actual == start,
    }
}

fn own_start_time() -> u64 {
    crate::resources::Collector::probe_start_time(std::process::id()).unwrap_or(0)
}

/// Free memory right now, in MiB. Public because `status` reports it beside
/// the condition it is weighed against — a number on its own says nothing.
pub fn free_memory_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.available_memory() / (1024 * 1024)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// --- the ledger file, under its lock ----------------------------------------

fn ledger_path(dir: &Path) -> PathBuf {
    dir.join("agent-budget.json")
}

fn lock_path(dir: &Path) -> PathBuf {
    dir.join("agent-budget.lock")
}

fn read_ledger(dir: &Path) -> Result<Ledger, AppError> {
    match std::fs::read_to_string(ledger_path(dir)) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Ledger::default()),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Read → edit → write the ledger with the lock held. The closure may return a
/// value of its own (what the caller learned while deciding).
fn with_ledger<T>(
    dir: &Path,
    edit: impl FnOnce(&mut Ledger) -> Result<T, AppError>,
) -> Result<T, AppError> {
    std::fs::create_dir_all(dir)?;
    let _lock = Lock::take(dir)?;
    let mut ledger = read_ledger(dir)?;
    let out = edit(&mut ledger)?;
    let text = serde_json::to_string_pretty(&ledger)?;
    // Same atomic write the rest of the app uses: a crash mid-write must not
    // leave a ledger that reads as "no slots taken" (or as junk).
    let tmp = ledger_path(dir).with_extension("json.tmp");
    std::fs::write(&tmp, text.as_bytes())?;
    std::fs::rename(&tmp, ledger_path(dir))?;
    Ok(out)
}

/// The exclusive lock: a directory only one process can create, holding the
/// identity of its owner so a lock left behind by a dead one can be broken.
struct Lock {
    path: PathBuf,
}

impl Lock {
    fn take(dir: &Path) -> Result<Self, AppError> {
        let path = lock_path(dir);
        let deadline = std::time::Instant::now() + LOCK_TIMEOUT;
        loop {
            match std::fs::create_dir(&path) {
                Ok(()) => {
                    let _ = std::fs::write(
                        path.join("owner"),
                        format!("{} {}", std::process::id(), own_start_time()),
                    );
                    return Ok(Lock { path });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if Self::stale(&path) {
                        // The holder is gone: take the lock away from it rather
                        // than wait out a process that will never release.
                        let _ = std::fs::remove_dir_all(&path);
                        continue;
                    }
                    if std::time::Instant::now() >= deadline {
                        return Err(AppError::Invalid(
                            "the agent budget is locked by another process".into(),
                        ));
                    }
                    std::thread::sleep(LOCK_RETRY);
                }
                Err(e) => return Err(AppError::Io(e)),
            }
        }
    }

    /// A lock whose owner is not running any more — or whose owner file never
    /// arrived, which means the holder died between creating the directory and
    /// writing it.
    fn stale(path: &Path) -> bool {
        let Ok(text) = std::fs::read_to_string(path.join("owner")) else {
            // No owner recorded yet. Give the writer a moment before deciding.
            return path
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|m| SystemTime::now().duration_since(m).ok())
                .is_some_and(|age| age > Duration::from_secs(5));
        };
        let mut parts = text.split_whitespace();
        let pid = parts.next().and_then(|p| p.parse::<u32>().ok());
        let start = parts
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        match pid {
            Some(pid) if pid == std::process::id() => false,
            Some(pid) => !owner_alive(pid, start),
            None => true,
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
