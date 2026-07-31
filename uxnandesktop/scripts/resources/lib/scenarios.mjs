/**
 * The canonical scenarios — the questions the baseline exists to answer.
 *
 * A scenario is a *question*, a deterministic preparation, and a window in which
 * to measure. Adding a capability to uxnan that spawns a process, a watcher, a
 * poll or a webview means adding or extending a scenario here; that is what
 * keeps the baseline a living artifact rather than a snapshot from the week it
 * was written.
 *
 * Each scenario declares a `mode`:
 *
 * - **auto** — the harness prepares a profile and the app restores itself into
 *   the state under test. Fully reproducible, runs unattended.
 * - **assisted** — the state cannot be reached without a person driving the UI
 *   (or an account the benchmark must never hold). The harness still measures,
 *   still records, and the report labels the result as operator-driven. These
 *   become `auto` when the E2E driver lands; the metric names will not change.
 *
 * `stabilizeS` is the window discarded before resting statistics start. It is
 * not padding: a just-launched app is still paging in a webview, and folding
 * that into a "cost at rest" figure publishes a number no user ever sees.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GLOBAL_WORKSPACE,
  group,
  layout,
  project,
  shellRunning,
  split,
  terminalGrid,
  terminalTab,
} from "./profile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, "..", "fixtures");

/** Terminals used by the multi-terminal scenarios, all in the same cwd. */
function shellsIn(cwd, count) {
  return terminalGrid(count, (i) => terminalTab({ title: `shell ${i + 1}`, cwd, sid: `bench-${i}` }));
}

export const SCENARIOS = [
  {
    id: "R00",
    title: "Cold process",
    mode: "auto",
    question: "How long does launch take, and what does the app cost before anything is opened?",
    defaults: { durationS: 45, stabilizeS: 15 },
    prepare: () => ({
      repos: [],
      layout: null,
      notes: ["empty profile: no projects, no terminals, no optional features"],
    }),
  },

  {
    id: "R01",
    title: "Idle, default configuration",
    mode: "auto",
    question: "What does the app cost at rest with one small project open?",
    defaults: { durationS: 300, stabilizeS: 60 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: group([]) }),
      notes: [`fixture repo at commit ${fixtures.repo.head} (${fixtures.repo.files} files)`],
    }),
  },

  {
    id: "R02",
    title: "One terminal",
    mode: "auto",
    question: "What does a single live shell add?",
    defaults: { durationS: 120, stabilizeS: 30 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R01",
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 1) }),
      notes: ["one region, one shell"],
    }),
  },

  {
    id: "R03",
    title: "Four terminals in splits",
    mode: "auto",
    question: "What does each additional terminal cost?",
    defaults: { durationS: 120, stabilizeS: 30 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R02",
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 4) }),
      notes: ["2×2 split: four regions, four live shells"],
    }),
  },

  {
    id: "R04",
    title: "Sleeping workspace",
    mode: "auto",
    question: "How much does a slept workspace actually give back?",
    defaults: { durationS: 120, stabilizeS: 30 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R03",
    prepare: ({ fixtures }) => {
      const asleep = terminalGrid(4, (i) =>
        terminalTab({
          title: `shell ${i + 1}`,
          cwd: fixtures.repo.dir,
          sid: `bench-${i}`,
          asleep: true,
        }),
      );
      return {
        repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
        layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: asleep }),
        notes: [
          "the same four regions as R03, restored asleep — compare against R03 for what sleep gives back",
          "waking is a UI action: wake latency and fidelity are measured in the assisted checklist",
        ],
      };
    },
    checklist: [
      "Activate each sleeping tab and confirm its scrollback is replayed intact.",
      "Note the delay between the click and an interactive prompt.",
    ],
  },

  {
    id: "R05",
    title: "Agent working",
    mode: "auto",
    question: "What does the app cost while an agent streams output, and what is the agent's own cost?",
    defaults: { durationS: 120, stabilizeS: 20 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R02",
    prepare: ({ fixtures }) => {
      // Launched *inside* a shell, exactly as the app launches a real agent —
      // which is also what puts its cost in the `external` bucket instead of
      // uxnan's (see `shellRunning`).
      const tab = terminalTab({
        title: "fixture agent",
        cwd: fixtures.repo.dir,
        sid: "bench-agent",
        ...shellRunning(["node", path.join(FIXTURES, "agent-fixture.mjs"), "--rate", "20", "--hooks"]),
      });
      return {
        repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
        layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: group([tab]) }),
        notes: [
          "the fixture agent is offline and deterministic; it runs inside a shell, so its cost lands in the `external` bucket and is never folded into uxnan's",
        ],
      };
    },
  },

  {
    id: "R06",
    title: "Large git repository",
    mode: "auto",
    question: "What do the git watcher and the status sweeps cost on a big, dirty checkout?",
    defaults: { durationS: 180, stabilizeS: 30 },
    fixtures: { repo: { name: "large", files: 10_000, dirs: 200, dirty: 250 } },
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-large", name: "large", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 1) }),
      notes: [
        `fixture repo at commit ${fixtures.repo.head} (${fixtures.repo.files} files, 250 modified)`,
        "covers the 3 s active-worktree watcher and the 15 s all-worktree sweep",
      ],
    }),
  },

  {
    id: "R07",
    title: "Integrated browser",
    mode: "assisted",
    question: "Does the browser cost anything while closed, and what does opening it add?",
    defaults: { durationS: 180, stabilizeS: 30 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 }, http: { weight: "light" } },
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 1) }),
      notes: [
        "the automatic half asserts the closed browser owns no process; opening it is the operator's part",
      ],
    }),
    checklist: [
      "Leave the browser closed for the first minute — the run asserts no browser webview exists.",
      "Open the browser panel and navigate to the fixture URL printed above.",
      "Leave it on that page for a minute, then close the panel.",
      "Confirm the browser's webview process disappears when the panel closes.",
    ],
  },

  {
    id: "R08",
    title: "GitHub panel",
    mode: "assisted",
    question: "What do the GitHub polls, cache and open panel cost?",
    defaults: { durationS: 240, stabilizeS: 30 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 1) }),
      notes: [
        "requires a real `gh` login, which is why this scenario is never automated and never runs in CI",
      ],
    }),
    checklist: [
      "Point the project at a repository your `gh` login can read.",
      "Leave the GitHub panel closed for the first minute.",
      "Open Pull Requests, then Actions, then Issues, pausing on each.",
      "Close the panel and let the run settle before it ends.",
    ],
  },

  {
    id: "R09",
    title: "Pet companion",
    mode: "auto",
    question: "Does the pet cost anything when off, and what do the layer and overlay modes cost?",
    defaults: { durationS: 120, stabilizeS: 30 },
    variants: ["off", "layer", "overlay"],
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R02",
    prepare: ({ fixtures, variant = "off" }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 1) }),
      settingsOverrides: {
        pets: {
          enabled: variant !== "off",
          overlay: variant === "overlay",
        },
      },
      notes: [`pet variant: ${variant}`, "compare the three variants: 'off' must cost nothing at all"],
    }),
  },

  {
    id: "R10",
    title: "Soak",
    mode: "auto",
    question: "Does anything grow over two hours — memory, handles, processes?",
    defaults: { durationS: 7200, stabilizeS: 300, intervalMs: 5000 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 2) }),
      notes: [
        "the slope metrics are the point of this scenario; a single-hour run is not a substitute",
      ],
    }),
  },

  {
    id: "R11",
    title: "Restart and restore",
    mode: "auto",
    question: "How long does restoring a saved session take, and does it come back whole?",
    defaults: { durationS: 120, stabilizeS: 30 },
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R03",
    // Two launches against the same profile: the first writes the session, the
    // second is the one measured — a restore is only a restore if something was
    // there to restore.
    warmup: true,
    prepare: ({ fixtures }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 4) }),
      notes: ["measured launch is the second one, against a profile the first launch already used"],
    }),
  },

  {
    id: "R12",
    title: "Resource observer overhead",
    mode: "auto",
    question:
      "Does the resource monitor cost anything while parked, and what does the opt-in orphan sweep add?",
    defaults: { durationS: 180, stabilizeS: 30 },
    variants: ["off", "parked", "sweep"],
    fixtures: { repo: { name: "small", files: 200, dirs: 20 } },
    baseline: "R02",
    prepare: ({ fixtures, variant = "parked" }) => ({
      repos: [project({ id: "bench-small", name: "small", dir: fixtures.repo.dir })],
      layout: layout(fixtures.repo.dir, { [fixtures.repo.dir]: shellsIn(fixtures.repo.dir, 1) }),
      settingsOverrides: {
        resources: {
          enabled: variant !== "off",
          orphanSweep: variant === "sweep",
          orphanSweepSeconds: 15, // the sweep's worst allowed case
        },
      },
      notes: [
        `resource-monitor variant: ${variant}`,
        "'off' and 'parked' must be indistinguishable from R02 — a parked collector holds no timer and no OS handle",
        "'sweep' is the only unattended cost the feature can have; compare it against 'parked' for the sweep's price",
        "the popover's fast cadence needs the panel open and is measured with the assisted checklist below",
      ],
    }),
    checklist: [
      "Open the status bar's backend popover and keep it open for two minutes (the 2 s cadence).",
      "Close it and confirm CPU settles back to the resting figure within one interval.",
    ],
  },
];

export function getScenario(id) {
  const found = SCENARIOS.find((s) => s.id === id.toUpperCase());
  if (!found) {
    throw new Error(`unknown scenario ${id}; known: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  }
  return found;
}

/** Scenario ids that run unattended — what CI and `--all` use. */
export function autoScenarioIds() {
  return SCENARIOS.filter((s) => s.mode === "auto").map((s) => s.id);
}

/** Re-exported so `run.mjs` can build ad-hoc layouts without a second import. */
export { GLOBAL_WORKSPACE, group, layout, split, terminalTab };
