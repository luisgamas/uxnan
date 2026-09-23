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
{ "profile": "balanced", "overrides": { "orchestrationConcurrency": null }, "autoSleep": false, "schemaVersion": 1,
  "resolvedBudget": { "concurrency": 4, "minFreeMemoryMb": 1024 } }
```

`null` (or absence) means *inherit from the preset*. Validation is
residue-free: an unknown profile resolves to `balanced`, an unknown key or
wrong-typed/out-of-range value to *inherit* (numbers clamp into the hard
limits), and a `schemaVersion` newer than the build understands resolves to
`balanced` with no overrides — the rollback posture. Hard safety limits
(`LIMITS`) sit **outside** overrides: sweeps can never go below 5 s, GitHub
polling never below 30 s, orchestration concurrency never above 8, monitor
history never outside 60–600 s.

The backend never resolves policy. Its consumers receive the **already-resolved
parameter**: the resource monitor's history budget over the
`resources_set_policy` command (clamped defensively in
`ResourceMonitor::set_history_seconds`), and the **global agent budget**
through `resolvedBudget` — the one derived field in the document above.

That field is a **mirror, never an input**: the store writes it on every policy
change and reconciles it at startup (`resourceMode.syncRunnerBudget()`), and
nothing reads it back as configuration. It exists because the budget is
enforced in Rust for **every process at once** (`budget.rs`) — including a
headless automations runner that runs with the app closed and has no window to
ask — and re-deriving the preset table there would be a second copy free to
disagree with this one. What is read is clamped to the same bounds (8 agents,
8 GiB), and an absent mirror means the pre-budget behavior: 4 agents, no
memory condition. The **extended** Performance ceiling is not mirrored: it
only applies against measured headroom, which a process with no monitor cannot
observe.

### The global agent budget

Two conditions, one gate, one place ([`budget.rs`](../src-tauri/src/budget.rs)):

- **A slot.** At most `concurrency` agent subprocesses at a time **across every
  process** — the app's orchestration steps and every automation runner beside
  it. Before this the cap was per process, so three automations at four steps
  each put twelve agents on a machine that was promised four.
- **Memory.** At least `minFreeMemoryMb` free when a step starts, so a run does
  not push the machine into swap for a step it would then run slowly.

**Where the memory numbers come from.** They are measured, not guessed:
`node scripts/resources/agent-footprint.mjs` runs each installed CLI through
the real headless path with a one-word prompt and reads the peak its process
tree held — the app's own sampler, the same number that lands in a run record.
What matters for this gate is what a **newly started** agent needs, not what a
long session grows to, which is exactly what that measurement is.

| CLI | peak of the tree (3 runs, macOS arm64, 18 GB) |
|---|---|
| OpenCode | **562 MB** (mean 559) |
| Claude Code | 255 MB (mean 245) |
| Codex | 195 MB (mean 184) |
| Antigravity | 133 MB (mean 88) |

The worst case is what a preset has to make room for, plus the headroom its
posture implies: Efficient yields the machine soonest (**1024 MB**, ~1.8×),
Balanced sits above the worst case (**768 MB**, ~1.4×), Performance asks for
about what one agent takes (**512 MB**). Re-run the script to re-derive them —
it prints the same table. Pi could not be measured (its provider refused the
request for want of credits, which is not a memory result), and these are
**macOS** numbers: Windows and Linux need their own pass with the platform
matrix ([`FOR-DEV.md`](../FOR-DEV.md) → *Resource mode*).

Beside the gate, a run is **watched**: every ten seconds its whole process tree
is measured, and the peak is recorded with the run (`peakMemoryMb`) — what an
execution nobody saw actually cost. With `maxAgentMemoryMb` set, a tree past
that ceiling is stopped and the run says so.

That ceiling is **advisory, and the word is exact**: nothing refuses an
allocation, the run is measured and then ended. A real limit is the operating
system's to impose (Job Objects on Windows, cgroups on Linux; macOS has no
equivalent) and this project does not claim one until enforcement *and*
descendant containment are proven on each platform — so the default is `0`,
measure and never stop, and the enforcement half is tracked in
[`FOR-DEV.md`](../FOR-DEV.md) → *Resource mode*, with the platform matrix.

Slots live in one ledger under the app's data directory, guarded by a lock only
one process can hold. A slot belongs to the process that took it, and is given
back when that process releases it **or stops existing**: the owner's pid and
start time are recorded, so a crashed or killed runner's slot is reclaimed by
the next caller that looks (and a recycled pid cannot inherit it). There are no
heartbeats to keep — liveness is the truth, with a six-hour backstop for a
process that is alive but wedged. If the ledger itself cannot be read or
written, work proceeds unbudgeted rather than stopping: bookkeeping must never
be what blocks the machine.

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
| GitHub launch fill (one-shot) | `github.prime` | once per arm/sign-in, batches of 2, ≤ 24 reads | skipped when the interval is `0` (manual) | R08 | `githubPollFactor` scales the cap (Efficient ≈ 6) |
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
| Browser page webviews | `browser/host.rs` | — | one per workspace with its panel open; at most 3 alive (`MAX_LIVE_PAGES`), the oldest released; destroyed on close and when its workspace sleeps, in every preset | R07 | already minimal; no preloading in v1 |
| Broadcast console pacing | `orchestration` store | while the console is open | open/close | — | not governed — interactive |

Known gaps (tracked in [`FOR-DEV.md`](../FOR-DEV.md)): the 1 s agent-detection
tick and the OSC title layer are not policy-governed in v1, and the Rust-side
`ResourceMonitor::subscribe_events` broadcast still has no backend consumer.

## Efficiency matrix (measured 2026-08-01)

Captured with the app closed (the harness refuses to run beside a live Uxnan
instance — the WebView2 user-data-folder sharing documented in
[`resource-benchmarks.md`](resource-benchmarks.md)); release build, 5
repetitions per cell via `npm run bench -- --resource-profile <preset>
--scenario <id>`, medians of own private memory and own CPU P95:

| Scenario | Efficient | Balanced | Performance |
|---|---|---|---|
| R01 (idle, default project) | 240 MB · **7.7 %** | 239 MB · 12.4 % | 240 MB · 9.3 % |
| R04 (sleeping workspace) | 229 MB · **4.8 %** | 227 MB · 7.9 % | 227 MB · 6.0 % |
| R06 (large git repo) | 247 MB · 10.2 % | 247 MB · 10.8 % | 245 MB · 15.8 % |
| R09 (pet companion) | 269 MB · **12.5 %** | 270 MB · 15.6 % | 269 MB · 12.4 % |

**Acceptance verdict — met.** Efficient improves a material metric without
touching the core flow: idle CPU P95 drops from 12.4 % to 7.7 % and a sleeping
workspace from 7.9 % to 4.8 % (the relaxed sweeps/polls doing exactly what the
preset promises), at identical memory. Balanced's figures sit on the approved
baseline (its constants are the pre-mode ones, pinned by test). Performance
buys fresher git state at visibly higher CPU on the git-heavy scenario
(15.8 % on R06) — the documented trade. The presets don't move memory:
governing cadence was never a memory claim.

Also captured that session: **R12** (the monitor's own overhead — parked sits
within ~1 MB of off, see the budget file's comment) and **R10** (2 h soak:
own-RSS slope **1.62 MB/h**, zero orphans, CPU P95 6.6 %). Still
operator-assisted: R07 (browser) and R08 (GitHub) — their automation over the
E2E driver is a FOR-DEV follow-up.

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
