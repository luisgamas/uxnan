# Uxnan — Visión del Producto

> **Versión:** 1.0.0  
> **Fecha:** 2026-06-03  
> **Estado:** Definición inicial — borrador técnico completo  
> **Plataformas objetivo:** Android (principal), iOS (principal)  
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod

> Este documento forma parte de la documentación técnica de Uxnan. Ver también: [02-technical-specification.md](02-technical-specification.md) | [03-technical-reference.md](03-technical-reference.md)

---

## Tabla de contenidos

1. [Visión general del producto](#1-visión-general-del-producto)
2. [Contexto y motivación](#2-contexto-y-motivación)
3. [Arquitectura del sistema](#3-arquitectura-del-sistema)
4. [Agentes de codificación soportados](#4-agentes-de-codificación-soportados)
5. [Flujos críticos del sistema](#5-flujos-críticos-del-sistema)
6. [Alcance del MVP y post-MVP](#6-alcance-del-mvp-y-post-mvp)
7. [Roadmap de versiones](#7-roadmap-de-versiones)

---

## 1. Visión general del producto

**Uxnan** es una aplicación móvil multiplataforma (Android e iOS) construida con Flutter que permite controlar remotamente sesiones de agentes de codificación con IA que corren en una PC (Windows, macOS o Linux). La app funciona como un cliente inteligente que se conecta a un daemon bridge local instalado en la PC del usuario, comunica operaciones a través de un canal WebSocket cifrado de extremo a extremo (E2EE), y expone al usuario una interfaz rica para gestionar conversaciones, threads, operaciones Git, el filesystem del workspace, terminal SSH, y notificaciones push.

### Diferenciadores clave

- **Multi-agente y multi-proveedor:** compatible con OpenAI Codex CLI, OpenCode, Claude Code, Gemini CLI, pi-agent y cualquier agente futuro que exponga una interfaz JSON-RPC o JSONL compatible.
- **Sin lock-in de proveedor:** el modelo de abstracción del bridge normaliza las diferencias de protocolo entre agentes.
- **Local-first y soberanía de datos:** el código, contexto y conversaciones nunca pasan por servidores de terceros. El producto es **bridge-first**: la ruta primaria es **LAN-direct** o **Tailscale-direct** (cero hosting, cero credenciales). El relay es **opcional y self-hosted** — cuando se usa, solo retransmite envelopes cifrados opacos. El push lo envía el **bridge** directamente (FCM HTTP v1) sobre cualquier transporte.
- **E2EE real:** ni el relay (cuando se usa) ni el bridge ven el contenido en texto claro. La clave de sesión se deriva de un handshake X25519 + HKDF firmado con Ed25519; el QR codifica la identidad del bridge y opcionalmente sus direcciones directas (`hosts: string[]`) además de una URL de relay.
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

## 3. Arquitectura del sistema

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
│                      Relay Server (Node.js, OPCIONAL)                │
│   (Self-hosted, solo para acceso off-LAN. La ruta primaria del        │
│    producto es LAN-direct / Tailscale-direct — sin relay.)            │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────────────────┐         │
│  │ HTTP/WS  │  │ WebSocket   │  │ Session                  │         │
│  │ Server   │  │ Relay       │  │ Management               │         │
│  └──────────┘  └──────┬──────┘  └──────────────────────────┘         │
│   (push endpoints opcionales: /push/register, /push/notify — solo     │
│    como fallback si el bridge no tiene credencial FCM local)            │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ WebSocket (E2EE opaque) — solo si el QR del bridge anuncia `relay`
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│               Uxnan Bridge Daemon (PC: Win / macOS / Linux)          │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐   │
│  │ Secure   │  │ Agent      │  │ Handler    │  │ Daemon         │   │
│  │Transport │→ │ Transport  │→ │ Router     │→ │ State          │   │
│  └──────────┘  └────────────┘  └─────┬──────┘  └────────────────┘   │
│  ┌─────────────┐  ┌─────────────────┘                                  │
│  │ Push Svc    │  ← bridge-direct FCM (lazy firebase-admin)            │
│  │ (FCM HTTPv1)│  → opcional POST /push/notify al relay (fallback)     │
│  └─────────────┘                                                       │
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
| **Uxnan Bridge** | Node.js daemon | Plano de control local en la PC; corre agentes y expone la API JSON-RPC al móvil |
| **Uxnan Relay** | Node.js HTTP/WS | (Opcional, self-hosted) Relay de envelopes E2EE opacos como fallback off-LAN; push enviado por el bridge directamente |
| **Agent Adapters** | Node.js | Adaptadores por agente (Codex, OpenCode, Claude Code, pi, Gemini CLI, Antigravity, Zero, Grok) |

### 3.3 Topologías de conexión

> **Dirección (2026-06):** el producto es **bridge-first**. Las topologías
> primaria y recomendada son LAN-direct y Tailscale-direct (cero hosting,
> cero credenciales). El relay es la topología de **fallback off-LAN** que
> el usuario puede self-hostear. Ver `02a-system-architecture.md` §2 y
> `02e-bridge-integration.md` para el detalle.

**Topología 1 — LAN directa (PRIMARIA):**
```
[Móvil] ──WebSocket LAN──→ [Bridge directo]
```
Cuando el móvil y la PC están en la misma red, la app se conecta directamente
al bridge. El bridge expone su `host:port` LAN en el `PairingPayload`
(`hosts: string[]`); el `TransportSelector` del móvil prueba cada host directo
con un timeout corto antes de cualquier fallback. La conexión sigue siendo
E2EE extremo a extremo.

**Topología 2 — Tailscale / mesh VPN directa (RECOMENDADA para remoto):**
```
[Móvil] ──WSS 100.x──→ [Bridge directo]
```
Cuando el móvil y la PC están en la misma red Tailscale (o cualquier mesh
VPN). El bridge detecta su dirección Tailscale (`100.x`) y la anuncia en
`hosts`. Cero hosting, cero relay, E2EE intacto. Es la opción recomendada
para acceder desde fuera de la LAN sin desplegar un relay.

**Topología 3 — Relay self-hosted (FALLBACK off-LAN):**
```
[Móvil] ──WS E2EE──→ [Relay self-hosted] ──WS E2EE──→ [Bridge]
```
Cuando el móvil está fuera de la LAN y no hay Tailscale. El relay
retransmite envelopes cifrados opacos; nunca ve el contenido. El relay es
**opcional y self-hosted**: el usuario lo despliega en un VPS o servidor
doméstico. El bridge lo anuncia en el QR solo si `relayEnabled = true`
(por defecto `false`).

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

### 4.2 Capacidades por agente

Todos los adaptadores exponen un modelo de capacidades que la app consulta para habilitar o deshabilitar features de la UI dinámicamente:

```typescript
// Fuente de verdad: shared/src/agents/agent-capabilities.ts
interface AgentCapabilities {
  planMode: boolean;                // agente soporta modo plan interactivo
  streaming: boolean;               // emite deltas de tokens en streaming
  approvals: boolean;               // emite content blocks `approval` (gating de tools)
  forking: boolean;                 // soporta forking / reanudar threads
  images: boolean;                  // acepta image attachments en sendTurn
  reportsContextUsage?: boolean;    // emite `usage` en turn/completed
  autonomous?: boolean;             // corre en modo autónomo ("YOLO") por defecto
}
```

---

## 5. Flujos críticos del sistema

### 5.1 Flujo completo de primera conexión

```
[App] Instala Uxnan en el móvil
[PC]  Instala uxnan-bridge: npm install -g uxnan-bridge
[PC]  Ejecuta: uxnan-bridge start
[PC]  Muestra QR en terminal: uxnan-bridge qr
  QR = PairingPayload { v:2, hosts:["192.168.1.42:19850", "100.x.y.z:19850"],
                         relay?: "wss://...", sessionId, macDeviceId,
                         macIdentityPublicKey, expiresAt, displayName }
  // `relay` es opcional; `hosts` es la ruta primaria. El QR se codifica como
  // Base64(utf8(JSON)). Ver 02a-system-architecture.md §5.5.4.

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

### 5.2 Flujo de reconexión confiable

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

### 5.3 Flujo de envío de mensaje y streaming

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

### 5.4 Flujo Git: commit + push

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

### 5.5 Flujo de notificación push

> **Dirección (2026-06-12):** el push se envía **directamente desde el
> bridge** sobre cualquier transporte (LAN, Tailscale, o relay) usando
> FCM HTTP v1 (lazy `firebase-admin` con un service account local). El
> relay conserva `POST /push/notify` como **fallback** opcional para
> setups con relay hospedado. Ver `02a-system-architecture.md` §5.10
> y `bridge/FOR-DEV.md` → *Direct FCM from the bridge*.

```
[PC] Agente completa un turno largo
[Bridge] AgentManager.onTurnEnd detecta turn/completed
[Bridge] PushService.resolveSession(sessionId) -> { token, platform }
[Bridge] createBridgePushSender (lazy firebase-admin) -> Firebase FCM HTTP v1
  { notification: { title: "Tarea completada", body: "..." },
    data: { threadId, turnId, ... },
    android: { priority: "high" }, apns: { headers: { "apns-priority": "10" } } }
   (fallback) [Bridge → Relay] POST /push/notify (solo si no hay credencial
   FCM local o relayEnabled = true)

[Móvil] Recibe push (background o foreground)
[App] HandleIncomingPush:
  ├── Si foreground y la conversacion esta en pantalla -> suprime (foregroundThreadProvider)
  └── Si background/tap -> navega a ConversationScreen(threadId)
[App] ThreadManager.selectThread(threadId)
[App] Si no conectado → SessionCoordinator.connect()
[App] Carga timeline del thread
```

---

## 6. Alcance del MVP y post-MVP

### 6.1 MVP — Scope mínimo viable

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

### 6.2 Post-MVP — Features siguientes

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

---

## 7. Roadmap de versiones

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
- Self-hosted relay setup wizard en la app *(opcional — la ruta primaria es LAN/Tailscale-direct y no necesita relay; el wizard aplica solo a quien decida self-hostear un relay off-LAN)*
