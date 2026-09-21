import { describe, expect, it } from "vitest";
import {
  picksPermissionMode,
  picksPermissionModeEnv,
  planUnattended,
  unattendedLevel,
  unattendedMode,
} from "./agentUnattended";

describe("unattended launches", () => {
  it("knows the reviewed automatic mode of the CLIs that have one", () => {
    expect(unattendedMode("claude")).toEqual({ level: "reviewed", args: ["--permission-mode", "auto"] });
    expect(unattendedMode("codex")).toEqual({ level: "reviewed", args: ["--approve-for-me"] });
    expect(unattendedMode("qwen")).toEqual({ level: "reviewed", args: ["--approval-mode", "auto"] });
    expect(unattendedMode("ante")).toEqual({ level: "reviewed", args: ["--permission-mode", "auto"] });
    expect(unattendedMode("kimi")).toEqual({ level: "reviewed", args: ["--yolo"] });
    expect(unattendedMode("devin")).toEqual({ level: "reviewed", args: ["--permission-mode", "smart"] });
    // The one CLI whose mode is an environment variable, not a flag.
    expect(unattendedMode("goose")).toEqual({ level: "reviewed", env: { GOOSE_MODE: "smart_approve" } });
  });

  it("knows the edits-only tier of the CLIs that stop there", () => {
    expect(unattendedMode("agy")).toEqual({ level: "editsOnly", args: ["--mode", "accept-edits"] });
    expect(unattendedMode("grok")).toEqual({ level: "editsOnly", args: ["--permission-mode", "acceptEdits"] });
    expect(unattendedMode("command-code")).toEqual({ level: "editsOnly", args: ["--accept-edits"] });
    expect(unattendedMode("cmd")).toEqual({ level: "editsOnly", args: ["--accept-edits"] });
    expect(unattendedMode("vibe")).toEqual({ level: "editsOnly", args: ["--agent", "accept-edits"] });
    expect(unattendedMode("omp")).toEqual({ level: "editsOnly", args: ["--approval-mode", "write"] });
    expect(unattendedMode("autohand")).toEqual({ level: "editsOnly", args: ["--yes"] });
    expect(unattendedLevel("grok")).toBe("editsOnly");
    expect(unattendedLevel("claude")).toBe("reviewed");
  });

  it("matches the command by basename, whatever the path or launcher extension", () => {
    expect(unattendedMode("/usr/local/bin/claude")?.args).toEqual(["--permission-mode", "auto"]);
    expect(unattendedMode("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd")?.args).toEqual(["--approve-for-me"]);
    expect(unattendedMode("Claude")?.args).toEqual(["--permission-mode", "auto"]);
    expect(unattendedMode("  qwen.exe ")?.level).toBe("reviewed");
  });

  it("says so for a CLI without a tier, rather than guessing one", () => {
    // Only a skip-all flag or an allow-list.
    expect(unattendedMode("opencode")).toBeNull();
    expect(unattendedMode("kilo")).toBeNull();
    expect(unattendedMode("cursor-agent")).toBeNull();
    // Its tier exists only on the one-shot `exec` subcommand, not on the TUI
    // Uxnan launches.
    expect(unattendedMode("zero")).toBeNull();
    expect(unattendedMode("droid")).toBeNull();
    // No approval prompt at all: nothing to add.
    expect(unattendedMode("pi")).toBeNull();
    expect(unattendedMode("")).toBeNull();
    expect(unattendedLevel("pi")).toBeNull();
  });

  it("never carries a skip-everything flag", () => {
    const bypass = /dangerous|skip-permissions|unrestricted|bypass|full-auto|always-approve|allow-all|trust-all/;
    for (const cmd of ["claude", "codex", "qwen", "ante", "kimi", "devin", "agy", "grok", "command-code", "vibe", "omp", "autohand"]) {
      const mode = unattendedMode(cmd);
      expect(mode, cmd).not.toBeNull();
      for (const a of mode!.args ?? []) expect(a, cmd).not.toMatch(bypass);
    }
    expect(unattendedMode("goose")?.env?.GOOSE_MODE).not.toBe("auto");
  });

  it("leaves a launch alone when the person's own args already chose", () => {
    expect(picksPermissionMode(["--permission-mode", "plan"])).toBe(true);
    expect(picksPermissionMode(["--permission-mode=acceptEdits"])).toBe(true);
    expect(picksPermissionMode(["--dangerously-skip-permissions"])).toBe(true);
    expect(picksPermissionMode(["--approve-for-me"])).toBe(true);
    expect(picksPermissionMode(["--approval-mode", "yolo"])).toBe(true);
    expect(picksPermissionMode(["-a", "never"])).toBe(true);
    expect(picksPermissionMode(["-s", "workspace-write"])).toBe(true);
    expect(picksPermissionMode(["--auto"])).toBe(true);
    expect(picksPermissionMode(["--auto", "low"])).toBe(true);
    expect(picksPermissionMode(["--yolo"])).toBe(true);
    expect(picksPermissionMode(["-y"])).toBe(true);
    expect(picksPermissionMode(["--yes-always"])).toBe(true);
    expect(picksPermissionMode(["--accept-edits"])).toBe(true);
    expect(picksPermissionMode(["--allow-all-tools"])).toBe(true);
    expect(picksPermissionMode(["--allow-tool=shell"])).toBe(true);
    expect(picksPermissionMode(["--allowedTools", "Bash"])).toBe(true);
    expect(picksPermissionMode(["--trust-tools=read,grep"])).toBe(true);
    expect(picksPermissionMode(["--skip-permissions-unsafe"])).toBe(true);
    expect(picksPermissionMode(["--plan"])).toBe(true);
    expect(picksPermissionMode(["--readonly"])).toBe(true);
    expect(picksPermissionMode(["--use-spec"])).toBe(true);
    expect(picksPermissionMode(["--model", "o3"])).toBe(false);
    expect(picksPermissionMode(["--allow-escalation"])).toBe(false);
    expect(picksPermissionMode([])).toBe(false);
  });

  it("reads the flags whose meaning depends on the CLI only for that CLI", () => {
    // `--mode` is a permission mode on two CLIs and a transport on another.
    expect(picksPermissionMode(["--mode", "plan"], "agy")).toBe(true);
    expect(picksPermissionMode(["--mode", "ask"], "cursor-agent")).toBe(true);
    expect(picksPermissionMode(["--mode", "acp"], "autohand")).toBe(false);
    expect(picksPermissionMode(["--mode", "plan"])).toBe(false);
    // `--agent` is the approval agent on one CLI, an agent profile elsewhere.
    expect(picksPermissionMode(["--agent", "plan"], "vibe")).toBe(true);
    expect(picksPermissionMode(["--agent", "build"], "opencode")).toBe(false);
    // `--force`/`-f` is a bypass on one CLI only.
    expect(picksPermissionMode(["-f"], "/opt/bin/cursor-agent")).toBe(true);
    expect(picksPermissionMode(["--force"], "agent")).toBe(true);
    expect(picksPermissionMode(["-f", "prompt.md"], "droid")).toBe(false);
  });

  it("reads a mode from the profile's environment too", () => {
    expect(picksPermissionModeEnv([{ key: "GOOSE_MODE", value: "approve" }])).toBe(true);
    expect(picksPermissionModeEnv([{ key: " DEVIN_PERMISSION_MODE ", value: "normal" }])).toBe(true);
    expect(picksPermissionModeEnv({ COPILOT_ALLOW_ALL: "1" })).toBe(true);
    expect(picksPermissionModeEnv({ QWEN_SANDBOX: "1" })).toBe(true);
    expect(picksPermissionModeEnv([{ key: "ANTHROPIC_MODEL", value: "x" }])).toBe(false);
    expect(picksPermissionModeEnv({})).toBe(false);
    expect(picksPermissionModeEnv(undefined)).toBe(false);
  });

  it("plans a launch: what goes on, and what the receipt says", () => {
    expect(planUnattended({ command: "claude", args: [] })).toEqual({
      extraArgs: ["--permission-mode", "auto"],
      outcome: "applied",
    });
    expect(planUnattended({ command: "goose", args: [] })).toEqual({
      extraEnv: { GOOSE_MODE: "smart_approve" },
      outcome: "applied",
    });
    expect(planUnattended({ command: "grok", args: ["--model", "grok-4"] })).toEqual({
      extraArgs: ["--permission-mode", "acceptEdits"],
      outcome: "partial",
    });
    expect(planUnattended({ command: "claude", args: ["--permission-mode", "plan"] })).toEqual({
      outcome: "configured",
    });
    expect(planUnattended({ command: "goose", args: [], env: [{ key: "GOOSE_MODE", value: "approve" }] })).toEqual({
      outcome: "configured",
    });
    expect(planUnattended({ command: "opencode", args: [] })).toEqual({ outcome: "unsupported" });
    expect(planUnattended({ command: "zero", args: [] })).toEqual({ outcome: "unsupported" });
  });
});
