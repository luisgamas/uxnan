//! Keep the system awake while an agent is working (spec Phase 5, opt-in).
//!
//! When the user enables "prevent sleep" and an agent is actively working, the
//! ADE asks the OS not to sleep. On Windows that means `SetThreadExecutionState`
//! — which is **thread-affine** (the request lives only as long as the thread
//! that made it), so all calls go through one long-lived worker thread fed by a
//! channel. As a safety cap the request auto-releases after 2 hours even if the
//! agent is still flagged working, so a stuck "working" state can't keep the
//! machine awake forever.
//!
//! Off Windows this is currently a no-op (see the `FOR-DEV` in `apply`).

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

/// Worker loop: owns the OS request so it stays on a single thread. Blocks for
/// commands; while a request is active it instead waits up to [`AUTO_RELEASE`]
/// and then releases on timeout.
fn worker(rx: mpsc::Receiver<bool>) {
    let mut active = false;
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
                    apply(active);
                }
            }
            // Auto-release safety cap: drop the request even if still "working".
            Err(RecvTimeoutError::Timeout) => {
                active = false;
                apply(false);
            }
            // Handle dropped: release and exit.
            Err(RecvTimeoutError::Disconnected) => {
                apply(false);
                break;
            }
        }
    }
}

#[cfg(windows)]
fn apply(keep_awake: bool) {
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

#[cfg(not(windows))]
fn apply(_keep_awake: bool) {
    // FOR-DEV: implement per-OS keep-awake off Windows — macOS via
    // `IOPMAssertionCreateWithName` (kIOPMAssertionTypePreventUserIdleSystemSleep),
    // Linux via the `org.freedesktop.login1` `Inhibit` D-Bus call (or
    // `systemd-inhibit`). No-op for now so the build/feature is cross-platform.
}
