# uxnanmobile — developer docs

![Flutter](https://img.shields.io/badge/Flutter-Android_%7C_iOS-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Architecture](https://img.shields.io/badge/Clean_Architecture-Riverpod_3.x-0553B1?style=for-the-badge)
![Spec](https://img.shields.io/badge/source_of_truth-architecture%2F-blue?style=for-the-badge)

Reference documentation for working **inside** the Flutter app. This is the
as-built developer guide; the canonical product/design spec lives in the
monorepo's [`architecture/`](../../architecture/00-index.md) (PRD + SRS) and
takes priority where the two differ.

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | The real code map: Clean-Architecture layers, directory layout, the Riverpod provider/DI graph, and how data flows from the bridge to the UI. |
| [testing.md](testing.md) | How to run analyze/test/build, the test layout, the testing patterns used here, and what still needs a real device/bridge. |
| [conventions.md](conventions.md) | The working agreement: Riverpod-manual style, Material 3 tokens + skills, l10n workflow, `FOR-DEV`/`FOR-HUMAN`, commit scopes, the UI review rule, and the security non-negotiables. |
| [neural-expressive-design.md](neural-expressive-design.md) | The UI design language (Material 3 Expressive / Neural Expressive): spring-motion tokens, transparent app bars + scroll veil, Icon Surfaces, focus-responsive pill input + compact turn-context shelf + "+" media menu, dynamic-corner card lists, breakpoints. Follow it for new/redesigned screens. |

Related files (not in `docs/`):

- [`../README.md`](../README.md) — app intro + quickstart (build/run, status).
- [`../CHANGELOG.md`](../CHANGELOG.md) — what shipped, under `[Unreleased]`.
- [`../FOR-DEV.md`](../FOR-DEV.md) — pending developer work (greppable `FOR-DEV:`).
- [`../FOR-HUMAN.md`](../FOR-HUMAN.md) — assets only a human can provide.
- [`../../AGENTS.md`](../../AGENTS.md) — monorepo-wide agent guidelines.
- Node-side testing (`bridge` / `relay` / `shared`) lives in each component's docs
  — [`../../bridge/docs/testing.md`](../../bridge/docs/testing.md) and
  [`../../relay/docs/testing.md`](../../relay/docs/testing.md); the mobile testing
  guide is [testing.md](testing.md).
