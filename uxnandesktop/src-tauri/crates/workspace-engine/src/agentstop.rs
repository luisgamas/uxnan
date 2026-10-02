//! Closing the agent a terminal runs — and only it.
//!
//! When a terminal hands its agent's session over (to a chat, here or on the
//! phone — architecture/02a §5.8.19), the agent CLI must stop writing to the
//! session before anyone else does: a CLI's session has one writer. The shell
//! stays, so the tab stays, back at its prompt.
//!
//! The agent is asked to end the way a terminal would end it (SIGTERM on Unix;
//! Windows has no such request, so the process is ended outright), then waited
//! for. The CLIs this runs on write their session as they go — a transcript
//! line per event — so nothing the person saw is lost by ending between turns.
//! One that does not exit in time has its whole process tree ended
//! ([`crate::procscan::kill_tree`]). Nothing here ever types into the terminal.
//!
//! It lives in the workspace engine so a host's engine stops an agent in one
//! of its terminals with the same code (`uxnan-host` → `StopAgent`).

use std::time::{Duration, Instant};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// How long the agent gets to exit on its own before its tree is ended.
pub const EXIT_GRACE: Duration = Duration::from_secs(6);
/// How often the process table is checked while waiting.
const POLL: Duration = Duration::from_millis(150);

/// How closing a terminal's agent went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopOutcome {
    /// No agent was running in the terminal.
    NotRunning,
    /// The agent exited when asked.
    Exited,
    /// It did not, and its process tree was ended.
    Killed,
}

/// Close the agent running as `shell_pid`'s foreground job (one of `commands`),
/// and return once it is gone. Blocking: call from a blocking thread.
pub fn stop_agent(shell_pid: u32, commands: &[String], grace: Duration) -> StopOutcome {
    let mut sys = System::new();
    refresh(&mut sys);
    let Some((_, agent_pid)) = crate::procscan::detect_agent_process(&sys, shell_pid, commands)
    else {
        return StopOutcome::NotRunning;
    };
    if let Some(process) = sys.process(Pid::from_u32(agent_pid)) {
        // `kill_with` is `None` where the platform has no such signal (Windows):
        // end it outright there.
        if process.kill_with(sysinfo::Signal::Term).is_none() {
            process.kill();
        }
    }
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        std::thread::sleep(POLL);
        refresh(&mut sys);
        if sys.process(Pid::from_u32(agent_pid)).is_none() {
            return StopOutcome::Exited;
        }
    }
    crate::procscan::kill_tree(agent_pid);
    StopOutcome::Killed
}

fn refresh(sys: &mut System) {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    /// A stand-in terminal: a shell whose foreground job is a long `sleep`
    /// named like an agent (`exec -a claude`), exactly the tree `procscan`
    /// walks for a real one.
    fn shell_running(agent: &str, trap_term: bool) -> std::process::Child {
        let trap = if trap_term { "trap '' TERM; " } else { "" };
        Command::new("bash")
            .arg("-c")
            .arg(format!("{trap}(exec -a {agent} sleep 30); sleep 30"))
            .stdin(Stdio::null())
            .spawn()
            .expect("bash")
    }

    fn wait_for_agent(shell: u32, commands: &[String]) {
        let mut sys = System::new();
        for _ in 0..50 {
            refresh(&mut sys);
            if crate::procscan::detect_agent_process(&sys, shell, commands).is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("the stand-in agent never started");
    }

    #[test]
    fn the_agent_is_closed_and_the_shell_stays() {
        let commands = vec!["claude".to_string()];
        let mut shell = shell_running("claude", false);
        wait_for_agent(shell.id(), &commands);
        assert_eq!(
            stop_agent(shell.id(), &commands, EXIT_GRACE),
            StopOutcome::Exited
        );
        // The shell is still there, on to its next command.
        assert!(shell.try_wait().unwrap().is_none());
        assert_eq!(
            stop_agent(shell.id(), &commands, EXIT_GRACE),
            StopOutcome::NotRunning
        );
        let _ = shell.kill();
        let _ = shell.wait();
    }

    #[test]
    fn an_agent_that_ignores_the_request_is_ended() {
        let commands = vec!["claude".to_string()];
        // The subshell inherits the ignored TERM, so the stand-in agent does too.
        let mut shell = shell_running("claude", true);
        wait_for_agent(shell.id(), &commands);
        assert_eq!(
            stop_agent(shell.id(), &commands, Duration::from_millis(400)),
            StopOutcome::Killed
        );
        let _ = shell.kill();
        let _ = shell.wait();
    }
}
