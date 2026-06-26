//! WSL path detection and translation (Windows ↔ WSL).
//!
//! When the user opens a repo that lives inside a WSL distro, its Windows path is
//! a UNC path under the `\\wsl.localhost\<distro>\…` (or the legacy `\\wsl$\…`)
//! share. Running the Windows `git.exe` against that 9P share is slow and can
//! disagree with the distro's own git (line endings, file modes, hooks), so the
//! git layer instead runs the *Linux* git inside the distro via `wsl.exe -d
//! <distro> git …`, translating the UNC path to its Linux form (`/home/u/repo`).
//! Output paths (e.g. from `git worktree list`) are translated back so the rest of
//! the app keeps using the UNC form it registered (spec `02c` §3.2).
//!
//! Paths reach us either forward-slash normalized (the app's canonical form) or
//! with the Windows backslash form straight from a picker, and with either host
//! token (`wsl.localhost` or `wsl$`), so [`parse`] accepts all of these. The
//! parsing is pure and platform-independent (so it is unit-tested everywhere);
//! only [`is_wsl_path`] short-circuits to `false` off Windows, where WSL paths
//! can't occur.

/// A parsed WSL UNC path: the share host token, the distro, and the absolute
/// Linux path inside it (always starting with `/`).
///
/// Only consumed by the Windows-only routing in `git.rs` (plus the
/// platform-independent unit tests below), so off Windows it's dead in the
/// non-test build — allowed rather than `#[cfg(windows)]`-gated so the parser
/// stays compiled and tested on every CI platform.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslPath {
    /// The UNC host token as written: `wsl.localhost` or `wsl$`.
    pub host: String,
    /// Distro name, e.g. `Ubuntu` or `Debian`.
    pub distro: String,
    /// Absolute path inside the distro, e.g. `/home/u/repo` (always leading `/`).
    pub linux: String,
}

/// Parse a `\\wsl.localhost\<distro>\…` / `\\wsl$\…` UNC path (in either slash
/// form, any host-token casing) into its parts, or `None` if it isn't a WSL path.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse(path: &str) -> Option<WslPath> {
    // Accept both slash forms by normalizing to '/'.
    let norm = path.replace('\\', "/");
    let rest = norm.strip_prefix("//")?;
    // rest = "<host>/<distro>[/<linux...>]"
    let mut parts = rest.splitn(3, '/');
    let host = parts.next()?;
    if !host.eq_ignore_ascii_case("wsl.localhost") && !host.eq_ignore_ascii_case("wsl$") {
        return None;
    }
    let distro = parts.next()?;
    if distro.is_empty() {
        return None;
    }
    // Everything after the distro is the absolute Linux path; the distro root
    // (no tail) maps to "/".
    let tail = parts.next().unwrap_or("").trim_end_matches('/');
    Some(WslPath {
        host: host.to_string(),
        distro: distro.to_string(),
        linux: format!("/{tail}"),
    })
}

/// Rebuild the app's canonical forward-slash UNC path from parts, e.g.
/// (`wsl.localhost`, `Ubuntu`, `/home/u/repo--x`) →
/// `//wsl.localhost/Ubuntu/home/u/repo--x`. Used to translate a Linux path that
/// the in-distro git reported (e.g. a new worktree) back to the form the app
/// registered, so per-worktree workspace keys line up.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn to_unc(host: &str, distro: &str, linux: &str) -> String {
    let tail = linux.trim_start_matches('/');
    if tail.is_empty() {
        format!("//{host}/{distro}")
    } else {
        format!("//{host}/{distro}/{tail}")
    }
}

/// Whether `path` is a WSL UNC path that should be routed through `wsl.exe`.
/// Always `false` off Windows, where such paths can't occur.
#[cfg(windows)]
pub fn is_wsl_path(path: &str) -> bool {
    parse(path).is_some()
}

/// Off Windows there is no WSL, so no path is ever WSL-routed.
#[cfg(not(windows))]
pub fn is_wsl_path(_path: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wsl_localhost_backslash_form() {
        let p = parse(r"\\wsl.localhost\Ubuntu\home\luis\repo").unwrap();
        assert_eq!(p.host, "wsl.localhost");
        assert_eq!(p.distro, "Ubuntu");
        assert_eq!(p.linux, "/home/luis/repo");
    }

    #[test]
    fn parses_forward_slash_and_legacy_wsl_dollar() {
        // Forward-slash form (the app's canonical normalization).
        let p = parse("//wsl.localhost/Debian/srv/app").unwrap();
        assert_eq!(p.distro, "Debian");
        assert_eq!(p.linux, "/srv/app");
        // Legacy `wsl$` host token, backslash form.
        let q = parse(r"\\wsl$\Ubuntu-22.04\home\u\x").unwrap();
        assert_eq!(q.host, "wsl$");
        assert_eq!(q.distro, "Ubuntu-22.04");
        assert_eq!(q.linux, "/home/u/x");
    }

    #[test]
    fn host_token_is_case_insensitive() {
        assert!(parse(r"\\WSL.localhost\Ubuntu\home").is_some());
    }

    #[test]
    fn rejects_non_wsl_paths() {
        assert!(parse(r"C:\Users\u\repo").is_none());
        assert!(parse("/home/u/repo").is_none());
        assert!(parse(r"\\server\share\x").is_none()); // ordinary UNC, not WSL
        assert!(parse(r"\\wsl.localhost\").is_none()); // no distro
        assert!(parse("//wsl.localhost").is_none()); // no distro segment
    }

    #[test]
    fn distro_root_maps_to_slash() {
        let p = parse(r"\\wsl.localhost\Ubuntu").unwrap();
        assert_eq!(p.linux, "/");
    }

    #[test]
    fn to_unc_round_trips_with_parse() {
        let original = "//wsl.localhost/Ubuntu/home/luis/repo--feature-x";
        let p = parse(original).unwrap();
        let back = to_unc(&p.host, &p.distro, &p.linux);
        assert_eq!(back, original);
    }

    #[test]
    fn to_unc_handles_distro_root() {
        assert_eq!(
            to_unc("wsl.localhost", "Ubuntu", "/"),
            "//wsl.localhost/Ubuntu"
        );
    }
}
