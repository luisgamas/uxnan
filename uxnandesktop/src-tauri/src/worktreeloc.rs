//! Where a new worktree lands on disk (spec `02c` §2.1) — the workspace
//! engine's (`uxnan_workspace_engine::worktreeloc`), so a host's engine places
//! one there by the same layout.

pub use uxnan_workspace_engine::worktreeloc::*;

/// A temporary directory's path **as git will report it** — canonicalized,
/// forward slashes, without Windows' `\\?\` prefix — for this crate's tests
/// that compare a path against git's own output (the engine's own copy is
/// private to its tests).
#[cfg(test)]
pub(crate) fn canonical_temp(path: &std::path::Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = resolved.to_string_lossy().replace('\\', "/");
    text.strip_prefix("//?/").unwrap_or(&text).to_string()
}
