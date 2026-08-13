//! Reading the user's own OpenSSH configuration.
//!
//! Two deliberately separate jobs, because they need very different amounts of
//! rigor:
//!
//! * **Enumerating** the aliases a user could add (`Host` blocks, plus whatever
//!   `Include` pulls in). A scan is enough here — we only need candidate names
//!   to show in a picker, so this understands exactly two keywords and ignores
//!   everything else.
//! * **Resolving** one alias to the values OpenSSH would actually use. This is
//!   where a hand-written parser goes wrong: `Match` blocks, pattern precedence,
//!   canonicalization and per-user defaults all change the answer, and getting
//!   any of it subtly wrong means we connect somewhere the user's own `ssh`
//!   would not. So we do not reimplement it — we ask `ssh -G <alias>`, which
//!   prints the fully resolved configuration and ships with Windows, macOS and
//!   Linux alike.
//!
//! Nothing here connects to anything; both halves are pure reads.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Depth limit for `Include` chains. OpenSSH itself allows nesting; a cycle
/// (`a` includes `b` includes `a`) would otherwise hang the scan, and no real
/// configuration nests anywhere near this deep.
const MAX_INCLUDE_DEPTH: usize = 8;

/// Most aliases one scan will return. A picker cannot usefully show more, and it
/// bounds the work a pathological (or hostile) config file can cause.
pub const MAX_HOSTS: usize = 500;

/// One `Host` alias found in the configuration — a candidate the user may add.
/// It carries no resolved values: those come from [`resolve`], which is a
/// process spawn and therefore only worth doing for the alias actually chosen.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigAlias {
    /// The alias as written (`Host <alias>`), e.g. `build-box`.
    pub alias: String,
    /// File it was declared in, so the UI can say where a duplicate came from.
    pub source: String,
}

/// The effective OpenSSH settings for one alias, as `ssh -G` reports them.
///
/// Only the fields the ADE acts on are lifted out; `ssh -G` prints dozens more
/// and they are deliberately ignored rather than mirrored, so this struct never
/// pretends to be a complete model of OpenSSH configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedHost {
    pub hostname: String,
    pub port: u16,
    pub user: String,
    /// Every `IdentityFile` in the order OpenSSH would try them.
    pub identity_files: Vec<String>,
    pub identity_agent: Option<String>,
    pub identities_only: bool,
    /// `ForwardAgent yes` — the setting that lets git on the remote host use the
    /// keys held by the agent here, without a private key ever being copied.
    pub forward_agent: bool,
    pub proxy_command: Option<String>,
    pub proxy_jump: Option<String>,
}

/// The default location of the user's SSH configuration.
pub fn default_config_path() -> Option<PathBuf> {
    dirs_home().map(|h| h.join(".ssh").join("config"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

/// Scan `path` (and anything it `Include`s) for concrete `Host` aliases.
///
/// Wildcard patterns (`*`, `?`, `!`) are skipped: `Host *` configures defaults
/// for every host, it is not a host anyone can connect to. Duplicates keep their
/// first sighting, which is also the one OpenSSH's first-match-wins would use.
/// A missing file is not an error — plenty of users have no SSH config at all.
pub fn enumerate(path: &Path) -> Vec<ConfigAlias> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut visited = HashSet::new();
    scan_file(path, 0, &mut out, &mut seen, &mut visited);
    out
}

fn scan_file(
    path: &Path,
    depth: usize,
    out: &mut Vec<ConfigAlias>,
    seen: &mut HashSet<String>,
    visited: &mut HashSet<PathBuf>,
) {
    if depth > MAX_INCLUDE_DEPTH || out.len() >= MAX_HOSTS {
        return;
    }
    // Guard against an include cycle even within the depth limit.
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if !visited.insert(canonical) {
        return;
    }
    let Ok(body) = std::fs::read_to_string(path) else {
        return;
    };
    let display = path.display().to_string();

    for line in body.lines() {
        let Some((keyword, value)) = split_directive(line) else {
            continue;
        };
        if keyword.eq_ignore_ascii_case("host") {
            for pattern in value.split_whitespace() {
                if out.len() >= MAX_HOSTS {
                    return;
                }
                if is_pattern(pattern) {
                    continue;
                }
                if seen.insert(pattern.to_ascii_lowercase()) {
                    out.push(ConfigAlias {
                        alias: pattern.to_string(),
                        source: display.clone(),
                    });
                }
            }
        } else if keyword.eq_ignore_ascii_case("include") {
            for entry in value.split_whitespace() {
                for included in expand_include(entry, path) {
                    scan_file(&included, depth + 1, out, seen, visited);
                }
            }
        }
    }
}

/// Split one configuration line into keyword and value, honoring both accepted
/// separators (`Key value` and `Key=value`) and dropping comments and blanks.
fn split_directive(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (keyword, rest) = match line.find([' ', '\t', '=']) {
        Some(i) => (&line[..i], line[i..].trim_start_matches([' ', '\t', '='])),
        None => return None,
    };
    let rest = rest.trim();
    if keyword.is_empty() || rest.is_empty() {
        return None;
    }
    Some((keyword, rest))
}

/// Whether a `Host` token is a pattern rather than a connectable alias.
fn is_pattern(token: &str) -> bool {
    token.contains(['*', '?', '!'])
}

/// Resolve one `Include` entry to concrete files: `~` expands to the home
/// directory, a relative path resolves against the including file's directory
/// (OpenSSH resolves relative user includes against `~/.ssh`, which is that
/// directory in every normal setup), and globs are expanded.
fn expand_include(entry: &str, including: &Path) -> Vec<PathBuf> {
    let raw = entry.trim_matches('"');
    let expanded: PathBuf = if let Some(rest) = raw.strip_prefix("~/").or(raw.strip_prefix("~\\")) {
        match dirs_home() {
            Some(home) => home.join(rest),
            None => return Vec::new(),
        }
    } else {
        let p = Path::new(raw);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            including.parent().unwrap_or(Path::new(".")).join(p)
        }
    };

    let as_str = expanded.to_string_lossy().to_string();
    if !as_str.contains(['*', '?']) {
        return vec![expanded];
    }
    match globset::Glob::new(&as_str.replace('\\', "/")) {
        Ok(glob) => {
            let matcher = glob.compile_matcher();
            let dir = expanded.parent().unwrap_or(Path::new(".")).to_path_buf();
            let Ok(entries) = std::fs::read_dir(&dir) else {
                return Vec::new();
            };
            let mut hits: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file())
                .filter(|p| matcher.is_match(p.to_string_lossy().replace('\\', "/").as_str()))
                .collect();
            // Deterministic order: a picker that reshuffles between refreshes
            // looks broken even when the contents are identical.
            hits.sort();
            hits
        }
        Err(_) => Vec::new(),
    }
}

/// Ask OpenSSH what it would actually use for `alias`.
///
/// Errors when the `ssh` binary is missing or the alias cannot be resolved, so
/// the caller can say "your ssh client could not resolve this host" instead of
/// silently connecting somewhere else.
pub async fn resolve(alias: &str) -> Result<ResolvedHost, AppError> {
    let alias = alias.trim();
    if alias.is_empty() || alias.starts_with('-') {
        // A leading dash would be read as a flag by `ssh` itself.
        return Err(AppError::Invalid(format!("invalid ssh alias: {alias}")));
    }
    let output = crate::winproc::command("ssh")
        .arg("-G")
        .arg(alias)
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("could not run `ssh -G`: {e}")))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Invalid(format!(
            "`ssh -G {alias}` failed: {}",
            if detail.is_empty() {
                "no detail".into()
            } else {
                detail
            }
        )));
    }
    Ok(parse_resolved(&String::from_utf8_lossy(&output.stdout)))
}

/// Parse `ssh -G` output: lowercase `keyword value` lines, one per setting,
/// with `identityfile` repeated once per configured key.
///
/// Unknown keywords are ignored rather than rejected — `ssh -G` prints whatever
/// the installed OpenSSH knows about, and that set grows with every release.
pub fn parse_resolved(stdout: &str) -> ResolvedHost {
    let mut out = ResolvedHost {
        port: 22,
        ..Default::default()
    };
    for line in stdout.lines() {
        let line = line.trim();
        let Some((key, value)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.to_ascii_lowercase().as_str() {
            "hostname" => out.hostname = value.to_string(),
            "user" => out.user = value.to_string(),
            "port" => {
                if let Ok(p) = value.parse::<u16>() {
                    if p > 0 {
                        out.port = p;
                    }
                }
            }
            "identityfile" => out.identity_files.push(value.to_string()),
            "identitiesonly" => out.identities_only = is_yes(value),
            "forwardagent" => out.forward_agent = is_yes(value),
            // `ssh -G` prints the literal `none` for these rather than omitting
            // them; taking it at face value would have us run a proxy command
            // called `none`.
            "identityagent" => out.identity_agent = unset_if_none(value),
            "proxycommand" => out.proxy_command = unset_if_none(value),
            "proxyjump" => out.proxy_jump = unset_if_none(value),
            _ => {}
        }
    }
    out
}

fn is_yes(value: &str) -> bool {
    value.eq_ignore_ascii_case("yes")
}

/// `Some(value)`, unless OpenSSH printed its placeholder for "not configured".
fn unset_if_none(value: &str) -> Option<String> {
    (!value.eq_ignore_ascii_case("none")).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        path
    }

    #[test]
    fn enumerates_aliases_in_declaration_order() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = write(
            dir.path(),
            "config",
            "# comment\n\nHost build-box\n  HostName 10.0.0.5\n\nHost mac-mini\n  User dev\n",
        );
        let hosts = enumerate(&cfg);
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["build-box", "mac-mini"]
        );
        assert!(hosts[0].source.ends_with("config"));
    }

    #[test]
    fn accepts_both_separator_styles_and_multiple_aliases_per_line() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = write(dir.path(), "config", "Host=alpha\nHost beta\tgamma\n");
        let hosts = enumerate(&cfg);
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["alpha", "beta", "gamma"]
        );
    }

    #[test]
    fn skips_wildcard_patterns_which_are_defaults_not_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = write(
            dir.path(),
            "config",
            "Host *\n  ForwardAgent yes\nHost *.internal\nHost !secret prod\n",
        );
        let hosts = enumerate(&cfg);
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["prod"]
        );
    }

    #[test]
    fn keeps_the_first_sighting_of_a_duplicate_alias() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = write(dir.path(), "config", "Host dup\nHost other\nHost DUP\n");
        let hosts = enumerate(&cfg);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "dup");
    }

    #[test]
    fn follows_relative_and_glob_includes() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "conf.d/10-work.conf", "Host work-1\n");
        write(dir.path(), "conf.d/20-home.conf", "Host home-1\n");
        let cfg = write(dir.path(), "config", "Include conf.d/*.conf\nHost direct\n");
        let hosts: Vec<String> = enumerate(&cfg).into_iter().map(|h| h.alias).collect();
        assert_eq!(hosts, ["work-1", "home-1", "direct"]);
    }

    #[test]
    fn an_include_cycle_terminates() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "b.conf", "Host from-b\nInclude config\n");
        let cfg = write(dir.path(), "config", "Host from-a\nInclude b.conf\n");
        let hosts: Vec<String> = enumerate(&cfg).into_iter().map(|h| h.alias).collect();
        assert_eq!(hosts, ["from-a", "from-b"]);
    }

    #[test]
    fn a_missing_config_is_empty_not_an_error() {
        assert!(enumerate(Path::new("C:/definitely/not/here/config")).is_empty());
    }

    #[test]
    fn parses_real_ssh_dash_g_output() {
        // Trimmed from actual `ssh -G` output (OpenSSH_for_Windows 9.5p2).
        let out = "host build-box\n\
                   user dev\n\
                   hostname 10.0.0.5\n\
                   port 2222\n\
                   identityfile ~/.ssh/id_ed25519\n\
                   identityfile ~/.ssh/id_rsa\n\
                   identitiesonly yes\n\
                   forwardagent yes\n\
                   proxyjump bastion\n\
                   addressfamily any\n\
                   controlmaster false\n";
        let r = parse_resolved(out);
        assert_eq!(r.hostname, "10.0.0.5");
        assert_eq!(r.user, "dev");
        assert_eq!(r.port, 2222);
        assert_eq!(r.identity_files.len(), 2);
        assert!(r.identities_only);
        assert!(r.forward_agent);
        assert_eq!(r.proxy_jump.as_deref(), Some("bastion"));
        assert_eq!(r.proxy_command, None);
    }

    #[test]
    fn treats_the_literal_none_as_unset() {
        // `ssh -G` prints "none" rather than omitting these; running `none` as a
        // proxy command would be a confusing failure at connect time.
        let r = parse_resolved("proxycommand none\nproxyjump none\nidentityagent none\n");
        assert_eq!(r.proxy_command, None);
        assert_eq!(r.proxy_jump, None);
        assert_eq!(r.identity_agent, None);
    }

    #[test]
    fn defaults_the_port_and_survives_junk() {
        let r = parse_resolved("hostname h\nport not-a-number\n\n  \nnokeyword\n");
        assert_eq!(r.port, 22);
        assert_eq!(r.hostname, "h");
    }

    #[tokio::test]
    async fn resolve_refuses_an_alias_that_would_be_read_as_a_flag() {
        assert!(resolve("-oProxyCommand=calc.exe").await.is_err());
        assert!(resolve("  ").await.is_err());
    }
}
