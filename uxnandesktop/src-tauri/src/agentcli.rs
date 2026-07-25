//! Resolution, invocation and model discovery for the coding-agent CLIs uxnan
//! can drive headlessly — the AI commit-message generator, the orchestration
//! engine's headless steps and every automation step: **Claude Code, Codex,
//! Gemini, OpenCode, Pi, Antigravity and Grok** (spec `02c` §4.5, `02f` §3).
//!
//! npm installs ship each CLI as an entry `*.js` behind a `.cmd`/`.ps1` shim that
//! can't be spawned shell-free on Windows, so — mirroring the bridge's
//! `resolve-*.ts` — we resolve to a runnable form: `node <entry.js>` for the npm
//! packages, or the native binary (Claude's `~/.local/bin`, OpenCode's `.exe`).
//! That's what makes the one-shot, non-interactive run work on Windows without a
//! shell (no command injection: args are a vector, never interpolated).

use std::path::PathBuf;

use serde::Serialize;

/// The agent ids that can be driven headlessly, in display order. Antigravity
/// (`agy`) and Grok ship a single native binary rather than an npm package.
pub const SUPPORTED: [&str; 7] = ["claude", "codex", "gemini", "opencode", "pi", "agy", "grok"];

/// A CLI agent resolved to a spawnable form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// Executable to spawn (a native binary, or `node` for an npm entry).
    pub program: String,
    /// Args prepended before the agent's own args (e.g. `[entry.js]` via node).
    pub prepend: Vec<String>,
}

/// A model offered by an agent (mirror of the frontend `AgentModel`). The id is
/// what the model-selecting flag expects verbatim (alias, `provider/model`, …).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    pub id: String,
    pub display_name: String,
}

impl AgentModel {
    fn new(id: &str, display_name: &str) -> Self {
        Self {
            id: id.to_string(),
            display_name: display_name.to_string(),
        }
    }
}

/// The user's home directory (`USERPROFILE` on Windows, `HOME` elsewhere).
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// `node` executable path, used to run an npm CLI's entry JS shell-free.
fn node() -> Option<String> {
    crate::which::resolve("node").map(|p| p.to_string_lossy().to_string())
}

/// npm-global `node_modules/<rel…>` candidates for the platform (matches the
/// bridge: `%APPDATA%/npm/...` on Windows; `/usr/local/lib/...` and
/// `~/.npm-global/lib/...` on POSIX).
fn npm_global_candidates(rel: &[&str]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let push = |out: &mut Vec<PathBuf>, mut base: PathBuf| {
        for c in rel {
            base.push(c);
        }
        out.push(base);
    };
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let mut p = PathBuf::from(appdata);
            p.push("npm");
            p.push("node_modules");
            push(&mut out, p);
        }
    } else {
        push(&mut out, PathBuf::from("/usr/local/lib/node_modules"));
        if let Some(mut home) = home_dir() {
            home.push(".npm-global");
            home.push("lib");
            home.push("node_modules");
            push(&mut out, home);
        }
    }
    out
}

/// Resolve an npm-packaged CLI to `node <entry.js>`, or the POSIX launcher on
/// PATH. On Windows the bare shim needs a shell, so we report unresolved.
fn resolve_node_cli(rel: &[&str], launcher: &str) -> Option<Resolved> {
    for cli in npm_global_candidates(rel) {
        if cli.is_file() {
            return Some(Resolved {
                program: node()?,
                prepend: vec![cli.to_string_lossy().to_string()],
            });
        }
    }
    if !cfg!(windows) {
        if let Some(p) = crate::which::resolve(launcher) {
            return Some(Resolved {
                program: p.to_string_lossy().to_string(),
                prepend: vec![],
            });
        }
    }
    None
}

/// Resolve a CLI that ships as one native executable on `PATH`.
fn resolve_native(command: &str) -> Option<Resolved> {
    crate::which::resolve(command).map(|p| Resolved {
        program: p.to_string_lossy().to_string(),
        prepend: vec![],
    })
}

/// Resolve Claude Code: the native `~/.local/bin/claude[.exe]` if present, else
/// the npm `@anthropic-ai/claude-code/cli.js` via node.
fn resolve_claude() -> Option<Resolved> {
    if let Some(mut native) = home_dir() {
        native.push(".local");
        native.push("bin");
        native.push(if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        });
        if native.is_file() {
            return Some(Resolved {
                program: native.to_string_lossy().to_string(),
                prepend: vec![],
            });
        }
    }
    resolve_node_cli(&["@anthropic-ai", "claude-code", "cli.js"], "claude")
}

const IMAGE_FILE_MACHINE_I386: u16 = 0x014c;
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64: u16 = 0xAA64;

/// Read the PE COFF **machine type** from a DOS/PE image, or `None` if it isn't a
/// PE (MZ → `e_lfanew` → `PE\0\0` → 2-byte machine). Generic over the reader so it
/// unit-tests against an in-memory buffer.
fn read_pe_machine<R: std::io::Read + std::io::Seek>(r: &mut R) -> Option<u16> {
    use std::io::SeekFrom;
    let mut mz = [0u8; 2];
    r.read_exact(&mut mz).ok()?;
    if &mz != b"MZ" {
        return None;
    }
    r.seek(SeekFrom::Start(0x3C)).ok()?;
    let mut lfa = [0u8; 4];
    r.read_exact(&mut lfa).ok()?;
    r.seek(SeekFrom::Start(u32::from_le_bytes(lfa) as u64))
        .ok()?;
    let mut sig = [0u8; 4];
    r.read_exact(&mut sig).ok()?;
    if &sig != b"PE\0\0" {
        return None;
    }
    let mut machine = [0u8; 2];
    r.read_exact(&mut machine).ok()?;
    Some(u16::from_le_bytes(machine))
}

/// Whether the current host can execute a PE of this machine type (best-effort:
/// x64 runs x64 + x86 via WOW64; ARM64 Windows also emulates x64/x86).
fn host_runs_machine(machine: u16) -> bool {
    let runnable: &[u16] = if cfg!(target_arch = "aarch64") {
        &[
            IMAGE_FILE_MACHINE_ARM64,
            IMAGE_FILE_MACHINE_AMD64,
            IMAGE_FILE_MACHINE_I386,
        ]
    } else if cfg!(target_arch = "x86_64") {
        &[IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_I386]
    } else {
        &[IMAGE_FILE_MACHINE_I386]
    };
    runnable.contains(&machine)
}

/// Whether this `.exe` is something Windows can actually execute. Guards against
/// two npm-install failure modes, both of which otherwise surface as an agent that
/// looks installed but can never run:
///
/// - a **wrong-architecture** binary (an x64 `opencode.exe` on an ARM64 host),
///   which fails with "not compatible with the version of Windows you're running";
/// - a **placeholder that isn't a PE at all** — when `opencode-ai`'s postinstall
///   doesn't run (`--ignore-scripts`, or pnpm's default), the `.exe` left behind is
///   a tiny shell stub that `CreateProcessW` cannot start. Windows requires a valid
///   PE image to execute an `.exe`, so a non-PE one is definitively not runnable;
///   treating it as runnable (the old `unwrap_or(true)`) is what let a broken
///   OpenCode reach the model picker enabled.
///
/// Only ever called on `.exe`/`.com` candidates. An **unreadable** file still
/// returns `true` — that's a permissions question, not a "wrong binary" one, so
/// let the OS report the real error.
fn exe_runnable(path: &std::path::Path) -> bool {
    match std::fs::File::open(path) {
        Ok(mut f) => read_pe_machine(&mut f)
            .map(host_runs_machine)
            .unwrap_or(false),
        Err(_) => true,
    }
}

/// Resolve OpenCode: its native `.exe` (the npm shim forwards to it) on Windows,
/// else the launcher on PATH. Wrong-arch `.exe` candidates are skipped so we don't
/// spawn a binary Windows can't run.
fn resolve_opencode() -> Option<Resolved> {
    if cfg!(windows) {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.push(
                PathBuf::from(appdata)
                    .join("npm")
                    .join("node_modules")
                    .join("opencode-ai")
                    .join("bin")
                    .join("opencode.exe"),
            );
        }
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(pf).join("opencode").join("opencode.exe"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("opencode").join("opencode.exe"));
        }
        for c in candidates {
            if c.is_file() && exe_runnable(&c) {
                return Some(Resolved {
                    program: c.to_string_lossy().to_string(),
                    prepend: vec![],
                });
            }
        }
        // A native opencode.exe on PATH is fine too (but not a .cmd shim).
        if let Some(p) = crate::which::resolve("opencode") {
            let is_exe = p
                .extension()
                .map(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("com"))
                .unwrap_or(false);
            if is_exe && exe_runnable(&p) {
                return Some(Resolved {
                    program: p.to_string_lossy().to_string(),
                    prepend: vec![],
                });
            }
        }
        None
    } else {
        crate::which::resolve("opencode").map(|p| Resolved {
            program: p.to_string_lossy().to_string(),
            prepend: vec![],
        })
    }
}

/// Resolve a supported agent id to a spawnable form, or `None` if it isn't
/// installed in a runnable shape.
pub fn resolve(agent_id: &str) -> Option<Resolved> {
    match agent_id {
        "claude" => resolve_claude(),
        "codex" => resolve_node_cli(&["@openai", "codex", "bin", "codex.js"], "codex"),
        "gemini" => resolve_node_cli(&["@google", "gemini-cli", "bundle", "gemini.js"], "gemini"),
        "opencode" => resolve_opencode(),
        "pi" => resolve_node_cli(
            &["@earendil-works", "pi-coding-agent", "dist", "cli.js"],
            "pi",
        ),
        // Antigravity and Grok ship a single native binary on `PATH` (no npm
        // package to walk), so a plain lookup is the whole resolution.
        "agy" | "grok" => resolve_native(agent_id),
        _ => None,
    }
}

/// The non-interactive (print-mode) args for `agent_id` to answer `prompt` with
/// an optional `model` (empty → the CLI's default model). The flags match each
/// CLI's headless mode; the prompt is the final positional arg (except Gemini
/// and Antigravity, where `-p` takes the prompt as its value). `None` for an
/// unknown agent.
///
/// `autonomous` adds the CLI's own auto-approve flag. It matters more than it
/// looks: with tools involved, a headless agent cannot ask a human, so several
/// CLIs **auto-deny** and return nothing useful (Antigravity says so outright).
/// An unattended automation that is supposed to *do* something therefore needs
/// this — but it is opt-in per step, never the default, because it lets an agent
/// edit files and run commands with nobody watching.
pub fn build_args(
    agent_id: &str,
    model: &str,
    prompt: &str,
    autonomous: bool,
) -> Option<Vec<String>> {
    let m = model.trim();
    let model_flag = |flag: &str| -> Vec<String> {
        if m.is_empty() {
            vec![]
        } else {
            vec![flag.to_string(), m.to_string()]
        }
    };
    let args = match agent_id {
        // claude -p [--model M] <prompt>
        "claude" => {
            let mut a = vec!["-p".to_string()];
            if autonomous {
                a.push("--dangerously-skip-permissions".to_string());
            }
            a.extend(model_flag("--model"));
            a.push(prompt.to_string());
            a
        }
        // codex exec --skip-git-repo-check [--model M] <prompt>
        //
        // Codex refuses to start outside a Git repository and asks the human to
        // confirm — a prompt nothing can answer in print mode, so the run just
        // fails. Every invocation here is programmatic, in a directory the user
        // picked (an AI-commit repo, an orchestration workspace, an automation's
        // working folder, which may deliberately not be a repo at all), so the
        // interactive guard has nothing to protect and is waived. Folder *trust*
        // is a separate decision and is left untouched.
        "codex" => {
            let mut a = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
            if autonomous {
                a.push("--dangerously-bypass-approvals-and-sandbox".to_string());
            }
            a.extend(model_flag("--model"));
            a.push(prompt.to_string());
            a
        }
        // gemini [-m M] -p <prompt>   (-p consumes the prompt as its value)
        "gemini" => {
            let mut a = model_flag("-m");
            a.push("-p".to_string());
            a.push(prompt.to_string());
            a
        }
        // opencode run [--model M] <prompt>
        "opencode" => {
            let mut a = vec!["run".to_string()];
            if autonomous {
                a.push("--auto".to_string());
            }
            a.extend(model_flag("--model"));
            a.push(prompt.to_string());
            a
        }
        // agy [--model M] [--dangerously-skip-permissions] --print <prompt>
        //
        // **Order matters here.** Antigravity's parser stops recognizing options
        // once `--print` has taken the prompt, so a flag placed after it is
        // silently ignored — which is worse than an error: the run then hangs
        // until agy's own 5-minute print timeout, waiting for a permission
        // nobody can grant. Every option therefore goes *before* the prompt.
        // The workspace comes from the process cwd; `--add-dir` is for *extra*
        // directories, so it is deliberately not passed.
        "agy" => {
            let mut a = model_flag("--model");
            if autonomous {
                a.push("--dangerously-skip-permissions".to_string());
            }
            a.push("--print".to_string());
            a.push(prompt.to_string());
            a
        }
        // grok [-m M] [--permission-mode …] -p <prompt>
        //
        // Grok's parser is happy either way, but the prompt goes last for the
        // same reason as Antigravity: one shape for every "flag takes the
        // prompt" CLI is one fewer thing to get subtly wrong.
        "grok" => {
            let mut a = model_flag("-m");
            if autonomous {
                // Grok spells its postures out; this is the one that lets an
                // unattended run actually use tools.
                a.push("--permission-mode".to_string());
                a.push("bypassPermissions".to_string());
            }
            a.push("-p".to_string());
            a.push(prompt.to_string());
            a
        }
        // pi -p [--model M] <prompt>
        "pi" => {
            let mut a = vec!["-p".to_string()];
            a.extend(model_flag("--model"));
            a.push(prompt.to_string());
            a
        }
        _ => return None,
    };
    Some(args)
}

/// Statically-known models for agents whose CLI exposes no list command
/// (Claude and Gemini — both curated tables below). Empty for agents discovered
/// live (OpenCode, Pi, Codex).
pub fn static_models(agent_id: &str) -> Vec<AgentModel> {
    match agent_id {
        "claude" => CLAUDE_MODELS
            .iter()
            .map(|(id, name)| AgentModel::new(id, name))
            .collect(),
        "gemini" => GEMINI_MODELS
            .iter()
            .map(|(id, name)| AgentModel::new(id, name))
            .collect(),
        _ => vec![],
    }
}

/// Curated Claude model ids + display names. Claude Code's CLI has **no**
/// list-models command, so we ship this hand-kept table of **exact** model ids
/// (the concrete versions Claude Code's `--model` flag accepts — *not* the
/// `fable`/`opus`/`sonnet`/`haiku` "latest" aliases, so the message is
/// reproducible).
///
/// ## How to maintain this list
/// **This table has a twin. Keep the two in sync.** The bridge ships the same
/// curated list for the mobile app's picker in `bridge/src/daemon-config.ts`
/// (`DEFAULT_DAEMON_CONFIG.agents['claude-code'].models`). Neither can be
/// discovered from the CLI, so both are hand-kept: when Anthropic ships or
/// retires a model, edit **both** arrays, with the same ids, labels and order.
/// - **id** (left): the exact `--model` string, e.g. `claude-opus-5`. These are
///   the canonical model ids — never append a date suffix or a routing variant
///   (`…[1m]`, `…-fast`) to a concrete id, and don't use the bare aliases here.
/// - **display name** (right): what the picker shows, e.g. `Opus 5`.
///
/// Keep newest/most-capable first (that's the picker order). The user can always
/// pick "Default" in the UI to let the CLI choose its own configured model.
/// Source of truth for current ids: the Claude API model catalog.
const CLAUDE_MODELS: [(&str, &str); 10] = [
    ("claude-fable-5", "Fable 5"),
    ("claude-opus-5", "Opus 5"),
    ("claude-opus-4-8", "Opus 4.8"),
    ("claude-opus-4-7", "Opus 4.7"),
    ("claude-opus-4-6", "Opus 4.6"),
    ("claude-opus-4-5", "Opus 4.5"),
    ("claude-sonnet-5", "Sonnet 5"),
    ("claude-sonnet-4-6", "Sonnet 4.6"),
    ("claude-sonnet-4-5", "Sonnet 4.5"),
    ("claude-haiku-4-5", "Haiku 4.5"),
];

/// Curated Gemini model ids + display names (the CLI has no enumerate command),
/// mirrored from the bridge's hand-kept table.
const GEMINI_MODELS: [(&str, &str); 7] = [
    ("auto", "Auto"),
    ("gemini-3-pro-preview", "Gemini 3 Pro (Preview)"),
    ("gemini-3.1-pro-preview", "Gemini 3.1 Pro (Preview)"),
    ("gemini-2.5-pro", "Gemini 2.5 Pro"),
    ("gemini-3.5-flash", "Gemini 3.5 Flash"),
    ("gemini-2.5-flash", "Gemini 2.5 Flash"),
    ("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"),
];

/// Strip ANSI SGR escape sequences (`ESC [ … m`) from a line.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Skip the optional '[' and the parameter bytes up to the final 'm'.
            if chars.peek() == Some(&'[') {
                chars.next();
            }
            for n in chars.by_ref() {
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Parse `opencode models` output into a unique list of `provider/model` ids
/// (those are the lines that contain a `/` and no spaces).
pub fn parse_opencode_models(stdout: &str) -> Vec<AgentModel> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in stdout.lines() {
        let line = strip_ansi(raw).trim().to_string();
        if line.contains('/') && !line.contains(' ') && seen.insert(line.clone()) {
            out.push(AgentModel::new(&line, &line));
        }
    }
    out
}

/// Parse `pi --list-models` output into `provider/model` ids.
///
/// The output is a whitespace-separated table printed to **stdout**:
/// `provider  model  context  max-out  thinking  images`. A row only counts when
/// its last two columns are the `yes`/`no` flags — a column *count* alone is not
/// enough, because pi answers with **prose** when no provider is authenticated
/// ("No models available. Use /login to log into a provider…"), and that sentence
/// has well over six whitespace-separated words. Taking its first two would mint
/// a phantom model literally called `No/models`.
pub fn parse_pi_models(output: &str) -> Vec<AgentModel> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in output.lines() {
        let line = strip_ansi(raw);
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 6 {
            continue;
        }
        // The `thinking` / `images` flags: present on every data row, and on
        // neither the header (`thinking  images`) nor any prose line.
        let is_flag = |s: &str| s.eq_ignore_ascii_case("yes") || s.eq_ignore_ascii_case("no");
        if !is_flag(cols[cols.len() - 1]) || !is_flag(cols[cols.len() - 2]) {
            continue;
        }
        let (provider, model) = (cols[0], cols[1]);
        let id = format!("{provider}/{model}");
        if seen.insert(id.clone()) {
            out.push(AgentModel::new(&id, model));
        }
    }
    out
}

/// Map a Codex `model/list` `result.data` array into [`AgentModel`]s, skipping
/// models hidden from the default picker.
pub fn parse_codex_models(data: &serde_json::Value) -> Vec<AgentModel> {
    let Some(arr) = data.as_array() else {
        return vec![];
    };
    let mut out = Vec::new();
    for e in arr {
        if e.get("hidden") == Some(&serde_json::Value::Bool(true)) {
            continue;
        }
        let id = e
            .get("id")
            .and_then(|v| v.as_str())
            .or_else(|| e.get("model").and_then(|v| v.as_str()));
        let Some(id) = id else { continue };
        let name = e
            .get("displayName")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(id);
        out.push(AgentModel::new(id, name));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_ids_resolve_to_args() {
        for id in SUPPORTED {
            assert!(
                build_args(id, "", "msg", false).is_some(),
                "{id} builds default args"
            );
            assert!(
                build_args(id, "x", "msg", false).is_some(),
                "{id} builds model args"
            );
        }
        assert!(build_args("nope", "", "m", false).is_none());
    }

    #[test]
    fn build_args_default_omits_model_flag() {
        assert_eq!(
            build_args("claude", "", "hi", false).unwrap(),
            vec!["-p", "hi"]
        );
        assert_eq!(
            build_args("codex", "  ", "hi", false).unwrap(),
            vec!["exec", "--skip-git-repo-check", "hi"]
        );
        assert_eq!(
            build_args("gemini", "", "hi", false).unwrap(),
            vec!["-p", "hi"]
        );
        assert_eq!(
            build_args("opencode", "", "hi", false).unwrap(),
            vec!["run", "hi"]
        );
        assert_eq!(build_args("pi", "", "hi", false).unwrap(), vec!["-p", "hi"]);
    }

    #[test]
    fn native_agents_keep_every_option_before_the_prompt() {
        // Antigravity stops parsing options once `--print` has taken the
        // prompt, so an option placed after it is silently ignored and the run
        // hangs until its own print timeout. Both natives therefore put every
        // option first and the prompt last.
        assert_eq!(
            build_args("agy", "", "hi", false).unwrap(),
            vec!["--print", "hi"]
        );
        assert_eq!(
            build_args("grok", "", "hi", false).unwrap(),
            vec!["-p", "hi"]
        );
        assert_eq!(
            build_args("agy", "gemini-3-pro", "hi", false).unwrap(),
            vec!["--model", "gemini-3-pro", "--print", "hi"]
        );
        assert_eq!(
            build_args("grok", "grok-4", "hi", false).unwrap(),
            vec!["-m", "grok-4", "-p", "hi"]
        );
    }

    #[test]
    fn autonomy_is_off_unless_asked_for() {
        // The safe default is the whole point: nothing may auto-approve tools
        // just because a run happens to be headless.
        for id in SUPPORTED {
            let args = build_args(id, "", "msg", false).unwrap();
            assert!(
                !args
                    .iter()
                    .any(|a| a.contains("dangerous") || a == "--auto" || a == "bypassPermissions"),
                "{id} auto-approves by default: {args:?}"
            );
        }
    }

    #[test]
    fn autonomy_adds_each_cli_own_auto_approve_flag() {
        // Without this a headless step that needs a tool comes back empty —
        // Antigravity auto-denies and says so — so the mapping has to be right
        // per CLI rather than one flag hopefully shared by all of them.
        let has = |id: &str, needle: &str| {
            build_args(id, "", "msg", true)
                .unwrap()
                .iter()
                .any(|a| a == needle)
        };
        assert!(has("claude", "--dangerously-skip-permissions"));
        assert!(has("codex", "--dangerously-bypass-approvals-and-sandbox"));
        assert!(has("opencode", "--auto"));
        assert!(has("agy", "--dangerously-skip-permissions"));
        assert!(has("grok", "bypassPermissions"));
    }

    #[test]
    fn the_prompt_stays_the_last_positional_when_autonomy_is_on() {
        // A flag inserted in the wrong place would silently become the prompt.
        assert_eq!(
            build_args("claude", "opus", "hi", true).unwrap(),
            vec![
                "-p",
                "--dangerously-skip-permissions",
                "--model",
                "opus",
                "hi"
            ]
        );
        // Antigravity is the one that breaks if an option lands after the
        // prompt, so pin its whole shape.
        assert_eq!(
            build_args("agy", "gemini-3-pro", "hi", true).unwrap(),
            vec![
                "--model",
                "gemini-3-pro",
                "--dangerously-skip-permissions",
                "--print",
                "hi"
            ]
        );
        assert_eq!(
            build_args("grok", "", "hi", true).unwrap(),
            vec!["--permission-mode", "bypassPermissions", "-p", "hi"]
        );
    }

    #[test]
    fn build_args_inserts_model_flag_per_cli() {
        assert_eq!(
            build_args("claude", "opus", "hi", false).unwrap(),
            vec!["-p", "--model", "opus", "hi"]
        );
        assert_eq!(
            build_args("codex", "gpt-5", "hi", false).unwrap(),
            vec!["exec", "--skip-git-repo-check", "--model", "gpt-5", "hi"]
        );
        // Gemini: -m before -p, and -p takes the prompt as its value.
        assert_eq!(
            build_args("gemini", "gemini-2.5-pro", "hi", false).unwrap(),
            vec!["-m", "gemini-2.5-pro", "-p", "hi"]
        );
        assert_eq!(
            build_args("opencode", "anthropic/claude-3.5", "hi", false).unwrap(),
            vec!["run", "--model", "anthropic/claude-3.5", "hi"]
        );
        assert_eq!(
            build_args("pi", "anthropic/sonnet", "hi", false).unwrap(),
            vec!["-p", "--model", "anthropic/sonnet", "hi"]
        );
    }

    #[test]
    fn static_models_for_claude_and_gemini() {
        let claude = static_models("claude");
        // Exact concrete model ids (no "latest" aliases), newest first — the same
        // order as the bridge's twin list (see the CLAUDE_MODELS doc comment).
        assert_eq!(claude.first().unwrap().id, "claude-fable-5");
        assert_eq!(claude[1].id, "claude-opus-5");
        assert!(claude.iter().any(|m| m.id == "claude-sonnet-5"));
        assert!(claude.iter().any(|m| m.id == "claude-sonnet-4-5"));
        assert!(claude.iter().all(|m| m.id.starts_with("claude-")));
        // no routing variants (`…[1m]`, `…-fast`) leak into the table
        assert!(claude
            .iter()
            .all(|m| !m.id.contains('[') && !m.id.ends_with("-fast")));
        assert!(static_models("gemini").iter().any(|m| m.id == "auto"));
        // Live-discovered agents have no static list.
        assert!(static_models("opencode").is_empty());
        assert!(static_models("codex").is_empty());
    }

    #[test]
    fn parses_opencode_models_skips_headers_and_ansi() {
        let out = "Available models\n\x1b[1manthropic/claude-3.5-sonnet\x1b[0m\nopenai/gpt-4o\nProvider Models\nanthropic/claude-3.5-sonnet\n";
        let models = parse_opencode_models(out);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"]
        );
    }

    #[test]
    fn parses_pi_models_table_with_header() {
        let out = "provider model context max-out thinking images\nanthropic claude-3.5-sonnet 200k 8k yes yes\nopenai gpt-5 400k 16k yes no\n";
        let models = parse_pi_models(out);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["anthropic/claude-3.5-sonnet", "openai/gpt-5"]
        );
        assert_eq!(models[0].display_name, "claude-3.5-sonnet");
    }

    /// The real `pi --list-models` layout (column-aligned, from the shipped CLI).
    #[test]
    fn parses_pi_models_real_aligned_table() {
        let out = "provider      model                               context  max-out  thinking  images\n\
                   aihubmix      coding-glm-4.7-free                 128K     16.4K    yes       no    \n\
                   google        gemini-2.5-pro                      1M       65.5K    yes       yes   \n";
        let models = parse_pi_models(out);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["aihubmix/coding-glm-4.7-free", "google/gemini-2.5-pro"]
        );
    }

    /// pi prints prose — not a table — when no provider is authenticated. It has
    /// well over six whitespace-separated words, so a column-count check alone let
    /// it through and minted a model literally called `No/models`.
    #[test]
    fn pi_no_auth_prose_yields_no_models() {
        let out =
            "No models available. Use /login to log into a provider via OAuth or API key. See:\n\
                   https://example.com/docs\n";
        assert!(parse_pi_models(out).is_empty());
    }

    #[test]
    fn parses_pi_models_strips_ansi() {
        let out = "\x1b[1mopenai\x1b[0m gpt-5 400k 16k yes no\n";
        let models = parse_pi_models(out);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["openai/gpt-5"]
        );
    }

    #[test]
    fn parses_codex_models_skips_hidden_and_uses_display_name() {
        let data = serde_json::json!([
            { "id": "gpt-5", "displayName": "GPT-5" },
            { "model": "gpt-5-codex" },
            { "id": "secret", "hidden": true },
        ]);
        let models = parse_codex_models(&data);
        assert_eq!(
            models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["gpt-5", "gpt-5-codex"]
        );
        assert_eq!(models[0].display_name, "GPT-5");
        assert_eq!(models[1].display_name, "gpt-5-codex"); // falls back to id
    }

    #[test]
    fn unknown_agent_resolves_to_none() {
        assert!(resolve("definitely-not-an-agent").is_none());
    }

    #[test]
    fn reads_pe_machine_and_gates_by_arch() {
        // Minimal DOS+PE header: "MZ", e_lfanew=0x40, "PE\0\0", machine = AMD64.
        let mut buf = vec![0u8; 0x48];
        buf[0] = b'M';
        buf[1] = b'Z';
        buf[0x3C..0x40].copy_from_slice(&0x40u32.to_le_bytes());
        buf[0x40..0x44].copy_from_slice(b"PE\0\0");
        buf[0x44..0x46].copy_from_slice(&IMAGE_FILE_MACHINE_AMD64.to_le_bytes());
        assert_eq!(
            read_pe_machine(&mut std::io::Cursor::new(buf)),
            Some(IMAGE_FILE_MACHINE_AMD64)
        );
        // A non-PE blob → None. `exe_runnable` treats that as NOT runnable: an
        // `.exe` Windows can't execute, e.g. the shell stub `opencode-ai` leaves
        // behind when its postinstall never ran.
        assert_eq!(
            read_pe_machine(&mut std::io::Cursor::new(b"not an exe".to_vec())),
            None
        );
        // The exact stub shape that shipped this bug: an `.exe` whose bytes are a
        // shell `echo`, which read as anything but MZ.
        assert_eq!(
            read_pe_machine(&mut std::io::Cursor::new(
                b"echo \"Error: opencode-ai's postinstall script was not run.\" >&2".to_vec()
            )),
            None
        );
        // x86 runs on every current Windows arch; the rest depends on the test host.
        assert!(host_runs_machine(IMAGE_FILE_MACHINE_I386));
        if cfg!(target_arch = "x86_64") {
            assert!(host_runs_machine(IMAGE_FILE_MACHINE_AMD64));
            assert!(!host_runs_machine(IMAGE_FILE_MACHINE_ARM64)); // wrong-arch → skipped
        }
    }
}
