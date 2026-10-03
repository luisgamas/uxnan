//! The git the workspace engine answers itself, through libgit2 — on this
//! machine in process, and on a host by its engine, so what the file tree knows
//! about a repository is the same on both.

use git2::Repository;

/// Best-effort: which of `paths` (absolute, native or forward-slash) git
/// ignores, in the repository that contains `dir`. Returns one bool per input
/// path, in order — all `false` when `dir` isn't inside a git repo, so the file
/// tree keeps working outside a repository. Mirrors `git check-ignore`: tracked
/// files are never reported ignored even when a rule matches. Used to dim
/// ignored entries in the file-tree tab.
pub fn ignored_flags(dir: &str, paths: &[String]) -> Vec<bool> {
    let mut out = vec![false; paths.len()];
    let Ok(repo) = Repository::discover(dir) else {
        return out;
    };
    // `is_path_ignored` wants a path relative to the workdir; `strip_prefix`
    // compares by component, so mixed `/` vs `\` separators still line up.
    let workdir = repo.workdir().map(std::path::Path::to_path_buf);
    for (i, p) in paths.iter().enumerate() {
        let abs = std::path::PathBuf::from(p);
        let rel = match &workdir {
            Some(w) => abs
                .strip_prefix(w)
                .map(std::path::Path::to_path_buf)
                .unwrap_or(abs),
            None => abs,
        };
        out[i] = repo.is_path_ignored(&rel).unwrap_or(false);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignored_flags_matches_gitignore_for_files_and_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        Repository::init(dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "ignored.txt\nbuild/\n").unwrap();
        std::fs::write(dir.join("ignored.txt"), "x").unwrap();
        std::fs::write(dir.join("kept.txt"), "x").unwrap();
        std::fs::create_dir(dir.join("build")).unwrap();

        // Forward-slash absolute paths, exactly as `list_dir` hands them over.
        let paths: Vec<String> = ["ignored.txt", "kept.txt", "build", ".gitignore"]
            .iter()
            .map(|n| dir.join(n).to_string_lossy().replace('\\', "/"))
            .collect();
        let flags = ignored_flags(&dir.to_string_lossy(), &paths);
        // ignored.txt + build/ matched; kept.txt + .gitignore are not ignored.
        assert_eq!(flags, vec![true, false, true, false]);
    }

    #[test]
    fn ignored_flags_all_false_outside_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp
            .path()
            .join("a.txt")
            .to_string_lossy()
            .replace('\\', "/");
        // No repo at/above the temp dir → every entry un-flagged, no panic.
        assert_eq!(
            ignored_flags(&tmp.path().to_string_lossy(), &[p]),
            vec![false]
        );
    }
}
