//! What a host actually has: its OS, its real `PATH`, and which agent CLIs are
//! installed there.
//!
//! This is what turns "I opened a terminal" into "I know what I can offer you
//! here" — the launcher lists the agents this machine has, not the ones the
//! user's own machine has.
//!
//! # One command, not one per fact
//!
//! Measured on a real Windows host over a tailnet, a single `exec` costs ~2.1 s
//! because the remote sshd starts its shell (and loads the user's profile) for
//! every command. Ten facts in ten commands would be ~21 s; in one, ~2 s. So the
//! probe is **one** command whose output is delimited by markers, and everything
//! is parsed out of that.
//!
//! Markers matter for a second reason: a remote shell profile prints things, and
//! on Windows it frequently *fails* over a non-interactive session
//! (`Set-PSReadLineOption` has no console) and writes to stderr. Reading only
//! what sits between the markers means that noise cannot be mistaken for an
//! answer. `path_env.rs` uses the same technique locally, for the same reason.
//!
//! # Two shells, because a host is not always POSIX
//!
//! What `sshd` does with our command string depends on the host's configured
//! shell. A POSIX probe is tried first and, when its marker does not come back,
//! a PowerShell one — Windows hosts are common enough (and this app's own users
//! are on them) that treating them as the exotic case would be backwards.

use std::collections::HashMap;

use super::conn::Connection;
use super::shellkind::ShellKind;
use crate::error::AppError;

/// Wraps the payload so profile noise before or after it cannot be read as data.
const BEGIN: &str = "__UXNAN_INV_BEGIN__";
const END: &str = "__UXNAN_INV_END__";

/// What a host reported about itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInventory {
    /// `linux`, `darwin`, `windows`, or whatever the host called itself.
    pub os: String,
    /// The user's home directory on that machine.
    pub home: String,
    /// `git version 2.47.0`, or empty when git is not installed — which is worth
    /// knowing before offering to clone anything.
    pub git: String,
    /// A terminal multiplexer, if one is there. Its presence is what decides
    /// whether a session can outlive a disconnection.
    pub multiplexer: String,
    /// Agent CLI id → version string. Absent means "not installed here", which
    /// is exactly what the launcher needs in order to stop offering it.
    pub agents: HashMap<String, String>,
    /// Which shell answered, for the troubleshooting view.
    pub shell: String,
}

/// Ask a host about itself. `agent_commands` are the CLI names to look for —
/// passed in rather than hardcoded so the catalog stays in one place.
pub async fn probe(
    conn: &Connection,
    agent_commands: &[String],
    shell: ShellKind,
) -> Result<HostInventory, AppError> {
    // The host already said which shell it starts, back when it connected
    // (`shellkind`). Taking that answer costs one round trip instead of two:
    // this used to try POSIX first and fall back, so every Windows host paid for
    // a failed command before the real one — ~2s each on a real host (§5.3).
    match shell {
        ShellKind::Posix => {
            let out = conn.exec(&posix_script(agent_commands)).await?;
            if let Some(body) = between_markers(&out.stdout) {
                return Ok(parse(body, "posix"));
            }
        }
        // Its shell *is* PowerShell, so the script runs in that one — no second
        // interpreter started, and no assumption about which one is installed.
        ShellKind::PowerShell => {
            let out = conn
                .exec(&super::powershell_inline(&powershell_body(agent_commands)))
                .await?;
            if let Some(body) = between_markers(&out.stdout) {
                return Ok(parse(body, "powershell"));
            }
        }
        // cmd cannot run the script itself, so one has to be named — `pwsh`
        // first, Windows PowerShell only as the fallback.
        ShellKind::Cmd => {
            let out = conn.exec(&powershell_script(agent_commands)).await?;
            if let Some(body) = between_markers(&out.stdout) {
                return Ok(parse(body, "powershell"));
            }
        }
        // Nobody could name it, so both are tried — the old behaviour, kept for
        // the case it was written for instead of applied to every host.
        ShellKind::Unknown => {
            let posix = conn.exec(&posix_script(agent_commands)).await?;
            if let Some(body) = between_markers(&posix.stdout) {
                return Ok(parse(body, "posix"));
            }
            let windows = conn.exec(&powershell_script(agent_commands)).await?;
            if let Some(body) = between_markers(&windows.stdout) {
                return Ok(parse(body, "powershell"));
            }
        }
    }

    Err(AppError::Invalid(
        "the host answered, but not in a shape this build understands — neither a          POSIX shell nor PowerShell produced the expected output"
            .to_string(),
    ))
}

/// Sanitize a command name before it is interpolated into a shell script.
///
/// The names come from the app's own agent catalog, not from the network, but
/// they end up inside a remote command line and that is exactly the place where
/// "it can only ever be one of ours" stops being true after one refactor.
fn safe_command(name: &str) -> Option<&str> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    ok.then_some(name)
}

fn posix_script(agent_commands: &[String]) -> String {
    let mut probes = String::new();
    for name in agent_commands.iter().filter_map(|c| safe_command(c)) {
        // `command -v` first: asking a missing binary for its version prints an
        // error and costs a process for nothing.
        probes.push_str(&format!(
            "if command -v {name} >/dev/null 2>&1; then \
             printf 'agent.{name}=%s\\n' \"$({name} --version 2>/dev/null | head -n1)\"; fi\n"
        ));
    }
    // A *login* shell, so the PATH is the one the user really has: version
    // managers (nvm, mise, fnm) only exist in an interactive/login environment,
    // and this is the single biggest reason a remote CLI looks "not installed".
    format!(
        "sh -lc '\
         echo {BEGIN}; \
         printf \"os=%s\\n\" \"$(uname -s 2>/dev/null | tr \"[:upper:]\" \"[:lower:]\")\"; \
         printf \"home=%s\\n\" \"$HOME\"; \
         printf \"git=%s\\n\" \"$(git --version 2>/dev/null)\"; \
         if command -v tmux >/dev/null 2>&1; then echo multiplexer=tmux; \
         elif command -v zellij >/dev/null 2>&1; then echo multiplexer=zellij; fi; \
         {probes} \
         echo {END}'"
    )
}

fn powershell_body(agent_commands: &[String]) -> String {
    let mut probes = String::new();
    for name in agent_commands.iter().filter_map(|c| safe_command(c)) {
        probes.push_str(&format!(
            "$c = Get-Command {name} -ErrorAction SilentlyContinue
             if ($c) {{ $v = (& {name} --version 2>$null | Select-Object -First 1)
                        Write-Output \"agent.{name}=$v\" }}
"
        ));
    }
    // Encoded rather than hand-quoted: the outer shell differs per host, and
    // escaping for one of them silently corrupts the script on another.
    format!(
        "Write-Output '{BEGIN}'
         Write-Output \"os=windows\"
         Write-Output \"home=$env:USERPROFILE\"
         $g = (git --version 2>$null); Write-Output \"git=$g\"
         {probes}
         Write-Output '{END}'"
    )
}

/// The same script, wrapped for a host whose shell cannot run it (cmd).
fn powershell_script(agent_commands: &[String]) -> String {
    super::powershell_command(&powershell_body(agent_commands))
}

/// The payload between the markers, or `None` when the host never emitted them.
fn between_markers(stdout: &str) -> Option<&str> {
    let start = stdout.find(BEGIN)? + BEGIN.len();
    let end = stdout[start..].find(END)? + start;
    Some(&stdout[start..end])
}

/// Parse `key=value` lines. Unknown keys are ignored rather than rejected: a
/// newer probe talking to this parser should degrade, not fail.
fn parse(body: &str, shell: &str) -> HostInventory {
    let mut out = HostInventory {
        shell: shell.to_string(),
        ..Default::default()
    };
    for line in body.lines() {
        let line = line.trim();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "os" => out.os = value,
            "home" => out.home = value,
            "git" => out.git = value,
            "multiplexer" => out.multiplexer = value,
            other => {
                if let Some(agent) = other.strip_prefix("agent.") {
                    out.agents.insert(agent.to_string(), value);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Against the sshd on this machine. Ignored by default; it authenticates
    /// through the system agent, so it needs a key that host authorizes.
    ///
    /// `cargo test --manifest-path uxnandesktop/src-tauri/Cargo.toml -- --ignored inventory_live --nocapture`
    /// The script a **PowerShell host** receives, run through a real PowerShell.
    ///
    /// That path cannot be exercised over this machine's `sshd` (it starts cmd),
    /// so this checks the half that can go wrong on its own: whether the inline
    /// form is valid PowerShell and produces the markers. What is left for a
    /// real pwsh host to confirm is only that `sshd` passes it through intact.
    #[test]
    #[ignore = "needs pwsh on PATH"]
    fn the_inline_script_is_valid_powershell() {
        let inline = super::super::powershell_inline(&powershell_body(&["git".into()]));
        let out = std::process::Command::new("pwsh")
            .args(["-NoProfile", "-NonInteractive", "-Command", &inline])
            .output()
            .expect("pwsh should be on PATH for this test");
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            between_markers(&stdout).is_some(),
            "no markers.
stdout: {stdout}
stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let inv = parse(between_markers(&stdout).unwrap(), "powershell");
        assert_eq!(inv.os, "windows");
        assert!(!inv.home.is_empty(), "the host's home must come back");
        println!("inline via pwsh: home={} git={:?}", inv.home, inv.git);
    }

    #[tokio::test]
    #[ignore = "needs a local sshd that authorizes a key in the agent"]
    async fn inventory_live_reports_what_this_machine_has() {
        use crate::ssh::auth::{authenticate, AuthOutcome, Credential};
        use crate::ssh::conn::{connect, Endpoint, Handshake};
        use crate::ssh::hostkey;

        let user = std::env::var("UXNAN_SSH_TEST_USER")
            .or_else(|_| std::env::var("USERNAME"))
            .expect("a username");
        let endpoint = Endpoint::new("127.0.0.1", 22);
        let Ok(Handshake::Unknown { key, .. }) = connect(endpoint.clone(), "").await else {
            panic!("expected an unknown host on an empty known_hosts");
        };
        let trusted = hostkey::trust_line("127.0.0.1", 22, &key);
        let Ok(Handshake::Ready(mut conn)) = connect(endpoint, &trusted).await else {
            panic!("the key just recorded should verify");
        };
        match authenticate(&mut conn, &user, &[Credential::Agent])
            .await
            .unwrap()
        {
            AuthOutcome::Success { .. } => {}
            other => panic!("authenticate with the agent first: {other:?}"),
        }

        // Ask the host which shell it starts, exactly as the app does, and probe
        // in that dialect — the test would otherwise prove a path the app no
        // longer takes.
        let shell = crate::ssh::shellkind::classify(&conn).await;
        let started = std::time::Instant::now();
        let inv = probe(
            &conn,
            &["git".into(), "node".into(), "claude".into()],
            shell,
        )
        .await
        .expect("the host should answer");
        println!("inventory: the host reported {shell:?}");
        println!(
            "inventory via {} in {} ms: os={} home={} git={:?} multiplexer={:?} agents={:?}",
            inv.shell,
            started.elapsed().as_millis(),
            inv.os,
            inv.home,
            inv.git,
            inv.multiplexer,
            inv.agents,
        );
        assert!(
            !inv.os.is_empty(),
            "the OS is the one answer that must arrive"
        );
        assert!(!inv.home.is_empty(), "and the home directory");
    }

    #[test]
    fn reads_only_what_sits_between_the_markers() {
        // The case this exists for: a remote profile that prints before our
        // payload and errors after it. Neither may be read as an answer.
        let stdout = format!(
            "Loading profile...\nos=ignored-noise\n{BEGIN}\nos=linux\nhome=/home/dev\n{END}\nos=more-noise\n"
        );
        let inv = parse(between_markers(&stdout).unwrap(), "posix");
        assert_eq!(inv.os, "linux");
        assert_eq!(inv.home, "/home/dev");
    }

    #[test]
    fn output_without_markers_is_not_an_answer() {
        assert!(between_markers("os=linux\nhome=/home/dev").is_none());
        assert!(between_markers(&format!("{BEGIN} truncated")).is_none());
    }

    #[test]
    fn collects_agents_with_their_versions() {
        let body = "os=linux\nagent.claude=2.1.0\nagent.codex=codex-cli 0.130.0\n";
        let inv = parse(body, "posix");
        assert_eq!(inv.agents.get("claude").map(String::as_str), Some("2.1.0"));
        assert_eq!(
            inv.agents.get("codex").map(String::as_str),
            Some("codex-cli 0.130.0")
        );
        // An agent that is not there is simply absent — which is what lets the
        // launcher stop offering it instead of offering it and failing.
        assert!(!inv.agents.contains_key("opencode"));
    }

    #[test]
    fn empty_values_are_dropped_rather_than_stored_as_blanks() {
        // `git=` means git is not installed; storing "" and storing nothing must
        // not be two different states downstream.
        let inv = parse("os=linux\ngit=\nmultiplexer=\n", "posix");
        assert!(inv.git.is_empty());
        assert!(inv.multiplexer.is_empty());
    }

    #[test]
    fn unknown_keys_are_ignored_not_fatal() {
        let inv = parse("os=linux\nfuture.thing=1\nnot a pair\n", "posix");
        assert_eq!(inv.os, "linux");
    }

    #[test]
    fn command_names_that_could_escape_a_shell_line_are_refused() {
        // These come from our own catalog today. "Today" is the word that stops
        // being true after a refactor, and this string lands in a remote shell.
        assert_eq!(safe_command("claude"), Some("claude"));
        assert_eq!(safe_command("agy"), Some("agy"));
        assert_eq!(safe_command("claude-code_1.2"), Some("claude-code_1.2"));
        assert_eq!(safe_command("rm -rf /"), None);
        assert_eq!(safe_command("a;b"), None);
        assert_eq!(safe_command("$(whoami)"), None);
        assert_eq!(safe_command("`id`"), None);
        assert_eq!(safe_command(""), None);
    }

    #[test]
    fn a_refused_name_never_reaches_the_script() {
        let script = posix_script(&["claude".into(), "evil; rm -rf /".into()]);
        assert!(script.contains("claude"));
        assert!(!script.contains("rm -rf"));
        // The encoded form hides the text, so decode it back to check.
        let decoded = super::super::decode_powershell_command(&powershell_script(&[
            "claude".into(),
            "evil; rm -rf /".into(),
        ]));
        assert!(decoded.contains("claude"), "{decoded}");
        assert!(!decoded.contains("rm -rf"), "{decoded}");
    }

    #[test]
    fn the_posix_probe_asks_a_login_shell() {
        // Without `-l` the PATH is the non-interactive one, where nvm/mise/fnm
        // do not exist — the single most common reason a remote CLI looks
        // uninstalled when it is right there.
        assert!(posix_script(&[]).starts_with("sh -lc"));
    }

    #[test]
    fn the_windows_probe_skips_the_user_profile() {
        // The profile is what makes each remote command cost seconds, and it
        // frequently fails outright on a non-interactive session.
        let script = powershell_script(&[]);
        assert!(script.contains("-NoProfile"), "{script}");
        assert!(script.contains("-NonInteractive"), "{script}");
        // And nothing an outer shell could reinterpret on the way there.
        assert!(!script.contains('"'), "{script}");
    }
}
