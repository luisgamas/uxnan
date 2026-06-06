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
- ☐ **Pairing/onboarding UI** — `OnboardingScreen` (Welcome/Features/Install/Pair),
  `QrScannerScreen` (`mobile_scanner`), `UpdatePromptDialog`, `MyDevicesScreen`.
  Next increment (UI), using the M3 design tokens. Needs the `mobile_scanner`
  dependency and the camera permission (see `FOR-HUMAN.md`).
- ☐ **Standalone pairing use cases** — the spec lists `StartPairing`,
  `RegisterTrustedDevice`, `RemoveTrustedDevice` under `domain/usecases/pairing/`.
  Currently folded into `SessionCoordinator.processPairingPayload` +
  `ITrustedDeviceRepository`; split out only if the indirection earns its keep.

## Connection / transport

- ☐ **IncomingMessageProcessor** — domain-event classification of inbound
  messages (spec §5.2.5); lands with the conversation module.
- ☐ **TransportSelector LAN discovery** — prefer a direct LAN socket before the
  relay (spec §5.9.3); needs mDNS/Bonjour + the iOS local-network permission.
- ☐ **Live WebSocket integration test** against a real bridge (current tests use
  an in-memory simulated bridge).

## Persistence

- ☐ **Message/Turn/Project drift repositories** — tables exist; repositories +
  the `MessageContent` sealed hierarchy and `AgentConfig` land with their
  modules (conversation, projects).

## Tooling

- ☐ Adopt `freezed`/`json_serializable` if/when entity boilerplate warrants it.
