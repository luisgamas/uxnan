//! In-app directory browser backing the project picker.
//!
//! Replaces the OS-native folder dialog with an ADE-owned browser: list a
//! directory's sub-folders, flag which are git repos, and navigate up/down so
//! "Add project" stays inside the app's own UI (spec §2.3, mirrors the bridge's
//! `workspace/browseDirs`). This is the user's own machine, so browsing is not
//! root-confined.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

/// One sub-directory in a listing.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    /// Whether this directory is a git repository (`.git` exists inside it).
    pub is_repo: bool,
}

/// A directory's listing: its path, its parent (for "up"), whether it is itself
/// a git repo, and its sub-directories.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub parent: Option<String>,
    pub is_repo: bool,
    pub entries: Vec<DirEntry>,
}

fn home_dir() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(var)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// List the sub-directories of `path` (or the home directory when omitted),
/// hidden/dot folders excluded, sorted case-insensitively by name.
pub async fn browse_dirs(path: Option<String>) -> Result<DirListing, AppError> {
    let base = match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => home_dir(),
    };

    let mut entries: Vec<DirEntry> = Vec::new();
    let mut reader = tokio::fs::read_dir(&base).await?;
    while let Some(item) = reader.next_entry().await? {
        let Ok(file_type) = item.file_type().await else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // skip hidden folders (including `.git`)
        }
        let entry_path = item.path();
        entries.push(DirEntry {
            is_repo: is_repo(&entry_path),
            path: entry_path.to_string_lossy().to_string(),
            name,
        });
    }
    entries.sort_by_key(|e| e.name.to_lowercase());

    Ok(DirListing {
        parent: base.parent().map(|p| p.to_string_lossy().to_string()),
        is_repo: is_repo(&base),
        path: base.to_string_lossy().to_string(),
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_sorted_dirs_and_flags_repos() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("zeta")).unwrap();
        std::fs::create_dir(tmp.path().join("alpha")).unwrap();
        let repo = tmp.path().join("beta");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        std::fs::create_dir(tmp.path().join(".hidden")).unwrap();
        std::fs::write(tmp.path().join("a-file.txt"), b"x").unwrap();

        let listing = browse_dirs(Some(tmp.path().to_string_lossy().to_string()))
            .await
            .unwrap();

        // Sorted, dirs only, hidden + files excluded.
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["alpha", "beta", "zeta"]);
        // Only `beta` has a `.git`.
        assert!(
            listing
                .entries
                .iter()
                .find(|e| e.name == "beta")
                .unwrap()
                .is_repo
        );
        assert!(
            !listing
                .entries
                .iter()
                .find(|e| e.name == "alpha")
                .unwrap()
                .is_repo
        );
        assert!(listing.parent.is_some());
        assert!(!listing.is_repo);
    }
}
