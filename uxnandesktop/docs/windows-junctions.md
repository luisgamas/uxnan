# Windows: commands blocked by "Redirection Guard" (junctions / OneDrive)

![Platform](https://img.shields.io/badge/platform-Windows-0a0a0a?style=for-the-badge)

## Symptom

A command run **inside a Uxnan terminal** fails, while the exact same command in a
standalone terminal (Windows Terminal / PowerShell) **works**:

```text
# cargo
failed to run `cargo metadata`: The path cannot be traversed because it contains
an untrusted mount point. (os error 448)

# npm
npm error code UNKNOWN
npm error syscall lstat
npm error errno -4094
npm error UNKNOWN: unknown error, lstat '…\node_modules\<pkg>\dist\…'
```

Both are the same failure: `os error 448` is Win32 `ERROR_UNTRUSTED_MOUNT_POINT`
(`STATUS_UNTRUSTED_MOUNT_POINT`, `0xC00004BE`); `errno -4094` is libuv's `UNKNOWN`,
what Node/npm print for that same 448.

## Cause

Windows' **Redirection Guard** (`ProcessRedirectionTrustPolicy`) refuses to
traverse a *reparse point* (junction / symlink / mount) it considers **untrusted** —
one created by a non-privileged (medium-integrity) actor. Two common sources in a
dev tree:

- **npm-workspace junctions** — an npm workspaces repo materializes each workspace
  package as a **junction** in `node_modules` (e.g. `node_modules/<pkg>` → the
  package folder). These are created by your user, so the guard flags them.
- **OneDrive Files On-Demand** — when a folder is OneDrive-backed, its entries are
  cloud placeholders (reparse points) behind OneDrive's minifilter, which the guard
  also treats as untrusted mount points.

### Why it fails inside Uxnan but not in a standalone terminal

Uxnan does **not** sandbox the shell and does **not** enable any process mitigation
itself (see `src-tauri/src/pty.rs` — `portable-pty` spawns the shell with no
restricted token, job object, or mitigation policy). The enforcement is
**inherited**: a process launched under the app runs in a stricter context (the
GUI/WebView2 host) that enforces redirection trust, whereas Windows Terminal /
standalone PowerShell do not. Same command, same junction — different process
context, different result. This is a known pattern for terminal/ADE apps built on a
web runtime, not something unique to Uxnan.

## Fix (recommended — preserves security)

Move the project to a **local path outside OneDrive**, ideally short, e.g.:

```text
C:\dev\<your-repo>
```

Then run the command inside Uxnan again. This works because the traversal no longer
crosses OneDrive's filter, and a local checkout re-created there avoids the
workspace-junction traversal that tripped the guard. (Moving off OneDrive and to a
short path also sidesteps unrelated Windows long-path issues.)

Uxnan detects this failure in terminal output and shows a **one-time toast** with
this guidance — it does not disable the OS mitigation, keeping the security posture
intact.

### Also worth checking

- **Is your `Documents` OneDrive-backed?** `Get-ItemProperty
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
  Personal` — if `Personal` points under `%OneDrive%`, that's a trigger.
- **Don't run Uxnan as administrator** for this — an elevated process classifies
  your (medium-integrity) junctions as untrusted, which can trigger the same error.

## Alternative (not shipped): a structural fix

A different approach would let junction traversal work **without** moving the repo:
spawn PTYs from a **separate process off the WebView2 host**, so terminal children
don't inherit the redirection-trust enforcement. That's a large, cross-platform
change (Windows/macOS/Linux) requiring validation on OSes not available to the
maintainer today, so it stays a **documented alternative** rather than the shipped
path. It's tracked in [`../FOR-DEV.md`](../FOR-DEV.md) → *Deferred follow-ups →
Terminal*, gated on a diagnostic that confirms the enforcement is inherited and
clearable.

## References

- Microsoft MSRC — *Redirection Guard: Mitigating unsafe junction traversal in
  Windows*.
- The detection lives in `src/lib/terminal/windowsJunctionDetector.ts` (pure,
  unit-tested) and `src/lib/terminal/windowsJunctionGuard.ts` (the Windows gate +
  the toast).
