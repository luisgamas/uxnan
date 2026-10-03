# Integracion del Bridge y Conexion Movil

> **Version:** 1.5.0
> **Fecha:** 2026-10-02
> **Estado:** Canal local (cliente) implementado; empaquetado embebido pendiente

> **Resumen ejecutivo (1.5.0):** el desktop ya muestra el relay propio como
> cliente del bridge: Ajustes → Bridge y movil → *Acceso remoto* (§5.4). Una
> sola replica (`$lib/bridge/relay.svelte.ts`) alimentada por `relay/status` en
> cada (re)conexion y por `stream/relay/updated`; cada cambio es una llamada
> `relay/*`. El token de Cloudflare solo viaja como parametro y el campo se
> vacia al responder el bridge. Pendiente: revision visual y una ejecucion real
> contra Cloudflare (`uxnandesktop/FOR-DEV.md` → *Remote access*).

> **Resumen ejecutivo (1.4.0):** no existe relay hospedado por Uxnan ni URL
> por defecto (`wss://relay.uxnan.io` y `customRelayUrl` desaparecen). El relay
> es el **propio del usuario**: un Worker que el bridge despliega en la cuenta
> de Cloudflare del usuario y gestiona por `relay/*` + `stream/relay/updated`
> (`02a` §5.10); su endpoint es el ajuste compartido `BridgeSettings.relay`. El
> desktop lo muestra como cliente de esos metodos en *Acceso remoto* (§5.4,
> construido en 1.5.0); el CLI `uxnan-bridge relay …` hace lo mismo. Las
> topologias (§5.1) son LAN, Tailscale y relay propio; el QR pasa a v3. Los
> conteos de §4.4 suben a 101 metodos y 25 notificaciones.

> **Resumen ejecutivo (1.3.1):** el push en background lo envia solo el bridge,
> directo a FCM; el relay no tiene push ni estado en disco. Se
> retiraron de `shared/` los contratos de push del relay (`validatePushPayload`
> y su schema); queda solo `PushPlatform`.

> **Resumen ejecutivo (1.3.0):** el bridge se actualiza a si mismo (`02a`
> §5.8.18) y el desktop se lo pide: `bridge/update` desde una fila de la barra
> lateral (visible solo mientras hay una version nueva), desde Ajustes → Bridge
> y movil, y en la actualizacion automatica. El desktop refleja `update` de
> `bridge/status` y de `stream/bridge/updated` en un solo lugar
> (`BridgeInstallStore`). Su instalador npm (`bridgeclient/install.rs`) queda
> solo para instalar el bridge y para actualizar uno anterior a esta funcion
> (sin `update`) o que no corre como servicio.

> **Resumen ejecutivo (1.2.1):** cada perfil del desktop se conecta con su
> propio nombre de cliente, `desktop-<perfil>` (`02a` §5.8.15): la app instalada
> y un build de desarrollo comparten el bridge sin desplazarse ni quitarse las
> herramientas de sus agentes.

> **Resumen ejecutivo (1.2.0):** una sola capa (`02a` §5.8.17). El bridge corre
> como **servicio del usuario**: el modo `managed` lo instala y lo arranca con
> su propia CLI (`service-status` / `install-service` / `service-start`) y solo
> se conecta — el bridge sigue sirviendo al telefono con la app cerrada. La
> ventana es una **replica** (`sync/changes` por revision) de hilos, proyectos,
> ajustes compartidos y presencia; los proyectos del desktop y del telefono son
> **un solo registro** en espejo en ambos sentidos; los turnos se ordenan por
> `Turn.seq`; el emparejamiento de un telefono se hace desde Ajustes con el QR
> del propio bridge en ejecucion; y la deteccion de agentes usa la tabla
> compartida con el bridge (`shared/agent-locations.json`).

> **Resumen ejecutivo (1.1.0):** el desktop ya es **cliente** del bridge sin
> empaquetarlo (§3.5): se conecta a un bridge instalado por el usuario por
> un **canal de control local** — WebSocket solo en `127.0.0.1`, token de un
> fichero `0600` — que sirve el mismo router JSON-RPC que los telefonos y lo
> registra como un receptor mas de `stream/*` (§3.5, `02a` §5.8.15). Sobre el,
> las **pestañas de chat** muestran y conducen las conversaciones del bridge
> junto a las terminales, las mismas que ve el telefono (`02a` §5.8.16, "un dueño,
> dos vistas"). Modos `off` (por defecto, coste cero) / `attach` / `managed`
> (lanza `uxnan-bridge` si no corre). El modo embebido como sidecar (§3.1–3.4)
> sigue pendiente y ya no bloquea nada: añadira un modo mas al mismo cliente.
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
- **Agent adapters**: Interactua con los CLI de agentes AI soportados a traves de adaptadores que implementan `IAgentAdapter`.
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
uxnan-bridge relay setup --account <id> [--remember]  # Despliega el relay propio en la cuenta de Cloudflare del usuario
uxnan-bridge relay status     # Tambien: use <wss-url> · enable · disable · update · rotate · remove [--delete-worker]
```

### 2.2 Funcionamiento como daemon

El bridge standalone corre como proceso en background en la PC del desarrollador:

1. Al iniciar, lee la configuracion de `~/.uxnan/daemon-config.json`.
2. Genera o reutiliza la identidad Ed25519 del bridge (`~/.uxnan/secure-device-state.json`).
3. Levanta su servidor LAN (`hosts` directos: LAN y Tailscale) y, si el usuario
   configuro su relay propio y esta habilitado, abre el socket de control hacia
   el (un Worker en la cuenta de Cloudflare del usuario, `02a` §5.10). No hay
   relay por defecto.
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
├── relay.json                      # Como se configuro el relay propio (provider, accountId, version)
├── trusted-phones.json             # Telefonos de confianza registrados
├── managed-worktrees.json          # Worktrees administrados
├── push-state.json                 # Registros de push (token FCM por telefono; solo se envia a FCM)
└── logs/
    └── bridge-YYYY-MM-DD.log
```

### 2.4 Autostart por plataforma

El comando `uxnan-bridge install-service` configura el arranque automatico del bridge segun la plataforma:

| Plataforma | Mecanismo | Ubicacion |
|---|---|---|
| **macOS** | LaunchAgent | `~/Library/LaunchAgents/dev.luisgamas.bridge.plist` |
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
│  4. Bridge conecta a SU relay, si el usuario configuro uno         │
│     └─→ wss://uxnan-relay.<subdominio>.workers.dev (cuenta propia)│
│     └─→ Notifica: stream/relay/updated                            │
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

### 3.5 Cliente del canal de control local (implementado)

La opcion B de §3.4, con dos diferencias deliberadas: el desktop **no** usa el
WebSocket LAN del telefono (exige el handshake E2EE), sino un listener propio
del bridge **solo en loopback**; y no hace falta empaquetar el bridge — basta
con que el usuario lo tenga instalado.

```
Settings → Bridge y movil (off | attach | managed)
   │
   ▼
src-tauri/src/bridgeclient/            ~/.uxnan/local-control.json (0600)
  discovery.rs  ── lee ─────────────►  { port, token, pid, bridgeVersion, instanceId }
  lock.rs       ── lee ─────────────►  ~/.uxnan/bridge.lock { pid, startedAt }
  connection.rs ── ws://127.0.0.1:<port>/control?client=desktop-<perfil>&resume=<seq>&instance=<id>
                   Authorization: Bearer <token>
  mod.rs        ── supervisor: reconexion con backoff; managed: asegura el servicio
  service.rs    ── `uxnan-bridge service-status | install-service | service-start | stop`
  commands.rs   ── bridge_client_status · bridge_client_retry · bridge_call
                   bridge_install_probe · bridge_install · bridge_restart · bridge_pairing_qr
   │ eventos: bridge:status · bridge:notification
   ▼
src/lib/bridge/  client · chat (replica) · projectMirror · conversation  →  components/chat/
```

- **El token no sale de Rust.** La ventana solo recibe estado, resultados y
  notificaciones; la CSP del webview tampoco permitiria `ws://`.
- **Un nombre por perfil** (`bridgeclient::client_id_for`): `desktop-` + 12 hex
  del SHA-256 del directorio del perfil. El canal mantiene una conexion viva
  por nombre, asi que la app instalada y un build de desarrollo nunca comparten
  uno — si no, se desplazan en bucle (`02a` §5.8.15).
- **Reanudacion:** el cliente guarda el ultimo `seq` aplicado y el `instanceId`;
  el bridge reenvia lo que falto o responde `gap` y la ventana re-sincroniza.
- **`managed`** resuelve `uxnan-bridge` en el `PATH` (como cualquier CLI de
  agente) y, si no hay descubrimiento, se asegura de que corra como **servicio
  del usuario**: `service-status`, `install-service` si falta (o tras una
  actualizacion, para apuntar al node y la entrada nuevos) y `service-start` si
  no corre. La app **nunca** lo detiene: el servicio sigue sirviendo al
  telefono con el desktop cerrado. El lock de instancia unica del bridge sigue
  siendo la autoridad: el desktop nunca comprueba-y-escribe estado del bridge.
- **Replica y espejo (`02a` §5.8.17).** La ventana converge con `sync/changes`
  al (re)conectar y ante un salto de `rev`; los proyectos locales del desktop y
  el registro del bridge se unen al conectar (nunca se poda por ausencia) y las
  altas y bajas viajan como eventos en ambos sentidos
  (`src/lib/bridge/projectMirror.svelte.ts`); una baja hecha sin conexion se
  envia al reconectar. **Emparejar un telefono** (Ajustes → Bridge y movil):
  `bridge_pairing_qr` pide `bridge/generatePairingQr` al bridge en ejecucion
  (su payload, ventana de emparejamiento armada) y lo dibuja como SVG
  (crate `qrcode`).
- **Sin descubrimiento no siempre es "no hay bridge".** El desktop **lee** (nunca
  escribe) `~/.uxnan/bridge.lock`: si un proceso vivo lo tiene y no publica el
  canal, el estado es `outdated` (el binario instalado no responde a
  `uxnan-bridge version`: es anterior al canal) o `channelOff` (lo conoce, pero
  corre un proceso anterior a la actualizacion o con `localControlEnabled:
  false`). `managed` no arranca un segundo bridge sobre un lock ocupado.
  `bridge_restart` (a peticion del usuario) detiene el que corre con
  `uxnan-bridge stop` y vuelve a levantar el servicio.
- **Actualizar el bridge (`02a` §5.8.18).** Lo hace el propio bridge:
  *Actualizar* llama `bridge/update`, el bridge se detiene, instala la version
  publicada y su servicio lo levanta; la ventana ve caer la conexion y volver con
  la version nueva, y lo dice (o dice el fallo que reporta el bridge que vuelve).
  Nunca con un turno en curso en cualquier cliente. El instalador del desktop
  (`npm install -g uxnan-bridge@latest` + reinstalar y reiniciar el servicio en
  `managed`) solo se usa cuando no hay bridge o cuando el bridge no puede
  hacerlo: uno anterior a esta funcion (`bridge/status` sin `update`) o que no
  corre como servicio del usuario.
- **Herramientas del desktop para los agentes del bridge.** Al conectar, el
  cliente llama `desktop/attach { mcpUrl, token }` (`02a` §5.8.15) con el
  endpoint `/mcp` de su servidor de control y un **token de agente del bridge**
  propio, generado en cada arranque, mientras el ajuste `browser.mcpEnabled`
  este activo (`desktop/detach` al apagarlo). En el servidor de control ese
  token es `Caller::Bridge { cwd }`: su alcance es el proyecto de la carpeta de
  la conversacion (cabecera `x-uxnan-cwd`, codificada en porcentaje y
  decodificada por el servidor), `current` no nombra nada y nunca
  reporta un hook (`docs/control-api.md` → *Callers*).
- **`off` cuesta cero**: el supervisor espera el cambio de modo sin socket,
  lectura de fichero, temporizador ni proceso.

**Pestaña `chat`.** Un tipo de pestaña nuevo junto a `terminal`/`file`/`commit`:
guarda solo el puntero (`cwd`, `threadId`, `agentId` preseleccionado); la
conversacion vive en el bridge. El agente se fija al crear el hilo; el modelo
se cambia con `thread/setModel`. Se ofrece desde el "+" de la barra de pestañas,
el submenu *Launch agent* de la fila de worktree y el dialogo lanzador, solo para
carpetas locales. El modelo de datos es el de `shared/` importado solo como
tipos (alias `$shared`). Uso: `docs/chat.md`.

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
│   │   └── push-payload.ts             # PushPlatform (`notifications/register`)
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
│       │   └── pairing-payload.schema.json
│       └── validate.ts                 # Funciones de validacion en runtime
└── dist/                               # Compilado, consumido por bridge y relay
```

### 4.2 Consumo por componente

| Componente | Como consume `shared/` |
|---|---|
| **Bridge** (Node.js) | Importa directamente como dependencia npm local. Usa tipos TypeScript y validadores JSON Schema en runtime. |
| **Relay** (Node.js) | Dependencia npm local. Reenvia los envelopes E2EE opacos sin abrirlos ni validarlos, y no tiene push (el bridge lo envia directo a FCM), asi que hoy no usa ningun validador de `shared/`. |
| **Mobile** (Flutter/Dart) | No importa directamente. Las definiciones Dart en `lib/domain/entities/` son el equivalente manual en Dart de los tipos de `shared/`. Se mantienen sincronizadas manualmente. |
| **Desktop** (Rust/Tauri) | No importa directamente los tipos TypeScript. El backend Rust define sus propios structs equivalentes (con Serde) para deserializar los mensajes del bridge. El frontend Svelte puede importar los tipos TypeScript para type-safety. |

### 4.3 Validacion en runtime

El directorio `shared/src/validators/` exporta funciones de validacion que el bridge usa para verificar la integridad de los mensajes:

```typescript
// shared/src/validators/validate.ts
import Ajv from "ajv";

const ajv = new Ajv();

export function validateJsonRpcRequest(data: unknown): ValidationResult { ... }
export function validateJsonRpcResponse(data: unknown): ValidationResult { ... }
export function validateE2EEnvelope(data: unknown): ValidationResult { ... }
export function validatePairingPayloadSchema(data: unknown): ValidationResult { ... }
```

Cada funcion retorna `{ valid: true, data: T }` o `{ valid: false, errors: ValidationError[] }`. Los schemas JSON se compilan una sola vez al importar el modulo.

### 4.4 Firmas JSON-RPC

`shared/src/jsonrpc/methods.ts` define todas las firmas que la app movil puede
invocar y que el bridge (standalone o embebido) debe implementar.

> **Fuente de verdad:** `shared/src/jsonrpc/methods.ts`
> (`JsonRpcMethodRegistry`) y `method-registry.ts` (`METHOD_NAMES`, **101
> entradas**, bloqueadas entre si en build). El bloque de abajo es una copia de
> lectura: si discrepa del paquete compartido, manda el paquete. La semantica de
> cada metodo vive en
> [`../../architecture/02b-contracts-and-requirements.md`](../../architecture/02b-contracts-and-requirements.md)
> §1.2, y las 25 notificaciones de streaming en §1.4.

```typescript
// shared/src/jsonrpc/methods.ts
export interface JsonRpcMethodRegistry {
  // Threads y turns (17)
  'thread/list':          { params: ListThreadsParams;         result: ThreadList };
  'thread/read':          { params: { threadId: string };      result: Thread };
  'thread/start':         { params: StartThreadParams;         result: Thread };
  'thread/resume':        { params: { threadId: string };      result: void };
  'thread/fork':          { params: ForkParams;                result: Thread };
  'thread/setModel':      { params: ThreadSetModelParams;      result: void };
  'thread/rename':        { params: ThreadRenameParams;        result: Thread };
  'thread/setAccessMode': { params: ThreadSetAccessModeParams; result: Thread };
  'thread/archive':       { params: { threadId: string };      result: Thread };
  'thread/unarchive':     { params: { threadId: string };      result: Thread };
  'thread/delete':        { params: { threadId: string };      result: void };
  'turn/list':            { params: TurnListParams;            result: TurnList };
  'turn/read':            { params: { turnId: string };        result: Turn };
  'turn/send':            { params: TurnSendParams;            result: TurnSendResult };
  'turn/cancel':          { params: { threadId: string; turnId: string }; result: void };
  // Cola de mensajes (follow-ups enviados con un turno en vuelo)
  'queue/resume':         { params: { threadId: string };      result: QueueStateResult };
  'queue/clear':          { params: { threadId: string };      result: QueueStateResult };

  // Git (20)
  'git/status':         { params: { cwd: string };         result: GitRepoStatus };
  'git/diff':           { params: GitDiffParams;           result: GitDiff };
  'git/commit':         { params: GitCommitParams;         result: GitCommitResult };
  'git/push':           { params: GitPushParams;           result: GitPushResult };
  'git/pull':           { params: GitPullParams;           result: GitPullResult };
  'git/checkout':       { params: GitCheckoutParams;       result: void };
  'git/createBranch':   { params: GitBranchParams;         result: GitBranchResult };
  'git/createWorktree': { params: GitWorktreeParams;       result: GitWorktreeResult };
  'git/stage':          { params: GitPathsParams;          result: void };
  'git/unstage':        { params: GitPathsParams;          result: void };
  'git/discard':        { params: GitPathsParams;          result: void };
  'git/createPr':       { params: GitPrParams;             result: GitPrResult };
  'git/undoCommit':     { params: { cwd: string };         result: void };
  'git/branches':       { params: { cwd: string };         result: GitBranchList };
  'git/switchBranch':   { params: GitSwitchBranchParams;   result: void };
  'git/revert':         { params: GitRevertParams;         result: void };
  'git/deleteBranch':   { params: GitDeleteBranchParams;   result: void };
  'git/removeWorktree': { params: GitRemoveWorktreeParams; result: void };
  'git/log':            { params: GitLogParams;            result: GitLogResult };
  'git/commitShow':     { params: GitCommitShowParams;     result: GitCommitDetails };

  // Workspace (10)
  'workspace/readFile':        { params: { cwd: string; path: string }; result: FileContent };
  'workspace/readImage':       { params: { cwd: string; path: string }; result: ImageContent };
  'workspace/list':            { params: { cwd: string };       result: WorkspaceListing };
  'workspace/searchFiles':     { params: SearchFilesParams;     result: WorkspaceSearchResult };
  'workspace/browseDirs':      { params: BrowseDirsParams;      result: BrowseResult };
  'workspace/checkpoint':      { params: CheckpointParams;      result: Checkpoint };
  'workspace/diffCheckpoint':  { params: { id: string };        result: CheckpointDiff };
  'workspace/applyCheckpoint': { params: { id: string };        result: void };
  'workspace/applyPatch':      { params: PatchParams;           result: ApplyResult };
  'workspace/exists':          { params: WorkspaceExistsParams; result: WorkspaceExistsResult };

  // Projects (2)
  'project/list':    { params: void;            result: Project[] };
  'project/resolve': { params: { cwd: string }; result: Project };

  // Agents (4)
  'agent/list':       { params: void;                result: AgentListResult };
  'agent/models':     { params: AgentModelsParams;   result: AgentModelsResult };
  'agent/commands':   { params: AgentCommandsParams; result: AgentCommandsResult };
  'agent/usageStats': { params: UsageStatsParams;    result: UsageStatsResult };

  // Metrics (3) - ledger propiedad del bridge + respaldo sellado
  'metrics/get':    { params: void;                result: MetricsSnapshot };
  'metrics/export': { params: MetricsExportParams; result: MetricsExportResult };
  'metrics/import': { params: MetricsImportParams; result: MetricsImportResult };

  // Auth (3) - sanitizado; nunca lleva tokens/keys
  'auth/status': { params: { agentId: AgentId }; result: AuthStatus };
  'auth/login':  { params: { provider: string }; result: void };
  'auth/logout': { params: void;                 result: void };

  // Notifications / push (3)
  'notifications/register':   { params: RegisterNotificationsParams; result: RegisterNotificationsResult };
  'notifications/update':     { params: UpdateNotificationsParams;   result: void };
  'notifications/unregister': { params: void;                        result: void };

  // Bridge control (7, desktop -> bridge)
  // BridgeStatus incluye `update` (la actualizacion del propio bridge, 02a
  // §5.8.18) y `features` (capacidades opcionales, p.ej. `messageQueue`). El
  // bridge embebido debe conservar ambos: el primero para que todo cliente
  // ofrezca actualizarlo a traves del mismo dueño, el
  // segundo porque el cliente decide con el si puede ofrecer una funcion —
  // ofrecer encolar contra un bridge que no sabe encolar arranca un turno
  // concurrente y corrompe la sesion del agente.
  'bridge/status':              { params: void;                 result: BridgeStatus };
  'bridge/generatePairingQr':   { params: void;                 result: PairingPayload };
  'bridge/pairingCode':         { params: void;                 result: PairingCode };   // solo canal local
  'bridge/connectedPhones':     { params: void;                 result: ConnectedPhone[] };
  'bridge/disconnectPhone':     { params: { deviceId: string }; result: void };
  'bridge/trustedDevices':      { params: void;                 result: TrustedDevice[] };
  'bridge/removeTrustedDevice': { params: { deviceId: string }; result: void };
  'bridge/update':              { params: void;                 result: BridgeUpdate };
  'bridge/checkForUpdate':      { params: void;                 result: BridgeUpdate };

  // El relay propio del usuario (02a §5.10): el bridge es el dueño; todo cliente pregunta
  'relay/status':               { params: void;                  result: RelayStatus };
  'relay/setup':                { params: RelaySetupParams;      result: RelayStatus };
  'relay/use':                  { params: RelayUseParams;        result: RelayStatus };
  'relay/set':                  { params: RelaySetParams;        result: RelayStatus };
  'relay/update':               { params: RelayCredentialParams; result: RelayStatus };
  'relay/rotate':               { params: void;                  result: RelayStatus };
  'relay/remove':               { params: RelayRemoveParams;     result: RelayStatus };
}
```

---

## 5. Conexion movil desde el desktop

### 5.1 Topologias de conexion

El movil llega al bridge (standalone o embebido) por tres caminos; prueba
primero las direcciones directas y el relay al final (`02a` §2, §5.9.3):

```
Topologia 1 — LAN directa
┌──────────┐   WebSocket LAN   ┌──────────────────────┐
│  Movil   │ ────────────────→ │  Bridge (PC)          │
│          │   E2EE directo    │                       │
└──────────┘                   └──────────────────────┘
No requiere relay. El movil y la PC estan en la misma red local.

Topologia 2 — Tailscale (directa)
┌──────────┐   WS 100.x (tailnet)   ┌──────────────────────┐
│  Movil   │ ─────────────────────→ │  Bridge (PC)          │
└──────────┘   E2EE directo         └──────────────────────┘
La direccion Tailscale del bridge viaja en `hosts`; sin hosting.

Topologia 3 — Relay propio del usuario
┌──────────┐   WSS   ┌──────────────────────────────┐   WSS   ┌──────────────┐
│  Movil   │ ──────→ │ Worker + Durable Object en la │ ←────── │  Bridge (PC) │
│          │         │ cuenta de Cloudflare del      │         │              │
│          │         │ usuario (lo despliega el      │         │              │
│          │         │ bridge)                       │         │              │
└──────────┘         └──────────────────────────────┘         └──────────────┘
Fuera de la red de la PC y sin VPN. Solo existe si el usuario lo configuro.
```

En las tres topologias, la conexion siempre es E2EE. El relay autentica a cada
lado con una firma Ed25519 y despues solo reenvia frames cifrados; no puede
descifrar el contenido. El desktop nunca usa el relay: habla con el bridge de su
propia maquina por el canal de control local (§3.5).

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
| Bridge activo, sin telefono | `Esperando conexion` | Bridge escuchando en la LAN (y conectado a su relay, si tiene), esperando movil |
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
│  Paso 4: Bridge genera PairingPayload (v3):                     │
│          { v: 3, hosts?, relay?: {url, routingId, ticket?},     │
│            sessionId, macDeviceId, macIdentityPublicKey,        │
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
│  Paso 7: Handshake E2EE por la LAN/Tailscale o, fuera de la     │
│          red y con relay propio, por el relay (ticket del QR)   │
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

### 5.4 Acceso remoto: el relay propio del usuario

El bridge es el **dueño** del relay (`02a` §5.10): lo despliega en la cuenta
de Cloudflare del usuario, lo mantiene conectado y lo reporta por `relay/*` y
`stream/relay/updated`. El desktop es **un cliente mas** (como el telefono y el
CLI `uxnan-bridge relay …`): nunca llama a Cloudflare ni guarda un ajuste de
relay propio. Vive en Ajustes → Bridge y movil, como seccion *Acceso remoto*
entre *Telefonos* y *Compartido con tus telefonos* — junto a los telefonos a
los que sirve, en el mismo panel que ya agrupa todo lo que conecta el telefono
con este equipo.

**Una replica, un escritor.** `RelayStore` (`$lib/bridge/relay.svelte.ts`)
guarda el ultimo `RelayStatus`: lo pide con `relay/status` en cada
(re)conexion, lo reemplaza con cada `stream/relay/updated` y con la respuesta
de cada `relay/*` (todas devuelven el estado completo), siempre por el mismo
metodo. Una respuesta de `relay/status` que se cruzo con una notificacion no la
deshace (la notificacion y la respuesta llegan a la ventana por canales
distintos). Un bridge que responde *method not found* (-32601) marca la seccion
como no soportada.

**Lo que muestra:**

- **Sin relay:** las tres formas de conectar — misma red (ya funciona),
  Tailscale (automatico si esta en ambos; el QR lleva esas direcciones) y relay
  propio (cualquier red, cuenta gratuita de Cloudflare) — con *Configurar tu
  relay* y, plegado, *Usar un relay que desplegaste* (`relay/use`) junto con la
  `hostKey` del bridge para copiar, que un relay desplegado a mano debe listar
  en `UXNAN_HOST_KEYS`.
- **Configurar** (dialogo): pasos con enlace a
  `dash.cloudflare.com/profile/api-tokens` y la plantilla *Edit Cloudflare
  Workers*, donde esta el id de cuenta, el id y el token (campo de
  contraseña), *Recordar el token en este PC (llavero del sistema)* apagado por
  defecto, y *Desplegar* con estado en curso (hasta ~1 min). El token se envia
  una vez en `relay/setup` y el campo se vacia al responder, con exito o error;
  el error es el texto del bridge tal cual.
- **Con relay:** *Usar el relay* (`relay/set`), estado (`state`, `lastError`),
  telefonos conectados por el relay, direccion y origen (tu cuenta de
  Cloudflare / desplegado por ti), version (`deployedVersion` vs
  `bundledVersion`; *Actualizar relay* → `relay/update` solo para un relay que
  desplego el bridge, pidiendo el token si `tokenRemembered` es falso), *Nueva
  direccion* (`relay/rotate`, con confirmacion) y *Quitar* (`relay/remove`, con
  la opcion de borrarlo tambien de Cloudflare — `deleteWorker`, que pide el
  token si no esta recordado).
- **Sin bridge o con uno anterior a `relay/*`:** la seccion sigue visible,
  deshabilitada, con la linea que dice por que.

**Estado:** construido y con pruebas; falta la revision visual del mantenedor
y una ejecucion real contra Cloudflare (`uxnandesktop/FOR-DEV.md` → *Remote
access*).

---

## 6. Configuracion del bridge en desktop

### 6.1 Settings expuestos en la UI

> **Nota (2026-10):** el bloque de abajo es el diseño original del modo
> embebido. El relay ya **no** es una URL configurable con un valor oficial por
> defecto: no existe relay hospedado por Uxnan. El relay es el propio del
> usuario, lo gestiona el bridge (`relay/*`, §5.4) y su endpoint es el ajuste
> compartido `BridgeSettings.relay` (clave `relay` de `daemon-config.json`).

```typescript
// Configuracion del bridge gestionada desde el desktop
interface BridgeDesktopConfig {
  // General
  enabled: boolean;                    // Habilitar/deshabilitar el modulo bridge
  // Relay: no vive aqui — se lee de relay/status y se cambia con relay/* (§5.4)

  // Red local
  lanEnabled: boolean;                 // Habilitar conexiones LAN directas
  lanPort: number;                     // Puerto para WebSocket LAN (default: 19850)

  // Notificaciones push
  pushEnabled: boolean;                // Enviar push al movil cuando un agente termina
  pushOnAgentDone: boolean;            // Push al completar un turn
  pushOnAgentError: boolean;           // Push al detectar error en un agente

  // Dispositivos de confianza
  trustedPhones: TrustedPhone[];       // Lista de telefonos pareados

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
└── Bridge y movil                    ← Seccion del bridge
    ├── Habilitar conexion movil       [Toggle ON/OFF]
    ├── Acceso remoto (relay propio)   ← §5.4; cliente de relay/*
    │   ├── Estado / endpoint / version
    │   ├── Configurar (cuenta + token) · Usar un relay propio
    │   └── Encender/apagar · Actualizar · Rotar · Quitar
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
│     └─→ Lee daemon-config.json → aplica relay propio, preferencias│
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
│     └─→ Conecta a su relay (si tiene) con la misma identidad    │
│                                                                  │
│  5. El telefono se reconecta automaticamente                     │
│     └─→ Trusted reconnect, sin necesidad de re-pairing          │
└──────────────────────────────────────────────────────────────────┘
```

### 7.3 Prevencion de conflictos

Si ambos modos intentan correr simultaneamente (bridge standalone + desktop con bridge embebido), habra un conflicto porque ambos intentan conectarse al relay del usuario con la misma identidad (el relay se queda con la conexion mas nueva: `replaced`) y escuchar en el mismo puerto LAN.

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
| Endpoint del relay propio (publico) | `~/.uxnan/daemon-config.json` (`relay`) + `~/.uxnan/relay.json` | Bridge; los clientes lo leen por `relay/status` |
| Token de Cloudflare (solo si se pidio recordarlo) | Llavero del sistema (`relay.cloudflare-token`) | Solo el proceso bridge |
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
