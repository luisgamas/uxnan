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

/// Largest image the preview will inline as a `data:` URL (25 MiB). Past this we
/// refuse rather than base64-encode a huge blob into the webview.
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

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

/// A page of file-tree project-wide search results.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSearch {
    /// Matching files (absolute, forward-slash paths), sorted by path.
    pub entries: Vec<FsEntry>,
    /// The walk hit `limit` before exhausting the tree — results are a prefix and
    /// the user should narrow the query.
    pub truncated: bool,
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

/// Read a local **image** file and return it as an inline `data:<mime>;base64,…`
/// URL for the editor's image preview (multimodal file viewer). The MIME is
/// resolved from the extension ([`crate::git::image_mime`]) and, failing that,
/// sniffed from the leading magic bytes ([`sniff_image_mime`]); a file that is
/// neither is refused, so we never inline a non-image as one. Refuses anything
/// over [`MAX_IMAGE_BYTES`]. Reading in Rust (not the webview) keeps this working
/// regardless of the asset-protocol scope.
pub async fn read_data_url(path: &str) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    let meta = tokio::fs::metadata(path).await?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Invalid(
            "the image is too large to preview".into(),
        ));
    }
    let bytes = tokio::fs::read(path).await?;
    let mime = crate::git::image_mime(path)
        .or_else(|| sniff_image_mime(&bytes))
        .ok_or_else(|| AppError::Invalid(format!("{path} is not a recognized image")))?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(&bytes)))
}

/// Best-effort image-type detection from the leading magic bytes, for files whose
/// extension is missing or unknown. Shared by [`read_data_url`] and the URL
/// fetcher in [`crate::commands`].
pub(crate) fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        Some("image/svg+xml")
    } else {
        None
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

/// Split a user-entered relative path for VSCode-style intercalated creation
/// (`sub/dir/file.js`) into its validated segments. Each `/`-separated segment
/// must be a valid bare name — non-empty after trimming, never `.` / `..`, and
/// free of `\` — so the joined result can never escape the base directory (no
/// `..`, no absolute/`\`-rooted segment). A single trailing `/` is tolerated
/// (the caller may pass a folder path with a trailing separator). Returns at
/// least one segment.
fn split_new_entry_path(rel: &str) -> Result<Vec<&str>, AppError> {
    let rel = rel.trim();
    let body = rel.strip_suffix('/').unwrap_or(rel);
    if body.is_empty() {
        return Err(AppError::Invalid("the name is empty".into()));
    }
    let mut segments = Vec::new();
    for raw in body.split('/') {
        let seg = raw.trim();
        if seg.is_empty() || seg == "." || seg == ".." || seg.contains('\\') {
            return Err(AppError::Invalid(format!("\"{rel}\" is not a valid name")));
        }
        segments.push(seg);
    }
    Ok(segments)
}

/// Shared preflight for "New File" / "New Folder": validate `rel` (a bare name or
/// a VSCode-style intercalated relative path — see [`split_new_entry_path`]),
/// confirm `dir` is an existing directory, then create any intermediate
/// directories (mkdir -p style; existing folders are reused, an existing *file*
/// in the chain errors). The leaf must not already exist (no clobber). Returns
/// the leaf target path to create.
async fn prepare_new_entry(dir: &str, rel: &str) -> Result<PathBuf, AppError> {
    let segments = split_new_entry_path(rel)?;
    let base = PathBuf::from(dir);
    let meta = tokio::fs::metadata(&base)
        .await
        .map_err(|_| AppError::NotFound(format!("{dir} does not exist")))?;
    if !meta.is_dir() {
        return Err(AppError::Invalid(format!("{dir} is not a directory")));
    }
    // Create every parent segment (all but the leaf), reusing existing folders.
    let (leaf, parents) = segments.split_last().expect("at least one segment");
    let mut cur = base;
    for seg in parents {
        cur = cur.join(seg);
        match tokio::fs::metadata(&cur).await {
            Ok(m) if m.is_dir() => {}
            Ok(_) => {
                return Err(AppError::Invalid(format!(
                    "\"{seg}\" already exists and is not a folder"
                )))
            }
            Err(_) => tokio::fs::create_dir(&cur).await?,
        }
    }
    let target = cur.join(leaf);
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        return Err(AppError::Invalid(format!(
            "\"{leaf}\" already exists in this folder"
        )));
    }
    Ok(target)
}

/// Create a new, empty file at `path` inside directory `dir` (the file tree's
/// "New File"). `path` is a bare name or a VSCode-style intercalated relative path
/// (`sub/dir/file.js`) whose parent segments are created as folders; the leaf must
/// not already exist. Returns the new absolute, forward-slash-normalized path so
/// the caller can reveal/open it.
pub async fn create_file(dir: &str, path: &str) -> Result<String, AppError> {
    let target = prepare_new_entry(dir, path).await?;
    tokio::fs::File::create(&target).await?;
    Ok(normalize(&target))
}

/// Create a new empty directory at `path` inside `dir` (the file tree's "New
/// Folder"). `path` is a bare name or a VSCode-style intercalated relative path
/// (`sub/dir/leaf`) whose parent segments are created as folders; the leaf folder
/// must not already exist. Returns the new path.
pub async fn create_dir(dir: &str, path: &str) -> Result<String, AppError> {
    let target = prepare_new_entry(dir, path).await?;
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

/// Recursively search `root` for files whose worktree-relative path contains every
/// whitespace-separated token of `query` (case-insensitive substring; AND across
/// tokens). This backs the file tree's **project-wide** filename search — unlike the
/// lazy per-folder tree (`list_dir`), it walks the whole subtree. Uses the `ignore`
/// walker so it honors `.gitignore` (+ global excludes) and skips `.git`; dotfiles
/// are included only when `include_hidden`. Stops at `limit` matches, setting
/// `truncated`. Synchronous (blocking I/O) — call it from the blocking pool.
pub fn search_files(root: &str, query: &str, include_hidden: bool, limit: usize) -> FileSearch {
    let tokens: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    if tokens.is_empty() || limit == 0 {
        return FileSearch {
            entries: Vec::new(),
            truncated: false,
        };
    }

    let root_path = Path::new(root);
    let mut entries: Vec<FsEntry> = Vec::new();
    let mut truncated = false;

    let walker = ignore::WalkBuilder::new(root_path)
        .hidden(!include_hidden) // hide dotfiles unless the caller asks for them
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        // never descend git's own store (kept even when include_hidden shows dotfiles)
        .filter_entry(|e| e.file_name() != std::ffi::OsStr::new(".git"))
        .build();

    for dent in walker.flatten() {
        if dent.depth() == 0 {
            continue; // the root itself
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue; // surface files only
        }
        let path = dent.path();
        let rel = path.strip_prefix(root_path).unwrap_or(path);
        let rel_lower = rel.to_string_lossy().replace('\\', "/").to_lowercase();
        if !tokens.iter().all(|t| rel_lower.contains(t.as_str())) {
            continue;
        }
        entries.push(FsEntry {
            path: normalize(path),
            name: dent.file_name().to_string_lossy().to_string(),
            is_dir: false,
            ignored: false,
        });
        if entries.len() >= limit {
            truncated = true;
            break;
        }
    }

    entries.sort_by_key(|e| e.path.to_lowercase());
    FileSearch { entries, truncated }
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
    async fn reads_image_as_data_url_by_extension_and_by_sniff() {
        let tmp = tempfile::tempdir().unwrap();

        // MIME from the extension — the payload need not be a real PNG.
        let named = tmp.path().join("logo.png");
        std::fs::write(&named, [1u8, 2, 3, 4]).unwrap();
        let url = read_data_url(&named.to_string_lossy()).await.unwrap();
        assert!(url.starts_with("data:image/png;base64,"));

        // MIME sniffed from magic bytes when the extension is missing/unknown.
        let sniffed = tmp.path().join("noext");
        std::fs::write(&sniffed, [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        let url = read_data_url(&sniffed.to_string_lossy()).await.unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[tokio::test]
    async fn data_url_refuses_non_image_and_oversized() {
        let tmp = tempfile::tempdir().unwrap();

        // Plain text is neither by extension nor by magic bytes → refused.
        let txt = tmp.path().join("notes.txt");
        std::fs::write(&txt, b"just text").unwrap();
        assert!(read_data_url(&txt.to_string_lossy()).await.is_err());

        // Over the size cap → refused before any encoding (checked on metadata).
        let big = tmp.path().join("huge.png");
        std::fs::write(&big, vec![0u8; (MAX_IMAGE_BYTES + 1) as usize]).unwrap();
        assert!(read_data_url(&big.to_string_lossy()).await.is_err());
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

        // Intercalated paths create intermediate folders (VSCode-style): `a/b.txt`
        // makes folder `a` + file `b.txt`; `x/y/z` makes the nested folder chain.
        let nested = create_file(&dir, "a/b.txt").await.unwrap();
        assert!(nested.ends_with("/a/b.txt"));
        assert!(tmp.path().join("a").is_dir());
        assert!(tmp.path().join("a/b.txt").is_file());
        let deep = create_dir(&dir, "x/y/z").await.unwrap();
        assert!(deep.ends_with("/x/y/z"));
        assert!(tmp.path().join("x/y/z").is_dir());
        // An existing intermediate folder is reused (only the leaf is no-clobber).
        let reuse = create_file(&dir, "a/c.txt").await.unwrap();
        assert!(reuse.ends_with("/a/c.txt"));
        assert!(tmp.path().join("a/c.txt").is_file());
        // A trailing slash is tolerated (folder path with a separator).
        assert!(create_dir(&dir, "trailing/").await.is_ok());
        assert!(tmp.path().join("trailing").is_dir());

        // Traversal / empty segments / backslash are refused — never escape `dir`.
        assert!(create_file(&dir, "..").await.is_err());
        assert!(create_file(&dir, "../escape.txt").await.is_err());
        assert!(create_file(&dir, "a/../b.txt").await.is_err());
        assert!(create_file(&dir, "a//b.txt").await.is_err());
        assert!(create_dir(&dir, "  ").await.is_err());
        // An intermediate segment that is an existing *file* (not a folder) errors.
        assert!(create_file(&dir, "notes.txt/inner.txt").await.is_err());

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

    #[test]
    fn search_files_walks_recursively_and_matches_tokens() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src/deep/nested")).unwrap();
        std::fs::write(root.join("src/deep/nested/widget.rs"), b"x").unwrap();
        std::fs::write(root.join("src/main.rs"), b"x").unwrap();
        std::fs::write(root.join("README.md"), b"x").unwrap();
        let root_s = root.to_string_lossy();

        // Finds a file inside a folder the lazy tree would never have expanded.
        let r = search_files(&root_s, "widget", false, 100);
        assert!(!r.truncated);
        assert_eq!(r.entries.len(), 1);
        assert!(r.entries[0].path.ends_with("/src/deep/nested/widget.rs"));
        assert!(!r.entries[0].is_dir);

        // Multi-token AND matches against the relative path (dir + name).
        let r = search_files(&root_s, "deep rs", false, 100);
        assert_eq!(r.entries.len(), 1);
        assert!(r.entries[0].path.ends_with("/widget.rs"));

        // ".rs" hits both rust files; results are path-sorted.
        let r = search_files(&root_s, ".rs", false, 100);
        let paths: Vec<&str> = r.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths.len(), 2);
        assert!(paths[0] < paths[1]);

        // Empty query / zero limit → no walk, no results.
        assert!(search_files(&root_s, "   ", false, 100).entries.is_empty());
        assert!(search_files(&root_s, "rs", false, 0).entries.is_empty());
    }

    #[test]
    fn search_files_honors_gitignore_and_hidden_toggle() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // A `.git` dir makes the walker treat this as a repo so `.gitignore` applies.
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), b"ref: refs/heads/main\n").unwrap();
        std::fs::write(root.join(".gitignore"), b"ignored.log\n").unwrap();
        std::fs::write(root.join("ignored.log"), b"x").unwrap();
        std::fs::write(root.join("kept.log"), b"x").unwrap();
        std::fs::write(root.join(".secret.log"), b"x").unwrap(); // a dotfile
        let root_s = root.to_string_lossy();

        // Hidden off: gitignored + dotfiles excluded, git store never walked.
        let r = search_files(&root_s, ".log", false, 100);
        let names: Vec<&str> = r.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["kept.log"]);

        // include_hidden surfaces the dotfile but still respects .gitignore + skips .git.
        let r = search_files(&root_s, ".log", true, 100);
        let mut names: Vec<String> = r.entries.iter().map(|e| e.name.clone()).collect();
        names.sort();
        assert_eq!(names, [".secret.log", "kept.log"]);
    }

    #[test]
    fn search_files_truncates_at_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for i in 0..5 {
            std::fs::write(root.join(format!("file{i}.txt")), b"x").unwrap();
        }
        let r = search_files(&root.to_string_lossy(), ".txt", false, 3);
        assert!(r.truncated);
        assert_eq!(r.entries.len(), 3);
    }
}
