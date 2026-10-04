//! Filesystem access for the file tree and the editor — the workspace engine's
//! (`uxnan_workspace_engine::fs`), so a host's engine serves the same functions.
//! What stays here is this machine's own: moving a deleted file to the system
//! trash (a host has none; its engine deletes for good).

pub use uxnan_workspace_engine::fs::*;

use crate::error::AppError;

/// Move `path` (a file or directory) to the OS trash — the file tree's "Delete".
/// Recoverable by design (Recycle Bin / Trash / freedesktop), unlike an unlink.
/// Guards via [`check_deletable`]; `trash::delete` is blocking, so it runs on the
/// blocking pool.
pub async fn delete_to_trash(path: &str) -> Result<(), AppError> {
    let target = check_deletable(path).await?;
    tokio::task::spawn_blocking(move || trash::delete(&target))
        .await
        .map_err(|e| AppError::Io(std::io::Error::other(format!("delete task failed: {e}"))))?
        .map_err(|e| {
            AppError::Io(std::io::Error::other(format!(
                "could not move to trash: {e}"
            )))
        })
}
