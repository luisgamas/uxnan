//! Post-mortem diagnostics: the record the app leaves behind when it fails.
//!
//! Why this module exists: the app went to a black screen and had to be
//! force-closed, and afterwards there was **nothing to investigate with** — no
//! Windows Application-log entry, no WebView2 minidump, and no log of our own.
//! The only reporting the backend had was a handful of `eprintln!` calls, which
//! in a packaged Windows GUI build write to a stderr no one is attached to, so
//! they vanish. A Rust panic left no trace either, and a frontend exception that
//! blanks the webview left less than that.
//!
//! So this is deliberately **not** a general logging framework. It is the
//! smallest thing that makes the *next* failure diagnosable:
//!
//! - a rolling file log under `<app-data>/logs/`, written by both Rust and the
//!   webview, so backend and frontend failures land on one timeline;
//! - a panic hook, so a Rust panic is recorded before the process dies;
//! - an **unclean-shutdown marker**, so the app can tell on the next launch that
//!   the previous session never reached its clean exit path (which is exactly
//!   what a force-close after a black screen looks like — and also why the
//!   terminal-scrollback sidecar silently stopped being written).
//!
//! It has no dependency of its own: timestamps are formatted from the same
//! `SystemTime` epoch the rest of the backend already uses (`hooks::now_secs`,
//! `automations`), so the log is readable without pulling in a date crate.
//!
//! **Secrets never enter this file.** Nothing here logs the hook server's token,
//! a provider token, terminal output, prompts or file contents; call sites pass
//! short lifecycle facts, and every message is sanitized ([`sanitize`]) because
//! the webview half is untrusted input.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Directory (under the app data dir) holding the log and its rotations.
pub const LOG_DIR: &str = "logs";
/// Current log file name; rotations are `uxnan-desktop.1.log`, `.2.log`, …
const LOG_FILE: &str = "uxnan-desktop.log";
/// Marker written while a session is live and removed on a clean exit.
const SESSION_MARKER: &str = "session.active";
/// Rotate once the live file passes this size (bytes).
const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// How many rotated files to keep besides the live one.
const KEEP_ROTATIONS: usize = 3;
/// Longest message we record; a webview stack trace can be unbounded.
const MAX_MESSAGE_CHARS: usize = 2000;

/// Severity of a recorded line. Kept tiny on purpose — this is a lifecycle
/// record, not a metrics pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }

    /// Parse a level coming from the webview. Unknown values degrade to `Error`
    /// rather than being dropped: an unrecognized report is still a report, and
    /// losing it is worse than over-reporting it.
    pub fn parse(raw: &str) -> Level {
        match raw.trim().to_ascii_lowercase().as_str() {
            "info" => Level::Info,
            "warn" | "warning" => Level::Warn,
            _ => Level::Error,
        }
    }
}

/// The process-wide diagnostics sink.
///
/// A global rather than managed Tauri state because the panic hook must be able
/// to write from any thread while the process is coming down, with no access to
/// an `AppHandle`.
static SINK: OnceLock<Diagnostics> = OnceLock::new();

/// An open diagnostics log rooted at one directory.
pub struct Diagnostics {
    dir: PathBuf,
    /// Serializes writes *and* rotation, so a rotation can never interleave with
    /// a half-written line.
    write_lock: Mutex<()>,
    previous_session_unclean: bool,
}

impl Diagnostics {
    /// Prepare `<data_dir>/logs/`, detect whether the previous session ended
    /// cleanly, and arm the marker for this one.
    ///
    /// Best-effort by construction: if the directory cannot be created the
    /// returned value still answers every call, it just discards the lines. A
    /// diagnostics facility that can break startup would be worse than none.
    pub fn init(data_dir: &Path) -> Diagnostics {
        let dir = data_dir.join(LOG_DIR);
        let _ = fs::create_dir_all(&dir);
        let marker = dir.join(SESSION_MARKER);
        let previous_session_unclean = marker.exists();
        // Arm the marker for this session. Its *content* is only a hint for a
        // human reading the folder; the existence of the file is the signal.
        let _ = fs::write(&marker, b"uxnan-desktop session in progress\n");
        Diagnostics {
            dir,
            write_lock: Mutex::new(()),
            previous_session_unclean,
        }
    }

    /// Whether the previous session never reached its clean-exit path (crash,
    /// force-close, or a kill). `false` on a first run.
    pub fn previous_session_unclean(&self) -> bool {
        self.previous_session_unclean
    }

    /// Path of the live log file.
    pub fn log_path(&self) -> PathBuf {
        self.dir.join(LOG_FILE)
    }

    /// Record one line. Never panics and never propagates an error — a failure
    /// to log must not become a second failure.
    pub fn log(&self, level: Level, source: &str, message: &str) {
        let line = format_line(now_ms(), level, source, message);
        let Ok(_guard) = self.write_lock.lock() else {
            // A poisoned lock means another thread panicked mid-write. The log
            // is exactly what we want during a panic, so carry on unguarded
            // rather than going silent.
            let _ = self.append(&line);
            return;
        };
        self.rotate_if_needed();
        let _ = self.append(&line);
    }

    fn append(&self, line: &str) -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.log_path())?;
        file.write_all(line.as_bytes())
    }

    /// Roll `uxnan-desktop.log` → `.1.log` → … → `.{KEEP_ROTATIONS}.log`,
    /// dropping the oldest, once the live file grows past [`MAX_BYTES`].
    fn rotate_if_needed(&self) {
        let live = self.log_path();
        let Ok(meta) = fs::metadata(&live) else {
            return; // No file yet — nothing to rotate.
        };
        if !should_rotate(meta.len()) {
            return;
        }
        let rotated = |n: usize| self.dir.join(format!("uxnan-desktop.{n}.log"));
        let _ = fs::remove_file(rotated(KEEP_ROTATIONS));
        for n in (1..KEEP_ROTATIONS).rev() {
            let _ = fs::rename(rotated(n), rotated(n + 1));
        }
        let _ = fs::rename(&live, rotated(1));
    }

    /// Record the clean-exit line and disarm the marker, so the next launch
    /// knows this session ended on purpose.
    pub fn mark_clean_shutdown(&self) {
        self.log(Level::Info, "lifecycle", "shutdown: clean exit");
        let _ = fs::remove_file(self.dir.join(SESSION_MARKER));
    }
}

/// Install the process-wide sink and record the start of this session.
///
/// Returns whether the **previous** session ended uncleanly, so the caller can
/// act on it (today: a log line; the marker is also readable by the frontend
/// through `diagnostics_report`).
pub fn init(data_dir: &Path, version: &str) -> bool {
    let diagnostics = Diagnostics::init(data_dir);
    let unclean = diagnostics.previous_session_unclean();
    let _ = SINK.set(diagnostics);
    log(
        Level::Info,
        "lifecycle",
        &format!(
            "startup: uxnan-desktop {version} on {} ({})",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
    if unclean {
        log(
            Level::Warn,
            "lifecycle",
            "previous session ended without a clean shutdown (crash, force-close or kill); \
             terminal scrollback from that session was not persisted",
        );
    }
    unclean
}

/// The installed sink, if [`init`] ran. `None` in unit tests and in the headless
/// automation runner, where logging to the user's profile is not wanted.
pub fn sink() -> Option<&'static Diagnostics> {
    SINK.get()
}

/// Record a line through the process-wide sink. A no-op when uninitialized.
pub fn log(level: Level, source: &str, message: &str) {
    if let Some(sink) = SINK.get() {
        sink.log(level, source, message);
    }
}

/// Route Rust panics into the log before the process dies, keeping whatever
/// hook was installed before (so Tauri's / the test harness's own reporting is
/// preserved rather than replaced).
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let payload = panic_payload(info.payload());
        log(
            Level::Error,
            "panic",
            &format!("panic at {location}: {payload}"),
        );
        previous(info);
    }));
}

/// Extract the human-readable half of a panic payload (`&str` and `String` are
/// what `panic!` produces; anything else is opaque).
fn panic_payload(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

/// Milliseconds since the Unix epoch — the same clock the rest of the backend
/// uses, so log lines interleave with `hooks`/`automations` timestamps.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// True once the live log has grown past its cap.
fn should_rotate(size: u64) -> bool {
    size >= MAX_BYTES
}

/// Render one log line, newline included.
fn format_line(epoch_ms: u64, level: Level, source: &str, message: &str) -> String {
    format!(
        "{} {:<5} [{}] {}\n",
        format_timestamp(epoch_ms),
        level.label(),
        sanitize_source(source),
        sanitize(message)
    )
}

/// Collapse a message to one safe, bounded line.
///
/// The webview half of this log is untrusted input: a thrown value can carry
/// newlines (which would forge extra log lines), control characters, or an
/// unbounded stack. Newlines become a visible `⏎` so a stack trace stays
/// readable on its single line.
fn sanitize(message: &str) -> String {
    let mut out = String::with_capacity(message.len().min(MAX_MESSAGE_CHARS));
    for (chars, ch) in message.chars().enumerate() {
        if chars >= MAX_MESSAGE_CHARS {
            out.push('…');
            break;
        }
        match ch {
            '\n' | '\r' => out.push('⏎'),
            c if c.is_control() => out.push(' '),
            c => out.push(c),
        }
    }
    if out.trim().is_empty() {
        return "(empty message)".to_string();
    }
    out
}

/// Sources are labels, not prose: keep them short and free of separators so the
/// bracketed field can never be forged from the webview side.
fn sanitize_source(source: &str) -> String {
    let cleaned: String = source
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
        .take(40)
        .collect();
    if cleaned.is_empty() {
        "webview".to_string()
    } else {
        cleaned
    }
}

/// Format an epoch-millisecond instant as `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC).
///
/// Hand-rolled civil-from-days rather than a date dependency: the backend has
/// no date crate today, and this is the only place that needs one. The algorithm
/// is Howard Hinnant's `civil_from_days`, valid across the range any log can
/// hold.
fn format_timestamp(epoch_ms: u64) -> String {
    let secs = (epoch_ms / 1000) as i64;
    let millis = epoch_ms % 1000;
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let (hour, minute, second) = (
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    );
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Days since 1970-01-01 → (year, month, day). Hinnant's algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Create the log file if it is missing — only used by tests that need it to
/// exist before they grow it; production always appends through
/// [`Diagnostics::append`], which creates it on demand.
#[cfg(test)]
fn touch(path: &Path) -> std::io::Result<()> {
    OpenOptions::new().create(true).append(true).open(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("uxnan-diagnostics-{name}-{}", now_ms()));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn timestamps_render_as_utc_iso8601() {
        // 2026-08-02T04:51:08.123Z — the merge timestamp from this cycle.
        assert_eq!(
            format_timestamp(1_785_646_268_123),
            "2026-08-02T04:51:08.123Z"
        );
        assert_eq!(format_timestamp(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn civil_from_days_handles_leap_years() {
        // 2024-02-29 is day 19782 since the epoch.
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn a_webview_message_cannot_forge_a_second_line() {
        // A thrown value carrying newlines would otherwise inject log lines.
        let forged = sanitize("boom\n2026-01-01T00:00:00.000Z INFO [lifecycle] all is well");
        assert!(!forged.contains('\n'));
        assert!(forged.contains('⏎'));
    }

    #[test]
    fn messages_are_bounded_and_never_empty() {
        let long = "x".repeat(MAX_MESSAGE_CHARS * 2);
        let sanitized = sanitize(&long);
        assert_eq!(sanitized.chars().count(), MAX_MESSAGE_CHARS + 1); // + the ellipsis
        assert_eq!(sanitize("   "), "(empty message)");
    }

    #[test]
    fn sources_are_reduced_to_a_label() {
        assert_eq!(sanitize_source("webview.error"), "webview.error");
        assert_eq!(sanitize_source("] forged ["), "forged");
        assert_eq!(sanitize_source(""), "webview");
    }

    #[test]
    fn unknown_levels_report_as_errors_rather_than_being_dropped() {
        assert_eq!(Level::parse("info"), Level::Info);
        assert_eq!(Level::parse("WARNING"), Level::Warn);
        assert_eq!(Level::parse("something else"), Level::Error);
    }

    #[test]
    fn a_first_run_is_not_reported_as_unclean_but_a_missing_shutdown_is() {
        let dir = temp_dir("marker");

        let first = Diagnostics::init(&dir);
        assert!(
            !first.previous_session_unclean(),
            "a first run has no marker yet"
        );

        // Session ends without `mark_clean_shutdown` — a force-close.
        let second = Diagnostics::init(&dir);
        assert!(second.previous_session_unclean());

        second.mark_clean_shutdown();
        let third = Diagnostics::init(&dir);
        assert!(
            !third.previous_session_unclean(),
            "a clean shutdown disarms the marker"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lines_land_in_the_log_file() {
        let dir = temp_dir("write");
        let diagnostics = Diagnostics::init(&dir);
        diagnostics.log(Level::Error, "panic", "panic at src/lib.rs:1:1: boom");

        let contents = fs::read_to_string(diagnostics.log_path()).expect("log written");
        assert!(contents.contains("ERROR"));
        assert!(contents.contains("[panic]"));
        assert!(contents.contains("boom"));
        assert_eq!(contents.lines().count(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_live_log_is_rotated_once_it_passes_its_cap() {
        let dir = temp_dir("rotate");
        let diagnostics = Diagnostics::init(&dir);
        touch(&diagnostics.log_path()).expect("create");
        fs::write(diagnostics.log_path(), vec![b'x'; MAX_BYTES as usize + 1]).expect("grow");

        diagnostics.log(Level::Info, "lifecycle", "after rotation");

        assert!(
            dir.join(LOG_DIR).join("uxnan-desktop.1.log").exists(),
            "the oversized file was rolled aside"
        );
        let live = fs::read_to_string(diagnostics.log_path()).expect("live log");
        assert!(live.contains("after rotation"));
        assert!(live.len() < MAX_BYTES as usize, "the live log starts fresh");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_keeps_a_bounded_number_of_files() {
        let dir = temp_dir("bounded");
        let diagnostics = Diagnostics::init(&dir);
        for _ in 0..KEEP_ROTATIONS + 3 {
            fs::write(diagnostics.log_path(), vec![b'x'; MAX_BYTES as usize + 1]).expect("grow");
            diagnostics.log(Level::Info, "lifecycle", "roll");
        }

        let logs = fs::read_dir(dir.join(LOG_DIR))
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".log"))
            .count();
        assert_eq!(logs, KEEP_ROTATIONS + 1, "live file plus its rotations");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn logging_without_init_is_a_no_op() {
        // The headless automation runner never calls `init`; a stray log call
        // there must not panic.
        log(Level::Info, "lifecycle", "no sink installed");
    }
}
