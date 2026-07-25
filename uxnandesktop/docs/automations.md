# Automations

![Runs](https://img.shields.io/badge/runs-with_the_app_closed-2ea44f?style=for-the-badge)
![Graph](https://img.shields.io/badge/graph-multi--agent-blue?style=for-the-badge)
![Verified](https://img.shields.io/badge/headless-verified_by_exit_code-8957e5?style=for-the-badge)

An **automation** is an unattended, **recurring** task: it runs on its own
schedule, in **its own working folder** (a git repo or any plain folder), and it
drives a small **graph of agent steps** — several providers working in parallel,
another agent consuming their outputs.

Two things make it different from the [orchestration console](./orchestration.md):
it does not need uxnan to be open, and it is not tied to whatever project is
selected in the sidebar.

> **Status.** The engine, the on-disk format, the headless runner and the
> **OS-scheduler registration** are implemented and tested. The **Automations
> screen** lands in the next phase — until then an automation is defined in
> `automations.json` and scheduled or started through the commands below.
> Spec: [`architecture/02f-automations.md`](../architecture/02f-automations.md).

---

## How it runs

The uxnan binary has a second life as a headless runner. `main.rs` checks its
arguments *before* Tauri builds a window:

```bash
uxnan-desktop --automation-run <automationId> [--trigger scheduled|manual]
```

With that flag it takes a plain Tokio path and exits — no webview, no window,
and on Windows no console. That is what lets an automation fire while the app is
closed (the machine has to be on, of course).

There is exactly **one execution path**: the OS scheduler and the app's "Run
now" both spawn this same subprocess, so a scheduled run and a manual one can
never behave differently.

Exit codes: `0` the run finished (or was skipped for a legitimate reason), `1` a
step failed, `2` the automation could not be run at all.

## Where things live

```
<app-data>/automations/
  automations.json                  # definitions — written ONLY by the app
  runs/<automationId>/<runId>.json  # one run per file — written ONLY by its runner
  logs/<runId>.log
```

`<app-data>` is `%APPDATA%\dev.luisgamas.uxnandesktop` on Windows,
`~/Library/Application Support/dev.luisgamas.uxnandesktop` on macOS, and
`$XDG_DATA_HOME/dev.luisgamas.uxnandesktop` on Linux.

Every file has a **single writer**, so the app and a live runner never race and
no locking is needed. Because the runner rewrites its own record as steps
advance, the app can show live progress just by watching the directory.

## Defining one

```jsonc
{
  "version": 1,
  "automations": [
    {
      "id": "nightly-triage",
      "name": "Nightly triage",
      "tags": ["triage"],
      "workingDir": "C:/work/my-repo",
      "schedule": { "kind": "every", "n": 30, "unit": "minutes", "startsAt": 0 },
      "policy": {
        "precondition": { "command": "git log --since=1.day --oneline | head -1", "timeoutSeconds": 20 },
        "keepRuns": 30
      },
      "steps": [
        { "id": "s1", "title": "Scan tests",  "agent": "opencode", "prompt": "List failing tests." },
        { "id": "s2", "title": "Scan deps",   "agent": "codex",    "prompt": "List outdated dependencies." },
        { "id": "s3", "title": "Consolidate", "agent": "claude", "dependsOn": ["s1", "s2"],
          "prompt": "Write one report. Tests: {{steps.s1.output}} Deps: {{steps.s2.output}}" }
      ]
    }
  ]
}
```

`s1` and `s2` are independent, so they run **at the same time**; `s3` declares
both as dependencies, so it waits for both and receives their outputs in its
prompt. That is the whole model — parallel and fan-in fall out of `dependsOn`
alone.

### Schedule

| `kind` | Fields | Meaning |
|---|---|---|
| `every` | `n`, `unit` (`minutes`/`hours`/`days`/`weeks`), `startsAt` | Every N units from a start moment |
| `dailyAt` | `hour`, `minute` | Every day at a wall-clock time |
| `weekdaysAt` | `hour`, `minute` | Monday–Friday |
| `weeklyAt` | `day` (0 = Sunday), `hour`, `minute` | Once a week |

The minimum interval is one minute. There is **no one-shot variant**: an
automation is recurring by definition — a single ad-hoc run belongs to the
normal three-panel workflow. There are **no cron expressions**: they don't
translate cleanly to Task Scheduler or systemd, and the presets cover the cases.

Rust does **no calendar arithmetic** — the OS scheduler owns *when* a run fires,
so it is the single authority. The "next runs" preview in the UI is computed in
the frontend and is display-only.

### Step fields

| Field | Default | Notes |
|---|---|---|
| `id` | — | Unique within the automation (`s1`, `s2`, …) |
| `agent` | — | `claude`, `codex`, `gemini`, `opencode`, `pi` |
| `model` | CLI default | Empty means the CLI picks |
| `prompt` | — | May reference other steps (below) |
| `dependsOn` | `[]` | Wait for these to complete |
| `onFailure` | `stop` | `retry` re-dispatches up to `maxAttempts` |
| `maxAttempts` | `1` | |
| `timeoutMs` | 10 min | Per-step wall-clock cap |

### Prompt references

| Token | Value |
|---|---|
| `{{steps.s1.output}}` | `s1`'s captured stdout **in this run** |
| `{{steps.s1.title}}` | `s1`'s title |
| `{{prev.s1.output}}` | `s1`'s output in the **previous** run of this automation |
| `{{workingDir}}` | the directory the run executes in |

`prev.*` is what lets a recurring automation continue yesterday's work instead
of starting from zero. A reference with no value yet resolves to an empty string
and is recorded in the run's `missingRefs` — a thin hand-off is documented, not
fatal.

### Policy

| Field | Default | Notes |
|---|---|---|
| `catchUp` | `true` | Recover a run whose moment passed while the machine was off |
| `overlap` | `skip` | What to do when the previous run is still going |
| `precondition` | none | Shell command; **exit 0 = proceed**, with a timeout |
| `maxRunMinutes` | `60` | Whole-run ceiling; in-flight steps are aborted |
| `keepRuns` | `30` | History retention |
| `notifyOn` | `["failed"]` | |

A run record keeps everything an unattended execution needs to explain itself
afterwards: the **prompt as actually sent**, the captured output, the verified
exit code, stderr, attempts, per-step timings and the precondition capture.

## Scheduling

uxnan keeps **no clock of its own**. Saving or enabling an automation registers a
task with the operating system's own scheduler, which then spawns the runner —
that is what keeps it firing with the app closed. Everything is registered **per
user, without elevation**.

| OS | Mechanism |
|---|---|
| Windows | Task Scheduler XML → `schtasks /Create /XML /TN uxnan-automation-<id> /F` |
| macOS | LaunchAgent in `~/Library/LaunchAgents`, loaded with `launchctl bootstrap gui/<uid>` |
| Linux | `~/.config/systemd/user/uxnan-automation-<id>.{service,timer}`, `systemctl --user enable --now` |

Two policy fields are delegated to the OS rather than enforced only by us:
`overlap` becomes Task Scheduler's `MultipleInstancesPolicy` (and its
equivalents), and `catchUp` becomes `StartWhenAvailable` / `Persistent`, so a run
whose moment passed while the machine was off is recovered rather than lost.

An interval is emitted as a repeating trigger; the clock-time presets as a
*calendar* trigger, which stays pinned to the wall clock where an interval would
drift across DST. On systemd this matters more than cosmetically: `Persistent=`
only applies to `OnCalendar`, so a monotonic interval timer deliberately does not
claim a catch-up it would not perform.

### When registration fails

It can — an unsupported platform, a corporate policy, a locked-down machine. When
it does the automation is **still saved**, and the status returned carries the
message the OS actually printed. The automation keeps running while uxnan is
open, and the UI must say plainly that it is not scheduled. There is no state in
which an automation looks active without being active.

**Windows caveat, stated rather than hidden:** the task runs with
`InteractiveToken`, so it fires only while the user is logged on. Running with
the session closed would require storing the user's password, which uxnan does
not do.

### Commands

| Command | Purpose |
|---|---|
| `automations_list` | Every saved automation |
| `automations_save` | Upsert **and** bring the OS task in line; returns the resulting scheduler status |
| `automations_set_enabled` | Enable/disable, registering or removing the task to match |
| `automations_delete` | Remove the automation, its task and its history |
| `automations_runs` / `automations_runs_dir` | Run history, and the directory to watch for live progress |
| `automations_run_now` | Spawn the same runner the scheduler spawns, tagged `manual` |
| `automations_scheduler_status` / `automations_scheduler_supported` | What the OS thinks, and whether this platform can schedule at all |

`automations_save` takes a `startBoundary`: a **local** ISO 8601 datetime the
caller computes, because the backend does no calendar arithmetic.

## No human gates

An unattended task that blocks at 3 AM waiting for a click is a broken task.
Automations finish and leave their result for you — a branch, a report, the
captured output. Anything that needs live approval belongs in the
[orchestration console](./orchestration.md), which is untouched by this feature.

## Agent-specific notes

- **Codex** refuses to start in a folder it does not trust, and asks
  interactively — unanswerable with nobody watching. The runner seeds the same
  per-folder trust the app seeds when it launches Codex into a workspace
  (non-destructive: an explicit decision you already made is left alone), and the
  headless recipe passes `--skip-git-repo-check` so a non-repo working folder
  works too.
- **PATH**: a run launched by the OS scheduler inherits a minimal environment
  (launchd in particular), so the runner applies the same PATH enrichment the app
  applies at startup. Without it every agent would resolve as "not installed".
- The agent CLIs must be **signed in**. If one asks for a login the step fails
  and its stderr is recorded.

## Testing & verifying

The pure logic is unit-tested (`cargo test automations`): schedule validation,
template resolution including multi-byte text, cycle detection, fan-in readiness,
skip propagation, retry, run-status derivation, retention, the single-writer
store contract, and the exact text of the Task Scheduler XML, the LaunchAgent
plist and the systemd units — those builders are compiled and tested on **every**
platform, so a Windows machine still checks the macOS and Linux output.

The scheduler also has a round-trip test against the **real** Task Scheduler,
`#[ignore]`d so it never runs in CI or a normal `cargo test`:

```bash
cargo test -- --ignored windows_round_trip
```

It registers, queries, removes and re-removes a throwaway task. Run it after any
change to the XML — Task Scheduler rejects a malformed document with a message
that says nothing about the cause, and this is the only thing that catches it.

To exercise a real run end to end, point the store at a scratch data directory
and invoke the runner directly:

```bash
cargo build --bin uxnan-desktop
./target/debug/uxnan-desktop --automation-run <id> --trigger manual
cat "<app-data>/automations/runs/<id>/"*.json
```

The run record shows each step's status, the resolved prompt, the captured
output and the exit code — with the app never opened.

See also: [testing & verification](./testing.md).
