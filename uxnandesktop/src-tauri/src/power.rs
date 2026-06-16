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

/// Worker loop: owns the platform [`Inhibitor`] so any thread-affine request
/// (Windows) and any child inhibitor process (macOS/Linux) stay on one thread.
/// Blocks for commands; while a request is active it instead waits up to
/// [`AUTO_RELEASE`] and then releases on timeout.
fn worker(rx: mpsc::Receiver<bool>) {
    let mut active = false;
    let mut inhibitor = Inhibitor::new();
    loop {
        let next = if active {
            rx.recv_timeout(AUTO_RELEASE)
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        match next {
            Ok(want) => {
                if want != active {
                    active = want;
                    inhibitor.set(active);
                }
            }
            // Auto-release safety cap: drop the request even if still "working".
            Err(RecvTimeoutError::Timeout) => {
                active = false;
                inhibitor.set(false);
            }
            // Handle dropped: release and exit.
            Err(RecvTimeoutError::Disconnected) => {
                inhibitor.set(false);
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
    fn set(&mut self, keep_awake: bool) {
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
    fn set(&mut self, keep_awake: bool) {
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
    fn set(&mut self, _keep_awake: bool) {}
}
