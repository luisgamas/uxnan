import { beforeEach, describe, expect, it, vi } from "vitest";

// The store calls the real `$lib/api` wrapper, so the command is faked at the
// module boundary rather than the IPC one — this file is a `node`-project test
// (pure logic, no component), matching the split documented in vitest.workspace.
const report = vi.hoisted(() => vi.fn());
vi.mock("$lib/api", () => ({ diagnosticsReport: report }));

const { diagnostics } = await import("./diagnostics.svelte");

describe("diagnostics store", () => {
  beforeEach(() => {
    report.mockReset();
    diagnostics.previousSessionUnclean = false;
    diagnostics.logPath = null;
    diagnostics.dismissed = false;
    diagnostics.loaded = false;
  });

  it("stays quiet when the previous session shut down cleanly", async () => {
    report.mockResolvedValue({ logPath: "C:/logs/app.log", previousSessionUnclean: false });
    await diagnostics.start();
    expect(diagnostics.loaded).toBe(true);
    expect(diagnostics.noticeVisible).toBe(false);
    expect(diagnostics.logPath).toBe("C:/logs/app.log");
  });

  it("shows the notice after an unclean shutdown", async () => {
    report.mockResolvedValue({ logPath: "C:/logs/app.log", previousSessionUnclean: true });
    await diagnostics.start();
    expect(diagnostics.noticeVisible).toBe(true);
  });

  it("does not show the notice again once dismissed", async () => {
    report.mockResolvedValue({ logPath: null, previousSessionUnclean: true });
    await diagnostics.start();
    diagnostics.dismiss();
    expect(diagnostics.noticeVisible).toBe(false);
  });

  it("never shows anything before the backend has answered", async () => {
    // Otherwise the notice could flash on every launch while the read is in
    // flight, which would be worse than not warning at all.
    expect(diagnostics.noticeVisible).toBe(false);
  });

  it("stays silent when the command is unavailable", async () => {
    // An older backend has no `diagnostics_report`; a diagnostics read that
    // cannot answer must not noise up startup.
    report.mockRejectedValue(new Error("unknown command"));
    await expect(diagnostics.start()).resolves.toBeUndefined();
    expect(diagnostics.loaded).toBe(true);
    expect(diagnostics.noticeVisible).toBe(false);
  });
});
