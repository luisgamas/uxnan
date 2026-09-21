import { describe, expect, it } from "vitest";
import { picksPermissionMode, unattendedArgs } from "./agentUnattended";

describe("unattended launches", () => {
  it("knows the reviewed automatic mode of the CLIs that have one", () => {
    expect(unattendedArgs("claude")).toEqual(["--permission-mode", "auto"]);
    expect(unattendedArgs("codex")).toEqual(["--approve-for-me"]);
    expect(unattendedArgs("/usr/local/bin/claude")).toEqual(["--permission-mode", "auto"]);
    expect(unattendedArgs("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd")).toEqual(["--approve-for-me"]);
    expect(unattendedArgs("Claude")).toEqual(["--permission-mode", "auto"]);
  });

  it("says so for a CLI without a flag, rather than guessing one", () => {
    expect(unattendedArgs("opencode")).toBeNull();
    expect(unattendedArgs("grok")).toBeNull();
    expect(unattendedArgs("")).toBeNull();
  });

  it("leaves a launch alone when the person's own args already chose", () => {
    expect(picksPermissionMode(["--permission-mode", "plan"])).toBe(true);
    expect(picksPermissionMode(["--permission-mode=acceptEdits"])).toBe(true);
    expect(picksPermissionMode(["--dangerously-skip-permissions"])).toBe(true);
    expect(picksPermissionMode(["--approve-for-me"])).toBe(true);
    expect(picksPermissionMode(["--model", "o3"])).toBe(false);
    expect(picksPermissionMode([])).toBe(false);
  });
});
