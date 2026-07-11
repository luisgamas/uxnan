# FOR-HUMAN — uxnan-bridge

Assets only a human can provide (credentials, signing keys, binaries). The bridge
always builds and runs without them — a missing asset degrades a feature, never the
build.

_The bridge's own identity needs no secrets_ — its Ed25519 key is generated and
stored in the OS keychain at runtime (no key files to provide).

## Pending human asset

- [ ] **iOS APNs auth key** — create it in the Apple Developer console (needs a
      **paid** Apple Developer enrollment) and upload the `.p8` to Firebase → Cloud
      Messaging → Apple app configuration (Key ID + Team ID, bundle id
      `dev.luisgamas.uxnanmobile`). Then the bridge's existing FCM path delivers to
      iOS too. Android push is already live. Cross-ref: `uxnanmobile/FOR-HUMAN.md`.

## Operational setup (done on the maintainer's PC; required per machine)

These are not pending dev work — they're per-machine setup. Full how-to is in
[`docs/`](docs/):

- **Firebase service account** — the bridge sends push directly via FCM; drop a
  service-account JSON (same Firebase project `uxnan-app`) at
  `~/.uxnan/firebase-service-account.json` (default path, no env var; gitignored).
  Already in place on this PC (Android push live). Setup:
  [`docs/push-notifications.md`](docs/push-notifications.md).
- **Agent CLIs — install + login** — the bridge spawns each vendor's **official
  local CLI** over stdio and uses **your** existing login/billing; it stores no API
  keys. Install + log into each agent you want (OpenCode, Claude Code, Codex, pi,
  Gemini, Zero, Grok); a missing/logged-out CLI just shows `available: false`. Per-agent details
  + overrides: [`docs/agents.md`](docs/agents.md), [`docs/installation.md`](docs/installation.md).
- **`browseRoots`** — the folder(s) the phone may browse (e.g. your `Documents`).
  The browse API is root-confined, but the agent process is not OS-sandboxed beyond
  its `permissionMode`, so pick a folder you're comfortable giving a coding agent.
  Config: [`docs/configuration.md`](docs/configuration.md).

## Cross-references (assets owned by other components)

- **Firebase client config** (`google-services.json`, `GoogleService-Info.plist`)
  belongs to the **mobile app** (`uxnanmobile/FOR-HUMAN.md`).
- The **relay**'s optional push credential ([`../relay/FOR-HUMAN.md`](../relay/FOR-HUMAN.md))
  is only for a self-hosted hosted-relay setup; the canonical push owner is the bridge.
