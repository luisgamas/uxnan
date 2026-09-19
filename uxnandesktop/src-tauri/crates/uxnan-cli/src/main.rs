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
        },
        Command::Agent { cmd } => match cmd {
            AgentCmd::Ls => with("agent/list", json!({})),
        },
        Command::Run { cmd } => match cmd {
            RunCmd::Ls => with("run/list", json!({})),
            RunCmd::Show { run } => with("run/show", json!({ "run": run })),
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
