# Desktop — resource benchmarks

![Harness](https://img.shields.io/badge/harness-node_%2B_per--OS_collectors-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Gate](https://img.shields.io/badge/gate-warn_only-f59e0b?style=for-the-badge)
![Baseline](https://img.shields.io/badge/baseline-windows_only-2563eb?style=for-the-badge)

uxnan claims to stay small enough to leave the machine to the agents. This is how
that claim is measured, repeated and defended — a scenario matrix, a versioned
result schema, per-platform budgets and a comparator, all runnable from a clean
checkout with no credentials and no network.

**A number without its conditions is not a measurement.** Every result records the
OS, webview version, CPU, core count, power plan, build profile and commit, and
the report prints them before anything else.

---

## Quick start

```bash
cd uxnandesktop

# 1. build what you are going to measure (release, frontend embedded — see below)
npm run bench:build

# 2. close every other uxnan window (the harness refuses to run otherwise)

# 3. measure
npm run bench -- --scenario R01 --repeats 5

# 4. read it
npm run bench:report
```

Results land in `.resource-results/` (git-ignored). Nothing is written anywhere
else: each repetition gets a disposable app profile inside that directory and the
app is pointed at it with `UXNAN_DATA_DIR`, so your real profile is never read or
modified.

| Command | What it does |
|---|---|
| `npm run bench:build` | build a measurable release binary (`tauri build --no-bundle`) |
| `npm run bench -- --scenario <id>` | run one scenario |
| `npm run bench -- --all` | every unattended scenario |
| `npm run bench:report` | render `report.md` from the aggregates |
| `npm run bench:compare` | compare the results against an approved baseline |

`npm run bench -- --help` lists every flag.

---

## Preconditions

Each of these is *enforced*, and each exists because breaking it produces a
believable number rather than an error. That is the failure mode this harness is
built to refuse.

**A release binary with its frontend embedded.** Debug numbers are not comparable
with anything, and the schema refuses a document that does not say which profile
it measured. More subtly: **`cargo build --release` on its own is not enough.** It
does not enable Tauri's `custom-protocol` feature, so the build stays in *dev*
mode and the window loads `http://localhost:1420` — which nothing is serving. The
app then opens a real window, starts its Rust backend, spawns real WebView2
processes, and shows a connection-refused page. Every signal the harness would
normally trust is present; only the product is missing. Measured that way, a
one-terminal scenario reports ~27 MB and no shell at all. So the harness scans the
binary for embedded frontend assets and refuses to start without them — use
`npm run bench:build`.

**No other uxnan may be running** — and that includes one your own interrupted
run left behind: a benchmark stopped mid-scenario never gets to close its app, and
the next run will refuse to start until that window is closed. The refusal names
the PID. This is enforced, not advisory, and the reason
is specific: on Windows, WebView2 keeps **one browser process per user-data
folder**, and uxnan's folder is `%LOCALAPPDATA%\dev.luisgamas.uxnandesktop\EBWebView`.
A second instance attaches to the first instance's browser process, so its
renderers are spawned *outside* the process tree being sampled. The run then
reports the Rust process alone — around 27 MB — and silently omits the entire
webview. That is a plausible, excellent-looking, completely wrong number, which is
worse than an error, so the harness refuses to start and any run that somehow
still shows a single `own` process is marked invalid.

**The seeded session has to come back.** Each scenario knows how many live
terminals its profile seeds, and the run fails if that many managed processes
never appear. That catches a broken restore path on its own, and it is the second
net under everything above: a UI that never booted cannot spawn a shell.

**A quiet machine.** Not enforceable, but a build or a video call running
alongside shows up in the CPU percentiles. The report prints the power plan for
the same reason.

---

## What is measured

### The three buckets

The single most misleading thing a desktop benchmark can publish is "the app used
N MB" when N includes a shell and whatever agent CLI happened to be running. So
every process is placed in exactly one bucket, and **the buckets are never
summed**:

| Bucket | What it holds | Why it is separate |
|---|---|---|
| **own** | the app process + its webview/crash-handler helpers | uxnan's own footprint — the number that must stay small |
| **managed** | own + PTY shells, ConPTY hosts, `git`/`gh`, sidecars | what uxnan costs you in practice; uxnan is responsible for these existing |
| **external** | the agent CLI or program running inside a shell, and its children | someone else's cost, reported for context, never folded in |

Attribution is **structural**: the harness spawns the app itself, so it knows the
root PID, and walks parent/child edges from there. A process is never claimed
because of its name — a `node.exe` that was already running cannot be counted, and
a renamed one cannot escape. Names are consulted only to decide *which* bucket a
descendant belongs to (is it a shell? a webview helper?), mirroring the shell list
`procscan.rs` descends through, and once — in `preflight.mjs` — to answer "is
another instance already running".

The boundary between `managed` and `external` is the shell: uxnan spawns the
shell, the user runs the program. Nested shells stay managed, because agent CLIs
are routinely launched through a `.cmd`/`.ps1` shim.

### Metrics

Metric names encode their bucket, statistic and unit, so `ownRssP50Mb` needs no
legend. The ones a budget can gate:

| Metric | Meaning |
|---|---|
| `ownRssP50Mb` / `ownRssP95Mb` | working-set sum of the app and its runtime helpers |
| `managedRssP50Mb` / `managedRssP95Mb` | the same, including shells and sidecars |
| `externalRssP50Mb` | what the user's own program cost (context only) |
| `ownPrivateP50Mb` / `ownPrivateP95Mb` | private committed bytes of the app and its helpers |
| `managedPrivateP50Mb` / `externalPrivateP50Mb` | the same, per bucket |
| `cpuP50` / `cpuP95` | managed CPU, **percent of one core** — divide by the core count for percent-of-machine |
| `ownCpuP95` | the app alone |
| `ownProcsP50` / `managedProcsP50` | process counts |
| `threadsP95` / `handlesP95` | thread and handle counts (Windows; `null` elsewhere) |
| `ownRssSlopeMbPerHour` | memory trend — the soak scenario's whole point |
| `launchToWindowMs` | launch until the app owns a visible window (Windows) |
| `launchToBackendMs` | launch until the hook server is listening |
| `launchToShellMs` | launch until a restored terminal's shell is live |
| `closeMs` | how long a graceful close took |
| `orphanCount` | managed processes still alive after a bounded wait |

**`Rss` and `Private` answer different questions, and neither alone is honest
about a webview.** A WebView2/WebKit tree is many processes sharing a large read-
only code region, and a *working set* counts those shared pages once per process
— so `ownRssP50Mb` materially over-states what the machine is actually carrying.
`ownPrivateP50Mb` sums private committed bytes: nothing double-counted, and the
defensible answer to "how much memory does this cost me". Both are published,
because `Rss` remains the better like-for-like signal between two runs on the same
platform, and hiding the gap between them would be the sort of quiet accounting
choice this harness exists to prevent. On Unix there is no cheap private figure,
so those metrics are `null` there.

**Slopes need a long window.** A memory trend fitted over a 45-second run is
dominated by warm-up and extrapolates to thousands of MB/h — a fabricated leak.
Slope metrics are therefore `null` unless the stable window is at least ten
minutes, which in practice means the soak scenario.

**`null` always means "not measurable on this platform" — never zero.** That is
what lets a Linux run sit next to a Windows one without inventing handle counts
that do not exist there.

A resting statistic ignores the **stabilisation window** (`stabilizeS`): a
just-launched app is still paging in its webview, and folding that into a "cost at
rest" figure publishes a number no user experiences. Those early samples stay in
the document — they *are* the launch measurement.

---

## The first measured baseline

Windows 11 Pro 10.0.26200 (x64) · WebView2 150.0.4078.105 · i7-13620H, 16 logical
cores · 16 GB · release build of `54d935e8` · five repetitions per scenario ·
medians. Full documents in
[`scripts/resources/baselines/windows/`](../scripts/resources/baselines/windows/).

| Scenario | own private | own working set | managed private | CPU P95 | procs (own/managed) |
|---|---:|---:|---:|---:|---:|
| R00 cold | 236 MB | 479 MB | 236 MB | 1.6 % | 7 / 7 |
| R01 idle, one project | 239 MB | 479 MB | 296 MB | 10.9 % | 7 / 9 |
| R02 one terminal | 252 MB | 506 MB | 257 MB | 6.4 % | 7 / 9 |
| R03 four terminals | 274 MB | 574 MB | 293 MB | 7.2 % | 7 / 15 |
| R04 workspace asleep | 226 MB | 470 MB | 226 MB | 4.6 % | 7 / 7 |
| R05 agent working | 271 MB | 526 MB | 276 MB | 35.1 % | 7 / 9 |
| R06 10 000-file repo | 246 MB | 492 MB | 251 MB | 12.8 % | 7 / 9 |
| R09 pet off | 242 MB | 495 MB | 247 MB | 11.1 % | 7 / 9 |
| R09 pet as a layer | 270 MB | 526 MB | 275 MB | 10.9 % | 7 / 9 |
| R09 pet as an overlay window | 330 MB | 637 MB | 335 MB | 24.2 % | 8 / 10 |
| R11 restart + restore | 266 MB | 568 MB | 289 MB | 8.7 % | 7 / 15 |

What it says, beyond the raw figures:

- **Sleep is real.** R03 → R04 gives back **48 MB and 8 processes**.
- **Restore comes back whole.** R11 lands on the same 15 managed processes as R03
  and within 3 % of its memory — the session is genuinely restored, not
  approximated.
- **A terminal is cheap; a webview is not.** Four terminals add 22 MB over one;
  the seven-process webview is most of the footprint in every scenario.
- **The pet is free when off** (R09-off ≈ R02) and **costs 88 MB and doubles CPU
  as a desktop overlay** — a second webview window, visible as the 8th `own`
  process. As a layer inside the main window it costs 28 MB.
- **The agent's cost is separated.** R05's fixture agent shows up in `external`
  (48 MB working set / 27 MB private) and never in uxnan's own figure; the 35 %
  CPU is the app rendering a terminal streaming 20 lines a second.

These numbers replaced the previously published "30–100 MB", which described the
Rust process alone (~40 MB) rather than what the app costs a machine. The claim
now reads **~250 MB** everywhere it appears — the two root READMEs, this
component's README, and `web/src/lib/site.ts` (`RAM_FOOTPRINT` / `RAM_CORE`).
Re-measure before changing it, and keep the platform and build beside it.

R07, R08 and R10 have no baseline: two need an operator, and the soak has never
been run. They report `unknown`, which is the honest distinction between "not
judged" and "passed".

---

## Scenarios

| ID | Scenario | Mode | Question |
|---|---|---|---|
| R00 | Cold process | auto | launch time and cost before anything is opened |
| R01 | Idle, default configuration | auto | cost at rest with one small project |
| R02 | One terminal | auto | what a single live shell adds |
| R03 | Four terminals in splits | auto | cost per additional terminal |
| R04 | Sleeping workspace | auto | what sleep actually gives back |
| R05 | Agent working | auto | cost while an agent streams, separated from the agent's own |
| R06 | Large git repository | auto | watcher and status-sweep cost on 10 000 files |
| R07 | Integrated browser | assisted | cost while closed, and what opening it adds |
| R08 | GitHub panel | assisted | polling, cache and open-panel cost |
| R09 | Pet companion | auto | off / layer / overlay — "off" must cost nothing |
| R10 | Soak (2 h) | auto | does anything grow: memory, handles, processes |
| R11 | Restart and restore | auto | restore time and fidelity |
| R12 | Resource observer overhead | auto | off / parked / sweep — parked must equal R02; the sweep is the only unattended cost |

**auto** scenarios prepare a profile and let the app restore itself into the state
under test — no UI driving, fully unattended, and what `--all` and CI run.

**assisted** scenarios need a person at the keyboard (or an account the benchmark
must never hold, in R08's case) and only run with `--assisted`. The harness still
samples and records; the report labels the result as operator-driven. They become
`auto` when the E2E driver lands, and the metric names will not change.

R04's *asleep* cost is automatic; **wake latency and fidelity are still on the
operator checklist**, because waking is a click.

R12 measures the in-app resource monitor (`src-tauri/src/resources.rs`,
`docs/resource-monitoring.md`) against its own promise: `off` and `parked` must
be indistinguishable from R02 (a parked collector holds no timer and no OS
handle), and `sweep` — the opt-in background orphan check at its fastest allowed
15 s — is the one unattended cost the feature can have. The popover's 2 s
cadence needs the panel open, so it rides the operator checklist. **Its Windows
budget entry is provisional** (copied from R02, which *is* the claim under
test) until a real baseline is captured — the harness refuses to run beside a
live uxnan instance, so that capture has to happen with the app closed.

### How a scenario reaches its state

By seeding the app's own persisted state. `lib/profile.mjs` writes a `state.json`
matching `AppData` (`src-tauri/src/model.rs`) and `SavedTerminalLayout`
(`src/lib/types.ts`), the app restores it at boot, and only the active workspace
spawns shells — so "four terminals" is four *regions*, not four tabs.

Every seeded profile also turns off what a resting measurement must not include:
the updater's auto-check, provider usage polling, the pet, notifications, and
hook auto-install (which would write into `~/.claude` and friends — outside the
scenario's own directory, which the harness never does).

### Fixtures

All local, all offline, all deterministic:

- **`fixtures/make-repo.mjs`** — a generated git repository. Author, committer and
  both timestamps are pinned and content comes from a seeded PRNG, so the commit
  hash is a function of the arguments; `--print-hash` prints it. Generation beats
  committing 10 000 files, and a drifted generator is caught by the hash.
- **`fixtures/agent-fixture.mjs`** — a stand-in agent. A real CLI would make the
  run depend on a model, a network and an account, and CI must never hold
  credentials. What the benchmark needs is the *shape* of the load: output at a
  fixed rate, a wait, more output, done — optionally reporting each transition to
  the hook server exactly as a real reporter does.
- **`fixtures/http-server.mjs`** — a fixed loopback page for the browser scenario.

---

## Budgets, baselines and the gate

Two independent questions, deliberately kept apart:

**Is it within budget?** An absolute per-scenario ceiling in
`scripts/resources/budgets/<os>.json`. Absolute limits cannot be shared across
platforms — a WebView2 tree and a WebKitGTK one differ by more than any regression
worth gating on — so each OS carries its own file, and a scenario with no entry is
reported `unknown`, not `pass`.

**Did it get worse?** `compare.mjs` against an approved baseline. It fires only
when a metric moves by **both** a relative and an absolute margin (default: more
than 15 % *and* more than 10 MB / 2 pp CPU / 200 handles). A 20 % jump on a 4 MB
number is a `warn`, not a `fail` — a gate that fires on noise gets switched off,
and then nothing is measured at all.

### The warn phase

Every budget ships with `"mode": "warn"`, which downgrades a `fail` to a `warn` so
CI reports without blocking. That is the deliberate first phase:

1. collect data without failing anything;
2. set a per-scenario ceiling with an explicit margin over the measured median;
3. leave it in warn mode for two weeks of real runs;
4. flip to `"mode": "enforce"` — a one-line, reviewable change;
5. from then on, raising a limit needs the run that justifies it in the diff.

### Promoting a baseline

1. Run the scenarios five times on a quiet machine with a release build.
2. Read `report.md` and sanity-check the conditions block.
3. Copy the aggregates into `scripts/resources/baselines/<os>/`.
4. Commit them **on their own**, separately from any code change, so review can
   tell measurements from behaviour.
5. Update the budget file in the same series if a limit moves, citing the run.

Raw results, samples, generated fixtures and disposable profiles stay in
`.resource-results/` and are never committed. Only approved aggregates, budgets,
fixtures and the schema are.

---

## Privacy

A result is meant to be attachable to a PR, so it must say nothing about the
person who ran it.

- The collectors never read a command line, an environment block or a window
  title, so a sample cannot carry a prompt, a token or a file path.
- Every document is scrubbed before it is written: user name, host name and
  temp/home directories are replaced, and paths under them collapse to a stable
  tag — `<home>/<path:1a2b3c4d5e6f>` — so the same folder stays recognisable
  across runs without the project's name being readable.
- The write is *refused* if anything personal survives the scrub.
- The machine is identified by a hash of hostname + user, so two runs on the same
  box compare without naming it.
- Nothing is transmitted anywhere. There is no telemetry.

---

## Adding a scenario when you add a feature

Anything that spawns a process, opens a webview, starts a watcher, polls, caches
or holds a socket changes the answer this document gives, so it comes with a
scenario change in the same series:

1. Add or extend the entry in `lib/scenarios.mjs` — a question, a deterministic
   preparation, a measurement window.
2. Prefer `auto`: reach the state by seeding the profile rather than by asking an
   operator to click.
3. If the feature is opt-in, add a variant proving it costs **nothing** while off
   (R09 is the model).
4. Run it, and put the measured numbers in the PR body.
5. Add a budget entry once a baseline exists for the platform.

---

## Platform support

| Platform | Collector | Status |
|---|---|---|
| Windows | `collectors/windows.ps1` (Windows PowerShell 5.1, CIM) | verified on real hardware |
| macOS | `collectors/unix.sh` (`ps`) | implemented, **never run on real hardware** |
| Linux | `collectors/unix.sh` (`ps`) | implemented, **never run on real hardware** |

Semantic differences that matter, surfaced rather than hidden:

- Windows reports a **working set**; `ps` reports **RSS**, which counts shared
  pages in every process that maps them, so a multi-process tree reads higher on
  Unix. The two are not directly comparable, which is exactly why budgets are
  per-platform.
- There is no cheap per-process private-memory or handle figure on Unix, and no
  window-handle probe outside Windows: those metrics are `null`.
- macOS runs the WebKit content process outside the app's process tree entirely,
  so the `own` bucket means something different there and needs its own measured
  ceilings.

Neither Unix collector has been run on real hardware. Until it has, do not publish
numbers for those platforms — the harness will happily produce them, and they will
be wrong in ways nobody has looked for yet.

---

## CI

`.github/workflows/resource-benchmarks.yml` runs on demand (`workflow_dispatch`)
and nightly. It builds a release binary on a Windows runner, runs the unattended
scenarios with short windows, and uploads the results and report as artifacts. It
never fails the build: a GitHub runner is a noisy, shared VM, so its numbers are a
trend signal, not a gate. The gate that matters runs on the reference hardware.

R08 never runs in CI at all — it needs a real `gh` login, and CI is never handed
one.

---

## Where things live

```
uxnandesktop/scripts/resources/
├── run.mjs                 # run scenarios → result documents
├── report.mjs              # aggregates → Markdown report
├── compare.mjs             # baseline vs candidate → verdict
├── lib/
│   ├── scenarios.mjs       # the scenario table (R00–R11)
│   ├── profile.mjs         # disposable app-data profiles
│   ├── app.mjs             # launch / readiness / graceful teardown
│   ├── sampler.mjs         # collector process → schema samples
│   ├── tree.mjs            # process-tree attribution (own/managed/external)
│   ├── stats.mjs           # percentiles, rates, slopes
│   ├── schema.mjs          # the result contract + validation
│   ├── budgets.mjs         # absolute budgets + regression policy
│   ├── preflight.mjs       # the checks that make a result believable
│   ├── redact.mjs          # what may leave the machine
│   ├── platform.mjs        # collector selection + machine facts
│   └── markdown.mjs        # the report
├── collectors/             # windows.ps1, unix.sh (+ unix.test.mjs)
├── fixtures/               # git repo, agent, http server (+ make-repo.test.mjs)
├── budgets/                # windows.json, macos.json, linux.json
└── baselines/              # approved aggregates, per platform
```

The pure logic (`schema`, `tree`, `stats`, `budgets`, `redact`, `scenarios`,
`preflight`) is covered by Vitest and runs in the normal `npm test` — it decides
what every published number means, so it is tested like product code.

Two of those suites are worth calling out because they cover code that otherwise
has none:

- **`collectors/unix.test.mjs`** lifts the awk program out of `unix.sh` (rather
  than duplicating it) and runs it against a synthetic `ps` snapshot: subtree
  descent, the same-named-but-unrelated process, CPU-time parsing, and the
  `null`-not-zero rule. It skips where `awk` is unavailable, so the Linux and
  macOS CI legs are what actually exercise it — which is where the script is
  destined to run.
- **`fixtures/make-repo.test.mjs`** pins the generated repository's commit hash,
  so a drifted generator is caught immediately instead of quietly changing what
  every git scenario measures. It also covers a path with spaces and non-ASCII
  characters.

See [`testing.md`](testing.md).
