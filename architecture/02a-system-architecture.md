# Uxnan — Arquitectura del Sistema y Modulos

> **Version:** 1.2.3
> **Fecha:** 2026-08-02
> **Estado:** Definicion inicial — documento de arquitectura tecnica, sincronizado con codigo ALPHA
> **Plataformas objetivo:** Android (principal), iOS (principal)
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod

> **Executive summary (1.2.3):** native assistant messages inside one turn are
> preserved losslessly through durable response-boundary metadata; terminal
> payloads reconcile additively and mobile collapses completed progress replies
> without discarding them. Profile activity is owned by a complete,
> global-per-PC bridge ledger. Conversation deletion never subtracts historical
> metrics; export/import includes conversations, messages, reported tokens,
> sessions and Git actions. Phone transport identity remains installation-local
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
| **Uxnan Relay** | Node.js HTTP/WS | Relay de transporte E2EE + push |
| **Agent Adapters** | Node.js | Adaptadores por agente (Codex, OpenCode, etc.) |

---

## 2. Topologias de conexion

> **Dirección (2026-06-12):** el producto es **bridge-first**. Las topologías
> primaria y recomendada son LAN-direct y Tailscale-direct (cero hosting,
> cero credenciales). El relay sigue siendo totalmente compatible y es el
> fallback off-LAN que el usuario puede self-hostear. Ver `bridge/FOR-DEV.md`
> → *Direct LAN/Tailscale addressing* y `relay/FOR-DEV.md` → *Direction*.

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

**Topologia 3 — Relay remoto / self-hosted (FALLBACK off-LAN):**
```
[Movil] ──WS E2EE──→ [Relay self-hosted] ──WS E2EE──→ [Bridge]
```
Cuando el movil esta fuera de la LAN y no hay Tailscale. El relay
retransmite envelopes cifrados opacos; nunca ve el contenido. El relay es
**opcional y self-hosted**: el usuario lo despliega en un VPS o servidor
domestico. El bridge lo anuncia en el QR solo si `relayEnabled = true`
(por defecto `false`).

**Notas:**
- `mac` y `iphone` son **roles del protocolo**, no plataformas. `mac` corre
  en Windows/macOS/Linux (donde corre el bridge); `iphone` corre en
  Android/iOS (la app movil).
- El QR codifica `PairingPayload` como **Base64 del UTF-8 del JSON**
  (v2 del pairing), no como JSON plano. `PairingValidator` requiere al
  menos un transporte (`relay` o `hosts`); emite `missing_transport` si
  ambos faltan.

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

  // Native session identity used for completed-turn convergence in turn/list.
  nativeSessionId?(threadId: string): string | null;

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
  registerPushToken(token: string, secret: string): Promise<void>;
  notifyCompletion(threadId: string, turnId: string): Promise<void>;
}

interface AgentCapabilities {
  // Fuente de verdad: shared/src/agents/agent-capabilities.ts (TypeScript).
  planMode: boolean;               // agente soporta modo plan interactivo
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
//   ✅ opencode  (default; `opencode serve` HTTP/SSE; sesión de server por thread persistida para continuidad; planMode=true vía `todo.updated` nativo; **`permission.asked` real approvals**)
//   ✅ claude-code (`claude -p --output-format stream-json`; --resume; **PreToolUse hook** real approvals)
//   ✅ codex     (`codex app-server`; JSON-RPC over stdio, un proceso por turno — Codex sólo admite UN writer por thread, así que el bridge lo suelta al terminar el turno y reengancha con `thread/resume`; `thread/start`/`turn/start` + every elicitation)
//   ✅ pi-agent  (`pi -p --mode json`; --session-id; **autonomous=true**: YOLO headless, no pre-tool protocol — see FOR-DEV)
//   ✅ antigravity-cli (`agy --conversation <uuid> --add-dir <cwd> -p`; active Google CLI; client-owned --conversation continuity; **autonomous=true**: `--dangerously-skip-permissions`, requestApproval→`--mode plan` read-only; models via `agy models`)
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
    "relayUrl": "wss://relay.uxnan.io",
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
  final String relayUrl;
  final String sessionId;
  final DateTime pairedAt;
  final DateTime? lastSeen;
  const TrustedDevice({...});
}

// lib/domain/entities/pairing_payload.dart
class PairingPayload {
  final int version;                      // PAIRING_QR_VERSION = 2
  final String relayUrl;
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

> ✅ **Implementado** (rama `uxnanmobile`): `lib/application/managers/thread_manager.dart`. Construye el `TurnTimelineSnapshot` del thread activo desde el repositorio local y aplica eventos de streaming (start/delta/complete, persistiendo el mensaje final); `loadThreads` (`thread/list`) y `sendUserMessage` (`turn/send`) sobre un `RpcSend` inyectado; dedup vía `MessageDeduplicator`. Expone `threadsStream`/`timelineStream` a providers Riverpod. Probado con DB in-memory + stream de eventos controlable. Adaptación: el spec usa `ValueNotifier`; se usan streams (BehaviorSubject) para Riverpod 3.x. Pendiente (FUTURO): paginación remota (`loadMoreHistory`), `startNewThread`/`resumeThread`/`fork`.

```dart
// lib/application/managers/thread_manager.dart
class ThreadManager {
  // Estado observable
  final ValueNotifier<List<Thread>> threads;
  final ValueNotifier<Thread?> activeThread;
  final ValueNotifier<Map<String, TurnTimelineSnapshot>> timelines;

  // Acciones
  Future<void> loadThreads({String? projectId});
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
  static const notificationSecret = 'uxnan.push.notification_secret';
}
```

#### 5.3.4 Almacenamiento local (SQLite)

> ✅ **Implementado** (rama `uxnanmobile`): `UxnanDatabase` y el esquema completo de 7 tablas en `lib/infrastructure/storage/`. Detalle de tablas y repositorios en 02c §10. Repositorios drift listos: `Thread`, `ComposerDraft` (los demás se implementan con su módulo).

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
> **Cada nivel tiene su propio orden**: proyectos, worktrees y conversaciones,
> los tres con las mismas cuatro opciones (`ListSort`: estado, actividad,
> creacion, nombre). Los worktrees **dentro** de un proyecto se ordenan con el
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
> el panel en vez de apilar — y eso vive en `pane_navigation.dart`. El detalle
> esta en `architecture/02c` §3.3.
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
│   └── pane_navigation.dart              # openInPane / closePane: que significa un toque
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
│   │   ├── space_rows.dart               # filas de proyecto y de carpeta
│   │   ├── thread_tile.dart              # fila de conversacion (estado derivado)
│   │   ├── thread_list_controls.dart     # orden por nivel (ListSort) + menu en cascada
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
│   │   ├── files/                        # navegador de archivos + visor/editor
│   │   ├── git/                          # estado, historial, detalle de commit
│   │   └── support/                      # selector de modelo, recuperacion, errores
│   ├── onboarding/
│   ├── pairing/                          # QR, codigo manual, descubrimiento en LAN
│   ├── profile/
│   │   ├── profile_screen.dart           # metricas agregadas + heatmap + uso
│   │   ├── agent_activity_section.dart
│   │   ├── usage_section.dart
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

```dart
// lib/presentation/router/app_router.dart
final appRouter = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (_,__) => const AppShellScreen(), routes: [
      GoRoute(path: 'home', builder: (_,__) => const HomeScreen()),
      GoRoute(path: 'conversation/:threadId', builder: (_,s) => ConversationScreen(threadId: s.pathParameters['threadId']!)),
      GoRoute(path: 'settings', builder: (_,__) => const SettingsScreen()),
      GoRoute(path: 'devices', builder: (_,__) => const MyDevicesScreen()),
      GoRoute(path: 'projects', builder: (_,__) => const ProjectsScreen()),
      GoRoute(path: 'terminal', builder: (_,__) => const TerminalScreen()),
    ]),
    GoRoute(path: '/onboarding', builder: (_,__) => const OnboardingScreen()),
    GoRoute(path: '/pairing', builder: (_,__) => const QrScannerScreen()),
  ],
);
```

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
│   ├── version del QR == PAIRING_QR_VERSION (2)?
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
> variante bridge-first cubre el caso LAN; para acceso fuera-de-LAN se usa
> Tailscale o un relay genérico de WebSocket con la sesión E2EE.
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
`uxnan-bridge code`).

#### 5.5.4 Estructuras de pairing

> **Cambio (2026-06):** `relay` ahora es **opcional**; el payload incluye
> `hosts: string[]` con las direcciones directas del bridge (LAN + Tailscale).
> La codificación del QR es **Base64 del UTF-8 del JSON** (v2 del pairing).

```typescript
// PAIRING_QR_VERSION = 2
// Payload transportado en el QR como Base64(utf8(JSON))
interface PairingPayload {
  v: 2;                              // version del formato QR
  // Al menos uno de los dos es obligatorio:
  relay?: string;                    // URL del relay: wss://...  (opcional)
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
  final String relayUrl;                  // puede ser null (solo-direct)
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
│   ├── Abre WebSocket al relay con headers:
│   │   └── x-role: iphone, x-session-id: <sessionId>
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
> (`system/compact_boundary`), OpenCode (`session.compacted`) y pi
> (`compaction_end` exitoso) emiten la señal. Zero/Grok por ACP y Antigravity no
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
// lib/presentation/screens/conversation/git/diff_viewer.dart
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
3. Mantener conexion con el relay via WebSocket
4. Registrar handlers de metodos JSON-RPC por dominio
5. Ejecutar Git localmente mediante `child_process`
6. Gestionar workspace, checkpoints y archivos
7. Mantener estado daemon en `~/.uxnan/` (fuera del repo del proyecto)
8. Vigilar rollout/versiones y compatibilidad
9. Sanitizar payloads: nunca exponer tokens o secretos al movil
10. Buffer de outbound messages para reconexion sin perdida

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
│   ├── cli.ts                      # CLI (start/stop/status/qr/code/install-service)
│   ├── daemon-state.ts             # persiste config, pairing, status
│   ├── daemon-config.ts            # ~/.uxnan/daemon-config.json
│   ├── handler-router.ts           # ruteo + validacion Ajv de metodos JSON-RPC
│   ├── bridge-status.ts            # snapshots de estado / relayConnected / update (latestVersion)
│   ├── update-check.ts             # chequeo de version en npm (dist-tag latest, cache 24h; `start` la ignora y re-chequea)
│   ├── qr.ts                       # QR + pairing code
│   ├── account-status.ts           # snapshot sanitizado de auth (nunca tokens)
│   ├── version.ts                  # BRIDGE_VERSION + BRIDGE_PACKAGE_NAME desde package.json
│   ├── lock-file.ts                # single-instance lock + stop
│   ├── logger.ts                   # logging a archivo + redaccion de secretos
│   ├── service-installer.ts        # autostart por OS (sin elevacion)
│   ├── secret-store.ts / keyring-secret-store.ts  # identidad en keychain del SO
│   ├── transport/                  # E2EE: relay-client, lan-server, server-handshake,
│   │                               #   crypto, secure-channel, outbound-log (catch-up),
│   │                               #   mdns-advertiser, local-hosts, trust-store, ...
│   ├── pairing/pairing-code-service.ts        # GET /pair/resolve?code=
│   ├── adapters/                   # un adapter + *-tools.ts por agente:
│   │                               #   opencode(+serve,approval)/claude/codex(+app-server,approval)/pi/antigravity/zero(+acp,approval)/grok(+acp,approval),
│   │                               #   echo, process-agent-adapter, content-blocks, run-options,
│   │                               #   resolve-<agente>, spawn
│   ├── agents/agent-manager.ts     # orquestacion de turnos/streaming + approvals
│   ├── agents/attachments.ts       # imagenes inline → archivos en el cwd
│   ├── conversation/               # thread-store, native-session history convergence
│   ├── git/                        # git-runner, git-service
│   ├── workspace/                  # workspace-service, browse-service, checkpoint-service, path-guard
│   ├── push/                       # push-service, push-sender (FCM directo)
│   ├── hooks/                      # claude-approval-hook
│   └── handlers/                   # git, workspace, thread-context, project, agent,
│                                   #   account, notifications, bridge-control, desktop (stub)
└── scripts/                        # install-service-{macos,windows,linux}
```

> Nota histórica: el draft original listaba módulos `.js` sueltos (p.ej.
> `secure-transport.js`, `agent-transport.js`, `voice-handler.js`,
> `push-notification-completion-dedupe.js`). No existen como tales: la función de
> voz nunca se implementó (no está en el registry), el dedupe de push vive en
> `relay/src/push.ts`, y el transporte está en `src/transport/`.

#### 5.8.3 Estado persistido del bridge

El bridge mantiene estado en `~/.uxnan/`:

```
~/.uxnan/
├── daemon-config.json              # configuracion general
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

#### 5.8.4 Autostart del bridge

- **macOS:** LaunchAgent en `~/Library/LaunchAgents/dev.luisgamas.bridge.plist`
- **Windows:** Windows Service o Task Scheduler via PowerShell
- **Linux:** systemd user unit en `~/.config/systemd/user/uxnan-bridge.service`

#### 5.8.5 Protocolo de instalacion del bridge

El bridge se instala como paquete npm global:

```bash
npm install -g uxnan-bridge
uxnan-bridge start          # inicia el daemon
uxnan-bridge qr             # muestra QR de pairing en terminal
uxnan-bridge status         # muestra estado actual
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
(`GitHistoryScreen` en `presentation/screens/conversation/git/`): la app
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
  `presentation/screens/conversation/files/`, managed by
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
  viewer opens from the `folder_open_rounded` `IconSurface` beside `GitScreen`
  in `ConversationScreen`.
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
| OpenCode | local `opencode serve` `GET /session/:id/message`; legacy JSON-store fallback | OpenCode Desktop/CLI completed turns across current SQLite and older installs |
| Zero | `~/.local/share/zero/sessions/<sessionId>/events.jsonl` | completed ACP session turns |
| Grok | `~/.grok/sessions/<encoded-cwd>/<sessionId>/updates.jsonl` | ACP turns closed by `turn_completed` only |
| Antigravity | none | unsupported: `agy` has no history/export API and its SQLite step payloads are opaque |

`IAgentAdapter.nativeSessionId(threadId)` supplies the native identity and
`AgentManager` persists it through `ThreadStore.setAgentSession`. The mirror of
that — `IAgentAdapter.adoptNativeSession(threadId, sessionId)`, offered before a
turn runs and only when the stored session belongs to the same agent — hands the
id back after a bridge restart, so the conversation continues in the SAME agent
session rather than opening a new one behind a history the phone still shows.
Reconciliation then follows these rules:

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
- a turn imported before it could be matched is **dropped** once its
  bridge-created twin is recognized, which is what converges a store that
  already holds the same exchange twice;
- completed native-only user/assistant pairs are imported and can be refreshed
  on a later read;
- user-only/in-progress native turns are ignored until an assistant result is
  durable;
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

#### 5.8.10 Estadisticas de uso por proveedor (`agent/usageStats`)

Metodo `agent/usageStats` (contrato `ProviderUsage[]` en `shared/src/models/usage.ts`;
ver 02b). Surface las ventanas de cuota (% consumido + reinicio), plan/cuenta y
saldo de credito de los CLIs de IA que el usuario **activo** — nunca de todos, para
ahorrar recursos.

**Postura de datos:** solo se leen los **archivos locales del CLI** (su token OAuth
ya guardado) y se llama a la **API oficial de uso** de cada proveedor. **Nunca**
cookies del navegador ni API keys pegadas por el usuario. Proveedores wired:
**Codex** (`~/.codex/auth.json` → chatgpt backend), **Claude** (`~/.claude/.credentials.json`
→ `api.anthropic.com/api/oauth/usage`), **Copilot** (token de `gh` → `api.github.com`),
and **Grok**
(`~/.grok/auth.json` → cli-chat-proxy). Cada proveedor degrada a un
`status` (`ok`/`authRequired`/`notInstalled`/`error`); uno lento o roto no tumba a
los demas.

**Lectura per-runtime (dual-reader, mismo contrato):** el acceso al disco de la PC
es intrinsecamente por-runtime, asi que se unifica por **contrato**, no por codigo:
- **Desktop (standalone, hoy):** lo lee **nativo en Rust** (`src-tauri/src/usage.rs`,
  comando `usage_read`), sin dependencia de Node — Settings → Providers.
- **Bridge (implementado):** lo lee en **TS** (`bridge/src/usage/usage-reader.ts`,
  handler `agent/usageStats`) portando el mismo reader del desktop, y lo sirve al
  telefono, que no ve el disco de la PC directamente — mismo contrato, misma
  postura de datos. La UI del telefono (seccion "Uso y credito" en el perfil) es
  el pendiente restante (ver `uxnanmobile/FOR-DEV.md`).

#### 5.8.11 Metricas de perfil (`metrics/*`) — bridge como fuente de verdad

Mobile profile metrics (conversations, messages, agents/models used, connected
time, sessions, Git actions, reported tokens and activity heatmaps) are owned by
the **bridge** and served through `metrics/*` (`MetricsSnapshot` in
`shared/src/models/metrics.ts`; see 02b §1.2). The phone caches/renders one
snapshot per PC and sums PCs. Provider quota/credit usage is a separate live
surface (`agent/usageStats`) and is never written to this ledger.

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
- El directorio se borra al terminar el turno.
- El mensaje que se persiste en el historial no filtra rutas temporales: un
  turno solo-imagen guarda `[N image attachments]`.
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

El bridge conduce **un turno por thread**. No es una simplificacion: la mitad
de los agentes corre one-shot por turno (`claude -p --resume`, pi,
antigravity), asi que dos turnos concurrentes serian dos procesos CLI sobre la
misma sesion nativa. Un `turn/send` que llega con un turno en vuelo se
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
bridge hace lo mismo donde la CLI del agente realmente lo permite.

```javascript
// #enqueueTurn -> #tryDeliverMidTurn(threadId, adapter, entry)
//   requiere: adapter.capabilities.steering && adapter.steerTurn
//             + turno en vuelo
//             + cola VACIA        (algo esperando ya se envio antes -> FIFO)
//             + cola NO pausada   (el usuario paro al agente, o se rompio)
//   exito -> ThreadStore.deliverQueuedTurn(threadId, turnId, intoTurnId)
//            + stream/turn/delivered ; turn/send responde { delivered: true }
//   fallo  -> el turno se queda `queued` y corre normal despues
```

El estado `delivered` es **terminal y exitoso**, deliberadamente distinto de
`cancelled`: el mensaje SI llego al agente, la respuesta pertenece al turno al
que se unio (`Turn.deliveredIntoTurnId`), y por eso `queue/clear` no lo toca ni
`#drainQueue` lo reproduce. Cualquier negativa del adaptador cae a la cola de
siempre, asi que un mensaje nunca se pierde: como mucho espera.

Que agentes pueden, y por que (verificado contra las CLI reales):

| Agente | ¿Steering? | Mecanismo |
|---|---|---|
| **Claude Code** | Si | `-p --input-format stream-json`, mensaje por stdin abierto |
| **OpenCode** | Si | otro `prompt_async` sobre la sesion ya ocupada |
| **Codex** | Si | app-server `turn/steer { threadId, expectedTurnId, input }` |
| **pi** | Si | comando RPC `steer`, drenado por su bucle de agente en el siguiente limite |
| **Antigravity** | No | `agy -p` es de un disparo; no hay canal de entrada |
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
//     -> stream/thread/renamed { threadId, title, titleSource }
```

Todo es **best-effort y acotado** (30 s): sin credito, sin CLI o con timeout el
thread conserva su titulo provisional y la conversacion no se entera. Y un
renombrado a mano hecho mientras corria el turno siempre gana.

Cableado en **los siete agentes activos**, cada uno con la forma de una pasada
de su propia CLI y elegida para no dejar rastro en la conversacion que nombra:

| Agente | Invocacion | Modelo |
|---|---|---|
| Claude Code | `-p`, sin `--resume` | `haiku` |
| Codex | `codex exec --ephemeral -s read-only --skip-git-repo-check -o <file>` | `gpt-5.4-mini` |
| OpenCode | `opencode run` (sin flags de sesion) | por defecto de la CLI |
| pi | `pi -p --no-session` | por defecto de la CLI |
| Antigravity | `agy -p` (sin `--conversation`) | `gemini-3.6-flash-low` |
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

Un adaptador decide cuando el agente termino, y hay dos formas:

| Termina por | Adaptadores | ¿La CLI puede emitir despues? |
|---|---|---|
| **Evento de protocolo** | Claude (`result`), Codex (`turn/completed`), OpenCode (`session.idle`), Pi (`stopReason`), Grok / Zero (respuesta ACP a `session/prompt`) | **Si** — el proceso sigue vivo cuando llega el evento |
| **Cierre del proceso** | Antigravity | No — el turno no puede terminar antes que el proceso |

La primera fila es la peligrosa, y **Claude Code lo demuestra**: cuando el modelo
lanza una tarea en segundo plano (`Bash` con `run_in_background`) y termina su
turno, la CLI emite su `result` y **sigue corriendo**; si ese trabajo acaba
dentro de su margen, la CLI **despierta al modelo** y produce un segundo turno
completo sobre el mismo proceso. Medido contra la CLI real, ese margen es de
**~4–6 s**, tras los cuales la CLI **mata** la tarea (`status:"stopped"`) y sale
con ese trabajo sin terminar.

**Una espera larga NO es este caso.** El margen anterior aplica solo a trabajo
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
   retiene la finalizacion hasta que la CLI produzca su turno de seguimiento o
   salga. Se emite **un solo** `turn_completed`, con **ambas** respuestas: el
   `result` de la CLI solo lleva el texto del ultimo turno.
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
store y en el manager porque la exposicion la comparte toda la primera fila de la
tabla, hoy o tras cualquier cambio upstream.

### 5.9 Transporte seguro y mensajeria E2EE

El transporte seguro es la capa mas critica del sistema. Garantiza que el relay nunca vea el contenido de los mensajes en texto claro.

#### 5.9.1 Protocolo de handshake completo

> ✅ **Implementado** (rama `uxnanmobile`): primitivas crypto en `lib/infrastructure/crypto/` (verificadas contra vectores RFC 8032/7748/5869 y NIST) + la mecánica de transporte en `lib/infrastructure/transport/`: `WebSocketTransport`/`WebSocketChannelTransport`, `SecureTransportLayer.performHandshake` (flujo clientHello→serverHello→clientAuth→ready con verificación de nonce/expiry/identidad/firma), `SecureChannel` (cifrado + `seq` 1-based + rechazo de replay), `RequestCorrelator`, `BackoffCalculator`, `OutboundMessageBuffer`. Probado con un handshake de dos partes sobre un transporte en memoria. **Pendiente** (siguiente incremento): `SessionCoordinator` (máquina `ConnectionPhase` + bucle de reconexión + providers), `TransportSelector` (descubrimiento LAN), `IncomingMessageProcessor` e integración WS en vivo contra un bridge real.
>
> **Contrato — codificación canónica del transcript:** el transcript que se firma es el UTF-8 de la concatenación, en el orden documentado, de la representación *wire* de cada campo: hex en minúsculas para los campos de bytes (`clientNonce`, claves efímeras, `serverNonce`), el string tal cual para `sessionId`, y la representación decimal para los enteros (`keyEpoch`, `expiresAtForTranscript`). El bridge debe reproducir esta codificación byte a byte. La librería usada para AES-256-GCM es `cryptography` (no se introduce ninguna variante criptográfica: mismos algoritmo y parámetros del spec).

```
CONSTANTES:
  SECURE_PROTOCOL_VERSION = 1
  PAIRING_QR_VERSION = 2
  HKDF_INFO_TAG = "uxnan-e2ee-v1"
  MAX_PAIRING_AGE_MS = 300_000        (5 minutos)
  CLOCK_SKEW_TOLERANCE_MS = 60_000   (60 segundos)
  TRUSTED_RECONNECT_SKEW_MS = 90_000 (90 segundos)
  MAX_BRIDGE_OUTBOUND_MESSAGES = 500
  MAX_BRIDGE_OUTBOUND_BYTES = 10_485_760  (10 MB)
  PAIRING_WINDOW_MS = 180_000         (3 minutos — ver nota de seguridad abajo)
```

**Fase 1 — Bootstrap por QR (solo primera conexion):**

1. El bridge genera un par Ed25519: (`macIdentityPrivateKey`, `macIdentityPublicKey`)
2. El bridge publica QR con payload: `{ v, relay, sessionId, macDeviceId, macIdentityPublicKey, expiresAt, displayName }`
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
> command, and `start`'s own printed QR) and `currentPairingCode()` (the `code`
> command) — and by a **successful `GET /pair/resolve`**: producing the current
> code proves the caller read it off the PC, which is the same consent signal.
> That last one is what keeps pairing working against an autostarted,
> console-less daemon: `qr`/`code` run in a SEPARATE short-lived process and
> share the code through `~/.uxnan/pairing-code.json`, but arming is in-memory
> and does not cross processes, so the daemon that actually serves the handshake
> can only be armed by the resolve it serves itself. `server-handshake.ts`
> rejects an unarmed `qr_bootstrap` BEFORE any
> `trustStore` mutation and before `ready` is sent. This corrects an earlier
> drift: the manual-pairing-code service documented itself as "the consent
> gate" for pairing, but that check only guarded `GET /pair/resolve` — the
> handshake itself accepted a bootstrap unconditionally regardless of whether
> the code or QR had ever been shown. The window is the actual gate now; the
> code/QR remain how the phone *learns* the connection details, not (yet) a
> value the handshake itself verifies. `trusted_reconnect` is NOT gated by the
> window (an already-trusted phone reconnects at any time), and the relay path
> is NOT gated by it either (it already scopes a bootstrap to one
> `expectedSessionId` per connection). **Deferred hardening (see
> `bridge/FOR-DEV.md`):** (1) binding enrollment to a phone-computed proof that
> it holds the pairing code — i.e. to *this* phone rather than to *some* open
> window — needs coordinated mobile work that isn't wired yet; (2) arming a
> hidden daemon for the QR-**scan** path, which never calls `/pair/resolve` and
> so is not covered by the resolve-arming above (pair with the manual code
> there).

**Fase 2 — Handshake criptografico:**

```
iPhone → Bridge: clientHello
{
  kind: "clientHello",
  protocolVersion: 1,
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
  protocolVersion: 1,
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
class TransportSelector {
  // Orden de preferencia:
  // 1. WebSocket directo LAN (si bridge detectable en red local)
  // 2. WebSocket via relay (WAN)
  // En ambos casos, la semantica E2EE es identica

  Future<WebSocketTransport> select(TrustedDevice device) async {
    // Intenta LAN primero con timeout de 2 segundos
    final lan = await _tryLan(device);
    if (lan != null) return lan;
    return _createRelayTransport(device);
  }
}
```

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

> **Cambio de dirección (2026-06-12):** el relay es ahora **opcional y
> self-hosted**. La ruta primaria del producto es LAN-direct / Tailscale-direct
> (ver §2). Las notificaciones push se entregan **directamente desde el bridge**
> sobre cualquier transporte (LAN, Tailscale, o relay) — no requieren relay.
> El relay conserva los endpoints `/push/*` como fallback opcional para setups
> con relay hospedado. Ver `relay/FOR-DEV.md` y `bridge/FOR-DEV.md` →
> *Direct FCM from the bridge*.

El relay, cuando se despliega, es un servidor Node.js independiente del
bridge. Su unico rol es retransmitir envelopes E2EE opacos y (opcionalmente)
gestionar push notifications.

#### 5.10.1 Arquitectura del relay

```
Relay Server (opcional / self-hosted)
├── HTTP Server (http nativo)
│   ├── GET  /health                        → health check
│   ├── POST /push/register                 → registra token push (fallback)
│   └── POST /push/notify                   → envia notificacion (fallback)
├── WebSocket Server (noServer mode)
│   ├── Upgrade HTTP → WS con rate limiting por IP
│   │   ├── Rate limits: HTTP 120/min, upgrade 60/min
│   │   ├── Mapas del limiter acotados: barrido de ventanas expiradas
│   │   │   + cap duro de 10k claves (evicción oldest-first) para que la
│   │   │   rotación de IPs no crezca la memoria sin límite
│   │   ├── Origin check (CSWSH defense): mismo host o allowlist
│   │   └── Rechaza upgrades en paths no-relay
│   └── Routing de sesiones por sessionId
│       ├── Rol "mac" (bridge PC)
│       │   Headers: x-role, x-session-id
│       └── Rol "iphone" (app movil)
│           Headers: x-role, x-session-id
├── Push Service (fallback; ruta primaria es bridge-direct)
│   ├── Registro de device token por sesion (persistido a relay-state.json)
│   ├── Envio via FCM HTTP v1 (Android directo + iOS via APNs-uploaded-to-FCM)
│   ├── Deduplicacion por (sessionId,turnId) + TTL 7d, cap 10k
│   └── Persistencia atomic temp+rename; restaurado al arranque via load()
└── FCM Client (firebase-admin, optionalDependency)
    Carga perezosa cuando UXNAN_FCM_SERVICE_ACCOUNT esta definido.
    (No existe emisor APNs-directo: la decision es FCM-for-both.)
```

**Routing de sesiones y reconexion.** Cada `sessionId` empareja un socket `mac`
(bridge) con un socket `iphone` (telefono). El bridge sirve **exactamente una
sesion por socket `mac`** y solo re-arma su handshake cuando ese socket se cierra
(ver el loop `connectRelay` del bridge). Por eso el relay debe garantizar que el
socket `mac` se cierre cuando la sesion del telefono deja de ser valida:

- **Cierre real del socket actual** → el relay cierra el peer emparejado, para
  que el telefono detecte un bridge muerto (y reconecte) y el bridge re-arme.
- **Socket reemplazado (supersession)** → cuando un socket nuevo toma el rol de
  uno previo para el mismo `sessionId` (caso tipico: el telefono reconecta tras
  un *background* mientras su socket viejo sigue *half-open* y nunca envio FIN),
  el relay cierra de inmediato el socket superado **y** su peer emparejado. El
  cierre tardio del socket viejo se ignora (ya no es el socket actual del rol),
  asi que este teardown ocurre en el momento de la supersession. Sin el, el
  handshake del telefono que reconecta se reenvia al loop de sesion **obsoleto**
  del bridge —que lo descarta como trafico cifrado invalido— y el telefono queda
  atascado en "reconnecting" hasta forzar el cierre de la app.

**Backoff del re-armado.** El re-armado del bridge es inmediato en el caso sano,
pero **no** es incondicional: si la sesion `mac` muere en menos de 3 s (el relay
acepta y cierra en el acto, un rebote del relay, o la sesion ya esta tomada), el
loop `connectRelay` aplica un backoff exponencial acotado — base 2 s, tope 30 s —
antes de volver a marcar, y vuelve a la base en cuanto una sesion dura lo
suficiente. Sin el, un relay que rebota empuja al bridge a un bucle de reconexion
sin pausa. La supersession descrita arriba cierra un socket que normalmente vivio
mucho mas de 3 s, asi que el teardown sigue re-armando de inmediato.

#### 5.10.2 Flujo de push notification (RUTA PRIMARIA: bridge-direct)

```
1. Agente completa un turno en la PC
2. Bridge detecta el evento de completado (AgentManager.onTurnEnd)
3. Bridge consulta el PushService para resolver el device token FCM real
   del telefono (persistido en ~/.uxnan/push-state.json, por sessionId)
4. Bridge → Firebase (FCM HTTP v1) DIRECTO usando el service account local
   Body: { notification: { title, body }, data: { threadId, turnId, ... },
           android: { priority: 'high' }, apns: { headers: { 'apns-priority': '10' } } }
5. App movil recibe push → navega al thread correspondiente
6. Foreground suppression: la UI suprime la notificacion si la conversacion
   esta en pantalla (`foregroundThreadProvider`)

Nota: este flujo no requiere relay. El service account FCM vive en
`~/.uxnan/firebase-service-account.json` (FOR-HUMAN) en la PC; el bridge
lazy-loads `firebase-admin`. `UXNAN_FCM_SERVICE_ACCOUNT` puede override el path.
```

#### 5.10.3 Flujo de push notification (FALLBACK: via relay, opcional)

```
1. Agente completa un turno en la PC
2. Bridge detecta el evento de completado
3. Bridge verifica push-notification-tracker: notificar?
4. Bridge verifica push-notification-completion-dedupe: ya enviado?
5. Bridge → Relay: POST /push/notify
   Body: { sessionId, notificationSecret, threadId, turnId, title, body }
6. Relay valida notificationSecret contra sesion autenticada del mac
7. Relay construye payload APNs/FCM:
   { aps: { alert: { title, body }, sound: "default" },
     data: { threadId, turnId } }
8. Relay envia a APNs (iOS) o FCM (Android)
9. App movil recibe push → navega al thread correspondiente
```

Este path se usa solo cuando (a) el bridge no tiene credencial FCM local, o
(b) `relayEnabled` es true. La deduplicacion por `(sessionId, turnId)` evita
doble entrega si ambos paths estan activos.

#### 5.10.4 Push en Android y iOS (plataformas)

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

#### 5.10.5 Deduplicacion de notificaciones (solo en el path via relay)

```javascript
// relay/src/push.ts (PushRegistry)
// Evita duplicados cuando el relay reconecta o reemite eventos.
// NOTA: en la ruta primaria (bridge-direct) la deduplicacion ocurre a nivel
// del bridge (un solo push por turn-end), por lo que este codigo solo aplica
// al fallback via relay.

const MAX_DEDUPE_KEYS = 10_000;
const DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 dias

function isDuplicate(sessionId, turnId) {
  const key = `${sessionId}:${turnId}`;
  if (deliveredDedupeKeys.has(key)) return true;
  deliveredDedupeKeys.add(key);
  // IMPLEMENTADO: la ventana de dedupe + el registro de tokens se persisten de
  // forma atomica (temp+rename) a ~/.uxnan/relay-state.json y se recargan al
  // arranque via PushRegistry.load(). TTL 7d + cap 10k aplicados en memoria.
  return false;
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
  final String toolName;
  final String toolId;
  final Map<String, dynamic> input;
  final dynamic output;
  final bool isError;
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
  final SubagentState state;
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
