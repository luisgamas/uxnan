# Uxnan — Product Requirements Document (PRD) + Software Requirements Specification (SRS)

> **Versión:** 1.0.0  
> **Fecha:** 2026-06-03  
> **Estado:** Definición inicial — borrador técnico completo  
> **Plataformas objetivo:** Android (principal), iOS (principal)  
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod

---

## Tabla de contenidos

1. [Visión general del producto](#1-visión-general-del-producto)
2. [Contexto y motivación](#2-contexto-y-motivación)
3. [Arquitectura del sistema de extremo a extremo](#3-arquitectura-del-sistema-de-extremo-a-extremo)
4. [Agentes de codificación soportados](#4-agentes-de-codificación-soportados)
5. [Módulos del sistema](#5-módulos-del-sistema)
   - [5.1 Capa de dominio](#51-capa-de-dominio)
   - [5.2 Capa de servicios / aplicación](#52-capa-de-servicios--aplicación)
   - [5.3 Capa de infraestructura](#53-capa-de-infraestructura)
   - [5.4 Capa de UI / presentación](#54-capa-de-ui--presentación)
   - [5.5 Módulo de pairing y onboarding](#55-módulo-de-pairing-y-onboarding)
   - [5.6 Módulo de timeline y turn handling](#56-módulo-de-timeline-y-turn-handling)
   - [5.7 Módulo de integración Git](#57-módulo-de-integración-git)
   - [5.8 Bridge daemon local (PC)](#58-bridge-daemon-local-pc)
   - [5.9 Transporte seguro y mensajería E2EE](#59-transporte-seguro-y-mensajería-e2ee)
   - [5.10 Relay y notificaciones push](#510-relay-y-notificaciones-push)
6. [Contratos de comunicación](#6-contratos-de-comunicación)
7. [Paquetes Flutter recomendados](#7-paquetes-flutter-recomendados)
8. [Modelos de dominio](#8-modelos-de-dominio)
9. [Requisitos no funcionales](#9-requisitos-no-funcionales)
10. [Requisitos funcionales detallados por módulo](#10-requisitos-funcionales-detallados-por-módulo)
11. [Flujos críticos del sistema](#11-flujos-críticos-del-sistema)
12. [Estructura de directorios del proyecto Flutter](#12-estructura-de-directorios-del-proyecto-flutter)
13. [Bridge y relay — especificación técnica](#13-bridge-y-relay--especificación-técnica)
14. [Seguridad y criptografía](#14-seguridad-y-criptografía)
15. [Gestión de estado y persistencia](#15-gestión-de-estado-y-persistencia)
16. [Consideraciones de plataforma Android vs iOS](#16-consideraciones-de-plataforma-android-vs-ios)
17. [Criterios de aceptación y MVP](#17-criterios-de-aceptación-y-mvp)
18. [Glosario técnico](#18-glosario-técnico)

---

## 1. Visión general del producto

**Uxnan** es una aplicación móvil multiplataforma (Android e iOS) construida con Flutter que permite controlar remotamente sesiones de agentes de codificación con IA que corren en una PC (Windows, macOS o Linux). La app funciona como un cliente inteligente que se conecta a un daemon bridge local instalado en la PC del usuario, comunica operaciones a través de un canal WebSocket cifrado de extremo a extremo (E2EE), y expone al usuario una interfaz rica para gestionar conversaciones, threads, operaciones Git, el filesystem del workspace, terminal SSH, y notificaciones push.

### Diferenciadores clave

- **Multi-agente y multi-proveedor:** compatible con OpenAI Codex CLI, OpenCode, Claude Code, Gemini CLI, pi-agent y cualquier agente futuro que exponga una interfaz JSON-RPC o JSONL compatible.
- **Sin lock-in de proveedor:** el modelo de abstracción del bridge normaliza las diferencias de protocolo entre agentes.
- **Local-first y soberanía de datos:** el código, contexto y conversaciones nunca pasan por servidores de terceros. El relay solo retransmite envelopes cifrados opacos.
- **E2EE real:** el relay nunca ve el contenido en texto claro. La clave de sesión se deriva de un handshake X25519 + HKDF firmado con Ed25519.
- **Multi-proyecto:** el usuario puede tener N proyectos abiertos en la PC y navegar entre ellos desde la app.
- **Reconexión confiable:** buffer de outbound messages con replay por sequence number; la reconexión no pierde estado conversacional.
- **Android e iOS como ciudadanos de primera clase:** no existen features exclusivos de una plataforma sin un equivalente funcional en la otra.

### Nombre

**Uxnan** (pronunciado /uʃ.nan/) — nombre que no tiene ninguna relación ni derivación de ningún producto existente. Es el identificador definitivo y único de esta aplicación.

---

## 2. Contexto y motivación

### 2.1 Problema que resuelve

Los agentes de codificación modernos (OpenAI Codex CLI, Claude Code, OpenCode, Gemini CLI, pi-agent) corren en terminales de PC y son herramientas de alta productividad. Sin embargo, el desarrollador que se aleja de su escritorio pierde visibilidad y control sobre las tareas en curso.

No existe hoy una solución móvil multiplataforma, agnóstica a proveedor, que:
- Muestre el estado en tiempo real de sesiones de agentes activos en la PC.
- Permita continuar conversaciones y enviar nuevas instrucciones.
- Exponga operaciones Git, diffs, checkpoints y workspace desde el móvil.
- Funcione con cualquier agente, no solo uno en particular.
- Sea local-first con cifrado E2EE real.

### 2.2 Agentes de codificación modernos — panorama 2025-2026

La categoría de agentes de codificación CLI ha madurado significativamente:

- **OpenAI Codex CLI (2025):** agente de OpenAI para tareas de software engineering. Disponible vía CLI y app de escritorio para Windows/macOS. Expone `thread/*`, `git/*`, `workspace/*` como métodos JSON-RPC. Arquitectura local-first con app-server propio.
- **OpenCode (opencode.ai):** agente open-source con +160K GitHub stars y 7.5M desarrolladores mensuales. Arquitectura cliente/servidor donde el TUI es solo uno de los clientes posibles, diseñado explícitamente para que una app móvil pueda conectarse remotamente. Soporta múltiples LLM providers (Anthropic, OpenAI, Gemini, Bedrock, Groq, Azure, OpenRouter). Almacenamiento en SQLite.
- **Claude Code (Anthropic):** agente de codificación con arquitectura multi-dispositivo. Incluye un sistema Bridge de 33+ archivos para "Remote Control" vía WebSocket/HTTPS tunnel autenticado. Soporta subagentes, MCP, skills, hooks. Sessions vía JSONL append-only.
- **Gemini CLI (Google):** agente open-source bajo Apache 2.0, integrado con Gemini Code Assist. Usa bucle ReAct con herramientas built-in y servidores MCP locales/remotos. Expone output-format JSON y stream-json para integración programática.
- **pi-agent (earendil-works/pi):** agente minimalista con cuatro herramientas core (read, write, edit, bash). Tiene modo RPC con framing JSONL estricto, pensado para ser consumido por clientes externos. Soporta Anthropic, OpenAI, Google y otros. Sessions persistidas como JSONL en `~/.pi/agent/sessions/`.

### 2.3 Posicionamiento de Uxnan

Uxnan no es un agente. Es el **cliente móvil** que permite al desarrollador controlar los agentes que ya tiene instalados en su PC. La propuesta de valor no compite con los agentes; los complementa.

---

## 3. Arquitectura del sistema de extremo a extremo

### 3.1 Diagrama conceptual

```
┌──────────────────────────────────────────────────────────────────────┐
│                   Dispositivo móvil (Android / iOS)                  │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  ┌─────────────┐  │
│  │ Flutter UI  │→ │ SessionSvc   │→ │ Secure    │→ │ WebSocket   │  │
│  │ (Widgets)   │← │ (coordinator)│← │ Transport │← │ Transport   │  │
│  └─────────────┘  └──────────────┘  └───────────┘  └──────┬──────┘  │
└─────────────────────────────────────────────────────────┼──────────┘
                                                           │ E2EE
                                                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Relay Server (Node.js)                          │
│  ┌──────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ HTTP/WS  │  │ WebSocket   │  │ Push     │  │ Session          │  │
│  │ Server   │  │ Relay       │  │ Service  │  │ Management       │  │
│  └──────────┘  └──────┬──────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ WebSocket (E2EE opaque)
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│               Uxnan Bridge Daemon (PC: Win / macOS / Linux)          │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐   │
│  │ Secure   │  │ Agent      │  │ Handler    │  │ Daemon         │   │
│  │Transport │→ │ Transport  │→ │ Router     │→ │ State          │   │
│  └──────────┘  └────────────┘  └─────┬──────┘  └────────────────┘   │
│                                      │                               │
│          ┌─────────┬─────────┬───────┼───────┬─────────┐            │
│          ▼         ▼         ▼       ▼       ▼         ▼            │
│       ┌─────┐  ┌──────┐  ┌──────┐ ┌─────┐ ┌─────┐ ┌──────┐        │
│       │ Git │  │Work- │  │Desk- │ │Proj │ │Noti-│ │Thread│        │
│       │     │  │space │  │top   │ │ect  │ │fic. │ │Ctx   │        │
│       └──┬──┘  └──┬───┘  └──┬───┘ └──┬──┘ └──┬──┘ └──┬───┘        │
│          │        │         │        │       │        │             │
│          ▼        ▼         ▼        ▼       ▼        ▼             │
│       ┌──────────────────────────────────────────────────────┐      │
│       │    Agent Adapter (Codex / OpenCode / Claude Code /   │      │
│       │              Gemini CLI / pi-agent / custom)         │      │
│       └────────────────────────┬─────────────────────────────┘      │
│                                │                                     │
│       ┌────────────────────────▼─────────────────────────────┐      │
│       │        Filesystem / Git repos / Workspace / Sessions │      │
│       └──────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Componentes del sistema

| Componente | Tecnología | Rol |
|---|---|---|
| **App móvil Uxnan** | Flutter / Dart | Cliente móvil: UI, transporte, estado |
| **Uxnan Bridge** | Node.js daemon | Agente de control local en la PC |
| **Uxnan Relay** | Node.js HTTP/WS | Relay de transporte E2EE + push |
| **Agent Adapters** | Node.js | Adaptadores por agente (Codex, OpenCode, etc.) |

### 3.3 Topologías de conexión

**Topología 1 — Red local (LAN):**
```
[Móvil] ──WebSocket LAN──→ [Bridge directo]
```
Cuando el móvil y la PC están en la misma red, la app puede conectarse directamente al bridge sin pasar por el relay. La conexión sigue siendo E2EE.

**Topología 2 — Relay remoto (WAN):**
```
[Móvil] ──WS E2EE──→ [Relay] ──WS E2EE──→ [Bridge]
```
Cuando el móvil está fuera de la red local. El relay retransmite envelopes cifrados opacos. No ve el contenido.

**Topología 3 — Self-hosted relay:**
El usuario puede desplegar su propio relay en un VPS o servidor doméstico, eliminando dependencia del relay oficial.

---

## 4. Agentes de codificación soportados

### 4.1 Resumen de agentes

Uxnan no se acopla a un agente específico. El Bridge implementa un **Agent Adapter** por proveedor que normaliza las diferencias de protocolo y expone una interfaz JSON-RPC unificada hacia el móvil.

| Agente | Protocolo nativo | Adaptación requerida | Estado objetivo |
|---|---|---|---|
| **OpenAI Codex CLI** | JSON-RPC 2.0 sobre WebSocket | Ninguna (protocolo nativo de referencia) | Soporte completo |
| **OpenCode** | JSON-RPC / REST + cliente/servidor | Adaptación de sesiones SQLite | Soporte completo |
| **Claude Code** | JSON-RPC + JSONL append-only | Bridge HTTPS tunnel + JSONL reader | Soporte completo |
| **Gemini CLI** | ReAct + output-format stream-json | Adaptación de streaming ReAct | Soporte completo |
| **pi-agent** | JSONL RPC (LF-delimited) | Reader JSONL `~/.pi/agent/sessions/` | Soporte completo |
| **Custom / futuro** | — | Interfaz de adaptador extensible | Extensible |

### 4.2 Agent Adapter — interfaz contractual

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

  // Turns / conversación
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

### 4.3 Configuración de agente por proyecto

La app permite que cada proyecto/conexión especifique qué agente usa, cómo localizarlo y qué configuración tiene:

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

## 5. Módulos del sistema

### 5.1 Capa de dominio

**Ubicación en Flutter:** `lib/domain/`

La capa de dominio define el vocabulario del sistema. No depende de Flutter, de ningún paquete externo, ni de detalles de transporte, red o UI. Es Dart puro.

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
  final String agentId;  // qué agente maneja este thread
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
  final int orderIndex;          // contador monotónico para orden
  final String? fingerprint;     // para deduplicación
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
  final int bridgeOutboundSeq;     // último seq recibido del bridge
  final int phoneOutboundSeq;      // próximo seq a enviar
  final int keyEpoch;
  final HandshakeMode mode;        // qrBootstrap | trustedReconnect
  const SecureSession({...});
}

// lib/domain/entities/trusted_device.dart
class TrustedDevice {
  final String macDeviceId;
  final String displayName;
  final Uint8List macIdentityPublicKey;  // clave pública Ed25519 del bridge
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
class ConnectToBridge { ... }           // inicia conexión + handshake
class ReconnectIfNeeded { ... }         // reconnect automático
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
class LoadTurns { ... }                 // con paginación
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

### 5.2 Capa de servicios / aplicación

**Ubicación en Flutter:** `lib/application/`

Esta capa orquesta los use cases y coordina los estados de dominio. Es el equivalente funcional de `CodexService` en la implementación de referencia iOS, pero descompuesta en coordinadores especializados con responsabilidad única.

#### 5.2.1 SessionCoordinator

Núcleo de la sesión de conexión. Gestiona el ciclo de vida completo:

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
  void enqueueSend();                // si no hay conexión activa
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
  // Sincronización en background
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

**Ubicación en Flutter:** `lib/infrastructure/`

Implementaciones concretas de repositorios, adaptadores de transporte, almacenamiento y plugins de plataforma.

#### 5.3.1 WebSocket Transport

```dart
// lib/infrastructure/transport/websocket_transport.dart
class WebSocketTransport {
  // Gestión del canal
  Future<void> connect(String url, {Map<String, String>? headers});
  Future<void> disconnect();
  Future<void> send(Uint8List data);
  Stream<Uint8List> get incoming;
  Stream<TransportState> get stateChanges;

  // Selección de canal: web_socket_channel como backend
  // Soporta wss:// para relay remoto y ws:// para LAN directa
}
```

**Paquete:** `web_socket_channel` — soportado en Android e iOS. Canal único para ambas plataformas sin código nativo adicional.

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

  // Clasificación de mensajes de control
  SecureMessageKind classifyRaw(Uint8List data);
}
```

**Criptografía:** implementada con `pointycastle` (puro Dart) + llamadas nativas para operaciones críticas de rendimiento:
- En Android: Android Keystore / JCE para Ed25519 y X25519
- En iOS: Security framework / CryptoKit para Ed25519 y X25519
- Interoperabilidad garantizada por el protocolo definido en §14

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
// Android: no requiere permiso explícito para LAN WebSocket
// iOS: NSLocalNetworkUsageDescription en Info.plist + plugin
class LocalNetworkPermissionAdapter {
  Future<LocalNetworkPermissionStatus> getStatus();
  Future<LocalNetworkPermissionStatus> request();
  // iOS: usa un plugin nativo mínimo que hace un socket probe para triggear el popup
}

// Cámara / adjuntos de imagen
// image_picker — Android: Gallery/Camera, iOS: PhotoLibrary/Camera
class ImagePickerAdapter {
  Future<List<ImageAttachment>> pickImages({int? maxCount});
  Future<ImageAttachment?> pickFromCamera();
}

// Vibración / haptic feedback
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

### 5.4 Capa de UI / presentación

**Ubicación en Flutter:** `lib/presentation/`

La UI es un sistema de composición visual que materializa el estado de los coordinadores de aplicación. No contiene lógica de negocio. Usa Riverpod para reactividad.

#### 5.4.1 Estado global (Riverpod providers)

```dart
// lib/presentation/providers/
final sessionCoordinatorProvider = Provider<SessionCoordinator>(...);
final connectionPhaseProvider = StateNotifierProvider<..., ConnectionPhase>(...);
final activeMacProvider = StateNotifierProvider<..., TrustedDevice?>(...);
final activeThreadProvider = StateNotifierProvider<..., Thread?>(...);
final threadsProvider = StreamProvider<List<Thread>>(...);
final timelineProvider = FutureProvider.family<TurnTimelineSnapshot, String>(...);
final gitRepoStateProvider = StateNotifierProvider<..., GitRepoState?>(...);
final composerProvider = StateNotifierProvider<..., ComposerState>(...);
final authStatusProvider = FutureProvider.family<AuthStatus, String>(...);
final projectsProvider = StreamProvider<List<Project>>(...);
```

#### 5.4.2 Pantallas principales

```
lib/presentation/
├── screens/
│   ├── shell/
│   │   ├── app_shell_screen.dart         # scaffold raíz + nav
│   │   └── session_coordinator_screen.dart
│   ├── home/
│   │   ├── home_screen.dart              # estado vacío, banners
│   │   └── home_view_model.dart
│   ├── sidebar/
│   │   ├── sidebar_screen.dart           # lista threads, búsqueda, proyectos
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

#### 5.4.3 Navegación

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

#### 5.4.4 Gestión de estado UI

- **Riverpod** como solución de state management principal
- `StateNotifierProvider` para estado mutable complejo
- `StreamProvider` para streams reactivos (threads, mensajes)
- `FutureProvider` para carga asíncrona única
- `Provider` para servicios singleton inyectados

#### 5.4.5 Renderizado de mensajes

```dart
// lib/presentation/screens/conversation/messages/message_renderer.dart
// Selecciona el renderer correcto según el tipo de contenido del mensaje

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

#### 5.4.6 Timeline snapshot y reconciliación

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

- **Markdown:** `flutter_markdown` — soportado Android + iOS. Renderer completo con soporte de syntax highlighting y bloques de código.
- **Mermaid:** renderizado vía `flutter_inappwebview` con un HTML embebido que carga mermaid.js localmente. Ambas plataformas.
- **Code highlighting:** `flutter_highlight` — puro Dart.
- **Diff viewer:** widget nativo custom con renderizado de líneas añadidas/eliminadas.

---

### 5.5 Módulo de pairing y onboarding

**Objetivo:** llevar al usuario desde "app instalada" hasta "sesión segura activa" sin exponer detalles técnicos.

#### 5.5.1 Flujo de onboarding

```
OnboardingScreen
├── WelcomePage         → presentación del producto
├── FeaturesPage        → capacidades principales (multi-agente, E2EE, local-first)
├── InstallStepPage     → instrucciones de instalación del bridge en la PC
│   ├── macOS: npx uxnan-bridge
│   ├── Windows: npx uxnan-bridge
│   └── Linux: npx uxnan-bridge
└── PairingStep         → CTA hacia QRScannerScreen o ManualCodeScreen
```

#### 5.5.2 Flujo de pairing por QR

```
QrScannerScreen
├── Solicita permiso de cámara (CameraPermissionRequest)
├── Abre cámara con overlay de escaneo (MobileScannerWidget)
├── Detecta QR → extrae PairingPayload
├── PairingValidator.validate(payload)
│   ├── ¿versión del QR == PAIRING_QR_VERSION (2)?
│   ├── ¿expiresAt > DateTime.now()? (MAX_PAIRING_AGE = 5 min)
│   └── ¿campos obligatorios presentes?
├── Si bridge incompatible → UpdatePromptDialog
└── Si válido → SessionCoordinator.processPairingPayload(payload)
    └── Persiste TrustedDevice
    └── Inicia handshake QR bootstrap
    └── Navega a HomeScreen
```

#### 5.5.3 Flujo de pairing por código manual

```
ManualCodeScreen
├── Campo de texto para código corto (6-8 caracteres)
├── POST al relay: GET /trusted-session/resolve?code=<code>
├── Recibe sessionId + macDeviceId + macIdentityPublicKey
├── Construye PairingPayload sintético
└── Continúa igual que QR bootstrap
```

#### 5.5.4 Estructuras de pairing

```dart
// PAIRING_QR_VERSION = 2
// Payload transportado en el QR como JSON codificado en Base64
class PairingPayload {
  final int v;                          // versión del formato QR
  final String relay;                   // URL del relay: wss://...
  final String sessionId;               // UUID de sesión
  final String macDeviceId;             // ID del bridge en la PC
  final String macIdentityPublicKey;    // Ed25519 pública del bridge (hex)
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
  final Uint8List phoneIdentityPrivateKey; // Ed25519 propia del teléfono, 32 bytes
  final Uint8List phoneIdentityPublicKey;
  final DateTime pairedAt;
}

// Identidad del teléfono (generada una sola vez, persistida en SecureStore)
class PhoneIdentity {
  final String phoneDeviceId;            // UUID generado al instalar
  final Uint8List identityPrivateKey;   // Ed25519, 32 bytes
  final Uint8List identityPublicKey;    // Ed25519, 32 bytes
}
```

#### 5.5.5 Reconexión confiable (trusted reconnect)

Una vez que hay pairing establecido, las reconexiones siguientes no requieren reescanear el QR:

```
SessionCoordinator.connect()
├── Tiene TrustedDevice registrado? → Sí
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
├── Desconecta sesión actual
├── Actualiza activeMac
└── Inicia nueva conexión con el TrustedDevice seleccionado
```

---

### 5.6 Módulo de timeline y turn handling

**Objetivo:** presentar la conversación activa de forma reactiva, eficiente y con soporte completo para streaming, diffs, planes, subagentes y adjuntos.

#### 5.6.1 ConversationScreen

Pantalla operativa central. Se compone de:

```
ConversationScreen
├── AppBar
│   ├── título del thread
│   ├── estado de conexión (badge)
│   └── menú de acciones (Git toolbar, fork, share)
├── TimelineWidget
│   ├── ScrollController con auto-scroll al final en streaming
│   ├── TimelineItemList
│   │   └── Para cada TimelineItem → MessageRenderer
│   ├── Indicador de carga de historial anterior (pull-to-load-more)
│   └── ConnectionRecoveryCard (si desconectado)
├── ComposerWidget
│   ├── TextField expandible
│   ├── AttachmentRow (imágenes, archivos)
│   ├── AutocompleteOverlay (menciones, archivos, slash commands)
│   ├── SendButton (activo según canSend)
│   └── VoiceInputButton
└── Overlays y sheets:
    ├── GitActionsBottomSheet
    ├── StatusSheet (estado de sesión y agente)
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
// - Queue draft (si no hay conexión, se encola para envío al reconectar)
// - Draft persistence (DriftComposerDraftRepository)
```

#### 5.6.3 Streaming de mensajes

El bridge emite eventos de streaming que la app procesa incrementalmente:

```
IncomingMessageProcessor
→ MessageStreamEvent { turnId, delta, isComplete }
→ TimelineSnapshot.appendStreaming(event)
→ TimelineWidget reconstruye solo el último mensaje afectado
```

Reglas de streaming:
- El auto-scroll está activo mientras el usuario no haya scrolleado hacia arriba.
- Si el usuario scrollea durante streaming, el auto-scroll se pausa.
- Al completar el turno, si el usuario está cerca del fondo, auto-scroll se reactiva.

#### 5.6.4 Reconciliación de historial

```dart
// Paginación: al llegar al tope del scroll, carga historial anterior
TimelineWidget.onScrollToTop()
→ ThreadManager.loadMoreHistory(threadId)
→ SyncManager.reconcileHistory(threadId, cursor: currentCursor)
→ Bridge: thread/turns/list { threadId, cursor, limit: 20 }
→ TimelineSnapshot.prependHistory(turns)
→ Mantiene posición de scroll actual
```

#### 5.6.5 Deduplicación de mensajes

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

### 5.7 Módulo de integración Git

**Objetivo:** exponer operaciones Git reales del repositorio en la PC a través de una UI de producto que abstraiga la complejidad de Git.

#### 5.7.1 Toolbar Git en conversación

El toolbar Git se muestra en la parte inferior de la ConversationScreen y se adapta al estado del repo:

```
GitActionsBottomSheet
├── Estado del repo: branch, N ahead, N behind, N archivos modificados
├── Acciones disponibles según estado:
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
    ├── "La rama está protegida"
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

El sistema soporta worktrees administrados para separación de contextos:

```dart
// Crear worktree desde conversación
GitActionManager.createWorktree(GitWorktreeParams(
  branch: 'feature/my-feature',
  path: '/projects/backend/.worktrees/feature-my-feature',
  managed: true,        // el bridge lo administra y limpia automáticamente
))
```

El bridge (en el daemon) mantiene un registro de worktrees administrados (`~/.uxnan/managed-worktrees.json`) y los limpia cuando el thread asociado se cierra.

#### 5.7.4 Diff viewer

```dart
// lib/presentation/screens/conversation/git/diff_viewer.dart
// Renderiza diffs con:
// - Líneas añadidas (verde)
// - Líneas eliminadas (rojo)
// - Contexto (sin cambios, gris)
// - Header de hunk (@@ -N,M +N,M @@)
// - Nombre de archivo y resumen de cambios
// - Scroll horizontal para líneas largas
```

#### 5.7.5 Revert de cambios del asistente

```dart
// RevertSheet permite deshacer cambios que el agente aplicó al workspace
// Se accede desde el toolbar Git o desde un mensaje del asistente con cambios
RevertSheet
├── Lista de archivos afectados con preview del diff
├── Selección individual de archivos a revertir
├── CTA "Revertir selección"
└── Confirmación antes de ejecutar
```

---

### 5.8 Bridge daemon local (PC)

**Ubicación:** paquete npm independiente `uxnan-bridge`  
**Tecnología:** Node.js  
**Plataformas PC:** Windows, macOS, Linux

El bridge es el componente que corre en la PC del usuario y actúa como el plano de control local. No es parte de la app Flutter, pero su especificación está aquí porque la app móvil depende de su API.

#### 5.8.1 Responsabilidades del bridge

1. Arrancar y mantener el runtime del agente local (Codex, OpenCode, etc.)
2. Publicar el QR de pairing y resolver sesiones de conexión
3. Mantener conexión con el relay vía WebSocket
4. Registrar handlers de métodos JSON-RPC por dominio
5. Ejecutar Git localmente mediante `child_process`
6. Gestionar workspace, checkpoints y archivos
7. Mantener estado daemon en `~/.uxnan/` (fuera del repo del proyecto)
8. Vigilar rollout/versiones y compatibilidad
9. Sanitizar payloads: nunca exponer tokens o secretos al móvil
10. Buffer de outbound messages para reconexión sin pérdida

#### 5.8.2 Entrypoint y estructura de archivos del bridge

```
uxnan-bridge/
├── package.json
├── index.js                        # export startBridge() como API pública
├── src/
│   ├── bridge.js                   # entrypoint del daemon, orquestación
│   ├── daemon-state.js             # persiste config, pairing, status, logs
│   ├── secure-transport.js         # handshake E2EE, buffers de catch-up
│   ├── agent-transport.js          # canal request/response hacia el agente
│   ├── handler-router.js           # ruteo de métodos JSON-RPC a handlers
│   ├── bridge-status.js            # heartbeat y snapshots de estado
│   ├── qr.js                       # generación de QR de pairing
│   ├── session-state.js            # estado de sesión relay
│   ├── secure-device-state.js      # identidad y trust del dispositivo
│   ├── session-jsonl-history.js    # fallback: leer historial de disco JSONL
│   ├── apply-patch-changes.js      # aplicar patches al workspace
│   ├── rollout-live-mirror.js      # espejo en vivo de eventos del runtime
│   ├── push-notification-tracker.js
│   ├── push-notification-completion-dedupe.js
│   ├── ios-app-compatibility.js    # compatibilidad bridge ↔ app móvil
│   ├── package-version-status.js   # versión del paquete npm
│   ├── bootstrap-agent.js          # bootstrap del CLI del agente
│   ├── agent-home.js               # resuelve rutas del home del agente
│   ├── account-status.js           # snapshot sanitizado de autenticación
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
├── daemon-config.json              # configuración general
├── pairing-session.json           # pairing y session payload
├── bridge-status.json             # heartbeat y estado
├── secure-device-state.json       # identidad Ed25519 del bridge
├── trusted-phones.json            # teléfonos de confianza registrados
├── managed-worktrees.json         # worktrees administrados
├── push-state.json                # estado de push notifications
├── push-dedupe-keys.json          # claves de deduplilcación
└── logs/
    └── bridge-YYYY-MM-DD.log
```

#### 5.8.4 Autostart del bridge

- **macOS:** LaunchAgent en `~/Library/LaunchAgents/com.uxnan.bridge.plist`
- **Windows:** Windows Service o Task Scheduler via PowerShell
- **Linux:** systemd user unit en `~/.config/systemd/user/uxnan-bridge.service`

#### 5.8.5 Protocolo de instalación del bridge

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
// Ejecuta comandos Git localmente vía child_process.execFile/spawn
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

Cuando el runtime del agente no tiene datos frescos de `thread/turns/list`, el bridge lee directamente de los archivos JSONL de sesión en disco:

```javascript
// src/session-jsonl-history.js
// Parsea archivos JSONL de sesión por agente:
// - Codex: ~/.codex/sessions/<sessionId>.jsonl
// - Claude Code: ~/.claude-code/sessions/<sessionId>.jsonl
// - pi-agent: ~/.pi/agent/sessions/<sessionId>.jsonl
// - OpenCode: SQLite de OpenCode

async function readHistoryFromDisk(threadId, { cursor, limit }) {
  // Soporta paginación por cursor y limit
  // Mantiene cache de paths de rollout por thread con TTL 60s
}
```

#### 5.8.9 Account status sanitizado

```javascript
// src/account-status.js
// NUNCA expone tokens al teléfono
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

### 5.9 Transporte seguro y mensajería E2EE

El transporte seguro es la capa más crítica del sistema. Garantiza que el relay nunca vea el contenido de los mensajes en texto claro.

#### 5.9.1 Protocolo de handshake completo

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

**Fase 1 — Bootstrap por QR (solo primera conexión):**

1. El bridge genera un par Ed25519: (`macIdentityPrivateKey`, `macIdentityPublicKey`)
2. El bridge publica QR con payload: `{ v, relay, sessionId, macDeviceId, macIdentityPublicKey, expiresAt, displayName }`
3. El teléfono escanea el QR
4. El teléfono genera su par Ed25519: (`phoneIdentityPrivateKey`, `phoneIdentityPublicKey`)
5. El teléfono persiste `PhoneIdentity` y crea `TrustedDevice`

**Fase 2 — Handshake criptográfico:**

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

**Derivación de clave simétrica:**

```
sharedSecret = X25519(phoneEphemeralPrivateKey, macEphemeralPublicKey)
             = X25519(macEphemeralPrivateKey, phoneEphemeralPublicKey)  # misma

salt = clientNonce || serverNonce
derivedKey = HKDF-SHA256(sharedSecret, salt, info="uxnan-e2ee-v1", length=32)
```

**Fase 3 — Tráfico cifrado (AES-256-GCM):**

```
SecureEnvelope = {
  kind: "encryptedEnvelope",
  sessionId: "<uuid>",
  seq: <integer monotónico>,
  nonce: "<hex 12 bytes random por mensaje>",
  ciphertext: "<base64 AES-256-GCM(plaintext, derivedKey, nonce)>",
  tag: "<base64 GCM auth tag 16 bytes>"
}
```

**Trusted Reconnect:**
- Usa `handshakeMode: "trusted_reconnect"`
- El bridge tiene `phoneIdentityPublicKey` persistido en `trusted-phones.json`
- El teléfono tiene `macIdentityPublicKey` persistido en `TrustedDevice`
- Flujo idéntico al handshake pero verificando contra registros existentes

#### 5.9.2 Outbound buffer y catch-up

```javascript
// Bridge side:
MAX_BRIDGE_OUTBOUND_MESSAGES = 500
MAX_BRIDGE_OUTBOUND_BYTES = 10 MB

// Cada mensaje enviado por el bridge tiene seq = bridgeOutboundSeq++
// Al reconectar, el teléfono envía en el handshake:
// resumeState: { lastAppliedBridgeOutboundSeq: N }
// El bridge reenvía solo mensajes con seq > N

// Teléfono side: mantiene phoneOutboundSeq++ para mensajes que envía al bridge
```

#### 5.9.3 Selección de canal de transporte

```dart
// lib/infrastructure/transport/transport_selector.dart
class TransportSelector {
  // Orden de preferencia:
  // 1. WebSocket directo LAN (si bridge detectable en red local)
  // 2. WebSocket vía relay (WAN)
  // En ambos casos, la semántica E2EE es idéntica

  Future<WebSocketTransport> select(TrustedDevice device) async {
    // Intenta LAN primero con timeout de 2 segundos
    final lan = await _tryLan(device);
    if (lan != null) return lan;
    return _createRelayTransport(device);
  }
}
```

#### 5.9.4 Correlación de requests

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

El relay es un servidor Node.js independiente del bridge. Su único rol es retransmitir envelopes E2EE opacos y gestionar push notifications.

#### 5.10.1 Arquitectura del relay

```
Relay Server
├── HTTP Server (Express o http nativo)
│   ├── GET  /health                        → health check
│   ├── POST /push/register                 → registra token push de un device
│   ├── POST /push/notify                   → envía notificación de completado
│   └── GET  /trusted-session/resolve       → resolución de pairing por código corto
├── WebSocket Server (noServer mode)
│   ├── Upgrade HTTP → WS con rate limiting por IP
│   │   ├── Rate limits: HTTP 120/min, push 30/min, upgrade 60/min
│   │   └── Rechaza upgrades en paths no-relay
│   └── Routing de sesiones por sessionId
│       ├── Rol "mac" (bridge PC)
│       │   Headers: x-role, x-notification-secret, x-mac-device-id,
│       │            x-mac-identity-public-key, x-machine-name, x-pairing-code
│       └── Rol "iphone" (app móvil)
│           Headers: x-role, x-session-id
├── Push Service
│   ├── Registro de device token por sesión
│   ├── Envío vía APNs (iOS) o FCM (Android)
│   ├── Deduplicación por dedupeKey + TTL
│   └── Persistencia de estado en archivo
└── APNs Client (iOS) / FCM Client (Android)
    ├── iOS: HTTP/2 + JWT firmado con teamId/keyId/privateKey
    └── Android: Firebase Admin SDK + service account
```

#### 5.10.2 Flujo de push notification

```
1. Agente completa un turno en la PC
2. Bridge detecta el evento de completado (rollout-live-mirror)
3. Bridge verifica push-notification-tracker: ¿notificar?
4. Bridge verifica push-notification-completion-dedupe: ¿ya enviado?
5. Bridge → Relay: POST /push/notify
   Body: { sessionId, notificationSecret, threadId, turnId, title, body }
6. Relay valida notificationSecret contra sesión autenticada del mac
7. Relay construye payload APNs/FCM:
   { aps: { alert: { title, body }, sound: "default" },
     data: { threadId, turnId } }
8. Relay envía a APNs (iOS) o FCM (Android)
9. App móvil recibe push → navega al thread correspondiente
```

#### 5.10.3 Push en Android y iOS

```dart
// lib/infrastructure/platform/push_notification_adapter.dart
// Usa firebase_messaging para ambas plataformas:
// - Android: FCM direct
// - iOS: APNs via FCM gateway (o APNs directo si se prefiere)

class PushNotificationAdapter {
  // Inicialización
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

#### 5.10.4 Deduplicación de notificaciones

```javascript
// relay/push-notification-completion-dedupe.js
// Evita duplicados de notificación cuando el relay reconecta o reemite eventos

const MAX_DEDUPE_KEYS = 10_000;
const DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 días

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

## 6. Contratos de comunicación

Toda la comunicación entre la app móvil y el bridge usa **JSON-RPC 2.0** sobre WebSocket, dentro de envelopes E2EE.

### 6.1 Formato base

```json
// Request
{ "jsonrpc": "2.0", "id": "uuid-or-int", "method": "namespace/action", "params": { ... } }

// Response exitosa
{ "jsonrpc": "2.0", "id": "uuid-or-int", "result": { ... } }

// Response con error
{ "jsonrpc": "2.0", "id": "uuid-or-int", "error": { "code": -32000, "message": "...", "data": { ... } } }

// Notificación (sin id, unidireccional del bridge al móvil)
{ "jsonrpc": "2.0", "method": "namespace/event", "params": { ... } }
```

### 6.2 Métodos JSON-RPC completos

#### Handshake y sesión
```
initialize              → handshake inicial con el app-server del agente
initialized             → confirmación de handshake
bridge/status           → snapshot de estado del bridge
bridge/version          → versión del bridge y capacidades
```

#### Threads
```
thread/list             → lista de threads, con filtro opcional por proyecto
thread/read             → datos de un thread específico
thread/resume           → reanudar thread existente
thread/turns/list       → turnos de un thread, con paginación por cursor
thread/start            → iniciar nuevo thread
thread/turn/start       → iniciar nuevo turno en un thread
thread/fork             → hacer fork de un thread
turn/send               → enviar contenido a un turno activo
turn/cancel             → cancelar turno en curso
```

#### Git
```
git/status              → estado del repositorio
git/diff                → diff completo del workspace
git/commit              → hacer commit con mensaje
git/push                → push a remote
git/pull                → pull desde remote
git/checkout            → checkout de rama
git/branch/create       → crear nueva rama
git/worktree/create     → crear worktree
git/worktree/managed/create   → crear worktree administrado
git/stacked/publish     → flujo encadenado commit+push+[PR]
git/revert              → revertir cambios del asistente
```

#### Workspace
```
workspace/file/read              → leer archivo del workspace
workspace/image/read             → leer imagen del workspace (base64)
workspace/list                   → listar archivos del cwd
workspace/checkpoint/capture     → capturar checkpoint del estado actual
workspace/checkpoint/preview     → preview de un checkpoint
workspace/checkpoint/diff        → diff de un checkpoint
workspace/checkpoint/apply       → aplicar un checkpoint
workspace/patch/apply            → aplicar lista de cambios de patch
```

#### Auth / cuenta
```
account/read            → leer estado de cuenta del agente
account/login/start     → iniciar flujo de login
account/login/cancel    → cancelar login en progreso
account/logout          → cerrar sesión del agente
getAuthStatus           → snapshot sanitizado de autenticación
```

#### Proyectos
```
project/list            → lista de proyectos configurados
project/resolve         → resolver proyecto por cwd
project/add             → agregar proyecto a la configuración
project/remove          → remover proyecto
```

#### Notificaciones
```
notifications/register          → registrar token push de la app
notifications/update            → actualizar preferencias de notificación
notifications/unregister        → desregistrar el dispositivo
```

#### Desktop / integración
```
desktop/refresh         → refrescar la UI de escritorio del agente
desktop/open            → abrir URL o app en el desktop
desktop/focus           → traer ventana del agente al frente
```

#### Streaming (notificaciones del bridge al móvil)
```
stream/message/delta           → delta de streaming de texto del asistente
stream/turn/started            → turno iniciado
stream/turn/completed          → turno completado
stream/turn/error              → turno con error
stream/turn/aborted            → turno cancelado
stream/git/progress            → progreso de acción Git
stream/plan/updated            → actualización de plan mode
stream/subagent/updated        → actualización de subagente
stream/approval/requested      → solicitud de aprobación
stream/connection/state        → cambio de estado de conexión
stream/workspace/updated       → cambio en el workspace
stream/auth/updated            → cambio en estado de autenticación
```

### 6.3 Errores JSON-RPC estándar

| Código | Significado |
|---|---|
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32000` | Bridge error genérico |
| `-32001` | Authentication required |
| `-32002` | Agent not running |
| `-32003` | Git operation failed |
| `-32004` | Workspace access denied |
| `-32005` | Bridge version incompatible |
| `-32006` | Session expired |
| `-32007` | Confirmation required |
| `-32008` | Resource not found |

---

## 7. Paquetes Flutter recomendados

Todos los paquetes listados son compatibles con Android e iOS. Se priorizan los de mayor mantenimiento activo, mayor número de stars y mejor score en pub.dev.

### 7.1 Estado y DI

| Paquete | Versión mín. | Rol | Notas |
|---|---|---|---|
| `riverpod` / `flutter_riverpod` | ^2.5.0 | State management | Con `riverpod_annotation` + `riverpod_generator` para código generado |
| `riverpod_annotation` | ^2.3.0 | Anotaciones para code gen | |
| `riverpod_generator` | ^2.4.0 | Generador de código | |

### 7.2 Navegación

| Paquete | Versión mín. | Rol |
|---|---|---|
| `go_router` | ^14.0.0 | Navegación declarativa, deep links, redirect guards |

### 7.3 Red y WebSocket

| Paquete | Versión mín. | Rol |
|---|---|---|
| `web_socket_channel` | ^3.0.0 | WebSocket client (Android + iOS, puro Dart) |
| `dio` | ^5.4.0 | HTTP client para endpoints del relay (REST) |
| `connectivity_plus` | ^6.0.0 | Detección de cambios de conectividad de red |

### 7.4 Almacenamiento

| Paquete | Versión mín. | Rol |
|---|---|---|
| `drift` | ^2.18.0 | ORM SQLite, type-safe, Android + iOS |
| `drift_flutter` | ^0.1.0 | Adapter de drift para Flutter |
| `flutter_secure_storage` | ^9.2.0 | Keychain (iOS) / EncryptedSharedPreferences (Android) |
| `shared_preferences` | ^2.3.0 | Preferencias no-sensibles (flags, configuración UI) |
| `path_provider` | ^2.1.0 | Directorios de app en disco |

### 7.5 Criptografía

| Paquete | Versión mín. | Rol |
|---|---|---|
| `pointycastle` | ^3.9.0 | AES-256-GCM, HKDF, SHA-256 — puro Dart |
| `cryptography` | ^2.7.0 | X25519, Ed25519, HKDF — con fallback nativo |
| `cryptography_flutter` | ^2.3.0 | Aceleración nativa de cryptography en iOS y Android |

La combinación `cryptography` + `cryptography_flutter` usa:
- iOS: CryptoKit (Swift) para X25519 y Ed25519
- Android: Android Keystore / JCE

### 7.6 UI y componentes visuales

| Paquete | Versión mín. | Rol |
|---|---|---|
| `flutter_markdown` | ^0.7.3 | Rendering de Markdown con syntax highlighting |
| `flutter_highlight` | ^0.7.0 | Syntax highlighting para bloques de código |
| `flutter_inappwebview` | ^6.0.0 | WebView para Mermaid diagrams |
| `cached_network_image` | ^3.3.0 | Cache de imágenes |
| `shimmer` | ^3.0.0 | Esqueletos de carga |
| `lottie` | ^3.1.0 | Animaciones Lottie (onboarding, estados) |

### 7.7 Cámara y QR

| Paquete | Versión mín. | Rol |
|---|---|---|
| `mobile_scanner` | ^5.1.0 | QR scanner — Android: CameraX/MLKit; iOS: AVFoundation/Apple Vision |

### 7.8 Permisos y plataforma

| Paquete | Versión mín. | Rol |
|---|---|---|
| `permission_handler` | ^11.3.0 | Permisos unificados (cámara, notificaciones, micrófono) |
| `image_picker` | ^1.1.0 | Selección de imagen de galería/cámara |
| `file_picker` | ^8.0.0 | Selección de archivos genéricos |

### 7.9 Notificaciones

| Paquete | Versión mín. | Rol |
|---|---|---|
| `firebase_core` | ^3.6.0 | Core de Firebase |
| `firebase_messaging` | ^15.1.0 | FCM (Android) + APNs via FCM (iOS) |
| `flutter_local_notifications` | ^17.2.0 | Notificaciones locales, badges, foreground notifications |

### 7.10 SSH Terminal

| Paquete | Versión mín. | Rol |
|---|---|---|
| `dartssh2` | ^2.9.0 | Cliente SSH puro Dart, Android + iOS |
| `xterm` | ^4.2.0 | Emulador de terminal para la UI del SSH |

### 7.11 Utilidades

| Paquete | Versión mín. | Rol |
|---|---|---|
| `uuid` | ^4.4.0 | Generación de UUIDs |
| `equatable` | ^2.0.5 | Comparación estructural de objetos de dominio |
| `freezed` | ^2.5.0 | Clases inmutables con code generation |
| `freezed_annotation` | ^2.4.0 | Anotaciones de freezed |
| `json_annotation` | ^4.9.0 | Serialización JSON |
| `json_serializable` | ^6.8.0 | Generador de código JSON |
| `intl` | ^0.19.0 | Internacionalización y formateo de fechas |
| `collection` | ^1.18.0 | Colecciones útiles (DeepCollectionEquality, etc.) |
| `async` | ^2.11.0 | StreamController, StreamSink helpers |
| `rxdart` | ^0.28.0 | Streams reactivos (debounce, distinctUnique) |
| `vibration` | ^2.0.0 | Haptic feedback en Android e iOS |
| `logger` | ^2.4.0 | Logging estructurado |

### 7.12 Puentes nativos necesarios (plugins personalizados)

| Plugin | Plataforma | Motivo |
|---|---|---|
| `uxnan_local_network` | iOS | Trigger del popup de permiso de red local (NSLocalNetworkUsageDescription) — API privada de iOS que requiere un socket probe |
| `uxnan_local_network` | Android | No necesario: Android no requiere permiso explícito para LAN WebSocket |
| `uxnan_secure_handshake` | iOS | Si se requiere usar Security framework directamente para Ed25519 sin overhead |
| `uxnan_secure_handshake` | Android | Si se requiere usar Android Keystore directamente |

---

## 8. Modelos de dominio

### 8.1 Mapa completo de modelos

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

### 8.2 MessageContent — tipos soportados

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

### 8.3 AiChangeSet

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

## 9. Requisitos no funcionales

### 9.1 Rendimiento

| Requisito | Valor objetivo |
|---|---|
| Tiempo de arranque de la app (cold start) | < 2 segundos |
| Tiempo de establecimiento de conexión E2EE (LAN) | < 500 ms |
| Tiempo de establecimiento de conexión E2EE (relay WAN) | < 2 segundos |
| Latencia de mensaje en conversación (LAN) | < 50 ms |
| Latencia de mensaje en conversación (relay WAN) | < 200 ms |
| Renderizado de timeline con 100 mensajes | < 16 ms por frame |
| Tiempo de render inicial de markdown (500 chars) | < 8 ms |
| Tamaño máximo de mensaje WebSocket | 1 MB |

### 9.2 Seguridad

| Requisito | Especificación |
|---|---|
| Cifrado de transporte | AES-256-GCM con clave derivada vía X25519 + HKDF-SHA256 |
| Autenticación | Ed25519 bilateral en el handshake |
| Almacenamiento de claves | Keychain en iOS, EncryptedSharedPreferences + Keystore en Android |
| Expiración de QR | 5 minutos (`MAX_PAIRING_AGE_MS`) |
| Tolerancia de clock skew | 60 segundos (90 para trusted reconnect) |
| Tamaño máximo del buffer de outbound | 500 mensajes / 10 MB |
| El relay no accede al contenido | Garantizado: solo retransmite envelopes cifrados opacos |
| Sanitización de tokens | El bridge nunca expone API keys o tokens al móvil |

### 9.3 Disponibilidad

| Requisito | Especificación |
|---|---|
| Reconexión automática | Sí, con backoff exponencial (1s, 2s, 4s, 8s, 16s, max 60s) |
| Reconexión sin pérdida de mensajes | Sí, mediante buffer de outbound + seq counter |
| Funcionamiento sin relay (LAN directa) | Sí, topología 1 |
| Funcionamiento sin conexión (offline) | Parcial: lectura de historial local cacheado; sin envío |
| Persistencia local del historial | Sí, en SQLite vía drift |

### 9.4 Compatibilidad

| Requisito | Especificación |
|---|---|
| Android mínimo | API 24 (Android 7.0) |
| iOS mínimo | iOS 15.0 |
| Arquitecturas Android | arm64-v8a, armeabi-v7a, x86_64 |
| Arquitecturas iOS | arm64 (device), x86_64 (simulator) |
| Flutter mínimo | 3.22.0 (Dart 3.4+) |

### 9.5 Internacionalización

- La app debe soportar como mínimo Español e Inglés en el lanzamiento inicial.
- Usar `flutter_localizations` + `intl` con archivos `.arb`.
- Todas las cadenas visibles deben estar externalizadas.

### 9.6 Accesibilidad

- Cumplimiento de WCAG 2.1 nivel AA.
- Etiquetas semánticas en todos los widgets interactivos.
- Soporte de tamaños de texto del sistema (Dynamic Type en iOS, Font Scale en Android).
- Contraste de colores mínimo 4.5:1 en texto normal.

### 9.7 Privacidad

- Ningún dato del usuario (código, conversaciones, proyectos) pasa por servidores de Uxnan.
- El relay solo ve sessionId, tamaño de mensaje, timestamps y tokens push cifrados.
- Declaración de privacidad en la app explica el flujo de datos.
- No hay analytics, telemetría ni tracking de comportamiento por defecto.

---

## 10. Requisitos funcionales detallados por módulo

### 10.1 RF-CONN: Conexión y sesión

| ID | Requisito |
|---|---|
| RF-CONN-01 | La app debe mantener como máximo una conexión activa al mismo tiempo |
| RF-CONN-02 | La app debe seleccionar automáticamente el canal (LAN vs relay) |
| RF-CONN-03 | La app debe ejecutar el handshake E2EE antes de enviar cualquier payload JSON-RPC |
| RF-CONN-04 | La app debe reconectarse automáticamente con backoff exponencial al perder conexión |
| RF-CONN-05 | La app debe recuperar mensajes perdidos durante reconexión mediante el buffer de outbound del bridge |
| RF-CONN-06 | El usuario debe poder ver el estado de conexión en tiempo real (indicador en AppBar) |
| RF-CONN-07 | El usuario debe poder forzar una reconexión manual |
| RF-CONN-08 | La app debe detectar cuando el bridge tiene una versión incompatible y mostrar prompt de actualización |
| RF-CONN-09 | Las requests pendientes deben tener timeout de 30 segundos y retornar error tipado |
| RF-CONN-10 | La desconexión debe retornar todas las continuations pendientes con error |

### 10.2 RF-PAIR: Pairing y dispositivos

| ID | Requisito |
|---|---|
| RF-PAIR-01 | La app debe soportar pairing por QR code con validación de payload |
| RF-PAIR-02 | La app debe soportar pairing por código manual corto (6-8 caracteres) |
| RF-PAIR-03 | El QR tiene un TTL de 5 minutos y debe ser rechazado si está expirado |
| RF-PAIR-04 | El usuario puede registrar múltiples Macs de confianza |
| RF-PAIR-05 | El usuario puede cambiar entre Macs de confianza desde la pantalla de dispositivos |
| RF-PAIR-06 | El usuario puede eliminar un dispositivo de confianza |
| RF-PAIR-07 | La trusted reconnect no requiere reescanear el QR |
| RF-PAIR-08 | La identidad del teléfono (Ed25519) debe generarse una sola vez y persistirse de forma segura |

### 10.3 RF-THREAD: Threads y conversación

| ID | Requisito |
|---|---|
| RF-THREAD-01 | El usuario puede ver la lista de todos los threads, agrupados por proyecto |
| RF-THREAD-02 | El usuario puede buscar threads por nombre o contenido |
| RF-THREAD-03 | El usuario puede iniciar un nuevo thread en cualquier proyecto configurado |
| RF-THREAD-04 | El usuario puede continuar un thread existente |
| RF-THREAD-05 | El usuario puede hacer fork de un thread en un nuevo branch/worktree |
| RF-THREAD-06 | El historial de mensajes se pagina (20 turnos por página, carga al scrollear arriba) |
| RF-THREAD-07 | El estado de streaming se refleja en tiempo real en la timeline |
| RF-THREAD-08 | Los mensajes en streaming se muestran de forma incremental (delta rendering) |
| RF-THREAD-09 | Los mensajes duplicados (replay del bridge) deben ser deduplicados silenciosamente |
| RF-THREAD-10 | El estado de la conversación persiste localmente para acceso offline |

### 10.4 RF-COMP: Composer

| ID | Requisito |
|---|---|
| RF-COMP-01 | El composer soporta texto multilínea |
| RF-COMP-02 | El composer soporta adjuntos de imagen (galería y cámara) |
| RF-COMP-03 | El composer soporta autocompletado de archivos del workspace (filtrado por nombre parcial) |
| RF-COMP-04 | El composer soporta menciones (@archivo, @proyecto) |
| RF-COMP-05 | El composer soporta slash commands (/fork, /new, /status) |
| RF-COMP-06 | El draft se persiste automáticamente por thread |
| RF-COMP-07 | Si no hay conexión, el send se encola y se ejecuta al reconectar |
| RF-COMP-08 | El usuario puede seleccionar el tier de servicio y el esfuerzo de razonamiento |

### 10.5 RF-GIT: Integración Git

| ID | Requisito |
|---|---|
| RF-GIT-01 | El usuario puede ver el estado del repo (branch, ahead/behind, archivos modificados) |
| RF-GIT-02 | El usuario puede ver el diff completo del workspace |
| RF-GIT-03 | El usuario puede hacer commit con mensaje personalizado |
| RF-GIT-04 | El usuario puede hacer push a remote |
| RF-GIT-05 | El usuario puede hacer pull desde remote |
| RF-GIT-06 | El usuario puede hacer checkout a otra rama |
| RF-GIT-07 | El usuario puede crear una nueva rama |
| RF-GIT-08 | El usuario puede crear un worktree |
| RF-GIT-09 | El usuario puede ejecutar stacked publish (commit + push + PR) |
| RF-GIT-10 | El usuario puede revertir cambios aplicados por el asistente |
| RF-GIT-11 | Los errores Git se presentan como mensajes de producto, no como salida cruda de Git |
| RF-GIT-12 | Las acciones largas muestran progreso por fase |

### 10.6 RF-WORK: Workspace

| ID | Requisito |
|---|---|
| RF-WORK-01 | El usuario puede leer archivos del workspace en la PC |
| RF-WORK-02 | El usuario puede ver imágenes generadas por el agente |
| RF-WORK-03 | El usuario puede capturar checkpoints del estado del workspace |
| RF-WORK-04 | El usuario puede ver el diff de un checkpoint |
| RF-WORK-05 | El usuario puede aplicar un checkpoint (restore) |

### 10.7 RF-NOTIF: Notificaciones

| ID | Requisito |
|---|---|
| RF-NOTIF-01 | La app recibe push notifications cuando un turno del agente se completa |
| RF-NOTIF-02 | El push navigates directamente al thread correspondiente |
| RF-NOTIF-03 | Las notificaciones duplicadas deben ser deduplicadas por el relay |
| RF-NOTIF-04 | El usuario puede activar/desactivar notificaciones por thread |
| RF-NOTIF-05 | Las notificaciones locales se muestran cuando la app está en foreground |

### 10.8 RF-SSH: Terminal SSH

| ID | Requisito |
|---|---|
| RF-SSH-01 | El usuario puede conectarse a la PC vía SSH |
| RF-SSH-02 | El usuario puede gestionar múltiples perfiles SSH (host, user, port, key) |
| RF-SSH-03 | Las claves privadas SSH se almacenan en SecureStore |
| RF-SSH-04 | La terminal emula un terminal ANSI completo (VT100/xterm compatible) |
| RF-SSH-05 | La terminal soporta copy/paste de texto |

### 10.9 RF-MULTI: Multi-agente y multi-proyecto

| ID | Requisito |
|---|---|
| RF-MULTI-01 | El usuario puede configurar múltiples proyectos en la misma PC |
| RF-MULTI-02 | Cada proyecto puede usar un agente diferente (Codex, OpenCode, etc.) |
| RF-MULTI-03 | El usuario puede navegar entre proyectos desde el sidebar |
| RF-MULTI-04 | Cada proyecto tiene su propio cwd y configuración de agente |
| RF-MULTI-05 | El bridge puede ejecutar múltiples agentes en paralelo |

---

## 11. Flujos críticos del sistema

### 11.1 Flujo completo de primera conexión

```
[App] Instala Uxnan en el móvil
[PC]  Instala uxnan-bridge: npm install -g uxnan-bridge
[PC]  Ejecuta: uxnan-bridge start
[PC]  Muestra QR en terminal: uxnan-bridge qr
  QR = PairingPayload { v:2, relay:"wss://relay.uxnan.io", sessionId, macDeviceId,
                         macIdentityPublicKey, expiresAt, displayName }

[App] Abre OnboardingScreen
[App] Sigue pasos de instalación
[App] Presiona "Escanear QR"
[App] QrScannerScreen solicita permiso de cámara
[App] Cámara detecta QR → PairingValidator.validate(payload)
  ├── ¿v == 2? ✓
  ├── ¿expiresAt > now? ✓
  └── ¿campos presentes? ✓

[App] Genera PhoneIdentity (Ed25519) si no existe
[App] Crea TrustedDevice, persiste en SecureStore + DB local
[App] SessionCoordinator.connect(mode: qrBootstrap)

[App → Relay] WebSocket upgrade: GET /relay
  Headers: x-role: iphone, x-session-id: <sessionId>
[PC → Relay]  WebSocket ya conectado: x-role: mac, x-session-id: <sessionId>
[Relay]       Enruta mensajes entre mac e iphone por sessionId

[App → Bridge] clientHello { protocolVersion:1, handshakeMode:"qr_bootstrap",
                              phoneDeviceId, phoneIdentityPublicKey,
                              phoneEphemeralPublicKey, clientNonce }
[Bridge → App] serverHello { macIdentityPublicKey, macEphemeralPublicKey,
                              serverNonce, keyEpoch, macSignature, ... }
[App]          Verifica macSignature con macIdentityPublicKey del QR ✓
[App]          Deriva clave: HKDF(X25519(phoneEph, macEph), salt, "uxnan-e2ee-v1")
[App → Bridge] clientAuth { phoneDeviceId, keyEpoch, phoneSignature }
[Bridge]       Verifica phoneSignature ✓
[Bridge]       Persiste trustedPhone en secure-device-state
[Bridge → App] ready { sessionId, keyEpoch, macDeviceId }

[App] Crea SecureSession, activa cifrado AES-256-GCM
[App] ConnectionPhase → connected
[App] Navega a HomeScreen → SidebarScreen
[App → Bridge] thread/list → lista de threads
```

### 11.2 Flujo de reconexión confiable

```
[App] Detecta pérdida de conexión WebSocket
[App] ConnectionPhase → reconnecting
[App] Backoff: espera 1s, 2s, 4s...
[App] SessionCoordinator.connect(mode: trustedReconnect)
[App] Abre nuevo WebSocket → relay
[App → Bridge] clientHello { handshakeMode:"trusted_reconnect",
                              phoneDeviceId,
                              phoneIdentityPublicKey,
                              phoneEphemeralPublicKey,
                              clientNonce,
                              resumeState: { lastAppliedBridgeOutboundSeq: N } }
[Bridge] Verifica que phoneDeviceId está en trusted-phones ✓
[Bridge → App] serverHello (normal)
[App → Bridge] clientAuth
[Bridge → App] ready
[Bridge → App] Reenvía mensajes con seq > N desde outbound buffer
[App] SyncManager.syncAfterReconnect()
[App] ConnectionPhase → connected
```

### 11.3 Flujo de envío de mensaje y streaming

```
[App] Usuario escribe mensaje en ComposerWidget
[App] ComposerManager.send()
[App → Bridge] turn/send { threadId, content: { text: "mensaje del usuario" } }
[Bridge] Pasa el mensaje al adapter del agente activo
[Bridge] El agente empieza a generar respuesta

[Bridge → App] stream/turn/started { threadId, turnId }
[App] TimelineSnapshot.startStreaming(turnId)
[App] UI muestra indicador "asistente escribiendo..."

[Bridge → App] stream/message/delta { threadId, turnId, delta: "Claro, " }
[Bridge → App] stream/message/delta { threadId, turnId, delta: "aquí está..." }
... (streaming continúa)
[Bridge → App] stream/turn/completed { threadId, turnId, finalMessage: {...} }
[App] TimelineSnapshot.completeStreaming(turnId, finalMessage)
[App] UI muestra respuesta completa

Si el agente ejecuta comandos durante el turno:
[Bridge → App] stream/message/delta { delta: {type:"command_execution", command:"git status", status:"running"} }
[Bridge → App] stream/message/delta { delta: {type:"command_execution", command:"git status", status:"completed", output:"..."} }

Si el agente solicita aprobación:
[Bridge → App] stream/approval/requested { approvalId, action, risk }
[App] ApprovalRequestOverlay.show()
[Usuario] Aprueba o rechaza
[App → Bridge] turn/send { content: { approvalResponse: { approvalId, approved: true } } }
```

### 11.4 Flujo Git: commit + push

```
[App] GitActionsBottomSheet visible con estado del repo
  isDirty: true, ahead: 2, branch: "feature/login"

[App] Usuario presiona "Commit"
[App] CommitDialog.show() → usuario escribe mensaje
[App] GitActionManager.commit({ cwd, message: "feat: add login form" })
[App → Bridge] git/commit { cwd: "/projects/app", message: "feat: add login form" }
[Bridge] git-handler.js ejecuta: git commit -m "feat: add login form"
[Bridge → App] RPC response { result: { sha: "abc123", message: "feat: add login form" } }
[App] GitActionProgress: commit completado ✓

[App] Usuario presiona "Push"
[App] GitActionManager.push({ cwd, branch: "feature/login", remote: "origin" })
[App → Bridge] git/push { cwd, branch, remote }
[Bridge] Emite progreso por fases:
[Bridge → App] stream/git/progress { phase: "resolving", status: "running" }
[Bridge → App] stream/git/progress { phase: "uploading", status: "running" }
[Bridge → App] stream/git/progress { phase: "complete", status: "completed" }
[App] GitActionsBottomSheet actualiza: ahead: 0, "Push exitoso"
```

### 11.5 Flujo de notificación push

```
[PC] Agente completa un turno largo
[Bridge] push-notification-tracker detecta turn/completed
[Bridge] push-notification-completion-dedupe: ¿ya enviado sessionId:turnId? No
[Bridge → Relay] POST /push/notify
  { sessionId, notificationSecret, threadId, turnId, title: "Tarea completada", body: "..." }
[Relay] Valida notificationSecret ✓, no duplicado ✓
[Relay → APNs/FCM] Envía push notification

[Móvil] Recibe push (background o foreground)
[App] HandleIncomingPush:
  ├── Si foreground → flutter_local_notifications muestra banner
  └── Si background/tap → navega a ConversationScreen(threadId)
[App] ThreadManager.selectThread(threadId)
[App] Si no conectado → SessionCoordinator.connect()
[App] Carga timeline del thread
```

---

## 12. Estructura de directorios del proyecto Flutter

```
uxnan_mobile/
├── android/
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   └── kotlin/com/uxnan/
│   │   │       └── MainKotlinActivity.kt       # (si se necesita código nativo)
│   │   └── build.gradle
│   └── build.gradle
├── ios/
│   ├── Runner/
│   │   ├── Info.plist                          # permisos: cámara, notificaciones, red local
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
│   │   ├── entities/                           # (ver §5.1.1)
│   │   ├── value_objects/                      # (ver §5.1.3)
│   │   ├── enums/                              # (ver §5.1.2)
│   │   ├── repositories/                       # interfaces (ver §5.1.4)
│   │   └── usecases/                           # (ver §5.1.5)
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
│       ├── screens/                            # (ver §5.4.2)
│       ├── widgets/                            # (ver §5.4.2)
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
├── build.yaml                                  # configuración de build_runner
└── README.md
```

---

## 13. Bridge y relay — especificación técnica

### 13.1 Configuración del relay

El relay puede desplegarse como servicio en cualquier VPS con Node.js:

```
relay/
├── server.js                           # entrypoint HTTP/WS
├── relay.js                            # lógica de routing de sesiones
├── push-service.js                     # gestión de push state
├── apns-client.js                      # cliente APNs (iOS)
├── fcm-client.js                       # cliente FCM (Android)
├── rate-limiter.js                     # rate limiting por IP
├── session-store.js                    # almacenamiento de sesiones en memoria + archivo
├── config.js                           # variables de entorno
├── tests/
│   ├── push-service.test.js
│   ├── server.test.js
│   ├── apns-client.test.js
│   └── simulated-pairing-reconnect.test.js
├── package.json
└── .env.example
```

#### Variables de entorno del relay

```bash
PORT=8080
# iOS / APNs
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_PRIVATE_KEY_PATH=/secrets/apns-auth-key.p8
APNS_ENVIRONMENT=production  # o sandbox
APNS_TOPIC=com.uxnan.mobile  # bundle ID
# Android / FCM
FCM_PROJECT_ID=uxnan-mobile
FCM_SERVICE_ACCOUNT_PATH=/secrets/firebase-service-account.json
# Configuración general
TRUST_PROXY=true             # si está detrás de reverse proxy
SESSION_FILE_PATH=/data/relay-sessions.json
PUSH_STATE_FILE_PATH=/data/push-state.json
MAX_SESSIONS=10000
SESSION_TTL_MS=86400000      # 24 horas
```

### 13.2 Rate limiting del relay

| Endpoint / tipo | Límite |
|---|---|
| HTTP general | 120 requests / minuto / IP |
| Push endpoints | 30 requests / minuto / IP |
| WebSocket upgrades | 60 upgrades / minuto / IP |

### 13.3 Protocolo de pairing por código corto

```
SHORT_PAIRING_CODE_LENGTH = 6  # caracteres alfanuméricos en mayúscula

1. Bridge conecta al relay con header: x-pairing-code: ABC123
2. Relay mantiene mapa: { ABC123: sessionId }
3. App hace GET /trusted-session/resolve?code=ABC123
4. Relay responde: { sessionId, macDeviceId, macIdentityPublicKey, displayName }
5. App construye PairingPayload sintético y continúa con QR bootstrap
```

### 13.4 Health check del relay

```
GET /health → 200 OK
Body: {
  "status": "ok",
  "activeSessions": 42,
  "uptime": 86400,
  "version": "1.0.0"
}
```

---

## 14. Seguridad y criptografía

### 14.1 Primitivas criptográficas

| Primitiva | Uso | Implementación |
|---|---|---|
| **Ed25519** | Identidad persistente del bridge y del teléfono; firma del transcript | `cryptography` + `cryptography_flutter` (nativo iOS/Android) |
| **X25519** | Intercambio de claves efímero para derivación de sesión | `cryptography` + `cryptography_flutter` |
| **HKDF-SHA256** | Derivación de clave simétrica desde shared secret X25519 | `cryptography` |
| **AES-256-GCM** | Cifrado autenticado de todos los envelopes | `pointycastle` / `cryptography` |
| **SHA-256** | Fingerprinting de mensajes para deduplicación | `crypto` (dart:crypto) |

### 14.2 Almacenamiento de material criptográfico

| Material | Dónde se almacena |
|---|---|
| `phoneIdentityPrivateKey` | `flutter_secure_storage` (Keychain/Keystore) — nunca en SQLite |
| `phoneIdentityPublicKey` | `flutter_secure_storage` |
| `phoneDeviceId` | `flutter_secure_storage` |
| `derivedKey` (sesión actual) | Solo en memoria (`SecureSession`), se deriva en cada handshake |
| `macIdentityPublicKey` (por device) | SQLite cifrado (drift) + `flutter_secure_storage` como backup |
| `notificationSecret` | `flutter_secure_storage` |
| Claves privadas SSH | `flutter_secure_storage` |

### 14.3 Threat model

| Amenaza | Mitigación |
|---|---|
| Relay malicioso intercepta mensajes | Los envelopes son E2EE opacos — relay nunca ve plaintext |
| QR escaneado por tercero | TTL de 5 minutos; el QR solo es válido una vez (first-connect wins) |
| MITM en handshake | Firma Ed25519 bilateral; el transcript incluye claves efímeras de ambas partes |
| Replay de mensajes | `seq` monotónico por lado; mensajes con seq ≤ lastApplied son rechazados |
| Token push exfiltrado | `notificationSecret` validado en cada push; el relay no asocia token con contenido |
| App comprometida extrae claves | Las claves están en Keychain/Keystore — no accesibles por código fuera de la app |
| Clock manipulation | Tolerancia explícita de 60/90 segundos; expiración de QR en Unix ms |

---

## 15. Gestión de estado y persistencia

### 15.1 Niveles de persistencia

```
Nivel 1: Memoria (duración: sesión de la app)
├── SecureSession (clave derivada, seq counters)
├── TurnTimelineSnapshot (estado actual de la timeline)
├── ComposerState (draft en edición)
└── ConnectionPhase, RecoveryState

Nivel 2: flutter_secure_storage (Keychain / Keystore — durabilidad máxima)
├── PhoneIdentityPrivateKey
├── PhoneIdentityPublicKey
├── PhoneDeviceId
├── NotificationSecret
├── TrustedDevice.macIdentityPublicKey (por device)
└── SshPrivateKeys

Nivel 3: SQLite / drift (durabilidad estándar, restaurable)
├── threads
├── messages (historial cacheado)
├── turns (historial cacheado)
├── projects
├── trusted_devices (metadata no-criptográfica)
└── composer_drafts

Nivel 4: shared_preferences (preferencias de usuario)
├── onboardingCompleted: bool
├── selectedTheme: String
├── notificationPreferences: JSON
└── lastConnectedMacId: String
```

### 15.2 Estrategia de caché de mensajes

```dart
// MessageRepository mantiene una caché por thread:
// - Cuando el usuario abre un thread, carga los últimos 50 mensajes de SQLite
// - Al scrollear hacia arriba, carga lotes de 20 en dirección al pasado
// - Los mensajes entrantes en streaming se añaden en memoria y se persisten al completar el turno
// - Al cerrar la app, el estado de la timeline se descarta de memoria
// - Al reabrirla, se recarga desde SQLite

class MessageCachePolicy {
  static const initialLoad = 50;    // mensajes al abrir thread
  static const paginationSize = 20; // mensajes por página de historial
  static const maxInMemory = 200;   // máximo en memoria antes de purgar extremo viejo
}
```

### 15.3 Offline support

```
Escenario: usuario abre la app sin conexión
├── SQLite tiene historial previo → se muestra correctamente
├── ConnectionPhase → disconnected
├── SyncManager.scheduleBackgroundSync() en loop con backoff
├── ComposerWidget: botón de envío muestra "Se enviará al conectar"
├── Al reconectar → flush de mensajes encolados + sync del historial
└── Timeline se actualiza con mensajes nuevos desde el bridge
```

---

## 16. Consideraciones de plataforma Android vs iOS

### 16.1 Diferencias de implementación

| Feature | Android | iOS |
|---|---|---|
| Almacenamiento seguro | `EncryptedSharedPreferences` + Android Keystore (API 23+) | Keychain Services (iOS 9+) |
| Push notifications | Firebase Cloud Messaging (FCM) | APNs (directo o vía FCM gateway) |
| Permiso de red local | No requerido (acceso a LAN directo) | Requiere `NSLocalNetworkUsageDescription` + probe nativo |
| QR Scanner | CameraX + ML Kit | AVFoundation + Apple Vision |
| SSH | dartssh2 (puro Dart) | dartssh2 (puro Dart) |
| Criptografía acelerada | JCE + Android Keystore | CryptoKit (Swift) vía FFI |
| Background execution | WorkManager para sync | BGAppRefreshTask (limitado por iOS) |
| Notificaciones background | FCM high-priority | APNs background push |

### 16.2 Permiso de red local en iOS

iOS requiere que el usuario autorice explícitamente el acceso a la red local (LAN) mediante un popup del sistema. Este popup solo aparece cuando se hace un socket probe a la red local:

```dart
// Plugin nativo: ios/Classes/LocalNetworkPlugin.swift
// Realiza un socket UDP probe a 224.0.0.0 (multicast) para triggear el popup

class LocalNetworkPermissionAdapter {
  Future<LocalNetworkPermissionStatus> request() async {
    if (Platform.isIOS) {
      return await _methodChannel.invokeMethod('requestLocalNetworkPermission');
    }
    return LocalNetworkPermissionStatus.granted; // Android no requiere
  }
}
```

La declaración en `Info.plist`:
```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Uxnan necesita acceso a la red local para conectarse al bridge instalado en tu PC.</string>
<key>NSBonjourServices</key>
<array><string>_uxnan-bridge._tcp</string></array>
```

### 16.3 Background push en Android

```kotlin
// android/app/src/main/kotlin/.../UxnanFirebaseService.kt
class UxnanFirebaseService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    // Mostrar notificación local si la app está en background
    // flutter_local_notifications gestiona esto vía FlutterLocalNotificationsPlugin
  }
  override fun onNewToken(token: String) {
    // Token FCM actualizado — notificar a Flutter vía EventChannel
  }
}
```

### 16.4 Tamaños de pantalla

La UI debe adaptarse a:
- **Teléfonos pequeños:** 360dp x 640dp (mínimo soportado)
- **Teléfonos estándar:** 390-430dp x 844-932dp (iPhone 14/15, Pixel 7-8)
- **Teléfonos grandes:** 412-480dp x 900-1000dp (Galaxy S24 Ultra)
- **Tablets (opcional en v1):** layout de dos paneles sidebar + conversación

---

## 17. Criterios de aceptación y MVP

### 17.1 MVP — Scope mínimo viable

El MVP debe cumplir los siguientes módulos completos:

| Módulo | Criterio de aceptación |
|---|---|
| Pairing | Usuario puede parear su móvil con una PC en < 2 minutos |
| Conexión E2EE | El handshake se completa en < 500ms en LAN |
| Threads list | Usuario ve la lista de threads del agente activo |
| Conversación | Usuario puede leer una conversación completa con streaming |
| Composer | Usuario puede enviar texto y recibir respuesta del agente |
| Reconexión | La app reconecta automáticamente sin perder mensajes |
| Push | Usuario recibe push cuando un turno se completa (background) |
| Git básico | Usuario puede ver status, diff, commit y push |
| Agentes | Soporte inicial: OpenAI Codex CLI y OpenCode |

### 17.2 Post-MVP — Features siguientes

| Feature | Prioridad |
|---|---|
| Soporte Claude Code | Alta |
| Soporte Gemini CLI | Alta |
| Soporte pi-agent | Media |
| SSH Terminal | Media |
| Workspace checkpoints | Media |
| Fork de threads | Media |
| Voice input | Baja |
| Worktrees administrados | Baja |
| Tablet layout | Baja |
| Custom agent adapter | Baja |

### 17.3 Criterios de calidad

| Métrica | Objetivo |
|---|---|
| Test coverage (unit) | > 80% de lógica de dominio y aplicación |
| Test coverage (widget) | > 60% de pantallas principales |
| Lint/análisis estático | 0 warnings con `flutter analyze` |
| Performance (frames) | 0 jank en timeline con 100 mensajes |
| Tamaño APK release (Android) | < 25 MB |
| Tamaño IPA release (iOS) | < 20 MB |

---

## 18. Glosario técnico

| Término | Definición |
|---|---|
| **ADE** | Agentic Development Environment — entorno de desarrollo asistido por agentes de IA |
| **Agent Adapter** | Módulo del bridge que normaliza la comunicación con un agente específico (Codex, OpenCode, etc.) |
| **APNs** | Apple Push Notification service — servicio de notificaciones push de Apple |
| **AES-256-GCM** | Advanced Encryption Standard de 256 bits en modo Galois/Counter — cifrado autenticado |
| **Bridge** | Daemon local que corre en la PC del usuario y actúa como intermediario entre el móvil y el agente |
| **catch-up** | Proceso de reenvío de mensajes perdidos al reconectar, usando el buffer de outbound del bridge |
| **cwd** | Current Working Directory — directorio raíz del proyecto en la PC |
| **dedupeKey** | Clave única usada para prevenir envío duplicado de notificaciones push |
| **drift** | ORM para SQLite en Flutter, sucesor de moor |
| **E2EE** | End-to-End Encryption — cifrado de extremo a extremo |
| **Ed25519** | Algoritmo de firma digital basado en curva elíptica (Edwards curve) |
| **FCM** | Firebase Cloud Messaging — servicio de notificaciones push de Google (Android) |
| **fingerprint** | Hash SHA-256 del contenido de un mensaje usado para deduplicación |
| **HKDF** | HMAC-based Key Derivation Function — función de derivación de claves |
| **handshake** | Proceso de autenticación mutua y establecimiento de clave de sesión E2EE |
| **JSON-RPC 2.0** | Protocolo de llamada a procedimiento remoto basado en JSON, sin estado |
| **JSONL** | JSON Lines — formato de archivo donde cada línea es un objeto JSON independiente |
| **keyEpoch** | Contador de renegociaciones de clave; incrementa si se derivan nuevas claves |
| **local-first** | Arquitectura donde el estado primario vive en el dispositivo del usuario, no en un servidor central |
| **MCP** | Model Context Protocol — protocolo estándar para conectar agentes LLM con herramientas externas |
| **notificationSecret** | Secreto compartido entre bridge y relay para autorizar el envío de push notifications |
| **outbound buffer** | Buffer circular del bridge (max 500 msgs / 10 MB) para reenvío al reconectar |
| **pairing** | Proceso de vincular criptográficamente el teléfono con un bridge específico en una PC |
| **PairingPayload** | Estructura JSON transportada en el QR code con los datos necesarios para el pairing |
| **phoneDeviceId** | UUID único generado al instalar la app en un teléfono concreto |
| **PhoneIdentity** | Par de claves Ed25519 que identifican permanentemente al teléfono |
| **plan mode** | Modo de operación de algunos agentes donde proponen un plan antes de ejecutar cambios |
| **QR bootstrap** | Modo de handshake inicial que requiere escanear el QR del bridge |
| **ReAct** | Reason and Act — paradigma de agentes que alterna entre razonamiento y acción |
| **relay** | Servidor intermediario que retransmite envelopes E2EE entre el móvil y el bridge |
| **Riverpod** | Framework de gestión de estado reactivo para Flutter basado en providers |
| **rollout** | Proceso de entrega de eventos del runtime del agente al bridge |
| **seq** | Número de secuencia monotónico por lado (bridge/iphone) para prevenir replay attacks |
| **sessionId** | UUID que identifica una sesión de conexión bridge-relay-móvil |
| **SecureSession** | Objeto inmutable que encapsula el material criptográfico de una sesión E2EE activa |
| **subagent** | Agente subordinado lanzado por el agente principal para una subtarea |
| **transcript** | Concatenación de valores del handshake sobre los que se firma con Ed25519 |
| **TrustedDevice** | Registro persistido de un bridge (Mac/PC) de confianza |
| **trusted reconnect** | Modo de reconexión que no requiere re-escanear el QR |
| **turn** | Unidad de interacción en la conversación: un mensaje del usuario + respuesta del asistente |
| **timeline** | Vista ordenada cronológicamente de todos los mensajes y eventos de un thread |
| **worktree** | Copia de trabajo de Git que permite tener múltiples branches abiertos simultáneamente |
| **X25519** | Protocolo de intercambio de claves Diffie-Hellman sobre curva elíptica de Bernstein |

---

## 19. Especificación detallada de proveedores Riverpod

Esta sección define todos los providers de Riverpod que la app necesita, con su tipo, dependencias y comportamiento esperado.

### 19.1 Providers de infraestructura (singletons)

```dart
// lib/presentation/providers/infrastructure_providers.dart

// Base de datos SQLite
@Riverpod(keepAlive: true)
UxnanDatabase database(DatabaseRef ref) => UxnanDatabase();

// Almacenamiento seguro
@Riverpod(keepAlive: true)
SecureStore secureStore(SecureStoreRef ref) => SecureStore();

// Preferencias compartidas
@Riverpod(keepAlive: true)
Future<SharedPreferences> sharedPreferences(SharedPreferencesRef ref) =>
    SharedPreferences.getInstance();

// Repositorios
@Riverpod(keepAlive: true)
IThreadRepository threadRepository(ThreadRepositoryRef ref) =>
    DriftThreadRepository(ref.watch(databaseProvider));

@Riverpod(keepAlive: true)
IMessageRepository messageRepository(MessageRepositoryRef ref) =>
    DriftMessageRepository(ref.watch(databaseProvider));

@Riverpod(keepAlive: true)
ITrustedDeviceRepository trustedDeviceRepository(TrustedDeviceRepositoryRef ref) =>
    DriftTrustedDeviceRepository(ref.watch(databaseProvider));

@Riverpod(keepAlive: true)
IProjectRepository projectRepository(ProjectRepositoryRef ref) =>
    DriftProjectRepository(ref.watch(databaseProvider));

@Riverpod(keepAlive: true)
ISecureSessionRepository secureSessionRepository(SecureSessionRepositoryRef ref) =>
    SecureStorageSessionRepository(ref.watch(secureStoreProvider));

@Riverpod(keepAlive: true)
IComposerDraftRepository composerDraftRepository(ComposerDraftRepositoryRef ref) =>
    DriftComposerDraftRepository(ref.watch(databaseProvider));

// Adaptadores de plataforma
@Riverpod(keepAlive: true)
PushNotificationAdapter pushAdapter(PushAdapterRef ref) =>
    PushNotificationAdapter();

@Riverpod(keepAlive: true)
QrScannerAdapter qrScannerAdapter(QrScannerAdapterRef ref) =>
    QrScannerAdapter();

@Riverpod(keepAlive: true)
HapticAdapter hapticAdapter(HapticAdapterRef ref) =>
    HapticAdapter();
```

### 19.2 Providers de dominio / aplicación (coordinadores)

```dart
// lib/presentation/providers/application_providers.dart

// SessionCoordinator — singleton con keepAlive
@Riverpod(keepAlive: true)
SessionCoordinator sessionCoordinator(SessionCoordinatorRef ref) =>
    SessionCoordinator(
      trustedDeviceRepo: ref.watch(trustedDeviceRepositoryProvider),
      secureSessionRepo: ref.watch(secureSessionRepositoryProvider),
      secureStore: ref.watch(secureStoreProvider),
    );

// ThreadManager — singleton con keepAlive
@Riverpod(keepAlive: true)
ThreadManager threadManager(ThreadManagerRef ref) =>
    ThreadManager(
      threadRepo: ref.watch(threadRepositoryProvider),
      messageRepo: ref.watch(messageRepositoryProvider),
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    );

// ComposerManager — singleton con keepAlive
@Riverpod(keepAlive: true)
ComposerManager composerManager(ComposerManagerRef ref) =>
    ComposerManager(
      draftRepo: ref.watch(composerDraftRepositoryProvider),
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    );

// GitActionManager — singleton con keepAlive
@Riverpod(keepAlive: true)
GitActionManager gitActionManager(GitActionManagerRef ref) =>
    GitActionManager(
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    );

// SyncManager
@Riverpod(keepAlive: true)
SyncManager syncManager(SyncManagerRef ref) =>
    SyncManager(
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
      threadManager: ref.watch(threadManagerProvider),
      messageRepo: ref.watch(messageRepositoryProvider),
    );

// NotificationManager
@Riverpod(keepAlive: true)
NotificationManager notificationManager(NotificationManagerRef ref) =>
    NotificationManager(
      pushAdapter: ref.watch(pushAdapterProvider),
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
      secureStore: ref.watch(secureStoreProvider),
    );
```

### 19.3 Providers de estado derivado (UI)

```dart
// lib/presentation/providers/ui_providers.dart

// Estado de conexión
@riverpod
Stream<ConnectionPhase> connectionPhase(ConnectionPhaseRef ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.connectionPhaseStream;
}

// Mac activa
@riverpod
Stream<TrustedDevice?> activeMac(ActiveMacRef ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.activeMacStream;
}

// Lista de dispositivos de confianza
@riverpod
Future<List<TrustedDevice>> trustedDevices(TrustedDevicesRef ref) {
  final repo = ref.watch(trustedDeviceRepositoryProvider);
  return repo.getDevices();
}

// Lista de threads (reactiva por cambios en DB)
@riverpod
Stream<List<Thread>> threads(ThreadsRef ref, {String? projectId}) {
  final repo = ref.watch(threadRepositoryProvider);
  return repo.watchThreads(projectId: projectId);
}

// Thread activo
@riverpod
Thread? activeThread(ActiveThreadRef ref) {
  final manager = ref.watch(threadManagerProvider);
  return manager.activeThread.value;
}

// Timeline snapshot para un thread dado
@riverpod
Future<TurnTimelineSnapshot> timeline(TimelineRef ref, String threadId) async {
  final manager = ref.watch(threadManagerProvider);
  return manager.getTimeline(threadId);
}

// Mensajes en stream (reactivo)
@riverpod
Stream<List<Message>> messages(MessagesRef ref, String threadId) {
  final repo = ref.watch(messageRepositoryProvider);
  return repo.watchMessages(threadId);
}

// Estado del repo Git para el thread activo
@riverpod
Future<GitRepoState?> gitRepoState(GitRepoStateRef ref) async {
  final thread = ref.watch(activeThreadProvider);
  if (thread == null || thread.cwd == null) return null;
  final manager = ref.watch(gitActionManagerProvider);
  return manager.repoState.value;
}

// Estado del composer
@riverpod
ComposerState composerState(ComposerStateRef ref) {
  final manager = ref.watch(composerManagerProvider);
  return manager.state;
}

// Lista de proyectos
@riverpod
Stream<List<Project>> projects(ProjectsRef ref) {
  final repo = ref.watch(projectRepositoryProvider);
  return repo.watchProjects();
}

// Estado de autenticación del agente activo
@riverpod
Future<AuthStatus> authStatus(AuthStatusRef ref, String agentId) async {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.getAuthStatus(agentId);
}

// ¿El onboarding ya fue completado?
@riverpod
Future<bool> onboardingCompleted(OnboardingCompletedRef ref) async {
  final prefs = await ref.watch(sharedPreferencesProvider.future);
  return prefs.getBool('onboardingCompleted') ?? false;
}
```

### 19.4 Family providers (por parámetro)

```dart
// Snapshot de timeline para un thread específico (auto-refresh)
@riverpod
Stream<TurnTimelineSnapshot> liveTimeline(
    LiveTimelineRef ref, String threadId) {
  final manager = ref.watch(threadManagerProvider);
  return manager.watchTimeline(threadId);
}

// Progreso de acción Git para un thread
@riverpod
Stream<GitActionProgress?> gitActionProgress(
    GitActionProgressRef ref, String threadId) {
  final manager = ref.watch(gitActionManagerProvider);
  return manager.watchProgress(threadId);
}

// Draft del composer por thread
@riverpod
Future<String?> composerDraft(ComposerDraftRef ref, String threadId) {
  final repo = ref.watch(composerDraftRepositoryProvider);
  return repo.getDraft(threadId);
}
```

---

## 20. Especificación de adaptadores de agente

Esta sección detalla el comportamiento específico de cada adaptador de agente en el bridge, incluyendo cómo localizan las sesiones, cómo inician el runtime y qué transformaciones aplican al protocolo.

### 20.1 Adaptador OpenAI Codex CLI (`codex-adapter.js`)

**Arquitectura del agente:** Codex corre como un `app-server` local que expone JSON-RPC 2.0 sobre WebSocket en un socket local Unix o TCP. El bridge actúa como proxy entre la app móvil y este app-server.

**Localización del runtime:**
```javascript
// Rutas de búsqueda del binario Codex
const CODEX_BINARY_PATHS = [
  '/usr/local/bin/codex',
  '/opt/homebrew/bin/codex',
  path.join(process.env.HOME, '.local/bin/codex'),
  // npx codex como fallback
];

// Directorio de sesiones JSONL
const CODEX_SESSIONS_DIR = path.join(process.env.HOME, '.codex', 'sessions');
// Directorio de imágenes generadas
const CODEX_IMAGES_DIR = path.join(process.env.HOME, '.codex', 'workspace-images');
```

**Inicio del runtime:**
```javascript
async function startCodexRuntime(cwd, projectConfig) {
  // Lanza: codex --app-server --socket /tmp/codex-<sessionId>.sock
  const proc = spawn(codexBinary, ['--app-server', '--socket', socketPath], {
    cwd,
    env: { ...process.env, ...projectConfig.env },
    detached: false,
  });
  // Espera hasta que el socket está disponible (polling con timeout de 10s)
  await waitForSocket(socketPath, 10_000);
  return proc;
}
```

**Mapeo de métodos JSON-RPC:**
Los métodos de Codex son nativos al protocolo, por lo que el adaptador es prácticamente un proxy transparente. Solo se necesitan estas transformaciones:

| Método Uxnan | Método Codex | Transformación |
|---|---|---|
| `thread/list` | `thread/list` | Ninguna |
| `thread/read` | `thread/read` | Ninguna |
| `thread/turns/list` | `thread/turns/list` | Ninguna |
| `turn/send` | `turn/send` | Ninguna |
| `git/status` | `git/status` | Bridge ejecuta git localmente |
| `account/read` | `account/read` | Sanitización de tokens en respuesta |
| `getAuthStatus` | `getAuthStatus` | Sanitización de tokens |

**Fallback JSONL:**
Cuando `thread/turns/list` retorna vacío o error, el adaptador lee directamente de `~/.codex/sessions/<threadId>.jsonl`:
```javascript
async function readTurnsFromJSONL(threadId, { cursor, limit = 20 }) {
  const sessionFile = path.join(CODEX_SESSIONS_DIR, `${threadId}.jsonl`);
  // Lee líneas desde el final hacia el principio (más recientes primero)
  // Filtra por cursor si se proporciona
  // Retorna en formato compatible con thread/turns/list response
}
```

**Capacidades declaradas:**
```javascript
capabilities: {
  supportsGit: true,
  supportsWorktrees: true,
  supportsCheckpoints: true,
  supportsVoice: false,
  supportsSubagents: true,
  supportsPlanMode: true,
  supportsMultipleProjects: true,
  supportsThreadFork: true,
  sessionsFormat: 'jsonl',
}
```

---

### 20.2 Adaptador OpenCode (`opencode-adapter.js`)

**Arquitectura del agente:** OpenCode usa una arquitectura cliente/servidor explícitamente diseñada para clientes remotos. OpenCode implementa una arquitectura cliente/servidor que permite que el frontend TUI sea solo uno de los posibles clientes, habilitando que una app móvil se conecte remotamente. Sus sesiones se almacenan en SQLite.

**Inicio del runtime:**
```javascript
async function startOpenCodeServer(cwd, projectConfig) {
  // OpenCode corre un servidor HTTP/WS en puerto configurable
  const port = projectConfig.port || await getFreePort();
  const proc = spawn('opencode', ['server', '--port', String(port), '--dir', cwd], {
    cwd,
    env: { ...process.env, ...projectConfig.env },
  });
  await waitForHttp(`http://localhost:${port}/health`, 15_000);
  return { proc, port };
}
```

**Protocolo de OpenCode:**
OpenCode expone una API REST + WebSocket. El adaptador traduce los métodos JSON-RPC de Uxnan a llamadas HTTP/WS de OpenCode:

```javascript
// GET /session → thread/list
async function listThreads() {
  const res = await fetch(`http://localhost:${port}/session`);
  const sessions = await res.json();
  return sessions.map(mapOpenCodeSessionToThread);
}

// POST /session → thread/start
async function startThread({ cwd, message }) {
  const res = await fetch(`http://localhost:${port}/session`, {
    method: 'POST',
    body: JSON.stringify({ cwd, initialMessage: message }),
  });
  return mapOpenCodeSessionToThread(await res.json());
}

// WS /session/:id/events → stream de eventos
function watchSession(sessionId, onEvent) {
  const ws = new WebSocket(`ws://localhost:${port}/session/${sessionId}/events`);
  ws.on('message', (data) => {
    const event = JSON.parse(data);
    onEvent(mapOpenCodeEventToDomainEvent(event));
  });
  return ws;
}
```

**Almacenamiento SQLite de OpenCode:**
OpenCode guarda sesiones en `~/.opencode/sessions.db`. Como fallback, el adaptador puede leer directamente:
```javascript
const OPENCODE_DB_PATH = path.join(process.env.HOME, '.opencode', 'sessions.db');

async function readSessionsFromSQLite(options) {
  // Usa better-sqlite3 en modo read-only
  const db = new Database(OPENCODE_DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?')
    .all(options.limit || 50);
  return rows.map(mapRowToThread);
}
```

**Capacidades declaradas:**
```javascript
capabilities: {
  supportsGit: true,
  supportsWorktrees: false,         // OpenCode no tiene worktrees nativos
  supportsCheckpoints: false,       // sin soporte nativo
  supportsVoice: false,
  supportsSubagents: false,
  supportsPlanMode: true,           // OpenCode tiene Plan/Build mode
  supportsMultipleProjects: true,
  supportsThreadFork: false,
  sessionsFormat: 'sqlite',
}
```

---

### 20.3 Adaptador Claude Code (`claude-code-adapter.js`)

**Arquitectura del agente:** Claude Code incluye un sistema Bridge de 33+ archivos para la funcionalidad de "Remote Control" que controla el Claude Code local desde la interfaz web de Claude.ai, usando un túnel WebSocket/HTTPS autenticado. El adaptador de Uxnan se conecta al agente de Claude Code de forma local, sin pasar por la nube de Anthropic.

**Inicio del runtime:**
```javascript
async function startClaudeCodeAgent(cwd, projectConfig) {
  // Claude Code puede lanzarse en modo server
  const proc = spawn('claude', ['--server', '--port', String(port)], {
    cwd,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: resolveApiKey(projectConfig),
      ...projectConfig.env,
    },
  });
  await waitForHttp(`http://localhost:${port}/health`, 15_000);
  return { proc, port };
}
```

**Sesiones JSONL de Claude Code:**
```javascript
// Claude Code almacena sesiones en ~/.claude-code/sessions/
const CLAUDE_CODE_SESSIONS_DIR = path.join(
  process.env.HOME, '.claude-code', 'sessions'
);

// Cada sesión es un archivo JSONL con entradas del tipo:
// {"type":"message","role":"user","content":"...","timestamp":...}
// {"type":"message","role":"assistant","content":"...","timestamp":...}
// {"type":"tool_use","name":"bash","input":{"command":"..."},...}
// {"type":"tool_result","tool_use_id":"...","content":"..."}

async function readSessionFromJSONL(sessionId, { cursor, limit }) {
  const filePath = path.join(CLAUDE_CODE_SESSIONS_DIR, `${sessionId}.jsonl`);
  // Parsea el JSONL, aplica cursor, retorna turns estructurados
}
```

**Capacidades declaradas:**
```javascript
capabilities: {
  supportsGit: true,
  supportsWorktrees: false,
  supportsCheckpoints: false,
  supportsVoice: false,
  supportsSubagents: true,          // Claude Code soporta subagentes
  supportsPlanMode: false,
  supportsMultipleProjects: true,
  supportsThreadFork: false,
  sessionsFormat: 'jsonl',
}
```

---

### 20.4 Adaptador Gemini CLI (`gemini-cli-adapter.js`)

**Arquitectura del agente:** Gemini CLI es un agente open-source que usa un bucle ReAct (Reason and Act) con herramientas built-in y servidores MCP locales o remotos para completar tareas complejas. Soporta output en formato JSON estructurado y stream-JSON para integración programática.

**Inicio del runtime:**
```javascript
async function startGeminiAgent(cwd, projectConfig) {
  // Gemini CLI no tiene modo server nativo; se lanza por conversación
  // El adaptador gestiona el ciclo de vida del proceso por turno
  // usando --output-format stream-json para consumir eventos
}

async function sendTurnToGemini(cwd, prompt, sessionFile) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--no-interactive',
  ];
  if (sessionFile) args.push('--session', sessionFile);

  const proc = spawn('gemini', args, {
    cwd,
    env: {
      ...process.env,
      GOOGLE_API_KEY: resolveApiKey(projectConfig),
    },
  });

  // Lee líneas NDJSON del stdout
  return parseStreamJsonOutput(proc.stdout);
}
```

**Formato stream-json de Gemini CLI:**
Gemini CLI soporta `--output-format stream-json` para obtener eventos NDJSON en tiempo real, útil para monitorear operaciones de larga duración.

```javascript
// Cada línea del output es un evento JSON del tipo:
// {"type":"thought","content":"Pensando sobre..."}
// {"type":"tool_call","name":"read_file","args":{"path":"..."}}
// {"type":"tool_result","name":"read_file","result":"..."}
// {"type":"response","content":"Aquí está la solución..."}
// {"type":"complete"}

function parseStreamJsonOutput(stdout) {
  // Mapea eventos Gemini → DomainEvents de Uxnan
  return new Transform({
    transform(chunk, _, callback) {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line);
        this.push(mapGeminiEventToDomainEvent(event));
      }
      callback();
    }
  });
}
```

**Capacidades declaradas:**
```javascript
capabilities: {
  supportsGit: false,               // Gemini CLI no tiene git integrado nativo
  supportsWorktrees: false,
  supportsCheckpoints: false,
  supportsVoice: false,
  supportsSubagents: false,
  supportsPlanMode: false,
  supportsMultipleProjects: true,
  supportsThreadFork: false,
  sessionsFormat: 'jsonl',          // sesiones en formato NDJSON por directorio
}
```

---

### 20.5 Adaptador pi-agent (`pi-agent-adapter.js`)

**Arquitectura del agente:** pi-agent usa modo RPC con framing JSONL estricto delimitado por LF. Los clientes deben dividir registros solo por `\n`. Las sesiones se persisten como archivos JSONL en `~/.pi/agent/sessions/`.

**Modo RPC de pi-agent:**
```javascript
// pi se lanza con --rpc para modo programático
async function startPiRpc(cwd, projectConfig) {
  const proc = spawn('pi', ['--rpc'], {
    cwd,
    env: {
      ...process.env,
      ...resolveProviderEnv(projectConfig),  // ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Protocolo: cada mensaje es una línea JSON terminada en \n
  // CRÍTICO: no usar readline — puede partir en separadores Unicode
  const reader = new NdjsonReader(proc.stdout);  // custom, split solo en \n
  const writer = new NdjsonWriter(proc.stdin);

  return { proc, reader, writer };
}

// Enviar request al RPC de pi
async function sendPiRequest(session, method, params) {
  const request = { id: generateId(), method, params };
  session.writer.write(JSON.stringify(request) + '\n');
  return waitForResponse(session.reader, request.id);
}
```

**Lectura de sesiones JSONL de pi:**
```javascript
const PI_SESSIONS_DIR = path.join(process.env.HOME, '.pi', 'agent', 'sessions');

// pi almacena sesiones como archivos JSONL bajo ~/.pi/agent/sessions/,
// siendo este archivo la fuente única de verdad. Cuando cualquier lado —
// CLI o cliente remoto — abre la sesión, reconstruye el historial completo
// de las entradas JSONL.

async function readPiSession(sessionId, { cursor, limit = 20 }) {
  const sessionPath = path.join(PI_SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionPath)) return { turns: [], cursor: null };
  // Lee líneas, reconstruye turns, aplica paginación
}
```

**Capacidades declaradas:**
```javascript
capabilities: {
  supportsGit: false,               // pi no tiene git integrado; usar git-handler del bridge
  supportsWorktrees: false,
  supportsCheckpoints: false,
  supportsVoice: false,
  supportsSubagents: false,         // pi no tiene subagentes nativos
  supportsPlanMode: false,
  supportsMultipleProjects: true,
  supportsThreadFork: false,
  sessionsFormat: 'jsonl',
}
```

---

### 20.6 Base adapter — herencia y extensibilidad

```javascript
// src/adapters/base-adapter.js
// Todos los adaptadores heredan de esta clase base
// Proporciona implementaciones default para git (via git-handler)
// y workspace (via workspace-handler) cuando el agente no las tiene nativas

class BaseAgentAdapter {
  constructor(bridgeHandlers) {
    this.gitHandler = bridgeHandlers.git;
    this.workspaceHandler = bridgeHandlers.workspace;
  }

  // Git siempre se ejecuta en el bridge, independientemente del agente
  async gitStatus(cwd) { return this.gitHandler.handleGitStatus({ cwd }); }
  async gitCommit(params) { return this.gitHandler.handleGitCommit(params); }
  async gitPush(params) { return this.gitHandler.handleGitPush(params); }
  // ... resto de métodos git

  // Workspace siempre se lee del filesystem local
  async readFile(path) { return this.workspaceHandler.handleReadFile({ path }); }
  async readImage(path) { return this.workspaceHandler.handleReadImage({ path }); }
  // ... resto de métodos workspace

  // Métodos que cada adaptador DEBE implementar (abstract)
  async listThreads() { throw new Error('Not implemented'); }
  async startThread() { throw new Error('Not implemented'); }
  async sendTurn() { throw new Error('Not implemented'); }
  async getAuthStatus() { throw new Error('Not implemented'); }
}
```

---

## 21. Diseño de UI y sistema visual

### 21.1 Sistema de diseño

Uxnan usa un sistema de diseño propio basado en Material Design 3 con personalización específica para el contexto de terminal/código.

#### Paleta de colores

```dart
// lib/presentation/theme/colors.dart

class UxnanColors {
  // Primario — azul profundo (identidad del producto)
  static const primary = Color(0xFF1B6EF3);
  static const primaryContainer = Color(0xFF0D3A7A);
  static const onPrimary = Color(0xFFFFFFFF);

  // Secundario — verde terminal (código, éxito, Git)
  static const secondary = Color(0xFF00C896);
  static const secondaryContainer = Color(0xFF003D2C);
  static const onSecondary = Color(0xFF000000);

  // Error y warning
  static const error = Color(0xFFFF4D4D);
  static const warning = Color(0xFFFFA500);
  static const success = Color(0xFF00C896);

  // Superficies — dark-first (el 95% del uso es en dark mode)
  static const surface = Color(0xFF0F1117);         // fondo principal
  static const surfaceVariant = Color(0xFF1A1D27);  // tarjetas, paneles
  static const surfaceElevated = Color(0xFF22263A); // modales, sheets
  static const outline = Color(0xFF2E3347);         // bordes sutiles

  // Texto
  static const onSurface = Color(0xFFEAEBF0);
  static const onSurfaceMuted = Color(0xFF8892A4);
  static const onSurfaceDisabled = Color(0xFF444A5A);

  // Git específicos
  static const gitAdded = Color(0xFF3FB950);
  static const gitDeleted = Color(0xFFF85149);
  static const gitModified = Color(0xFFE3B341);
  static const gitUntracked = Color(0xFF58A6FF);

  // Estado de conexión
  static const connected = Color(0xFF3FB950);
  static const connecting = Color(0xFFFFA657);
  static const disconnected = Color(0xFFFF4D4D);
  static const syncing = Color(0xFF58A6FF);

  // Agentes (colores por proveedor)
  static const codexAgent = Color(0xFF00A67E);        // verde OpenAI
  static const openCodeAgent = Color(0xFF7C3AED);     // violeta
  static const claudeCodeAgent = Color(0xFFD97706);   // naranja Anthropic
  static const geminiCliAgent = Color(0xFF4285F4);    // azul Google
  static const piAgentColor = Color(0xFF2563EB);      // azul pi
}
```

#### Tipografía

```dart
// lib/presentation/theme/typography.dart

class UxnanTypography {
  // Fuente principal — Inter para UI
  static const fontFamily = 'Inter';
  // Fuente monoespaciada — JetBrains Mono para código
  static const monoFontFamily = 'JetBrainsMono';

  static const displayLarge = TextStyle(
    fontFamily: fontFamily, fontSize: 32, fontWeight: FontWeight.w700,
    color: UxnanColors.onSurface, letterSpacing: -0.5,
  );
  static const headlineMedium = TextStyle(
    fontFamily: fontFamily, fontSize: 20, fontWeight: FontWeight.w600,
    color: UxnanColors.onSurface,
  );
  static const titleSmall = TextStyle(
    fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w500,
    color: UxnanColors.onSurface,
  );
  static const bodyMedium = TextStyle(
    fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w400,
    color: UxnanColors.onSurface, height: 1.5,
  );
  static const bodySmall = TextStyle(
    fontFamily: fontFamily, fontSize: 12, fontWeight: FontWeight.w400,
    color: UxnanColors.onSurfaceMuted,
  );
  static const codeBody = TextStyle(
    fontFamily: monoFontFamily, fontSize: 13, fontWeight: FontWeight.w400,
    color: UxnanColors.onSurface, height: 1.6,
  );
  static const codeSmall = TextStyle(
    fontFamily: monoFontFamily, fontSize: 11, fontWeight: FontWeight.w400,
    color: UxnanColors.onSurfaceMuted,
  );
}
```

#### Espaciado y radios

```dart
// lib/presentation/theme/spacing.dart

class UxnanSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  static const xxxl = 48.0;
}

class UxnanRadius {
  static const sm = Radius.circular(4.0);
  static const md = Radius.circular(8.0);
  static const lg = Radius.circular(12.0);
  static const xl = Radius.circular(16.0);
  static const full = Radius.circular(999.0);
}
```

### 21.2 Componentes de UI críticos

#### ConnectionStatusIndicator

```dart
// lib/presentation/widgets/connection_status_indicator.dart
// Aparece en el AppBar de HomeScreen y ConversationScreen

class ConnectionStatusIndicator extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final phase = ref.watch(connectionPhaseProvider);
    return phase.when(
      data: (p) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7, height: 7,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _colorForPhase(p),
            ),
          ),
          const SizedBox(width: 6),
          Text(_labelForPhase(p), style: UxnanTypography.bodySmall),
        ],
      ),
      loading: () => const SizedBox(width: 16, height: 16,
          child: CircularProgressIndicator(strokeWidth: 2)),
      error: (_, __) => const Icon(Icons.error_outline, size: 16,
          color: UxnanColors.error),
    );
  }

  Color _colorForPhase(ConnectionPhase p) => switch (p) {
    ConnectionPhase.connected => UxnanColors.connected,
    ConnectionPhase.connecting ||
    ConnectionPhase.handshaking ||
    ConnectionPhase.syncing => UxnanColors.connecting,
    ConnectionPhase.reconnecting => UxnanColors.syncing,
    _ => UxnanColors.disconnected,
  };
}
```

#### ThreadListItem

```dart
// lib/presentation/screens/sidebar/thread_list_item.dart
// Ítem de thread en la lista lateral

class ThreadListItem extends StatelessWidget {
  final Thread thread;
  final bool isActive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.lg, vertical: UxnanSpacing.md),
        decoration: BoxDecoration(
          color: isActive
              ? UxnanColors.primaryContainer.withOpacity(0.4)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            // Indicador de agente (color por proveedor)
            _AgentDot(agentId: thread.agentId),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(thread.title.nonEmpty ?? 'Sin título',
                      style: UxnanTypography.titleSmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  if (thread.cwd != null)
                    Text(thread.cwd!.pathDisplayName,
                        style: UxnanTypography.codeSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            // Badge de estado (si syncing, error, etc.)
            ThreadStatusBadge(status: thread.status),
          ],
        ),
      ),
    );
  }
}
```

#### ComposerWidget

```dart
// lib/presentation/screens/conversation/composer/composer_widget.dart

class ComposerWidget extends ConsumerStatefulWidget { ... }

class _ComposerWidgetState extends ConsumerState<ComposerWidget> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;

  @override
  Widget build(BuildContext context) {
    final composerState = ref.watch(composerStateProvider);
    final canSend = ref.watch(canSendProvider);

    return Container(
      decoration: BoxDecoration(
        color: UxnanColors.surfaceVariant,
        border: Border(top: BorderSide(color: UxnanColors.outline, width: 1)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Fila de adjuntos (si hay)
          if (composerState.attachments.isNotEmpty)
            AttachmentRowWidget(attachments: composerState.attachments),

          // Overlay de autocompletado (menciones / archivos)
          if (composerState.showAutocomplete)
            AutocompleteOverlay(
              suggestions: composerState.autocompleteSuggestions,
              onSelect: (s) => ref.read(composerManagerProvider).selectSuggestion(s),
            ),

          // Fila principal: input + acciones
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // Botón adjuntar imagen
              IconButton(
                icon: const Icon(Icons.attach_file),
                onPressed: _pickImage,
                color: UxnanColors.onSurfaceMuted,
              ),

              // Campo de texto
              Expanded(
                child: TextField(
                  controller: _controller,
                  focusNode: _focusNode,
                  maxLines: null,
                  minLines: 1,
                  keyboardType: TextInputType.multiline,
                  style: UxnanTypography.bodyMedium,
                  decoration: const InputDecoration(
                    hintText: 'Escribe un mensaje...',
                    hintStyle: TextStyle(color: UxnanColors.onSurfaceDisabled),
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: UxnanSpacing.sm,
                      vertical: UxnanSpacing.md,
                    ),
                  ),
                  onChanged: (text) =>
                      ref.read(composerManagerProvider).updateDraft(text),
                ),
              ),

              // Botón de voz
              IconButton(
                icon: const Icon(Icons.mic_none),
                onPressed: _startVoiceInput,
                color: UxnanColors.onSurfaceMuted,
              ),

              // Botón de envío
              AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                child: IconButton(
                  icon: canSend
                      ? const Icon(Icons.send_rounded)
                      : composerState.isQueued
                          ? const Icon(Icons.schedule)
                          : const Icon(Icons.send_rounded),
                  onPressed: canSend || composerState.isQueued
                      ? () => ref.read(composerManagerProvider).send()
                      : null,
                  color: canSend ? UxnanColors.primary : UxnanColors.onSurfaceDisabled,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
```

### 21.3 Layouts responsive

```dart
// lib/presentation/screens/shell/app_shell_screen.dart
// La shell detecta el ancho y decide el layout

class AppShellScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;

    // < 600dp: layout móvil (nav drawer o bottom nav)
    if (width < 600) {
      return _MobileLayout();
    }
    // >= 600dp: layout tablet (NavigationRail + panel lateral)
    return _TabletLayout();
  }
}

class _MobileLayout extends StatelessWidget {
  // Navegación: Scaffold + Drawer para sidebar
  // ConversationScreen ocupa toda la pantalla
}

class _TabletLayout extends StatelessWidget {
  // NavigationRail lateral fijo (72dp)
  // SidebarPanel (280dp) + ConversationScreen (resto)
  // Implementado con Row + Expanded
}
```

---

## 22. Plan de pruebas

### 22.1 Estrategia de testing

La estrategia sigue la pirámide de testing: más unit tests, menos tests de integración, menos aún de UI.

```
         ┌─────────────────┐
         │  E2E / UI Tests │  ← 10%  (integration_test/)
         ├─────────────────┤
         │  Widget Tests   │  ← 30%  (test/widget/)
         ├─────────────────┤
         │   Unit Tests    │  ← 60%  (test/unit/)
         └─────────────────┘
```

### 22.2 Tests unitarios

#### Dominio — entidades y value objects

```dart
// test/unit/domain/entities/thread_test.dart
void main() {
  group('Thread', () {
    test('debe crear thread con valores válidos', () {
      final thread = Thread(
        id: 'thread-1',
        title: 'Mi conversación',
        agentId: AgentId.opencode.name,
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
      );
      expect(thread.id, 'thread-1');
      expect(thread.syncState, ThreadSyncState.synced);
    });
  });
}

// test/unit/domain/value_objects/rpc_message_test.dart
void main() {
  group('RpcMessage', () {
    test('isRequest debe ser true cuando tiene id y method', () {
      final msg = RpcMessage(jsonrpc: '2.0', id: '1', method: 'thread/list');
      expect(msg.isRequest, isTrue);
    });
    test('isNotification cuando no tiene id', () {
      final msg = RpcMessage(jsonrpc: '2.0', method: 'stream/turn/started');
      expect(msg.isNotification, isTrue);
    });
  });
}
```

#### Infraestructura — transporte

```dart
// test/unit/infrastructure/transport/request_correlator_test.dart
void main() {
  group('RequestCorrelator', () {
    test('debe resolver request con la response correcta', () async {
      final correlator = RequestCorrelator(timeout: Duration(seconds: 5));
      final request = RpcMessage(jsonrpc: '2.0', id: 'req-1', method: 'thread/list');
      final mockTransport = MockWebSocketTransport();
      final future = correlator.send(request, mockTransport);
      correlator.resolve(RpcMessage(jsonrpc: '2.0', id: 'req-1',
          result: {'threads': []}));
      final response = await future;
      expect(response.result, isNotNull);
    });

    test('debe lanzar TimeoutException después del timeout', () async {
      final correlator = RequestCorrelator(timeout: Duration(milliseconds: 50));
      final request = RpcMessage(jsonrpc: '2.0', id: 'req-2', method: 'thread/list');
      final mockTransport = MockWebSocketTransport();
      await expectLater(
        correlator.send(request, mockTransport),
        throwsA(isA<TimeoutException>()),
      );
    });

    test('rejectAll debe rechazar todas las continuations', () async {
      final correlator = RequestCorrelator(timeout: Duration(seconds: 30));
      final mockTransport = MockWebSocketTransport();
      final f1 = correlator.send(
          RpcMessage(jsonrpc: '2.0', id: 'r1', method: 'm'), mockTransport);
      final f2 = correlator.send(
          RpcMessage(jsonrpc: '2.0', id: 'r2', method: 'm'), mockTransport);
      correlator.rejectAll(Exception('disconnected'));
      await expectLater(f1, throwsException);
      await expectLater(f2, throwsException);
    });
  });
}
```

#### Criptografía — handshake

```dart
// test/unit/infrastructure/crypto/handshake_crypto_test.dart
void main() {
  group('HandshakeCrypto', () {
    test('debe derivar la misma clave en ambos lados', () async {
      final phoneKey = await generateX25519KeyPair();
      final macKey = await generateX25519KeyPair();
      final clientNonce = generateRandomBytes(32);
      final serverNonce = generateRandomBytes(32);

      final phoneShared = await x25519(phoneKey.privateKey, macKey.publicKey);
      final macShared = await x25519(macKey.privateKey, phoneKey.publicKey);
      expect(phoneShared, macShared);

      final salt = Uint8List.fromList([...clientNonce, ...serverNonce]);
      final phoneKey256 = await hkdfDerive(phoneShared, salt, 'uxnan-e2ee-v1', 32);
      final macKey256 = await hkdfDerive(macShared, salt, 'uxnan-e2ee-v1', 32);
      expect(phoneKey256, macKey256);
    });

    test('debe verificar firma Ed25519 del transcript', () async {
      final identityKey = await generateEd25519KeyPair();
      final transcript = buildTranscript(
        clientNonce: generateRandomBytes(32),
        phoneEphemeralPubKey: generateRandomBytes(32),
        macEphemeralPubKey: generateRandomBytes(32),
        serverNonce: generateRandomBytes(32),
        sessionId: 'session-uuid',
        keyEpoch: 1,
        expiresAt: DateTime.now().add(Duration(minutes: 5)),
      );
      final signature = await ed25519Sign(identityKey.privateKey, transcript);
      final valid = await ed25519Verify(identityKey.publicKey, transcript, signature);
      expect(valid, isTrue);
    });
  });
}
```

#### Deduplicación de mensajes

```dart
// test/unit/application/processors/message_deduplicator_test.dart
void main() {
  group('MessageDeduplicator', () {
    test('debe ignorar mensajes con mismo fingerprint', () {
      final dedup = MessageDeduplicator();
      final m1 = buildMessage(content: 'hola mundo');
      final m2 = buildMessage(content: 'hola mundo');  // mismo contenido
      expect(dedup.isDuplicate(m1), isFalse);
      expect(dedup.isDuplicate(m2), isTrue);
    });

    test('debe aceptar mensajes con diferente contenido', () {
      final dedup = MessageDeduplicator();
      final m1 = buildMessage(content: 'mensaje 1');
      final m2 = buildMessage(content: 'mensaje 2');
      expect(dedup.isDuplicate(m1), isFalse);
      expect(dedup.isDuplicate(m2), isFalse);
    });
  });
}
```

### 22.3 Tests de widgets

```dart
// test/widget/presentation/screens/conversation/composer_widget_test.dart
void main() {
  testWidgets('ComposerWidget muestra botón de envío deshabilitado sin conexión',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          connectionPhaseProvider.overrideWith((_) =>
              Stream.value(ConnectionPhase.disconnected)),
          composerStateProvider.overrideWith((_) => ComposerState.initial()),
        ],
        child: const MaterialApp(home: Scaffold(body: ComposerWidget())),
      ),
    );
    final sendButton = find.byIcon(Icons.send_rounded);
    expect(tester.widget<IconButton>(sendButton).onPressed, isNull);
  });

  testWidgets('ComposerWidget envía el mensaje al presionar send', (tester) async {
    final mockComposer = MockComposerManager();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          composerManagerProvider.overrideWithValue(mockComposer),
          connectionPhaseProvider.overrideWith((_) =>
              Stream.value(ConnectionPhase.connected)),
        ],
        child: const MaterialApp(home: Scaffold(body: ComposerWidget())),
      ),
    );
    await tester.enterText(find.byType(TextField), 'Hola agente');
    await tester.tap(find.byIcon(Icons.send_rounded));
    verify(mockComposer.send()).called(1);
  });
}

// test/widget/presentation/screens/sidebar/thread_list_item_test.dart
void main() {
  testWidgets('ThreadListItem muestra el título del thread', (tester) async {
    final thread = Thread(id: 't1', title: 'Mi proyecto', agentId: 'opencode',
        syncState: ThreadSyncState.synced, status: ThreadStatus.active);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ThreadListItem(thread: thread, isActive: false, onTap: () {}),
        ),
      ),
    );
    expect(find.text('Mi proyecto'), findsOneWidget);
  });
}
```

### 22.4 Tests de integración

```dart
// integration_test/connection_flow_test.dart
// Requiere un bridge real o un mock server corriendo localmente

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Flujo completo: pairing → conexión → thread list',
      (tester) async {
    // Lanzar un mock bridge server en localhost
    final mockBridge = await MockBridgeServer.start(port: 18080);

    await tester.pumpWidget(const UxnanApp());
    await tester.pumpAndSettle();

    // Verificar que se muestra el onboarding
    expect(find.byType(OnboardingScreen), findsOneWidget);

    // Simular escaneo de QR con payload del mock bridge
    final payload = mockBridge.generatePairingPayload();
    await tester.tap(find.text('Escanear QR'));
    await tester.pumpAndSettle();

    // Inyectar payload como si viniera del scanner
    final scannerKey = find.byKey(const Key('qr_scanner'));
    await tester.pumpWidget(
      // Override del scanner con el payload simulado
      ...
    );

    // Esperar handshake
    await tester.pumpAndSettle(const Duration(seconds: 3));

    // Verificar que llegamos a HomeScreen conectados
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.byIcon(Icons.circle, color: UxnanColors.connected), findsOneWidget);

    // Verificar que la lista de threads está presente
    expect(find.byType(ThreadListItem), findsWidgets);

    await mockBridge.stop();
  });
}
```

---

## 23. Estrategia de build y CI/CD

### 23.1 Configuración de pubspec.yaml

```yaml
name: uxnan
description: Remote mobile client for AI coding agents
version: 1.0.0+1
publish_to: none

environment:
  sdk: '>=3.4.0 <4.0.0'
  flutter: '>=3.22.0'

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter

  # Estado
  flutter_riverpod: ^2.5.1
  riverpod_annotation: ^2.3.5

  # Navegación
  go_router: ^14.2.7

  # Red
  web_socket_channel: ^3.0.1
  dio: ^5.4.3+1
  connectivity_plus: ^6.0.3

  # Almacenamiento
  drift: ^2.18.0
  drift_flutter: ^0.1.0
  flutter_secure_storage: ^9.2.2
  shared_preferences: ^2.3.2
  path_provider: ^2.1.3

  # Criptografía
  cryptography: ^2.7.0
  cryptography_flutter: ^2.3.2
  pointycastle: ^3.9.1

  # UI
  flutter_markdown: ^0.7.3
  flutter_highlight: ^0.7.0
  flutter_inappwebview: ^6.0.0
  cached_network_image: ^3.3.1
  shimmer: ^3.0.0
  lottie: ^3.1.0

  # Cámara y QR
  mobile_scanner: ^5.1.1

  # Permisos
  permission_handler: ^11.3.1
  image_picker: ^1.1.2
  file_picker: ^8.1.2

  # Notificaciones
  firebase_core: ^3.6.0
  firebase_messaging: ^15.1.3
  flutter_local_notifications: ^17.2.3

  # SSH Terminal
  dartssh2: ^2.9.0
  xterm: ^4.2.0

  # Utilidades
  uuid: ^4.4.2
  equatable: ^2.0.5
  freezed_annotation: ^2.4.2
  json_annotation: ^4.9.0
  intl: ^0.19.0
  collection: ^1.18.0
  async: ^2.11.0
  rxdart: ^0.28.0
  vibration: ^2.0.0
  logger: ^2.4.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  integration_test:
    sdk: flutter
  riverpod_generator: ^2.4.3
  build_runner: ^2.4.12
  drift_dev: ^2.18.0
  freezed: ^2.5.7
  json_serializable: ^6.8.0
  mockito: ^5.4.4
  build_verify: ^3.1.0
  flutter_lints: ^4.0.0
  very_good_analysis: ^6.0.0

flutter:
  uses-material-design: true
  generate: true   # para l10n
  assets:
    - assets/fonts/Inter/
    - assets/fonts/JetBrainsMono/
    - assets/images/
    - assets/animations/lottie/
  fonts:
    - family: Inter
      fonts:
        - asset: assets/fonts/Inter/Inter-Regular.ttf
        - asset: assets/fonts/Inter/Inter-Medium.ttf
          weight: 500
        - asset: assets/fonts/Inter/Inter-SemiBold.ttf
          weight: 600
        - asset: assets/fonts/Inter/Inter-Bold.ttf
          weight: 700
    - family: JetBrainsMono
      fonts:
        - asset: assets/fonts/JetBrainsMono/JetBrainsMono-Regular.ttf
        - asset: assets/fonts/JetBrainsMono/JetBrainsMono-Medium.ttf
          weight: 500
```

### 23.2 Scripts de build

```bash
# Generación de código (ejecutar antes de cada build)
flutter pub run build_runner build --delete-conflicting-outputs

# Build Android APK (release)
flutter build apk --release --split-per-abi

# Build Android AAB (Play Store)
flutter build appbundle --release

# Build iOS IPA (App Store)
flutter build ipa --release

# Tests
flutter test
flutter test integration_test/ --device-id=<device_id>

# Análisis de código
flutter analyze
dart format --set-exit-if-changed lib/ test/
```

### 23.3 Pipeline CI/CD (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.22.0' }
      - run: flutter pub get
      - run: flutter pub run build_runner build --delete-conflicting-outputs
      - run: flutter analyze --no-fatal-infos
      - run: dart format --output=none --set-exit-if-changed lib/ test/

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.22.0' }
      - run: flutter pub get
      - run: flutter pub run build_runner build --delete-conflicting-outputs
      - run: flutter test --coverage
      - uses: codecov/codecov-action@v4

  build-android:
    runs-on: ubuntu-latest
    needs: [analyze, test]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.22.0' }
      - run: flutter pub get
      - run: flutter pub run build_runner build --delete-conflicting-outputs
      - run: flutter build apk --release --split-per-abi
      - uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: build/app/outputs/flutter-apk/

  build-ios:
    runs-on: macos-15
    needs: [analyze, test]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.22.0' }
      - run: flutter pub get
      - run: flutter pub run build_runner build --delete-conflicting-outputs
      - run: flutter build ios --release --no-codesign
```

---

## 24. Guía de contribución al bridge

### 24.1 Agregar un nuevo adaptador de agente

Para agregar soporte a un nuevo agente de codificación en el bridge, se deben seguir estos pasos:

**Paso 1: Crear el archivo del adaptador**

```
uxnan-bridge/src/adapters/mi-agente-adapter.js
```

**Paso 2: Extender BaseAgentAdapter**

```javascript
const BaseAgentAdapter = require('./base-adapter');

class MiAgenteAdapter extends BaseAgentAdapter {
  constructor(bridgeHandlers) {
    super(bridgeHandlers);
    this.agentId = 'mi-agente';           // identificador único
    this.displayName = 'Mi Agente CLI';
    this.capabilities = {
      supportsGit: false,                 // el bridge gestiona git
      supportsWorktrees: false,
      supportsCheckpoints: false,
      supportsVoice: false,
      supportsSubagents: false,
      supportsPlanMode: false,
      supportsMultipleProjects: true,
      supportsThreadFork: false,
      sessionsFormat: 'jsonl',
    };
  }

  async initialize(config) {
    // Verificar que el binario del agente existe
    this.binaryPath = await this._resolveBinary(config.binaryPath, [
      '/usr/local/bin/mi-agente',
      path.join(process.env.HOME, '.local/bin/mi-agente'),
    ]);
    this.config = config;
  }

  async listThreads({ projectId } = {}) {
    // Implementar: retornar lista de threads en formato Uxnan
    // [{ id, title, cwd, status, lastActivity, agentId: this.agentId }]
  }

  async startThread({ cwd, message, projectId }) {
    // Implementar: iniciar nueva conversación
  }

  async sendTurn(threadId, { content }) {
    // Implementar: enviar mensaje al agente
    // Debe emitir eventos de dominio a través de this.emitDomainEvent()
  }

  async getAuthStatus() {
    // Implementar: retornar estado de auth sanitizado
    return {
      agentId: this.agentId,
      requiresLogin: false,
      authenticatedProvider: null,
    };
  }
}

module.exports = MiAgenteAdapter;
```

**Paso 3: Registrar en handler-router.js**

```javascript
// src/handler-router.js
const adapters = {
  codex: require('./adapters/codex-adapter'),
  opencode: require('./adapters/opencode-adapter'),
  'claude-code': require('./adapters/claude-code-adapter'),
  'gemini-cli': require('./adapters/gemini-cli-adapter'),
  'pi-agent': require('./adapters/pi-agent-adapter'),
  'mi-agente': require('./adapters/mi-agente-adapter'),   // ← nuevo
};
```

**Paso 4: Declarar en la documentación de la app**

Agregar el nuevo agente a la lista de `AgentId` en la app Flutter:

```dart
// lib/domain/enums/agent_id.dart
enum AgentId {
  codex,
  opencode,
  claudeCode,
  geminiCli,
  piAgent,
  miAgente,    // ← nuevo
  custom,
}
```

### 24.2 Convenciones del bridge

- **Sanitización obligatoria:** cualquier respuesta que contenga tokens, API keys, o credenciales debe sanitizarse antes de enviarse al teléfono. Usar `account-status.js` como referencia.
- **Errores tipados:** siempre retornar errores como `{ code: -32XXX, message: "...", data: { agentId, originalError: "..." } }` — nunca strings crudos.
- **No blocking:** los handlers deben ser asíncronos y no bloquear el event loop de Node.js.
- **Buffer de outbound:** el bridge automáticamente bufferea todo lo que envía al teléfono en `secure-transport.js`. No es responsabilidad del adaptador.
- **Paths absolutos:** siempre resolver paths relativos a absolutos antes de operar con el filesystem.

---

## 25. Internacionalización (i18n)

### 25.1 Archivos ARB

```json
// l10n/app_es.arb
{
  "@@locale": "es",
  "appTitle": "Uxnan",
  "connectionConnected": "Conectado",
  "connectionConnecting": "Conectando...",
  "connectionDisconnected": "Desconectado",
  "connectionHandshaking": "Estableciendo sesión segura...",
  "connectionReconnecting": "Reconectando...",
  "connectionSyncing": "Sincronizando...",
  "onboardingWelcomeTitle": "Controla tus agentes desde cualquier lugar",
  "onboardingWelcomeSubtitle": "Uxnan te conecta con los agentes de codificación IA que corren en tu PC, de forma segura y sin intermediarios.",
  "onboardingInstallStep": "Instala el bridge en tu PC",
  "onboardingInstallCommand": "npm install -g uxnan-bridge",
  "onboardingScanQrTitle": "Escanea el QR de tu PC",
  "onboardingScanQrSubtitle": "Ejecuta uxnan-bridge qr en tu PC para ver el código QR",
  "pairingScanButtonLabel": "Escanear QR",
  "pairingManualCodeLabel": "Ingresar código manual",
  "pairingExpiredError": "El código QR ha expirado. Genera uno nuevo con uxnan-bridge qr",
  "pairingInvalidError": "Código QR no válido",
  "pairingBridgeUpdateRequired": "Actualiza el bridge antes de continuar",
  "threadsEmptyTitle": "No hay conversaciones",
  "threadsEmptySubtitle": "Inicia una nueva conversación con tu agente desde el botón +",
  "composerPlaceholder": "Escribe un mensaje...",
  "composerSendQueued": "Se enviará al conectar",
  "gitCommitDialogTitle": "Commit",
  "gitCommitMessageLabel": "Mensaje de commit",
  "gitCommitButton": "Confirmar",
  "gitPushButton": "Publicar",
  "gitPullButton": "Actualizar",
  "gitCreateBranchButton": "Nueva rama",
  "gitRevertButton": "Revertir cambios",
  "gitNothingToCommit": "No hay cambios para commitear",
  "gitBranchProtected": "Esta rama está protegida",
  "gitConflictsDetected": "Hay conflictos de merge",
  "settingsTitle": "Configuración",
  "settingsConnection": "Conexión",
  "settingsAgents": "Agentes",
  "settingsNotifications": "Notificaciones",
  "settingsAbout": "Acerca de Uxnan",
  "devicesTitle": "Mis equipos",
  "devicesConnect": "Conectar",
  "devicesRemove": "Eliminar",
  "devicesAddNew": "Agregar equipo",
  "projectsTitle": "Proyectos",
  "projectsAdd": "Nuevo proyecto",
  "terminalTitle": "Terminal SSH",
  "terminalConnect": "Conectar",
  "terminalDisconnect": "Desconectar",
  "errorGeneric": "Ocurrió un error. Intenta de nuevo.",
  "errorAgentNotRunning": "El agente no está corriendo en tu PC",
  "errorBridgeVersionIncompatible": "Versión del bridge incompatible. Actualiza con: npm update -g uxnan-bridge",
  "errorSessionExpired": "La sesión expiró. Vuelve a conectar."
}
```

```json
// l10n/app_en.arb
{
  "@@locale": "en",
  "appTitle": "Uxnan",
  "connectionConnected": "Connected",
  "connectionConnecting": "Connecting...",
  "connectionDisconnected": "Disconnected",
  "connectionHandshaking": "Establishing secure session...",
  "connectionReconnecting": "Reconnecting...",
  "connectionSyncing": "Syncing...",
  "onboardingWelcomeTitle": "Control your agents from anywhere",
  "onboardingWelcomeSubtitle": "Uxnan securely connects you to AI coding agents running on your PC, with no intermediaries.",
  "onboardingInstallStep": "Install the bridge on your PC",
  "onboardingInstallCommand": "npm install -g uxnan-bridge",
  "onboardingScanQrTitle": "Scan the QR from your PC",
  "onboardingScanQrSubtitle": "Run uxnan-bridge qr on your PC to see the pairing QR code",
  "pairingScanButtonLabel": "Scan QR",
  "pairingManualCodeLabel": "Enter manual code",
  "pairingExpiredError": "QR code has expired. Generate a new one with uxnan-bridge qr",
  "pairingInvalidError": "Invalid QR code",
  "pairingBridgeUpdateRequired": "Update the bridge before continuing",
  "threadsEmptyTitle": "No conversations yet",
  "threadsEmptySubtitle": "Start a new conversation with your agent using the + button",
  "composerPlaceholder": "Write a message...",
  "composerSendQueued": "Will send when connected",
  "gitCommitDialogTitle": "Commit",
  "gitCommitMessageLabel": "Commit message",
  "gitCommitButton": "Commit",
  "gitPushButton": "Push",
  "gitPullButton": "Pull",
  "gitCreateBranchButton": "New branch",
  "gitRevertButton": "Revert changes",
  "gitNothingToCommit": "Nothing to commit",
  "gitBranchProtected": "This branch is protected",
  "gitConflictsDetected": "Merge conflicts detected",
  "settingsTitle": "Settings",
  "settingsConnection": "Connection",
  "settingsAgents": "Agents",
  "settingsNotifications": "Notifications",
  "settingsAbout": "About Uxnan",
  "devicesTitle": "My devices",
  "devicesConnect": "Connect",
  "devicesRemove": "Remove",
  "devicesAddNew": "Add device",
  "projectsTitle": "Projects",
  "projectsAdd": "New project",
  "terminalTitle": "SSH Terminal",
  "terminalConnect": "Connect",
  "terminalDisconnect": "Disconnect",
  "errorGeneric": "An error occurred. Please try again.",
  "errorAgentNotRunning": "The agent is not running on your PC",
  "errorBridgeVersionIncompatible": "Bridge version incompatible. Update with: npm update -g uxnan-bridge",
  "errorSessionExpired": "Session expired. Reconnect to continue."
}
```

### 25.2 Configuración de l10n

```yaml
# l10n.yaml (raíz del proyecto)
arb-dir: l10n
template-arb-file: app_es.arb
output-localization-file: app_localizations.dart
output-class: AppLocalizations
preferred-supported-locales: [es, en]
```

---

## 26. Manifiesto de permisos

### 26.1 Android (`AndroidManifest.xml`)

```xml
<!-- Permisos obligatorios -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.VIBRATE" />

<!-- Notificaciones push (Android 13+) -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- Para FCM background -->
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />

<!-- Features requeridas -->
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

### 26.2 iOS (`Info.plist`)

```xml
<!-- Cámara — requerida para escaneo de QR -->
<key>NSCameraUsageDescription</key>
<string>Uxnan necesita la cámara para escanear el código QR de tu PC y establecer la conexión segura.</string>

<!-- Red local — requerida para conexión LAN directa al bridge -->
<key>NSLocalNetworkUsageDescription</key>
<string>Uxnan necesita acceso a la red local para conectarse directamente al bridge instalado en tu PC cuando ambos están en la misma red Wi-Fi.</string>
<key>NSBonjourServices</key>
<array>
    <string>_uxnan-bridge._tcp</string>
</array>

<!-- Micrófono — para voice input (feature post-MVP) -->
<key>NSMicrophoneUsageDescription</key>
<string>Uxnan puede usar el micrófono para enviar mensajes de voz a tu agente de codificación.</string>

<!-- Notificaciones push -->
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>remote-notification</string>
</array>

<!-- Firebase Google Service -->
<key>GOOGLE_APP_ID</key>
<string><!-- ver GoogleService-Info.plist --></string>
```

---

## 27. Consideraciones de despliegue y auto-hosting

### 27.1 Relay auto-hospedado

El relay puede desplegarse en cualquier VPS con Node.js 18+. Configuración mínima recomendada:

```
VPS: 1 vCPU, 512 MB RAM, 10 GB SSD
OS: Ubuntu 22.04 LTS
Puerto: 8080 (o 443 con TLS termination en nginx)
```

Ejemplo de setup con nginx como reverse proxy:

```nginx
# /etc/nginx/sites-available/uxnan-relay
server {
    listen 443 ssl;
    server_name relay.midominio.com;

    ssl_certificate /etc/letsencrypt/live/relay.midominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.midominio.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;   # WebSocket keepalive
    }
}
```

Configuración del relay para este escenario:

```bash
# .env del relay
PORT=8080
TRUST_PROXY=true
# ... resto de variables de APNs y FCM
```

En la app, el usuario configura la URL de su relay auto-hospedado en Settings → Conexión → URL del relay.

### 27.2 Relay oficial de Uxnan

Uxnan provee un relay oficial en `wss://relay.uxnan.io` para los usuarios que no quieren self-host. Este relay:
- Solo ve sessionId, tamaño de envelopes cifrados y tokens push.
- No almacena contenido de conversaciones.
- Cumple con GDPR por no procesar datos personales del contenido.
- Tiene SLA de 99.5% uptime.

---

## 28. Roadmap de versiones

### v1.0 — MVP

- Pairing QR y trusted reconnect
- Conexión E2EE con bridge
- Threads y conversación básica (texto)
- Streaming de respuestas
- Reconexión automática con catch-up
- Push notifications (turno completado)
- Git básico: status, diff, commit, push
- Agentes soportados: Codex, OpenCode
- Android + iOS

### v1.1 — Completitud de agentes

- Soporte Claude Code
- Soporte Gemini CLI
- Soporte pi-agent
- Mejorar diff viewer (syntax highlighting por lenguaje)
- Slash commands en composer

### v1.2 — Workspace y Git avanzado

- Workspace file browser
- Checkpoints (captura/diff/restore)
- Worktrees administrados
- Stacked publish (commit + push + PR draft)
- Revert de cambios del asistente

### v1.3 — SSH Terminal y multi-proyecto

- SSH Terminal con xterm
- Gestión de múltiples proyectos por PC
- Fork de threads
- Búsqueda en historial de threads

### v2.0 — Features avanzados

- Voice input (STT local o cloud)
- Plan mode interactivo
- Subagentes visibles en UI
- Tablet layout
- Custom agent adapter (plugin system para el bridge)
- Self-hosted relay setup wizard en la app

---

## 29. Manejo de errores y recuperación

### 29.1 Taxonomía de errores de la app

Todos los errores de la app se tipan en una jerarquía sellada que permite manejo exhaustivo en la UI:

```dart
// lib/core/errors/app_exception.dart

sealed class AppException implements Exception {
  final String message;
  final String? technicalDetail;
  const AppException(this.message, {this.technicalDetail});
}

// Errores de transporte
final class TransportException extends AppException {
  final TransportErrorKind kind;
  const TransportException(super.message, this.kind, {super.technicalDetail});
}

enum TransportErrorKind {
  webSocketClosed,
  webSocketError,
  relayUnreachable,
  bridgeUnreachable,
  timeout,
  invalidMessage,
}

// Errores de handshake / sesión
final class HandshakeException extends AppException {
  final HandshakeErrorKind kind;
  const HandshakeException(super.message, this.kind, {super.technicalDetail});
}

enum HandshakeErrorKind {
  invalidSignature,
  versionMismatch,
  sessionExpired,
  clockSkewExceeded,
  unknownDevice,
  qrExpired,
  qrInvalid,
  bridgeUpdateRequired,
}

// Errores de protocolo / RPC
final class RpcException extends AppException {
  final int code;
  final RpcErrorKind kind;
  const RpcException(super.message, this.code, this.kind, {super.technicalDetail});

  factory RpcException.fromCode(int code, String message, {String? detail}) {
    final kind = switch (code) {
      -32001 => RpcErrorKind.authRequired,
      -32002 => RpcErrorKind.agentNotRunning,
      -32003 => RpcErrorKind.gitOperationFailed,
      -32004 => RpcErrorKind.workspaceAccessDenied,
      -32005 => RpcErrorKind.bridgeVersionIncompatible,
      -32006 => RpcErrorKind.sessionExpired,
      -32007 => RpcErrorKind.confirmationRequired,
      -32008 => RpcErrorKind.resourceNotFound,
      _ => RpcErrorKind.unknown,
    };
    return RpcException(message, code, kind, technicalDetail: detail);
  }
}

enum RpcErrorKind {
  authRequired,
  agentNotRunning,
  gitOperationFailed,
  workspaceAccessDenied,
  bridgeVersionIncompatible,
  sessionExpired,
  confirmationRequired,
  resourceNotFound,
  unknown,
}

// Errores de pairing
final class PairingException extends AppException {
  final PairingErrorKind kind;
  const PairingException(super.message, this.kind, {super.technicalDetail});
}

enum PairingErrorKind {
  qrExpired,
  qrInvalid,
  qrVersionMismatch,
  bridgeUpdateRequired,
  alreadyPaired,
  networkUnavailable,
}

// Errores de Git
final class GitException extends AppException {
  final GitErrorKind kind;
  const GitException(super.message, this.kind, {super.technicalDetail});
}

enum GitErrorKind {
  nothingToCommit,
  branchProtected,
  mergeConflicts,
  noRemote,
  notARepo,
  pushRejected,
  worktreeAlreadyExists,
  unknown,
}

// Errores de almacenamiento
final class StorageException extends AppException {
  const StorageException(super.message, {super.technicalDetail});
}

// Errores de permisos
final class PermissionException extends AppException {
  final PermissionErrorKind kind;
  const PermissionException(super.message, this.kind);
}

enum PermissionErrorKind { camera, notifications, microphone, localNetwork }
```

### 29.2 Error boundaries en la UI

```dart
// lib/presentation/widgets/error_boundary.dart
// Wrapper para capturar y mostrar errores de forma amigable en cualquier widget

class ErrorBoundary extends StatelessWidget {
  final Widget child;
  final Widget Function(AppException error, VoidCallback retry)? errorBuilder;

  const ErrorBoundary({required this.child, this.errorBuilder, super.key});

  @override
  Widget build(BuildContext context) {
    return child; // En producción, wrappear con ErrorWidget.builder customizado
  }
}

// Registro global del error builder en main.dart
ErrorWidget.builder = (FlutterErrorDetails details) {
  return ErrorCardWidget(
    message: 'Algo salió mal en esta sección',
    onRetry: () => details.context?.markNeedsBuild(),
  );
};
```

### 29.3 Recovery card de conexión

Cuando la app pierde la conexión, en lugar de bloquear la UI entera, se muestra un banner no-intrusivo en la ConversationScreen:

```dart
// lib/presentation/screens/conversation/support/connection_recovery_card.dart

class ConnectionRecoveryCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final phase = ref.watch(connectionPhaseProvider).valueOrNull;
    if (phase == ConnectionPhase.connected) return const SizedBox.shrink();

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
      padding: const EdgeInsets.all(UxnanSpacing.md),
      margin: const EdgeInsets.all(UxnanSpacing.sm),
      decoration: BoxDecoration(
        color: _bgColor(phase),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _borderColor(phase)),
      ),
      child: Row(
        children: [
          _IconForPhase(phase: phase),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(child: _MessageForPhase(phase: phase)),
          if (phase == ConnectionPhase.disconnected || phase == ConnectionPhase.error)
            TextButton(
              onPressed: () => ref.read(sessionCoordinatorProvider).connect(),
              child: Text(AppLocalizations.of(context).reconnect),
            ),
          if (phase == ConnectionPhase.reconnecting)
            const SizedBox(
              width: 16, height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
        ],
      ),
    );
  }
}
```

### 29.4 Errores Git — mensajes de producto

```dart
// lib/presentation/screens/conversation/git/git_error_mapper.dart

class GitErrorMapper {
  static String toProductMessage(GitException e, BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return switch (e.kind) {
      GitErrorKind.nothingToCommit => l10n.gitNothingToCommit,
      GitErrorKind.branchProtected => l10n.gitBranchProtected,
      GitErrorKind.mergeConflicts => l10n.gitConflictsDetected,
      GitErrorKind.noRemote => 'No hay un remote configurado para esta rama',
      GitErrorKind.notARepo => 'Este directorio no es un repositorio Git',
      GitErrorKind.pushRejected => 'El push fue rechazado. ¿Necesitas hacer pull primero?',
      GitErrorKind.worktreeAlreadyExists => 'Ya existe un worktree con ese nombre',
      GitErrorKind.unknown => '${l10n.errorGeneric}: ${e.technicalDetail ?? ''}',
    };
  }
}
```

---

## 30. Modelos de base de datos (Drift)

### 30.1 Definición completa de tablas

```dart
// lib/infrastructure/storage/tables/threads_table.dart
@DataClassName('ThreadRow')
class ThreadsTable extends Table {
  TextColumn get id => text()();
  TextColumn get title => text()();
  TextColumn get projectId => text().nullable()();
  TextColumn get cwd => text().nullable()();
  TextColumn get worktreePath => text().nullable()();
  TextColumn get agentId => text()();
  TextColumn get syncState => text()();       // serializado como string del enum
  TextColumn get status => text()();
  IntColumn get lastActivityMs => integer().nullable()();
  IntColumn get createdAtMs => integer()();

  @override
  Set<Column> get primaryKey => {id};
}

// lib/infrastructure/storage/tables/messages_table.dart
@DataClassName('MessageRow')
class MessagesTable extends Table {
  TextColumn get id => text()();
  TextColumn get threadId => text()();
  TextColumn get turnId => text()();
  TextColumn get role => text()();             // MessageRole serializado
  TextColumn get contentsJson => text()();     // List<MessageContent> como JSON
  TextColumn get deliveryState => text()();
  IntColumn get orderIndex => integer()();
  TextColumn get fingerprint => text().nullable()();
  IntColumn get createdAtMs => integer()();

  @override
  Set<Column> get primaryKey => {id};
  @override
  List<Index> get indexes => [
    Index('idx_messages_thread_id', [threadId, orderIndex]),
  ];
}

// lib/infrastructure/storage/tables/turns_table.dart
@DataClassName('TurnRow')
class TurnsTable extends Table {
  TextColumn get id => text()();
  TextColumn get threadId => text()();
  TextColumn get status => text()();
  TextColumn get gitProgressJson => text().nullable()();
  TextColumn get subagentStateJson => text().nullable()();
  TextColumn get planStateJson => text().nullable()();
  IntColumn get startedAtMs => integer()();
  IntColumn get completedAtMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
  @override
  List<Index> get indexes => [
    Index('idx_turns_thread_id', [threadId]),
  ];
}

// lib/infrastructure/storage/tables/projects_table.dart
@DataClassName('ProjectRow')
class ProjectsTable extends Table {
  TextColumn get id => text()();
  TextColumn get displayName => text()();
  TextColumn get cwd => text()();
  TextColumn get agentId => text()();
  TextColumn get agentConfigJson => text()();  // AgentConfig serializada
  IntColumn get lastActiveMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

// lib/infrastructure/storage/tables/trusted_devices_table.dart
@DataClassName('TrustedDeviceRow')
class TrustedDevicesTable extends Table {
  TextColumn get macDeviceId => text()();
  TextColumn get displayName => text()();
  // macIdentityPublicKey se guarda en SecureStore, no aquí
  TextColumn get relayUrl => text()();
  TextColumn get sessionId => text()();
  IntColumn get pairedAtMs => integer()();
  IntColumn get lastSeenMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {macDeviceId};
}

// lib/infrastructure/storage/tables/composer_drafts_table.dart
@DataClassName('ComposerDraftRow')
class ComposerDraftsTable extends Table {
  TextColumn get threadId => text()();
  TextColumn get draft => text()();
  IntColumn get updatedAtMs => integer()();

  @override
  Set<Column> get primaryKey => {threadId};
}

// lib/infrastructure/storage/tables/git_action_log_table.dart
@DataClassName('GitActionLogRow')
class GitActionLogTable extends Table {
  TextColumn get id => text()();
  TextColumn get threadId => text()();
  TextColumn get kind => text()();           // GitActionKind serializado
  TextColumn get status => text()();         // completed | error
  TextColumn get paramsJson => text()();
  TextColumn get resultJson => text().nullable()();
  TextColumn get errorMessage => text().nullable()();
  IntColumn get startedAtMs => integer()();
  IntColumn get completedAtMs => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
```

### 30.2 Definición de la base de datos principal

```dart
// lib/infrastructure/storage/local_database.dart

@DriftDatabase(tables: [
  ThreadsTable,
  MessagesTable,
  TurnsTable,
  ProjectsTable,
  TrustedDevicesTable,
  ComposerDraftsTable,
  GitActionLogTable,
])
class UxnanDatabase extends _$UxnanDatabase {
  UxnanDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      // Migraciones futuras aquí
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA journal_mode=WAL');
      await customStatement('PRAGMA foreign_keys=ON');
      await customStatement('PRAGMA synchronous=NORMAL');
    },
  );

  static QueryExecutor _openConnection() {
    return driftDatabase(
      name: 'uxnan_local.db',
      native: const DriftNativeOptions(shareAcrossIsolates: true),
    );
  }
}
```

### 30.3 Repositorios Drift — implementaciones completas

```dart
// lib/infrastructure/repositories/drift_thread_repository.dart

class DriftThreadRepository implements IThreadRepository {
  final UxnanDatabase _db;
  const DriftThreadRepository(this._db);

  @override
  Future<List<Thread>> getThreads({String? projectId}) async {
    final query = _db.select(_db.threadsTable);
    if (projectId != null) {
      query.where((t) => t.projectId.equals(projectId));
    }
    query.orderBy([(t) => OrderingTerm.desc(t.lastActivityMs)]);
    final rows = await query.get();
    return rows.map(_rowToThread).toList();
  }

  @override
  Future<Thread?> getThread(String id) async {
    final query = _db.select(_db.threadsTable)
      ..where((t) => t.id.equals(id));
    final row = await query.getSingleOrNull();
    return row != null ? _rowToThread(row) : null;
  }

  @override
  Future<void> saveThread(Thread thread) async {
    await _db.into(_db.threadsTable).insertOnConflictUpdate(
      ThreadsTableCompanion(
        id: Value(thread.id),
        title: Value(thread.title),
        projectId: Value(thread.projectId),
        cwd: Value(thread.cwd),
        worktreePath: Value(thread.worktreePath),
        agentId: Value(thread.agentId),
        syncState: Value(thread.syncState.name),
        status: Value(thread.status.name),
        lastActivityMs: Value(thread.lastActivity?.millisecondsSinceEpoch),
        createdAtMs: Value(DateTime.now().millisecondsSinceEpoch),
      ),
    );
  }

  @override
  Future<void> deleteThread(String id) async {
    await (_db.delete(_db.threadsTable)..where((t) => t.id.equals(id))).go();
  }

  @override
  Stream<List<Thread>> watchThreads({String? projectId}) {
    final query = _db.select(_db.threadsTable);
    if (projectId != null) {
      query.where((t) => t.projectId.equals(projectId));
    }
    query.orderBy([(t) => OrderingTerm.desc(t.lastActivityMs)]);
    return query.watch().map((rows) => rows.map(_rowToThread).toList());
  }

  Thread _rowToThread(ThreadRow row) => Thread(
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    cwd: row.cwd,
    worktreePath: row.worktreePath,
    agentId: row.agentId,
    syncState: ThreadSyncState.values.byName(row.syncState),
    status: ThreadStatus.values.byName(row.status),
    lastActivity: row.lastActivityMs != null
        ? DateTime.fromMillisecondsSinceEpoch(row.lastActivityMs!)
        : null,
  );
}

// lib/infrastructure/repositories/drift_message_repository.dart

class DriftMessageRepository implements IMessageRepository {
  final UxnanDatabase _db;
  const DriftMessageRepository(this._db);

  @override
  Future<List<Message>> getMessages(String threadId,
      {int? limit, String? beforeId}) async {
    final query = _db.select(_db.messagesTable)
      ..where((m) => m.threadId.equals(threadId))
      ..orderBy([(m) => OrderingTerm.desc(m.orderIndex)]);

    if (limit != null) query.limit(limit);

    if (beforeId != null) {
      // Obtener orderIndex del mensaje de referencia
      final ref = await (_db.select(_db.messagesTable)
            ..where((m) => m.id.equals(beforeId)))
          .getSingleOrNull();
      if (ref != null) {
        query.where((m) => m.orderIndex.isSmallerThanValue(ref.orderIndex));
      }
    }

    final rows = await query.get();
    return rows.reversed.map(_rowToMessage).toList();
  }

  @override
  Future<void> saveMessage(Message message) async {
    await _db.into(_db.messagesTable).insertOnConflictUpdate(
      MessagesTableCompanion(
        id: Value(message.id),
        threadId: Value(message.threadId),
        turnId: Value(message.turnId),
        role: Value(message.role.name),
        contentsJson: Value(jsonEncode(
          message.contents.map((c) => c.toJson()).toList())),
        deliveryState: Value(message.deliveryState.name),
        orderIndex: Value(message.orderIndex),
        fingerprint: Value(message.fingerprint),
        createdAtMs: Value(message.createdAt.millisecondsSinceEpoch),
      ),
    );
  }

  @override
  Future<void> saveMessages(List<Message> messages) async {
    await _db.batch((batch) {
      for (final m in messages) {
        batch.insertAllOnConflictUpdate(
          _db.messagesTable,
          [MessagesTableCompanion(/* ... mismo que saveMessage ... */)],
        );
      }
    });
  }

  @override
  Stream<List<Message>> watchMessages(String threadId) {
    return (_db.select(_db.messagesTable)
          ..where((m) => m.threadId.equals(threadId))
          ..orderBy([(m) => OrderingTerm.asc(m.orderIndex)]))
        .watch()
        .map((rows) => rows.map(_rowToMessage).toList());
  }

  Message _rowToMessage(MessageRow row) => Message(
    id: row.id,
    threadId: row.threadId,
    turnId: row.turnId,
    role: MessageRole.values.byName(row.role),
    contents: (jsonDecode(row.contentsJson) as List)
        .map((c) => MessageContent.fromJson(c as Map<String, dynamic>))
        .toList(),
    deliveryState: MessageDeliveryState.values.byName(row.deliveryState),
    orderIndex: row.orderIndex,
    fingerprint: row.fingerprint,
    createdAt: DateTime.fromMillisecondsSinceEpoch(row.createdAtMs),
  );
}
```

---

## 31. Especificación del estado de reconexión

El sistema de reconexión es uno de los más críticos para la experiencia del usuario. Esta sección lo especifica en detalle.

### 31.1 Máquina de estados de reconexión

```
                     ┌─────────────────────────────────────┐
                     │           DISCONNECTED               │
                     │   (app abierta, sin sesión activa)   │
                     └──────────────┬──────────────────────┘
                                    │ connect() llamado
                                    ▼
                     ┌─────────────────────────────────────┐
                     │            CONNECTING                │
                     │     (abriendo WebSocket al relay)    │
                     └──────────┬──────────────────────────┘
                                │ WebSocket abierto
                                ▼
                     ┌─────────────────────────────────────┐
                     │           HANDSHAKING                │
              ┌─────▶│  (intercambio Ed25519 + X25519)      │
              │      └──────────┬──────────────────────────┘
              │                 │ ready recibido
              │                 ▼
              │      ┌─────────────────────────────────────┐
              │      │             SYNCING                  │
              │      │   (catch-up de mensajes perdidos)    │
              │      └──────────┬──────────────────────────┘
              │                 │ sync completado
              │                 ▼
              │      ┌─────────────────────────────────────┐
              │      │            CONNECTED                 │◀─────┐
              │      │     (sesión E2EE activa, bidirec.)   │      │
              │      └──────────┬──────────────────────────┘      │
              │                 │ WS cerrado / error              │
              │                 ▼                                  │
              │      ┌─────────────────────────────────────┐      │
              └──────│          RECONNECTING                │      │
                     │   (backoff exp.: 1→2→4→8→16→60s)    │──────┘
                     └──────────┬──────────────────────────┘
                                │ max reintentos excedidos (10)
                                ▼
                     ┌─────────────────────────────────────┐
                     │              ERROR                   │
                     │   (requiere intervención del user)   │
                     └─────────────────────────────────────┘
```

### 31.2 ConnectionRecoveryState

```dart
// lib/domain/entities/connection_recovery_state.dart

class ConnectionRecoveryState {
  final bool isRecovering;
  final int attempt;                    // intento actual (1-based)
  final int maxAttempts;                // default: 10
  final Duration nextRetryIn;           // tiempo hasta el próximo intento
  final DateTime? lastConnectedAt;
  final String? lastErrorMessage;
  final bool requiresManualIntervention; // true si superó maxAttempts

  const ConnectionRecoveryState({
    this.isRecovering = false,
    this.attempt = 0,
    this.maxAttempts = 10,
    this.nextRetryIn = Duration.zero,
    this.lastConnectedAt,
    this.lastErrorMessage,
    this.requiresManualIntervention = false,
  });

  ConnectionRecoveryState copyWith({...}) { ... }
}
```

### 31.3 BackoffCalculator

```dart
// lib/infrastructure/transport/backoff_calculator.dart

class BackoffCalculator {
  static const _baseDurationSec = 1;
  static const _maxDurationSec = 60;
  static const _jitterFactorMax = 0.3;   // ±30% de jitter para evitar thundering herd

  static Duration compute(int attempt) {
    // Exponencial: 1, 2, 4, 8, 16, 32, 60, 60, 60...
    final exp = min(_baseDurationSec * pow(2, attempt - 1), _maxDurationSec);
    // Jitter aleatorio para evitar sincronización de múltiples clientes
    final jitter = exp * _jitterFactorMax * (Random().nextDouble() * 2 - 1);
    return Duration(milliseconds: ((exp + jitter) * 1000).round());
  }

  // Secuencia aproximada:
  // attempt=1: ~1s
  // attempt=2: ~2s
  // attempt=3: ~4s
  // attempt=4: ~8s
  // attempt=5: ~16s
  // attempt=6: ~32s
  // attempt=7+: ~60s (con jitter)
}
```

### 31.4 Comportamiento del outbound buffer durante reconexión

```dart
// lib/infrastructure/transport/outbound_message_buffer.dart

class OutboundMessageBuffer {
  // Mensajes que el teléfono quiso enviar mientras estaba desconectado
  // Se envían en orden al reconectar, antes de cualquier mensaje nuevo
  final Queue<PendingOutboundMessage> _queue = Queue();
  final int maxSize;     // default: 100 mensajes de usuario

  void enqueue(RpcMessage message) {
    if (_queue.length >= maxSize) {
      // Si la cola está llena, descarta el más antiguo (sliding window)
      _queue.removeFirst();
    }
    _queue.add(PendingOutboundMessage(
      message: message,
      enqueuedAt: DateTime.now(),
    ));
  }

  List<PendingOutboundMessage> drainAll() {
    final items = _queue.toList();
    _queue.clear();
    return items;
  }

  bool get isEmpty => _queue.isEmpty;
  int get length => _queue.length;
}

// Al reconectar (en SessionCoordinator.handleReconnect):
// 1. Completar handshake
// 2. Enviar mensajes del outbound buffer en orden
// 3. Procesar mensajes catch-up del bridge
// 4. Emitir ConnectionPhase.connected
// 5. Notificar a ComposerManager para reenviar drafts encolados
```

---

## 32. Especificación del módulo SSH Terminal

### 32.1 Arquitectura del módulo SSH

El módulo SSH Terminal permite al usuario conectarse por SSH a su PC de trabajo directamente desde la app. Esto es útil para ejecutar comandos arbitrarios, monitorear procesos, o gestionar el bridge y el agente desde el móvil.

```
TerminalScreen
├── ConnectionEditorSheet              # crear / editar perfiles SSH
├── ProfileListView                    # lista de perfiles guardados
└── TerminalSurface                    # terminal xterm activo
    ├── XtermWidget                    # emulador de terminal (paquete xterm)
    ├── KeyboardToolbar                # teclas especiales: Ctrl, Esc, Tab, flechas
    └── SessionStatusBar               # info de conexión activa
```

### 32.2 Modelos SSH

```dart
// lib/domain/entities/ssh/ssh_profile.dart

class SshProfile {
  final String id;
  final String displayName;
  final String host;
  final int port;                          // default: 22
  final String username;
  final SshAuthMethod authMethod;
  final String? privateKeyId;              // referencia a clave en SecureStore
  final String? passwordHint;              // solo hint, no password real
  final String? initialCommand;            // comando a ejecutar al conectar
  final DateTime createdAt;
  const SshProfile({...});
}

enum SshAuthMethod { privateKey, password, agent }

// lib/domain/entities/ssh/ssh_session.dart
class SshSession {
  final String profileId;
  final SshConnectionStatus status;
  final String? terminalTitle;             // título del pty
  final int pid;
  final DateTime connectedAt;
  const SshSession({...});
}

enum SshConnectionStatus { connecting, connected, disconnected, error }
```

### 32.3 SshTerminalAdapter — implementación con dartssh2

```dart
// lib/infrastructure/platform/ssh_terminal_adapter.dart

class SshTerminalAdapter {
  SSHClient? _client;
  SSHSession? _session;

  Future<SshSession> connect(SshProfile profile) async {
    final socket = await SSHSocket.connect(profile.host, profile.port,
        timeout: const Duration(seconds: 15));

    _client = SSHClient(
      socket,
      username: profile.username,
      onPasswordRequest: () async {
        if (profile.authMethod == SshAuthMethod.password) {
          // Solicitar al usuario mediante un dialog
          return await _requestPasswordFromUser(profile);
        }
        return '';
      },
      identities: profile.authMethod == SshAuthMethod.privateKey
          ? await _loadPrivateKey(profile.privateKeyId!)
          : null,
    );

    // Autenticar
    await _client!.authenticate();

    // Abrir sesión de shell
    _session = await _client!.shell(
      pty: SSHPtyConfig(
        type: 'xterm-256color',
        width: 220,
        height: 50,
      ),
    );

    return SshSession(
      profileId: profile.id,
      status: SshConnectionStatus.connected,
      pid: 0,
      connectedAt: DateTime.now(),
    );
  }

  // Stream de salida del terminal (bytes ANSI)
  Stream<List<int>> get outputStream => _session!.stdout;

  // Enviar input del teclado al terminal
  Future<void> write(String input) async {
    _session?.stdin.add(utf8.encode(input));
  }

  // Redimensionar el pty al cambiar orientación o tamaño del teclado
  Future<void> resizePty({required int width, required int height}) async {
    await _session?.resizeTerminal(width, height);
  }

  Future<void> disconnect() async {
    await _session?.close();
    _client?.close();
    _client = null;
    _session = null;
  }

  Future<List<SSHKeyPair>> _loadPrivateKey(String keyId) async {
    final pem = await SecureStore().read('ssh_key.$keyId');
    if (pem == null) throw PermissionException(
        'Clave privada no encontrada', PermissionErrorKind.localNetwork);
    return SSHKeyPair.fromPem(pem);
  }
}
```

### 32.4 TerminalSurface con xterm

```dart
// lib/presentation/screens/ssh_terminal/terminal_surface.dart

class TerminalSurface extends StatefulWidget {
  final SshProfile profile;
  const TerminalSurface({required this.profile, super.key});

  @override
  State<TerminalSurface> createState() => _TerminalSurfaceState();
}

class _TerminalSurfaceState extends State<TerminalSurface> {
  late final Terminal _terminal;
  late final TerminalController _controller;
  late final SshTerminalAdapter _ssh;

  @override
  void initState() {
    super.initState();
    _terminal = Terminal(maxLines: 10000);
    _controller = TerminalController();
    _ssh = SshTerminalAdapter();
    _connect();
  }

  Future<void> _connect() async {
    await _ssh.connect(widget.profile);
    // Leer output del SSH y escribir en xterm
    _ssh.outputStream.listen((data) {
      _terminal.write(String.fromCharCodes(data));
    });
    // Enviar input del xterm al SSH
    _terminal.onOutput = (data) {
      _ssh.write(data);
    };
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Terminal principal
        Expanded(
          child: TerminalView(
            _terminal,
            controller: _controller,
            theme: _buildTerminalTheme(),
            textStyle: TerminalStyle(
              fontFamily: 'JetBrainsMono',
              fontSize: 13,
            ),
            onSecondaryTapDown: (_, __) => _showContextMenu(),
          ),
        ),
        // Toolbar de teclas especiales
        _KeyboardToolbar(
          onKey: (key) => _ssh.write(key),
        ),
      ],
    );
  }

  TerminalTheme _buildTerminalTheme() => const TerminalTheme(
    cursor: Color(0xFFCCCCCC),
    selection: Color(0xFF4A5568),
    foreground: Color(0xFFEAEBF0),
    background: Color(0xFF0F1117),
    black: Color(0xFF1A1D27),
    red: Color(0xFFFF4D4D),
    green: Color(0xFF3FB950),
    yellow: Color(0xFFE3B341),
    blue: Color(0xFF58A6FF),
    magenta: Color(0xFFF778BA),
    cyan: Color(0xFF39C5CF),
    white: Color(0xFFEAEBF0),
    brightBlack: Color(0xFF444A5A),
    // ... bright variants
  );

  @override
  void dispose() {
    _ssh.disconnect();
    _controller.dispose();
    super.dispose();
  }
}
```

### 32.5 KeyboardToolbar

```dart
// lib/presentation/screens/ssh_terminal/keyboard_toolbar.dart

class _KeyboardToolbar extends StatelessWidget {
  final ValueChanged<String> onKey;

  const _KeyboardToolbar({required this.onKey});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 44,
      color: UxnanColors.surfaceVariant,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _KeyButton('Esc', onKey: () => onKey('\x1B')),
            _KeyButton('Tab', onKey: () => onKey('\t')),
            _KeyButton('Ctrl', onKey: () => _showCtrlMenu(context)),
            _KeyButton('↑', onKey: () => onKey('\x1B[A')),
            _KeyButton('↓', onKey: () => onKey('\x1B[B')),
            _KeyButton('←', onKey: () => onKey('\x1B[D')),
            _KeyButton('→', onKey: () => onKey('\x1B[C')),
            _KeyButton('Home', onKey: () => onKey('\x1B[H')),
            _KeyButton('End', onKey: () => onKey('\x1B[F')),
            _KeyButton('PgUp', onKey: () => onKey('\x1B[5~')),
            _KeyButton('PgDn', onKey: () => onKey('\x1B[6~')),
            _KeyButton('F1-F12', onKey: () => _showFnMenu(context)),
          ],
        ),
      ),
    );
  }

  void _showCtrlMenu(BuildContext context) {
    // Muestra un grid de combinaciones Ctrl+A..Ctrl+Z
  }
}
```

---

## 33. Especificación del módulo de onboarding detallado

### 33.1 Flujo completo de onboarding

El onboarding está diseñado para llevar a un desarrollador desde cero hasta la primera conexión activa en menos de 5 minutos.

```
OnboardingScreen
├── PageController con 4 páginas
├── Indicadores de página (dots)
└── Botón "Siguiente" / "Comenzar" en el último paso

Página 1: WelcomePage
├── Animación Lottie de agente en acción (loop)
├── Título: "Controla tus agentes desde cualquier lugar"
├── Subtítulo: descripción del producto en 2 líneas
└── Botón: "Comenzar" → avanza a página 2

Página 2: FeaturesPage
├── Lista de 4 características clave:
│   ├── 🔒 Cifrado E2EE — "Tu código nunca toca nuestros servidores"
│   ├── 🤖 Multi-agente — "Compatible con Codex, OpenCode, Gemini CLI y más"
│   ├── 📱 Local-first — "Funciona en tu red local sin internet"
│   └── 🔔 Notificaciones — "Te avisamos cuando el agente termina"
└── Botón: "Siguiente" → página 3

Página 3: InstallStepPage
├── Título: "Instala el bridge en tu PC"
├── Tabs: macOS | Windows | Linux
├── CommandCardWidget con el comando de instalación
│   └── npm install -g uxnan-bridge
│       (botón de copia automática)
├── CommandCardWidget con el comando de inicio
│   └── uxnan-bridge start
├── CommandCardWidget para mostrar el QR
│   └── uxnan-bridge qr
└── Botón: "Ya lo instalé, escanear QR" → página 4

Página 4: PairingStep
├── Título: "Escanea el QR de tu PC"
├── Subtítulo: "El QR aparece en tu terminal al ejecutar uxnan-bridge qr"
├── Botón primario: "Escanear QR" → QrScannerScreen
└── Botón secundario: "Ingresar código manual" → ManualCodeScreen
```

### 33.2 CommandCardWidget

```dart
// lib/presentation/screens/onboarding/command_card_widget.dart

class CommandCardWidget extends StatefulWidget {
  final String command;
  final String? label;
  const CommandCardWidget({required this.command, this.label, super.key});

  @override
  State<CommandCardWidget> createState() => _CommandCardWidgetState();
}

class _CommandCardWidgetState extends State<CommandCardWidget> {
  bool _copied = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg, vertical: UxnanSpacing.md),
      decoration: BoxDecoration(
        color: UxnanColors.surfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: UxnanColors.outline),
      ),
      child: Row(
        children: [
          if (widget.label != null) ...[
            Text(widget.label!, style: UxnanTypography.bodySmall),
            const SizedBox(width: UxnanSpacing.sm),
          ],
          Expanded(
            child: Text(widget.command,
                style: UxnanTypography.codeBody,
                overflow: TextOverflow.ellipsis),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          GestureDetector(
            onTap: _copyToClipboard,
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              child: Icon(
                _copied ? Icons.check_circle_outline : Icons.copy_outlined,
                key: ValueKey(_copied),
                size: 18,
                color: _copied ? UxnanColors.success : UxnanColors.onSurfaceMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _copyToClipboard() async {
    await Clipboard.setData(ClipboardData(text: widget.command));
    setState(() => _copied = true);
    await Future.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _copied = false);
  }
}
```

---

## 34. Especificación del módulo de settings

### 34.1 Árbol de configuración

```
SettingsScreen
├── Sección: Conexión
│   ├── URL del relay
│   │   ├── Valor default: wss://relay.uxnan.io
│   │   └── Editable para self-hosted relay
│   ├── Timeout de requests (segundos)
│   │   ├── Default: 30
│   │   └── Rango: 10-120
│   ├── Modo de conexión preferido
│   │   ├── Auto (LAN si disponible, relay como fallback) — default
│   │   ├── Solo LAN
│   │   └── Solo Relay
│   └── Reconexión automática
│       ├── Activar/desactivar (default: activado)
│       └── Max intentos (default: 10)
│
├── Sección: Agentes
│   ├── Lista de proyectos configurados
│   │   ├── ProjectCard (nombre, cwd, agente)
│   │   ├── Editar → ProjectEditor
│   │   └── Eliminar
│   └── Agregar proyecto → ProjectEditor
│
├── Sección: Notificaciones
│   ├── Notificaciones de turno completado
│   │   ├── Activar/desactivar
│   │   └── Solo cuando la app está en background
│   ├── Notificaciones de error del agente
│   └── Sonido de notificación
│
├── Sección: Apariencia
│   ├── Tema: Oscuro (default) | Claro | Sistema
│   └── Tamaño de fuente del terminal SSH
│
├── Sección: Mis equipos
│   └── → MyDevicesScreen
│
└── Sección: Acerca de
    ├── Versión de la app
    ├── Versión del protocolo
    ├── Política de privacidad → WebView
    ├── Código fuente (GitHub) → abrir navegador
    └── Restablecer configuración
```

### 34.2 ProjectEditor

```dart
// lib/presentation/screens/projects/project_editor.dart

class ProjectEditor extends ConsumerStatefulWidget {
  final Project? existingProject;   // null = crear nuevo
  const ProjectEditor({this.existingProject, super.key});

  @override
  ConsumerState<ProjectEditor> createState() => _ProjectEditorState();
}

class _ProjectEditorState extends ConsumerState<ProjectEditor> {
  late final TextEditingController _nameController;
  late final TextEditingController _cwdController;
  AgentId _selectedAgent = AgentId.opencode;
  AgentConfig _agentConfig = AgentConfig.defaults(AgentId.opencode);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.existingProject == null
            ? 'Nuevo proyecto'
            : 'Editar proyecto'),
        actions: [
          TextButton(
            onPressed: _save,
            child: const Text('Guardar'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(UxnanSpacing.lg),
        children: [
          // Nombre del proyecto
          _SectionTitle('Nombre'),
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              hintText: 'Mi proyecto backend',
            ),
          ),
          const SizedBox(height: UxnanSpacing.xl),

          // Directorio de trabajo
          _SectionTitle('Directorio (cwd)'),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _cwdController,
                  decoration: const InputDecoration(
                    hintText: '/Users/dev/projects/mi-proyecto',
                    fontFamily: 'JetBrainsMono',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.xl),

          // Selección de agente
          _SectionTitle('Agente de codificación'),
          _AgentSelector(
            selected: _selectedAgent,
            onChanged: (agent) {
              setState(() {
                _selectedAgent = agent;
                _agentConfig = AgentConfig.defaults(agent);
              });
            },
          ),
          const SizedBox(height: UxnanSpacing.xl),

          // Configuración específica del agente
          _AgentConfigForm(
            agentId: _selectedAgent,
            config: _agentConfig,
            onChanged: (config) => setState(() => _agentConfig = config),
          ),
        ],
      ),
    );
  }

  Future<void> _save() async {
    final project = Project(
      id: widget.existingProject?.id ?? const Uuid().v4(),
      displayName: _nameController.text.trim(),
      cwd: _cwdController.text.trim(),
      agentId: _selectedAgent.name,
      agentConfig: _agentConfig,
      lastActive: widget.existingProject?.lastActive,
    );
    await ref.read(projectRepositoryProvider).saveProject(project);
    if (mounted) Navigator.of(context).pop();
  }
}
```

---

## 35. Análisis estático y calidad de código

### 35.1 Configuración de analysis_options.yaml

```yaml
# analysis_options.yaml

include: package:very_good_analysis/analysis_options.yaml

analyzer:
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"
    - "**/*.gen.dart"
  errors:
    # Tratar como errores
    invalid_annotation_target: ignore   # freezed genera esto
    missing_required_param: error
    dead_code: warning
    unused_import: error
    unused_local_variable: warning
  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true

linter:
  rules:
    # Reglas de estilo
    - always_use_package_imports
    - avoid_dynamic_calls
    - avoid_print
    - avoid_relative_lib_imports
    - avoid_type_to_string
    - cancel_subscriptions
    - close_sinks
    - collection_methods_unrelated_type
    - combinators_ordering
    - directives_ordering
    - eol_at_end_of_file
    - no_adjacent_strings_in_list
    - no_literal_bool_comparisons
    - prefer_const_constructors
    - prefer_const_declarations
    - prefer_final_fields
    - prefer_final_in_for_each
    - prefer_final_locals
    - prefer_relative_imports
    - require_trailing_commas
    - sort_constructors_first
    - sort_pub_dependencies
    - unawaited_futures
    - unnecessary_await_in_return
    - unnecessary_breaks
    - unnecessary_lambdas
    - unnecessary_null_checks
    - use_colored_box
    - use_decorated_box
    - use_enums
    - use_if_null_to_convert_nulls_to_bools
    - use_string_buffers
    - use_super_parameters
```

### 35.2 Scripts de calidad

```bash
# Verificar formato
dart format --output=none --set-exit-if-changed lib/ test/

# Análisis estático
flutter analyze --fatal-infos

# Tests con cobertura
flutter test --coverage --reporter=expanded
genhtml coverage/lcov.info -o coverage/html
open coverage/html/index.html

# Verificar que el build_runner no tiene salidas sin generar
dart run build_verify:build_verify

# Ordenar dependencias en pubspec.yaml
dart pub deps --style=tree

# Verificar que no hay imports circulares en el dominio
dart run import_sorter:main
```

---

## 36. Apéndices técnicos

### Apéndice A — Sequence diagram: handshake completo

```
 iPhone App              Relay Server             Bridge Daemon (PC)
     │                       │                          │
     │── WS connect ─────────▶│                          │
     │   x-role: iphone       │                          │
     │   x-session-id: UUID   │                          │
     │                        │◀── WS connect ───────────│
     │                        │    x-role: mac            │
     │                        │    x-session-id: UUID     │
     │                        │    x-mac-device-id: ...   │
     │                        │    x-notification-secret  │
     │                        │                          │
     │ ← relay connected ─────│                          │
     │                        │                          │
     │─ clientHello ──────────┼──────────────────────────▶│
     │  {kind, proto, mode,   │  (relay reenvía opaco)   │
     │   phoneDevId, phonePub │                          │
     │   phoneEphPub, nonce}  │                          │
     │                        │                          │
     │◀─ serverHello ─────────┼──────────────────────────│
     │  {macPub, macEphPub,   │  (relay reenvía opaco)   │
     │   serverNonce, epoch,  │                          │
     │   macSignature, ...}   │                          │
     │                        │                          │
     │  verifica macSignature │                          │
     │  deriva clave HKDF     │                          │
     │                        │                          │
     │─ clientAuth ───────────┼──────────────────────────▶│
     │  {phoneDevId, epoch,   │                          │
     │   phoneSignature}      │                          │
     │                        │                          │
     │                        │          verifica         │
     │                        │          phoneSignature   │
     │                        │          persiste trust   │
     │                        │                          │
     │◀─ ready ───────────────┼──────────────────────────│
     │  {sessionId, epoch,    │                          │
     │   macDeviceId}         │                          │
     │                        │                          │
     │ ══ sesión E2EE activa══│══════════════════════════│
     │                        │                          │
     │─ [E2EE] thread/list ───┼──────────────────────────▶│
     │◀─ [E2EE] response ─────┼──────────────────────────│
     │                        │                          │
```

### Apéndice B — Sequence diagram: notificación push completa

```
 Bridge Daemon           Relay Server         APNs/FCM         iPhone App
     │                       │                   │                 │
     │  turn completed        │                   │                 │
     │  (agente termina)      │                   │                 │
     │                        │                   │                 │
     │  check push-tracker    │                   │                 │
     │  check dedupe keys     │                   │                 │
     │  → not duplicate       │                   │                 │
     │                        │                   │                 │
     │── POST /push/notify ──▶│                   │                 │
     │  {sessionId,           │                   │                 │
     │   notificationSecret,  │                   │                 │
     │   threadId, turnId,    │                   │                 │
     │   title, body}         │                   │                 │
     │                        │                   │                 │
     │                   valida secret            │                 │
     │                   no duplicado             │                 │
     │                   busca token push         │                 │
     │                        │                   │                 │
     │                        │── push payload ──▶│                 │
     │                        │  iOS: APNs HTTP/2 │                 │
     │                        │  Android: FCM     │                 │
     │                        │                   │                 │
     │                        │                   │── push ────────▶│
     │                        │                   │                 │
     │                        │                   │          handle push
     │                        │                   │          navega a thread
     │                        │                   │          conecta si offline
     │                        │                   │                 │
```

### Apéndice C — Formato del envelope E2EE

```
Estructura del SecureEnvelope (JSON serializado):

{
  "kind": "encryptedEnvelope",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 42,
  "nonce": "a3f9c0d1e2b4a5f6c7d8e9f0",        // 12 bytes hex = 24 chars
  "ciphertext": "base64url(AES-256-GCM(plaintext, derivedKey, nonce))",
  "tag": "base64url(GCM_AUTH_TAG)"             // 16 bytes = ~22 chars base64
}

Proceso de cifrado (lado emisor):
1. Serializar el RpcMessage como JSON → bytes UTF-8
2. Generar nonce aleatorio de 12 bytes
3. Cifrar con AES-256-GCM:
   ciphertext || tag = AES_GCM_Encrypt(
     key = derivedKey,       // 32 bytes, de HKDF
     nonce = nonce,          // 12 bytes, aleatorio por mensaje
     plaintext = jsonBytes,
     aad = sessionId || seq  // additional authenticated data
   )
4. Construir SecureEnvelope JSON

Proceso de descifrado (lado receptor):
1. Extraer sessionId, seq, nonce, ciphertext, tag
2. Verificar seq > lastAppliedSeq (replay prevention)
3. Descifrar con AES-256-GCM:
   plaintext = AES_GCM_Decrypt(
     key = derivedKey,
     nonce = nonce,
     ciphertext = ciphertext,
     tag = tag,
     aad = sessionId || seq
   )
4. Parsear como RpcMessage JSON
5. Actualizar lastAppliedSeq
```

### Apéndice D — Tabla de compatibilidad de versiones

El sistema tiene dos componentes versionados de forma independiente: la app móvil y el bridge. La compatibilidad se verifica en el handshake:

| App versión | Bridge mínimo | Notas |
|---|---|---|
| 1.0.x | 1.0.0 | Versión inicial |
| 1.1.x | 1.0.0 | Compatible hacia atrás |
| 1.2.x | 1.1.0 | Requiere bridge con soporte de checkpoints |
| 1.3.x | 1.2.0 | Requiere bridge con soporte SSH relay |
| 2.0.x | 2.0.0 | Cambio de protocolo (voice, subagentes) |

Cuando el bridge tiene una versión incompatible con la app:
1. El bridge envía en `serverHello`: `minAppVersion: "2.0.0"`
2. La app detecta que su versión es menor
3. La app muestra `UpdatePromptDialog` con instrucciones para actualizar
4. La conexión se cierra ordenadamente

Cuando la app tiene una versión incompatible con el bridge (app nueva, bridge viejo):
1. El bridge recibe `protocolVersion: 2` en `clientHello`
2. El bridge no reconoce la versión
3. El bridge responde con error `-32005` (bridge version incompatible)
4. La app muestra instrucciones para actualizar el bridge

### Apéndice E — Constantes de protocolo completas

```dart
// lib/core/constants/protocol_constants.dart

abstract final class ProtocolConstants {
  // Versiones
  static const int secureProtocolVersion = 1;
  static const int pairingQrVersion = 2;

  // Criptografía
  static const String hkdfInfoTag = 'uxnan-e2ee-v1';
  static const int derivedKeyLengthBytes = 32;     // AES-256
  static const int nonceBytes = 12;                 // GCM nonce
  static const int tagBytes = 16;                   // GCM auth tag
  static const int ed25519PublicKeyBytes = 32;
  static const int ed25519PrivateKeyBytes = 32;
  static const int x25519PublicKeyBytes = 32;
  static const int x25519PrivateKeyBytes = 32;
  static const int clientNonceBytes = 32;
  static const int serverNonceBytes = 32;

  // Timeouts y TTLs
  static const Duration maxPairingAge = Duration(minutes: 5);
  static const Duration clockSkewTolerance = Duration(seconds: 60);
  static const Duration trustedReconnectSkew = Duration(seconds: 90);
  static const Duration requestTimeout = Duration(seconds: 30);
  static const Duration webSocketConnectTimeout = Duration(seconds: 10);
  static const Duration lanProbeTimeout = Duration(seconds: 2);

  // Outbound buffer (bridge → phone)
  static const int maxBridgeOutboundMessages = 500;
  static const int maxBridgeOutboundBytes = 10 * 1024 * 1024; // 10 MB

  // Outbound buffer (phone → bridge, para mensajes encolados offline)
  static const int maxPhoneOutboundMessages = 100;

  // Reconexión
  static const int maxReconnectAttempts = 10;
  static const int backoffBaseSec = 1;
  static const int backoffMaxSec = 60;
  static const double backoffJitterFactor = 0.3;

  // Código de pairing manual
  static const int shortPairingCodeLength = 6;

  // Paginación
  static const int threadListInitialLoad = 50;
  static const int messageListInitialLoad = 50;
  static const int messageListPageSize = 20;
  static const int maxInMemoryMessages = 200;

  // WebSocket
  static const int maxWebSocketMessageBytes = 1 * 1024 * 1024; // 1 MB
  static const Duration webSocketPingInterval = Duration(seconds: 30);
  static const Duration webSocketPongTimeout = Duration(seconds: 10);

  // Push
  static const Duration pushDedupeRetentionPeriod = Duration(days: 7);
  static const int maxPushDedupeKeys = 10000;

  // LAN discovery
  static const String bonjourServiceType = '_uxnan-bridge._tcp';
  static const int bridgeDefaultPort = 51420;
}
```

### Apéndice F — Checklist de release

Antes de cada release de producción, verificar:

**App Flutter:**
- [ ] `flutter analyze` sin errores
- [ ] `dart format --set-exit-if-changed` pasa
- [ ] `flutter test` 100% verde
- [ ] `flutter build apk --release` compila sin warnings
- [ ] `flutter build ios --release` compila sin warnings
- [ ] Números de versión actualizados en `pubspec.yaml`
- [ ] `CHANGELOG.md` actualizado
- [ ] Permisos en AndroidManifest.xml correctos
- [ ] Permisos en Info.plist correctos
- [ ] `GoogleService-Info.plist` y `google-services.json` actualizados
- [ ] Screenshots actualizados en el store

**Bridge:**
- [ ] Tests del bridge pasan: `npm test`
- [ ] Lint: `npm run lint` sin errores
- [ ] Versión en `package.json` actualizada
- [ ] `CHANGELOG.md` del bridge actualizado
- [ ] Compatible con la versión mínima de Node.js soportada (Node 18 LTS)
- [ ] Publicado en npm: `npm publish`

**Relay:**
- [ ] Tests del relay pasan: `npm test`
- [ ] Variables de entorno de producción verificadas
- [ ] Certificados APNs vigentes (caducan anualmente)
- [ ] Service account de FCM válida
- [ ] Health check activo y respondiendo

---

*Fin del documento. Versión 1.0.0 — Uxnan PRD + SRS completo*

---

> **Nota de autor:** Este documento es la fuente de verdad única y definitiva para el desarrollo de Uxnan. No existe relación alguna con ningún producto anterior. Todos los nombres, identificadores, rutas, constantes y especificaciones son propias de Uxnan y deben usarse tal como están definidos aquí. Las referencias a otros productos externos (OpenAI Codex, OpenCode, Claude Code, Gemini CLI, pi-agent) solo existen en el contexto de compatibilidad técnica como proveedores de agentes soportados (secciones 4 y 20).