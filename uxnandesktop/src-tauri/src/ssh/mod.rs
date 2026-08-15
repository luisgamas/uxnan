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
pub mod git;
pub mod hostkey;
pub mod inventory;
pub mod pty;
pub mod registry;
pub mod sftp;
pub mod shellkind;
// The live suite that runs this whole stack against a Linux host in a container
// (`docker/ssh-test-host/`). Test-only: it exists to cover the POSIX branches
// that the machine running the tests — Windows — can never reach.
#[cfg(test)]
mod testhost;

/// Base64 (UTF-16LE) of a PowerShell script — the payload both wrappers below
/// carry.
///
/// The command we send is interpreted by whatever shell that host's `sshd` is
/// configured to launch — `cmd`, `powershell`, `pwsh`, or a POSIX shell — and
/// each treats quotes and backslashes differently. Hand-escaping a nested
/// command therefore works on the machine it was tested against and quietly
/// produces garbage on the next one. That is not hypothetical: a directory
/// listing came back with a path of a single backslash and no entries, because
/// the escapes never reached PowerShell intact.
///
/// Base64 of UTF-16LE contains no quotes, no backslashes and no spaces, so an
/// outer shell has nothing left to interpret and the script inside can quote
/// however it likes.
fn powershell_payload(script: &str) -> String {
    use base64::Engine;
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect();
    base64::engine::general_purpose::STANDARD.encode(utf16)
}

/// Run a PowerShell script **in the PowerShell the host already started**.
///
/// Used when the host reported that its shell *is* PowerShell (`shellkind`), and
/// it names no interpreter at all — which is the point. Naming one meant writing
/// `powershell`, i.e. Windows PowerShell **5.1**, so a host running pwsh 7 had a
/// second, older engine started inside the one it already had. The user's shell
/// is the host's business, not ours.
///
/// It decodes the same payload the `-EncodedCommand` switch would have taken,
/// with the same immunity to the outer quoting. `Invoke-Expression` here is not
/// the eval the security rules forbid: the string is one this process built and
/// encoded, from the app's own catalog, and every interpolated name has already
/// been through `inventory::safe_command`. It is exactly what
/// `-EncodedCommand` does, spelled out because we are not starting a new
/// interpreter to do it.
pub fn powershell_inline(script: &str) -> String {
    let payload = powershell_payload(script);
    format!(
        "$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('{payload}'));         Invoke-Expression $s"
    )
}

/// Run a PowerShell script from a host whose shell is **not** PowerShell (cmd).
///
/// Here an interpreter has to be named, so it asks for **`pwsh` first** and only
/// falls back to Windows PowerShell — the reverse of what this code did before,
/// which always started 5.1 even on a machine whose owner had installed 7. The
/// `||` costs nothing when `pwsh` is there, and cmd's "not recognized" complaint
/// goes to stderr, which callers read separately from the output they parse.
pub fn powershell_command(script: &str) -> String {
    let payload = powershell_payload(script);
    format!(
        "pwsh -NoProfile -NonInteractive -EncodedCommand {payload} ||          powershell -NoProfile -NonInteractive -EncodedCommand {payload}"
    )
}

/// Read an encoded command back into the script it carries.
///
/// Only tests need this: once a script is encoded, asserting anything about its
/// contents means decoding it first, and every such assertion would otherwise
/// reimplement the base64 + UTF-16LE pair and get to be wrong in its own way.
#[cfg(test)]
pub fn decode_powershell_command(command: &str) -> String {
    use base64::Engine;
    // Either shape: `… -EncodedCommand <payload>` (which repeats, so the last
    // one is as good as the first) or the inline decoder's `'<payload>'`.
    let encoded = match command.split_once("FromBase64String('") {
        Some((_, rest)) => {
            rest.split_once('\'')
                .expect("the inline form quotes its payload")
                .0
        }
        None => command
            .rsplit(' ')
            .next()
            .expect("an encoded command ends in its payload"),
    };
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
    use super::{decode_powershell_command, powershell_command, powershell_inline};

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

    #[test]
    fn a_named_interpreter_asks_for_pwsh_before_windows_powershell() {
        // The reverse of what this used to do. A machine whose owner installed
        // PowerShell 7 should not have 5.1 started inside it just because that
        // is the name this code happened to know.
        let cmd = powershell_command("x");
        let pwsh = cmd.find("pwsh ").expect("pwsh is offered");
        let legacy = cmd.find("powershell -").expect("5.1 is the fallback");
        assert!(pwsh < legacy, "{cmd}");
    }

    #[test]
    fn the_inline_form_names_no_interpreter_at_all() {
        // For a host whose shell already *is* PowerShell: no second engine, no
        // guess about which one is installed — it runs in the one the host
        // started, whatever version that is.
        let cmd = powershell_inline("Write-Output 'hi'");
        assert!(!cmd.contains("pwsh"), "{cmd}");
        assert!(!cmd.contains("powershell"), "{cmd}");
        assert!(cmd.contains("FromBase64String"), "{cmd}");
    }

    #[test]
    fn the_inline_form_still_survives_an_outer_shell() {
        // Its only quoting is the pair around the payload, and the payload is
        // base64 — so there is nothing inside for the outer layer to end early.
        let script = "Write-Output \"it's a \\ test\"";
        let cmd = powershell_inline(script);
        assert!(!cmd.contains('"'), "{cmd}");
        assert!(!cmd.contains('\\'), "{cmd}");
        // Exactly the pair that wraps the payload, and nothing else.
        assert_eq!(cmd.matches('\'').count(), 2, "{cmd}");
        assert_eq!(decode_powershell_command(&cmd), script);
    }
}
