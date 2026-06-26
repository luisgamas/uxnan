# 02d — Monitoreo y Orquestacion de Agentes

> **Documento:** 02d-agent-monitoring.md
> **Ambito:** Sistema de monitoreo de estado en tiempo real, notificaciones nativas del OS, orquestacion multi-agente con grafo de tareas
> **Stack relevante:** Rust (axum/hyper + Tokio), Tauri 2 (events + tauri-plugin-notification), Svelte 5 ($state)
> **Origen:** Seccion 6 (Funcionalidades Core de Orquestacion) de `architect-desktop.md`

---

## 1. Sistema de Monitoreo de Estado en Tiempo Real

El ADE necesita saber en todo momento que esta haciendo cada agente. Esto se logra con un **sistema de hooks multicapa** que combina integracion activa (agentes que reportan su estado) con deteccion pasiva (inferencia de estado por titulo de terminal y proceso en ejecucion). Las tres capas funcionan como fallbacks sucesivos: si un agente soporta hooks HTTP nativos, se usa la Capa 1; si no, el ADE recurre a la Capa 2 (titulo de terminal) y la Capa 3 (deteccion de proceso).

### 1.1 Capa 1: Servidor de Hooks HTTP Local

El ADE levanta un **servidor HTTP en localhost** que los agentes pueden usar para reportar su estado. Este servidor corre de forma asincrona dentro del backend Rust, integrado con el runtime de Tokio.

**Implementacion:**

- **Framework HTTP:** `axum` o `hyper` en Rust, corriendo async con Tokio dentro del proceso principal de Tauri.
- **Protocolo:** Los agentes envian un `POST` a un endpoint local con un payload JSON que incluye:
  - Estado actual del agente (`working`, `blocked`, `waiting`, `done`).
  - Prompt del usuario que el agente esta procesando.
  - Tipo de agente (identificador: `claude`, `codex`, `aider`, etc.).
  - Herramienta en uso (si aplica, por ejemplo: `file_edit`, `bash`, `web_search`).
  - Flag `interrupted` indicando si el agente fue interrumpido.
  - Preview corto de la última respuesta (`summary`), enviado en `done` para
    enriquecer la notificación de finalización (el hook de Claude lo extrae del
    transcript de la sesión).
- **Cache persistente:** El ultimo estado de cada agente se guarda en disco con un **TTL de 7 dias**. Esto permite que al reiniciar el ADE, la sidebar muestre el estado correcto de cada agente sin necesidad de que estos re-reporten.
- **Broadcast:** Cada cambio de estado se difunde al frontend via **Tauri events** para actualizacion inmediata de la UI. El evento `agent:status-changed` se emite con el nuevo estado normalizado.
- **Configs listas para usar:** El ADE embebe en su binario cuatro scripts
  (`src-tauri/src/agent_hooks.rs` + `static/hooks/`) y los escribe a
  `<app-data>/hooks/` en cada arranque, de forma idempotente:
  - `uxnan-claude-hook.cjs` — script CJS sin dependencias, invocable por la
    `hooks` block de Claude Code. Mapea los eventos `UserPromptSubmit`,
    `PreToolUse`, `PreCompact`, `Notification`, `PermissionRequest`, `Stop`
    y `SessionEnd` a los estados del servidor (`working` / `waiting` /
    `done` / `blocked`).
  - `uxnan-hook-wrapper.{sh,ps1,cmd}` — envoltorio generico para cualquier
    CLI: postea `working` antes del `exec` y `done` al exit (con
    `interrupted: true` si el codigo es != 0).
  **Settings → Agents → Hooks** expone el path absoluto de cada script y un
  boton **Install** que mergea la `hooks` block del ADE (marcada con
  `__uxnan_managed_hooks__`) en `~/.claude/settings.json` sin tocar el
  resto de la configuracion. Uninstall es su reverso idempotente. Asi los
  estados precisos funcionan out-of-the-box sin edicion manual de JSON.

**Diagrama de flujo del hook HTTP:**

```
[Agente CLI] --HTTP POST--> [Servidor axum (localhost)]
                                    |
                                    v
                           [Normalizar payload]
                                    |
                                    +---> [Cache en memoria (HashMap)]
                                    |         |
                                    |         v
                                    |     [Persistir a disco (Serde JSON, TTL 7d)]
                                    |
                                    +---> [emit('agent:status-changed', state)]
                                              |
                                              v
                                      [Frontend Svelte actualiza UI]
```

### 1.2 Estados de Agente

Los estados posibles de un agente son cuatro, cada uno con un significado especifico y un indicador visual diferenciado en la UI:

| Estado | Significado | Indicador Visual |
|--------|-------------|------------------|
| `working` | Procesando activamente una tarea | Punto verde animado |
| `blocked` | Esperando respuesta de otro sistema (API, servicio externo) | Punto amarillo |
| `waiting` | Esperando input del usuario | Punto naranja parpadeante |
| `done` | Tarea completada | Punto azul / check |
| `idle` (derivado) | Agente en reposo, sin reporte preciso | Punto gris |

Ademas, un reporte sin actualizacion por mas de **30 minutos** se considera
`stale` y se atenua (`opacity-40`) tanto en la sidebar como en la barra de
tabs. Un terminal plain (sin agente corriendo y sin output reciente) no
muestra ningun indicador.

Estos estados se muestran en dos lugares de la interfaz:

- **Tarjeta del worktree** en la sidebar izquierda: como badge de color junto al nombre de la rama.
- **Barra de tabs** del area central: como indicador en el tab del terminal donde corre el agente. La barra de tabs usa el mismo `AgentStatusDot` que la sidebar (resolucion reactiva `hook` › `title` › `activity`), de modo que un agente con hook server reportando estados muestra el estado preciso (`working` / `blocked` / `waiting` / `done`) y un agente sin hook configurado cae al fallback (output-activity o title-inference) con dot gris/idle cuando no hay movimiento.

**Descubrimiento de hooks.** Cuando un tab de la barra es de un agente y su
estado proviene de un fallback (no del hook server), se muestra al lado del
dot un pequeno icono de `Webhook` que abre **Settings → Hooks** al hacer
click. Asi el usuario descubre las configs listas para usar (`§1.1`) y
entiende que los estados precisos requieren una instalacion manual
(puntual) por agente. La pista solo aparece en tabs de agentes no
gobernados por hooks — los tabs plain y los agentes ya conectados no la
muestran.

### 1.3 Capa 2: Deteccion por Titulo de Terminal

Como **fallback** para agentes que no soportan hooks HTTP nativos, el ADE analiza el titulo del terminal y la salida del proceso para inferir el estado del agente.

- Muchos agentes CLI actualizan el titulo de la ventana del terminal (via secuencias de escape ANSI/OSC) para reflejar su estado actual (por ejemplo, "thinking...", "waiting for input", "done").
- El ADE intercepta estas secuencias OSC en el stream del PTY y las interpreta para mapearlas a uno de los cuatro estados definidos (`working`, `blocked`, `waiting`, `done`).
- Esto permite **monitorear agentes desconocidos** sin que estos necesiten integracion explicita con el ADE. Si un agente actualiza su titulo de terminal con patrones reconocibles, el ADE puede inferir su estado automaticamente.

### 1.4 Capa 3: Deteccion de Proceso en Ejecucion

El ADE detecta **que proceso esta corriendo en primer plano** en cada PTY:

- Si el proceso coincide con un agente conocido (por nombre del ejecutable, por ejemplo `claude`, `codex`, `aider`, `opencode`), se activa el **tracking automatico**.
- Esta capa no determina el estado especifico del agente, pero confirma que un agente esta activo en un PTY determinado y habilita el monitoreo por las capas superiores.
- Es la capa mas basica: solo detecta presencia, no estado detallado.

### 1.5 Staleness y Limpieza

Para evitar que estados obsoletos contaminen la interfaz:

- **Marca de stale:** Si un agente no reporta estado en **30 minutos**, su estado se marca como "stale".
- **Visualizacion diferenciada:** Los estados stale se muestran con **opacidad reducida** en la UI, tanto en la sidebar como en la barra de tabs. Esto indica al usuario que la informacion puede no estar actualizada.
- **Limpieza automatica:** Al cabo de **7 dias sin actividad**, el registro del agente se elimina del cache persistente en disco. Esto evita acumulacion indefinida de datos de agentes antiguos.

---

## 2. Notificaciones

El sistema de notificaciones mantiene al usuario informado del progreso de los agentes, incluso cuando no esta mirando activamente la ventana del ADE.

### 2.1 Tipos de Notificacion

| Tipo | Mecanismo | Descripcion |
|------|-----------|-------------|
| **Transicion de estado del agente** | Notificacion nativa del OS via `tauri-plugin-notification` | En una transicion **precisa** del hook (`done` / `waiting` / `blocked`) el ADE avisa: con la app en background dispara una notificacion nativa del OS (la de `done` incluye la tarea y un preview de la respuesta); con la app enfocada usa un toast in-app; si el usuario ya esta mirando esa terminal no avisa. **`working` nunca notifica** (cambia en cada herramienta). La inferencia gruesa de output-activity **no** dispara notificaciones — solo el punto visual — para no avisar cuando un agente quedo en reposo sin tarea. |
| **Badge en dock/taskbar** | Contador nativo del OS | Muestra un contador de agentes con cambios no-leidos. En macOS aparece como badge numerico en el icono del dock; en Windows como overlay en el icono de la taskbar. |
| **Indicador en sidebar** | Badge rojo en la tarjeta del worktree | Un indicador visual rojo en la tarjeta del worktree correspondiente, senalando que el agente termino y el usuario aun no ha revisado los resultados. |
| **Limpieza automatica** | Evento de foco de ventana | Al enfocar la ventana del ADE, los badges se limpian automaticamente. Esto evita que el usuario tenga que limpiarlos manualmente y asegura que los indicadores siempre reflejen el estado real de atencion. |

**Flujo de notificacion al completar un agente:**

```
[Agente reporta done] --> [Backend Rust recibe estado]
        |
        +---> [tauri-plugin-notification: notificacion nativa del OS]
        +---> [Tauri event: agent:status-changed {done}]
                      |
                      v
              [Svelte actualiza sidebar]
                      |
                      +---> Badge rojo en tarjeta del worktree
                      +---> Incrementa contador de dock/taskbar
```

---

## 3. Orquestacion Multi-Agente

Para escenarios avanzados donde un **agente coordinador** gestiona multiples **agentes trabajadores** (workers), el ADE soporta orquestacion multi-agente con las siguientes capacidades.

> **Estado: IMPLEMENTADO** (consola de orquestacion). Logica pura de routing/cola
> en `src/lib/orchestration.ts` (con tests unitarios); store reactivo (agentes
> vivos, timers de backpressure, entrega al PTY) en
> `src/lib/state/orchestration.svelte.ts`; UI en `OrchestrationConsole.svelte`,
> abierta desde la barra de estado cuando hay **≥2 agentes** corriendo. Un
> "agente" orquestable es cualquier pestaña de terminal que corre un agente
> (identificada por su `agentCommand`); la entrega es escribir el mensaje en el
> PTY de la pestaña y enviar Enter.

### 3.1 Grafo de Tareas

- Se mantiene un **grafo en memoria** (no se persiste): un agente coordinador
  designado por el usuario y sus workers (el resto de los agentes vivos).
- **Aclaracion respecto del diseno original:** la creacion *automatica* de
  workers por parte del coordinador (que el coordinador genere worktrees nuevos)
  requiere un canal de control agente→ADE que aun no existe — los agentes son
  CLIs opacos. Hoy el usuario crea los worktrees/agentes y **designa** cual es el
  coordinador (un click en la consola); el ADE rastrea el estado de cada worker
  en relacion a el. La automatizacion queda como follow-up (`FOR-DEV.md`).

### 3.2 Routing de Mensajes

- Se puede enviar un mensaje a **agentes especificos por tipo** (por ejemplo,
  todos los `claude`, todos los `codex`), a **todos** los agentes, o a los
  **workers del coordinador**.
- **Fan-out:** un mensaje se distribuye a **todos los agentes de un tipo** (o a
  todos) simultaneamente, encolando una copia por agente.
- El routing se basa en el tipo de agente, normalizado desde el comando del
  agente registrado en la pestaña/terminal (`agentType()` en
  `src/lib/orchestration.ts`).

### 3.3 Backpressure

- El orquestador **no entrega el siguiente mensaje** a un agente hasta que este
  vuelva a estar libre (no `working`/`blocked`).
- Cada agente tiene una **cola FIFO**; se entrega solo la cabeza cuando el agente
  esta disponible, evitando la sobrecarga de agentes lentos.
- La disponibilidad usa el **estado preciso del hook** cuando existe
  (`working`/`blocked` = ocupado) y, como fallback para agentes sin hooks, la
  **inferencia gruesa de actividad de salida** (`tab.working`). Tras entregar, se
  espera a ver al agente reportar ocupado (ventana de gracia configurable) antes
  de considerar su siguiente mensaje, para no duplicar la entrega.

### 3.4 Linaje (Coordinador → Workers)

- La jerarquia coordinador→workers se visualiza en la **consola de orquestacion**
  (`OrchestrationConsole.svelte`): el coordinador se marca con una corona y queda
  resaltado, y el target "workers" hace fan-out a todos los demas.
- **Cambio respecto del diseno original (justificado para ALPHA):** el linaje se
  muestra en la consola en vez de anidar los worktrees hijos en la **sidebar
  izquierda**. Anidar el arbol de worktrees del proyecto es un refactor mayor de
  la sidebar y se difiere (`FOR-DEV.md`); la consola entrega el mismo valor
  funcional (ver y dirigir la jerarquia) con mucho menos riesgo.

---

## 4. Flujo Completo: Agente Reporta Estado

Paso a paso, desde que un agente emite un cambio de estado hasta que la UI refleja el cambio:

1. **El agente emite un hook HTTP** (POST al servidor local de hooks) **o una secuencia OSC** que es detectada en el stream del PTY.
2. **El backend Rust recibe el reporte**, lo normaliza al formato interno de estados, y lo cachea en memoria (HashMap) y en disco (Serde JSON con TTL de 7 dias).
3. **Se emite un Tauri event** `agent:status-changed` con el nuevo estado normalizado del agente.
4. **La sidebar izquierda (Svelte)** recibe el evento y actualiza el badge del worktree correspondiente de forma reactiva (via `$state`).
5. **Si el agente termino** (estado `done`), el backend Rust dispara una **notificacion nativa del OS** via `tauri-plugin-notification`.

```
Agente CLI
   |
   |-- (Opcion A) HTTP POST al servidor de hooks local
   |-- (Opcion B) Secuencia OSC detectada en stream PTY
   |
   v
Backend Rust
   |
   +-- Normalizar estado (working/blocked/waiting/done)
   +-- Cachear en memoria (HashMap) + disco (Serde JSON, TTL 7d)
   +-- emit('agent:status-changed', { agentId, state, ... })
   |
   +-- Si state == 'done':
   |       emit notificacion nativa (tauri-plugin-notification)
   |
   v
Frontend Svelte
   |
   +-- listen('agent:status-changed')
   +-- Actualizar $state del worktree correspondiente
   +-- Re-renderizar badge en tarjeta de sidebar
   +-- Re-renderizar indicador en barra de tabs
```

---

## 5. Flujo Completo: Agente Modifica Archivos

Paso a paso, desde que un agente escribe en el filesystem hasta que la UI refleja los cambios:

1. **El agente escribe en el filesystem** del worktree (crea, modifica o elimina archivos como parte de su trabajo).
2. **El backend Rust** (timer de Tokio ejecutandose cada 3 segundos) ejecuta `git2::Repository::statuses()` para detectar cambios en el worktree activo.
3. **Se emite un Tauri event** `git:status-changed` con la lista actualizada de archivos modificados, staged y untracked.
4. **El store reactivo de Svelte** (`$state`) se actualiza automaticamente al recibir el evento.
5. **Si el usuario esta viendo el diff**, el componente de diff se **re-renderiza reactivamente** para mostrar los cambios mas recientes.

```
Agente CLI
   |
   +-- Escribe archivos en el worktree
   |
   v
Backend Rust (timer Tokio cada 3 seg)
   |
   +-- git2::Repository::statuses()
   +-- Detecta archivos modificados/staged/untracked
   +-- emit('git:status-changed', { files, staged, untracked })
   |
   v
Frontend Svelte
   |
   +-- listen('git:status-changed')
   +-- Actualizar $state del estado git del worktree
   +-- Sidebar derecha: arbol de archivos se actualiza
   +-- Si el visor de diff esta abierto: re-renderizar reactivamente
```

---

## 6. Modulos y Conexiones

El siguiente diagrama muestra como se conectan todos los modulos involucrados en el monitoreo y la orquestacion de agentes:

```
[Servidor de Hooks (axum)] <--- [Agentes CLI via HTTP POST]
        |
        v
[Cache de Estado de Agentes] ---> [Tauri Events] ---> [Estado Svelte ($state)]
        |                                                      |
        v                                                      v
[Notificaciones OS]                                    [Sidebar: badges]
                                                       [Dashboard: rows]

[PTY Manager (portable-pty)] <---> [Shell/Agente CLI]
     |
     v
[Snapshot Manager] (para restaurar terminales al reiniciar)

[Persistencia (Serde JSON)] <--- [Backend Rust state]
     |
     +-- Backup rotativo (5 copias)
     +-- Encriptacion de secretos
     +-- Migraciones de esquema
```

### Descripcion de cada modulo

| Modulo | Capa | Responsabilidad |
|--------|------|-----------------|
| **Servidor de Hooks (axum)** | Backend Rust | Servidor HTTP local async que recibe reportes de estado de agentes via POST. Corre en localhost con Tokio. |
| **Cache de Estado de Agentes** | Backend Rust | HashMap en memoria + persistencia a disco (Serde JSON) con TTL de 7 dias. Almacena el ultimo estado conocido de cada agente. |
| **Tauri Events** | Backend Rust -> Frontend | Canal de comunicacion unidireccional para streaming. Emite eventos `agent:status-changed` y `git:status-changed`. |
| **Estado Svelte ($state)** | Frontend Svelte | Store reactivo que mantiene el estado de agentes y git por worktree. Se actualiza al recibir Tauri events. |
| **Notificaciones OS** | Backend Rust (plugin) | `tauri-plugin-notification` para notificaciones nativas del sistema operativo y badges en dock/taskbar. |
| **Sidebar: badges** | Frontend Svelte | Indicadores visuales en las tarjetas de worktree: punto de color por estado, badge rojo de no-leido. |
| **Dashboard: rows** | Frontend Svelte | Vista agregada de todos los agentes activos con sus estados (para monitoreo general). |
| **PTY Manager (portable-pty)** | Backend Rust | Gestor de pseudoterminales multiplataforma. Crea, escribe, redimensiona y cierra PTYs. Detecta procesos foreground. |
| **Snapshot Manager** | Backend Rust | Guarda y restaura buffers de terminales para persistir sesiones entre reinicios del ADE. |
| **Persistencia (Serde JSON)** | Backend Rust | Serializacion/deserializacion type-safe del estado completo. Escritura atomica (write-rename), backups rotativos (5 copias), encriptacion de secretos via `tauri-plugin-stronghold` o keyring del OS, migraciones de esquema versionadas. |

---

> **Nota:** Este documento cubre exclusivamente el monitoreo de estado de agentes, el sistema de notificaciones, y la orquestacion multi-agente. Para la arquitectura general del sistema, consultar `02a-system-architecture.md`. Para el motor de terminales y PTY, consultar `02b-terminal-engine.md`. Para git, worktrees y diffs, consultar `02c-git-worktrees.md`.
