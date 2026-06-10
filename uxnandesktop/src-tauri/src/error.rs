//! Error types for the backend.
//!
//! `AppError` is the internal `Result` error (via `thiserror`). `CommandError`
//! is the serializable shape sent back to the Svelte frontend across the Tauri
//! command boundary — it never leaks internals beyond a stable `code` + message.

use serde::Serialize;

/// Internal backend error. Use this in module functions; convert to
/// [`CommandError`] at the Tauri command boundary.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("unsupported persistence schema version: {0}")]
    UnsupportedVersion(u32),
    #[error("pty error: {0}")]
    Pty(String),
    #[error("not found: {0}")]
    NotFound(String),
}

/// Serializable error returned to the frontend. `code` is a stable,
/// machine-readable identifier; `message` is human-readable detail.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub message: String,
    pub code: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: code.into(),
        }
    }
}

impl From<AppError> for CommandError {
    fn from(e: AppError) -> Self {
        let code = match &e {
            AppError::Io(_) => "IO_ERROR",
            AppError::Serde(_) => "SERDE_ERROR",
            AppError::UnsupportedVersion(_) => "UNSUPPORTED_VERSION",
            AppError::Pty(_) => "PTY_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
        };
        CommandError::new(code, e.to_string())
    }
}
