//! L3 — backend integration: the terminal identity this process inherited must
//! not reach a real child process.
//!
//! The unit tests in `launchenv.rs` prove the key list and that a `Command` is
//! marked up correctly. Only an actual `fork`/`CreateProcess` proves the thing
//! the bug was about: a CLI the app spawns inherits the *operating system's*
//! copy of the environment, not a Rust struct. This runs the platform's own
//! "print my environment" command twice — before and after the scrub — so the
//! first half proves the leak is real and the second proves it is closed.
//!
//! It lives in a file of its own because it mutates the process environment,
//! which is global: each integration test file is its own binary, and this is
//! the only test in it, so nothing else can be running while it does.

use std::process::Command;

/// The platform's command that dumps the whole environment to stdout.
fn print_env() -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/c", "set"]);
        c
    } else {
        Command::new("env")
    }
}

fn env_dump() -> String {
    let out = print_env().output().expect("could not read a child's env");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn a_child_cannot_see_the_terminal_identity_this_process_inherited() {
    // A value no real environment would contain, so a hit is unambiguous.
    const PHANTOM: &str = "phantom-terminal-4a7f1e";

    std::env::set_var("UXNAN_AGENT_ID", PHANTOM);
    std::env::set_var("UXNAN_HOOK_TOKEN", PHANTOM);
    // A deliberate override must survive the scrub — it steers this process and
    // is not terminal identity.
    std::env::set_var("UXNAN_DATA_DIR", PHANTOM);

    // Control: without the scrub the leak is real. If this ever stops holding,
    // the rest of the test proves nothing and should fail loudly rather than
    // pass vacuously.
    assert!(
        env_dump().contains(PHANTOM),
        "a child does not inherit the environment — this test can prove nothing"
    );

    uxnan_desktop_lib::launchenv::scrub_process();

    let dump = env_dump();
    for key in uxnan_desktop_lib::launchenv::PER_TERMINAL_KEYS {
        assert!(
            !dump.contains(&format!("{key}={PHANTOM}")),
            "{key} still reaches a spawned child"
        );
    }
    assert!(
        dump.contains(&format!("UXNAN_DATA_DIR={PHANTOM}")),
        "the disposable-profile override must survive the scrub"
    );

    std::env::remove_var("UXNAN_DATA_DIR");
}
