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

/// The effective OpenSSH settings for one host, as `ssh -G` reports them.
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
    /// `CertificateFile`s, offered with the key they certify.
    pub certificate_files: Vec<String>,
    /// `IdentityAgent` as OpenSSH printed it: a socket path, the literal
    /// `SSH_AUTH_SOCK` (use the environment), or `none` (use no agent at all).
    /// `None` means it was not configured, which is the environment's agent.
    pub identity_agent: Option<String>,
    pub identities_only: bool,
    /// `ForwardAgent yes` — the setting that lets git on the remote host use the
    /// keys held by the agent here, without a private key ever being copied.
    pub forward_agent: bool,
    pub proxy_command: Option<String>,
    pub proxy_jump: Option<String>,
    /// `HostKeyAlias`: the name the host key is filed under in `known_hosts`
    /// instead of `hostname`.
    pub host_key_alias: Option<String>,
    /// `UserKnownHostsFile`, in order. The first one is where a newly trusted
    /// key is written.
    pub user_known_hosts_files: Vec<String>,
    /// `GlobalKnownHostsFile`: read, never written.
    pub global_known_hosts_files: Vec<String>,
    pub strict_host_key_checking: StrictHostKeys,
    /// What only the system `ssh` can do (`system::needs_system`): Kerberos,
    /// a smartcard, a security-key middleware, host-based authentication, a
    /// proxy that passes a socket, host keys from a command.
    pub gssapi_authentication: bool,
    pub pkcs11_provider: Option<String>,
    /// A `SecurityKeyProvider` other than OpenSSH's built-in one.
    pub security_key_provider: Option<String>,
    pub hostbased_authentication: bool,
    pub proxy_use_fdpass: bool,
    pub known_hosts_command: Option<String>,
}

/// `StrictHostKeyChecking`, as far as this app honours it.
///
/// There is no value that lets a **changed** key through: OpenSSH's `no` still
/// warns about one, and here it refuses it outright, like every other value.
/// What the setting decides is only what happens with a host that has no key on
/// file yet.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StrictHostKeys {
    /// `ask` (OpenSSH's default): show the fingerprint and let the user decide.
    #[default]
    Ask,
    /// `yes`: never trust a new key from here. It has to be on file already.
    Yes,
    /// `accept-new` — and `no`, read the same way: record a new key without
    /// asking, but never one that replaces a key on file.
    AcceptNew,
}

impl StrictHostKeys {
    /// OpenSSH writes this one as `yes`/`no` in a config file but `ssh -G`
    /// prints `true`/`false`, so both spellings are read.
    fn parse(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "yes" | "true" => StrictHostKeys::Yes,
            "accept-new" | "no" | "false" | "off" => StrictHostKeys::AcceptNew,
            _ => StrictHostKeys::Ask,
        }
    }
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
    let cut = line.find([' ', '\t', '='])?;
    let (keyword, rest) = (
        &line[..cut],
        line[cut..].trim_start_matches([' ', '\t', '=']),
    );
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
    if !is_safe_word(alias) {
        // A leading dash would be read as a flag by `ssh` itself.
        return Err(AppError::Invalid(format!("invalid ssh alias: {alias}")));
    }
    run_dash_g(&[alias.to_string()]).await
}

/// What a host the user typed by hand resolves to, **through their own
/// configuration**.
///
/// A hand-written host is still subject to the user's `Host *` defaults — the
/// agent socket, the known-hosts files, `IdentitiesOnly` — exactly as typing
/// `ssh -p 2222 me@box` would be. So it is resolved the way that command line
/// would be: the typed values become `ssh` flags and OpenSSH merges them. What
/// the user typed wins, because command-line options always do.
pub async fn resolve_typed(typed: &TypedHost<'_>) -> Result<ResolvedHost, AppError> {
    run_dash_g(&typed_args(typed)?).await
}

/// The values of a hand-written host that `ssh -G` should see.
pub struct TypedHost<'a> {
    pub hostname: &'a str,
    pub port: u16,
    pub user: &'a str,
    pub identity_files: &'a [String],
    pub proxy_jump: Option<&'a str>,
    pub proxy_command: Option<&'a str>,
    pub forward_agent: bool,
}

pub(crate) fn typed_args(typed: &TypedHost<'_>) -> Result<Vec<String>, AppError> {
    let hostname = typed.hostname.trim();
    let user = typed.user.trim();
    if !is_safe_word(hostname) {
        return Err(AppError::Invalid(format!("invalid host name: {hostname}")));
    }
    if !user.is_empty() && !is_safe_word(user) {
        return Err(AppError::Invalid(format!("invalid user name: {user}")));
    }
    let mut args = vec!["-p".to_string(), typed.port.to_string()];
    if !user.is_empty() {
        args.extend(["-l".to_string(), user.to_string()]);
    }
    for file in typed.identity_files.iter().filter(|f| !f.trim().is_empty()) {
        args.extend(["-i".to_string(), file.trim().to_string()]);
    }
    if let Some(jump) = typed.proxy_jump.map(str::trim).filter(|j| !j.is_empty()) {
        args.extend(["-J".to_string(), jump.to_string()]);
    }
    if let Some(command) = typed.proxy_command.map(str::trim).filter(|c| !c.is_empty()) {
        args.extend(["-o".to_string(), format!("ProxyCommand={command}")]);
    }
    if typed.forward_agent {
        args.extend(["-o".to_string(), "ForwardAgent=yes".to_string()]);
    }
    args.push(hostname.to_string());
    Ok(args)
}

/// One `ProxyJump` hop as written: `[user@]host[:port]`, or the URI form
/// `ssh://[user@]host[:port]`. The host part may be an alias of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JumpSpec {
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
}

/// Split a `ProxyJump` value into its hops, first to last.
///
/// Errors on a hop that cannot be read, rather than skipping it: connecting
/// without one of the bastions the user configured would mean dialling a
/// machine by a route they never chose.
pub fn parse_jumps(value: &str) -> Result<Vec<JumpSpec>, AppError> {
    let mut hops = Vec::new();
    for raw in value.split(',').map(str::trim).filter(|h| !h.is_empty()) {
        let body = raw.strip_prefix("ssh://").unwrap_or(raw);
        let (user, rest) = match body.rsplit_once('@') {
            Some((u, r)) => (Some(u.to_string()), r),
            None => (None, body),
        };
        // `[v6::addr]:port` keeps its colons inside the brackets.
        let (host, port) = if let Some(inner) = rest.strip_prefix('[') {
            match inner.split_once(']') {
                Some((h, tail)) => (h.to_string(), tail.strip_prefix(':')),
                None => return Err(AppError::Invalid(format!("unreadable jump host: {raw}"))),
            }
        } else {
            match rest.rsplit_once(':') {
                Some((h, p)) if !h.contains(':') => (h.to_string(), Some(p)),
                _ => (rest.to_string(), None),
            }
        };
        let port = match port {
            Some(p) => Some(
                p.parse::<u16>()
                    .ok()
                    .filter(|p| *p > 0)
                    .ok_or_else(|| AppError::Invalid(format!("unreadable jump port: {raw}")))?,
            ),
            None => None,
        };
        if !is_safe_word(&host) || user.as_deref().is_some_and(|u| !is_safe_word(u)) {
            return Err(AppError::Invalid(format!("unreadable jump host: {raw}")));
        }
        hops.push(JumpSpec { user, host, port });
    }
    Ok(hops)
}

/// Resolve one jump hop through the user's configuration, as OpenSSH resolves
/// the hosts of a `-J` list: the host part is looked up as an alias of its own.
pub async fn resolve_jump(jump: &JumpSpec) -> Result<ResolvedHost, AppError> {
    let mut args = Vec::new();
    if let Some(port) = jump.port {
        args.extend(["-p".to_string(), port.to_string()]);
    }
    if let Some(user) = &jump.user {
        args.extend(["-l".to_string(), user.clone()]);
    }
    args.push(jump.host.clone());
    run_dash_g(&args).await
}

/// A name `ssh` will read as a name: not empty, not a flag, no whitespace or
/// control characters that would split it into something else.
fn is_safe_word(word: &str) -> bool {
    !word.is_empty()
        && !word.starts_with('-')
        && !word.chars().any(|c| c.is_whitespace() || c.is_control())
}

async fn run_dash_g(args: &[String]) -> Result<ResolvedHost, AppError> {
    let output = crate::winproc::command("ssh")
        .arg("-G")
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| AppError::Invalid(format!("could not run `ssh -G`: {e}")))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Invalid(format!(
            "`ssh -G {}` failed: {}",
            args.last().map(String::as_str).unwrap_or_default(),
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
            "certificatefile" => out.certificate_files.push(value.to_string()),
            "identitiesonly" => out.identities_only = is_yes(value),
            "forwardagent" => out.forward_agent = is_yes(value),
            // Kept as printed, `none` included: here it is not a placeholder
            // but an instruction — use no agent at all.
            "identityagent" => out.identity_agent = Some(value.to_string()),
            // `ssh -G` prints the literal `none` for these rather than omitting
            // them; taking it at face value would have us run a proxy command
            // called `none`.
            "proxycommand" => out.proxy_command = unset_if_none(value),
            "proxyjump" => out.proxy_jump = unset_if_none(value),
            "hostkeyalias" => out.host_key_alias = unset_if_none(value),
            // Several files on one line, space-separated.
            "userknownhostsfile" => {
                out.user_known_hosts_files = value.split_whitespace().map(String::from).collect()
            }
            "globalknownhostsfile" => {
                out.global_known_hosts_files = value.split_whitespace().map(String::from).collect()
            }
            "stricthostkeychecking" => out.strict_host_key_checking = StrictHostKeys::parse(value),
            "gssapiauthentication" => out.gssapi_authentication = is_yes(value),
            "pkcs11provider" => out.pkcs11_provider = unset_if_none(value),
            // `internal` is OpenSSH's own FIDO support — a key file, which the
            // identity check reads; anything else is a middleware library.
            "securitykeyprovider" => {
                out.security_key_provider =
                    (!value.eq_ignore_ascii_case("internal")).then(|| value.to_string())
            }
            "hostbasedauthentication" => out.hostbased_authentication = is_yes(value),
            "proxyusefdpass" => out.proxy_use_fdpass = is_yes(value),
            "knownhostscommand" => out.known_hosts_command = unset_if_none(value),
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
    fn reads_what_only_the_system_ssh_can_do() {
        // As `ssh -G` prints them for a plain host: nothing asks for it.
        let plain = parse_resolved(
            "gssapiauthentication no\nsecuritykeyprovider internal\nhostbasedauthentication no\nproxyusefdpass no\n",
        );
        assert!(!plain.gssapi_authentication);
        assert_eq!(plain.security_key_provider, None);
        assert!(!plain.hostbased_authentication);
        assert!(!plain.proxy_use_fdpass);
        assert_eq!(plain.pkcs11_provider, None);
        // And for one that does.
        let asks = parse_resolved(
            "gssapiauthentication yes\nsecuritykeyprovider /usr/lib/libsk.so\npkcs11provider /usr/lib/opensc-pkcs11.so\nhostbasedauthentication yes\nproxyusefdpass yes\nknownhostscommand /usr/bin/hosts %H\n",
        );
        assert!(asks.gssapi_authentication);
        assert_eq!(
            asks.security_key_provider.as_deref(),
            Some("/usr/lib/libsk.so")
        );
        assert_eq!(
            asks.pkcs11_provider.as_deref(),
            Some("/usr/lib/opensc-pkcs11.so")
        );
        assert!(asks.hostbased_authentication);
        assert!(asks.proxy_use_fdpass);
        assert_eq!(
            asks.known_hosts_command.as_deref(),
            Some("/usr/bin/hosts %H")
        );
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
        let r = parse_resolved("proxycommand none\nproxyjump none\nhostkeyalias none\n");
        assert_eq!(r.proxy_command, None);
        assert_eq!(r.proxy_jump, None);
        assert_eq!(r.host_key_alias, None);
    }

    #[test]
    fn identity_agent_none_is_kept_because_it_means_use_no_agent() {
        // Unlike the proxy settings, `IdentityAgent none` is an instruction —
        // dropping it would quietly offer the agent the user switched off.
        let r = parse_resolved("identityagent none\n");
        assert_eq!(r.identity_agent.as_deref(), Some("none"));
        assert_eq!(parse_resolved("").identity_agent, None);
    }

    #[test]
    fn reads_the_host_key_settings_ssh_dash_g_prints() {
        // Copied from OpenSSH 10.3 `ssh -G`: two files per line, and `true` /
        // `false` where a config file would say `yes` / `no`.
        let out = "userknownhostsfile /u/.ssh/known_hosts /u/.ssh/known_hosts2\n\
                   globalknownhostsfile /etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2\n\
                   hostkeyalias box-key\n\
                   certificatefile ~/.ssh/id_ed25519-cert.pub\n\
                   stricthostkeychecking true\n";
        let r = parse_resolved(out);
        assert_eq!(
            r.user_known_hosts_files,
            ["/u/.ssh/known_hosts", "/u/.ssh/known_hosts2"]
        );
        assert_eq!(r.global_known_hosts_files.len(), 2);
        assert_eq!(r.host_key_alias.as_deref(), Some("box-key"));
        assert_eq!(r.certificate_files, ["~/.ssh/id_ed25519-cert.pub"]);
        assert_eq!(r.strict_host_key_checking, StrictHostKeys::Yes);

        for (printed, expected) in [
            ("ask", StrictHostKeys::Ask),
            ("false", StrictHostKeys::AcceptNew),
            ("accept-new", StrictHostKeys::AcceptNew),
            ("yes", StrictHostKeys::Yes),
        ] {
            let r = parse_resolved(&format!("stricthostkeychecking {printed}\n"));
            assert_eq!(r.strict_host_key_checking, expected, "{printed}");
        }
    }

    #[test]
    fn jump_lists_are_split_into_hops_in_order() {
        let hops = parse_jumps("bastion, ops@edge:2222,ssh://me@[fe80::1]:22").unwrap();
        assert_eq!(
            hops,
            vec![
                JumpSpec {
                    user: None,
                    host: "bastion".into(),
                    port: None
                },
                JumpSpec {
                    user: Some("ops".into()),
                    host: "edge".into(),
                    port: Some(2222)
                },
                JumpSpec {
                    user: Some("me".into()),
                    host: "fe80::1".into(),
                    port: Some(22)
                },
            ]
        );
        // A hop that cannot be read stops the route: skipping it would dial
        // the target by a path the user never configured.
        assert!(parse_jumps("edge:notaport").is_err());
        assert!(parse_jumps("-oProxyCommand=x").is_err());
        assert!(parse_jumps("").unwrap().is_empty());
    }

    #[test]
    fn a_typed_host_becomes_the_ssh_flags_that_command_line_would_carry() {
        let files = vec!["~/.ssh/work".to_string()];
        let args = typed_args(&TypedHost {
            hostname: "box.lan",
            port: 2222,
            user: "dev",
            identity_files: &files,
            proxy_jump: Some("bastion"),
            proxy_command: None,
            forward_agent: true,
        })
        .unwrap();
        assert_eq!(
            args,
            [
                "-p",
                "2222",
                "-l",
                "dev",
                "-i",
                "~/.ssh/work",
                "-J",
                "bastion",
                "-o",
                "ForwardAgent=yes",
                "box.lan"
            ]
        );
        // A host or user that `ssh` would read as a flag is refused.
        let bad = TypedHost {
            hostname: "-oProxyCommand=calc",
            port: 22,
            user: "",
            identity_files: &[],
            proxy_jump: None,
            proxy_command: None,
            forward_agent: false,
        };
        assert!(typed_args(&bad).is_err());
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

    /// The one thing unit tests cannot cover: that the *real* `ssh` on this
    /// machine is spawned correctly and its real output parses. Ignored by
    /// default because it shells out to the system OpenSSH (same posture as the
    /// live GitHub suite); it resolves an alias only and connects to nothing.
    ///
    /// Run it with:
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored ssh_dash_g`
    #[tokio::test]
    #[ignore = "spawns the system ssh; run explicitly with --ignored"]
    async fn live_ssh_dash_g_resolves_through_the_real_binary() {
        // A name with no config entry: `ssh -G` still answers, from its built-in
        // defaults, so this works on a machine with no `~/.ssh/config` at all.
        let resolved = resolve("example.invalid")
            .await
            .expect("`ssh -G` should resolve even an unconfigured name");

        // What OpenSSH always fills in, and what the app relies on.
        assert_eq!(resolved.hostname, "example.invalid");
        assert_eq!(resolved.port, 22, "default port");
        assert!(!resolved.user.is_empty(), "OpenSSH resolves a login user");
        // The `none` placeholders must never survive as values.
        assert_eq!(resolved.proxy_command, None);
        assert_eq!(resolved.proxy_jump, None);

        println!(
            "live ssh -G → hostname={} port={} user={} identityFiles={} forwardAgent={}",
            resolved.hostname,
            resolved.port,
            resolved.user,
            resolved.identity_files.len(),
            resolved.forward_agent
        );
    }
}
