//! Resolution, invocation and model discovery for the coding-agent CLIs the
//! AI commit-message generator can drive: **Claude Code, Codex, Gemini, OpenCode
//! and Pi** (spec `02c` §4.5).
//!
//! npm installs ship each CLI as an entry `*.js` behind a `.cmd`/`.ps1` shim that
//! can't be spawned shell-free on Windows, so — mirroring the bridge's
//! `resolve-*.ts` — we resolve to a runnable form: `node <entry.js>` for the npm
//! packages, or the native binary (Claude's `~/.local/bin`, OpenCode's `.exe`).
//! That's what makes the one-shot, non-interactive run work on Windows without a
//! shell (no command injection: args are a vector, never interpolated).

use std::path::PathBuf;

use serde::Serialize;

/// The agent ids the AI commit feature supports, in display order.
pub const SUPPORTED: [&str; 5] = ["claude", "codex", "gemini", "opencode", "pi"];

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

/// Best-effort guard against handing a **wrong-architecture** `.exe` to `spawn()`
/// (which fails with Windows' "not compatible with the version of Windows you're
/// running" — e.g. an x64 `opencode.exe` installed by npm on an ARM64 host). An
/// unreadable or non-PE file returns `true` — never over-reject; let the OS report
/// the real error in that case.
fn exe_runnable(path: &std::path::Path) -> bool {
    match std::fs::File::open(path) {
        Ok(mut f) => read_pe_machine(&mut f)
            .map(host_runs_machine)
            .unwrap_or(true),
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
        _ => None,
    }
}

/// The non-interactive (print-mode) args for `agent_id` to answer `prompt` with
/// an optional `model` (empty → the CLI's default model). The flags match each
/// CLI's headless mode; the prompt is the final positional arg (except Gemini,
/// where `-p` takes the prompt as its value). `None` for an unknown agent.
pub fn build_args(agent_id: &str, model: &str, prompt: &str) -> Option<Vec<String>> {
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
            a.extend(model_flag("--model"));
            a.push(prompt.to_string());
            a
        }
        // codex exec [--model M] <prompt>
        "codex" => {
            let mut a = vec!["exec".to_string()];
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
            a.extend(model_flag("--model"));
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
/// `opus`/`sonnet`/`haiku` "latest" aliases, so the message is reproducible).
///
/// ## How to maintain this list
/// When Anthropic ships or retires a model, edit this array:
/// - **id** (left): the exact `--model` string, e.g. `claude-opus-4-8`. These are
///   the canonical model ids — never append a date suffix to a concrete id, and
///   don't use the bare aliases here.
/// - **display name** (right): what the picker shows, e.g. `Opus 4.8`.
///
/// Keep newest/most-capable first (that's the picker order). The user can always
/// pick "Default" in the UI to let the CLI choose its own configured model.
/// Source of truth for current ids: the Claude API model catalog.
const CLAUDE_MODELS: [(&str, &str); 6] = [
    ("claude-opus-4-8", "Opus 4.8"),
    ("claude-opus-4-7", "Opus 4.7"),
    ("claude-opus-4-6", "Opus 4.6"),
    ("claude-sonnet-4-6", "Sonnet 4.6"),
    ("claude-haiku-4-5", "Haiku 4.5"),
    ("claude-fable-5", "Fable 5"),
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

/// Parse `pi --list-models` output (a whitespace-separated table; the model
/// table is printed to **stderr**) into `provider/model` ids.
pub fn parse_pi_models(output: &str) -> Vec<AgentModel> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in output.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 6 {
            continue;
        }
        let (provider, model) = (cols[0], cols[1]);
        if provider == "provider" {
            continue; // header row
        }
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
                build_args(id, "", "msg").is_some(),
                "{id} builds default args"
            );
            assert!(
                build_args(id, "x", "msg").is_some(),
                "{id} builds model args"
            );
        }
        assert!(build_args("nope", "", "m").is_none());
    }

    #[test]
    fn build_args_default_omits_model_flag() {
        assert_eq!(build_args("claude", "", "hi").unwrap(), vec!["-p", "hi"]);
        assert_eq!(build_args("codex", "  ", "hi").unwrap(), vec!["exec", "hi"]);
        assert_eq!(build_args("gemini", "", "hi").unwrap(), vec!["-p", "hi"]);
        assert_eq!(build_args("opencode", "", "hi").unwrap(), vec!["run", "hi"]);
        assert_eq!(build_args("pi", "", "hi").unwrap(), vec!["-p", "hi"]);
    }

    #[test]
    fn build_args_inserts_model_flag_per_cli() {
        assert_eq!(
            build_args("claude", "opus", "hi").unwrap(),
            vec!["-p", "--model", "opus", "hi"]
        );
        assert_eq!(
            build_args("codex", "gpt-5", "hi").unwrap(),
            vec!["exec", "--model", "gpt-5", "hi"]
        );
        // Gemini: -m before -p, and -p takes the prompt as its value.
        assert_eq!(
            build_args("gemini", "gemini-2.5-pro", "hi").unwrap(),
            vec!["-m", "gemini-2.5-pro", "-p", "hi"]
        );
        assert_eq!(
            build_args("opencode", "anthropic/claude-3.5", "hi").unwrap(),
            vec!["run", "--model", "anthropic/claude-3.5", "hi"]
        );
        assert_eq!(
            build_args("pi", "anthropic/sonnet", "hi").unwrap(),
            vec!["-p", "--model", "anthropic/sonnet", "hi"]
        );
    }

    #[test]
    fn static_models_for_claude_and_gemini() {
        let claude = static_models("claude");
        // Exact concrete model ids (no "latest" aliases), newest first.
        assert_eq!(claude.first().unwrap().id, "claude-opus-4-8");
        assert!(claude.iter().any(|m| m.id == "claude-fable-5"));
        assert!(claude.iter().all(|m| m.id.starts_with("claude-")));
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
        // A non-PE blob → None (exe_runnable treats that as runnable, not a reject).
        assert_eq!(
            read_pe_machine(&mut std::io::Cursor::new(b"not an exe".to_vec())),
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
