# FOR-HUMAN — uxnan-bridge

Assets only a human can provide (credentials, signing keys, binaries). The bridge
must always build and run without them.

## Open items

_None for the bridge itself._

The bridge needs no human-provided assets: its Ed25519 identity is generated and
stored in the OS keychain at runtime (no key files to provide).

### Cross-references (assets owned by other components)
- **Push credentials** (Firebase service account / APNs `.p8`) belong to the
  **relay** — see [`../relay/FOR-HUMAN.md`](../relay/FOR-HUMAN.md) (Phase 6).
- **Firebase client config** (`google-services.json`,
  `GoogleService-Info.plist`) belongs to the **mobile app** (`uxnanmobile`
  branch) so the phone can obtain an FCM token.
