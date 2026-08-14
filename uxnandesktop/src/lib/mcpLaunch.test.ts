import { beforeEach, describe, expect, it, vi } from "vitest";

// The catalog normally comes from the backend; these tests drive the pure
// transform with a stand-in, so they cover exactly what the launch path does to
// a command line.
vi.mock("$lib/api", () => ({ mcpInfo: vi.fn().mockResolvedValue({ agents: [] }) }));

import {
  __setMcpCatalog,
  launchExecutable,
  mcpLaunchArgs,
  syncMcpLaunchSettings,
  withMcpLaunch,
} from "./mcpLaunch";
import type { BrowserSettings, McpAgentInfo } from "./types";

const CATALOG: McpAgentInfo[] = [
  {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    via: "args",
    mechanism: "--mcp-config C:\\Users\\a b\\AppData\\uxnan\\mcp\\claude-63345.json",
    args: ["--mcp-config", "C:\\Users\\a b\\AppData\\uxnan\\mcp\\claude-63345.json"],
  },
  {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    via: "args",
    mechanism: "-c mcp_servers.uxnan-browser.*",
    args: [
      "-c",
      "mcp_servers.uxnan-browser.url=http://127.0.0.1:63345/mcp",
      "-c",
      "mcp_servers.uxnan-browser.bearer_token_env_var=UXNAN_MCP_TOKEN",
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    commands: ["opencode"],
    via: "env",
    mechanism: "OPENCODE_CONFIG_CONTENT",
    args: [],
  },
];

const ON: BrowserSettings = {
  enabled: true,
  linkPolicy: "internal",
  allowAgents: true,
  terminalLinks: true,
  homepage: "",
  mcpEnabled: true,
  frictionFree: true,
  mcpDisabledAgents: [],
};

beforeEach(() => {
  __setMcpCatalog(CATALOG);
  syncMcpLaunchSettings(ON);
});

describe("launchExecutable", () => {
  it("reads the executable name out of a command line", () => {
    expect(launchExecutable("claude")).toBe("claude");
    expect(launchExecutable("claude --resume 1234")).toBe("claude");
    expect(launchExecutable("codex resume 1234")).toBe("codex");
    expect(launchExecutable("C:\\Users\\a\\bin\\claude.exe --resume 1")).toBe("claude");
    expect(launchExecutable('"C:\\Program Files\\bin\\claude.cmd" --resume 1')).toBe("claude");
    expect(launchExecutable("/usr/local/bin/opencode --session x")).toBe("opencode");
    expect(launchExecutable("")).toBe("");
  });
});

describe("withMcpLaunch", () => {
  it("appends Claude's config flag, quoted for the shell", () => {
    // The path has a space, so each shell needs its own quoting; the flag value
    // is a path precisely so this is the only quoting that ever happens.
    expect(withMcpLaunch("claude", "cmd.exe")).toBe(
      'claude --mcp-config "C:\\Users\\a b\\AppData\\uxnan\\mcp\\claude-63345.json"',
    );
    expect(withMcpLaunch("claude", "pwsh.exe")).toBe(
      "claude --mcp-config 'C:\\Users\\a b\\AppData\\uxnan\\mcp\\claude-63345.json'",
    );
    expect(withMcpLaunch("claude", "/bin/bash")).toBe(
      "claude --mcp-config 'C:\\Users\\a b\\AppData\\uxnan\\mcp\\claude-63345.json'",
    );
  });

  it("appends Codex's overrides unquoted in every shell", () => {
    const expected =
      "codex -c mcp_servers.uxnan-browser.url=http://127.0.0.1:63345/mcp" +
      " -c mcp_servers.uxnan-browser.bearer_token_env_var=UXNAN_MCP_TOKEN";
    expect(withMcpLaunch("codex", "cmd.exe")).toBe(expected);
    expect(withMcpLaunch("codex", "pwsh.exe")).toBe(expected);
    expect(withMcpLaunch("codex", "/bin/zsh")).toBe(expected);
  });

  it("covers a resumed session, not just a fresh launch", () => {
    expect(withMcpLaunch("codex resume 019ff-abc", "cmd.exe")).toContain(
      "codex resume 019ff-abc -c mcp_servers.uxnan-browser.url=",
    );
    expect(withMcpLaunch("claude --resume 019ff-abc", "cmd.exe")).toContain(
      "claude --resume 019ff-abc --mcp-config ",
    );
  });

  it("leaves env-registered agents and plain commands untouched", () => {
    // OpenCode gets its registration from the terminal's environment, and a
    // non-agent command must never grow flags it can't parse.
    expect(withMcpLaunch("opencode", "cmd.exe")).toBe("opencode");
    expect(withMcpLaunch("npm run dev", "cmd.exe")).toBe("npm run dev");
    expect(withMcpLaunch("grok", "cmd.exe")).toBe("grok");
    expect(withMcpLaunch("", "cmd.exe")).toBe("");
  });

  it("honors the master switch and the per-agent toggles", () => {
    syncMcpLaunchSettings({ ...ON, mcpEnabled: false });
    expect(withMcpLaunch("claude", "cmd.exe")).toBe("claude");

    syncMcpLaunchSettings({ ...ON, enabled: false });
    expect(withMcpLaunch("claude", "cmd.exe")).toBe("claude");

    syncMcpLaunchSettings({ ...ON, mcpDisabledAgents: ["claude"] });
    expect(withMcpLaunch("claude", "cmd.exe")).toBe("claude");
    expect(withMcpLaunch("codex", "cmd.exe")).not.toBe("codex"); // others unaffected
  });

  it("adds nothing while the catalog is cold", () => {
    // Before the local server is listening there is no endpoint to point at —
    // the agent launches without the tools rather than with a broken server.
    __setMcpCatalog([]);
    expect(withMcpLaunch("claude", "cmd.exe")).toBe("claude");
    expect(mcpLaunchArgs("codex")).toEqual([]);
  });
});
