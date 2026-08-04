# End-to-end tests

The only layer that runs the whole product: a release binary, its Rust backend, a
real WebView2, real IPC, real processes.

```bash
cd uxnandesktop
npm run bench:build          # a release binary with its frontend embedded
npm run test:e2e:setup       # fetch the WebDriver matching this machine's WebView2
# close every other uxnan window
npm run test:e2e
```

## Preconditions, and why each one is enforced

**A release binary with the frontend embedded.** `cargo build --release` alone
leaves Tauri in dev mode: the window opens, the backend runs, and the webview
shows a connection-refused page. Use `npm run bench:build`.

**No other uxnan running.** Windows keeps **one WebView2 browser process per
user-data folder**, so a second instance attaches to the first one's — and the
automation session then drives a webview that is not this app's. It does not
error: every query returns `<html><head></head><body></body></html>`, which reads
as "the app renders nothing". The config refuses to start and names the offending
PID. (The resource benchmarks hit the same constraint; the check is shared with
them rather than written twice.)

**A WebDriver matching the installed WebView2.** `msedgedriver` is version-locked
to the runtime, and a mismatch fails with a message about browser versions that
says nothing about what to do. `setup-driver.mjs` reads the installed version
from the registry and fetches the matching driver into `.drivers/` (git-ignored:
it is a per-machine artifact). The version is deliberately **not** pinned in a
config file — WebView2 updates on its own schedule, so a checked-in version would
be wrong within weeks and wrong on every other machine.

## Two traps, both now guarded

**The session starts on `about:blank`.** `tauri-driver` does not attach to the
window the app already navigated; it hands you a blank webview. Every query then
succeeds and returns `<html><head></head><body></body></html>`, which reads as
"the app rendered nothing" while the app is running perfectly — its process tree
has a full set of renderers and it writes `state.json` and
`terminal-buffers.json`, which only a hydrated frontend does. The config
navigates to `http://tauri.localhost/` before any test, and the IPC bridge is
live there: `invoke("ping")` answers `"pong"` from the Rust backend, so these are
genuine end-to-end tests rather than a frontend rendering against nothing.

**`tauri:options.env` did not reach the app.** A diagnostic run came up showing
the developer's real projects and name — the suite was driving their profile, not
the disposable one, and a journey that removed a worktree would have removed a
real one. `UXNAN_DATA_DIR` is set on the driver process now (the app inherits
from it), and `before` **refuses to run** if the app under test has any project
in it.

## What is here, and what is not

Journeys only. Everything provable in jsdom or against a temp directory belongs
in a faster layer; this one costs a process launch per spec and is the first to
become flaky.

Eight of them, one per spec file, each with its own app started from a profile
seeded for it (`journeys.mjs`): **launch**, **restore** (a saved session comes
back), **terminal** (two panes in a split, a real shell behind each),
**sleep-wake** (a sleeping workspace spawns nothing), **worktree** (a real git
repository is recognised, listed and read), **agent** (the agent runs under a
shell; the hook server refuses an untokened report and records a valid one),
**browser** (a loopback page in a second window) and **migration** (a profile
from an older build still opens with its projects).

A ninth is **opt-in** and self-skips by default: **github-fake** (enable with
`UXNAN_E2E_FAKE_GH=1`) routes the app's `gh` to the test fixture — prepending a
gh-only shim to the driver's PATH, so every other CLI stays real — and asserts
the GitHub status/PR/rate-limit chains over IPC against the captured real
payloads from `../fixtures/github/`. No network, no account; see
[`../../docs/github-validation.md`](../../docs/github-validation.md).

Setup is seeded rather than clicked: twenty clicks to reach the thing you wanted
to assert is how an E2E suite becomes slow and brittle. The assertions still go
through the real UI, real IPC and a real backend.

The matrix of what each flow is covered by — and what it is not — lives in
[`../quality-matrix.json`](../quality-matrix.json), checked against the repo by
`../quality-matrix.test.mjs`.

## Isolation and cleanup

Every run gets a throwaway `UXNAN_DATA_DIR`, so it starts from a known profile
and can never touch yours.

Teardown reaps **by PID**, never by name. That is not fastidiousness: this
harness runs on machines where a real `uxnan-desktop.exe` is very likely open —
quite possibly the one hosting the terminal the tests were started from — and a
name-based sweep would take it down along with whatever was running inside it. An
app that outlives its session is matched on *our* profile directory, killed, and
**reported**, because a leak is a teardown bug and not a passing detail.

## When something fails

`.artifacts/` (git-ignored) holds a screenshot and the page source per failed
test, plus the driver log. The empty-document case above is diagnosable straight
from the saved HTML.

### When no session starts at all

A different failure, and nothing above explains it: every spec dies in
`session not created: DevToolsActivePort file doesn't exist` before its first
assertion. That is the **attach** failing, not the app — and it is what the
nightly CI run has done since it was added, on a runner where the resource
benchmarks launch the same binary and record a full WebView2 process tree.

```bash
npm run test:e2e:diagnose
```

`diagnose-session.mjs` runs the experiment the suite cannot run around itself,
and prints a verdict:

1. **Does the app expose a debugging endpoint at all?** It launches the release
   binary with the environment `tauri-driver` arranges
   (`TAURI_WEBVIEW_AUTOMATION`, plus `--remote-debugging-port` through
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`) and asks `/json/version` who
   answers. Silence means the problem sits below WebDriver.
2. **Can `msedgedriver` attach?** It drives `msedgedriver` directly — verbose,
   logging into `.artifacts/` — first with the exact capabilities
   `tauri-driver` forwards, then with `webviewOptions.userDataFolder` naming the
   folder Tauri forces the webview to use. Plain failing while scoped succeeds
   would make the fix a capability the suite can pass, proved rather than
   guessed.

It asserts nothing and changes nothing; the report is
`.artifacts/diagnose-session.json`. Same preconditions as the suite — a release
binary, and no other uxnan running, which it refuses to start without. It reaps
only what it started, and the name-based sweep is armed **only** after that
guard passes, so a failure before it can never touch an app you had open.

**A healthy machine, for comparison** (WebView2 151.0.4129.59, 2026-08-04):
the endpoint answers in **611 ms** and a session is created in **956 ms**. A
report that instead shows silence at 90 s is not a slow machine — the runner's
numbers, and what they narrowed the cause to, are in
[`../../FOR-DEV.md`](../../FOR-DEV.md) → *Make E2E a required gate*. Note that
`DevToolsActivePort` is absent from the app's own user-data folder **even on a
green run**: the driver locates the port some other way, so that file missing is
not itself the fault.

## Platforms

Windows only for now. `tauri-driver` supports Linux (WebKitWebDriver) and does
not support macOS, but neither has been run here — and this harness does not
claim a platform it has not executed on.
