//! Where a new worktree lands on disk (spec `02c` §2.1).
//!
//! Two layouts, chosen by [`crate::model::WorktreeLocationMode`]:
//!
//! - **managed** (the default): a single root the app owns —
//!   `<home>/uxnan/worktrees/<repo>/<branch>` — so a repository's checkouts are
//!   grouped instead of scattered as siblings through whatever folder the repo
//!   happens to live in, and the phone and the desktop land in the same place.
//! - **sibling** (the previous behaviour, kept as an option):
//!   `<parent>/<repo>--<branch>`.
//!
//! Everything here that can be pure **is** pure, and takes the home directory as
//! an argument, so the layout is unit-tested without touching the filesystem.
//! The two functions that cannot ([`resolve`], [`prepare`]) do the git query, the
//! marker read and the directory creation, and nothing else.
//!
//! **The managed layout is never nested inside the repository's own work tree.**
//! A checkout under `<repo>/…` would be untracked content git wants ignored, it
//! would be deleted by `git clean -xdf`, and every tool that walks the tree
//! (analyzers, watchers, the app's own file tree) would walk N copies of the
//! project. Grouping under a separate root gets the tidiness without any of that.

use std::path::Path;

use crate::error::AppError;
use crate::model::WorktreeLocationMode;

/// Longest branch-derived folder name we produce. Long enough to stay readable,
/// short enough that the checkout's own deep paths (`node_modules`, `target`)
/// still fit inside Windows' 260-character limit.
const MAX_BRANCH_FOLDER: usize = 60;

/// Names Windows reserves device-wide: unusable as a folder name, with or
/// without an extension (`CON`, `con.txt`). A branch that produces one is
/// prefixed with `_`.
const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Canonical form for every path this module returns: forward slashes, no
/// trailing slash. Matches what `git worktree list` reports (git normalizes to
/// `/` even on Windows), which is what the frontend keys per-worktree workspaces
/// off — a backslash spelling would never match its own worktree.
pub fn normalize(path: &str) -> String {
    let s = path.replace('\\', "/");
    let trimmed = s.trim_end_matches('/');
    // A root like `C:/` or `/` keeps its slash.
    if trimmed.is_empty() || trimmed.ends_with(':') {
        s
    } else {
        trimmed.to_string()
    }
}

/// Fold a branch name into a folder name that is valid on every OS we ship on.
///
/// Beyond the `/` → `-` flattening the sibling layout always did, this drops the
/// characters Windows rejects outright (`<>:"|?*` and control codes), trims the
/// trailing dots and spaces Windows silently strips (which would make the folder
/// git created and the folder we asked for two different names), escapes the
/// reserved device names, and caps the length on a word boundary so a long
/// branch does not produce an unwieldy folder.
pub fn sanitize_branch(branch: &str) -> String {
    let mut out = String::with_capacity(branch.len());
    for ch in branch.chars() {
        match ch {
            '/' | '\\' => out.push('-'),
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => {}
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {}
            c => out.push(c),
        }
    }

    // Cap on a word boundary: cutting mid-word reads like a typo in a file tree.
    if out.chars().count() > MAX_BRANCH_FOLDER {
        let capped: String = out.chars().take(MAX_BRANCH_FOLDER).collect();
        out = match capped.rfind('-') {
            Some(i) if i > 0 => capped[..i].to_string(),
            _ => capped,
        };
    }

    // Leading `-` would read as an option to git; leading dots hide the folder.
    let out = out
        .trim_start_matches([' ', '.', '-'])
        .trim_end_matches([' ', '.', '-'])
        .to_string();

    if out.is_empty() {
        return "branch".to_string();
    }

    let stem = out.split('.').next().unwrap_or(&out).to_ascii_uppercase();
    if WINDOWS_RESERVED.contains(&stem.as_str()) {
        return format!("_{out}");
    }
    out
}

/// A short, stable digest of a repository path, used only to tell two projects
/// that share a folder name apart (`api` and `api-4f2a91c8`).
///
/// FNV-1a, written out rather than taken from `DefaultHasher`, whose output is
/// explicitly not stable across Rust releases — this one names a folder on the
/// user's disk, so it has to produce the same eight characters forever, and be
/// reproducible from the bridge's TypeScript with the same few lines.
pub fn repo_hash(repo_path: &str) -> String {
    // Lowercased unconditionally (not only on Windows) so the digest does not
    // depend on the platform the app was built for.
    let key = normalize(repo_path).to_lowercase();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:08x}", ((hash >> 32) ^ hash) as u32)
}

/// The folder name a repository's worktrees are grouped under: the name of its
/// **main** worktree's directory, sanitized the same way a branch is.
pub fn repo_key(main_worktree_path: &str) -> String {
    let name = Path::new(&normalize(main_worktree_path))
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let safe = sanitize_branch(&name);
    if safe == "branch" && name.is_empty() {
        "repo".to_string()
    } else {
        safe
    }
}

/// The app's default managed root, `<home>/uxnan/worktrees`.
///
/// Deliberately under the **visible** `~/uxnan` the clone flow already writes
/// to, not under `~/.uxnan`, which holds daemon state: this root holds the
/// user's own source, and code the user cannot find in a file manager is code
/// they cannot back up, open in another editor, or clean up.
pub fn default_root(home: &str) -> String {
    format!("{}/uxnan/worktrees", normalize(home))
}

/// `<root>/<repo-key>/<safe-branch>`.
pub fn managed_path(root: &str, repo_key: &str, branch: &str) -> String {
    format!(
        "{}/{}/{}",
        normalize(root),
        repo_key,
        sanitize_branch(branch)
    )
}

/// The pre-existing layout: a sibling of the repo named `<repo>--<branch>`, with
/// branch separators flattened. Kept verbatim so choosing `sibling` reproduces
/// exactly what the app did before the managed root existed.
pub fn sibling_path(repo_path: &str, branch: &str) -> String {
    let repo = Path::new(repo_path);
    let parent = repo.parent().unwrap_or(repo);
    let name = repo
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());
    let safe_branch = branch.replace(['/', '\\'], "-");
    normalize(
        &parent
            .join(format!("{name}--{safe_branch}"))
            .to_string_lossy(),
    )
}

/// `path`, `path-2`, `path-3`, … — how a destination that is already taken is
/// made free. `git worktree add` refuses an existing directory, so without this
/// a second worktree off the same branch name would simply fail.
pub fn nth_candidate(path: &str, n: u32) -> String {
    if n <= 1 {
        path.to_string()
    } else {
        format!("{path}-{n}")
    }
}

/// Name of the marker file written beside a repository's grouped worktrees,
/// holding the path of the repository they belong to.
pub const MARKER_FILE: &str = ".uxnan-repo";

/// Whether `marker_contents` names the same repository as `main_worktree_path`.
/// Split out from the I/O so the comparison itself is unit-tested.
pub fn marker_matches(marker_contents: &str, main_worktree_path: &str) -> bool {
    normalize(marker_contents.trim()).to_lowercase() == normalize(main_worktree_path).to_lowercase()
}

/// The managed root to use for `main_worktree_path`, honouring a configured
/// override and mirroring into the distro for a WSL repository.
///
/// A worktree of a WSL repository must stay on the distro's own filesystem: a
/// checkout on the Windows side of the 9P share is slow, loses file modes, and
/// makes the in-distro git and the Windows git disagree. So a WSL repo ignores a
/// Windows-side root and mirrors the same `~/uxnan/worktrees` layout inside the
/// distro instead.
async fn root_for(main_worktree_path: &str, configured: Option<&str>) -> Result<String, AppError> {
    let configured = configured
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(normalize);

    if cfg!(windows) {
        if let Some(w) = crate::wsl::parse(main_worktree_path) {
            // A root that is itself inside WSL is honoured as written.
            if let Some(root) = configured.as_deref() {
                if crate::wsl::parse(root).is_some() {
                    return Ok(root.to_string());
                }
            }
            let home = wsl_home(&w.distro, &w.linux).await?;
            return Ok(crate::wsl::to_unc(
                &w.host,
                &w.distro,
                &format!("{}/uxnan/worktrees", home.trim_end_matches('/')),
            ));
        }
    }

    if let Some(root) = configured {
        return Ok(root);
    }
    let home = crate::agent_hooks::home_dir()
        .ok_or_else(|| AppError::Invalid("could not resolve the home directory".to_string()))?;
    Ok(default_root(&home.to_string_lossy()))
}

/// The distro user's home, for the managed root of a WSL repository. Read off
/// the repo's own path when it lives under `/home/<user>/…` (the ordinary case,
/// and free), and otherwise asked of the distro directly.
async fn wsl_home(distro: &str, repo_linux_path: &str) -> Result<String, AppError> {
    if let Some(home) = home_from_linux_path(repo_linux_path) {
        return Ok(home);
    }
    let out = crate::winproc::command("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("sh")
        .arg("-c")
        .arg("printf %s \"$HOME\"")
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("could not query the WSL home: {e}")))?;
    let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || !home.starts_with('/') {
        return Err(AppError::Invalid(format!(
            "could not resolve the home directory inside WSL distro '{distro}'"
        )));
    }
    Ok(home)
}

/// `/home/<user>` for a path under it, else `None`. Pure, so the common WSL case
/// is unit-tested without a distro.
fn home_from_linux_path(linux_path: &str) -> Option<String> {
    let rest = linux_path.strip_prefix("/home/")?;
    let user = rest.split('/').next()?;
    if user.is_empty() {
        return None;
    }
    Some(format!("/home/{user}"))
}

/// A resolved destination: where the worktree goes, and the repository it
/// belongs to (which [`prepare`] records so a second project of the same name
/// gets its own group).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub path: String,
    pub main_worktree: String,
    /// Whether the path is inside a managed root. `false` for the sibling
    /// layout, which lands in the user's own folder and must therefore be left
    /// exactly as it was found — no directories created, no marker written.
    pub managed: bool,
}

/// Where a worktree for `branch` off the repository at `repo_path` should be
/// created. **Read-only**: safe to call on every keystroke of the create dialog
/// to show the user where the folder will land.
///
/// `configured_root` is the effective override (the project's, else the global
/// setting), already resolved by the caller.
pub async fn resolve(
    repo_path: &str,
    branch: &str,
    mode: WorktreeLocationMode,
    configured_root: Option<&str>,
) -> Result<Resolved, AppError> {
    // Always measured from the repository's MAIN worktree: creating a worktree
    // while standing in another one must not nest the new folder under it.
    let main = main_worktree_path(repo_path).await;

    let managed = mode != WorktreeLocationMode::Sibling;
    let path = if managed {
        let root = root_for(&main, configured_root).await?;
        let key = group_key(&root, &main).await;
        unique_path(&managed_path(&root, &key, branch)).await
    } else {
        unique_path(&sibling_path(&main, branch)).await
    };
    Ok(Resolved {
        path,
        main_worktree: main,
        managed,
    })
}

/// The repository's main worktree path, or `repo_path` unchanged when git cannot
/// say (a plain folder, or a repo git refuses to read).
async fn main_worktree_path(repo_path: &str) -> String {
    match crate::git::list_worktrees(repo_path).await {
        Ok(entries) => entries
            .into_iter()
            .find(|e| e.is_main)
            .map(|e| e.path)
            .unwrap_or_else(|| repo_path.to_string()),
        Err(_) => repo_path.to_string(),
    }
}

/// The group folder for this repository under `root`, disambiguated when a
/// different project already claimed the name.
async fn group_key(root: &str, main_worktree_path: &str) -> String {
    let key = repo_key(main_worktree_path);
    let marker = format!("{root}/{key}/{MARKER_FILE}");
    match tokio::fs::read_to_string(&marker).await {
        // Claimed by this same repository, or a group we have not marked yet.
        Ok(contents) if marker_matches(&contents, main_worktree_path) => key,
        // Claimed by a repository that is **gone**. The name is free: a marker
        // outliving its repository is litter, not a claim, and suffixing around
        // it hangs a hash on a clean name for no reason — which is exactly what
        // happened after the first project was deleted and cloned again.
        Ok(contents) if !Path::new(normalize(contents.trim()).as_str()).is_dir() => key,
        Ok(_) => format!("{key}-{}", repo_hash(main_worktree_path)),
        Err(_) => key,
    }
}

/// The first of `path`, `path-2`, `path-3`, … that does not exist. Gives up
/// after 99 and returns the last candidate, letting `git worktree add` report
/// the collision rather than looping forever.
async fn unique_path(path: &str) -> String {
    for n in 1..=99 {
        let candidate = nth_candidate(path, n);
        if !tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return candidate;
        }
    }
    nth_candidate(path, 99)
}

/// Create the parent folder of a resolved path and claim it for this
/// repository, right before `git worktree add` runs. Best-effort: a marker that
/// cannot be written only costs the next same-named project its suffix, so it
/// must never block creating the worktree.
pub async fn prepare(resolved: &Resolved) {
    if !resolved.managed {
        return;
    }
    let Some(parent) = Path::new(&resolved.path).parent() else {
        return;
    };
    if tokio::fs::create_dir_all(parent).await.is_err() {
        return;
    }
    // Overwrite a marker left by a repository that no longer exists: taking the
    // group over is the whole point of [`group_key`] having allowed the name.
    // Only a live claim is left alone.
    let marker = parent.join(MARKER_FILE);
    if let Ok(contents) = tokio::fs::read_to_string(&marker).await {
        if Path::new(normalize(contents.trim()).as_str()).is_dir() {
            return;
        }
    }
    let _ = tokio::fs::write(&marker, normalize(&resolved.main_worktree)).await;
}

/// A temporary directory's path **as git will report it**: canonicalized,
/// forward slashes, without Windows' `\\?\` prefix.
///
/// Shared by every test module here that compares a path against git's own
/// output, because `tempfile` hands back a path git does not echo: macOS
/// resolves `/var` to `/private/var`, and a Windows CI runner hands out 8.3
/// short names (`RUNNER~1` for `runneradmin`). Neither shows up on a developer
/// machine whose temp path is already canonical — which is exactly how a suite
/// that was green locally went red on two CI platforms at once.
#[cfg(test)]
pub(crate) fn canonical_temp(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = resolved.to_string_lossy().replace('\\', "/");
    text.strip_prefix("//?/").unwrap_or(&text).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_to_forward_slashes_without_trailing_separator() {
        assert_eq!(normalize(r"C:\Users\u\repo\"), "C:/Users/u/repo");
        assert_eq!(normalize("/home/u/repo//"), "/home/u/repo");
    }

    #[test]
    fn flattens_branch_separators() {
        assert_eq!(sanitize_branch("feature/login"), "feature-login");
        assert_eq!(sanitize_branch(r"feature\login"), "feature-login");
    }

    #[test]
    fn drops_characters_windows_rejects() {
        assert_eq!(sanitize_branch("fix:the?bug*now"), "fixthebugnow");
        assert_eq!(sanitize_branch("a\u{7}b"), "ab");
    }

    #[test]
    fn trims_what_windows_would_strip_silently() {
        // A trailing dot or space is dropped by the filesystem, so the folder we
        // asked for and the folder that appears would not be the same name.
        assert_eq!(sanitize_branch("release. "), "release");
        assert_eq!(sanitize_branch("-wip-"), "wip");
    }

    #[test]
    fn escapes_windows_reserved_device_names() {
        assert_eq!(sanitize_branch("con"), "_con");
        assert_eq!(sanitize_branch("COM1"), "_COM1");
        assert_eq!(sanitize_branch("nul.txt"), "_nul.txt");
        // Only the exact device names — a longer word is fine.
        assert_eq!(sanitize_branch("console"), "console");
    }

    #[test]
    fn caps_length_on_a_word_boundary() {
        let long = "feat/add-a-reconnection-backoff-to-the-zero-adapter-and-then-some-more";
        let out = sanitize_branch(long);
        assert!(out.chars().count() <= MAX_BRANCH_FOLDER, "{out}");
        assert!(!out.ends_with('-'), "{out}");
        assert!(out.starts_with("feat-add-a-reconnection-backoff"), "{out}");
    }

    #[test]
    fn never_produces_an_empty_folder_name() {
        assert_eq!(sanitize_branch("..."), "branch");
        assert_eq!(sanitize_branch("???"), "branch");
    }

    #[test]
    fn repo_hash_is_stable_and_case_insensitive() {
        let a = repo_hash("C:/Users/u/repo");
        assert_eq!(a.len(), 8);
        assert_eq!(a, repo_hash(r"c:\users\u\repo\"));
        assert_ne!(a, repo_hash("C:/Users/u/other"));
        // Pinned: this names a folder on disk and must not move between builds.
        assert_eq!(repo_hash("/home/u/myrepo"), "532b9c1b");
    }

    #[test]
    fn repo_key_is_the_main_worktree_folder_name() {
        assert_eq!(repo_key("/home/u/myrepo"), "myrepo");
        assert_eq!(repo_key(r"C:\Users\u\my repo\"), "my repo");
    }

    #[test]
    fn managed_path_groups_by_repo_then_branch() {
        let root = default_root("/home/u");
        assert_eq!(root, "/home/u/uxnan/worktrees");
        assert_eq!(
            managed_path(&root, "myrepo", "feature/login"),
            "/home/u/uxnan/worktrees/myrepo/feature-login"
        );
    }

    #[test]
    fn default_root_normalizes_a_windows_home() {
        assert_eq!(
            default_root(r"C:\Users\Agent"),
            "C:/Users/Agent/uxnan/worktrees"
        );
    }

    #[test]
    fn sibling_path_keeps_the_previous_layout() {
        assert_eq!(
            sibling_path("/home/u/myrepo", "feature/login"),
            "/home/u/myrepo--feature-login"
        );
    }

    #[test]
    fn sibling_path_stays_under_the_wsl_unc_prefix() {
        // A WSL repo's sibling worktree must remain under the same UNC share, so
        // the path keeps parsing as WSL (and keeps routing through wsl.exe).
        let p = sibling_path("//wsl.localhost/Ubuntu/home/u/myrepo", "feature/login");
        assert_eq!(p, "//wsl.localhost/Ubuntu/home/u/myrepo--feature-login");
        assert!(
            crate::wsl::parse(&p).is_some(),
            "result should still parse as WSL"
        );
    }

    #[test]
    fn nth_candidate_suffixes_from_two() {
        assert_eq!(nth_candidate("/a/b", 1), "/a/b");
        assert_eq!(nth_candidate("/a/b", 2), "/a/b-2");
    }

    #[test]
    fn marker_matches_ignores_spelling_differences() {
        assert!(marker_matches("C:/Users/u/repo\n", r"c:\Users\u\repo"));
        assert!(!marker_matches("C:/Users/u/repo", "C:/Users/u/other"));
    }

    // --- Against a real repository ------------------------------------------
    //
    // The pure tests above pin the layout; these prove the resolver behaves on
    // an actual git repo — that the group is measured from the MAIN worktree
    // even when asked from inside another one, and that what it returns is a
    // path `git worktree add` accepts and then lists back unchanged.

    async fn run_git(dir: &str, args: &[&str]) {
        let out = crate::winproc::command("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .await
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {:?}", out.status);
    }

    async fn init_repo(dir: &str) {
        run_git(dir, &["init", "-b", "main"]).await;
        run_git(dir, &["config", "user.email", "test@uxnan.dev"]).await;
        run_git(dir, &["config", "user.name", "Uxnan Test"]).await;
        run_git(dir, &["config", "commit.gpgsign", "false"]).await;
        std::fs::write(format!("{dir}/README.md"), "base\n").unwrap();
        run_git(dir, &["add", "-A"]).await;
        run_git(dir, &["commit", "-m", "initial"]).await;
    }

    #[tokio::test]
    async fn managed_resolve_groups_by_repo_and_is_accepted_by_git() {
        let home = tempfile::tempdir().unwrap();
        let root = canonical_temp(home.path());
        let repo = tempfile::tempdir().unwrap();
        let repo_path = canonical_temp(repo.path());
        init_repo(&repo_path).await;
        let name = repo_key(&repo_path);

        let resolved = resolve(
            &repo_path,
            "feature/login",
            WorktreeLocationMode::Custom,
            Some(&root),
        )
        .await
        .unwrap();
        assert_eq!(resolved.path, format!("{root}/{name}/feature-login"));
        assert!(resolved.managed);

        prepare(&resolved).await;
        crate::git::add_worktree(&repo_path, "feature/login", &resolved.path, Some("main"))
            .await
            .unwrap();

        // git lists it back at exactly the path we asked for — the spelling the
        // frontend keys its per-worktree workspace off.
        let listed = crate::git::list_worktrees(&repo_path).await.unwrap();
        assert!(
            listed.iter().any(|e| e.path == resolved.path),
            "not listed: {listed:?}"
        );
        // And the group is claimed, so a same-named project lands elsewhere.
        let marker = std::fs::read_to_string(format!("{root}/{name}/{MARKER_FILE}")).unwrap();
        assert!(marker_matches(&marker, &repo_path));
    }

    #[tokio::test]
    async fn asking_from_inside_a_worktree_still_groups_under_the_main_one() {
        let home = tempfile::tempdir().unwrap();
        let root = canonical_temp(home.path());
        let repo = tempfile::tempdir().unwrap();
        let repo_path = canonical_temp(repo.path());
        init_repo(&repo_path).await;
        let name = repo_key(&repo_path);

        let first = resolve(&repo_path, "one", WorktreeLocationMode::Custom, Some(&root))
            .await
            .unwrap();
        prepare(&first).await;
        crate::git::add_worktree(&repo_path, "one", &first.path, Some("main"))
            .await
            .unwrap();

        // Now ask from INSIDE that worktree. Measured naively, the second one
        // would nest under the first (`…/one/two`) and the tree would grow a
        // level deeper with every worktree.
        let second = resolve(
            &first.path,
            "two",
            WorktreeLocationMode::Custom,
            Some(&root),
        )
        .await
        .unwrap();
        assert_eq!(second.path, format!("{root}/{name}/two"));
        assert_eq!(second.main_worktree, repo_path);
    }

    #[tokio::test]
    async fn a_marker_left_by_a_deleted_repository_does_not_earn_a_suffix() {
        let home = tempfile::tempdir().unwrap();
        let root = canonical_temp(home.path());
        let repo = tempfile::tempdir().unwrap();
        let repo_path = canonical_temp(repo.path());
        init_repo(&repo_path).await;
        let name = repo_key(&repo_path);

        // Exactly what a cleaned-up project leaves behind: an empty group whose
        // marker names a repository that no longer exists. Reading that as a
        // live claim is what hung a hash on a clean name after the user deleted
        // a project and cloned it again.
        std::fs::create_dir_all(format!("{root}/{name}")).unwrap();
        std::fs::write(
            format!("{root}/{name}/{MARKER_FILE}"),
            "C:/gone/for/good/repo",
        )
        .unwrap();

        let resolved = resolve(&repo_path, "wip", WorktreeLocationMode::Custom, Some(&root))
            .await
            .unwrap();
        assert_eq!(resolved.path, format!("{root}/{name}/wip"));

        // And preparing it takes the group over rather than leaving the lie.
        prepare(&resolved).await;
        let marker = std::fs::read_to_string(format!("{root}/{name}/{MARKER_FILE}")).unwrap();
        assert!(marker_matches(&marker, &repo_path), "marker: {marker}");
    }

    #[tokio::test]
    async fn a_marker_of_a_repository_that_still_exists_earns_a_suffix() {
        let home = tempfile::tempdir().unwrap();
        let root = canonical_temp(home.path());
        let repo = tempfile::tempdir().unwrap();
        let repo_path = canonical_temp(repo.path());
        init_repo(&repo_path).await;
        let other = tempfile::tempdir().unwrap();
        let other_path = canonical_temp(other.path());
        let name = repo_key(&repo_path);

        // A different project that DOES still exist keeps its group.
        std::fs::create_dir_all(format!("{root}/{name}")).unwrap();
        std::fs::write(format!("{root}/{name}/{MARKER_FILE}"), &other_path).unwrap();

        let resolved = resolve(&repo_path, "wip", WorktreeLocationMode::Custom, Some(&root))
            .await
            .unwrap();
        assert_eq!(
            resolved.path,
            format!("{root}/{name}-{}/wip", repo_hash(&repo_path))
        );
        // …and its marker is left exactly as it was.
        let marker = std::fs::read_to_string(format!("{root}/{name}/{MARKER_FILE}")).unwrap();
        assert!(marker_matches(&marker, &other_path));
    }

    #[tokio::test]
    async fn a_taken_destination_gets_the_next_free_suffix() {
        let home = tempfile::tempdir().unwrap();
        let root = canonical_temp(home.path());
        let repo = tempfile::tempdir().unwrap();
        let repo_path = canonical_temp(repo.path());
        init_repo(&repo_path).await;
        let name = repo_key(&repo_path);

        // Two branches that sanitize to the same folder name (`a/b` and `a-b`).
        std::fs::create_dir_all(format!("{root}/{name}/a-b")).unwrap();
        let resolved = resolve(&repo_path, "a/b", WorktreeLocationMode::Custom, Some(&root))
            .await
            .unwrap();
        assert_eq!(resolved.path, format!("{root}/{name}/a-b-2"));
    }

    #[tokio::test]
    async fn a_second_project_of_the_same_name_gets_its_own_group() {
        let home = tempfile::tempdir().unwrap();
        let root = canonical_temp(home.path());
        let repo = tempfile::tempdir().unwrap();
        let repo_path = canonical_temp(repo.path());
        init_repo(&repo_path).await;
        let name = repo_key(&repo_path);

        // Another repository already owns this group name — and, crucially, it
        // still EXISTS. A marker naming a repository that is gone is litter, not
        // a claim, and reclaiming the name is the point of the sibling test.
        let other = tempfile::tempdir().unwrap();
        let other_path = canonical_temp(other.path());
        std::fs::create_dir_all(format!("{root}/{name}")).unwrap();
        std::fs::write(format!("{root}/{name}/{MARKER_FILE}"), &other_path).unwrap();

        let resolved = resolve(&repo_path, "wip", WorktreeLocationMode::Custom, Some(&root))
            .await
            .unwrap();
        assert_eq!(
            resolved.path,
            format!("{root}/{name}-{}/wip", repo_hash(&repo_path))
        );
    }

    #[test]
    fn wsl_home_is_read_off_the_repo_path_when_it_can_be() {
        assert_eq!(
            home_from_linux_path("/home/luis/code/repo").as_deref(),
            Some("/home/luis")
        );
        assert_eq!(home_from_linux_path("/srv/app"), None);
        assert_eq!(home_from_linux_path("/home/"), None);
    }
}
