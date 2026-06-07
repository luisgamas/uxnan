# Uxnan — Arquitectura del Sistema y Modulos

> **Version:** 1.0.0
> **Fecha:** 2026-06-04
> **Estado:** Definicion inicial — documento de arquitectura tecnica
> **Plataformas objetivo:** Android (principal), iOS (principal)
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod

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

**Topologia 1 — Red local (LAN):**
```
[Movil] ──WebSocket LAN──→ [Bridge directo]
```
Cuando el movil y la PC estan en la misma red, la app puede conectarse directamente al bridge sin pasar por el relay. La conexion sigue siendo E2EE.

**Topologia 2 — Relay remoto (WAN):**
```
[Movil] ──WS E2EE──→ [Relay] ──WS E2EE──→ [Bridge]
```
Cuando el movil esta fuera de la red local. El relay retransmite envelopes cifrados opacos. No ve el contenido.

**Topologia 3 — Self-hosted relay:**
El usuario puede desplegar su propio relay en un VPS o servidor domestico, eliminando dependencia del relay oficial.

---

## 3. Agent Adapter — interfaz contractual

Todos los adaptadores deben implementar la interfaz `IAgentAdapter` en el Bridge:

```typescript
interface IAgentAdapter {
  // Identidad
  readonly agentId: string;          // "codex" | "opencode" | "claude-code" | "gemini-cli" | "pi-agent" | custom
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

  // Turns / conversacion
  startTurn(threadId: string, params: TurnParams): Promise<Turn>;
  sendTurn(threadId: string, content: TurnContent): Promise<TurnResult>;

  // Git
  gitStatus(cwd: string): Promise<GitRepoStatus>;
  gitDiff(cwd: string): Promise<GitDiff>;
  gitCommit(params: GitCommitParams): Promise<GitCommitResult>;
  gitPush(params: GitPushParams): Promise<GitPushResult>;
  gitPull(params: GitPullParams): Promise<GitPullResult>;
  gitCheckout(params: GitCheckoutParams): Promise<void>;
  gitCreateBranch(params: GitBranchParams): Promise<GitBranchResult>;
  gitCreateWorktree(params: GitWorktreeParams): Promise<GitWorktreeResult>;

  // Workspace
  readFile(path: string): Promise<FileContent>;
  readImage(path: string): Promise<ImageContent>;
  listWorkspace(cwd: string): Promise<WorkspaceListing>;
  captureCheckpoint(params: CheckpointParams): Promise<Checkpoint>;
  diffCheckpoint(checkpointId: string): Promise<CheckpointDiff>;
  applyCheckpoint(checkpointId: string): Promise<void>;
  applyPatchChanges(changes: PatchChange[]): Promise<ApplyResult>;

  // Auth (si aplica al agente)
  getAuthStatus(): Promise<AuthStatus>;
  startLogin(provider: string): Promise<LoginSession>;
  cancelLogin(sessionId: string): Promise<void>;
  logout(): Promise<void>;

  // Proyectos
  listProjects(): Promise<Project[]>;
  resolveProject(cwd: string): Promise<Project>;

  // Notificaciones
  registerPushToken(token: string, secret: string): Promise<void>;
  notifyCompletion(threadId: string, turnId: string): Promise<void>;
}

interface AgentCapabilities {
  supportsGit: boolean;
  supportsWorktrees: boolean;
  supportsCheckpoints: boolean;
  supportsVoice: boolean;
  supportsSubagents: boolean;
  supportsPlanMode: boolean;
  supportsMultipleProjects: boolean;
  supportsThreadFork: boolean;
  sessionsFormat: "jsonrpc" | "jsonl" | "sqlite" | "custom";
}
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
  final String title;
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
enum AgentId { codex, opencode, claudeCode, geminiCli, piAgent, custom }
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

```
lib/presentation/
├── screens/
│   ├── shell/
│   │   ├── app_shell_screen.dart         # scaffold raiz + nav
│   │   └── session_coordinator_screen.dart
│   ├── home/
│   │   ├── home_screen.dart              # estado vacio, banners
│   │   └── home_view_model.dart
│   ├── sidebar/
│   │   ├── sidebar_screen.dart           # lista threads, busqueda, proyectos
│   │   ├── thread_list_item.dart
│   │   └── sidebar_view_model.dart
│   ├── conversation/
│   │   ├── conversation_screen.dart      # pantalla de turno activa
│   │   ├── conversation_view_model.dart
│   │   ├── timeline/
│   │   │   ├── timeline_widget.dart
│   │   │   ├── timeline_reducer.dart
│   │   │   └── timeline_snapshot.dart
│   │   ├── messages/
│   │   │   ├── message_renderer.dart
│   │   │   ├── markdown_renderer.dart
│   │   │   ├── mermaid_renderer.dart
│   │   │   ├── code_block_widget.dart
│   │   │   ├── command_execution_card.dart
│   │   │   ├── approval_request_card.dart
│   │   │   ├── subagent_card.dart
│   │   │   ├── plan_mode_widget.dart
│   │   │   └── workspace_preview_widget.dart
│   │   ├── composer/
│   │   │   ├── composer_widget.dart
│   │   │   ├── attachment_picker.dart
│   │   │   ├── mention_autocomplete.dart
│   │   │   ├── file_autocomplete.dart
│   │   │   └── slash_command_menu.dart
│   │   ├── git/
│   │   │   ├── git_actions_toolbar.dart
│   │   │   ├── branch_selector_sheet.dart
│   │   │   ├── diff_viewer.dart
│   │   │   ├── revert_sheet.dart
│   │   │   └── worktree_handoff_overlay.dart
│   │   └── support/
│   │       ├── connection_recovery_card.dart
│   │       ├── error_card.dart
│   │       ├── status_sheet.dart
│   │       └── terminal_indicator.dart
│   ├── onboarding/
│   │   ├── onboarding_screen.dart
│   │   ├── welcome_page.dart
│   │   ├── features_page.dart
│   │   ├── install_step_page.dart
│   │   └── command_card_widget.dart
│   ├── pairing/
│   │   ├── qr_scanner_screen.dart
│   │   ├── manual_code_screen.dart
│   │   ├── pairing_validator.dart
│   │   └── update_prompt_dialog.dart
│   ├── devices/
│   │   ├── my_devices_screen.dart
│   │   └── device_card.dart
│   ├── settings/
│   │   ├── settings_screen.dart
│   │   ├── connection_settings.dart
│   │   ├── agent_settings.dart
│   │   ├── notification_settings.dart
│   │   └── about_screen.dart
│   ├── ssh_terminal/
│   │   ├── terminal_screen.dart
│   │   ├── connection_editor.dart
│   │   └── terminal_surface.dart
│   └── projects/
│       ├── projects_screen.dart
│       └── project_editor.dart
├── widgets/                              # componentes reutilizables
│   ├── uxnan_button.dart
│   ├── uxnan_badge.dart
│   ├── uxnan_card.dart
│   ├── connection_status_indicator.dart
│   ├── thread_status_badge.dart
│   └── adaptive_bottom_sheet.dart
└── theme/
    ├── uxnan_theme.dart
    ├── colors.dart
    ├── typography.dart
    └── spacing.dart
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

- **Markdown:** `flutter_markdown` — soportado Android + iOS. Renderer completo con soporte de syntax highlighting y bloques de codigo.
- **Mermaid:** renderizado via `flutter_inappwebview` con un HTML embebido que carga mermaid.js localmente. Ambas plataformas.
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

```
ManualCodeScreen
├── Campo de texto para codigo corto (6-8 caracteres)
├── POST al relay: GET /trusted-session/resolve?code=<code>
├── Recibe sessionId + macDeviceId + macIdentityPublicKey
├── Construye PairingPayload sintetico
└── Continua igual que QR bootstrap
```

#### 5.5.4 Estructuras de pairing

```dart
// PAIRING_QR_VERSION = 2
// Payload transportado en el QR como JSON codificado en Base64
class PairingPayload {
  final int v;                          // version del formato QR
  final String relay;                   // URL del relay: wss://...
  final String sessionId;               // UUID de sesion
  final String macDeviceId;             // ID del bridge en la PC
  final String macIdentityPublicKey;    // Ed25519 publica del bridge (hex)
  final int expiresAt;                  // Unix timestamp ms, TTL 5 min
  final String displayName;            // nombre visible de la Mac
}

// Persistido en SecureStore + base de datos local
class TrustedDevice {
  final String macDeviceId;
  final String displayName;
  final Uint8List macIdentityPublicKey;  // Ed25519, 32 bytes
  final String relayUrl;
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
// MyDevicesScreen → DeviceCard → CTA "Conectar"
SessionCoordinator.switchMac(device)
├── Desconecta sesion actual
├── Actualiza activeMac
└── Inicia nueva conexion con el TrustedDevice seleccionado
```

---

### 5.6 Modulo de timeline y turn handling

> ✅ **Dominio + datos implementados** (rama `uxnanmobile`): jerarquía sellada `MessageContent` (+ codec JSON con fallback `UnknownContent`) en `lib/domain/value_objects/message_content.dart`; entidades `Message`/`Turn`; `IMessageRepository` + `DriftMessageRepository` (§6.2 / §10.3); `MessageDeduplicator` (§5.6.5) y `TurnTimelineSnapshot` con reducer de streaming/reconciliación/paginación (§5.4.6). Todo con tests. ⏳ **Pendiente (FOR-DEV):** contenido avanzado (`approval`/`plan`/`subagent`), managers de aplicación (`ThreadManager` de timeline, `IncomingMessageProcessor`), y la **UI** (`ConversationScreen`, renderers, composer) — siguiente incremento, para revisión visual. Ver `uxnanmobile/FOR-DEV.md`.

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
- El auto-scroll esta activo mientras el usuario no haya scrolleado hacia arriba.
- Si el usuario scrollea durante streaming, el auto-scroll se pausa.
- Al completar el turno, si el usuario esta cerca del fondo, auto-scroll se reactiva.

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

```
uxnan-bridge/
├── package.json
├── index.js                        # export startBridge() como API publica
├── src/
│   ├── bridge.js                   # entrypoint del daemon, orquestacion
│   ├── daemon-state.js             # persiste config, pairing, status, logs
│   ├── secure-transport.js         # handshake E2EE, buffers de catch-up
│   ├── agent-transport.js          # canal request/response hacia el agente
│   ├── handler-router.js           # ruteo de metodos JSON-RPC a handlers
│   ├── bridge-status.js            # heartbeat y snapshots de estado
│   ├── qr.js                       # generacion de QR de pairing
│   ├── session-state.js            # estado de sesion relay
│   ├── secure-device-state.js      # identidad y trust del dispositivo
│   ├── session-jsonl-history.js    # fallback: leer historial de disco JSONL
│   ├── apply-patch-changes.js      # aplicar patches al workspace
│   ├── rollout-live-mirror.js      # espejo en vivo de eventos del runtime
│   ├── push-notification-tracker.js
│   ├── push-notification-completion-dedupe.js
│   ├── ios-app-compatibility.js    # compatibilidad bridge ↔ app movil
│   ├── package-version-status.js   # version del paquete npm
│   ├── bootstrap-agent.js          # bootstrap del CLI del agente
│   ├── agent-home.js               # resuelve rutas del home del agente
│   ├── account-status.js           # snapshot sanitizado de autenticacion
│   ├── adapters/
│   │   ├── codex-adapter.js        # OpenAI Codex CLI
│   │   ├── opencode-adapter.js     # OpenCode
│   │   ├── claude-code-adapter.js  # Claude Code CLI
│   │   ├── gemini-cli-adapter.js   # Gemini CLI
│   │   ├── pi-agent-adapter.js     # pi-agent
│   │   └── base-adapter.js         # clase base extensible
│   └── handlers/
│       ├── git-handler.js
│       ├── workspace-handler.js
│       ├── thread-context-handler.js
│       ├── project-handler.js
│       ├── desktop-handler.js
│       ├── notifications-handler.js
│       ├── voice-handler.js
│       └── account-handler.js
└── scripts/
    ├── install-service-macos.sh    # instala LaunchAgent en macOS
    ├── install-service-windows.ps1 # instala Windows Service
    └── install-service-linux.sh    # instala systemd unit en Linux
```

#### 5.8.3 Estado persistido del bridge

El bridge mantiene estado en `~/.uxnan/`:

```
~/.uxnan/
├── daemon-config.json              # configuracion general
├── pairing-session.json           # pairing y session payload
├── bridge-status.json             # heartbeat y estado
├── secure-device-state.json       # identidad Ed25519 del bridge
├── trusted-phones.json            # telefonos de confianza registrados
├── managed-worktrees.json         # worktrees administrados
├── push-state.json                # estado de push notifications
├── push-dedupe-keys.json          # claves de deduplicacion
└── logs/
    └── bridge-YYYY-MM-DD.log
```

#### 5.8.4 Autostart del bridge

- **macOS:** LaunchAgent en `~/Library/LaunchAgents/com.uxnan.bridge.plist`
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
async function handleGitStackedPublish({ cwd, message, remote, branch }) { ... }
```

#### 5.8.7 Workspace handler (bridge)

```javascript
// src/handlers/workspace-handler.js
async function handleReadFile({ path }) { ... }          // lee archivo del disco
async function handleReadImage({ path }) { ... }         // lee imagen, codifica base64
async function handleListWorkspace({ cwd }) { ... }      // lista archivos del proyecto
async function handleCaptureCheckpoint({ threadId }) { ... }
async function handleDiffCheckpoint({ checkpointId }) { ... }
async function handleApplyCheckpoint({ checkpointId }) { ... }
async function handleApplyPatchChanges({ changes }) { ... }
```

#### 5.8.8 Fallback JSONL (session-jsonl-history)

Cuando el runtime del agente no tiene datos frescos de `thread/turns/list`, el bridge lee directamente de los archivos JSONL de sesion en disco:

```javascript
// src/session-jsonl-history.js
// Parsea archivos JSONL de sesion por agente:
// - Codex: ~/.codex/sessions/<sessionId>.jsonl
// - Claude Code: ~/.claude-code/sessions/<sessionId>.jsonl
// - pi-agent: ~/.pi/agent/sessions/<sessionId>.jsonl
// - OpenCode: SQLite de OpenCode

async function readHistoryFromDisk(threadId, { cursor, limit }) {
  // Soporta paginacion por cursor y limit
  // Mantiene cache de paths de rollout por thread con TTL 60s
}
```

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

---

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
```

**Fase 1 — Bootstrap por QR (solo primera conexion):**

1. El bridge genera un par Ed25519: (`macIdentityPrivateKey`, `macIdentityPublicKey`)
2. El bridge publica QR con payload: `{ v, relay, sessionId, macDeviceId, macIdentityPublicKey, expiresAt, displayName }`
3. El telefono escanea el QR
4. El telefono genera su par Ed25519: (`phoneIdentityPrivateKey`, `phoneIdentityPublicKey`)
5. El telefono persiste `PhoneIdentity` y crea `TrustedDevice`

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
  ciphertext: "<base64 AES-256-GCM(plaintext, derivedKey, nonce)>",
  tag: "<base64 GCM auth tag 16 bytes>"
}
```

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

El relay es un servidor Node.js independiente del bridge. Su unico rol es retransmitir envelopes E2EE opacos y gestionar push notifications.

#### 5.10.1 Arquitectura del relay

```
Relay Server
├── HTTP Server (Express o http nativo)
│   ├── GET  /health                        → health check
│   ├── POST /push/register                 → registra token push de un device
│   ├── POST /push/notify                   → envia notificacion de completado
│   └── GET  /trusted-session/resolve       → resolucion de pairing por codigo corto
├── WebSocket Server (noServer mode)
│   ├── Upgrade HTTP → WS con rate limiting por IP
│   │   ├── Rate limits: HTTP 120/min, push 30/min, upgrade 60/min
│   │   └── Rechaza upgrades en paths no-relay
│   └── Routing de sesiones por sessionId
│       ├── Rol "mac" (bridge PC)
│       │   Headers: x-role, x-notification-secret, x-mac-device-id,
│       │            x-mac-identity-public-key, x-machine-name, x-pairing-code
│       └── Rol "iphone" (app movil)
│           Headers: x-role, x-session-id
├── Push Service
│   ├── Registro de device token por sesion
│   ├── Envio via APNs (iOS) o FCM (Android)
│   ├── Deduplicacion por dedupeKey + TTL
│   └── Persistencia de estado en archivo
└── APNs Client (iOS) / FCM Client (Android)
    ├── iOS: HTTP/2 + JWT firmado con teamId/keyId/privateKey
    └── Android: Firebase Admin SDK + service account
```

#### 5.10.2 Flujo de push notification

```
1. Agente completa un turno en la PC
2. Bridge detecta el evento de completado (rollout-live-mirror)
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

#### 5.10.3 Push en Android y iOS

```dart
// lib/infrastructure/platform/push_notification_adapter.dart
// Usa firebase_messaging para ambas plataformas:
// - Android: FCM direct
// - iOS: APNs via FCM gateway (o APNs directo si se prefiere)

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

#### 5.10.4 Deduplicacion de notificaciones

```javascript
// relay/push-notification-completion-dedupe.js
// Evita duplicados de notificacion cuando el relay reconecta o reemite eventos

const MAX_DEDUPE_KEYS = 10_000;
const DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 dias

function isDuplicate(sessionId, turnId) {
  const key = `${sessionId}:${turnId}`;
  if (deliveredDedupeKeys.has(key)) return true;
  deliveredDedupeKeys.add(key);
  // Persiste en archivo para sobrevivir reinicios
  persistDedupeState();
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

class CommandExecutionContent extends MessageContent {
  final String command;
  final String? output;
  final int? exitCode;
  final CommandStatus status;   // running | completed | error
}

class ApprovalContent extends MessageContent {
  final ApprovalRequest request;
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
