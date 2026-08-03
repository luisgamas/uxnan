# Diagnostics — the record the app leaves behind

Uxnan Desktop hosts live agent terminals, so a failure can cost real work. This
page describes the log it writes, what goes in it, and how to use it when
something goes wrong.

## Why it exists

The app once went to a **black screen** and had to be force-closed, and
afterwards there was nothing to investigate with:

- no entry in the Windows Application event log,
- no WebView2 minidump (nothing had actually crashed),
- and no log of our own — the backend's only reporting was a handful of
  `eprintln!` calls, which in a packaged Windows GUI build write to a stderr no
  one is attached to.

A Rust panic left no trace either, and a frontend exception that blanks the
window left less than that. So the app now keeps its own record. This is
deliberately a **small lifecycle log**, not a telemetry system: nothing leaves
your machine, and nothing is sent anywhere.

## Where the log is

```
<app data>/logs/uxnan-desktop.log     ← live file
<app data>/logs/uxnan-desktop.1.log   ← previous, up to .3.log
<app data>/logs/session.active        ← present only while a session is running
```

`<app data>` is the per-user application directory (on Windows,
`%APPDATA%\dev.luisgamas.uxnandesktop`), or whatever `UXNAN_DATA_DIR` points at
— the same directory the rest of the app persists into (see `datadir.rs`).

The live file rotates at **2 MiB** and **3 rotations** are kept, so the logs
directory is bounded at roughly 8 MiB no matter how long the app runs.

Each line looks like:

```
2026-08-02T20:15:03.123Z ERROR [webview.error] TypeError: x is not a function (chunk.js:1:12345)
```

— a UTC timestamp, a level (`INFO` / `WARN` / `ERROR`), the source, and the
message.

## What gets recorded

| Source | What it means |
|---|---|
| `lifecycle` | Startup (with version, OS, arch), clean shutdown, and the **unclean-shutdown warning** |
| `panic` | A Rust panic, with its location and message, written *before* the process dies |
| `webview.error` | An uncaught frontend exception — the failure mode that blanks the window while the process stays healthy |
| `webview.rejection` | An unhandled promise rejection in the frontend |
| `persistence` | Failing to load the persisted state (the app then starts fresh) |
| `hooks` | The agent hook server failing to start, or hook scripts failing to install |

### What is never recorded

No secrets, by construction: not the hook server's token, not a provider token,
not terminal output, prompts, or file contents. Call sites pass short lifecycle
facts only. Messages coming from the webview are treated as untrusted input —
they are bounded, stripped of control characters, and their newlines are
replaced with `⏎` so a thrown value can never forge extra log lines.

## The unclean-shutdown marker

While the app runs, `logs/session.active` exists. Reaching the app's normal exit
path deletes it. So on the next launch:

- **marker absent** → the previous session ended cleanly;
- **marker present** → the previous session was killed, force-closed or crashed,
  and the app records a `WARN` line saying so.

This matters beyond diagnostics: terminal scrollback is persisted on the clean
exit path (`terminal-buffers.json`), so an unclean exit is also the reason
scrollback from that session is missing.

## What you see in the app

Two surfaces, and nothing else — this is a safety net, not a feature that asks
for attention:

- **A notice at startup, only after an unclean shutdown.** A card in the
  bottom-right toast area (the same elevated-card treatment the update notice
  uses) saying the previous session ended unexpectedly and that terminal
  scrollback from it was not saved, with a **Show log file** button that reveals
  the log in the file manager. It appears at most once per launch, never
  auto-dismisses (a notice you did not happen to look at is a notice that did
  not happen) and is dismissed with its own ✕. After a normal shutdown nothing
  appears at all.
- **Settings → App → Diagnostics**, always available: whether the last session
  ended normally or unexpectedly, the log's full path, and the same **Show log
  file** action.

## Using it

**When something goes wrong,** open the live log and look at the last lines
before the failure. A blank/black window with a `webview.error` line is a
frontend fault (the stack names the culprit); a `panic` line is a backend fault;
neither, plus an unclean-shutdown warning on the next launch, means the process
died or hung without either half getting a word in — which itself narrows it to
the host process or the OS.

**When reporting a bug,** attach the log (it contains no secrets — but do skim
it, since paths on your machine appear in some messages).

The frontend can also ask the backend where the log is and whether the last
session ended cleanly:

```ts
import { diagnosticsReport } from "$lib/api";
const { logPath, previousSessionUnclean } = await diagnosticsReport();
```

## How it is implemented

- **`src-tauri/src/diagnostics.rs`** — the sink: rotation, formatting,
  sanitization, the session marker, and the panic hook. It has no dependency of
  its own; timestamps are formatted from the same `SystemTime` epoch the rest of
  the backend uses.
- **`src-tauri/src/lib.rs`** — arms diagnostics and the panic hook as the first
  thing in `setup()` (before anything else can fail), and disarms the marker on
  the exit path, after the other teardown.
- **`src/lib/utils/errorReporter.ts`** — installs the `error` /
  `unhandledrejection` listeners in the main window and forwards them through
  the `diagnostics_log` command. Passive: it never prevents, defaults, or
  swallows anything the page does, and a failure to report is swallowed rather
  than becoming a second failure.
- **`src/lib/state/diagnostics.svelte.ts`** — one read of `diagnostics_report()`
  at boot (nothing to poll: the backend computed it at startup), plus the
  dismissed flag. A failed read stays silent, so an older backend simply shows
  nothing.
- **`src/lib/components/SessionRecoveryToast.svelte`** +
  `src/lib/sessionRecoveryToast.svelte.ts` — the startup notice and the driver
  that decides whether it is on screen, mirroring the updater's pinned-toast
  pattern.
- Commands: `diagnostics_log(level, source, message)` and
  `diagnostics_report()`.

## Testing

`cargo test --lib diagnostics` covers timestamp formatting, log-line forging,
message bounds, rotation (including that the number of files stays bounded), and
the marker's three states — first run, missing shutdown, clean shutdown.
`npm run test:node -- errorReporter` covers describing arbitrary thrown values
(including non-`Error`s and unserializable ones) and that a failing report never
raises. `npm run test:dom -- diagnostics` covers when the notice is shown: not
before the backend has answered, not after a clean shutdown, not once dismissed,
and not at all when the command is unavailable.
