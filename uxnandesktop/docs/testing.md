# Desktop — testing & verification

![Backend](https://img.shields.io/badge/backend-cargo_test_%2B_clippy_%2B_fmt-000000?style=for-the-badge&logo=rust&logoColor=white)
![Frontend](https://img.shields.io/badge/frontend-svelte--check_%2B_Vitest-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![E2E](https://img.shields.io/badge/E2E-WebdriverIO_%2B_tauri--driver-EA5906?style=for-the-badge)

The quality gates to run before considering a change done (AGENTS.md requires
compile + tests + lint/format clean, and a real UI flow for UI changes).

## The layers

Five, each with a job the one below it cannot do. The point of the split is
speed: almost everything is provable in a layer that costs milliseconds, so the
expensive layers stay small enough to remain trustworthy.

| | Layer | What it proves | Runner | Gate |
|---|---|---|---|---|
| **L0** | static | it compiles and lints | `npm run check`, `cargo clippy`, `cargo fmt` | required |
| **L1** | unit | pure logic is correct | `npm run test:node`, `cargo test` | required |
| **L2** | component | a Svelte component behaves | `npm run test:dom` | required |
| **L3** | backend integration | real files, real git, real processes | `cargo test --test *`, `npm run test:node` | required |
| **L4** | end to end | the whole app actually works | `npm run test:e2e` | manual (Windows) |
| **L5** | real compatibility | accounts, signed artifacts, physical machines | by hand | checklist |

What is covered at which layer — **and what is not** — is
[`../tests/quality-matrix.json`](../tests/quality-matrix.json), a machine-readable
file checked against the repository by `tests/quality-matrix.test.mjs`: a flow
that claims a layer must cite a file that exists, and a partially covered flow
must state its gap. Every plan that adds a feature updates its row.

## Backend (Rust)

```bash
cd uxnandesktop/src-tauri
cargo test                     # unit + integration tests
cargo clippy --all-targets     # lints — must be warning-free
cargo fmt --check              # formatting — must be clean (run `cargo fmt` to fix)
```

Unit tests live in-file under `#[cfg(test)]` (e.g. `model.rs`, `persistence.rs`,
`git.rs`, `gitfast.rs`, `pty.rs`, `hooks.rs`, `agent_hooks.rs`, `procscan.rs`,
`updater.rs`, `which.rs`, `pets.rs`, `datadir.rs`); **integration** tests go in
`src-tauri/tests/` and may use only the crate's public surface, which is what
keeps them integration tests rather than unit tests with a longer path —
`automations_store.rs` (10 tests) drives the store against a real `TempDir`:
round-trip across a process boundary, seed-once, a truncated file degrading
instead of panicking, nothing written outside its own root, and a path with
spaces and non-ASCII characters; `resources_processes.rs` (3 tests) drives the
resource monitor against **real spawned process trees** — live attribution, the
start-time probe agreeing with the full table read, and the orphan flow (owner
closed, child survives, cleared when it ends); `github_cli.rs` (12 tests) drives the
**production GitHub layer through real child processes** — a scripted stand-in
`gh` on `PATH` answers with the shapes recorded in
`tests/fixtures/github/mutation-outcomes.json` (each with its provenance), so
merge refusals, degraded environments (signed out / offline / rate-limited /
truncated JSON / old gh), the Windows `.cmd` resolution path and the
non-interactive env all run for real with no network; and `github_live.rs`
holds the **supervised live suite** (every test `#[ignore]`, armed only by
`UXNAN_GH_SANDBOX` naming the allowlisted sandbox — its 3 non-ignored tests
prove the guard refuses everything else; procedure in
[`github-sandbox-runbook.md`](github-sandbox-runbook.md)). **538 backend tests**
in total (plus the 7 ignored live tests and the ignored real-scheduler probe).

The 510 unit tests cover the Serde model shape, persistence round-trip / atomicity /
migration / backups (including a corrupt state file and an obstructed data
directory failing cleanly instead of panicking), the GitHub layer's parsers —
including **contract tests that feed them captured real `gh` output** frozen
under `tests/fixtures/github/` (`src/github/fixture_tests.rs`; capture +
sanitization tool in `scripts/github/capture-fixtures.mjs`, status in
[`github-validation.md`](github-validation.md)), git + worktree ops (including
creation, opt-in branch
cleanup on removal — local/remote/force — checking out an existing branch,
staging, discard, hunk apply and commit against throwaway repos), the git2 fast
path, the PTY lifecycle,
the agent hook server, the integrated-browser scheme gate, process detection,
the updater's per-channel endpoints, the keep-awake state machine (fake
inhibitor: flip-on-change, the auto-release cap, release-on-drop — plus one
host-OS test that toggles the real inhibitor, so each CI runner exercises its
own platform branch), the pet overlay's monitor-aware placement (an unplugged
display's saved position rejected, the fallback corner provably on-screen), the
pets store (Codex-format manifest
parsing, path-traversal refusal, and the import copy staying scoped to the
manifest + its spritesheet), and the resource monitor (`resources.rs`: cadence
resolution, pid+start-time attribution, CPU/I-O delta honesty, buffer bounds,
orphan detection, the configurable history budget's clamp/trim, and the export
sanitizer's golden + schema-allow-list tests), plus the resource-mode settings
block (defaults, back-compat, camelCase round trip).

## Frontend (Svelte / TypeScript)

```bash
cd uxnandesktop
npm run check                  # svelte-check — must report 0 errors / 0 warnings
npm test                       # both Vitest projects (node + dom)
npm run test:node              # L1 only — pure logic, no DOM, a couple of seconds
npm run test:dom               # L2 only — Svelte components in jsdom
npm run build                  # production SPA build must succeed
```

Vitest runs as **two projects** (`vitest.workspace.ts`), and the split is
deliberate: the `node` project has no Svelte compiler and no jsdom, so it stays
fast — and a module that needs a `document` to be tested is a module with UI
concerns in it. Component tests are `*.svelte.test.ts`, which is also how the
`node` project knows to skip them.

### L1 — pure logic (`node`)

**Vitest** covers the pure, framework-free logic modules (node env, no DOM):
`shell.ts` (shell-aware agent-launch quoting), `orchestration.ts` (multi-agent
broadcast routing + backpressure), `orchestration/run.ts` (the run engine's DAG
readiness, context templates, cycle detection, validation + status derivation),
`updaterLogic.ts` (download-progress fraction + install-policy decision),
`diffParse.ts` (unified-diff parsing), `theme.ts` (batch theme-import
normalization), `quickCommands.ts` (quick-command token substitution + scope
filters), `terminalArbiter.ts` (terminal keyboard app-vs-TUI arbitration),
`branchName.ts` (GitHub branch-name slugging + friendly auto-generated
worktree branch names with collision-proof uniqueness), `filePreview.ts`
(extension-to-view capability), `markdown.ts` (GitHub-flavored Markdown: alerts,
disclosures, hidden comments and the safe README HTML subset),
`markdownHighlight.ts` (Lezer language selection + highlighted token runs),
`usageSchedule.ts` (per-provider cadence and stale-snapshot decisions),
`relTime.ts` (localized
relative dates), `state/flushRegistry.ts` (the flush-on-close registry:
register / unregister + `Promise.allSettled` fan-out), `utils/pointerLock.ts`
(the orphaned-body-pointer-lock guard: orphan detection + deferred modal open),
`pathid.ts` (workspace path identity + the boot reconcile plan) and
`agentResume.ts` (the per-CLI session-resume command registry + hostile-input
rejection), `agentSessionId.ts` (which CLIs take a caller-chosen session id, and
never pinning on top of args that already choose one), `agentLogoCache.ts` (the
backend-fetched logo memo: one fetch per URL, failures remembered, concurrent
asks collapsed), `terminal/scrollback.ts` (the scrollback clamp) and
`terminal/windowsJunctionDetector.ts` (the Windows Redirection-Guard failure
signature detector, incl. chunk-split matching) and `pets/` (the Codex-compatible
manifest parser, frame timing, and the agent-state → animation mapping +
priority, plus the v2 look-pose maths) and `automations/` (the recurrence
schedule + next-runs preview, the run/step display projections, the seeded
example automations, and the prompt-variable insertion) and
`state/statusSweepRegistry.ts` (the all-worktree status sweep's pacing +
its request registry) and `usageCatalog.ts` (which providers are still offered
vs merely still readable) and `platform.ts` (user-agent OS detection behind the
untested-platform badge and every per-OS frontend default) and
`resources/policy.ts` (the resource-mode policy
engine: presets with Balanced pinned to the pre-mode constants, residue-free
normalization/clamping, headroom gating and the effective poll intervals) and
`resources/autoSleep.ts` (every auto-sleep guard under a fake clock) — plus
the **resource-benchmark harness** under
`scripts/resources/lib/` (process-tree attribution own/managed/external, the
result schema and its validation messages, percentile / CPU-rate / soak-slope
maths, absolute budgets and the regression policy, the redaction gate, the
scenario table, the pre-flight checks that mark a run invalid, the Unix collector's awk parser and the git fixture's determinism) — and the **test fixtures**
under `tests/fixtures/` (the fake `gh` — incl. its scripted gh-shaped failure
outcomes — the PATH shim, the disposable and legacy profiles), the **GitHub
validation tooling** (`scripts/github/lib.test.mjs`: the sandbox allowlist's
refusals as real child processes, capture sanitization, the read/mutation
classifier), the **GitHub command inventory** check
(`tests/github-command-inventory.test.mjs` — every gh-backed function in
`github.rs` must have an inventoried row whose evidence exists), the
**quality matrix** check and the **platform support matrix**
check (`tests/platform-support.test.mjs` — every platform claim backed by
evidence that exists, and the announced level gated to it; see
[`platform-support.md`](platform-support.md)). **926 tests** across both projects,
config in `vitest.config.ts` / `vitest.dom.config.ts`.

### L2 — components (`dom`)

Real Svelte 5 components mounted in jsdom, with **Tauri's own `mockIPC`** behind
them. The seam is deliberately below `src/lib/api.ts` rather than a mock of it:
`api.ts` then runs *for real* — its command names, its argument marshalling — and
only the process on the other side is fake, so a renamed command fails a test
instead of quietly agreeing with a mock nobody updated.

- `src/test/tauri.ts` — the fake backend: a typed handler table, a call log, event
  emission, and failure/latency injection. An unhandled command **rejects loudly**
  rather than returning `undefined`, which would surface later as a confusing
  null-deref inside the component.
- `src/test/render.ts` — `mount()` (component + backend + `user-event`, all torn
  down together), `mountWithProviders()` for components needing the app-level
  context the root layout provides (bits-ui tooltips throw without their
  provider — `ProviderHost.svelte`), and `until()` for the waits that have no
  DOM signal.
- `src/test/setup.dom.ts` — jsdom's gaps filled once (`matchMedia`,
  `ResizeObserver`, canvas), plus a console policy: an unknown-prop or
  lifecycle-outside-component warning **fails** the test; known third-party
  teardown noise is suppressed. It also unmounts and then **waits out `bits-ui`'s
  body-style restore** — see below.
- **Dialogs leave a timer armed after they unmount.** `bits-ui` restores the body
  style 24 ms after the last scroll lock is released (a deliberate delay, so a
  modal that closes and reopens in the same tick does not flicker). If Vitest
  tears the jsdom environment down inside that window, the callback fires with no
  `document` and the whole run dies on an unhandled `ReferenceError` — *with
  every test passing*. It is a race, so it fails one platform at a time: it took
  the macOS leg of the 0.0.31 release build at 882/882 green while Linux and
  Windows won it. `setup.dom.ts` closes it by waiting ~40 ms after each test that
  actually left lock styles on the body — no cost for the tests that never open
  one. If you add a global body style for another reason, expect those files to
  pay the wait too.
- `MarkdownView.svelte.test.ts` — README-style badges render through the typed
  safe-HTML path, unsafe attributes/content stay absent, the full-width preview
  uses the native overflow treatment shared with CodeMirror, explicit badge
  dimensions survive app CSS, local/remote animated-image paths select the
  correct backend mode, and relative sibling links dispatch through the real
  file navigation callback.
- `FilePreview.svelte.test.ts` — loose-table README GIFs resolve from Windows,
  macOS, Linux, and UNC document paths and render the returned animated image
  unchanged; `markdown.test.ts` covers multiple inline-HTML images in one table.
- `GithubPanel.svelte.test.ts` — the right-panel GitHub tab keeps its content
  mounted while a poll re-reads the context, an unsubmitted **Create PR** form
  survives both a poll tick and an outright remount (each worktree keeping its
  own), **Cancel** is what discards it, and a worktree that really has no context
  still says so. The bug it locks down came from real use: the panel was gated on
  "a read is in flight", so every tick unmounted it and took a half-written pull
  request with it — which is why the first assertion is that the digest is *still
  there*, not that it loaded.
- `ThemeSettings.svelte.test.ts` — Settings → Appearance → Terminal's **Bold
  text** switch changes the weight and nothing else (family, size and spacing
  come out untouched), keeps program-bold output heavier than the body weight,
  and reads the *effective* weight: against a preset that is already bold it
  shows as on and switching it off writes an explicit regular weight, because
  merely clearing the override would fall straight back onto the preset.

- `ui/icon/icon.svelte.test.ts` — the Hugeicons glyph data reaches the DOM as
  *valid* SVG. The data uses camelCase keys (`strokeLinecap`) that SVG has no
  concept of, and a browser ignores an unknown attribute silently: spread them
  verbatim and every icon renders almost right — butt caps, hairline joins — with
  nothing failing anywhere. So the assertions read the emitted attribute names.
  It also locks the reason we don't use upstream's `@hugeicons/svelte`: the glyph
  must repaint when the `icon` prop changes.
- `AgentStatusIndicator.svelte.test.ts` — the sidebar's state glyphs actually
  paint. Three of the four states are rare next to `working`, so a glyph that
  went missing would hide for a long time; and a glyph resolving to `undefined`
  still type-checks and renders an empty `<svg>`. Each assertion is about painted
  geometry: real `d`/`r` on every shape, `currentColor` so the state tint reaches
  it, no `<svg>` at all for the CSS Comet Trail, and a plain dot for `idle`.

House style: query the way a user finds things — role, label, text. Reach for
`data-testid` only where there is genuinely no accessible handle. A test that
passes because it knew a class name will break on the next restyle and will keep
passing the next time someone breaks its accessibility.

### L4 — end to end

WebdriverIO + `tauri-driver` against a release binary. Setup, preconditions and
cleanup rules are in [`../tests/e2e/README.md`](../tests/e2e/README.md).

> **Two things this layer got wrong before it worked**, both worth knowing
> because neither announces itself:
>
> 1. **`tauri-driver` hands you a webview sitting at `about:blank`.** It does not
>    attach to the window the app already navigated, so every query succeeds and
>    returns `<html><head></head><body></body></html>` — which reads as "the app
>    rendered nothing" while the app is running perfectly. The session navigates
>    to `http://tauri.localhost/` in `before`, and the IPC bridge is live there:
>    `invoke("ping")` answers `"pong"` from the Rust backend, so these are real
>    end-to-end tests and not a frontend rendering against nothing.
> 2. **`tauri:options.env` did not reach the app.** A diagnostic run came up
>    showing the developer's real projects and name — the suite was driving their
>    profile, not the disposable one. The variable is now set on the driver
>    process, which the app inherits from, and `before` **refuses to run** if the
>    app under test has any project in it.

```bash
npm run bench:build      # a release binary with the frontend embedded
npm run test:e2e:setup   # fetch the WebDriver matching this machine's WebView2
npm run test:e2e         # close every other uxnan window first
npm run test:e2e:diagnose  # only when no session starts at all (see below)
```

> **This layer is green locally and does not run on a hosted runner.** Every
> `e2e-desktop.yml` run failed the same way — all 9 specs dying in `session not
> created: DevToolsActivePort file doesn't exist`, before any assertion — so the
> nightly schedule was removed rather than left red, and the workflow is now
> dispatch-only. It is the WebDriver attach, not the app: the browser process
> comes up on the runner with **no `--remote-debugging-port`**, so nothing was
> ever listening, while the identical binary and runtime answer in 611 ms here.
> Ruled out along the way: the driver pairing, the runtime version (the runner
> was forced to the same 151.0.4129.59) and `webviewOptions.userDataFolder`.
> `npm run test:e2e:diagnose` is the instrument that measured all of it
> ([`../tests/e2e/README.md`](../tests/e2e/README.md) → *When no session starts
> at all*). E2E therefore stays outside the required gate, and what is still
> owed is in [`../FOR-DEV.md`](../FOR-DEV.md).

**Eight journeys, 24 tests, ~39 s for the suite**, verified green on consecutive
runs with zero leftover processes: launch, session restore, terminals in a split,
a sleeping workspace, a git project, an agent and the hook chain, the browser
window, and a profile from an older build. A ninth journey is **opt-in**:
`github-fake.e2e.mjs` (enable with `UXNAN_E2E_FAKE_GH=1`) routes the app's `gh`
to the fixture — answering with the captured real payloads — and asserts the
GitHub chain over real IPC; it self-skips otherwise, and its first run is still
pending (it shares the operator session described in
[`github-sandbox-runbook.md`](github-sandbox-runbook.md)).

Each spec is one journey and gets its own app, started from a profile seeded for
it (`tests/e2e/journeys.mjs`). Setting a journey up by clicking through the UI
would be slower and far more brittle — twenty clicks to reach the thing you
wanted to assert, any of which can break for an unrelated reason — so the *setup*
is seeded and the *assertions* go through the real UI, over real IPC, against a
real backend.

Two habits the assertions follow, both learned by getting them wrong:

- **Ask the backend, not the screen, for facts.** The UI is localised; it renders
  in Spanish on the machine this was written on, so an assertion on visible text
  is an assertion on a translation.
- **A terminal's contents are not readable.** xterm paints through WebGL, so
  `.xterm-rows` is empty in the DOM. "Is a shell alive?" is answered from the
  process tree instead.

#### Why this driver, and not Playwright

The choice came from a spike, not a preference, and both candidates were tried
against the actual requirement — *drive the shipped app, across IPC, including
its native window*.

| | WebdriverIO + `tauri-driver` | Playwright |
|---|---|---|
| Drives a Tauri 2 window | **yes** — speaks WebDriver, delegates to `msedgedriver` | no; it drives browsers, and a Tauri app is not one |
| Crosses real IPC | **yes** | only if the frontend is served separately, in which case it does not |
| Native window / multi-window | **yes** (multi-window unproven here) | no |
| Setup cost | a Rust binary + a version-matched WebDriver | none |
| Verified | **Windows, 2026-07-30** — session established, 3 journeys green | not applicable |

Playwright could serve the frontend and click around it, and that has real value
— but a test that never crosses IPC is a component test with a browser attached.
Calling it E2E would be exactly the self-deception this harness exists to
prevent, so the component layer above uses jsdom (cheaper, same honesty) and E2E
means the real app.

**Pinned:** `webdriverio` 9.x, `tauri-driver` from crates.io, `msedgedriver`
matched to the installed WebView2 at setup time (deliberately not pinned in a
file — the runtime updates itself).

**Limitations, stated rather than discovered later:** Windows only so far;
multi-window journeys (the pet overlay, the browser panel) are unproven; and the
suite cannot run alongside another uxnan instance.

## Resource benchmarks

Type-checks and tests say the code is correct; they say nothing about what it
costs. The scenario matrix that measures uxnan's own footprint — and the budgets
and regression comparison built on it — is documented in
[`resource-benchmarks.md`](resource-benchmarks.md):

```bash
cd uxnandesktop
npm run bench:build                          # release, frontend embedded
npm run bench -- --scenario R01 --repeats 5  # measure
npm run bench:report                         # read it
```

Run it for any change that spawns a process, opens a webview, starts a watcher,
polls, caches or runs at startup, and put the numbers in the PR (the template
asks for them). Close every other uxnan window first — the harness refuses to
measure otherwise, and the doc explains why.

## UI / behavior verification

Type-checks and unit tests verify *code* correctness, not *feature* correctness.
For anything user-visible, also run the app and exercise the flow:

```bash
npm run tauri dev              # full app (backend + webview, hot reload, devtools)
```

Per the repo's UI workflow (AGENTS.md), UI changes are reviewed visually by the
maintainer on-device and are **not committed unilaterally** — propose → review →
adjust → approve → commit.

## L5 — the manual checklist

The things no automated layer can honestly cover: a real account, a signed
artifact, physical hardware. Run before a release, and record the date and the
machine — an unrecorded manual check is indistinguishable from one nobody did.

**Never in the required CI job.** These need credentials, cost money, or mutate
somebody's real data.

**Platform claims have their own machine-readable record**: what each
platform×feature pair has demonstrated (with date, sha, hardware, tester) lives
in [`../tests/platform-support.json`](../tests/platform-support.json), checked
by `tests/platform-support.test.mjs` and summarised in
[`platform-support.md`](platform-support.md). The per-platform release
checklists are **generated from it** (`node scripts/platform-support.mjs
checklist`), and the release workflow refuses a build whose announced platform
state exceeds the evidence (`… gate`). The table below is the cross-cutting
manual list; recording one of its platform runs means updating that matrix.

| # | Check | Why it cannot be automated here | Last verified |
|---|---|---|---|
| 1 | `gh` sign-in, then read a PR, an issue and an Actions run | Needs a real GitHub account; the suite uses a fake `gh` that never reaches the network (the *parsers* are now contract-tested on captured real output — this row is the live-account walk) | 2026-08-01 — live read chain green against the sandbox (`github_live_status_and_context…`) |
| 2 | Create a PR, review it, merge it | Mutates a real repository — scripted as the supervised sandbox suite (`github_live.rs` + `docs/github-sandbox-runbook.md`) | 2026-08-01 — first supervised run, 7/7 live tests green (`docs/github-validation.md` → *Supervised runs*) |
| 3 | Run each installed agent CLI in a terminal and confirm its status dot follows | Needs the CLIs installed and, for most, a paid account | — |
| 4 | Install a signed update from the stable channel | Needs a signed artifact and a real release | — |
| 5 | Install a signed update from the nightly channel | Same | — |
| 6 | Register an automation and confirm the OS scheduler fires it with the app closed | Needs the machine's own scheduler and a wall-clock wait | — |
| 7 | macOS: launch, agent/`gh`/editor detection, notifications, keep-awake, self-update | Needs Apple hardware; `tauri-driver` does not support macOS at all | — |
| 8 | Linux: the same walk-through | Needs a Linux machine; `tauri-driver` supports it but it has never been run | — |
| 9 | A WSL repository: open it, create a worktree, run an agent | Needs a WSL distribution with a checkout in it | — |
| 10 | The pet as a desktop overlay: visible over other apps, drag, click-to-reveal | A second always-on-top window, positioned by the OS | — |
| 11 | Open a real site in the integrated browser and use DevTools | Needs the network; the E2E journey uses a loopback fixture | — |
| 12 | Restore a session with several worktrees after a machine restart | Needs a real reboot | — |

Anything on this list that becomes automatable should move up a layer and leave
this table — a checklist is where coverage goes to be forgotten, so it should
hold only what genuinely belongs there.

## Which layer does my change need?

- **Pure function, no DOM, no IO** → L1. Nothing else.
- **A component whose behaviour a user can see** — a state it can be in, an
  action it dispatches, an error it has to survive → L2. Not its markup.
- **Anything that touches the filesystem, git, a process or a port** → L3,
  against a temp directory. Never against the developer's machine.
- **A journey that only exists when all the pieces are together** — boot,
  restore, launching an agent → L4, and only if no cheaper layer can show it.
- **A real account, a signed artifact, physical hardware** → L5, by hand, on the
  checklist. Never in the required CI job.

Then update the flow's row in
[`../tests/quality-matrix.json`](../tests/quality-matrix.json). A feature whose
row still says `planned` for the layer you just wrote is a matrix that has begun
to lie.

## Flaky tests

A test that fails intermittently is worse than no test: it trains everyone to
re-run rather than to look.

1. **Quarantine with an owner and a date**, never a silent skip. `it.skip` with a
   comment naming who and when — 14 days maximum.
2. **Keep the case at a lower layer.** Deleting an unstable E2E test is fine
   *only* if what it asserted survives in L2 or L3. Otherwise the coverage went
   away with the flake.
3. **One retry, and only for infrastructure.** A retry on a product assertion
   converts a real bug into a slow test. Where a retry is configured, the first
   failure is still recorded.
4. **Fix the wait, not the timeout.** Almost every flake here is a race dressed
   as a timing problem: assert on an observable state or an event, never a fixed
   `sleep`.

## One-shot pre-commit check (copy/paste)

```bash
cd uxnandesktop \
  && npm run check \
  && npm test \
  && npm run build \
  && ( cd src-tauri && cargo test && cargo clippy --all-targets && cargo fmt --check )
```
