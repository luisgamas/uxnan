# FOR-DEV — pending developer work

Deferred implementation work (code the team/agent will do later). Distinct from
`FOR-HUMAN.md` (assets only a human can provide). Search the codebase for
`FOR-DEV:` to jump to the exact deferral sites.

> Convention defined in the root `AGENTS.md` → "Pending developer work".

---

## Pairing module

- ☐ **Manual-code pairing** — `ManualCodeScreen` + relay `GET /trusted-session/resolve?code=`
  (dio) to synthesize a `PairingPayload` (spec §5.5.3). Deferred: QR is the MVP
  method and the relay is not implemented yet.
- ☑ **Pairing/onboarding UI** — DONE: `OnboardingScreen` (Welcome/Features/
  Install/Pair), `QrScannerScreen` (`mobile_scanner` + permission gating),
  `UpdatePromptDialog`, routes and home CTA. Still open below.
- ☐ **iOS camera permission macro** — `permission_handler` needs
  `GCC_PREPROCESSOR_DEFINITIONS` `PERMISSION_CAMERA=1` in the iOS Podfile
  `post_install`. The Podfile is generated on the first macOS build; add the
  macro there or `Permission.camera` is compiled out on iOS.
- ☐ **`MyDevicesScreen` + `DeviceCard`** — list/switch trusted Macs
  (`SessionCoordinator.switchMac`), spec §5.5.6. Post-MVP-ish; not built yet.
- ☐ **On-device pairing verification** — the QR happy path needs a running
  bridge/relay to complete `processPairingPayload`; verify end-to-end once the
  bridge exists.
- ☐ **Standalone pairing use cases** — the spec lists `StartPairing`,
  `RegisterTrustedDevice`, `RemoveTrustedDevice` under `domain/usecases/pairing/`.
  Currently folded into `SessionCoordinator.processPairingPayload` +
  `ITrustedDeviceRepository`; split out only if the indirection earns its keep.

## Connection / transport

- ☑ **IncomingMessageProcessor** — DONE (conversation managers).
- ☐ **TransportSelector LAN discovery** — prefer a direct LAN socket before the
  relay (spec §5.9.3); needs mDNS/Bonjour + the iOS local-network permission.
- ☐ **Live WebSocket integration test** against a real bridge (current tests use
  an in-memory simulated bridge).

## Persistence

- ☑ **Message drift repository + `MessageContent`** — DONE (conversation domain
  layer).
- ☐ **Project drift repository** — `projects` table exists; the repository plus
  the `AgentConfig` type land with the projects module.

## Conversation / timeline

- ☐ **Advanced `MessageContent` types** — `approval`, `plan`, `subagent` (and
  their `ApprovalRequest` / `PlanState` / `SubagentState` payloads). Currently
  decoded as `UnknownContent` (lossless). Post-MVP per spec.
- ☑ **Application managers** — DONE: `ThreadManager` (timeline build + streaming
  reducer application, `loadThreads`, `sendUserMessage`) and
  `IncomingMessageProcessor`.
- ☐ **Remote history pagination** — `ThreadManager.loadMoreHistory` via
  `thread/turns/list` (cursor) → `TurnTimelineSnapshot.prependHistory`; plus
  `startNewThread`/`resumeThread`/`forkThread`. The bridge `thread/list` JSON
  shape is assumed (tolerant parser); verify against the real bridge.
- ☐ **Conversation UI** — `ConversationScreen`, message renderers (markdown,
  code, command card, diff viewer), `ComposerWidget` (+ `ComposerManager`),
  streaming/auto-scroll. Next increment, for visual review.

## Tooling

- ☐ Adopt `freezed`/`json_serializable` if/when entity boilerplate warrants it.
