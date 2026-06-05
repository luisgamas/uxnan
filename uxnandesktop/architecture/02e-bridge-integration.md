# Integracion del Bridge y Conexion Movil

> **Version:** 1.0.0
> **Fecha:** 2026-06-05
> **Estado:** Definicion inicial
> **Plataformas objetivo:** Windows (principal), macOS, Linux
> **Stack:** Rust, Tauri 2, Svelte 5, Node.js (bridge)

> Este documento forma parte de la documentacion tecnica de Uxnan Desktop (ADE). Ver tambien: [00-index.md](00-index.md) | [02a-system-architecture.md](02a-system-architecture.md) | [02d-agent-monitoring.md](02d-agent-monitoring.md) | [03-implementation-guide.md](03-implementation-guide.md)

---

## Tabla de contenidos

1. [Vision general de la integracion](#1-vision-general-de-la-integracion)
2. [Modo standalone (bridge como daemon independiente)](#2-modo-standalone-bridge-como-daemon-independiente)
3. [Modo embebido (bridge integrado en desktop)](#3-modo-embebido-bridge-integrado-en-desktop)
4. [Contratos compartidos (shared/)](#4-contratos-compartidos-shared)
5. [Conexion movil desde el desktop](#5-conexion-movil-desde-el-desktop)
6. [Configuracion del bridge en desktop](#6-configuracion-del-bridge-en-desktop)
7. [Migracion entre modos](#7-migracion-entre-modos)
8. [Consideraciones de seguridad](#8-consideraciones-de-seguridad)

---

## 1. Vision general de la integracion

El Uxnan Bridge es el componente conector entre la app movil (Flutter, Android+iOS) y la PC del desarrollador. Es el daemon que ejecuta las operaciones locales que el telefono solicita: consultas Git, lectura de archivos, interaccion con agentes AI, gestion de worktrees y checkpoints.

### Responsabilidades del bridge

El bridge gestiona todas las operaciones criticas de la conexion movil-PC:

- **Handshake E2EE**: Establece la sesion cifrada end-to-end con el telefono. El relay nunca ve contenido en texto claro.
- **Pairing por QR**: Genera el payload de pairing que el telefono escanea para iniciar la conexion segura.
- **Ruteo JSON-RPC**: Recibe metodos JSON-RPC del movil y los enruta al handler correspondiente (Git, workspace, threads, agentes).
- **Agent adapters**: Interactua con los CLI de agentes AI (Claude Code, Codex CLI, OpenCode, Gemini CLI, Aider, pi-agent) a traves de adaptadores que implementan `IAgentAdapter`.
- **Operaciones Git**: Ejecuta comandos Git localmente via `child_process` (status, diff, commit, push, pull, worktrees).
- **Gestion de workspace**: Lectura de archivos, listado de directorios, checkpoints, aplicacion de patches.

### Por que integrar el bridge en el desktop

Cuando el bridge corre como proceso independiente y el desktop ADE como aplicacion separada, el usuario necesita instalar, configurar y mantener dos componentes. Al integrar el bridge dentro del desktop:

- **Instalacion unica**: El usuario instala el ADE y obtiene la funcionalidad del bridge incluida.
- **Experiencia unificada**: Configuracion, estado y monitoreo se gestionan desde una sola interfaz.
- **Estado compartido**: El desktop sabe cuando hay un telefono conectado, que comandos envia y que sesiones estan activas.
- **Autostart simplificado**: Un solo proceso que iniciar en lugar de dos.

### Decision de diseno: dos modos de operacion

El bridge puede correr en **dos modos mutuamente excluyentes**:

| Modo | Descripcion | Caso de uso |
|---|---|---|
| **Standalone** | Daemon Node.js independiente, instalado como paquete npm | Usuario que solo tiene la app movil y quiere control remoto sin instalar el ADE desktop |
| **Embebido** | Proceso hijo gestionado por el ADE desktop (Tauri sidecar) | Usuario que tiene el ADE desktop y quiere conectar su telefono desde la misma aplicacion |

En ambos modos, los protocolos y contratos de comunicacion son identicos. La app movil no distingue si se conecta a un bridge standalone o a uno embebido: usa el mismo protocolo E2EE, los mismos metodos JSON-RPC y los mismos formatos de payload.

> **Referencia**: Para los detalles del protocolo E2EE, handshake, formato de envelopes y pairing, consultar [../../architecture/02a-system-architecture.md](../../architecture/02a-system-architecture.md) secciones 5.8 y 5.9.

---

## 2. Modo standalone (bridge como daemon independiente)

### 2.1 Instalacion y comandos

El bridge standalone se distribuye como paquete npm global:

```bash
npm install -g uxnan-bridge
```

Comandos disponibles:

```bash
uxnan-bridge start            # Inicia el daemon en background
uxnan-bridge stop             # Detiene el daemon
uxnan-bridge status           # Muestra estado actual (conectado, sesiones, agentes)
uxnan-bridge qr               # Muestra el QR de pairing en la terminal
uxnan-bridge install-service  # Configura autostart en la plataforma actual
```

### 2.2 Funcionamiento como daemon

El bridge standalone corre como proceso en background en la PC del desarrollador:

1. Al iniciar, lee la configuracion de `~/.uxnan/daemon-config.json`.
2. Genera o reutiliza la identidad Ed25519 del bridge (`~/.uxnan/secure-device-state.json`).
3. Conecta al relay server via WebSocket (`wss://relay.uxnan.io` por defecto).
4. Queda en espera de conexiones del movil.
5. Cuando el movil se conecta, completa el handshake E2EE y comienza a procesar metodos JSON-RPC.

### 2.3 Estado persistido

El bridge mantiene todo su estado en `~/.uxnan/`:

```
~/.uxnan/
├── daemon-config.json              # Configuracion general del daemon
├── pairing-session.json            # Payload de pairing activo
├── bridge-status.json              # Heartbeat y estado actual
├── secure-device-state.json        # Identidad Ed25519 del bridge
├── trusted-phones.json             # Telefonos de confianza registrados
├── managed-worktrees.json          # Worktrees administrados
├── push-state.json                 # Estado de push notifications
├── push-dedupe-keys.json           # Claves de deduplicacion
└── logs/
    └── bridge-YYYY-MM-DD.log
```

### 2.4 Autostart por plataforma

El comando `uxnan-bridge install-service` configura el arranque automatico del bridge segun la plataforma:

| Plataforma | Mecanismo | Ubicacion |
|---|---|---|
| **macOS** | LaunchAgent | `~/Library/LaunchAgents/com.uxnan.bridge.plist` |
| **Windows** | Windows Service / Task Scheduler | Configurado via PowerShell (`scripts/install-service-windows.ps1`) |
| **Linux** | systemd user unit | `~/.config/systemd/user/uxnan-bridge.service` |

### 2.5 Caso de uso tipico

El modo standalone esta disenado para usuarios que:

- Solo tienen la app movil Uxnan y quieren control remoto de agentes AI desde el telefono.
- No necesitan el ADE desktop completo (tres paneles, orquestacion visual, diffs interactivos).
- Prefieren una instalacion minima: un `npm install -g` y un comando `start`.
- Trabajan desde la terminal y no necesitan una GUI de escritorio.

> **Referencia**: La especificacion completa del bridge (estructura de archivos, handlers, adapters, estado) esta en [../../architecture/02a-system-architecture.md](../../architecture/02a-system-architecture.md) seccion 5.8.

---

## 3. Modo embebido (bridge integrado en desktop)

### 3.1 Arquitectura de integracion

El ADE desktop integra el bridge como un **proceso hijo gestionado** (sidecar) en lugar de requerir que el usuario instale el bridge por separado.

#### Tauri 2 sidecar

Tauri 2 permite bundlear y gestionar procesos externos junto con la aplicacion principal. El bridge Node.js se empaqueta como sidecar:

```
uxnandesktop/
├── src-tauri/
│   ├── src/
│   │   ├── bridge_manager.rs       # Gestion del ciclo de vida del bridge
│   │   ├── bridge_ipc.rs           # Comunicacion IPC con el bridge
│   │   └── ...
│   ├── binaries/                    # Sidecar: bridge Node.js bundleado
│   │   └── uxnan-bridge/
│   └── tauri.conf.json             # Configuracion del sidecar
└── src/
    └── lib/
        └── bridge/
            ├── bridge-store.svelte.ts   # Estado del bridge en el frontend
            ├── BridgeStatus.svelte      # Indicador de estado en UI
            └── PairingDialog.svelte     # Modal de QR de pairing
```

#### Alternativa futura: reimplementacion nativa en Rust

Como consideracion a futuro, la funcionalidad core del bridge podria reimplementarse directamente en Rust dentro del backend de Tauri. Esto eliminaria la dependencia de Node.js como sidecar. Sin embargo, para el MVP, el enfoque de sidecar permite reutilizar directamente el codigo del bridge standalone sin duplicar esfuerzo.

#### Principio fundamental

El bridge embebido usa los **mismos protocolos y contratos** que el standalone. No existe un "protocolo embebido" diferente. La app movil se conecta al bridge embebido exactamente igual que al standalone.

### 3.2 Lifecycle del bridge embebido

El ciclo de vida del bridge embebido esta completamente gestionado por el backend Rust del ADE:

```
┌────────────────────────────────────────────────────────────────────┐
│  1. Desktop inicia                                                 │
│     └─→ Lee settings: bridge_module_enabled = true?                │
│                                                                    │
│  2. Si habilitado: spawn bridge como Tauri sidecar                 │
│     └─→ bridge_manager.rs → Command::new("uxnan-bridge")          │
│         con stdin/stdout capturados para IPC                       │
│                                                                    │
│  3. Bridge inicializa                                              │
│     └─→ Lee config de ~/.uxnan/ (o recibe config del desktop)      │
│     └─→ Carga identidad Ed25519                                   │
│     └─→ Registra handlers JSON-RPC                                │
│                                                                    │
│  4. Bridge conecta al relay                                        │
│     └─→ WebSocket a wss://relay.uxnan.io                          │
│     └─→ Notifica al desktop: "relay_connected"                    │
│                                                                    │
│  5. Pairing desde GUI del desktop                                  │
│     └─→ Usuario abre Settings → Conexion Movil                   │
│     └─→ Click "Generar QR de Pairing"                             │
│     └─→ Desktop solicita QR payload al bridge via IPC             │
│     └─→ QR se muestra en un modal (PairingDialog.svelte)          │
│                                                                    │
│  6. Movil escanea QR → handshake E2EE a traves del relay          │
│     └─→ Bridge notifica al desktop: "phone_paired"                │
│     └─→ Desktop muestra "Telefono pareado exitosamente"           │
│                                                                    │
│  7. Operacion normal                                               │
│     └─→ Movil envia comandos JSON-RPC                             │
│     └─→ Bridge procesa y responde                                 │
│     └─→ Desktop tiene visibilidad del estado en tiempo real       │
│                                                                    │
│  8. Reconexiones automaticas                                       │
│     └─→ Conexiones posteriores son automaticas (trusted reconnect)│
│     └─→ No se necesita escanear QR de nuevo                       │
│                                                                    │
│  9. Shutdown del desktop                                           │
│     └─→ bridge_manager.rs envia SIGTERM al proceso bridge         │
│     └─→ Bridge cierra sesiones, limpia WebSocket                  │
│     └─→ Bridge termina gracefully                                 │
└────────────────────────────────────────────────────────────────────┘
```

#### Gestion del proceso en Rust

```rust
// src-tauri/src/bridge_manager.rs
// Responsable de spawn, monitoreo y shutdown del bridge sidecar

pub struct BridgeManager {
    process: Option<Child>,
    ipc: Option<BridgeIpc>,
    state: BridgeState,
}

pub enum BridgeState {
    Disabled,            // Bridge deshabilitado en settings
    Starting,            // Proceso spawned, esperando ready
    Connected,           // Bridge conectado al relay
    PhonePaired,         // Telefono pareado y activo
    Error(String),       // Error en el bridge
    ShuttingDown,        // En proceso de shutdown
}

impl BridgeManager {
    pub async fn start(&mut self, config: BridgeConfig) -> Result<()> { ... }
    pub async fn stop(&mut self) -> Result<()> { ... }
    pub async fn restart(&mut self) -> Result<()> { ... }
    pub fn state(&self) -> &BridgeState { ... }
    pub async fn generate_pairing_qr(&self) -> Result<PairingPayload> { ... }
    pub async fn disconnect_phone(&self, device_id: &str) -> Result<()> { ... }
    pub async fn get_connected_phones(&self) -> Result<Vec<ConnectedPhone>> { ... }
}
```

### 3.3 Ventajas del modo embebido

| Aspecto | Standalone | Embebido |
|---|---|---|
| **Instalacion** | `npm install -g` + `start` separado | Incluido en el instalador del ADE |
| **Configuracion** | Editar JSON en `~/.uxnan/` o flags CLI | GUI integrada en Settings del desktop |
| **Pairing QR** | Se muestra en la terminal (texto) | Modal visual con QR renderizado en la GUI |
| **Estado del movil** | Solo visible via `uxnan-bridge status` | Indicador en la barra de estado del ADE |
| **Autostart** | Requiere `install-service` por separado | Arranca con el ADE automaticamente |
| **Logs** | Archivos en `~/.uxnan/logs/` | Visibles en panel de logs del ADE + archivos |
| **Actualizaciones** | `npm update -g uxnan-bridge` | Incluido en las actualizaciones del ADE |

### 3.4 Comunicacion desktop ↔ bridge embebido

La comunicacion entre el backend Rust del ADE y el bridge Node.js embebido puede seguir dos estrategias:

#### Opcion A: IPC via stdin/stdout (JSON-RPC)

El bridge se spawn como proceso hijo con stdin/stdout capturados. La comunicacion usa JSON-RPC sobre estas tuberias:

```
┌──────────────┐   stdin (JSON-RPC request)   ┌──────────────┐
│              │ ──────────────────────────→   │              │
│  Rust        │                               │  Bridge      │
│  Backend     │   stdout (JSON-RPC response)  │  Node.js     │
│              │ ←──────────────────────────   │              │
│  (Tauri)     │   stderr (logs)               │  (sidecar)   │
│              │ ←──────────────────────────   │              │
└──────────────┘                               └──────────────┘
```

```rust
// src-tauri/src/bridge_ipc.rs
// Comunicacion JSON-RPC via stdin/stdout con el bridge

pub struct BridgeIpc {
    stdin: ChildStdin,
    stdout_reader: BufReader<ChildStdout>,
    pending_requests: HashMap<String, oneshot::Sender<JsonRpcResponse>>,
}

impl BridgeIpc {
    pub async fn send_request(&mut self, method: &str, params: Value) -> Result<Value> { ... }
    pub async fn subscribe_events(&mut self) -> mpsc::Receiver<BridgeEvent> { ... }
}
```

#### Opcion B: WebSocket local

El bridge ya expone un servidor WebSocket para conexiones LAN del movil. El backend Rust puede conectarse a ese mismo WebSocket como un cliente local:

```
┌──────────────┐   WebSocket (localhost:PORT)  ┌──────────────┐
│              │ ←─────────────────────────→   │              │
│  Rust        │                               │  Bridge      │
│  Backend     │                               │  Node.js     │
│  (Tauri)     │                               │  (sidecar)   │
└──────────────┘                               └──────────────┘
```

Esta opcion reutiliza la infraestructura existente del bridge sin necesidad de implementar IPC adicional.

#### Eventos del bridge al desktop

Independientemente de la opcion de transporte, el bridge emite eventos que el desktop consume:

```typescript
// Eventos que el bridge emite al desktop
type BridgeEvent =
  | { type: "relay_connected" }
  | { type: "relay_disconnected"; reason: string }
  | { type: "phone_connected"; deviceId: string; displayName: string }
  | { type: "phone_disconnected"; deviceId: string }
  | { type: "phone_paired"; deviceId: string; displayName: string }
  | { type: "command_received"; method: string; deviceId: string }
  | { type: "command_completed"; method: string; success: boolean }
  | { type: "bridge_error"; error: string }
  | { type: "bridge_ready" };
```

#### Comandos del desktop al bridge

```typescript
// Comandos que el desktop puede enviar al bridge
type DesktopToBridgeCommand =
  | { method: "bridge.generatePairingQr" }
  | { method: "bridge.getStatus" }
  | { method: "bridge.getConnectedPhones" }
  | { method: "bridge.disconnectPhone"; params: { deviceId: string } }
  | { method: "bridge.updateConfig"; params: Partial<BridgeConfig> }
  | { method: "bridge.getTrustedDevices" }
  | { method: "bridge.removeTrustedDevice"; params: { deviceId: string } }
  | { method: "bridge.getActiveSessions" }
  | { method: "bridge.forceDisconnectSession"; params: { sessionId: string } };
```

---

## 4. Contratos compartidos (shared/)

### 4.1 Ubicacion y proposito

Los contratos compartidos viven en `../../shared/` dentro del monorepo. Este directorio contiene las definiciones de tipos y schemas que todos los componentes del ecosistema Uxnan consumen para garantizar compatibilidad.

```
shared/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                        # Re-exporta todo
│   ├── jsonrpc/
│   │   ├── methods.ts                  # Todas las firmas de metodos JSON-RPC
│   │   ├── method-registry.ts          # Registro tipado de metodos y params
│   │   ├── errors.ts                   # Codigos de error JSON-RPC estandar
│   │   └── envelope.ts                 # Formato del envelope JSON-RPC
│   ├── e2ee/
│   │   ├── envelope.ts                 # Formato del envelope E2EE cifrado
│   │   ├── handshake.ts                # Tipos del protocolo de handshake
│   │   └── pairing-payload.ts          # Formato del payload del QR de pairing
│   ├── agents/
│   │   ├── agent-adapter.ts            # Interfaz IAgentAdapter
│   │   ├── agent-capabilities.ts       # AgentCapabilities
│   │   └── agent-config.ts             # AgentConfig por proyecto
│   ├── notifications/
│   │   └── push-payload.ts             # Formato de push notifications
│   ├── models/
│   │   ├── thread.ts                   # Thread, Turn, Message
│   │   ├── project.ts                  # Project
│   │   ├── git.ts                      # GitRepoStatus, GitDiff, etc.
│   │   ├── workspace.ts               # WorkspaceListing, FileContent
│   │   └── session.ts                  # SecureSession, TrustedDevice
│   └── validators/
│       ├── json-schema/                # Archivos .json con JSON Schema
│       │   ├── jsonrpc-request.schema.json
│       │   ├── jsonrpc-response.schema.json
│       │   ├── e2ee-envelope.schema.json
│       │   ├── pairing-payload.schema.json
│       │   └── push-payload.schema.json
│       └── validate.ts                 # Funciones de validacion en runtime
└── dist/                               # Compilado, consumido por bridge y relay
```

### 4.2 Consumo por componente

| Componente | Como consume `shared/` |
|---|---|
| **Bridge** (Node.js) | Importa directamente como dependencia npm local. Usa tipos TypeScript y validadores JSON Schema en runtime. |
| **Relay** (Node.js) | Importa directamente como dependencia npm local. Valida envelopes E2EE y payloads de push. |
| **Mobile** (Flutter/Dart) | No importa directamente. Las definiciones Dart en `lib/domain/entities/` son el equivalente manual en Dart de los tipos de `shared/`. Se mantienen sincronizadas manualmente. |
| **Desktop** (Rust/Tauri) | No importa directamente los tipos TypeScript. El backend Rust define sus propios structs equivalentes (con Serde) para deserializar los mensajes del bridge. El frontend Svelte puede importar los tipos TypeScript para type-safety. |

### 4.3 Validacion en runtime

El directorio `shared/src/validators/` exporta funciones de validacion que el bridge y el relay usan para verificar la integridad de los mensajes:

```typescript
// shared/src/validators/validate.ts
import Ajv from "ajv";

const ajv = new Ajv();

export function validateJsonRpcRequest(data: unknown): ValidationResult { ... }
export function validateJsonRpcResponse(data: unknown): ValidationResult { ... }
export function validateE2EEnvelope(data: unknown): ValidationResult { ... }
export function validatePairingPayload(data: unknown): ValidationResult { ... }
export function validatePushPayload(data: unknown): ValidationResult { ... }
```

Cada funcion retorna `{ valid: true, data: T }` o `{ valid: false, errors: ValidationError[] }`. Los schemas JSON se compilan una sola vez al importar el modulo.

### 4.4 Firmas JSON-RPC

El archivo `shared/src/jsonrpc/methods.ts` define todas las firmas de metodos que la app movil puede invocar y que el bridge (standalone o embebido) debe implementar:

```typescript
// shared/src/jsonrpc/methods.ts
// Registro de todos los metodos JSON-RPC del ecosistema Uxnan

export interface JsonRpcMethodRegistry {
  // Threads
  "thread/list":       { params: ListThreadsParams;    result: ThreadList };
  "thread/read":       { params: { threadId: string };  result: Thread };
  "thread/start":      { params: StartThreadParams;     result: Thread };
  "thread/resume":     { params: { threadId: string };  result: void };
  "thread/fork":       { params: ForkParams;            result: Thread };
  "turn/list":         { params: TurnListParams;        result: TurnList };
  "turn/send":         { params: TurnSendParams;        result: TurnResult };

  // Git
  "git/status":        { params: { cwd: string };       result: GitRepoStatus };
  "git/diff":          { params: { cwd: string };       result: GitDiff };
  "git/commit":        { params: GitCommitParams;       result: GitCommitResult };
  "git/push":          { params: GitPushParams;         result: GitPushResult };
  "git/pull":          { params: GitPullParams;         result: GitPullResult };
  "git/checkout":      { params: GitCheckoutParams;     result: void };
  "git/createBranch":  { params: GitBranchParams;       result: GitBranchResult };
  "git/createWorktree":{ params: GitWorktreeParams;     result: GitWorktreeResult };

  // Workspace
  "workspace/readFile":    { params: { path: string };      result: FileContent };
  "workspace/readImage":   { params: { path: string };      result: ImageContent };
  "workspace/list":        { params: { cwd: string };       result: WorkspaceListing };
  "workspace/checkpoint":  { params: CheckpointParams;      result: Checkpoint };
  "workspace/diffCheckpoint":  { params: { id: string };    result: CheckpointDiff };
  "workspace/applyCheckpoint": { params: { id: string };    result: void };
  "workspace/applyPatch":      { params: PatchParams;       result: ApplyResult };

  // Projects
  "project/list":      { params: void;                  result: Project[] };
  "project/resolve":   { params: { cwd: string };       result: Project };

  // Auth
  "auth/status":       { params: void;                  result: AuthStatus };
  "auth/login":        { params: { provider: string };  result: LoginSession };
  "auth/logout":       { params: void;                  result: void };

  // Bridge control (desktop → bridge)
  "bridge/status":          { params: void;             result: BridgeStatus };
  "bridge/generatePairingQr": { params: void;           result: PairingPayload };
  "bridge/connectedPhones": { params: void;             result: ConnectedPhone[] };
  "bridge/disconnectPhone": { params: { deviceId: string }; result: void };
  "bridge/trustedDevices":  { params: void;             result: TrustedDevice[] };
  "bridge/removeTrustedDevice": { params: { deviceId: string }; result: void };
}
```

---

## 5. Conexion movil desde el desktop

### 5.1 Topologias de conexion

El movil puede conectarse al bridge (standalone o embebido) a traves de tres topologias:

```
Topologia 1 — LAN directa (bridge embebido en desktop)
┌──────────┐   WebSocket LAN   ┌──────────────────────┐
│  Movil   │ ────────────────→ │  Desktop (bridge      │
│          │   E2EE directo    │  embebido)            │
└──────────┘                   └──────────────────────┘
No requiere relay. El movil y el desktop estan en la misma red local.

Topologia 2 — WAN via relay (bridge embebido en desktop)
┌──────────┐   WS E2EE   ┌─────────┐   WS E2EE   ┌──────────────────────┐
│  Movil   │ ──────────→ │  Relay  │ ──────────→ │  Desktop (bridge      │
│          │              │         │              │  embebido)            │
└──────────┘              └─────────┘              └──────────────────────┘
El movil esta fuera de la red local. El relay retransmite envelopes cifrados opacos.

Topologia 3 — WAN via relay + bridge standalone (sin desktop)
┌──────────┐   WS E2EE   ┌─────────┐   WS E2EE   ┌──────────────────────┐
│  Movil   │ ──────────→ │  Relay  │ ──────────→ │  Bridge standalone    │
│          │              │         │              │  (daemon Node.js)     │
└──────────┘              └─────────┘              └──────────────────────┘
No hay desktop ADE. El bridge corre como daemon independiente en la PC.
```

En las tres topologias, la conexion siempre es E2EE. El relay solo ve envelopes cifrados y no puede descifrar el contenido.

### 5.2 Estado de conexion movil en la UI del desktop

Cuando el bridge esta embebido, el ADE desktop puede mostrar informacion en tiempo real sobre la conexion movil:

#### Indicador en la barra de estado

```
┌─────────────────────────────────────────────────────────────────┐
│  [Proyectos ▾]  [Terminales]  [Diffs]         📱 Conectado    │
└─────────────────────────────────────────────────────────────────┘
```

El indicador de telefono en la barra de estado muestra:

| Estado | Indicador | Descripcion |
|---|---|---|
| Bridge deshabilitado | Sin indicador | El modulo bridge esta desactivado en settings |
| Bridge activo, sin telefono | `Esperando conexion` | Bridge conectado al relay, esperando movil |
| Telefono conectado | `Conectado: iPhone de Jorge` | Sesion E2EE activa con el movil |
| Telefono desconectado | `Desconectado` | Sesion E2EE cerrada, esperando reconexion |

#### Panel de detalle (opcional)

Al hacer click en el indicador, se abre un panel con informacion detallada:

- Nombre del dispositivo movil conectado.
- Tiempo de conexion activa.
- Ultimo comando recibido del movil (si el usuario quiere visibilidad).
- Boton para desconectar la sesion del movil.
- Boton para acceder a la configuracion del bridge.

### 5.3 Flujo de pairing desde el desktop

El proceso de pairing cuando el bridge esta embebido en el desktop:

```
┌──────────────────────────────────────────────────────────────────┐
│  Paso 1: El usuario abre Settings → Conexion Movil              │
│                                                                  │
│  Paso 2: Click en "Generar QR de Pairing"                       │
│                                                                  │
│  Paso 3: Desktop envia al bridge embebido:                      │
│          { method: "bridge.generatePairingQr" }                  │
│                                                                  │
│  Paso 4: Bridge genera PairingPayload:                          │
│          { version: 2, relayUrl, sessionId,                     │
│            macDeviceId, macIdentityPublicKey,                    │
│            displayName, expiresAt }                              │
│                                                                  │
│  Paso 5: Desktop renderiza el QR en un modal (PairingDialog)    │
│          ┌─────────────────────────┐                             │
│          │     Pairing QR Code     │                             │
│          │    ┌─────────────┐      │                             │
│          │    │ █▀▀▀▀▀▀▀█  │      │                             │
│          │    │ █ QR    █  │      │                             │
│          │    │ █ CODE  █  │      │                             │
│          │    │ █▄▄▄▄▄▄▄█  │      │                             │
│          │    └─────────────┘      │                             │
│          │  Escanea con Uxnan      │                             │
│          │  Expira en 5:00         │                             │
│          │  [Cancelar] [Regenerar] │                             │
│          └─────────────────────────┘                             │
│                                                                  │
│  Paso 6: El usuario escanea el QR con la app movil Uxnan        │
│                                                                  │
│  Paso 7: Handshake E2EE a traves del relay                      │
│          Movil → Relay → Bridge embebido                         │
│                                                                  │
│  Paso 8: Bridge notifica al desktop: "phone_paired"             │
│          Desktop muestra: "Telefono pareado exitosamente"        │
│          El modal se cierra automaticamente                      │
│                                                                  │
│  Paso 9: Conexiones posteriores son automaticas                 │
│          (trusted reconnect, sin necesidad de QR)                │
└──────────────────────────────────────────────────────────────────┘
```

El QR de pairing contiene la misma informacion que en el modo standalone (ver `PairingPayload` en `../../shared/`). La unica diferencia es que en modo embebido el QR se renderiza en una ventana grafica, no en texto ASCII en la terminal.

---

## 6. Configuracion del bridge en desktop

### 6.1 Settings expuestos en la UI

El ADE desktop expone la configuracion del bridge embebido en la seccion Settings → Conexion Movil:

```typescript
// Configuracion del bridge gestionada desde el desktop
interface BridgeDesktopConfig {
  // General
  enabled: boolean;                    // Habilitar/deshabilitar el modulo bridge
  relayUrl: string;                    // URL del relay (default: "wss://relay.uxnan.io")
  customRelayUrl: string | null;       // URL personalizada para relay self-hosted

  // Red local
  lanEnabled: boolean;                 // Habilitar conexiones LAN directas
  lanPort: number;                     // Puerto para WebSocket LAN (default: 19850)

  // Notificaciones push
  pushEnabled: boolean;                // Enviar push al movil cuando un agente termina
  pushOnAgentDone: boolean;            // Push al completar un turn
  pushOnAgentError: boolean;           // Push al detectar error en un agente

  // Dispositivos de confianza
  trustedPhones: TrustedPhone[];       // Lista de telefonos pareados
  autoReconnect: boolean;              // Reconectar automaticamente al iniciar

  // Sesiones
  maxConcurrentSessions: number;       // Maximo de sesiones simultaneas (default: 1)
  sessionTimeoutMinutes: number;       // Timeout de inactividad (default: 30)
}

interface TrustedPhone {
  deviceId: string;
  displayName: string;
  publicKey: string;                   // Clave publica Ed25519 del telefono
  pairedAt: string;                    // ISO 8601
  lastSeen: string | null;            // ISO 8601
}
```

### 6.2 Organizacion en la UI de settings

```
Settings
├── General
│   ├── Tema (claro/oscuro)
│   ├── Idioma
│   └── ...
├── Terminales
│   └── ...
├── Git y Worktrees
│   └── ...
├── Agentes
│   └── ...
└── Conexion Movil                    ← Seccion del bridge
    ├── Habilitar conexion movil       [Toggle ON/OFF]
    ├── Servidor relay
    │   ├── Usar relay oficial         (wss://relay.uxnan.io)
    │   └── Relay personalizado        [input URL]
    ├── Conexion LAN
    │   ├── Habilitar LAN directa      [Toggle]
    │   └── Puerto                     [19850]
    ├── Notificaciones push
    │   ├── Enviar push al telefono    [Toggle]
    │   ├── Al completar tarea         [Toggle]
    │   └── Al detectar error          [Toggle]
    ├── Telefonos de confianza
    │   ├── iPhone de Jorge            [Pareado: 2026-06-05] [Eliminar]
    │   └── [Agregar telefono]         → abre PairingDialog
    └── Sesiones activas
        ├── iPhone de Jorge            [Conectado hace 15m] [Desconectar]
        └── Sin sesiones activas
```

### 6.3 Persistencia de configuracion

La configuracion del bridge se persiste en dos ubicaciones:

- **Configuracion del desktop**: En el store de Tauri (via Serde JSON), junto con el resto de la configuracion del ADE.
- **Estado del bridge**: En `~/.uxnan/` (identidad, trusted phones, sesiones). Este directorio es compartido entre el modo standalone y el embebido.

Esta separacion permite que si el usuario desinstala el desktop y vuelve al modo standalone, su identidad y dispositivos de confianza persisten en `~/.uxnan/`.

---

## 7. Migracion entre modos

### 7.1 De standalone a embebido

Escenario: El usuario tiene el bridge standalone instalado con telefonos pareados, y decide instalar el ADE desktop.

```
┌──────────────────────────────────────────────────────────────────┐
│  1. Usuario instala el ADE desktop                               │
│                                                                  │
│  2. Al primer inicio, el desktop detecta ~/.uxnan/               │
│     └─→ Existe daemon-config.json                               │
│     └─→ Existen trusted-phones.json                             │
│     └─→ Existe secure-device-state.json (identidad Ed25519)     │
│                                                                  │
│  3. Desktop muestra dialogo de migracion:                       │
│     "Se detecto una instalacion existente del bridge Uxnan.      │
│      ¿Desea importar la configuracion y los dispositivos         │
│      de confianza?"                                              │
│     [Importar] [Comenzar de cero]                                │
│                                                                  │
│  4. Si "Importar":                                               │
│     └─→ Lee daemon-config.json → aplica relay URL, preferencias │
│     └─→ Lee trusted-phones.json → importa telefonos pareados    │
│     └─→ Reutiliza secure-device-state.json → misma identidad    │
│     └─→ El telefono se reconecta automaticamente al bridge      │
│         embebido sin necesidad de re-pairing                     │
│                                                                  │
│  5. Desktop sugiere desinstalar el bridge standalone:            │
│     "El ADE desktop incluye la funcionalidad del bridge.         │
│      Puede desinstalar el bridge standalone con:                 │
│      npm uninstall -g uxnan-bridge"                              │
│                                                                  │
│  6. El usuario detiene el standalone y habilita el embebido:    │
│     uxnan-bridge stop                                            │
│     npm uninstall -g uxnan-bridge                                │
│     → El desktop ya tiene el bridge corriendo internamente       │
└──────────────────────────────────────────────────────────────────┘
```

Lo fundamental es que la identidad Ed25519 del bridge se reutiliza. Dado que el telefono confia en la clave publica del bridge (almacenada durante el pairing original), cambiar la identidad requeriria re-pairing. Al conservar la misma identidad, la transicion es transparente.

### 7.2 De embebido a standalone

Escenario: El usuario desinstala el ADE desktop pero quiere seguir usando la conexion movil.

```
┌──────────────────────────────────────────────────────────────────┐
│  1. Usuario decide desinstalar el ADE desktop                    │
│                                                                  │
│  2. Los datos en ~/.uxnan/ persisten (no se borran con el ADE)  │
│     └─→ secure-device-state.json (identidad Ed25519)            │
│     └─→ trusted-phones.json (telefonos pareados)                │
│     └─→ daemon-config.json (configuracion)                      │
│                                                                  │
│  3. El usuario instala el bridge standalone:                     │
│     npm install -g uxnan-bridge                                  │
│                                                                  │
│  4. Al iniciar, el bridge standalone detecta ~/.uxnan/ existente │
│     └─→ Carga la identidad Ed25519 existente                    │
│     └─→ Carga los telefonos de confianza                        │
│     └─→ Conecta al relay con la misma identidad                 │
│                                                                  │
│  5. El telefono se reconecta automaticamente                     │
│     └─→ Trusted reconnect, sin necesidad de re-pairing          │
└──────────────────────────────────────────────────────────────────┘
```

### 7.3 Prevencion de conflictos

Si ambos modos intentan correr simultaneamente (bridge standalone + desktop con bridge embebido), habra un conflicto porque ambos intentan conectarse al relay con la misma identidad y escuchar en el mismo puerto LAN.

Protecciones implementadas:

1. **Lock file**: Al iniciar, el bridge (en cualquier modo) crea `~/.uxnan/bridge.lock` con su PID. Si ya existe un lock valido, no arranca.
2. **Deteccion al inicio del desktop**: Antes de spawn el bridge embebido, el desktop verifica si ya hay un bridge standalone corriendo (via lock file o probe del puerto).
3. **Dialogo de resolucion**: Si se detecta un bridge standalone activo, el desktop ofrece:
   - "Detener el bridge standalone y usar el embebido"
   - "Mantener el standalone y deshabilitar el embebido"

---

## 8. Consideraciones de seguridad

### 8.1 Garantias E2EE en ambos modos

El bridge embebido hereda las mismas garantias de encriptacion end-to-end que el standalone:

- **El relay nunca ve texto claro**: Todos los mensajes entre el movil y el bridge viajan como envelopes cifrados con AES-256-GCM, usando una clave derivada del handshake X25519 + HKDF.
- **Perfect forward secrecy**: Cada sesion genera claves efimeras X25519. Comprometer una sesion no compromete sesiones pasadas.
- **Sequence numbers**: Cada mensaje lleva un numero de secuencia monotonico para prevenir replay attacks.
- **Key rotation**: Renegociacion de claves cuando el epoch cambia.

### 8.2 Aislamiento de secretos

```
┌─────────────────────────────────────────────────────────────────┐
│                    Desktop ADE (Tauri)                           │
│  ┌───────────────────────┐   ┌────────────────────────────────┐ │
│  │  Rust Backend          │   │  Bridge Node.js (sidecar)      │ │
│  │                        │   │                                │ │
│  │  - Acceso al estado    │   │  - Claves Ed25519 (identidad) │ │
│  │    del bridge via IPC  │   │  - Claves X25519 (sesion)     │ │
│  │  - NO tiene acceso a   │   │  - Clave derivada AES-256     │ │
│  │    claves E2EE         │   │  - Handshake E2EE completo    │ │
│  │  - Gestiona UI y       │   │  - Cifrado/descifrado de      │ │
│  │    configuracion       │   │    mensajes                    │ │
│  └───────────────────────┘   └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

El backend Rust del desktop tiene acceso al **estado operativo** del bridge (que dispositivo esta conectado, que metodos se invocan, etc.) pero **no tiene acceso a las claves criptograficas** del E2EE. Estas claves existen exclusivamente en el proceso Node.js del bridge.

### 8.3 Almacenamiento seguro de secretos

| Secreto | Almacenamiento | Acceso |
|---|---|---|
| Identidad Ed25519 del bridge | `~/.uxnan/secure-device-state.json` (cifrado via OS keychain) | Solo el proceso bridge |
| Claves de sesion X25519 | Memoria del proceso bridge (nunca persisten) | Solo el proceso bridge |
| Tokens de API de agentes | `tauri-plugin-stronghold` o OS keychain | Solo el backend Rust |
| Configuracion del relay | `~/.uxnan/daemon-config.json` | Bridge + desktop |
| Claves publicas de telefonos de confianza | `~/.uxnan/trusted-phones.json` | Bridge + desktop |

### 8.4 Sanitizacion de payloads

El bridge (en ambos modos) aplica las mismas reglas de sanitizacion antes de enviar cualquier dato al movil:

- **Nunca expone tokens o API keys**: El endpoint `auth/status` retorna estado sanitizado (ver seccion 5.8.9 de [../../architecture/02a-system-architecture.md](../../architecture/02a-system-architecture.md)).
- **Nunca expone rutas absolutas del sistema**: Los paths se relativizan al cwd del proyecto.
- **Nunca expone variables de entorno**: Las env vars con tokens (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) se filtran.
- **Nunca expone contenido de archivos sensibles**: `.env`, credenciales, claves SSH se excluyen del workspace listing.

### 8.5 Permisos del sidecar

El proceso bridge sidecar corre con los mismos permisos del usuario que ejecuta el ADE desktop. No requiere permisos elevados (no root, no admin). Las operaciones que ejecuta (Git, lectura de archivos, procesos de agentes) son las mismas que el usuario podria ejecutar manualmente desde una terminal.

---

> **Nota**: Este documento especifica como el bridge se integra con el ADE desktop. Para la especificacion completa del bridge (handlers, adapters, estado, protocolo de instalacion), consultar [../../architecture/02a-system-architecture.md](../../architecture/02a-system-architecture.md) seccion 5.8. Para el protocolo E2EE y transporte seguro, consultar la seccion 5.9 del mismo documento. Para los contratos JSON-RPC completos, consultar [../../architecture/02b-contracts-and-requirements.md](../../architecture/02b-contracts-and-requirements.md).
