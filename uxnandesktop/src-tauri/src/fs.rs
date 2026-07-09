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

/// Validate that `name` is a usable *bare* file/directory name — never a path
/// fragment that could move or escape the target folder. Trims, then rejects an
/// empty name, any path separator, and the `.` / `..` specials. Returns the
/// trimmed name so callers operate on the cleaned value.
fn validate_bare_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("the name is empty".into()));
    }
    if name.contains('/') || name.contains('\\') || name == ".." || name == "." {
        return Err(AppError::Invalid(format!("\"{name}\" is not a valid name")));
    }
    Ok(name)
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

/// Rename a file (or directory) to `new_name`, keeping it in the same parent
/// directory. This is the real on-disk rename behind a file tab's "Rename"
/// action, so it deliberately refuses anything that could move or clobber a
/// file: `new_name` must be a bare file name (no `/`, `\`, or `..`), the source
/// must exist, and the destination must not already exist (case-sensitive-safe).
/// Returns the new absolute, forward-slash-normalized path so the caller can
/// re-point the open tab/editor at it.
pub async fn rename_path(path: &str, new_name: &str) -> Result<String, AppError> {
    let source = PathBuf::from(path);
    // A bare file name only — never a path fragment that could escape the folder.
    let new_name = validate_bare_name(new_name)?;
    if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
        return Err(AppError::NotFound(format!("{path} does not exist")));
    }
    let parent = source
        .parent()
        .ok_or_else(|| AppError::Invalid(format!("{path} has no parent directory")))?;
    let target = parent.join(new_name);
    // Refuse to overwrite an existing sibling — unless it's the same path under a
    // case-only rename (e.g. `Readme.md` → `README.md` on a case-insensitive FS).
    if target != source && tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return Err(AppError::Invalid(format!(
            "\"{new_name}\" already exists in this folder"
        )));
    }
    tokio::fs::rename(&source, &target).await?;
    Ok(normalize(&target))
}

/// Shared preflight for "New File" / "New Folder": validate the bare `name`,
/// confirm `dir` is an existing directory, and confirm nothing named `name` is
/// already there. Returns the target path to create.
async fn prepare_new_entry(dir: &str, name: &str) -> Result<PathBuf, AppError> {
    let name = validate_bare_name(name)?;
    let base = PathBuf::from(dir);
    let meta = tokio::fs::metadata(&base)
        .await
        .map_err(|_| AppError::NotFound(format!("{dir} does not exist")))?;
    if !meta.is_dir() {
        return Err(AppError::Invalid(format!("{dir} is not a directory")));
    }
    let target = base.join(name);
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return Err(AppError::Invalid(format!(
            "\"{name}\" already exists in this folder"
        )));
    }
    Ok(target)
}

/// Create a new, empty file `name` inside directory `dir` (the file tree's "New
/// File"). `name` must be a bare name and must not already exist. Returns the new
/// absolute, forward-slash-normalized path so the caller can reveal/open it.
pub async fn create_file(dir: &str, name: &str) -> Result<String, AppError> {
    let target = prepare_new_entry(dir, name).await?;
    tokio::fs::File::create(&target).await?;
    Ok(normalize(&target))
}

/// Create a new empty directory `name` inside `dir` (the file tree's "New
/// Folder"). Only the single leaf is created (`name` is a bare name, so no
/// intermediate components), never clobbering an existing entry.
pub async fn create_dir(dir: &str, name: &str) -> Result<String, AppError> {
    let target = prepare_new_entry(dir, name).await?;
    tokio::fs::create_dir(&target).await?;
    Ok(normalize(&target))
}

/// Safety preflight for a delete: the path must be non-empty, must exist, and must
/// have a parent directory — so a filesystem root (`/`, `C:\`) can never be
/// deleted even if the frontend is coerced into passing one. Returns the resolved
/// path. Split out from [`delete_to_trash`] so the guard is unit-testable without
/// actually trashing anything.
pub async fn check_deletable(path: &str) -> Result<PathBuf, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Invalid("no path to delete".into()));
    }
    let target = PathBuf::from(path);
    if target.parent().is_none() {
        return Err(AppError::Invalid(format!(
            "refusing to delete the filesystem root {path}"
        )));
    }
    if !tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return Err(AppError::NotFound(format!("{path} does not exist")));
    }
    Ok(target)
}

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

/// Build a unique "copy" name for `file_name` in a folder: `name copy.ext`, then
/// `name copy 2.ext`, `name copy 3.ext`, … until `exists(candidate)` is false. The
/// extension is split on the final dot so it's preserved (a leading-dot dotfile
/// like `.env` is treated as having no extension). Pure — the collision check is
/// injected — so it's directly testable.
fn unique_copy_name(file_name: &str, exists: impl Fn(&str) -> bool) -> String {
    let dot = file_name.rfind('.').filter(|&i| i > 0);
    let (stem, ext) = match dot {
        Some(i) => (&file_name[..i], &file_name[i..]), // `ext` includes the leading dot
        None => (file_name, ""),
    };
    let mut candidate = format!("{stem} copy{ext}");
    let mut n = 2;
    while exists(&candidate) {
        candidate = format!("{stem} copy {n}{ext}");
        n += 1;
    }
    candidate
}

/// Duplicate a single file next to itself under a unique "… copy" name (the file
/// tree's "Duplicate"). Directories are refused — a recursive copy is a heavier,
/// separate concern. Returns the new absolute, forward-slash-normalized path.
pub async fn duplicate_file(path: &str) -> Result<String, AppError> {
    let source = PathBuf::from(path);
    let meta = tokio::fs::metadata(&source)
        .await
        .map_err(|_| AppError::NotFound(format!("{path} does not exist")))?;
    if meta.is_dir() {
        return Err(AppError::Invalid("only files can be duplicated".into()));
    }
    let parent = source
        .parent()
        .ok_or_else(|| AppError::Invalid(format!("{path} has no parent directory")))?;
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Invalid(format!("{path} has no file name")))?;
    let target = parent.join(unique_copy_name(&file_name, |candidate| {
        parent.join(candidate).exists()
    }));
    tokio::fs::copy(&source, &target).await?;
    Ok(normalize(&target))
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

    #[tokio::test]
    async fn renames_within_folder_and_guards_bad_input() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.txt");
        std::fs::write(&a, "x").unwrap();

        // Happy path: renamed in place, new normalized path returned.
        let new_path = rename_path(&a.to_string_lossy(), "b.md").await.unwrap();
        assert!(new_path.ends_with("/b.md"));
        assert!(!a.exists());
        assert!(tmp.path().join("b.md").exists());

        // Path separators / traversal are refused (never move out of the folder).
        assert!(rename_path(&new_path, "sub/c.txt").await.is_err());
        assert!(rename_path(&new_path, "../c.txt").await.is_err());
        assert!(rename_path(&new_path, "  ").await.is_err());

        // Clobbering an existing sibling is refused.
        std::fs::write(tmp.path().join("taken.txt"), "y").unwrap();
        assert!(rename_path(&new_path, "taken.txt").await.is_err());

        // A missing source errors instead of silently succeeding.
        assert!(
            rename_path(&tmp.path().join("nope.txt").to_string_lossy(), "z.txt")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn creates_file_and_folder_guarding_bad_input() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();

        // Happy paths: file + folder land in `dir`, normalized paths returned.
        let f = create_file(&dir, "notes.txt").await.unwrap();
        assert!(f.ends_with("/notes.txt"));
        assert!(tmp.path().join("notes.txt").is_file());
        let d = create_dir(&dir, "sub").await.unwrap();
        assert!(d.ends_with("/sub"));
        assert!(tmp.path().join("sub").is_dir());

        // Clobbering an existing entry is refused (either kind).
        assert!(create_file(&dir, "notes.txt").await.is_err());
        assert!(create_dir(&dir, "sub").await.is_err());

        // Path separators / traversal / empties are refused — never escape `dir`.
        assert!(create_file(&dir, "a/b.txt").await.is_err());
        assert!(create_file(&dir, "..").await.is_err());
        assert!(create_dir(&dir, "  ").await.is_err());

        // A missing parent directory errors instead of creating anything.
        let missing = tmp.path().join("nope").to_string_lossy().to_string();
        assert!(create_file(&missing, "x.txt").await.is_err());
    }

    #[tokio::test]
    async fn check_deletable_guards_root_empty_and_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("a.txt");
        std::fs::write(&f, "x").unwrap();

        // A real, non-root path passes and resolves.
        let ok = check_deletable(&f.to_string_lossy()).await.unwrap();
        assert_eq!(ok, f);

        // Empty, missing, and filesystem-root paths are all refused.
        assert!(check_deletable("   ").await.is_err());
        assert!(check_deletable(&tmp.path().join("ghost").to_string_lossy())
            .await
            .is_err());
        let root = if cfg!(windows) { "C:\\" } else { "/" };
        assert!(check_deletable(root).await.is_err());
    }

    #[test]
    fn unique_copy_name_preserves_extension_and_increments() {
        // First copy, then numbered copies once the earlier ones are taken.
        let taken: std::collections::HashSet<&str> =
            ["report copy.md", "report copy 2.md"].into_iter().collect();
        assert_eq!(unique_copy_name("fresh.md", |_| false), "fresh copy.md");
        assert_eq!(
            unique_copy_name("report.md", |c| taken.contains(c)),
            "report copy 3.md"
        );
        // No extension / dotfiles: the whole name is the stem.
        assert_eq!(unique_copy_name("Makefile", |_| false), "Makefile copy");
        assert_eq!(unique_copy_name(".env", |_| false), ".env copy");
    }

    #[tokio::test]
    async fn duplicates_file_with_unique_names_refusing_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("data.json");
        std::fs::write(&a, "{}").unwrap();

        // First duplicate → "… copy", contents preserved.
        let c1 = duplicate_file(&a.to_string_lossy()).await.unwrap();
        assert!(c1.ends_with("/data copy.json"));
        assert_eq!(std::fs::read_to_string(&c1).unwrap(), "{}");
        // Second duplicate of the same source → numbered, never clobbering.
        let c2 = duplicate_file(&a.to_string_lossy()).await.unwrap();
        assert!(c2.ends_with("/data copy 2.json"));
        assert!(tmp.path().join("data copy.json").is_file());

        // Directories are refused; a missing source errors.
        std::fs::create_dir(tmp.path().join("folder")).unwrap();
        assert!(duplicate_file(&tmp.path().join("folder").to_string_lossy())
            .await
            .is_err());
        assert!(
            duplicate_file(&tmp.path().join("nope.txt").to_string_lossy())
                .await
                .is_err()
        );
    }
}
