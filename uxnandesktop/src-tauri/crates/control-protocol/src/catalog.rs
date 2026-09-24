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

/// Channels on a host's live session, as an optional field: absent while the
/// host is not connected, because there is nothing to count.
fn host_channels() -> Value {
    let mut v = nested(
        "Channels in use on the live session, and the limit this host turned out to enforce. A terminal, the file session and each command are one channel each; the limit is learned from a refusal, never guessed.",
        json!({
            "open": field("integer", "Channels in use right now."),
            "limit": nullable("integer", "The host's own limit, once it has refused one. Null until then."),
        }),
    );
    v[ABSENT] = json!(true);
    v
}

/// A registered remote machine and what its session is doing (`SshHost` plus
/// live state). `full` adds what only `host/show` answers: the projects on the
/// machine and the terminals open against its session.
///
/// What is *not* here is deliberate: no key paths, no credentials, no
/// fingerprints — a caller of this surface never needs them, and the person
/// resolves anything key-shaped in Settings → Hosts.
fn host_view(full: bool) -> Value {
    let mut props = json!({
        "id": field("string", "The host id — what a project's `ssh:<hostId>` target names, and what `host/show` and `host/connect` take."),
        "label": field("string", "What the person calls this machine."),
        "hostname": field("string", "The address it is dialled at."),
        "port": field("integer", "Its SSH port."),
        "user": field("string", "The user Uxnan logs in as."),
        "source": field("string", "Where the record came from: `manual` (added here) or `sshConfig` (imported from the person's `~/.ssh/config`)."),
        "needsPrompt": field("boolean", "Whether the last connection needed a passphrase or a password. Such a host is left alone at startup and `host/connect` will likely answer `needsPassword`/`needsPassphrase`: only the person can finish it."),
        "connected": field("boolean", "Whether a live session is open on it right now — the session itself, not what the settings remember."),
        "generation": optional("integer", "The connection incarnation, while connected. It changes when a dropped session is replaced, and every mutation prepared against a session carries it."),
        "shell": optional("string", "The shell its `sshd` starts (`posix`, `cmd`, `powershell` or `unknown`), learned once per connection. It decides how a command line must be quoted for this machine."),
        "channels": host_channels(),
    });
    if full {
        props["projects"] = list_of(
            project_ref(),
            "The registered projects that live on this host.",
        );
        props["terminals"] = list_of(
            terminal_view(),
            "The terminals open against its session, as `terminal/list` describes them.",
        );
    }
    result(props)
}

/// A saved automation. `full` adds what only `automation/show` answers: each
/// step's prompt and failure handling, and the run policy — what a caller reads
/// to decide whether running it is what it wants.
fn automation_view(full: bool) -> Value {
    let mut step = json!({
        "id": field("string", "The step id (`s1`, `s2`, …) — what a `{{steps.<id>.output}}` reference names."),
        "title": field("string", "The step's title."),
        "agent": field("string", "The agent it runs (`claude`, `codex`, …)."),
        "model": field("string", "The model it pins; empty for the CLI's default."),
    });
    if full {
        step["prompt"] = field("string", "What the step asks the agent to do, as written — `{{steps.<id>.output}}` is substituted at run time.");
        step["dependsOn"] = list_of(
            field("string", "A step id."),
            "Steps that must finish first; empty means it starts with the run.",
        );
        step["onFailure"] = field(
            "string",
            "`stop` (fail the run; dependents are skipped) or `retry`.",
        );
        step["maxAttempts"] = field("integer", "How many dispatches `retry` allows.");
        step["timeoutMs"] = nullable(
            "integer",
            "The step's own wall-clock cap in milliseconds; null uses the runner's default.",
        );
        step["autonomous"] = field("boolean", "Whether this step's agent approves its own tool use. A step that must change something needs it; one that only reads should not have it.");
    }
    let mut props = json!({
        "id": field("string", "The automation id — what `automation/show` and `automation/run` take."),
        "name": field("string", "Its name."),
        "description": field("string", "Its description, possibly empty."),
        "enabled": field("boolean", "Whether its schedule is active. A disabled automation can still be run by hand."),
        "tags": list_of(field("string", "A label."), "Free-form labels the list groups by."),
        "workingDir": field("string", "The folder a run executes in."),
        "worktreePerRun": field("boolean", "Whether every run gets its own worktree, so unattended work never touches the tree the person is using."),
        "schedule": field("object", "Its schedule: `{ kind: \"every\", n, unit, startsAt }`, `{ kind: \"dailyAt\", hour, minute }`, `{ kind: \"weekdaysAt\", hour, minute }` or `{ kind: \"weeklyAt\", day, hour, minute }`."),
        "steps": list_of(result(step), "Its steps, in order."),
        "updatedAt": field("integer", "Epoch milliseconds of the last edit."),
    });
    if full {
        props["baseBranch"] = nullable(
            "string",
            "The branch a per-run worktree is cut from; null uses the repository's HEAD.",
        );
        props["createdAt"] = field("integer", "Epoch milliseconds of its creation.");
        props["policy"] = nested(
            "How a run behaves, beyond the graph.",
            json!({
                "catchUp": field("boolean", "Whether a moment missed while the machine was off is recovered."),
                "overlap": field("string", "What a trigger does while a run is going: `skip`, `queue` or `cancelPrevious`."),
                "maxRunMinutes": field("integer", "Wall-clock ceiling for the whole run."),
                "keepRuns": field("integer", "How many past runs are kept on disk."),
                "notifyOn": list_of(field("string", "`completed` or `failed`."), "Which outcomes raise a native notification."),
                "precondition": nullable("object", "`{ command, timeoutSeconds }`: a shell command that decides whether the run proceeds at all (exit 0 = go ahead). Null when there is none — `automation/run` may therefore do nothing and say why."),
            }),
        );
    }
    result(props)
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

/// A browser page (`browser/*`): the one of the caller's workspace.
fn browser_page() -> Value {
    result(json!({
        "workspace": field("string", "The workspace the page belongs to: the worktree folder of your terminal (`ssh:<hostId>::` on a host), empty for the Global space. Every workspace has its own page."),
        "url": field("string", "The page's current URL."),
        "title": field("string", "The document title; empty until the page sets one."),
        "loading": field("boolean", "Whether the page is still loading (a wait ran out before it finished)."),
        "visible": field("boolean", "Whether the person can see it right now: its workspace is on screen and its panel open. A page in another workspace loads and works hidden."),
        "canGoBack": nullable("boolean", "Whether history can go back; null when the engine does not say."),
        "canGoForward": nullable("boolean", "Whether history can go forward; null when the engine does not say."),
    }))
}

/// The schema fragment for an element reference from `browser/snapshot`.
fn element_ref() -> Value {
    json!({
        "type": "string",
        "description": "The element, by the `ref` a browser_snapshot of the current page gave it (e.g. `k3p9:e12`). A reference from before a navigation or reload is refused — take a new snapshot."
    })
}

/// The schema fragment for returning a fresh snapshot with an action.
fn snapshot_flag() -> Value {
    json!({
        "type": "boolean",
        "description": "Also return the page's new snapshot (as browser_snapshot would) in `snapshot`, saving a call. Default false."
    })
}

/// A page's outline (`browser/snapshot`).
fn page_outline() -> Value {
    result(json!({
        "url": field("string", "The page's URL."),
        "title": field("string", "The document title."),
        "outline": field("string", "The page as an indented outline, one line per element: `role \"name\" [ref=…] [state] value=\"…\" -> href`. Interactive elements carry a `ref` to pass to browser_click / browser_type; text is quoted. Password values never appear."),
        "nodes": field("integer", "Lines in the outline."),
        "interactive": field("integer", "Elements with a `ref`."),
        "truncated": field("boolean", "Whether the outline was cut at its size limit (scroll, or act on what is there)."),
        "consoleErrors": field("integer", "Errors logged by the page since it loaded (read them with browser_console)."),
        "viewport": nested("The visible area, in CSS pixels.", json!({
            "width": field("integer", "Viewport width."),
            "height": field("integer", "Viewport height."),
            "scrollX": field("integer", "Horizontal scroll offset."),
            "scrollY": field("integer", "Vertical scroll offset."),
            "scrollHeight": field("integer", "Height of the whole document."),
        })),
    }))
}

/// What a page action answers.
fn page_action_result(done: &str) -> Value {
    let mut v = result(json!({
        "done": field("string", done),
        "navigated": field("boolean", "Whether a new document loaded as a result (the action's navigation is waited for, up to 10 s)."),
        "page": browser_page_or_null("The page after the action."),
        "effect": optional("string", "What happened beyond the action itself: for browser_press, `focus` (moved focus), `submit` (submitted the form), `click` (activated the focused element) or `none`; for browser_click, `opened here` when a link meant for a new window loaded in this page (the browser has no tabs)."),
        "chosen": optional("string", "For browser_type into a select: the option chosen."),
        "scrollX": optional("integer", "For browser_scroll: the page's horizontal offset after it."),
        "scrollY": optional("integer", "For browser_scroll: the page's vertical offset after it."),
    }));
    v["properties"]["snapshot"] = {
        let mut s = described(
            "The new snapshot, when `snapshot: true` was passed.",
            page_outline(),
        );
        s[ABSENT] = json!(true);
        s
    };
    // `snapshot` was added after `result()` ran, so it is absent from `required` already.
    v
}

/// [`browser_page`] as a field that is `null` when there is no page.
fn browser_page_or_null(description: &str) -> Value {
    let mut v = described(description, browser_page());
    v["type"] = json!(["object", "null"]);
    v
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
                "budget": nested("What must be free before another agent starts here, and what is taken right now. It is the resolved resource mode (Settings → Resources), shared by this app and every automations runner: read it before dispatching workers, or they queue behind each other.", json!({
                    "concurrency": field("integer", "How many agent runs may be in flight on this machine at once."),
                    "live": field("integer", "How many of those slots are held right now, by this app and by any automations runner."),
                    "minFreeMemoryMb": field("integer", "Memory that must be free for a new agent to be admitted, in MiB. 0 = no memory condition."),
                    "freeMemoryMb": field("integer", "Memory free on this machine right now, in MiB."),
                    "maxAgentMemoryMb": field("integer", "The advisory ceiling on one run's whole process tree, in MiB. 0 = measured only, which is the default."),
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
            method: "host/list",
            tool: "host_list",
            group: Group::Read,
            summary: "List the remote machines Uxnan is registered against, with the state of their live SSH session: connected or not, the shell each one starts, and the channels in use against the limit it enforces. A project whose `target` is `ssh:<hostId>` lives on one of these — check here when work on it stops answering. You see the host your own project lives on, and the person's own shell sees every registered host: a token scoped to a project on this machine is refused (`-32003`), because an inventory of someone's machines is not a project's business.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({ "hosts": list_of(host_view(false), "The hosts you may see.") })),
            example: json!({}),
        },
        Entry {
            method: "host/show",
            tool: "host_show",
            group: Group::Read,
            summary: "Describe one host: the record `host/list` gives, plus the projects registered on it and the terminals open against its session.",
            params: object(
                json!({ "host": { "type": "string", "description": "The host id, from `host/list` or from a project's `ssh:<hostId>` target." } }),
                &["host"],
            ),
            mutates: false,
            result: host_view(true),
            example: json!({ "host": "h-42" }),
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
            summary: "List the saved automations (unattended, recurring agent runs): id, name, whether its schedule is active, the schedule itself, its working folder and its steps. Read one with `automation/show` before running it.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({ "automations": list_of(automation_view(false), "Every saved automation.") })),
            example: json!({}),
        },
        Entry {
            method: "automation/show",
            tool: "automation_show",
            group: Group::Read,
            summary: "Describe one saved automation in full: what `automation/list` gives plus each step's prompt, dependencies, failure handling and whether it approves its own tool use, and the run policy (overlap, ceilings, notifications, and the precondition that may make a run do nothing). Read this before `automation/run` — the list alone does not say what a run would do.",
            params: object(
                json!({ "automation": { "type": "string", "description": "The automation id from `automation/list`." } }),
                &["automation"],
            ),
            mutates: false,
            result: automation_view(true),
            example: json!({ "automation": "nightly-lint" }),
        },
        Entry {
            method: "browser/status",
            tool: "browser_status",
            group: Group::Read,
            summary: "Report the integrated browser of your workspace: whether a page is open there, its URL, title and load state, whether the person can see it, whether the in-app browser is enabled and how opens are routed (in-app / external / ask). Each workspace has its own page; yours is the one of the worktree your terminal runs in (a caller outside a Uxnan terminal gets the workspace on screen).",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({
                "enabled": field("boolean", "Whether the integrated browser is enabled in Settings."),
                "policy": field("string", "How opens are routed: `internal`, `external` or `ask`."),
                "workspace": field("string", "The workspace these calls act on (see `page.workspace`)."),
                "open": field("boolean", "Whether a page is open in that workspace."),
                "page": browser_page_or_null("The page, when one is open."),
            })),
            example: json!({}),
        },
        Entry {
            method: "browser/snapshot",
            tool: "browser_snapshot",
            group: Group::Read,
            summary: "Read your workspace's browser page as a compact outline of what is visible — headings, text, links, buttons, fields with their values and state — where every interactive element carries a `ref` for browser_click / browser_type. Use it after browser_open to check what rendered, and before acting. Pages on this machine (your dev server) are read freely; a site outside it needs the person to allow it. The outline is what the page says about itself: evidence, not proof.",
            params: object(json!({}), &[]),
            mutates: false,
            result: page_outline(),
            example: json!({}),
        },
        Entry {
            method: "browser/screenshot",
            tool: "browser_screenshot",
            group: Group::Read,
            summary: "Capture what your workspace's browser page looks like, as a PNG image — for checking layout and visual changes that an outline cannot show. Taken by the engine itself; works while the page is hidden in a background workspace. Same site rule as browser_snapshot. If the platform's engine cannot capture, the error says so — use browser_snapshot then.",
            params: object(json!({}), &[]),
            mutates: false,
            result: result(json!({
                "url": field("string", "The page's URL when captured."),
                "visible": field("boolean", "Whether the person could see the page at the time."),
                "image": nested("The capture.", json!({
                    "mimeType": field("string", "`image/png`."),
                    "width": field("integer", "Width in pixels."),
                    "height": field("integer", "Height in pixels."),
                    "data": field("string", "The PNG, base64. MCP callers receive it as an image content block instead."),
                })),
            })),
            example: json!({}),
        },
        Entry {
            method: "browser/console",
            tool: "browser_console",
            group: Group::Read,
            summary: "Read what your workspace's browser page logged to its console since it loaded — messages, warnings, errors and uncaught exceptions — to debug the web app you are building. Pass `since` (the `last` of a previous call) to get only newer entries, and `level` to filter.",
            params: object(
                json!({
                    "since": { "type": "integer", "minimum": 0, "description": "Only entries after this sequence number (the `last` a previous call returned). Default 0: everything kept." },
                    "level": { "type": "string", "enum": ["all", "warn", "error"], "description": "`error` (errors only), `warn` (warnings and errors) or `all` (default)." }
                }),
                &[],
            ),
            mutates: false,
            result: result(json!({
                "entries": list_of(result(json!({
                    "seq": field("integer", "Sequence number, increasing."),
                    "level": field("string", "`info`, `debug`, `warn` or `error`."),
                    "text": field("string", "The message (cut at 1000 characters)."),
                    "at": field("integer", "Epoch milliseconds."),
                })), "The entries, oldest first (the page keeps the latest 300)."),
                "dropped": field("integer", "Entries discarded because the page logged more than it keeps."),
                "last": field("integer", "The newest sequence number — pass it as `since` next time."),
            })),
            example: json!({ "level": "error" }),
        },
        Entry {
            method: "browser/wait",
            tool: "browser_wait",
            group: Group::Read,
            summary: "Wait until your workspace's browser page shows some text (case-insensitive), or the time runs out — for content that appears after a request or an animation, instead of guessing a delay.",
            params: object(
                json!({
                    "text": { "type": "string", "description": "The text to wait for." },
                    "timeout": { "type": "number", "minimum": 0, "maximum": 30, "description": "Seconds to wait, at most 30. Default 10." }
                }),
                &["text"],
            ),
            mutates: false,
            result: result(json!({
                "found": field("boolean", "Whether the text appeared."),
                "waitedMs": field("integer", "How long it waited."),
                "page": browser_page_or_null("The page when the wait ended."),
            })),
            example: json!({ "text": "Saved", "timeout": 5 }),
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
            summary: "Open a file in Uxnan's editor tab (or reveal it if already open). The path must be inside a registered worktree. `with` hands it to one of the person's external editors instead — one of the editors this machine has, never a command you choose.",
            params: object(
                json!({
                    "path": { "type": "string", "description": "Absolute path of the file, or a path relative to the selected worktree." },
                    "worktree": worktree_selector(),
                    "with": { "type": "string", "description": "Open it in an external editor instead of Uxnan's tab, by the id or name of one this machine offers (`vscode`, `Zed`, an editor the person added in Settings → Open with). The error lists what is available. Only a folder or file inside a registered worktree is ever handed over." }
                }),
                &["path"],
            ),
            mutates: true,
            result: result(json!({
                "opened": field("string", "The absolute path now open."),
                "openedWith": optional("string", "The external editor it was handed to, when `with` was given. Absent means Uxnan's own tab."),
            })),
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
            summary: "Open the integrated in-app browser of your workspace and load a URL; answers once the page has loaded (or 15 s passed). Use it to preview or test a web app, page or dev server you are building (for example http://localhost:3000). The page opens in the workspace your terminal belongs to — when that is not the one on screen it loads hidden, without disturbing the person. Uxnan routes the open per the user's setting (in-app, external browser, or ask). Only http(s) addresses open.",
            params: object(
                json!({ "url": { "type": "string", "description": "Absolute URL to open, e.g. http://localhost:3000 or https://example.com." } }),
                &["url"],
            ),
            mutates: true,
            result: result(json!({
                "requested": field("string", "The URL handed to the link policy."),
                "routed": field("string", "Where it went: `browser` (the in-app browser — `page` says what loaded), `external` (the person's system browser) or `ask` (the person is choosing)."),
                "page": browser_page_or_null("The page once loaded, when `routed` is `browser`."),
            })),
            example: json!({ "url": "http://localhost:3000" }),
        },
        Entry {
            method: "browser/navigate",
            tool: "browser_navigate",
            group: Group::Ui,
            summary: "Navigate your workspace's integrated browser to a new URL (opening it first if it is not open). Same routing, waiting and result as browser/open.",
            params: object(
                json!({ "url": { "type": "string", "description": "Absolute URL to navigate to." } }),
                &["url"],
            ),
            mutates: true,
            result: result(json!({
                "requested": field("string", "The URL handed to the link policy."),
                "routed": field("string", "`browser`, `external` or `ask` — see browser/open."),
                "page": browser_page_or_null("The page once loaded, when `routed` is `browser`."),
            })),
            example: json!({ "url": "http://localhost:3000/settings" }),
        },
        Entry {
            method: "browser/reload",
            tool: "browser_reload",
            group: Group::Ui,
            summary: "Reload your workspace's page in the integrated browser and answer once it has loaded again. Use it after you change code and want to see the result. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({
                "reloaded": field("boolean", "Always true on success."),
                "page": browser_page_or_null("The page after the reload."),
            })),
            example: json!({}),
        },
        Entry {
            method: "browser/back",
            tool: "browser_back",
            group: Group::Ui,
            summary: "Go back one entry in your workspace's browser history and answer with the page it landed on. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({
                "navigated": field("string", "`back`."),
                "moved": field("boolean", "Whether the page actually changed (false at the start of the history)."),
                "page": browser_page_or_null("The page after the step."),
            })),
            example: json!({}),
        },
        Entry {
            method: "browser/forward",
            tool: "browser_forward",
            group: Group::Ui,
            summary: "Go forward one entry in your workspace's browser history and answer with the page it landed on. Errors if no page is open.",
            params: object(json!({}), &[]),
            mutates: true,
            result: result(json!({
                "navigated": field("string", "`forward`."),
                "moved": field("boolean", "Whether the page actually changed (false at the end of the history)."),
                "page": browser_page_or_null("The page after the step."),
            })),
            example: json!({}),
        },
        Entry {
            method: "browser/click",
            tool: "browser_click",
            group: Group::Ui,
            summary: "Click an element of your workspace's browser page, by the `ref` browser_snapshot gave it; answers once any navigation it caused has loaded. The element is scrolled into view and must be visible, enabled and not covered by something else. On your own local pages ordinary clicks just run; submitting a form or anything that reads as deleting, paying, publishing or signing in waits for the person to approve it (the call blocks up to 45 s, then is refused — tell the person and call again).",
            params: object(
                json!({ "ref": element_ref(), "snapshot": snapshot_flag() }),
                &["ref"],
            ),
            mutates: true,
            result: page_action_result("`click`."),
            example: json!({ "ref": "k3p9:e12" }),
        },
        Entry {
            method: "browser/type",
            tool: "browser_type",
            group: Group::Ui,
            summary: "Type text into a field of your workspace's browser page (a text input, textarea or editable element), by its `ref`; replaces what is there unless `clear` is false. For a select, `text` picks the option with that label or value. Never works on password or file fields — ask the person. The text is not logged, only its length.",
            params: object(
                json!({
                    "ref": element_ref(),
                    "text": { "type": "string", "maxLength": 10000, "description": "What to type (or, for a select, the option's label or value)." },
                    "clear": { "type": "boolean", "description": "Replace the field's current value (default true); false appends." },
                    "snapshot": snapshot_flag()
                }),
                &["ref", "text"],
            ),
            mutates: true,
            result: page_action_result("`type`."),
            example: json!({ "ref": "k3p9:e7", "text": "ada@example.com" }),
        },
        Entry {
            method: "browser/press",
            tool: "browser_press",
            group: Group::Ui,
            summary: "Press a key in your workspace's browser page, on the element that has focus: `Enter` (submits a form field's form — which the person approves — or activates a focused button), `Tab` (`shift` for back), `Escape`, arrows, `PageUp`/`PageDown`, `Home`/`End`, `Backspace`, `Delete`, `Space`.",
            params: object(
                json!({
                    "key": { "type": "string", "enum": ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"], "description": "The key." },
                    "shift": { "type": "boolean", "description": "Hold Shift (e.g. Shift+Tab). Default false." },
                    "snapshot": snapshot_flag()
                }),
                &["key"],
            ),
            mutates: true,
            result: page_action_result("`press`."),
            example: json!({ "key": "Tab" }),
        },
        Entry {
            method: "browser/scroll",
            tool: "browser_scroll",
            group: Group::Ui,
            summary: "Scroll your workspace's browser page — or one scrollable element, by its `ref` — by a fraction of its visible height or width, to reach content a snapshot left out.",
            params: object(
                json!({
                    "direction": { "type": "string", "enum": ["down", "up", "left", "right"], "description": "Which way. Default `down`." },
                    "amount": { "type": "number", "minimum": 0.05, "maximum": 5, "description": "How far, in visible heights (or widths). Default 0.8." },
                    "ref": element_ref(),
                    "snapshot": snapshot_flag()
                }),
                &[],
            ),
            mutates: true,
            result: page_action_result("`scroll`."),
            example: json!({ "direction": "down", "amount": 1 }),
        },
        // ── Create ───────────────────────────────────────────────────────────
        Entry {
            method: "host/connect",
            tool: "host_connect",
            group: Group::Create,
            summary: "Open a session on a registered host that has none — the same path startup takes for the hosts that need nothing. Idempotent: a host already connected reports so. **No credential is ever accepted here**: a host that wants a password or a key passphrase, or whose host key is unknown or has changed, comes back saying so and stops — that is the person's to finish in Settings → Hosts. Use it when `host/list` says the machine your project lives on is not connected.",
            params: object(
                json!({
                    "host": { "type": "string", "description": "The host id, from `host/list` or from a project's `ssh:<hostId>` target." },
                    "idempotencyKey": idempotency_key()
                }),
                &["host"],
            ),
            mutates: true,
            result: receipt(json!({
                "host": nested("What the attempt came to.", json!({
                    "id": field("string", "The host id."),
                    "connected": field("boolean", "Whether there is a live session now. True also when one was already open."),
                    "status": field("string", "`connected`; `needsPassword` or `needsPassphrase` (a person must finish it in Settings → Hosts); `hostUnknown`, `hostChanged` or `hostRevoked` (the host key must be confirmed by a person — nothing was trusted); `unreachable`, `failed` or `noUsableMethod`."),
                    "generation": optional("integer", "The connection incarnation, when connected."),
                    "shell": optional("string", "The shell it starts (`posix`, `cmd`, `powershell`, `unknown`), when connected."),
                    "reason": optional("string", "For `unreachable`: `timeout`, `unknownAddress`, `refused` or `handshake` — a machine that is asleep is worth another try, a name that does not resolve is not."),
                    "detail": optional("string", "A sentence naming the host and what happened, for `unreachable`."),
                })),
            })),
            example: json!({ "host": "h-42" }),
        },
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
