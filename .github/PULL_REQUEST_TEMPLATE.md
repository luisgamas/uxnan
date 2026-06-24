<!--
  Thanks for contributing to Uxnan! Keep PRs focused — one logical change per PR.
  Fill in every section; it tells reviewers exactly what you're proposing and
  which monorepo project(s) it touches.
-->

## Summary

<!-- What does this PR do, and why? -->

Closes #<!-- issue number, or remove this line if none -->

## Affected component(s)

<!-- Mark all that apply (x inside the brackets). -->

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

<!-- Commands run, platforms/OS, manual steps, screenshots for UI. -->

## Checklist

- [ ] Lint/format pass for the touched component(s) (see `CONTRIBUTING.md`).
- [ ] Tests added or updated, and the suite passes.
- [ ] `CHANGELOG.md` updated for each affected component (technical detail).
- [ ] Docs / `architecture/` updated if behavior or a contract changed (spec-drift control).
- [ ] Commits follow Conventional Commits — `type(scope): message`.
- [ ] **If this is a `uxnanmobile` release:** `.github/whatsnew/whatsnew-{en-US,es-ES}` updated with short, non-technical notes (≤ 500 chars each).
- [ ] If a `shared` contract changed, all consumers (bridge/relay/mobile) were updated in the same change.
