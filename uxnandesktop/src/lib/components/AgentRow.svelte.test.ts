/**
 * The nested sub-agent rows — what a parent's children actually show.
 *
 * These rows are the only place in the app where a spawned child is visible at
 * all, and they are made of data four different CLIs fill differently: one sends
 * a task, another only a kind, a third a tool in flight. So the assertions are
 * about the text a user reads with each of those gaps present, not about classes.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { mountWithProviders } from "../../test/render";
import AgentRow from "./AgentRow.svelte";
import { agentStatus } from "$lib/state/agentStatus.svelte";
import { clock } from "$lib/time.svelte";
import type { SubagentEntry } from "$lib/types";

const TAB_ID = "pty-1";

/** A minimal terminal tab: the row only reads its id, kind and agent identity. */
const tab = {
  id: TAB_ID,
  kind: "terminal" as const,
  title: "claude",
  agentName: "Claude Code",
  agentIcon: null,
  working: false,
  exited: false,
};

function child(over: Partial<SubagentEntry> = {}): SubagentEntry {
  return {
    id: "child-1",
    agentType: "code-reviewer",
    description: "review the diff",
    tool: null,
    status: "working",
    // Epoch **ms** — what the store hands the row after scaling from the
    // backend's seconds.
    startedAt: clock.now - 12_000,
    lastUpdate: clock.now,
    ...over,
  };
}

function reportWith(subagents: SubagentEntry[]) {
  agentStatus.byId = {
    [TAB_ID]: {
      status: "working",
      agentType: "claude",
      prompt: "do the thing",
      tool: "Agent",
      interrupted: false,
      summary: null,
      subagents,
      lastUpdate: clock.now,
    },
  };
}

const render = () =>
  mountWithProviders(AgentRow, {
    props: { tab, workspacePath: "C:/repo", active: false, onreveal: () => {} },
  });

describe("AgentRow — sub-agent rows", () => {
  beforeEach(() => {
    agentStatus.byId = {};
  });

  it("lists a running child with its task and its kind", () => {
    reportWith([child()]);

    const { screen } = render();

    expect(screen.getByText("review the diff")).toBeTruthy();
    expect(screen.getByText("code-reviewer")).toBeTruthy();
  });

  it("shows no elapsed time on a child — the shared clock is too coarse for one", () => {
    reportWith([child()]);

    const { screen } = render();

    // The parent's own "now/Nm/Nh" is fine; a child that lives seconds would sit
    // frozen and then jump, so it deliberately has none.
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
  });

  it("shows what the child is running right now, next to its task", () => {
    reportWith([child({ tool: "bash" })]);

    const { screen } = render();

    expect(screen.getByText(/bash/)).toBeTruthy();
  });

  it("drops a finished child's row but keeps it in the parent's count", () => {
    reportWith([
      child({ id: "done-1", description: "the finished one", status: "done" }),
      child({ id: "live-1", description: "the running one" }),
    ]);

    const { screen } = render();

    expect(screen.queryByText("the finished one")).toBeNull();
    expect(screen.getByText("the running one")).toBeTruthy();
    // Badge reads active/total while any child runs.
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("names a child with no description at all rather than rendering a blank row", () => {
    reportWith([child({ description: null, agentType: null })]);

    const { screen } = render();

    expect(screen.getByText("Sub-agent")).toBeTruthy();
  });
});
