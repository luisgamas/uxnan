# Uxnan — Contratos, Requisitos y Paquetes

> **Version:** 1.1.0 | **Fecha:** 2026-06-17 | **Estado:** Sincronizado con codigo ALPHA
>
> **Regla de mantenimiento (ver `AGENTS.md` → *Spec drift control (non-negotiable)*):**
> este documento es la **fuente de verdad** de los contratos JSON-RPC,
> requisitos no funcionales, paquetes Flutter, y los requisitos funcionales
> por modulo. La **lista definitiva de metodos** vive en
> `../../shared/src/jsonrpc/method-registry.ts` (`METHOD_NAMES`) y la lista
> de notificaciones en `../../shared/src/jsonrpc/notifications.ts`
> (`StreamNotification`). Las dos estan sincronizadas en build-time por una
> asercion de tipos (`_assertNamesAreMethods` / `_assertMethodsAreNames`);
> cualquier drift en TS rompe la build. Esta seccion documenta el contrato,
> no la sintaxis.

> Este documento forma parte de la documentacion tecnica de Uxnan. Ver tambien: [01-product-vision.md](01-product-vision.md) | [02a-system-architecture.md](02a-system-architecture.md) | [02c-implementation-guide.md](02c-implementation-guide.md) | [03-technical-reference.md](03-technical-reference.md)

---

## Tabla de contenidos

1. [Contratos de comunicacion](#1-contratos-de-comunicacion)
   1. [Formato base](#11-formato-base)
   2. [Metodos JSON-RPC completos](#12-metodos-json-rpc-completos)
   3. [Errores JSON-RPC estandar](#13-errores-json-rpc-estandar)
   4. [Notificaciones de streaming (bridge -> phone)](#14-notificaciones-de-streaming-bridge---phone)
   5. [Shapes cross-cutting (seleccion)](#15-shapes-cross-cutting-seleccion)
2. [Paquetes Flutter recomendados](#2-paquetes-flutter-recomendados)
   1. [Estado y DI](#21-estado-y-di)
   2. [Navegacion](#22-navegacion)
   3. [Red y WebSocket](#23-red-y-websocket)
   4. [Almacenamiento](#24-almacenamiento)
   5. [Criptografia](#25-criptografia)
   6. [UI y componentes visuales](#26-ui-y-componentes-visuales)
   7. [Camara y QR](#27-camara-y-qr)
   8. [Permisos y plataforma](#28-permisos-y-plataforma)
   9. [Notificaciones](#29-notificaciones)
   10. [SSH Terminal](#210-ssh-terminal)
   11. [Utilidades](#211-utilidades)
   12. [Puentes nativos necesarios (plugins personalizados)](#212-puentes-nativos-necesarios-plugins-personalizados)
3. [Requisitos no funcionales](#3-requisitos-no-funcionales)
   1. [Rendimiento](#31-rendimiento)
   2. [Seguridad](#32-seguridad)
   3. [Disponibilidad](#33-disponibilidad)
   4. [Compatibilidad](#34-compatibilidad)
   5. [Internacionalizacion](#35-internacionalizacion)
   6. [Accesibilidad](#36-accesibilidad)
   7. [Privacidad](#37-privacidad)
4. [Requisitos funcionales detallados por modulo](#4-requisitos-funcionales-detallados-por-modulo)
   1. [RF-CONN: Conexion y sesion](#41-rf-conn-conexion-y-sesion)
   2. [RF-PAIR: Pairing y dispositivos](#42-rf-pair-pairing-y-dispositivos)
   3. [RF-THREAD: Threads y conversacion](#43-rf-thread-threads-y-conversacion)
   4. [RF-COMP: Composer](#44-rf-comp-composer)
   5. [RF-GIT: Integracion Git](#45-rf-git-integracion-git)
   6. [RF-WORK: Workspace](#46-rf-work-workspace)
   7. [RF-NOTIF: Notificaciones](#47-rf-notif-notificaciones)
   8. [RF-SSH: Terminal SSH](#48-rf-ssh-terminal-ssh)
   9. [RF-MULTI: Multi-agente y multi-proyecto](#49-rf-multi-multi-agente-y-multi-proyecto)
5. [Seguridad y criptografia](#5-seguridad-y-criptografia)
   1. [Primitivas criptograficas](#51-primitivas-criptograficas)
   2. [Almacenamiento de material criptografico](#52-almacenamiento-de-material-criptografico)
   3. [Threat model](#53-threat-model)
6. [Gestion de estado y persistencia](#6-gestion-de-estado-y-persistencia)
   1. [Niveles de persistencia](#61-niveles-de-persistencia)
   2. [Estrategia de cache de mensajes](#62-estrategia-de-cache-de-mensajes)
   3. [Offline support](#63-offline-support)

---

## 1. Contratos de comunicacion

Toda la comunicacion entre la app movil y el bridge usa **JSON-RPC 2.0** sobre WebSocket, dentro de envelopes E2EE.

### 1.1 Formato base

```json
// Request
{ "jsonrpc": "2.0", "id": "uuid-or-int", "method": "namespace/action", "params": { ... } }

// Response exitosa
{ "jsonrpc": "2.0", "id": "uuid-or-int", "result": { ... } }

// Response con error
{ "jsonrpc": "2.0", "id": "uuid-or-int", "error": { "code": -32000, "message": "...", "data": { ... } } }

// Notificacion (sin id, unidireccional del bridge al movil)
{ "jsonrpc": "2.0", "method": "namespace/event", "params": { ... } }
```

### 1.2 Metodos JSON-RPC completos

> **Lista canonica:** la fuente de verdad en TypeScript es
> `../../shared/src/jsonrpc/method-registry.ts` (`METHOD_NAMES`, 59 entradas).
> El telefono mantiene una copia Dart sincronizada a mano
> (`uxnanmobile/lib/domain/value_objects/...`); el bridge y el relay consumen
> el paquete compartido directamente. Los nombres siguen la convencion
> `domain/action` (lowercase) en singular para acciones discretas
> (`git/commit`) y plural para lecturas (`git/branches`).
>
> **Total: 59 metodos request/response** + 8 notificaciones de streaming
> (ver §1.4). El bridge tambien expone el endpoint HTTP local
> `GET /pair/resolve?code=<code>` para manual-code pairing (ver
> `02a` §5.5.3) — fuera del canal JSON-RPC, vive en su `http.Server`.

**Threads y turns (15):**
```
thread/list             -> lista de threads del PC, con filtro opcional
thread/read             -> datos completos de un thread
thread/start            -> crear nuevo thread (agentId, model, cwd, opcional)
thread/resume           -> reanudar thread existente (best-effort)
thread/fork             -> fork de un thread en uno nuevo
thread/setModel         -> cambiar el modelo de un thread mid-conversacion
thread/rename           -> renombrar thread (devuelve el Thread actualizado)
thread/setAccessMode    -> persistir el modo de acceso/aprobacion por hilo. Params: { threadId, mode: AccessMode } (requestApproval | approveForMe | fullAccess). Devuelve el Thread actualizado; idempotente. El Thread expone `accessMode?` (fuente de verdad) y `agentSessionId?` (id de sesion nativo del agente, para "reanudar desde la CLI"). **Enforcement:** en cada `turn/send` el bridge lee `accessMode` del hilo y lo pasa al adapter (`SendTurnOptions.accessMode`); Claude lo mapea a su postura (requestApproval=hook interactivo, approveForMe=`--permission-mode acceptEdits`, fullAccess=`--dangerously-skip-permissions`). Sin modo → postura configurada (sin cambio).
thread/archive          -> archivar thread (status -> archived, reversible)
thread/unarchive        -> restaurar thread archivado (status -> active)
thread/delete           -> eliminar thread y sus turns
turn/list               -> turnos de un thread; paginacion por cursor offset (oldest->newest). Params: { threadId, cursor?, limit?, fromEnd? }. Result: { turns, nextCursor?, total? }. `fromEnd:true` devuelve la pagina mas reciente (ultimos `limit` turnos); `total` permite paginar hacia atras (newest-first) calculando offsets sin traer todo el thread.
turn/read               -> datos de un turno especifico
turn/send               -> enviar contenido a un turno activo (texto opcional, attachments, options, approvalResponse)
turn/cancel             -> cancelar turno en curso
```

**Git (18):**
```
git/status              -> estado del repo (files, ahead/behind, diffTotals)
git/diff                -> diff de un path o del workspace completo
git/commit              -> hacer commit con mensaje (title + body + Co-authored-by)
git/push                -> push a remote, con progreso por fase (stream/git/progress)
git/pull                -> pull desde remote
git/checkout            -> checkout de rama (con auto-stash opcional)
git/createBranch        -> crear nueva rama
git/createWorktree      -> crear worktree (path explicito; managed flag reservado)
git/stage               -> stage de archivos o hunks especificos
git/unstage             -> unstage de archivos o hunks especificos
git/discard             -> descartar cambios de archivos o hunks especificos
git/createPr            -> crear Pull Request (smart PR; auto-push del head)
git/undoCommit          -> soft reset del ultimo commit
git/branches            -> lectura: lista de ramas (locales + remotas)
git/switchBranch        -> cambiar de rama (con auto-stash)
git/revert              -> revertir el ultimo commit (git revert, preserva historia)
git/deleteBranch        -> eliminar rama (refusa unmerged salvo force)
git/removeWorktree      -> eliminar worktree (refusa dirty salvo force)
git/log                -> historial de commits (paginado por cursor; parents[] para la vista gráfico)
```

**Workspace (9):**
```
workspace/readFile              -> leer archivo del workspace (utf-8 o base64)
workspace/readImage             -> leer imagen del workspace (base64)
workspace/list                  -> listar archivos del cwd
workspace/browseDirs            -> navegar sub-carpetas bajo un root configurado (confinado; git-repo aware)
workspace/checkpoint            -> capturar checkpoint del estado actual
workspace/diffCheckpoint        -> diff de un checkpoint (unified)
workspace/applyCheckpoint       -> aplicar un checkpoint (restore verdadero: borra archivos creados despues)
workspace/applyPatch            -> aplicar lista de cambios de patch
workspace/exists                -> probe rapido: existe cwd? es git repo? (para detectar threads huerfanos)
```

**Proyectos (2):**
```
project/list            -> lista de proyectos configurados (Project { id, name, cwd, agentId?, model? })
project/resolve         -> resolver proyecto por cwd (sintetiza uno si el cwd no esta en workspaceRoots)
```

**Agentes (2):**
```
agent/list              -> agentes registrados (IAgentAdapter.agentId, displayName, capabilities, available)
agent/models            -> modelos disponibles del agente activo (AgentModel[] estructurado: id, displayName, description?, version?, isDefault?, options?, contextWindow?)
```

**Auth (3):**
```
auth/status             -> estado de auth **sanitizado** del agente (no expone tokens; login por existencia de auth file)
auth/login              -> stub (login interactivo se hace en el CLI del agente en la PC, no desde el movil)
auth/logout             -> stub (idem; logout en el CLI)
```

**Notificaciones push (3):**
```
notifications/register          -> registrar FCM token + preferencias del telefono
notifications/update            -> actualizar preferencias de notificacion (Replies/Errors)
notifications/unregister        -> desregistrar el telefono
```

**Control del bridge (7):**
```
bridge/status                    -> snapshot de estado del bridge (incluye relayConnected)
bridge/generatePairingQr         -> regenera y devuelve el PairingPayload vigente
bridge/connectedPhones           -> lista de telefonos conectados
bridge/disconnectPhone           -> desconectar un telefono
bridge/trustedDevices            -> lista de dispositivos de confianza
bridge/removeTrustedDevice       -> revocar confianza + drop session + drop push registration
```

**Metodos eliminados del draft v0.1.0 (no se llegaron a implementar):**
- `initialize` / `initialized` (handshake estilo MCP): el handshake E2EE
  cubre ese rol; el bridge no implementa un canal de inicializacion
  separado.
- `bridge/version`: el endpoint HTTP del bridge y el JSON-RPC
  `bridge/status` exponen la misma informacion.
- `getAuthStatus`: renombrado a `auth/status { agentId }` (per-agente).
- `workspace/file/read` -> `workspace/readFile`.
- `workspace/image/read` -> `workspace/readImage`.
- `workspace/checkpoint/capture` -> `workspace/checkpoint`.
- `workspace/checkpoint/preview` -> eliminado (unificado en
  `diffCheckpoint`).
- `workspace/checkpoint/diff` -> `workspace/diffCheckpoint`.
- `workspace/checkpoint/apply` -> `workspace/applyCheckpoint`.
- `workspace/patch/apply` -> `workspace/applyPatch`.
- `account/read` -> `auth/status`.
- `account/login/start` -> `auth/login` (stub; el login real es en el CLI).
- `account/login/cancel` -> eliminado.
- `account/logout` -> `auth/logout` (stub).
- `project/add` / `project/remove`: el descubrimiento de proyectos
  es **plug-and-play** via `workspace/browseDirs` + `project/resolve`;
  ya no se pre-configuran proyectos. `workspaceRoots` / `browseRoots`
  son la unica configuracion de proyecto (ver
  `bridge/docs/configuration.md`).
- `git/branch/create` -> `git/createBranch`.
- `git/worktree/create` -> `git/createWorktree`.
- `git/worktree/managed/create` -> eliminado (el flag `managed` queda
  reservado en `GitWorktreeParams` para uso futuro).
- `git/stacked/publish` -> reemplazado por `git/commit` + `git/push` +
  `git/createPr` con auto-push condicional; el flujo "stacked" ya no
  es un metodo dedicado.
- `thread/turns/list` -> `turn/list`.
- `thread/turn/start` -> unificado en `turn/send` (el adapter crea el
  primer turno si no existe; el contrato es uniforme).
- `desktop/refresh` / `desktop/open` / `desktop/focus`: el bridge no
  expone endpoints de control de la app de escritorio; el desktop
  consume el bridge, no al reves. Ver
  `../../uxnandesktop/architecture/02e-bridge-integration.md` para el
  sentido de la integracion.

### 1.3 Errores JSON-RPC estandar

> **Lista canonica:** `../../shared/src/jsonrpc/errors.ts` (`JsonRpcErrorCode`
> + `RpcError`). El bridge mapea sus errores de aplicacion a estos codigos
> en `RpcError`; el telefono los decodifica con la misma clase y los traduce
> a un mensaje local. Los codigos Uxnan-especificos ocupan el rango
> `-32000` a `-32099`.

| Codigo | Significado | Cuando se emite |
|---|---|---|
| `-32700` | Parse error | JSON malformado en el envelope |
| `-32600` | Invalid request | Envelope no es un JSON-RPC 2.0 valido |
| `-32601` | Method not found | `method` no esta en `METHOD_NAMES` |
| `-32602` | Invalid params | Parametros no cumplen el schema (Ajv) o tipos incorrectos |
| `-32603` | Internal error | Cualquier excepcion no contemplada abajo |
| `-32000` | Bridge error generico | Fallo del bridge no clasificable |
| `-32001` | Authentication required | Handshake E2EE no completado o `TrustedDevice` revocado |
| `-32002` | Agent not running | El adaptador no esta disponible (CLI no instalado o logged out) |
| `-32003` | Git operation failed | `git` exit != 0, worktree dirty, etc. |
| `-32004` | Workspace access denied | Path-traversal (`..` o absolute) o sensitive file |
| `-32005` | Bridge version incompatible | `protocolVersion` o `PairingPayload.v` no soportado |
| `-32006` | Session expired | Handshake `expiresAt` vencido, o sesion rotada |
| `-32007` | Confirmation required | (Reservado; el flujo de approval usa `approval` content block, no este codigo) |
| `-32008` | Resource not found | `threadId` / `turnId` / `checkpointId` desconocido |
| `missing_transport` (en `PairingPayload`) | - | El payload no tiene ni `relay` ni `hosts` (validacion pairing) |

---

### 1.4 Notificaciones de streaming (bridge -> phone)

> **Lista canonica:** `../../shared/src/jsonrpc/notifications.ts`
> (`StreamNotification`, 8 entradas). Son JSON-RPC notifications (sin `id`,
> unidireccionales). El telefono las decodifica via
> `IncomingMessageProcessor` y las proyecta en la timeline via un reducer
> sobre `TurnTimelineSnapshot`. Los parametros exactos viven en `shared/`.

```
stream/turn/started         -> TurnStartedParams  { threadId, turnId }
stream/message/delta        -> MessageDeltaParams { threadId, turnId, messageId, delta }
stream/thinking/delta       -> ThinkingDeltaParams { threadId, turnId, messageId, delta }   (NUEVO 2026-06)
stream/content/block        -> ContentBlockParams { threadId, turnId, messageId, content }  (NUEVO 2026-06)
stream/turn/completed       -> TurnCompletedParams { threadId, turnId, messageId, text, usage? }  (usage es TurnUsage)
stream/turn/error           -> TurnErrorParams     { threadId, turnId, error: { code, message } }
stream/turn/aborted         -> TurnAbortedParams   { threadId, turnId }
stream/model/resolved       -> ModelResolvedParams { threadId, turnId, model }              (NUEVO 2026-06)
```

**Notas sobre los nuevos streams (2026-06):**
- `stream/thinking/delta`: el agente emite "thinking" / "reasoning" como
  un canal separado de la respuesta final; el telefono lo pliega en una
  seccion colapsable "Thinking" arriba del turno (settings-gated,
  default off).
- `stream/content/block`: el `content` es un `MessageContent` polimorfico
  serializado (`command_execution` para Bash, `diff` para Edit/Write, un
  bloque `tool` generico para el resto). El telefono lo decodifica con
  el mismo codec que `Message.blocks` y lo proyecta en el **Work log** /
  **Changed files** de la respuesta. Asi los comandos/herramientas/diffs
  del agente se renderizan en vivo y sobreviven a un `turn/list` re-sync.
- `stream/model/resolved`: el bridge informa la version concreta a la que
  un alias (ej. `opus` -> `claude-opus-4-8`) se resolvio para este turno,
  para que el picker del telefono pueda mostrar una fila "Active version"
  en la status sheet.

**El bridge NO emite** (reservadas como follow-up; hoy se gestionan en
otro lado):
- `stream/connection/state`: la reconexion la gestiona el telefono.
- `stream/workspace/updated`: el workspace se refresca bajo demanda con
  `workspace/list`.
- `stream/auth/updated`: el auth se consulta con `auth/status`.

### 1.5 Shapes cross-cutting (seleccion)

> Estas shapes aparecen en multiples metodos y notificaciones. La fuente
> de verdad TS vive en `../../shared/src/models/*.ts` y
> `../../shared/src/agents/agent-capabilities.ts`. La copia Dart vive en
> `uxnanmobile/lib/domain/entities/...` y `value_objects/...`.

**`PairingPayload` v2** (en el QR / respuesta de `GET /pair/resolve`):
```typescript
interface PairingPayload {
  v: 2;                              // version del formato QR
  relay?: string;                    // URL del relay: wss://...  (opcional)
  hosts?: string[];                  // Direcciones directas: ["192.168.1.42:19850", "100.x.y.z:19850"]
  sessionId: string;
  macDeviceId: string;
  macIdentityPublicKey: string;      // Ed25519 publica del bridge (hex)
  expiresAt: number;                 // Unix timestamp ms, TTL 5 min
  displayName: string;
}
// QR encoding: Base64(utf8(JSON)).
// Validacion: al menos uno de `relay` o `hosts` es obligatorio (error `missing_transport`).
```

**`TurnSendParams`** (parametros de `turn/send`):
```typescript
interface TurnSendParams {
  threadId: string;
  text?: string;                              // OPCIONAL: un mensaje image-only es valido
  attachments?: TurnAttachment[];             // imagenes inline (base64, mime, width, height)
  options?: Record<string, string | boolean>; // per-model run-option knobs (ej. { reasoning: 'high' })
  approvalResponse?: ApprovalResponse;        // control-only (no crea turno nuevo)
  service?: string;                           // override per-turn del modelo
  cwd?: string;                               // override per-turn del cwd
}
```

**`TurnAttachment`** (adjunto inline en `turn/send`):
```typescript
interface TurnAttachment {
  type?: 'image';
  mimeType: string;                           // 'image/png' | 'image/jpeg' | ...
  base64Data?: string;                        // una de base64Data o path
  path?: string;                              // ruta alternativa (tolerante)
  width?: number;
  height?: number;
}
```

**`ApprovalResponse`** (respuesta del usuario a un `approval` content block):
```typescript
type ApprovalDecision = 'approve' | 'reject' | 'approveSession';
interface ApprovalResponse { approvalId: string; decision: ApprovalDecision; }
```

**Cómo se enruta la respuesta.** El bridge mantiene un `pendingApprovals`
compartido (en `AgentManager`) que el `AgentManager.requestApproval()`
popula y `AgentManager.respondApproval()` resuelve. El transporte
concreto depende del adaptador:

- **Claude Code** — `--settings` inyecta un hook `PreToolUse` que
  hace `POST /agent-hook/approval` a la LAN server del bridge; el
  bridge reenvía al teléfono por el canal central.
- **Codex** — protocolo JSON-RPC `codex app-server` (long-lived):
  elicitaciones `item/commandExecution|fileChange|permissions/
  requestApproval`, `mcpServer/elicitation/request`,
  `item/tool/requestUserInput` (+ legacy `applyPatchApproval`,
  `execCommandApproval`).
- **Gemini CLI** — el bridge escribe
  `<cwd>/.gemini/settings.json` con un hook `BeforeTool` que
  `POST /agent-hook/approval` con el mismo shape que Claude.
- **Echo (dev)** — el adaptador directamente llama a
  `requestApproval` cuando el texto es `approval-demo` y pausa el
  turno hasta que el usuario responde.

**Timeout consciente de la conexión.** El auto-rechazo de una aprobación
(`APPROVAL_TIMEOUT_MS`, 5 min) solo corre **mientras hay un teléfono con canal
vivo**. Si el teléfono está en background/desconectado, la aprobación **espera**
(su `approval` content block se reenvía vía el outbound log al reconectar), de
modo que un turno que pide aprobación con la app cerrada nunca cae al `reject`
por una tarjeta que el usuario no vio. Una reconexión otorga una ventana nueva;
la última desconexión pausa la cuenta atrás. Para que el propio CLI no aborte el
hook antes de que el usuario regrese, los hooks `PreToolUse` (Claude) y
`BeforeTool` (Gemini) fijan un `timeout` amplio (1800 s), por encima del default
~60 s del CLI.


**`AgentModel`** (item de `agent/models`):
```typescript
interface AgentModel {
  id: string;                                 // routing key (alias, provider/model, o id concreto)
  displayName: string;                        // nombre legible para el picker
  description?: string;
  version?: string;                           // version concreta para ids no-alias
  isDefault?: boolean;
  options?: AgentModelOption[];               // per-model run-option knobs
  contextWindow?: number;                     // ventana del modelo cuando el CLI la reporta (p.ej. pi --list-models)
}
type AgentModelOption =
  | { key: string; kind: 'enum';   label: string; values: string[]; default?: string }
  | { key: string; kind: 'toggle'; label: string; default?: boolean };
// El telefono IGNORA kinds desconocidos (forward-compatible).
```

**`AgentCapabilities`** (de `agent/list`):
```typescript
interface AgentCapabilities {
  planMode: boolean;
  streaming: boolean;
  approvals: boolean;            // emite `approval` content blocks (opt-in)
  forking: boolean;
  images: boolean;               // acepta TurnAttachment[] en sendTurn
  reportsContextUsage: boolean;  // emite `usage` en turn/completed
}
```

**`TurnUsage`** (en `TurnCompletedParams.usage`):
```typescript
interface TurnUsage {
  tokens: number;            // tokens que la conversacion ocupa ahora
  contextWindow?: number;     // ventana del modelo cuando se conoce (Claude tiers)
}
// Si `contextWindow` esta presente, el telefono muestra %; si no, token count crudo.
```

**`ApprovalRequestBlock`** (forma de un `approval` content block):
```typescript
interface ApprovalRequestBlock {
  approvalId: string;
  action: string;             // descripcion legible de la accion propuesta
  risk?: 'low' | 'medium' | 'high';
  detail?: string;            // detalle adicional opcional
}
// Viajado como `stream/content/block` (NO como notificacion dedicada), para
// que persista con el turno y sobreviva a un `turn/list` re-sync.
```

**`MessageContent`** (tipos polimorficos soportados; ver `02a` §6.2):
- `text` (markdown + code blocks)
- `command_execution` (Bash; output truncado a 4 KB)
- `diff` (Edit/Write/MultiEdit/NotebookEdit; +/- counts; unified hunks)
- `tool` (cualquier otra herramienta; output truncado)
- `thinking` (razonamiento del agente; colapsable, default off)
- `image` (inline, base64)
- `approval` (bloque interactivo: Approve / Reject / "always allow this session")
- `plan` (checklist; solo informacional, no bloquea)
- `subagent` (status updates; solo informacional)
- `usage` (token usage)

---

## 2. Paquetes Flutter recomendados

Todos los paquetes listados son compatibles con Android e iOS. Se priorizan los de mayor mantenimiento activo, mayor numero de stars y mejor score en pub.dev.

### 2.1 Estado y DI

| Paquete | Version min. | Rol | Notas |
|---|---|---|---|
| `riverpod` / `flutter_riverpod` | ^3.0.0 | State management | **Riverpod 3.x** (decisión 2026-06-05). Sin riverpod_generator — providers manuales con la API `Notifier`/`NotifierProvider`/`AsyncNotifierProvider` para control explicito del ciclo de vida. Los ejemplos de estos documentos que muestran `StateNotifierProvider` (API 2.x) se adaptan a la API 3.x. |

### 2.2 Navegacion

| Paquete | Version min. | Rol |
|---|---|---|
| `go_router` | ^14.0.0 | Navegacion declarativa, deep links, redirect guards |

### 2.3 Red y WebSocket

| Paquete | Version min. | Rol |
|---|---|---|
| `web_socket_channel` | ^3.0.0 | WebSocket client (Android + iOS, puro Dart) |
| `dio` | ^5.4.0 | HTTP client para endpoints del relay (REST) |
| `connectivity_plus` | ^6.0.0 | Deteccion de cambios de conectividad de red |

### 2.4 Almacenamiento

| Paquete | Version min. | Rol |
|---|---|---|
| `drift` | ^2.18.0 | ORM SQLite, type-safe, Android + iOS |
| `drift_flutter` | ^0.1.0 | Adapter de drift para Flutter |
| `flutter_secure_storage` | ^9.2.0 | Keychain (iOS) / EncryptedSharedPreferences (Android) |
| `shared_preferences` | ^2.3.0 | Preferencias no-sensibles (flags, configuracion UI) |
| `path_provider` | ^2.1.0 | Directorios de app en disco |

### 2.5 Criptografia

| Paquete | Version min. | Rol |
|---|---|---|
| `pointycastle` | ^3.9.0 | AES-256-GCM, HKDF, SHA-256 — puro Dart |
| `cryptography` | ^2.7.0 | X25519, Ed25519, HKDF — con fallback nativo |
| `cryptography_flutter` | ^2.3.0 | Aceleracion nativa de cryptography en iOS y Android |

La combinacion `cryptography` + `cryptography_flutter` usa:
- iOS: CryptoKit (Swift) para X25519 y Ed25519
- Android: Android Keystore / JCE

### 2.6 UI y componentes visuales

| Paquete | Version min. | Rol |
|---|---|---|
| `flutter_markdown` | ^0.7.3 | Rendering de Markdown con syntax highlighting |
| `flutter_highlight` | ^0.7.0 | Syntax highlighting para bloques de codigo |
| `flutter_inappwebview` | ^6.0.0 | WebView para Mermaid diagrams |
| `cached_network_image` | ^3.3.0 | Cache de imagenes |
| `shimmer` | ^3.0.0 | Esqueletos de carga |
| `lottie` | ^3.1.0 | Animaciones Lottie (onboarding, estados) |

### 2.7 Camara y QR

| Paquete | Version min. | Rol |
|---|---|---|
| `mobile_scanner` | ^5.1.0 | QR scanner — Android: CameraX/MLKit; iOS: AVFoundation/Apple Vision |

### 2.8 Permisos y plataforma

| Paquete | Version min. | Rol |
|---|---|---|
| `permission_handler` | ^11.3.0 | Permisos unificados (camara, notificaciones, microfono) |
| `image_picker` | ^1.1.0 | Seleccion de imagen de galeria/camara |
| `file_picker` | ^8.0.0 | Seleccion de archivos genericos |

### 2.9 Notificaciones

| Paquete | Version min. | Rol |
|---|---|---|
| `firebase_core` | ^3.6.0 | Core de Firebase |
| `firebase_messaging` | ^15.1.0 | FCM (Android) + APNs via FCM (iOS) |
| `flutter_local_notifications` | ^17.2.0 | Notificaciones locales, badges, foreground notifications |

### 2.10 SSH Terminal

| Paquete | Version min. | Rol |
|---|---|---|
| `dartssh2` | ^2.9.0 | Cliente SSH puro Dart, Android + iOS |
| `xterm` | ^4.2.0 | Emulador de terminal para la UI del SSH |

### 2.11 Utilidades

| Paquete | Version min. | Rol |
|---|---|---|
| `uuid` | ^4.4.0 | Generacion de UUIDs |
| `equatable` | ^2.0.5 | Comparacion estructural de objetos de dominio |
| `freezed` | ^2.5.0 | Clases inmutables con code generation |
| `freezed_annotation` | ^2.4.0 | Anotaciones de freezed |
| `json_annotation` | ^4.9.0 | Serializacion JSON |
| `json_serializable` | ^6.8.0 | Generador de codigo JSON |
| `intl` | ^0.19.0 | Internacionalizacion y formateo de fechas |
| `collection` | ^1.18.0 | Colecciones utiles (DeepCollectionEquality, etc.) |
| `async` | ^2.11.0 | StreamController, StreamSink helpers |
| `rxdart` | ^0.28.0 | Streams reactivos (debounce, distinctUnique) |
| `vibration` | ^2.0.0 | Haptic feedback en Android e iOS |
| `logger` | ^2.4.0 | Logging estructurado |

### 2.12 Puentes nativos necesarios (plugins personalizados)

| Plugin | Plataforma | Motivo |
|---|---|---|
| `uxnan_local_network` | iOS | Trigger del popup de permiso de red local (NSLocalNetworkUsageDescription) — API privada de iOS que requiere un socket probe |
| `uxnan_local_network` | Android | No necesario: Android no requiere permiso explicito para LAN WebSocket |
| `uxnan_secure_handshake` | iOS | Si se requiere usar Security framework directamente para Ed25519 sin overhead |
| `uxnan_secure_handshake` | Android | Si se requiere usar Android Keystore directamente |

---

## 3. Requisitos no funcionales

### 3.1 Rendimiento

| Requisito | Valor objetivo |
|---|---|
| Tiempo de arranque de la app (cold start) | < 2 segundos |
| Tiempo de establecimiento de conexion E2EE (LAN) | < 500 ms |
| Tiempo de establecimiento de conexion E2EE (relay WAN) | < 2 segundos |
| Latencia de mensaje en conversacion (LAN) | < 50 ms |
| Latencia de mensaje en conversacion (relay WAN) | < 200 ms |
| Renderizado de timeline con 100 mensajes | < 16 ms por frame |
| Tiempo de render inicial de markdown (500 chars) | < 8 ms |
| Tamano maximo de mensaje WebSocket | 1 MB |

### 3.2 Seguridad

| Requisito | Especificacion |
|---|---|
| Cifrado de transporte | AES-256-GCM con clave derivada via X25519 + HKDF-SHA256 |
| Autenticacion | Ed25519 bilateral en el handshake |
| Almacenamiento de claves | Keychain en iOS, EncryptedSharedPreferences + Keystore en Android |
| Expiracion de QR | 5 minutos (`MAX_PAIRING_AGE_MS`) |
| Tolerancia de clock skew | 60 segundos (90 para trusted reconnect) |
| Tamano maximo del buffer de outbound | 500 mensajes / 10 MB |
| El relay no accede al contenido | Garantizado: solo retransmite envelopes cifrados opacos |
| Sanitizacion de tokens | El bridge nunca expone API keys o tokens al movil |

### 3.3 Disponibilidad

| Requisito | Especificacion |
|---|---|
| Reconexion automatica | Si, con backoff exponencial (1s, 2s, 4s, 8s, 16s, max 60s) |
| Reconexion sin perdida de mensajes | Si, mediante buffer de outbound + seq counter |
| Funcionamiento sin relay (LAN directa) | Si, topologia 1 |
| Funcionamiento sin conexion (offline) | Parcial: lectura de historial local cacheado; sin envio |
| Persistencia local del historial | Si, en SQLite via drift |

### 3.4 Compatibilidad

| Requisito | Especificacion |
|---|---|
| Android minimo | API 24 (Android 7.0) |
| iOS minimo | iOS 15.0 |
| Arquitecturas Android | arm64-v8a, armeabi-v7a, x86_64 |
| Arquitecturas iOS | arm64 (device), x86_64 (simulator) |
| Flutter minimo | 3.22.0 (Dart 3.4+) |

### 3.5 Internacionalizacion

- La app debe soportar como minimo Espanol e Ingles en el lanzamiento inicial.
- Usar `flutter_localizations` + `intl` con archivos `.arb`.
- Todas las cadenas visibles deben estar externalizadas.

### 3.6 Accesibilidad

- Cumplimiento de WCAG 2.1 nivel AA.
- Etiquetas semanticas en todos los widgets interactivos.
- Soporte de tamanos de texto del sistema (Dynamic Type en iOS, Font Scale en Android).
- Contraste de colores minimo 4.5:1 en texto normal.

### 3.7 Privacidad

- Ningun dato del usuario (codigo, conversaciones, proyectos) pasa por servidores de Uxnan.
- El relay solo ve sessionId, tamano de mensaje, timestamps y tokens push cifrados.
- Declaracion de privacidad en la app explica el flujo de datos.
- No hay analytics, telemetria ni tracking de comportamiento por defecto.

---

## 4. Requisitos funcionales detallados por modulo

### 4.1 RF-CONN: Conexion y sesion

| ID | Requisito |
|---|---|
| RF-CONN-01 | La app debe mantener como maximo una conexion activa al mismo tiempo |
| RF-CONN-02 | La app debe seleccionar automaticamente el canal (LAN vs relay) |
| RF-CONN-03 | La app debe ejecutar el handshake E2EE antes de enviar cualquier payload JSON-RPC |
| RF-CONN-04 | La app debe reconectarse automaticamente con backoff exponencial al perder conexion |
| RF-CONN-05 | La app debe recuperar mensajes perdidos durante reconexion mediante el buffer de outbound del bridge |
| RF-CONN-06 | El usuario debe poder ver el estado de conexion en tiempo real (indicador en AppBar) |
| RF-CONN-07 | El usuario debe poder forzar una reconexion manual |
| RF-CONN-08 | La app debe detectar cuando el bridge tiene una version incompatible y mostrar prompt de actualizacion |
| RF-CONN-09 | Las requests pendientes deben tener timeout de 30 segundos y retornar error tipado |
| RF-CONN-10 | La desconexion debe retornar todas las continuations pendientes con error |

### 4.2 RF-PAIR: Pairing y dispositivos

| ID | Requisito |
|---|---|
| RF-PAIR-01 | La app debe soportar pairing por QR code con validacion de payload |
| RF-PAIR-02 | La app debe soportar pairing por codigo manual corto (6-8 caracteres) |
| RF-PAIR-03 | El QR tiene un TTL de 5 minutos y debe ser rechazado si esta expirado |
| RF-PAIR-04 | El usuario puede registrar multiples Macs de confianza |
| RF-PAIR-05 | El usuario puede cambiar entre Macs de confianza desde la pantalla de dispositivos |
| RF-PAIR-06 | El usuario puede eliminar un dispositivo de confianza |
| RF-PAIR-07 | La trusted reconnect no requiere reescanear el QR |
| RF-PAIR-08 | La identidad del telefono (Ed25519) debe generarse una sola vez y persistirse de forma segura |

### 4.3 RF-THREAD: Threads y conversacion

| ID | Requisito |
|---|---|
| RF-THREAD-01 | El usuario puede ver la lista de todos los threads, agrupados por proyecto |
| RF-THREAD-02 | El usuario puede buscar threads por nombre o contenido |
| RF-THREAD-03 | El usuario puede iniciar un nuevo thread en cualquier proyecto configurado |
| RF-THREAD-04 | El usuario puede continuar un thread existente |
| RF-THREAD-05 | El usuario puede hacer fork de un thread en un nuevo branch/worktree |
| RF-THREAD-06 | El historial de mensajes se pagina (20 turnos por pagina, carga al scrollear arriba) |
| RF-THREAD-07 | El estado de streaming se refleja en tiempo real en la timeline |
| RF-THREAD-08 | Los mensajes en streaming se muestran de forma incremental (delta rendering) |
| RF-THREAD-09 | Los mensajes duplicados (replay del bridge) deben ser deduplicados silenciosamente |
| RF-THREAD-10 | El estado de la conversacion persiste localmente para acceso offline |

### 4.4 RF-COMP: Composer

| ID | Requisito |
|---|---|
| RF-COMP-01 | El composer soporta texto multilinea |
| RF-COMP-02 | El composer soporta adjuntos de imagen (galeria y camara) |
| RF-COMP-03 | El composer soporta autocompletado de archivos del workspace (filtrado por nombre parcial) |
| RF-COMP-04 | El composer soporta menciones (@archivo, @proyecto) |
| RF-COMP-05 | El composer soporta slash commands (/fork, /new, /status) |
| RF-COMP-06 | El draft se persiste automaticamente por thread |
| RF-COMP-07 | Si no hay conexion, el send se encola y se ejecuta al reconectar |
| RF-COMP-08 | El usuario puede seleccionar el tier de servicio y el esfuerzo de razonamiento |

### 4.5 RF-GIT: Integracion Git

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

### 4.6 RF-WORK: Workspace

| ID | Requisito |
|---|---|
| RF-WORK-01 | El usuario puede leer archivos del workspace en la PC |
| RF-WORK-02 | El usuario puede ver imagenes generadas por el agente |
| RF-WORK-03 | El usuario puede capturar checkpoints del estado del workspace |
| RF-WORK-04 | El usuario puede ver el diff de un checkpoint |
| RF-WORK-05 | El usuario puede aplicar un checkpoint (restore) |

### 4.7 RF-NOTIF: Notificaciones

| ID | Requisito |
|---|---|
| RF-NOTIF-01 | La app recibe push notifications cuando un turno del agente se completa |
| RF-NOTIF-02 | El push navigates directamente al thread correspondiente |
| RF-NOTIF-03 | Las notificaciones duplicadas deben ser deduplicadas por el relay |
| RF-NOTIF-04 | El usuario puede activar/desactivar notificaciones por thread |
| RF-NOTIF-05 | Las notificaciones locales se muestran cuando la app esta en foreground |

### 4.8 RF-SSH: Terminal SSH

| ID | Requisito |
|---|---|
| RF-SSH-01 | El usuario puede conectarse a la PC via SSH |
| RF-SSH-02 | El usuario puede gestionar multiples perfiles SSH (host, user, port, key) |
| RF-SSH-03 | Las claves privadas SSH se almacenan en SecureStore |
| RF-SSH-04 | La terminal emula un terminal ANSI completo (VT100/xterm compatible) |
| RF-SSH-05 | La terminal soporta copy/paste de texto |

### 4.9 RF-MULTI: Multi-agente y multi-proyecto

| ID | Requisito |
|---|---|
| RF-MULTI-01 | El usuario puede configurar multiples proyectos en la misma PC |
| RF-MULTI-02 | Cada proyecto puede usar un agente diferente (Codex, OpenCode, etc.) |
| RF-MULTI-03 | El usuario puede navegar entre proyectos desde el sidebar |
| RF-MULTI-04 | Cada proyecto tiene su propio cwd y configuracion de agente |
| RF-MULTI-05 | El bridge puede ejecutar multiples agentes en paralelo |

---

## 5. Seguridad y criptografia

### 5.1 Primitivas criptograficas

| Primitiva | Uso | Implementacion |
|---|---|---|
| **Ed25519** | Identidad persistente del bridge y del telefono; firma del transcript | `cryptography` + `cryptography_flutter` (nativo iOS/Android) |
| **X25519** | Intercambio de claves efimero para derivacion de sesion | `cryptography` + `cryptography_flutter` |
| **HKDF-SHA256** | Derivacion de clave simetrica desde shared secret X25519 | `cryptography` |
| **AES-256-GCM** | Cifrado autenticado de todos los envelopes | `pointycastle` / `cryptography` |
| **SHA-256** | Fingerprinting de mensajes para deduplicacion | `crypto` (dart:crypto) |

### 5.2 Almacenamiento de material criptografico

| Material | Donde se almacena |
|---|---|
| `phoneIdentityPrivateKey` | `flutter_secure_storage` (Keychain/Keystore) — nunca en SQLite |
| `phoneIdentityPublicKey` | `flutter_secure_storage` |
| `phoneDeviceId` | `flutter_secure_storage` |
| `derivedKey` (sesion actual) | Solo en memoria (`SecureSession`), se deriva en cada handshake |
| `macIdentityPublicKey` (por device) | SQLite cifrado (drift) + `flutter_secure_storage` como backup |
| `notificationSecret` | `flutter_secure_storage` |
| Claves privadas SSH | `flutter_secure_storage` |

### 5.3 Threat model

| Amenaza | Mitigacion |
|---|---|
| Relay malicioso intercepta mensajes | Los envelopes son E2EE opacos — relay nunca ve plaintext |
| QR escaneado por tercero | TTL de 5 minutos; el QR solo es valido una vez (first-connect wins) |
| MITM en handshake | Firma Ed25519 bilateral; el transcript incluye claves efimeras de ambas partes |
| Replay de mensajes | `seq` monotonico por lado; mensajes con seq <= lastApplied son rechazados |
| Token push exfiltrado | `notificationSecret` validado en cada push; el relay no asocia token con contenido |
| App comprometida extrae claves | Las claves estan en Keychain/Keystore — no accesibles por codigo fuera de la app |
| Clock manipulation | Tolerancia explicita de 60/90 segundos; expiracion de QR en Unix ms |

---

## 6. Gestion de estado y persistencia

### 6.1 Niveles de persistencia

```
Nivel 1: Memoria (duracion: sesion de la app)
├── SecureSession (clave derivada, seq counters)
├── TurnTimelineSnapshot (estado actual de la timeline)
├── ComposerState (draft en edicion)
└── ConnectionPhase, RecoveryState

Nivel 2: flutter_secure_storage (Keychain / Keystore — durabilidad maxima)
├── PhoneIdentityPrivateKey
├── PhoneIdentityPublicKey
├── PhoneDeviceId
├── NotificationSecret
├── TrustedDevice.macIdentityPublicKey (por device)
└── SshPrivateKeys

Nivel 3: SQLite / drift (durabilidad estandar, restaurable)
├── threads
├── messages (historial cacheado)
├── turns (historial cacheado)
├── projects
├── trusted_devices (metadata no-criptografica)
└── composer_drafts

Nivel 4: shared_preferences (preferencias de usuario)
├── onboardingCompleted: bool
├── selectedTheme: String
├── notificationPreferences: JSON
└── lastConnectedMacId: String
```

### 6.2 Estrategia de cache de mensajes

```dart
// MessageRepository mantiene una cache por thread:
// - Cuando el usuario abre un thread, carga los ultimos 50 mensajes de SQLite
// - Al scrollear hacia arriba, carga lotes de 20 en direccion al pasado
// - Los mensajes entrantes en streaming se anaden en memoria y se persisten al completar el turno
// - Al cerrar la app, el estado de la timeline se descarta de memoria
// - Al reabrirla, se recarga desde SQLite

class MessageCachePolicy {
  static const initialLoad = 50;    // mensajes al abrir thread
  static const paginationSize = 20; // mensajes por pagina de historial
  static const maxInMemory = 200;   // maximo en memoria antes de purgar extremo viejo
}
```

### 6.3 Offline support

```
Escenario: usuario abre la app sin conexion
├── SQLite tiene historial previo -> se muestra correctamente
├── ConnectionPhase -> disconnected
├── SyncManager.scheduleBackgroundSync() en loop con backoff
├── ComposerWidget: boton de envio muestra "Se enviara al conectar"
├── Al reconectar -> flush de mensajes encolados + sync del historial
└── Timeline se actualiza con mensajes nuevos desde el bridge
```
