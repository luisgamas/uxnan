//! The daemon's log: one line per event worth knowing after the fact.
//!
//! **Nothing a terminal shows is written here** — no output, no input, no
//! command line — only lifecycle: started, a client came and went, a terminal
//! began or ended. A log is read by whoever can read the file, and a terminal
//! carries secrets all the time.

use std::io::Write;

/// Past this size the log starts over, keeping one previous file.
const MAX_LOG_BYTES: u64 = 1 << 20;

pub fn line(message: &str) {
    let path = crate::paths::log();
    if std::fs::metadata(&path)
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&path, path.with_extension("log.1"));
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    // Readable by the user alone, whatever the umask.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    if let Ok(mut file) = options.open(&path) {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "{secs} [{}] {message}", std::process::id());
    }
}
