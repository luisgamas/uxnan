//! The guide an agent (or a person) reads to learn the surface — generated from
//! the catalog, so it cannot say something the app does not do.
//!
//! `uxnan-cli skills get control` prints it; the published `uxnan-control`
//! skill is this same text written to a file. One source, two readers.

use uxnan_control_protocol::catalog::{catalog, Entry, Group};
use uxnan_control_protocol::rpc::ErrorCode;
use uxnan_control_protocol::PROTOCOL_VERSION;

/// The short form: what exists and how to call it.
pub fn short() -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# Uxnan control surface (protocol v{PROTOCOL_VERSION})\n\n"
    ));
    out.push_str(
        "Operate the running Uxnan Desktop from a shell or from an agent. Two doors to one catalog: MCP tools (available with nothing to install inside every terminal Uxnan launches) and `uxnan-cli` (any shell of the same user).\n\n",
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
            out.push_str(&format!("- `{}` (MCP tool `{}`)\n", e.method, e.tool));
        }
        out.push('\n');
    }
    out
}

/// The long form: every entry with its description and arguments, plus the
/// output and exit-code contract.
pub fn full() -> String {
    let mut out = short();
    out.push_str("## Reference\n\n");
    for e in catalog() {
        out.push_str(&format!("### `{}`\n\n", e.method));
        out.push_str(&format!(
            "MCP tool: `{}` · group: `{}` · {}\n\n",
            e.tool,
            e.group.name(),
            if e.mutates { "mutates" } else { "read-only" }
        ));
        out.push_str(&format!("{}\n\n", e.summary));
        let props = e.params.get("properties").and_then(|p| p.as_object());
        let required: Vec<&str> = e
            .params
            .get("required")
            .and_then(|r| r.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        match props {
            Some(p) if !p.is_empty() => {
                out.push_str("Arguments:\n\n");
                for (name, schema) in p {
                    let ty = schema.get("type").and_then(|t| t.as_str()).unwrap_or("any");
                    let desc = schema
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("");
                    out.push_str(&format!(
                        "- `{name}` ({ty}{}) — {desc}\n",
                        if required.contains(&name.as_str()) {
                            ", required"
                        } else {
                            ", optional"
                        }
                    ));
                }
                out.push('\n');
            }
            _ => out.push_str("No arguments.\n\n"),
        }
    }
    out.push_str("## Output and exit status\n\n");
    out.push_str(OUTPUT);
    out.push_str("\n| Exit | Meaning |\n|---|---|\n| 0 | success |\n");
    let mut rows: Vec<(i32, &str)> = vec![
        (
            ErrorCode::InvalidParams.exit_status(),
            "usage: unknown method, bad or missing argument",
        ),
        (
            ErrorCode::Unavailable.exit_status(),
            "Uxnan Desktop is not running or its window did not answer",
        ),
        (
            ErrorCode::ProtocolMismatch.exit_status(),
            "the app and the CLI speak different protocol versions",
        ),
        (
            ErrorCode::GroupDisabled.exit_status(),
            "denied: the capability group is switched off, or the token was refused",
        ),
        (ErrorCode::Timeout.exit_status(), "timed out"),
        (
            ErrorCode::NotFound.exit_status(),
            "the selector named nothing",
        ),
        (ErrorCode::Busy.exit_status(), "the target is busy"),
        (
            ErrorCode::Internal.exit_status(),
            "the app failed while carrying the request out",
        ),
    ];
    rows.sort_by_key(|(code, _)| *code);
    for (code, meaning) in rows {
        out.push_str(&format!("| {code} | {meaning} |\n"));
    }
    out
}

fn group_blurb(group: Group) -> &'static str {
    match group {
        Group::Read => "reads with no effect",
        Group::Ui => "actions on the window that change nothing on disk or in a process",
        Group::Create => "create a worktree or a terminal, start a saved run",
        Group::Converse => "talk to a running agent",
        Group::Orchestrate => "coordinate several agents",
    }
}

pub const COMMANDS: &str = "uxnan-cli status
uxnan-cli project ls | show <project>
uxnan-cli worktree ls [--project <project>] | show <worktree>
uxnan-cli worktree create --project <project> --branch <name> [--base <ref>] [--from-existing]
                          [--agent <agent>] [--prompt-file <file>] [--idempotency-key <key>]
uxnan-cli terminal ls [--worktree <worktree>] | show <terminal> | reveal <terminal>
uxnan-cli terminal create --worktree <worktree> [--title <t>] [--agent <agent>] [--prompt-file <file>]
                          [--idempotency-key <key>]
uxnan-cli agent ls
uxnan-cli run ls | show <run-id> | start <run-id> [--idempotency-key <key>]
uxnan-cli automation ls | run <automation-id> [--idempotency-key <key>]
uxnan-cli app focus
uxnan-cli file open <path> [--worktree <worktree>]
uxnan-cli file diff <path> [--worktree <worktree>] [--staged]
uxnan-cli browser open <url> | navigate <url> | reload | back | forward | status
uxnan-cli rpc <method> [--params '<json>']      # any catalog entry, raw
uxnan-cli skills get control [--full]           # this guide
Global: --json (stable machine output), --timeout <seconds>
";

pub const SELECTORS: &str = "- `current` — your own terminal, and from it your worktree and project. Works inside a terminal Uxnan launched (it knows `UXNAN_AGENT_ID`); from another shell, use an explicit form.
- `id:<id>` — a project id or a terminal id (from `ls`).
- `path:<absolute path>` — a project or worktree folder. A bare absolute path is accepted too.
- `branch:<name>` — a worktree by its branch.
- `name:<project name>` — a project by its name (must be unique).
";

pub const OUTPUT: &str = "Human-readable output goes to stdout; errors go to stderr. `--json` prints the raw result object, stable across versions: fields may be added, never renamed or removed without a protocol bump. Prefer `--json` from a script or an agent.

A `create` entry answers with a **receipt**: `{ requestId, idempotencyKey?, … }` plus what was created. Pass `--idempotency-key` (any string you choose, e.g. a UUID) and a retry of the same call returns the first receipt instead of creating a second worktree, terminal or run — so a lost reply is safe to retry. Every `create` call, done or refused, is written to `control-audit.log` in the app's data directory (prompt text is recorded as its length only).
";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_guide_names_every_catalog_entry() {
        let text = full();
        for e in catalog() {
            assert!(text.contains(&format!("`{}`", e.method)), "{}", e.method);
            assert!(text.contains(&format!("`{}`", e.tool)), "{}", e.tool);
        }
        assert!(short().len() < text.len());
    }

    #[test]
    fn every_exit_status_is_documented() {
        let text = full();
        for code in [1, 2, 3, 4, 5, 6, 7, 8] {
            assert!(text.contains(&format!("| {code} |")), "exit {code}");
        }
    }
}
