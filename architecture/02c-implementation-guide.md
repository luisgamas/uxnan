# Uxnan — Guia de Implementacion

> **Version:** 1.0.0  
> **Fecha:** 2026-06-04  
> **Estado:** En desarrollo  
> Este documento forma parte de la documentacion tecnica de Uxnan. Ver tambien: [01-product-vision.md](01-product-vision.md) | [02a-system-architecture.md](02a-system-architecture.md) | [02b-contracts-and-requirements.md](02b-contracts-and-requirements.md) | [03-technical-reference.md](03-technical-reference.md)

---

## Tabla de contenidos

1. [Especificacion detallada de proveedores Riverpod](#1-especificacion-detallada-de-proveedores-riverpod)
2. [Especificacion de adaptadores de agente](#2-especificacion-de-adaptadores-de-agente)
3. [Diseno de UI y sistema visual](#3-diseno-de-ui-y-sistema-visual)
4. [Plan de pruebas](#4-plan-de-pruebas)
5. [Estrategia de build y CI/CD](#5-estrategia-de-build-y-cicd)
6. [Internacionalizacion (i18n)](#6-internacionalizacion-i18n)
7. [Manifiesto de permisos](#7-manifiesto-de-permisos)
8. [Consideraciones de despliegue y auto-hosting](#8-consideraciones-de-despliegue-y-auto-hosting)
9. [Manejo de errores y recuperacion](#9-manejo-de-errores-y-recuperacion)
10. [Modelos de base de datos (Drift)](#10-modelos-de-base-de-datos-drift)
11. [Estado de reconexion](#11-estado-de-reconexion)
12. [Modulo SSH Terminal](#12-modulo-ssh-terminal)
13. [Modulo de onboarding](#13-modulo-de-onboarding)
14. [Modulo de settings](#14-modulo-de-settings)
15. [Analisis estatico y calidad de codigo](#15-analisis-estatico-y-calidad-de-codigo)
16. [Apendices tecnicos](#16-apendices-tecnicos)

---

## 1. Especificacion detallada de proveedores Riverpod

> **Nota:** Uxnan usa Riverpod 3.x con providers declarados manualmente (sin riverpod_generator) para mantener control explicito sobre el ciclo de vida y las dependencias.

Esta seccion define todos los providers de Riverpod que la app necesita, con su tipo, dependencias y comportamiento esperado.

### 1.1 Providers de infraestructura (singletons)

```dart
// lib/presentation/providers/infrastructure_providers.dart

// Base de datos SQLite
final databaseProvider = Provider<UxnanDatabase>((ref) => UxnanDatabase());

// Almacenamiento seguro
final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

// Preferencias compartidas
final sharedPreferencesProvider = FutureProvider<SharedPreferences>(
  (ref) => SharedPreferences.getInstance(),
);

// Repositorios
final threadRepositoryProvider = Provider<IThreadRepository>(
  (ref) => DriftThreadRepository(ref.watch(databaseProvider)),
);

final messageRepositoryProvider = Provider<IMessageRepository>(
  (ref) => DriftMessageRepository(ref.watch(databaseProvider)),
);

final trustedDeviceRepositoryProvider = Provider<ITrustedDeviceRepository>(
  (ref) => DriftTrustedDeviceRepository(ref.watch(databaseProvider)),
);

final projectRepositoryProvider = Provider<IProjectRepository>(
  (ref) => DriftProjectRepository(ref.watch(databaseProvider)),
);

final secureSessionRepositoryProvider = Provider<ISecureSessionRepository>(
  (ref) => SecureStorageSessionRepository(ref.watch(secureStoreProvider)),
);

final composerDraftRepositoryProvider = Provider<IComposerDraftRepository>(
  (ref) => DriftComposerDraftRepository(ref.watch(databaseProvider)),
);

// Adaptadores de plataforma
final pushAdapterProvider = Provider<PushNotificationAdapter>(
  (ref) => PushNotificationAdapter(),
);

final qrScannerAdapterProvider = Provider<QrScannerAdapter>(
  (ref) => QrScannerAdapter(),
);

final hapticAdapterProvider = Provider<HapticAdapter>(
  (ref) => HapticAdapter(),
);
```

### 1.2 Providers de dominio / aplicacion (coordinadores)

```dart
// lib/presentation/providers/application_providers.dart

// SessionCoordinator — singleton
final sessionCoordinatorProvider = Provider<SessionCoordinator>(
  (ref) => SessionCoordinator(
    trustedDeviceRepo: ref.watch(trustedDeviceRepositoryProvider),
    secureSessionRepo: ref.watch(secureSessionRepositoryProvider),
    secureStore: ref.watch(secureStoreProvider),
  ),
);

// ThreadManager — singleton
final threadManagerProvider = Provider<ThreadManager>(
  (ref) => ThreadManager(
    threadRepo: ref.watch(threadRepositoryProvider),
    messageRepo: ref.watch(messageRepositoryProvider),
    sessionCoordinator: ref.watch(sessionCoordinatorProvider),
  ),
);

// ComposerManager — singleton
final composerManagerProvider = Provider<ComposerManager>(
  (ref) => ComposerManager(
    draftRepo: ref.watch(composerDraftRepositoryProvider),
    sessionCoordinator: ref.watch(sessionCoordinatorProvider),
  ),
);

// GitActionManager — singleton
final gitActionManagerProvider = Provider<GitActionManager>(
  (ref) => GitActionManager(
    sessionCoordinator: ref.watch(sessionCoordinatorProvider),
  ),
);

// SyncManager
final syncManagerProvider = Provider<SyncManager>(
  (ref) => SyncManager(
    sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    threadManager: ref.watch(threadManagerProvider),
    messageRepo: ref.watch(messageRepositoryProvider),
  ),
);

// NotificationManager
final notificationManagerProvider = Provider<NotificationManager>(
  (ref) => NotificationManager(
    pushAdapter: ref.watch(pushAdapterProvider),
    sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    secureStore: ref.watch(secureStoreProvider),
  ),
);
```

### 1.3 Providers de estado derivado (UI)

```dart
// lib/presentation/providers/ui_providers.dart

// Estado de conexion
final connectionPhaseProvider = StreamProvider<ConnectionPhase>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.connectionPhaseStream;
});

// Mac activa
final activeMacProvider = StreamProvider<TrustedDevice?>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.activeMacStream;
});

// Lista de dispositivos de confianza
final trustedDevicesProvider = FutureProvider<List<TrustedDevice>>((ref) {
  final repo = ref.watch(trustedDeviceRepositoryProvider);
  return repo.getDevices();
});

// Lista de threads (reactiva por cambios en DB)
final threadsProvider = StreamProvider.family<List<Thread>, String?>((ref, projectId) {
  final repo = ref.watch(threadRepositoryProvider);
  return repo.watchThreads(projectId: projectId);
});

// Thread activo
final activeThreadProvider = Provider<Thread?>((ref) {
  final manager = ref.watch(threadManagerProvider);
  return manager.activeThread.value;
});

// Timeline snapshot para un thread dado
final timelineProvider = FutureProvider.family<TurnTimelineSnapshot, String>((ref, threadId) async {
  final manager = ref.watch(threadManagerProvider);
  return manager.getTimeline(threadId);
});

// Mensajes en stream (reactivo)
final messagesProvider = StreamProvider.family<List<Message>, String>((ref, threadId) {
  final repo = ref.watch(messageRepositoryProvider);
  return repo.watchMessages(threadId);
});

// Estado del repo Git para el thread activo
final gitRepoStateProvider = FutureProvider<GitRepoState?>((ref) async {
  final thread = ref.watch(activeThreadProvider);
  if (thread == null || thread.cwd == null) return null;
  final manager = ref.watch(gitActionManagerProvider);
  return manager.repoState.value;
});

// Estado del composer
final composerStateProvider = Provider<ComposerState>((ref) {
  final manager = ref.watch(composerManagerProvider);
  return manager.state;
});

// Lista de proyectos
final projectsProvider = StreamProvider<List<Project>>((ref) {
  final repo = ref.watch(projectRepositoryProvider);
  return repo.watchProjects();
});

// Estado de autenticacion del agente activo
final authStatusProvider = FutureProvider.family<AuthStatus, String>((ref, agentId) async {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.getAuthStatus(agentId);
});

// El onboarding ya fue completado?
final onboardingCompletedProvider = FutureProvider<bool>((ref) async {
  final prefs = await ref.watch(sharedPreferencesProvider.future);
  return prefs.getBool('onboardingCompleted') ?? false;
});
```

### 1.4 Family providers (por parametro)

```dart
// Snapshot de timeline para un thread especifico (auto-refresh)
final liveTimelineProvider = StreamProvider.family<TurnTimelineSnapshot, String>((ref, threadId) {
  final manager = ref.watch(threadManagerProvider);
  return manager.watchTimeline(threadId);
});

// Progreso de accion Git para un thread
final gitActionProgressProvider = StreamProvider.family<GitActionProgress?, String>((ref, threadId) {
  final manager = ref.watch(gitActionManagerProvider);
  return manager.watchProgress(threadId);
});

// Draft del composer por thread
final composerDraftProvider = FutureProvider.family<String?, String>((ref, threadId) {
  final repo = ref.watch(composerDraftRepositoryProvider);
  return repo.getDraft(threadId);
});
```

---

## 2. Especificacion de adaptadores de agente

Esta seccion detalla el comportamiento especifico de cada adaptador de agente en el bridge, incluyendo como localizan las sesiones, como inician el runtime y que transformaciones aplican al protocolo.

### 2.1 Adaptador OpenAI Codex CLI (`codex-adapter.js`)

**Arquitectura del agente:** Codex corre como un `app-server` local que expone JSON-RPC 2.0 sobre WebSocket en un socket local Unix o TCP. El bridge actua como proxy entre la app movil y este app-server.

**Localizacion del runtime:**
```javascript
// Rutas de busqueda del binario Codex
const CODEX_BINARY_PATHS = [
  '/usr/local/bin/codex',
  '/opt/homebrew/bin/codex',
  path.join(process.env.HOME, '.local/bin/codex'),
  // npx codex como fallback
];

// Directorio de sesiones JSONL
const CODEX_SESSIONS_DIR = path.join(process.env.HOME, '.codex', 'sessions');
// Directorio de imagenes generadas
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
  // Espera hasta que el socket esta disponible (polling con timeout de 10s)
  await waitForSocket(socketPath, 10_000);
  return proc;
}
```

**Mapeo de metodos JSON-RPC:**
Los metodos de Codex son nativos al protocolo, por lo que el adaptador es practicamente un proxy transparente. Solo se necesitan estas transformaciones:

| Metodo Uxnan | Metodo Codex | Transformacion |
|---|---|---|
| `thread/list` | `thread/list` | Ninguna |
| `thread/read` | `thread/read` | Ninguna |
| `thread/turns/list` | `thread/turns/list` | Ninguna |
| `turn/send` | `turn/send` | Ninguna |
| `git/status` | `git/status` | Bridge ejecuta git localmente |
| `account/read` | `account/read` | Sanitizacion de tokens en respuesta |
| `getAuthStatus` | `getAuthStatus` | Sanitizacion de tokens |

**Fallback JSONL:**
Cuando `thread/turns/list` retorna vacio o error, el adaptador lee directamente de `~/.codex/sessions/<threadId>.jsonl`:
```javascript
async function readTurnsFromJSONL(threadId, { cursor, limit = 20 }) {
  const sessionFile = path.join(CODEX_SESSIONS_DIR, `${threadId}.jsonl`);
  // Lee lineas desde el final hacia el principio (mas recientes primero)
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

### 2.2 Adaptador OpenCode (`opencode-adapter.js`)

**Arquitectura del agente:** OpenCode usa una arquitectura cliente/servidor explicitamente disenada para clientes remotos. OpenCode implementa una arquitectura cliente/servidor que permite que el frontend TUI sea solo uno de los posibles clientes, habilitando que una app movil se conecte remotamente. Sus sesiones se almacenan en SQLite.

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
OpenCode expone una API REST + WebSocket. El adaptador traduce los metodos JSON-RPC de Uxnan a llamadas HTTP/WS de OpenCode:

```javascript
// GET /session -> thread/list
async function listThreads() {
  const res = await fetch(`http://localhost:${port}/session`);
  const sessions = await res.json();
  return sessions.map(mapOpenCodeSessionToThread);
}

// POST /session -> thread/start
async function startThread({ cwd, message }) {
  const res = await fetch(`http://localhost:${port}/session`, {
    method: 'POST',
    body: JSON.stringify({ cwd, initialMessage: message }),
  });
  return mapOpenCodeSessionToThread(await res.json());
}

// WS /session/:id/events -> stream de eventos
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

### 2.3 Adaptador Claude Code (`claude-code-adapter.js`)

**Arquitectura del agente:** Claude Code incluye un sistema Bridge de 33+ archivos para la funcionalidad de "Remote Control" que controla el Claude Code local desde la interfaz web de Claude.ai, usando un tunel WebSocket/HTTPS autenticado. El adaptador de Uxnan se conecta al agente de Claude Code de forma local, sin pasar por la nube de Anthropic.

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

// Cada sesion es un archivo JSONL con entradas del tipo:
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

### 2.4 Adaptador Gemini CLI (`gemini-cli-adapter.js`)

**Arquitectura del agente:** Gemini CLI es un agente open-source que usa un bucle ReAct (Reason and Act) con herramientas built-in y servidores MCP locales o remotos para completar tareas complejas. Soporta output en formato JSON estructurado y stream-JSON para integracion programatica.

**Inicio del runtime:**
```javascript
async function startGeminiAgent(cwd, projectConfig) {
  // Gemini CLI no tiene modo server nativo; se lanza por conversacion
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

  // Lee lineas NDJSON del stdout
  return parseStreamJsonOutput(proc.stdout);
}
```

**Formato stream-json de Gemini CLI:**
Gemini CLI soporta `--output-format stream-json` para obtener eventos NDJSON en tiempo real, util para monitorear operaciones de larga duracion.

```javascript
// Cada linea del output es un evento JSON del tipo:
// {"type":"thought","content":"Pensando sobre..."}
// {"type":"tool_call","name":"read_file","args":{"path":"..."}}
// {"type":"tool_result","name":"read_file","result":"..."}
// {"type":"response","content":"Aqui esta la solucion..."}
// {"type":"complete"}

function parseStreamJsonOutput(stdout) {
  // Mapea eventos Gemini -> DomainEvents de Uxnan
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

### 2.5 Adaptador pi-agent (`pi-agent-adapter.js`)

**Arquitectura del agente:** pi-agent usa modo RPC con framing JSONL estricto delimitado por LF. Los clientes deben dividir registros solo por `\n`. Las sesiones se persisten como archivos JSONL en `~/.pi/agent/sessions/`.

**Modo RPC de pi-agent:**
```javascript
// pi se lanza con --rpc para modo programatico
async function startPiRpc(cwd, projectConfig) {
  const proc = spawn('pi', ['--rpc'], {
    cwd,
    env: {
      ...process.env,
      ...resolveProviderEnv(projectConfig),  // ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Protocolo: cada mensaje es una linea JSON terminada en \n
  // CRITICO: no usar readline — puede partir en separadores Unicode
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
// siendo este archivo la fuente unica de verdad. Cuando cualquier lado —
// CLI o cliente remoto — abre la sesion, reconstruye el historial completo
// de las entradas JSONL.

async function readPiSession(sessionId, { cursor, limit = 20 }) {
  const sessionPath = path.join(PI_SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionPath)) return { turns: [], cursor: null };
  // Lee lineas, reconstruye turns, aplica paginacion
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

### 2.6 Base adapter — herencia y extensibilidad

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
  // ... resto de metodos git

  // Workspace siempre se lee del filesystem local
  async readFile(path) { return this.workspaceHandler.handleReadFile({ path }); }
  async readImage(path) { return this.workspaceHandler.handleReadImage({ path }); }
  // ... resto de metodos workspace

  // Metodos que cada adaptador DEBE implementar (abstract)
  async listThreads() { throw new Error('Not implemented'); }
  async startThread() { throw new Error('Not implemented'); }
  async sendTurn() { throw new Error('Not implemented'); }
  async getAuthStatus() { throw new Error('Not implemented'); }
}
```

---

## 3. Diseno de UI y sistema visual

> **Nota:** El sistema visual de Uxnan se basa en Material Design 3, usando tokens de diseno centralizados y ColorScheme semantico.

### 3.1 Sistema de diseno

> ✅ **Implementado** (rama `uxnanmobile`): tokens en `lib/presentation/theme/` (`colors.dart`, `typography.dart`, `spacing.dart`) y `buildUxnanTheme()` adaptativo para claro/oscuro. Nota: se usa `Color.withValues(alpha:)` en lugar de `withOpacity()` (deprecado en Flutter actual). Las fuentes Inter/JetBrainsMono ya están incluidas en `assets/fonts/` y declaradas en `pubspec.yaml` (verificado en dispositivo).

Uxnan usa un sistema de diseno propio basado en Material Design 3 con personalizacion especifica para el contexto de terminal/codigo.

#### Paleta de colores

```dart
// lib/presentation/theme/colors.dart

class UxnanColors {
  // Primario — azul profundo (identidad del producto)
  static const primary = Color(0xFF1B6EF3);
  static const primaryContainer = Color(0xFF0D3A7A);
  static const onPrimary = Color(0xFFFFFFFF);

  // Secundario — verde terminal (codigo, exito, Git)
  static const secondary = Color(0xFF00C896);
  static const secondaryContainer = Color(0xFF003D2C);
  static const onSecondary = Color(0xFF000000);

  // Error y warning
  static const error = Color(0xFFFF4D4D);
  static const warning = Color(0xFFFFA500);
  static const success = Color(0xFF00C896);

  // Superficies y texto: variantes claras y oscuras.
  static const lightSurface = Color(0xFFF8FAFD);
  static const surface = Color(0xFF0F1117);
  static const lightSurfaceVariant = Color(0xFFE7EBF4);
  static const surfaceVariant = Color(0xFF1A1D27);
  static const lightSurfaceElevated = Color(0xFFFFFFFF);
  static const surfaceElevated = Color(0xFF22263A);
  static const lightOutline = Color(0xFFB5BECC);
  static const outline = Color(0xFF2E3347);

  static const lightOnSurface = Color(0xFF111827);
  static const onSurface = Color(0xFFEAEBF0);
  static const lightOnSurfaceMuted = Color(0xFF5B6474);
  static const onSurfaceMuted = Color(0xFF8892A4);
  static const lightOnSurfaceDisabled = Color(0xFF98A1B3);
  static const onSurfaceDisabled = Color(0xFF444A5A);

  // Git especificos
  static const gitAdded = Color(0xFF3FB950);
  static const gitDeleted = Color(0xFFF85149);
  static const gitModified = Color(0xFFE3B341);
  static const gitUntracked = Color(0xFF58A6FF);

  // Estado de conexion
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

#### Tipografia

```dart
// lib/presentation/theme/typography.dart

class UxnanTypography {
  // Fuente principal — Inter para UI
  static const fontFamily = 'Inter';
  // Fuente monoespaciada — JetBrains Mono para codigo
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

#### Mapeo a M3 ColorScheme

```dart
// lib/presentation/theme/uxnan_theme.dart
ThemeData buildUxnanTheme({Brightness brightness = Brightness.dark}) {
  final colorScheme = ColorScheme(
    brightness: brightness,
    primary: UxnanColors.primary,
    onPrimary: UxnanColors.onPrimary,
    primaryContainer: UxnanColors.primaryContainer,
    onPrimaryContainer: UxnanColors.onSurface,
    secondary: UxnanColors.secondary,
    onSecondary: UxnanColors.onSecondary,
    secondaryContainer: UxnanColors.secondaryContainer,
    onSecondaryContainer: UxnanColors.onSurface,
    error: UxnanColors.error,
    onError: Colors.white,
    surface: UxnanColors.surface,
    onSurface: UxnanColors.onSurface,
    surfaceContainerHighest: UxnanColors.surfaceVariant,
    surfaceContainerHigh: UxnanColors.surfaceElevated,
    outline: UxnanColors.outline,
    outlineVariant: UxnanColors.outline.withOpacity(0.5),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: colorScheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: colorScheme.surface,
      foregroundColor: colorScheme.onSurface,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: colorScheme.surfaceContainerHighest,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colorScheme.surfaceContainerHigh,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
    ),
    textTheme: _buildTextTheme(colorScheme),
    fontFamily: UxnanTypography.fontFamily,
  );
}
```

#### Temas personalizables (Personalization → Custom theme)

> ✅ **Implementado** (rama `uxnanmobile`): el usuario diseña temas
> Material 3 completos (todos los roles M3 para light y dark) desde un
> editor dedicado, o importa/exporta temas como JSON. La pantalla
> ofrece una **librería multi-tema** (no un único tema activo): el
> usuario alterna entre los temas guardados o el picker
> System/Light/Dark mediante un *master switch* en la misma pantalla.
> Persistido en `shared_preferences` bajo
> `uxnan.appearance.customThemes` (array JSON de documentos), con
> `uxnan.appearance.activeCustomThemeId` (id del tema activo) y
> `uxnan.appearance.useCustomTheme` (estado del switch).

El builder de tema acepta un `ThemeSource` requerido y, cuando la fuente
es `ThemeSource.custom`, el `CustomTheme` del usuario. Las dos rutas son
**mutuamente excluyentes** — no se mezclan:

1. **`ThemeSource.brand` (default, switch *off*):** se usa la paleta
   hand-tuned de `UxnanColors` para todos los roles M3. La experiencia
   por defecto es identica a antes de la personalizacion (cero
   regresion visual para los usuarios que nunca tocan el switch).
2. **`ThemeSource.custom` (switch *on*, con `CustomTheme` activo):** se
   delega al `ColorScheme` que el usuario seleccionó. El editor ofrece
   *"Derive from seed"* por modo (regenera todos los roles via
   `ColorScheme.fromSeed` para ese modo) y un editor por rol para
   sobreescrituras puntuales. Garantiza coherencia harmoniosa en ambos
   modos porque la fuente es siempre el `ColorScheme` del usuario, no
   una derivacion en runtime.

##### Modelo de estado (3 providers + 1 derivado)

```dart
// lib/presentation/providers/application_providers.dart

/// Librería de temas: built-ins + cualquier tema autoral/importado.
class CustomThemesLibrary extends Notifier<List<CustomTheme>> {
  @override List<CustomTheme> build() { unawaited(_hydrate()); return kBuiltInCustomThemes; }
  Future<void> upsert(CustomTheme theme) async { /* reemplaza por id o agrega */ }
  Future<bool> remove(String id) async {
    if (isBuiltInCustomThemeId(id)) return false; // built-ins protegidos
    /* ... */
  }
  Future<void> resetToBuiltIns() async { /* seed built-ins + switch off */ }
}
final customThemesLibraryProvider =
    NotifierProvider<CustomThemesLibrary, List<CustomTheme>>(CustomThemesLibrary.new);

/// Id del tema activo dentro de la librería (null = sin selección).
final activeCustomThemeIdProvider =
    NotifierProvider<ActiveCustomThemeId, String?>(ActiveCustomThemeId.new);

/// Master switch: true ⇒ app usa el tema activo; false ⇒ System/Light/Dark.
final useCustomThemeProvider =
    NotifierProvider<UseCustomTheme, bool>(UseCustomTheme.new);

/// Provider derivado que `app.dart` y `themeSourceSettingProvider`
/// consumen: resuelve el tema activo cuando el switch está on y hay un
/// id seleccionado; null en cualquier otro caso.
final customThemeSettingProvider = Provider<CustomTheme?>((ref) {
  if (!ref.watch(useCustomThemeProvider)) return null;
  final id = ref.watch(activeCustomThemeIdProvider);
  if (id == null) return null;
  final lib = ref.watch(customThemesLibraryProvider);
  for (final t in lib) { if (t.id == id) return t; }
  return null;
});

class ThemeSourceSetting extends Notifier<ThemeSource> {
  @override ThemeSource build() {
    return ref.watch(customThemeSettingProvider) != null
        ? ThemeSource.custom : ThemeSource.brand;
  }
}
```

```dart
// lib/app.dart
final themeSource = ref.watch(themeSourceSettingProvider);
final customTheme = ref.watch(customThemeSettingProvider); // derived
return MaterialApp.router(
  theme:     buildUxnanTheme(brightness: Brightness.light, themeSource: themeSource, customTheme: customTheme),
  darkTheme: buildUxnanTheme(brightness: Brightness.dark,  themeSource: themeSource, customTheme: customTheme),
  ...
);
```

##### Temas integrados (built-ins)

`kBuiltInCustomThemes` (constante en `application_providers.dart`)
define **dos ejemplos** que se siembran en la librería la primera vez
que arranca la app:

- **`Midnight`** (`uxnan.builtin.midnight`) — azul-violeta profundo,
  *leans dark*: roles light con primarios saturados y surface ramp casi
  blanco, roles dark más profundos.
- **`Sandstone`** (`uxnan.builtin.sandstone`) — ámbar cálido, *leans
  light*: paleta cálida con surface ramp con tinte crema en ambos
  modos.

Los ids con el prefijo `uxnan.builtin.` (`isBuiltInCustomThemeId(id)`)
son **protegidos** — la acción *Delete* en el menú del item está
deshabilitada y `CustomThemesLibrary.remove` los rechaza, así que el
usuario nunca queda con la librería vacía.

##### Personalización (adelgazada) + Theme Manager dedicado

La UI de temas está partida en **dos pantallas**. El modelo viejo (un
único `ExpansionTile` colapsable con la librería embebida en
Personalización, dirigido por `customThemesExpandedProvider`) quedó
**retirado**: la librería vive ahora en una pantalla propia.

**`PersonalizationScreen`** (`lib/presentation/screens/settings/personalization_screen.dart`)
— en estilo Neural Expressive (labels de sección callados + grupos de
tarjetas de esquina dinámica), tres secciones:

1. **Tema** — un `ConnectedButtonGroup<ThemeModeOption>` (System / Light /
   Dark, el reemplazo M3E del `SegmentedButton`). Se **deshabilita**
   (Opacity + IgnorePointer) cuando un custom theme **single-brightness**
   fuerza el brillo (`themePickerEnabledProvider` = false); un theme
   **dual** o el baseline de marca lo dejan libre.
2. **Custom theme** — un `ExpressiveCardGroup` de 2 filas: un `NeSwitchTile`
   master (conmuta `useCustomThemeProvider`; encenderlo sin selección
   activa el primer tema de la librería) + un `NeNavTile` que entra al
   Theme Manager, mostrando el nombre del tema activo + un mini-palette de
   4 puntos (o chevron si no hay activo).
3. **Idioma** — grupo de filas de radio (system default + cada locale
   soportado), sin cambios funcionales respecto al modelo anterior.

**`ThemeManagerScreen`** (`lib/presentation/screens/settings/theme_manager_screen.dart`)
— la librería multi-tema completa, separada de Personalización:

- **Grid de cards de preview en vivo**: dual = light\|dark lado a lado,
  single = un panel; chip de brillo + badges *Active* / *Built-in*.
- **Tap** activa el tema; **long-press** entra en modo multi-selección
  para **borrar / exportar en bloque**.
- **New** / **Import** / **Export all** / **Reset** viven en el `NeTopBar`.
  *New* abre el editor (`CustomThemeEditorScreen`); *Reset* llama
  `customThemesLibraryProvider.notifier.resetToBuiltIns()` (restaura
  `kBuiltInCustomThemes`, limpia el active id y apaga el switch).
- **Import** es una **pantalla completa** (`ThemeImportScreen`,
  `theme_sheets.dart`) — no un sheet (un sheet acotado desbordaba con un blob
  grande) — con el patrón de formulario NE (à la `ManualCodeScreen`): `NeTopBar`
  transparente con Close, un campo que **llena la pantalla y hace scroll
  interno**, la fila de fuentes alternativas y una CTA **Import** inferior a todo
  el ancho (deshabilitada hasta que hay texto). Acepta formato nativo, Material
  Theme Builder y flat (objeto único o array); la fuente puede ser **pegar**,
  **un archivo `.json`** (`file_picker`) o **una URL http(s)** (`dio`,
  `ResponseType.plain`, timeouts + tope de 5 MB) — las tres llenan el mismo campo
  para revisar antes de importar. **Ids built-in:** al importar, un id
  `uxnan.builtin.*` (o cualquier colisión) recibe un id fresco, así ningún import
  queda como "integrado" (no borrable / no persistido); al exportar, un tema
  built-in se emite con un id fresco no-builtin para que reimporte como custom
  normal. **Export** sigue siendo un bottom sheet: *Copy to clipboard* o *Save to
  file* (`share_plus`), por tema o `Export all` (array pretty-printed).

##### Editor (`CustomThemeEditorScreen`)

`CustomThemeEditorScreen` (`lib/presentation/screens/settings/custom_theme_editor_screen.dart`)
es el editor completo. El botón *Save* llama
`ref.read(customThemesLibraryProvider.notifier).upsert(next)` (sin
cambiar el id, así editar el tema activo lo deja activo). Si el id es
**nuevo** (no estaba en la librería), Save además (a) activa el tema
(`activeCustomThemeIdProvider` ← id, `useCustomThemeProvider` ← true)
y (b) sincroniza `themeModeSettingProvider` al `Brightness` de la
pestaña que el editor tenía activa, para que el lado light/dark
correcto del esquema personalizado sea el que Material aplica al
pop. Editar un tema existente no cambia activation ni themeMode.
Acepta un `initialBrightness` opcional (`Brightness.light` por
defecto) para que el dialog *+ New theme* pueda abrir el editor en la
pestaña que el usuario eligió. Estructura:

- **Barra superior** (`NeScaffold` + `NeTopBar`): título, accion
  `Export` (copia el JSON al portapapeles + dialog con JSON
  pretty-printed seleccionable; el dialog incluye además un botón
  *Share file* que abre el share sheet nativo con
  `uxnan-theme-<slug>.json` via `share_plus`) y accion `Import`
  (dialog con text field para pegar JSON; falla silenciosa con
  snackbar si el JSON no parsea).
- **Metadatos**: campos *Name* (requerido, se usa como título en la
  fila de la librería) y *Description* (opcional, persiste en el
  JSON pero no se renderiza en la fila).
- **Tabs Light / Dark** (`SegmentedButton<Brightness>`): cambiar de
  tab no cambia el tema aplicado — es estado local hasta *Save*.
- **Lista de roles agrupados** (`_RoleList`): cada grupo (Primary,
  Secondary, Tertiary, Error, Surface, Outline & inverse) es una
  `Material(color: surfaceContainerHighest)` con `_GroupHeader` y
  filas por rol. Cada fila muestra la etiqueta, el valor hex y un
  swatch circular. Tap → `ColorPickerSheet` (HSV picker con sliders
  H/S/V, hex field, preview, Apply/Cancel).
- **Botones "Reset brightness"** (regenera el modo activo desde la
  `primary` actual via `ColorScheme.fromSeed`) **y "Derive from seed"**
  (regenera desde un nuevo seed elegido via dialog con HSV picker).

##### `ColorPickerSheet`

`ColorPickerSheet` (`lib/presentation/widgets/color_picker.dart`) sigue
siendo el sheet HSV que el editor abre al tocar el swatch de un rol.
Sigue siendo un detalle interno del editor — el usuario llega a él
vía *Edit* sobre cualquier tema de la librería (un item con popup
menu), no como destino de primer nivel. El picker ofrece preview +
sliders H/S/V + campo hex + Apply/Cancel.

##### `CustomTheme`

`CustomTheme` (`lib/domain/value_objects/custom_theme.dart`) — sin
cambios funcionales respecto al modelo anterior:

- `id` (UUID v4 u opaco; los ids built-in usan el prefijo
  `uxnan.builtin.`), `name`, `description` opcional, `schemaVersion`
  (default 1).
- `lightColors` + `darkColors` (`CustomThemeColors` con los 46 roles
  públicos de `ColorScheme`, expuestos como campos planos — sin
  dependencias de `flutter/material` para serializar).
- Constructores: `CustomTheme({...})` (light only, dark derivado),
  `CustomTheme.fromDualSchemes({light, dark})` (light + dark
  independientes), `CustomTheme.derivedFromSeed({seed, ...})`
  (regenera ambos modos via `ColorScheme.fromSeed`).
- Copy-with: `withLightColors`, `withDarkColors`, `withMetadata`.
- JSON: `toJson` / `fromJson` / `toJsonString` / `fromJsonString`.
  Hex strings con `#AARRGGBB` (preferido, human-readable) y enteros
  ARGB de 32 bits (compatibilidad con exports anteriores). Roles
  desconocidos se ignoran; roles faltantes caen a defaults seguros de
  Material 3 — un documento parcial (o hand-editado) sigue cargando
  sin lanzar.
- Versionado: `schemaVersion` se persiste en el JSON; el parser es
  tolerante con `version` faltante (asume 1) y rechaza / migra en el
  futuro.

##### Almacenamiento

`AppearancePreferencesStore` (`lib/infrastructure/storage/appearance_preferences_store.dart`)
añade tres pares de getters bajo nuevas claves:

- `uxnan.appearance.customThemes` — JSON array de
  `CustomTheme.toJson()`. Tolerante con entradas malformadas (se
  omiten sin tirar la librería entera).
- `uxnan.appearance.activeCustomThemeId` — `String?` (id del tema
  activo; ausente = sin selección).
- `uxnan.appearance.useCustomTheme` — `bool` (estado del master
  switch; default false).

El getter legacy `uxnan.appearance.customTheme` se mantiene
**sólo para migración**: en el primer hydrate de la librería, si la
clave nueva está ausente pero la legacy existe, se copia su contenido
a la librería, se setea el active id, se enciende el switch, y se
borra la clave legacy. Hidrates posteriores nunca tocan la clave
legacy.

##### Justificación del rediseño (v2 — librería)

El picker anterior (un único tema activo seleccionado vía el 4to
segmento *Custom* del `SegmentedButton`) tenía dos fricciones:

1. **El editor y los temas importados quedaban escondidos.** Para
   abrir el editor el usuario tenía que seleccionar primero *Custom*,
   lo que dependía de haber persistido un tema antes (si la librería
   estaba vacía el segmento estaba deshabilitado). Un usuario nuevo
   que quería probar un tema importado tenía que navegar un
   callejón sin salida. La librería visible desde el primer arranque
   elimina ese descubrimiento.
2. **No había forma de tener varios temas seleccionables.** Un
   usuario que diseña un tema *Midnight* y otro *Sandstone* tenía que
   importar/exportar uno cada vez. La librería multi-tema es el
   modelo natural para *pick a theme from your library*.

El switch master reemplaza la semántica del antiguo segmento *Custom*:
cuando el switch está on, la app aplica el tema activo; cuando está
off, el picker System/Light/Dark conduce. Un custom theme
**single-brightness** además fuerza su brillo y deshabilita el picker
(`themePickerEnabledProvider`), mientras que un theme **dual** deja al
usuario alternar System/Light/Dark sobre su propio esquema.

### 3.2 Componentes de UI criticos

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
// Item de thread en la lista lateral

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
                  Text(thread.title.nonEmpty ?? 'Sin titulo',
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
              // Boton adjuntar imagen
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

              // Boton de voz
              IconButton(
                icon: const Icon(Icons.mic_none),
                onPressed: _startVoiceInput,
                color: UxnanColors.onSurfaceMuted,
              ),

              // Boton de envio
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

### 3.3 Layouts responsive

```dart
// lib/presentation/screens/shell/app_shell_screen.dart
// La shell detecta el ancho y decide el layout

class AppShellScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;

    // < 600dp: layout movil (nav drawer o bottom nav)
    if (width < 600) {
      return _MobileLayout();
    }
    // >= 600dp: layout tablet (NavigationRail + panel lateral)
    return _TabletLayout();
  }
}

class _MobileLayout extends StatelessWidget {
  // Navegacion: Scaffold + Drawer para sidebar
  // ConversationScreen ocupa toda la pantalla
}

class _TabletLayout extends StatelessWidget {
  // NavigationRail lateral fijo (72dp)
  // SidebarPanel (280dp) + ConversationScreen (resto)
  // Implementado con Row + Expanded
}
```

---

## 4. Plan de pruebas

### 4.1 Estrategia de testing

La estrategia sigue la piramide de testing: mas unit tests, menos tests de integracion, menos aun de UI.

```
         +-------------------+
         |  E2E / UI Tests   |  <- 10%  (integration_test/)
         +-------------------+
         |  Widget Tests     |  <- 30%  (test/widget/)
         +-------------------+
         |   Unit Tests      |  <- 60%  (test/unit/)
         +-------------------+
```

### 4.2 Tests unitarios

#### Dominio — entidades y value objects

```dart
// test/unit/domain/entities/thread_test.dart
void main() {
  group('Thread', () {
    test('debe crear thread con valores validos', () {
      final thread = Thread(
        id: 'thread-1',
        title: 'Mi conversacion',
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

    test('debe lanzar TimeoutException despues del timeout', () async {
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

#### Criptografia — handshake

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

#### Deduplicacion de mensajes

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

### 4.3 Tests de widgets

```dart
// test/widget/presentation/screens/conversation/composer_widget_test.dart
void main() {
  testWidgets('ComposerWidget muestra boton de envio deshabilitado sin conexion',
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

  testWidgets('ComposerWidget envia el mensaje al presionar send', (tester) async {
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
  testWidgets('ThreadListItem muestra el titulo del thread', (tester) async {
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

### 4.4 Tests de integracion

```dart
// integration_test/connection_flow_test.dart
// Requiere un bridge real o un mock server corriendo localmente

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Flujo completo: pairing -> conexion -> thread list',
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

    // Verificar que la lista de threads esta presente
    expect(find.byType(ThreadListItem), findsWidgets);

    await mockBridge.stop();
  });
}
```

---

## 5. Estrategia de build y CI/CD

### 5.1 Configuracion de pubspec.yaml

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

  # Navegacion
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

  # Criptografia
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

  # Camara y QR
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

### 5.2 Scripts de build

```bash
# Generacion de codigo (ejecutar antes de cada build)
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

# Analisis de codigo
flutter analyze
dart format --set-exit-if-changed lib/ test/
```

### 5.3 Pipeline CI/CD (GitHub Actions)

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

## 6. Internacionalizacion (i18n)

### 6.1 Archivos ARB

```json
// l10n/app_es.arb
{
  "@@locale": "es",
  "appTitle": "Uxnan",
  "connectionConnected": "Conectado",
  "connectionConnecting": "Conectando...",
  "connectionDisconnected": "Desconectado",
  "connectionHandshaking": "Estableciendo sesion segura...",
  "connectionReconnecting": "Reconectando...",
  "connectionSyncing": "Sincronizando...",
  "onboardingWelcomeTitle": "Controla tus agentes desde cualquier lugar",
  "onboardingWelcomeSubtitle": "Uxnan te conecta con los agentes de codificacion IA que corren en tu PC, de forma segura y sin intermediarios.",
  "onboardingInstallStep": "Instala el bridge en tu PC",
  "onboardingInstallCommand": "npm install -g uxnan-bridge",
  "onboardingScanQrTitle": "Escanea el QR de tu PC",
  "onboardingScanQrSubtitle": "Ejecuta uxnan-bridge qr en tu PC para ver el codigo QR",
  "pairingScanButtonLabel": "Escanear QR",
  "pairingManualCodeLabel": "Ingresar codigo manual",
  "pairingExpiredError": "El codigo QR ha expirado. Genera uno nuevo con uxnan-bridge qr",
  "pairingInvalidError": "Codigo QR no valido",
  "pairingBridgeUpdateRequired": "Actualiza el bridge antes de continuar",
  "threadsEmptyTitle": "No hay conversaciones",
  "threadsEmptySubtitle": "Inicia una nueva conversacion con tu agente desde el boton +",
  "composerPlaceholder": "Escribe un mensaje...",
  "composerSendQueued": "Se enviara al conectar",
  "gitCommitDialogTitle": "Commit",
  "gitCommitMessageLabel": "Mensaje de commit",
  "gitCommitButton": "Confirmar",
  "gitPushButton": "Publicar",
  "gitPullButton": "Actualizar",
  "gitCreateBranchButton": "Nueva rama",
  "gitRevertButton": "Revertir cambios",
  "gitNothingToCommit": "No hay cambios para commitear",
  "gitBranchProtected": "Esta rama esta protegida",
  "gitConflictsDetected": "Hay conflictos de merge",
  "settingsTitle": "Configuracion",
  "settingsConnection": "Conexion",
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
  "errorGeneric": "Ocurrio un error. Intenta de nuevo.",
  "errorAgentNotRunning": "El agente no esta corriendo en tu PC",
  "errorBridgeVersionIncompatible": "Version del bridge incompatible. Actualiza con: npm update -g uxnan-bridge",
  "errorSessionExpired": "La sesion expiro. Vuelve a conectar."
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

### 6.2 Configuracion de l10n

```yaml
# l10n.yaml (raiz del proyecto)
arb-dir: l10n
template-arb-file: app_es.arb
output-localization-file: app_localizations.dart
output-class: AppLocalizations
preferred-supported-locales: [es, en]
```

---

## 7. Manifiesto de permisos

### 7.1 Android (`AndroidManifest.xml`)

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

### 7.2 iOS (`Info.plist`)

```xml
<!-- Camara — requerida para escaneo de QR -->
<key>NSCameraUsageDescription</key>
<string>Uxnan necesita la camara para escanear el codigo QR de tu PC y establecer la conexion segura.</string>

<!-- Red local — requerida para conexion LAN directa al bridge -->
<key>NSLocalNetworkUsageDescription</key>
<string>Uxnan necesita acceso a la red local para conectarse directamente al bridge instalado en tu PC cuando ambos estan en la misma red Wi-Fi.</string>
<key>NSBonjourServices</key>
<array>
    <string>_uxnan-bridge._tcp</string>
</array>

<!-- Microfono — para voice input (feature post-MVP) -->
<key>NSMicrophoneUsageDescription</key>
<string>Uxnan puede usar el microfono para enviar mensajes de voz a tu agente de codificacion.</string>

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

## 8. Consideraciones de despliegue y auto-hosting

### 8.1 Relay auto-hospedado

El relay puede desplegarse en cualquier VPS con Node.js 18+. Configuracion minima recomendada:

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

Configuracion del relay para este escenario:

```bash
# .env del relay
PORT=8080
TRUST_PROXY=true
# ... resto de variables de APNs y FCM
```

En la app, el usuario configura la URL de su relay auto-hospedado en Settings -> Conexion -> URL del relay.

### 8.2 Relay oficial de Uxnan

Uxnan provee un relay oficial en `wss://relay.uxnan.io` para los usuarios que no quieren self-host. Este relay:
- Solo ve sessionId, tamano de envelopes cifrados y tokens push.
- No almacena contenido de conversaciones.
- Cumple con GDPR por no procesar datos personales del contenido.
- Tiene SLA de 99.5% uptime.

---

## 9. Manejo de errores y recuperacion

### 9.1 Taxonomia de errores de la app

Todos los errores de la app se tipan en una jerarquia sellada que permite manejo exhaustivo en la UI:

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

// Errores de handshake / sesion
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

### 9.2 Error boundaries en la UI

```dart
// lib/presentation/widgets/error_boundary.dart
// Wrapper para capturar y mostrar errores de forma amigable en cualquier widget

class ErrorBoundary extends StatelessWidget {
  final Widget child;
  final Widget Function(AppException error, VoidCallback retry)? errorBuilder;

  const ErrorBoundary({required this.child, this.errorBuilder, super.key});

  @override
  Widget build(BuildContext context) {
    return child; // En produccion, wrappear con ErrorWidget.builder customizado
  }
}

// Registro global del error builder en main.dart
ErrorWidget.builder = (FlutterErrorDetails details) {
  return ErrorCardWidget(
    message: 'Algo salio mal en esta seccion',
    onRetry: () => details.context?.markNeedsBuild(),
  );
};
```

### 9.3 Recovery card de conexion

Cuando la app pierde la conexion, en lugar de bloquear la UI entera, se muestra un banner no-intrusivo en la ConversationScreen:

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

### 9.4 Errores Git — mensajes de producto

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
      GitErrorKind.pushRejected => 'El push fue rechazado. Necesitas hacer pull primero?',
      GitErrorKind.worktreeAlreadyExists => 'Ya existe un worktree con ese nombre',
      GitErrorKind.unknown => '${l10n.errorGeneric}: ${e.technicalDetail ?? ''}',
    };
  }
}
```

---

## 10. Modelos de base de datos (Drift)

> ✅ **Implementado** (rama `uxnanmobile`): esquema completo (7 tablas, `schemaVersion` 1, pragmas WAL/foreign_keys), `UxnanDatabase` con constructor `forTesting`, y `DriftThreadRepository` + `DriftComposerDraftRepository` con tests in-memory. Ajuste vs. spec: los índices usan la anotación real de drift `@TableIndex(...)` en lugar del `List<Index> get indexes` mostrado abajo (que es pseudocódigo de referencia). `DriftMessageRepository` se implementa con el módulo de conversación, junto con la jerarquía sellada `MessageContent`.

### 10.1 Definicion completa de tablas

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
  // macIdentityPublicKey se guarda en SecureStore, no aqui
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

### 10.2 Definicion de la base de datos principal

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
      // Migraciones futuras aqui
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

### 10.3 Repositorios Drift — implementaciones completas

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

## 11. Estado de reconexion

El sistema de reconexion es uno de los mas criticos para la experiencia del usuario. Esta seccion lo especifica en detalle.

### 11.1 Maquina de estados de reconexion

```
                     +-------------------------------------+
                     |           DISCONNECTED               |
                     |   (app abierta, sin sesion activa)   |
                     +----------------+--------------------+
                                      | connect() llamado
                                      v
                     +-------------------------------------+
                     |            CONNECTING                |
                     |     (abriendo WebSocket al relay)    |
                     +----------+--------------------------+
                                | WebSocket abierto
                                v
                     +-------------------------------------+
                     |           HANDSHAKING                |
              +----->|  (intercambio Ed25519 + X25519)      |
              |      +----------+--------------------------+
              |                 | ready recibido
              |                 v
              |      +-------------------------------------+
              |      |             SYNCING                  |
              |      |   (catch-up de mensajes perdidos)    |
              |      +----------+--------------------------+
              |                 | sync completado
              |                 v
              |      +-------------------------------------+
              |      |            CONNECTED                 |<-----+
              |      |     (sesion E2EE activa, bidirec.)   |      |
              |      +----------+--------------------------+      |
              |                 | WS cerrado / error              |
              |                 v                                  |
              |      +-------------------------------------+      |
              +------+          RECONNECTING                |      |
                     |   (backoff exp.: 1->2->4->8->16->60s)  |------+
                     +----------+--------------------------+
                                | max reintentos excedidos (10)
                                v
                     +-------------------------------------+
                     |              ERROR                   |
                     |   (requiere intervencion del user)   |
                     +-------------------------------------+
```

### 11.2 ConnectionRecoveryState

```dart
// lib/domain/entities/connection_recovery_state.dart

class ConnectionRecoveryState {
  final bool isRecovering;
  final int attempt;                    // intento actual (1-based)
  final int maxAttempts;                // default: 10
  final Duration nextRetryIn;           // tiempo hasta el proximo intento
  final DateTime? lastConnectedAt;
  final String? lastErrorMessage;
  final bool requiresManualIntervention; // true si supero maxAttempts

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

### 11.3 BackoffCalculator

```dart
// lib/infrastructure/transport/backoff_calculator.dart

class BackoffCalculator {
  static const _baseDurationSec = 1;
  static const _maxDurationSec = 60;
  static const _jitterFactorMax = 0.3;   // +/-30% de jitter para evitar thundering herd

  static Duration compute(int attempt) {
    // Exponencial: 1, 2, 4, 8, 16, 32, 60, 60, 60...
    final exp = min(_baseDurationSec * pow(2, attempt - 1), _maxDurationSec);
    // Jitter aleatorio para evitar sincronizacion de multiples clientes
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

### 11.4 Comportamiento del outbound buffer durante reconexion

```dart
// lib/infrastructure/transport/outbound_message_buffer.dart

class OutboundMessageBuffer {
  // Mensajes que el telefono quiso enviar mientras estaba desconectado
  // Se envian en orden al reconectar, antes de cualquier mensaje nuevo
  final Queue<PendingOutboundMessage> _queue = Queue();
  final int maxSize;     // default: 100 mensajes de usuario

  void enqueue(RpcMessage message) {
    if (_queue.length >= maxSize) {
      // Si la cola esta llena, descarta el mas antiguo (sliding window)
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

## 12. Modulo SSH Terminal

### 12.1 Arquitectura del modulo SSH

El modulo SSH Terminal permite al usuario conectarse por SSH a su PC de trabajo directamente desde la app. Esto es util para ejecutar comandos arbitrarios, monitorear procesos, o gestionar el bridge y el agente desde el movil.

```
TerminalScreen
+-- ConnectionEditorSheet              # crear / editar perfiles SSH
+-- ProfileListView                    # lista de perfiles guardados
+-- TerminalSurface                    # terminal xterm activo
    +-- XtermWidget                    # emulador de terminal (paquete xterm)
    +-- KeyboardToolbar                # teclas especiales: Ctrl, Esc, Tab, flechas
    +-- SessionStatusBar               # info de conexion activa
```

### 12.2 Modelos SSH

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
  final String? terminalTitle;             // titulo del pty
  final int pid;
  final DateTime connectedAt;
  const SshSession({...});
}

enum SshConnectionStatus { connecting, connected, disconnected, error }
```

### 12.3 SshTerminalAdapter — implementacion con dartssh2

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

    // Abrir sesion de shell
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

  // Redimensionar el pty al cambiar orientacion o tamano del teclado
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

### 12.4 TerminalSurface con xterm

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

### 12.5 KeyboardToolbar

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

## 13. Modulo de onboarding

### 13.1 Flujo completo de onboarding

El onboarding esta disenado para llevar a un desarrollador desde cero hasta la primera conexion activa en menos de 5 minutos.

```
OnboardingScreen
+-- PageController con 4 paginas
+-- Indicadores de pagina (dots)
+-- Boton "Siguiente" / "Comenzar" en el ultimo paso

Pagina 1: WelcomePage
+-- Animacion Lottie de agente en accion (loop)
+-- Titulo: "Controla tus agentes desde cualquier lugar"
+-- Subtitulo: descripcion del producto en 2 lineas
+-- Boton: "Comenzar" -> avanza a pagina 2

Pagina 2: FeaturesPage
+-- Lista de 4 caracteristicas clave:
|   +-- Cifrado E2EE — "Tu codigo nunca toca nuestros servidores"
|   +-- Multi-agente — "Compatible con Codex, OpenCode, Gemini CLI y mas"
|   +-- Local-first — "Funciona en tu red local sin internet"
|   +-- Notificaciones — "Te avisamos cuando el agente termina"
+-- Boton: "Siguiente" -> pagina 3

Pagina 3: InstallStepPage
+-- Titulo: "Instala el bridge en tu PC"
+-- Tabs: macOS | Windows | Linux
+-- CommandCardWidget con el comando de instalacion
|   +-- npm install -g uxnan-bridge
|       (boton de copia automatica)
+-- CommandCardWidget con el comando de inicio
|   +-- uxnan-bridge start
+-- CommandCardWidget para mostrar el QR
|   +-- uxnan-bridge qr
+-- Boton: "Ya lo instale, escanear QR" -> pagina 4

Pagina 4: PairingStep
+-- Titulo: "Escanea el QR de tu PC"
+-- Subtitulo: "El QR aparece en tu terminal al ejecutar uxnan-bridge qr"
+-- Boton primario: "Escanear QR" -> QrScannerScreen
+-- Boton secundario: "Ingresar codigo manual" -> ManualCodeScreen
```

### 13.2 CommandCardWidget

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

## 14. Modulo de settings

### 14.1 Arbol de configuracion

```
SettingsScreen
+-- Seccion: Conexion
|   +-- URL del relay
|   |   +-- Valor default: wss://relay.uxnan.io
|   |   +-- Editable para self-hosted relay
|   +-- Timeout de requests (segundos)
|   |   +-- Default: 30
|   |   +-- Rango: 10-120
|   +-- Modo de conexion preferido
|   |   +-- Auto (LAN si disponible, relay como fallback) — default
|   |   +-- Solo LAN
|   |   +-- Solo Relay
|   +-- Reconexion automatica
|       +-- Activar/desactivar (default: activado)
|       +-- Max intentos (default: 10)
|
+-- Seccion: Agentes
|   +-- Lista de proyectos configurados
|   |   +-- ProjectCard (nombre, cwd, agente)
|   |   +-- Editar -> ProjectEditor
|   |   +-- Eliminar
|   +-- Agregar proyecto -> ProjectEditor
|
+-- Seccion: Notificaciones
|   +-- Notificaciones de turno completado
|   |   +-- Activar/desactivar
|   |   +-- Solo cuando la app esta en background
|   +-- Notificaciones de error del agente
|   +-- Sonido de notificacion
|
+-- Seccion: Apariencia
|   +-- Tema: Oscuro (default) | Claro | Sistema
|   +-- Tamano de fuente del terminal SSH
|
+-- Seccion: Mis equipos
|   +-- -> MyDevicesScreen
|
+-- Seccion: Acerca de
    +-- Version de la app
    +-- Version del protocolo
    +-- Politica de privacidad -> WebView
    +-- Codigo fuente (GitHub) -> abrir navegador
    +-- Restablecer configuracion
```

### 14.2 ProjectEditor

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

          // Seleccion de agente
          _SectionTitle('Agente de codificacion'),
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

          // Configuracion especifica del agente
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

## 15. Analisis estatico y calidad de codigo

### 15.1 Configuracion de analysis_options.yaml

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

### 15.2 Scripts de calidad

```bash
# Verificar formato
dart format --output=none --set-exit-if-changed lib/ test/

# Analisis estatico
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

## 16. Apendices tecnicos

### Apendice A — Sequence diagram: handshake completo

```
 iPhone App              Relay Server             Bridge Daemon (PC)
     |                       |                          |
     |-- WS connect -------->|                          |
     |   x-role: iphone      |                          |
     |   x-session-id: UUID  |                          |
     |                       |<-- WS connect -----------|
     |                       |    x-role: mac            |
     |                       |    x-session-id: UUID     |
     |                       |    x-mac-device-id: ...   |
     |                       |    x-notification-secret  |
     |                       |                          |
     | <- relay connected ---|                          |
     |                       |                          |
     |-- clientHello --------+------------------------->|
     |  {kind, proto, mode,  |  (relay reenvia opaco)   |
     |   phoneDevId, phonePub|                          |
     |   phoneEphPub, nonce} |                          |
     |                       |                          |
     |<- serverHello --------+--------------------------|
     |  {macPub, macEphPub,  |  (relay reenvia opaco)   |
     |   serverNonce, epoch, |                          |
     |   macSignature, ...}  |                          |
     |                       |                          |
     |  verifica macSignature|                          |
     |  deriva clave HKDF    |                          |
     |                       |                          |
     |-- clientAuth ---------+------------------------->|
     |  {phoneDevId, epoch,  |                          |
     |   phoneSignature}     |                          |
     |                       |                          |
     |                       |          verifica         |
     |                       |          phoneSignature   |
     |                       |          persiste trust   |
     |                       |                          |
     |<- ready --------------+--------------------------|
     |  {sessionId, epoch,   |                          |
     |   macDeviceId}        |                          |
     |                       |                          |
     | == sesion E2EE activa=|==========================|
     |                       |                          |
     |-- [E2EE] thread/list -+------------------------->|
     |<- [E2EE] response ----+--------------------------|
     |                       |                          |
```

### Apendice B — Sequence diagram: notificacion push completa

```
 Bridge Daemon           Relay Server         APNs/FCM         iPhone App
     |                       |                   |                 |
     |  turn completed       |                   |                 |
     |  (agente termina)     |                   |                 |
     |                       |                   |                 |
     |  check push-tracker   |                   |                 |
     |  check dedupe keys    |                   |                 |
     |  -> not duplicate     |                   |                 |
     |                       |                   |                 |
     |-- POST /push/notify ->|                   |                 |
     |  {sessionId,          |                   |                 |
     |   notificationSecret, |                   |                 |
     |   threadId, turnId,   |                   |                 |
     |   title, body}        |                   |                 |
     |                       |                   |                 |
     |                  valida secret            |                 |
     |                  no duplicado             |                 |
     |                  busca token push         |                 |
     |                       |                   |                 |
     |                       |-- push payload -->|                 |
     |                       |  iOS: APNs HTTP/2 |                 |
     |                       |  Android: FCM     |                 |
     |                       |                   |                 |
     |                       |                   |-- push -------->|
     |                       |                   |                 |
     |                       |                   |          handle push
     |                       |                   |          navega a thread
     |                       |                   |          conecta si offline
     |                       |                   |                 |
```

### Apendice C — Formato del envelope E2EE

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
1. Serializar el RpcMessage como JSON -> bytes UTF-8
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

### Apendice D — Tabla de compatibilidad de versiones

El sistema tiene dos componentes versionados de forma independiente: la app movil y el bridge. La compatibilidad se verifica en el handshake:

| App version | Bridge minimo | Notas |
|---|---|---|
| 1.0.x | 1.0.0 | Version inicial |
| 1.1.x | 1.0.0 | Compatible hacia atras |
| 1.2.x | 1.1.0 | Requiere bridge con soporte de checkpoints |
| 1.3.x | 1.2.0 | Requiere bridge con soporte SSH relay |
| 2.0.x | 2.0.0 | Cambio de protocolo (voice, subagentes) |

Cuando el bridge tiene una version incompatible con la app:
1. El bridge envia en `serverHello`: `minAppVersion: "2.0.0"`
2. La app detecta que su version es menor
3. La app muestra `UpdatePromptDialog` con instrucciones para actualizar
4. La conexion se cierra ordenadamente

Cuando la app tiene una version incompatible con el bridge (app nueva, bridge viejo):
1. El bridge recibe `protocolVersion: 2` en `clientHello`
2. El bridge no reconoce la version
3. El bridge responde con error `-32005` (bridge version incompatible)
4. La app muestra instrucciones para actualizar el bridge

### Apendice E — Constantes de protocolo completas

```dart
// lib/core/constants/protocol_constants.dart

abstract final class ProtocolConstants {
  // Versiones
  static const int secureProtocolVersion = 1;
  static const int pairingQrVersion = 2;

  // Criptografia
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

  // Outbound buffer (bridge -> phone)
  static const int maxBridgeOutboundMessages = 500;
  static const int maxBridgeOutboundBytes = 10 * 1024 * 1024; // 10 MB

  // Outbound buffer (phone -> bridge, para mensajes encolados offline)
  static const int maxPhoneOutboundMessages = 100;

  // Reconexion
  static const int maxReconnectAttempts = 10;
  static const int backoffBaseSec = 1;
  static const int backoffMaxSec = 60;
  static const double backoffJitterFactor = 0.3;

  // Codigo de pairing manual
  static const int shortPairingCodeLength = 6;

  // Paginacion
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

### Apendice F — Checklist de release

Antes de cada release de produccion, verificar:

**App Flutter:**
- [ ] `flutter analyze` sin errores
- [ ] `dart format --set-exit-if-changed` pasa
- [ ] `flutter test` 100% verde
- [ ] `flutter build apk --release` compila sin warnings
- [ ] `flutter build ios --release` compila sin warnings
- [ ] Numeros de version actualizados en `pubspec.yaml`
- [ ] `CHANGELOG.md` actualizado
- [ ] Permisos en AndroidManifest.xml correctos
- [ ] Permisos en Info.plist correctos
- [ ] `GoogleService-Info.plist` y `google-services.json` actualizados
- [ ] Screenshots actualizados en el store

**Bridge:**
- [ ] Tests del bridge pasan: `npm test`
- [ ] Lint: `npm run lint` sin errores
- [ ] Version en `package.json` actualizada
- [ ] `CHANGELOG.md` del bridge actualizado
- [ ] Compatible con la version minima de Node.js soportada (Node 18 LTS)
- [ ] Publicado en npm: `npm publish`

**Relay:**
- [ ] Tests del relay pasan: `npm test`
- [ ] Variables de entorno de produccion verificadas
- [ ] Certificados APNs vigentes (caducan anualmente)
- [ ] Service account de FCM valida
- [ ] Health check activo y respondiendo

---

*Fin del documento. Version 1.0.0 — Uxnan Guia de Implementacion*
