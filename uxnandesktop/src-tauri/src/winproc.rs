//! Spawn helper that suppresses the console window Windows would otherwise
//! allocate for every child process.
//!
//! A packaged build runs under the Windows `windows` subsystem (see
//! `main.rs`'s `windows_subsystem = "windows"`), so it has no console of its
//! own. When such a GUI process spawns a console-subsystem child (`git`,
//! `wsl.exe`, an agent CLI), Windows allocates a brand-new console **window** for
//! the child unless `CREATE_NO_WINDOW` is set. With the app launching `git` on a
//! timer (the status watcher) and probing agent CLIs for model discovery, those
//! windows flash open and shut in a cascade — visible only in the installed app,
//! never in `cargo tauri dev` (a debug build keeps a console the children
//! inherit). Setting `CREATE_NO_WINDOW` makes every child run windowless.
//!
//! Use [`command`] instead of `tokio::process::Command::new` for any child the
//! app spawns. PTY-hosted shells are unaffected: they run under ConPTY, which is
//! already windowless. The flag is a no-op off Windows.

use std::ffi::OsStr;

use tokio::process::Command;

/// `CREATE_NO_WINDOW` (winbase.h) — run the child without a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build a [`tokio::process::Command`] for `program` that never pops a console
/// window on Windows. Behaves exactly like `Command::new(program)` everywhere
/// else.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_command_for_the_given_program() {
        // The flag is opaque (not readable back through the public API), so the
        // observable contract is just "same program as `Command::new`". On
        // Windows the `creation_flags` call must also compile and not panic.
        let cmd = command("git");
        assert_eq!(cmd.as_std().get_program(), OsStr::new("git"));
    }
}
