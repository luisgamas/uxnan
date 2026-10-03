# Uxnan — Arquitectura del Sistema y Modulos

> **Version:** 1.6.2
> **Fecha:** 2026-10-03
> **Estado:** Definicion inicial — documento de arquitectura tecnica, sincronizado con codigo ALPHA
> **Plataformas objetivo:** Android (principal), iOS (principal)
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod

> **Executive summary (1.6.2):** the relay is the last resort. The bridge
> publishes where it listens **now** — `BridgeSettings.hosts`, its live
> `host:port` list (LAN + Tailscale; no virtual or link-local adapter) — and
> follows the PC across networks (interfaces checked every 15 s; a change takes
> a settings revision and re-announces mDNS). A phone stores it, over the relay
> too, and moves to the new direct address; when its stored addresses fail it
> finds its PC on the local network by mDNS (TXT `id`) before using the relay.
> Before this, a PC's addresses only travelled in the pairing QR, so a phone
> kept dialling the pairing day's network and fell back to the relay right next
> to its PC (§5.8.17, §5.9.3).

> **Executive summary (1.6.1):** found on a real phone switching from mobile
> data to Wi-Fi. The bridge now closes a phone connection that has received
> nothing for **90 s** (three missed 25 s heartbeats) — a relay channel whose
> phone side died used to stay open forever — and a phone's newer connection
> closes its older one. The phone no longer waits on its old connection's
> goodbye when switching (it hung on a dead socket). Every phone connection
> carries its **route** — `lan`, `tailscale` (`100.64.0.0/10`,
> `fd7a:115c:a1e0::/48`) or `relay` — in presence and `bridge/connectedPhones`
> (§5.8.17, §5.9.3). A phone on the relay that changes network tries the
> PC's direct addresses once and moves to one that answers; with no direct
> path and no relay it fails with `noRoute` and says why.

> **Executive summary (1.6.0):** the relay is now **each user's own**: a
> Cloudflare Worker with one SQLite-backed Durable Object per bridge, which the
> **bridge deploys into the user's own Cloudflare account** (free plan) through
> the REST API — `uxnan-bridge relay setup` or `relay/setup` from any client.
> Uxnan hosts no relay and there is no default URL; LAN and Tailscale stay
> direct and are tried first (§2, §5.9.3). The relay authenticates every socket
> with an Ed25519 challenge before it forwards anything — bridges by the keys
> it was deployed with, phones by the bridge's allow list or a one-time pairing
> ticket — then forwards E2EE frames blindly; a revoked phone is cut off at
> once; an idle bridge costs nothing (hibernation) (§5.10.1). Seven new methods
> `relay/status|setup|use|set|update|rotate|remove` and `stream/relay/updated`;
> the endpoint is the shared setting `BridgeSettings.relay`, so a phone paired
> at home reaches the PC from anywhere without pairing again. The pairing QR
> moves to **v3** (`relay: {url, routingId, ticket?}`, §5.5.4), the pairing
> window now gates the relay path too (§5.9.1), and the §5.9.1 constants are
> corrected (`SECURE_PROTOCOL_VERSION = 2`, `PAIRING_WINDOW_MS` = 5 min). The
> old Node relay (`x-role` / `x-session-id`) is gone.

> **Executive summary (1.5.9):** the access mode is a contract, not a
> suggestion: each of `requestApproval`, `approveForMe`, `fullAccess` and the
> new `plan` means the same on every agent; each agent declares the modes it
> can honor (`AgentCapabilities.accessModes`, replacing `planMode`) and its
> default; the bridge starts a conversation in that default, refuses a mode
> the agent cannot keep, and runs a stored one it no longer offers as the
> default, which both apps say. Per-CLI mapping, verified live, in
> `bridge/docs/agents.md` → *Access modes* (02b `thread/setAccessMode`).

> **Executive summary (1.5.8):** background push is delivered **only by the
> bridge, straight to FCM** (§5.10.2). The relay push fallback is gone: the
> relay has no `/push/*` endpoints, no token store and no state on disk, so it
> never sees a phone's push token or a notification's title and body. Without a
> Firebase service account on the PC, background push is off
> (`notifications/register` → `registered: false`) and the phone's foreground
> notifications keep working. The phone no longer reserves a
> `notificationSecret` secure-storage key (§5.3.3).

> **Executive summary (1.5.7):** Claude Code's background work is waited for
> across **every** wake-up, not just the first: the bridge keeps the CLI's input
> open from one wake-up to the next, so a wake-up that starts more background
> work ("CI is green; now I wait for the release") is waited for too, and the
> turn completes when Claude ends one with nothing left running (§5.8.14).
> OpenCode 2 comes back too — its shell tool can move a command to the
> background and the server wakes the model when it ends — and its turn is now
> held the same way, so that report lands in the conversation. Every other
> wired agent was re-measured: none comes back on its own. Internal to the
> bridge: no contract changes.

> **Executive summary (1.5.6):** every queued message — the first one too —
> stays editable, cancellable and sendable now until the agent is handed it,
> which happens when the step the agent is in **ends** (not when it starts), so
> a long or hung command never locks a message the person wants back
> (§5.8.13). `queue/sendNow` while a turn runs now **stops** that turn and runs
> the chosen message next, on every agent — the one way to reach an agent stuck
> in a step. OpenCode waits for its server to close a stopped run before the
> stop counts, so the next turn starts clean.

> **Executive summary (1.5.5):** a message sent while the agent works always
> waits in the queue — visible, editable, cancellable — and an agent that takes
> input mid-turn gets the first one at its **next pause**: while it is inside a
> step, which it reads when that step ends (§5.8.13). Until then the message is
> marked as being delivered (`deliveringTurnId` on `stream/queue/updated`,
> `QueueStateResult`, and `TurnList.queueDeliveringTurnId`) and can no longer be
> taken back; it is placed in the conversation when the agent reads it (Claude
> Code, by its echo) or when the step ends (Codex, OpenCode, pi). `queue/sendNow`
> no longer delivers mid-turn. Agents without an input channel mid-turn (Zero,
> Grok, Antigravity) keep the message until their turn ends.

> **Executive summary (1.5.4):** the phone's navigation is three single
> layers. `pane_navigation.dart` owns opening and going back — every back arrow
> and every "open this" goes through it, it asks each screen before popping it
> (unsaved edits) and never opens twice what is on screen; `RouteFacts` is the
> one reader of what a location belongs to and what is one level up; and the
> drawer's PC is the route's, else a persisted **PC in focus** checked against
> the paired PCs. A conversation reads its own timeline, never whatever is in
> front, and the two panes are separate semantics containers (§5.4.3).
> App-only: no contract changes.

> **Executive summary (1.5.3):** a working folder's files and source control
> belong to the folder, not to a conversation. On the phone they are routes of
> their own (`/workspace/files?cwd=…`, `/workspace/git?cwd=…`, §5.4.3), opened
> from a conversation's bar and straight from a folder row in the threads list
> (§5.4.2); the screens moved to `presentation/screens/workspace/`, and the git
> state the app shows is kept per `cwd`. App-only: no contract changes.

> **Executive summary (1.5.2):** a bridge turn that ended before it received
> any of its reply — a crash, or an older bridge that ended a Claude Code turn
> on a wake-up's `result` — takes the reply the agent went on to write in its
> own transcript, in its own place (§5.8.8), instead of gaining it as a new turn
> at the end of the conversation. §5.8.14 now records that every adapter ends a
> turn on a protocol event, and that Claude Code's background work is waited for
> in full while the bridge keeps its input open. Internal to the bridge: no
> contract changes.

> **Executive summary (1.5.1):** no agent process outlives a bridge that is
> killed hard (§5.8.3). The daemon records every agent process it starts in
> `~/.uxnan/agent-processes.json` and, when it starts after a `SIGKILL` or a
> crash, ends only the recorded processes that are still running, orphaned and
> still the recorded command started at the recorded time — on macOS, Linux and
> Windows, with no native module. Internal to the bridge: no contract changes.

> **Executive summary (1.5.0):** the bridge owns its own update (§5.8.18). It
> checks the npm registry itself every hour while it runs (a daemon that learned
> of a release a day late was the bug), installs the published version and
> restarts on it (`bridge/update`), and tells every client with
> `stream/bridge/updated`; `bridge/status` carries it as `update: BridgeUpdate`.
> Uxnan Desktop and every paired phone offer the same one-tap update through
> that one owner — never under a running turn. The desktop's own npm path is
> left only for what the bridge cannot do for itself: installing it, and
> updating a bridge that predates updating itself.

> **Executive summary (1.4.1):** a message the agent takes into its running
> turn (steering, §5.8.13) now ends that turn there and carries the rest of the
> agent's run as its own turn, so the answer shows under the message it
> answers on every client (the `delivered` status and `stream/turn/delivered`
> are gone). The turn it ended names that one (`Turn.continuedIn`), so a client
> shows its reply as the answer so far — not a closing one folded away — and
> an adapter reports a message as taken only when that run will answer it. And every Uxnan Desktop profile is its own client
> on the local control channel (`desktop-<profile>`, §5.8.15): the installed app
> and a development build running at once no longer share one name, so neither
> supersedes the other, and each keeps its own replay log, presence and the
> tools the bridge's agents get from it.

> **Executive summary (1.4.0):** one layer. The bridge is the single source of
> truth for projects (a persistent, mirrored registry — add or remove on any
> client, conversations are never deleted with a project), conversations,
> shared settings (the `home` start folder), presence and installed agents;
> phones and Uxnan Desktop are replicas that converge through revisioned
> `sync/changes`, never by trusting that every notification arrived. Turns
> carry a canonical `seq`, titles are named only by the bridge, opening a
> conversation no longer un-archives it, agent detection follows one table
> shared with the desktop plus the user's login-shell PATH, and the bridge runs
> as the user's service (§5.8.17).

> **Executive summary (1.3.0):** the bridge is the single owner of every
> conversation and any number of clients drive it at once — paired phones over
> E2EE and Uxnan Desktop over a new loopback-only, token-gated local control
> channel (§5.8.15) that serves the same router and registers the desktop as one
> more receiver with its own `seq` and replay. Everything that changes a thread
> is broadcast (§5.8.16): `stream/thread/updated` (replacing
> `stream/thread/renamed`), `stream/thread/deleted`, `stream/turn/created` (the
> user's message, before the answer, with the sender's `clientTurnId` echo) and
> `stream/approval|question/resolved`, so a thread started or answered on one
> client appears on the other without a refresh.

> **Executive summary (1.2.3):** native assistant messages inside one turn are
> preserved losslessly through durable response-boundary metadata; terminal
> payloads reconcile additively and mobile collapses completed progress replies
> without discarding them. Profile activity is owned by a complete,
> global-per-PC bridge ledger. Conversation deletion never subtracts historical
> metrics; export/import includes conversations, messages, sessions and Git
> actions (what the agents spent is read from each CLI's history by
> `usage/summary`, never kept in the ledger). Phone transport identity remains installation-local
> and is not used as an activity-profile identity. LAN discovery is an
> unauthenticated host hint, emitted explicitly on every eligible IPv4 interface;
> it never carries the pairing code and never bypasses the operator-gated E2EE
> enrollment. The mobile workspace browser now selects viewers by file
> capability: it preserves editable source and Git changes while adding guarded
> GitHub-style Markdown resources, animated raster and SVG rendering, and native
> Android/iOS PDF preview. Local resource paths remain workspace-confined, and
> the bridge preserves bounded PDF bytes as base64 without changing the RPC
> response shape.

> **Regla de mantenimiento (ver `AGENTS.md` → *Spec drift control (non-negotiable)*):**
> este documento es la **fuente de verdad** de la arquitectura del sistema.
> Cualquier item marcado `DONE` / `DONE & validated end-to-end` en los
> `FOR-DEV.md` de `uxnanmobile/`, `bridge/`, `relay/`, `shared/` o
> `uxnandesktop/` debe reflejarse aquí en el **mismo conjunto de cambios**,
> no solo en el `CHANGELOG.md`. Si un item contradice esta spec, abrir un
> `FOR-DRIFT` en el `FOR-DEV.md` correspondiente. La spec NO debe quedar
> atrás del código en un release.

> Este documento forma parte de la documentacion tecnica de Uxnan. Ver tambien: [01-product-vision.md](01-product-vision.md) | [02b-contracts-and-requirements.md](02b-contracts-and-requirements.md) | [02c-implementation-guide.md](02c-implementation-guide.md) | [03-technical-reference.md](03-technical-reference.md)

---

## Tabla de contenidos

1. [Componentes del sistema](#1-componentes-del-sistema)
2. [Topologias de conexion](#2-topologias-de-conexion)
3. [Agent Adapter — interfaz contractual](#3-agent-adapter--interfaz-contractual)
4. [Configuracion de agente por proyecto](#4-configuracion-de-agente-por-proyecto)
5. [Modulos del sistema](#5-modulos-del-sistema)
   - [5.1 Capa de dominio](#51-capa-de-dominio)
   - [5.2 Capa de servicios / aplicacion](#52-capa-de-servicios--aplicacion)
   - [5.3 Capa de infraestructura](#53-capa-de-infraestructura)
   - [5.4 Capa de UI / presentacion](#54-capa-de-ui--presentacion)
   - [5.5 Modulo de pairing y onboarding](#55-modulo-de-pairing-y-onboarding)
   - [5.6 Modulo de timeline y turn handling](#56-modulo-de-timeline-y-turn-handling)
   - [5.7 Modulo de integracion Git](#57-modulo-de-integracion-git)
   - [5.8 Bridge daemon local (PC)](#58-bridge-daemon-local-pc)
   - [5.9 Transporte seguro y mensajeria E2EE](#59-transporte-seguro-y-mensajeria-e2ee)
   - [5.10 Relay y notificaciones push](#510-relay-y-notificaciones-push)
6. [Modelos de dominio](#6-modelos-de-dominio)
7. [Estructura de directorios del proyecto Flutter](#7-estructura-de-directorios-del-proyecto-flutter)

---

## 1. Componentes del sistema

| Componente | Tecnologia | Rol |
|---|---|---|
| **App movil Uxnan** | Flutter / Dart | Cliente movil: UI, transporte, estado |
| **Uxnan Bridge** | Node.js daemon | Agente de control local en la PC |
| **Uxnan Relay** | Cloudflare Worker + Durable Object (SQLite) | Relay propio del usuario, desplegado por el bridge en su cuenta de Cloudflare: autentica y luego retransmite frames E2EE opacos (opcional, sin push) |
| **Agent Adapters** | Node.js | Adaptadores por agente (Codex, OpenCode, etc.) |

---

## 2. Topologias de conexion

> **Dirección (2026-06-12):** el producto es **bridge-first**. Las topologías
> primaria y recomendada son LAN-direct y Tailscale-direct (cero hosting,
> cero credenciales). El relay es el fallback off-LAN: desde 2026-10 es el
> relay **propio de cada usuario**, que el bridge despliega en su cuenta de
> Cloudflare (§5.10). Uxnan no hospeda ningún relay.

**Topologia 1 — LAN directa (PRIMARIA):**
```
[Movil] ──WebSocket LAN──→ [Bridge directo]
```
Cuando el movil y la PC estan en la misma red, la app se conecta directamente
al bridge. El bridge expone su `host:port` LAN en el `PairingPayload`
(`hosts: string[]`); el `TransportSelector` del movil prueba cada host directo
con un timeout corto antes de cualquier fallback. La conexion sigue siendo
E2EE extremo a extremo.

**Topologia 2 — Tailscale / mesh VPN directa (RECOMENDADA para remoto):**
```
[Movil] ──WSS 100.x──→ [Bridge directo]
```
Cuando el movil y la PC estan en la misma red Tailscale (o cualquier mesh
VPN). El bridge detecta su direccion Tailscale (`100.x`) y la anuncia en
`hosts`. Cero hosting, cero relay, E2EE intacto. Es la opción recomendada
para acceder desde fuera de la LAN sin desplegar un relay.

**Topologia 3 — Relay propio del usuario (FALLBACK off-LAN):**
```
[Movil] ──WSS──→ [Relay del usuario: Worker + Durable Object en SU cuenta de Cloudflare] ←──WSS── [Bridge]
```
Cuando el movil esta fuera de la LAN y no hay Tailscale. El bridge mantiene
abierto un socket de control hacia su sala del relay; el movil marca al relay
y el bridge abre un canal por telefono. Tras autenticar a ambos lados con
Ed25519, el relay retransmite frames E2EE opacos; nunca ve el contenido. Es
**opcional**: no existe hasta que el usuario corre `uxnan-bridge relay setup`
(o `relay/setup` desde cualquier cliente), y el bridge lo anuncia en el QR solo
mientras esta configurado y habilitado (§5.10).

**Notas:**
- El QR codifica `PairingPayload` como **Base64 del UTF-8 del JSON**
  (v3 del pairing), no como JSON plano. `PairingValidator` requiere al
  menos un transporte (`relay` o `hosts`); emite `missing_transport` si
  ambos faltan.
- El relay es ademas un ajuste compartido (`BridgeSettings.relay`): un
  telefono emparejado en la LAN lo aprende por `sync/changes` y puede salir de
  casa sin volver a emparejar.

---

## 3. Agent Adapter — interfaz contractual

> **Cambios desde la v1 (2026-06):** la interfaz gano `listModels()` con
> `AgentModel[]` estructurado (en lugar de `string[]`), `respondApproval()`
> para aprobaciones interactivas, `nativeSessionId()` para que el bridge
> localice la sesion on-disk del agente, y `attachments` en `sendTurn()`.
> `AgentCapabilities` ahora incluye `reportsContextUsage`, `reportsCompaction`
> e `images`; `AgentDescriptor.deprecated?` retira un adapter sin romper el
> contrato de instalaciones antiguas.
> **(2026-07)** se agregaron `listCommands()`/`expandCommand()` para los
> comandos "slash" del agente (`agent/commands`), `command?` en `sendTurn()`
> para invocarlos, y `commands?` en `AgentCapabilities`.
> Ver `shared/src/agents/agent-adapter.ts` para la fuente de verdad
> TypeScript; esta seccion documenta el contrato, no la sintaxis.

Todos los adaptadores deben implementar la interfaz `IAgentAdapter` en el Bridge:

```typescript
interface IAgentAdapter {
  // Identidad
  readonly agentId: string;          // codex | opencode | claude-code | antigravity-cli | pi-agent | zero | grok | custom
  readonly displayName: string;
  readonly version: string;
  readonly capabilities: AgentCapabilities;

  // Lifecycle
  initialize(config: AgentConfig): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  // Threads
  listThreads(params: ListThreadsParams): Promise<ThreadList>;
  readThread(threadId: string): Promise<Thread>;
  resumeThread(threadId: string): Promise<void>;
  startThread(params: StartThreadParams): Promise<Thread>;
  forkThread(threadId: string, params: ForkParams): Promise<Thread>;
  listTurns(threadId: string, params: PaginationParams): Promise<TurnList>;
  // PaginationParams: { cursor?, limit?, fromEnd? } — `fromEnd:true` => ultima pagina (newest).
  // TurnList: { turns, nextCursor?, total? } — `total` permite paginar hacia atras (newest-first).

  // Turns / conversacion
  startTurn(threadId: string, params: TurnParams): Promise<Turn>;
  sendTurn(
    threadId: string,
    content: TurnContent,
    options?: SendTurnOptions  // { cwd?, model?, options?: Record<string, string|boolean>, attachments?: TurnAttachment[], approvalResponse?: ApprovalResponse, questionResponse?: QuestionResponse, command?: AgentCommandInvocation }
  ): Promise<TurnResult>;

  // Aprobaciones interactivas (opt-in por agente)
  // El agente emite un `approval` content block en el stream;
  // el bridge lo entrega a la app y, cuando el usuario responde,
  // invoca respondApproval(approvalId, decision) para desbloquear el hook.
  respondApproval?(threadId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;

  // Modelo discovery (retorna AgentModel[] estructurado, no string[])
  listModels?(): Promise<AgentModel[]>;   // id, displayName, description?, version?, isDefault?, options?: AgentModelOption[]

  // Command discovery + expansion (comandos "slash" del agente → agent/commands)
  listCommands?(cwd?: string): Promise<AgentCommand[]>;         // name, description?, argumentHint?, source, headlessSupported?
  expandCommand?(name: string, args?: string, cwd?: string): Promise<string>;  // solo custom prompt-template agents; nativos (Claude/ACP) no lo implementan

  // Native session identity: the id the CLI resumes and its transcript is named
  // after (completed-turn convergence in turn/list, continuity after a restart).
  // Held once, in BaseAgentAdapter, for every adapter.
  nativeSessionId(threadId: string): string | undefined;
  // Continue a conversation in a native session this process did not open (the
  // stored id after a bridge restart, or a terminal's session taken over). Never
  // replaces a live one, never takes back an id the CLI refused to resume.
  adoptNativeSession(threadId: string, sessionId: string): void;

  // Git
  gitStatus(cwd: string): Promise<GitRepoStatus>;
  gitDiff(cwd: string, path?: string): Promise<GitDiff>;
  gitCommit(params: GitCommitParams): Promise<GitCommitResult>;
  gitPush(params: GitPushParams): Promise<GitPushResult>;
  gitPull(params: GitPullParams): Promise<GitPullResult>;
  gitCheckout(params: GitCheckoutParams): Promise<void>;
  gitCreateBranch(params: GitBranchParams): Promise<GitBranchResult>;
  gitCreateWorktree(params: GitWorktreeParams): Promise<GitWorktreeResult>;
  gitRevert?(cwd: string): Promise<GitRevertResult>;
  gitDeleteBranch?(cwd: string, branch: string, force?: boolean): Promise<void>;
  gitRemoveWorktree?(cwd: string, worktreePath: string, force?: boolean): Promise<void>;

  // Workspace
  readFile(path: string): Promise<FileContent>;
  readImage(path: string): Promise<ImageContent>;
  listWorkspace(cwd: string): Promise<WorkspaceListing>;
  captureCheckpoint(params: CheckpointParams): Promise<Checkpoint>;
  diffCheckpoint(checkpointId: string): Promise<CheckpointDiff>;
  applyCheckpoint(checkpointId: string): Promise<void>;
  applyPatchChanges(changes: PatchChange[]): Promise<ApplyResult>;
  // Confinado a un root configurado; emite -32004 si hay escape
  browseDirs?(rootId?: string, path?: string): Promise<BrowseResult>;
  exists?(cwd: string): Promise<{ exists: boolean; isGitRepo?: boolean }>;

  // Auth (si aplica al agente)
  getAuthStatus(agentId: string): Promise<AuthStatus>;   // sanitizado: NUNCA tokens
  startLogin(provider: string): Promise<LoginSession>;
  cancelLogin(sessionId: string): Promise<void>;
  logout(): Promise<void>;

  // Proyectos
  listProjects(): Promise<Project[]>;                   // cada Project puede llevar agentId/model pins
  resolveProject(cwd: string): Promise<Project>;

  // Notificaciones (gestiona el bridge, no el adaptador)
  registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void>;
  notifyCompletion(threadId: string, turnId: string): Promise<void>;
}

interface AgentCapabilities {
  // Fuente de verdad: shared/src/agents/agent-capabilities.ts (TypeScript).
  accessModes?: AccessMode[];      // modos de acceso que el agente puede cumplir (02b thread/setAccessMode)
  defaultAccessMode?: AccessMode;  // modo de un hilo nuevo o con un modo que el agente ya no ofrece
  streaming: boolean;              // emite deltas de tokens en streaming
  approvals: boolean;              // emite content blocks `approval` (gating de tools, opt-in por agente)
  forking: boolean;                // soporta forking / reanudar threads
  images: boolean;                 // acepta TurnAttachment[] (image) en sendTurn
  reportsContextUsage: boolean;    // emite `usage` en turn/completed (ausente/false = no reporta uso)
  reportsCompaction?: boolean;     // emite un bloque `compaction` solo ante una señal real del agente
  autonomous?: boolean;            // corre en modo autónomo ("YOLO") por defecto: actúa/edita sin pedir aprobación
}

// Nota histórica (pre-2026-06): esta interfaz antes listaba supportsGit /
// supportsWorktrees / supportsCheckpoints / supportsVoice / supportsSubagents /
// supportsPlanMode / supportsMultipleProjects / supportsThreadFork /
// sessionsFormat. Esos campos se movieron a AgentDescriptor o se eliminaron; el
// contrato vigente es el de arriba.

// Agentes actualmente implementados (ver bridge/CHANGELOG.md):
//   ✅ opencode  (default; `opencode serve` HTTP/SSE, OpenCode 1 y 2: un cliente de protocolo por version mayor elegido por `opencode --version`, 2.x con password por proceso y rutas `/api/*`; sesión de server por thread persistida para continuidad; plan nativo vía `todo.updated`; steer en turno; **`permission.asked` real approvals**)
//   ✅ claude-code (`claude -p --input-format stream-json --output-format stream-json --replay-user-messages`; --resume; `steer` en turno; **PreToolUse hook** real approvals)
//   ✅ codex     (`codex app-server`; JSON-RPC over stdio, un proceso por turno — Codex sólo admite UN writer por thread, así que el bridge lo suelta al terminar el turno y reengancha con `thread/resume`; `thread/start`/`turn/start` + every elicitation; `turn/steer` en turno)
//   ✅ pi-agent  (`pi --mode rpc`, UN proceso residente por thread; `--session-id` con el id leido de `get_state`; `steer` en turno; **autonomous=true**: YOLO headless, no pre-tool protocol — see FOR-DEV)
//   ✅ antigravity-cli (`agy --input-format stream-json --output-format stream-json --add-dir <cwd>`, UN proceso residente por thread; `--conversation <id>` con el id que `agy` anuncia en `init` (no client-owned: 1.2.x rechaza un id desconocido); usage en `stream/turn/completed`; **autonomous=true**: `--dangerously-skip-permissions`, requestApproval→`--mode plan` read-only; models via `agy models`)
//   ✅ zero      (`zero acp` ACP JSON-RPC over stdio; session/prompt turns; **session/request_permission real approvals**; plan; models via `zero models list`)
//   ✅ grok      (`grok agent stdio` ACP JSON-RPC over stdio; session/prompt turns; **session/request_permission real approvals**; plan; models via own discovery)
```

---

## 4. Configuracion de agente por proyecto

La app permite que cada proyecto/conexion especifique que agente usa, como localizarlo y que configuracion tiene:

```json
{
  "projectId": "uuid",
  "displayName": "Mi Proyecto Backend",
  "cwd": "/Users/dev/projects/backend",
  "agentId": "opencode",
  "agentConfig": {
    "binaryPath": "/usr/local/bin/opencode",
    "modelProvider": "anthropic",
    "model": "claude-opus-4-6",
    "apiKeyEnvVar": "ANTHROPIC_API_KEY"
  },
  "bridgeConfig": {
    "relay": { "url": "wss://uxnan-relay.<subdominio>.workers.dev", "routingId": "<32 hex>", "enabled": true },
    "sessionId": "...",
    "macDeviceId": "..."
  }
}
```

---

## 5. Modulos del sistema

### 5.1 Capa de dominio

**Ubicacion en Flutter:** `lib/domain/`

La capa de dominio define el vocabulario del sistema. No depende de Flutter, de ningun paquete externo, ni de detalles de transporte, red o UI. Es Dart puro.

#### 5.1.1 Entidades principales

```dart
// lib/domain/entities/thread.dart
class Thread {
  final String id;
  final String title;             // bridge title; first prompt replaces only a placeholder
  final String? projectId;
  final String? cwd;
  final String? worktreePath;
  final ThreadSyncState syncState;
  final ThreadStatus status;
  final DateTime? lastActivity;
  final String agentId;  // que agente maneja este thread
  const Thread({...});
}

// lib/domain/entities/message.dart
class Message {
  final String id;
  final String threadId;
  final String turnId;
  final MessageRole role;        // user | assistant | system | tool
  final List<MessageContent> contents;
  final MessageDeliveryState deliveryState;
  final int orderIndex;          // contador monotonico para orden
  final String? fingerprint;     // para deduplicacion
  final DateTime createdAt;
  const Message({...});
}

// lib/domain/entities/turn.dart
class Turn {
  final String id;
  final String threadId;
  final TurnStatus status;       // pending | running | completed | error | aborted
  final List<Message> messages;
  final TurnGitActionProgress? gitProgress;
  final SubagentState? subagentState;
  final PlanState? planState;
  final DateTime startedAt;
  final DateTime? completedAt;
  const Turn({...});
}

// lib/domain/entities/project.dart
class Project {
  final String id;
  final String displayName;
  final String cwd;
  final String agentId;
  final AgentConfig agentConfig;
  final DateTime? lastActive;
  const Project({...});
}

// lib/domain/entities/secure_session.dart
class SecureSession {
  final String sessionId;
  final String macDeviceId;
  final String phoneDeviceId;
  final Uint8List derivedKey;      // AES-256 derived via HKDF
  final int bridgeOutboundSeq;     // ultimo seq recibido del bridge
  final int phoneOutboundSeq;      // proximo seq a enviar
  final int keyEpoch;
  final HandshakeMode mode;        // qrBootstrap | trustedReconnect
  const SecureSession({...});
}

// lib/domain/entities/trusted_device.dart
class TrustedDevice {
  final String macDeviceId;
  final String displayName;
  final Uint8List macIdentityPublicKey;  // clave publica Ed25519 del bridge
  final RelayEndpoint? relay;            // relay propio del PC {url, routingId, enabled}; null sin relay
  final List<String> hosts;              // direcciones directas LAN/Tailscale
  final String sessionId;
  final DateTime pairedAt;
  final DateTime? lastSeen;
  const TrustedDevice({...});
}

// lib/domain/entities/pairing_payload.dart
class PairingPayload {
  final int version;                      // PAIRING_QR_VERSION = 3
  final RelayEndpoint? relay;             // {url, routingId} del relay propio (opcional)
  final String? relayTicket;              // ticket de un solo uso (solo para emparejar)
  final List<String> hosts;
  final String sessionId;
  final String macDeviceId;
  final Uint8List macIdentityPublicKey;
  final String displayName;
  final DateTime expiresAt;
  const PairingPayload({...});
}

// lib/domain/entities/git_repo_state.dart
class GitRepoState {
  final String branch;
  final String? upstream;
  final bool isDirty;
  final int ahead;
  final int behind;
  final GitDiffTotals diffTotals;
  final List<GitChangedFile> changedFiles;
  const GitRepoState({...});
}

// lib/domain/entities/workspace_checkpoint.dart
class WorkspaceCheckpoint {
  final String id;
  final String threadId;
  final String? description;
  final List<CheckpointFile> files;
  final DateTime createdAt;
  const WorkspaceCheckpoint({...});
}
```

#### 5.1.2 Enumeraciones de dominio

> ✅ **Implementado** (rama `uxnanmobile`): los 8 enums en `lib/domain/enums/` (uno por archivo). `AgentId` añade mapeo a `wireId` estable con fallback a `custom`.

```dart
enum MessageRole { user, assistant, system, tool }
enum TurnStatus { pending, running, completed, error, aborted }
enum ThreadStatus { active, archived, syncing, error }
enum ThreadSyncState { synced, syncing, behind, localOnly }
enum HandshakeMode { qrBootstrap, trustedReconnect }
enum ConnectionPhase {
  disconnected,
  connecting,
  handshaking,
  syncing,
  connected,
  reconnecting,
  error
}
enum GitActionKind {
  commit, push, pull, checkout, createBranch,
  createWorktree, revert, stackedPublish
}
enum AgentId { codex, opencode, claudeCode, antigravity, piAgent, zero, grok, custom }
```

#### 5.1.3 Value objects

```dart
// lib/domain/value_objects/rpc_message.dart
class RpcMessage {
  final String jsonrpc;           // siempre "2.0"
  final String? id;               // null = notification
  final String? method;
  final Map<String, dynamic>? params;
  final dynamic result;
  final RpcError? error;
  const RpcMessage({...});
  bool get isRequest => method != null && id != null;
  bool get isNotification => method != null && id == null;
  bool get isResponse => method == null && id != null;
}

// lib/domain/value_objects/json_value.dart
// Wrapper para JSON arbitrario sin perder estructura
@sealed
abstract class JsonValue { ... }
class JsonNull extends JsonValue { ... }
class JsonBool extends JsonValue { final bool value; ... }
class JsonNumber extends JsonValue { final num value; ... }
class JsonString extends JsonValue { final String value; ... }
class JsonArray extends JsonValue { final List<JsonValue> items; ... }
class JsonObject extends JsonValue { final Map<String, JsonValue> fields; ... }

// lib/domain/value_objects/context_window_usage.dart
class ContextWindowUsage {
  final int usedTokens;
  final int maxTokens;
  final double usagePercent;
  const ContextWindowUsage({...});
}

// lib/domain/value_objects/text_fingerprint.dart
class TextFingerprint {
  final String hash;  // SHA-256 del contenido normalizado
  const TextFingerprint._(this.hash);
  factory TextFingerprint.of(String content) { ... }
}
```

#### 5.1.4 Repositorios (interfaces)

```dart
// lib/domain/repositories/
abstract class IThreadRepository {
  Future<List<Thread>> getThreads({String? projectId});
  Future<Thread?> getThread(String id);
  Future<void> saveThread(Thread thread);
  Future<void> deleteThread(String id);
  Stream<List<Thread>> watchThreads({String? projectId});
}

abstract class IMessageRepository {
  Future<List<Message>> getMessages(String threadId, {int? limit, String? beforeId});
  Future<void> saveMessage(Message message);
  Future<void> saveMessages(List<Message> messages);
  Stream<List<Message>> watchMessages(String threadId);
}

abstract class ITrustedDeviceRepository {
  Future<List<TrustedDevice>> getDevices();
  Future<TrustedDevice?> getDevice(String macDeviceId);
  Future<void> saveDevice(TrustedDevice device);
  Future<void> deleteDevice(String macDeviceId);
}

abstract class IProjectRepository {
  Future<List<Project>> getProjects();
  Future<Project?> getProject(String id);
  Future<void> saveProject(Project project);
  Future<void> deleteProject(String id);
}

abstract class ISecureSessionRepository {
  Future<SecureSession?> getSession();
  Future<void> saveSession(SecureSession session);
  Future<void> clearSession();
}

abstract class IComposerDraftRepository {
  Future<String?> getDraft(String threadId);
  Future<void> saveDraft(String threadId, String content);
  Future<void> clearDraft(String threadId);
}
```

#### 5.1.5 Use Cases

```dart
// lib/domain/usecases/connection/
class ConnectToBridge { ... }           // inicia conexion + handshake
class ReconnectIfNeeded { ... }         // reconnect automatico
class DisconnectFromBridge { ... }
class SwitchActiveMac { ... }           // cambiar entre Macs de confianza

// lib/domain/usecases/pairing/
class StartPairing { ... }              // procesa un QRPairingPayload
class ValidatePairingPayload { ... }    // valida QR antes de aceptar
class RegisterTrustedDevice { ... }    // persiste Mac de confianza
class RemoveTrustedDevice { ... }
class BootstrapNewSession { ... }

// lib/domain/usecases/threads/
class LoadThreads { ... }
class LoadThread { ... }
class LoadTurns { ... }                 // con paginacion
class StartNewThread { ... }
class ResumeThread { ... }
class ForkThread { ... }
class SyncThreadHistory { ... }

// lib/domain/usecases/conversation/
class SendMessage { ... }
class SendAttachment { ... }
class CancelTurn { ... }

// lib/domain/usecases/git/
class GetGitStatus { ... }
class CommitChanges { ... }
class PushBranch { ... }
class PullBranch { ... }
class CreateBranch { ... }
class CreateWorktree { ... }
class RevertAiChanges { ... }
class StackedPublish { ... }

// lib/domain/usecases/workspace/
class ReadWorkspaceFile { ... }
class ListWorkspace { ... }
class CaptureCheckpoint { ... }
class DiffCheckpoint { ... }
class ApplyCheckpoint { ... }
class ApplyPatchChanges { ... }

// lib/domain/usecases/auth/
class GetAuthStatus { ... }
class StartLogin { ... }
class Logout { ... }

// lib/domain/usecases/notifications/
class RegisterPushToken { ... }
class UpdateNotificationPreferences { ... }
```

---

### 5.2 Capa de servicios / aplicacion

**Ubicacion en Flutter:** `lib/application/`

Esta capa orquesta los use cases y coordina los estados de dominio. Es el equivalente funcional de `CodexService` en la implementacion de referencia iOS, pero descompuesta en coordinadores especializados con responsabilidad unica.

#### 5.2.1 SessionCoordinator

> ✅ **Implementado** (rama `uxnanmobile`): `lib/application/coordinators/session_coordinator.dart`. Orquesta connect/disconnect/switchMac, handshake vía `SecureTransportLayer`, `SecureChannel`, `sendRequest` (cifrado + correlación), y reconexión automática con backoff (hasta 10 intentos → fase `error`). Expone `connectionPhase`/`recoveryState`/`activeMac`/`incomingMessages` como streams, cableados a providers Riverpod (`sessionCoordinatorProvider`, `connectionPhaseProvider`, …). Probado con un bridge simulado en memoria (connect, RPC round-trip, notificación entrante, reconexión tras caída). Nota de adaptación: el spec usa `ValueNotifier`; se exponen **streams** (BehaviorSubject) para encajar con Riverpod 3.x (doc 03 §1.3 ya referencia `connectionPhaseStream`). **Pendiente:** `IncomingMessageProcessor` (clasificación de eventos de dominio, con el módulo de conversación), descubrimiento LAN en `TransportSelector`, e integración WS en vivo.

Nucleo de la sesion de conexion. Gestiona el ciclo de vida completo:

```dart
// lib/application/coordinators/session_coordinator.dart
class SessionCoordinator {
  // Estado observable
  final ValueNotifier<ConnectionPhase> connectionPhase;
  final ValueNotifier<ConnectionRecoveryState> recoveryState;
  final ValueNotifier<TrustedDevice?> activeMac;

  // Ciclo de vida
  Future<void> connect({bool forceQrBootstrap = false});
  Future<void> disconnect();
  Future<void> switchMac(TrustedDevice device);
  Future<void> handleReconnect();

  // Pairing
  Future<void> processPairingPayload(PairingPayload payload);
  Future<void> cancelPairing();

  // Requests RPC
  Future<RpcMessage> sendRequest(String method, Map<String, dynamic> params);
  Stream<RpcMessage> get incomingMessages;
}
```

#### 5.2.2 ThreadManager

> ✅ **Implementado** (rama `uxnanmobile`): `lib/application/managers/thread_manager.dart`. Construye el `TurnTimelineSnapshot` del thread activo desde el repositorio local y aplica eventos de streaming (start/delta/complete, persistiendo el mensaje final); `sendUserMessage` (`turn/send`) sobre un `RpcSend` inyectado; la lista de hilos ya no se pide aqui: la escribe `BridgeReplica` (§5.8.17) con `applyReplicaThreads`, el unico camino por el que se guarda un hilo del bridge; dedup vía `MessageDeduplicator`. Expone `threadsStream`/`timelineStream` a providers Riverpod. Probado con DB in-memory + stream de eventos controlable. Adaptación: el spec usa `ValueNotifier`; se usan streams (BehaviorSubject) para Riverpod 3.x. Pendiente (FUTURO): paginación remota (`loadMoreHistory`), `startNewThread`/`resumeThread`/`fork`.

```dart
// lib/application/managers/thread_manager.dart
class ThreadManager {
  // Estado observable
  final ValueNotifier<List<Thread>> threads;
  final ValueNotifier<Thread?> activeThread;
  final ValueNotifier<Map<String, TurnTimelineSnapshot>> timelines;

  // Acciones (la lista de hilos llega por BridgeReplica, §5.8.17)
  Future<void> selectThread(String threadId);
  Future<void> loadMoreHistory(String threadId);
  Future<Thread> startNewThread(StartThreadParams params);
  Future<Thread> resumeThread(String threadId);
  Future<void> syncAll();
}
```

#### 5.2.3 ComposerManager

```dart
// lib/application/managers/composer_manager.dart
class ComposerManager {
  // Estado del composer
  final ValueNotifier<String> draft;
  final ValueNotifier<List<Attachment>> attachments;
  final ValueNotifier<List<String>> mentionSuggestions;
  final ValueNotifier<bool> canSend;
  final ValueNotifier<bool> isQueued;

  // Acciones
  Future<void> send({String? threadId});
  void updateDraft(String text);
  void addAttachment(Attachment attachment);
  void removeAttachment(String id);
  Future<List<String>> autocompleteMentions(String prefix);
  Future<List<String>> autocompleteFiles(String partial);
  void enqueueSend();                // si no hay conexion activa
}
```

#### 5.2.4 GitActionManager

```dart
// lib/application/managers/git_action_manager.dart
class GitActionManager {
  final ValueNotifier<GitRepoState?> repoState;
  final ValueNotifier<GitActionProgress?> activeAction;
  final ValueNotifier<bool> isLoading;

  Future<void> refreshStatus(String cwd);
  Future<void> commit(GitCommitParams params);
  Future<void> push(GitPushParams params);
  Future<void> pull(GitPullParams params);
  Future<void> checkout(GitCheckoutParams params);
  Future<void> createBranch(GitBranchParams params);
  Future<void> createWorktree(GitWorktreeParams params);
  Future<void> revert(RevertParams params);
  Future<void> stackedPublish(StackedPublishParams params);
}
```

#### 5.2.5 IncomingMessageProcessor

> ✅ **Implementado** (rama `uxnanmobile`): `lib/application/processors/incoming_message_processor.dart` + jerarquía `DomainEvent`. Clasifica las notificaciones `stream/turn/started|message/delta|turn/completed|error|aborted` en eventos tipados; el resto (`stream/git/progress`, `plan`, `subagent`, `approval`, `connection`, `workspace`, `auth`) cae en `UnknownDomainEvent` hasta que su módulo lo modele (FOR-DEV). Probado. Nota: el `SessionCoordinator` ya descifra envelopes y enruta respuestas; este procesador consume las notificaciones entrantes.

Procesa mensajes entrantes del bridge y los clasifica antes de rutearlos:

```dart
// lib/application/processors/incoming_message_processor.dart
class IncomingMessageProcessor {
  // Clasifica mensajes fuera del hilo principal para no bloquear UI
  void processRaw(Uint8List rawEnvelope);

  // Emite mensajes ya clasificados
  Stream<SecureControlMessage> get controlMessages;
  Stream<RpcMessage> get rpcMessages;
  Stream<DomainEvent> get domainEvents;
}

// Eventos de dominio emitidos
sealed class DomainEvent {}
class TurnStartedEvent extends DomainEvent { ... }
class TurnCompletedEvent extends DomainEvent { ... }
class MessageStreamEvent extends DomainEvent { ... }
class GitProgressEvent extends DomainEvent { ... }
class ConnectionStateEvent extends DomainEvent { ... }
class WorkspaceUpdateEvent extends DomainEvent { ... }
class PlanModeEvent extends DomainEvent { ... }
class SubagentEvent extends DomainEvent { ... }
class ApprovalRequestEvent extends DomainEvent { ... }
class BridgeUpdatePromptEvent extends DomainEvent { ... }
class AuthStatusEvent extends DomainEvent { ... }
```

#### 5.2.6 SyncManager

```dart
// lib/application/managers/sync_manager.dart
class SyncManager {
  // Sincronizacion en background
  Future<void> catchUp(String threadId);
  Future<void> reconcileHistory(String threadId, {String? cursor});
  Future<void> syncAfterReconnect();
  void scheduleBackgroundSync();
  void cancelSync();
}
```

#### 5.2.7 NotificationManager

```dart
// lib/application/managers/notification_manager.dart
class NotificationManager {
  Future<void> requestPermissions();
  Future<void> registerToken(String rawToken);
  Future<void> handleIncomingPush(Map<String, dynamic> payload);
  Future<void> showLocalNotification(NotificationPayload payload);
  void updatePreferences(NotificationPreferences prefs);
}
```

---

### 5.3 Capa de infraestructura

**Ubicacion en Flutter:** `lib/infrastructure/`

Implementaciones concretas de repositorios, adaptadores de transporte, almacenamiento y plugins de plataforma.

#### 5.3.1 WebSocket Transport

> ✅ **Implementado** (rama `uxnanmobile`): `lib/infrastructure/transport/websocket_transport.dart` define la interfaz `WebSocketTransport` + `WebSocketChannelTransport` (vía `IOWebSocketChannel` para soportar headers de upgrade). La capa segura (handshake + envelopes + `seq`/replay) está en `secure_transport_layer.dart`. Ver detalle en §5.9.1.

```dart
// lib/infrastructure/transport/websocket_transport.dart
class WebSocketTransport {
  // Gestion del canal
  Future<void> connect(String url, {Map<String, String>? headers});
  Future<void> disconnect();
  Future<void> send(Uint8List data);
  Stream<Uint8List> get incoming;
  Stream<TransportState> get stateChanges;

  // Seleccion de canal: web_socket_channel como backend
  // Soporta wss:// para relay remoto y ws:// para LAN directa
}
```

**Paquete:** `web_socket_channel` — soportado en Android e iOS. Canal unico para ambas plataformas sin codigo nativo adicional.

#### 5.3.2 Secure Transport Layer

```dart
// lib/infrastructure/transport/secure_transport.dart
class SecureTransportLayer {
  // Handshake E2EE completo
  Future<SecureSession> performHandshake({
    required TrustedDevice device,
    required PhoneIdentity phoneIdentity,
    required HandshakeMode mode,
    required WebSocketTransport transport,
  });

  // Cifrado/descifrado de envelopes
  Uint8List encryptEnvelope(Uint8List plaintext, SecureSession session);
  Uint8List decryptEnvelope(Uint8List ciphertext, SecureSession session);

  // Clasificacion de mensajes de control
  SecureMessageKind classifyRaw(Uint8List data);
}
```

**Criptografia:** implementada con `pointycastle` (puro Dart) + llamadas nativas para operaciones criticas de rendimiento:
- En Android: Android Keystore / JCE para Ed25519 y X25519
- En iOS: Security framework / CryptoKit para Ed25519 y X25519
- Interoperabilidad garantizada por el protocolo definido en la seccion de seguridad

#### 5.3.3 Almacenamiento seguro

```dart
// lib/infrastructure/storage/secure_store.dart
class SecureStore {
  // Usa flutter_secure_storage internamente
  // Android: EncryptedSharedPreferences / Keystore
  // iOS: Keychain Services
  Future<void> write(String key, String value);
  Future<String?> read(String key);
  Future<void> delete(String key);
  Future<void> clearAll();

  // Claves gestionadas
  static const phonePrivateKey = 'uxnan.phone.private_key';
  static const phonePublicKey = 'uxnan.phone.public_key';
  static const sessionDerivedKey = 'uxnan.session.derived_key';
}
```

#### 5.3.4 Almacenamiento local (SQLite)

> ✅ **Implementado** (rama `uxnanmobile`): `UxnanDatabase` y el esquema completo (hoy 10 tablas) en `lib/infrastructure/storage/`. Detalle de tablas y repositorios en 02c §10. Repositorios drift listos: `Thread`, `ComposerDraft` (los demás se implementan con su módulo).

```dart
// lib/infrastructure/storage/local_database.dart
// Implementado con drift (Drift = moor 2.x)
// Tablas principales:
// - threads
// - messages
// - turns
// - projects
// - trusted_devices
// - composer_drafts
// - git_action_log
// - checkpoint_metadata

@DriftDatabase(tables: [
  ThreadsTable,
  MessagesTable,
  TurnsTable,
  ProjectsTable,
  TrustedDevicesTable,
  ComposerDraftsTable,
])
class UxnanDatabase extends _$UxnanDatabase { ... }
```

**Paquete:** `drift` — soportado en Android e iOS. SQLite nativo en ambas plataformas.

#### 5.3.5 Adaptadores de plataforma

```dart
// lib/infrastructure/platform/

// QR Scanner — mobile_scanner (Android: CameraX/MLKit, iOS: AVFoundation/Apple Vision)
class QrScannerAdapter {
  Stream<PairingPayload?> startScan();
  Future<void> stopScan();
  Future<bool> requestCameraPermission();
}

// SSH Terminal — dartssh2 (puro Dart, Android + iOS)
class SshTerminalAdapter {
  Future<SshSession> connect(SshConnectionParams params);
  Stream<String> get output;
  Future<void> write(String input);
  Future<void> disconnect();
}

// Notificaciones Push
// Android: FCM via firebase_messaging
// iOS: APNs via firebase_messaging (mismo paquete, distinto backend)
class PushNotificationAdapter {
  Future<String?> getToken();  // FCM token en Android, APNs token en iOS
  Stream<RemoteMessage> get onMessage;
  Stream<RemoteMessage> get onBackgroundMessage;
  Future<void> requestPermissions();
}

// Permisos de red local
// Android: no requiere permiso explicito para LAN WebSocket
// iOS: NSLocalNetworkUsageDescription en Info.plist + plugin
class LocalNetworkPermissionAdapter {
  Future<LocalNetworkPermissionStatus> getStatus();
  Future<LocalNetworkPermissionStatus> request();
  // iOS: usa un plugin nativo minimo que hace un socket probe para triggear el popup
}

// Camara / adjuntos de imagen
// image_picker — Android: Gallery/Camera, iOS: PhotoLibrary/Camera
class ImagePickerAdapter {
  Future<List<ImageAttachment>> pickImages({int? maxCount});
  Future<ImageAttachment?> pickFromCamera();
}

// Vibracion / haptic feedback
// flutter_vibrate o vibration — Android + iOS
class HapticAdapter {
  void lightImpact();
  void mediumImpact();
  void heavyImpact();
  void selectionChanged();
}
```

#### 5.3.6 Repositorios de infraestructura (implementaciones)

```dart
// lib/infrastructure/repositories/
class DriftThreadRepository implements IThreadRepository { ... }
class DriftMessageRepository implements IMessageRepository { ... }
class DriftTrustedDeviceRepository implements ITrustedDeviceRepository { ... }
class DriftProjectRepository implements IProjectRepository { ... }
class SecureStorageSessionRepository implements ISecureSessionRepository { ... }
class DriftComposerDraftRepository implements IComposerDraftRepository { ... }
```

---

### 5.4 Capa de UI / presentacion

**Ubicacion en Flutter:** `lib/presentation/`

La UI es un sistema de composicion visual que materializa el estado de los coordinadores de aplicacion. No contiene logica de negocio. Usa Riverpod para reactividad.

> **Nota:** Uxnan usa Riverpod 3.x con providers declarados manualmente (sin riverpod_generator).

#### 5.4.1 Estado global (Riverpod providers)

```dart
// lib/presentation/providers/

final sessionCoordinatorProvider = Provider<SessionCoordinator>((ref) => ...);

final connectionPhaseProvider = StateNotifierProvider<ConnectionPhaseNotifier, ConnectionPhase>((ref) => ...);

final activeMacProvider = StateNotifierProvider<ActiveMacNotifier, TrustedDevice?>((ref) => ...);

final activeThreadProvider = StateNotifierProvider<ActiveThreadNotifier, Thread?>((ref) => ...);

final threadsProvider = StreamProvider<List<Thread>>((ref) => ...);

final timelineProvider = FutureProvider.family<TurnTimelineSnapshot, String>((ref, threadId) => ...);

final gitRepoStateProvider = StateNotifierProvider<GitRepoStateNotifier, GitRepoState?>((ref) => ...);

final composerProvider = StateNotifierProvider<ComposerNotifier, ComposerState>((ref) => ...);

final authStatusProvider = FutureProvider.family<AuthStatus, String>((ref, agentId) => ...);

final projectsProvider = StreamProvider<List<Project>>((ref) => ...);
```

#### 5.4.2 Pantallas principales

> **La lista de conversaciones esta agrupada por la carpeta en la que corren.**
> Un solo nivel, no dos: `uxnandesktop` dibuja repositorios sobre sus worktrees
> porque SABE cuales son; el telefono no — el bridge reporta raices planas y
> nada sobre worktrees, que viven como hermanos del repo. Un nivel "proyecto"
> construido sobre eso seria un encabezado sobre una sola carpeta mas un cajon
> "otros" con casi todo el trabajo real. La carpeta es la cima del arbol hasta
> que el bridge pueda decir mas (`git/worktrees`), momento en el que un nivel de
> proyecto vuelve significando lo mismo que en desktop. Las raices configuradas
> aportan su **nombre**, nada mas.
>
> **La jerarquia de worktrees SI se dibuja, cuando el bridge la reporta.**
> `git/worktrees` (§5.8.6) dice que carpetas son worktrees de que repositorio,
> y solo entonces aparece un nivel de repositorio sobre ellas. Se pregunta por
> las carpetas **de la lista** (los `cwd` distintos de las conversaciones), no
> por las raices configuradas: `workspaceRoots` es opcional y suele estar vacio,
> porque una conversacion puede arrancarse en cualquier carpeta desde el
> selector. Cada respuesta nombra a todos los hermanos de su repositorio, asi
> que diez worktrees cuestan una llamada, no diez. Nunca se deduce
> de prefijos de ruta: los worktrees son **hermanos** en disco, asi que un
> prefijo comun no dice nada. Y solo se dibuja cuando relaciona **dos o mas**
> carpetas — un encabezado sobre una sola carpeta es cromo, no estructura, que
> es exactamente lo que hundio el primer intento. Una carpeta que no se
> relaciona con nada se queda donde esta; no hay cajon "otros". Con un bridge
> anterior la tabla llega vacia y la lista es literalmente la de antes.
>
> **Cada nivel tiene su propio orden, guardado**: proyectos (TODO el primer
> nivel — un proyecto de una carpeta y un repositorio con varios worktrees se
> comparan con el mismo ajuste; mezclar dos criterios en una comparacion no es
> un orden), worktrees dentro de un proyecto (solo cuando hay alguno) y
> conversaciones, con las mismas cuatro opciones (`ListSort`: estado,
> actividad, creacion, nombre); el archivo tiene el suyo. La lista de un PC usa
> los proyectos de ESE PC (la replica guarda uno por PC), nunca los del
> conectado. Los worktrees **dentro** de un proyecto se ordenan con el
> mismo ajuste que los de primer nivel — `buildWorkspaceTree` recibe el
> comparador en vez de ordenarlos por su cuenta, que es lo que antes los dejaba
> fuera del alcance del menu. `created` de una carpeta es derivado: el bridge
> reporta una ruta, no una historia, asi que vale la conversacion mas antigua
> dentro. El archivo ofrece menos (`created` y `name`): el trabajo archivado
> esta terminado por definicion, asi que estado y actividad ordenarian por un
> valor que ya no puede cambiar.
>
> La fila de carpeta lleva **dos lineas, y la segunda cambia con el pliegue**:
> abierta dice solo cuantas conversaciones contiene, porque cada una lleva su
> propia marca de agente y su propio estado una fila mas abajo; cerrada anade
> las marcas de los agentes que hay dentro y, en la primera linea, el estado mas
> urgente de todos ellos — esa evidencia desaparece al plegar y la cabecera
> tiene que suplirla. Es el mismo canje que hace la vista de agentes de
> `uxnandesktop`.
>
> **Las herramientas de la carpeta viven en su fila.** Junto al "+" (nueva
> conversacion aqui) la fila lleva *Explorar archivos* y *Control de
> versiones*: las mismas pantallas que abre la barra de una conversacion, porque
> son de la carpeta y deben alcanzarse antes de que exista conversacion alguna.
> Ambas exigen canal vivo con ESE PC. En la columna fija de 320 dp del drawer
> permanente las dos se pliegan en un unico menu ⋮ para que el nombre de la
> carpeta conserve su sitio; el "+" nunca se pliega. El FAB sigue siendo la
> nueva conversacion global. La hoja de pulsacion larga acota su lista de
> conversaciones como cualquier hoja de seleccion y nunca pasa bajo la barra de
> estado.

> **El estado del agente en la lista es DERIVADO, no reportado.** La fila de
> conversacion muestra los mismos cinco estados que la barra lateral de
> `uxnandesktop` (working / waiting / blocked / done / idle), pero el bridge no
> los envia: desktop los arma con su propio hook server sobre las terminales que
> el mismo lanza, y el telefono no tiene nada de eso. El movil los deriva de lo
> que el contrato SI da — eventos de turno, estado de la cola, `auth/status`, no
> leidos, y los bloques `approval`/`question` que el agente emite al detenerse a
> preguntar. `ThreadManager` registra esos bloques **para todos los threads**,
> no solo el abierto, que es lo unico que permite distinguir "trabajando" de
> "te espera" desde una lista. Ese registro es en memoria y se reconstruye en el
> siguiente resync (`turn/list` reproduce los bloques): un `waiting` exacto tras
> reinicio requeriria que el bridge lo dijera — una notificacion
> `stream/thread/state` o un campo en `thread/list` — y esta anotado como
> trabajo debido en `uxnanmobile/FOR-DEV.md`, no implementado.
>
> **Los indicadores de git de cada carpeta** (sin confirmar, ↑adelante /
> ↓atras) salen de `git/status` por cwd, que ya existia — no hizo falta
> contrato nuevo. Las reglas son de **coste**, no de dibujo: solo con el PC
> conectado, solo para carpetas visibles (`autoDispose`: una carpeta plegada no
> dibuja indicadores, luego nadie observa el provider, luego no se pide), y con
> un throttle de 15 s. El refresco real llega por el bus de `git/status` tras
> un commit/push/pull, sin viaje de ida y vuelta. Un cero no se dibuja jamas y
> la fila corta a tres senales; el desglose (rama, upstream, +/−) vive en la
> hoja de pulsacion larga. Sin respuesta la fila no dibuja nada — nunca
> "limpio", que seria una mentira con aspecto de buena noticia.
> `GitActionManager` guarda ese estado **por cwd**: las filas leen el de cada
> carpeta visible mientras una pantalla de git, el navegador de archivos o la
> rama de una conversacion muestran el de otra, y un unico hueco "repositorio
> actual" dejaba que la ultima lectura pintara sus archivos en todas.

> **La misma tabla de rutas se dibuja en dos sitios distintos.** A partir de
> 840 dp de ancho de ventana la app deja de ser una pila de pantallas: una
> unica `ShellRoute` envuelve las rutas planas y `AppShell` decide si la
> pantalla enrutada ES la ventana o es el **panel de contenido** junto a un
> navigation drawer permanente. La tabla no cambia, asi que cada deep link y
> cada notificacion push siguen funcionando en los dos anchos sin un segundo
> modelo de navegacion que mantener en paralelo. **El tope son dos paneles**:
> las divisiones anidadas (ajustes y su seccion) miden sus propias constraints,
> no la ventana, y una tercera columna en una tablet no le sirve a nadie. Lo
> que cambia con el ancho es el **significado de un toque** — abrir reemplaza
> el panel en vez de apilar — y eso vive en `pane_navigation.dart`, que es
> tambien la unica regla de "atras" de la app: saca lo apilado (preguntando a la
> pantalla, que puede negarse si tiene cambios sin guardar); si no queda nada,
> en ancho cierra el panel y en telefono sube un nivel (`RouteFacts.parent`: el
> archivo o las estadisticas de un PC → su lista; la pantalla de una carpeta →
> la conversacion desde la que se abrio; una conversacion → la lista de su PC).
> Los dos paneles son contenedores semanticos separados: la barrera modal de
> cada ruta del panel oculta a la accesibilidad lo pintado antes en su mismo
> contenedor, y compartido ocultaba el drawer entero. El detalle esta en
> `architecture/02c` §3.3.
>
> **El PC del drawer** es el de la ruta (el que nombra, o el de su
> conversacion); si la ruta no pertenece a ningun PC, el **PC en foco**
> persistido; luego el conectado; luego cualquiera emparejado — siempre
> validado contra los PCs emparejados. El foco tiene un solo escritor y tres
> entradas, todas actos de ir a un PC: la ruta, el selector del drawer (que
> ademas vacia el panel, cuyo contenido era del otro PC) y el emparejamiento.
>
> **Una conversacion lee SU timeline** (`threadTimelineProvider(threadId)`),
> nunca "lo que el gestor tenga delante": dos pueden estar montadas a la vez
> (la de una notificacion encima de la que leias), y al volver la de abajo
> recupera su thread (`paneRouteObserver`). Si su thread se borra, se cierra.
>
> **`detail` es siempre el `child` del router.** No es estilo: ese `child` es
> el `Navigator` de la `ShellRoute`, y `GoRouterDelegate.popRoute` — a donde va
> el boton atras del sistema — lo desreferencia sin comprobar. Sustituirlo por
> otro widget en alguna ruta rompe el boton atras en TODA la app.
>
> **Un unico ambito responde por el boton atras, y esta montado en TODA ruta.**
> Android no pregunta cuando se pulsa atras: actua sobre una afirmacion que la
> app publica *antes*
> (`SystemNavigator.setFrameworkHandlesBack`, que Flutter deriva de la ultima
> `NavigationNotification` que llega a `WidgetsApp`). Como `AppShell` envuelve
> al `Navigator` de la `ShellRoute`, ese ambito queda registrado en la ruta que
> esta **por encima** de ese navigator, y de ahi salen dos reglas que ya se
> incumplieron una vez:
>
> - **Devolver `child` pelado en una ruta desregistra el ambito**, y eso publica
>   "esta app no gestiona atras". El sistema cerraba la app en vez de salir de
>   Ajustes, mientras la flecha de la barra — un pop directo, que nunca pasa por
>   el sistema — seguia funcionando en la misma pantalla.
> - **El navigator de abajo puede contradecirlo.** Publica lo suyo en cada
>   cambio de historial; un `Navigator` normal corrige un "no puedo" de su
>   subarbol cuando el si puede, pero nada corrige el que viene de un navigator
>   *por debajo* de la ruta que responde. Un panel abierto con `go` deja una
>   sola pagina y anula asi el "atras vacia el panel" de la tablet. La
>   correccion la hace el propio ambito mientras atras sea de la app.
>
> Lo que significa atras no cambia: sacar la pantalla que abriste; con drawer
> permanente, vaciar el panel; en telefono sin nada que sacar, subir en la
> jerarquia; y en la vista general, salir de la app.

```
lib/presentation/
├── router/
│   ├── app_router.dart                   # tabla de rutas PLANA + la unica ShellRoute
│   ├── pane_navigation.dart              # openInPane / closePane: que significa un toque
│   └── route_facts.dart                  # a que PC/conversacion pertenece una ruta, y su padre
├── screens/
│   ├── shell/
│   │   ├── app_shell.dart                # builder de la ShellRoute: pantalla o panel
│   │   ├── app_shell_screen.dart         # TwoPaneScaffold (tambien para splits anidados)
│   │   ├── nav_drawer.dart               # drawer permanente: PC, su trabajo, y tu
│   │   └── shell_welcome.dart            # el panel tranquilo, antes de abrir nada
│   ├── devices/
│   │   └── my_devices_screen.dart        # portada: identidad, PCs y su trabajo
│   ├── threads/
│   │   ├── threads_screen.dart           # Espacios: proyectos > carpetas > conversaciones
│   │   ├── space_rows.dart               # filas de proyecto y de carpeta (+ archivos, git, nueva)
│   │   ├── thread_tile.dart              # fila de conversacion (estado derivado)
│   │   ├── thread_list_controls.dart     # orden por nivel (ListSort) + menu anidado de orden
│   │   ├── workspace_git_indicators.dart # sin confirmar / adelante / atras por carpeta
│   │   ├── workspace_details_sheet.dart  # hoja de pulsacion larga: ruta, rama, upstream
│   │   ├── workspace_browser_sheet.dart  # explorador de carpetas del bridge
│   │   ├── archived_threads_screen.dart
│   │   └── new_conversation_screen.dart  # pantalla completa en movil, dialogo en ancho
│   ├── conversation/
│   │   ├── conversation_screen.dart      # pantalla de turno activa
│   │   ├── session_environment.dart
│   │   ├── messages/                     # render de bloques, markdown, diffs, tarjetas
│   │   ├── composer/                     # pill flotante, cinta de opciones, adjuntos
│   │   └── support/                      # selector de modelo, recuperacion, errores
│   ├── workspace/                        # lo de la CARPETA, no de una conversacion
│   │   ├── files/                        # navegador de archivos + visor/editor
│   │   └── git/                          # estado, historial, detalle de commit
│   ├── onboarding/
│   ├── pairing/                          # QR, codigo manual, descubrimiento en LAN
│   ├── profile/
│   │   ├── profile_screen.dart           # identidad, gasto, limites, actividad, PCs
│   │   ├── profile_identity_header.dart  # foto + el nombre del telefono (uno solo)
│   │   ├── spend_section.dart            # usage/summary: gasto por dia y agente
│   │   ├── usage_section.dart            # agent/usageStats: limites y ritmo
│   │   ├── agent_activity_section.dart   # heatmap + agentes
│   │   └── pc_details_screen.dart        # ficha por PC
│   └── settings/
│       ├── settings_screen.dart          # accesos, y su seccion al lado en ancho
│       ├── sections/                     # una pantalla por seccion
│       ├── personalization_screen.dart
│       ├── theme_manager_screen.dart     # + editor de tema custom
│       └── licenses/
├── providers/                            # Riverpod manual (sin codegen)
├── widgets/                              # primitivas compartidas (NeScaffold, UxIcon, ...)
└── theme/
    ├── uxnan_theme.dart
    ├── breakpoints.dart                  # UxnanBreakpoint: la unica frontera responsive
    ├── colors.dart
    ├── typography.dart
    ├── spacing.dart                      # tamanios, radios, y el grosor de trazo de iconos
    ├── motion.dart                       # muelles M3E + duraciones de entrada
    ├── icons.dart                        # catalogo UxIcons (Hugeicons)
    └── markdown.dart
```

#### 5.4.3 Navegacion

**Paquete:** `go_router` — soportado en Android e iOS.

Tabla PLANA dentro de una unica `ShellRoute` (ver arriba); cada ruta
parametrizada lleva un `ValueKey` de su parametro.

| Ruta | Pantalla |
|---|---|
| `/` | `MyDevicesScreen` (telefono) / `ShellWelcome` (con drawer) |
| `/device/:deviceId/threads` · `/archived` · `/stats` | `ThreadsScreen` · `ArchivedThreadsScreen` · `PcDetailsScreen` |
| `/conversation/:threadId` | `ConversationScreen` |
| `/workspace/files?cwd=…[&thread=…]` | `FileBrowserScreen` |
| `/workspace/git?cwd=…[&thread=…]` | `GitScreen` |
| `/onboarding`, `/pairing`, `/pairing/manual`, `/settings`, `/profile` | pantalla completa, sin drawer |

Los archivos y el control de versiones son de la **carpeta**: la ruta la
identifica con el parametro `cwd` (una ruta absoluta no es un segmento), y
`thread` solo nombra la conversacion desde la que se abrio (el git screen
registra sus acciones en ella y ofrece retirar su worktree). Se abren con
`push` sobre una conversacion y con `openInPane` desde una fila de carpeta; en
ancho, `closePane` saca primero lo apilado en el panel y solo despues lo vacia.
Una ruta de carpeta sin `cwd` redirige a `/`.

#### 5.4.4 Gestion de estado UI

Uxnan utiliza **Riverpod 3.x con providers manuales** como solucion de state management principal:

- `StateNotifierProvider` para estado mutable complejo
- `StreamProvider` para streams reactivos (threads, mensajes)
- `FutureProvider` para carga asincrona unica
- `Provider` para servicios singleton inyectados

Todos los providers se declaran manualmente en `lib/presentation/providers/`. No se utiliza `riverpod_generator` ni anotaciones de generacion de codigo para providers.

#### 5.4.5 Renderizado de mensajes

```dart
// lib/presentation/screens/conversation/messages/message_renderer.dart
// Selecciona el renderer correcto segun el tipo de contenido del mensaje

class MessageRenderer extends StatelessWidget {
  final Message message;
  @override
  Widget build(BuildContext context) {
    return switch (message.primaryContentType) {
      ContentType.text => MarkdownRenderer(message: message),
      ContentType.code => CodeBlockWidget(message: message),
      ContentType.mermaid => MermaidRenderer(message: message),
      ContentType.commandExecution => CommandExecutionCard(message: message),
      ContentType.diff => DiffViewer(message: message),
      ContentType.image => WorkspaceImagePreview(message: message),
      ContentType.approval => ApprovalRequestCard(message: message),
      ContentType.subagent => SubagentCard(message: message),
      ContentType.plan => PlanModeWidget(message: message),
      ContentType.system => SystemMessageCard(message: message),
      _ => TextMessageWidget(message: message),
    };
  }
}
```

#### 5.4.6 Timeline snapshot y reconciliacion

La timeline nunca trabaja con listas mutables directamente. Trabaja con snapshots inmutables:

```dart
// lib/presentation/screens/conversation/timeline/timeline_snapshot.dart
class TurnTimelineSnapshot {
  final List<TimelineItem> items;
  final bool hasMore;
  final String? nextCursor;
  final bool isStreaming;
  final String? streamingTurnId;

  TurnTimelineSnapshot reconcile(List<Message> newMessages) { ... }
  TurnTimelineSnapshot appendStreaming(MessageStreamEvent event) { ... }
}
```

#### 5.4.7 Markdown y contenido enriquecido

- **Markdown:** `flutter_markdown_plus` — Android + iOS renderer for messages and workspace documents. Partial streaming prose and settled prose use the same `MarkdownBody` renderer and shared style sheet, preventing a source-text-to-formatted-layout swap when a turn completes. **A reply that is still streaming is rendered as several bodies, not one:** it is cut at boundaries that can no longer move (a blank line outside a code fence, followed by a line that unmistakably starts a new block — never between list items, inside a quote, table, indented code or a fence), and each settled chunk keeps its widget instance so Flutter skips it instead of rebuilding. Rendering the whole accumulated reply on every delta made a turn cost time quadratic in its own length: measured on device, p95 per frame went 5.4 ms under 4 500 characters to 28.1 ms past it, with the raster flat at 3.7 ms; after the split, 11.0 ms past 4 500 and no longer growing with the reply. Separate bodies lose the renderer's inter-block spacing, so it is restored explicitly (`uxnanMarkdownBlockSpacing`) and the two renderings are compared pixel by pixel in `streaming_markdown_fidelity_test.dart`. Explicit Markdown links, bare local paths and inline-code paths share one tap callback: local paths open the workspace file viewer, remote links are copied rather than launched. Workspace previews target GitHub-flavored Markdown as GitHub renders it, without embedding a WebView: GitHub **alerts** (`> [!NOTE]` …) and **`<details>` disclosures** are extracted as blocks and given their own chrome, common README HTML (including rectangular tables, `<kbd>`, `<sub>`/`<sup>`) is normalized, and the renderer runs the `gitHubWeb` extension set with a checkbox builder and a syntax-highlighted, horizontally scrollable code-block builder. An HTTPS resource is decoded by the media type its **response** declares (`content-type` + payload signature), never by its URL, because README shields are served from extensionless endpoints as `image/svg+xml`.
- **SVG:** two renderers by design. `flutter_svg` draws the app's own bundled assets; **`jovial_svg`** draws documents the user did not author (workspace previews, README shields), because `vector_graphics` does not apply transforms to `<text>` and every badge service scales its label down with one.
- **Mermaid:** represented as structured message content and rendered as an explicit diagram placeholder; no WebView dependency is part of the current mobile UI stack.
- **Code highlighting:** `flutter_highlight` — puro Dart.
- **Diff viewer:** widget nativo custom con renderizado de lineas anadidas/eliminadas.

---

### 5.5 Modulo de pairing y onboarding

> ✅ **Lógica + UI implementadas** (rama `uxnanmobile`): Lógica — `PairingPayload` (+`fromQrString`), `PairingValidator`, `ITrustedDeviceRepository` + `TrustedDeviceRepository` (drift + `SecureStore`), `SessionCoordinator.processPairingPayload`/`cancelPairing`. UI (M3) — `OnboardingScreen` (Welcome/Features/Install/Pair) con `CommandCardWidget`, `QrScannerScreen` (`mobile_scanner` + gating de permiso de cámara), `UpdatePromptDialog`, rutas `/onboarding` y `/pairing`. Permiso de cámara configurado (Android manifest + iOS `NSCameraUsageDescription`). Tests: dominio/infra + `processPairingPayload` e2e (bridge simulado) + navegación de onboarding. ⏳ **Pendiente (FOR-DEV):** pairing por **código manual** (relay REST §5.5.3), `MyDevicesScreen`, macro `PERMISSION_CAMERA=1` del Podfile iOS, y verificación on-device contra un bridge real. Ver `uxnanmobile/FOR-DEV.md`.

**Objetivo:** llevar al usuario desde "app instalada" hasta "sesion segura activa" sin exponer detalles tecnicos.

#### 5.5.1 Flujo de onboarding

```
OnboardingScreen
├── WelcomePage         → presentacion del producto
├── FeaturesPage        → capacidades principales (multi-agente, E2EE, local-first)
├── InstallStepPage     → instrucciones de instalacion del bridge en la PC
│   ├── macOS: npx uxnan-bridge
│   ├── Windows: npx uxnan-bridge
│   └── Linux: npx uxnan-bridge
└── PairingStep         → CTA hacia QRScannerScreen o ManualCodeScreen
```

#### 5.5.2 Flujo de pairing por QR

```
QrScannerScreen
├── Solicita permiso de camara (CameraPermissionRequest)
├── Abre camara con overlay de escaneo (MobileScannerWidget)
├── Detecta QR → extrae PairingPayload
├── PairingValidator.validate(payload)
│   ├── version del QR == PAIRING_QR_VERSION (3)?
│   ├── expiresAt > DateTime.now()? (MAX_PAIRING_AGE = 5 min)
│   └── campos obligatorios presentes?
├── Si bridge incompatible → UpdatePromptDialog
└── Si valido → SessionCoordinator.processPairingPayload(payload)
    └── Persiste TrustedDevice
    └── Inicia handshake QR bootstrap
    └── Navega a HomeScreen
```

#### 5.5.3 Flujo de pairing por codigo manual

> **Cambio (2026-06):** el código manual es ahora una función **bridge-first**
> (no relay). El bridge emite un código corto rotativo y expone
> `GET /pair/resolve?code=<code>` en su servidor LAN. El bridge también anuncia
> mDNS `_uxnan._tcp.local` para descubrimiento automático en LAN (el telefono
> puede autocompletar el host). El relay nunca implementó el endpoint fuera-de-
> LAN `/trusted-session/resolve` que el whitepaper original proponía — la
> variante bridge-first cubre el caso LAN (y Tailscale). Fuera de la red del
> PC, sin Tailscale, se empareja escaneando el QR: lleva el ticket de un solo
> uso del relay propio (§5.10). Resolver un código a través del relay no existe
> (ver `uxnanmobile/FOR-DEV.md`).
>
> **Seguridad (2026-07): el código va a UN solo host, el que el usuario eligió.**
> El código de emparejamiento es un secreto compartido que se lee de la pantalla
> del PC, y un `/pair/resolve` exitoso **abre la ventana de bootstrap** del bridge
> (ver §5.9). Por eso el teléfono lo manda exclusivamente al host que el usuario
> nombró — tecleado, o elegido en la hoja "Browse nearby bridges", que rellena ese
> campo. Nunca se reparte entre candidatos descubiertos: los registros mDNS no
> están autenticados y cualquier dispositivo de la red puede publicarlos, así que
> repartirlo revelaría el código a quien publicó el registro y permitiría que el
> primero en responder suplantara al PC. La hoja de descubrimiento sigue
> existiendo, pero es una **elección explícita** del usuario, y el hint TXT `addr`
> solo se honra si es una IP literal en rango privado/CGNAT/loopback (el resto de
> casos usan la dirección resuelta por SRV). El caso totalmente fuera de red (el
> teléfono sin ruta directa alguna al bridge) sigue sin cubrirse; queda registrado
> como trabajo pendiente en `uxnanmobile/FOR-DEV.md`.
>
> **Multi-interface discovery (2026-07):** the bridge does not let the OS choose
> one implicit multicast route. It joins `224.0.0.251:5353` and emits each
> `_uxnan._tcp.local` announcement/response explicitly through every eligible
> advertised IPv4. This prevents a lower-metric disconnected Ethernet,
> Tailscale, Hyper-V or WSL route from hiding a Wi-Fi bridge. Individual
> membership/send failures are logged without secrets and degrade to QR/typed
> host pairing. mDNS remains link-local and does not traverse Tailscale.

```
ManualCodeScreen
├── Campo de texto para el codigo (8 chars Crockford base32, 10 min TTL)
│   y campo para host:port (autocompletable via mDNS si está disponible)
├── GET http://<bridge-host>:<port>/pair/resolve?code=<code>
│   ├── Dirigido SOLO al host elegido por el usuario (nunca repartido
│   │   entre candidatos mDNS — el código es un secreto)
│   ├── Validación constant-time + rate-limit por IP (mapa acotado:
│   │   barrido de entradas expiradas + cap duro `rateMaxKeys`, 10k por
│   │   defecto, para que la rotación de IPs no agote la memoria)
│   └── Respuesta: PairingPayload completo (identico al del QR)
└── Continua igual que QR bootstrap (proceso de handshake E2EE)
```

Flujo equivalente en CLI: el bridge, al arrancar, muestra en la terminal
tanto el QR como el código de pairing (visible via `uxnan-bridge start` y
`uxnan-bridge code`). `uxnan-bridge code` pide el código al bridge en ejecución
por el canal de control local (`bridge/pairingCode`, §5.8.15), lo que abre la
ventana de pairing de ese bridge; si ninguno responde, imprime el código del
almacén que comparten todos (`~/.uxnan/pairing-code.json`), que acepta el
próximo bridge que arranque. Ninguno de los dos casos levanta otro bridge.

#### 5.5.4 Estructuras de pairing

> **Cambio (2026-06):** `relay` ahora es **opcional**; el payload incluye
> `hosts: string[]` con las direcciones directas del bridge (LAN + Tailscale).
> La codificación del QR es **Base64 del UTF-8 del JSON**.
>
> **Cambio (2026-10) — v3:** `relay` deja de ser una URL y pasa a ser el objeto
> `{ url, routingId, ticket? }` del relay **propio** del usuario (§5.10). El
> `ticket` (32 bytes aleatorios, base64url) existe mientras la ventana de
> emparejamiento está abierta y permite emparejar por el relay a un teléfono
> que no está en la red del PC; el relay solo conoce su SHA-256 y lo acepta una
> vez. Un QR v2 se lee como versión no soportada. `DEFAULT_RELAY_URL` ya no
> existe.

```typescript
// PAIRING_QR_VERSION = 3
// Payload transportado en el QR como Base64(utf8(JSON))
interface PairingPayload {
  v: 3;                              // version del formato QR
  // Al menos uno de los dos es obligatorio:
  relay?: {                          // relay propio del usuario (solo si esta configurado y habilitado)
    url: string;                     //   wss://uxnan-relay.<subdominio>.workers.dev (sin path)
    routingId: string;               //   sala del bridge en ese relay: 32 hex en minusculas
    ticket?: string;                 //   ticket de un solo uso (43 chars base64url), mientras la ventana esta abierta
  };
  hosts?: string[];                  // Direcciones directas del bridge: ["192.168.1.42:19850", "100.x.y.z:19850"]
  sessionId: string;                 // UUID de sesion
  macDeviceId: string;               // ID del bridge en la PC
  macIdentityPublicKey: string;      // Ed25519 publica del bridge (hex)
  expiresAt: number;                 // Unix timestamp ms, TTL 5 min
  displayName: string;               // nombre visible de la Mac
}

// Persistido en SecureStore + base de datos local
class TrustedDevice {
  final String macDeviceId;
  final String displayName;
  final Uint8List macIdentityPublicKey;  // Ed25519, 32 bytes
  final RelayEndpoint? relay;             // {url, routingId, enabled}; null sin relay. Lo escribe
                                          // solo BridgeReplica desde BridgeSettings.relay (el ticket nunca se guarda)
  final List<String> hosts;               // puede coexistir o reemplazar al relay
  final String sessionId;
  final Uint8List phoneIdentityPrivateKey; // Ed25519 propia del telefono, 32 bytes
  final Uint8List phoneIdentityPublicKey;
  final DateTime pairedAt;
}

// Identidad del telefono (generada una sola vez, persistida en SecureStore)
class PhoneIdentity {
  final String phoneDeviceId;            // UUID generado al instalar
  final Uint8List identityPrivateKey;   // Ed25519, 32 bytes
  final Uint8List identityPublicKey;    // Ed25519, 32 bytes
}
```

#### 5.5.5 Reconexion confiable (trusted reconnect)

Una vez que hay pairing establecido, las reconexiones siguientes no requieren reescanear el QR:

```
SessionCoordinator.connect()
├── Tiene TrustedDevice registrado? → Si
│   ├── TransportSelector: prueba cada `hosts` directo (LAN/Tailscale);
│   │   si ninguno responde y el PC tiene relay habilitado:
│   │   └── RelayClient → /v1/connect/<routingId>: challenge → phone-auth
│   │       firmado con la identidad del telefono → ready (§5.10)
│   └── Inicia handshake con mode: "trusted_reconnect"
└── No → Flujo de onboarding/QR
```

#### 5.5.6 Cambio de Mac activa

El usuario puede tener N Macs registradas y cambiar entre ellas:

```dart
// MyDevicesScreen es la superficie "overview":
//   AppBar: marca (izquierda) · ajustes + avatar (derecha).
//   Encabezado en dos filas: saludo fijo pequeno sobre el nombre grande, y
//     debajo badges de "N en linea" (tono live) y "miembro desde…" (neutro).
//     Hace scroll bajo la barra, no colapsa a titulo.
//   DeviceCard list → 1 columna; 2 columnas emparejadas desde `expanded`.
// Cada DeviceCard: fila de identidad (glifo con punto de estado, nombre,
//   direccion revelable al tocarla, y "Ultima conexion: <hora>" con el reloj
//   12/24 h del propio telefono; menu ⋮) sobre badges de modo de conexion
//   (estado y ruta de red en uno solo) y agentes trabajando ahora; abajo,
//   "Conectar" a la izquierda y el conteo de conversaciones a la derecha. Los
//   conteos en cero no se dibujan.
// El PairEmptyState conserva el logo como hero.
SessionCoordinator.switchMac(device)
├── Desconecta sesion actual
├── Actualiza activeMac
└── Inicia nueva conexion con el TrustedDevice seleccionado
```

---

### 5.6 Modulo de timeline y turn handling

> ✅ **Dominio + datos implementados** (rama `uxnanmobile`): jerarquía sellada `MessageContent` (+ codec JSON con fallback `UnknownContent`) en `lib/domain/value_objects/message_content.dart`; entidades `Message`/`Turn`; `IMessageRepository` + `DriftMessageRepository` (§6.2 / §10.3); `MessageDeduplicator` (§5.6.5) y `TurnTimelineSnapshot` con reducer de streaming/reconciliación/paginación (§5.4.6). Todo con tests. ✅ **UI + managers implementados y validados en dispositivo:** contenido avanzado (`approval` interactivo, `plan`/todo, `subagent`, y el `question` multiple-choice interactivo), managers de aplicación (`ThreadManager` de timeline, `IncomingMessageProcessor`), y la **UI** (`ConversationScreen`, renderers, composer). Ver `uxnanmobile/FOR-DEV.md`.

**Objetivo:** presentar la conversacion activa de forma reactiva, eficiente y con soporte completo para streaming, diffs, planes, subagentes y adjuntos.

#### 5.6.1 ConversationScreen

Pantalla operativa central. Se compone de:

```
ConversationScreen
├── AppBar
│   ├── titulo del thread
│   ├── estado de conexion (badge)
│   └── menu de acciones (Git toolbar, fork, share)
├── TimelineWidget
│   ├── ScrollController con auto-scroll al final en streaming
│   ├── TimelineItemList
│   │   └── Para cada TimelineItem → MessageRenderer
│   ├── Indicador de carga de historial anterior (pull-to-load-more)
│   └── ConnectionRecoveryCard (si desconectado)
├── ComposerWidget
│   ├── TextField expandible
│   ├── AttachmentRow (imagenes, archivos)
│   ├── AutocompleteOverlay (menciones, archivos, slash commands)
│   ├── SendButton (activo segun canSend)
│   └── VoiceInputButton
└── Overlays y sheets:
    ├── GitActionsBottomSheet
    ├── StatusSheet (estado de sesion y agente)
    ├── BranchSelectorSheet
    ├── RevertSheet
    ├── WorktreeHandoffOverlay
    └── ApprovalRequestOverlay
```

El `AutocompleteOverlay` presenta `/` y `@` como superficies auxiliares
hermanas 8 dp por encima del composer. Comparten superficie tonal elevada,
geometria, ancho y una cabecera con el trigger y el titulo. `/` usa filas
continuas de al menos 56 dp con icono contenido, nombre y descripcion; `@`
conserva sus filas y estados de navegacion, busqueda, carga y error. Ambos
respetan reduced motion.

#### 5.6.2 Composer avanzado

```dart
// lib/presentation/screens/conversation/composer/composer_widget.dart
// El composer maneja:
// - Texto con soporte para menciones (@archivo, @proyecto)
// - Slash commands (/fork, /new, /status, /git, /checkout)
// - Adjuntos de imagen (image_picker)
// - Plan mode toggle (si el agente lo soporta)
// - Runtime override (modelo, tier, razonamiento)
// - Queue draft (si no hay conexion, se encola para envio al reconectar)
// - Draft persistence (DriftComposerDraftRepository)
```

#### 5.6.3 Streaming de mensajes

El bridge emite eventos de streaming que la app procesa incrementalmente:

```
IncomingMessageProcessor
→ MessageStreamEvent { turnId, delta, isComplete }
→ TimelineSnapshot.appendStreaming(event)
→ TimelineWidget reconstruye solo el ultimo mensaje afectado
```

Reglas de streaming:
- **The bridge coalesces text deltas over a 25 ms window (or 512 characters,
  whichever comes first) before notifying.** `stream/message/delta` carries the
  accumulated run, so nothing on the wire or in the app changes shape — there
  are simply fewer, larger deltas. Agents emit prose in bursts (measured: 60% of
  a real turn's deltas arrived within 5 ms of the previous one), and one
  serialization + AES-GCM seal + WebSocket frame per handful of characters was
  paid on both ends; batching that recording cut 911 notifications to 244.
  **Order is the invariant:** any non-delta event — a content block, a turn
  ending — flushes the open batch first, so a block still lands against the text
  run it belongs to and a completion never overtakes the prose before it.
- El auto-scroll esta activo mientras el usuario no haya scrolleado hacia arriba.
- Si el usuario scrollea durante streaming, el auto-scroll se pausa.
- Al completar el turno, si el usuario esta cerca del fondo, auto-scroll se reactiva.
- A terminal event reconciles with accumulated text additively; it never replaces
  divergent prose already streamed or persisted.
- Multiple native assistant messages remain visible while streaming. Once the
  turn settles, all but the final response collapse into one expandable section.
- Text deltas render through the same Markdown path as settled prose; the live
  loader is adjacent UI, never response text or a reason to fall back to a plain
  `SelectableText` surface.

> ✅ **Implementación actual:** `ConversationScreen` usa una política explícita
> de auto-follow. Cualquier drag manual se impone inmediatamente a los eventos
> de streaming; los saltos post-layout se agrupan por frame y vuelven a validar
> la intención antes de mover el `ScrollController`. El seguimiento se reactiva
> al volver cerca del fondo, usar "jump to latest" o enviar con la preferencia
> correspondiente activa. "Jump to latest" es un comando explícito que **siempre**
> desciende al contenido más reciente, superando cualquier inercia/arrastre en
> curso. Los disclosures secundarios de proceso (razonamiento/actividad) son
> paneles tonales sin borde, contraídos por defecto y con expansión exclusiva
> dentro de cada turno; los prompts largos del usuario ofrecen una vista previa
> expandible sin alterar la copia completa. Para navegar una conversación larga,
> un **riel de mensajes** reutilizable (`MessageScrollRail`) — un tick por
> mensaje del usuario, tenue en reposo — vive en la orilla derecha: está oculto
> mientras el scroll está hasta abajo y **entra deslizándose desde la derecha**
> (con fade) cuando el usuario sube (la misma señal que muestra "jump to latest"
> y oculta la cinta de contexto). Al arrastrarlo revela un efecto "fisheye" y una
> vista previa del mensaje, y al soltar se desplaza suavemente (ease-in/out, con
> un settle final) hasta la burbuja de ese mensaje. Los atajos de scroll flotantes van **centrados abajo**
> ("jump to latest" en la conversación, que baja; "back to top" en el historial
> de commits, que sube) y comparten un botón circular neutral de 52 dp. Cuando
> "jump to latest" aparece, la franja de contexto del turno y el aviso de modo
> autónomo (si existe) se deslizan hacia el composer, se desvanecen y colapsan
> dentro de un clip; así despejan el área de lectura sin quedar visibles bajo el
> velo translúcido. En la franja visible al fondo, los controles del turno
> permanecen plegados a la izquierda y los indicadores de edits/contexto a la
> derecha; al desplegar los primeros, los indicadores informativos salen con
> fade + desplazamiento y ceden progresivamente todo el ancho compacto, y
> reaparecen al plegar. La transición usa motion M3E compartido y se vuelve
> inmediata con reduced motion. Los menús de opciones del turno no roban el
> foco del composer y recalculan su anclaje si cambia la geometría del teclado.
> Las compactaciones confirmadas por el agente se insertan como hitos tonales
> `CompactionContent` dentro del orden real de `Message.segments`; no forman
> parte del texto copiable ni de previews. Codex (`contextCompaction`), Claude
> (`system/compact_boundary`), OpenCode (`session.compacted` en 1.x /
> `session.compaction.ended` en 2.x, solo cuando la sesión ya tiene contexto:
> tras su primera salida del modelo o al reanudar una sesión previa — la
> compactación automática que OpenCode hace antes del primer paso de una sesión
> nueva no genera hito) y pi (`compaction_end` exitoso) emiten la señal. Zero/Grok por ACP y Antigravity no
> exponen una señal fiable en la integración actual, por lo que el bridge no la
> infiere a partir del texto ni del contador de tokens.

#### 5.6.4 Reconciliacion de historial

```dart
// Paginacion: al llegar al tope del scroll, carga historial anterior
TimelineWidget.onScrollToTop()
→ ThreadManager.loadMoreHistory(threadId)
→ SyncManager.reconcileHistory(threadId, cursor: currentCursor)
→ Bridge: thread/turns/list { threadId, cursor, limit: 20 }
→ TimelineSnapshot.prependHistory(turns)
→ Mantiene posicion de scroll actual
```

#### 5.6.5 Deduplicacion de mensajes

```dart
// AssistantReplayDeduplicator
// Evita que mensajes duplicados aparezcan durante reconexiones
// o replays del bridge
class MessageDeduplicator {
  final Set<String> _seen = {};   // fingerprints vistos
  bool isDuplicate(Message message) {
    final fp = message.fingerprint ?? TextFingerprint.of(message.content).hash;
    return !_seen.add(fp);
  }
}
```

#### 5.6.6 Turn View Model

```dart
// lib/presentation/screens/conversation/conversation_view_model.dart
class ConversationViewModel extends StateNotifier<ConversationState> {
  final ComposerManager composerManager;
  final ThreadManager threadManager;
  final GitActionManager gitActionManager;
  final SessionCoordinator sessionCoordinator;

  // Estado
  bool get canSend => composerManager.canSend.value && sessionCoordinator.connectionPhase.value == ConnectionPhase.connected;
  bool get isStreaming => state.activeStreamingTurnId != null;

  // Acciones de alto nivel
  Future<void> send();
  Future<void> cancelCurrentTurn();
  Future<void> loadMoreHistory();
  Future<void> refreshGitStatus();
  Future<void> openGitActions();
  void openStatusSheet();
  void openBranchSelector();
  void dismissOverlays();
}
```

---

### 5.7 Modulo de integracion Git

**Objetivo:** exponer operaciones Git reales del repositorio en la PC a traves de una UI de producto que abstraiga la complejidad de Git.

#### 5.7.1 Toolbar Git en conversacion

El toolbar Git se muestra en la parte inferior de la ConversationScreen y se adapta al estado del repo:

```
GitActionsBottomSheet
├── Estado del repo: branch, N ahead, N behind, N archivos modificados
├── Acciones disponibles segun estado:
│   ├── Commit (si isDirty)
│   ├── Push (si ahead > 0)
│   ├── Pull (si behind > 0)
│   ├── Create Branch
│   ├── Create Worktree
│   └── Stacked Publish (commit + push + [PR])
├── Progreso para acciones largas:
│   ├── Barra de progreso por fase
│   └── Log de salida del comando Git
└── Error handling con mensajes de producto:
    ├── "No hay nada que commitear"
    ├── "La rama esta protegida"
    ├── "Hay conflictos de merge"
    └── "El worktree ya existe"
```

#### 5.7.2 Modelos Git

```dart
// lib/domain/entities/git/
class GitRepoState {
  final String branch;
  final String? upstream;
  final bool isDirty;
  final int ahead;
  final int behind;
  final GitDiffTotals diffTotals;
  final List<GitChangedFile> changedFiles;
  final bool isDetachedHead;
}

class GitDiffTotals {
  final int additions;
  final int deletions;
  final int binaryFiles;
  final int changedFileCount;
}

class GitChangedFile {
  final String path;
  final GitFileStatus status;    // added | modified | deleted | renamed | untracked
  final int additions;
  final int deletions;
}

class GitActionProgress {
  final GitActionKind kind;
  final List<GitActionPhase> phases;
  final GitActionPhase? currentPhase;
  final String? error;
}

class GitActionPhase {
  final String name;
  final GitActionPhaseStatus status;   // pending | running | completed | error
  final String? output;
}

// Resultados de operaciones
class GitCommitResult { final String sha; final String message; }
class GitPushResult { final String branch; final String remote; }
class GitBranchResult { final String branchName; }
class GitWorktreeResult { final String path; final String branch; }
class GitStackedActionResult {
  final GitCommitResult? commit;
  final GitPushResult? push;
  final String? prUrl;
}
```

#### 5.7.3 Worktrees administrados

El sistema soporta worktrees administrados para separacion de contextos:

```dart
// Crear worktree desde conversacion
GitActionManager.createWorktree(GitWorktreeParams(
  branch: 'feature/my-feature',
  path: '/projects/backend/.worktrees/feature-my-feature',
  managed: true,        // el bridge lo administra y limpia automaticamente
))
```

El bridge (en el daemon) mantiene un registro de worktrees administrados (`~/.uxnan/managed-worktrees.json`) y los limpia cuando el thread asociado se cierra.

#### 5.7.4 Diff viewer

```dart
// lib/presentation/screens/workspace/git/git_diff_view.dart
// Renderiza diffs con:
// - Lineas anadidas (verde)
// - Lineas eliminadas (rojo)
// - Contexto (sin cambios, gris)
// - Header de hunk (@@ -N,M +N,M @@)
// - Nombre de archivo y resumen de cambios
// - Scroll horizontal para lineas largas
```

#### 5.7.5 Revert de cambios del asistente

```dart
// RevertSheet permite deshacer cambios que el agente aplico al workspace
// Se accede desde el toolbar Git o desde un mensaje del asistente con cambios
RevertSheet
├── Lista de archivos afectados con preview del diff
├── Seleccion individual de archivos a revertir
├── CTA "Revertir seleccion"
└── Confirmacion antes de ejecutar
```

---

### 5.8 Bridge daemon local (PC)

**Ubicacion:** paquete npm independiente `uxnan-bridge`
**Tecnologia:** Node.js
**Plataformas PC:** Windows, macOS, Linux

El bridge es el componente que corre en la PC del usuario y actua como el plano de control local. No es parte de la app Flutter, pero su especificacion esta aqui porque la app movil depende de su API.

#### 5.8.1 Responsabilidades del bridge

1. Arrancar y mantener el runtime del agente local (Codex, OpenCode, etc.)
2. Publicar el QR de pairing y resolver sesiones de conexion
3. Desplegar, mantener conectado y reportar el relay propio del usuario cuando hay uno (`relay/*`, §5.10)
4. Registrar handlers de metodos JSON-RPC por dominio
5. Ejecutar Git localmente mediante `child_process`
6. Gestionar workspace, checkpoints y archivos
7. Mantener estado daemon en `~/.uxnan/` (fuera del repo del proyecto)
8. Vigilar rollout/versiones y compatibilidad
9. Sanitizar payloads: nunca exponer tokens o secretos al movil
10. Buffer de outbound messages para reconexion sin perdida

**Invariante de entorno al lanzar un agente.** Todo spawn de un CLI de agente
usa un entorno **explicito** — el del bridge menos la identidad por terminal que
inyecta el ADE de escritorio (`UXNAN_AGENT_ID`, url+token de su hook server,
endpoint file, endpoints de browser/MCP; ver `uxnandesktop/architecture/02d` §1.1
"Identidad por terminal, jamas heredada") mas lo que el adaptador fije a
proposito, que gana. Las variables de entorno se heredan por todo el arbol de
procesos, asi que un `uxnan-bridge start` arrancado **dentro** de una terminal
del ADE le pasaba esa identidad a cada agente que lanzaba, y sus hooks
reportaban al ADE como si fueran esa terminal. `agentEnv`
(`bridge/src/adapters/spawn.ts`) es el unico sitio que decide esto; un spawn
nuevo debe usarlo. El hook de aprobaciones del bridge reutiliza tres de esos
nombres (`UXNAN_HOOK_URL`/`_TOKEN`/`_THREAD_ID`) para su propio servidor: los
**fija** por turno y lo que fija sobrevive; solo se descarta lo heredado.

#### 5.8.2 Entrypoint y estructura de archivos del bridge

> NOTA: el bridge está implementado en **TypeScript** (`bridge/src/*.ts`,
> compilado a `dist/` con `tsc`), no en `.js` planos, y la estructura se
> reorganizó en subdirectorios por dominio. El árbol real:

```
bridge/
├── package.json
├── src/
│   ├── index.ts                    # API publica (startBridge, tipos)
│   ├── bridge.ts                   # entrypoint del daemon, orquestacion
│   ├── bridge-context.ts           # contenedor de dependencias inyectadas
│   ├── cli.ts                      # CLI (start/stop/status/qr/code/install-service/config/relay)
│   ├── daemon-state.ts             # persiste config, pairing, status
│   ├── daemon-config.ts            # ~/.uxnan/daemon-config.json
│   ├── handler-router.ts           # ruteo + validacion Ajv de metodos JSON-RPC
│   ├── bridge-status.ts            # snapshots de estado / relayConnected / update (BridgeUpdate)
│   ├── update-check.ts             # consulta a npm (dist-tag latest) + cache 24h para los comandos cortos del CLI
│   ├── self-update.ts              # §5.8.18: chequeo horario, bridge/update, ayudante `self-update`
│   ├── qr.ts                       # QR + pairing code
│   ├── account-status.ts           # snapshot sanitizado de auth (nunca tokens)
│   ├── version.ts                  # BRIDGE_VERSION + BRIDGE_PACKAGE_NAME desde package.json
│   ├── lock-file.ts                # single-instance lock + stop
│   ├── logger.ts                   # logging a archivo + redaccion de secretos
│   ├── service-installer.ts        # autostart por OS (sin elevacion)
│   ├── secret-store.ts / keyring-secret-store.ts  # identidad en keychain del SO
│   ├── relay/                      # §5.10: relay-service (dueño unico), relay-host (socket de
│   │                               #   control + un canal por telefono), cloudflare (deploy REST), relay-bundle
│   ├── transport/                  # E2EE: lan-server, server-handshake,
│   │                               #   crypto, secure-channel, outbound-log (catch-up),
│   │                               #   mdns-advertiser, local-hosts, trust-store, ...
│   ├── pairing/pairing-code-service.ts        # GET /pair/resolve?code=
│   ├── adapters/                   # un adapter + *-tools.ts por agente:
│   │                               #   opencode(+serve,approval)/claude/codex(+app-server,approval)/pi/antigravity/zero(+acp,approval)/grok(+acp,approval),
│   │                               #   echo, process-agent-adapter, content-blocks, run-options,
│   │                               #   resolve-<agente>, spawn (+ child-ledger, orphan-reaper)
│   ├── agents/agent-manager.ts     # orquestacion de turnos/streaming + approvals
│   ├── agents/attachments.ts       # imagenes inline → archivos en el cwd
│   ├── conversation/               # thread-store, native-session history convergence
│   ├── git/                        # git-runner, git-service
│   ├── workspace/                  # workspace-service, browse-service, checkpoint-service, path-guard
│   ├── push/                       # push-service, push-sender (FCM directo)
│   ├── hooks/                      # claude-approval-hook
│   └── handlers/                   # git, workspace, thread-context, project, agent,
│                                   #   account, notifications, bridge-control, desktop (stub), relay
└── scripts/                        # install-service-{macos,windows,linux}
```

> Nota histórica: el draft original listaba módulos `.js` sueltos (p.ej.
> `secure-transport.js`, `agent-transport.js`, `voice-handler.js`,
> `push-notification-completion-dedupe.js`). No existen como tales: la función de
> voz nunca se implementó (no está en el registry), no hay un dedupe de push
> aparte (el bridge envía un solo push por turn-end, directo a FCM), y el
> transporte está en `src/transport/`.

#### 5.8.3 Estado persistido del bridge

El bridge mantiene estado en `~/.uxnan/`:

```
~/.uxnan/
├── daemon-config.json              # configuracion general (incl. `relay`: {url, routingId, enabled}, ajuste compartido)
├── relay.json                     # como se configuro el relay: provider, accountId, deployedVersion
├── pairing-session.json           # pairing y session payload
├── bridge-status.json             # heartbeat y estado
├── trusted-phones.json            # telefonos de confianza registrados
├── managed-worktrees.json         # worktrees administrados
├── push-state.json                # estado de push notifications
├── threads/                       # historial mutable, un fichero por conversacion
│   └── <threadId>.json            #   reescrito solo cuando ESA conversacion cambia
├── metrics.json                   # ledger historico completo (version 2)
├── metrics.json.bak1..bak5        # generaciones locales del ledger
├── checkpoints.json               # metadata de checkpoints
├── update-check.json              # cache de actualizaciones
├── agent-processes.json           # procesos de agente que el daemon en marcha arranco
└── logs/
    └── bridge-YYYY-MM-DD.log
```

The bridge Ed25519 identity and the metrics sealing key live in the OS keychain,
not in these JSON files.

**Conversations are stored one per file, and that is load-bearing.** Every
streamed token mutates a conversation, so while they shared a single
`threads.json` each token re-read, re-serialized and rewrote the whole store.
Measured on a real 8.4 MB one: 36 ms to read and parse, 33 ms to serialize
(blocking the event loop) and 24 ms to write — **93 ms per delta**, which queued
behind the store mutex and throttled delivery to the phone to 5.8 deltas/s with
gaps of 109 ms (p50) and 573 ms (max). The same reply took 116 s against that
store and 26 s against an empty one: the cost scaled with the user's whole
history, so it got worse on its own. Per conversation the median write is a few
KB, and one conversation's size no longer taxes every other.

The conversations are also held in memory between mutations — this process is
their only reader and writer, guaranteed by the single-instance lock. **No
durability guarantee changes: every mutation still writes its file before it
resolves**, so nothing is deferred and no window of loss is opened. A legacy
`threads.json` is split into per-conversation files on first read and kept as
`threads.json.migrated` (a backup, not a deletion — it is the user's only copy
of that history until the new files are proven).

**No agent process outlives a bridge that is killed hard.** A graceful stop
closes every child (`AgentManager.stopAll`); a `SIGKILL`, a crash or an OOM kill
cannot, and the long-lived children (`opencode serve`, a resident `pi` / `agy`,
Codex's app-server, the ACP servers) are re-parented and keep running. So every
agent process starts through one place (`adapters/spawn.ts`), which records it
in `agent-processes.json` — `{ version: 1, processes: [{ pid, command, args,
cwd, startedAt, ownerPid, ownerStartedAt }] }` — and removes it on exit
(`adapters/child-ledger.ts`, one writer, atomic writes). Only the long-running
daemon keeps the record, after it holds the single-instance lock. Before it
serves anything, it ends each recorded process that is **still running**,
**orphaned** (its parent is no longer the recording bridge — on Windows, which
keeps a dead parent's pid, that bridge must also be gone) and **still the same
process** (its command line ends with the recorded arguments after the recorded
executable, and it started within seconds of the recorded time), then starts a
fresh record (`adapters/orphan-reaper.ts`). Inspection needs no native module:
`ps -ww -o ppid=,etime=,command=` on macOS / Linux, PowerShell `Get-CimInstance
Win32_Process` on Windows; the end is `SIGTERM`, then `SIGKILL` after 3 s
(re-checked first) on POSIX, `taskkill /PID <pid> /T /F` on Windows. Any doubt
leaves the process running: nothing unrecorded is looked at, and a reused pid
fails the command and start-time checks. The log carries counts and agent
names, never a command line.

#### 5.8.4 Autostart del bridge

- **macOS:** LaunchAgent en `~/Library/LaunchAgents/dev.luisgamas.bridge.plist`
- **Windows:** Windows Service o Task Scheduler via PowerShell
- **Linux:** systemd user unit en `~/.config/systemd/user/uxnan-bridge.service`

#### 5.8.5 Protocolo de instalacion del bridge

El bridge se instala como paquete npm global:

```bash
npm install -g uxnan-bridge
uxnan-bridge start          # inicia el daemon
uxnan-bridge qr             # muestra QR de pairing en terminal (el del bridge en ejecucion si hay uno)
uxnan-bridge code           # codigo de pairing manual (bridge/pairingCode por el canal local si hay uno)
uxnan-bridge status         # estado del daemon en ejecucion (bridge/status por el canal local, §5.8.15; no arranca otro)
uxnan-bridge stop           # detiene el daemon
uxnan-bridge install-service   # configura autostart en la plataforma
```

#### 5.8.6 Git handler (bridge)

```javascript
// src/handlers/git-handler.js
// Ejecuta comandos Git localmente via child_process.execFile/spawn
// Resuelve el cwd correcto desde el contexto del thread

async function handleGitStatus({ cwd }) { ... }       // git status --porcelain
async function handleGitDiff({ cwd }) { ... }          // git diff HEAD
async function handleGitCommit({ cwd, message }) { ... }
async function handleGitPush({ cwd, branch, remote }) { ... }
async function handleGitPull({ cwd, branch }) { ... }
async function handleGitCheckout({ cwd, branch }) { ... }
async function handleGitCreateBranch({ cwd, name }) { ... }
async function handleGitCreateWorktree({ cwd, branch, path, managed }) { ... }
async function handleGitWorktrees({ cwd }) { ... }
  // git worktree list --porcelain, parseado (parseWorktreePorcelain).
  // Devuelve { worktrees: [{ path, branch?, isMain, isLocked? }] }, el
  //   principal primero — que es lo UNICO que lo distingue: `isMain` es
  //   posicional, git no lo marca.
  // Fuera de un repositorio devuelve [] en vez de lanzar: se pregunta por raiz
  //   configurada, y una raiz que no es repo es un caso normal, no un error.
  // Existe porque los worktrees son HERMANOS en disco (`repo` y
  //   `../repo-feature` no comparten relacion de ruta), asi que el cliente no
  //   puede deducir la jerarquia y hay que decirsela. El movil lo usa para
  //   agrupar carpetas bajo su repositorio; un bridge anterior responde
  //   "metodo desconocido" y la lista se queda plana.
async function handleGitStackedPublish({ cwd, message, remote, branch }) { ... }
async function handleGitLog({ cwd, limit, cursor, ref }) {
  // git log <ref|HEAD> --date-order --format=...%x1e --decorate=full -z
  //   --shortstat -n (limit+1) --skip <offset>
  // Orden por FECHA respetando topología (`--date-order`: nunca un padre antes
  //   que sus hijos, por lo demás por commit-time, más reciente primero) →
  //   coincide con el ADE de escritorio (git2 `Sort::TOPOLOGICAL | TIME`) y con
  //   la lista de GitHub. (`--topo-order` agrupaba cada rama y desordenaba los
  //   commits por fecha en el teléfono.) Sigue siendo orden topológico válido →
  //   el grafo swimlane queda limpio (sin lanes colgando/fantasma).
  // Paginación por OFFSET: `cursor` es un token opaco (= nº de commits a saltar);
  //   nextCursor = offset+limit. (El antiguo `cursor^` saltaba el 2º padre de un
  //   merge y PERDÍA commits en un DAG.) Devuelve {commits, hasMore, nextCursor}.
  // %D (--decorate=full) → refs[] por commit (HEAD/ramas/remotas/tags).
  // Parser robusto: un merge no emite --shortstat, así que el record siguiente
  //   empieza con el terminador -z sin stat — se quita el NUL líder antes de
  //   separar campos (si no, se descartaba el commit posterior a un merge).
  // Repo fresco (sin HEAD) → {commits:[], hasMore:false} (no error).
}
async function handleGitCommitShow({ cwd, sha }) {
  // git show -s --decorate=full --format=...  → metadata (incl. refs[])
  // git show --name-status --numstat -M       → files[] (status + oldPath en
  //   renames + additions/deletions por archivo)
  // git show --format= -M                      → diff unificado completo
  // Devuelve { commit, files, diff, diffTruncated? } (diff capado ~400 KB).
}
```

El método `git/log` es la fuente de la pantalla de historial de commits
(`GitHistoryScreen` en `presentation/screens/workspace/git/`): la app
lo llama al abrir y al acercarse al final del scroll (paginación incremental),
pasando el `nextCursor` de la página anterior como `cursor`. `parents[]`
alimenta la vista gráfico (cada parent es un "lane") y `refs[]` aporta los
chips de rama/tag y el resaltado de HEAD. `git/commitShow` alimenta el detalle
de un commit (archivos tocados con +/- y diff completo).

**UI:** `GitHistoryScreen` se abre desde un `IconSurface` `history_rounded`
en la app-bar de `GitScreen` (solo visible cuando hay un repositorio
abierto). Es **una sola lista plana** (sin chrome de tarjeta — el mismo
lenguaje limpio del file browser), limitada a 840 dp en ventanas amplias:
cada fila muestra los chips de
rama/tag/HEAD (`refs[]`), un badge del short-SHA y `+/-` coloreados. La
app-bar mantiene visibles Buscar y Grafo; las acciones menos frecuentes viven
en un `IconSurfaceMenu` vertical igual al de `GitScreen`:

- **Grafo** (`account_tree`) — superpone un grafo estilo VS Code (swimlanes):
  filas de **altura fija** para que los puntos se alineen en carriles, **color
  estable por rama** (el color sigue a la rama aunque cambie de columna),
  curvas suaves en branch/merge, y un **nodo de merge** distinto (punto sólido
  + anillo de contorno separado). El gutter ocupa el ancho real de los carriles
  (el texto se recorre a la derecha para que el grafo se vea completo).
- **Compacto** (menú) — densidad de fila más alta.
- **Selector de rama/ref** (menú, `alt_route`, vía `git/branches`) — ver el historial
  de cualquier rama/remota en modo **solo lectura** (no hace checkout); muestra
  un banner "Viewing <ref>" con retorno a HEAD en un toque.

`GitCommitDetailScreen` usa una columna editorial limitada a 760 dp: mensaje
y metadatos se leen sin tarjetas decorativas, y los archivos tocados forman
filas planas expandibles con separadores. Sólo el diff abierto recibe una
superficie tonal para distinguir el contenido de código del resumen.

Paginación cursor-based con **scroll infinito** (carga al acercarse al final) +
botón *Load older commits* + un FAB **volver-arriba**. Tocar un commit abre la
pantalla completa `GitCommitDetailScreen` (vía `git/commitShow`): mensaje
completo, refs, autor/committer/fecha, SHA copiable, padres, stats, **la lista
de archivos (status + +/- por archivo + `from <old>` en renames) y el diff
unificado completo** (coloreado, scroll horizontal, aviso de truncado).
Pull-to-refresh recarga la primera página. `git/log` y `git/commitShow` son
lectura pura: no tocan `git/status`.

La implementación sigue el sistema Neural Expressive
(`docs/neural-expressive-design.md`): filas planas tipo file browser
(`InkWell`, sin tarjeta), `CustomPainter` para el grafo de swimlanes,
`PolygonLoader` (shape-morphing §4.7) para el spinner y los tokens
`UxnanSpacing` / `UxnanRadius`.

#### 5.8.7 Workspace handler (bridge)

```javascript
// src/handlers/workspace-handler.js
async function handleReadFile({ path }) { ... }          // lee archivo del disco
async function handleReadImage({ path }) { ... }         // lee imagen, codifica base64
async function handleListWorkspace({ cwd }) { ... }      // lista archivos del proyecto
async function handleResolveFileLink({ cwd, href }) { ... } // resolve agent citation for viewer
async function handleCaptureCheckpoint({ threadId }) { ... }
async function handleDiffCheckpoint({ checkpointId }) { ... }
async function handleApplyCheckpoint({ checkpointId }) { ... }
async function handleApplyPatchChanges({ changes }) { ... }
```

`workspace/searchFiles` complementa a `workspace/list` con una **busqueda
fuzzy de archivos en todo el repositorio** (respeta `.gitignore`, excluye
`.git` y archivos sensibles igual que `list`): en un repo git es un unico
`git ls-files` (tracked + untracked no ignorados) mas las carpetas ancestro
derivadas; fuera de un repo, un walk recursivo acotado. El ranking es
basename-substring > path-substring > subsecuencia. Lo consume el picker `@`
del composer movil y el buscador de `FileBrowserScreen`. Este último muestra
el nombre como información principal y la ruta relativa al workspace como
información secundaria; al abrir un resultado expande de forma perezosa sólo
sus carpetas ancestro para revelar su ubicación al volver del visor. Cerrar la
búsqueda sin seleccionar un resultado no modifica el árbol. Mientras la vista
de búsqueda aún cubre el árbol, el móvil pre-posiciona la fila seleccionada
cerca del centro del viewport (limitada por los extremos normales del scroll),
de modo que el usuario no ve una animación de desplazamiento y al volver del
visor encuentra el archivo inmediatamente.

`workspace/resolveFileLink { cwd, href }` resolves a file citation on the PC,
where the filesystem and platform-specific path rules are authoritative.
Relative paths start at the conversation cwd. Absolute paths, `file:` URLs and
`..` references may land in a sibling worktree: when the target is outside the
conversation root, the bridge returns the target's Git top-level as the new
viewer `cwd` (or the containing directory for a non-Git file) plus a relative
`path`. The canonical target must exist and be a regular file; fragments,
percent encoding and common `:line[:column]` suffixes are normalized. `.git`
internals and sensitive path segments remain denied.

Las RPCs `workspace/list`, `workspace/searchFiles`,
`workspace/resolveFileLink`, `workspace/readFile` y `workspace/readImage` son
consumidas hoy por:

- **Folder browser en la app** (`NewConversationScreen` /
  `WorkspaceBrowserSheet`, en `presentation/screens/threads/`) — el selector
  de root + breadcrumb dentro del diálogo full-screen Neural Expressive. La
  selección de agente se compara directamente en un grupo de tarjetas de
  esquinas dinámicas; sólo la tarjeta seleccionada revela sus capability chips.
- **Workspace file viewer** (`FileBrowserScreen` + `FileViewerScreen` under
  `presentation/screens/workspace/files/`, managed by
  `FileBrowserManager`) — the lazy tree and repo-wide fuzzy search feed a
  capability-based viewer: editable and selectable highlighted UTF-8 source;
  selectable git diffs; GitHub-style Markdown preview/source with common README
  HTML normalization, alert callouts, `<details>` disclosures, HTML tables, task
  lists and highlighted scrollable fences; local and HTTPS raster, animated GIF,
  and SVG resources;
  full-surface raster/SVG zoom; SVG Preview / Source / Changes parity; native
  Android/iOS PDF preview; and an honest fallback for unsupported binary files.
  Relative Markdown resources and file links resolve against the open document,
  discard query/fragment suffixes before local reads, and are rejected if
  normalization would leave the workspace. A tapped link opens another document
  in the viewer (workspace-relative), is handed to the OS (`http`/`https`/
  `mailto` only), or is copied — never launched under any other scheme. HTTPS resources go through a shared
  `RemoteResourceService` (`infrastructure/media/`): `https`-only, bounded at
  5 MiB, cached by URL, and typed from the response (`content-type` + payload
  signature) rather than from the URL, since shields answer extensionless
  endpoints with `image/svg+xml`. Inline placeholders measure their slot so a
  badge-height row degrades to a single glyph instead of overflowing the line. `workspace/readFile` preserves PDF
  bytes as base64 (bounded at 20 MiB); `workspace/readImage` carries supported
  images (bounded at 10 MiB). Both pass through `path-guard` (§5.8.9/infra),
  which confines reads to the workspace root and excludes sensitive files. The
  viewer is the folder's route (`/workspace/files?cwd=…`): it opens from the
  `folderOpen` `IconSurface` beside the `GitScreen` one in
  `ConversationScreen`, and from the same glyph on the folder's row in
  `ThreadsScreen`.
  Conversation links first resolve to a canonical viewer root; every
  subsequent read remains confined to that root and excludes `.git` and
  sensitive files.

Cada entrada de `workspace/list` (`WorkspaceEntry` en `shared/`) lleva
`name` + `type` (`file`/`dir`) y, en archivos, `size` y `mtime` (epoch ms,
del mismo `stat`). Además expone `ignored?: boolean`: el bridge marca por
listado qué entradas ignora git (un match de `.gitignore`/exclude) con un
único `git check-ignore -z --stdin`; un directorio no-repo (o cualquier
error de git) deja todo sin marcar. Es **independiente** de `GitFileStatus`
(las entradas ignoradas nunca aparecen en `git/status`, así que no inflan
los contadores del Git screen): el visor de archivos las atenúa (tono
apagado + cursiva) para distinguirlas de las trackeadas/untracked, mientras
los estados git (added/modified/deleted/untracked) conservan su color
convencional. El ADE de escritorio replica el atenuado con su propio
`FsEntry.ignored` (tipo local, vía git2 `is_path_ignored`).

#### 5.8.8 Native-session history convergence

`turn/list` reconciles the agent-owned transcript before reading the bridge
store whenever that thread has no bridge-driven turn in flight. This is not an
empty-store fallback: it runs on every idle read so completed turns written from
another client attached to the same native session converge into Uxnan.

| Agent | Authoritative readable source | Support |
|---|---|---|
| Codex | `~/.codex/sessions/<Y>/<M>/<D>/rollout-<ts>-<sessionId>.jsonl` | Codex Desktop/CLI completed turns |
| Claude Code | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | completed CLI turns |
| pi | `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<sessionId>.jsonl` | completed CLI turns |
| OpenCode | local `opencode serve`: `GET /session/:id/message` (1.x) or `GET /api/session/:id/message?order=asc` following its cursor (2.x), normalized by the version's protocol client; legacy JSON-store fallback | OpenCode Desktop/CLI completed turns across current SQLite and older installs |
| Zero | `~/.local/share/zero/sessions/<sessionId>/events.jsonl` | completed ACP session turns |
| Grok | `~/.grok/sessions/<encoded-cwd>/<sessionId>/updates.jsonl` | ACP turns closed by `turn_completed` only |
| Antigravity | none | unsupported: `agy` has no history/export API and its SQLite step payloads are opaque |

`IAgentAdapter.nativeSessionId(threadId)` supplies the native identity and
`AgentManager` persists it through `ThreadStore.setAgentSession`. The mirror of
that — `IAgentAdapter.adoptNativeSession(threadId, sessionId)`, offered before a
turn runs and only when the stored session belongs to the same agent — hands the
id back after a bridge restart (or a self-update), so the conversation continues
in the SAME agent session rather than opening a new one behind a history the
phone still shows. Every adapter implements it through the one map
`BaseAgentAdapter` keeps (verified 2026-09-27 against all seven CLIs: each one
recalled a word from before the restart). A stored session the CLI no longer
has is refused once — the turn runs in a fresh session instead of failing — and
never adopted again for that thread; a fork does not inherit the original's
session (`thread/fork` drops `agentSessionId`), so two conversations never write
into one transcript. Reconciliation then follows these rules:

- bridge-owned turns keep their UUID and remain authoritative for ordered
  segments, queue state, usage and delivery status;
- a matching native turn is linked by a private deterministic history id rather
  than inserted twice;
- **a turn is matched by content identity — its prompt and its reply, each
  concatenated across however many messages carry it, compared ignoring
  whitespace.** Per-message comparison is wrong: the bridge accumulates one
  assistant message per turn while a native transcript splits the same reply
  across several, one per tool step and most with no prose at all. Where an
  agent's log keeps a different rendition of the reply than the one it streamed
  (Zero drops the preamble), the same prompt plus one reply containing the other
  plus a native start inside the bridge turn's own run window identify it — all
  three together, so a turn genuinely written elsewhere still imports;
- **a bridge turn that ended with no reply at all** — closed before the bridge
  received a word of it (an older bridge that took an unrelated `result` for
  its end, a crash) while the agent answered on in its own transcript — is
  matched by the prompt and a native start inside its run window alone, and
  the transcript's reply is **filled into that turn**, which keeps its id and
  position. Without it the reply imported as a turn of its own at the end of
  the conversation, below later exchanges, and the question stayed unanswered
  where it was asked;
- a turn imported before it could be matched is **dropped** once its
  bridge-created twin is recognized, which is what converges a store that
  already holds the same exchange twice. Its position (`Turn.seq`) is not
  handed out again — the store keeps the highest one it ever gave — and a
  client lets go of any turn it held before a re-sync that the newest page no
  longer lists, the end of the conversation included;
- **every turn read from a transcript has the one shape a client renders**: at
  most one user message and ONE assistant message whose `segments` hold its
  prose and steps in order (`canonicalTurn`, `session-history.ts`). Handed a
  reply split into a message per transcript line, the desktop showed only the
  first (often empty) one and the phone kept replacing one with the next —
  rows imported that way are reshaped when the store loads;
- **an agent waking itself up is not a prompt.** Claude Code writes the end of a
  background task as a user line (`<task-notification>…`) and answers it in the
  same run: it opens no turn, and the reply continues the turn it belongs to;
  a row imported as such a prompt is dropped on load;
- **nor is anything else Claude Code adds on its own.** An image's size note,
  a loaded skill's body or a hook's context is written as an `isMeta` "user"
  line of the running prompt, and a compaction leaves an `isCompactSummary`
  one: none of them opens a turn. Taken as prompts, one run became a turn per
  line, each imported beside the bridge's own record of it — duplicate and
  stray bubbles on the phone, which re-imported them on every 3-second poll;
- **what the transcript holds of a run the bridge drove is never
  native-only.** One native session runs one turn at a time, so a native turn
  that starts inside a bridge-recorded turn's run (from its start, less the
  clock slack, to its end — or just its start, for a turn a restart cut short)
  is that run, whatever the reader made of it: it is not imported, a row
  imported that way before is dropped on the next read, and a twin is always
  the bridge's own record, never another imported row. Reconciling is
  idempotent: a second read of an unchanged transcript changes nothing;
- a message a bridge from before the mid-turn hand-off (§5.8.13) stored as a
  turn with no reply — the reply went on in the turn before it — is matched to
  its transcript turn by prompt, and the part of the previous turn from where
  that reply begins moves back into it (`takeBackSteeredReply`);
- completed native-only user/assistant pairs are imported and can be refreshed
  on a later read;
- a row already imported is the same exchange as a transcript turn with the
  same prompt and the same start (or the same reply) — also under an id an
  older reader gave it, or read while the agent was still answering: it is
  refreshed in place and kept once (`sameExchange`), and a leftover second
  copy is dropped;
- user-only native turns are ignored until an assistant result is durable (a
  turn read mid-answer is kept as far as it went and refreshed by the rule
  above);
- missing or temporarily unreadable native rows never delete bridge history;
- native history is not read while the bridge itself is streaming that thread,
  preventing a half-flushed record from being frozen as an external turn.

The wire shape and offset pagination of `turn/list` do not change. This provides
near-real-time **completed-turn convergence**, not token streaming from the
external client. The active Mobile conversation polls the newest page every
three seconds while connected and idle; navigation, reconnect and lifecycle
resume also trigger immediate reads.

##### The other direction: the phone's conversation must open in the agent's app

Convergence is not only a read. A conversation **started from Mobile** has to be
openable in the agent's own client, and for Codex that is a write claim, not a
read: the app-server grants **one writer per thread**, held for as long as the
thread is loaded in a process. So an adapter that keeps a process alive across
turns locks every conversation the phone ever touched, and Codex Desktop /
`codex resume` refuse to open it (`already has an active writer`, surfaced by
the Codex app as *this conversation is not available*).

**Rule for any server-style adapter: the bridge holds an agent session only
while a turn is in flight.** Codex implements it by ending its `codex app-server`
as soon as no turn is running and re-attaching with `thread/resume` on the next
one — `thread/unsubscribe` does NOT release the writer (measured on codex-cli
0.147.0: the thread stays loaded and held; only the process exiting hands it
over). The turn's `(approvalPolicy, sandbox)` rides on each resume, so a
mid-conversation access-mode change applies from the next turn.

The conflict is symmetric and has no fallback: if the agent's app holds the
thread when Mobile sends, the turn fails with a message naming the other client
rather than a protocol string. If the native session was deleted elsewhere, the
conversation continues in a fresh native thread.

#### 5.8.9 Account status sanitizado

```javascript
// src/account-status.js
// NUNCA expone tokens al telefono
// Solo expone estado sanitizado:
{
  agentId: "codex",
  requiresLogin: false,
  loginInProgress: false,
  authenticatedProvider: "openai",
  displayName: "dev@example.com",
  transportMode: "local",
  platform: "darwin"
}
```

#### 5.8.10 Uso por proveedor: limites (`agent/usageStats`) y gasto (`usage/summary`)

**Un solo lector, el bridge; todos los clientes le preguntan** (el telefono y el
panel Proveedores de Uxnan Desktop). Contratos en `shared/src/models/usage.ts`
(ver 02b).

**Limites del plan — `agent/usageStats { providers }`.** Ventanas de cuota (%
consumido + reinicio), plan/cuenta, saldo y reinicios canjeables de los
proveedores que el usuario **activo** (nunca de todos). Postura:
- **Claude Code y Codex se preguntan a si mismos.** Cada CLI responde por la cuenta
  con la que ya inicio sesion, desde la sesion que el mismo guarda, asi que el
  bridge **no lee ninguna credencial ni necesita permisos del SO** — los limites
  de Claude llegan tambien en macOS (antes quedaban en el llavero, fuera del
  alcance del bridge). Claude: `claude --input-format stream-json`, peticiones de
  control `initialize` (cuenta, organizacion, plan) y `get_usage` (`rate_limits`
  con `limits[]` `percent`/`resets_at`, `extra_usage`); Codex: `codex app-server`,
  `account/read` y `account/rateLimits/read` (ventanas `primary`/`secondary`,
  creditos y `rateLimitResetCredits`). Procesos efimeros, sin turno ni tokens
  (`bridge/src/usage/cli-usage.ts`).
- **Copilot y Grok** no tienen esa superficie: solo se lee el token que cada CLI
  guardo (`gh auth token`, `~/.grok/auth.json`) y se llama a la API oficial de uso
  del proveedor. Nunca cookies del navegador, API keys pegadas ni refresh tokens.
  - Grok: `cli-chat-proxy.grok.com/v1/billing?format=credits` gives the
    `creditUsagePercent` window (when the account has one) and the `{val}` USD
    amounts → `credit`: on-demand spend of its cap once a cap is set or anything
    was spent, else a prepaid balance above zero, else none (a free account's
    are all 0). The plan comes from `/v1/user?include=subscription`
    (`subscriptionTier`; `null` on a personal account reads `Free`), the call
    the Grok CLI itself takes it from; its failure only drops the plan.
- Cada proveedor degrada a un `status` (`ok`/`authRequired`/`notInstalled`/`error`);
  uno lento o roto no tumba a los demas.
- **`usage/redeemReset { provider, idempotencyKey, creditId? }`** canjea un reinicio
  de Codex (`account/rateLimitResetCredit/consume`) y responde el uso actualizado.

**Gasto — `usage/summary { days }`.** Tokens y costo por dia local de la PC, agente
y modelo, leidos de las **transcripciones que cada CLI guarda en disco** (Claude
Code `~/.claude/projects`, Codex `~/.codex/sessions`, pi `~/.pi/agent/sessions`,
Grok `~/.grok/sessions`, OpenCode 2 `opencode.db`, Zero `~/.local/share/zero/sessions`):
cuenta **todo** lo que el agente gasto en esa PC, los turnos del bridge y las sesiones
que la persona corrio en una terminal. Antigravity queda fuera: su transcripcion no
registra tokens (`bridge/FOR-DEV.md`). El costo es el facturado donde el CLI lo registra (pi, Grok, OpenCode) o
una estimacion a precios de API (Claude, con la tabla de precios del propio CLI);
un modelo sin precio conocido se muestra como tal (`unpricedTokens`), nunca se
adivina. Escaneo incremental con cache en `~/.uxnan/usage-scan.json` (lo leido de
cada archivo y hasta donde); las respuestas de Claude que una sesion reanudada
copia a otro archivo se cuentan una vez. Nada crudo sale del bridge: solo sumas.

#### 5.8.11 Metricas de perfil (`metrics/*`) — bridge como fuente de verdad

Mobile profile metrics (conversations, messages, agents/models used, connected
time, sessions, Git actions and activity heatmaps) are owned by
the **bridge** and served through `metrics/*` (`MetricsSnapshot` in
`shared/src/models/metrics.ts`; see 02b §1.2). The phone caches/renders one
snapshot per PC and sums PCs. The development `echo` agent is never counted.
Tokens and cost are **not** in this ledger: `usage/summary` (§5.8.10) reads them
from each CLI's own history, which covers every session on the PC — one source
for what the agents spent, not a second count of the bridge's turns. Provider
quota/credit usage is a separate live surface (`agent/usageStats`) and is never
written to this ledger either.

`metrics/metrics-store.ts` persists a version-2 ledger in
`~/.uxnan/metrics.json`:

- Conversation rows preserve creation time plus the observed agent/model.
- Turn rows preserve message counts by UTC calendar day and assistant-reported
  token throughput. Agents without usage reporting still contribute messages
  with zero tokens. Tokens are throughput, not billed cost.
- Secure-channel sessions preserve phone device id, relay/direct transport and
  duration. A crash-left session closes at its own start time on next startup,
  so it counts without inflating connected time.
- Mutating Git operations preserve method, thread association, outcome and time.

Rows have stable ids. Conversation/turn projections advance by `updatedAt`;
sessions and Git rows are append-only. Existing `threads.json` history is
backfilled idempotently at startup and before snapshot/export. Deleting a thread
only deletes mutable conversation history — it never deletes ledger rows, so
activity totals cannot go backwards. Day keys use `utcDayKey` (UTC midnight of
the host calendar date), which keeps heatmap cells timezone-stable.

Every ledger write is atomic and preserves five rotating local generations
(`metrics.json.bak1` … `.bak5`). If the primary is missing or malformed, reads
recover from the newest readable generation.

**Tamper-proof backup (`metrics-seal.ts`):** `metrics/export` seals the complete
ledger with AES-256-GCM under a 32-byte OS-keychain secret (header as AAD).
Therefore the file is non-editable and same-PC only; an optional passphrase adds
scrypt-based confidentiality. `metrics/import` verifies, decrypts, validates and
idempotently merges every ledger stream. Version-1 partial backups remain
readable. Any authenticated phone can call `metrics/get` after pairing and
rehydrate the PC history without restoring a phone-local identity.

The ledger is intentionally global per PC. `phoneDeviceId` and its Ed25519 key
remain transport/trust identifiers, not user-profile identifiers. The phone
keeps its metrics provider alive for the application lifetime and calls
`metrics/get` on every successful (re)connection. Secure identity material does
not migrate to another device; an installation without the original secret
generates a fresh identity and re-pairs. Hardware ids are not used. Individual
per-phone profiles are deferred until explicit profile recovery, rebinding,
attribution, revocation and migration semantics exist.

---

#### 5.8.12 Entrega de adjuntos de imagen (`turn/send { attachments }`)

Ningun CLI de agente acepta base64 inline por la via headless, pero **todos**
los cableados pueden ABRIR un fichero local con sus propias herramientas de
archivo/vision. Por eso el bridge materializa cada adjunto a disco y referencia
la ruta en el prompt (`src/agents/attachments.ts`), sin manejo de imagen por
adaptador.

Reglas (no negociables, verificadas contra los CLIs reales):

- El fichero se escribe **dentro del directorio de trabajo del agente**
  (`<cwd>/.uxnan-attachments/<turnId>/`) y se referencia con ruta **relativa al
  cwd**: los agentes estan confinados a su workspace y rechazan una ruta fuera
  de el (Claude responde *"the read was blocked by a permission prompt"* para la
  misma imagen colocada en el temp del SO).
- Si el turno no trae `cwd`, se usa el del **adaptador**
  (`IAgentAdapter.defaultCwd()`), que es donde el CLI se lanza realmente. El
  temp del SO queda solo como ultimo recurso para un adaptador que no reporte
  ninguno.
- Un **archivo** (`type: 'file'`) conserva su nombre, en una carpeta propia
  (`.../<turnId>/<n>/<nombre>`) para que dos con el mismo nombre no choquen; la
  nota del prompt dice *Attached file(s)*. Una imagen es `image-<n>.<ext>`.
  Cualquier agente lo abre con sus herramientas de archivos, asi que no depende
  de `capabilities.images`.
- El directorio se borra al terminar el turno.
- El mensaje que se persiste en el historial no filtra rutas temporales: guarda
  el texto del usuario tal cual (vacio en un turno solo-imagen) y **las imagenes
  junto al mensaje**. El bridge es su dueno: las escribe en
  `~/.uxnan/attachments/<threadId>/<turnId>-<n>.<ext>`, las nombra en
  `Message.attachments` (`{ id, mimeType, bytes, width?, height? }`, solo en el
  mensaje del usuario) y entrega los bytes con `turn/attachment { threadId,
  attachmentId }`. `turn/list` solo las nombra — una pagina de historial sigue
  siendo ligera — y cada cliente (telefono, desktop) pide la que muestra y la
  guarda en memoria. Un fork copia las imagenes; borrar el hilo las borra.
- `capabilities.images` declara si el agente puede recibirlos; el telefono
  oculta el "+" cuando es `false`. Que el modelo *vea* los pixeles o razone
  sobre los bytes con herramientas es cosa del modelo — un modelo no multimodal
  igualmente responde inspeccionando el fichero.
- **Excepcion: entrega nativa.** Un adaptador cuyo protocolo transporta imagenes
  y cuyas herramientas de fichero NO pueden abrirlas declara
  `IAgentAdapter.handlesAttachments()`; entonces el bridge **no** materializa
  nada ni añade la nota, y el adaptador entrega los adjuntos el mismo. Es el
  caso de **Zero**: su ACP anuncia `promptCapabilities.image` y decodifica un
  bloque `{ type: "image", mimeType, data }` inline, mientras que su `read_file`
  es texto por lineas — referenciar la ruta le haria leer un PNG como basura.

---

#### 5.8.13 Cola de mensajes por thread (`AgentManager`)

El bridge conduce **un turno por thread**. No es una simplificacion: el agente
one-shot reanuda su sesion en cada turno (`claude -p --resume`), asi que dos
turnos concurrentes serian dos procesos CLI sobre la misma sesion nativa; los
agentes de **proceso residente por thread** (pi, Antigravity) leen un turno a la
vez de su stdin, asi que un segundo mensaje lo encolaria la propia CLI como el
turno *siguiente*, volcandolo en un turno que el bridge ya cerro; y los agentes
con servidor serializan por sesion. Un `turn/send` que llega con un turno en vuelo se
**encola** — el mismo comportamiento que las CLI cuando escribes mientras
trabajan (contrato completo en `02b` §1.2).

```javascript
// src/agents/agent-manager.ts
// #queueByThread:       threadId -> QueuedTurn[] (orden de ejecucion)
// #queuePausedByThread: threadId -> 'turnAborted' | 'turnError'
//
// sendTurn()  : hay turno activo (o cola no vacia) -> #enqueueTurn, que persiste
//               el turno con status `queued` (ThreadStore.queueTurn) y congela
//               sus run options; si no, arranca normal. Ambos caminos terminan
//               en #runTurn, asi que un turno encolado corre por la MISMA ruta
//               (comando/attachments/adapter) que uno inmediato.
// turn_completed -> #drainQueue: promueve el siguiente (`queued` -> `streaming`)
//               y lo entrega al adapter.
// turn_aborted / turn_error -> #pauseQueue: el usuario detuvo (o el agente se
//               rompio) por algo; los follow-ups esperan un `queue/resume`.
// turn/cancel de un turno encolado -> nunca toca un adapter: sale de la cola y
//               queda `cancelled` (conservado en el thread, no borrado).
```

La cola es **estado vivo**, como `#activeTurnByThread`: no se reconstruye tras
un reinicio. Por eso el arranque llama a
`ThreadStore.cancelOrphanedQueuedTurns()`, que marca `cancelled` cualquier turno
que quedo `queued` en disco — el usuario ve exactamente que mensajes no
salieron, en vez de quedar esperando una cola que ya no existe.

##### Entrega en pleno turno (steering)

Encolar hasta el final del turno **no es lo que hacen las CLI**: ellas recogen
lo que escribes en el siguiente limite de herramienta, *dentro* del turno en
curso — que es lo que permite corregir el rumbo de un agente sin detenerlo. El
bridge hace lo mismo donde la CLI del agente realmente lo permite, **y como la
CLI, a la vista**: el mensaje espera en la cola — visible, editable, cancelable
y con "Enviar ahora", el primero incluido — hasta que **termina el paso** en
que esta el agente, y solo entonces se entrega. Un paso largo, o colgado, no lo
bloquea.

```javascript
// #enqueueTurn -> SIEMPRE a la cola (queued)
// #onEvent(block con blockId) -> #trackStep(run, paso, isRunning) ; si el paso
//   TERMINO -> #deliverAtPause
//
// #deliverAtPause: entrega el PRIMERO de la cola, de uno en uno, cuando
//   adapter.capabilities.steering && adapter.steerTurn
//   + turno en vuelo, del mismo agente
//   + el agente ya NO esta dentro de ningun paso (el ultimo acaba de terminar):
//     lo lee antes de seguir
//   + cola NO pausada, sin aprobacion/pregunta pendiente, sin otra entrega,
//     sin un "Enviar ahora" deteniendo el turno
//   entregando -> sigue en queuedTurnIds, marcado deliveringTurnId (ya no se
//                 puede editar ni cancelar: turn/cancel lo rechaza)
//   tomado     -> espera a que los pasos en curso de la ejecucion terminen
//                 (#stepsSettled; el fin de la ejecucion tambien libera) y
//                 entonces #handOff: el turno en curso termina ahi (completed,
//                 con lo dicho hasta ese momento, continuedIn) y el mensaje pasa
//                 a streaming con el RESTO de la misma ejecucion
//                 (ThreadStore.handOffTurn) ; stream/turn/completed y
//                 stream/turn/started, en ese orden
//   rechazo    -> se queda `queued`, sin marca, y corre como el siguiente turno
// Sin pasos antes del final (el agente solo escribe) -> corre como el siguiente turno.
```

**Una relectura ve lo anunciado.** `#handOff` anuncia el relevo de forma
sincrona (ningun evento posterior de la ejecucion lo adelanta) y lo escribe
justo despues; un cliente que relee el turno al oirlo (`turn/read`,
`turn/list`) espera a las escrituras ya pedidas (`ThreadStore`
`#afterPendingWrites`), asi que nunca recibe la copia de antes — sin fin ni
`continuedIn` — que plegaba la respuesta interrumpida.

**El mensaje queda donde el agente lo leyo.** Lo que el agente dice despues de
leerlo contesta a ese mensaje, asi que se muestra debajo de el: para cada
cliente es una cola que avanzo antes de tiempo (el turno anterior termina, el
nuevo empieza). El turno que termino asi lo dice: `Turn.continuedIn` (y
`continuedIn` en su `stream/turn/completed`) nombra el turno donde siguio la
ejecucion, de modo que el telefono y el desktop muestran su respuesta como "lo
dicho hasta ahi" — completa, con un "continua abajo" — y no como una respuesta
final plegada, y marcan el mensaje que llego a mitad de ejecucion. Solo
mientras se entrega la burbuja sigue en la cola con "Llegandole al agente" y
sin acciones.

**El momento es el real.** El mensaje se coloca cuando el agente lo lee, no
cuando el bridge lo escribe:
- **Claude Code**: `steerTurn` resuelve cuando la CLI devuelve el mensaje al
  leerlo (`--replay-user-messages`, por su `uuid`). Escrito al terminar un
  paso, la CLI puede leerlo ahi o en su siguiente pausa: hasta entonces se ve
  "Llegandole al agente".
- **Codex, OpenCode y pi** solo confirman que lo aceptaron; lo leen al terminar
  el paso en que estan, asi que el `AgentManager` espera a que ese paso termine
  antes de colocarlo.

**`queue/sendNow` fuerza el envio, con todos los agentes.** Con un turno
corriendo **detiene ese turno** y el mensaje elegido corre en cuanto la
detencion se confirma, primero en la cola (`#sendNextAfterStop`; la cola no se
pausa por esa detencion, ni si el agente la reporta como error). Es lo unico
que alcanza a un agente atascado en un paso: ninguno lee mensajes hasta que su
paso termina. Lo hecho queda en el turno detenido y el resto de la cola
conserva su orden. Sin nada corriendo (una cola en pausa) corre ese mensaje de
inmediato. Rechazado solo para un mensaje que ya se esta entregando. Para que
el mensaje forzado empiece sobre una sesion limpia, OpenCode no da por
detenido un turno hasta que su servidor cierra el run (`idle` en 1.x,
`interrupted`/fallo en 2.x; 5 s como maximo) y descarta lo que ese run aun
envia. (Hasta 2026-09-29 el bridge entregaba el mensaje en cuanto llegaba; del
29-09 al 01-10, al empezar un paso, lo que lo dejaba sin poder retirarse
mientras el paso durara.)

**"Tomado" significa contestado en esa ejecucion.** `steerTurn` devuelve `true`
solo cuando la ejecucion en curso va a responder el mensaje, y cada adaptador
lo garantiza con lo que su CLI dice de verdad (verificado contra las CLI
reales, 2026-09-28):

- **Claude Code**: cada mensaje se escribe con un `uuid` y la CLI lo devuelve al
  leerlo (`--replay-user-messages`, `isReplay: true`); un `result` cierra el
  turno solo si ya se leyeron todos los mensajes escritos. Un `result` de un
  despertar propio de la CLI (una tarea en segundo plano que termino, o un
  `<task-notification>` que una sesion reanudada debia) o del turno del modelo
  que un mensaje tardio no alcanzo ya no cierra el turno. Una CLI que sale sin
  `result`, sin haber leido el prompt, o porque el bridge se detiene, falla el
  turno (con lo ultimo de su stderr) en vez de darlo por completado; un
  mensaje entregado que no llego a leer vuelve a la cola.
- **pi**: espera la respuesta RPC del `steer` (`success`), que pi da en ~20 ms
  este ocupado o no; un rechazo deja el mensaje en la cola.
- **OpenCode**: un `idle` que llega mientras se entrega un mensaje espera esa
  entrega; si el servidor lo acepto (tras el `idle` lo corre como otra
  ejecucion y termina con otro `idle`), el turno sigue abierto hasta ese
  segundo `idle`.
- **Codex**: `turn/steer` con `expectedTurnId` solo acepta sobre el turno
  activo.
- **AgentManager**: el fin de una ejecucion (`turn_completed`/`error`/`aborted`)
  libera la espera de pasos y espera a una entrega en curso, asi que un mensaje aceptado justo al terminar
  se contesta en su turno y nunca se envia dos veces; un mensaje encolado
  mientras el turno terminaba se ejecuta en vez de quedar varado; cancelar por
  el id de un turno ya relevado no detiene al nuevo; archivar cancela lo que
  esperaba en la cola; un turno detenido conserva la sesion del agente. El adaptador sigue nombrando la ejecucion por el id con el que
empezo; el `AgentManager` mapea ese id de ejecucion al turno que muestra su
salida (`#turnOfRun` / `#runOfTurn`), y lo usa tambien para `cancelTurn` y para
la siguiente entrega. Un paso que empezo antes del relevo y termina despues se
escribe en su fila original (`ThreadStore.settleStep`), sin repetirlo bajo el
mensaje nuevo; el texto final que reporta el adaptador cubre toda la ejecucion,
asi que tras un relevo se conserva el texto transmitido. Un turno ya relevado
no esta en la cola, por eso `queue/clear` no lo toca ni `#drainQueue` lo
reproduce. Cualquier negativa del adaptador deja el mensaje en la cola, asi
que un mensaje nunca se pierde: como mucho espera; uno que la CLI no llego a
leer antes de salir (Claude Code) vuelve a la cola y corre como turno propio.
Los mensajes en cola se entregan de uno en uno, en orden, uno por pausa; los
que no alcanzan una pausa corren al terminar el turno. (Hasta 2026-09 el mensaje
quedaba `delivered`, sin respuesta propia, y la respuesta seguia en el turno
anterior — por encima del mensaje que contestaba; los turnos guardados asi se
leen como `completed`.)

Que agentes pueden, y por que (verificado contra las CLI reales):

| Agente | ¿Steering? | Mecanismo |
|---|---|---|
| **Claude Code** | Si | `-p --input-format stream-json`, mensaje por stdin abierto |
| **OpenCode** | Si | 1.x: otro `prompt_async` sobre la sesion ya ocupada; 2.x: `POST /api/session/:id/prompt` con `delivery: "steer"` |
| **Codex** | Si | app-server `turn/steer { threadId, expectedTurnId, input }` |
| **pi** | Si | comando RPC `steer`, drenado por su bucle de agente en el siguiente limite |
| **Antigravity** | No | `--input-format stream-json` "runs a turn for each" mensaje de stdin: un segundo mensaje es el siguiente turno, no un steer; la CLI no tiene mensaje de steer |
| **Zero** | No | su ACP serializa con `turnMu`, y su propio TUI tampoco inyecta |
| **Grok** | No | ACP no define un metodo de steer ni lo anuncia en `initialize` |

Zero es el caso instructivo: **ya se comporta como la cola del bridge**. Su TUI
solo lanza el mensaje encolado cuando el turno termino, asi que aqui no hay
comportamiento nativo que igualar.


#### 5.8.13b Nombre de la conversacion (`AgentManager` + adaptadores)

Un thread se llamaba como los primeros ~72 caracteres de su mensaje inicial, asi
que dos conversaciones que empiezan con la misma frase eran indistinguibles en la
lista. **Ningun CLI puede ayudarnos aqui**: todos dejan el titulo a su propio
cliente y las superficies headless no exponen ninguno (comprobado: un hilo creado
por uxnan vuelve de `codex thread/list` con `name: null`; una sesion nueva de
OpenCode se queda en `"New session - <fecha>"`; el `name` de Claude sale de la
carpeta). uxnan es el cliente, asi que uxnan los nombra.

```javascript
// turn_completed -> #nameThread(threadId, turnId, text)   (NO se espera: lanza un CLI)
//   solo si: titleSource es `prompt` (o ausente) y es el PRIMER turno
//   adapter.generateTitle({ userText, assistantText, cwd })
//     -> one-shot SIN session id  => no entra en el historial del hilo
//     -> modelo MAS BARATO del agente (Claude: haiku), nunca el de la conversacion
//   ThreadStore.applyGeneratedTitle() rechaza pisar un titulo `user`
//     -> stream/thread/updated { thread }   (titleSource: 'agent')
```

Todo es **best-effort y acotado** (30 s): sin credito, sin CLI o con timeout el
thread conserva su titulo provisional y la conversacion no se entera. Y un
renombrado a mano hecho mientras corria el turno siempre gana.

Cableado en **los siete agentes activos**, cada uno con la forma de una pasada
de su propia CLI y elegida para no dejar rastro en la conversacion que nombra:

| Agente | Invocacion | Modelo |
|---|---|---|
| Claude Code | `-p`, sin `--resume` | `haiku` |
| Codex | `codex exec --ephemeral -s read-only --skip-git-repo-check -o <file>` | `gpt-5.6-luna` con `-c model_reasoning_effort=low` |
| OpenCode | `opencode run` (sin flags de sesion) | por defecto de la CLI |
| pi | `pi -p --no-session` | por defecto de la CLI |
| Antigravity | `agy -p --mode plan` (sin `--conversation`) | `gemini-3.6-flash-low` |
| Grok | `grok -p` | por defecto de la CLI |
| Zero | `zero exec` | por defecto de la CLI |

Codex necesita los tres flags: `--ephemeral` no escribe fichero de sesion,
`read-only` le niega toda escritura al sandbox, y `-o` entrega **solo** el
mensaje final (su stdout lleva banner, lineas de hook y un recuento de tokens).

**Seis verificados en vivo**; Zero es la excepcion — no esta instalado y sin
creditos, asi que su forma esta confirmada contra el codigo del propio Zero pero
nunca ejecutada (`bridge/FOR-DEV.md`). Los ids de modelo se comprueban contra la
lista real de cada cuenta: un id invalido no es cosmetico, la CLI rechaza la
ejecucion.
#### 5.8.14 Fin de turno: trabajo diferido y llegadas tardias

Un adaptador decide cuando el agente termino, siempre por un evento del protocolo:

| Termina por | Adaptadores | ¿La CLI puede emitir despues? |
|---|---|---|
| **Evento de protocolo** | Claude (`result`), Codex (`turn/completed`), OpenCode (`session.idle` en 1.x, `session.execution.succeeded` en 2.x), Pi (`agent_settled` — **no** `agent_end`, que cierra una *corrida*: pi reintenta tras un error reintentable del proveedor, `willRetry: true`, y un prompt enviado entre medias se rechaza), Grok / Zero (respuesta ACP a `session/prompt`), Antigravity (`result` del proceso residente) | **Si** — el proceso sigue vivo cuando llega el evento |

Que el proceso siga vivo es lo peligroso, y **Claude Code lo demuestra**: cuando el modelo
lanza una tarea en segundo plano (`Bash` con `run_in_background`) y termina su
turno, la CLI emite su `result` y **sigue corriendo**; si ese trabajo acaba
dentro de su margen, la CLI **despierta al modelo** y produce un segundo turno
completo sobre el mismo proceso. Cuanto espera depende de su entrada, que
controla el bridge: **mientras la entrada sigue abierta espera lo que tarde el
trabajo** (un `sleep 240` dejado corriendo tras el turno se espero completo), y
**una vez cerrada** le da al trabajo **~4–6 s** y luego lo **detiene**
(`status:"stopped"`), saliendo con ese trabajo sin terminar. El bridge mantiene
la entrada abierta mientras haya una tarea viva **y de un despertar al
siguiente**: el despertar puede lanzar mas trabajo ("el CI paso; ahora espero el
release"), y la CLI solo lo espera si su entrada sigue abierta. Cerrarla al
terminar la ultima tarea, como se hacia, cortaba todo despertar despues del
primero (medido: la segunda espera quedaba `stopped`). La entrada se cierra al
completarse el turno, o si no aparece ningun despertar en 30 s
(`WAKE_GRACE_MS`; medido, el `init` del despertar llega ~0.2 s despues del
`task_notification`).

**Una espera larga NO es este caso.** Lo anterior aplica solo a trabajo
que queda corriendo *despues* de que el modelo termina su turno. El caso comun —
"abre el PR y espera el CI", una compilacion, una bateria de tests — es una
llamada de herramienta que **bloquea dentro del turno**: no se ha emitido ningun
`result`, asi que no hay nada que expire ni que matar. Medido sobre la CLI real:
una espera de 75 s en primer plano corrio como **un solo turno de 100 s**, con
eventos `tool_progress` a +35 s y +65 s y el trabajo completandose con
normalidad. Ademas **el bridge no tiene ningun timeout de turno**: los unicos
temporizadores de `AgentManager` acotan cuanto se espera *al usuario* (una
aprobacion o una pregunta), no cuanto puede durar un turno. Un turno puede durar
minutos u horas.

Reglas derivadas (comportamiento, no contrato — ningun metodo ni notificacion
cambia):

1. **Un `result` con trabajo vivo no cierra el turno.** `claude-adapter.ts`
   sigue las tareas vivas (lineas `system` con `subtype:"task_started"` /
   `"task_notification"`; por eso `system` dejo de mapearse a un solo tipo) y
   retiene la finalizacion hasta que un turno de seguimiento termine sin
   trabajo vivo — tantos despertares como hagan falta — o la CLI salga. Tampoco lo cierra mientras quede un mensaje escrito que la CLI aun no
   leyo: cada mensaje lleva un `uuid` y la CLI lo devuelve al leerlo
   (`--replay-user-messages`); un `result` sin mensajes pendientes es el unico
   que termina el turno. Se emite **un solo** `turn_completed`, con **todas** las respuestas: el
   `result` de la CLI solo lleva el texto del ultimo turno.
1b. **OpenCode 2 tambien vuelve, y se retiene igual.** Su herramienta de shell
   acepta `background: true`, le dice al modelo que *sera notificado*, y cuando
   el shell sale el servidor encola una nota `synthetic` y vuelve a correr el
   modelo en la misma sesion (medido en 2.0.19). `opencode-adapter.ts` sigue los
   shells del turno (`session.tool.progress` con `metadata.shellID`;
   `shell.exited` / `shell.deleted` los cierran) y no completa en
   `session.execution.succeeded` mientras quede uno vivo: el despertar se separa
   con un limite de respuesta y su propio `execution.succeeded` decide de nuevo;
   sin despertar en 30 s tras el ultimo shell, el turno se completa con lo que
   tiene. Los demas agentes conectados no vuelven solos (re-medido el
   2026-10-02; tabla en `bridge/docs/agents.md`).
2. **El trabajo que la CLI mata se informa**, con un bloque `warning`
   (`SystemContent kind:'warning'`, forma que el telefono ya renderiza), en vez
   de presentar un turno limpio sobre trabajo perdido.
3. **Un turno terminado permanece terminado** (`ThreadStore`): `appendDelta`,
   `appendThinking`, `appendBlock` y `completeTurn` ignoran un turno en estado
   terminal. Una segunda finalizacion llegaba a **sobrescribir la respuesta que
   el usuario ya habia leido**.
4. **La cola no se drena dos veces** (`AgentManager` ignora un evento terminal
   duplicado): hacerlo arrancaria el siguiente turno encolado contra una CLI que
   sigue corriendo — justo la serializacion que §5.8.13 existe para garantizar.

Las reglas 3 y 4 son deliberadamente **agnosticas del adaptador**: viven en el
store y en el manager porque la exposicion la comparte todo adaptador de la
tabla, hoy o tras cualquier cambio upstream.

#### 5.8.15 Canal de control local (desktop ↔ bridge en la misma maquina)

Uxnan Desktop habla con el bridge de la **misma maquina** sin el pairing E2EE
de un telefono. `uxnan-bridge start` abre, ademas del listener LAN, un
**WebSocket ligado solo a `127.0.0.1`** en un puerto libre, y publica como
llegar a el en `~/.uxnan/local-control.json` (`LOCAL_CONTROL_FILE`):

```json
{ "protocol": 1, "port": 51234, "token": "<256 bits base64url>", "pid": 4242,
  "bridgeVersion": "0.0.27-…", "instanceId": "<uuid por arranque>" }
```

- **El fichero es la credencial**: se escribe atomico y con permisos `0600`
  (en Windows, el ACL del perfil del usuario). Token nuevo en cada arranque; se
  borra al parar (solo si sigue siendo el nuestro). Los comandos efimeros
  (`qr`, `code`, `status`) nunca abren el canal. Config: `localControlEnabled`
  (por defecto `true`).
- **Autorizacion antes del upgrade** (`transport/local-control-server.ts`):
  par de loopback, **sin cabecera `Origin`** (un navegador siempre la manda;
  un cliente nativo no — ninguna pagina web alcanza el socket) y
  `Authorization: Bearer <token>` comparado en tiempo constante. URL:
  `/control?client=<id>&resume=<seq>&instance=<id>`.
- **Una conexion viva por nombre de cliente:** una nueva con el mismo `client`
  desplaza a la anterior (`4000 superseded`) — lo que necesita un desktop que se
  reinicio o reconecto antes de notar que su socket murio. Por eso **cada perfil
  del desktop tiene su propio nombre**, `desktop-<perfil>` (12 hex del SHA-256
  del directorio del perfil, estable entre arranques): la app instalada, un
  build de desarrollo (`…-dev`) o un `UXNAN_DATA_DIR` desechable corren a la vez
  sobre el mismo bridge sin desplazarse. Compartiendo `desktop`, se
  desplazaban en bucle: las ventanas parpadeaban y el `OutboundLog`, la
  presencia y las herramientas de los agentes saltaban de una app a la otra.
  `isDesktopClientId` (`shared`) reconoce `desktop` y `desktop-*`; los comandos
  de la CLI se conectan como `cli` y no son presencia.
- **Mismo router, mismo registro.** El cliente se registra en el
  `SessionRegistry` como `local:<id>`: recibe cada `stream/*` con su propio
  `seq` y su `OutboundLog`, exactamente como un telefono. Primer frame `hello`
  (`replayed`, `gap`); luego `{type:'message', seq?, message}` — las
  notificaciones llevan `seq`, las respuestas no. `gap: true` (ventana agotada,
  o el bridge se reinicio: `instanceId` distinto) obliga a re-sincronizar con
  `thread/list` / `turn/list`.
- **Orden:** las peticiones que nombran un `threadId` corren en orden de
  llegada por hilo; el resto en paralelo (un `agent/models` lento no bloquea un
  `turn/list`).
- Un cliente local conectado cuenta como "hay alguien" para la cuenta atras de
  las aprobaciones, igual que un telefono. No entra en `bridge/connectedPhones`.
- `bridge/status` → `features.localControl: true` mientras escucha.
- **Herramientas del desktop para los agentes del bridge**
  (`desktop/attach { mcpUrl, token }` / `desktop/detach`): el desktop le da al
  bridge su servidor MCP — el mismo que entrega a los agentes que lanza en sus
  terminales (navegador, terminales, otros agentes, el catalogo de control) —
  para que los agentes de las conversaciones del bridge lo usen tambien. **Solo
  lo acepta un cliente local** (el despacho local marca la peticion con
  `RequestSession.local`; un telefono recibe `-32001`) y solo para un endpoint
  loopback `http://127.0.0.1:<port>/mcp`; el token es uno propio del desktop
  para agentes del bridge, rotado en cada arranque, y el bridge lo olvida al
  desconectarse ese cliente. **Cada desktop conectado guarda las suyas** — uno
  que se va no se lleva las de otro —; un turno corre con las del desktop que lo
  envio (`turn/send` por el canal local) y, si lo envio un telefono, con las del
  desktop adjunto desde hace mas tiempo. Cada adapter registra el servidor **solo para su
  conversacion**, con el nombre `uxnan-browser`, el token **nunca en argv ni en
  un archivo** (solo en el entorno o en un mensaje por el stdin del agente) y la
  carpeta de la conversacion en la cabecera `x-uxnan-cwd`, **codificada en
  porcentaje** (`encodeCwdHeader`, para que cualquier ruta sea un valor de
  cabecera valido), que el desktop decodifica y usa para acotar al agente al
  proyecto de esa carpeta. Un cambio de adjunto llega al siguiente turno.
  Mecanismo por agente: **Claude Code** `--mcp-config` por ejecucion; **Codex**
  `config` por hilo en `thread/start` / `thread/resume`; **OpenCode**
  `OPENCODE_CONFIG_CONTENT` en el `opencode serve` de la carpeta (se reinicia
  ocioso si cambia el adjunto); **pi** una extension que el bridge distribuye
  (`-e`, cliente MCP Streamable HTTP; no en la postura de solo lectura);
  **Grok** `mcpServers` de ACP en `session/new` / `session/load`, solo si
  `initialize` anuncia `mcpCapabilities.http`. **Zero** (su `acp` ignora
  `mcpServers`) y **Antigravity** (sin mecanismo por ejecucion) solo leen una
  configuracion global del usuario: pendiente de decision
  (`bridge/FOR-DEV.md`).

**No es una variante criptografica**: es una ruta local con token, el mismo
modelo de confianza que `POST /agent-hook/approval`. El E2EE no cambia.
Contrato: `shared/src/local-control/local-control.ts`.

#### 5.8.16 Convergencia entre clientes ("un dueño, dos vistas")

El bridge es el **unico dueño** de cada hilo; telefonos y desktop son clientes
que le envian turnos, y la cola por hilo (§5.8.13) los ordena — nunca hay dos
procesos conduciendo una sesion. Para que dos clientes activos a la vez
converjan, todo lo que cambia el estado se difunde (`02b` §1.4):

| Cambio | Notificacion |
|---|---|
| hilo creado / metadatos (titulo, modelo, acceso, archivo) | `stream/thread/updated { thread }` |
| hilo borrado | `stream/thread/deleted` |
| turno de usuario guardado (arrancado o encolado) | `stream/turn/created { turn, clientTurnId? }` — **antes** de `stream/turn/started` |
| aprobacion / pregunta resuelta (o vencida) | `stream/approval/resolved`, `stream/question/resolved` |

El emisor manda `clientTurnId` (el id de su burbuja optimista) en `turn/send`;
el bridge lo devuelve en `stream/turn/created` y el emisor confirma esa burbuja
en vez de dibujar el mensaje dos veces. Los demas clientes lo insertan en su
sitio, por encima de la respuesta que esta por llegar.

**Reconexion:** el `seq` por cliente del `OutboundLog` + replay es la
re-sincronizacion fina de lo que llega en vivo, pero **no alcanza**: el log
vive en memoria (un reinicio del bridge lo pierde), un telefono solo tiene log
desde que se conecto en ese proceso, y la ventana (500 mensajes / 10 MB) la
consumen los deltas de cualquier hilo. La convergencia la garantiza la
**sincronizacion por revision** de §5.8.17 (`sync/changes`) y el orden de cada
conversacion lo fija `Turn.seq`, nunca el orden de llegada.

**Ciclo de vida de una conversacion (igual en todos los clientes).** Cerrar la
vista de una conversacion (la pestaña del desktop, salir de la pantalla en el
telefono) no la toca: sigue en el bridge y un turno en curso sigue corriendo.
**Archivar** (`thread/archive`, reversible con `thread/unarchive`) la saca de
las listas de todos los clientes via `stream/thread/updated`; **eliminar**
(`thread/delete`, siempre confirmado y advirtiendo que es para todos los
dispositivos) la borra via `stream/thread/deleted`. Las listas de uso diario
muestran lo abierto o lo que necesita atencion (trabajando, esperando al
usuario, fallido, terminado sin ver — `activeTurnId` y los eventos de turno), no
todo el historial.


**Agente fijo, modelo variable.** El agente de un hilo se fija en
`thread/start` y no cambia (cambiar de CLI rompe la sesion nativa); el modelo
si (`thread/setModel`, y lo ven todos los clientes via `stream/thread/updated`).

#### 5.8.17 Una sola capa: el bridge como fuente de verdad (2026-09)

Mobile y desktop son **replicas** del estado que el bridge posee: proyectos,
conversaciones, ajustes compartidos, presencia y agentes disponibles. El
telefono funciona sin desktop; lo que se hizo sin desktop aparece en el desktop
al conectarse, y viceversa. Contratos: `shared/src/models/{project,sync}.ts`,
`02b` §1.2/§1.4.

**Registro de proyectos persistente** (`~/.uxnan/projects.json`,
`bridge/src/projects/project-registry.ts`). Un proyecto es una carpeta
canonica (symlinks resueltos); un worktree pertenece al proyecto de su
repositorio (`git rev-parse --git-common-dir`). Entra por `project/add`
(`source: user`, o `desktop` desde el canal local — el desktop publica los
suyos), al iniciar una conversacion en su carpeta (`thread`) o por
`workspaceRoots` (`config`); sale solo por `project/remove`, que **no toca las
conversaciones**. `project/rename` cambia el nombre (vacio lo restaura).
Espejo total: agregar o quitar en cualquier cliente se refleja en todos
(`stream/project/updated|removed`). Al crearse por primera vez, el registro se
siembra con las carpetas de todas las conversaciones existentes, y en cada
arranque cada conversacion se re-enlaza al proyecto de su carpeta. Un telefono
solo registra carpetas dentro de las raices de exploracion; el desktop
cualquiera. `thread/start` decide el proyecto por la carpeta (`cwd`), nunca al
reves, y lo registra.

**Carpeta de inicio compartida** (`settings/get|set`, `home` en
`daemon-config.json`, `stream/settings/updated`): de donde parte la exploracion
para agregar proyectos, sin importar desde que carpeta se ejecuto `start`. Por
defecto, la carpeta personal. Se cambia desde el telefono, el desktop o
`uxnan-bridge config set home <carpeta>` (que usa el canal local si hay un
bridge corriendo). Raices de exploracion = `home` + `browseRoots` +
`workspaceRoots`.

**Sincronizacion por revision** (`bridge/src/sync/sync-ledger.ts`,
`~/.uxnan/sync.json`). Un contador global persistido numera cada cambio de
resumen de un hilo (titulo, estado, modelo, acceso, origen, turnos creados o
terminados — nunca los deltas), de un proyecto o de los ajustes; el cambio se
escribe en disco **antes** de difundirse, y cada notificacion lleva su `rev`.
Las eliminaciones quedan como lapidas acotadas (2 000). `sync/changes { since,
storeId }` devuelve lo posterior a `since`, o una instantanea completa
(`reset: true`) si `storeId` difiere o `since` es anterior al horizonte. El
cliente la llama al (re)conectar, al volver la app y cuando una notificacion
trae un `rev` que no es el siguiente al ultimo aplicado. El almacen de hilos y
el registro de proyectos son la **unica** fuente de esas notificaciones
(`onChange`), de modo que ningun handler puede cambiar algo y olvidar avisar.

**Orden canonico:** `Turn.seq` (1..n por hilo, asignado al guardar el turno y
nunca reutilizado; los turnos anteriores se numeran en su orden guardado). Un
turno importado de la historia nativa toma la siguiente posicion. Los clientes
ordenan por `seq`.

**Abrir no cambia nada:** `thread/resume` ya no pone `status: active` ni toca
`updatedAt` (desarchivaba en silencio lo abierto en el telefono). Solo
`thread/unarchive` desarchiva.

**Un ajuste no es actividad:** `updatedAt` es cuando la conversacion se movio
por ultima vez — turnos, historia releida, titulo, estado —, y toda lista ordena
y fecha por el. `thread/setModel`, `thread/setAccessMode` y el id de sesion
nativo se propagan como cambio propio (`rev`) sin moverlo: el telefono escribe
el modo de acceso por defecto al abrir una conversacion, y eso la fechaba
"ahora" y la subia al principio de cada lista por actividad. La proyeccion
local de metricas reemplaza igualmente una fila con el mismo `updatedAt` cuyo
contenido cambio.

**Titulos solo en el bridge:** el provisional se pone al guardar el primer
turno si el titulo es el marcador (`titleSource: prompt`); el generado tras un
turno completado mientras la fuente sea `prompt`/ausente, con hasta 2 intentos
(no depende de `turnCount`: un primer turno fallido, detenido o con mensaje en
cola ya no deja el nombre provisional para siempre). Un `thread/rename
{ source: 'prompt' }` no pisa un titulo `user`/`agent`. Los clientes no
renombran por su cuenta.

**Presencia y origen:** `bridge/status` lleva `host { launchedBy: service |
desktop | cli, machineName }` y `clients[]`; `stream/presence/updated` cada vez
que un telefono o el desktop se conecta o se va. Cada telefono lleva su
`route` (`lan` | `tailscale` | `relay`): el bridge la sabe por el camino
(el servidor LAN clasifica la IP de origen: `100.64.0.0/10` o
`fd7a:115c:a1e0::/48` es Tailscale; el canal del relay es `relay`) y la
publica en la presencia y en `bridge/connectedPhones`. `Thread.origin { kind,
name }` dice donde nacio una conversacion.

**Relay compartido.** El tercer ajuste compartido es `relay`
(`BridgeSettings.relay`: `{ url, routingId, enabled }` o `null`), de solo
lectura para los clientes: lo escribe unicamente el servicio del relay del
bridge (`relay/*`, §5.10), nunca `settings/set`. Viaja en `sync/changes` y
`stream/settings/updated` como los otros, asi que un telefono emparejado en la
LAN aprende el relay y puede salir de casa sin volver a emparejar.

**Direcciones vivas.** El cuarto ajuste compartido es `hosts`
(`BridgeSettings.hosts`: `host:port` de cada direccion LAN y Tailscale donde
escucha el servidor LAN; vacio si la LAN esta apagada), tambien de solo
lectura y nunca guardado en disco: es un hecho vivo. `NetworkWatcher` relee
las interfaces cada 15 s (descarta adaptadores virtuales —Docker, VM, WSL— y
direcciones link-local `169.254.x.x`); si cambian, `setHosts` sube la revision
y lo anuncia, y el anuncio mDNS se rehace con las direcciones nuevas. El QR toma
sus `hosts` de aqui. Asi un telefono emparejado en otra red aprende, incluso por
el relay, donde esta su PC ahora.

**Nombres compartidos.** El PC y cada telefono tienen un nombre que ven todos
los clientes. El del PC es el ajuste `name` (`settings/set`; por defecto el
nombre de la maquina; `uxnan-bridge config set name`): es el que viaja en el QR,
el de la presencia del desktop y el origen de sus conversaciones. Un telefono,
al conectarse, se describe (`device/describe`: nombre, modelo, plataforma,
version del SO y de la app — un metodo JSON-RPC despues del handshake; el
protocolo E2EE no cambia); su nombre por defecto (el modelo) aplica mientras
nadie lo haya nombrado. Cualquier cliente lo renombra (`device/rename`), y el
telefono tambien a si mismo. En los tres casos gana la decision mas reciente
(el bridge guarda en privado cuando se decidio cada nombre; un cambio hecho sin
conexion viaja con su edad), y la respuesta de `device/describe` trae el nombre
vigente con su edad para que el telefono adopte uno puesto en otro cliente y lo
lleve a sus demas PCs. La lista completa viaja en `sync/changes.devices` y en
`stream/devices/updated`; un telefono conectado aparece con su nombre nuevo en
la presencia al instante. Se pueden emparejar varios telefonos a un mismo PC.

**Agentes: una sola regla de deteccion.** `shared/agent-locations.json` dice
donde se instala cada CLI; el bridge (`locateAgent`) y el desktop (Rust,
`include_str!`) resuelven con la misma tabla. El bridge toma al arrancar el
PATH del shell de login del usuario (`$SHELL -ilc`, `bridge/src/login-path.ts`)
— un servicio o una app grafica solo tienen `/usr/bin:/bin` — y re-detecta en
vivo (`agent/list`, a lo sumo cada 10 s): un agente instalado despues aparece
sin reiniciar y se avisa con `stream/agents/updated`; `agent/doctor` explica
donde busco y que encontro.

**Replicas en los clientes.** En el telefono, `BridgeReplica`
(`uxnanmobile/lib/application/managers/bridge_replica.dart`) es la unica capa
que escribe lo que el bridge posee: guarda por PC un cursor `{ storeId, rev,
home }` (tabla `replica_cursors`), llama `sync/changes` al conectar, al volver
la app y al detectar un salto de `rev`, y aplica cada notificacion solo si es
posterior a lo aplicado (una tardia nunca deshace un estado nuevo). Los hilos
entran por `ThreadManager.applyReplicaThreads`; los proyectos, por PC, en la
tabla `projects`. La lista agrupa por carpeta y muestra tambien los proyectos
sin conversaciones; "Nueva conversacion" elige entre los proyectos del registro
o agrega uno (`project/add`) explorando desde la carpeta de inicio; la hoja de
detalles de una carpeta ofrece quitarla del registro. La pantalla del PC
muestra y cambia la carpeta de inicio. Con el desktop conectado al mismo
bridge, la lista dice "Enlazado con Uxnan Desktop en <maquina>"; una
conversacion nacida en el desktop lleva su marca. En el desktop, `ChatStore`
(`uxnandesktop/src/lib/bridge/chat.svelte.ts`) aplica la misma regla y
`projectMirror` une los proyectos del desktop con el registro
(`uxnandesktop/architecture/02e-bridge-integration.md`).

**Acciones sin conexion: gana la mas reciente.** Ningun cliente depende de
otro: el desktop chatea con el bridge sin telefono y el telefono sin desktop, y
el que llega despues lo recibe todo en una sincronizacion. Lo que el telefono
hace mientras su PC no esta al alcance (renombrar, archivar, desarchivar o
borrar una conversacion; renombrar el PC) se ve al instante en el telefono y
espera en una bandeja persistente (`ActionOutbox`, tabla `pending_actions`; una
accion nueva reemplaza las que deja sin efecto sobre lo mismo). Al volver el PC, la bandeja se
envia **antes** de leer `sync/changes`, y si falla a medias no se lee nada: un
estado del bridge nunca pisa una accion que aun no recibio. Cada accion viaja
con `ageMs` (hace cuanto se decidio, por el reloj del telefono: una edad, no
una hora, para que los relojes no tengan que coincidir). El bridge la fecha
`now - ageMs` y la aplica solo si nadie decidio lo mismo despues: guarda en
privado cuando se decidio por ultima vez el titulo (renombrado a mano; un
titulo generado no cuenta) y el estado; un borrado anterior a la ultima
actividad del hilo (un turno, un renombrado, un archivado) se descarta, porque
nadie borra trabajo que no vio. Una accion que el bridge rechaza se descarta.

**Servicio de usuario.** `uxnan-bridge install-service` registra
`<node> <cli.js> start --service` (rutas absolutas, `WorkingDirectory` = home)
en launchd / systemd --user / Programador de tareas; se reinicia si se cae, no
si se detiene a proposito. `service-status` / `service-start` permiten al
desktop administrarlo; el bridge sigue sirviendo al telefono con el desktop
cerrado.

#### 5.8.18 El bridge se actualiza a si mismo (2026-09)

La actualizacion del bridge tiene **un dueño: el bridge**, y todos los clientes
la ofrecen pidiendosela a el (`bridge/self-update.ts`, modelo `BridgeUpdate`).

**Saber.** El bridge en marcha consulta el registro de npm (`dist-tags`,
etiqueta `latest`) **cada hora** y al arrancar. Los comandos cortos del CLI
conservan la cache de 24 h de `update-check.json`; el demonio no la obedece,
porque con ella podia tardar un dia en enterarse de una version publicada (el
fallo que origino esta seccion). Cuando cambia la version mas nueva conocida,
emite `stream/bridge/updated { update }` a todos los clientes; `bridge/status`
lleva el mismo `update`. Un cliente nunca consulta npm.

**Aplicar.** `bridge/update` solo corre si el bridge es el **servicio del
usuario** (`host.launchedBy: service`) instalado **globalmente con npm** y con
npm a su lado en la misma carpeta global (el PATH de un servicio no trae npm);
si no, `update.canApply` es `false` con `unsupportedReason`. Rechaza con
`-32009` si hay un turno en curso en cualquier cliente. Si procede, responde con
el estado `updating`, lo difunde, lanza un **ayudante** desacoplado
(`uxnan-bridge self-update --pid <pid> --to <version>`, desde el home), **le
traspasa su lock** (`~/.uxnan/bridge.lock`, `LockFile.transfer`) y se detiene
limpiamente (el gestor de servicios no lo relanza). Mientras el ayudante tenga el
lock, cualquier bridge que se arranque (una app que lo mantiene corriendo, el
propio gestor) sale enseguida en vez de correr sobre un paquete a medio
reemplazar. Al detenerse, el bridge detiene **todos** sus adaptadores, aunque no
hayan corrido un turno: un CLI arrancado solo para listar modelos lo mantenia
vivo. El ayudante espera a que el bridge salga (si sigue vivo pasado el plazo lo
termina a la fuerza: ya se habia detenido y guardado su estado), instala con
`node <npm-cli.js> install --global --prefix <el mismo prefijo>
uxnan-bridge@<version>`, comprueba la version que quedo en disco, escribe el
resultado en `~/.uxnan/update-result.json`, **suelta el lock y arranca el
servicio**, haya funcionado npm o no. Instalar solo con el bridge detenido es lo
que lo hace funcionar en Windows, donde un proceso vivo bloquea sus modulos
nativos.

**Informar.** El bridge que vuelve lee (y consume) `update-result.json`: si
fallo, `update.phase` es `failed` con `failure { reason: permission | install |
unsupported, message, command? }` (el comando para hacerlo a mano). Si
funciono, no dice nada: el cliente ve la version nueva al reconectar.

**Comprobar ahora.** `bridge/checkForUpdate` pide al registro la version mas
nueva en ese momento, sin esperar el chequeo horario ni su cache: es lo que
hace "Comprobar de nuevo" (Ajustes → Bridge y movil en el desktop, la tarjeta
del bridge en Ajustes → Actualizaciones del telefono). Responde con el
`BridgeUpdate` y, si supo de una version nueva, lo difunde con
`stream/bridge/updated` a todos los clientes.

**Clientes.** Uxnan Desktop (fila en la barra lateral, Ajustes → Bridge y
movil, y la actualizacion automatica si esta activada) y el telefono (aviso en la
lista de conversaciones y Ajustes → Actualizaciones) llaman a `bridge/update`.
Un bridge sin `update` en `bridge/status` es anterior a esta funcion y por lo
tanto mas antiguo que el cliente: el desktop lo actualiza con su instalador npm
(la unica ruta propia que conserva, junto con instalarlo cuando no hay bridge) y
el telefono pide actualizarlo en la PC.

#### 5.8.19 Sesiones de agente: retomar cualquier sesion y la terminal como escritor (2026-09)

Una conversacion con un agente no siempre nace en Uxnan: la persona abre el CLI
en una terminal del desktop, o en su propia terminal, y mas tarde quiere
seguirla como chat — en el desktop o en el telefono. El bridge es el **dueño** de
las dos cosas que eso necesita, y todo cliente se las pregunta a el:

**El catalogo (`agent/sessions { cwd, agentId? }`).** Cada adaptador lista
las sesiones de su CLI en una carpeta por la superficie que el CLI ofrece
(`IAgentAdapter.listNativeSessions`), medido el 2026-09-27:

| Agente | Como lista | Como distingue lo de una persona |
|---|---|---|
| Claude Code | su store (`~/.claude/projects/<cwd>/*.jsonl`), solo cabeza y cola (`cwd`, `entrypoint`, primer prompt, `ai-title`) | `entrypoint: cli` (su TUI) frente a `sdk-cli` (`-p`) |
| Codex | app-server `thread/list { cwd, sortKey: updated_at }` (nombre, `preview`) | `originator` distinto del nombre de cliente del bridge |
| OpenCode | su servidor: `GET /api/session?directory=` (2.x) / `GET /session` (1.x) | el bridge titula sus sesiones con el id del hilo (UUID) |
| pi | su store (`<PI_CODING_AGENT_DIR o ~/.pi/agent>/sessions/--<cwd>--/`), cabecera `{type:'session', cwd}` | no lo registra: todas cuentan |
| Grok | su store (`~/.grok/sessions/<cwd codificado>/<id>/updates.jsonl`): su `session/list` no trae titulo ni separa sesiones vacias | todas cuentan; una sin prompt no es sesion |
| Zero | ACP `session/list { cwd }` (anuncia `sessionCapabilities.list`) | Zero titula `ACP session` las abiertas por ACP |
| Antigravity | no tiene listado | se retoma solo desde la terminal (id capturado por hook) → `unlisted` |

El bridge anade lo que sabe: la conversacion que continua cada sesion
(`threadId`) y la terminal que la retiene (`hold`), convierte las fechas en
edades (`updatedAgoMs`) y deja fuera lo que no fue de una persona: una sesion
sin interfaz solo aparece si una conversacion la continua, y los encargos de un
solo uso de Uxnan (nombrar, mensajes de commit, cuerpos de PR) nunca, por como
abre su prompt (`shared/src/agents/one-shot.ts`; donde el CLI lo permite ni
siquiera dejan sesion: `claude --no-session-persistence`, `codex exec
--ephemeral`, `pi --no-session`). Una sesion retenida en esa carpeta aparece
aunque su CLI no sepa listarla.

**Retomar (`thread/start { agentId, agentSessionId, cwd }`).** El hilo nace
guardando la sesion (`agentSessionId`): su primer turno la continua (adopcion,
§5.8.8) y `turn/list` importa su historial por la convergencia de siempre. Una
sesion tiene una sola conversacion: si ya hay una que la continua, `thread/start`
devuelve esa. El titulo que traiga es provisional (`titleSource: prompt`).

**La terminal como escritor (`agent/hold` / `release`).** Una sesion de
un CLI tiene un solo escritor. Cuando una terminal del desktop tiene el agente
abierto, el desktop lo dice (solo por el canal local, §5.8.15; `busy` cuando el
agente trabaja) y el bridge: no corre turnos en ella (`turn/send` → `-32010
SessionHeld` con la retencion en `data`), suelta el proceso residente que
guardaba para la conversacion (pi, Antigravity; nunca cancela un turno) y avisa
a todos (`stream/agent/held`). Las retenciones viven solo en memoria y
pertenecen a la conexion del desktop: se van con ella (las terminales se cierran
con la app) y el desktop que reconecta las declara de nuevo. Un cliente que se
perdio avisos pregunta `agent/holds`.

**El relevo (`agent/requestHandoff`).** Cualquier cliente pide una sesion
retenida: si esta libre → `notHeld`; si el agente trabaja → `busy`; si no, el
bridge le pregunta **solo** al desktop que la retiene
(`stream/agent/handoffRequested { requestId, from }`), que cierra el
agente en su terminal, suelta la retencion y responde
(`agent/handoffAnswer`: `released` | `busy` | `declined`); sin respuesta
en 20 s → `unreachable`. Nunca se simulan teclas en la terminal.

**Clientes.** Uxnan Desktop reporta las retenciones desde sus pestanas de
terminal (`terminalSessions.svelte.ts`: una sesion capturada por hook, viva y de
un agente que el bridge conduce), las repite al reconectar, atiende
`handoffRequested` cerrando el agente con una senal a su proceso
(`pty_stop_agent`, nunca teclas; el shell y la pestana quedan) y ofrece
*Continuar como chat* en la pestana y *Abrir en terminal* en el chat
(`app.launchAgent` con `resume`). Ambas apps listan las sesiones de la carpeta
al empezar una conversacion (desktop: el inicio del chat; movil: *Nueva
conversacion*), muestran la retencion sobre el compositor con *Continuar aqui*
(`requestHandoff`) y lo ofrecen solo si el bridge anuncia
`features.agentSessions`.

### 5.9 Transporte seguro y mensajeria E2EE

El transporte seguro es la capa mas critica del sistema. Garantiza que el relay nunca vea el contenido de los mensajes en texto claro.

#### 5.9.1 Protocolo de handshake completo

> ✅ **Implementado** (rama `uxnanmobile`): primitivas crypto en `lib/infrastructure/crypto/` (verificadas contra vectores RFC 8032/7748/5869 y NIST) + la mecánica de transporte en `lib/infrastructure/transport/`: `WebSocketTransport`/`WebSocketChannelTransport`, `SecureTransportLayer.performHandshake` (flujo clientHello→serverHello→clientAuth→ready con verificación de nonce/expiry/identidad/firma), `SecureChannel` (cifrado + `seq` 1-based + rechazo de replay), `RequestCorrelator`, `BackoffCalculator`, `OutboundMessageBuffer`. Probado con un handshake de dos partes sobre un transporte en memoria. **Pendiente** (siguiente incremento): `SessionCoordinator` (máquina `ConnectionPhase` + bucle de reconexión + providers), `TransportSelector` (descubrimiento LAN), `IncomingMessageProcessor` e integración WS en vivo contra un bridge real.
>
> **Contrato — codificación canónica del transcript:** el transcript que se firma es el UTF-8 de la concatenación, en el orden documentado, de la representación *wire* de cada campo: hex en minúsculas para los campos de bytes (`clientNonce`, claves efímeras, `serverNonce`), el string tal cual para `sessionId`, y la representación decimal para los enteros (`keyEpoch`, `expiresAtForTranscript`). El bridge debe reproducir esta codificación byte a byte. La librería usada para AES-256-GCM es `cryptography` (no se introduce ninguna variante criptográfica: mismos algoritmo y parámetros del spec).

```
CONSTANTES:
  SECURE_PROTOCOL_VERSION = 2        (sessionId/seq/direccion como AAD de GCM — ver nota abajo)
  PAIRING_QR_VERSION = 3
  HKDF_INFO_TAG = "uxnan-e2ee-v1"
  MAX_PAIRING_AGE_MS = 300_000        (5 minutos)
  CLOCK_SKEW_TOLERANCE_MS = 60_000   (60 segundos)
  TRUSTED_RECONNECT_SKEW_MS = 90_000 (90 segundos)
  MAX_BRIDGE_OUTBOUND_MESSAGES = 500
  MAX_BRIDGE_OUTBOUND_BYTES = 10_485_760  (10 MB)
  PAIRING_WINDOW_MS = MAX_PAIRING_AGE_MS = 300_000  (5 minutos — ver nota de seguridad abajo)
```

**Fase 1 — Bootstrap por QR (solo primera conexion):**

1. El bridge genera un par Ed25519: (`macIdentityPrivateKey`, `macIdentityPublicKey`)
2. El bridge publica QR con payload: `{ v, hosts?, relay?, sessionId, macDeviceId, macIdentityPublicKey, expiresAt, displayName }` (§5.5.4; `relay` = `{url, routingId, ticket?}`)
3. El telefono escanea el QR
4. El telefono genera su par Ed25519: (`phoneIdentityPrivateKey`, `phoneIdentityPublicKey`)
5. El telefono persiste `PhoneIdentity` y crea `TrustedDevice`

> **Security — armed pairing window (bridge, implemented):** on the direct-LAN/
> Tailscale transport the bridge binds all interfaces, so any reachable peer can
> reach the handshake socket at any time. A `qr_bootstrap` bootstrap is
> therefore only ACCEPTED while an operator-armed pairing window is open — the
> bridge's `PairingCodeService.arm()`/`isArmed()` (`PAIRING_WINDOW_MS`, in-memory,
> per bridge-process instance; set to `MAX_PAIRING_AGE_MS` so the gate lives exactly
> as long as the `PairingPayload` it gates — a shorter window would leave a band
> where the phone still accepts the QR and the bridge silently refuses). The window is armed by the exact
> operator actions that surface a QR/code — `generatePairingQr()` (the `qr`
> command, and `start`'s own printed QR) and `currentPairingCode()` /
> `bridge/pairingCode` (the `code` command) — and by a **successful
> `GET /pair/resolve`**: producing the current code proves the caller read it
> off the PC, which is the same consent signal. Arming is in-memory and does
> not cross processes, so `qr` and `code` ask the RUNNING daemon over the local
> control channel (`bridge/generatePairingQr`, `bridge/pairingCode`, §5.8.15),
> which arms that daemon's own window. With no daemon answering, `code` prints
> the code shared through `~/.uxnan/pairing-code.json`, and the resolve that
> daemon serves later is what arms it. `server-handshake.ts`
> rejects an unarmed `qr_bootstrap` BEFORE any
> `trustStore` mutation and before `ready` is sent. This corrects an earlier
> drift: the manual-pairing-code service documented itself as "the consent
> gate" for pairing, but that check only guarded `GET /pair/resolve` — the
> handshake itself accepted a bootstrap unconditionally regardless of whether
> the code or QR had ever been shown. The window is the actual gate now; the
> code/QR remain how the phone *learns* the connection details, not (yet) a
> value the handshake itself verifies. `trusted_reconnect` is NOT gated by the
> window (an already-trusted phone reconnects at any time). **Since 2026-10 the
> relay path is gated by the same window**: every relay channel runs the same
> `handleSecureConnection` as the LAN with `isPairingArmed`, and on top of it
> the relay itself admits a phone that is not yet trusted only with the
> one-time ticket the same arming minted (§5.10). (Before, the relay path was
> scoped only by its `expectedSessionId`.) **Deferred hardening (see
> `bridge/FOR-DEV.md`):** binding enrollment to a phone-computed proof that
> it holds the pairing code — i.e. to *this* phone rather than to *some* open
> window — needs coordinated mobile work that isn't wired yet. A hidden daemon
> (the user's service) is armed for the QR-**scan** path by whoever shows its
> QR: `uxnan-bridge qr` and Uxnan Desktop's "Pair a phone" both ask the running
> daemon over the local control channel (`bridge/generatePairingQr`, §5.8.15),
> which arms that daemon's window; the service itself prints no QR or code and
> never arms at startup.

**Fase 2 — Handshake criptografico:**

```
iPhone → Bridge: clientHello
{
  kind: "clientHello",
  protocolVersion: 2,                  // SECURE_PROTOCOL_VERSION
  sessionId: "<uuid>",
  handshakeMode: "qr_bootstrap" | "trusted_reconnect",
  phoneDeviceId: "<uuid>",
  phoneIdentityPublicKey: "<hex 32 bytes Ed25519>",
  phoneEphemeralPublicKey: "<hex 32 bytes X25519>",
  clientNonce: "<hex 32 bytes random>"
}

Bridge → iPhone: serverHello
{
  kind: "serverHello",
  protocolVersion: 2,                  // SECURE_PROTOCOL_VERSION
  sessionId: "<uuid>",
  handshakeMode: "...",
  macDeviceId: "<uuid>",
  macIdentityPublicKey: "<hex 32 bytes Ed25519>",
  macEphemeralPublicKey: "<hex 32 bytes X25519>",
  serverNonce: "<hex 32 bytes random>",
  keyEpoch: <integer>,
  expiresAtForTranscript: <unix ms>,
  macSignature: "<hex 64 bytes Ed25519 sobre transcript>",
  clientNonce: "<echo del clientNonce>",
  displayName: "<nombre visible>"
}

transcript = clientNonce || phoneEphemeralPublicKey || macEphemeralPublicKey
           || serverNonce || sessionId || keyEpoch || expiresAtForTranscript

iPhone verifica macSignature con macIdentityPublicKey

iPhone → Bridge: clientAuth
{
  kind: "clientAuth",
  sessionId: "<uuid>",
  phoneDeviceId: "<uuid>",
  keyEpoch: <integer>,
  phoneSignature: "<hex 64 bytes Ed25519 sobre mismo transcript>"
}

Bridge verifica phoneSignature con phoneIdentityPublicKey

Bridge → iPhone: ready
{
  kind: "ready",
  sessionId: "<uuid>",
  keyEpoch: <integer>,
  macDeviceId: "<uuid>"
}
```

**Derivacion de clave simetrica:**

```
sharedSecret = X25519(phoneEphemeralPrivateKey, macEphemeralPublicKey)
             = X25519(macEphemeralPrivateKey, phoneEphemeralPublicKey)  # misma

salt = clientNonce || serverNonce
derivedKey = HKDF-SHA256(sharedSecret, salt, info="uxnan-e2ee-v1", length=32)
```

**Fase 3 — Trafico cifrado (AES-256-GCM):**

```
SecureEnvelope = {
  kind: "encryptedEnvelope",
  sessionId: "<uuid>",
  seq: <integer monotonico>,
  nonce: "<hex 12 bytes random por mensaje>",
  ciphertext: "<base64 AES-256-GCM(plaintext, derivedKey, nonce, aad)>",
  tag: "<base64 GCM auth tag 16 bytes>"
}
```

`sessionId` y `seq` viajan en claro en el sobre (el receptor los necesita para
ubicar la clave *antes* de poder descifrar), pero están **autenticados sin
estar cifrados**: se vinculan al tag de AES-GCM como *Additional Authenticated
Data* (AAD), junto con un byte de **dirección** que identifica el sentido del
mensaje:

```
AAD = utf8(sessionId) || 0x00 || u64_be(seq) || 0x00 || direction

direction = 0x01  # telefono -> bridge
direction = 0x02  # bridge -> telefono
```

Ambos lados deben derivar el AAD **byte a byte idéntico** para una misma
`(sessionId, seq, direction)`: el bridge (`buildEnvelopeAad` en
`bridge/src/transport/secure-channel.ts`) y el teléfono (`buildEnvelopeAad` en
`lib/infrastructure/transport/secure_transport_layer.dart`) implementan
exactamente esta codificación (UTF-8 para `sessionId`, entero de 64 bits
big-endian para `seq`, los mismos separadores `0x00`). Vector de referencia:
para `sessionId="abc"`, `seq=1`, `direction=0x01`, el AAD es
`61 62 63 00 00 00 00 00 00 00 00 01 00 01` (14 bytes).

> ✅ **Implementado** (bridge + `uxnanmobile`): antes de este cambio, la
> protección contra replay dependía por completo del campo `seq`
> **no autenticado** (`envelope.seq <= lastInboundSeq`), lo que permitía a un
> relay malicioso o a un atacante en la ruta (a) reenviar un sobre capturado
> con un `seq` manipulado para forzar su re-aplicación, (b) fijar un `seq`
> enorme para bloquear el canal, o (c) reflejar un sobre bridge→teléfono de
> vuelta al bridge como si fuera tráfico entrante legítimo (la misma clave se
> usa en ambos sentidos, sin vinculación de dirección). Vincular
> `sessionId || seq || direction` como AAD de AES-GCM cierra las tres vías:
> cualquier alteración de esos campos falla la verificación del tag en lugar
> de pasar silenciosamente una comprobación de replay no autenticada. El
> **replay y la reflexión ahora se aplican criptográficamente**, no solo por
> un contador en memoria. `bridge/src/transport/crypto.ts`
> (`aesGcmEncrypt`/`aesGcmDecrypt`) y `lib/infrastructure/crypto/envelope_crypto.dart`
> (`EnvelopeCrypto.encrypt`/`decrypt`) aceptan un `aad` opcional; `nonce`
> (12 bytes aleatorios por mensaje) y la derivación HKDF de la clave de
> sesión **no cambian** — el patrón AAD ya existía en el repo para el sellado
> de métricas (`bridge/src/metrics/metrics-seal.ts`) y aquí se aplica al
> canal cifrado. Un follow-up considerado y descartado por ahora: claves
> derivadas por HKDF separadas por dirección (permitiría prescindir del byte
> de dirección); se documenta como posible trabajo futuro, no como deuda
> pendiente de este cambio.
>
> **Versionado del protocolo (obligatorio con este cambio).** Como la AAD forma
> parte del cálculo del tag, un peer v1 y uno v2 **no pueden descifrarse
> mutuamente**. Sin una comprobación de versión el fallo era mudo y muy difícil
> de diagnosticar: el handshake no cambió, así que el emparejamiento/reconexión
> se completa y ambos lados muestran "conectado" — y a partir de ahí el bridge
> descarta cada petición en el `catch { continue; }` de `session-handler.ts` y el
> correlador RPC del teléfono nunca resuelve, de modo que toda acción expira sin
> ninguna señal. Por eso `SECURE_PROTOCOL_VERSION` sube a **2** y **ambos lados
> lo validan en el handshake** (`clientHello` en `server-handshake.ts`,
> `serverHello` en `_verifyServerHello`), que es el último punto en el que
> todavía pueden leerse entre sí; el rechazo ocurre antes de derivar clave o
> tocar el trust store, con un mensaje que nombra ambas versiones. Regla que
> antes era implícita y ahora está escrita en la constante: **se sube esta
> versión cuando cambia el formato del *frame cifrado*, no solo el JSON del
> handshake**. Los bytes de dirección viven en `shared/src/constants.ts`
> (`ENVELOPE_DIRECTION_*`), única fuente de verdad; el bridge los re-exporta y
> `ProtocolConstants` del móvil los espeja.
>
> **Consecuencia de release:** bridge y `uxnanmobile` deben publicarse en el
> mismo ciclo (ver `docs/releases.md`).

**Trusted Reconnect:**
- Usa `handshakeMode: "trusted_reconnect"`
- El bridge tiene `phoneIdentityPublicKey` persistido en `trusted-phones.json`
- El telefono tiene `macIdentityPublicKey` persistido en `TrustedDevice`
- Flujo identico al handshake pero verificando contra registros existentes

#### 5.9.2 Outbound buffer y catch-up

```javascript
// Bridge side:
MAX_BRIDGE_OUTBOUND_MESSAGES = 500
MAX_BRIDGE_OUTBOUND_BYTES = 10 MB

// Cada mensaje enviado por el bridge tiene seq = bridgeOutboundSeq++
// Al reconectar, el telefono envia en el handshake:
// resumeState: { lastAppliedBridgeOutboundSeq: N }
// El bridge reenvia solo mensajes con seq > N

// Telefono side: mantiene phoneOutboundSeq++ para mensajes que envia al bridge
```

> **Estado de implementación (bridge — hecho):** el bridge implementa esto en
> `src/transport/outbound-log.ts` (`OutboundLog`): un contador `seq` continuo
> **por dispositivo** que **sobrevive a las reconexiones** (no se reinicia con
> cada handshake) más una ventana deslizante con los topes de arriba. Retiene el
> **texto plano** de cada mensaje saliente (respuestas Y notificaciones), no los
> sobres cifrados, porque cada reconexión deriva una clave nueva: en la
> reconexión el canal nuevo **re-cifra** las entradas con `seq > N`
> (`BridgeSecureChannel.encryptReplay`) y las reenvía **antes** de registrar el
> sink en vivo, preservando el orden. `performServerHandshake` lee
> `clientHello.resumeState.lastAppliedBridgeOutboundSeq` (tolerante: ausente o
> inválido → 0). El log se descarta al desconfiar del dispositivo
> (`SessionRegistry.forget`). Si el bridge se reinicia, el log en memoria se
> pierde (el `seq` reinicia en 1); el punto de reanudación viejo del teléfono no
> produce replay y el teléfono re-sincroniza con `turn/list` — comportamiento
> aceptado.
>
> **Estado de implementación (móvil — hecho):** el teléfono persiste el último
> `seq` aplicado por dispositivo en `TrustedDevice.lastAppliedBridgeOutboundSeq`
> (columna drift nullable, esquema v5) y lo envía en
> `clientHello.resumeState.lastAppliedBridgeOutboundSeq` (omitido cuando es 0).
> `SessionCoordinator` lo carga en `performHandshake` y lo checkpointea en cada
> teardown (drop/disconnect/cierre de socket) y periódicamente en el heartbeat.
> El `seq` aplicado se rastrea en `SecureChannel.decrypt`
> (`SecureSession.bridgeOutboundSeq`). Catch-up por `seq` cerrado end-to-end.

#### 5.9.3 Seleccion de canal de transporte

```dart
// lib/infrastructure/transport/transport_selector.dart
abstract class TransportSelector {
  // Orden de preferencia (DirectTransportSelector):
  // 1. Cada `hosts` directo del TrustedDevice (LAN y Tailscale `100.x`),
  //    cada uno con un timeout corto.
  // 2. El relay propio del PC (TrustedDevice.relay), si existe y esta
  //    habilitado: RelayClient abre /v1/connect/<routingId>, firma el
  //    challenge con la identidad del telefono y entrega el socket listo.
  // En ambos casos la semantica E2EE es identica: el handshake de §5.9.1
  // corre igual sobre el socket directo o sobre el canal del relay.
  Future<WebSocketTransport> select(
    TrustedDevice device, {
    String? relayTicket, // solo en el primer enlace de un pairing por el relay (ticket del QR)
  });
}
```

`TrustedDevice.relay` lo escribe solo `BridgeReplica` a partir de
`BridgeSettings.relay` y se relee antes de cada intento, asi que un PC
emparejado en la LAN es alcanzable fuera de casa sin volver a emparejar. Los
codigos de cierre del relay llegan como `RelayException` tipada (PC apagado,
telefono no emparejado / revocado, relay lleno) — §5.10.

**Orden de seleccion (1.6.2).** Cada intento dialea en paralelo las
direcciones guardadas (`TrustedDevice.hosts`, que `BridgeReplica` reemplaza con
`BridgeSettings.hosts`) y, solo con Wi-Fi/Ethernet, busca al PC por mDNS
(`_uxnan._tcp`, TXT `id` = `macDeviceId`, maximo 2,5 s, nunca en segundo plano).
Un socket abierto es solo un candidato: los handshakes E2EE corren uno a la vez
(8 s cada uno), primero las direcciones guardadas y al final las anunciadas por
mDNS (no estan firmadas). Un candidato cuyo handshake falla (otra identidad,
error de protocolo, silencio) se cierra y no se reintenta en ese intento; si no
queda ninguno, el mismo intento sigue por el relay (`RelayReason.directHandshakeFailed`),
de modo que nada en la red local puede dejar al telefono fuera de su relay. Si
mDNS vio al PC pero ninguna direccion respondio, el telefono lo dice
(`RelayReason.sameNetworkUnreachable`: la red puede aislar dispositivos).

**Volver a la via directa.** Si el telefono esta conectado por el relay y
cambia de red, vuelve al primer plano o recibe direcciones nuevas del PC, marca una sola vez las direcciones
directas que anuncia el PC (`selectDirect`, 2 s por direccion, sin tocar el
relay); si una responde, corre el handshake sobre ella con la sesion del relay
aun viva y la confirma como un cambio validado — el bridge cierra entonces el
canal del relay al registrar la conexion nueva. Si nada responde, no cambia
nada. Cuando ninguna direccion directa responde y el PC no tiene relay (o lo
tiene apagado), el selector falla con `TransportErrorKind.noRoute` y el
telefono dice que el acceso remoto del PC esta apagado y como encenderlo.

**Conexiones muertas y sustituidas.** El telefono envia un latido cada 25 s
mientras esta conectado; el bridge cierra una conexion de telefono que lleva
**90 s** sin recibir nada (`SESSION_IDLE_TIMEOUT_MS`), handshake incluido. Sin
eso, un canal del relay cuyo lado del telefono murio (el telefono cambio de
datos moviles a Wi-Fi) quedaba abierto para siempre, porque el tramo
bridge↔relay sigue sano. Ademas, la conexion nueva de un telefono cierra la
vieja (`SessionRegistry.register`). Del lado del telefono, al cambiar de
conexion la sesion nueva se confirma sin esperar el cierre de la anterior, y
el cierre de un transporte espera el saludo de cierre como mucho 2 s: un
socket muerto con su red nunca lo contesta.

#### 5.9.4 Correlacion de requests

```dart
// lib/infrastructure/transport/request_correlator.dart
class RequestCorrelator {
  final Map<String, Completer<RpcMessage>> _pending = {};
  final Duration timeout;    // default: 30 segundos

  Future<RpcMessage> send(RpcMessage request, WebSocketTransport transport) {
    final completer = Completer<RpcMessage>();
    _pending[request.id!] = completer;
    transport.send(encodeMessage(request));
    Future.delayed(timeout, () {
      if (!completer.isCompleted) {
        _pending.remove(request.id);
        completer.completeError(TimeoutException('Request timed out'));
      }
    });
    return completer.future;
  }

  void resolve(RpcMessage response) {
    _pending.remove(response.id)?.complete(response);
  }

  void rejectAll(Exception error) {
    for (final completer in _pending.values) {
      completer.completeError(error);
    }
    _pending.clear();
  }
}
```

---

### 5.10 Relay y notificaciones push

> **Dirección (2026-10):** el relay es **el relay propio de cada usuario**: un
> Cloudflare Worker con un Durable Object respaldado por SQLite que **el bridge
> despliega en la cuenta de Cloudflare del propio usuario** (plan gratuito). Uxnan
> no hospeda ningún relay ni tiene servidores en la ruta, y no existe URL por
> defecto. Sigue siendo **opcional**: LAN y Tailscale son directos y el teléfono
> los prueba primero (§2, §5.9.3). Las notificaciones push las entrega **solo el
> bridge, directo a FCM** (§5.10.2); el relay no tiene push. Reemplaza al
> servidor Node anterior (emparejamiento por `x-role`/`x-session-id`, sin
> autenticación), que se eliminó.

#### 5.10.1 Arquitectura del relay

```
Worker "uxnan-relay"  (wss://uxnan-relay.<subdominio>.workers.dev, en la cuenta del usuario)
├── GET /v1/version                          → { name: "uxnan-relay", protocol: 1, version }
├── /v1/host/<routingId>                     → socket de control del bridge
├── /v1/connect/<routingId>                  → un telefono
├── /v1/channel/<routingId>/<channelId>      → el lado del bridge de la tuberia de UN telefono
├── cualquier otra ruta → 404 · ruta sin upgrade WebSocket → 426
└── Durable Object RelayRoom — UNA sala por routingId (idFromName)
    ├── WebSocket Hibernation API: estado por socket en el attachment
    ├── SQLite: meta (host_key), allowed (claves de telefonos de confianza),
    │   tickets (SHA-256 + expiracion)
    └── alarmas para los plazos de autenticacion y de dial
```

`routingId` y `channelId` son 32 hex en minusculas (128 bits aleatorios). El
protocolo de control (version `RELAY_PROTOCOL_VERSION = 1`, independiente de la
version E2EE) esta definido una sola vez en `shared/src/relay/protocol.ts`
(`@uxnan/shared/relay`, sin dependencias para que el Worker lo empaquete); el
telefono lo replica en Dart (`relay_protocol.dart`).

##### Autenticacion antes de reenviar nada

1. El cliente abre una de las tres rutas.
2. El relay envia `{ t: "challenge", v: 1, nonce }` (32 bytes hex).
3. El cliente firma con su clave Ed25519 de identidad el string
   `relaySigningMessage` = `uxnan-relay-v1|<ruta>|<host del relay>|<routingId>|<channelId o vacio>|<nonce>`
   — la firma no se puede reutilizar en otra ruta, relay o canal, y el nonce la
   hace de un solo uso — y responde el frame de su ruta:
   - bridge, ruta host: `{ t: "host-auth", key, sig }`. `key` debe estar en el
     binding `UXNAN_HOST_KEYS` del Worker; el primer host que reclama un
     `routingId` queda ligado a el (`meta.host_key`). Un socket de control nuevo
     del mismo bridge reemplaza al anterior (cierre `replaced`).
   - telefono: `{ t: "phone-auth", key, sig, ticket? }`. `key` debe estar en la
     lista `allowed`, o el telefono presenta un `ticket` vigente (abajo).
   - bridge, ruta canal: `{ t: "channel-auth", sig }`, verificada con la clave
     ligada a la sala, y solo si un telefono autenticado espera ese canal.
4. El relay responde `{ t: "ready" }` o cierra con un codigo `RELAY_CLOSE`.

Desde `ready`, en las rutas de telefono y canal **cada frame se reenvia tal
cual** al otro extremo; el relay no parsea ninguno. Lo que viaja es el
handshake de §5.9.1 y los sobres AES-256-GCM.

##### Socket de control, dial y canales

El bridge (`bridge/src/relay/relay-host.ts`) mantiene abierto un socket a
`/v1/host/<routingId>`: tras `ready` envia `allow` con las claves de sus
telefonos de confianza (y lo reenvia cada vez que cambia el trust store), y
un `ping` cada 30 s que el runtime responde `pong` **sin despertar** al
Durable Object. Si se cae, reconecta con backoff de 2 s a 60 s (al ritmo mas
lento si el relay lo rechazo: `notAllowed`/`authFailed` no se arreglan solos).

Cuando un telefono autenticado llega, la sala envia al bridge
`{ t: "dial", channel }` y le da 10 s (`RELAY_DIAL_TIMEOUT_MS`) para abrir
`/v1/channel/<routingId>/<channel>`. El bridge abre **un canal por
telefono** y corre sobre el el mismo `handleSecureConnection` que en la LAN,
incluida la ventana de emparejamiento (§5.9.1). Si un extremo se va, la sala
cierra el otro (`peerClosed`).

##### Emparejar por el relay: tickets de un solo uso

Mostrar el QR o el codigo abre la ventana de emparejamiento del bridge
(§5.9.1) y ademas genera un ticket de 32 bytes aleatorios (base64url). El bridge
envia al relay solo `{ t: "ticket", hash: SHA-256(ticket), ttlMs }` — una edad,
no una fecha (los relojes no coinciden), con tope `RELAY_MAX_TICKET_TTL_MS` = 15
min; el bridge usa la duracion de su ventana — y el QR lleva el ticket en
`relay.ticket` (§5.5.4). Un telefono que no esta en la red del PC presenta el
ticket en `phone-auth`; el relay lo acepta **una vez** y lo borra. Despues, el
handshake `qr_bootstrap` sigue exigiendo la ventana abierta en el bridge, y al
completarse el telefono entra al trust store y por tanto a la lista `allow`.

##### Revocacion

Quitar un telefono de confianza (`bridge/removeTrustedDevice`) reenvia `allow`;
la sala cierra en el acto el canal vivo de ese telefono con `revoked` (4010),
no en su proxima reconexion. Un telefono que esta emparejando con ticket no se
toca.

##### Codigos de cierre (`RELAY_CLOSE`)

| Codigo | Nombre | Significado |
|---|---|---|
| 4001 | `authFailed` | frame de auth malformado o firma invalida |
| 4002 | `authTimeout` | sin auth en `RELAY_AUTH_TIMEOUT_MS` (10 s) |
| 4003 | `notAllowed` | clave no admitida (host desconocido, telefono no emparejado, ticket invalido o vencido) |
| 4004 | `bridgeOffline` | ningun bridge conectado a esta sala (PC apagado, o `routingId` rotado) |
| 4005 | `bridgeTimeout` | el bridge no abrio el canal a tiempo |
| 4006 | `peerClosed` | el otro extremo del canal se fue |
| 4008 | `badFrame` | frame de control demasiado grande o JSON invalido |
| 4009 | `replaced` | una conexion mas nueva del mismo host lo reemplazo |
| 4010 | `revoked` | la clave del telefono salio de la lista `allow` |
| 4011 | `full` | demasiados telefonos conectados a la vez |

Ademas, la sala responde `503 Relay full` al upgrade cuando ya tiene
`RELAY_MAX_SOCKETS` sockets o `RELAY_MAX_PHONE_CONNECTIONS` telefonos.

##### Limites

Frames de control ≤ 64 KiB (`RELAY_MAX_CONTROL_FRAME_BYTES`); ≤ 64 claves en
`allow` (`RELAY_MAX_ALLOWED_PHONES`); ≤ 8 telefonos conectados o conectando a la
vez (`RELAY_MAX_PHONE_CONNECTIONS`); ≤ 32 sockets por sala (`RELAY_MAX_SOCKETS`);
10 s para autenticar y 10 s para el dial.

##### Lo que el relay ve y guarda

Ve las claves publicas del bridge y de los telefonos, cuando se conectan y el
tamaño de los frames cifrados. **Nunca** el contenido ni claves que lo abran:
todo despues de su paso de auth es E2EE (§5.9). Guarda solo la clave del host
ligada a la sala, las claves de los telefonos de confianza y el SHA-256 de un
ticket abierto — nada del trafico. No tiene push (§5.10.2). TLS lo da
`workers.dev`.

##### Despliegue por el bridge (el bridge es el dueño)

El bridge es el unico dueño de la capacidad (`bridge/src/relay/relay-service.ts`);
el telefono, el desktop y el CLI le preguntan por `relay/*` (§1 de `02b`):

- `relay/setup { provider: "cloudflare", accountId, apiToken, remember? }` —
  por la API REST de Cloudflare (`relay/cloudflare.ts`): comprueba el
  subdominio `workers.dev` de la cuenta; lee las claves que el Worker
  `uxnan-relay` ya sirve (otro PC de la misma cuenta); sube el bundle que el
  bridge trae (`dist/relay-worker/`) con el binding Durable Object `RELAY` →
  `RelayRoom` y el binding de texto `UXNAN_HOST_KEYS` (agrega su clave publica,
  conserva las otras), con la migracion `new_sqlite_classes: ["RelayRoom"]` solo
  en el primer despliegue; habilita `workers.dev`; espera (hasta 60 s) a que
  `GET /v1/version` responda; guarda el endpoint y conecta.
- `relay/use { url }` — un relay desplegado a mano (mismo Worker); comprueba
  `/v1/version`. `ws://` solo para `localhost`/`127.0.0.1`.
- `relay/set { enabled, ageMs? }` — encender/apagar; una decision tomada
  offline se aplica solo si nadie decidio despues.
- `relay/update { apiToken?, remember? }` — despliega la version que el bridge
  trae (`RelayStatus.bundledVersion` vs `deployedVersion`).
- `relay/rotate` — `routingId` nuevo: el viejo deja de servir; los telefonos
  aprenden el nuevo por los ajustes compartidos.
- `relay/remove { deleteWorker?, apiToken?, remember? }` — deja de usarlo;
  con `deleteWorker` quita la clave de este PC del Worker y borra el Worker si
  no queda ningun PC.
- `relay/status` y la notificacion `stream/relay/updated` (el `RelayStatus`
  completo: endpoint, estado `off|connecting|connected|error`, `lastError`,
  versiones, `tokenRemembered`, `connectedPhones`, `hostKey`).

Donde vive cada cosa: el endpoint publico `{ url, routingId, enabled }` es el
ajuste compartido `BridgeSettings.relay` (clave `relay` de
`~/.uxnan/daemon-config.json`, escrito solo por el servicio del relay, nunca por
`settings/set`) y converge en cada cliente por `sync/changes` (§5.8.17); como
se configuro (`provider`, `accountId`, `deployedVersion`) vive en
`~/.uxnan/relay.json`. El token de Cloudflare se usa para la llamada y se
descarta, salvo que `remember` lo guarde en el llavero del sistema
(`relay.cloudflare-token`); nunca aparece en un archivo, log, respuesta,
notificacion ni error. El CLI (`uxnan-bridge relay status | setup --account <id>
[--remember] | use <wss-url> | enable | disable | update [--remember] | rotate |
remove [--delete-worker]`) habla con el daemon en ejecucion y lee el token sin
eco, nunca como argumento. Varios PCs comparten un Worker por cuenta, cada uno
con su sala.

##### Costo y rendimiento (plan gratuito, medido 2026-10-02)

El plan gratuito de Cloudflare basta: 100,000 requests/dia (los mensajes
WebSocket entrantes cuentan 20:1, los salientes son gratis) y 13,000 GB-s/dia
de duracion de Durable Objects; superar un limite hace fallar operaciones hasta
el dia siguiente, nunca cobra. Medido en una cuenta gratuita: despliegue REST
~0.6 s; una ruta `workers.dev` nueva responde tras ~5–15 s; el socket de control
inactivo hiberna (2 despertares del objeto en 3 minutos inactivos con pings de
30 s); `ready` del relay en ~360–540 ms; handshake E2EE por el relay ~210 ms;
RTT p50 de una peticion cifrada por el relay ~80 ms.

##### Por que este diseño

Un relay compartido operado por el proyecto obligaria a hospedar y pagar una
infraestructura central por la que pasarian los metadatos de todos los usuarios;
una VPN de malla (Tailscale) ya cubre a quien la quiera, pero pide instalar
algo en el telefono; un servidor propio en un VPS o detras de un tunel pide
mantener una maquina siempre encendida, TLS y actualizaciones. Un Worker en la
cuenta del propio usuario no cuesta nada en el plan gratuito, no deja ningun
servidor que mantener, lo despliega y actualiza el bridge con un token, y deja
los metadatos en la cuenta del usuario. El mismo Worker puede correr fuera de
Cloudflare sobre el runtime open-source de Workers (pendiente, `relay/FOR-DEV.md`).

#### 5.10.2 Flujo de push notification (solo bridge → FCM)

```
1. El telefono registra su token FCM/APNs con el bridge por la sesion E2EE
   (`notifications/register` { pushToken, platform, preferences? }). El bridge
   lo guarda en ~/.uxnan/push-state.json (por sessionId) y no lo envia a
   ningun otro sitio que no sea FCM.
2. Agente completa un turno en la PC
3. Bridge detecta el evento de completado (AgentManager.onTurnEnd)
4. PushService resuelve el token y la plataforma de cada telefono registrado
5. Bridge → Firebase (FCM HTTP v1) DIRECTO usando el service account local
   Body: { notification: { title, body }, data: { threadId, turnId, ... },
           android: { priority: 'high' }, apns: { headers: { 'apns-priority': '10' } } }
6. App movil recibe push → navega al thread correspondiente
7. Foreground suppression: la UI suprime la notificacion si la conversacion
   esta en pantalla (`foregroundThreadProvider`)

Nota: es la unica ruta de push, y funciona sobre cualquier transporte. El
service account FCM vive en `~/.uxnan/firebase-service-account.json`
(FOR-HUMAN) en la PC; `UXNAN_FCM_SERVICE_ACCOUNT` puede override el path; el
bridge lazy-loads `firebase-admin`. Sin service account (o si `firebase-admin`
no inicializa) no hay push en background: `notifications/register` responde
`registered: false` y el bridge registra
`push: no Firebase service account at <path> — background push disabled`. Las
notificaciones locales en foreground del telefono siguen funcionando. El relay
no participa: nunca recibe el token ni el texto de la notificacion.
```

#### 5.10.3 Push en Android y iOS (plataformas)

```dart
// lib/infrastructure/platform/push_notification_adapter.dart
// Usa firebase_messaging para ambas plataformas:
// - Android: FCM direct
// - iOS: APNs via el gateway de FCM (decision: FCM-para-ambos; la APNs key
//   se sube a Firebase. El path APNs-directo quedo descartado.)

class PushNotificationAdapter {
  // Inicializacion
  Future<void> initialize() async {
    await Firebase.initializeApp();
    await FirebaseMessaging.instance.requestPermission();
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) {
      await _notificationManager.registerToken(token);
    }
    FirebaseMessaging.instance.onTokenRefresh.listen(_notificationManager.registerToken);
  }

  // Handler de mensajes en foreground
  void setupHandlers() {
    FirebaseMessaging.onMessage.listen((message) {
      _notificationManager.handleIncomingPush(message.data);
    });
    // Background manejado por FirebaseMessaging.onBackgroundMessage (top-level function)
  }
}
```

---

## 6. Modelos de dominio

### 6.1 Mapa completo de modelos

```
domain/
├── entities/
│   ├── Thread
│   ├── Turn
│   ├── Message
│   ├── MessageContent           (text | code | image | tool | system | diff | mermaid)
│   ├── Project
│   ├── TrustedDevice
│   ├── PhoneIdentity
│   ├── SecureSession
│   ├── PairingPayload
│   ├── GitRepoState
│   ├── GitChangedFile
│   ├── GitDiffTotals
│   ├── WorkspaceCheckpoint
│   ├── PlanState
│   ├── PlanStep
│   ├── SubagentState
│   ├── SubagentAction
│   ├── ApprovalRequest
│   ├── AiChangeSet
│   ├── BridgeUpdatePrompt
│   ├── AuthStatus
│   ├── NotificationPreferences
│   └── AgentConfig
├── value_objects/
│   ├── RpcMessage
│   ├── JsonValue
│   ├── ContextWindowUsage
│   ├── TextFingerprint
│   ├── MessageOrderCounter
│   └── AgentCapabilities
└── enums/
    ├── MessageRole
    ├── TurnStatus
    ├── ThreadStatus
    ├── ThreadSyncState
    ├── HandshakeMode
    ├── ConnectionPhase
    ├── ConnectionRecoveryState
    ├── GitActionKind
    ├── GitActionPhaseStatus
    ├── GitFileStatus
    ├── AgentId
    ├── ServiceTier
    ├── ReasoningEffort
    ├── AccessMode
    ├── PlanStepStatus
    └── SubagentActionKind
```

### 6.2 MessageContent — tipos soportados

```dart
sealed class MessageContent {}

class TextContent extends MessageContent {
  final String text;
  final bool isStreaming;
}

class CodeContent extends MessageContent {
  final String code;
  final String? language;
  final String? filename;
}

class ImageContent extends MessageContent {
  final String? path;           // ruta en el workspace
  final String? base64Data;     // datos inline
  final String mimeType;
  final int? width;
  final int? height;
}

class ToolUseContent extends MessageContent {
  final String toolName;        // the agent's own name for the tool
  final String toolId;
  final Map<String, dynamic> input;
  final dynamic output;
  final bool isError;
  final ToolKind kind;          // read | search | list | fetch | webSearch | mcp | other,
                                // classified by the bridge for every agent
  final String? target;         // what it acted on, ready to show
}

class DiffContent extends MessageContent {
  final String filename;
  final String diff;            // formato unified diff
  final int additions;
  final int deletions;
}

class MermaidContent extends MessageContent {
  final String diagram;
  final String? diagramType;    // flowchart | sequenceDiagram | gantt | etc.
}

class SystemContent extends MessageContent {
  final String text;
  final SystemContentKind kind; // info | warning | error | debug
}

class CompactionContent extends MessageContent {
  final CompactionReason reason; // manual | threshold | overflow | automatic | unknown
  final int? tokensBefore;
  final int? tokensAfter;
}

class AssistantResponseBoundaryContent extends MessageContent {
  final AssistantResponsePhase phase; // commentary | finalAnswer | unknown
  final String? itemId;                // native item/message id when available
}

class CommandExecutionContent extends MessageContent {
  final String command;
  final String? output;
  final int? exitCode;
  final CommandStatus status;   // running | completed | error
}

class ApprovalContent extends MessageContent {
  final ApprovalRequest request;
}

// El agente pregunta al usuario (multiple-choice). El telefono renderiza una card
// con opciones y responde `turn/send { questionResponse: { questionId, answers } }`.
class QuestionContent extends MessageContent {
  final String questionId;
  final List<QuestionItem> questions; // { question, header?, options:[{label,description?}], multiple? }
}

class PlanContent extends MessageContent {
  final PlanState state;
}

class SubagentContent extends MessageContent {
  final SubagentState state;    // id, name (its task), status, actions, output (its report)
}
```

### 6.3 AiChangeSet

```dart
class AiChangeSet {
  final String id;
  final String threadId;
  final String turnId;
  final List<AiFileChange> files;
  final RevertState revertState;  // none | reverting | reverted | error
  final DateTime createdAt;
}

class AiFileChange {
  final String path;
  final FileChangeKind kind;     // created | modified | deleted
  final String? diff;
  final bool canRevert;
}
```

---

## 7. Estructura de directorios del proyecto Flutter

> ✅ **Implementado parcialmente** (rama `uxnanmobile`): el árbol está creado con las 5 capas. Completos: `core/`, `domain/enums`, parte de `domain/entities` + `domain/repositories`, `infrastructure/storage` + `infrastructure/repositories` (drift), `presentation/{theme,router,providers}` y las pantallas base. Las carpetas aún sin código llevan `.gitkeep`. `build.yaml` no es necesario por ahora (la generación de drift usa la config por defecto de `build_runner`).

> **Nota:** este proyecto usa `lib/core/` para utilidades transversales. En proyectos que siguen la convencion `config/`, el contenido equivalente se ubicaria en `lib/config/`.

```
uxnan_mobile/
├── android/
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   └── kotlin/com/uxnan/
│   │   │       └── MainKotlinActivity.kt       # (si se necesita codigo nativo)
│   │   └── build.gradle
│   └── build.gradle
├── ios/
│   ├── Runner/
│   │   ├── Info.plist                          # permisos: camara, notificaciones, red local
│   │   ├── AppDelegate.swift
│   │   └── GoogleService-Info.plist            # Firebase/FCM config
│   └── Podfile
├── lib/
│   ├── main.dart                               # entrypoint
│   ├── app.dart                                # MaterialApp + ProviderScope
│   ├── core/
│   │   ├── constants/
│   │   │   ├── protocol_constants.dart         # SECURE_PROTOCOL_VERSION, HKDF_INFO_TAG, etc.
│   │   │   └── app_constants.dart
│   │   ├── errors/
│   │   │   ├── app_exception.dart
│   │   │   ├── rpc_exception.dart
│   │   │   └── transport_exception.dart
│   │   ├── extensions/
│   │   │   ├── string_ext.dart
│   │   │   ├── datetime_ext.dart
│   │   │   └── uint8list_ext.dart
│   │   └── utils/
│   │       ├── logger.dart
│   │       └── debouncer.dart
│   ├── domain/
│   │   ├── entities/                           # (ver 5.1.1)
│   │   ├── value_objects/                      # (ver 5.1.3)
│   │   ├── enums/                              # (ver 5.1.2)
│   │   ├── repositories/                       # interfaces (ver 5.1.4)
│   │   └── usecases/                           # (ver 5.1.5)
│   ├── application/
│   │   ├── coordinators/
│   │   │   └── session_coordinator.dart
│   │   ├── managers/
│   │   │   ├── thread_manager.dart
│   │   │   ├── composer_manager.dart
│   │   │   ├── git_action_manager.dart
│   │   │   ├── sync_manager.dart
│   │   │   └── notification_manager.dart
│   │   └── processors/
│   │       └── incoming_message_processor.dart
│   ├── infrastructure/
│   │   ├── transport/
│   │   │   ├── websocket_transport.dart
│   │   │   ├── secure_transport_layer.dart
│   │   │   ├── request_correlator.dart
│   │   │   └── transport_selector.dart
│   │   ├── storage/
│   │   │   ├── local_database.dart             # drift database
│   │   │   ├── local_database.g.dart           # generado por drift
│   │   │   ├── secure_store.dart
│   │   │   └── tables/
│   │   │       ├── threads_table.dart
│   │   │       ├── messages_table.dart
│   │   │       ├── turns_table.dart
│   │   │       ├── projects_table.dart
│   │   │       ├── trusted_devices_table.dart
│   │   │       └── composer_drafts_table.dart
│   │   ├── repositories/                       # implementaciones
│   │   │   ├── drift_thread_repository.dart
│   │   │   ├── drift_message_repository.dart
│   │   │   ├── drift_trusted_device_repository.dart
│   │   │   ├── drift_project_repository.dart
│   │   │   ├── secure_storage_session_repository.dart
│   │   │   └── drift_composer_draft_repository.dart
│   │   ├── platform/
│   │   │   ├── qr_scanner_adapter.dart
│   │   │   ├── ssh_terminal_adapter.dart
│   │   │   ├── push_notification_adapter.dart
│   │   │   ├── image_picker_adapter.dart
│   │   │   ├── local_network_permission_adapter.dart
│   │   │   └── haptic_adapter.dart
│   │   └── crypto/
│   │       ├── key_generation.dart
│   │       ├── handshake_crypto.dart           # X25519, HKDF, Ed25519
│   │       ├── envelope_crypto.dart            # AES-256-GCM
│   │       └── fingerprint.dart
│   └── presentation/
│       ├── screens/                            # (ver 5.4.2)
│       ├── widgets/                            # (ver 5.4.2)
│       ├── providers/                          # Riverpod providers
│       ├── router/
│       │   └── app_router.dart
│       └── theme/
│           ├── uxnan_theme.dart
│           ├── colors.dart
│           ├── typography.dart
│           └── spacing.dart
├── test/
│   ├── unit/
│   │   ├── domain/
│   │   ├── application/
│   │   └── infrastructure/
│   ├── widget/
│   │   └── presentation/
│   └── integration/
│       └── connection_flow_test.dart
├── integration_test/
│   └── app_test.dart
├── assets/
│   ├── fonts/
│   ├── images/
│   │   ├── logo.svg
│   │   └── onboarding/
│   └── animations/
│       └── lottie/
├── l10n/
│   ├── app_en.arb
│   └── app_es.arb
├── pubspec.yaml
├── analysis_options.yaml
├── build.yaml                                  # configuracion de build_runner
└── README.md
```
