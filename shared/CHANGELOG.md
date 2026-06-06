# Changelog — @uxnan/shared

All notable changes to the shared contracts package are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Initial `@uxnan/shared` contracts package (TypeScript, ESM, Node ≥18).
- JSON-RPC 2.0 envelope types and constructors (`makeRequest`, `makeNotification`,
  `makeResponse`, `makeErrorResponse`) plus type guards.
- JSON-RPC error codes (`JsonRpcErrorCode`) including Uxnan-specific codes
  (-32000..-32008) and the `RpcError` class.
- Typed method registry (`JsonRpcMethodRegistry`, `MethodParams`, `MethodResult`)
  and a runtime method list (`METHOD_NAMES`, `isKnownMethod`) kept in lock-step
  via a compile-time assertion.
- E2EE types: handshake messages (`clientHello`/`serverHello`/`clientAuth`/`ready`),
  the canonical transcript builder (`buildHandshakeTranscript`), the encrypted
  `SecureEnvelope`, and the v2 `PairingPayload` with validation/parse helpers.
- Protocol constants mirroring the mobile `protocol_constants.dart`.
- Domain models: thread/turn/message, git, workspace, project/auth, session/trust.
- Agent contracts: `IAgentAdapter`, `AgentCapabilities`, `AgentConfig`.
- Push payloads and runtime validators (Ajv) for requests, responses, E2EE
  envelopes, pairing payloads and push payloads.

### Notes
- JSON Schemas are authored as typed TS objects under `src/validators/json-schema/`
  (rather than standalone `.json` files as sketched in the architecture) so they
  are bundled, type-checked, and free of ESM import-attribute friction.
- The pairing QR string uses compact JSON; the exact encoding must be verified
  against the mobile `PairingPayload.fromQrString` before real pairing.
