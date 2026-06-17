# @uxnan/shared

Shared JSON-RPC and E2EE contracts for the Uxnan ecosystem. Consumed as a local
workspace dependency by the **bridge** and the **relay**. The mobile app keeps
manually-synced Dart equivalents (see
[`architecture/02b-contracts-and-requirements.md`](../architecture/02b-contracts-and-requirements.md)
§1 for the canonical contract list).

> **Status:** implemented. **59 JSON-RPC methods** + **8 streaming
> notifications**, lock-step in build-time with the `METHOD_NAMES` array and
> the `StreamNotification` enum (a compile-time assertion in
> `src/jsonrpc/method-registry.ts` fails the build on any drift).

## What's inside

| Area | Exports |
|---|---|
| JSON-RPC | envelope types + constructors (`makeRequest`, `makeNotification`, `makeResponse`, `makeErrorResponse`), error codes (`JsonRpcErrorCode` + Uxnan-specific `-32000..-32008`), `RpcError`, typed method registry (`JsonRpcMethodRegistry` + `METHOD_NAMES`), `isKnownMethod` |
| Streaming | `StreamNotification` enum + param types (`TurnStartedParams`, `MessageDeltaParams`, `ThinkingDeltaParams`, `ContentBlockParams`, `TurnCompletedParams`, `TurnUsage`, `TurnErrorParams`, `TurnAbortedParams`, `ModelResolvedParams`) |
| E2EE | handshake messages (`clientHello` / `serverHello` / `clientAuth` / `ready`), `buildHandshakeTranscript`, `SecureEnvelope`, `PairingPayload` v2 (`relay` optional + `hosts: string[]`) with `Base64(utf8(JSON))` QR encoding |
| Models | thread / turn / message (with `MessageContent` polymorphic blocks), git, workspace (incl. `browseDirs` + `exists`), project, auth, session/trust, approval |
| Agents | `IAgentAdapter` (with `respondApproval`, `listModels`, `nativeSessionId`, `SendTurnOptions { cwd?, model?, options?, attachments?, approvalResponse? }`), `AgentCapabilities` (incl. `images`, `approvals`, `reportsContextUsage`), `AgentConfig` (cwd, agentId, model, plus optional `binaryPath`/`extraArgs`) |
| Validation | Ajv validators for requests, responses, envelopes, pairing payload, push payloads |

## Usage

```ts
import {
  makeRequest,
  isKnownMethod,
  validateJsonRpcRequest,
  METHOD_NAMES,
  type AgentModel,
  type PairingPayload,
} from '@uxnan/shared';
```

## Develop

```bash
npm run build      # tsc → dist/
npm test           # tsc + node --test dist/test
npm run typecheck  # tsc --noEmit
```

Requires Node ≥18. The package is ESM-only.

## Source of truth

The canonical contract list lives in this package — see
[`src/jsonrpc/method-registry.ts`](src/jsonrpc/method-registry.ts) (`METHOD_NAMES`)
and [`src/jsonrpc/notifications.ts`](src/jsonrpc/notifications.ts)
(`StreamNotification`). The spec mirrors it in
[`architecture/02b-contracts-and-requirements.md`](../architecture/02b-contracts-and-requirements.md)
§1.2 / §1.4. Per `AGENTS.md` → *Spec drift control*, any change here MUST be
reflected in the spec in the same change set.

## Publish (planned)

`@uxnan/shared` is published to npm **first**; `uxnan-bridge` and `uxnan-relay`
then pin `"@uxnan/shared": "^0.x"` instead of the `"*"` workspace spec they
use today. See `bridge/FOR-DEV.md` → *Packaging*.
