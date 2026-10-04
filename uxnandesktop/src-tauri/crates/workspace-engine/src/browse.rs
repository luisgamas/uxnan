//! The directory browser behind the project picker — on this machine in
//! process, and on a host by its engine, so a folder there is found exactly as
//! one here is.
//!
//! List a directory's sub-folders, flag which are git repos, and navigate
//! up/down so "Add project" stays inside the app's own UI (spec §2.3, mirrors
//! the bridge's `workspace/browseDirs`). It is the user's own machine, so
//! browsing is not root-confined. Only directories, hidden ones left out:
//! adding a project means choosing a folder, and neither thousands of files nor
//! a `.cache` is something a user is picking here.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Error;

/// Most entries one listing returns. A home directory with ten thousand
/// folders is unusual but not impossible, and neither the wire nor a picker
/// gains anything from the rest.
const MAX_ENTRIES: usize = 500;

/// One sub-directory in a listing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    /// Whether this directory is a git repository (`.git` exists inside it).
    pub is_repo: bool,
}

/// A directory's listing: its path, its parent (for "up"), whether it is itself
/// a git repo, and its sub-directories.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub parent: Option<String>,
    pub is_repo: bool,
    pub entries: Vec<DirEntry>,
    /// The listing was cut at [`MAX_ENTRIES`]. Said out loud, because a picker
    /// that silently shows 500 of 3,000 folders cannot find the one you want
    /// and will not tell you why.
    #[serde(default)]
    pub truncated: bool,
}

impl DirListing {
    /// Every path in the forward-slash form the app keeps a host's paths in
    /// (`C:/Users/…` on a Windows host), whatever this machine spells.
    pub fn forward_slashed(mut self) -> Self {
        let fix = |p: &mut String| *p = p.replace('\\', "/");
        fix(&mut self.path);
        if let Some(parent) = self.parent.as_mut() {
            fix(parent);
        }
        for entry in &mut self.entries {
            fix(&mut entry.path);
        }
        self
    }
}

fn home_dir() -> PathBuf {
    crate::agent_hooks::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// List the sub-directories of `path` (or the home directory when omitted),
/// hidden/dot folders excluded, sorted case-insensitively by name.
pub async fn browse_dirs(path: Option<String>) -> Result<DirListing, Error> {
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
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);

    Ok(DirListing {
        parent: base.parent().map(|p| p.to_string_lossy().to_string()),
        is_repo: is_repo(&base),
        path: base.to_string_lossy().to_string(),
        entries,
        truncated,
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
        assert!(!listing.truncated);
    }

    #[test]
    fn a_hosts_listing_is_spelled_with_forward_slashes() {
        let listing = DirListing {
            path: r"C:\Users\gamas".into(),
            parent: Some(r"C:\Users".into()),
            is_repo: false,
            entries: vec![DirEntry {
                name: "app".into(),
                path: r"C:\Users\gamas\app".into(),
                is_repo: true,
            }],
            truncated: false,
        }
        .forward_slashed();
        assert_eq!(listing.path, "C:/Users/gamas");
        assert_eq!(listing.parent.as_deref(), Some("C:/Users"));
        assert_eq!(listing.entries[0].path, "C:/Users/gamas/app");
    }

    #[tokio::test]
    async fn a_listing_says_when_it_was_cut() {
        let tmp = tempfile::tempdir().unwrap();
        for n in 0..=MAX_ENTRIES {
            std::fs::create_dir(tmp.path().join(format!("d{n:04}"))).unwrap();
        }
        let listing = browse_dirs(Some(tmp.path().to_string_lossy().to_string()))
            .await
            .unwrap();
        assert_eq!(listing.entries.len(), MAX_ENTRIES);
        assert!(listing.truncated);
    }
}
