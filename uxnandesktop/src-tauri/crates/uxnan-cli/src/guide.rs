//! The guide an agent (or a person) reads to learn the surface — generated from
//! the catalog and the protocol constants, so it cannot say something the app
//! does not do.
//!
//! `uxnan-cli skills get control` prints the short form; `--full` prints the
//! reference: every entry with its CLI form, its arguments, its result, a
//! request, and the transport contract a script in any language needs. The
//! committed `docs/control-api-reference.md` and the published `uxnan-control`
//! skill's `references/catalog.md` are that same text written to a file — one
//! source, three readers — and a test below fails when the committed copy is
//! stale.

use serde_json::Value;
use uxnan_control_protocol::catalog::{catalog, Entry, Group};
use uxnan_control_protocol::rpc::ErrorCode;
use uxnan_control_protocol::{
    datadir, discovery, env, headers, MCP_PATH, PROTOCOL_VERSION, RPC_PATH,
};

/// The short form: what exists and how to call it.
pub fn short() -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# Uxnan control surface (protocol v{PROTOCOL_VERSION})\n\n"
    ));
    out.push_str(
        "Operate the running Uxnan Desktop from a shell or from an agent. Two doors to one catalog: MCP tools (available with nothing to install inside every terminal Uxnan launches) and `uxnan-cli` (any shell of the same user). A script in any language can take a third door, the JSON-RPC route the CLI itself uses — see *Calling the RPC route directly* in the full form (`--full`).\n\n",
    );
    out.push_str("## Commands\n\n");
    out.push_str("```\n");
    out.push_str(COMMANDS);
    out.push_str("```\n\n");
    out.push_str("## Selectors\n\n");
    out.push_str(SELECTORS);
    out.push_str("\n## Catalog\n\n");
    for group in Group::ALL {
        let entries: Vec<Entry> = catalog().into_iter().filter(|e| e.group == group).collect();
        if entries.is_empty() {
            continue;
        }
        out.push_str(&format!(
            "### `{}` (v{}) — {}\n\n",
            group.name(),
            group.version(),
            group_blurb(group)
        ));
        for e in entries {
            out.push_str(&format!(
                "- `{}` (MCP tool `{}`) — {}\n",
                e.method,
                e.tool,
                first_sentence(e.summary)
            ));
        }
        out.push('\n');
    }
    out
}

/// The long form: the reference.
pub fn full() -> String {
    let mut out = short();
    out.push_str(&transport());
    out.push_str("## Reference\n\n");
    out.push_str("One section per entry. **CLI** is the `uxnan-cli` form; **MCP** the tool name an agent Uxnan launched calls; **Request** the JSON-RPC body a script posts (the `params` shown are an example, not the only valid ones). Every result is an object. A field typed `string | null` is always there but may be `null`; one marked *optional* is left out when there is nothing to say — read it with a default. Fields may be added over time, never renamed or removed without a protocol bump.\n\n");
    for e in catalog() {
        out.push_str(&entry_section(&e));
    }
    out.push_str("## Output and exit status\n\n");
    out.push_str(OUTPUT);
    out.push_str("\n| Exit | Meaning |\n|---|---|\n| 0 | success |\n");
    let mut rows: Vec<(i32, &str)> = EXIT_MEANINGS
        .iter()
        .map(|(code, meaning)| (code.exit_status(), *meaning))
        .collect();
    rows.sort_by_key(|(code, _)| *code);
    for (code, meaning) in rows {
        out.push_str(&format!("| {code} | {meaning} |\n"));
    }
    out
}

/// The transport contract: how a script finds the app and posts a request.
/// Every path, header, file name and code here is the constant the app uses.
fn transport() -> String {
    let mut out = String::new();
    out.push_str("## Calling the RPC route directly\n\n");
    out.push_str("For a script in any language, or an agent runtime with an HTTP client, on the **same machine** as the app: the server listens on loopback only, so nothing reaches it from another host. Everything here is what `uxnan-cli` does internally.\n\n");
    out.push_str("### Find the app\n\n");
    out.push_str(&format!(
        "Inside a terminal Uxnan launched, the environment already says: `{}` (`http://127.0.0.1:<port>/hook` — the server's origin is that URL without the path), `{}` (the per-launch token) and `{}` (this terminal's id — send it back and `current` resolves to it).\n\n",
        env::HOOK_URL,
        env::HOOK_TOKEN,
        env::AGENT_ID
    ));
    out.push_str(&format!(
        "Anywhere else, read `{}` under the app's data directory — `~/Library/Application Support/{id}` on macOS, `%APPDATA%\\{id}` on Windows, `$XDG_DATA_HOME/{id}` (or `~/.local/share/{id}`) on Linux; `{}` overrides it, and a development build uses the `{id}{}` sibling:\n\n",
        discovery::FILE_NAME,
        datadir::DATA_DIR_ENV,
        datadir::DEV_SUFFIX,
        id = datadir::APP_IDENTIFIER,
    ));
    let sample = discovery::Discovery {
        protocol_version: PROTOCOL_VERSION,
        app_version: "<the app version>".into(),
        pid: 4242,
        process_start: 1_789_840_953,
        endpoint: "http://127.0.0.1:56606".into(),
        token: "…".into(),
    };
    out.push_str("```json\n");
    out.push_str(&serde_json::to_string_pretty(&sample).unwrap_or_default());
    out.push_str("\n```\n\n");
    out.push_str(&format!(
        "Before using it: refuse a file readable by other users (a mode other than `0600` on Unix; on Windows an access list granting any account but yours, SYSTEM and Administrators); refuse a `protocolVersion` other than {PROTOCOL_VERSION}; confirm that `pid` is alive **and** started at `processStart` (±2 s) — a file left behind by a crash then points nowhere. The app writes the file on start, removes it on a clean exit, and mints a new token on every start (and on a rotation), so read the file per session, not once.\n\n"
    ));
    out.push_str("### Post a request\n\n");
    out.push_str(&format!(
        "`POST {{endpoint}}{RPC_PATH}` with one JSON-RPC 2.0 request per call. The token goes in `Authorization: Bearer <token>` (the `{}` header is accepted too); inside a Uxnan terminal add `{}: <{}>` so `current` means your terminal.\n\n",
        headers::TOKEN,
        headers::AGENT_ID,
        env::AGENT_ID
    ));
    out.push_str(&format!(
        "```http\nPOST {RPC_PATH} HTTP/1.1\nHost: 127.0.0.1\nContent-Type: application/json\nAuthorization: Bearer <token>\n\n{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"worktree/list\",\"params\":{{\"project\":\"name:uxnan\"}}}}\n```\n\n"
    ));
    out.push_str("The reply is `200` with a result — `{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"worktrees\":[…]}}` — or, still `200`, an error: `{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32002,\"message\":\"no project matches `name:uxnan`\",\"data\":…}}` (`data` only when the entry has something structured to add). `params` is always an object and is validated against the entry's schema: an unknown argument, a missing required one or a wrong type is `-32602` with a message that names the accepted arguments. No batches, no notifications: every request has an `id` and gets one reply.\n\n");
    out.push_str("At the HTTP layer: `400` with a JSON-RPC error means the body was not JSON (`-32700`) or not a JSON-RPC 2.0 request with an id and a method (`-32600`); `401` means the token was refused — the app restarted or rotated it, re-read the discovery file; `403` means the request's `Host`/`Origin` was not loopback; `404` means the app predates the control surface.\n\n");
    out.push_str("### Error codes\n\n");
    out.push_str("| Code | Name | Exit in `uxnan-cli` | Meaning |\n|---|---|---|---|\n");
    for (code, name, meaning) in ERROR_MEANINGS {
        out.push_str(&format!(
            "| {} | {name} | {} | {meaning} |\n",
            code.code(),
            code.exit_status()
        ));
    }
    out.push_str("\n### The MCP door\n\n");
    out.push_str(&format!(
        "The same server serves MCP (Streamable HTTP, request/response only) at `{{endpoint}}{MCP_PATH}` with the same tokens and gates. `tools/list` is the catalog: each tool's `name` is the entry's tool name (`domain_verb`), its `description` the entry's summary, its `inputSchema` the entry's params schema and its `outputSchema` the entry's result schema — the same two schemas this reference prints. A failed call is reported in-band (`isError: true`, the reason as text). Agents Uxnan launches are already pointed at it; a script may use it too, but the RPC route above is the simpler one for a script.\n\n"
    ));
    out
}

/// One entry's section of the reference.
fn entry_section(e: &Entry) -> String {
    let mut out = String::new();
    out.push_str(&format!("### `{}`\n\n", e.method));
    out.push_str(&format!("{}\n\n", e.summary));
    out.push_str(&format!(
        "- **Group:** `{}` · {}\n",
        e.group.name(),
        if e.mutates {
            "mutates (receipted, audited)"
        } else {
            "read-only"
        }
    ));
    out.push_str(&format!("- **MCP:** `{}`\n", e.tool));
    match cli_form(e.method) {
        Some(form) => out.push_str(&format!("- **CLI:** `{form}`\n")),
        None => out.push_str(&format!(
            "- **CLI:** no dedicated command — `uxnan-cli rpc {} --params '<json>'`\n",
            e.method
        )),
    }
    out.push('\n');

    let props = e.params.get("properties").and_then(|p| p.as_object());
    let required: Vec<&str> = e
        .params
        .get("required")
        .and_then(|r| r.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    match props {
        Some(p) if !p.is_empty() => {
            out.push_str("**Params**\n\n| Name | Type | Required | Meaning |\n|---|---|---|---|\n");
            for (name, schema) in p {
                out.push_str(&format!(
                    "| `{name}` | {} | {} | {} |\n",
                    type_of(schema),
                    if required.contains(&name.as_str()) {
                        "yes"
                    } else {
                        "no"
                    },
                    cell(
                        schema
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                    )
                ));
            }
            out.push('\n');
        }
        _ => out.push_str("**Params** — none (send `{}`).\n\n"),
    }

    out.push_str("**Result**\n\n");
    let mut fields = String::new();
    render_fields(&e.result, 0, &mut fields);
    if fields.is_empty() {
        out.push_str("An empty object.\n\n");
    } else {
        out.push_str(&fields);
        out.push('\n');
    }

    out.push_str("**Request**\n\n```json\n");
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": e.method,
        "params": e.example,
    });
    out.push_str(&serde_json::to_string_pretty(&request).unwrap_or_default());
    out.push_str("\n```\n\n");

    let errors = errors_of(e);
    if !errors.is_empty() {
        out.push_str(
            "**Errors** (besides the ones every entry can answer — see *Error codes*)\n\n",
        );
        for (code, why) in errors {
            out.push_str(&format!("- `{}` {} — {why}\n", code.code(), name_of(code)));
        }
        out.push('\n');
    }
    out
}

/// The result schema as nested bullets: `name (type) — meaning`, one level of
/// indentation per nested object or array of objects.
fn render_fields(schema: &Value, depth: usize, out: &mut String) {
    let Some(props) = schema.get("properties").and_then(|p| p.as_object()) else {
        return;
    };
    let required: Vec<&str> = schema
        .get("required")
        .and_then(|r| r.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let pad = "  ".repeat(depth);
    for (name, field) in props {
        let desc = field
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("");
        out.push_str(&format!(
            "{pad}- `{name}` ({}{})",
            type_of(field),
            if required.contains(&name.as_str()) {
                ""
            } else {
                ", optional"
            }
        ));
        if !desc.is_empty() {
            out.push_str(&format!(" — {desc}"));
        }
        out.push('\n');
        let nested = match field.get("items") {
            Some(items) => items,
            None => field,
        };
        render_fields(nested, depth + 1, out);
    }
}

/// `string`, `integer`, `string | null`, `array of object`, …
fn type_of(schema: &Value) -> String {
    let base = match schema.get("type") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(" | "),
        _ => "any".into(),
    };
    if base == "array" {
        if let Some(items) = schema.get("items") {
            return format!("array of {}", type_of(items));
        }
    }
    if let Some(values) = schema.get("enum").and_then(|e| e.as_array()) {
        let list: Vec<String> = values
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| format!("`{s}`"))
            .collect();
        return format!("{base}: {}", list.join(" \\| "));
    }
    base
}

/// A table cell: pipes escaped, newlines flattened.
fn cell(text: &str) -> String {
    text.replace('|', "\\|").replace('\n', " ")
}

fn first_sentence(text: &str) -> &str {
    match text.find(". ") {
        Some(i) => &text[..=i],
        None => text,
    }
}

fn name_of(code: ErrorCode) -> &'static str {
    ERROR_MEANINGS
        .iter()
        .find(|(c, _, _)| *c == code)
        .map(|(_, name, _)| *name)
        .unwrap_or("")
}

/// The errors one entry can answer beyond the general ones, derived from what
/// it takes: a selector can name nothing, a wait can run out, a run can be
/// unable to start.
fn errors_of(e: &Entry) -> Vec<(ErrorCode, &'static str)> {
    let mut out = Vec::new();
    let props = e.params.get("properties").and_then(|p| p.as_object());
    let has = |name: &str| props.is_some_and(|p| p.contains_key(name));
    if has("project") || has("worktree") || has("terminal") {
        out.push((
            ErrorCode::NotFound,
            "the selector named no project, worktree or terminal",
        ));
    }
    if has("run") || has("automation") {
        out.push((
            ErrorCode::NotFound,
            "no saved run or automation has that id",
        ));
    }
    if has("path") && e.method.starts_with("file/") {
        out.push((
            ErrorCode::NotFound,
            "the path is not inside the worktree, or does not exist",
        ));
    }
    match e.method {
        "worktree/create" => {
            out.push((
                ErrorCode::InvalidParams,
                "the branch name is invalid, the base does not exist, or `prompt` was given without `agent`",
            ));
            out.push((ErrorCode::Busy, BUDGET));
        }
        "terminal/create" => {
            out.push((
                ErrorCode::NotFound,
                "`agent` names no configured agent, or the agent has no command to launch",
            ));
            out.push((ErrorCode::Busy, BUDGET));
        }
        "terminal/close" => {
            out.push((
                ErrorCode::InvalidParams,
                "the terminal was opened by a person and its shell is alive — only they close it",
            ));
            out.push((
                ErrorCode::Busy,
                "the terminal's agent is working; `agent wait --for idle` first",
            ));
        }
        "agent/send" => out.push((
            ErrorCode::NotFound,
            "the terminal has no live agent to receive the message",
        )),
        "agent/wait" => out.push((
            ErrorCode::Timeout,
            "the state was not reached within `timeoutMs` (at most 15 000 per call); `data.current` says where the agent is — call again to keep waiting",
        )),
        "terminal/read" => out.push((
            ErrorCode::GroupDisabled,
            "the terminal's project is listed in `settings.control.terminalReadDisabledProjects`",
        )),
        "run/start" => out.push((
            ErrorCode::Busy,
            "the run cannot start (already running, or invalid); `data.errors` lists why",
        )),
        "orchestration/reportResult" | "orchestration/reportProgress" => out.push((
            ErrorCode::Unavailable,
            "the window is not there to receive the report",
        )),
        "run/finish" | "task/create" | "task/update" | "inbox/check" => out.push((
            ErrorCode::NotFound,
            "no driven run (or task) has that id",
        )),
        "worker/start" => {
            out.push((
                ErrorCode::NotFound,
                "no driven run has that id, the task is not `ready`, or `agent` names no configured agent",
            ));
            out.push((
                ErrorCode::InvalidParams,
                "for `new`: the branch name is invalid or already exists",
            ));
            out.push((ErrorCode::Busy, BUDGET));
        }
        "question/ask" => {
            out.push((
                ErrorCode::InvalidParams,
                "called from outside a terminal Uxnan launched, or from a terminal that is no worker of a running task",
            ));
            out.push((
                ErrorCode::Timeout,
                "no answer within `timeoutMs` (at most 15 000 per call); `data.questionId` — call again with it to keep waiting",
            ));
        }
        "question/answer" => out.push((
            ErrorCode::NotFound,
            "no open question with that id in that run",
        )),
        _ => {}
    }
    out
}

/// The launch budget every agent launch through the surface is subject to.
const BUDGET: &str = "with `agent`: the launch budget is spent — as many agents are running as the resource policy allows at once (`data.live`, `data.cap`); wait for one to finish, or the person raises the orchestration concurrency in Settings → Resources";

/// The `uxnan-cli` form of each entry. `None` for an entry only `rpc` reaches.
fn cli_form(method: &str) -> Option<&'static str> {
    Some(match method {
        "status" => "uxnan-cli status",
        "project/list" => "uxnan-cli project ls",
        "project/show" => "uxnan-cli project show <project>",
        "worktree/list" => "uxnan-cli worktree ls [--project <project>]",
        "worktree/show" => "uxnan-cli worktree show <worktree>",
        "worktree/create" => "uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing] [--agent <agent>] [--prompt-file <file>] [--unattended] [--idempotency-key <key>]",
        "terminal/list" => "uxnan-cli terminal ls [--worktree <worktree>]",
        "terminal/show" => "uxnan-cli terminal show <terminal>",
        "terminal/reveal" => "uxnan-cli terminal reveal <terminal>",
        "terminal/close" => "uxnan-cli terminal close <terminal>",
        "terminal/create" => "uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>] [--unattended] [--idempotency-key <key>]",
        "terminal/read" => "uxnan-cli terminal read <terminal> [--lines <n>]",
        "agent/list" => "uxnan-cli agent ls",
        "agent/send" => "uxnan-cli agent send --to <terminal> --message-file <file> [--force] [--idempotency-key <key>]",
        "agent/wait" => "uxnan-cli agent wait --to <terminal> --for idle|waiting|exit [--timeout <seconds>]",
        "run/list" => "uxnan-cli run ls",
        "run/show" => "uxnan-cli run show <run-id>",
        "run/start" => "uxnan-cli run start <run-id> [--idempotency-key <key>]",
        "automation/list" => "uxnan-cli automation ls",
        "automation/run" => "uxnan-cli automation run <automation-id> [--idempotency-key <key>]",
        "app/focus" => "uxnan-cli app focus",
        "file/open" => "uxnan-cli file open <path> [--worktree <worktree>]",
        "file/diff" => "uxnan-cli file diff <path> [--worktree <worktree>] [--staged]",
        "browser/open" => "uxnan-cli browser open <url>",
        "browser/navigate" => "uxnan-cli browser navigate <url>",
        "browser/reload" => "uxnan-cli browser reload",
        "browser/back" => "uxnan-cli browser back",
        "browser/forward" => "uxnan-cli browser forward",
        "browser/status" => "uxnan-cli browser status",
        "browser/snapshot" => "uxnan-cli browser snapshot",
        "browser/screenshot" => "uxnan-cli browser screenshot --out <file.png>",
        "browser/console" => "uxnan-cli browser console [--since <n>] [--level all|warn|error]",
        "browser/wait" => "uxnan-cli browser wait <text> [--for <seconds>]",
        "browser/click" => "uxnan-cli browser click <ref> [--snapshot]",
        "browser/type" => "uxnan-cli browser type <ref> <text> [--append] [--snapshot]",
        "browser/press" => "uxnan-cli browser press <key> [--shift]",
        "browser/scroll" => "uxnan-cli browser scroll [--direction down|up|left|right] [--amount <n>] [--ref <ref>]",
        "run/create" => "uxnan-cli run create --title <t> [--idempotency-key <key>]",
        "run/finish" => "uxnan-cli run finish <run-id> --outcome success|failure|blocked [--summary <text>]",
        "task/create" => "uxnan-cli task create --run <run-id> --title <t> --prompt-file <file> [--depends-on <task>]... [--headless <agent>] [--worktree <worktree>] [--retry] [--idempotency-key <key>]",
        "task/list" => "uxnan-cli task ls --run <run-id>",
        "task/update" => "uxnan-cli task update --run <run-id> <task> [--title <t>] [--prompt-file <file>] [--depends-on <task>]... [--status completed|failed|skipped] [--output <text>]",
        "worker/start" => "uxnan-cli worker start --run <run-id> --task <task> --agent <agent> [--worktree current|new|<worktree>] [--branch <name>] [--project <project>] [--unattended | --attended] [--idempotency-key <key>]",
        "inbox/check" => "uxnan-cli inbox check --run <run-id> [--ack <id>]... [--wait] [--timeout <seconds>]",
        "question/ask" => "uxnan-cli ask --question <text> [--option <o>]... [--timeout <seconds>]",
        "question/answer" => "uxnan-cli answer --run <run-id> --question <id> --answer <text> [--reject]",
        _ => return None,
    })
}

fn group_blurb(group: Group) -> &'static str {
    match group {
        Group::Read => "reads with no effect",
        Group::Ui => "actions on the window that change nothing on disk or in a process",
        Group::Create => "create a worktree or a terminal, start a saved run or automation",
        Group::Converse => "talk to a running agent",
        Group::Orchestrate => "drive a run as its coordinator: tasks, workers, an inbox, questions; a worker reports back",
    }
}

/// Every error code, its name and its meaning — the one table the reference
/// prints and the CLI's exit codes derive from.
const ERROR_MEANINGS: [(ErrorCode, &str, &str); 13] = [
    (ErrorCode::ParseError, "parse error", "the body was not JSON"),
    (
        ErrorCode::InvalidRequest,
        "invalid request",
        "not a JSON-RPC 2.0 request with an id and a method",
    ),
    (
        ErrorCode::MethodNotFound,
        "method not found",
        "no catalog entry has this name",
    ),
    (
        ErrorCode::InvalidParams,
        "invalid params",
        "an argument or a selector was rejected; the message names what is accepted",
    ),
    (
        ErrorCode::Internal,
        "internal",
        "the app failed while carrying the request out",
    ),
    (
        ErrorCode::GroupDisabled,
        "group disabled",
        "the entry's capability group is switched off (`settings.control.disabledGroups`), or the project opted out of terminal reads",
    ),
    (ErrorCode::NotFound, "not found", "a selector named nothing"),
    (
        ErrorCode::ScopeDenied,
        "scope denied",
        "the selector names a project, worktree or terminal outside the caller's scope: a launch token reaches only the project its terminal runs in, and a launch request that named no terminal reaches none (`uxnan-cli` also reports a refused token, HTTP `401`, under this code)",
    ),
    (
        ErrorCode::Unavailable,
        "unavailable",
        "the window that owns the resource did not answer within 5 s",
    ),
    (
        ErrorCode::Busy,
        "busy",
        "the target is busy: a run that is already running or cannot start, or an agent launch past the launch budget (`data.live` / `data.cap`)",
    ),
    (ErrorCode::Timeout, "timeout", "a wait ran out of time"),
    (
        ErrorCode::ProtocolMismatch,
        "protocol mismatch",
        "the app and the client speak different protocol versions",
    ),
    (
        ErrorCode::Refused,
        "refused",
        "a safety policy or the person refused it: a browser page action that is never allowed (typing into a password field), a site outside this machine the person has not allowed, or an approval the person declined or did not answer in time",
    ),
];

/// The exit-status table, one row per status, worded for a script's author.
const EXIT_MEANINGS: [(ErrorCode, &str); 9] = [
    (
        ErrorCode::Internal,
        "the app failed while carrying the request out",
    ),
    (
        ErrorCode::InvalidParams,
        "usage: unknown method, bad or missing argument, malformed selector",
    ),
    (
        ErrorCode::Unavailable,
        "Uxnan Desktop is not running, or its window did not answer",
    ),
    (
        ErrorCode::ProtocolMismatch,
        "the app and the CLI speak different protocol versions (or the app predates the control surface)",
    ),
    (
        ErrorCode::GroupDisabled,
        "denied: the capability group is switched off, or the token was refused",
    ),
    (ErrorCode::Timeout, "timed out"),
    (ErrorCode::NotFound, "the selector named nothing"),
    (ErrorCode::Busy, "the target is busy"),
    (
        ErrorCode::Refused,
        "refused by a safety policy or by the person",
    ),
];

pub const COMMANDS: &str = "uxnan-cli status
uxnan-cli project ls | show <project>
uxnan-cli worktree ls [--project <project>] | show <worktree>
uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing]
                          [--agent <agent>] [--prompt-file <file>] [--unattended] [--idempotency-key <key>]
uxnan-cli terminal ls [--worktree <worktree>] | show <terminal> | reveal <terminal> | close <terminal>
uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>]
                          [--unattended] [--idempotency-key <key>]
uxnan-cli agent ls
uxnan-cli agent send --to <terminal> --message-file <file> [--force] [--idempotency-key <key>]
uxnan-cli agent wait --to <terminal> --for idle|waiting|exit [--timeout <seconds>]
uxnan-cli terminal read <terminal> [--lines <n>]
uxnan-cli run ls | show <run-id> | start <run-id> [--idempotency-key <key>]
uxnan-cli run create --title <t> | finish <run-id> --outcome success|failure|blocked [--summary <text>]
uxnan-cli task create --run <run-id> --title <t> --prompt-file <file> [--depends-on <task>]... [--headless <agent>]
uxnan-cli task ls --run <run-id> | update --run <run-id> <task> [--status completed|failed|skipped] [--output <text>]
uxnan-cli worker start --run <run-id> --task <task> --agent <agent> [--worktree current|new|<worktree>] [--unattended | --attended]
uxnan-cli inbox check --run <run-id> [--ack <id>]... [--wait] [--timeout <seconds>]
uxnan-cli ask --question <text> [--option <o>]...      # from a worker's terminal
uxnan-cli answer --run <run-id> --question <id> --answer <text> [--reject]
uxnan-cli automation ls | run <automation-id> [--idempotency-key <key>]
uxnan-cli app focus
uxnan-cli file open <path> [--worktree <worktree>]
uxnan-cli file diff <path> [--worktree <worktree>] [--staged]
uxnan-cli browser open <url> | navigate <url> | reload | back | forward | status
uxnan-cli browser snapshot | screenshot --out <file> | console | wait <text> | click <ref> | type <ref> <text> | press <key> | scroll
uxnan-cli rpc <method> [--params '<json>']      # any catalog entry, raw
uxnan-cli skills get control [--full]           # this guide / the full reference
Global: --json (stable machine output), --timeout <seconds>
";

pub const SELECTORS: &str = "- `current` — your own terminal, and from it your worktree and project. Works inside a terminal Uxnan launched (it knows `UXNAN_AGENT_ID`, and the MCP tools send it with every call); from another shell, use an explicit form.
- Scope: from a terminal Uxnan launched, every listing and selector is confined to that terminal's project (anything else is *scope denied*); from the user's shell, `uxnan-cli` reaches every project.
- `id:<id>` — a project id or a terminal id (from `ls`).
- `path:<absolute path>` — a project or worktree folder. A bare absolute path is accepted too.
- `branch:<name>` — a worktree by its branch.
- `name:<project name>` — a project by its name (must be unique).
";

pub const OUTPUT: &str = "Human-readable output goes to stdout; errors go to stderr. `--json` prints the raw result object, stable across versions: fields may be added, never renamed or removed without a protocol bump. Prefer `--json` from a script or an agent.

`agent send` queues a whole message for a running agent until it is free (`--force` types it now and interrupts); `agent wait --for idle` blocks until the agent's own hooks report its turn finished, printing a heartbeat to stderr every 15 s; `terminal read` returns the screen with secrets redacted and is written to the audit log. Together they are the loop: send, wait, read.

A `create` entry answers with a **receipt**: `{ requestId, idempotencyKey?, … }` plus what was created. Pass `--idempotency-key` (any string you choose, e.g. a UUID) and a retry of the same call returns the first receipt instead of creating a second worktree, terminal or run — so a lost reply is safe to retry. Every `create` call, done or refused, is written to `control-audit.log` in the app's data directory (prompt text is recorded as its length only).
";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_guide_names_every_catalog_entry() {
        let text = full();
        for e in catalog() {
            assert!(
                text.contains(&format!("### `{}`", e.method)),
                "{}",
                e.method
            );
            assert!(text.contains(&format!("`{}`", e.tool)), "{}", e.tool);
        }
        assert!(short().len() < text.len());
    }

    /// Every CLI form names a command path clap actually has (`uxnan-cli
    /// worktree create` → subcommand `worktree`, then `create`), so a renamed
    /// or removed command cannot leave a stale form in the reference.
    #[test]
    fn every_entry_outside_orchestrate_has_a_real_cli_form() {
        use clap::CommandFactory;
        let root = crate::Cli::command();
        for e in catalog() {
            let form = cli_form(e.method);
            if e.method.starts_with("orchestration/report") {
                assert!(form.is_none(), "{} is rpc-only", e.method);
                continue;
            }
            let form = form.unwrap_or_else(|| panic!("{} has no CLI form", e.method));
            let mut words = form.split_whitespace();
            assert_eq!(words.next(), Some("uxnan-cli"), "{form}");
            let mut cmd = &root;
            for word in words.take_while(|w| w.chars().next().is_some_and(|c| c.is_alphabetic())) {
                cmd = cmd
                    .find_subcommand(word)
                    .unwrap_or_else(|| panic!("`{form}`: no subcommand `{word}`"));
            }
        }
    }

    #[test]
    fn every_exit_status_and_error_code_is_documented() {
        let text = full();
        for code in [1, 2, 3, 4, 5, 6, 7, 8] {
            assert!(text.contains(&format!("| {code} |")), "exit {code}");
        }
        for (code, name, _) in ERROR_MEANINGS {
            assert!(
                text.contains(&format!("| {} | {name} |", code.code())),
                "{name}"
            );
        }
        assert!(text.contains(RPC_PATH));
        assert!(text.contains(MCP_PATH));
        assert!(text.contains(discovery::FILE_NAME));
    }

    #[test]
    fn every_result_field_renders_with_a_meaning() {
        let text = full();
        for e in catalog() {
            let mut fields = String::new();
            render_fields(&e.result, 0, &mut fields);
            assert!(!fields.is_empty(), "{} renders no result", e.method);
            for line in fields.lines() {
                assert!(line.contains(" — "), "{}: {line}", e.method);
            }
            assert!(text.contains(&fields), "{}", e.method);
        }
    }

    /// The committed reference is this generator's output, byte for byte.
    /// Regenerate with `uxnan-cli skills get control --full > docs/control-api-reference.md`
    /// (from `uxnandesktop/`) whenever the catalog or this file changes.
    #[test]
    fn the_committed_reference_is_current() {
        let committed = include_str!("../../../../docs/control-api-reference.md");
        assert_eq!(
            committed,
            full(),
            "docs/control-api-reference.md is stale — regenerate it with `uxnan-cli skills get control --full`"
        );
    }
}
