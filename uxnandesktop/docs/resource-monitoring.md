# Resource monitoring

Uxnan can tell you — locally, cheaply and honestly — what **it** costs: the
desktop process, every terminal it spawned, and the agents running inside them,
in CPU, memory and (where the OS reports it) I/O. It is **not** telemetry and
**not** a system task manager: only processes Uxnan launched or can tie to
itself by evidence are ever classified, nothing leaves the machine, and every
figure carries a stated confidence instead of pretending precision.

Two surfaces, both opt-out via Settings → **Resources**:

- the **status bar's backend popover** gains a *Resources* section — the Uxnan
  total (instant CPU/memory, peak, memory trend), one row per workspace and per
  agent, and a warning block for processes that outlived their closed terminal;
- **Settings → Resources** (Application group) holds the switches, explains the
  confidence labels, and offers the sanitized diagnostics export.

## Cost model: nothing runs unless something consumes it

The collector (`src-tauri/src/resources.rs`) is **demand-driven**. With no
consumer it is fully *parked*: no timer, no process-table walks, and no
retained OS handle (the `sysinfo` state is dropped on park). The cadences:

| State | Interval | Who causes it |
|---|---|---|
| Parked | — (nothing runs) | the default |
| Popover open | 2 s | opening the backend popover takes a sampling lease |
| Budget consumer | 3 s | reserved for a future limits/orchestration engine |
| Orphan sweep | 15–30 s (default 20) | the **opt-in** background check |

Leases are renewed by the frontend while its surface is open and **expire on
their own** (90 s TTL), so a reloaded webview that never unsubscribed cannot pin
the fast cadence. The orphan sweep is the only mode that samples with no UI
open, and it is off by default — which is why the default configuration costs
nothing at rest. The benchmark harness measures exactly this promise
(scenario **R12**, [`resource-benchmarks.md`](resource-benchmarks.md)).

## Attribution: evidence, with a confidence label

Ownership is resolved from **pid + start time + parent chain**, plus the
explicit link each PTY registers when it spawns (`pty_create` passes the tab's
workspace; the agent detector feeds the terminal's agent command). Command
lines, environment, sockets and file contents are **never read** here.

- **exact** — pid *and* start time verified against a terminal Uxnan spawned
  (±2 s tolerance). The shell processes themselves, and re-identified orphans.
- **inferred** (`~` in the UI) — parent-chain evidence below a verified
  process: a shell's descendants, the desktop tree's webview helpers, an
  agent's subtree.
- **unknown** (`?`) — identity could not be verified: typically a **recycled
  pid** (same id, different start time). The link is voided, nothing is
  claimed, and the row renders dashes — absent data is never shown as zero.

Groups: the desktop tree (minus terminal subtrees), one group per **workspace**
(its shells and their non-agent descendants), one per **agent** command (that
subtree, with its workspace attached). A group that vanishes is reported as
**ended** with its last-known figures for ~90 s rather than silently dropped.

**Orphans:** closing a terminal snapshots its members (pid + start time). On
later samples, any member still alive — re-verified by start time, so a
recycled pid never counts — is reported as a *surviving process* until it ends.

## What the numbers are

Per group: instant CPU (normalized to the whole machine), a ~60 s short
average, the buffered peak, resident + virtual memory, I/O rates, and a memory
**trend** over the buffer. History lives in an in-memory circular buffer capped
at **10 minutes** of aggregated frames — never per-process, never persisted.
A first sighting (or a gap after a parked window) reports CPU/I-O as unknown
rather than a made-up number; a partially-unknown group's rate is unknown too
(a partial sum shown as a fact would under-report).

## Privacy and the diagnostics export

Settings → Resources → **Export diagnostics** writes a JSON snapshot of the
current summary, and it is consent-first: the dialog lists **every field** the
file will contain before anything is written, and you pick the destination in
the OS save dialog. Sanitization is structural, not cosmetic:

- workspace paths and terminal ids become opaque labels (`workspace-1`,
  `terminal-2`);
- agent names survive only when they match the known catalog (an allow-list —
  an unknown name exports as `agent-N`, so drift degrades safely);
- no command lines, environment, cwd, home paths or file names exist anywhere
  in the pipeline to leak; pids are included (it is a process diagnostic);
- a schema allow-list test fails the build if the export ever gains an
  un-reviewed field, and a golden test feeds hostile values (paths, tokens,
  env spellings) and asserts none survive serialization.

There is no upload path. The document is versioned (`schemaVersion`).

## Settings reference (`AppSettings.resources`)

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch for the surfaces + data. A parked collector is free, which is why on-by-default costs nothing. |
| `orphanSweep` | `false` | Opt-in background sweep so orphans are noticed with no UI open. |
| `orphanSweepSeconds` | `20` | Sweep interval; clamped to 15–30 by the backend. |

## Platform support

Implemented portably over `sysinfo`. **Validated on Windows only** so far: on
macOS/Linux the same code runs, `capabilities.validated` is `false`, and the UI
adds a "best effort" note instead of claiming verified figures. Per-process
I/O counters are unavailable on the BSDs (`capabilities.io = false` → dashes).
A start time the OS reports as `0` is treated as absent, degrading that link's
confidence to *inferred* instead of inventing identity.

## For future consumers

Every ingested frame's summary is also broadcast on an internal Rust channel
(`ResourceMonitor::subscribe_events`), and a `budget` lease kind exists in the
contract — that is the hook for resource-limit / orchestration-routing features
to consume the same data without adding a second sampler.

## Testing

- **L1** — `src/lib/resources/*.test.ts` (formatting honesty, spike/ended/
  unknown display rules).
- **L2** — `ResourceSummary.svelte.test.ts` / `ResourceSettings.svelte.test.ts`
  (loading/empty/unsupported states, confidence marks, orphan warning, the
  whole export consent flow).
- **L3** — `src-tauri/src/resources.rs` unit tests (cadence, attribution,
  deltas, buffer bounds, the export golden tests, the parked loop under a
  paused clock) and `src-tauri/tests/resources_processes.rs` against real
  spawned process trees.
- **Overhead** — benchmark scenario **R12** (`npm run bench -- --scenario R12
  --variant sweep`); its Windows budget entry is provisional until a baseline
  is captured with the app closed.

Gaps are tracked honestly in `tests/quality-matrix.json`
(`resource-observability`) and [`FOR-DEV.md`](../FOR-DEV.md).
