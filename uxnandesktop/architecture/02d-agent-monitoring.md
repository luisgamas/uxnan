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
  (`src-tauri/src/agent_hooks.rs` + `static/hooks/`) y los escribe **una sola
  vez por máquina**, en `~/.uxnan/hooks/`, en cada arranque e idempotente.
  **La ruta registrada no nombra a ninguna instancia, y esa es la regla.** La
  configuración de cada agente es un fichero por máquina; mientras el ADE
  escribía ahí una ruta de su *perfil* (`<app-data>/hooks/`), la última
  instancia en arrancar se adueñaba de todos los agentes del equipo — una
  segunda ventana, una build de desarrollo, un perfil desechable de una demo —
  y borrar ese perfil dejaba a cada agente ejecutando `node <inexistente>.cjs`
  en cada turno. Lo único que es por instancia es **a qué app va el reporte**, y
  eso ya viaja en el entorno de la terminal (`UXNAN_HOOK_URL` y
  `UXNAN_ENDPOINT_FILE`, que apunta al `endpoint.*` del perfil que lanzó esa
  terminal); los reporters prefieren el entorno, así que dos instancias
  conviven. Efecto colateral buscado: el `trusted_hash` de Codex —que cubre el
  comando, ruta incluida— deja de cambiar, y con él la petición de volver a
  confiar en los hooks. Dos builds pueden traer scripts distintos, así que el
  directorio guarda la versión que lo escribió (`.uxnan-hooks-version`) y **una
  build más vieja nunca pisa las copias de una más nueva**: lee lo que hay y
  registra esas rutas. Los reporters que una build anterior dejó dentro de un
  perfil se borran al arrancar (el `endpoint.*` no es un reporter y se queda). Cada agente usa el reporter
  que mejor evita el problema de "¿qué shell ejecuta el hook?" (el runner de
  hooks del propio agente lo ejecuta, así que debe funcionar sea cual sea la
  shell del usuario: cmd, PowerShell, PowerShell 7, Git Bash, WSL, bash, zsh,
  fish):
  - **Claude Code** — un relay Node sin dependencias
    (`uxnan-status-relay.cjs`). Claude es un programa Node, así que `node` está
    garantizado; lo invoca en **exec form** (`command:"node", args:[…]`, sin
    shell). Se mergea **por evento** en `~/.claude/settings.json` preservando los
    hooks del usuario. El servidor normaliza el evento y, para `done`, lee el
    transcript server-side para el preview.
  - **Codex** — un hook `curl` (`uxnan-codex-hook.{sh,cmd}`; Codex es un binario
    Rust sin garantía de Node) en `~/.codex/hooks.json`, **más un `trusted_hash`
    reproducido** en `~/.codex/config.toml` (`codex_trust.rs`): Codex 0.129+
    exige ese hash o el hook nunca dispara.
  - **Grok** y **Antigravity** — un reporter `curl` compartido
    (`uxnan-event-hook.{sh,cmd}`) que recibe el **tipo de agente como argumento**;
    ambos son binarios nativos (Rust y Go) sin garantía de Node, y los bytes del
    hook de Codex están congelados por su `trusted_hash`, así que no podía
    parametrizarse ese. Grok recibe un **archivo propio**
    (`~/.grok/hooks/uxnan-status.json`: Grok mergea todos los `*.json` de esa
    carpeta, siempre confiada, así que no se lee ni reescribe nada del usuario) y
    habla el vocabulario de eventos de Claude Code, incluido un `StopFailure` que
    da un `blocked` **real**. Antigravity recibe **una entrada con nombre**
    (`uxnan-status`) en `~/.gemini/config/hooks.json`; solo expone su bucle de
    ejecución (`PreInvocation`, `PostInvocation`, `PostToolUse`, `Stop`) — sin
    evento de prompt, permiso ni notificación — así que **nunca puede reportar
    `waiting`**. `PreToolUse` queda fuera a propósito: en el contrato de
    Antigravity es una compuerta de permisos cuya respuesta debe llevar una
    `decision` (sin valor neutro), y `agy` lee el `{}` del reporter como
    denegación de la tool. Ambos CLIs interpretan el comando del hook como
    una ruta literal **sin quoting**, lo que rompería con un nombre de usuario con
    espacio: Antigravity se resuelve copiando el reporter junto a su config e
    invocándolo **relativo** (`.\uxnan-event-hook.cmd antigravity`, su doc fija el
    cwd del hook a esa carpeta), y Grok con la **ruta corta 8.3** de Windows,
    degradando a "no disponible" si el SO no la genera.
  - **OpenCode** — un plugin in-process depositado en su directorio `plugins/`
    (`~/.config/opencode/plugins/uxnan-status.js`); OpenCode lo auto-descubre, así
    que **no** se toca `opencode.json` (no tiene key `plugins` en su schema). Un
    solo archivo habla las **dos APIs de plugin**: su `export default { id, setup,
    server }` lleva el `setup` de OpenCode 2 (cuyo contexto transmite los eventos
    `session.execution.*`, `form.*`, `permission.*`) y la fábrica V1 como `server`
    (el bus `session.status` / `session.idle` / `message.part.updated`). Medido:
    OpenCode 1.17.20 / 1.18.25 / 1.18.32 llaman `server` (y `setup` sin flujo de
    eventos, que no hace nada), OpenCode 2.0.16 llama solo `setup`. OpenCode 2 corre
    los plugins en un **servidor**, no en el TUI: uxnan lo lanza `--standalone`
    (servidor privado, hijo del TUI de la pestaña, con su entorno — ver §1.6) y el
    plugin **calla dentro del servicio compartido** (`opencode serve --service`),
    cuyo entorno es el de otra pestaña.
  - **Pi / OMP** — una extensión in-process en `~/.pi/agent/extensions/`.
  - **Plugins in-process de terceros** — **MiMo Code** y **Kilo Code** ejecutan el
    plugin de OpenCode tal cual (MiMo es un fork suyo; Kilo reimplementó el mismo
    bus de eventos): el instalador reescribe solo el tipo de agente que declara —
    el descriptor por defecto del archivo lo cargan tal cual Kilo 7.7.9 y MiMo
    0.1.15 (ambos llaman `server`) — y tres copias casi idénticas de un reporter
    ya validado serían tres sitios donde corregir el siguiente bug. **Amp** tiene API propia (`amp.on(...)`, con un
    `agent.end` que distingue turno terminado de turno muerto), así que lleva su
    propio archivo; su `tool.call` **decide** si la herramienta corre, y el
    reporter responde `allow` — observar no puede ser la razón de que algo no se
    ejecute (la misma regla que hace que el reporter de shell conteste `{}`).
    Ninguno toca configuración del usuario: los tres CLIs auto-descubren su
    directorio de plugins, y una instalación jamás sobrescribe un archivo sin
    nuestro marcador.
  - **Agentes declarativos** — el resto de CLIs cableados (OpenClaude, Qwen Code,
    Droid, Devin, Command Code, Auggie, Cursor, GitHub Copilot, Kiro, Kimi Code)
    no necesita maquinaria propia: todos ejecutan un comando por evento y le
    pipean su JSON crudo, así que comparten el mismo reporter `uxnan-event-hook`
    y solo difieren en **dónde** va la entrada y **cómo** se escribe. Eso vive
    como **datos** en `agent_hooks.rs` → `TABLE_AGENTS`: una fila declara el
    archivo de config, el ejecutable con el que se detecta el CLI, la forma de la
    entrada (`Grouped` = la forma agrupada de Claude · `Flat` = comando sobre la
    definición, la de Cursor · `OwnFile`/`OwnList` = un archivo entero nuestro,
    como Copilot y Kiro · `TomlBlock` = bloque delimitado dentro del TOML del
    usuario, como Kimi) y los eventos a registrar. Agregar un agente es **una
    fila + un brazo en `hooks::normalize_event`**, con el mismo id en ambos lados
    (un test lo verifica: un id mal escrito instala perfecto y luego descarta
    todos los reportes). La instalación automática al arrancar **solo toca los
    agentes presentes** en la máquina (ejecutable en `PATH` o su config ya
    existente); crear la carpeta de configuración de otro producto sin que nadie
    lo pida no le corresponde al ADE. El **Install** explícito de Settings no
    está condicionado.
  - **Wrapper genérico** (`uxnan-hook-wrapper.{sh,ps1,cmd,fish}`) — para
    cualquier CLI sin superficie de hooks: postea `working` antes de correr y
    `done` al salir (con `interrupted` si el código es != 0).
  Los reporters de shell **no construyen JSON**: el `agentId`/`agentType`/`status`
  viajan en headers HTTP (`X-Uxnan-Agent-Id` / `-Type` / `-Status`) y el evento
  crudo va en el body — eliminando una clase de bugs de escaping entre shells.
  El reporter compartido sí **responde `{}` por stdout**, incluidas sus salidas
  tempranas: varios de estos CLIs parsean lo que imprime el hook y **Cursor
  condiciona el uso de herramientas a esa respuesta** — un reporter mudo no
  fallaría en silencio, bloquearía las lecturas de archivo del agente. En Windows
  su comando se escribe con **backslashes** (medido contra el CLI real de Cursor:
  un CLI que pasa el comando a `cmd.exe` parte una ruta con `/` en el primer
  separador y responde «…oaming no se reconoce como un comando»), degradando a la
  ruta corta 8.3 si hay espacios, igual que Grok.
  **Endpoint file:** el servidor escribe `endpoint.env`/`endpoint.cmd` (url+token
  vivos) al arrancar e inyecta `UXNAN_ENDPOINT_FILE`; cada reporter lo prefiere,
  así una terminal que sobrevive a un reinicio del ADE alcanza al servidor vivo.
  **Identidad por terminal, jamás heredada (invariante):** `UXNAN_AGENT_ID` +
  las coordenadas del servidor (y los endpoints de browser/MCP) identifican **una
  terminal de un lanzamiento**, pero las variables de entorno bajan por todo el
  árbol de procesos. Un ADE arrancado *desde* una terminal de otro ADE — que es
  literalmente `npm run tauri dev` — heredaba el servidor de hooks del otro y el
  id de esa terminal, y se los pasaba a cada CLI que ejecuta en headless
  (`agentrun`: mensaje de commit IA, título de conversación, paso de
  automatización), cuyo propio hook reportaba al **otro** ADE haciéndose pasar
  por esa terminal: tarjeta de un agente que nadie lanzó, con su sesión estampada
  en el tab y un `resume` esperando a la siguiente restauración. Por eso el
  proceso se limpia de esas claves al arrancar y cada hijo que spawnea también
  (`launchenv.rs`, aplicado en `winproc::command`): una ejecución one-shot no
  pertenece a ninguna terminal y no debe reportar como si lo fuera. Los overrides
  que un humano fija a propósito (`UXNAN_DATA_DIR`, `UXNAN_SHELL`) quedan fuera
  de la lista.
  **Settings → Agents → Hooks** expone un **switch por agente** — una fila de
  ajustes por CLI, agrupadas en «en este equipo» y el resto — que instala
  (mergeando de forma idempotente, marcando lo gestionado por el nombre del
  script/relay) o desinstala, su reverso. Así los estados precisos funcionan
  out-of-the-box.
- **Seguridad del servidor local (defensa en profundidad):** el servidor liga
  solo a `127.0.0.1` (loopback) con puerto efímero y exige el **token por
  lanzamiento** (nunca escrito a disco). Sobre esa base: (a) el token se compara
  en **tiempo constante** (igualdad de digests SHA-256, no `==` sobre el secreto);
  (b) **todas** las rutas que mutan estado (`/hook`, `/browser`, `/mcp`) pasan
  primero por un **gate loopback de `Host`/`Origin`** (rechaza con `403` un `Host`
  o `Origin` no-loopback — defensa explícita contra CSRF / DNS-rebinding, sin
  depender del token ni del preflight CORS); (c) el `transcript_path` de un `done`
  de Claude solo se lee si es un `.jsonl` dentro de `~/.claude` (canonicalizado,
  así un `..` no escapa) — nunca un archivo arbitrario que pida el llamante; y
  (d) la cadena de comando del reporter Codex (POSIX) **escapa** la ruta del
  script (comilla simple `'\''`) para que una `'` en la ruta no rompa el
  quoting. Toda ruta
  nueva en este servidor debe ir tras **ambos** gates (loopback + token).

- **Captura de sesión del proveedor (resume):** cuando el payload de un evento
  trae la identidad de sesión del propio proveedor (`session_id` / `sessionID` /
  `sessionId` / `session-id` / `conversation_id` / `conversationId` /
  `conversationID` / `conversation-id` — Antigravity emite la grafía camelCase,
  que era justo la que faltaba, más un
  archivo opcional en
  `session_file` / `sessionFile` / `transcript_path`), el servidor la extrae y
  **sanea como entrada hostil** (longitud acotada, charset conservador, sin `-`
  inicial — el id llega después a una línea de comandos) antes de guardarla en
  `AgentStateEntry.session` (mismo TTL de 7 días). Los reporters incluidos la
  reenvían ellos mismos: el relay de Claude pasa el JSON crudo íntegro,
  el plugin de OpenCode adjunta el `sessionID` de la sesión RAÍZ a cada evento
  de estado (una sesión hija de sub-agente nunca lo pisa), y la extensión de
  Pi reenvía los campos explícitos `session_id`/`session_file` que observa, y el
  hook por evento de Grok/Antigravity reenvía su payload crudo. El
  evento difundido `agent:status-changed` **incluye la sesión** (espeja la
  entrada cacheada — omitirla fue exactamente el bug que desactivó el resume
  en silencio); el frontend la persiste con él
  además en el tab dueño (con el layout), y al restaurar/despertar ese tab
  lanza el comando de resume del CLI (`claude --resume <id>`,
  `codex resume <id>`, `opencode --session <id>`, `grok --resume <id>`,
  `agy --conversation <id>`, `pi --session <archivo|id>`;
  registro en `src/lib/agentResume.ts`) como comando de arranque: se
  **auto-ejecuta si la TUI seguía viva al cerrar/dormir** (el workspace vuelve
  con sus TUIs abiertas; el pane omite entonces el replay del
  snapshot, la TUI redibuja su propia conversación), y solo queda pre-escrito
  si el agente ya había salido (un tab despertado SIN sesión reanudable limpia
  su comando de lanzamiento sobrante en vez de re-dispararlo). El flag `live`
  lo mantiene la detección de procesos (`agent:detected`), pero **solo una
  salida observada** lo baja — el detector emite al cambiar partiendo de un mapa
  vacío, así que tras restaurar informa una vez "sin agente" en cada tab, antes
  de que arranque la TUI reanudada, y creerle daba por muertas justo las
  sesiones recién restauradas. Los ids de
  sesión son identificadores, no credenciales.

- **Tipo de agente saneado:** el tipo llega por cabecera/cuerpo y se
  canonicaliza (trim + minúsculas) rechazando el placeholder `"agent"` que
  emitía un reporter pre-relay ya retirado; un informe **sin** tipo nunca borra
  la identidad ya establecida del tab (misma regla que la sesión), porque
  perderla se lleva por delante el comando de resume. Los reporters de builds
  anteriores se barren al arrancar por dos vías distintas: del **directorio de
  hooks** por regla — se borra todo `uxnan-*` que esta build no acabe de escribir,
  así que un renombrado futuro se limpia solo (los ficheros que no son nuestros,
  como `endpoint.*`, quedan intactos) — y de la **config de cada agente** por una
  lista de nombres retirados mantenida a mano, que es lo único que no se puede
  deducir: renombrar un reporter obliga a añadir su nombre viejo ahí. Una sesión
  **ya persistida** con ese placeholder se repara al
  volver el tab deduciendo el CLI de la ruta de transcript que venía en el mismo
  informe (`~/.codex/sessions/…`, `~/.claude/projects/…`, …); si no se puede
  ubicar se deja como está — lanzar la línea de otro CLI a ciegas es peor que no
  ofrecer nada.

- **Sesiones nombradas al lanzar (`src/lib/agentSessionId.ts`):** la captura por
  hook solo aprende el id cuando el agente ya hizo algo, así que un tab abierto
  y nunca usado no tenía nada que recuperar. Para los CLI que aceptan un id
  elegido por el llamador — `claude --session-id <uuid>`,
  `grok --session-id <uuid>`, `pi --session-id <id>` (verificados contra la
  ayuda de cada CLI) — uxnan elige el id al lanzar y sella el tab en el acto.
  Antigravity queda fuera desde `agy` 1.2: su `--conversation` solo **reanuda**
  un id que agy creó (uno desconocido produce un aviso y una conversación nueva
  con otro id), así que se captura por hook como Codex y OpenCode. Ese id queda marcado
  `pending` hasta que el proveedor lo reporta, porque los flags son
  complementarios exactos (cada uno rechaza el caso del otro): un tab `pending`
  se reabre **reclamando** un id en vez de reanudarlo, y reclama uno recién
  acuñado (reclamar dos veces el mismo es justo lo que falla, y una conversación
  sin usar no tiene historia que perder). Si los args del propio usuario ya
  eligen sesión (`--resume`, `--continue`, `--session*`, `--fork*`,
  `--conversation`), la línea se deja tal cual. Interruptor:
  `AppSettings.pin_agent_sessions` (Ajustes → Agentes), por defecto activo.

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

| Estado | Significado | Indicador Visual (`AgentStatusIndicator.svelte`) |
|--------|-------------|------------------|
| `working` | Procesando activamente una tarea | **Comet Trail** verde (`CometTrail.svelte`) |
| `blocked` | Esperando respuesta de otro sistema (API, servicio externo) | Icono de pausa ambar (`circle-pause`) |
| `waiting` | Esperando input del usuario | Burbuja de pregunta naranja (`message-circle-question-mark`) |
| `done` | Tarea completada | Check azul (`circle-check`) |
| `idle` (derivado) | Agente en reposo, sin reporte preciso | Punto gris |

> **Por que un glifo por estado y no un punto de color.** Un punto solo se
> distingue por el matiz, asi que a 12px la sidebar obligaba a mirar dos veces
> para separar "te esta esperando" de "termino". Cada estado *activo* tiene ahora
> su propia forma, legible sin color. `idle` conserva el punto gris **a
> proposito**: es el estado mas frecuente, y un glifo ahi seria ruido constante —
> "glifo = pasa algo / punto = no pasa nada" es lo que hace escaneable la lista.
>
> **Comet Trail** es una matriz 3x3 de puntos: los 8 del perimetro llevan una
> cabeza brillante con una cola de 2 puntos que se apaga, girando en sentido
> horario (vuelta ≈ 1.15 s), mientras el punto central respira. Se anima con **CSS
> puro** — un solo keyframe mas un `animation-delay` negativo por punto, tocando
> unicamente `opacity` — para que corra en el compositor sin ningun timer de JS:
> se renderiza uno por agente *trabajando*, y uxnan apunta a hardware modesto.
> Respeta `prefers-reduced-motion` congelandose en un anillo **completo** (uno
> congelado a mitad de barrido se lee como widget roto).
>
> El tamano canonico es 12px (`icon.status` en `design.ts`). La **tira contraida**
> (`AgentAvatar`) mantiene el anillo de color: a 16-20px la matriz no seria
> legible, y ahi solo hace falta "quien + como".

> **Semantica `done` vs `waiting` (fin de turno).** `done` es el estado de reposo
> tras completar un turno — la tarjeta muestra "Listo" + badge de no-leido.
> `waiting` se reserva para **esperas reales a mitad de tarea** (el agente necesita
> tu respuesta para continuar: permiso, pregunta, elicitacion). En Claude Code esto
> importa: al terminar dispara `Stop` (→ `done`) y, ya en reposo en el prompt, una
> `Notification` de tipo `idle_prompt`. Esa notificacion de reposo mapea a **`done`**
> (no a `waiting`), para que no pise — el cache es last-write-wins — el `done` previo
> y deje la tarjeta atascada en "Esperando tu respuesta". Solo
> `permission_prompt` / `elicitation_dialog` / `agent_needs_input` producen
> `waiting`; `auth_success` y otros avisos transitorios se ignoran
> (`hooks::normalize_event`). La regla vale para **cualquier** agente que hable
> ese vocabulario: una `Notification` sin tipo reconocible **no** es `waiting`
> — Grok emite rutinarias (un aviso de permiso de herramienta que dispara incluso
> con permisos bypasseados, y un empujón de reposo al terminar el turno) y
> tomarlas al pie de la letra es lo que dejaba sesiones terminadas en el carril
> **Needs you**. El tipo se lee en las tres grafías que usan estos CLIs
> (`notification_type`, `notificationType`, `type`): los payloads de Grok son
> camelCase de punta a punta, así que leer solo snake_case no encontraba nada.
> Codex, medido contra el CLI real, **no tiene evento `Notification`**: su
> solicitud de permiso es `PermissionRequest`.
>
> **`SessionStart` es un límite, no un estado.** La mayoría de estos CLIs lo
> disparan al abrir o reanudar su TUI, antes de que el usuario pida nada; mapearlo
> a `working` pintaba el punto verde desde el instante en que se abría la terminal
> y **nada podía moverlo**, porque el siguiente evento solo llega cuando la persona
> por fin escribe (medido en Codex: emite exactamente
> `SessionStart {"source":"startup"}` y después nada). `hooks::is_session_boundary`
> lo trata como frontera: **borra** el turno cacheado de esa pestaña
> (`model::clear_agent_state` — la sesión anterior ya no describe nada: prompt,
> herramienta, respuesta y subagentes son de otra), conserva la identidad de
> sesión que trae el payload (para el resume) y emite `agent:status-cleared`, un
> evento aparte porque **no hay estado que reportar**: el agente está presente y
> en reposo, que es exactamente el `idle` derivado. Un `SessionStart` disparado
> **a mitad de turno** por una compactación queda excluido por su `source`, así
> que nunca borra un turno vivo.

Ademas, un reporte sin actualizacion por mas de **30 minutos** se considera
`stale` y se atenua (`opacity-40`) tanto en la sidebar como en la barra de
tabs. Un terminal plain (sin agente corriendo y sin output reciente) no
muestra ningun indicador.

Estos estados se muestran en dos lugares de la interfaz:

- **Tarjeta del worktree** en la sidebar izquierda: como indicador junto al nombre de la rama.
- **Barra de tabs** del area central: como indicador en el tab del terminal donde corre el agente.
- **Cabecera de Proyectos**: una **pildora de atencion** con cuantos worktrees
  visibles tienen un agente en `waiting`/`blocked` (`projects.needsYouCount`, la
  clase 1 de `attentionClass`). Click → `revealNeedsYou()` cambia a la vista por
  estado con esa lane abierta. Es la unica senal que debe escapar del arbol: un
  permiso pendiente dentro de un proyecto contraido no puede quedar invisible.
- **Tarjeta de proyecto contraida**: la tira de avatares con anillo de estado
  (`AgentAvatar size="sm"`) + el conteo de worktrees, para que un proyecto cerrado
  siga diciendo que hay dentro. Solo aparece si hay senal real (algun agente, o
  mas de un worktree). La cabecera **y** ese resumen viven dentro de **una sola
  superficie**, igual que una fila de worktree y sus agentes: con el relleno de
  seleccion solo en la cabecera, el resumen quedaba fuera del bloque resaltado y
  se leia como si perteneciera al elemento siguiente.

### Tercera vista: agrupar por revisión

`sidebarGroupBy` tiene tres valores porque son **tres preguntas distintas**:

| Vista | Pregunta | Carriles |
|---|---|---|
| `none` (árbol) | ¿qué pertenece a qué? | proyecto → worktree → agentes |
| `status` | ¿quién me necesita ahora? | te necesita · listo · trabajando · ocioso · listo para cerrar |
| `review` | ¿qué tan avanzado está esto? | checks fallando · en revisión · en curso · mergeado · cerrado |

La tercera aparece cuando hay suficientes espacios como para que las otras dos
dejen sin ubicar a una rama que espera a un revisor: no necesita nada de ti, pero
tampoco está terminada. `reviewGroupOf` (`$lib/sidebar-review.ts`) la resuelve
desde el PR cacheado, y los carriles se ordenan por **cuánta acción tuya piden**,
no por progreso — por eso *checks fallando* va primero (es el único estado
abierto bloqueado en ti) y *sin PR* comparte carril con *borrador* (ninguno se ha
entregado todavía). El PR llega al store empujado desde `github` (`notePr`), igual
que el veredicto de completitud, para no cerrar un ciclo de imports.

### Lane «Listo para cerrar» (vista por estado)

La vista por estado tiene una lane mas, **al final**, alimentada por
`isClosable(completion)` (ver `02c` → *¿Este espacio ya termino?*) en vez de por
`attentionClass`. Un worktree terminado se saca de las lanes de atencion por
completo: caia en «Ocioso», que es donde se busca trabajo para **retomar**, no
trabajo para cerrar.

Va **ultima** a proposito. Es la unica lane que pide una *decision* en vez de
atencion, asi que no debe competir con lo que sigue en vuelo. `CLOSABLE_LANE`
viaja dentro de `AttentionClass` para que la vista renderice una sola lista de
lanes, pero no es un nivel de urgencia — por eso ordena al final y no por
prioridad.

Su cabecera lleva un **cierre en lote** (revelado al pasar el raton), que es el
punto de todo lo anterior: cerrar de a uno esta bien con tres espacios terminados
y es inutil con treinta. `planBatchClose` (`$lib/worktree-batch-close.ts`) es
**mas estricto que el dialogo individual**: ahi los cambios sin commitear son una
advertencia que puedes ignorar — estas mirando *un* worktree y sabes que hay
dentro; aqui estas mirando un numero, asi que cualquier espacio con cambios sin
commitear, commits sin subir o un agente vivo se **omite y se lista**, nunca se
arrastra. El dialogo enseña las dos mitades antes de actuar: lo que se cierra y
lo que se queda **con su razon** — un lote que encogiera en silencio seria peor
que no tenerlo, porque el conteo es lo unico que se lee.

### Agent view (sidebar izquierda)

Dentro de cada worktree, la lista de agentes (`AgentSpace.svelte`) es una **"agent
view"**: cada agente es una **fila de dos lineas** — indicador de estado
(`AgentStatusIndicator`) + logo (`AgentLogo`) + **titulo de conversacion** +
**modelo fijado** + tiempo relativo en la 1a linea, y un **preview** atenuado en
la 2a (la herramienta actual mientras trabaja, si no la ultima respuesta, si no la
etiqueta de estado). Las dos lineas son deliberadas: es lo que distingue esta
lista de una fila unica con el texto concatenado. El chip de **modelo** sale de
los argumentos del propio perfil de lanzamiento (`modelFromArgs` →
`TerminalTab.agentModel`) y **no aparece** si el perfil no fija ninguno: uxnan no
puede ver el modelo que el CLI elija por su cuenta y no lo inventa. El
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
polling mientras haya un agente Zero abierto. La barra de tabs usa el mismo `AgentStatusIndicator` que la sidebar (resolucion reactiva `hook` › `title` › `activity`), de modo que un agente con hook server reportando estados muestra el estado preciso (`working` / `blocked` / `waiting` / `done`) y un agente sin hook configurado cae al fallback (output-activity o title-inference) con dot gris/idle cuando no hay movimiento.

**Descubrimiento de hooks.** Cuando un tab de la barra es de un agente y su
estado proviene de un fallback (no del hook server), se muestra al lado del
dot un pequeno icono de `Webhook` que abre **Settings → Hooks** al hacer
click. Asi el usuario descubre las configs listas para usar (`§1.1`) y
entiende que los estados precisos requieren una instalacion manual
(puntual) por agente. La pista solo aparece en tabs de agentes no
gobernados por hooks — los tabs plain y los agentes ya conectados no la
muestran.

### Subagentes (agentes hijos)

Un agente puede lanzar **subagentes**. El hijo corre bajo el **mismo PTY** que el
padre, asi que sus hooks llegan con el **mismo `agent_id`** (id del PTY) — la
separacion sale de campos del payload crudo, no del envelope. El ADE suscribe los
eventos de ciclo de vida `SubagentStart`/`SubagentStop` y mantiene un **roster de
subagentes por sesion** en la entrada del padre (`AgentStateEntry.subagents` +
`model::upsert_subagent`), **sin tocar el estado del padre** (un spawn/fin de hijo no
debe voltear al padre a `working`/`done`). El roster esta limitado
(`MAX_SUBAGENTS = 32`; se descarta primero el hijo terminado mas antiguo). Cada
reporte de subagente se difunde reusando `agent:status-changed` con la lista
`subagents` actualizada.

El ruteo es **agnostico al agente** (`hooks::is_subagent_event`, que normaliza la
grafia: Grok despacha `subagent_start`, Cursor/Copilot `subagentStart`), y el
extractor (`hooks::source_subagent`) sigue defensivo — **ignora un evento sin id de
hijo estable**, nunca inventa una fila. Cuatro agentes estan cableados y **validados
corriendolos de verdad y leyendo lo que emiten**:

| Agente | Como lanza | id del hijo | Respuesta final |
|---|---|---|---|
| Claude Code 2.1.225 | herramienta `Agent` | `agent_id` | `last_assistant_message` |
| Codex 0.147.0 | herramienta `spawn_agent` | `agent_id` | `last_assistant_message` |
| Grok 0.2.118 | herramienta de subagente | `subagentId` | `lastAssistantMessage` |
| OpenCode 1.18.15 | herramienta `task` (**sesion hija**) | id de la sesion hija | — |
| OpenCode 2.0.16 | herramienta `task` (**sesion hija**, `data.parentID`) | id de la sesion hija | — |

Codex expone los dos eventos con **el mismo payload que Claude**, asi que basta con
suscribirse: van en `codex_trust::CODEX_EVENTS` con su etiqueta snake_case, porque su
`trusted_hash` es **por evento y por grupo** (`<hooks.json>:<evento>:<índice de
grupo>:0`, con el índice donde el merge dejó nuestro grupo — detrás de los de
otros productos en el mismo archivo — leído del archivo recién escrito) y una
etiqueta o un índice equivocados dejan el hook sin ejecutar y a Codex pidiendo
revisar los hooks en cada arranque.
**Droid** dispara `SubagentStop` sin id de hijo, asi que su reporte se descarta.
**Pi** no tiene subagentes; **Antigravity** y **OMP** si los tienen pero no los
exponen donde los podamos leer (los hooks de Antigravity son solo su bucle de
ejecucion; los de OMP viven en su capa RPC/TUI, no en el bus de plugins que usa su
reporter).

**De quien es el evento.** En Grok y OpenCode el hijo corre en **sesion propia** y sus
eventos suben por el mismo canal, bajo el PTY del padre. Todo evento cuya sesion sea
la de un hijo conocido (`model::is_subagent_session`) se atribuye a la fila de ese
hijo (`model::touch_subagent_activity`, que registra su herramienta en curso) y **no
llega al padre**. Medido en Grok: el hijo emite su propio `user_prompt_submit` — que
pisaba el titulo de conversacion del padre — y su propio `session_end`, que mapea a
`done` y dejaba al padre en "Done" **mientras seguia trabajando**; su id de sesion
tambien acababa como la sesion capturada del tab, es decir, la que se reanuda. Claude
y Codex no necesitan nada de esto: los eventos de sus hijos llevan la sesion del
**padre**, asi que el uso de herramientas de un hijo es, honestamente, actividad del
padre.

En la agent view (`AgentRow.svelte`) los subagentes **activos** se muestran como
**filas hijas indentadas** bajo el padre: indicador de estado, **tipo** del hijo como
chip y su tarea (o la herramienta que corre ahora mismo, cuando el agente la reporta —
hoy solo Grok, porque el plugin de OpenCode ya filtra los eventos de sus hijas dentro
del CLI). Un hijo que termina **deja de listarse** pero sigue contando en el **badge**
del padre, que resume activos/total. El display del padre esta **done-gated**
(`agentDisplay.ts`): mientras un hijo siga `working`, el padre no se muestra `done`
(evita un ✓ prematuro cuando un hijo de fondo sobrevive al `Stop` del padre).

La fila de un hijo **no lleva tiempo transcurrido**: el reloj compartido de la app
tictaquea cada 30 s — bien para el "4m" del padre, inutil para un hijo que vive doce
segundos, que se veria congelado y luego a saltos.

Claude y Codex solo nombran la tarea del hijo **al terminar**, asi que mientras corre
su fila dice `[general-purpose] Subagente`. Es deliberado: la tarea esta en la llamada
a la herramienta que lo lanza, pero emparejarla con el hijo que aparece despues es una
suposicion en cuanto se lanzan dos a la vez, y una fila que muestra con aplomo la
tarea equivocada es peor que una que no muestra ninguna.

> Los sellos de tiempo del roster llegan del backend en **segundos** y se escalan a ms
> una sola vez, en `agentStatus.svelte.ts:toLive`, junto con los del padre — la UI
> entera habla una sola unidad.

### 1.3 Capa 2: Deteccion por Titulo de Terminal

Como **fallback** para agentes que no soportan hooks HTTP nativos, el ADE analiza el titulo del terminal y la salida del proceso para inferir el estado del agente.

- Muchos agentes CLI actualizan el titulo de la ventana del terminal (via secuencias de escape ANSI/OSC) para reflejar su estado actual (por ejemplo, "thinking...", "waiting for input", "done").
- El ADE intercepta estas secuencias OSC en el stream del PTY y las interpreta para mapearlas a uno de los cuatro estados definidos (`working`, `blocked`, `waiting`, `done`).
- Esto permite **monitorear agentes desconocidos** sin que estos necesiten integracion explicita con el ADE. Si un agente actualiza su titulo de terminal con patrones reconocibles, el ADE puede inferir su estado automaticamente.

> **Las heurísticas de esta capa solo valen si no mienten.** Dos de las más
> laxas se recortaron: el sufijo de puntos suspensivos y el glifo de check ahora
> **solo cuentan al final del título** (`agentTitle.ts`). Sin ese anclaje también
> casaban con los puntos suspensivos que cualquier terminal escribe para una ruta
> truncada (`…/very/long/path`) y con un check usado como decoración, de modo que
> un título que no dice nada del estado acuñaba un `working` o un `done`. La capa
> es un fallback: prefiere no reportar antes que reportar mal, porque el hook
> (Capa 1) no está ahí para corregirla.
>
> **Zero se lee de su sesión en disco, no del terminal.** No reporta hook ni
> escribe título, pero sí registra lo que hace en
> `<data>/zero/sessions/<id>/` (`zero.rs`), y eso es evidencia sobre el
> **agente**, a diferencia de las dos inferencias de abajo, que son evidencia
> sobre el **terminal**. Por eso su sesión se resuelve con la misma prioridad que
> un hook, en `resolveAgentDisplay` y no solo en la fila de agente: antes el
> punto del worktree salía de la actividad de output, así que hacer clic en su
> TUI (un redibujo) se leía como trabajo mientras la fila de justo debajo decía
> otra cosa. Dos reglas la mantienen honesta: un `metadata.json` que lleva
> `FRESH_SECS` sin tocarse **no afirma nada** (Zero guarda todas las
> conversaciones de una carpeta, así que la más reciente suele ser el último
> turno terminado — leer su `message` como `done` ponía un check en una sesión a
> la que nadie había pedido nada), y una sesión anterior a la pestaña que la
> muestra no es de esa pestaña (`zeroSessions.forTab`). Su **última respuesta**
> sale de la cola de su propio `events.jsonl` (el último `message` con
> `role: "assistant"`), para que su tarjeta diga lo mismo que la de cualquier
> agente con hook en vez de solo una etiqueta de estado.
>
> **La inferencia por output exige actividad sostenida.** Un TUI con mouse
> tracking responde a un **clic** redibujándose, y tomar cualquier byte como
> trabajo encendía el punto verde cada vez que la persona tocaba la terminal
> (`agentMonitor.noteOutput`). Ahora el output tiene que **seguir llegando** un
> instante después de haber empezado (`ACTIVITY_SUSTAIN_MS`): un agente que
> piensa emite durante segundos, un redibujo aislado no. Una ráfaga posterior se
> juzga por sí misma, no arrastra el reloj de la anterior.

### 1.4 Capa 3: Deteccion de Proceso en Ejecucion

El ADE detecta **que agente corre como el trabajo en primer plano** de cada PTY —
el que el usuario realmente lanzo en esa terminal, **no** cualquier proceso-agente
que aparezca en cualquier lugar del arbol. Esa distincion es la que mantiene honesta
a la terminal: un programa que **no es un agente** (p. ej. un servidor local o el
daemon `bridge`) puede a su vez lanzar un CLI de agente como **ayudante de fondo**
(el bridge mantiene un `zero acp` de larga vida), y atribuir ese ayudante a la
pestana la etiquetaria con un nombre/logo/estado que nunca lanzo.

Dos reglas gobiernan `procscan.rs` (`detect_agent`):

- **Descender solo a traves de shells.** Desde el shell se mira su trabajo en primer
  plano. Se ve **a traves** de shells anidados (un shim `.cmd`/`.ps1`/shell que corre
  el agente real como su hijo), pero un proceso **no-shell es un callejon sin salida**:
  sus hijos son ayudantes que el lanzo, nunca el agente en primer plano de la terminal.
  Gana el nivel coincidente **mas cercano al shell** (el trabajo lanzado); dentro de un
  nivel gana la coincidencia mas especifica.
- **Identificar por tokens de identidad, no por toda la linea de comandos.** Un proceso
  se identifica por su **nombre de ejecutable** y — para un interprete de lenguaje
  (`node …\codex\cli.js`) — por la **ruta del script que ejecuta**. El texto del prompt,
  los flags y el directorio de trabajo se ignoran a proposito, para que
  `claude "compara con codex"` siga siendo Claude y no Codex. El scoring por
  **especificidad** se conserva (exacto ▸ variante `cmd-`/`cmd_` ▸ substring de 4+;
  el comando mas largo gana), asi un agente "envoltorio" (`openclaude`, que contiene
  `claude`) no se confunde con el que envuelve, de forma determinista.

Ademas, un tab **lanzado** por el ADE ya conoce su identidad y la deteccion **no la
sobrescribe** (solo nombra agentes iniciados a mano). Esta capa no determina el estado
especifico del agente, pero confirma que un agente esta activo en un PTY determinado y
habilita el monitoreo por las capas superiores: es la capa mas basica, solo detecta
presencia, no estado detallado.

**Identidad por hook (no solo por proceso).** Ademas de `procscan`, **el propio
reporte de hook (Capa 1) establece la identidad del tab**: como el reporter declara
su `agentType`, un agente iniciado **a mano** en cualquier terminal del ADE — incluso
un wrapper, un binario renombrado o uno lanzado via `node` que `procscan` no sabe
nombrar — aparece en la agent view y alimenta el indicador de estado del worktree en
cuanto llega su **primer hook**, sin depender de la coincidencia por nombre de
ejecutable. La deteccion de proceso queda como **fallback** para agentes sin hook. El
hook solo sella la identidad de un tab que aun no la tiene (una identidad de
lanzamiento o ya detectada siempre gana). Sitio: `state/agentStatus.svelte.ts`
(`sealIdentity`).

### 1.5 Staleness y Limpieza

Para evitar que estados obsoletos contaminen la interfaz:

- **Marca de stale:** Si un agente no reporta estado en **30 minutos**, su estado se marca como "stale".
- **Visualizacion diferenciada:** Los estados stale se muestran con **opacidad reducida** en la UI, tanto en la sidebar como en la barra de tabs. Esto indica al usuario que la informacion puede no estar actualizada.
- **Neutralizacion de atencion obsoleta:** un estado de atencion (`waiting`/`blocked`) que quedo obsoleto (stale, sin evento de cierre que lo resuelva) se degrada a `idle` neutral en la UI, para que ningun agente atascado domine la lane «Te necesita» indefinidamente. `done`/`working` conservan su significado. (`state/agentDisplay.ts`.)
- **Inferencia de interrupcion:** un turno abortado por el usuario (`Ctrl+C` / doble-`Esc`) que el CLI no reporta por hook se resuelve a `done + interrupted` observando (sin consumir) esas teclas en la terminal; guardado para que un `Stop` real siempre gane. Detalle en `02b-terminal-engine.md` §4.b (`state/agentStatus.svelte.ts` `synthesizeInterruptedDone`).
- **Limpieza automatica:** Al cabo de **7 dias sin actividad**, el registro del agente se elimina del cache persistente en disco. Esto evita acumulacion indefinida de datos de agentes antiguos.

---

### 1.6 Superficie de control: MCP y `uxnan-cli` sobre un catalogo

El mismo servidor HTTP local (Capa 1) es **el unico servidor local de la app**
(`src-tauri/src/control/server.rs`): sirve los reportes de hooks (`/hook`), el
shim del navegador (`/browser`), un servidor **Model Context Protocol** (`/mcp`,
transporte Streamable HTTP) y un endpoint **JSON-RPC 2.0** de control
(`/control/v1/rpc`), en un puerto efimero de `127.0.0.1`. Los dos ultimos son los
dos transportes de **una sola superficie de control**: un catalogo de entradas
(`uxnan-control-protocol`, `src-tauri/crates/control-protocol`) que el agente
lanzado por el ADE descubre como tools MCP **sin instalar nada**, y que
`uxnan-cli` (`src-tauri/crates/uxnan-cli`, un binario sin Tauri) expone a
cualquier shell del mismo usuario. Una tool MCP `worktree_list` y un metodo
`worktree/list` son la **misma entrada** con el mismo esquema de argumentos y el
mismo resultado; ambos terminan en el mismo servicio (`control/services/`) que
tambien llama el comando Tauri de la ventana. Nada fuera del catalogo es
alcanzable: no hay shell, ni bytes crudos al PTY, ni filesystem o git
destructivos, ni credenciales, ni edicion externa de la persistencia.

**Cada entrada del catalogo declara** su nombre JSON-RPC (`dominio/verbo`), su
nombre de tool MCP (`dominio_verbo`), su grupo, un esquema **cerrado** de
argumentos, un **esquema de resultado** (cada campo con su significado; que
campos son nulos y cuales se omiten) y una peticion de ejemplo. De ese unico
origen salen las tres lecturas: `tools/list` de MCP (`inputSchema` +
`outputSchema`), `uxnan-cli skills get control --full` — la **referencia de la
API** completa: por entrada, forma de CLI, tool MCP, tabla de argumentos,
campos del resultado, peticion y errores; antes, el contrato de transporte para
un script (archivo de descubrimiento y sus comprobaciones, sobre JSON-RPC,
cabeceras, codigos HTTP y de error con su codigo de salida) — y el archivo
versionado `docs/control-api-reference.md`, que **es** esa salida: un test del
crate `uxnan-cli` falla cuando queda desactualizado, y otro comprueba cada
forma de CLI contra el arbol real de subcomandos de clap.

**Grupos de capacidad (versionados y desconectables en `settings.control`):**
`read` (`status` — que ademas informa del **presupuesto** que enfrenta un agente
nuevo aqui: concurrencia, ranuras vivas, memoria minima exigida, memoria libre y
el tope advisory por agente: la misma regla que aplican las propias puertas
(`automations::runner::limits_from`) sobre los ajustes que este proceso ya
tiene en memoria, mas `budget::live` para las ranuras que comparten todos los
procesos — responder `status` no relee el fichero de estado —, asi que un coordinador puede
decidir cuantos workers caben en vez de lanzarlos a encolarse —,
`project/list|show`, `host/list|show`, `worktree/list|show`, `terminal/list|show`,
`agent/list`, `run/list|show`, `automation/list|show` — el detalle completo de una
automatizacion (prompts, dependencias, manejo de fallos, `autonomous`, politica y
precondicion) porque la lista no dice **que haria** una corrida —,
`browser/status|snapshot|screenshot|console|wait`), `ui` (`app/focus`,
`terminal/reveal`, `file/open` — en la pestana del ADE o, con `with`, en uno de
los editores externos de la persona: se nombra **un editor de su lista**, nunca
un comando, asi que la superficie no gana una puerta a ejecutar cualquier cosa —,
`file/diff`, `automation/propose` — abre el editor de automatizaciones relleno
con el borrador de un agente y **no crea nada**: la persona lo lee, lo cambia y
pulsa Guardar, y se guarda **en pausa**; crear, editar, activar o programar una
automatizacion no tienen entrada, porque una que pudiera programarse a si misma
sobreviviria a la sesion que la creo. El backend comprueba lo barato (nombre,
carpeta existente, pasos, prompt bajo 64 KiB, maximo 20) y **el alcance** (un
token de lanzamiento solo propone trabajo en una carpeta de su proyecto); la
ventana comprueba lo que solo ella sabe (que el agente de cada paso este
instalado, que `dependsOn` nombre pasos reales) —,
`browser/open|navigate|reload|back|forward`,
`browser/click|type|press|scroll` — acciones en la pagina, bajo la politica de riesgo
y aprobacion de `02a` §4.2b; codigo de error `-32008` *refused*, salida 9 del CLI),
`create` (`host/connect` — abre sesion en un host **ya registrado** que no la
tiene, el mismo camino que el arranque toma con los que no piden nada, y
**sin aceptar credencial alguna**: si el host pide contrasena o passphrase, o su
clave es desconocida, cambio o fue revocada, la respuesta lo dice y ahi termina
(lo resuelve una persona en Ajustes → Hosts); el resultado no lleva huella
digital, ruta de clave ni metodo de credencial —, `worktree/create` — el nucleo del comando `worktree_create` movido al
servicio, adopcion por la ventana via el puente, lanzamiento del agente y primer
mensaje encolado tras el backpressure del broadcast —, `terminal/create`,
`terminal/close` — cierra una pestana que la propia superficie abrio (marcada
`origin: control`, persistida) cuando su agente ya no trabaja, o cualquiera en
alcance cuyo shell ya salio; la de una persona con shell vivo se rechaza como
invalida y una con agente trabajando como *busy* —, `run/start` y
`automation/run` **solo sobre definiciones guardadas**; cada entrada
responde con un **recibo** `{ requestId, idempotencyKey?, … }`, repite el primer
recibo ante la misma `idempotencyKey` en vez de crear dos veces, y deja una linea
en `control-audit.log` del directorio de datos con el llamador, la entrada, los
argumentos — el prompt reducido a su longitud — y el resultado), `converse`
(`agent/send`: un mensaje completo como paste-and-submit por la cola con
backpressure del broadcast, o forzado; `agent/wait --for idle|waiting|exit`
sobre el estado reportado por los hooks, dormido en el notificador
`AppState.agent_changes` en vez de sondear, maximo 15 s por llamada;
`terminal/read`: las ultimas lineas del buffer del terminal de la ventana con
**redaccion** de secretos en el backend antes de salir, auditado, y desconectable
por proyecto con `settings.control.terminalReadDisabledProjects`) y
`orchestrate` v2 (`run/create|finish`, `task/create|list|update`, `worker/start`, `inbox/check`, `question/ask|answer`, `orchestration/reportResult|reportProgress` — una corrida conducida por un agente coordinador, §3.9). La nomenclatura `dominio/verbo` es la del contrato del bridge (`shared/`),
para que la union de ambos mundos (029/030) sea mecanica. Los **selectores**
(`current`, `id:`, `path:`, `branch:`, `name:`) evitan copiar ids del sidebar;
`current` se ancla en el `UXNAN_AGENT_ID` del llamador, asi que solo existe
dentro de una terminal lanzada por el ADE.

**Recursos de la ventana.** Las pestanas de terminal, los archivos abiertos y las
corridas de orquestacion son estado del webview (el backend persiste su
serializacion sin interpretarla). Las entradas que los tocan se reenvian a la
ventana como evento `control:request` y esperan su unica respuesta por el comando
`control_respond` (`control/bridge.rs` + `src/lib/control/bridge.ts`); una ventana
que no responde en 5 s produce *unavailable*, distinto de "no".

**Autenticacion y aislamiento:** toda ruta rechaza primero un llamador cuyo
`Host`/`Origin` no sea loopback y exige despues un token. Hay **tres tokens**, todos nuevos en cada arranque: el **token por lanzamiento** (`UXNAN_HOOK_TOKEN`,
referenciado por la config MCP del agente como `UXNAN_MCP_TOKEN`; con
`UXNAN_HOOK_URL` y `UXNAN_AGENT_ID`) identifica un proceso que el ADE arranco y
ancla `current` en su terminal; el **token de control** vive solo en el archivo de
descubrimiento `control.json` del directorio de datos (legible solo por su dueno:
`0600` en Unix; en Windows una DACL explicita y protegida con una sola entrada para
el usuario actual, `uxnan_control_protocol::private`, el mismo modulo con el que
`uxnan-cli` lo comprueba), junto al pid **y la hora de inicio** del proceso, y
se borra al salir limpiamente — `uxnan-cli` rechaza un archivo legible por otros,
una version de protocolo distinta o un pid que ya no es ese proceso. El token de
control abarca todos los proyectos (es el mismo usuario del SO que ya puede abrir
la app); el de lanzamiento, **solo el proyecto de su terminal**, y el resolutor
lo aplica (`control/resolve.rs` → `Scope`): los listados (`project/list`,
`worktree/list`, `terminal/list`, `agent/list`, `host/list`, los conteos de `status`) se
acotan a el, y un selector que nombra un worktree, una terminal o un host de otro
proyecto responde `-32003` *scope denied* — distinto de *not found*, para que
el agente deje de insistir. El alcance sale del **estado del backend** (la
carpeta en la que corre el PTY del propio llamador), nunca de lo que la
peticion afirme; una carpeta es de un proyecto si esta dentro de su checkout,
de su ubicacion de worktrees registrada **o de cualquier worktree que git le
lista** — los worktrees enlazados que la app corta bajo la raiz de worktrees
viven fuera del checkout y son donde corren los workers de un coordinador; una peticion de lanzamiento sin la cabecera
`x-uxnan-agent-id` no alcanza ningun proyecto, ni una terminal del espacio
Global. Los **hosts** siguen ese mismo alcance en vez de relajarlo: un llamador
ve la maquina en la que vive su propio proyecto, la shell de la persona las ve
todas, y a un token acotado a un proyecto local se le dice por que no ve
ninguna (una lista vacia se leeria como "no hay hosts", que es otro hecho). Hoy
eso hace de `host/*` la superficie de la persona: una terminal en un host es un
PTY remoto sin ninguna variable `UXNAN_*`, asi que un agente que corra *alli* no
puede llamar a esta API — eso llega con el estado de agente en el host
(`02g-remote-hosts.md`, fase 2) y su ejecucion headless remota, y la regla ya
esta escrita para entonces. Para que eso funcione desde las tools MCP y no solo desde `uxnan-cli`,
**cada config de lanzamiento envia el id de la terminal en cada llamada**,
expandido de `UXNAN_AGENT_ID` como cada CLI expande variables (tabla abajo);
`current` se resuelve asi tambien desde una tool. El tercero, el **token de agente del bridge**, se entrega al bridge Uxnan por su canal local (`desktop/attach`, `02e` §3.5) para los agentes de sus conversaciones: llega al agente como `UXNAN_MCP_TOKEN`, identifica a un `Caller::Bridge` cuyo alcance es el proyecto de la carpeta de la conversacion (cabecera `x-uxnan-cwd`), no ancla `current` y nunca reporta un hook. Ninguno de los tokens se escribe en la config de ningun CLI ni se registra en logs.

**`uxnan-cli`:** resultados en stdout, errores en stderr, `--json` estable, codigos
de salida por clase de error (uso 2, app ausente 3, protocolo 4, denegado 5,
timeout 6, no encontrado 7, ocupado 8); `skills get control --full` imprime la
referencia generada desde el catalogo. Encuentra la app por el entorno (dentro de una
terminal del ADE) o por `control.json` (con las mismas reglas de directorio de
datos que la app, incluido el perfil `-dev` de una build de desarrollo). **Viaja
dentro de la app** como sidecar de Tauri (`bundle.externalBin`, construido por
`scripts/build-cli.mjs` y declarado por la superposicion
`src-tauri/tauri.cli.conf.json`, que el wrapper `npm run tauri` aplica solo a
`dev` y `build` — declararlo en `tauri.conf.json` haria fallar cada `cargo
test`/`clippy` sin el binario). Desde ahi (`control/cli.rs`): **toda terminal que
el ADE abre lo lleva en el PATH** (la carpeta del sidecar primero, y `UXNAN_CLI`
con la ruta), asi que un agente o un worker no instala nada; y para la shell
propia del usuario un **shim** renovado en cada arranque — enlace simbolico
`~/.local/bin/uxnan-cli` en macOS/Linux, copia en `%LOCALAPPDATA%\uxnan\bin`
mas esa carpeta en el PATH de usuario en Windows —, idempotente y de mejor
esfuerzo (un archivo ajeno en esa ruta se respeta). `status` reporta ambos
(`cli.bundled`, `cli.shim`). Detalle operativo en `docs/control-api.md`.

**Registracion por lanzamiento (`mcpinject.rs`) — invariante de diseno:** el servidor se registra **en el proceso que lanza uxnan y solo para ese lanzamiento**; el ADE **no escribe nada** en la config de ningun CLI (`~/.claude.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`, …). Un agente arrancado fuera de uxnan no descubre el servidor, no intenta conectarse y **no puede avisar de que esta caido**.

| Agente | Mecanismo | Forma |
|---|---|---|
| Claude Code | flag de lanzamiento | `--mcp-config <archivo propio del ADE>` (`headers`: `Authorization: Bearer ${UXNAN_MCP_TOKEN}`, `x-uxnan-agent-id: ${UXNAN_AGENT_ID}`, expandidos del entorno) |
| Codex | flags de lanzamiento | `-c mcp_servers.<n>.url=<endpoint> -c mcp_servers.<n>.bearer_token_env_var=UXNAN_MCP_TOKEN -c mcp_servers.<n>.env_http_headers.x-uxnan-agent-id=UXNAN_AGENT_ID` (cabecera → nombre de variable; verificado con `codex mcp get`) |
| OpenCode | env de lanzamiento | `OPENCODE_CONFIG_CONTENT` (se **fusiona** sobre la config del usuario; `headers` con `{env:UXNAN_MCP_TOKEN}` y `{env:UXNAN_AGENT_ID}`). Con OpenCode 2 solo en la terminal que uxnan abre para lanzarlo, y el lanzamiento lleva `--standalone` (abajo) |

El archivo de Claude vive en `<app-data>/mcp/claude-<puerto>.json` y lleva el puerto de **esa** ventana, de modo que dos ventanas de uxnan abiertas nunca se pisan el endpoint. Los flags se anaden en el unico punto donde el frontend teclea un comando de lanzamiento (`$lib/mcpLaunch` desde `terminal/instances.ts`), asi que cubre por igual un lanzamiento nuevo, una sesion reanudada y una pestana despertada.

**OpenCode 2: un servidor por pestaña.** OpenCode 2 ya no corre el agente en el TUI: un `opencode` a secas es cliente de un **servicio de fondo compartido** (`opencode serve --service`) que sobrevive a la pestaña y corre plugins y servidores MCP con el entorno de la primera terminal que lo arrancó. Registrado por entorno en todas las terminales, eso repetiría el fallo que este invariante evita: una registración que sobrevive al lanzamiento (puerto y token caducos al reiniciar uxnan) y que presta la identidad de **una** pestaña a todo cliente de OpenCode de la máquina. Por eso, con OpenCode 2 instalado (`agentcli::opencode_major_version`, `opencode --version` cacheado contra el binario): (1) uxnan lo lanza con **`--standalone`** (`mcpinject::required_args`, que el frontend añade en todo lanzamiento aunque las herramientas estén apagadas, salvo que el perfil ya elija servidor con `--standalone` / `--server`) — un servidor privado, hijo del TUI de la pestaña, que muere con ella; OpenCode 1 rechaza el flag y no lo necesita; y (2) `OPENCODE_CONFIG_CONTENT` va **solo en la terminal abierta para lanzar OpenCode** (`pty_create` recibe `launching`; `mcpinject::launch_env_all`), así que un `opencode` tecleado a mano no se lo pasa al servicio. Con OpenCode 1 todas las terminales lo siguen recibiendo, como antes. Coste medido (macOS, 2.0.16): ~585 MB por pestaña standalone frente a ~175 MB por TUI más ~470 MB del servicio una vez.

**Por que se sustituyo la escritura en la config global de usuario:** era una unica entrada, persistente y compartida, con dos fallos observados. (1) Fuera de uxnan no era inocua: Codex valida `bearer_token_env_var` al arrancar y aborta la fase MCP con *«Environment variable UXNAN_MCP_TOKEN for MCP server 'uxnan-browser' is not set»* en **cada** ejecucion. (2) La entrada llevaba el puerto de una instancia, asi que una **segunda** ventana de uxnan la sobrescribia y rompia los agentes de la primera desde dentro. Al arrancar, el ADE hace un **barrido de limpieza** (solo eliminacion, `sweep_legacy`) que borra esa entrada de las siete configs de usuario que versiones anteriores pudieron escribir.

**Ajustes (Settings → Browser → *Herramientas para agentes (MCP)*):** interruptor maestro `mcp_enabled`, interruptores por agente (`mcp_disabled_agents`) y `friction_free` — que es lo unico que sigue tocando la config propia del usuario: la semilla por-carpeta `[projects."<cwd>"] trust_level = "trusted"` en `~/.codex/config.toml` para que Codex no pregunte por la carpeta (silenciosa, desactivable). Con `mcp_enabled` en off no se registra nada; el endpoint `/mcp` y `uxnan-cli` siguen funcionando, y el snippet copiable (con la cabecera de id de agente a rellenar) sirve para cablear a mano. El grupo es **independiente del interruptor maestro del navegador integrado**: apagar el navegador retira el shim `$BROWSER`, nunca el catalogo (`browser_open` manda entonces la URL al navegador del sistema y responde `routed: "external"`; las tools que necesitan una pagina no encuentran ninguna). Las claves siguen en `BrowserSettings`, de donde el cableado nacio.

**Primer mensaje y espera.** Un `prompt` encolado al lanzar un agente (`worktree/create`, `terminal/create`) sale de la cola de backpressure solo cuando la terminal **ya dibujo y se asento** (`readyToReceive`, `src/lib/orchestration.ts`: salida vista al menos una vez y quieta ≥ 1,5 s; un agente ocupado se retiene hasta el tope de 12 s) — pegar en una shell que aun arranca el agente pierde el mensaje. Y `agent/wait` sobre una pestana que la ventana da por abierta pero cuyo PTY aun no existe lee *no reportado*, no `exit`.

**La superficie no tiene panel de ajustes, por diseno.** Las dos claves que existen (`settings.control.disabledGroups`, `settings.control.terminalReadDisabledProjects`) se respetan desde `state.json` y estan documentadas en `docs/control-api.md` → *Settings*; un panel de interruptores que nadie acciona es coste sin beneficio, y el token de control ya se renueva en cada arranque.

**Fila por agente (misma forma que la lista de Hooks, §1.1):** cada agente del catalogo es una fila `AgentSettingsRow` con su marca, su nombre y su interruptor. Donde Hooks muestra el archivo de config que escribe, esta lista muestra `McpAgentInfo.mechanism` — el flag o la variable que recibe ese lanzamiento (`--mcp-config <archivo>`, `-c mcp_servers.uxnan-browser.*`, `OPENCODE_CONFIG_CONTENT`) — porque aqui no hay ningun archivo de config que mostrar: ese es justamente el punto.

Solo se auto-configura un CLI cuando existe un mecanismo por lanzamiento **verificado contra el CLI real**; Grok, Qwen Code, Droid y MiMo Code no lo tienen hoy (detalle y receta para anadir uno en `docs/browser.md`).

---

### 1.7 Mascotas (pets): estado de agente como companero animado

Una superficie **puramente cosmetica y opcional** (apagada por defecto) que consume el mismo estado preciso de la Capa 1 y lo representa como un companero animado que flota sobre el ADE. No cambia en nada como trabaja un agente.

**Mapeo de estado → animacion** (1:1 con `AgentStatus`, §1.2):

| Estado del agente | La mascota muestra | Animacion |
|---|---|---|
| `working` | Trabajando | `running` |
| `waiting` | Te necesita | `waiting` |
| `done` | Lista | `review` |
| `blocked` | Bloqueada | `failed` |
| `done` **+ `interrupted`** | Bloqueada | `failed` |
| *(nadie reportando)* | Descansando | `idle` |

**Un turno interrumpido no es un resultado.** Esc / Ctrl-C reporta `done` con la bandera `interrupted` — para el resto de consumidores (barra lateral, notificaciones, badges) el turno efectivamente termino, y eso no cambia. La mascota es el unico sitio donde se lee distinto: responder a un turno cancelado con el gesto complacido de "Lista" dice lo contrario de lo que paso, asi que ahi un `done` interrumpido se muestra como **Bloqueada** (`petStateOf`, `src/lib/pets/status.ts`). Es ademas lo que hace `blocked` alcanzable en la practica: de los cinco agentes que reportan, solo OpenCode puede levantar un estado de error real (su `session.error` → `Error`), de modo que la fila `failed` de la hoja quedaba practicamente sin usar.

Un reporte **stale** (§1.5, 30 min) se ignora, de modo que la mascota vuelve a descansar en vez de seguir mimando trabajo que ya termino.

**Una sola mascota.** Cuando varios agentes reportan a la vez gana el mas urgente — **`waiting` → `blocked` → `done` → `working`**. Una mascota *por agente* se construyo y se retiro: nunca hubo asignacion (aparecia una por cada agente reportando dentro de la ventana de frescura), asi que la segunda solo existia en los instantes en que dos agentes trabajaban a la vez, y duplicaba lo que la barra lateral ya reporta por agente con nombre. La mascota aporta conciencia ambiental —algo que ves de reojo—, y eso lo da mejor una que cinco.

**Y habla de uno de ellos.** El tooltip nombra la tarea de ese agente y el clic revela su terminal, asi que cuando varios comparten el estado ganador hay que elegir: gana **el que reporto mas recientemente** (`pickDriver`). Tomar el primero que coincidiera — el orden en que los reportes cayeron en el mapa, mas o menos el orden en que cada agente reporto por primera vez desde el arranque — hacia que la mascota apuntara a un candidato arbitrario: ni el agente que estas manejando ni el que acaba de moverse. Deliberadamente **no** se filtra por el worktree seleccionado: la mascota se quedaria muda justo cuando lo que necesita atencion esta en otro sitio, que es cuando mas sirve.

**Clic = atajo.** Hacer clic en una mascota revela la terminal del agente que esta representando (`terminals.revealTab`), asi que el companero tambien navega, no solo decora. Se puede arrastrar a cualquier lado y se acomoda en la esquina mas cercana conservando su desplazamiento.

**Interactividad de puntero.** La mascota responde al raton como la mascota de escritorio de referencia. Un pack **v2** (`spriteVersionNumber: 2`, rejilla 8 x 11) reserva sus **filas 9-10** para un bucle continuo de **16 poses de mirada** en sentido horario (pasos de 22.5°, 0° = mirar hacia arriba; el frente/neutral no tiene pose: es la **zona muerta** del puntero, donde descansa el idle). Estando en reposo, la mascota **gira la mirada hacia el cursor** (pose sostenida, nunca una animacion — reproducirlas en secuencia es exactamente el barrido que hace ver rota una mascota), la mantiene unos segundos despues de que el cursor se detiene y vuelve a respirar dentro de la zona muerta. **"En reposo" significa que la animacion ya se toco entera (`hasSettled`), no que el estado del agente sea `idle`**: un gesto sigue sin interrumpirse a medias, pero las dos condiciones dejaron de ser lo mismo cuando los estados dejaron de caducar a los 3 minutos — condicionar la mirada al *estado* dejo a la mascota sin mirar ni una vez durante una tarea larga. Al volver de una mirada, la animacion **retoma en su punto de bucle**, no desde el principio: repetir el gesto entero cada vez que el cursor se aleja es la mascota actuando dos veces por un solo evento. **Clic = un toque**: reacciona con el salto (ademas del atajo a la terminal). **Arrastrar = cargarla, y corre**: mientras viaja reproduce la **carrera que se desplaza** del sentido del arrastre (`running-right` / `running-left`, filas 1-2 — para lo unico que existen esas filas, y el unico sitio donde se usan); al detenerse vuelve a la pose v2 de mirar hacia abajo — viendo pasar el suelo — y un pack sin carreras ni filas de mirada se menea con `jumping` como antes. A diferencia de una animacion de estado, una carrera de viaje **repite su propia fila** en vez de caer a idle tras tres pases (una mascota quieta a media carga se ve rota) y corre a su **propio ritmo, algo mas rapido y perfectamente parejo** (`CARRY_PACE` 1.25 = 150 ms por cuadro, sin cuadro de cierre largo): una carrera es un bucle, no un gesto — estirarla como gesto la vuelve camara lenta (con el 2.0 vigente cuando esto se hizo, 240 ms por cuadro), y conservarle el cierre largo le mete una cojera por vuelta, que es lo que se ve mal aunque los dos ritmos se acerquen. Las dos presentaciones miden el arrastre de forma distinta y comparten la decision. La capa dentro de la ventana lee eventos de puntero. La de escritorio no puede: **el arrastre lo posee el SO**, que se traga todos los eventos de puntero mientras dura, asi que el movimiento de la propia ventana es la unica senal — y por eso ese movimiento **arma** la carga en vez de solo alimentarla. La distincion es toda la conducta: con el movimiento como unica evidencia, "se quedo quieta" es una *conjetura* de que la soltaron, y si solo un `pointerdown` pudiera volver a armarla, una mano que pausa a media carga la termina para siempre (la mascota deja de correr y no vuelve por mucho que sigas arrastrando). Cualquier movimiento la re-arma, y la carga sobrevive a un instante quieto durante `CARRY_HOLD_MS`. Todo respeta *Animar* y `prefers-reduced-motion`; matematicas puras y testeadas en `src/lib/pets/look.ts` + `src/lib/pets/interactions.ts`.

**Ventana de escritorio (por defecto).** Con `pets.overlay` (activo por defecto; apagarlo devuelve la mascota a la capa dentro de la ventana de uxnan) la mascota vive en su **propia ventana sin bordes, transparente y siempre-encima** (`pet_window_show`, etiqueta `pet`): visible sobre otras aplicaciones e incluso con uxnan minimizado, como la mascota de escritorio de Codex. Se arrastra con el **drag nativo de ventana** (`startDragging` — correcto en DPI y multi-monitor, donde mover a mano con coordenadas falla), recuerda su posicion (validada contra los monitores vivos al crearla: un punto en una pantalla desconectada cae al reposo junto a la esquina inferior derecha del monitor primario) y el clic salta al agente; **traer la ventana principal al frente en ese clic es su propio interruptor (`raise_on_click`), apagado por defecto** — un toque a la mascota no debe tapar lo que la persona este haciendo salvo que lo pida. Dos restricciones aprendidas a golpe la moldean: las **capabilities de Tauri son por ventana** (la etiqueta `pet` lleva su propio `capabilities/pet.json`; sin el, `listen`/`emitTo` fallan en silencio y la ventana se ve vacia) y **el build estatico no tiene archivos por ruta** (la ventana carga `index.html?window=pet` y el layout raiz bifurca; una URL de ruta resuelve en dev via el fallback de Vite y da 404 empaquetada). La ventana es un **renderer delgado sin estado propio** (`PetWindow.svelte`): la ventana principal le empuja el pack parseado + hoja + estado vivo por eventos Tauri y aplica lo que vuelve (posicion a persistir, el salto de foco); cerrarse la ventana principal la destruye (la app nunca queda corriendo solo-mascota). Un ultimo detalle sostiene la ilusion: el boton de la mascota va con `outline-none`, porque el **anillo de foco por defecto del webview** dibuja un rectangulo alrededor de toda la celda del sprite — al hacer clic y otra vez con la siguiente tecla, que reevalua `:focus-visible` — y se lee como un recuadro de seleccion sobre el escritorio; en esa ventana no hay nada mas entre lo que mover el foco, asi que el anillo no informa de nada. La capa dentro de la ventana si conserva un anillo propio (el del design system) para navegacion con Tab, y suelta el foco tras un toque con el puntero.

**Formato en disco (compatible con Codex).** Una mascota es una carpeta con un manifiesto (`pet.json`, o `avatar.json`) y una hoja de sprites; los paquetes hechos para ese ecosistema cargan sin modificaciones:

```json
{ "id": "…", "displayName": "…", "spritesheetPath": "spritesheet.webp",
  "frame": { "width": 192, "height": 208, "columns": 8, "rows": 9 },
  "animations": { "idle": { "frames": [0,1], "fps": 8, "loop": true, "fallback": "idle" } } }
```

Todos los campos son opcionales (una hoja suelta ya anima, con rejilla convencional 8 × 9 de 192 × 208 y un `idle` sintetizado que recorre la hoja). Las cadenas de `fallback` se siguen hasta `idle` y una cadena circular resuelve en vez de colgarse.

**Frontera de confianza (`pets.rs`).** La importacion (desde `~/.codex/pets` o cualquier carpeta) es una **copia validante, no un clon de directorio**: solo se copian el manifiesto y la unica hoja que referencia. Los ids se validan contra traversal, `spritesheetPath` debe ser un nombre de archivo simple junto al manifiesto, la hoja debe pesar ≤ 24 MiB y oler a imagen, y la rejilla declarada esta acotada; los indices de cuadro fuera de la hoja se descartan en vez de invalidar el paquete. Lo que se guarda en disco es el manifiesto **saneado** que se parseo.

**Personalidad ociosa.** El mapa de estados son solo cinco animaciones y un pack trae mas (el incluido, once). Sobre la animacion base del estado la mascota intercala **one-shots** cortos y vuelve: mira alrededor / brinca mientras descansa (cada 14-34 s), **saluda para llamar la atencion** mientras te espera (6-13 s), toma aire mientras trabaja (25-50 s), da un brinco satisfecho cuando esta lista (25-50 s), se desploma mientras esta bloqueada (20-40 s). **Un one-shot cuesta dos rafagas de movimiento, no una**, y ahi esta el mecanismo que repone el estado: al terminar, el renderer recibe otra animacion distinta (la base) y la **reinicia desde el cuadro cero**, de modo que el estado vuelve a tocar su fila tres veces. Esa es la mitad util — un estado que ya se habia asentado en su cola de idle vuelve a verse cada tanto, sin ninguna maquinaria de "pulso". Y es tambien la razon de que un one-shot sea siempre una fila **distinta** de la del propio estado: usar la propia fila se probo y se revirtio, porque apila el one-shot sobre la repeticion que ya provoca y la mascota actua el doble en cada ciclo (una mascota en `done`, estado que dura media hora, se pasaba esa media hora celebrando). La cadencia se lee entonces contra lo que dura cada estado: te-necesita insiste porque ese es su trabajo, descansando se remueve cada medio minuto, y los estados largos (ocupado mientras el agente siga reportando; lista y bloqueada hasta 30 min) son los mas calmados, porque a mayor ritmo se leen como una mascota que nunca se asienta. Un cambio de estado real **siempre cancela** el flavour, asi que la textura nunca tapa una senal; se desactiva en la vista previa de Settings, con `prefers-reduced-motion` y con *Animar* apagado (`src/lib/pets/personality.ts`, puro y testeado).

**Tamano.** La escala ofrecida es 96 / 144 / 200 / 260 px (por defecto 144), medida sobre la **celda** del sprite — que un pack generado llena casi por completo (~6 px de margen arriba y abajo). Una escala anterior que terminaba en 160 dejaba incluso el maximo por debajo de la mascota de escritorio de referencia en su ajuste *medio* (~200 px). El tamano dibujado se ajusta a esa escala, para que el selector y la mascota nunca discrepen.

**Arte.** Las mascotas incluidas son **Uxni** (la predeterminada) y **Nox**, packs v2 en el mismo formato que cualquier otro (`static/pets/<id>/`): hoja de 8 x 11 cuadros — filas 0-8 con una animacion de estado por fila, filas 9-10 con las 16 poses de mirada. No se generan ni se dibujan en codigo — se reemplazan cambiando los archivos de esa carpeta. Que packs se incluyen lo declara `src/lib/pets/bundled.ts` (una lista de ids); ninguno recibe trato especial en el renderer.

**Los estados caducan, no se espejan.** Una mascota que refleja `working` literalmente corre sin pausa lo que dure la tarea: se lee como un spinner y tapa los estados que si requieren a la persona. Cada estado tiene una **vida util** medida desde que el agente **entro** en el (un hook que dispara en cada llamada a herramienta no puede renovarla): **ocupado 3 min**, **te-necesita / bloqueado / listo 30 min**. Misma idea que el `RUNNING_LIFETIME` de la implementacion de referencia.

**Pero una vida util no es una amnesia.** Un estado que agota su vida util mientras su agente **sigue reportando** (un hook en los ultimos 90 s) vuelve a empezar el reloj en vez de desaparecer (`decayVerdict`). Evitar el spinner es trabajo de la *animacion* — un estado toca su fila tres veces y se asienta en idle —, asi que caducar ademas el estado solo conseguia que la mascota descansara encima de trabajo vivo, y **apuntando a ninguna parte**: el destino del clic caduca con el estado, de modo que tocar a la mascota a media tarea larga no llevaba a ningun lado. Un agente que se calla — termino, se colgo, cerraste la terminal — caduca igual que antes.

**Packs generados: rejilla y animaciones deducidas.** Un pack de `hatch-pet` (lo que producen `/hatch` y las galerias de la comunidad) trae solo id, descripcion y ruta de la hoja: el layout es convencion del formato, no dato por pack. Ambas mitades se recuperan de la imagen — la **rejilla** de sus dimensiones (los v2 son 8 x 11 = 1536 x 2288, los antiguos 8 x 9; asumir cortaria cada cuadro en el offset equivocado) y las **animaciones** del orden convencional de filas de la implementacion de referencia, con sus **conteos de cuadros por fila** declarados (las filas suelen ir a medias — un saludo generado son 4 cuadros en una rejilla de 8 — y animar el resto en blanco hace parpadear a la mascota). Dos detalles importan: **`running` es la fila 7** (animacion en el sitio), no la fila 1 (una carrera que *se desplaza*, para una mascota que camina por el escritorio) — cablearlo a la fila 1 hace que la mascota esprinte toda la tarea; cada animacion de estado es **su fila repetida tres veces seguida de los cuadros de idle**, con el bucle volviendo al tramo de idle (la mascota reacciona y luego se calma, en vez de interpretar un estado mientras dure); y los cuadros llevan **duraciones individuales**, no una tasa fija: el idle sostiene sus poses de reposo 1.68 s y 1.92 s y pasa por los intermedios en 0.66 s — una respiracion cada **6.6 s**, donde un bucle plano a 8 fps dura 0.75 s y se ve frenetico. Las filas de estado se reproducen a los tiempos crudos de la referencia (120-150 ms por cuadro) **multiplicados por `STATE_PACE` (1.3)**, un unico ritmo para todo gesto: junto a un idle que respira cada 6.6 s, la fila cruda se veia como un tic (todas las vistas previas salvo Descansando "demasiado rapidas"), pero el tope del otro lado resulto ser el que manda — pasado ~un quinto de segundo un cuadro sostenido deja de leerse como pose y empieza a leerse como pausa, y el gesto se vuelve mecanico. Los dos valores anteriores caian por encima de ese tope y ambos se reportaron como robotizados (2.4 → 288-360 ms por cuadro; 2.0 → 240-300); 1.3 deja el gesto en **182-195 ms**, el mismo registro que la carrera de carga (`CARRY_PACE` 1.25), que es donde se lee bien: un gesto conserva un compas algo mas largo que una carrera, como debe ser. Un pack que declare cualquiera de las dos (o su propio `fps`) se respeta tal cual.

**Fidelidad del formato.** El import re-escribe el manifiesto saneado, pero los campos que la app **no interpreta se conservan tal cual** (mapa aplanado en `PetManifest`): `spriteVersionNumber` en particular, sin el cual Codex rechaza la hoja de 11 filas de un pack v2 — un pack importado aqui y copiado de vuelta a `~/.codex/pets` sigue siendo exactamente tan valido como llego.

**Procedencia.** uxnan **incluye una sola mascota: la propia**. Cualquier otra la importa el usuario y su arte sigue siendo de su autor; la biblioteca y el dialogo de importacion lo dicen explicitamente, y cada mascota importada guarda su origen (`ORIGIN`), visible bajo su nombre.

**Costo y accesibilidad.** El render solo despierta en frontera de cuadro (una animacion de 8 fps cuesta 8 despertares/s, no 60), se detiene por completo con la ventana oculta, dibuja **un solo cuadro fijo** con `prefers-reduced-motion` (o con *Animar* apagado) y **no carga nada** hasta que las mascotas se habilitan.

Detalle de uso y formato: [`docs/pets.md`](../docs/pets.md).

---

### 1.8 Nombres de conversacion generados

La tarjeta y la pestana de una sesion muestran un **nombre generado**, no las
primeras palabras que escribio el usuario: dos sesiones abiertas con una frase
parecida serian indistinguibles en el panel. Lo produce `convtitle.rs` con el
mismo runner headless de un solo disparo que el mensaje de commit — sin API de
proveedor y sin claves, con el CLI propio del agente bajo la cuenta que el
usuario ya autentico.

**La entrada es la transcripcion del terminal de la sesion, no el prompt.** Es
una correccion deliberada de la primera version: medido contra una corrida real
de los siete agentes, **solo `claude` reporta prompt o respuesta por el hook**
(`codex`, `opencode` y `pi` mandan cadenas vacias), asi que una entrada con
forma de prompt nombraba dos agentes y se saltaba el resto en silencio. La
transcripcion es el unico material que **todos** tienen. Se recorta por la
**cola**: un terminal abre con un banner y la conversacion esta abajo, de modo
que recortar por delante entregaria el boilerplate y cortaria la tarea.

Dos agentes necesitan un trato aparte:

- **Antigravity reporta como `antigravity` pero su CLI es `agy`.** El tipo del
  hook y el id ejecutable son vocabularios distintos; mapear entre ambos es lo
  que hace que su nombrado funcione. Ademas **su payload no nombra el evento**
  —medido contra el CLI real, manda `invocationNum` / `fullyIdle` /
  `terminationReason` y ningun campo de evento—, asi que sus reportes llegaban
  sin identificar y se descartaban: nunca alcanzaba `done` y por eso nunca se
  titulaba. Como el registro ya es por evento, el nombre viaja como segundo
  argumento del reporter y llega en la cabecera `X-Uxnan-Event`.
- **Zero no emite hook**, asi que se nombra desde su propio poll. Su etiqueta
  `"ACP session"` es un placeholder que **Zero escribe solo**, no una mala
  lectura de uxnan.

El nombrado ocurre **una vez por sesion** y es best-effort: un CLI ausente, sin
saldo o un timeout deja la etiqueta existente intacta y no se reintenta —un
bucle de reintentos gastaria cuota real en algo cosmetico—. Un renombrado manual
siempre gana.

Cada agente nombra con el modelo mas barato que sepamos nombrarle
(`title_model`); el resto corre con el default de su CLI en vez de adivinar un
id que el CLI rechazaria. Verifica un id nuevo contra el `model/list` real de la
cuenta: uno equivocado no es un fallo cosmetico, la corrida falla y la sesion se
queda callada con su etiqueta vieja.

**Sobre la espera.** Medido en Windows: el arranque del CLI son ~140 ms, el
suelo de cualquier ida y vuelta al modelo son ~3.3 s, y una transcripcion
completa nombra en ~7.5–9 s. Encoger la transcripcion **no** acelera (1800 / 900
/ 500 caracteres caen en el mismo rango) y empeora el titulo —con 500 perdio el
tema por completo—. El tiempo es del modelo, asi que la entrada se queda en el
tamano que mejor nombra.

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
> verificado, reusa `agentcli`) y tools MCP de orquestacion en `control/` (§1.6).

### 3.1 Modelo: corrida (`Run`) = grafo de pasos (`Step`)

- Una **corrida** es un DAG de **pasos**. Cada paso apunta a un agente, tiene un
  prompt (con plantilla de contexto), declara `dependsOn`, y lleva su propio estado
  + salida capturada. Ids de paso cortos y estables (`s1`, `s2`, …).
- **Tipos de paso** (`kind`): `interactive` (escribe en el PTY de un agente vivo),
  `headless` (corre un CLI instalado en modo print), `gate` (compuerta HITL).
- El motor es un **scheduler determinista** (tick ~700 ms + eventos): promueve
  `pending`→`ready` cuando todas las dependencias estan `completed` (o `skipped` si
  una fallo/omitio), despacha `ready` hasta el tope de concurrencia de la
  politica de recursos (`orchestrationConcurrency`), detecta
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
  agentes inyectables (claude/codex/opencode). **Headless** → output = **stdout
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

- El ADE registra en cada agente que lanza (junto a las tools del navegador, §1.6)
  las tools MCP `orchestration_report_result` / `orchestration_report_progress`
  (entradas `orchestration/reportResult|reportProgress` del catalogo, §1.6). El
  agente pasa su `UXNAN_AGENT_ID`; el servicio en `control/services/orchestration.rs` emite un evento
  `agent:orchestration` que el motor frontend atribuye al paso interactivo en curso
  (backend tonto; el modelo de corrida vive 100% en TS). Esto da **salida
  estructurada** de agentes interactivos, mejor que el `summary` grueso. Para que el
  caso comun funcione sin que el usuario conozca la tool, el motor **anexa un
  recordatorio corto al prompt** de un paso interactivo — pero **solo** cuando ese
  paso alimenta a otro *y* el agente realmente tiene la tool (registracion MCP activa
  y es uno de los agentes registrados: claude/codex/opencode). Para cualquier
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
  Y nunca se entrega a una terminal que **aun no dibujo y se asento**
  (`readyToReceive`): pegar en una shell que arranca el agente pierde el mensaje.

### 3.9 Corridas conducidas por un coordinador (grupo `orchestrate` v2)

> **Estado: IMPLEMENTADO.** Sin motor paralelo: una corrida conducida **es** una
> corrida, sus tareas **son** pasos, la pregunta de un worker **es** una compuerta,
> y todo se ve en la consola de Runs, donde la persona puede intervenir.

- **Quien conduce.** `Run.driven` marca la corrida como conducida (con la terminal
  del coordinador cuando la creo un agente lanzado; sin ella cuando la conduce una
  persona desde `uxnan-cli`). Una corrida conducida arranca `running` vacia y
  **solo termina con `run/finish`** (resultado + resumen): un DAG vacio o todo
  terminado es "esperando la siguiente tarea", no "hecho". El motor no deriva su
  estado terminal ni despacha solo sus pasos interactivos: una tarea interactiva
  espera en `ready` a `worker/start`; una `headless` (con agente) la corre el motor
  solo, como hoy, y el coordinador lee su resultado en la bandeja.
- **Despacho y autoridad de finalizacion.** Cada despacho de un paso acuña un
  `dispatchId` (`<paso>.<intento>`), nuevo en cada reintento. El reporte de un
  worker (`orchestration/reportResult` con `taskId`, `dispatchId`, `outcome`) cierra
  la tarea **solo si nombra el despacho vigente**; uno viejo se rechaza como
  obsoleto (`accepted: false`), asi el reporte tardio de un worker reintentado nunca
  cierra la tarea nueva. `outcome: failure|blocked` falla la tarea respetando su
  politica de reintento. Un worker que se queda ocioso sin reportar cierra por la
  senal de hooks tras una **gracia de 60 s** (un CLI suele terminar el turno un
  instante antes de la llamada a la tool que lleva el reporte); una terminal que
  sale falla la tarea.
- **`worker/start`.** El backend resuelve el worktree (el del coordinador, uno nuevo
  en rama nueva con la politica de ubicacion del proyecto — rama por defecto
  `run/<run>/<tarea>` —, o uno dado), abre la terminal con el agente
  (`terminal/create`), y la ventana ata la tarea a esa pestaña, acuña el despacho y
  encola el **preambulo** + el prompt resuelto (`workerPreamble`, `run.ts`): quien
  es dentro de la corrida, reportar exactamente una vez con sus ids, y como
  preguntar (`question_ask`, con la forma `uxnan-cli` entre parentesis para un
  agente sin tools). Es una pestaña normal con su TUI completa.
- **Bandeja.** `Run.inbox` (FIFO, `deliveryId` monotono, persistida con la corrida):
  `worker_done` (con el resultado), `worker_failed` (con el error), `question`,
  `status` (progreso, o "intento n fallo; la tarea vuelve a ready"). Un mensaje
  permanece hasta el `ack`; un reinicio no pierde nada. `inbox/check --wait` duerme
  en el notificador de cambios de la app (`control_notify` desde la ventana, el mismo
  `AppState.agent_changes` de `agent/wait`), ≤15 s por llamada, sin sondeo.
  **En la consola**, el detalle de una corrida conducida (`RunInbox.svelte`)
  muestra quien la conduce — el agente y la pestana del coordinador, con un
  boton para revelarla; "desde una shell" cuando la conduce `uxnan-cli`; el
  resultado y el resumen cuando el coordinador la termino — y la **bandeja**:
  cada mensaje aun no acusado con su tipo, el paso, el despacho y su texto
  (desplegable). Vacia significa "leido", no "inactivo". La tarjeta del listado
  dice `dirigida` y cuantos mensajes esperan; una corrida conducida no se
  re-ejecuta desde la consola (sus tareas las creo el coordinador).
- **Preguntas = compuertas.** `question/ask` (desde la terminal del worker: el
  backend identifica su tarea por su propio id) crea un paso `gate` con
  `resolver: coordinator` y `askedBy: {stepId, dispatchId}`, lo pone `running` sin
  notificacion nativa (es del coordinador; la persona lo ve igual en la consola y
  puede responderlo) y lo publica en la bandeja con sus opciones; la llamada espera la
  respuesta (≤15 s, luego *timeout* con `questionId` para seguir esperando).
  `question/answer` resuelve la compuerta (`approve` con la respuesta como nota, o
  `reject`); el worker en espera la recibe al instante.
- **Presupuesto de lanzamiento.** Cada agente que la superficie lanza
  (`terminal/create` o `worktree/create` con `agent`, `worker/start`) cuenta contra
  la **concurrencia de orquestacion de la politica de recursos** — el mismo tope
  con el que despacha el motor (`orchestrationRun.concurrencyCap`). Con tantos
  agentes vivos como permite el tope, el lanzamiento se rechaza con `-32005`
  *busy* (`data.live`, `data.cap`) **antes de crear nada** (`launch/admit` por el
  puente antes de un worktree con agente); una terminal sin agente y el clic de
  una persona no se presupuestan. Es la mitad determinista del plan 023 aplicada
  en el unico sitio que comparten las tres puertas.
- **Lanzamiento desatendido.** Un lanzamiento desatendido anade al CLI su
  **modo automatico revisado** — nunca su bandera de saltarse todo — en dos
  niveles (`src/lib/agentUnattended.ts`, por *basename* del comando):
  `reviewed` (toda herramienta se aprueba bajo un revisor: `claude
  --permission-mode auto`, `codex --approve-for-me`, `qwen --approval-mode
  auto`, `ante --permission-mode auto`, `kimi --yolo`, `devin --permission-mode
  smart`, `goose` via `GOOSE_MODE=smart_approve` en su entorno) o `editsOnly`
  (solo las ediciones de archivos; shell y MCP siguen preguntando: `agy --mode
  accept-edits`, `grok --permission-mode acceptEdits`, `command-code
  --accept-edits`, `vibe --agent accept-edits`, `omp --approval-mode write`,
  `autohand --yes`). Un CLI sin nivel — solo bandera de saltarse todo, o un
  nivel que existe solo en su subcomando `exec` y no en la TUI que Uxnan lanza
  (`zero`, `droid`) — queda ausente. Lo anadido viaja por la misma ruta que la
  configuracion del perfil: argumentos tras los suyos, una variable junto a su
  entorno (`extraArgs` / `extraEnv` en `launchAgent`). **Un worker es
  desatendido por diseno:** `worker/start` sin `unattended` sigue el ajuste del
  agente (`AgentProfile.workersUnattended`, Settings → Agents → *Automatic mode
  when launched by an agent*, encendido salvo que la persona lo apague);
  `unattended: false` (`--attended`) lo lanza tal como esta configurado.
  `terminal/create` y `worktree/create` con agente siguen siendo opt-in
  (`unattended: true`). Un perfil cuyos args o entorno ya eligen modo se
  respeta siempre. El recibo dice `unattended: applied | partial | configured |
  unsupported`; ausente si el lanzamiento no fue desatendido.
- **Alcance y auditoria.** Las corridas no son por proyecto; `worker/start` con
  `new` crea el worktree en el proyecto del llamador (o el indicado), sujeto al
  alcance del token. Todo movimiento del coordinador salvo las lecturas y las
  esperas (`task/list`, `inbox/check`) y la linea de progreso queda en
  `control-audit.log` con recibo e idempotencia.
- **Verificado en vivo:** un coordinador Claude Code, solo con las tools MCP, creo
  la corrida y la tarea, lanzo un worker Claude Code en un worktree nuevo, espero la
  bandeja y cerro con el resultado del worker; y un worker pregunto por `question_ask`,
  el coordinador respondio y el worker reporto la respuesta textual.

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
                                                       [Mascota (§1.7)]
                                                              |
                                                              v
                                                  [pets.rs: <app-data>/pets/]

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
