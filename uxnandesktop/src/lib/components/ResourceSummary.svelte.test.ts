/**
 * The popover's resource readout, state by state. What matters here is honesty
 * under partial knowledge: loading is not empty, empty is not zero, an unknown
 * confidence is visibly marked, a spike is highlighted only when real, an ended
 * group is frozen rather than dropped, and a survivor gets a warning — each of
 * these is a distinct render this file pins down.
 */

import { describe, expect, it } from "vitest";

import { mountWithProviders as mount } from "../../test/render";
import { resources } from "$lib/state/resources.svelte";
import type { ResourceGroupSummary, ResourceSummary } from "$lib/types";
import ResourceSummaryView from "./ResourceSummary.svelte";

function group(overrides: Partial<ResourceGroupSummary> = {}): ResourceGroupSummary {
  return {
    kind: "workspace",
    id: "C:\\dev\\uxnan--pets",
    confidence: "exact",
    ended: false,
    processes: 2,
    cpuPercent: 1.2,
    cpuAvgPercent: 1.0,
    cpuPeakPercent: 2.0,
    residentBytes: 200 * 1024 * 1024,
    residentAvgBytes: 190 * 1024 * 1024,
    residentPeakBytes: 220 * 1024 * 1024,
    virtualBytes: 900 * 1024 * 1024,
    ioReadBytesPerSec: null,
    ioWriteBytesPerSec: null,
    trend: "steady",
    ...overrides,
  };
}

function summary(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    enabled: true,
    capabilities: {
      cpu: true,
      memory: true,
      virtualMemory: true,
      io: true,
      startTime: true,
      validated: true,
    },
    sampling: { active: true, intervalMs: 2000, reason: "popover" },
    updatedAtMs: Date.now(),
    bufferSeconds: 600,
    total: {
      processes: 9,
      cpuPercent: 4.2,
      cpuAvgPercent: 3.9,
      cpuPeakPercent: 12,
      residentBytes: 800 * 1024 * 1024,
      residentAvgBytes: 780 * 1024 * 1024,
      residentPeakBytes: 900 * 1024 * 1024,
      virtualBytes: 4 * 1024 * 1024 * 1024,
      ioReadBytesPerSec: null,
      ioWriteBytesPerSec: null,
      trend: "steady",
    },
    groups: [group()],
    orphans: [],
    terminalsLinked: 1,
    ...overrides,
  };
}

/** The store is a module singleton; each test states its world explicitly. */
function setStore(value: ResourceSummary | null, loading = false): void {
  resources.summary = value;
  resources.loading = loading;
}

describe("ResourceSummary", () => {
  it("shows a loading line before the first data, never an empty zero-table", () => {
    setStore(null, true);
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("says measuring starts with the panel open when nothing was sampled yet", () => {
    setStore(null, false);
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText(/No samples yet/)).toBeInTheDocument();
  });

  it("states unsupported when the platform offers neither CPU nor memory", () => {
    const s = summary();
    s.capabilities = { ...s.capabilities, cpu: false, memory: false };
    setStore(s);
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText(/not available on this platform/)).toBeInTheDocument();
  });

  it("renders the total with instant CPU and memory", () => {
    setStore(summary());
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText("Uxnan (everything)")).toBeInTheDocument();
    expect(screen.getByText(/4\.2%/)).toBeInTheDocument();
    expect(screen.getByText(/800 MB/)).toBeInTheDocument();
    expect(screen.getByText("9 processes")).toBeInTheDocument();
  });

  it("shows the workspace folder name, not the full path", () => {
    setStore(summary());
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText("uxnan--pets")).toBeInTheDocument();
    expect(screen.queryByText(/C:\\dev/)).not.toBeInTheDocument();
  });

  it("marks an inferred group with ~ and an unknown one with ?", () => {
    setStore(
      summary({
        groups: [
          group({ kind: "agent", id: "claude", confidence: "inferred" }),
          group({ kind: "terminal", id: "pty-9", confidence: "unknown", cpuPercent: null, residentBytes: null }),
        ],
      }),
    );
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText("~")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders an unknown group's metrics as dashes, never zeros", () => {
    setStore(
      summary({
        groups: [
          group({
            kind: "terminal",
            id: "pty-9",
            confidence: "unknown",
            processes: 0,
            cpuPercent: null,
            residentBytes: null,
          }),
        ],
      }),
    );
    const { screen } = mount(ResourceSummaryView);
    const row = screen.container.querySelector('[data-testid="resource-group"]');
    expect(row?.textContent).toContain("—");
    expect(row?.textContent).not.toContain("0 B");
  });

  it("highlights a spike only when the instant is far above the average", () => {
    setStore(
      summary({
        groups: [group({ kind: "agent", id: "codex", cpuPercent: 22, cpuAvgPercent: 4 })],
      }),
    );
    const { screen } = mount(ResourceSummaryView);
    const row = screen.container.querySelector('[data-testid="resource-group"]');
    expect(row?.getAttribute("data-state")).toBe("spike");
  });

  it("freezes an ended group with an explicit note instead of dropping it", () => {
    setStore(summary({ groups: [group({ ended: true })] }));
    const { screen } = mount(ResourceSummaryView);
    const row = screen.container.querySelector('[data-testid="resource-group"]');
    expect(row?.getAttribute("data-state")).toBe("ended");
    expect(screen.getByText(/ended/)).toBeInTheDocument();
  });

  it("warns about processes that outlived their terminal", () => {
    setStore(
      summary({
        orphans: [
          {
            kind: "agent",
            id: "claude",
            pids: [4242],
            cpuPercent: 1,
            residentBytes: 64 * 1024 * 1024,
            sinceMs: Date.now() - 30_000,
            confidence: "exact",
          },
        ],
      }),
    );
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText("1 surviving process")).toBeInTheDocument();
    expect(
      screen.container.querySelector('[data-testid="resource-orphans"]'),
    ).toBeInTheDocument();
  });

  it("admits best-effort figures on an unvalidated platform", () => {
    const s = summary();
    s.capabilities = { ...s.capabilities, validated: false };
    setStore(s);
    const { screen } = mount(ResourceSummaryView);
    expect(screen.getByText(/best effort/)).toBeInTheDocument();
  });
});
