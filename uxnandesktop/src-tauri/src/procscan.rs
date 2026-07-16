//! Foreground-process detection for agent monitoring (spec §1.4 / 02d, Layer 3).
//!
//! Given a shell's process id, we identify the agent running as its **foreground
//! job** — the process the user actually launched in that terminal — not merely
//! any known-agent process anywhere below it. That distinction is what keeps a
//! terminal honest: a *non-agent* program the user runs (say a local server or a
//! bridge daemon) can itself spawn a known agent CLI as a **background helper**,
//! and attributing that helper to the tab would mislabel the terminal with a
//! logo/name it never launched.
//!
//! Two rules enforce this:
//!
//! 1. **Descend through shells only.** From the shell we look at its foreground
//!    job. We see *through* nested shells (a `.cmd`/`.ps1`/shell shim that runs
//!    the real agent as its child), but a non-shell process is a dead end: its
//!    children are helpers it spawned, never this terminal's foreground agent.
//! 2. **Match on identity tokens, not the whole command line.** A process is
//!    identified by its executable name and — for a language interpreter
//!    (`node …\codex\cli.js`) — the path of the **script it runs**. Prompt text,
//!    flags and the working directory are deliberately ignored, so
//!    `claude "compare with codex"` stays Claude, not Codex.

use std::collections::{HashMap, HashSet};

use sysinfo::System;

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

/// Shell executables we transparently descend through: agents are frequently
/// launched via a `.cmd`/`.ps1`/shell shim, so the real agent process is a child
/// of a nested shell. Compared on the extension-stripped, lowercased basename.
fn is_shell(name: &str) -> bool {
    matches!(
        name,
        "cmd" | "powershell" | "pwsh" | "bash" | "sh" | "dash" | "zsh" | "fish" | "ksh" | "nu"
    )
}

/// Language interpreters whose agent identity comes from the **script** they run,
/// not from the interpreter name itself (`node`, `python`, …). Handles versioned
/// Python (`python3`, `python3.12`).
fn is_interpreter(name: &str) -> bool {
    if matches!(name, "node" | "bun" | "deno" | "ruby" | "perl" | "pythonw") {
        return true;
    }
    match name.strip_prefix("python") {
        Some("") => true,
        Some(rest) => rest.chars().all(|c| c.is_ascii_digit() || c == '.'),
        None => false,
    }
}

/// Whether a token looks like a script path rather than a flag/word — an
/// interpreter entrypoint carries a path separator or a script extension.
fn looks_like_script(token: &str) -> bool {
    token.contains('/')
        || token.contains('\\')
        || [".js", ".mjs", ".cjs", ".py", ".pyw"]
            .iter()
            .any(|ext| token.to_ascii_lowercase().ends_with(ext))
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

/// The entrypoint script an interpreter runs (`node <script>`, `python -m <mod>`),
/// or `None` when there is no script (a REPL, or inline source via `-e`/`-p`). It
/// skips interpreter flags and their values so a `--loader x` argument — or any
/// prompt text further along — never masquerades as the entrypoint.
fn interpreter_entrypoint(argv: &[String], is_python: bool) -> Option<&str> {
    let with_value = [
        "-r",
        "--require",
        "--import",
        "--loader",
        "--experimental-loader",
    ];
    let inline_source = ["-e", "--eval", "-p", "--print", "--check"];
    let mut i = 1; // argv[0] is the interpreter itself
    while i < argv.len() {
        let tok = argv[i].as_str();
        if tok == "--" {
            i += 1;
            continue;
        }
        if is_python && tok == "-m" {
            return argv.get(i + 1).map(String::as_str);
        }
        if tok.starts_with('-') {
            let name = tok.split('=').next().unwrap_or(tok);
            if inline_source.contains(&name) {
                return None; // running inline source → no script entrypoint
            }
            if name == tok && with_value.contains(&name) {
                i += 2; // this flag consumes the next token as its value
                continue;
            }
            i += 1;
            continue;
        }
        if looks_like_script(tok) {
            return Some(tok);
        }
        i += 1;
    }
    None
}

/// The identity tokens for a process: its executable basename, its `argv[0]`
/// basename (robust when the OS truncates the process name), and — for an
/// interpreter — the path segments of the **script** it runs. Everything else on
/// the command line (prompt text, flags, cwd) is intentionally excluded: those are
/// the source of look-alike misidentification.
fn agent_tokens(name: &str, argv: &[String]) -> HashSet<String> {
    let mut tokens: HashSet<String> = HashSet::new();
    tokens.insert(name.to_string());
    if let Some(arg0) = argv.first() {
        if let Some(base) = arg0.rsplit(['/', '\\']).next() {
            tokens.insert(strip_ext(base).to_ascii_lowercase());
        }
    }
    if is_interpreter(name) {
        if let Some(entry) = interpreter_entrypoint(argv, name.starts_with("python")) {
            for seg in entry.split(['/', '\\']) {
                if !seg.is_empty() {
                    tokens.insert(strip_ext(seg).to_ascii_lowercase());
                }
            }
        }
    }
    tokens
}

/// Minimal process facts detection needs — extracted from `sysinfo` in
/// [`detect_agent`], hand-built in tests. `name` is the extension-stripped,
/// lowercased executable basename.
struct ProcInfo {
    name: String,
    argv: Vec<String>,
    parent: Option<u32>,
}

/// The agent command (from `commands`) this process most specifically looks like,
/// plus its match score, or `None` when it is not a known agent.
fn recognize(info: &ProcInfo, commands: &[String]) -> Option<(String, u32)> {
    best_command(&agent_tokens(&info.name, &info.argv), commands)
}

/// Walk the shell's foreground job over the process table `procs` and return the
/// agent command it runs. Breadth-first from the root shell, descending **only
/// through shells** (nested shells / `.cmd` shims), so a non-shell foreground
/// program's background helpers are never attributed to this terminal. The
/// shallowest matching level wins (the job nearest the shell); within a level the
/// most specific match wins.
fn detect_in_tree(
    procs: &HashMap<u32, ProcInfo>,
    root_pid: u32,
    commands: &[String],
) -> Option<String> {
    if commands.is_empty() {
        return None;
    }
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, info) in procs {
        if let Some(parent) = info.parent {
            children.entry(parent).or_default().push(*pid);
        }
    }
    let mut level = vec![root_pid];
    let mut seen: HashSet<u32> = HashSet::new();
    while !level.is_empty() {
        let mut best: Option<(String, u32)> = None;
        let mut next: Vec<u32> = Vec::new();
        for &pid in &level {
            if !seen.insert(pid) {
                continue;
            }
            // Only the root shell and nested shells expose a foreground job; a
            // non-shell process's children are helpers it spawned, so we neither
            // match them nor descend into them.
            let is_shell_or_root =
                pid == root_pid || procs.get(&pid).map(|i| is_shell(&i.name)).unwrap_or(false);
            if !is_shell_or_root {
                continue;
            }
            if let Some(kids) = children.get(&pid) {
                for &kid in kids {
                    if let Some(info) = procs.get(&kid) {
                        if let Some((cmd, score)) = recognize(info, commands) {
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

/// The agent command running as the foreground job of `root_pid`, or `None` when
/// the shell is idle / running a non-agent command. See [`detect_in_tree`].
pub fn detect_agent(sys: &System, root_pid: u32, commands: &[String]) -> Option<String> {
    if commands.is_empty() {
        return None;
    }
    let mut procs: HashMap<u32, ProcInfo> = HashMap::new();
    for (pid, proc) in sys.processes() {
        procs.insert(
            pid.as_u32(),
            ProcInfo {
                name: strip_ext(&proc.name().to_string_lossy()).to_ascii_lowercase(),
                argv: proc
                    .cmd()
                    .iter()
                    .map(|s| s.to_string_lossy().into_owned())
                    .collect(),
                parent: proc.parent().map(|p| p.as_u32()),
            },
        );
    }
    detect_in_tree(&procs, root_pid, commands)
}

#[cfg(test)]
mod tests {
    use super::{agent_tokens, best_command, detect_in_tree, token_matches, ProcInfo};
    use std::collections::HashMap;

    /// The catalog commands as `syncAgentCommands` sends them (base brand first).
    fn catalog() -> Vec<String> {
        [
            "claude",
            "codex",
            "gemini",
            "opencode",
            "pi",
            "agy",
            "goose",
            "grok",
            "zero",
            "openclaude",
            "aider",
            "cursor-agent",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect()
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    fn proc(name: &str, argv_parts: &[&str], parent: Option<u32>) -> ProcInfo {
        ProcInfo {
            name: name.to_string(),
            argv: argv(argv_parts),
            parent,
        }
    }

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

    fn tokset(parts: &[&str]) -> std::collections::HashSet<String> {
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

    // --- Identity tokens: exe + interpreter script only, never other args -------

    #[test]
    fn node_shim_agent_identified_by_script_path() {
        // `node …\@openai\codex\cli.js` → Codex, from the package folder.
        let t = agent_tokens(
            "node",
            &argv(&[
                "node",
                "C:\\Users\\me\\npm\\node_modules\\@openai\\codex\\cli.js",
            ]),
        );
        assert_eq!(best_command(&t, &catalog()).unwrap().0, "codex");

        let t = agent_tokens(
            "node",
            &argv(&["node", "C:\\a\\@anthropic-ai\\claude-code\\cli.js"]),
        );
        assert_eq!(best_command(&t, &catalog()).unwrap().0, "claude");
    }

    #[test]
    fn prompt_text_and_flags_do_not_identify_the_agent() {
        // A user prompt mentioning other agents must not change identity.
        let t = agent_tokens("codex", &argv(&["codex", "compare gemini and zero output"]));
        assert_eq!(best_command(&t, &catalog()).unwrap().0, "codex");
        // Inline node source (`-e`) has no script entrypoint → no false match.
        let t = agent_tokens("node", &argv(&["node", "-e", "console.log('gemini')"]));
        assert!(best_command(&t, &catalog()).is_none());
    }

    #[test]
    fn native_agent_identified_by_exe_name() {
        let t = agent_tokens("cursor-agent", &argv(&["C:\\tools\\cursor-agent.exe"]));
        assert_eq!(best_command(&t, &catalog()).unwrap().0, "cursor-agent");
    }

    // --- Foreground-job discipline: descend through shells only -----------------

    #[test]
    fn ignores_agent_helpers_spawned_by_a_non_agent_foreground_job() {
        // Shell → `node bridge/cli.js start` (NOT an agent) → `node zero.js acp`
        // spawned as a background helper. The tab must stay unlabelled: the
        // foreground job is the bridge, not Zero.
        let mut procs = HashMap::new();
        procs.insert(100, proc("cmd", &["cmd.exe"], None)); // root shell
        procs.insert(
            200,
            proc(
                "node",
                &["node", ".\\bridge\\dist\\src\\cli.js", "start"],
                Some(100),
            ),
        );
        procs.insert(
            300,
            proc(
                "node",
                &["node", "C:\\npm\\zero\\zero.js", "acp"],
                Some(200),
            ),
        );
        assert_eq!(detect_in_tree(&procs, 100, &catalog()), None);
    }

    #[test]
    fn detects_a_directly_launched_agent() {
        let mut procs = HashMap::new();
        procs.insert(100, proc("cmd", &["cmd.exe"], None));
        procs.insert(
            200,
            proc(
                "node",
                &["node", "C:\\npm\\@openai\\codex\\cli.js"],
                Some(100),
            ),
        );
        assert_eq!(
            detect_in_tree(&procs, 100, &catalog()).as_deref(),
            Some("codex")
        );
    }

    #[test]
    fn sees_through_a_nested_shell_shim() {
        // pwsh → cmd (running the `claude.cmd` shim) → node (the real claude CLI).
        let mut procs = HashMap::new();
        procs.insert(100, proc("pwsh", &["pwsh.exe"], None));
        procs.insert(
            200,
            proc("cmd", &["cmd.exe", "/c", "claude.cmd"], Some(100)),
        );
        procs.insert(
            300,
            proc(
                "node",
                &["node", "C:\\a\\@anthropic-ai\\claude-code\\cli.js"],
                Some(200),
            ),
        );
        assert_eq!(
            detect_in_tree(&procs, 100, &catalog()).as_deref(),
            Some("claude")
        );
    }

    #[test]
    fn a_directly_launched_zero_is_still_detected() {
        // The helper case must not suppress a real, user-launched Zero.
        let mut procs = HashMap::new();
        procs.insert(100, proc("cmd", &["cmd.exe"], None));
        procs.insert(
            200,
            proc(
                "node",
                &["node", "C:\\npm\\zero\\zero.js", "acp"],
                Some(100),
            ),
        );
        assert_eq!(
            detect_in_tree(&procs, 100, &catalog()).as_deref(),
            Some("zero")
        );
    }

    #[test]
    fn a_plain_non_agent_command_matches_nothing() {
        let mut procs = HashMap::new();
        procs.insert(100, proc("cmd", &["cmd.exe"], None));
        procs.insert(200, proc("git", &["git", "status"], Some(100)));
        assert_eq!(detect_in_tree(&procs, 100, &catalog()), None);
    }

    #[test]
    fn the_foreground_agent_wins_over_a_deeper_one() {
        // Shell → claude (foreground) and, separately, a backgrounded shell that
        // holds a gemini. The direct child (claude) is the launched agent.
        let mut procs = HashMap::new();
        procs.insert(100, proc("cmd", &["cmd.exe"], None));
        procs.insert(
            200,
            proc(
                "node",
                &["node", "C:\\a\\@anthropic-ai\\claude-code\\cli.js"],
                Some(100),
            ),
        );
        procs.insert(300, proc("bash", &["bash"], Some(100)));
        procs.insert(
            400,
            proc(
                "node",
                &["node", "C:\\a\\@google\\gemini-cli\\index.js"],
                Some(300),
            ),
        );
        assert_eq!(
            detect_in_tree(&procs, 100, &catalog()).as_deref(),
            Some("claude")
        );
    }
}
