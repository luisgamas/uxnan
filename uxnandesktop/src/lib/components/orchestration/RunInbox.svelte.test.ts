/**
 * A driven run's strip and inbox: who drives it, what waits for them, and the
 * one action — showing the coordinator's terminal. The run is a pure fixture;
 * the coordinator's tab, when there is one, is a real tab in the terminals
 * store so the label reads its agent and the reveal moves the active tab.
 */

import { describe, expect, it } from "vitest";

import { mountWithProviders } from "../../../test/render";
import RunInbox from "./RunInbox.svelte";
import { addStep, createRun, postInbox, type Run } from "$lib/orchestration/run";

const { terminals } = await import("$lib/state/terminals.svelte");

const WT = "/tmp/wt";
const NOW = 1_700_000_000_000;

function driven(coordinator?: string): Run {
  let run: Run = { ...createRun("r1", "Split the work", NOW), status: "running", driven: coordinator ? { coordinator } : {}, inbox: [], inboxSeq: 0 };
  run = addStep(run, { title: "Lexer" }).run;
  run = addStep(run, { title: "Parser" }).run;
  return run;
}

describe("RunInbox", () => {
  it("names the coordinator's agent, counts what waits, and opens a message", async () => {
    terminals.setWorkspace(WT);
    const tabId = terminals.create({ cwd: WT, title: "orchestrator", agentName: "Claude Code", agentCommand: "claude" });
    let run = driven(tabId);
    run = postInbox(run, { type: "worker_done", stepId: "s1", dispatchId: "s1.1", text: "## Done\nthe lexer is in" }, NOW - 120_000);
    run = postInbox(run, { type: "question", stepId: "s2", text: "keep the old flag?" }, NOW);
    const { screen, user } = mountWithProviders(RunInbox, { props: { run } });

    expect(screen.getByText("Driven by Claude Code · orchestrator")).toBeTruthy();
    expect(screen.getByText("2 waiting")).toBeTruthy();
    // Each message: the step it is about, its kind, its dispatch, its text.
    expect(screen.getByText("Lexer")).toBeTruthy();
    expect(screen.getByText("Worker done")).toBeTruthy();
    expect(screen.getByText("s1.1")).toBeTruthy();
    expect(screen.getByText("Parser")).toBeTruthy();
    expect(screen.getByText("Question")).toBeTruthy();
    // A message opens to its full text.
    const row = screen.getByRole("button", { name: /Lexer/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.querySelector("pre")?.textContent).toContain("the lexer is in");
  });

  it("shows the coordinator's terminal on request", async () => {
    terminals.setWorkspace(WT);
    const tabId = terminals.create({ cwd: WT, title: "orchestrator", agentName: "Codex", agentCommand: "codex" });
    // Another tab opened after it is the active one; the reveal brings the
    // coordinator's back. Both sit in the workspace's one group.
    const other = terminals.create({ cwd: WT, title: "other" });
    const group = terminals.root as { kind: string; activeTabId: string };
    expect(group.kind).toBe("group");
    expect(group.activeTabId).toBe(other);
    const { screen, user } = mountWithProviders(RunInbox, { props: { run: driven(tabId) } });
    await user.click(screen.getByRole("button", { name: "Show the coordinator's terminal" }));
    expect((terminals.root as { activeTabId: string }).activeTabId).toBe(tabId);
  });

  it("says when nothing waits, when a shell drives it, and how it ended", () => {
    const run: Run = { ...driven(), status: "completed", driven: { outcome: "success", summary: "Both halves landed." } };
    const { screen } = mountWithProviders(RunInbox, { props: { run } });
    expect(screen.getByText("Driven from a shell")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Both halves landed.")).toBeTruthy();
    expect(screen.getByText(/Nothing waiting/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show the coordinator's terminal" })).toBeNull();
  });

  it("says so when the coordinator's terminal is gone", () => {
    const { screen } = mountWithProviders(RunInbox, { props: { run: driven("no-such-tab") } });
    expect(screen.getByText("The coordinator's terminal is closed")).toBeTruthy();
  });
});
