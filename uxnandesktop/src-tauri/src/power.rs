//! Keep the system awake while an agent is working (spec Phase 5, opt-in).
//!
//! When the user enables "prevent sleep" and an agent is actively working, the
//! ADE asks the OS not to sleep, per platform:
//! - **Windows:** `SetThreadExecutionState` — thread-affine (the request lives
//!   only as long as the thread that set it), so all calls run on one long-lived
//!   worker thread.
//! - **macOS:** a child `caffeinate -i` process (prevents idle sleep while it
//!   runs); killed to release.
//! - **Linux:** a child `systemd-inhibit … --mode=block sleep infinity` holding
//!   an idle/sleep inhibitor lock; killed to release. No-op if `systemd-inhibit`
//!   is absent.
//!
//! As a safety cap the request auto-releases after 2 hours even if the agent is
//! still flagged working, so a stuck "working" state can't keep the machine
//! awake forever.
//!
//! NOTE: the macOS and Linux paths are implemented but **untested** on those
//! platforms (developed on Windows). They are `std`-only (no extra deps).

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

/// Safety cap: release the keep-awake request after this long regardless.
const AUTO_RELEASE: Duration = Duration::from_secs(2 * 60 * 60);

/// Handle to the keep-awake worker thread. Dropping it ends the thread, which
/// releases any active request.
pub struct SleepBlocker {
    tx: Sender<bool>,
}

impl SleepBlocker {
    /// Spawn the worker thread (initially idle / allowing sleep).
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<bool>();
        thread::spawn(move || worker(rx));
        Self { tx }
    }

    /// Request (or release) keeping the system awake. Idempotent and cheap; the
    /// worker applies a change only when the desired state actually flips.
    pub fn set(&self, keep_awake: bool) {
        let _ = self.tx.send(keep_awake);
    }
}

impl Default for SleepBlocker {
    fn default() -> Self {
        Self::new()
    }
}

/// What the worker drives: the platform [`Inhibitor`] in the app, a recorder in
/// the state-machine tests (the OS calls themselves are covered by the host-OS
/// test below — each CI runner exercises its own branch).
trait Inhibit {
    fn apply(&mut self, keep_awake: bool);
}

/// Worker loop entry: owns the platform [`Inhibitor`] so any thread-affine
/// request (Windows) and any child inhibitor process (macOS/Linux) stay on one
/// thread.
fn worker(rx: mpsc::Receiver<bool>) {
    worker_loop(rx, Inhibitor::new(), AUTO_RELEASE);
}

/// The state machine, generic over the inhibitor so it is testable: blocks for
/// commands; while a request is active it instead waits up to `auto_release`
/// and then releases on timeout. Applies a change only when the desired state
/// actually flips.
fn worker_loop<I: Inhibit>(rx: mpsc::Receiver<bool>, mut inhibitor: I, auto_release: Duration) {
    let mut active = false;
    loop {
        let next = if active {
            rx.recv_timeout(auto_release)
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        match next {
            Ok(want) => {
                if want != active {
                    active = want;
                    inhibitor.apply(active);
                }
            }
            // Auto-release safety cap: drop the request even if still "working".
            Err(RecvTimeoutError::Timeout) => {
                active = false;
                inhibitor.apply(false);
            }
            // Handle dropped: release and exit.
            Err(RecvTimeoutError::Disconnected) => {
                inhibitor.apply(false);
                break;
            }
        }
    }
}

#[cfg(windows)]
struct Inhibitor;

#[cfg(windows)]
impl Inhibitor {
    fn new() -> Self {
        Self
    }
}

#[cfg(windows)]
impl Inhibit for Inhibitor {
    fn apply(&mut self, keep_awake: bool) {
        use windows_sys::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
        };
        // ES_CONTINUOUS makes the new state persist for this thread; adding
        // ES_SYSTEM_REQUIRED keeps the system from sleeping. Releasing = just
        // ES_CONTINUOUS (clears the system-required flag).
        let flags = if keep_awake {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        // Safety: a plain Win32 call with no pointers; always valid to invoke.
        unsafe {
            SetThreadExecutionState(flags);
        }
    }
}

// macOS + Linux both hold the request by keeping a helper child process alive,
// so they share the same struct shape and logic (only the command differs).
#[cfg(any(target_os = "macos", target_os = "linux"))]
struct Inhibitor {
    child: Option<std::process::Child>,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl Inhibitor {
    fn new() -> Self {
        Self { child: None }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl Inhibit for Inhibitor {
    fn apply(&mut self, keep_awake: bool) {
        if keep_awake {
            if self.child.is_none() {
                self.child = spawn_inhibitor();
            }
        } else if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Spawn the platform's keep-awake helper. `None` (and a silent no-op) if the
/// helper isn't available — UNTESTED on macOS/Linux.
#[cfg(target_os = "macos")]
fn spawn_inhibitor() -> Option<std::process::Child> {
    // `caffeinate -i` prevents idle system sleep for as long as it runs.
    std::process::Command::new("caffeinate")
        .arg("-i")
        .spawn()
        .ok()
}

#[cfg(target_os = "linux")]
fn spawn_inhibitor() -> Option<std::process::Child> {
    // Hold a systemd inhibitor lock until the helper is killed. No-op when
    // `systemd-inhibit` isn't present (non-systemd systems).
    std::process::Command::new("systemd-inhibit")
        .args([
            "--what=idle:sleep",
            "--who=Uxnan Desktop",
            "--why=An agent is working",
            "--mode=block",
            "sleep",
            "infinity",
        ])
        .spawn()
        .ok()
}

// Any other platform: keep-awake is a no-op (build stays cross-platform).
#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
struct Inhibitor;

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl Inhibitor {
    fn new() -> Self {
        Self
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl Inhibit for Inhibitor {
    fn apply(&mut self, _keep_awake: bool) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Records every state the worker applies, standing in for the OS.
    struct Recorder(Arc<Mutex<Vec<bool>>>);

    impl Inhibit for Recorder {
        fn apply(&mut self, keep_awake: bool) {
            self.0.lock().unwrap().push(keep_awake);
        }
    }

    fn spawn_loop(
        auto_release: Duration,
    ) -> (Sender<bool>, Arc<Mutex<Vec<bool>>>, thread::JoinHandle<()>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let recorder = Recorder(log.clone());
        let (tx, rx) = mpsc::channel::<bool>();
        let handle = thread::spawn(move || worker_loop(rx, recorder, auto_release));
        (tx, log, handle)
    }

    fn wait_until(log: &Arc<Mutex<Vec<bool>>>, expected: &[bool]) -> bool {
        // Poll on an observable state rather than sleeping a fixed time — the
        // worker applies commands asynchronously.
        for _ in 0..200 {
            if log.lock().unwrap().as_slice() == expected {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn applies_only_real_state_changes() {
        let (tx, log, handle) = spawn_loop(Duration::from_secs(60));
        tx.send(true).unwrap();
        tx.send(true).unwrap(); // duplicate: must not re-apply
        tx.send(false).unwrap();
        assert!(
            wait_until(&log, &[true, false]),
            "got {:?}",
            log.lock().unwrap()
        );
        drop(tx); // exit path releases once more, unconditionally
        handle.join().unwrap();
        assert_eq!(log.lock().unwrap().as_slice(), &[true, false, false]);
    }

    #[test]
    fn a_stuck_working_state_auto_releases_after_the_cap() {
        let (tx, log, handle) = spawn_loop(Duration::from_millis(30));
        tx.send(true).unwrap();
        // No further message: the cap alone must release the request.
        assert!(
            wait_until(&log, &[true, false]),
            "got {:?}",
            log.lock().unwrap()
        );
        drop(tx);
        handle.join().unwrap();
    }

    #[test]
    fn dropping_the_handle_releases_and_ends_the_worker() {
        let (tx, log, handle) = spawn_loop(Duration::from_secs(60));
        tx.send(true).unwrap();
        assert!(wait_until(&log, &[true]), "got {:?}", log.lock().unwrap());
        drop(tx);
        handle.join().unwrap(); // the loop exited…
        assert_eq!(log.lock().unwrap().last(), Some(&false)); // …after releasing
    }

    #[test]
    fn the_real_inhibitor_toggles_on_this_host() {
        // Executes the platform branch of whichever OS runs the suite — each CI
        // runner covers its own: `SetThreadExecutionState` on Windows, a spawned
        // `caffeinate` on macOS, `systemd-inhibit` on Linux (a silent no-op when
        // the helper is absent). Proves the call/spawn/kill path holds together;
        // whether the machine truly stays awake is hardware evidence and lives
        // on the platform checklist (tests/platform-support.json).
        let mut inhibitor = Inhibitor::new();
        inhibitor.apply(true);
        inhibitor.apply(false);
    }
}
