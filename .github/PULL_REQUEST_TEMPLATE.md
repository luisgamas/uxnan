<!--
  Thanks for contributing to Uxnan! Keep PRs focused — one logical change per PR.
  Replace the italic prompts and the "Example" blocks with your own content.
-->

## Summary

_What does this PR change, and why? 1–3 sentences._

> **Example:** Fixes the QR scanner crashing in release builds. R8 full-mode was
> stripping ML Kit's `BarcodeRegistrar` no-arg constructor; added a keep rule so
> the scanner works in `--release` again.

Closes #<!-- issue number, or delete this line if there's no issue -->

## Affected component(s)

<!-- Put an "x" inside the brackets: [x] -->

- [ ] `shared` — contracts / JSON-RPC / E2EE schemas
- [ ] `bridge` — PC daemon (uxnan-bridge)
- [ ] `relay` — E2EE relay server (uxnan-relay)
- [ ] `uxnandesktop` — Tauri desktop app
- [ ] `uxnanmobile` — Flutter mobile app
- [ ] Cross-cutting / tooling / CI / docs

## Type of change

- [ ] `fix` — bug fix
- [ ] `feat` — new feature
- [ ] `refactor` — no behavior change
- [ ] `docs`
- [ ] `test`
- [ ] `chore` / `ci` / `build`

## How was it tested?

_List the actual checks you ran: the commands, the OS/device, and the result.
Include manual steps for anything CI can't cover (UI, pairing, on-device), and a
screenshot/video for UI changes. "It builds" is not enough._

> **Example:**
>
> 1. `cd bridge && npm test` → 263 tests pass (Ubuntu + Windows).
> 2. Manual, on Windows: started the bridge, paired my phone, sent a turn to the
>    echo agent — the reply arrived and the turn showed `completed`.
> 3. Built `flutter build apk --release` and confirmed the QR scanner opens and
>    scans without crashing (screenshot below).

## Checklist

- [ ] Lint/format pass for the touched component(s) (see `CONTRIBUTING.md`).
- [ ] Tests added or updated, and the suite passes.
- [ ] `CHANGELOG.md` updated for each affected component (technical detail).
- [ ] Docs / `architecture/` updated if behavior or a contract changed (spec-drift control).
- [ ] Commits follow Conventional Commits — `type(scope): message`.
- [ ] **If this is a `uxnanmobile` release:** `.github/whatsnew/whatsnew-{en-US,es-ES}` updated with short, non-technical notes (≤ 500 chars each).
- [ ] If a `shared` contract changed, all consumers (bridge/relay/mobile) were updated in the same change.
