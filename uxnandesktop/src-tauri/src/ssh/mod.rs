//! Remote hosts over SSH: the machine an agent runs on when it is not this one.
//!
//! The model is the one every mature remote client converges on — **the UI stays
//! local, the work happens on the host**. Agents run there, with the CLIs and the
//! credentials that host already has; uxnan is the control surface. Running a
//! local agent against a remotely-mounted filesystem is the arrangement this
//! deliberately does *not* implement: the agent's own tools (build, tests, git)
//! would execute here, against a network mount, which is the opposite of why
//! anyone reaches for a bigger machine.
//!
//! Trust posture, stated once so nothing downstream has to guess: an SSH host is
//! *"my machine, my account"*. A session is worth exactly what the user's shell
//! on that host is worth, so this layer does not claim to impose a permission
//! ceiling — that is a different (and much heavier) design, and pretending
//! otherwise in the UI would be a lie. What it does guarantee is that work lands
//! on the host the user *meant*: see [`crate::target`].
//!
//! Secrets: none are stored. A host record keeps alias, hostname, port, user and
//! a *reference* to an identity file — never a key, never a password. The
//! system's ssh-agent, the key file on disk and an in-memory prompt supply the
//! rest, which is also why `ForwardAgent` matters: it lets git on the remote use
//! the keys held here without a private key ever being copied.

pub mod auth;
pub mod browse;
pub mod config;
pub mod conn;
pub mod hostkey;
pub mod inventory;
pub mod pty;
pub mod registry;

/// Wrap a PowerShell script so no quoting survives to be misread.
///
/// The command we send is interpreted by whatever shell that host's `sshd` is
/// configured to launch — `cmd`, `powershell`, `pwsh`, or a POSIX shell — and
/// each treats quotes and backslashes differently. Hand-escaping a nested
/// command therefore works on the machine it was tested against and quietly
/// produces garbage on the next one. That is not hypothetical: a directory
/// listing came back with a path of a single backslash and no entries, because
/// the escapes never reached PowerShell intact.
///
/// `-EncodedCommand` takes base64 of UTF-16LE. It contains no quotes, no
/// backslashes and no spaces, so an outer shell has nothing left to interpret,
/// and the script inside can quote however it likes.
pub fn powershell_command(script: &str) -> String {
    use base64::Engine;
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    format!("powershell -NoProfile -NonInteractive -EncodedCommand {encoded}")
}

/// Read an encoded command back into the script it carries.
///
/// Only tests need this: once a script is encoded, asserting anything about its
/// contents means decoding it first, and every such assertion would otherwise
/// reimplement the base64 + UTF-16LE pair and get to be wrong in its own way.
#[cfg(test)]
pub fn decode_powershell_command(command: &str) -> String {
    use base64::Engine;
    let encoded = command
        .rsplit(' ')
        .next()
        .expect("an encoded command ends in its payload");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("the payload is base64");
    String::from_utf16_lossy(
        &bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>(),
    )
}

#[cfg(test)]
mod tests {
    use super::{decode_powershell_command, powershell_command};

    #[test]
    fn an_encoded_command_leaves_an_outer_shell_nothing_to_misread() {
        // The whole point: whatever the host's sshd launches — cmd, pwsh, sh —
        // finds only base64, which is [A-Za-z0-9+/=].
        let cmd = powershell_command("Write-Output \"it's a \\ test\"");
        let encoded = cmd.rsplit(' ').next().unwrap();
        assert!(
            encoded
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=')),
            "{encoded}"
        );
        assert!(!cmd.contains('"'), "{cmd}");
        assert!(!cmd.contains('\''), "{cmd}");
        assert!(!cmd.contains('\\'), "{cmd}");
    }

    #[test]
    fn it_encodes_utf16le_which_is_what_powershell_expects() {
        // ASCII "hi" as UTF-16LE is 68 00 69 00 -> "aABpAA==". Wrong width or
        // byte order yields a script PowerShell reads as mojibake.
        assert!(powershell_command("hi").ends_with("aABpAA=="));
    }

    #[test]
    fn what_goes_in_is_what_comes_out() {
        // The round trip is what every other test's decoding depends on, quotes
        // and backslashes included.
        let script = "Write-Output \"it's a \\ test\"";
        assert_eq!(
            decode_powershell_command(&powershell_command(script)),
            script
        );
    }

    #[test]
    fn it_always_skips_the_users_profile() {
        // A profile costs seconds per command and, on a non-interactive session,
        // frequently fails outright.
        let cmd = powershell_command("x");
        assert!(cmd.contains("-NoProfile") && cmd.contains("-NonInteractive"));
    }
}
