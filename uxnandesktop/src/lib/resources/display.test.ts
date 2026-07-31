/**
 * The display rules the popover rows depend on: when a row is a spike, when it
 * is frozen as ended, when identity loss outranks everything, and what the
 * whole surface shows before/without data. Pure, so each rule is one assert.
 */

import { describe, expect, it } from "vitest";

import type { ResourceGroupSummary, ResourceSummary } from "$lib/types";
import {
  confidenceKey,
  groupLabel,
  groupState,
  orderedGroups,
  SPIKE_FACTOR,
  SPIKE_FLOOR_PERCENT,
  surfaceState,
} from "./display";

function group(overrides: Partial<ResourceGroupSummary> = {}): ResourceGroupSummary {
  return {
    kind: "workspace",
    id: "C:\\dev\\uxnan",
    confidence: "exact",
    ended: false,
    processes: 2,
    cpuPercent: 1,
    cpuAvgPercent: 1,
    cpuPeakPercent: 2,
    residentBytes: 100,
    residentAvgBytes: 100,
    residentPeakBytes: 120,
    virtualBytes: 1000,
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
    updatedAtMs: 1000,
    bufferSeconds: 600,
    groups: [],
    orphans: [],
    terminalsLinked: 0,
    ...overrides,
  };
}

describe("groupState", () => {
  it("is ok for a quiet, attributed, live group", () => {
    expect(groupState(group())).toBe("ok");
  });

  it("flags a spike only above the floor AND the factor", () => {
    // Above both: instant 20% vs 4% average.
    expect(groupState(group({ cpuPercent: 20, cpuAvgPercent: 4 }))).toBe("spike");
    // Factor exceeded but under the floor: a 0.5% → 2% wiggle stays quiet.
    expect(groupState(group({ cpuPercent: 2, cpuAvgPercent: 0.5 }))).toBe("ok");
    // Floor exceeded but not the factor: busy-but-steady is not a spike.
    expect(groupState(group({ cpuPercent: 20, cpuAvgPercent: 15 }))).toBe("ok");
    // The exact boundary counts as a spike.
    expect(
      groupState(
        group({
          cpuPercent: SPIKE_FLOOR_PERCENT * SPIKE_FACTOR,
          cpuAvgPercent: SPIKE_FLOOR_PERCENT,
        }),
      ),
    ).toBe("spike");
  });

  it("never calls a spike on unknown CPU (absent is not zero, nor a peak)", () => {
    expect(groupState(group({ cpuPercent: null, cpuAvgPercent: null }))).toBe("ok");
    expect(groupState(group({ cpuPercent: 50, cpuAvgPercent: null }))).toBe("ok");
  });

  it("freezes an ended group regardless of its last figures", () => {
    expect(groupState(group({ ended: true, cpuPercent: 90, cpuAvgPercent: 1 }))).toBe("ended");
  });

  it("identity loss outranks everything else", () => {
    expect(
      groupState(group({ confidence: "unknown", ended: true, cpuPercent: 90, cpuAvgPercent: 1 })),
    ).toBe("unknown");
  });
});

describe("surfaceState", () => {
  it("is loading before any summary arrives", () => {
    expect(surfaceState(null, true)).toBe("loading");
  });

  it("is empty when nothing was ever sampled and nothing is in flight", () => {
    expect(surfaceState(null, false)).toBe("empty");
    expect(surfaceState(summary({ updatedAtMs: undefined }), false)).toBe("empty");
  });

  it("is unsupported only when neither CPU nor memory exist", () => {
    const caps = summary().capabilities;
    expect(
      surfaceState(summary({ capabilities: { ...caps, cpu: false, memory: false } }), false),
    ).toBe("unsupported");
    // Partial support renders the table with dashes instead of giving up.
    expect(surfaceState(summary({ capabilities: { ...caps, cpu: false } }), false)).toBe("ready");
  });

  it("is ready once a frame exists", () => {
    expect(surfaceState(summary(), false)).toBe("ready");
  });
});

describe("confidenceKey", () => {
  it("maps each confidence to its explanation key", () => {
    expect(confidenceKey("exact")).toBe("resources.confidenceExact");
    expect(confidenceKey("inferred")).toBe("resources.confidenceInferred");
    expect(confidenceKey("unknown")).toBe("resources.confidenceUnknown");
  });
});

describe("groupLabel", () => {
  it("shortens a workspace path to its folder name (both separators)", () => {
    expect(groupLabel(group({ kind: "workspace", id: "C:\\dev\\uxnan--pets" }))).toBe(
      "uxnan--pets",
    );
    expect(groupLabel(group({ kind: "workspace", id: "/home/dev/uxnan" }))).toBe("uxnan");
  });

  it("keeps an agent command verbatim", () => {
    expect(groupLabel(group({ kind: "agent", id: "cursor-agent" }))).toBe("cursor-agent");
  });

  it("trims a long terminal id to its tail", () => {
    const label = groupLabel(
      group({ kind: "terminal", id: "3f89ab00-1234-4cd9-a1b2-99887766aabb" }),
    );
    expect(label.length).toBeLessThanOrEqual(9);
    expect(label.startsWith("…")).toBe(true);
  });
});

describe("orderedGroups", () => {
  it("puts desktop first and ended groups last, whatever the wire order", () => {
    const s = summary({
      groups: [
        group({ kind: "agent", id: "claude" }),
        group({ kind: "workspace", id: "b", ended: true }),
        group({ kind: "desktop", id: undefined }),
        group({ kind: "workspace", id: "a" }),
      ],
    });
    const kinds = orderedGroups(s).map((g) => `${g.kind}${g.ended ? ":ended" : ""}`);
    expect(kinds).toEqual(["desktop", "workspace", "agent", "workspace:ended"]);
  });
});
