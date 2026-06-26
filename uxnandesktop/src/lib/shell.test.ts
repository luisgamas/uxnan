import { describe, expect, it } from "vitest";
import { buildRunCommand, quoteArg, shellKind } from "./shell";

describe("shellKind", () => {
  it("classifies PowerShell by name or path", () => {
    expect(shellKind("powershell.exe")).toBe("powershell");
    expect(shellKind("pwsh")).toBe("powershell");
    expect(shellKind("C:/Program Files/PowerShell/7/pwsh.exe")).toBe("powershell");
  });

  it("classifies cmd by name or path", () => {
    expect(shellKind("cmd.exe")).toBe("cmd");
    expect(shellKind("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
  });

  it("falls back to POSIX for unix shells and unknowns", () => {
    expect(shellKind("/bin/bash")).toBe("posix");
    expect(shellKind("/usr/bin/zsh")).toBe("posix");
    expect(shellKind(undefined)).toBe("posix");
    expect(shellKind("")).toBe("posix");
  });
});

describe("quoteArg", () => {
  it("leaves safe tokens unquoted in every shell", () => {
    for (const kind of ["posix", "cmd", "powershell"] as const) {
      expect(quoteArg("--model", kind)).toBe("--model");
      expect(quoteArg("opus-4.8", kind)).toBe("opus-4.8");
      expect(quoteArg("a/b_c.d", kind)).toBe("a/b_c.d");
    }
  });

  it("quotes whitespace per shell", () => {
    expect(quoteArg("a b", "posix")).toBe("'a b'");
    expect(quoteArg("a b", "cmd")).toBe('"a b"');
    expect(quoteArg("a b", "powershell")).toBe("'a b'");
  });

  it("escapes embedded quotes per shell", () => {
    // POSIX: close/escape/reopen the single quote.
    expect(quoteArg("it's a path", "posix")).toBe(`'it'\\''s a path'`);
    // PowerShell: a literal single quote doubles.
    expect(quoteArg("it's", "powershell")).toBe("'it''s'");
    // cmd: a literal double quote doubles inside double quotes.
    expect(quoteArg('say "hi"', "cmd")).toBe('"say ""hi"""');
  });

  it("quotes the empty string explicitly", () => {
    expect(quoteArg("", "posix")).toBe("''");
    expect(quoteArg("", "cmd")).toBe('""');
    expect(quoteArg("", "powershell")).toBe("''");
  });
});

describe("buildRunCommand", () => {
  it("joins an unquoted command with quoted args", () => {
    expect(buildRunCommand("claude", ["--model", "opus 4"], "cmd")).toBe(
      'claude --model "opus 4"',
    );
    expect(buildRunCommand("codex", ["-p", "fix the bug"], "posix")).toBe(
      "codex -p 'fix the bug'",
    );
  });

  it("handles no args", () => {
    expect(buildRunCommand("claude", [], "posix")).toBe("claude");
  });
});
