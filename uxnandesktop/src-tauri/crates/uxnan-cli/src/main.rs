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
    /// Orchestration runs — and, for a coordinator, driving one.
    Run {
        #[command(subcommand)]
        cmd: RunCmd,
    },
    /// The tasks of a run you drive.
    Task {
        #[command(subcommand)]
        cmd: TaskCmd,
    },
    /// Workers: an agent in a terminal, on a task of a run you drive.
    Worker {
        #[command(subcommand)]
        cmd: WorkerCmd,
    },
    /// The inbox of a run you drive.
    Inbox {
        #[command(subcommand)]
        cmd: InboxCmd,
    },
    /// As a worker: ask the run's coordinator a question and wait for the answer.
    Ask {
        /// The question.
        #[arg(long)]
        question: Option<String>,
        /// A choice to offer (repeatable).
        #[arg(long = "option")]
        options: Vec<String>,
        /// Keep waiting on a question already asked.
        #[arg(long)]
        question_id: Option<String>,
        /// Give up after this many seconds (default 600). Heartbeats go to stderr.
        #[arg(long, default_value_t = 600)]
        timeout: u64,
    },
    /// As a coordinator: answer a worker's question.
    Answer {
        /// The run id.
        #[arg(long)]
        run: String,
        /// The question id (the inbox message's stepId).
        #[arg(long)]
        question: String,
        /// The answer.
        #[arg(long)]
        answer: String,
        /// Tell the worker not to proceed.
        #[arg(long)]
        reject: bool,
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
    /// Launch the agent in its CLI's reviewed automatic mode (no per-tool prompts).
    #[arg(long)]
    unattended: bool,
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
    /// Close a terminal tab the surface opened (once its agent is done) or
    /// whose shell has exited — how a coordinator collects its workers.
    Close { terminal: String },
    /// Read the last lines of a terminal's screen (secrets redacted).
    Read {
        terminal: String,
        /// How many lines from the bottom (default 120, at most 2000).
        #[arg(long, default_value_t = 120)]
        lines: u64,
    },
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
    /// Send a whole message to a running agent (queued until it is free).
    Send {
        /// The agent's terminal (`current` or `id:<terminalId>`).
        #[arg(long)]
        to: String,
        /// A file whose contents are the message.
        #[arg(long)]
        message_file: std::path::PathBuf,
        /// Type it now even if the agent is working (interrupts it).
        #[arg(long)]
        force: bool,
        /// A caller-chosen key: repeating the call with it returns the first receipt.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
    /// Wait until an agent reaches a state reported by its hooks.
    Wait {
        /// The agent's terminal (`current` or `id:<terminalId>`).
        #[arg(long)]
        to: String,
        /// `idle` (turn finished), `waiting` (asked the person) or `exit`.
        #[arg(long = "for")]
        state: String,
        /// Give up after this many seconds (default 600). Heartbeats go to stderr.
        #[arg(long, default_value_t = 600)]
        timeout: u64,
    },
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
    /// Create a run you will drive as its coordinator.
    Create {
        /// The run's title.
        #[arg(long)]
        title: String,
        /// A caller-chosen key: repeating the call with it returns the first receipt.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
    /// Finish a run you drive with its outcome.
    Finish {
        run: String,
        /// `success`, `failure` or `blocked`.
        #[arg(long)]
        outcome: String,
        /// A short closing summary.
        #[arg(long)]
        summary: Option<String>,
    },
}

#[derive(Subcommand)]
enum TaskCmd {
    /// Add a task to a run you drive.
    Create {
        /// The run id.
        #[arg(long)]
        run: String,
        /// A short title.
        #[arg(long)]
        title: String,
        /// A file whose contents are the task's prompt.
        #[arg(long)]
        prompt_file: std::path::PathBuf,
        /// Task ids that must complete first (repeatable).
        #[arg(long = "depends-on")]
        depends_on: Vec<String>,
        /// Run it headless with this agent instead of waiting for a worker.
        #[arg(long)]
        headless: Option<String>,
        /// The worktree a headless task runs in (`current` by default).
        #[arg(long)]
        worktree: Option<String>,
        /// Retry once on failure.
        #[arg(long)]
        retry: bool,
        /// A caller-chosen key: repeating the call with it returns the first receipt.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
    /// List the tasks of a run with their state, dispatch and output.
    Ls {
        /// The run id.
        #[arg(long)]
        run: String,
    },
    /// Change a task, or close it by hand.
    Update {
        /// The run id.
        #[arg(long)]
        run: String,
        /// The task id.
        task: String,
        #[arg(long)]
        title: Option<String>,
        /// A file whose contents replace the prompt (before it starts).
        #[arg(long)]
        prompt_file: Option<std::path::PathBuf>,
        /// Replace the dependencies (repeatable; before it starts).
        #[arg(long = "depends-on")]
        depends_on: Vec<String>,
        /// Close it: `completed`, `failed` or `skipped`.
        #[arg(long)]
        status: Option<String>,
        /// The result to record when closing it.
        #[arg(long)]
        output: Option<String>,
    },
}

#[derive(Subcommand)]
enum WorkerCmd {
    /// Start a worker for a ready task: a terminal, the agent, the task.
    Start {
        /// The run id.
        #[arg(long)]
        run: String,
        /// The task id.
        #[arg(long)]
        task: String,
        /// The agent to launch: a profile name, its command (`claude`, `codex`) or id.
        #[arg(long)]
        agent: String,
        /// `current` (default), `new` (a new worktree on a new branch), `path:` or `branch:`.
        #[arg(long)]
        worktree: Option<String>,
        /// For `new`: the branch name (default `run/<run>/<task>`).
        #[arg(long)]
        branch: Option<String>,
        /// For `new`: the project (`current` by default).
        #[arg(long)]
        project: Option<String>,
        /// Launch the worker in its CLI's reviewed automatic mode, whatever the
        /// agent's setting says (the default already follows that setting).
        #[arg(long, conflicts_with = "attended")]
        unattended: bool,
        /// Launch the worker as configured, with its usual prompts, even when the
        /// agent's setting makes workers unattended.
        #[arg(long)]
        attended: bool,
        /// A caller-chosen key: repeating the call with it returns the first receipt.
        #[arg(long)]
        idempotency_key: Option<String>,
    },
}

#[derive(Subcommand)]
enum InboxCmd {
    /// Read the inbox; with --wait, block until a message arrives.
    Check {
        /// The run id.
        #[arg(long)]
        run: String,
        /// Delivery ids to acknowledge first (repeatable).
        #[arg(long = "ack")]
        ack: Vec<String>,
        /// Block until a message is there.
        #[arg(long)]
        wait: bool,
        /// With --wait: give up after this many seconds (default 600).
        #[arg(long, default_value_t = 600)]
        timeout: u64,
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

/// What a command resolves to: a catalog call, a wait (many bounded calls
/// until the answer or the deadline), or text printed locally.
enum Plan {
    Call { method: &'static str, params: Value },
    Wait(Repeat),
    Text(String),
}

/// A wait: the same entry called again and again, each call bounded on the
/// app's side, until it answers with what was waited for. `settled` says
/// whether an `Ok` is the answer (an empty inbox is not); `carry` names the
/// fields of a *timeout* error's `data` to feed into the next call (a
/// question's id); `state` reads the heartbeat's detail from that `data`.
struct Repeat {
    method: &'static str,
    params: Value,
    timeout: Duration,
    what: String,
    settled: fn(&Value) -> bool,
    carry: &'static [&'static str],
    state: &'static str,
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
            TerminalCmd::Close { terminal } => {
                with("terminal/close", json!({ "terminal": terminal }))
            }
            TerminalCmd::Read { terminal, lines } => with(
                "terminal/read",
                json!({ "terminal": terminal, "lines": lines }),
            ),
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
            AgentCmd::Send {
                to,
                message_file,
                force,
                idempotency_key,
            } => {
                let mut p = json!({ "terminal": to, "message": read_prompt_file(&message_file)? });
                if force {
                    p["force"] = json!(true);
                }
                if let Some(k) = sel(idempotency_key) {
                    p["idempotencyKey"] = json!(k);
                }
                with("agent/send", p)
            }
            AgentCmd::Wait { to, state, timeout } => Ok(Plan::Wait(Repeat {
                method: "agent/wait",
                params: json!({ "terminal": to, "for": state.clone() }),
                timeout: Duration::from_secs(timeout.max(1)),
                what: format!("`{state}`"),
                settled: |_| true,
                carry: &[],
                state: "current",
            })),
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
            RunCmd::Create {
                title,
                idempotency_key,
            } => {
                let mut p = json!({ "title": title });
                if let Some(k) = sel(idempotency_key) {
                    p["idempotencyKey"] = json!(k);
                }
                with("run/create", p)
            }
            RunCmd::Finish {
                run,
                outcome,
                summary,
            } => {
                let mut p = json!({ "run": run, "outcome": outcome });
                if let Some(t) = sel(summary) {
                    p["summary"] = json!(t);
                }
                with("run/finish", p)
            }
        },
        Command::Task { cmd } => match cmd {
            TaskCmd::Create {
                run,
                title,
                prompt_file,
                depends_on,
                headless,
                worktree,
                retry,
                idempotency_key,
            } => {
                let mut p = json!({
                    "run": run,
                    "title": title,
                    "prompt": read_prompt_file(&prompt_file)?,
                    "dependsOn": depends_on,
                });
                if let Some(agent) = sel(headless) {
                    p["kind"] = json!("headless");
                    p["agent"] = json!(agent);
                }
                if let Some(w) = sel(worktree) {
                    p["worktree"] = json!(w);
                }
                if retry {
                    p["retry"] = json!(true);
                }
                if let Some(k) = sel(idempotency_key) {
                    p["idempotencyKey"] = json!(k);
                }
                with("task/create", p)
            }
            TaskCmd::Ls { run } => with("task/list", json!({ "run": run })),
            TaskCmd::Update {
                run,
                task,
                title,
                prompt_file,
                depends_on,
                status,
                output,
            } => {
                let mut p = json!({ "run": run, "task": task });
                if let Some(t) = sel(title) {
                    p["title"] = json!(t);
                }
                if let Some(path) = prompt_file {
                    p["prompt"] = json!(read_prompt_file(&path)?);
                }
                if !depends_on.is_empty() {
                    p["dependsOn"] = json!(depends_on);
                }
                if let Some(st) = sel(status) {
                    p["status"] = json!(st);
                }
                if let Some(o) = output {
                    p["output"] = json!(o);
                }
                with("task/update", p)
            }
        },
        Command::Worker { cmd } => match cmd {
            WorkerCmd::Start {
                run,
                task,
                agent,
                worktree,
                branch,
                project,
                unattended,
                attended,
                idempotency_key,
            } => {
                let mut p = json!({ "run": run, "task": task, "agent": agent });
                if let Some(mode) = worker_mode(unattended, attended) {
                    p["unattended"] = json!(mode);
                }
                if let Some(w) = sel(worktree) {
                    p["worktree"] = json!(w);
                }
                if let Some(b) = sel(branch) {
                    p["branch"] = json!(b);
                }
                if let Some(pr) = sel(project) {
                    p["project"] = json!(pr);
                }
                if let Some(k) = sel(idempotency_key) {
                    p["idempotencyKey"] = json!(k);
                }
                with("worker/start", p)
            }
        },
        Command::Inbox { cmd } => match cmd {
            InboxCmd::Check {
                run,
                ack,
                wait,
                timeout,
            } => {
                let mut p = json!({ "run": run });
                if !ack.is_empty() {
                    p["ack"] = json!(ack);
                }
                if !wait {
                    return with("inbox/check", p);
                }
                p["wait"] = json!(true);
                Ok(Plan::Wait(Repeat {
                    method: "inbox/check",
                    params: p,
                    timeout: Duration::from_secs(timeout.max(1)),
                    what: "a message".into(),
                    settled: |v| {
                        v.get("messages")
                            .and_then(|m| m.as_array())
                            .is_some_and(|m| !m.is_empty())
                    },
                    carry: &[],
                    state: "",
                }))
            }
        },
        Command::Ask {
            question,
            options,
            question_id,
            timeout,
        } => {
            let mut p = json!({});
            match (sel(question), sel(question_id)) {
                (_, Some(id)) => p["questionId"] = json!(id),
                (Some(q), None) => {
                    p["question"] = json!(q);
                    if !options.is_empty() {
                        p["options"] = json!(options);
                    }
                }
                (None, None) => return Err("`ask` needs --question (or --question-id)".into()),
            }
            Ok(Plan::Wait(Repeat {
                method: "question/ask",
                params: p,
                timeout: Duration::from_secs(timeout.max(1)),
                what: "the answer".into(),
                settled: |_| true,
                carry: &["questionId"],
                state: "questionId",
            }))
        }
        Command::Answer {
            run,
            question,
            answer,
            reject,
        } => {
            let mut p = json!({ "run": run, "question": question, "answer": answer });
            if reject {
                p["decision"] = json!("reject");
            }
            with("question/answer", p)
        }
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

/// What `worker start` says about `unattended`: nothing when neither flag was
/// given (the agent's own setting decides), `true` for `--unattended`, `false`
/// for `--attended`. Clap already refuses both at once.
fn worker_mode(unattended: bool, attended: bool) -> Option<bool> {
    match (unattended, attended) {
        (true, _) => Some(true),
        (false, true) => Some(false),
        (false, false) => None,
    }
}

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
        if self.unattended {
            if params.get("agent").is_none() {
                return Err("--unattended needs --agent: it is the agent's launch mode".into());
            }
            params["unattended"] = json!(true);
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
        Plan::Wait(repeat) => {
            let endpoint = match client::discover() {
                Ok(e) => e,
                Err(e) => return fail(json, e.code, &e.message),
            };
            wait(&endpoint, repeat, json)
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

/// The most one wait call may block on the app's side; the CLI keeps calling
/// until the deadline, printing a heartbeat to stderr in between so a person
/// (or a log) sees it is still alive.
const WAIT_CHUNK_MS: u64 = 15_000;

/// A wait: repeated bounded calls until the answer or the deadline. The final
/// result goes to stdout; the heartbeats never do. A timeout on the app's side
/// is one more turn (carrying what it said to carry); an `Ok` that is not yet
/// the answer (an empty inbox) is one more turn too.
fn wait(endpoint: &client::Endpoint, mut repeat: Repeat, json: bool) -> ExitCode {
    let started = std::time::Instant::now();
    loop {
        let left = repeat.timeout.saturating_sub(started.elapsed());
        if left.is_zero() {
            return fail(
                json,
                ErrorCode::Timeout,
                &format!(
                    "gave up after {} s: {} not reached",
                    repeat.timeout.as_secs(),
                    repeat.what
                ),
            );
        }
        let chunk = left.as_millis().min(WAIT_CHUNK_MS as u128) as u64;
        let mut params = repeat.params.clone();
        params["timeoutMs"] = json!(chunk);
        match client::call(
            endpoint,
            repeat.method,
            params,
            Duration::from_millis(chunk + 5_000),
        ) {
            Ok(result) if (repeat.settled)(&result) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".into())
                    );
                } else {
                    print!("{}", render::render(repeat.method, &result));
                }
                return ExitCode::SUCCESS;
            }
            Ok(_) => {
                eprintln!(
                    "waiting for {}… {} s elapsed",
                    repeat.what,
                    started.elapsed().as_secs()
                );
            }
            Err(e) if e.code == ErrorCode::Timeout => {
                if let Some(data) = &e.data {
                    for key in repeat.carry {
                        if let Some(v) = data.get(*key) {
                            repeat.params[*key] = v.clone();
                        }
                    }
                    // A question once asked is only waited on: never re-asked.
                    if repeat.method == "question/ask" {
                        repeat.params.as_object_mut().map(|o| {
                            o.remove("question");
                            o.remove("options")
                        });
                    }
                }
                let detail = e
                    .data
                    .as_ref()
                    .and_then(|d| d.get(repeat.state))
                    .and_then(|c| c.as_str())
                    .map(|c| format!(", {} is `{c}`", repeat.state))
                    .unwrap_or_default();
                eprintln!(
                    "waiting for {}… {} s elapsed{detail}",
                    repeat.what,
                    started.elapsed().as_secs()
                );
            }
            Err(e) => return fail(json, e.code, &e.message),
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
            unattended: false,
            idempotency_key: None,
        };
        assert!(no_agent
            .apply(&mut p)
            .unwrap_err()
            .contains("needs --agent"));
        let unattended_shell = Launch {
            agent: None,
            prompt_file: None,
            unattended: true,
            idempotency_key: None,
        };
        assert!(unattended_shell
            .apply(&mut json!({}))
            .unwrap_err()
            .contains("--unattended needs --agent"));
        let full = Launch {
            agent: Some(" claude ".into()),
            prompt_file: Some(file),
            unattended: true,
            idempotency_key: Some("k1".into()),
        };
        full.apply(&mut p).unwrap();
        assert_eq!(p["agent"], "claude");
        assert_eq!(p["prompt"], "hello");
        assert_eq!(p["unattended"], true);
        assert_eq!(p["idempotencyKey"], "k1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `worker start` leaves `unattended` out unless a flag says, so the agent's
    /// own setting decides; `--attended` is an explicit `false`, and the two
    /// flags refuse each other.
    #[test]
    fn worker_start_says_unattended_only_when_a_flag_does() {
        assert_eq!(worker_mode(false, false), None);
        assert_eq!(worker_mode(true, false), Some(true));
        assert_eq!(worker_mode(false, true), Some(false));
        let base = [
            "uxnan-cli",
            "worker",
            "start",
            "--run",
            "r",
            "--task",
            "s1",
            "--agent",
            "codex",
        ];
        assert!(Cli::try_parse_from(base).is_ok());
        assert!(Cli::try_parse_from(base.iter().chain(["--attended"].iter())).is_ok());
        assert!(Cli::try_parse_from(base.iter().chain(["--unattended"].iter())).is_ok());
        assert!(
            Cli::try_parse_from(base.iter().chain(["--unattended", "--attended"].iter())).is_err()
        );
    }
}
