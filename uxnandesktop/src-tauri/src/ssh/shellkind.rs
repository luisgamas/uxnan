//! Which shell a host's `sshd` actually starts — asked, never assumed.
//!
//! Everything uxnan sends to a host that is not a bare program goes through that
//! shell, and the families do not share syntax. A user is not going to keep one
//! configured for our convenience: the same machine may answer with `cmd`,
//! PowerShell, WSL or Git Bash depending on what its owner set this week, and
//! that is their business, not ours.
//!
//! Assuming instead of asking has already cost real breakage. The first version
//! of the remote terminal applied its working directory by running
//! `cd /d "…" && cmd` — cmd syntax — so a machine whose `sshd` starts PowerShell
//! answered with a parameter error and closed the channel a second later: every
//! project terminal on that host opened and died, while a terminal with no
//! directory was fine.
//!
//! So the shell is **classified once per connection** with a single probe whose
//! *reply* identifies the family, and every shell-shaped thing we send is chosen
//! from that answer. When the answer is not recognizable the honest outcome is
//! to send nothing at all: a terminal that opens in the host's default directory
//! is a small loss, and a terminal that dies is a broken feature.
//!
//! The longer-term direction is to stop needing this — a small helper running on
//! the host would place a terminal in a directory (and read files, and run git)
//! without any shell being involved. That is the phase-3 design; this module is
//! what makes the SSH-only path correct in the meantime.

use super::conn::Connection;

/// A marker only our probe can produce, so the reply is found in whatever the
/// host's profile prints around it.
const MARKER: &str = "__UXNAN_SH__";

/// The shell families uxnan knows how to talk to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ShellKind {
    /// `bash`, `zsh`, `sh`, `fish` — Linux, macOS, WSL and Git Bash alike.
    Posix,
    /// Windows `cmd.exe`.
    Cmd,
    /// Windows PowerShell 5.1 or PowerShell 7+.
    PowerShell,
    /// The probe came back as something none of the above would say. Nothing is
    /// typed into a shell we could not name.
    #[default]
    Unknown,
}

/// The probe: one line every family accepts, whose *answer* differs per family.
///
/// - a POSIX shell expands `$0` to its own name and leaves `%COMSPEC%` alone;
/// - `cmd` expands `%COMSPEC%` to its own path and leaves `$0` alone;
/// - PowerShell drops the undefined `$0` and leaves `%COMSPEC%` as written.
///
/// The fields are separated by **spaces, not colons**: `$0:` is a parser error
/// in PowerShell (it reads as a drive-qualified variable), which the first
/// version of this probe found out the hard way. Everything here was run in
/// cmd, Windows PowerShell 5.1, pwsh 7, Git Bash and WSL before being written
/// down — the tests below hold their literal replies.
fn probe_command() -> String {
    format!("echo {MARKER} $0 %COMSPEC% {MARKER}")
}

/// Classify from the probe's output. Pure, so every family's real reply is a
/// test rather than a belief.
pub fn classify_output(stdout: &str) -> ShellKind {
    let Some(body) = stdout
        .split_once(MARKER)
        .and_then(|(_, rest)| rest.split_once(MARKER))
        .map(|(body, _)| body)
    else {
        return ShellKind::Unknown;
    };
    // PowerShell's `echo` is Write-Output, which prints each argument on its own
    // line, so the body is read as tokens rather than as fixed fields.
    let tokens: Vec<&str> = body.split_whitespace().collect();

    // cmd is the only family that expands `%COMSPEC%` — to itself.
    if tokens
        .iter()
        .any(|t| t.to_ascii_lowercase().ends_with("cmd.exe"))
    {
        return ShellKind::Cmd;
    }
    // A POSIX shell expanded `$0` to its own name: `/usr/bin/bash` (Git Bash),
    // `bash` (WSL), `-zsh` (a login shell on macOS).
    const POSIX_SHELLS: [&str; 6] = ["sh", "bash", "zsh", "fish", "dash", "ksh"];
    let looks_posix = tokens.iter().any(|t| {
        let name = t.rsplit('/').next().unwrap_or(t).trim_start_matches('-');
        POSIX_SHELLS.contains(&name)
    });
    if looks_posix {
        return ShellKind::Posix;
    }
    // PowerShell dropped the undefined `$0` and left `%COMSPEC%` as written, so
    // the unexpanded variable is all that sits between the markers.
    if tokens.iter().any(|t| t.eq_ignore_ascii_case("%COMSPEC%")) {
        return ShellKind::PowerShell;
    }
    ShellKind::Unknown
}

/// Ask a host which shell its `sshd` starts. One `exec`, so it costs a single
/// round trip and nothing appears in any terminal the user is looking at.
pub async fn classify(conn: &Connection) -> ShellKind {
    match conn.exec(&probe_command()).await {
        Ok(out) => classify_output(&out.stdout),
        // A host that will not answer the probe is a host we will not type into.
        Err(_) => ShellKind::Unknown,
    }
}

/// What to type so a shell of this family moves to `path` — or `None` when we
/// could not name the shell, which is the case where typing anything is a guess.
///
/// Every line here was run against the real shell before being written down:
/// `cmd`, Windows PowerShell 5.1 and pwsh 7 all land in the folder, and the
/// POSIX form is the ordinary quoted `cd`.
pub fn cd_line(kind: ShellKind, path: &str) -> Option<String> {
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    match kind {
        // Single quotes stop every expansion there is, and the only character
        // that can end them is escaped — a folder named `it's` must not become
        // the end of the argument and the start of a command.
        ShellKind::Posix => Some(format!("cd '{}'\n", path.replace('\'', r"'\''"))),
        // The drive letter is its own command in cmd, and `cd` alone will not
        // change drive; both lines are needed.
        ShellKind::Cmd => {
            let drive = drive_letter(path)
                .map(|d| format!("{d}:\r\n"))
                .unwrap_or_default();
            Some(format!("{drive}cd \"{path}\"\r\n"))
        }
        // `-LiteralPath` so a bracket in a path is a bracket, not a wildcard.
        ShellKind::PowerShell => Some(format!("Set-Location -LiteralPath \"{path}\"\r\n")),
        ShellKind::Unknown => None,
    }
}

/// The drive of a Windows path, when it has one (a UNC path does not).
fn drive_letter(path: &str) -> Option<char> {
    let mut chars = path.chars();
    let first = chars.next()?;
    (chars.next() == Some(':') && first.is_ascii_alphabetic()).then_some(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The literal replies each shell gave when the probe was run in it. Not
    /// what they seemed like they should say — what they said.
    #[test]
    fn every_family_is_recognised_from_its_own_answer() {
        // cmd.exe /c
        assert_eq!(
            classify_output(r"__UXNAN_SH__ $0 C:\WINDOWS\system32\cmd.exe __UXNAN_SH__"),
            ShellKind::Cmd
        );
        // Windows PowerShell 5.1 and pwsh 7 both answer this way: `echo` is
        // Write-Output, the undefined $0 disappears, and each argument lands on
        // its own line.
        assert_eq!(
            classify_output("__UXNAN_SH__\r\n%COMSPEC%\r\n__UXNAN_SH__\r\n"),
            ShellKind::PowerShell
        );
        // Git Bash on Windows.
        assert_eq!(
            classify_output("__UXNAN_SH__ /usr/bin/bash %COMSPEC% __UXNAN_SH__\n"),
            ShellKind::Posix
        );
        // WSL.
        assert_eq!(
            classify_output("__UXNAN_SH__ bash %COMSPEC% __UXNAN_SH__\n"),
            ShellKind::Posix
        );
        // A login shell on macOS prefixes a dash.
        assert_eq!(
            classify_output("__UXNAN_SH__ -zsh %COMSPEC% __UXNAN_SH__\n"),
            ShellKind::Posix
        );
    }

    #[test]
    fn a_chatty_profile_around_the_answer_changes_nothing() {
        // The reason the marker exists: plenty of profiles print a banner, and
        // one of them printing the word `bash` must not be read as the answer.
        let noisy = "Welcome to the machine\nMOTD: cmd.exe is not installed here\n\
                     __UXNAN_SH__ /bin/sh %COMSPEC% __UXNAN_SH__\nhave a nice day\n";
        assert_eq!(classify_output(noisy), ShellKind::Posix);
    }

    #[test]
    fn an_unrecognisable_answer_is_unknown_rather_than_a_guess() {
        assert_eq!(classify_output(""), ShellKind::Unknown);
        assert_eq!(classify_output("no marker here"), ShellKind::Unknown);
        // Half an answer is not an answer.
        assert_eq!(
            classify_output("__UXNAN_SH__:$0:%COMSPEC%"),
            ShellKind::Unknown
        );
    }

    #[test]
    fn nothing_is_typed_into_a_shell_we_could_not_name() {
        // The whole point of the Unknown arm: a terminal that opens in the home
        // directory is a small loss; one that dies on syntax is a broken feature.
        assert_eq!(cd_line(ShellKind::Unknown, "/home/dev"), None);
        assert_eq!(cd_line(ShellKind::Posix, "   "), None);
    }

    #[test]
    fn each_family_gets_the_line_it_understands() {
        assert_eq!(
            cd_line(ShellKind::Posix, "/home/dev/app").unwrap(),
            "cd '/home/dev/app'\n"
        );
        assert_eq!(
            cd_line(ShellKind::Cmd, r"C:\Users\Gamas\code").unwrap(),
            "C:\r\ncd \"C:\\Users\\Gamas\\code\"\r\n"
        );
        assert_eq!(
            cd_line(ShellKind::PowerShell, r"C:\Users\Gamas\code").unwrap(),
            "Set-Location -LiteralPath \"C:\\Users\\Gamas\\code\"\r\n"
        );
        // A UNC path has no drive to switch to.
        let unc = cd_line(ShellKind::Cmd, r"\\wsl$\Ubuntu\home\dev").unwrap();
        assert!(unc.starts_with("cd \""), "{unc}");
    }

    #[test]
    fn a_quote_in_a_posix_path_cannot_end_the_argument() {
        assert_eq!(
            cd_line(ShellKind::Posix, "/home/it's/app").unwrap(),
            "cd '/home/it'\\''s/app'\n"
        );
    }

    #[test]
    fn the_probe_carries_its_marker_twice() {
        // Once would let a profile that echoes the command line look like a
        // reply; the body is what sits *between* them.
        let probe = probe_command();
        assert_eq!(probe.matches(MARKER).count(), 2, "{probe}");
    }
}
