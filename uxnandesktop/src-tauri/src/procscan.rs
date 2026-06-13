//! Foreground-process detection for agent monitoring (spec §1.4 / 02d, Layer 3).
//!
//! Given a shell's process id, we walk its descendant processes and look for one
//! that matches a known agent command. Matching is by token: the process's exe
//! name and every path/space-separated segment of its command line are
//! extension-stripped and compared to the agent command. That covers both real
//! executables (`claude.exe`) and node-shim CLIs (`node …\codex\cli.js`), where
//! the executable is `node` but the command line carries the agent's name.

use std::collections::{HashMap, HashSet};

use sysinfo::{Pid, Process, System};

/// Strip a known executable/script extension from a path segment.
fn strip_ext(s: &str) -> &str {
    let lower = s.to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".ps1", ".bat", ".js", ".mjs", ".cjs"] {
        if lower.ends_with(ext) {
            return &s[..s.len() - ext.len()];
        }
    }
    s
}

/// Whether a path/exe token identifies the agent command `cmd`. Matches the
/// exact token, a `cmd-…`/`cmd_…` variant (e.g. `gemini-cli` for `gemini`), or —
/// for commands of 4+ chars, where false positives are unlikely — any token
/// containing it (covers `@scope/codex` style package folders).
fn token_matches(token: &str, cmd: &str) -> bool {
    if token == cmd {
        return true;
    }
    if let Some(rest) = token.strip_prefix(cmd) {
        if rest.starts_with('-') || rest.starts_with('_') {
            return true;
        }
    }
    cmd.len() >= 4 && token.contains(cmd)
}

/// Return the agent command (from `commands`) that this process looks like, if
/// any — matching its exe name or any command-line token.
fn matches_agent(proc: &Process, commands: &[String]) -> Option<String> {
    let mut tokens: HashSet<String> = HashSet::new();
    tokens.insert(strip_ext(&proc.name().to_string_lossy()).to_ascii_lowercase());
    for part in proc.cmd() {
        for seg in part.to_string_lossy().split(['/', '\\', ' ']) {
            if !seg.is_empty() {
                tokens.insert(strip_ext(seg).to_ascii_lowercase());
            }
        }
    }
    commands
        .iter()
        .find(|c| {
            let cl = c.to_ascii_lowercase();
            tokens.iter().any(|t| token_matches(t, &cl))
        })
        .cloned()
}

/// The first agent command found running as a descendant of `root_pid`, or
/// `None` when the shell is idle at its prompt / running a non-agent command.
pub fn detect_agent(sys: &System, root_pid: u32, commands: &[String]) -> Option<String> {
    if commands.is_empty() {
        return None;
    }
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, proc) in sys.processes() {
        if let Some(parent) = proc.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }
    let mut stack = vec![Pid::from_u32(root_pid)];
    let mut seen: HashSet<Pid> = HashSet::new();
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(kids) = children.get(&pid) {
            for &kid in kids {
                if let Some(proc) = sys.process(kid) {
                    if let Some(cmd) = matches_agent(proc, commands) {
                        return Some(cmd);
                    }
                }
                stack.push(kid);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::token_matches;

    #[test]
    fn matches_exact_and_suffix_variants() {
        assert!(token_matches("gemini", "gemini"));
        assert!(token_matches("gemini-cli", "gemini")); // node-shim package folder
        assert!(token_matches("pi", "pi"));
        assert!(token_matches("pi-cli", "pi"));
        assert!(token_matches("opencode", "opencode"));
    }

    #[test]
    fn does_not_falsely_match_short_commands() {
        assert!(!token_matches("pip", "pi"));
        assert!(!token_matches("api", "pi"));
        assert!(!token_matches("node", "codex"));
    }
}
