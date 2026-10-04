//! How an agent CLI is pointed at the control surface's MCP server for one
//! launch — the registry the desktop's `mcpinject` serves, kept in the
//! workspace engine because it describes the machine the agent runs on: a
//! host's engine answers it with its own endpoint, its own Claude config file
//! and its own OpenCode's version (`uxnan-host` → `AgentTools`), and the app
//! computes a host launch's catalog with this same code. Everything here is
//! pure: no file is written and no process run.
//!
//! The rules (registered per launch only, never in a config the user keeps;
//! the token never in a file) are the desktop's `mcpinject` module docs.

use std::collections::HashSet;

use serde_json::json;

/// The MCP server name every launch registers us under (its tools appear
/// prefixed with this, e.g. `mcp__uxnan-browser__browser_open`).
pub const SERVER_NAME: &str = "uxnan-browser";
/// Environment variable the injected configs read the bearer token from, so the
/// token itself is never written to a config file.
pub const TOKEN_ENV: &str = "UXNAN_MCP_TOKEN";

/// The header every launched agent sends with its terminal id — what anchors
/// `current` and the caller's project scope on the control surface — and the
/// environment variable each launch config expands it from.
pub const AGENT_ID_HEADER: &str = uxnan_control_protocol::headers::AGENT_ID;
pub const AGENT_ID_ENV: &str = uxnan_control_protocol::env::AGENT_ID;
/// OpenCode's "extra config, merged over the files" environment variable — how
/// OpenCode (and only OpenCode) is pointed at the server for one launch.
pub const OPENCODE_CONFIG_ENV: &str = "OPENCODE_CONFIG_CONTENT";

/// How a CLI is pointed at the server for a single launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchVia {
    /// Extra arguments appended to the command uxnan types into the terminal.
    Args,
    /// Extra environment variables set on the terminal uxnan spawns.
    Env,
}

/// One agent the ADE can auto-configure for the browser MCP server.
#[derive(Debug, Clone, Copy)]
pub struct McpAgent {
    /// Stable id used in `mcpDisabledAgents` + the Settings toggles.
    pub id: &'static str,
    /// Human-readable name for the UI.
    pub label: &'static str,
    /// Executable names this agent is recognized by, so the frontend can match
    /// the command it is about to type (basename, extension stripped).
    pub commands: &'static [&'static str],
    /// Which per-launch mechanism carries the registration.
    pub via: LaunchVia,
}

/// The agents we currently know how to register **per launch**. Adding one means
/// proving its CLI accepts a per-launch flag or env (see the module docs) and
/// then adding a row here plus an arm in [`launch_args`] / [`launch_env`].
pub const AGENTS: &[McpAgent] = &[
    McpAgent {
        id: "claude",
        label: "Claude Code",
        commands: &["claude"],
        via: LaunchVia::Args,
    },
    McpAgent {
        id: "codex",
        label: "Codex",
        commands: &["codex"],
        via: LaunchVia::Args,
    },
    McpAgent {
        id: "opencode",
        label: "OpenCode",
        commands: &["opencode"],
        via: LaunchVia::Env,
    },
];

/// Serializable view of a supported agent for the frontend: the Settings →
/// Browser toggles **and** the launch path, which appends `args` to the command
/// it types (empty for env-based agents).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub label: String,
    pub commands: Vec<String>,
    pub via: LaunchVia,
    /// What this launch actually adds — the flag or the environment variable —
    /// shown mono under the agent's name in Settings, the way the hooks list
    /// shows the config file it writes. This list has no config file to show:
    /// that is the point.
    pub mechanism: String,
    /// Ready-to-append arguments for this launch (endpoint already substituted).
    /// Empty when the server isn't listening yet or the agent is env-based.
    pub args: Vec<String>,
    /// Arguments this CLI needs for **any** of uxnan's per-launch wiring (hooks,
    /// this server) to reach the process it launches — appended on every
    /// launch, whether or not the agent tools are switched on. See
    /// [`required_args`].
    pub required_args: Vec<String>,
    /// Flags by which a command line has already made the choice
    /// `required_args` makes; a line carrying one is left alone, since the
    /// person's own profile decided. See [`required_args_chosen_by`].
    pub required_args_chosen_by: Vec<String>,
}

/// The supported-agent catalog for the frontend. `endpoint`/`claude_config` are
/// `None` before the hook server is listening — the catalog is still returned
/// (so Settings can render its toggles), just with no launch arguments.
/// `opencode_major` is the installed OpenCode's major version, if known.
pub fn agent_infos(
    endpoint: Option<&str>,
    claude_config: Option<&str>,
    opencode_major: Option<u32>,
) -> Vec<AgentInfo> {
    AGENTS
        .iter()
        .map(|a| AgentInfo {
            id: a.id.to_string(),
            label: a.label.to_string(),
            commands: a.commands.iter().map(|c| c.to_string()).collect(),
            via: a.via,
            mechanism: launch_mechanism(a.id, claude_config),
            args: match endpoint {
                Some(e) => launch_args(a.id, e, claude_config),
                None => Vec::new(),
            },
            required_args: required_args(a.id, opencode_major),
            required_args_chosen_by: required_args_chosen_by(a.id),
        })
        .collect()
}

/// Whether the installed OpenCode runs its agent in a shared background
/// service unless told otherwise — OpenCode 2 and later.
pub fn opencode_has_shared_service(opencode_major: Option<u32>) -> bool {
    opencode_major.is_some_and(|major| major >= 2)
}

/// Arguments `agent_id` must be launched with for uxnan's per-launch wiring to
/// reach it at all, independent of the agent-tools switch.
///
/// Only OpenCode 2 today: `--standalone` gives the launch a private server in
/// the tab instead of the shared background service (module docs). A profile
/// that already picks a server is left alone ([`required_args_chosen_by`]).
/// `None` (version unknown) adds nothing: OpenCode 1 rejects the flag, and a
/// launch that works beats one that is wired.
// FOR-DEV: one uxnan-owned OpenCode server per window instead of one per tab
// (`--server <url>` launches keyed by a session → tab map), which needs OpenCode
// to say which client a session belongs to — see FOR-DEV.md → *Agent hooks* →
// *OpenCode 2: one server for every tab*.
pub fn required_args(agent_id: &str, opencode_major: Option<u32>) -> Vec<String> {
    match agent_id {
        "opencode" if opencode_has_shared_service(opencode_major) => {
            vec!["--standalone".to_string()]
        }
        _ => Vec::new(),
    }
}

/// The flags by which a command line has already chosen what
/// [`required_args`] would: for OpenCode, where its server runs —
/// `--standalone` itself, or `--server <url>`, a server the person runs.
pub fn required_args_chosen_by(agent_id: &str) -> Vec<String> {
    match agent_id {
        "opencode" => vec!["--standalone".to_string(), "--server".to_string()],
        _ => Vec::new(),
    }
}

/// One line naming how `agent_id` is pointed at the server, for the Settings
/// row: the flag it is launched with, or the variable set on its terminal.
pub fn launch_mechanism(agent_id: &str, claude_config: Option<&str>) -> String {
    match agent_id {
        "claude" => match claude_config {
            Some(p) if !p.is_empty() => format!("--mcp-config {p}"),
            _ => "--mcp-config".to_string(),
        },
        "codex" => format!("-c mcp_servers.{SERVER_NAME}.*"),
        "opencode" => OPENCODE_CONFIG_ENV.to_string(),
        _ => String::new(),
    }
}

/// Turn the hook server's `…/hook` URL into its `…/mcp` sibling (the MCP endpoint).
pub fn mcp_endpoint(hook_url: &str) -> String {
    hook_url.replacen("/hook", "/mcp", 1)
}

/// The loopback port an `http://127.0.0.1:<port>/mcp` endpoint names, as a
/// string. `"0"` when it can't be read — the caller only uses it to keep one
/// window's launch config from colliding with another's.
pub fn endpoint_port(endpoint: &str) -> String {
    endpoint
        .rsplit_once(':')
        .and_then(|(_, tail)| {
            let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
            (!digits.is_empty()).then_some(digits)
        })
        .unwrap_or_else(|| "0".to_string())
}

// --- Per-launch registration ------------------------------------------------

/// Arguments to append to the command line for `agent_id`, or empty when the
/// agent is registered through the environment instead (see [`launch_env`]).
///
/// Claude takes a config **file** rather than an inline JSON string on purpose:
/// the same argument then survives `cmd.exe`, PowerShell and POSIX quoting, and
/// the file lives in uxnan's own data directory — never in the user's project
/// and never in a config any other agent reads.
pub fn launch_args(agent_id: &str, endpoint: &str, claude_config: Option<&str>) -> Vec<String> {
    match agent_id {
        "claude" => match claude_config {
            Some(path) if !path.is_empty() => {
                vec!["--mcp-config".to_string(), path.to_string()]
            }
            _ => Vec::new(),
        },
        // Values are deliberately unquoted: Codex parses each `-c` value as TOML
        // and falls back to the literal string, so a bare URL and a bare
        // variable name need no shell quoting at all.
        // `env_http_headers` maps a header to the environment variable Codex
        // reads it from at call time, so every terminal's agent identifies
        // itself without a per-terminal argument.
        "codex" => vec![
            "-c".to_string(),
            format!("mcp_servers.{SERVER_NAME}.url={endpoint}"),
            "-c".to_string(),
            format!("mcp_servers.{SERVER_NAME}.bearer_token_env_var={TOKEN_ENV}"),
            "-c".to_string(),
            format!(
                "mcp_servers.{SERVER_NAME}.env_http_headers.{}={}",
                AGENT_ID_HEADER, AGENT_ID_ENV
            ),
        ],
        _ => Vec::new(),
    }
}

/// Environment variables to set on a terminal so an env-registered agent finds
/// the server. Only OpenCode today: `OPENCODE_CONFIG_CONTENT` is **merged over**
/// the config files it already loads, so the user's providers, agents and their
/// own MCP servers are untouched — and it expands `{env:VAR}`, so the token
/// stays in the environment.
pub fn launch_env(agent_id: &str, endpoint: &str) -> Vec<(String, String)> {
    match agent_id {
        "opencode" => vec![(
            OPENCODE_CONFIG_ENV.to_string(),
            json!({
                "mcp": {
                    SERVER_NAME: {
                        "type": "remote",
                        "url": endpoint,
                        "enabled": true,
                        "headers": {
                            "Authorization": format!("Bearer {{env:{TOKEN_ENV}}}"),
                            AGENT_ID_HEADER: format!("{{env:{AGENT_ID_ENV}}}")
                        }
                    }
                }
            })
            .to_string(),
        )],
        _ => Vec::new(),
    }
}

/// Every env-based registration for the agents that aren't disabled — what
/// `pty_create` adds to the terminal's environment. `launching` is the
/// executable uxnan will type into this terminal (`opencode`, `claude`, …), if
/// any: OpenCode 2's registration goes only on a terminal launching OpenCode,
/// because anywhere else a hand-typed `opencode` would pass it to the shared
/// background service (module docs).
pub fn launch_env_all(
    endpoint: &str,
    disabled: &HashSet<&str>,
    launching: Option<&str>,
    opencode_major: Option<u32>,
) -> Vec<(String, String)> {
    AGENTS
        .iter()
        .filter(|a| a.via == LaunchVia::Env && !disabled.contains(a.id))
        .filter(|a| {
            a.id != "opencode"
                || !opencode_has_shared_service(opencode_major)
                || launching.is_some_and(|exe| a.commands.contains(&exe))
        })
        .flat_map(|a| launch_env(a.id, endpoint))
        .collect()
}

/// The contents of that file: a standard `mcpServers` entry naming the token's
/// environment variable (Claude expands `${VAR}` when it loads the config), so
/// the file itself holds no secret — and the terminal's id the same way, so one
/// file per window serves every terminal and each agent still says which it is.
pub fn claude_config_json(endpoint: &str) -> String {
    let doc = json!({
        "mcpServers": {
            SERVER_NAME: {
                "type": "http",
                "url": endpoint,
                "headers": {
                    "Authorization": format!("Bearer ${{{TOKEN_ENV}}}"),
                    AGENT_ID_HEADER: format!("${{{AGENT_ID_ENV}}}")
                }
            }
        }
    });
    format!(
        "{}\n",
        serde_json::to_string_pretty(&doc).unwrap_or_else(|_| doc.to_string())
    )
}

/// The major version a CLI's `--version` output names, reading the first token
/// shaped like `X.Y…` (a leading `v` allowed): OpenCode 1 prints `1.18.32`,
/// OpenCode 2 prints `opencode v2.0.16`. `None` when nothing version-shaped is
/// printed — a bare number is not taken for one.
pub fn parse_major_version(output: &str) -> Option<u32> {
    output.split_whitespace().find_map(|token| {
        let token = token.trim_start_matches(['v', 'V']);
        let mut parts = token.split('.');
        let major = parts.next()?.parse::<u32>().ok()?;
        parts.next()?.chars().next().filter(char::is_ascii_digit)?;
        Some(major)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn endpoint_rewrites_hook_to_mcp() {
        assert_eq!(
            mcp_endpoint("http://127.0.0.1:5123/hook"),
            "http://127.0.0.1:5123/mcp"
        );
    }

    #[test]
    fn endpoint_port_is_read_for_the_per_window_file_name() {
        assert_eq!(endpoint_port("http://127.0.0.1:5123/mcp"), "5123");
        assert_eq!(endpoint_port("http://127.0.0.1:5123"), "5123");
        assert_eq!(endpoint_port("nonsense"), "0");
    }

    #[test]
    fn every_offered_agent_has_a_per_launch_mechanism() {
        // A row with neither args nor env would show a Settings toggle that
        // silently does nothing — the exact class of bug this module replaced.
        let cfg = Some("C:/data/mcp/claude-1.json");
        for agent in AGENTS {
            let args = launch_args(agent.id, "http://127.0.0.1:9/mcp", cfg);
            let env = launch_env(agent.id, "http://127.0.0.1:9/mcp");
            match agent.via {
                LaunchVia::Args => assert!(!args.is_empty(), "{} has no launch args", agent.id),
                LaunchVia::Env => assert!(!env.is_empty(), "{} has no launch env", agent.id),
            }
            assert!(
                !agent.commands.is_empty(),
                "{} matches no command",
                agent.id
            );
        }
    }

    #[test]
    fn nothing_carries_the_token_itself() {
        // The token is always referenced by the name of an environment variable
        // uxnan sets on the terminal it spawns — never written into a file or a
        // command line, which is what keeps the server unusable outside uxnan.
        let secret = "s3cret-token-value";
        let endpoint = "http://127.0.0.1:9/mcp";
        let mut all = claude_config_json(endpoint);
        for agent in AGENTS {
            all.push_str(&launch_args(agent.id, endpoint, Some("cfg.json")).join(" "));
            for (k, v) in launch_env(agent.id, endpoint) {
                all.push_str(&k);
                all.push_str(&v);
            }
        }
        assert!(!all.contains(secret));
        assert!(all.contains(TOKEN_ENV), "nothing names the token variable");
    }

    #[test]
    fn codex_args_need_no_shell_quoting() {
        // Codex parses each `-c` value as TOML and falls back to the literal
        // string, so we pass bare values: no quotes, no spaces, nothing for
        // cmd.exe / PowerShell / sh to mangle on the way in.
        let args = launch_args("codex", "http://127.0.0.1:63345/mcp", None);
        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "mcp_servers.uxnan-browser.url=http://127.0.0.1:63345/mcp".to_string(),
                "-c".to_string(),
                "mcp_servers.uxnan-browser.bearer_token_env_var=UXNAN_MCP_TOKEN".to_string(),
                "-c".to_string(),
                "mcp_servers.uxnan-browser.env_http_headers.x-uxnan-agent-id=UXNAN_AGENT_ID"
                    .to_string(),
            ]
        );
        for a in &args {
            assert!(
                !a.contains(' ') && !a.contains('"') && !a.contains('\''),
                "{a} would need shell quoting"
            );
        }
    }

    #[test]
    fn claude_args_are_empty_without_a_config_file() {
        // No file → no flag, rather than a flag pointing at nothing (which is a
        // hard startup error in Claude Code).
        assert!(launch_args("claude", "http://127.0.0.1:9/mcp", None).is_empty());
        assert_eq!(
            launch_args("claude", "http://127.0.0.1:9/mcp", Some("/tmp/c.json")),
            vec!["--mcp-config".to_string(), "/tmp/c.json".to_string()]
        );
    }

    #[test]
    fn opencode_env_is_a_merge_over_the_users_config() {
        let env = launch_env("opencode", "http://127.0.0.1:9/mcp");
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, OPENCODE_CONFIG_ENV);
        let doc: Value = serde_json::from_str(&env[0].1).unwrap();
        // Only our server — anything else in the value would replace a key of
        // the user's own config, since OpenCode merges this over the files.
        assert_eq!(doc.as_object().unwrap().len(), 1);
        assert_eq!(doc["mcp"][SERVER_NAME]["type"], "remote");
        assert_eq!(doc["mcp"][SERVER_NAME]["url"], "http://127.0.0.1:9/mcp");
        assert_eq!(doc["mcp"][SERVER_NAME]["enabled"], true);
        assert_eq!(
            doc["mcp"][SERVER_NAME]["headers"]["x-uxnan-agent-id"],
            "{env:UXNAN_AGENT_ID}"
        );
    }

    #[test]
    fn launch_env_all_skips_disabled_agents() {
        let none: HashSet<&str> = HashSet::new();
        assert_eq!(
            launch_env_all("http://x/mcp", &none, None, Some(1)).len(),
            1
        );
        let off: HashSet<&str> = ["opencode"].into_iter().collect();
        assert!(launch_env_all("http://x/mcp", &off, Some("opencode"), Some(1)).is_empty());
    }

    #[test]
    fn opencode_2s_variable_goes_only_where_it_is_launched() {
        let none: HashSet<&str> = HashSet::new();
        let e = "http://x/mcp";
        // OpenCode 1 (or an unknown version): every terminal, as before — a
        // hand-typed `opencode` there has no daemon to hand it to.
        for major in [Some(1), None] {
            assert_eq!(launch_env_all(e, &none, None, major).len(), 1);
            assert_eq!(launch_env_all(e, &none, Some("claude"), major).len(), 1);
        }
        // OpenCode 2: only the terminal uxnan opens to launch it; a plain
        // terminal or another agent's would give it to the shared service.
        assert_eq!(launch_env_all(e, &none, Some("opencode"), Some(2)).len(), 1);
        assert!(launch_env_all(e, &none, None, Some(2)).is_empty());
        assert!(launch_env_all(e, &none, Some("claude"), Some(3)).is_empty());
    }

    #[test]
    fn only_opencode_2_is_launched_standalone() {
        // OpenCode 1 rejects the flag outright (prints its help and exits), so
        // an unknown version must not get it either.
        assert!(required_args("opencode", Some(1)).is_empty());
        assert!(required_args("opencode", None).is_empty());
        assert_eq!(required_args("opencode", Some(2)), vec!["--standalone"]);
        assert!(required_args("claude", Some(2)).is_empty());

        // …and the catalog carries it whether or not the server is up: it is
        // not part of the MCP registration.
        for endpoint in [None, Some("http://127.0.0.1:9/mcp")] {
            let infos = agent_infos(endpoint, None, Some(2));
            let opencode = infos.iter().find(|a| a.id == "opencode").unwrap();
            assert_eq!(opencode.required_args, vec!["--standalone"]);
        }
    }

    #[test]
    fn agent_infos_carry_args_only_once_the_server_is_up() {
        let cold = agent_infos(None, None, Some(1));
        assert_eq!(cold.len(), AGENTS.len());
        assert!(cold.iter().all(|a| a.args.is_empty()));

        let warm = agent_infos(Some("http://127.0.0.1:9/mcp"), Some("cfg.json"), Some(1));
        let claude = warm.iter().find(|a| a.id == "claude").unwrap();
        assert_eq!(claude.args, vec!["--mcp-config", "cfg.json"]);
        let opencode = warm.iter().find(|a| a.id == "opencode").unwrap();
        assert!(opencode.args.is_empty()); // env-based
    }

    #[test]
    fn every_agent_row_says_how_it_is_wired() {
        // Each Settings row shows this line under the agent's name — the
        // per-launch answer to the question the hooks list answers with a
        // config path. An empty one would leave the row claiming a name and
        // explaining nothing.
        for infos in [
            agent_infos(None, None, None),
            agent_infos(Some("http://127.0.0.1:9/mcp"), Some("cfg.json"), None),
        ] {
            for (info, agent) in infos.iter().zip(AGENTS) {
                assert_eq!(info.id, agent.id);
                assert_eq!(info.label, agent.label);
                assert!(
                    !info.mechanism.is_empty(),
                    "{} says nothing about how it is wired",
                    agent.id
                );
            }
        }
        // The file Claude is launched with is named once it exists.
        let warm = agent_infos(Some("http://127.0.0.1:9/mcp"), Some("cfg.json"), None);
        let claude = warm.iter().find(|a| a.id == "claude").unwrap();
        assert_eq!(claude.mechanism, "--mcp-config cfg.json");
        let opencode = warm.iter().find(|a| a.id == "opencode").unwrap();
        assert_eq!(opencode.mechanism, OPENCODE_CONFIG_ENV);
    }

    #[test]
    fn claude_config_names_the_env_var_and_the_endpoint() {
        let text = claude_config_json("http://127.0.0.1:63345/mcp");
        let doc: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(doc["mcpServers"][SERVER_NAME]["type"], "http");
        assert_eq!(
            doc["mcpServers"][SERVER_NAME]["url"],
            "http://127.0.0.1:63345/mcp"
        );
        assert_eq!(
            doc["mcpServers"][SERVER_NAME]["headers"]["Authorization"],
            "Bearer ${UXNAN_MCP_TOKEN}"
        );
        assert_eq!(
            doc["mcpServers"][SERVER_NAME]["headers"]["x-uxnan-agent-id"],
            "${UXNAN_AGENT_ID}"
        );
    }

    #[test]
    fn reads_the_major_version_either_opencode_prints() {
        // Both spellings captured from the real CLIs.
        assert_eq!(parse_major_version("1.18.32\n"), Some(1));
        assert_eq!(parse_major_version("opencode v2.0.16\n"), Some(2));
        assert_eq!(parse_major_version("V10.0.0-beta.3"), Some(10));
        // A bare number, prose or nothing is no version.
        assert_eq!(parse_major_version("2"), None);
        assert_eq!(parse_major_version("version unknown"), None);
        assert_eq!(parse_major_version(""), None);
    }
}
