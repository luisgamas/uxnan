//! The environment keys that identify **one terminal of one launch**, and why
//! nothing the app spawns may inherit them.
//!
//! [`crate::commands::pty_create`] injects a terminal's coordinates into the
//! shell it spawns: `UXNAN_AGENT_ID` (that terminal's id), the hook server's
//! url and token, the endpoint file, and the browser / MCP endpoints. An agent
//! running in that shell reports its state by echoing them back, which is what
//! maps a report to the tab that owns it.
//!
//! Environment variables travel down the **whole** process tree, so those
//! coordinates outlive the terminal they describe. Run the app from inside a
//! uxnan terminal — which is exactly what `npm run tauri dev` is — and the dev
//! process inherits the *installed* app's hook server plus the id of the terminal
//! it was launched from. Every CLI that process then spawns headless (an AI
//! commit message, a conversation title, an automation step — all of
//! [`crate::agentrun`]) inherits them in turn, and its own hook reports to the
//! *other* app claiming to **be** that terminal: a phantom agent card on a
//! terminal that only ever ran a dev server, its unread/needs-you badges, and a
//! provider session stamped on the tab that a later restore would try to resume.
//! The same leak turns any nested run into a lie about its parent — an agent that
//! shells out to another CLI would repaint its own terminal with that CLI's brand.
//!
//! They are therefore scrubbed twice, because the two passes fail differently:
//! [`scrub_process`] drops them from this process at startup, so nothing can
//! inherit what the process no longer has (it covers children spawned by code
//! that never heard of this module); [`scrub_command`] drops them per child in
//! [`crate::winproc::command`], so a child stays clean even if some later code
//! path puts them back on the process. A caller that genuinely wants to hand a
//! child its own coordinates still can: an explicit `.env(…)` after the scrub
//! wins, exactly as it does for any other key.
//!
//! `UXNAN_DATA_DIR` and `UXNAN_SHELL` are deliberately **not** on the list. They
//! are overrides a human (or a benchmark harness) sets on purpose to steer this
//! process, not identity handed out per terminal — scrubbing them would break the
//! disposable-profile launch that [`crate::datadir`] documents.

/// Per-launch, per-terminal identity the ADE injects into the shells it spawns.
/// Inheriting any of these makes a process impersonate a terminal it is not.
pub const PER_TERMINAL_KEYS: &[&str] = &[
    "UXNAN_AGENT_ID",
    "UXNAN_HOOK_URL",
    "UXNAN_HOOK_TOKEN",
    "UXNAN_ENDPOINT_FILE",
    "UXNAN_BROWSER_URL",
    "UXNAN_BROWSER_TOKEN",
    "UXNAN_MCP_URL",
    "UXNAN_MCP_TOKEN",
];

/// Drop the inherited terminal identity from **this** process. Call it first
/// thing in `main`, before any thread exists: the app builds its own hook server
/// and never reads these from its environment, so whatever a parent handed down
/// can only be a mislabel waiting to happen.
pub fn scrub_process() {
    for key in PER_TERMINAL_KEYS {
        std::env::remove_var(key);
    }
}

/// Drop the same keys from a child's environment.
pub fn scrub_command(cmd: &mut tokio::process::Command) {
    for key in PER_TERMINAL_KEYS {
        cmd.env_remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_every_key_pty_create_injects() {
        // The identity keys `pty_create` pushes into a terminal's environment.
        // A new one added there without landing here leaks on the next dev run.
        for key in [
            "UXNAN_AGENT_ID",
            "UXNAN_HOOK_URL",
            "UXNAN_HOOK_TOKEN",
            "UXNAN_ENDPOINT_FILE",
            "UXNAN_BROWSER_URL",
            "UXNAN_BROWSER_TOKEN",
            "UXNAN_MCP_URL",
            "UXNAN_MCP_TOKEN",
        ] {
            assert!(
                PER_TERMINAL_KEYS.contains(&key),
                "{key} is injected per terminal but never scrubbed"
            );
        }
    }

    #[test]
    fn keeps_the_overrides_a_human_sets_on_purpose() {
        // These steer *this* process (a disposable profile, a chosen shell); they
        // are not terminal identity and must survive.
        assert!(!PER_TERMINAL_KEYS.contains(&"UXNAN_DATA_DIR"));
        assert!(!PER_TERMINAL_KEYS.contains(&"UXNAN_SHELL"));
    }

    #[test]
    fn scrub_command_marks_every_key_removed() {
        let mut cmd = tokio::process::Command::new("git");
        scrub_command(&mut cmd);
        let removed: Vec<String> = cmd
            .as_std()
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .collect();
        for key in PER_TERMINAL_KEYS {
            assert!(removed.contains(&key.to_string()), "{key} not removed");
        }
    }

    #[test]
    fn an_explicit_value_still_wins_over_the_scrub() {
        // Scrubbing is a default, not a ban: a caller that means to hand a child
        // its own coordinates sets them after the scrub and they take effect.
        let mut cmd = tokio::process::Command::new("git");
        scrub_command(&mut cmd);
        cmd.env("UXNAN_AGENT_ID", "deliberate");
        let value = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| k.to_string_lossy() == "UXNAN_AGENT_ID")
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(value.as_deref(), Some("deliberate"));
    }
}
