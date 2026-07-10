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

/// How strongly a path/exe token identifies the agent command `cmd`, or `None`.
/// Ranked so a **more specific** match always outranks a looser one: an exact
/// token beats a `cmd-…`/`cmd_…` variant (e.g. `gemini-cli` for `gemini`), which
/// beats a bare substring (4+ chars, for `@scope/codex` package folders). Longer
/// commands outrank shorter ones within a tier, so a specific brand (`openclaude`)
/// wins over a base one it contains (`claude`).
fn match_score(token: &str, cmd: &str) -> Option<u32> {
    if token == cmd {
        return Some(3000 + cmd.len() as u32);
    }
    if let Some(rest) = token.strip_prefix(cmd) {
        if rest.starts_with('-') || rest.starts_with('_') {
            return Some(2000 + cmd.len() as u32);
        }
    }
    if cmd.len() >= 4 && token.contains(cmd) {
        return Some(1000 + cmd.len() as u32);
    }
    None
}

/// Whether a token identifies `cmd` at all (any tier). Thin predicate over
/// [`match_score`], used by the tests.
#[cfg(test)]
fn token_matches(token: &str, cmd: &str) -> bool {
    match_score(token, cmd).is_some()
}

/// The single best (most specific) command among `commands` for a token set, with
/// its score — so a process is identified by the most specific agent it looks like,
/// not merely the first in list order.
fn best_command(tokens: &HashSet<String>, commands: &[String]) -> Option<(String, u32)> {
    commands
        .iter()
        .filter_map(|c| {
            let cl = c.to_ascii_lowercase();
            tokens
                .iter()
                .filter_map(|t| match_score(t, &cl))
                .max()
                .map(|score| (c.clone(), score))
        })
        .max_by_key(|(_, score)| *score)
}

/// The agent command (from `commands`) this process most specifically looks like
/// + its match score, from its exe name or any command-line token.
fn matches_agent(proc: &Process, commands: &[String]) -> Option<(String, u32)> {
    let mut tokens: HashSet<String> = HashSet::new();
    tokens.insert(strip_ext(&proc.name().to_string_lossy()).to_ascii_lowercase());
    for part in proc.cmd() {
        for seg in part.to_string_lossy().split(['/', '\\', ' ']) {
            if !seg.is_empty() {
                tokens.insert(strip_ext(seg).to_ascii_lowercase());
            }
        }
    }
    best_command(&tokens, commands)
}

/// The agent command running as a descendant of `root_pid`, or `None` when the
/// shell is idle / running a non-agent command. Walks **breadth-first** and returns
/// the match on the process **nearest the shell** — that's the agent the user
/// launched (e.g. `zero`, `openclaude`), not a helper it spawns (`agy`, `claude`) —
/// picking the most specific match within that level. Deterministic regardless of
/// the OS process-map order.
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
    let mut level = vec![Pid::from_u32(root_pid)];
    let mut seen: HashSet<Pid> = HashSet::new();
    while !level.is_empty() {
        let mut best: Option<(String, u32)> = None;
        let mut next: Vec<Pid> = Vec::new();
        for pid in &level {
            if !seen.insert(*pid) {
                continue;
            }
            if let Some(kids) = children.get(pid) {
                for &kid in kids {
                    if let Some(proc) = sys.process(kid) {
                        if let Some((cmd, score)) = matches_agent(proc, commands) {
                            if best.as_ref().map(|(_, s)| score > *s).unwrap_or(true) {
                                best = Some((cmd, score));
                            }
                        }
                    }
                    next.push(kid);
                }
            }
        }
        if let Some((cmd, _)) = best {
            return Some(cmd); // shallowest matching level wins (the launched agent)
        }
        level = next;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{best_command, token_matches};
    use std::collections::HashSet;

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

    fn tokset(parts: &[&str]) -> HashSet<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prefers_the_most_specific_agent() {
        // Catalog order puts the base brand first (as syncAgentCommands sends it),
        // but the specific wrapper must still win despite the substring collision.
        let cmds = vec![
            "claude".to_string(),
            "agy".to_string(),
            "openclaude".to_string(),
            "zero".to_string(),
        ];
        // An `openclaude` process contains "claude" but must resolve to openclaude.
        assert_eq!(
            best_command(&tokset(&["openclaude"]), &cmds).unwrap().0,
            "openclaude"
        );
        // A real `claude` process still resolves to claude.
        assert_eq!(
            best_command(&tokset(&["claude"]), &cmds).unwrap().0,
            "claude"
        );
        // `zero` doesn't collide with the short `agy` (contains needs 4+ chars).
        assert_eq!(best_command(&tokset(&["zero"]), &cmds).unwrap().0, "zero");
        assert_eq!(best_command(&tokset(&["agy"]), &cmds).unwrap().0, "agy");
        // No agent token → no match.
        assert!(best_command(&tokset(&["bash", "node"]), &cmds).is_none());
    }
}
