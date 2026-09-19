//! `uxnan-cli` — operate the running Uxnan Desktop from any shell.
//!
//! For a person at a prompt, a script, or an agent that has no MCP (or was not
//! launched by Uxnan). Every command is one catalog entry (`--help` lists them;
//! `skills get control --full` explains them); `rpc` reaches any entry by its
//! method name. The contract of the console: results on stdout, errors on
//! stderr, `--json` for a stable machine-readable result, and an exit status
//! that says what kind of thing went wrong.

mod client;
mod guide;
mod render;

use std::process::ExitCode;
use std::time::Duration;

use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use uxnan_control_protocol::rpc::ErrorCode;

#[derive(Parser)]
#[command(
    name = "uxnan-cli",
    version,
    about = "Operate the running Uxnan Desktop from any shell — for people, scripts and agents.",
    long_about = None,
    disable_help_subcommand = true
)]
struct Cli {
    /// Print the raw result as JSON (stable; prefer it from scripts and agents).
    #[arg(long, global = true)]
    json: bool,
    /// Seconds to wait for the app's answer.
    #[arg(long, global = true, default_value_t = 30)]
    timeout: u64,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Report the running app: version, protocol, enabled groups, counts.
    Status,
    /// Projects registered in Uxnan.
    Project {
        #[command(subcommand)]
        cmd: ProjectCmd,
    },
    /// Worktrees of the projects.
    Worktree {
        #[command(subcommand)]
        cmd: WorktreeCmd,
    },
    /// Terminal tabs and the agents in them.
    Terminal {
        #[command(subcommand)]
        cmd: TerminalCmd,
    },
    /// The agents Uxnan is tracking.
    Agent {
        #[command(subcommand)]
        cmd: AgentCmd,
    },
    /// Orchestration runs.
    Run {
        #[command(subcommand)]
        cmd: RunCmd,
    },
    /// Saved automations (unattended, recurring runs).
    Automation {
        #[command(subcommand)]
        cmd: AutomationCmd,
    },
    /// The app window.
    App {
        #[command(subcommand)]
        cmd: AppCmd,
    },
    /// Files in the editor.
    File {
        #[command(subcommand)]
        cmd: FileCmd,
    },
    /// The integrated browser.
    Browser {
        #[command(subcommand)]
        cmd: BrowserCmd,
    },
    /// Call any catalog entry by its method name.
    Rpc {
        /// The method, e.g. `worktree/list`.
        method: String,
        /// The params as a JSON object.
        #[arg(long, default_value = "{}")]
        params: String,
    },
    /// Guides for agents and people.
    Skills {
        #[command(subcommand)]
        cmd: SkillsCmd,
    },
}

#[derive(Subcommand)]
enum ProjectCmd {
    /// List every project.
    Ls,
    /// Describe one project.
    Show { project: String },
}

#[derive(Subcommand)]
enum WorktreeCmd {
    /// List worktrees, of one project or of all.
    Ls {
        #[arg(long)]
        project: Option<String>,
    },
    /// Describe one worktree.
    Show { worktree: String },
    /// Create a worktree on a new branch, and optionally launch an agent in it.
    Create {
        /// The project (`current`, `id:`, `path:` or `name:`).
        #[arg(long)]
        project: String,
        /// The new branch name.
        #[arg(long)]
        branch: String,
        /// The ref to branch from (default: the project's default base).
        #[arg(long)]
        base: Option<String>,
        /// Check out an existing branch instead of creating one.
        #[arg(long)]
        from_existing: bool,
        #[command(flatten)]
        launch: Launch,
    },
}

/// The arguments shared by the entries that may launch an agent.
#[derive(Args)]
struct Launch {
    /// The agent to launch: a profile name, its command (`claude`, `codex`) or id.
    #[arg(long)]
    agent: Option<String>,
    /// A file whose contents become the agent's first message (needs --agent).
    #[arg(long)]
    prompt_file: Option<std::path::PathBuf>,
    /// A caller-chosen key: repeating the call with it returns the first receipt.
    #[arg(long)]
    idempotency_key: Option<String>,
}

#[derive(Subcommand)]
enum TerminalCmd {
    /// List terminal tabs, optionally only those in a worktree.
    Ls {
        #[arg(long)]
        worktree: Option<String>,
    },
    /// Describe one terminal tab (`current` for your own).
    Show { terminal: String },
    /// Show a terminal tab in the window.
    Reveal { terminal: String },
    /// Open a new terminal tab in a worktree, optionally with an agent.
    Create {
        /// The worktree (`current`, `path:` or `branch:`).
        #[arg(long)]
        worktree: String,
        /// A tab title (default: the worktree folder name).
        #[arg(long)]
        title: Option<String>,
        #[command(flatten)]
        launch: Launch,
    },
}

#[derive(Subcommand)]
enum AgentCmd {
    /// List the agents Uxnan is tracking.
    Ls,
}

#[derive(Subcommand)]
enum RunCmd {
    /// List the orchestration runs.
    Ls,
    /// Describe one run with its steps.
    Show { run: String },
    /// Start (or re-run) a saved run.
    Start {
        run: String,
        /// A caller-chosen key: repeating the call with it returns the first receipt.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
}

#[derive(Subcommand)]
enum AutomationCmd {
    /// List the saved automations.
    Ls,
    /// Run a saved automation now.
    Run {
        automation: String,
        /// A caller-chosen key: repeating the call with it returns the first receipt.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
}

#[derive(Subcommand)]
enum AppCmd {
    /// Bring the Uxnan window to the front.
    Focus,
}

#[derive(Args)]
struct FileTarget {
    /// The file: absolute, or relative to the worktree.
    path: String,
    /// The worktree the path belongs to (`current` by default).
    #[arg(long)]
    worktree: Option<String>,
}

#[derive(Subcommand)]
enum FileCmd {
    /// Open a file in the editor.
    Open {
        #[command(flatten)]
        target: FileTarget,
    },
    /// Open a file's working-tree diff.
    Diff {
        #[command(flatten)]
        target: FileTarget,
        /// The staged (index vs HEAD) diff instead of the unstaged one.
        #[arg(long)]
        staged: bool,
    },
}

#[derive(Subcommand)]
enum BrowserCmd {
    /// Open a URL in the integrated browser.
    Open { url: String },
    /// Navigate the integrated browser to a URL.
    Navigate { url: String },
    /// Reload the current page.
    Reload,
    /// Go back.
    Back,
    /// Go forward.
    Forward,
    /// Report the browser's state.
    Status,
}

#[derive(Subcommand)]
enum SkillsCmd {
    /// Print a guide.
    Get {
        /// Which guide; only `control` exists.
        name: String,
        /// The long form, with every entry and argument.
        #[arg(long)]
        full: bool,
    },
}

/// What a command resolves to: a catalog call, or text printed locally.
enum Plan {
    Call { method: &'static str, params: Value },
    Text(String),
}

fn plan(command: Command) -> Result<Plan, String> {
    let sel = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    let with = |method: &'static str, params: Value| Ok(Plan::Call { method, params });
    match command {
        Command::Status => with("status", json!({})),
        Command::Project { cmd } => match cmd {
            ProjectCmd::Ls => with("project/list", json!({})),
            ProjectCmd::Show { project } => with("project/show", json!({ "project": project })),
        },
        Command::Worktree { cmd } => match cmd {
            WorktreeCmd::Ls { project } => match sel(project) {
                Some(p) => with("worktree/list", json!({ "project": p })),
                None => with("worktree/list", json!({})),
            },
            WorktreeCmd::Show { worktree } => {
                with("worktree/show", json!({ "worktree": worktree }))
            }
            WorktreeCmd::Create {
                project,
                branch,
                base,
                from_existing,
                launch,
            } => {
                let mut p = json!({ "project": project, "branch": branch });
                if let Some(b) = sel(base) {
                    p["base"] = json!(b);
                }
                if from_existing {
                    p["fromExisting"] = json!(true);
                }
                launch.apply(&mut p)?;
                with("worktree/create", p)
            }
        },
        Command::Terminal { cmd } => match cmd {
            TerminalCmd::Ls { worktree } => match sel(worktree) {
                Some(w) => with("terminal/list", json!({ "worktree": w })),
                None => with("terminal/list", json!({})),
            },
            TerminalCmd::Show { terminal } => {
                with("terminal/show", json!({ "terminal": terminal }))
            }
            TerminalCmd::Reveal { terminal } => {
                with("terminal/reveal", json!({ "terminal": terminal }))
            }
            TerminalCmd::Create {
                worktree,
                title,
                launch,
            } => {
                let mut p = json!({ "worktree": worktree });
                if let Some(t) = sel(title) {
                    p["title"] = json!(t);
                }
                launch.apply(&mut p)?;
                with("terminal/create", p)
            }
        },
        Command::Agent { cmd } => match cmd {
            AgentCmd::Ls => with("agent/list", json!({})),
        },
        Command::Run { cmd } => match cmd {
            RunCmd::Ls => with("run/list", json!({})),
            RunCmd::Show { run } => with("run/show", json!({ "run": run })),
            RunCmd::Start {
                run,
                idempotency_key,
            } => {
                let mut p = json!({ "run": run });
                if let Some(k) = sel(idempotency_key) {
                    p["idempotencyKey"] = json!(k);
                }
                with("run/start", p)
            }
        },
        Command::Automation { cmd } => match cmd {
            AutomationCmd::Ls => with("automation/list", json!({})),
            AutomationCmd::Run {
                automation,
                idempotency_key,
            } => {
                let mut p = json!({ "automation": automation });
                if let Some(k) = sel(idempotency_key) {
                    p["idempotencyKey"] = json!(k);
                }
                with("automation/run", p)
            }
        },
        Command::App { cmd } => match cmd {
            AppCmd::Focus => with("app/focus", json!({})),
        },
        Command::File { cmd } => match cmd {
            FileCmd::Open { target } => {
                let mut p = json!({ "path": target.path });
                if let Some(w) = sel(target.worktree) {
                    p["worktree"] = json!(w);
                }
                with("file/open", p)
            }
            FileCmd::Diff { target, staged } => {
                let mut p = json!({ "path": target.path, "staged": staged });
                if let Some(w) = sel(target.worktree) {
                    p["worktree"] = json!(w);
                }
                with("file/diff", p)
            }
        },
        Command::Browser { cmd } => match cmd {
            BrowserCmd::Open { url } => with("browser/open", json!({ "url": url })),
            BrowserCmd::Navigate { url } => with("browser/navigate", json!({ "url": url })),
            BrowserCmd::Reload => with("browser/reload", json!({})),
            BrowserCmd::Back => with("browser/back", json!({})),
            BrowserCmd::Forward => with("browser/forward", json!({})),
            BrowserCmd::Status => with("browser/status", json!({})),
        },
        Command::Rpc { method, params } => {
            let params: Value = serde_json::from_str(&params)
                .map_err(|e| format!("--params is not valid JSON: {e}"))?;
            if !params.is_object() {
                return Err("--params must be a JSON object".into());
            }
            // The method name is only known at run time; the catalog check
            // happens on the app's side. Leak it so the plan can carry a
            // `&'static str` like the fixed commands — a one-off per process.
            let method: &'static str = Box::leak(method.into_boxed_str());
            with(method, params)
        }
        Command::Skills { cmd } => match cmd {
            SkillsCmd::Get { name, full } => {
                if name != "control" {
                    return Err(format!("unknown guide `{name}`; only `control` exists"));
                }
                Ok(Plan::Text(if full {
                    guide::full()
                } else {
                    guide::short()
                }))
            }
        },
    }
}

/// The most a prompt file may weigh — the same cap the app enforces, checked
/// here first so a too-large file is refused before anything is sent.
const PROMPT_MAX_BYTES: u64 = 64 * 1024;

impl Launch {
    /// Put the launch arguments into `params`, reading the prompt file.
    fn apply(self, params: &mut Value) -> Result<(), String> {
        if let Some(agent) = self.agent.filter(|a| !a.trim().is_empty()) {
            params["agent"] = json!(agent.trim());
        }
        if let Some(path) = self.prompt_file {
            if params.get("agent").is_none() {
                return Err(
                    "--prompt-file needs --agent: a plain terminal has nobody to read it".into(),
                );
            }
            params["prompt"] = json!(read_prompt_file(&path)?);
        }
        if let Some(key) = self.idempotency_key.filter(|k| !k.trim().is_empty()) {
            params["idempotencyKey"] = json!(key.trim());
        }
        Ok(())
    }
}

/// Read a prompt file: UTF-8, non-empty, under the cap.
fn read_prompt_file(path: &std::path::Path) -> Result<String, String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("cannot read prompt file {}: {e}", path.display()))?;
    if meta.len() > PROMPT_MAX_BYTES {
        return Err(format!(
            "prompt file {} is {} bytes; the most a first message may be is {} — tell the agent to read the file instead",
            path.display(),
            meta.len(),
            PROMPT_MAX_BYTES
        ));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read prompt file {}: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Err(format!("prompt file {} is empty", path.display()));
    }
    Ok(text)
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let json = cli.json;
    let timeout = Duration::from_secs(cli.timeout.max(1));
    let plan = match plan(cli.command) {
        Ok(p) => p,
        Err(message) => return fail(json, ErrorCode::InvalidParams, &message),
    };
    match plan {
        Plan::Text(text) => {
            print!("{text}");
            ExitCode::SUCCESS
        }
        Plan::Call { method, params } => {
            let endpoint = match client::discover() {
                Ok(e) => e,
                Err(e) => return fail(json, e.code, &e.message),
            };
            match client::call(&endpoint, method, params, timeout) {
                Ok(result) => {
                    if json {
                        println!(
                            "{}",
                            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".into())
                        );
                    } else {
                        print!("{}", render::render(method, &result));
                        if method == "status" {
                            println!("found via: {}", endpoint.via);
                        }
                    }
                    ExitCode::SUCCESS
                }
                Err(e) => fail(json, e.code, &e.message),
            }
        }
    }
}

/// Report a failure the way the contract says: on stderr, as text or as the
/// error object, and with the code's exit status.
fn fail(json: bool, code: ErrorCode, message: &str) -> ExitCode {
    if json {
        eprintln!(
            "{}",
            serde_json::to_string(&json!({ "error": { "code": code.code(), "message": message } }))
                .unwrap_or_default()
        );
    } else {
        eprintln!("uxnan-cli: {message}");
    }
    ExitCode::from(code.exit_status() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_file_must_exist_be_non_empty_and_fit_the_cap() {
        let dir = std::env::temp_dir().join(format!("uxnan-cli-prompt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("ok.md");
        std::fs::write(&ok, "do the thing\n").unwrap();
        assert_eq!(read_prompt_file(&ok).unwrap(), "do the thing\n");
        let empty = dir.join("empty.md");
        std::fs::write(&empty, "  \n").unwrap();
        assert!(read_prompt_file(&empty).unwrap_err().contains("is empty"));
        let big = dir.join("big.md");
        std::fs::write(&big, "x".repeat(PROMPT_MAX_BYTES as usize + 1)).unwrap();
        assert!(read_prompt_file(&big)
            .unwrap_err()
            .contains("the most a first message may be"));
        assert!(read_prompt_file(&dir.join("missing.md"))
            .unwrap_err()
            .contains("cannot read"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_prompt_needs_an_agent_and_launch_args_land_in_params() {
        let dir = std::env::temp_dir().join(format!("uxnan-cli-launch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("p.md");
        std::fs::write(&file, "hello").unwrap();
        let mut p = json!({ "worktree": "current" });
        let no_agent = Launch {
            agent: None,
            prompt_file: Some(file.clone()),
            idempotency_key: None,
        };
        assert!(no_agent
            .apply(&mut p)
            .unwrap_err()
            .contains("needs --agent"));
        let full = Launch {
            agent: Some(" claude ".into()),
            prompt_file: Some(file),
            idempotency_key: Some("k1".into()),
        };
        full.apply(&mut p).unwrap();
        assert_eq!(p["agent"], "claude");
        assert_eq!(p["prompt"], "hello");
        assert_eq!(p["idempotencyKey"], "k1");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
