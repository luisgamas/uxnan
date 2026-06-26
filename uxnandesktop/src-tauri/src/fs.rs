//! Filesystem access backing the right-panel **file-tree** tab and the center
//! **file editor**.
//!
//! The git review surface (`git.rs`) only sees *changed* files; this module lets
//! the UI browse the full working tree of the active worktree/project, lazily one
//! directory at a time (so huge trees like `node_modules` never load until
//! expanded), and read/write a single text file from the editor. Like
//! [`crate::browse`], this is the user's own machine, so access is not confined.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

/// Largest file the editor will open (2 MiB). Past this we refuse to load the
/// content (so the webview never chokes on a giant/minified file) and the UI
/// shows a "too large to edit" notice instead.
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// One entry in a directory listing (a sub-directory or a file).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    /// Absolute path, forward-slash normalized so it lines up with the
    /// forward-slash worktree paths git reports (the frontend derives the
    /// worktree-relative path for git-status coloring from this).
    pub path: String,
    pub is_dir: bool,
    /// Whether git ignores this entry (a `.gitignore` / exclude match), computed
    /// per-listing. `false` outside a git repository. The file tree dims ignored
    /// entries (muted + italic) — this is independent of git *status* (ignored
    /// entries never appear in the review panel's changed-file list).
    #[serde(default)]
    pub ignored: bool,
}

/// The content of a file opened in the editor, with guards the UI honors.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// UTF-8 text (empty when `binary` or `tooLarge`).
    pub content: String,
    /// The file is not valid UTF-8 text (or contains NUL bytes) — not editable.
    pub binary: bool,
    /// The file exceeds [`MAX_EDIT_BYTES`] — not loaded (read-only notice).
    pub too_large: bool,
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// List the immediate children of `path`: sub-directories first, then files,
/// each group sorted case-insensitively by name. The `.git` directory is hidden
/// (its internals are never user-editable); every other entry — dotfiles
/// included — is listed, matching what an IDE file tree shows.
pub async fn list_dir(path: &str) -> Result<Vec<FsEntry>, AppError> {
    let base = PathBuf::from(path);
    let mut dirs: Vec<FsEntry> = Vec::new();
    let mut files: Vec<FsEntry> = Vec::new();

    let mut reader = tokio::fs::read_dir(&base).await?;
    while let Some(item) = reader.next_entry().await? {
        let Ok(file_type) = item.file_type().await else {
            continue;
        };
        let name = item.file_name().to_string_lossy().to_string();
        let is_dir = file_type.is_dir();
        if is_dir && name == ".git" {
            continue; // git's own store is never browsed/edited
        }
        let entry = FsEntry {
            path: normalize(&item.path()),
            name,
            is_dir,
            ignored: false,
        };
        if is_dir {
            dirs.push(entry);
        } else {
            files.push(entry);
        }
    }
    dirs.sort_by_key(|e| e.name.to_lowercase());
    files.sort_by_key(|e| e.name.to_lowercase());
    dirs.append(&mut files);
    let mut entries = dirs;

    // Flag git-ignored entries (dimmed in the tree). libgit2 is blocking, so the
    // ignore check runs on the blocking pool; best-effort, so any failure (or a
    // non-repo directory) just leaves every entry un-flagged.
    let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
    let dir = path.to_string();
    let flags = tokio::task::spawn_blocking(move || crate::gitfast::ignored_flags(&dir, &paths))
        .await
        .unwrap_or_default();
    for (entry, ignored) in entries.iter_mut().zip(flags) {
        entry.ignored = ignored;
    }
    Ok(entries)
}

/// Read a single file for the editor. Refuses (via flags, not an error) to load
/// a file larger than [`MAX_EDIT_BYTES`] or one that isn't valid UTF-8 text, so
/// the editor can show an honest notice instead of garbage.
pub async fn read_file(path: &str) -> Result<FileContent, AppError> {
    let meta = tokio::fs::metadata(path).await?;
    if meta.len() > MAX_EDIT_BYTES {
        return Ok(FileContent {
            content: String::new(),
            binary: false,
            too_large: true,
        });
    }
    let bytes = tokio::fs::read(path).await?;
    // A NUL byte (or invalid UTF-8) means it's not an editable text file.
    if bytes.contains(&0) {
        return Ok(FileContent {
            content: String::new(),
            binary: true,
            too_large: false,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(FileContent {
            content,
            binary: false,
            too_large: false,
        }),
        Err(_) => Ok(FileContent {
            content: String::new(),
            binary: true,
            too_large: false,
        }),
    }
}

/// Overwrite `path` with `content` (the editor's save). Writes to a sibling temp
/// file then renames over the target, so a crash mid-write can't truncate the
/// original.
pub async fn write_file(path: &str, content: &str) -> Result<(), AppError> {
    let target = PathBuf::from(path);
    let parent = target.parent().ok_or_else(|| {
        AppError::Invalid(format!("{path} has no parent directory to write into"))
    })?;
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let tmp = parent.join(format!(".{file_name}.uxnan-tmp"));
    tokio::fs::write(&tmp, content.as_bytes()).await?;
    // rename is atomic on the same filesystem; clean up the temp on failure.
    if let Err(e) = tokio::fs::rename(&tmp, &target).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_dirs_first_then_files_sorted_skipping_git() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("zeta")).unwrap();
        std::fs::create_dir(tmp.path().join("alpha")).unwrap();
        std::fs::create_dir(tmp.path().join(".git")).unwrap();
        std::fs::write(tmp.path().join("b.txt"), b"x").unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"x").unwrap();
        std::fs::write(tmp.path().join(".gitignore"), b"x").unwrap();

        let entries = list_dir(&tmp.path().to_string_lossy()).await.unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // dirs (alpha, zeta) before files (.gitignore, a.txt, b.txt); .git hidden.
        assert_eq!(names, ["alpha", "zeta", ".gitignore", "a.txt", "b.txt"]);
        assert!(entries[0].is_dir);
        assert!(!entries[2].is_dir);
        assert!(entries.iter().all(|e| e.name != ".git"));
        // Paths are forward-slash normalized.
        assert!(entries[0].path.ends_with("/alpha"));
    }

    #[tokio::test]
    async fn reads_text_flags_binary_and_too_large() {
        let tmp = tempfile::tempdir().unwrap();
        let text = tmp.path().join("a.txt");
        std::fs::write(&text, "hello\nworld\n").unwrap();
        let r = read_file(&text.to_string_lossy()).await.unwrap();
        assert_eq!(r.content, "hello\nworld\n");
        assert!(!r.binary && !r.too_large);

        let bin = tmp.path().join("b.bin");
        std::fs::write(&bin, [0u8, 1, 2, 3]).unwrap();
        let r = read_file(&bin.to_string_lossy()).await.unwrap();
        assert!(r.binary && r.content.is_empty());

        let big = tmp.path().join("big.txt");
        std::fs::write(&big, vec![b'a'; (MAX_EDIT_BYTES + 1) as usize]).unwrap();
        let r = read_file(&big.to_string_lossy()).await.unwrap();
        assert!(r.too_large && r.content.is_empty());
    }

    #[tokio::test]
    async fn writes_atomically_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("a.txt");
        std::fs::write(&f, "old").unwrap();
        write_file(&f.to_string_lossy(), "new content")
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "new content");
        // No temp file left behind.
        let leftover = tmp.path().join(".a.txt.uxnan-tmp");
        assert!(!leftover.exists());
    }
}
