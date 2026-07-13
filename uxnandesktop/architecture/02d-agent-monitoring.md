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
- **Reporters listos para usar (multi-shell):** El ADE embebe sus scripts
  (`src-tauri/src/agent_hooks.rs` + `static/hooks/`) y los escribe a
  `<app-data>/hooks/` en cada arranque, idempotente. Cada agente usa el reporter
  que mejor evita el problema de "¿qué shell ejecuta el hook?" (el runner de
  hooks del propio agente lo ejecuta, así que debe funcionar sea cual sea la
  shell del usuario: cmd, PowerShell, PowerShell 7, Git Bash, WSL, bash, zsh,
  fish):
  - **Claude Code** y **Gemini CLI** — un relay Node sin dependencias
    (`uxnan-status-relay.cjs`). Ambos *son* programas Node, así que `node` está
    garantizado; Claude lo invoca en **exec form** (`command:"node", args:[…]`,
    sin shell) y Gemini como `node "<relay>"`. Se mergea **por evento** en
    `~/.claude/settings.json` / `~/.gemini/settings.json` preservando los hooks
    del usuario. El servidor normaliza el evento y, para el `done` de Claude, lee
    el transcript server-side para el preview.
  - **Codex** — un hook `curl` (`uxnan-codex-hook.{sh,cmd}`; Codex es un binario
    Rust sin garantía de Node) en `~/.codex/hooks.json`, **más un `trusted_hash`
    reproducido** en `~/.codex/config.toml` (`codex_trust.rs`): Codex 0.129+
    exige ese hash o el hook nunca dispara.
  - **OpenCode** — un plugin in-process depositado en su directorio `plugins/`
    (`~/.config/opencode/plugins/uxnan-status.js`); OpenCode lo auto-descubre, así
    que **no** se toca `opencode.json` (no tiene key `plugins` en su schema).
  - **Pi / OMP** — una extensión in-process en `~/.pi/agent/extensions/`.
  - **Wrapper genérico** (`uxnan-hook-wrapper.{sh,ps1,cmd,fish}`) — para
    cualquier CLI sin superficie de hooks: postea `working` antes de correr y
    `done` al salir (con `interrupted` si el código es != 0).
  Los reporters de shell **no construyen JSON**: el `agentId`/`agentType`/`status`
  viajan en headers HTTP (`X-Uxnan-Agent-Id` / `-Type` / `-Status`) y el evento
  crudo va en el body — eliminando una clase de bugs de escaping entre shells.
  **Endpoint file:** el servidor escribe `endpoint.env`/`endpoint.cmd` (url+token
  vivos) al arrancar e inyecta `UXNAN_ENDPOINT_FILE`; cada reporter lo prefiere,
  así una terminal que sobrevive a un reinicio del ADE alcanza al servidor vivo.
  **Settings → Agents → Hooks** expone un botón **Install** por agente (mergea de
  forma idempotente, marcando lo gestionado por el nombre del script/relay);
  Uninstall es su reverso. Así los estados precisos funcionan out-of-the-box.

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
- **Barra de tabs** del area central: como indicador en el tab del terminal donde corre el agente.

### Agent view (sidebar izquierda)

Dentro de cada worktree, la lista de agentes (`AgentSpace.svelte`) es una **"agent
view"**: cada agente es una **fila de dos lineas** — punto de estado
(`AgentStatusDot`) + logo (`AgentLogo`) + **titulo de conversacion** + tiempo
relativo en la 1a linea, y un **preview** atenuado en la 2a (la herramienta actual
mientras trabaja, si no la ultima respuesta, si no la etiqueta de estado). El
titulo/preview salen de datos que **ya** captura el hook server y viven en
`agentStatus` (`prompt` = prompt de usuario mas reciente, `tool`, `summary`); antes
solo alimentaban notificaciones. `resolveAgentView` (`state/agentDisplay.ts`)
compone estado + titulo + preview con fallback al nombre del agente + etiqueta de
estado cuando no hay prompt.

**Contraida**, la lista muestra una **tira compacta**: el logo de cada agente
rodeado por un anillo del color de su estado (`AgentAvatar.svelte`), + el contador;
click en un avatar revela ese agente.

**Zero** no reporta por hook ni fija el titulo OSC: su titulo de conversacion vive
en su sesion en disco (`~/.local/share/zero/sessions/<id>/metadata.json`). El
backend `zero_session(cwd)` (`src-tauri/src/zero.rs`) lee la sesion raiz mas
reciente que coincide con el cwd del worktree y deriva un estado coarse de su
`lastEventType`; el frontend (`state/zeroSessions.svelte.ts`) lo consulta por
polling mientras haya un agente Zero abierto. La barra de tabs usa el mismo `AgentStatusDot` que la sidebar (resolucion reactiva `hook` › `title` › `activity`), de modo que un agente con hook server reportando estados muestra el estado preciso (`working` / `blocked` / `waiting` / `done`) y un agente sin hook configurado cae al fallback (output-activity o title-inference) con dot gris/idle cuando no hay movimiento.

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
- El matching (`procscan.rs`) puntua por **especificidad** (exacto ▸ variante `cmd-`/`cmd_` ▸ substring; el comando mas largo gana) y recorre el arbol de procesos **en anchura**, quedandose con la coincidencia del proceso **mas cercano al shell**. Asi un agente "envoltorio" (p. ej. `openclaude`, que contiene `claude`) no se confunde con el que envuelve, de forma determinista. Ademas, un tab **lanzado** por el ADE ya conoce su identidad y la deteccion **no la sobrescribe** (solo nombra agentes iniciados a mano).
- Esta capa no determina el estado especifico del agente, pero confirma que un agente esta activo en un PTY determinado y habilita el monitoreo por las capas superiores.
- Es la capa mas basica: solo detecta presencia, no estado detallado.

### 1.5 Staleness y Limpieza

Para evitar que estados obsoletos contaminen la interfaz:

- **Marca de stale:** Si un agente no reporta estado en **30 minutos**, su estado se marca como "stale".
- **Visualizacion diferenciada:** Los estados stale se muestran con **opacidad reducida** en la UI, tanto en la sidebar como en la barra de tabs. Esto indica al usuario que la informacion puede no estar actualizada.
- **Limpieza automatica:** Al cabo de **7 dias sin actividad**, el registro del agente se elimina del cache persistente en disco. Esto evita acumulacion indefinida de datos de agentes antiguos.

---

### 1.6 Capa MCP: Navegador Controlable por Agentes

El mismo servidor HTTP local (Capa 1) expone tambien un endpoint **`/mcp`**: un servidor **Model Context Protocol** (transporte Streamable HTTP) que hace **descubrible** el navegador integrado (`architecture/02a` §4.2b) para los agentes CLI. En lugar de que el agente tenga que *conocer* la convencion `$BROWSER`/`curl` al hook `/browser`, las herramientas del navegador aparecen en su lista de tools como cualquier capacidad nativa, y las usa sin leer documentacion.

**Superficie de herramientas (solo control):** `browser_open`, `browser_navigate`, `browser_reload`, `browser_back`, `browser_forward`, `browser_status`. Reusan los mismos caminos del navegador (`browser::route_url` + comandos de ventana) y respetan la misma politica de enlaces que un enlace clicado. La inspeccion/interaccion de pagina (snapshot/evaluate/click/type) queda como fase posterior (requiere un canal de retorno JS desde la `WebviewWindow`).

**Autenticacion y aislamiento:** el endpoint acepta el **mismo token por lanzamiento** que el hook server (`Authorization: Bearer <token>`, o el header legado `x-uxnan-token`). Los agentes reciben la configuracion MCP de su propio CLI apuntando a `/mcp`, pero el **token nunca se escribe en un archivo**: cada config lo referencia por la variable de entorno `UXNAN_MCP_TOKEN`, que el ADE inyecta en el PTY del agente. Consecuencia de diseno: la config inyectada **solo funciona dentro de una terminal lanzada por uxnan** — un agente ejecutado en otro entorno lee el mismo archivo pero no tiene la variable, no autentica y el servidor simplemente no carga para el (no puede secuestrar el navegador in-app).

**Inyeccion por agente (`mcpinject.rs`):** el ADE escribe la config MCP nativa de cada CLI soportado (Claude Code, Codex, Gemini, OpenCode) en su ubicacion estandar, segun el modo elegido en Settings → Browser:

- **`workspace`** (default): archivo con alcance de proyecto en el directorio de trabajo de la terminal (`.mcp.json`, `.codex/config.toml`, `.gemini/settings.json`, `opencode.json`); cubre agentes lanzados por el ADE y tecleados a mano ahi. Los archivos que el ADE crea se ocultan de Git (`info/exclude`, con soporte de worktrees via `git2`) y se eliminan al salir.
- **`global`**: config global del usuario de cada CLI (aplica en todos los proyectos; mayor huella).
- **`off`**: no inyecta nada (el endpoint `/mcp` sigue disponible para cableado manual desde el snippet copiable de Settings).

El merge preserva el resto de la configuracion del usuario (JSON via `serde_json`, TOML de Codex via `toml_edit`). El registro es extensible: agregar un agente nuevo (p. ej. `agy`/Antigravity, Cursor, Grok, amp, Pi) es una fila en `AGENTS` + un brazo en `config_path`/`write_entry` (receta en `docs/browser.md`).

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

La orquestacion tiene **dos superficies** en una sola consola
(`OrchestrationConsole.svelte`, abierta desde la barra de estado cuando hay **≥2
agentes** corriendo **o** cuando existe alguna corrida):

- **Difusion** (pestaña *Broadcast*): el router de entrada por fan-out.
- **Motor de corridas** (pestaña *Runs*): un scheduler determinista sobre un grafo
  (DAG) de pasos, con paso de contexto, dependencias, compuertas humanas y
  persistencia durable.

> **Estado: IMPLEMENTADO** (difusion + motor de corridas). La difusion mantiene la
> logica pura de routing/cola en `src/lib/orchestration.ts` (tests unitarios) + el
> store reactivo `src/lib/state/orchestration.svelte.ts`. El motor de corridas vive
> en `src/lib/orchestration/run.ts` (**puro, unit-testeado**: prontitud del DAG,
> plantillas de contexto, deteccion de ciclos, validacion, derivacion de estado) +
> el store reactivo `src/lib/state/orchestrationRun.svelte.ts` (agentes vivos,
> despacho, timers, persistencia). Backend: `set_orchestration_runs` (persistencia
> opaca, patron `terminal_layout`), `agent_run_headless` (modo print con exit code
> verificado, reusa `agentcli`) y tools MCP de orquestacion en `mcp.rs`.

### 3.1 Modelo: corrida (`Run`) = grafo de pasos (`Step`)

- Una **corrida** es un DAG de **pasos**. Cada paso apunta a un agente, tiene un
  prompt (con plantilla de contexto), declara `dependsOn`, y lleva su propio estado
  + salida capturada. Ids de paso cortos y estables (`s1`, `s2`, …).
- **Tipos de paso** (`kind`): `interactive` (escribe en el PTY de un agente vivo),
  `headless` (corre un CLI instalado en modo print), `gate` (compuerta HITL).
- El motor es un **scheduler determinista** (tick ~700 ms + eventos): promueve
  `pending`→`ready` cuando todas las dependencias estan `completed` (o `skipped` si
  una fallo/omitio), despacha `ready` hasta un tope de concurrencia (4), detecta
  completado, y deriva el estado de la corrida. **La logica de control vive en el
  frontend** porque necesita el estado vivo de agentes; el backend aporta primitivos.
- **Plantillas de ejemplo**: el UI ofrece corridas listas (secuencial, paralelo/
  fan-in, gate) con pasos **headless** preconfigurados a un agente instalado, para
  arrancar sin construir desde cero (`orchestration/examples.ts`, builder puro).

### 3.2 Paso de contexto (pizarra A→B→C)

- Cada paso completado guarda `output` (+ `summary`) en la corrida. El prompt de un
  paso resuelve `{{steps.<id>.output|summary|title}}` contra pasos previos
  (`resolveTemplate`). Referenciar un paso lo agrega como dependencia automatica.
- **Interactivo** → output = el `summary` del hook (delgado, puede venir vacio), o el
  **resultado estructurado** que el agente reporte por MCP — posible solo en los
  agentes inyectables (claude/codex/gemini/opencode). **Headless** → output = **stdout
  completo** (robusto, verificado). Por eso un paso nuevo **defaultea a headless** para
  encadenar. En el editor, un **selector de contexto** lista los pasos previos y sus
  campos (con vista previa del valor capturado) e inserta el token en el cursor.

### 3.3 Dependencias, paralelo y fan-in

- `dependsOn` + promocion-al-completar = paralelo + fan-in ("A y B en paralelo → C
  cuando ambos terminen"). Pasos sin dependencia se despachan a la vez (hasta el
  tope). El aislamiento por worktree es nativo: un paso headless corre con
  `current_dir=worktree`; uno interactivo apunta a un agente en su worktree.

### 3.4 Completado verificado (difusion vs headless)

- **Difusion / interactivo:** disponibilidad y completado por el **estado preciso
  del hook** (`working`/`blocked` = ocupado; `done`/idle = libre) con fallback a la
  inferencia gruesa de actividad (`tab.working`) + una ventana de gracia. La entrega
  es escribir en el PTY y enviar Enter, con **backpressure** (cola FIFO por agente,
  no se entrega el siguiente hasta que el agente reporte libre).
- **Headless:** el ADE **posee el proceso**, asi que el completado se **verifica por
  exit code** (`0` = hecho; ≠0 = fallo, con stderr). Esta es la ventaja sobre el
  estado del arte: verificacion en vez de confianza en un reporte cooperativo.

### 3.5 Compuertas humanas (HITL) + auto-reparacion

- Un paso `gate` **pausa** la corrida y espera tu decision en la consola (con
  notificacion nativa): **Aprobar** (su nota alimenta pasos posteriores) o
  **Rechazar** (los dependientes se omiten). Las ramas independientes siguen.
- **Auto-reparacion:** `onFailure` = `stop` (default) o `retry` (reintenta hasta
  `maxAttempts`; un interactivo puede re-vincularse a otro agente del mismo tipo, un
  headless re-lanza el proceso). Remediacion (`remediate:<stepId>`) y paso `eval`
  (evaluador-optimizador) quedan como follow-up (`FOR-DEV.md`).

### 3.6 Persistencia durable + re-enganche

- El grafo, estados y **salidas** se persisten como JSON opaco
  (`set_orchestration_runs`) → la corrida sobrevive a un reinicio. Al cargar, el
  motor **se re-engancha**: conserva las salidas `completed` (la cadena de contexto
  sobrevive) y devuelve a `ready` cualquier paso que quedo en vuelo (su PTY se
  perdio). La corrida avanza **mientras la app esta abierta**; un motor de fondo
  (Tokio) es endurecimiento futuro.

### 3.7 Canal cooperativo agente→ADE (tools MCP de orquestacion)

- El ADE inyecta a cada agente lanzado (junto a las tools del navegador, §1.6) las
  tools MCP `orchestration_report_result` / `orchestration_report_progress`. El
  agente pasa su `UXNAN_AGENT_ID`; el handler en `mcp.rs` emite un evento
  `agent:orchestration` que el motor frontend atribuye al paso interactivo en curso
  (backend tonto; el modelo de corrida vive 100% en TS). Esto da **salida
  estructurada** de agentes interactivos, mejor que el `summary` grueso. Para que el
  caso comun funcione sin que el usuario conozca la tool, el motor **anexa un
  recordatorio corto al prompt** de un paso interactivo — pero **solo** cuando ese
  paso alimenta a otro *y* el agente realmente tiene la tool (inyeccion MCP activa y
  es uno de los agentes inyectados: claude/codex/gemini/opencode). Para cualquier
  otro agente no se menciona MCP, asi que ningun CLI recibe la instruccion de usar
  una tool que no tiene.

### 3.8 Difusion (fan-out) — el router de entrada

- Se elige **explicitamente** a los destinatarios: cada agente en ejecucion es una
  **casilla** (agrupadas por tipo, con una casilla "todos" por tipo) mas atajos
  **Todos / Ninguno**. Fan-out = una copia por agente seleccionado, entregada bajo
  backpressure. (No hay coordinador/workers: se retiro la corona para eliminar la
  ambiguedad de que "todos" incluyera a un agente designado.) Es la superficie
  original ("difusion"), ahora una pestaña distinta del motor de corridas.
- **Entrega robusta:** los prompts se teclean como **pegado** y se envian con un
  Enter **aparte** (`pty_paste_submit`), asi no queda texto a medias en el composer
  del agente ni se concatenan envios, y lo multilinea no se envia en el primer salto.
  Un agente que se lee **ocupado** indefinidamente (sin hooks / lector clavado) no
  atasca la cola: tras un tope de espera se **fuerza la entrega** (mejor esfuerzo).

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
