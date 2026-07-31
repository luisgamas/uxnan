# Resource mode

Uxnan can be told, explicitly, how much background work to keep running:
**Settings → Resources → Resource mode** offers three presets — `Efficient`,
`Balanced` (the default) and `Performance` — plus per-capability overrides.
The mode governs **local infrastructure only**: refresh cadences, polling,
orchestration parallelism, the resource monitor's history, the pet's idle
motion and (behind its own flag) workspace auto-sleep. It never changes what
an agent may do, which model it uses, OS process priorities, or any process
Uxnan did not spawn.

Two product rules shape everything below:

- **`Balanced` is the pre-mode behavior, exactly.** Its values are the
  constants the consumers shipped with, and a policy test pins them — the
  default changes nothing.
- **Degradation is never silent.** Every surface whose data `Efficient` makes
  less fresh shows a hint (a quiet leaf) that explains itself and offers a
  one-shot **refresh now** which never touches the selected profile.

## The policy engine

One pure module — [`src/lib/resources/policy.ts`](../src/lib/resources/policy.ts)
— resolves `{ profile, overrides }` into the values every consumer reads
(`ResourceProfile`, `ResourceCapabilities`, `ResolvedResourcePolicy`).
Consumers ask the resolved policy instead of re-reading settings, so no
subsystem replicates conditions. The reactive door is
`src/lib/state/resourceMode.svelte.ts`; a profile switch applies **hot** and
is fully reversible (timers restart, pacing re-reads per decision, nothing is
woken or killed by a switch).

Persistence (`AppSettings.resourceMode`, mirrored by Rust
`ResourceModeSettings` in `model.rs` — an additive field, no schema bump):

```jsonc
{ "profile": "balanced", "overrides": { "orchestrationConcurrency": null }, "autoSleep": false, "schemaVersion": 1 }
```

`null` (or absence) means *inherit from the preset*. Validation is
residue-free: an unknown profile resolves to `balanced`, an unknown key or
wrong-typed/out-of-range value to *inherit* (numbers clamp into the hard
limits), and a `schemaVersion` newer than the build understands resolves to
`balanced` with no overrides — the rollback posture. Hard safety limits
(`LIMITS`) sit **outside** overrides: sweeps can never go below 5 s, GitHub
polling never below 30 s, orchestration concurrency never above 8, monitor
history never outside 60–600 s.

The backend never resolves policy. Its one consumer — the resource monitor's
history budget — receives the already-resolved parameter over the
`resources_set_policy` command (clamped defensively in
`ResourceMonitor::set_history_seconds`).

## What each preset does

| Capability | Efficient | Balanced (default) | Performance |
|---|---|---|---|
| All-worktree git status sweep (`gitSweepIntervalMs`)* | every 45 s | every 15 s | every 10 s |
| Worktree-list reconcile poll | every 10 s | every driver tick (3 s) | every driver tick (3 s) |
| GitHub polling (× the user's interval; 0 stays manual) | ×4, long TTL | ×1 | ×0.5, floored at 30 s |
| Provider-usage refresh (× the user's interval) | ×3 | ×1 | ×1 (quota data gains nothing from more) |
| Orchestration concurrency (`orchestrationConcurrency`)* | 2 | 4 | 4, up to **6 with measured headroom** |
| Resource-monitor history (`resourceHistorySeconds`)* | 180 s | 600 s | 600 s |
| Pet idle one-shots (`petFlavour`)* | off (state changes still animate) | on | on |
| Workspace auto-sleep (`workspaceAutoSleep`*, behind the flag) | suggest after 30 min idle | off | off |
| Browser panel on close | destroy webview | destroy webview | destroy webview (no preloading) |
| Watchers (fs, active-worktree git, browse) | unchanged — they follow what is visible | unchanged | unchanged |

\* = user-overridable per capability (plus `autoSleepIdleMinutes`); everything
else follows the preset. Forced refreshes — window focus, an agent state
change, Uxnan's own git actions, every manual refresh button — always run in
every preset.

**Performance's extra parallelism is evidence-gated.** While a run is active
and the profile allows extending, the orchestration engine holds the resource
monitor's `budget` lease (3 s cadence) and grants the 5th/6th concurrent step
only when the freshest summary (≤ 15 s old) shows Uxnan's own total CPU is
known and **below 50 %**. No sample, a stale one, or an unknown CPU all mean
the base cap — absence of a measurement is never treated as capacity.

## Workspace auto-sleep (feature flag)

Off by default, and double-gated: the profile's capability level (`suggest` /
`auto`, or an override) **and** the explicit switch in Settings → Resources →
Resource mode must both allow it. A one-minute engine
(`src/lib/state/autoSleep.svelte.ts`) evaluates the pure planner
(`src/lib/resources/autoSleep.ts`) and acts **only** through the existing
sleep/wake lifecycle in `terminals.svelte.ts`:

- `suggest` — a toast offers to sleep an idle workspace; the click is the
  user's confirmation (and re-checks the blockers at that moment).
- `auto` — sleeps an idle workspace automatically, **except** one with a
  working agent, which gets a suggestion instead — an agent-active workspace
  is never slept without a human click, same as the manual path.

Guards, all tested under a fake clock: never the active workspace, never the
Global scratch space, never a workspace that is already asleep, holds no live
terminals, or was never mounted this session (it holds no processes); a
workspace with no last-active stamp is never guessed at; suggestions repeat at
most every 30 minutes per workspace. Sleeping preserves scrollback (the
serialized-screen sidecar) and agent sessions resume on wake — but it does
stop that workspace's other processes (a dev server, a watcher), which is why
the automatic level is a second, explicit opt-in. The flag stays until the
behavior has soaked on all three platforms; turning it off kills the whole
feature whatever the profile says.

## Background-work inventory

Every recurring activity, who owns it, and how the mode governs it. Cost
evidence points at the benchmark scenarios
([`resource-benchmarks.md`](resource-benchmarks.md)) where one measures it.

| Activity | Owner | Cadence (Balanced) | Trigger / park | Cost evidence | Governed by |
|---|---|---|---|---|---|
| Active-worktree git status watcher | `src-tauri/src/git.rs` (Tokio) | 3 s, focus-paused | follows `gitSetWatch`; parks with no watched path | R01/R06 | not governed — it feeds the visible Changes panel |
| All-worktree status sweep | `projects.sweepStatuses` | ≥ 15 s (3 s driver tick in `LeftSidebar`) | skipped hidden; forced by focus / agent activity / own git actions | R06 | `gitSweepIntervalMs` |
| Worktree-list reconcile | `projects.refreshWorktrees` | every 3 s tick | forced by `refreshNow` | R06 | `worktreeReconcileIntervalMs` |
| GitHub context/rate-limit/badge poll | `github.startPolling` | user setting (45 s), hidden-paused; ≤ 2 badge reads per tick | armed while the app runs, `0` = manual | R08 | `githubPollFactor` (+ 30 s floor) |
| Provider-usage poll | `usage.reschedule` | user setting (5 min), armed lazily | `0` = manual; surfaces call `ensureFresh` on open | — | `usageRefreshFactor` |
| Orchestration engine tick | `orchestrationRun` | 700 ms **while a run is active**, parks idle | run start/stop | — | concurrency cap (2/4/4–6), not the tick |
| Resource-monitor sampler | `src-tauri/src/resources.rs` | parked; popover 2 s / budget 3 s / opt-in orphan sweep 15–30 s | leases (TTL 90 s) | R12 | `resourceHistorySeconds`; the budget lease is the headroom feed |
| Auto-sleep engine | `state/autoSleep.svelte.ts` | 60 s (one function call when gated off) | armed at boot, double-gated | R04 (sleeping's effect) | `workspaceAutoSleep` + flag + `autoSleepIdleMinutes` |
| Pet renderer | `PetSprite`/`PetLayer`/`PetWindow` | frame boundaries; parks hidden; still under reduced motion | enabled + a sheet loaded | R09 | `petFlavour` (idle one-shots) |
| Agent detection (process layer) | `agentMonitor` (1 s tick) + hook server (event-driven) | 1 s / on-event | armed at boot | R05 | **not governed (gap)** — it feeds attention states; pacing it risks stale "needs you" |
| Filesystem watcher (active worktree) | `fswatch.rs` via `fsSetWatch` | event-driven | follows the active worktree only | — | not governed — necessary |
| Folder-browser watcher | `browse_set_watch` | event-driven while a picker is open | parks on close | — | not governed — UI-scoped |
| Updater check / download | `updater.start` | once per launch + on channel change; download opt-in | Settings → Updates | — | not governed |
| Keep-awake | `power.rs` | none (a held OS request) | opt-in && agent working; 2 h cap | — | not governed — opt-in already |
| Terminal PTYs / xterm | user-owned | — | workspace sleep/wake lifecycle | R02–R04 | auto-sleep (above); manual sleep unchanged |
| Browser panel webview | `browser.rs` | — | destroyed on close in every preset | R07 | already minimal; no preloading in v1 |
| Broadcast console pacing | `orchestration` store | while the console is open | open/close | — | not governed — interactive |

Known gaps (tracked in [`FOR-DEV.md`](../FOR-DEV.md)): the 1 s agent-detection
tick and the OSC title layer are not policy-governed in v1, and the Rust-side
`ResourceMonitor::subscribe_events` broadcast still has no backend consumer.

## Efficiency gates (pending measurement)

The per-preset matrix is wired but **not yet measured**: the harness refuses
to run beside a live Uxnan instance (the WebView2 user-data-folder sharing
documented in [`resource-benchmarks.md`](resource-benchmarks.md)), so the
capture must happen with the app closed. What will be measured, per preset
(`--resource-profile efficient|balanced|performance`):

| Scenario | Question the presets must answer |
|---|---|
| R01 (idle) | Efficient must not regress idle; the deltas quantify the sweep/poll relaxations |
| R04 (sleeping workspace) | the state auto-sleep produces — its saving is auto-sleep's value |
| R06 (large repo) | the git sweep pacing is most visible here |
| R07 (browser), R08 (GitHub) | operator-assisted; R08 exercises the poll factors |
| R09 (pet) | flavour off vs on under Efficient |
| R10 (2 h soak) | the shortened monitor history + no leak under any preset |

Acceptance (from the plan of record): Efficient must improve at least one
material metric without pushing the core flow outside its latency budget, and
`Balanced` must match the existing baseline. No number is published until the
runs exist; budgets stay untouched.

## Testing

- **L1** — `src/lib/resources/policy.test.ts` (presets, the Balanced
  invariant, normalization/clamping, headroom, effective intervals) and
  `src/lib/resources/autoSleep.test.ts` (every guard under a fake clock).
- **L2** — `src/lib/components/ResourceModeSection.svelte.test.ts`
  (accessible radio group, EN/ES, persist + effects view, keyboard selection,
  clamped overrides + "use preset" + reset, the auto-sleep flag gating, corrupt
  settings rendering as Balanced).
- **L3** — `src-tauri/src/resources.rs` (history clamp/trim/summary) and
  `model.rs` (defaults, back-compat, camelCase round trip).
- **Not covered (honest):** no E2E journey switches the preset against the
  real binary (the suite cannot run beside the live instance this was built
  next to), and the auto-sleep flag needs a multi-platform soak before it can
  ever be retired. Both in `tests/quality-matrix.json` (`resource-mode`) and
  [`FOR-DEV.md`](../FOR-DEV.md).

See also [`resource-monitoring.md`](resource-monitoring.md) — the monitor the
mode's history budget and headroom check are built on.
