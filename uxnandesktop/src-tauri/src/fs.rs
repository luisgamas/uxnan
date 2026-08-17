//! Filesystem access backing the right-panel **file-tree** tab and the center
//! **file editor**.
//!
//! The git review surface (`git.rs`) only sees *changed* files; this module lets
//! the UI browse the full working tree of the active worktree/project, lazily one
//! directory at a time (so huge trees like `node_modules` never load until
//! expanded), and read/write a single text file from the editor. Like
//! [`crate::browse`], this is the user's own machine, so access is not confined.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Largest file the editor will open (2 MiB). Past this we refuse to load the
/// content (so the webview never chokes on a giant/minified file) and the UI
/// shows a "too large to edit" notice instead.
pub(crate) const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// Largest image/PDF the preview will inline as a `data:` URL (25 MiB). Past
/// this we refuse rather than base64-encode a huge blob into the webview.
/// Shared with the host reader (`ssh::sftp::RemoteFiles::read_data_url`) so a
/// file previews — or is refused — identically on either machine.
pub(crate) const MAX_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;

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

/// Largest file [`search_content`] will read. Matches [`MAX_EDIT_BYTES`] on
/// purpose: a file the editor refuses to open is not one the user can act on
/// from a search hit either.
const MAX_SEARCH_BYTES: u64 = MAX_EDIT_BYTES;

/// Bytes sniffed for a NUL before deciding a file is binary and skipping it.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// Matches reported per file before that file's list is cut (`truncated`). Keeps
/// one generated/minified file from crowding out the rest of the results.
pub(crate) const MAX_MATCHES_PER_FILE: usize = 50;

/// Characters of a matching line sent to the UI. A longer line is windowed
/// around the match (see [`ContentMatch::elided`]) so a minified bundle still
/// yields a readable snippet.
const MAX_SNIPPET_CHARS: usize = 400;

/// Characters of leading context kept when a match sits past [`MAX_SNIPPET_CHARS`].
const SNIPPET_LEAD_CHARS: usize = 40;

/// Include/exclude glob filters shared by both project-wide searches.
///
/// Each field is a comma-separated list of patterns, VSCode-style. A pattern with
/// no `/` matches the file **name** (`*.ts`); one with a `/` matches the
/// worktree-relative **path** (`src/**/*.ts`). A bare name with no glob
/// metacharacters (`docs`, `node_modules`) also matches everything **under** a
/// folder of that name, which is what a user typing a folder name means. Matching
/// is case-insensitive so `*.TS` and `*.ts` behave the same on every platform.
/// Empty fields mean "no filter".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    /// Only files matching one of these patterns are searched (empty = all).
    #[serde(default)]
    pub include: String,
    /// Files matching one of these patterns are skipped (applied after `include`).
    #[serde(default)]
    pub exclude: String,
}

/// One matching line inside a file.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    /// 1-based line number, for "go to line" when the hit is opened.
    pub line: u32,
    /// The line's text, capped at [`MAX_SNIPPET_CHARS`] and windowed around the
    /// match when the line is longer.
    pub text: String,
    /// Offset of the match inside `text`, in UTF-16 code units so the frontend can
    /// `slice()` it directly (JavaScript string indices are UTF-16).
    pub start: u32,
    /// End offset of the match inside `text` (UTF-16 code units).
    pub end: u32,
    /// `text` starts mid-line — the UI renders a leading ellipsis.
    pub elided: bool,
}

/// Every match found in one file.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentFileMatch {
    /// Absolute, forward-slash path.
    pub path: String,
    pub name: String,
    pub matches: Vec<ContentMatch>,
    /// The file had more than [`MAX_MATCHES_PER_FILE`] matches; `matches` is a prefix.
    pub truncated: bool,
}

/// A page of project-wide **content** search results.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearch {
    /// Files with at least one match, sorted by path.
    pub files: Vec<ContentFileMatch>,
    /// Total matches carried in `files`.
    pub total: u32,
    /// The walk stopped at `limit` — results are a prefix, narrow the search.
    pub truncated: bool,
}

/// Compile one comma-separated pattern list into a [`globset::GlobSet`], or
/// `None` when the list is empty (meaning "no filter" — never "match nothing").
/// See [`SearchFilters`] for the pattern rules. An unparsable pattern is skipped
/// rather than failing the whole search: the user is typing it live, and a
/// half-written glob should narrow nothing, not blank the results.
fn build_glob_set(patterns: &str) -> Option<globset::GlobSet> {
    let mut builder = globset::GlobSetBuilder::new();
    let mut any = false;
    for raw in patterns.split(',') {
        let pat = raw.trim().replace('\\', "/");
        if pat.is_empty() {
            continue;
        }
        // A trailing slash, a bare folder name, or a plain name all expand to the
        // forms a user means by them; anything else is used as written.
        let mut forms: Vec<String> = Vec::new();
        if let Some(stripped) = pat.strip_suffix('/') {
            forms.push(format!("{stripped}/**"));
        } else if !pat.contains('/') {
            forms.push(format!("**/{pat}"));
            if !pat.contains(['*', '?', '[', '{']) {
                forms.push(format!("**/{pat}/**")); // `docs` also means "inside docs"
            }
        } else {
            forms.push(pat.clone());
            if !pat.contains(['*', '?', '[', '{']) {
                forms.push(format!("{pat}/**"));
            }
        }
        for form in forms {
            if let Ok(glob) = globset::GlobBuilder::new(&form)
                .literal_separator(true) // `*` must not cross a path separator
                .case_insensitive(true)
                .build()
            {
                builder.add(glob);
                any = true;
            }
        }
    }
    if !any {
        return None;
    }
    builder.build().ok()
}

/// The include/exclude test both searches apply to a worktree-relative path.
pub(crate) struct CompiledFilters {
    include: Option<globset::GlobSet>,
    exclude: Option<globset::GlobSet>,
}

impl CompiledFilters {
    pub(crate) fn new(filters: &SearchFilters) -> Self {
        Self {
            include: build_glob_set(&filters.include),
            exclude: build_glob_set(&filters.exclude),
        }
    }
    /// Whether `rel` (worktree-relative, forward-slash) survives the filters.
    pub(crate) fn allows(&self, rel: &str) -> bool {
        if let Some(inc) = &self.include {
            if !inc.is_match(rel) {
                return false;
            }
        }
        if let Some(exc) = &self.exclude {
            if exc.is_match(rel) {
                return false;
            }
        }
        true
    }
}

/// Shared `ignore` walker for both project-wide searches: honors `.gitignore`
/// (+ global/exclude files), never descends `.git`, and hides dotfiles unless
/// `include_hidden`.
fn search_walker(root: &Path, include_hidden: bool) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(!include_hidden) // hide dotfiles unless the caller asks for them
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        // never descend git's own store (kept even when include_hidden shows dotfiles)
        .filter_entry(|e| e.file_name() != std::ffi::OsStr::new(".git"));
    builder
}

/// `path` relative to `root`, forward-slash normalized (falls back to the full
/// path when it is not under `root`).
fn rel_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Validate that `name` is a usable *bare* file/directory name — never a path
/// fragment that could move or escape the target folder. Trims, then rejects an
/// empty name, any path separator, and the `.` / `..` specials. Returns the
/// trimmed name so callers operate on the cleaned value.
pub(crate) fn validate_bare_name(name: &str) -> Result<&str, AppError> {
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

/// Read a local previewable file and return it as an inline
/// `data:<mime>;base64,…` URL. Known images and PDF documents are accepted by
/// extension or magic bytes; every other type is refused. Reading in Rust (not
/// the webview) keeps this working regardless of the asset-protocol scope.
pub async fn read_data_url(path: &str) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    let meta = tokio::fs::metadata(path).await?;
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err(AppError::Invalid("the file is too large to preview".into()));
    }
    let bytes = tokio::fs::read(path).await?;
    let mime = preview_mime(path, &bytes)
        .ok_or_else(|| AppError::Invalid(format!("{path} is not a recognized image or PDF")))?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(&bytes)))
}

/// The MIME type a previewable file should be inlined as, or `None` when it is
/// neither a known image nor a PDF. Shared with the host reader so the same file
/// is recognized (or refused) wherever it lives.
pub(crate) fn preview_mime(path: &str, bytes: &[u8]) -> Option<&'static str> {
    crate::git::image_mime(path)
        .or_else(|| {
            path.rsplit_once('.')
                .filter(|(_, ext)| ext.eq_ignore_ascii_case("pdf"))
                .map(|_| "application/pdf")
        })
        .or_else(|| sniff_image_mime(bytes))
        .or_else(|| bytes.starts_with(b"%PDF-").then_some("application/pdf"))
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
pub(crate) fn split_new_entry_path(rel: &str) -> Result<Vec<&str>, AppError> {
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
/// are included only when `include_hidden`, and `filters` narrows by include/exclude
/// globs. Stops at `limit` matches, setting `truncated`. Synchronous (blocking I/O) —
/// call it from the blocking pool.
pub fn search_files(
    root: &str,
    query: &str,
    include_hidden: bool,
    filters: &SearchFilters,
    limit: usize,
) -> FileSearch {
    let tokens: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    if tokens.is_empty() || limit == 0 {
        return FileSearch {
            entries: Vec::new(),
            truncated: false,
        };
    }

    let root_path = Path::new(root);
    let globs = CompiledFilters::new(filters);
    let mut entries: Vec<FsEntry> = Vec::new();
    let mut truncated = false;

    for dent in search_walker(root_path, include_hidden).build().flatten() {
        if dent.depth() == 0 {
            continue; // the root itself
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue; // surface files only
        }
        let path = dent.path();
        let rel = rel_of(root_path, path);
        if !globs.allows(&rel) {
            continue;
        }
        let rel_lower = rel.to_lowercase();
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

/// What the user typed in the content-search box, with its three match modes.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentQuery {
    pub query: String,
    /// Off by default — a search box is expected to ignore case.
    #[serde(default)]
    pub case_sensitive: bool,
    /// Match only at word boundaries.
    #[serde(default)]
    pub whole_word: bool,
    /// Treat `query` as a regular expression instead of literal text.
    #[serde(default)]
    pub is_regex: bool,
}

/// Compile a [`ContentQuery`] into one regex. A literal query is escaped (so
/// `a.b` means `a.b`, not "a, any char, b"); `whole_word` wraps it in word
/// boundaries; `is_regex` passes it through as written. Returns the user-facing
/// error for an unparsable pattern, so the UI can show it under the input.
pub(crate) fn build_content_regex(q: &ContentQuery) -> Result<regex::Regex, AppError> {
    let base = if q.is_regex {
        q.query.clone()
    } else {
        regex::escape(&q.query)
    };
    let pattern = if q.whole_word {
        format!(r"\b(?:{base})\b")
    } else {
        base
    };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!q.case_sensitive)
        // A content search is line-oriented; a `.` must not swallow the rest of
        // the file, and a multi-line pattern would break the line/column report.
        .multi_line(true)
        .size_limit(1 << 22) // reject a pathologically large compiled program
        .build()
        .map_err(|e| AppError::Invalid(format!("invalid search pattern: {e}")))
}

/// Number of UTF-16 code units in `s` — the unit JavaScript string offsets use.
fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Build the snippet the UI shows for one match: the whole line when it is short
/// enough, otherwise a window around the match. Offsets come back in UTF-16 code
/// units, relative to the returned text.
pub(crate) fn snippet_for(line: &str, m_start: usize, m_end: usize) -> ContentMatch {
    // Character (not byte) positions, so a window never splits a multi-byte char.
    let char_start = line[..m_start].chars().count();
    let char_len = line[m_start..m_end].chars().count();
    let total_chars = line.chars().count();

    let (window_start, elided) =
        if total_chars <= MAX_SNIPPET_CHARS || char_start + char_len <= MAX_SNIPPET_CHARS {
            (0, false)
        } else {
            (char_start.saturating_sub(SNIPPET_LEAD_CHARS), true)
        };

    let text: String = line
        .chars()
        .skip(window_start)
        .take(MAX_SNIPPET_CHARS)
        .collect();
    // Re-derive the offsets against the emitted text, in UTF-16 units.
    let rel_char_start = char_start - window_start;
    let prefix: String = text.chars().take(rel_char_start).collect();
    let matched: String = text.chars().skip(rel_char_start).take(char_len).collect();
    let start = utf16_len(&prefix);
    ContentMatch {
        line: 0, // filled in by the caller
        start,
        end: start + utf16_len(&matched),
        text,
        elided,
    }
}

/// Find every match of `re` in `text`, at most [`MAX_MATCHES_PER_FILE`]. Returns
/// the matches plus whether the file had more. Empty matches (a regex like `^`)
/// are skipped: they would report a hit on every line while highlighting nothing.
fn matches_in_text(text: &str, re: &regex::Regex) -> (Vec<ContentMatch>, bool) {
    let mut out: Vec<ContentMatch> = Vec::new();
    for (i, line) in text.lines().enumerate() {
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            if out.len() >= MAX_MATCHES_PER_FILE {
                return (out, true);
            }
            let mut snippet = snippet_for(line, m.start(), m.end());
            snippet.line = (i + 1) as u32; // 1-based, for "go to line"
            out.push(snippet);
        }
    }
    (out, false)
}

/// Read a file for content search, or `None` when it should be skipped: too large
/// ([`MAX_SEARCH_BYTES`]), unreadable, or binary (a NUL in the first
/// [`BINARY_SNIFF_BYTES`], the same test the editor applies). Invalid UTF-8 is
/// read lossily rather than skipped, so a file with a stray byte still matches.
fn read_searchable(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_SEARCH_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let sniff = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff].contains(&0) {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Recursively search the **content** of the files under `root` for `query` (text
/// plus its match modes — see [`ContentQuery`]), backing the file tree's content
/// search. Walks with the same `ignore` rules as [`search_files`] (gitignore-aware,
/// `.git` skipped, dotfiles behind `include_hidden`, narrowed by `filters`), then
/// reads each candidate and reports the matching lines with 1-based line numbers so
/// a hit can be opened in place.
///
/// Binary, oversized and unreadable files are skipped silently. The walk stops
/// once `limit` total matches are collected (`truncated`), and each file
/// contributes at most [`MAX_MATCHES_PER_FILE`]. Multi-threaded (ripgrep's
/// parallel walker) and blocking — call it from the blocking pool. Returns an
/// error only for an unparsable pattern.
pub fn search_content(
    root: &str,
    query: &ContentQuery,
    include_hidden: bool,
    filters: &SearchFilters,
    limit: usize,
) -> Result<ContentSearch, AppError> {
    if query.query.is_empty() || limit == 0 {
        return Ok(ContentSearch {
            files: Vec::new(),
            total: 0,
            truncated: false,
        });
    }
    let re = build_content_regex(query)?;

    let root_path = Path::new(root).to_path_buf();
    let globs = Arc::new(CompiledFilters::new(filters));
    // One lock around the shared accumulator: the walker's threads only take it
    // after the (far more expensive) read + match of a whole file.
    let state = Arc::new(Mutex::new((Vec::<ContentFileMatch>::new(), 0usize, false)));

    search_walker(&root_path, include_hidden)
        .build_parallel()
        .run(|| {
            let state = Arc::clone(&state);
            let globs = Arc::clone(&globs);
            let re = re.clone();
            let root_path = root_path.clone();
            Box::new(move |result| {
                let Ok(dent) = result else {
                    return ignore::WalkState::Continue;
                };
                if dent.depth() == 0 || !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    return ignore::WalkState::Continue;
                }
                // Cheap pre-checks before touching the disk.
                if !globs.allows(&rel_of(&root_path, dent.path())) {
                    return ignore::WalkState::Continue;
                }
                if state.lock().map(|s| s.2).unwrap_or(true) {
                    return ignore::WalkState::Quit; // another thread hit the cap
                }
                let Some(text) = read_searchable(dent.path()) else {
                    return ignore::WalkState::Continue;
                };
                let (mut matches, mut file_truncated) = matches_in_text(&text, &re);
                if matches.is_empty() {
                    return ignore::WalkState::Continue;
                }
                let Ok(mut guard) = state.lock() else {
                    return ignore::WalkState::Quit;
                };
                let (files, total, hit_cap) = &mut *guard;
                if *hit_cap {
                    return ignore::WalkState::Quit;
                }
                // Honor the global cap even mid-file, so a huge result set can't blow
                // past `limit` by however many matches the last file happened to have.
                let room = limit.saturating_sub(*total);
                if matches.len() >= room {
                    matches.truncate(room);
                    file_truncated = true;
                    *hit_cap = true;
                }
                *total += matches.len();
                files.push(ContentFileMatch {
                    path: normalize(dent.path()),
                    name: dent.file_name().to_string_lossy().to_string(),
                    matches,
                    truncated: file_truncated,
                });
                if *hit_cap {
                    ignore::WalkState::Quit
                } else {
                    ignore::WalkState::Continue
                }
            })
        });

    // Every walker thread has been joined by `run`, so this lock is uncontended.
    let (mut files, total, truncated) = {
        let mut guard = state.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *guard)
    };
    files.sort_by_key(|f| f.path.to_lowercase());
    Ok(ContentSearch {
        files,
        total: total as u32,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The "search everything" filter set — most tests aren't about narrowing.
    fn no_filters() -> SearchFilters {
        SearchFilters::default()
    }

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
    async fn reads_preview_data_url_by_extension_and_by_sniff() {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

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

        let pdf = tmp.path().join("guide.PDF");
        std::fs::write(&pdf, b"%PDF-1.7\n").unwrap();
        let url = read_data_url(&pdf.to_string_lossy()).await.unwrap();
        assert!(url.starts_with("data:application/pdf;base64,"));

        let sniffed_pdf = tmp.path().join("document");
        std::fs::write(&sniffed_pdf, b"%PDF-1.4\n").unwrap();
        let url = read_data_url(&sniffed_pdf.to_string_lossy()).await.unwrap();
        assert!(url.starts_with("data:application/pdf;base64,"));

        // Animated images are passed through byte-for-byte, never decoded into
        // a still frame. The browser remains responsible for animation.
        let gif_bytes = b"GIF89a\x01\x00\x01\x00frame-one-frame-two;";
        let gif = tmp.path().join("demo.gif");
        std::fs::write(&gif, gif_bytes).unwrap();
        let url = read_data_url(&gif.to_string_lossy()).await.unwrap();
        assert_eq!(
            url,
            format!("data:image/gif;base64,{}", BASE64.encode(gif_bytes))
        );
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
        std::fs::write(&big, vec![0u8; (MAX_PREVIEW_BYTES + 1) as usize]).unwrap();
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
        let r = search_files(&root_s, "widget", false, &no_filters(), 100);
        assert!(!r.truncated);
        assert_eq!(r.entries.len(), 1);
        assert!(r.entries[0].path.ends_with("/src/deep/nested/widget.rs"));
        assert!(!r.entries[0].is_dir);

        // Multi-token AND matches against the relative path (dir + name).
        let r = search_files(&root_s, "deep rs", false, &no_filters(), 100);
        assert_eq!(r.entries.len(), 1);
        assert!(r.entries[0].path.ends_with("/widget.rs"));

        // ".rs" hits both rust files; results are path-sorted.
        let r = search_files(&root_s, ".rs", false, &no_filters(), 100);
        let paths: Vec<&str> = r.entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths.len(), 2);
        assert!(paths[0] < paths[1]);

        // Empty query / zero limit → no walk, no results.
        assert!(search_files(&root_s, "   ", false, &no_filters(), 100)
            .entries
            .is_empty());
        assert!(search_files(&root_s, "rs", false, &no_filters(), 0)
            .entries
            .is_empty());
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
        let r = search_files(&root_s, ".log", false, &no_filters(), 100);
        let names: Vec<&str> = r.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["kept.log"]);

        // include_hidden surfaces the dotfile but still respects .gitignore + skips .git.
        let r = search_files(&root_s, ".log", true, &no_filters(), 100);
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
        let r = search_files(&root.to_string_lossy(), ".txt", false, &no_filters(), 3);
        assert!(r.truncated);
        assert_eq!(r.entries.len(), 3);
    }

    // --- Search filters (shared by both project-wide searches) ---------------

    /// A tree with the same name in two folders, for the include/exclude tests.
    fn filter_tree() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src/ui")).unwrap();
        std::fs::create_dir_all(root.join("dist")).unwrap();
        std::fs::create_dir_all(root.join("docs/guide")).unwrap();
        std::fs::write(root.join("src/ui/panel.ts"), b"needle here").unwrap();
        std::fs::write(root.join("src/ui/panel.css"), b"needle here").unwrap();
        std::fs::write(root.join("dist/panel.ts"), b"needle here").unwrap();
        std::fs::write(root.join("docs/guide/panel.md"), b"needle here").unwrap();
        tmp
    }

    /// The last two path segments of each hit ("folder/name"), sorted — enough to
    /// tell `src/ui/panel.ts` from `dist/panel.ts` without the temp-dir prefix.
    fn names_of(r: &FileSearch) -> Vec<String> {
        let mut v: Vec<String> = r
            .entries
            .iter()
            .map(|e| {
                let mut tail: Vec<&str> = e.path.rsplit('/').take(2).collect();
                tail.reverse();
                tail.join("/")
            })
            .collect();
        v.sort();
        v
    }

    #[test]
    fn glob_filters_narrow_by_name_path_and_folder() {
        let tmp = filter_tree();
        let root_s = tmp.path().to_string_lossy();

        // A pattern with no `/` matches the file name, anywhere in the tree.
        let f = SearchFilters {
            include: "*.ts".into(),
            exclude: String::new(),
        };
        assert_eq!(
            names_of(&search_files(&root_s, "panel", false, &f, 100)),
            ["dist/panel.ts", "ui/panel.ts"]
        );

        // A pattern with a `/` matches the relative path.
        let f = SearchFilters {
            include: "src/**/*.ts".into(),
            exclude: String::new(),
        };
        assert_eq!(
            names_of(&search_files(&root_s, "panel", false, &f, 100)),
            ["ui/panel.ts"]
        );

        // A bare folder name means "everything under it", for include and exclude.
        let f = SearchFilters {
            include: "docs".into(),
            exclude: String::new(),
        };
        assert_eq!(
            names_of(&search_files(&root_s, "panel", false, &f, 100)),
            ["guide/panel.md"]
        );
        let f = SearchFilters {
            include: String::new(),
            exclude: "dist, docs".into(),
        };
        assert_eq!(
            names_of(&search_files(&root_s, "panel", false, &f, 100)),
            ["ui/panel.css", "ui/panel.ts"]
        );

        // Exclude wins over include, and matching is case-insensitive.
        let f = SearchFilters {
            include: "*.TS".into(),
            exclude: "dist/**".into(),
        };
        assert_eq!(
            names_of(&search_files(&root_s, "panel", false, &f, 100)),
            ["ui/panel.ts"]
        );

        // An unparsable pattern is ignored rather than blanking the results.
        let f = SearchFilters {
            include: "[unclosed".into(),
            exclude: String::new(),
        };
        assert_eq!(
            search_files(&root_s, "panel", false, &f, 100).entries.len(),
            4
        );
    }

    // --- Content search ------------------------------------------------------

    /// A plain literal, case-insensitive content search — the default modes.
    fn text_query(query: &str) -> ContentQuery {
        ContentQuery {
            query: query.into(),
            ..ContentQuery::default()
        }
    }

    fn search_text(root: &str, query: &str) -> ContentSearch {
        search_content(root, &text_query(query), false, &no_filters(), 100).unwrap()
    }

    #[test]
    fn search_content_reports_lines_and_offsets() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join("src/a.rs"),
            b"let x = 1;\nlet needle = 2;\nlet y = 3;\nneedle again\n",
        )
        .unwrap();
        std::fs::write(root.join("b.txt"), b"nothing to see\n").unwrap();
        let root_s = root.to_string_lossy();

        let r = search_text(&root_s, "needle");
        assert!(!r.truncated);
        assert_eq!(r.total, 2);
        assert_eq!(r.files.len(), 1);
        let f = &r.files[0];
        assert!(f.path.ends_with("/src/a.rs"));
        assert_eq!(f.name, "a.rs");
        // 1-based line numbers, so a hit can be opened at its line.
        assert_eq!(f.matches[0].line, 2);
        assert_eq!(f.matches[1].line, 4);
        // The snippet is the whole line, and the offsets slice the match out of it.
        assert_eq!(f.matches[0].text, "let needle = 2;");
        let m = &f.matches[0];
        let sliced: String = m
            .text
            .chars()
            .skip(m.start as usize)
            .take((m.end - m.start) as usize)
            .collect();
        assert_eq!(sliced, "needle");
        assert!(!m.elided);
    }

    #[test]
    fn search_content_honors_case_word_and_regex_modes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("a.txt"), b"Needle\nneedles\nneedle\na.b\naxb\n").unwrap();
        let root_s = root.to_string_lossy();
        let count = |q: &str, case: bool, word: bool, rx: bool| {
            let query = ContentQuery {
                query: q.into(),
                case_sensitive: case,
                whole_word: word,
                is_regex: rx,
            };
            search_content(&root_s, &query, false, &no_filters(), 100)
                .unwrap()
                .total
        };

        // Case-insensitive by default; case-sensitive drops the capitalized line.
        assert_eq!(count("needle", false, false, false), 3);
        assert_eq!(count("needle", true, false, false), 2);
        // Whole word drops "needles".
        assert_eq!(count("needle", true, true, false), 1);
        // A literal query escapes regex metacharacters — `a.b` is not "a<any>b".
        assert_eq!(count("a.b", false, false, false), 1);
        assert_eq!(count("a.b", false, false, true), 2);
        // An unparsable regex is a user-facing error, not a panic.
        let bad = ContentQuery {
            query: "a(".into(),
            is_regex: true,
            ..ContentQuery::default()
        };
        assert!(search_content(&root_s, &bad, false, &no_filters(), 100).is_err());
    }

    #[test]
    fn search_content_skips_binary_and_oversized_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("text.txt"), b"needle\n").unwrap();
        std::fs::write(root.join("blob.bin"), b"needle\0binary\n").unwrap();
        let mut huge = vec![b'.'; (MAX_SEARCH_BYTES + 1) as usize];
        huge.extend_from_slice(b"needle");
        std::fs::write(root.join("huge.txt"), &huge).unwrap();

        let r = search_text(&root.to_string_lossy(), "needle");
        let names: Vec<&str> = r.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["text.txt"]);
    }

    #[test]
    fn search_content_windows_long_lines_around_the_match() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // A minified-style line with the match far past the snippet cap.
        let line = format!("{}needle{}", "x".repeat(2000), "y".repeat(2000));
        std::fs::write(root.join("min.js"), line.as_bytes()).unwrap();

        let r = search_text(&root.to_string_lossy(), "needle");
        let m = &r.files[0].matches[0];
        assert!(m.elided, "a windowed snippet flags its elided start");
        assert!(m.text.chars().count() <= MAX_SNIPPET_CHARS);
        // The offsets still slice the match out of the *windowed* text.
        let sliced: String = m
            .text
            .chars()
            .skip(m.start as usize)
            .take((m.end - m.start) as usize)
            .collect();
        assert_eq!(sliced, "needle");
    }

    #[test]
    fn search_content_offsets_are_utf16_units() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // An emoji is 2 UTF-16 units (and 4 bytes) — the frontend slices in UTF-16.
        std::fs::write(root.join("e.txt"), "🚀 ñ needle".as_bytes()).unwrap();

        let r = search_text(&root.to_string_lossy(), "needle");
        let m = &r.files[0].matches[0];
        let units: Vec<u16> = m.text.encode_utf16().collect();
        let sliced = String::from_utf16(&units[m.start as usize..m.end as usize]).unwrap();
        assert_eq!(sliced, "needle");
    }

    #[test]
    fn search_content_caps_total_matches() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for i in 0..4 {
            let body = "needle\n".repeat(10);
            std::fs::write(root.join(format!("f{i}.txt")), body.as_bytes()).unwrap();
        }
        let r = search_content(
            &root.to_string_lossy(),
            &text_query("needle"),
            false,
            &no_filters(),
            12,
        )
        .unwrap();
        assert!(r.truncated);
        assert_eq!(r.total, 12, "the cap holds across files, not just per file");
        let counted: usize = r.files.iter().map(|f| f.matches.len()).sum();
        assert_eq!(counted, 12);
    }

    #[test]
    fn search_content_honors_gitignore_and_filters() {
        let tmp = filter_tree();
        let root_s = tmp.path().to_string_lossy();

        // Same include/exclude semantics as the filename search.
        let f = SearchFilters {
            include: String::new(),
            exclude: "dist".into(),
        };
        let r = search_content(&root_s, &text_query("needle"), false, &f, 100).unwrap();
        let mut names: Vec<&str> = r.files.iter().map(|x| x.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["panel.css", "panel.md", "panel.ts"]);
        assert!(r.files.iter().all(|x| !x.path.contains("/dist/")));
    }
}
