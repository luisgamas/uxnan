//! Listing directories on a host, so a project that lives there can be found and
//! added.
//!
//! The local file browser walks the filesystem directly (`browse.rs`); there is
//! no filesystem here, only a shell. So this asks the host to enumerate a
//! directory and parses what comes back — one command, delimited output, same
//! technique and the same reason as [`super::inventory`]: a remote command costs
//! seconds, and a chatty (or failing) shell profile must not be mistaken for
//! data.
//!
//! Only directories are returned. Adding a project means choosing a folder, and
//! listing thousands of files the user cannot pick would cost bytes and time to
//! deliver noise.

use super::conn::Connection;
use crate::error::AppError;

const BEGIN: &str = "__UXNAN_LS_BEGIN__";
const END: &str = "__UXNAN_LS_END__";

/// Most entries one listing returns. A home directory with ten thousand folders
/// is unusual but not impossible, and neither the wire nor a picker gains
/// anything from the rest.
const MAX_ENTRIES: usize = 500;

/// A directory on a host.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDir {
    /// Just the folder name, for display.
    pub name: String,
    /// Absolute path on that machine, which is what gets registered.
    pub path: String,
}

/// What a listing produced.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListing {
    /// The directory that was listed, absolute and as the host spells it.
    pub path: String,
    /// The parent, or `None` at the root — so a picker knows whether "up" exists
    /// without having to parse paths for two different operating systems.
    pub parent: Option<String>,
    pub dirs: Vec<RemoteDir>,
    /// True when the listing was cut at [`MAX_ENTRIES`]. Said out loud, because
    /// a picker that silently shows 500 of 3,000 folders is a picker that
    /// cannot find the one you want and will not tell you why.
    pub truncated: bool,
}

/// List the directories inside `path` on a host. An empty `path` means the
/// user's home, which is where a picker should start.
pub async fn list_dirs(conn: &Connection, path: &str) -> Result<RemoteListing, AppError> {
    let path = path.trim();
    // POSIX first, then PowerShell — same order and reasoning as the inventory.
    let posix = conn.exec(&posix_script(path)).await?;
    if let Some(body) = between_markers(&posix.stdout) {
        return parse(body);
    }
    let windows = conn.exec(&powershell_script(path)).await?;
    if let Some(body) = between_markers(&windows.stdout) {
        return parse(body);
    }
    Err(AppError::Invalid(format!(
        "could not list {} on that host",
        if path.is_empty() {
            "the home directory"
        } else {
            path
        }
    )))
}

/// Quote a path for a POSIX shell. Single quotes stop every expansion there is,
/// and the only character that can end them is escaped — a folder named `it's`
/// must not become the end of the argument and the start of a command.
fn posix_quote(path: &str) -> String {
    format!("'{}'", path.replace('\'', r"'\''"))
}

/// Quote a path for PowerShell's single-quoted string, where the escape is a
/// doubled quote.
fn powershell_quote(path: &str) -> String {
    format!("'{}'", path.replace('\'', "''"))
}

fn posix_script(path: &str) -> String {
    // `${VAR:-$HOME}` rather than branching in Rust: the empty case is "wherever
    // this user's home is", and only the host knows that.
    let target = if path.is_empty() {
        "\"$HOME\"".to_string()
    } else {
        posix_quote(path)
    };
    format!(
        "sh -lc 'd={target}; \
         cd \"$d\" 2>/dev/null || exit 1; \
         echo {BEGIN}; \
         printf \"path=%s\\n\" \"$(pwd)\"; \
         printf \"parent=%s\\n\" \"$(dirname \"$(pwd)\")\"; \
         for e in */; do [ -d \"$e\" ] && printf \"dir=%s\\n\" \"${{e%/}}\"; done; \
         echo {END}'"
    )
}

fn powershell_script(path: &str) -> String {
    let target = if path.is_empty() {
        "$env:USERPROFILE".to_string()
    } else {
        powershell_quote(path)
    };
    format!(
        "powershell -NoProfile -NonInteractive -Command \"\
         $d = {target}; \
         if (-not (Test-Path -LiteralPath $d)) {{ exit 1 }}; \
         $i = Get-Item -LiteralPath $d; \
         Write-Output '{BEGIN}'; \
         Write-Output \\\"path=$($i.FullName)\\\"; \
         if ($i.Parent) {{ Write-Output \\\"parent=$($i.Parent.FullName)\\\" }}; \
         Get-ChildItem -LiteralPath $d -Directory -Force -ErrorAction SilentlyContinue | \
         ForEach-Object {{ Write-Output \\\"dir=$($_.Name)\\\" }}; \
         Write-Output '{END}'\""
    )
}

/// Whether a folder on the host is a git repository.
///
/// Asked of the host rather than inferred from the path: only that machine can
/// answer, and a wrong guess would leave a real repository with its git panels
/// permanently empty. A failure to ask is answered `false` — a project that
/// works minus its branches beats refusing to add it.
pub async fn is_git_repo(conn: &Connection, path: &str) -> bool {
    let quoted_posix = posix_quote(path);
    let quoted_ps = powershell_quote(path);
    let posix = format!(
        "sh -lc 'cd {quoted_posix} 2>/dev/null && git rev-parse --is-inside-work-tree 2>/dev/null'"
    );
    if let Ok(out) = conn.exec(&posix).await {
        if out.stdout.contains("true") {
            return true;
        }
    }
    let windows = format!(
        "powershell -NoProfile -NonInteractive -Command \"Set-Location -LiteralPath {quoted_ps};          git rev-parse --is-inside-work-tree 2>$null\""
    );
    matches!(conn.exec(&windows).await, Ok(out) if out.stdout.contains("true"))
}

fn between_markers(stdout: &str) -> Option<&str> {
    let start = stdout.find(BEGIN)? + BEGIN.len();
    let end = stdout[start..].find(END)? + start;
    Some(&stdout[start..end])
}

fn parse(body: &str) -> Result<RemoteListing, AppError> {
    let mut path = String::new();
    let mut parent = None;
    let mut names: Vec<String> = Vec::new();
    let mut truncated = false;

    for line in body.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "path" => path = value.to_string(),
            "parent" => parent = Some(value.to_string()),
            "dir" => {
                if names.len() >= MAX_ENTRIES {
                    truncated = true;
                } else {
                    names.push(value.to_string());
                }
            }
            _ => {}
        }
    }

    if path.is_empty() {
        return Err(AppError::Invalid(
            "the host listed a directory but did not say which".to_string(),
        ));
    }
    // A path is its own parent at the root; reporting that would give a picker an
    // "up" that goes nowhere.
    if parent.as_deref() == Some(path.as_str()) {
        parent = None;
    }

    // Case-insensitive, because the two operating systems disagree about whether
    // `Documents` sorts near `documents` and the user does not care.
    names.sort_by_key(|n| n.to_lowercase());
    let separator = if path.contains('\\') && !path.starts_with('/') {
        '\\'
    } else {
        '/'
    };
    let dirs = names
        .into_iter()
        .map(|name| RemoteDir {
            path: join(&path, &name, separator),
            name,
        })
        .collect();

    Ok(RemoteListing {
        path,
        parent,
        dirs,
        truncated,
    })
}

/// Join with the separator the host itself used, rather than this machine's.
fn join(base: &str, name: &str, separator: char) -> String {
    let trimmed = base.trim_end_matches(['/', '\\']);
    // A POSIX root trims to nothing; keep it a root rather than a relative path.
    if trimmed.is_empty() {
        format!("{separator}{name}")
    } else {
        format!("{trimmed}{separator}{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Against the sshd on this machine: list the home directory, then walk into
    /// one of its folders. Ignored by default.
    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn browse_live_lists_this_machines_home() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the recorded key should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        let home = list_dirs(&conn, "").await.expect("the home directory");
        assert!(!home.path.is_empty());
        println!(
            "live: {} has {} folders (truncated={}), parent={:?}",
            home.path,
            home.dirs.len(),
            home.truncated,
            home.parent
        );
        assert!(home.parent.is_some(), "a home directory has a parent");

        // Walking into a child must produce a listing of *that* folder — the
        // paths we hand back have to be openable on the host, not merely
        // plausible on this one.
        if let Some(child) = home.dirs.first() {
            let inside = list_dirs(&conn, &child.path).await.expect("a subfolder");
            let normalize = |p: &str| p.replace(std::path::MAIN_SEPARATOR, "/").replace('\\', "/");
            assert_eq!(normalize(&inside.path), normalize(&child.path));
            println!(
                "live: walked into {} ({} folders)",
                inside.path,
                inside.dirs.len()
            );
        }
    }

    #[test]
    fn parses_a_posix_listing_and_builds_absolute_paths() {
        let body = "path=/home/dev\nparent=/home\ndir=code\ndir=Documents\n";
        let out = parse(body).unwrap();
        assert_eq!(out.path, "/home/dev");
        assert_eq!(out.parent.as_deref(), Some("/home"));
        assert_eq!(
            out.dirs.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(),
            ["/home/dev/code", "/home/dev/Documents"]
        );
        assert!(!out.truncated);
    }

    #[test]
    fn parses_a_windows_listing_with_its_own_separator() {
        // The separator comes from the host, not from whichever machine is
        // running this code — otherwise a Windows host browsed from Linux would
        // produce paths that host cannot open.
        let body = "path=C:\\Users\\dev\nparent=C:\\Users\ndir=code\n";
        let out = parse(body).unwrap();
        assert_eq!(out.dirs[0].path, "C:\\Users\\dev\\code");
    }

    #[test]
    fn sorts_case_insensitively() {
        let body = "path=/x\ndir=zeta\ndir=Alpha\ndir=beta\n";
        let out = parse(body).unwrap();
        assert_eq!(
            out.dirs.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(),
            ["Alpha", "beta", "zeta"]
        );
    }

    #[test]
    fn a_root_reports_no_parent() {
        // `dirname /` is `/`, and offering "up" from there is an affordance that
        // does nothing.
        let out = parse("path=/\nparent=/\ndir=home\n").unwrap();
        assert_eq!(out.parent, None);
        assert_eq!(out.dirs[0].path, "/home");
    }

    #[test]
    fn a_listing_with_no_path_is_an_error_not_an_empty_folder() {
        // Silence and "this folder is empty" are different answers, and only one
        // of them is true.
        assert!(parse("dir=code\n").is_err());
    }

    #[test]
    fn a_huge_directory_is_cut_and_says_so() {
        let mut body = String::from("path=/x\n");
        for i in 0..(MAX_ENTRIES + 20) {
            body.push_str(&format!("dir=d{i}\n"));
        }
        let out = parse(&body).unwrap();
        assert_eq!(out.dirs.len(), MAX_ENTRIES);
        assert!(out.truncated, "a cut listing must admit it was cut");
    }

    #[test]
    fn a_quote_in_a_path_cannot_end_the_argument() {
        // A folder named `it's` is ordinary. Getting this wrong turns a path into
        // the end of a string and the start of a command.
        assert_eq!(posix_quote("/home/it's"), r"'/home/it'\''s'");
        assert_eq!(powershell_quote("C:\\it's"), "'C:\\it''s'");

        let script = posix_script("/home/dev; rm -rf /");
        // The whole thing stays inside one quoted argument.
        assert!(script.contains(r"'/home/dev; rm -rf /'"), "{script}");
    }

    #[test]
    fn an_empty_path_asks_the_host_where_home_is() {
        // Only the host knows, and hardcoding `/home/<user>` would be wrong on
        // macOS, on Windows, and for any user with a moved home.
        assert!(posix_script("").contains("$HOME"));
        assert!(powershell_script("").contains("$env:USERPROFILE"));
    }
}
