//! The agents' hook installer, served by the workspace engine.
//!
//! The installer — the reporter scripts, and merging them into each agent's
//! own config — lives in `crates/workspace-engine` because a host's engine runs
//! the same one on that machine, so an agent there reports its state exactly as
//! it does here. This module keeps the path the rest of the app imports it from,
//! and the one part that is the app's own: moving the reporter paths its agent
//! profiles name.

use std::path::Path;

pub use uxnan_workspace_engine::agent_hooks::*;

/// Move every hand-wired reporter path in the agent profiles to the shared
/// directory. Answers how many values changed, for the log — and for the
/// caller to know whether the settings are worth saving.
pub fn repoint_profiles(
    profiles: &mut [crate::model::AgentProfile],
    profile_hooks_dir: &Path,
    shared: &Path,
) -> usize {
    let mut moved = 0;
    for profile in profiles.iter_mut() {
        if let Some(next) = repointed_reporter(&profile.command, profile_hooks_dir, shared) {
            profile.command = next;
            moved += 1;
        }
        for arg in profile.args.iter_mut() {
            if let Some(next) = repointed_reporter(arg, profile_hooks_dir, shared) {
                *arg = next;
                moved += 1;
            }
        }
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn table_agent_ids_match_the_servers_event_table() {
        // The id is posted as the agent type and matched by `normalize_event`.
        // A typo here means a perfectly installed hook whose every report is
        // silently discarded, which is exactly the failure that is hardest to
        // notice: the card just never moves.
        for id in table_agent_ids() {
            // Each agent's own spelling for "I am working on it".
            let event = match id {
                "cursor" | "copilot" => "preToolUse",
                // The in-process plugins report their reporter's own vocabulary,
                // not the CLI's bus event names.
                "mimo" | "kilocode" => "SessionBusy",
                "amp" => "tool.call",
                // OMP runs Pi's extension, so it speaks Pi's snake_case events.
                "omp" => "tool_call",
                _ => "PreToolUse",
            };
            assert_eq!(
                crate::hooks::normalize_event(id, event, None),
                Some(crate::model::AgentStatus::Working),
                "{id} has no working arm in the server's event table"
            );
        }
    }

    /// Over the profiles themselves: the command *and* the arguments, because
    /// the Windows wrapper forms put paths in both, and the count is what tells
    /// the caller whether the settings are worth saving.
    #[test]
    fn profiles_move_their_commands_and_arguments_once() {
        let (profile_dir, shared) = (
            PathBuf::from("data").join("uxnan").join("hooks"),
            PathBuf::from("home").join(".uxnan").join("hooks"),
        );
        let in_profile = |name: &str| profile_dir.join(name).to_string_lossy().into_owned();
        let in_shared = |name: &str| shared.join(name).to_string_lossy().into_owned();
        let mk = |command: &str, args: &[&str]| crate::model::AgentProfile {
            id: "a".into(),
            name: "Custom".into(),
            command: command.into(),
            args: args.iter().map(|a| a.to_string()).collect(),
            terminal_profile_id: None,
            env: Vec::new(),
            icon: None,
            workers_unattended: None,
        };
        let wrapper_sh = in_profile("uxnan-hook-wrapper.sh");
        let wrapper_cmd = in_profile("uxnan-hook-wrapper.cmd");
        let mut profiles = vec![
            mk(&wrapper_sh, &["-Type", "codex"]),
            mk("claude", &["--model", "opus"]),
            mk("cmd", &["/c", &wrapper_cmd]),
        ];

        assert_eq!(repoint_profiles(&mut profiles, &profile_dir, &shared), 2);
        assert_eq!(profiles[0].command, in_shared("uxnan-hook-wrapper.sh"));
        assert_eq!(
            profiles[0].args,
            vec!["-Type", "codex"],
            "arguments that are not paths stay"
        );
        assert_eq!(
            profiles[1].command, "claude",
            "an ordinary agent is untouched"
        );
        assert_eq!(profiles[2].args[0], "/c", "a flag that is not a path stays");
        assert_eq!(profiles[2].args[1], in_shared("uxnan-hook-wrapper.cmd"));
        // Idempotent: a second launch finds nothing left to move.
        assert_eq!(repoint_profiles(&mut profiles, &profile_dir, &shared), 0);
    }
}
