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
            Group::Orchestrate => 1,
        }
    }

    /// Stable lowercase name, as it appears in `status` and in settings.
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
        },
        Entry {
            method: "project/list",
            tool: "project_list",
            group: Group::Read,
            summary: "List the projects registered in Uxnan: id, name, folder, whether it is a git repository, the machine it lives on, and its worktrees with branch and change counts.",
            params: object(json!({}), &[]),
            mutates: false,
        },
        Entry {
            method: "project/show",
            tool: "project_show",
            group: Group::Read,
            summary: "Describe one project: the same record `project/list` gives, for the project you select.",
            params: object(json!({ "project": project_selector(true) }), &["project"]),
            mutates: false,
        },
        Entry {
            method: "worktree/list",
            tool: "worktree_list",
            group: Group::Read,
            summary: "List worktrees: path, branch, HEAD, whether it is the main checkout, and which live agents run in it. Filter by project or list them all.",
            params: object(json!({ "project": project_selector(false) }), &[]),
            mutates: false,
        },
        Entry {
            method: "worktree/show",
            tool: "worktree_show",
            group: Group::Read,
            summary: "Describe one worktree: path, branch, HEAD, the project it belongs to, its dirty/ahead/behind counts and the agents running in it.",
            params: object(json!({ "worktree": worktree_selector() }), &["worktree"]),
            mutates: false,
        },
        Entry {
            method: "terminal/list",
            tool: "terminal_list",
            group: Group::Read,
            summary: "List the terminal tabs open in Uxnan: id, title, working directory, the worktree it belongs to, and — when an agent runs in it — the agent, its model and its live state (working, waiting, blocked, done).",
            params: object(json!({ "worktree": worktree_selector() }), &[]),
            mutates: false,
        },
        Entry {
            method: "terminal/show",
            tool: "terminal_show",
            group: Group::Read,
            summary: "Describe one terminal tab, including the agent state Uxnan knows for it. Use `current` to learn about your own terminal.",
            params: object(json!({ "terminal": terminal_selector() }), &["terminal"]),
            mutates: false,
        },
        Entry {
            method: "agent/list",
            tool: "agent_list",
            group: Group::Read,
            summary: "List the agents Uxnan is currently tracking: terminal id, agent kind, state (working, waiting, blocked, done), the prompt and tool last reported, and the worktree they run in.",
            params: object(json!({}), &[]),
            mutates: false,
        },
        Entry {
            method: "run/list",
            tool: "run_list",
            group: Group::Read,
            summary: "List the orchestration runs (multi-step, multi-agent plans) with their status and step counts.",
            params: object(json!({}), &[]),
            mutates: false,
        },
        Entry {
            method: "run/show",
            tool: "run_show",
            group: Group::Read,
            summary: "Describe one orchestration run: every step with its kind, target, dependencies, status and captured output.",
            params: object(json!({ "run": { "type": "string", "description": "The run id from `run/list`." } }), &["run"]),
            mutates: false,
        },
        Entry {
            method: "automation/list",
            tool: "automation_list",
            group: Group::Read,
            summary: "List the saved automations (unattended, recurring agent runs): id, name, whether it is enabled, its schedule and its working folder.",
            params: object(json!({}), &[]),
            mutates: false,
        },
        Entry {
            method: "browser/status",
            tool: "browser_status",
            group: Group::Read,
            summary: "Report the integrated browser's state: whether a page is open, the current URL, whether the in-app browser is enabled, and how opens are routed (in-app / external / ask).",
            params: object(json!({}), &[]),
            mutates: false,
        },
        // ── Ui ───────────────────────────────────────────────────────────────
        Entry {
            method: "app/focus",
            tool: "app_focus",
            group: Group::Ui,
            summary: "Bring the Uxnan window to the front.",
            params: object(json!({}), &[]),
            mutates: true,
        },
        Entry {
            method: "terminal/reveal",
            tool: "terminal_reveal",
            group: Group::Ui,
            summary: "Show a terminal tab: switch to its workspace and make it the active tab, so the person sees what that agent is doing.",
            params: object(json!({ "terminal": terminal_selector() }), &["terminal"]),
            mutates: true,
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
        },
        Entry {
            method: "browser/reload",
            tool: "browser_reload",
            group: Group::Ui,
            summary: "Reload the current page in the integrated browser. Use it after you change code and want to see the result. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
        },
        Entry {
            method: "browser/back",
            tool: "browser_back",
            group: Group::Ui,
            summary: "Go back one entry in the integrated browser's history. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
        },
        Entry {
            method: "browser/forward",
            tool: "browser_forward",
            group: Group::Ui,
            summary: "Go forward one entry in the integrated browser's history. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
        },
        // ── Create ───────────────────────────────────────────────────────────
        Entry {
            method: "worktree/create",
            tool: "worktree_create",
            group: Group::Create,
            summary: "Create a git worktree on a new branch of a project — where Uxnan's worktree-location policy puts it — make it the active worktree, and optionally launch an agent in it with a first message. Use it to give a subtask its own isolated space and agent instead of running `git worktree add` yourself: Uxnan then sees, lists and can stop it. Returns a receipt with the worktree and, when an agent was launched, its terminal id.",
            params: object(
                json!({
                    "project": project_selector(true),
                    "branch": { "type": "string", "description": "The new branch name (also the worktree's folder name under the policy's root)." },
                    "base": { "type": "string", "description": "The ref to branch from. Default: the project's default base (its main branch)." },
                    "fromExisting": { "type": "boolean", "description": "Check out an existing branch named `branch` instead of creating it. Default false." },
                    "agent": agent_selector(),
                    "prompt": prompt(),
                    "idempotencyKey": idempotency_key()
                }),
                &["project", "branch"],
            ),
            mutates: true,
        },
        Entry {
            method: "terminal/create",
            tool: "terminal_create",
            group: Group::Create,
            summary: "Open a new terminal tab in a worktree, optionally launching a configured agent in it with a first message. Returns a receipt with the terminal id.",
            params: object(
                json!({
                    "worktree": worktree_selector(),
                    "agent": agent_selector(),
                    "title": { "type": "string", "description": "A tab title. Default: the worktree folder name." },
                    "prompt": prompt(),
                    "idempotencyKey": idempotency_key()
                }),
                &["worktree"],
            ),
            mutates: true,
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
        },
        // ── Orchestrate ──────────────────────────────────────────────────────
        Entry {
            method: "orchestration/reportResult",
            tool: "orchestration_report_result",
            group: Group::Orchestrate,
            summary: "Report the final result of the task Uxnan's orchestration run gave you, so the run captures your output verbatim and can feed it to the next step. Call it once, when you are done. Pass your UXNAN_AGENT_ID as agentId.",
            params: object(
                json!({
                    "agentId": { "type": "string", "description": "The value of your UXNAN_AGENT_ID environment variable (identifies which run step you are)." },
                    "result": { "type": "string", "description": "Your full result/output for the task, captured verbatim by the run." },
                    "summary": { "type": "string", "description": "Optional one-line summary of the result." }
                }),
                &["agentId", "result"],
            ),
            mutates: true,
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

    /// Reads never mutate; everything else does. The flag is what the client
    /// uses to decide whether a retry is safe.
    #[test]
    fn read_group_entries_do_not_mutate() {
        for e in catalog() {
            if e.group == Group::Read {
                assert!(!e.mutates, "{} is a read that mutates", e.method);
            } else {
                assert!(e.mutates, "{} is a non-read that does not mutate", e.method);
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
