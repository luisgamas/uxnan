# @uxnan/shared

Shared JSON-RPC and E2EE contracts for the Uxnan ecosystem. Consumed as a local
workspace dependency by the **bridge** and (later) the **relay**. The mobile app
keeps manually-synced Dart equivalents (see
`architecture/02e-bridge-integration.md` §4.2).

## What's inside

| Area | Exports |
|---|---|
| JSON-RPC | envelope types + constructors, error codes, `RpcError`, typed method registry |
| E2EE | handshake messages, transcript builder, `SecureEnvelope`, `PairingPayload` |
| Models | thread/turn/message, git, workspace, project/auth, session/trust |
| Agents | `IAgentAdapter`, `AgentCapabilities`, `AgentConfig` |
| Validation | Ajv validators for requests, responses, envelopes, pairing & push |

## Usage

```ts
import { makeRequest, isKnownMethod, validateJsonRpcRequest } from '@uxnan/shared';
```

## Develop

```bash
npm run build      # tsc → dist/
npm test           # tsc + node --test dist/test
npm run typecheck  # tsc --noEmit
```

Requires Node ≥18. The package is ESM-only.
