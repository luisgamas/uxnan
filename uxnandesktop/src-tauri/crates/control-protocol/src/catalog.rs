//! The method catalog: every entry a caller may ask for, in every transport.
//!
//! An entry has one JSON-RPC name (`domain/verb`, the naming the bridge's
//! contract already uses, so a future merge of the two is mechanical), one MCP
//! tool name (`domain_verb`, the form agent CLIs accept), one argument schema
//! and one result. The app dispatches by the RPC name; the MCP adapter and the
//! console client only translate. Nothing outside this list is reachable — not
//! a Tauri command, not a PTY write, not a shell.
//!
//! Entries are grouped, and a group is a **feature**: it carries its own version
//! and can be switched off without touching the others. The order of the groups
//! is the order they are meant to be trusted in — reading comes first, creating
//! things later, talking to an agent after that.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// A capability group. Each one is versioned and switchable on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    /// Reads with no effect: status, lists, one item.
    Read,
    /// Actions on the window itself that change nothing on disk or in a process:
    /// focus, reveal a terminal, open a file or a diff, drive the browser.
    Ui,
    /// Create a worktree or a terminal, start a saved run — idempotent, receipted.
    Create,
    /// Talk to a running agent: send a complete message, wait for a state, read
    /// its screen.
    Converse,
    /// Coordinate several agents: tasks, an inbox, questions, completion reports.
    Orchestrate,
}

impl Group {
    /// The feature version of the group. A group whose behaviour changes in a
    /// way a caller could notice bumps this, not the protocol version.
    pub const fn version(self) -> u32 {
        match self {
            Group::Read => 1,
            Group::Ui => 1,
            Group::Create => 1,
            Group::Converse => 1,
            Group::Orchestrate => 2,
        }
    }

    /// Stable lowercase name, as it appears in `status` and in `settings.control.disabledGroups`.
    pub const fn name(self) -> &'static str {
        match self {
            Group::Read => "read",
            Group::Ui => "ui",
            Group::Create => "create",
            Group::Converse => "converse",
            Group::Orchestrate => "orchestrate",
        }
    }

    /// Every group, in trust order.
    pub const ALL: [Group; 5] = [
        Group::Read,
        Group::Ui,
        Group::Create,
        Group::Converse,
        Group::Orchestrate,
    ];
}

/// One catalog entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// JSON-RPC method name, `domain/verb`.
    pub method: &'static str,
    /// MCP tool name, `domain_verb` (agent CLIs reject a `/` in a tool name).
    pub tool: &'static str,
    pub group: Group,
    /// What the entry does, written for the agent that will read it as a tool
    /// description: when to use it, what it needs, what comes back.
    pub summary: &'static str,
    /// JSON Schema (draft 2020-12 subset) of the `params` object.
    pub params: Value,
    /// Whether the entry changes anything (a window, a process, the disk). Reads
    /// are safe to retry blindly; a mutation carries a receipt.
    pub mutates: bool,
    /// JSON Schema of the `result` object: every field, with what it means. The
    /// reference documentation and the MCP `outputSchema` are both this.
    pub result: Value,
    /// Params a caller would plausibly send — the example in the reference.
    pub example: Value,
}

/// The schema fragment for a project selector argument.
fn project_selector(required: bool) -> Value {
    json!({
        "type": "string",
        "description": if required {
            "Which project: `current` (the project of the terminal you run in), `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`."
        } else {
            "Which project: `current`, `id:<projectId>`, `path:<absolute folder>`, or `name:<project name>`. Omit for every project."
        }
    })
}

/// The schema fragment for a worktree selector argument.
fn worktree_selector() -> Value {
    json!({
        "type": "string",
        "description": "Which worktree: `current` (the one your terminal runs in), `path:<absolute folder>`, or `branch:<branch name>`."
    })
}

/// The schema fragment for a terminal selector argument.
fn terminal_selector() -> Value {
    json!({
        "type": "string",
        "description": "Which terminal: `current` (the one you run in, from UXNAN_AGENT_ID), or `id:<terminalId>` from `terminal/list`."
    })
}

/// The schema fragment every `create` entry accepts: a caller-chosen key that
/// makes a retry return the first receipt instead of doing the thing twice.
fn idempotency_key() -> Value {
    json!({
        "type": "string",
        "description": "Optional caller-chosen key (e.g. a UUID). Repeating a call with the same key returns the receipt of the first call instead of creating a second worktree/terminal/run. Held for the app's lifetime."
    })
}

/// The schema fragment for choosing an agent profile to launch.
fn agent_selector() -> Value {
    json!({
        "type": "string",
        "description": "Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id. Omit for no agent (a plain terminal)."
    })
}

/// The schema fragment for the first message to an agent that was just launched.
fn prompt() -> Value {
    json!({
        "type": "string",
        "description": "A first message for the launched agent, typed into it once it is ready (queued behind Uxnan's backpressure, so it is never pasted into a busy agent). Requires `agent`. At most 64 KiB."
    })
}

/// A result field.
fn field(ty: &str, description: &str) -> Value {
    json!({ "type": ty, "description": description })
}

/// A result field that is always present but may be `null`.
fn nullable(ty: &str, description: &str) -> Value {
    json!({ "type": [ty, "null"], "description": description })
}

/// A result field that is left out when there is nothing to say (never
/// `null`). Read it with a default.
fn optional(ty: &str, description: &str) -> Value {
    json!({ "type": ty, "description": description, ABSENT: true })
}

/// The private marker [`optional`] sets and [`result`] turns into `required`.
const ABSENT: &str = "x-absent";

/// A result object. Every property is listed in `required` except the ones
/// built with [`optional`]; a [`nullable`] one is required but may be `null`.
fn result(properties: Value) -> Value {
    let mut properties = properties;
    let mut required = Vec::new();
    if let Some(map) = properties.as_object_mut() {
        for (name, schema) in map.iter_mut() {
            let absent = schema
                .as_object_mut()
                .and_then(|o| o.remove(ABSENT))
                .is_some();
            if !absent {
                required.push(Value::String(name.clone()));
            }
        }
    }
    json!({ "type": "object", "properties": properties, "required": required })
}

/// A nested result object, with what it is.
fn nested(description: &str, properties: Value) -> Value {
    described(description, result(properties))
}

/// A shared shape placed as a field: the same schema, with what it is here.
fn described(description: &str, mut schema: Value) -> Value {
    schema["description"] = json!(description);
    schema
}

/// An array of one shape.
fn list_of(item: Value, description: &str) -> Value {
    json!({ "type": "array", "items": item, "description": description })
}

/// The project record every view names (`ProjectRef`).
fn project_ref() -> Value {
    result(json!({
        "id": field("string", "The project id — what `id:<projectId>` selects."),
        "name": field("string", "The display name — what `name:<project name>` selects."),
        "path": field("string", "Absolute folder of the project."),
        "target": field("string", "`local`, or `ssh:<hostId>` for a project on a host."),
        "isGit": field("boolean", "Whether the folder is a git repository. A plain folder has one pseudo-worktree and no branches."),
    }))
}

/// A tracked agent (`AgentView`).
fn agent_view() -> Value {
    result(json!({
        "terminalId": field("string", "The terminal it runs in — its `UXNAN_AGENT_ID`."),
        "kind": optional("string", "`claude`, `codex`, … when its hooks said."),
        "status": field("string", "`working`, `blocked`, `waiting` (asked the person something) or `done` (turn finished)."),
        "prompt": optional("string", "The prompt it is working on, when reported."),
        "tool": optional("string", "The tool in use (`file_edit`, `bash`, …), when reported."),
        "interrupted": field("boolean", "Whether it reported being interrupted."),
        "summary": optional("string", "A short preview of its latest reply, when reported."),
        "sessionId": optional("string", "The provider's own session id, when captured — what its `--resume` takes."),
        "cwd": optional("string", "The folder its terminal was opened in, when known."),
        "firstSeen": field("integer", "Epoch seconds of its first report."),
        "lastUpdate": field("integer", "Epoch seconds of its latest report."),
    }))
}

/// [`agent_view`] as an optional field: the agent a terminal tracks, once one
/// has reported.
fn tracked_agent() -> Value {
    let mut v = described(
        "The agent tracked in this tab, once one has reported.",
        agent_view(),
    );
    v[ABSENT] = json!(true);
    v
}

/// A worktree with its project and the agents in it (`WorktreeView`).
fn worktree_view(with_status: bool) -> Value {
    let mut props = json!({
        "path": field("string", "Absolute folder of the worktree — what `path:` selects."),
        "branch": nullable("string", "The checked-out branch — what `branch:` selects; null when detached or not a repository."),
        "head": nullable("string", "The HEAD commit, when known."),
        "isMain": field("boolean", "Whether this is the project's primary checkout."),
        "project": described("The project it belongs to.", project_ref()),
        "agents": list_of(agent_view(), "The live agents whose terminal was opened inside this worktree."),
    });
    if with_status {
        props["status"] = result(json!({
            "dirty": field("integer", "Changed entries in the working tree."),
            "ahead": field("integer", "Commits ahead of the upstream."),
            "behind": field("integer", "Commits behind the upstream."),
        }));
        props["status"]["description"] = json!(
            "The change counts of a local repository; a plain folder and a host's worktree have none."
        );
        props["status"][ABSENT] = json!(true);
    }
    result(props)
}

/// A terminal tab with the agent state the app knows for it (`TerminalView`).
fn terminal_view() -> Value {
    result(json!({
        "id": field("string", "The tab id — also the PTY id and the agent id; what `id:<terminalId>` selects."),
        "title": field("string", "The tab title (a custom one when the person renamed it)."),
        "workspace": field("string", "The workspace key: the worktree folder, prefixed `ssh:<hostId>::` on a host, empty for the Global space."),
        "cwd": optional("string", "The folder the shell was opened in."),
        "target": field("string", "`local`, or `ssh:<hostId>`."),
        "agentName": optional("string", "The configured agent launched in this tab, when one was."),
        "agentCommand": optional("string", "That agent's command (`claude`, `codex`, …)."),
        "agentModel": optional("string", "The model the launch pinned, when the profile pins one."),
        "exited": field("boolean", "Whether the shell has exited."),
        "asleep": field("boolean", "Whether the tab is asleep (its PTY released, restorable)."),
        "agent": tracked_agent(),
    }))
}

/// A project with its worktrees (`ProjectView`).
fn project_with_worktrees(with_status: bool) -> Value {
    let mut v = project_ref();
    v["properties"]["worktrees"] = list_of(worktree_view(with_status), "The project's worktrees.");
    v
}

/// One task of a driven run — a step, as `task/list` describes it.
fn task_view() -> Value {
    result(json!({
        "id": field("string", "The task id, unique within the run (`s1`, `s2`, …) — what `task/update`, `worker/start` and `dependsOn` take."),
        "title": field("string", "The task's title."),
        "kind": field("string", "`interactive` (a worker in a terminal, started with `worker/start`), `headless` (the engine runs the agent in print mode by itself once the task is ready) or `gate` (a question waiting for an answer)."),
        "status": field("string", "`pending` (dependencies unmet), `ready` (dispatchable — an interactive task waits here for `worker/start`), `running`, `blocked`, `completed`, `failed` or `skipped` (a dependency failed)."),
        "dependsOn": list_of(field("string", "A task id."), "Tasks that must complete first."),
        "prompt": field("string", "The task's prompt; `{{steps.<id>.output}}` references a finished task's output."),
        "dispatchId": optional("string", "The current dispatch (`<task>.<attempt>`), once the task has been dispatched — the one a worker's report must name."),
        "outcome": optional("string", "`success`, `failure` or `blocked`, once a worker reported."),
        "attempts": field("integer", "How many times it has been dispatched."),
        "output": nullable("string", "The captured result, once finished."),
        "error": optional("string", "Why it failed, when it did."),
        "terminal": optional("string", "The worker's terminal id, for an interactive task that was started."),
        "question": optional("object", "For a gate: `{ question, options?, resolver, answered, answer?, askedBy? }`."),
    }))
}

/// A message in a driven run's inbox.
fn inbox_message() -> Value {
    result(json!({
        "deliveryId": field("string", "What to acknowledge (`m<n>`)."),
        "type": field("string", "`worker_done` (a task completed; `text` is its result), `worker_failed` (`text` is why), `question` (a worker asks; `stepId` is the question id to answer) or `status` (a progress line)."),
        "stepId": field("string", "The task — or, for a question, the question — the message is about."),
        "dispatchId": optional("string", "The dispatch the message came from, for `worker_*`."),
        "text": field("string", "The message."),
        "at": field("integer", "Epoch milliseconds."),
    }))
}

/// A receipt: what every `create` entry and `agent/send` answer with.
fn receipt(extra: Value) -> Value {
    let mut props = json!({
        "requestId": field("string", "A fresh id for this call — the audit line carries it too."),
        "idempotencyKey": optional("string", "The key the caller sent, when it sent one."),
    });
    if let (Some(dst), Some(src)) = (props.as_object_mut(), extra.as_object()) {
        for (k, v) in src {
            dst.insert(k.clone(), v.clone());
        }
    }
    result(props)
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

/// The whole catalog, in group order. Built on each call — it is small, and a
/// function keeps the entries free of `static` gymnastics for the `json!`
/// schemas.
pub fn catalog() -> Vec<Entry> {
    vec![
        // ── Read ─────────────────────────────────────────────────────────────
        Entry {
            method: "status",
            tool: "uxnan_status",
            group: Group::Read,
            summary: "Report the running Uxnan Desktop: its version, the control protocol version, which capability groups are enabled, and how many projects, terminals and live agents it holds. Call this first to learn what you may ask for.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({
                "app": field("string", "`uxnan-desktop`."),
                "version": field("string", "The app version."),
                "protocolVersion": field("integer", "The control protocol version the app speaks."),
                "pid": field("integer", "The app's process id."),
                "groups": list_of(result(json!({
                    "name": field("string", "`read`, `ui`, `create`, `converse` or `orchestrate`."),
                    "version": field("integer", "The group's feature version."),
                    "enabled": field("boolean", "Whether the group is switched on."),
                })), "Every capability group, in trust order."),
                "caller": nested("Who the app takes you for, from the token you presented.", json!({
                    "kind": field("string", "`launch` (a process the app started) or `control` (the user's shell)."),
                    "terminalId": optional("string", "For a launch caller: the terminal it said it is (null when it did not say)."),
                })),
                "counts": nested("What the app holds right now.", json!({
                    "projects": field("integer", "Registered projects."),
                    "terminals": field("integer", "Live terminals."),
                    "agents": field("integer", "Live agents."),
                })),
                "cli": nested("Where `uxnan-cli` is on this machine.", json!({
                    "bundled": nullable("string", "The binary shipped inside the app, next to its executable — on the PATH of every terminal Uxnan opens (also named by `UXNAN_CLI` there). Null for a build made without the sidecar."),
                    "shim": nullable("string", "The link (macOS/Linux, `~/.local/bin/uxnan-cli`) or copy (Windows, `%LOCALAPPDATA%\\uxnan\\bin`) the app keeps for your own shell. Null when it could not be written."),
                })),
            })),
            example: json!({}),
        },
        Entry {
            method: "project/list",
            tool: "project_list",
            group: Group::Read,
            summary: "List the projects registered in Uxnan: id, name, folder, whether it is a git repository, the machine it lives on, and its worktrees with branch and change counts.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({ "projects": list_of(project_with_worktrees(false), "Every registered project.") })),
            example: json!({}),
        },
        Entry {
            method: "project/show",
            tool: "project_show",
            group: Group::Read,
            summary: "Describe one project: the same record `project/list` gives, for the project you select.",
            params: object(json!({ "project": project_selector(true) }), &["project"]),
            mutates: false,
            result: project_with_worktrees(true),
            example: json!({ "project": "name:uxnan" }),
        },
        Entry {
            method: "worktree/list",
            tool: "worktree_list",
            group: Group::Read,
            summary: "List worktrees: path, branch, HEAD, whether it is the main checkout, and which live agents run in it. Filter by project or list them all.",
            params: object(json!({ "project": project_selector(false) }), &[]),
            mutates: false,
            result: result(json!({ "worktrees": list_of(worktree_view(false), "The worktrees, of one project or of all.") })),
            example: json!({ "project": "current" }),
        },
        Entry {
            method: "worktree/show",
            tool: "worktree_show",
            group: Group::Read,
            summary: "Describe one worktree: path, branch, HEAD, the project it belongs to, its dirty/ahead/behind counts and the agents running in it.",
            params: object(json!({ "worktree": worktree_selector() }), &["worktree"]),
            mutates: false,
            result: worktree_view(true),
            example: json!({ "worktree": "branch:feat/x" }),
        },
        Entry {
            method: "terminal/list",
            tool: "terminal_list",
            group: Group::Read,
            summary: "List the terminal tabs open in Uxnan: id, title, working directory, the worktree it belongs to, and — when an agent runs in it — the agent, its model and its live state (working, waiting, blocked, done).",
            params: object(json!({ "worktree": worktree_selector() }), &[]),
            mutates: false,
            result: result(json!({ "terminals": list_of(terminal_view(), "Every terminal tab, optionally only those in a worktree.") })),
            example: json!({ "worktree": "current" }),
        },
        Entry {
            method: "terminal/show",
            tool: "terminal_show",
            group: Group::Read,
            summary: "Describe one terminal tab, including the agent state Uxnan knows for it. Use `current` to learn about your own terminal.",
            params: object(json!({ "terminal": terminal_selector() }), &["terminal"]),
            mutates: false,
            result: terminal_view(),
            example: json!({ "terminal": "current" }),
        },
        Entry {
            method: "agent/list",
            tool: "agent_list",
            group: Group::Read,
            summary: "List the agents Uxnan is currently tracking: terminal id, agent kind, state (working, waiting, blocked, done), the prompt and tool last reported, and the worktree they run in.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({ "agents": list_of(agent_view(), "Every live agent the app tracks.") })),
            example: json!({}),
        },
        Entry {
            method: "run/list",
            tool: "run_list",
            group: Group::Read,
            summary: "List the orchestration runs (multi-step, multi-agent plans) with their status and step counts.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({ "runs": list_of(result(json!({
                "id": field("string", "The run id — what `run/show` and `run/start` take."),
                "title": field("string", "The run's title."),
                "status": field("string", "`draft`, `running`, `paused`, `completed`, `failed` or `cancelled`."),
                "createdAt": field("integer", "Epoch milliseconds."),
                "updatedAt": field("integer", "Epoch milliseconds."),
                "steps": field("integer", "How many steps the run has."),
                "completed": field("integer", "How many of them are completed."),
            })), "Every saved orchestration run.") })),
            example: json!({}),
        },
        Entry {
            method: "run/show",
            tool: "run_show",
            group: Group::Read,
            summary: "Describe one orchestration run: every step with its kind, target, dependencies, status and captured output.",
            params: object(json!({ "run": { "type": "string", "description": "The run id from `run/list`." } }), &["run"]),
            mutates: false,
            result: result(json!({
                "id": field("string", "The run id."),
                "title": field("string", "The run's title."),
                "status": field("string", "`draft`, `running`, `paused`, `completed`, `failed` or `cancelled`."),
                "createdAt": field("integer", "Epoch milliseconds."),
                "updatedAt": field("integer", "Epoch milliseconds."),
                "steps": list_of(result(json!({
                    "id": field("string", "The step id, unique within the run (`s1`, `s2`, …)."),
                    "title": field("string", "The step's title."),
                    "kind": field("string", "`interactive`, `headless` or `gate`."),
                    "target": field("object", "Where the step runs (an agent type or a specific terminal)."),
                    "dependsOn": list_of(field("string", "A step id."), "Steps that must complete first."),
                    "status": field("string", "`pending`, `ready`, `running`, `blocked`, `completed`, `failed` or `skipped`."),
                    "prompt": field("string", "The step's prompt template."),
                    "output": nullable("string", "The captured output, once the step ran."),
                })), "Every step of the run."),
            })),
            example: json!({ "run": "run-1a2b" }),
        },
        Entry {
            method: "automation/list",
            tool: "automation_list",
            group: Group::Read,
            summary: "List the saved automations (unattended, recurring agent runs): id, name, whether it is enabled, its schedule and its working folder.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({ "automations": list_of(result(json!({
                "id": field("string", "The automation id — what `automation/run` takes."),
                "name": field("string", "Its name."),
                "description": field("string", "Its description, possibly empty."),
                "enabled": field("boolean", "Whether its schedule is active."),
                "tags": list_of(field("string", "A label."), "Free-form labels the list groups by."),
                "workingDir": field("string", "The folder a run executes in."),
                "worktreePerRun": field("boolean", "Whether every run gets its own worktree."),
                "schedule": field("object", "Its schedule: `{ kind: \"every\", n, unit, startsAt }`, `{ kind: \"dailyAt\", hour, minute }`, `{ kind: \"weekdaysAt\", hour, minute }` or `{ kind: \"weeklyAt\", day, hour, minute }`."),
                "steps": list_of(result(json!({
                    "id": field("string", "The step id."),
                    "title": field("string", "The step's title."),
                    "agent": field("string", "The agent it runs (`claude`, `codex`, …)."),
                    "model": field("string", "The model it pins; empty for the CLI's default."),
                })), "Its steps, in order."),
                "updatedAt": field("integer", "Epoch milliseconds of the last edit."),
            })), "Every saved automation.") })),
            example: json!({}),
        },
        Entry {
            method: "browser/status",
            tool: "browser_status",
            group: Group::Read,
            summary: "Report the integrated browser's state: whether a page is open, the current URL, whether the in-app browser is enabled, and how opens are routed (in-app / external / ask).",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({
                "open": field("boolean", "Whether a page is open in the integrated browser."),
                "url": nullable("string", "The page's URL, when one is open."),
                "enabled": field("boolean", "Whether the integrated browser is enabled in Settings."),
                "policy": field("string", "How opens are routed: `internal`, `external` or `ask`."),
            })),
            example: json!({}),
        },
        // ── Ui ───────────────────────────────────────────────────────────────
        Entry {
            method: "app/focus",
            tool: "app_focus",
            group: Group::Ui,
            summary: "Bring the Uxnan window to the front.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({ "focused": field("boolean", "Always true on success.") })),
            example: json!({}),
        },
        Entry {
            method: "terminal/reveal",
            tool: "terminal_reveal",
            group: Group::Ui,
            summary: "Show a terminal tab: switch to its workspace and make it the active tab, so the person sees what that agent is doing.",
            params: object(json!({ "terminal": terminal_selector() }), &["terminal"]),
            mutates: true,
            result: result(json!({ "revealed": field("string", "The terminal id now active.") })),
            example: json!({ "terminal": "id:5f0c…" }),
        },
        Entry {
            method: "file/open",
            tool: "file_open",
            group: Group::Ui,
            summary: "Open a file in Uxnan's editor tab (or reveal it if already open). The path must be inside a registered worktree.",
            params: object(
                json!({
                    "path": { "type": "string", "description": "Absolute path of the file, or a path relative to the selected worktree." },
                    "worktree": worktree_selector()
                }),
                &["path"],
            ),
            mutates: true,
            result: result(json!({ "opened": field("string", "The absolute path now open in the editor.") })),
            example: json!({ "path": "src/app.ts", "worktree": "current" }),
        },
        Entry {
            method: "file/diff",
            tool: "file_diff",
            group: Group::Ui,
            summary: "Open a file's working-tree diff in Uxnan (the Changes view of its tab), so the person can review what changed. `staged` shows the index-vs-HEAD diff instead.",
            params: object(
                json!({
                    "path": { "type": "string", "description": "Path of the file relative to the worktree, or absolute." },
                    "worktree": worktree_selector(),
                    "staged": { "type": "boolean", "description": "Show the staged diff instead of the unstaged one. Default false." }
                }),
                &["path"],
            ),
            mutates: true,
            result: result(json!({
                "opened": field("string", "The absolute path whose diff is now shown."),
                "staged": field("boolean", "Which diff: staged (index vs HEAD) or unstaged."),
            })),
            example: json!({ "path": "src/app.ts", "worktree": "branch:feat/x", "staged": false }),
        },
        Entry {
            method: "browser/open",
            tool: "browser_open",
            group: Group::Ui,
            summary: "Open the integrated in-app browser and load a URL. Use it to preview or test a web app, page or dev server you are building (for example http://localhost:3000). Uxnan routes the open per the user's setting (in-app, external browser, or ask).",
            params: object(
                json!({ "url": { "type": "string", "description": "Absolute URL to open, e.g. http://localhost:3000 or https://example.com." } }),
                &["url"],
            ),
            mutates: true,
            result: result(json!({ "requested": field("string", "The URL handed to the link policy.") })),
            example: json!({ "url": "http://localhost:3000" }),
        },
        Entry {
            method: "browser/navigate",
            tool: "browser_navigate",
            group: Group::Ui,
            summary: "Navigate the integrated browser to a new URL (opening the panel first if it is not open). Same routing as browser/open.",
            params: object(
                json!({ "url": { "type": "string", "description": "Absolute URL to navigate to." } }),
                &["url"],
            ),
            mutates: true,
            result: result(json!({ "requested": field("string", "The URL handed to the link policy.") })),
            example: json!({ "url": "http://localhost:3000/settings" }),
        },
        Entry {
            method: "browser/reload",
            tool: "browser_reload",
            group: Group::Ui,
            summary: "Reload the current page in the integrated browser. Use it after you change code and want to see the result. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({ "reloaded": field("boolean", "Always true on success.") })),
            example: json!({}),
        },
        Entry {
            method: "browser/back",
            tool: "browser_back",
            group: Group::Ui,
            summary: "Go back one entry in the integrated browser's history. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({ "navigated": field("string", "`back`.") })),
            example: json!({}),
        },
        Entry {
            method: "browser/forward",
            tool: "browser_forward",
            group: Group::Ui,
            summary: "Go forward one entry in the integrated browser's history. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({ "navigated": field("string", "`forward`.") })),
            example: json!({}),
        },
        // ── Create ───────────────────────────────────────────────────────────
        Entry {
            method: "worktree/create",
            tool: "worktree_create",
            group: Group::Create,
            summary: "Create a git worktree on a new branch of a project — where Uxnan's worktree-location policy puts it — list it in the sidebar, and optionally launch an agent in it with a first message. Use it to give a subtask its own isolated space and agent instead of running `git worktree add` yourself: Uxnan then sees, lists and can stop it. It happens in the background: the person's focus stays where it is (`terminal/reveal` moves it). Returns a receipt with the worktree and, when an agent was launched, its terminal id.",
            params: object(
                json!({
                    "project": project_selector(true),
                    "branch": { "type": "string", "description": "The new branch name (also the worktree's folder name under the policy's root)." },
                    "base": { "type": "string", "description": "The ref to branch from. Default: the project's default base (its main branch)." },
                    "fromExisting": { "type": "boolean", "description": "Check out an existing branch named `branch` instead of creating it. Default false." },
                    "agent": agent_selector(),
                    "prompt": prompt(),
                    "unattended": { "type": "boolean", "description": "Launch the agent in its CLI's reviewed automatic mode, so it does not stop at every tool for a person who is not there (`claude --permission-mode auto`, `codex --approve-for-me`, …; some CLIs only reach an edits-only tier where shell and MCP still prompt). Default false: a terminal an agent opens is attended unless asked. A profile whose own args or env already pick a mode is left alone; a CLI with no such tier launches as configured — the receipt says which (`unattended`)." },
                    "idempotencyKey": idempotency_key()
                }),
                &["project", "branch"],
            ),
            mutates: true,
            result: receipt(json!({
                "worktree": described("The worktree, as `worktree/list` describes it.", worktree_view(false)),
                "adopted": field("boolean", "Whether the window listed it and launched the agent. False when the window was not there; the worktree exists either way."),
                "terminal": optional("object", "`{ id, agent }` of the launched agent's terminal — only when `agent` was given and the window adopted."),
                "warning": optional("string", "Why the window did not adopt, when it did not."),
                "unattended": optional("string", "When the launch was unattended: `applied` (the CLI's reviewed automatic mode went on its command line or environment), `partial` (only its edits-only tier — shell and MCP tools still prompt; read the screen and answer with `agent/send --force` if it stalls), `configured` (the profile's own args or env already pick a mode; left alone) or `unsupported` (no tier known for that CLI; launched as configured)."),
            })),
            example: json!({ "project": "current", "branch": "feat/subtask", "agent": "claude", "prompt": "Implement the parser described in TASK.md.", "idempotencyKey": "3d1f…" }),
        },
        Entry {
            method: "terminal/create",
            tool: "terminal_create",
            group: Group::Create,
            summary: "Open a new terminal tab in a worktree, optionally launching a configured agent in it with a first message. The tab opens in the background — the person's focus stays where it is (`terminal/reveal` moves it). Returns a receipt with the terminal id.",
            params: object(
                json!({
                    "worktree": worktree_selector(),
                    "agent": agent_selector(),
                    "title": { "type": "string", "description": "A tab title. Default: the worktree folder name." },
                    "prompt": prompt(),
                    "unattended": { "type": "boolean", "description": "Launch the agent in its CLI's reviewed automatic mode, so it does not stop at every tool for a person who is not there (`claude --permission-mode auto`, `codex --approve-for-me`, …; some CLIs only reach an edits-only tier where shell and MCP still prompt). Default false: a terminal an agent opens is attended unless asked. A profile whose own args or env already pick a mode is left alone; a CLI with no such tier launches as configured — the receipt says which (`unattended`)." },
                    "idempotencyKey": idempotency_key()
                }),
                &["worktree"],
            ),
            mutates: true,
            result: receipt(json!({
                "terminal": nested("The new tab.", json!({
                    "id": field("string", "The new tab's id."),
                    "agent": optional("string", "The launched agent's name, when one was."),
                })),
                "worktree": field("string", "The worktree folder the tab opened in."),
                "unattended": optional("string", "When the launch was unattended: `applied` (the CLI's reviewed automatic mode went on its command line or environment), `partial` (only its edits-only tier — shell and MCP tools still prompt; read the screen and answer with `agent/send --force` if it stalls), `configured` (the profile's own args or env already pick a mode; left alone) or `unsupported` (no tier known for that CLI; launched as configured)."),
            })),
            example: json!({ "worktree": "branch:feat/subtask", "title": "build", "idempotencyKey": "9c2e…" }),
        },
        Entry {
            method: "terminal/close",
            tool: "terminal_close",
            group: Group::Create,
            summary: "Close a terminal tab: one the surface opened (`terminal/create`, `worktree/create`, `worker/start`) once its agent is no longer working, or any terminal whose shell has exited — the way a coordinator collects the workers it started. A terminal a person opened and is still using is refused; one whose agent is working is refused as busy until it is done.",
            params: object(json!({ "terminal": terminal_selector() }), &["terminal"]),
            mutates: true,
            result: result(json!({ "closed": field("string", "The terminal id that was closed.") })),
            example: json!({ "terminal": "id:5f0c…" }),
        },
        Entry {
            method: "run/start",
            tool: "run_start",
            group: Group::Create,
            summary: "Start (or re-run) a saved orchestration run by id: every step is reset and the engine begins dispatching. Refused with the validation errors when the run is not runnable. Only saved runs can be started; there is no way to inject steps from here.",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id from `run/list`." },
                    "idempotencyKey": idempotency_key()
                }),
                &["run"],
            ),
            mutates: true,
            result: receipt(json!({
                "run": nested("The run, now started.", json!({
                    "id": field("string", "The run id."),
                    "status": field("string", "`running` once started."),
                })),
            })),
            example: json!({ "run": "run-1a2b", "idempotencyKey": "77aa…" }),
        },
        Entry {
            method: "automation/run",
            tool: "automation_run",
            group: Group::Create,
            summary: "Run a saved automation now, as a manual run of the same headless runner its schedule uses. Only saved definitions can be run.",
            params: object(
                json!({
                    "automation": { "type": "string", "description": "The automation id from `automation/list`." },
                    "idempotencyKey": idempotency_key()
                }),
                &["automation"],
            ),
            mutates: true,
            result: receipt(json!({
                "automation": nested("The automation, now running.", json!({
                    "id": field("string", "The automation id."),
                    "started": field("boolean", "Always true on success: the headless runner was started."),
                })),
            })),
            example: json!({ "automation": "nightly-lint" }),
        },
        // ── Converse ─────────────────────────────────────────────────────────
        Entry {
            method: "agent/send",
            tool: "agent_send",
            group: Group::Converse,
            summary: "Send a complete message to a running agent, as one paste-and-submit — never as keystrokes. By default the message waits in Uxnan's backpressure queue until that agent is free (not working); `force` types it now, which interrupts whatever the agent is doing and should be rare. Only an agent's terminal can receive a message; a plain shell has nobody to read it. Use `agent/wait` afterwards to learn when the agent has finished.",
            params: object(
                json!({
                    "terminal": terminal_selector(),
                    "message": { "type": "string", "description": "The whole message, as the person would type it. At most 64 KiB." },
                    "force": { "type": "boolean", "description": "Type it now even if the agent is working. Default false." },
                    "idempotencyKey": idempotency_key()
                }),
                &["terminal", "message"],
            ),
            mutates: true,
            result: receipt(json!({
                "terminal": field("string", "The terminal the message was handed to."),
                "delivery": field("string", "`queued` (waits for the agent to be free), `delivered` (it was free) or `forced`."),
                "bytes": field("integer", "The message's size."),
            })),
            example: json!({ "terminal": "id:5f0c…", "message": "Now add tests for the parser." }),
        },
        Entry {
            method: "agent/wait",
            tool: "agent_wait",
            group: Group::Converse,
            summary: "Wait until an agent reaches a state, as reported by its own hooks: `idle` (its turn finished — the state to wait for after sending a message), `waiting` (it stopped to ask the person something), or `exit` (its terminal is gone). Returns the state reached and how long it took, or a timeout. One call waits at most 15 seconds; call again to keep waiting (uxnan-cli does this for you and prints a heartbeat).",
            params: object(
                json!({
                    "terminal": terminal_selector(),
                    "for": { "type": "string", "description": "`idle`, `waiting` or `exit`." },
                    "timeoutMs": { "type": "integer", "description": "How long this call may wait, in milliseconds. Capped at 15000. Default 15000." }
                }),
                &["terminal", "for"],
            ),
            mutates: false,
            result: result(json!({
                "terminal": field("string", "The terminal waited on."),
                "reached": field("string", "`idle`, `waiting` or `exit` — the state reached."),
                "waitedMs": field("integer", "How long this call waited."),
            })),
            example: json!({ "terminal": "id:5f0c…", "for": "idle", "timeoutMs": 15000 }),
        },
        Entry {
            method: "terminal/read",
            tool: "terminal_read",
            group: Group::Converse,
            summary: "Read the last lines of a terminal's screen as plain text (escapes removed, blank rows dropped), with secrets redacted — tokens, keys, `Authorization` headers, `password=`. Use it to see what an agent printed or asked. Every read is written to Uxnan's audit log; a project can be opted out of reads (`settings.control.terminalReadDisabledProjects`).",
            params: object(
                json!({
                    "terminal": terminal_selector(),
                    "lines": { "type": "integer", "description": "How many lines from the bottom. Default 120, at most 2000." }
                }),
                &["terminal"],
            ),
            mutates: false,
            result: result(json!({
                "terminal": field("string", "The terminal read."),
                "lines": field("integer", "How many lines came back."),
                "text": field("string", "The screen text, escapes removed, blank rows dropped, secrets redacted."),
            })),
            example: json!({ "terminal": "id:5f0c…", "lines": 60 }),
        },
        // ── Orchestrate ──────────────────────────────────────────────────────
        Entry {
            method: "orchestration/reportResult",
            tool: "orchestration_report_result",
            group: Group::Orchestrate,
            summary: "Report the final result of the task Uxnan's orchestration run gave you, so the run captures your output verbatim and can feed it to the next step. Call it exactly once, when you are done. Pass your UXNAN_AGENT_ID as agentId; a worker started by a coordinator also passes the taskId and dispatchId its preamble gave it (a report naming a dispatch that is no longer the task's current one is ignored) and an outcome.",
            params: object(
                json!({
                    "agentId": { "type": "string", "description": "The value of your UXNAN_AGENT_ID environment variable (identifies which run step you are)." },
                    "result": { "type": "string", "description": "Your full result/output for the task, captured verbatim by the run." },
                    "summary": { "type": "string", "description": "Optional one-line summary of the result." },
                    "taskId": { "type": "string", "description": "The task id from your preamble, when a coordinator started you." },
                    "dispatchId": { "type": "string", "description": "The dispatch id from your preamble. Holds the completion authority: only the task's current dispatch may finish it." },
                    "outcome": { "type": "string", "enum": ["success", "failure", "blocked"], "description": "What the task came to. Default `success`. `failure` fails the task (its retry policy applies); `blocked` too, saying you could not proceed." }
                }),
                &["agentId", "result"],
            ),
            mutates: true,
            result: result(json!({
                "reported": field("string", "`result`."),
                "accepted": field("boolean", "Whether a running task took the report. False when no task is waiting on this agent, or the dispatch is stale."),
                "task": optional("string", "The task the report went to."),
                "reason": optional("string", "Why it was not accepted."),
            })),
            example: json!({ "agentId": "5f0c…", "taskId": "s2", "dispatchId": "s2.1", "outcome": "success", "result": "Done: parser implemented, 12 tests green.", "summary": "parser done" }),
        },
        Entry {
            method: "orchestration/reportProgress",
            tool: "orchestration_report_progress",
            group: Group::Orchestrate,
            summary: "Report a short progress update for your current orchestration-run step (optional; it surfaces what you are doing in the run view). Pass your UXNAN_AGENT_ID as agentId.",
            params: object(
                json!({
                    "agentId": { "type": "string", "description": "The value of your UXNAN_AGENT_ID environment variable." },
                    "message": { "type": "string", "description": "A one-line progress message." }
                }),
                &["agentId", "message"],
            ),
            mutates: true,
            result: result(json!({ "reported": field("string", "`progress`.") })),
            example: json!({ "agentId": "5f0c…", "message": "Writing tests" }),
        },
        Entry {
            method: "run/create",
            tool: "run_create",
            group: Group::Orchestrate,
            summary: "Create an orchestration run you will drive as its coordinator: an empty, running run to which you add tasks (`task/create`), start workers (`worker/start`) and read the inbox (`inbox/check`) until you finish it (`run/finish`). It stays running until then, however many tasks it holds. The person sees it in the Runs console like any other run and can intervene.",
            params: object(
                json!({
                    "title": { "type": "string", "description": "The run's title, as the console shows it." },
                    "idempotencyKey": idempotency_key()
                }),
                &["title"],
            ),
            mutates: true,
            result: receipt(json!({
                "run": nested("The new run.", json!({
                    "id": field("string", "The run id — what every other orchestrate entry takes as `run`."),
                    "status": field("string", "`running`."),
                })),
                "coordinator": optional("string", "Your terminal id, when a launched agent created the run."),
            })),
            example: json!({ "title": "Split the parser work", "idempotencyKey": "4b7e…" }),
        },
        Entry {
            method: "run/finish",
            tool: "run_finish",
            group: Group::Orchestrate,
            summary: "Finish a run you drive: record its outcome and summary and end it. Workers still running keep their terminals; the run stops accepting reports.",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id." },
                    "outcome": { "type": "string", "enum": ["success", "failure", "blocked"], "description": "What the run came to." },
                    "summary": { "type": "string", "description": "A short closing summary for the person." }
                }),
                &["run", "outcome"],
            ),
            mutates: true,
            result: result(json!({
                "run": nested("The run, ended.", json!({
                    "id": field("string", "The run id."),
                    "status": field("string", "`completed` for `success`, `failed` otherwise."),
                })),
            })),
            example: json!({ "run": "run-1a2b", "outcome": "success", "summary": "Parser split in three worktrees, all merged." }),
        },
        Entry {
            method: "task/create",
            tool: "task_create",
            group: Group::Orchestrate,
            summary: "Add a task to a run you drive. An `interactive` task (the default) waits, once its dependencies are done, for you to start a worker in a terminal with `worker/start`; a `headless` task names an agent and the engine runs it in print mode by itself when it becomes ready, capturing its output. `dependsOn` builds the graph; a task's prompt may reference an earlier task's result with `{{steps.<id>.output}}`.",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id." },
                    "title": { "type": "string", "description": "A short title." },
                    "prompt": { "type": "string", "description": "What the worker is asked to do. At most 64 KiB." },
                    "dependsOn": { "type": "array", "items": { "type": "string" }, "description": "Task ids that must complete first." },
                    "kind": { "type": "string", "enum": ["interactive", "headless"], "description": "Default `interactive`." },
                    "agent": { "type": "string", "description": "For `headless`: the agent to run (its profile name, command or id)." },
                    "worktree": worktree_selector(),
                    "retry": { "type": "boolean", "description": "Retry once on failure instead of failing the task. Default false." },
                    "idempotencyKey": idempotency_key()
                }),
                &["run", "title", "prompt"],
            ),
            mutates: true,
            result: receipt(json!({
                "task": nested("The new task.", json!({
                    "id": field("string", "The task id."),
                    "status": field("string", "`pending` (dependencies unmet) or `ready`."),
                })),
            })),
            example: json!({ "run": "run-1a2b", "title": "Lexer", "prompt": "Write the lexer described in docs/lexer.md; run its tests.", "dependsOn": [] }),
        },
        Entry {
            method: "task/list",
            tool: "task_list",
            group: Group::Orchestrate,
            summary: "The tasks of a run with their state, dispatch, worker terminal, captured output and open questions — what a coordinator reads to decide what to start next.",
            params: object(json!({ "run": { "type": "string", "description": "The run id." } }), &["run"]),
            mutates: true,
            result: result(json!({
                "run": nested("The run.", json!({
                    "id": field("string", "The run id."),
                    "title": field("string", "Its title."),
                    "status": field("string", "`running` until finished; then `completed`, `failed` or `cancelled`."),
                    "driven": field("boolean", "Whether a coordinator drives it."),
                })),
                "tasks": list_of(task_view(), "Every task, in creation order."),
                "inbox": field("integer", "How many messages wait in the inbox."),
            })),
            example: json!({ "run": "run-1a2b" }),
        },
        Entry {
            method: "task/update",
            tool: "task_update",
            group: Group::Orchestrate,
            summary: "Change a task of a run you drive: its title, prompt or dependencies while it has not started, or close it by hand (`completed`, `failed` or `skipped`) with an output — for work you did yourself or decided to drop.",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id." },
                    "task": { "type": "string", "description": "The task id." },
                    "title": { "type": "string" },
                    "prompt": { "type": "string" },
                    "dependsOn": { "type": "array", "items": { "type": "string" } },
                    "status": { "type": "string", "enum": ["completed", "failed", "skipped"], "description": "Close the task with this status." },
                    "output": { "type": "string", "description": "The result to record when closing it." }
                }),
                &["run", "task"],
            ),
            mutates: true,
            result: result(json!({
                "task": nested("The task, after the change.", json!({
                    "id": field("string", "The task id."),
                    "status": field("string", "Its status now."),
                })),
            })),
            example: json!({ "run": "run-1a2b", "task": "s3", "status": "skipped", "output": "Not needed after s2." }),
        },
        Entry {
            method: "worker/start",
            tool: "worker_start",
            group: Group::Orchestrate,
            summary: "Start a worker for a ready task: open a terminal — in the current worktree, in a new worktree on a new branch (`worktree: \"new\"`), or in a given one — launch the agent in it and hand it the task with a preamble that names its task and dispatch, tells it to report exactly once and how to ask you a question. The task becomes `running`; you learn it finished from the inbox (`worker_done` / `worker_failed`). Its terminal is a normal tab the person can watch.",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id." },
                    "task": { "type": "string", "description": "A `ready` task id." },
                    "agent": { "type": "string", "description": "Which configured agent to launch, by its profile name, its command (e.g. `claude`, `codex`) or its profile id." },
                    "worktree": { "type": "string", "description": "`current` (default: your own worktree), `new` (a new worktree of the project on a new branch), or a selector `path:<folder>` / `branch:<name>`." },
                    "branch": { "type": "string", "description": "For `new`: the branch name. Default `run/<run>/<task>`." },
                    "project": project_selector(false),
                    "unattended": { "type": "boolean", "description": "Whether the worker launches in its CLI's reviewed automatic mode, so it does not stop at every tool for a person who is not there (`claude --permission-mode auto`, `codex --approve-for-me`, …; some CLIs only reach an edits-only tier where shell and MCP still prompt). **Default: the agent's own setting** (Settings → Agents → *Automatic mode when launched by an agent*, on unless the person switched it off) — a worker is unattended by design; pass `false` (the CLI's `--attended`) to launch it as configured. A profile whose own args or env already pick a mode is left alone; a CLI with no such tier launches as configured — the receipt says which (`unattended`)." },
                    "idempotencyKey": idempotency_key()
                }),
                &["run", "task", "agent"],
            ),
            mutates: true,
            result: receipt(json!({
                "task": field("string", "The task id."),
                "dispatchId": field("string", "The dispatch this worker holds — the only one whose report the task will take."),
                "terminal": nested("The worker's terminal.", json!({
                    "id": field("string", "The tab id — read its screen with `terminal/read`, wait on it with `agent/wait`."),
                    "agent": field("string", "The launched agent's name."),
                })),
                "worktree": field("string", "The folder the worker runs in."),
                "unattended": optional("string", "When the launch was unattended: `applied` (the CLI's reviewed automatic mode went on its command line or environment), `partial` (only its edits-only tier — shell and MCP tools still prompt; read the screen and answer with `agent/send --force` if it stalls), `configured` (the profile's own args or env already pick a mode; left alone) or `unsupported` (no tier known for that CLI; launched as configured)."),
            })),
            example: json!({ "run": "run-1a2b", "task": "s1", "agent": "codex", "worktree": "new" }),
        },
        Entry {
            method: "inbox/check",
            tool: "inbox_check",
            group: Group::Orchestrate,
            summary: "Read the inbox of a run you drive: workers finishing or failing, questions waiting for your answer, progress lines. Acknowledge what you have handled with `ack` — an unacknowledged message is delivered again, and survives a restart. With `wait`, the call blocks until a message arrives or its budget runs out (at most 15 seconds per call; call again to keep waiting — uxnan-cli does this for you).",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id." },
                    "ack": { "type": "array", "items": { "type": "string" }, "description": "Delivery ids to acknowledge first." },
                    "wait": { "type": "boolean", "description": "Block until a message is there. Default false." },
                    "timeoutMs": { "type": "integer", "description": "How long this call may wait, in milliseconds. Capped at 15000. Default 15000." }
                }),
                &["run"],
            ),
            mutates: true,
            result: result(json!({
                "run": field("string", "The run id."),
                "messages": list_of(inbox_message(), "Every unacknowledged message, oldest first."),
                "acked": field("integer", "How many of `ack` were dropped."),
            })),
            example: json!({ "run": "run-1a2b", "ack": ["m1", "m2"], "wait": true }),
        },
        Entry {
            method: "question/ask",
            tool: "question_ask",
            group: Group::Orchestrate,
            summary: "As a worker, ask the run's coordinator a question and wait for the answer — instead of guessing or asking a prompt nobody reads. The question reaches the coordinator's inbox (and the Runs console, where the person can answer too). One call waits at most 15 seconds; on timeout, call again with the returned `questionId` to keep waiting (uxnan-cli does this for you).",
            params: object(
                json!({
                    "question": { "type": "string", "description": "The question." },
                    "options": { "type": "array", "items": { "type": "string" }, "description": "Choices, when the answer is one of a few." },
                    "questionId": { "type": "string", "description": "To keep waiting on a question already asked." },
                    "timeoutMs": { "type": "integer", "description": "How long this call may wait, in milliseconds. Capped at 15000. Default 15000." }
                }),
                &[],
            ),
            mutates: true,
            result: result(json!({
                "run": field("string", "The run the question belongs to."),
                "questionId": field("string", "The question's id."),
                "answered": field("boolean", "Whether an answer arrived within this call."),
                "answer": optional("string", "The answer, when it did."),
                "decision": optional("string", "`approve` or `reject`, when it did."),
            })),
            example: json!({ "question": "Keep the old CLI flag for compatibility?", "options": ["yes", "no"] }),
        },
        Entry {
            method: "question/answer",
            tool: "question_answer",
            group: Group::Orchestrate,
            summary: "Answer a worker's question in a run you drive (it came to your inbox as `question`). The worker waiting on it receives the answer at once.",
            params: object(
                json!({
                    "run": { "type": "string", "description": "The run id." },
                    "question": { "type": "string", "description": "The question id (the inbox message's `stepId`)." },
                    "answer": { "type": "string", "description": "The answer." },
                    "decision": { "type": "string", "enum": ["approve", "reject"], "description": "Default `approve`; `reject` tells the worker not to proceed." }
                }),
                &["run", "question", "answer"],
            ),
            mutates: true,
            result: result(json!({
                "question": field("string", "The question id."),
                "resolved": field("boolean", "Always true on success."),
            })),
            example: json!({ "run": "run-1a2b", "question": "s4", "answer": "yes, keep it" }),
        },
    ]
}

/// Look an entry up by its RPC method name.
pub fn by_method(method: &str) -> Option<Entry> {
    catalog().into_iter().find(|e| e.method == method)
}

/// Look an entry up by its MCP tool name.
pub fn by_tool(tool: &str) -> Option<Entry> {
    catalog().into_iter().find(|e| e.tool == tool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Two entries with the same name, in either transport, would make one of
    /// them unreachable — and a tool name with a `/` is rejected by agent CLIs.
    #[test]
    fn names_are_unique_and_well_formed() {
        let entries = catalog();
        let mut methods = HashSet::new();
        let mut tools = HashSet::new();
        for e in &entries {
            assert!(methods.insert(e.method), "duplicate method {}", e.method);
            assert!(tools.insert(e.tool), "duplicate tool {}", e.tool);
            assert!(!e.tool.contains('/'), "tool {} contains a slash", e.tool);
            assert!(
                e.tool
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "tool {} is not snake_case",
                e.tool
            );
            assert!(
                e.method == "status" || e.method.contains('/'),
                "method {} is not domain/verb",
                e.method
            );
            assert!(!e.summary.is_empty());
        }
    }

    /// Every schema is an object schema with `additionalProperties: false`, so a
    /// misspelled argument is an error the caller sees rather than a silently
    /// ignored one.
    #[test]
    fn every_params_schema_is_a_closed_object() {
        for e in catalog() {
            assert_eq!(e.params["type"], "object", "{}", e.method);
            assert_eq!(e.params["additionalProperties"], false, "{}", e.method);
            assert!(e.params["properties"].is_object(), "{}", e.method);
            assert!(e.params["required"].is_array(), "{}", e.method);
        }
    }

    /// Reads never mutate and creations always do; a `converse` entry may be a
    /// read (`wait`, `read`) or a send. The flag is what the client uses to
    /// decide whether a retry is safe.
    #[test]
    fn the_mutates_flag_follows_the_group() {
        for e in catalog() {
            match e.group {
                Group::Read => assert!(!e.mutates, "{} is a read that mutates", e.method),
                Group::Ui | Group::Create | Group::Orchestrate => {
                    assert!(e.mutates, "{} does not mutate", e.method)
                }
                Group::Converse => {
                    let sends = e.method == "agent/send";
                    assert_eq!(e.mutates, sends, "{}", e.method);
                }
            }
        }
    }

    #[test]
    fn lookups_find_by_either_name() {
        assert_eq!(by_method("worktree/list").unwrap().tool, "worktree_list");
        assert_eq!(by_tool("worktree_list").unwrap().method, "worktree/list");
        assert!(by_method("shell/exec").is_none());
    }

    #[test]
    fn group_names_round_trip_through_serde() {
        for g in Group::ALL {
            let s = serde_json::to_string(&g).unwrap();
            assert_eq!(s, format!("\"{}\"", g.name()));
            let back: Group = serde_json::from_str(&s).unwrap();
            assert_eq!(back, g);
        }
    }
}
