import os from "node:os";
import { describe, expect, it } from "vitest";

import { findLeaks, redact, redactString, tag } from "./redact.mjs";

const SUBS = [
  { value: "C:\\Users\\someone", replacement: "<home>" },
  { value: "someone", replacement: "<user>" },
  { value: "DESKTOP-ABC123", replacement: "<host>" },
];

describe("redactString", () => {
  it("replaces the home directory before the user name inside it", () => {
    expect(redactString("C:\\Users\\someone\\Documents\\repo", SUBS)).toMatch(
      /^<home>\/<path:[0-9a-f]{12}>$/,
    );
  });

  it("hides the folder names under the home directory, not just the home itself", () => {
    // These are the client and project names; substituting only `<home>` would
    // publish them.
    const a = redactString("C:\\Users\\someone\\work\\acme", SUBS);
    const b = redactString("C:\\Users\\someone\\work\\other-client", SUBS);
    expect(a).not.toContain("acme");
    expect(b).not.toContain("other-client");
    expect(a).not.toBe(b);
  });

  it("is case-insensitive, as Windows paths are", () => {
    expect(redactString("c:\\users\\SOMEONE\\x", SUBS)).toMatch(/^<home>\/<path:[0-9a-f]{12}>$/);
  });

  it("leaves a bare substituted root as the root", () => {
    expect(redactString("C:\\Users\\someone", SUBS)).toBe("<home>");
  });

  it("collapses any surviving absolute path to a stable tag", () => {
    const out = redactString("D:\\work\\secret-client\\src", SUBS);
    expect(out).toMatch(/^<path:[0-9a-f]{12}>$/);
    // Stable across calls, so two samples of the same folder still line up.
    expect(out).toBe(redactString("D:\\work\\secret-client\\src", SUBS));
  });

  it("leaves an executable basename alone — that is the measurement", () => {
    expect(redactString("msedgewebview2.exe", SUBS)).toBe("msedgewebview2.exe");
  });

  it("passes non-strings through", () => {
    expect(redactString(42, SUBS)).toBe(42);
  });
});

describe("redact", () => {
  it("walks objects, arrays and keys", () => {
    const doc = {
      notes: ["ran in C:\\Users\\someone\\proj"],
      workspaces: { "C:\\Users\\someone\\proj": { rssMb: 12 } },
      nested: [{ host: "DESKTOP-ABC123" }],
    };
    const clean = redact(doc, SUBS);
    const key = Object.keys(clean.workspaces)[0];
    expect(clean.notes[0]).toMatch(/^ran in <home>\/<path:[0-9a-f]{12}>$/);
    expect(key).toMatch(/^<home>\/<path:[0-9a-f]{12}>$/);
    expect(clean.nested[0].host).toBe("<host>");
    // The value survives the key being rewritten.
    expect(clean.workspaces[key].rssMb).toBe(12);
  });

  it("leaves numbers, booleans and null untouched", () => {
    expect(redact({ a: 1, b: true, c: null }, SUBS)).toEqual({ a: 1, b: true, c: null });
  });
});

describe("findLeaks", () => {
  it("finds an identifier that survived", () => {
    expect(findLeaks({ note: "hello someone" }, SUBS)).toContain("hello someone");
  });

  it("finds a raw drive-letter path even when no identifier matches", () => {
    expect(findLeaks({ note: "E:\\build\\out" }, SUBS)).toContain("E:\\build\\out");
  });

  it("reports nothing for a scrubbed document", () => {
    const doc = redact({ note: "C:\\Users\\someone\\x", host: "DESKTOP-ABC123" }, SUBS);
    expect(findLeaks(doc, SUBS)).toEqual([]);
  });

  it("catches this machine's own identifiers with the real substitution list", () => {
    // The guard that actually runs before a result file is written.
    const doc = { note: `ran as ${os.userInfo().username} on ${os.hostname()}` };
    expect(findLeaks(doc).length).toBeGreaterThan(0);
    expect(findLeaks(redact(doc))).toEqual([]);
  });
});

describe("tag", () => {
  it("is stable, short and not reversible by inspection", () => {
    const a = tag("DESKTOP-ABC123");
    expect(a).toHaveLength(12);
    expect(a).toBe(tag("DESKTOP-ABC123"));
    expect(a).not.toBe(tag("DESKTOP-ABC124"));
    expect(a).not.toContain("DESKTOP");
  });
});
