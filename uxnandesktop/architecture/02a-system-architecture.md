# 02a — Arquitectura del Sistema

> Documento de arquitectura del sistema para el Uxnan Desktop ADE.
> Cubre el modelo de tres actores, modelo de datos, navegacion, layout, review, conexiones y persistencia.
> Derivado de las secciones 2, 3, 4, 6.3 y 7 del documento de arquitectura original.

---

## 1. Arquitectura de Tres Actores

El ADE con Tauri 2 tiene tres "actores" principales que necesitan mantenerse sincronizados. Cada actor es **fuente de verdad** (source of truth) para un dominio distinto, y la comunicacion entre ellos fluye a traves de canales bien definidos.

### 1.1 Diagrama de Tres Actores

```
+-------------------+
| Backend Rust      |  <-- Fuente de verdad para:
| (Tauri Core)      |      - Estado de repos/worktrees
|                   |      - PTY management (portable-pty)
|                   |      - Git operations (git2 + CLI)
|                   |      - Persistencia a disco (serde)
|                   |      - Hooks de agentes (HTTP server)
+--------+----------+
         |
         | Tauri Commands (invoke) + Events (emit/listen)
         |
+--------v----------+
| Frontend Svelte   |  <-- Fuente de verdad para:
| (Webview)         |      - Estado de la UI ($state, $derived)
|                   |      - Layout de tabs/splits
|                   |      - Seleccion activa
|                   |      - Interaccion del usuario
+--------+----------+
         |
         | Tauri Events (PTY I/O streaming)
         |
+--------v----------+
| Procesos PTY      |  <-- Fuente de verdad para:
| (Agentes CLI)     |      - Output del agente
|                   |      - Estado del proceso
|                   |      - Modificaciones a archivos
+-------------------+
```

### 1.2 Backend Rust (Tauri Core)

El backend Rust es la fuente de verdad para todo lo que toca el sistema de archivos, los procesos y la persistencia:

- **Estado de repos/worktrees**: La lista de repositorios registrados, sus worktrees, metadatos y relaciones jerarquicas viven en structs de Rust serializados con Serde.
- **PTY management**: Cada pseudoterminal es creado y gestionado por el backend Rust usando la crate `portable-pty`. El backend mantiene los buffers async con `tokio::sync::mpsc` para tabs ocultos.
- **Git operations**: Las operaciones de alta frecuencia (status, diff, stage, log) usan la crate `git2` (bindings de libgit2). Las operaciones de worktree (`git worktree add/remove/list`) y de red (fetch, push) usan git CLI como subproceso via `tokio::process::Command`.
- **Persistencia a disco**: Serde serializa el estado completo a JSON en el directorio de datos de la aplicacion (`app.path().app_data_dir()`). Escritura atomica con write-rename y backups rotativos.
- **Hooks de agentes**: Un servidor HTTP local (axum/hyper, async con Tokio) recibe POST de los agentes CLI para reportar su estado. El backend cachea, normaliza y difunde esos estados al frontend.

### 1.3 Frontend Svelte 5 (Webview)

El frontend es la fuente de verdad para todo lo que el usuario ve e interactua:

- **Estado de la UI**: Usa `$state` y `$derived` (Runes de Svelte 5) para estado reactivo. No se necesitan librerias de estado externas como Zustand o Redux.
- **Layout de tabs/splits**: El arbol binario recursivo de splits y la configuracion de TabGroups viven en el estado reactivo de Svelte.
- **Seleccion activa**: Que worktree, tab, pane y archivo estan seleccionados es responsabilidad exclusiva del frontend.
- **Interaccion del usuario**: Eventos de teclado, mouse, drag-and-drop y comandos de la paleta de comandos se procesan en el webview.

### 1.4 Procesos PTY (Agentes CLI)

Los procesos PTY son la fuente de verdad para lo que ocurre dentro de cada terminal:

- **Output del agente**: Todo lo que el agente imprime (stdout/stderr) es la unica fuente de verdad sobre su comunicacion. El ADE no intercepta ni modifica la salida.
- **Estado del proceso**: Si el proceso esta corriendo, terminado, o fue interrumpido es algo que solo el PTY sabe. El backend Rust detecta esto via la crate `portable-pty`.
- **Modificaciones a archivos**: Los agentes escriben directamente en el filesystem del worktree. El ADE detecta los cambios via polling de `git2::Repository::statuses()`, no via interceptacion del I/O del agente.

### 1.5 Tauri Commands vs Tauri Events

La comunicacion entre backend y frontend usa dos mecanismos distintos, cada uno con su proposito:

**Tauri Commands (`invoke`)** — Request/Response:
- Se usan para operaciones donde el frontend necesita enviar datos al backend y esperar una respuesta.
- Definidos en Rust con `#[tauri::command]` y llamados desde JavaScript con `invoke()`.
- Ejemplos: `invoke('pty_write', { ptyId, data })`, `invoke('worktree_create', { ... })`, `invoke('git_stage', { path })`.
- Patron: el frontend pide algo, el backend lo ejecuta y devuelve el resultado.

**Tauri Events (`emit`/`listen`)** — Streaming unidireccional:
- Se usan para flujos continuos de datos del backend al frontend, donde no hay un request explicito.
- El backend emite con `emit()` y el frontend escucha con `listen()`.
- Ejemplos: `listen('pty:output:{id}')` para output de terminal, `listen('git:status-changed')` para cambios de git, `listen('agent:status-changed')` para estado de agentes.
- Patron: el backend produce datos continuamente y el frontend reacciona.

> **Diferencia clave con Electron**: En Electron, la comunicacion main<->renderer es via `ipcMain`/`ipcRenderer` con serializacion JSON. En Tauri 2, los commands usan serializacion Serde (mas rapido y type-safe), y los events son mas eficientes porque evitan el overhead de serializar respuestas completas — perfecto para streaming de bytes de PTY.

---

## 2. Modelo de Datos Jerarquico

El ADE organiza el trabajo en una jerarquia de entidades que refleja como los desarrolladores trabajan con multiples repositorios y multiples tareas en paralelo.

### 2.1 Diagrama Jerarquico

```
Grupo de Proyectos (opcional, organizacional)
  +-- Repositorio
       +-- Worktree Principal (el checkout original)
       +-- Worktree A (checkout paralelo - rama feature-x)
       +-- Worktree B (checkout paralelo - rama fix-bug-y)
       +-- Worktree C (checkout paralelo - rama refactor-z)
```

### 2.2 Grupo de Proyectos

Agrupacion visual y colapsable de repositorios. Sirve para organizar la sidebar cuando el usuario trabaja con muchos repositorios. Es **opcional** — un repositorio puede existir sin pertenecer a ningun grupo. Caracteristicas:

- Agrupacion puramente organizacional (no afecta el filesystem).
- Colapsable en la sidebar para reducir ruido visual.
- Permite organizar repos por equipo, cliente, dominio o cualquier criterio del usuario.

### 2.3 Repositorio

Representa un repositorio git (o carpeta no-git). Cada repositorio almacena:

| Campo | Descripcion |
|-------|-------------|
| Ruta en el filesystem | Ruta absoluta al directorio del repositorio en disco |
| Nombre visible | Nombre que el usuario ve en la sidebar (editable vía `repo_update`; **solo** cambia la etiqueta de la tarjeta, la carpeta en disco conserva su nombre real) |
| Tipo | `git` (repositorio git) o `folder` (carpeta simple sin git) |
| Icono del proyecto | Icono opcional de la tarjeta (`icon`): un `data:` URL incrustado (imagen de archivo/URL/avatar de la cuenta del host git, rasterizada a un PNG cuadrado pequeño) o vacío = icono por defecto. Se fija con `repo_update`; el avatar del host se resuelve con `repo_remote_owner` + `image_fetch_data_url` |
| Iconos por rama | Mapa `branchIcons` (rama → `data:` URL o clave de icono integrado), fijado con `repo_set_branch_icon`; permite un icono distinto por worktree/rama |
| Configuracion de worktrees | Donde se crean los worktrees asociados (directorio destino) |
| Grupo | Referencia al Grupo de Proyectos al que pertenece (opcional) |

### 2.4 Worktree (Espacio de Trabajo)

Representa un checkout independiente de git. Es la **unidad fundamental de aislamiento** del ADE — cada tarea, feature o fix vive en su propio worktree con su propio directorio en disco.

| Campo | Descripcion |
|-------|-------------|
| Referencia al repositorio padre | A que repo pertenece este worktree |
| Nombre descriptivo | Nombre asignado por el usuario para identificar la tarea |
| Rama de git actual | La branch que tiene checked out este worktree |
| Creado por el ADE | Flag booleano: `true` si fue creado por el ADE, `false` si existia previamente |
| Timestamp de creacion | Cuando se creo el worktree |
| Timestamp de ultima actividad | Cuando hubo actividad por ultima vez (PTY output, cambio de archivos) |
| Agente asignado | Que agente CLI se lanzo al crear el worktree (si aplica) |
| Estado de lectura | Si el usuario ha revisado los cambios desde que el agente termino. Permite marcar como "no-leido" cuando el agente termina mientras el usuario no esta mirando |
| Issue/PR vinculado | Referencia opcional a un issue o pull request vinculado a esta tarea |
| Relaciones padre-hijo | Para agentes que generan sub-tareas: un worktree puede ser hijo de otro worktree |

### 2.5 Tab

Cada tab vive dentro de un TabGroup y representa una unidad de contenido en el area central.

| Campo | Descripcion |
|-------|-------------|
| Tipo de contenido | `terminal` (emulador PTY), `editor` (CodeMirror 6), `diff` (visor de comparacion). El navegador integrado (`browser`) **no** es un tab central: vive en un panel lateral derecho — ver §4.2b |
| Nombre visible | Etiqueta mostrada en la pestaña. Renombrable desde el menú contextual de la pestaña: terminales/diff/commit usan una etiqueta libre (`customTitle`, persistida en terminales); un tab de **archivo** renombra el archivo real en disco (`fs_rename`, misma carpeta) con confirmación y aviso de cambio de extensión. "Cerrar todas las pestañas" cierra las del workspace activo |
| TabGroup padre | A que TabGroup pertenece este tab |

### 2.6 TabGroup

Coleccion de tabs dentro de una region de split del area central.

| Campo | Descripcion |
|-------|-------------|
| Tabs | Lista ordenada de tabs que contiene |
| Tab activo | Cual de los tabs esta visible actualmente |
| Region de split | Posicion dentro del arbol binario de splits |

### 2.7 Pane

Un pane individual dentro de un tab de terminal. Cada pane es un proceso PTY independiente.

| Campo | Descripcion |
|-------|-------------|
| PTY ID | Identificador unico del proceso PTY en el backend Rust |
| Posicion de split | Posicion dentro del arbol de splits internos del tab (horizontal/vertical, ratio) |
| Directorio de trabajo | Ruta del worktree donde corre el shell/agente |

### 2.8 AgentState (Estado de Agente)

Representa el estado reportado por un agente CLI en un worktree.

| Estado | Significado | Indicador Visual |
|--------|-------------|-----------------|
| `working` | Procesando activamente | Punto verde animado |
| `blocked` | Esperando respuesta de otro sistema | Punto amarillo |
| `waiting` | Esperando input del usuario | Punto naranja parpadeante |
| `done` | Termino su tarea | Punto azul/check |

Campos adicionales del estado:

| Campo | Descripcion |
|-------|-------------|
| Timestamps | Cuando se reporto el estado por primera vez y ultima actualizacion |
| TTL | Los estados se persisten con un TTL de 7 dias. Al cabo de 7 dias sin actividad, el registro se elimina del cache |
| Staleness | Si un agente no reporta estado en 30 minutos, se marca como "stale" y se muestra con opacidad reducida en la UI |

---

## 3. Sidebar Izquierda — Modelo de Navegacion

La sidebar izquierda es el **centro de navegacion y organizacion** del ADE. Permite al usuario gestionar multiples repositorios y multiples worktrees dentro de cada repositorio, con visibilidad inmediata del estado de cada agente.

Se organiza en **cuatro regiones verticales** (`LeftSidebar.svelte`):

1. **Cabecera de marca**: logo, nombre de la app y el distintivo *Alpha*; es
   ademas el area de arrastre de la ventana (no hay barra de titulo nativa).
2. **Acciones rapidas**: unicamente **Buscar** (abre la paleta de
   proyectos/worktrees).
3. **Proyectos**: la cabecera con sus acciones (agregar, refrescar, ordenar,
   nueva terminal) y el arbol proyectos → worktrees (o las calles por estado).
4. **Pie de perfil** (`SidebarProfile.svelte`): una tarjeta de identidad
   configurable —avatar, nombre y una linea de descripcion debajo— al estilo del
   *sidebar footer* de shadcn. Al pulsarla despliega **hacia la derecha**
   (anclada por abajo, para no salirse del borde inferior) un menu con
   **GitHub** y **Configuracion** —cuyos accesos vivian antes en las acciones
   rapidas— mas **Editar perfil**. El badge de notificaciones de GitHub se
   muestra aqui: un punto sobre el avatar y el contador en el item del menu.

   El perfil se persiste en `AppSettings.profile` (`SidebarProfile`: `name`,
   `icon`, `description`; forma propiedad del frontend, guardada de forma opaca
   en el backend, ausente por defecto). El **avatar reutiliza el mismo
   `IconPicker` / `EntityIcon` que los iconos de las tarjetas de proyecto**, por
   lo que admite un glifo integrado (con color de acento) o una imagen propia
   (archivo o URL) rasterizada a un `data:` URL. Se edita en
   `SidebarProfileDialog.svelte`: el icono se aplica al instante y el
   nombre/descripcion al guardar (`app.updateSidebarProfile`).

### 3.1 Tarjetas de Worktree

Cada worktree se muestra como una tarjeta compacta que presenta:

- **Nombre de la rama**: Identidad visual principal de la tarjeta.
- **Indicadores de estado del agente**: Punto de color con animacion segun el estado (working, waiting, blocked, done).
- **Badges contextuales**: PR abierto, issue vinculado, cambios sin revisar.
- **Indicador de no-leido**: Cuando el agente termino y el usuario no ha revisado los cambios.
- **Acciones rapidas**: Fijar/desfijar, menu contextual (eliminar, renombrar, archivar, relanzar agente).

### 3.2 Modos de Agrupacion

El usuario puede agrupar los worktrees de varias formas:

**Por estado** (predeterminado):
- **Fijados (Pinned)**: Worktrees que el usuario marco como importantes.
- **Recientes (Recent)**: Worktrees con actividad reciente, ordenados por timestamp.
- **Todos (All)**: Lista completa de worktrees.
- **Archivados (Archived)**: Worktrees finalizados que el usuario archivo.

**Por linaje** (para orquestacion):
- Worktrees hijos agrupados visualmente bajo su worktree padre.
- Util cuando un agente coordinador genera sub-tareas en worktrees independientes.
- Muestra la relacion padre-hijo del modelo de datos.
- **Estado:** la relacion coordinador→workers ya existe (en memoria) y se
  visualiza hoy en la **consola de orquestacion** (`02d` §3.4), no anidada en este
  arbol de la sidebar. Llevar el linaje a este modo de agrupacion del sidebar
  queda como follow-up (`FOR-DEV.md`).

**Por estado de trabajo** (tipo Kanban):
- **Por hacer (Todo)**: Worktrees creados pero sin agente activo.
- **En progreso (In Progress)**: Worktrees con agentes en estado `working` o `blocked`.
- **En revision (Review)**: Worktrees con agentes en estado `done` y cambios sin revisar.
- **Completado (Done)**: Worktrees revisados y mergeados.

### 3.3 Diagrama de Conexiones de Modulos

```
[Modulo de Persistencia] <---> [Estado de Repositorios y Worktrees]
         |                               |
         v                               v
[Descubridor de Repos] <--> [Motor Git (worktree list)]
                                         |
                                         v
                              [Modulo de Sidebar UI]
                                    |         |
                                    v         v
                         [Estado de Agentes]  [Motor de Terminales]
```

- **Modulo de Persistencia**: Guarda y carga la lista de repos, worktrees y sus metadatos via Serde a JSON.
- **Motor Git**: Ejecuta `git worktree list` para descubrir worktrees existentes. Usa `git2` para status y `tokio::process::Command` para operaciones de worktree.
- **Estado de Agentes**: Alimenta los badges e indicadores de la sidebar. Se actualiza via Tauri events desde el servidor de hooks del backend.
- **Motor de Terminales**: Se activa al cambiar de worktree (muestra/oculta terminales). Los PTYs siguen corriendo en background cuando no estan visibles.

---

## 4. Area Central — Modelo de Layout

El area central es donde ocurre la interaccion directa con los agentes. Es un **multiplexor de terminales con capacidad de split y tabs**, similar a tmux pero integrado en la interfaz grafica con conciencia de agentes.

### 4.1 Arbol Binario de Splits (Recursivo)

El area central se organiza como un **arbol binario recursivo** de paneles:

```
TabGroup Layout (por worktree)
  +-- Split Horizontal
       +-- Hoja (TabGroup 1: Terminal con Claude Code)
       +-- Split Vertical
            +-- Hoja (TabGroup 2: Terminal con bash)
            +-- Hoja (TabGroup 3: Terminal con Codex)
```

Cada **hoja** del arbol contiene un **grupo de tabs** (TabGroup), y cada tab puede ser un tipo de contenido distinto. Los splits tienen ratios ajustables mediante drag-to-resize.

### 4.2 Dos Niveles de Splitting

Esto es una distincion importante que diferencia al ADE de un terminal convencional:

**Nivel 1 — Splits de TabGroup (nivel alto):**
- Divide el area central en regiones independientes.
- Cada region tiene su propia barra de tabs.
- Permite ver terminales de diferentes propositos lado a lado.
- Ejemplo: Claude Code a la izquierda, tests a la derecha.

**Nivel 2 — Splits de Pane dentro de un Tab (nivel bajo):**
- Dentro de un mismo tab de terminal, divide el area en multiples panes PTY.
- Cada pane es un proceso independiente con su propio shell/agente.
- Similar a como funcionan los splits en Vim o tmux.

### 4.2b Navegador integrado (tab `browser`) — implementado

El tipo de contenido `browser` (webview embebido) **está implementado** como un
navegador *de desarrollo* ligero: para previsualizar/depurar lo que construyen los
agentes y abrir los enlaces que generan — no un navegador de uso general.

- **Motor:** un `WebviewWindow` sin marco, **propiedad de** (owner = la ventana
  principal) y **acoplado a** uxnan, que contiene la página (`src-tauri/src/browser.rs`
  + `BrowserPanel.svelte`). Es un webview real del SO (Chromium/WebView2 en Windows)
  → **carga cualquier sitio** (Google incluido, sin el bloqueo de iframe) y trae
  **DevTools reales**, reusando el motor que la app ya carga (ligero). La barra de
  herramientas vive en el DOM del panel; la ventana de la página se posiciona sobre
  el rect del panel y se re-posiciona en cada move/resize de la app (mediante
  `set_position`/`set_size`, API estable). Se crea perezosamente al abrir y se
  destruye al cerrar (no persiste al reiniciar). *Decisión de diseño:* se
  descartaron (a) el *child webview* nativo (multiwebview `unstable`) porque
  **congelaba la app** en Windows (`add_child` bloqueaba el hilo principal), y (b)
  un `<iframe>` por ser limitado (lo bloquea `X-Frame-Options`, sin DevTools).
- **Política de enlaces (`BrowserSettings`):** un único punto de decisión
  (`browser::route_url`, expuesto como el comando `open_url`) enruta cada enlace
  según `linkPolicy` (`internal` → tab interno vía el evento `browser:open-url`,
  `external` → navegador del SO vía `tauri-plugin-opener`/`open_external`, `ask` →
  el usuario elige). Un navegador deshabilitado siempre va a externo. Campos:
  `enabled`, `linkPolicy`, `allowAgents`, `terminalLinks`, `homepage` (todos con
  `#[serde(default)]`).
- **Agentes:** con `enabled && allowAgents`, cada terminal de agente recibe
  `UXNAN_BROWSER_URL` + `UXNAN_BROWSER_TOKEN` y un shim `$BROWSER`
  (`static/hooks/uxnan-browser.{sh,cmd}`). Una URL que el agente abre se hace `POST`
  a la ruta **`/browser`** del servidor de hooks local (`hooks.rs`), que la enruta
  por la misma política. Mismo patrón que `UXNAN_HOOK_*`.
- **Terminal:** las URLs impresas en la terminal son clicables con **Ctrl/Cmd+clic**
  (`@xterm/addon-web-links`) y pasan por `open_url` (toggle `terminalLinks`).

### 4.3 Ejemplo de Layout Complejo

```
Ejemplo de layout complejo:
+------------------------------------------+
| Tab: Claude Code  | Tab: Tests           |
|-------------------+----------------------|
| +-------+-------+ |                      |
| | Pane  | Pane  | | Pane unico           |
| | (pty1)| (pty2)| | (pty3: npm test)     |
| |       |       | |                      |
| +-------+-------+ |                      |
+-------------------+----------------------+
  TabGroup 1 (split V interno)  TabGroup 2
         \________________________/
              Split Horizontal
```

En este ejemplo:
- El area central esta dividida en un **Split Horizontal** (nivel alto) con dos TabGroups.
- **TabGroup 1** tiene un tab "Claude Code" que internamente tiene un **Split Vertical** (nivel bajo) con dos panes PTY.
- **TabGroup 2** tiene un tab "Tests" con un solo pane PTY ejecutando `npm test`.

### 4.4 Tipos de Contenido por Tab

| Tipo | Tecnologia | Descripcion |
|------|-----------|-------------|
| **Terminal** | xterm.js + portable-pty | Emulador de terminal completo conectado a un proceso PTY. Renderiza con WebGLAddon (DOM fallback). |
| **Editor** | CodeMirror 6 | Editor de codigo para edicion rapida. Mas ligero que Monaco (~300KB vs ~5MB). Extensible con plugins. |
| **Visor de Diff** | CodeMirror 6 + extension de diff | Comparador de cambios inline o side-by-side. |
| **Navegador Embebido** | Webview | Para previsualizar aplicaciones web en desarrollo. |

### 4.5 Diagrama de Conexiones de Modulos

```
[Motor de Layout] <---> [Arbol de Splits/TabGroups]
       |                          |
       v                          v
[Gestor de Tabs]           [Gestor de Panes]
       |                          |
       v                          v
[Fabrica de Contenido]     [Conexion PTY <-> xterm]
  (terminal/editor/diff)         |
                                 v
                         [Backend Rust: PTY Manager]
                         (portable-pty + tokio)
                                 |
                                 v
                         [Shell/Agente CLI]
```

- **Motor de Layout**: Almacena y renderiza el arbol binario de splits con ratios ajustables. Vive en el estado reactivo de Svelte (`$state`).
- **Gestor de Tabs**: Maneja la barra de tabs por cada TabGroup (crear, cerrar, reordenar, MRU — most recently used).
- **Gestor de Panes**: Maneja los splits internos dentro de un tab de terminal.
- **Conexion PTY <-> xterm**: Establece el flujo bidireccional entre xterm.js (webview) y el PTY (backend Rust) via Tauri commands y events.
- **Backend Rust: PTY Manager**: Vive en el backend Rust, crea y destruye pseudoterminales con `portable-pty`, gestiona buffers async con Tokio para tabs ocultos.

---

## 5. Sidebar Derecha — Modelo de Review

La sidebar derecha es el **centro de revision de cambios**. Su proposito es presentar al usuario todos los cambios que los agentes (o el mismo) han hecho en el worktree activo, y darle herramientas para revisar, aprobar, descartar o modificar esos cambios antes de commitearlos.

### 5.1 Arbol de Estado Git

El componente principal es un arbol de archivos modificados, organizado por area:

```
Cambios (unstaged)
  +-- archivo-a.ts  [modificado]
  +-- archivo-b.ts  [anadido]
  +-- archivo-c.ts  [eliminado]

Staged
  +-- archivo-d.ts  [modificado]

Sin rastrear (untracked)
  +-- archivo-nuevo.ts
```

### 5.2 Informacion por Entrada de Archivo

Cada entrada del arbol muestra:

| Campo | Descripcion |
|-------|-------------|
| **Ruta del archivo** | Ruta relativa dentro del worktree |
| **Icono de tipo** | Indica si el archivo fue anadido, modificado, eliminado o renombrado |
| **Conteo de lineas** | Lineas anadidas (+) y eliminadas (-) |
| **Estado de conflicto** | Si aplica: conflicto de merge, rebase o cherry-pick |
| **Acciones rapidas** | Botones para stage, unstage, descartar cambios |

### 5.3 Visor de Diffs

Al seleccionar un archivo del arbol, se abre el visor de diffs con dos modos:

**Inline (unificado):**
- Muestra las lineas anadidas y eliminadas en un solo flujo vertical.
- Mas compacto, mejor para cambios dispersos en el archivo.

**Side-by-side (lado a lado):**
- Muestra el archivo original a la izquierda y el modificado a la derecha.
- Mejor para comparar estructura y ver el contexto completo.

### 5.4 Caracteristicas del Visor

| Caracteristica | Descripcion |
|----------------|-------------|
| **Scroll virtual** | Para changesets grandes (cientos de archivos), solo se renderizan los diffs visibles en pantalla. Los demas se cargan bajo demanda. Usa TanStack Virtual. |
| **Carga lazy** | Los diffs de archivos individuales se obtienen lazily conforme el usuario navega. Evita bloquear la UI cuando un agente modifica 50+ archivos. |
| **Navegacion por archivo** | Un arbol lateral permite saltar directamente a cualquier archivo del changeset. |
| **Timeout de proteccion** | Si un diff individual tarda mas de 30 segundos en calcularse, se aborta para no colgar la interfaz. |
| **Diffs de imagenes** | Comparacion visual antes/despues para archivos de imagen (PNG, JPG, SVG, etc.). |

### 5.5 Operaciones Sobre Cambios

Las operaciones disponibles operan a tres niveles de granularidad:

**Nivel de archivo completo:**
- Stage individual (mover a staged).
- Unstage individual (sacar de staged).
- Descartar cambios (revertir a HEAD).

**Nivel bulk (todos los archivos):**
- Stage all: Agregar todos los archivos modificados a staged.
- Unstage all: Sacar todos los archivos de staged.
- Discard all: Revertir todos los cambios a HEAD. **Con confirmacion obligatoria** para evitar perdida accidental de trabajo.

**Nivel de hunk/parcial:**
- Stage por hunk: Seleccionar bloques de cambios individuales dentro de un archivo para hacer stage parcial.
- Usa el sistema de patching de git internamente (`git2::Diff::foreach` + index manipulation).
- Permite al usuario aceptar parte de los cambios de un agente y descartar otros.

### 5.6 Anotaciones y Comentarios en Diffs

El usuario puede anadir **anotaciones a nivel de linea** en los diffs:

- Util para dejar notas al agente (ej: "revisa esta logica").
- Se persisten en el metadato del worktree (via Serde al JSON de persistencia).
- Pueden ser enviados al agente como contexto adicional en un prompt posterior.

### 5.7 Composicion de Commits

Integrada en el panel de cambios:

- **Editor de mensaje de commit**: Textarea con soporte markdown para escribir mensajes descriptivos.
- **Generacion AI del mensaje**: Un boton para que el agente genere automaticamente un mensaje de commit basado en los cambios staged. Analiza los diffs y produce un mensaje conciso.
- **Boton de accion primaria contextual**: Cambia segun el estado de la rama:
  - **Commit**: Cuando hay cambios staged.
  - **Push**: Cuando hay commits locales sin pushear.
  - **Sync**: Cuando hay commits locales y remotos pendientes.
  - **Publish**: Cuando la rama no tiene upstream remoto.

### 5.8 Tres Fuentes de Diff

El visor maneja tres fuentes de diff distintas:

| Fuente | Comparacion | Caso de uso |
|--------|-------------|-------------|
| **Uncommitted** | Working tree vs HEAD | El mas comun. Muestra los cambios que el agente acaba de hacer y aun no se han commiteado. |
| **Branch** | Rama actual vs rama base | Muestra el changeset completo de una feature branch. Util para ver todo lo que cambiara al mergear. |
| **Commit** | Un commit individual | Muestra que cambio en un commit especifico. Util para revisar el historial. |

### 5.9 Capa de Deduplicacion

Cada fuente de diff pasa por una **capa de deduplicacion** que evita calcular el mismo diff multiples veces si el usuario lo abre en diferentes contextos. Si el usuario ve el diff uncommitted de un archivo y luego lo abre en el visor de branch, el diff se reutiliza si no ha cambiado.

### 5.10 Diagrama de Conexiones de Modulos

```
[Polling de Git Status] ---> [Store Reactivo Svelte: Estado Git por Worktree]
        |                              |
        v                              v
[Backend Rust: git2/CLI]       [Arbol de Archivos UI (Svelte)]
                                       |
                                       v
                                [Visor de Diffs]
                                  |          |
                                  v          v
                           [CodeMirror 6]  [Scroll Virtual]
                                  |
                                  v
                           [Operaciones: stage/unstage/discard]
                                  |
                                  v
                           [Compositor de Commits]
```

- **Polling de Git Status**: El backend Rust ejecuta `git2::Repository::statuses()` cada pocos segundos con Tokio timers. Se pausa cuando la ventana no es visible. Los resultados se emiten al frontend via Tauri events (`git:status-changed`).
- **Store Reactivo de Svelte**: Almacena el estado por worktree (archivos modificados, staged, conflictos) usando `$state` y `$derived` de Svelte 5.
- **Visor de Diffs**: Usa CodeMirror 6 con extension de diff y carga lazy. Scroll virtual con TanStack Virtual para changesets grandes.
- **Operaciones Git**: Stage, unstage y discard se ejecutan en el backend Rust via `git2` crate o invocando git CLI como subproceso. Se invocan con Tauri commands (`invoke('git_stage', { path })`).
- **Compositor de Commits**: Combina el editor de mensaje con la accion primaria contextual. Ejecuta `git2::Repository::commit` en el backend.

---

## 6. Mapa Completo de Conexiones

Este diagrama muestra como **todos los modulos se conectan** para formar el ADE completo con el stack Rust + Tauri 2 + Svelte 5:

### 6.1 Diagrama Completo de Modulos

```
+================================================================+
|                    FRONTEND (Svelte 5 + Webview)                |
|                                                                 |
|  [Estado Reactivo Svelte 5]                                    |
|     |-- $state: Repos/Worktrees                                |
|     |-- $state: Terminales/Tabs/Layout                         |
|     |-- $state: Estado Git (por worktree)                      |
|     |-- $state: Estado de Agentes                              |
|     |-- $state: UI (sidebar, seleccion activa)                 |
|     +-- $derived: Datos computados (filtros, agrupaciones)     |
|                                                                 |
|  [Componentes UI (Svelte + shadcn-svelte + Tailwind)]          |
|     |-- Sidebar Izquierda (navega worktrees)                   |
|     |-- Area Central (xterm.js + splits + tabs)                |
|     +-- Sidebar Derecha (CodeMirror 6 diffs, staging, commits) |
|                                                                 |
|  [Suscripciones a Eventos Tauri]                               |
|     |-- listen('git:status-changed')                           |
|     |-- listen('agent:status-changed')                         |
|     |-- listen('pty:output:{id}')                              |
|     +-- listen('notification:*')                               |
+====================+============================+==============+
                     | Tauri Commands (invoke)    |
                     | Tauri Events (emit/listen) |
                     v                            v
+====================+============================+==============+
|                 BACKEND RUST (Tauri Core)                       |
|                                                                 |
|  [Tauri Commands (#[tauri::command])]                          |
|     |-- repo_add / repo_remove / repo_list / repo_update       |
|     |-- repo_set_branch_icon / repo_remote_owner               |
|     |-- worktree_create / worktree_remove / worktree_list      |
|     |-- pty_create / pty_write / pty_resize / pty_close        |
|     |-- fs_rename / image_fetch_data_url                       |
|     |-- git_stage / git_unstage / git_discard / git_commit     |
|     +-- agent_status_get / settings_update                     |
|                                                                 |
|  [Motor Git (git2 crate + CLI fallback)]                       |
|     |-- git2: status, diff, stage, log, branch ops             |
|     |-- CLI: worktree add/remove/list, fetch, push             |
|     |-- Tokio timer: polling cada 3s                           |
|     +-- Emite eventos: git:status-changed                      |
|                                                                 |
|  [PTY Manager (portable-pty + Tokio)]                          |
|     |-- Spawn procesos PTY                                     |
|     |-- Hilo lector dedicado por sesion (stream directo)       |
|     |-- Deteccion de procesos foreground                       |
|     +-- Emite eventos: pty:output:{id}                         |
|                                                                 |
|  [Servidor de Hooks de Agentes (hyper/axum)]                   |
|     |-- HTTP server localhost (async, Tokio)                   |
|     |-- Cache de ultimo estado (HashMap + Serde)               |
|     +-- Emite eventos: agent:status-changed                    |
|                                                                 |
|  [Persistencia (Serde JSON)]                                   |
|     |-- Lectura/escritura atomica (write-rename)               |
|     |-- Backups rotativos (5 copias)                           |
|     |-- Encriptacion: tauri-plugin-stronghold / keyring        |
|     +-- Migraciones de esquema (versionado)                    |
|                                                                 |
|  [Notificaciones (tauri-plugin-notification)]                  |
|     |-- Notificaciones OS nativas                              |
|     +-- Badge en Dock/Taskbar                                  |
|                                                                 |
|  [Prevencion de suspension]                                    |
|     +-- Power save blocker nativo (API del OS)                 |
+================================================================+
                     |
                     v
+================================================================+
|              PROCESOS EXTERNOS (PTYs via portable-pty)          |
|                                                                 |
|  [Shell 1] --> [Agente Claude Code] --> modifica archivos      |
|  [Shell 2] --> [Agente Codex CLI] --> modifica archivos        |
|  [Shell 3] --> [bash/zsh/PowerShell] --> comandos manuales     |
|  [Shell N] --> [Agente N] --> ...                              |
+================================================================+
```

### 6.2 Flujos Criticos de Datos

Estos son los seis flujos de datos principales que conectan los tres actores del sistema:

#### Flujo 1: Agente modifica archivo

```
Agente escribe en filesystem del worktree
  --> Backend Rust (git2 polling cada 3s detecta cambios)
    --> Tauri event 'git:status-changed'
      --> Store Svelte ($state) se actualiza
        --> Sidebar derecha actualiza arbol de archivos y diffs
```

El backend Rust usa `git2::Repository::statuses()` con un timer Tokio cada 3 segundos para detectar cambios. El polling se pausa cuando la ventana no es visible y se reanuda al volver. Si el status tarda mas que el intervalo, no se acumulan requests — se ejecuta uno mas al final (coalescencia).

#### Flujo 2: Agente reporta estado

```
Agente emite hook HTTP POST a localhost
  --> Servidor hooks Rust (hyper/axum) recibe y normaliza
    --> Cache en memoria + disco (HashMap + Serde)
      --> Tauri event 'agent:status-changed'
        --> Store Svelte ($state) se actualiza
          --> Sidebar izquierda actualiza badge del worktree
```

El servidor de hooks corre en localhost como un HTTP server async con axum. El payload incluye: estado actual (working/blocked/waiting/done), prompt del usuario, tipo de agente, herramienta en uso, y si fue interrumpido. Si el agente llego al estado `done`, el backend ademas dispara una notificacion nativa del OS via `tauri-plugin-notification`.

#### Flujo 3: Usuario escribe en terminal

```
Evento de teclado en xterm.js (webview)
  --> invoke('pty_write', { ptyId, data }) [Tauri command]
    --> Backend Rust escribe al PTY stdin
      --> PTY responde con output
        --> Tauri event 'pty:output:{ptyId}' con bytes
          --> xterm.js renderiza con WebGLAddon
```

Se usa Tauri command (`invoke`) para el input porque es request/response — el frontend envia datos y el backend confirma. Se usa Tauri event (`emit`) para el output porque es streaming continuo — el PTY puede producir output en cualquier momento sin que el frontend lo pida.

#### Flujo 4: Usuario cambia de worktree

```
Usuario hace click en tarjeta de worktree (sidebar izquierda)
  --> Store Svelte actualiza worktree activo ($state)
    --> Tabs/terminales del worktree anterior se ocultan (PTYs siguen corriendo)
    --> Tabs/terminales del nuevo worktree se muestran
      --> Backend re-enfoca git polling al nuevo worktree
```

Los PTYs del worktree anterior **no se matan** — siguen corriendo en background con el buffer async de Tokio acumulando output. Cuando el usuario vuelve, el backend envia un snapshot del buffer acumulado para sincronizar xterm.js.

#### Flujo 5: Usuario crea worktree

```
Usuario abre dialogo "Crear Espacio de Trabajo"
  --> invoke('worktree_create', { repo, branch, agent }) [Tauri command]
    --> Backend Rust ejecuta git worktree add (git2/CLI)
      --> Serde guarda metadatos a disco (escritura atomica)
        --> Tauri event notifica al frontend
          --> Store Svelte ($state) se actualiza
            --> Sidebar revela nuevo worktree con scroll automatico
```

Si el usuario selecciono un agente, el backend ademas crea un PTY en el directorio del nuevo worktree y lanza el comando del agente automaticamente.

#### Flujo 6: Agente termina

```
Agente llega a estado 'done'
  --> Hook HTTP al servidor de hooks del backend Rust
    --> Backend actualiza cache y emite Tauri event
      --> tauri-plugin-notification dispara notificacion OS nativa
        --> Sidebar izquierda muestra badge de "no-leido" en el worktree
          --> Usuario revisa diffs en sidebar derecha cuando este listo
```

El badge de "no-leido" se limpia automaticamente cuando el usuario enfoca el worktree correspondiente. El badge en dock/taskbar muestra un contador de agentes con cambios no-leidos.

---

## 7. Sincronizacion y Persistencia

El ADE persiste su estado completo usando **Serde** (serializacion/deserializacion en Rust) a archivos JSON en el directorio de datos de la aplicacion, obtenido via `app.path().app_data_dir()` en Tauri 2.

### 7.1 Mecanismo de Escritura Atomica

La persistencia usa el patron **write-rename** para garantizar atomicidad:

1. Se escribe el nuevo estado a un archivo temporal en el mismo directorio.
2. Se ejecuta `std::fs::rename()` para reemplazar atomicamente el archivo original.
3. Si el proceso se interrumpe durante la escritura, el archivo original queda intacto.

Ademas, se mantienen **5 backups rotativos**: antes de cada escritura, el archivo actual se rota a un backup numerado (1-5), y el mas antiguo se elimina. Esto permite recuperar estado ante corrupcion.

### 7.2 Debounce de Layout

Los cambios de layout (mover splits, redimensionar panes, crear/cerrar tabs) son frecuentes y no deben disparar una escritura a disco en cada cambio. Se usa un **debounce de 250ms via Tokio timer**: despues del ultimo cambio de layout, se espera 250ms antes de persistir. Si llegan mas cambios en ese intervalo, el timer se reinicia.

### 7.3 Tabla Completa de Persistencia

| Dato | Persiste | Proteccion |
|------|----------|------------|
| Lista de repos y worktrees | Si | Escritura atomica (write-rename) + 5 backups rotativos |
| Layout de tabs y splits | Si | Guardado con debounce de 250ms (Tokio timer) |
| Estado de agentes (ultimo) | Si | TTL de 7 dias, cache separado del store principal |
| Scrollback de terminal | Si | Por pane, hasta 50MB por worktree |
| Configuracion y preferencias | Si | En el store principal, escritura atomica |
| Credenciales y secretos | Si | **Encriptados** via `tauri-plugin-stronghold` o keyring del OS |

### 7.4 Migraciones de Esquema

Cuando el formato del JSON de persistencia cambia entre versiones del ADE:

- El archivo JSON incluye un campo de version de esquema.
- Al abrir, si la version es anterior a la actual, se aplican migraciones secuenciales (v1 -> v2 -> v3, etc.).
- Las migraciones son funciones Rust que transforman el JSON de un esquema al siguiente.
- Se crea un backup antes de migrar para poder revertir si algo falla.

### 7.5 Ventaja de Rust para Persistencia

La serializacion con Serde es extremadamente rapida y type-safe. Los structs de Rust se serializan directamente a JSON sin riesgo de campos `undefined` o tipos incorrectos. Ademas, el patron write-rename para escritura atomica es trivial en Rust con `std::fs::rename()`, que es una operacion atomica a nivel de filesystem en todos los sistemas operativos soportados.

---

## 8. Prevencion de Suspension del Sistema

Cuando un agente esta trabajando activamente, el ADE puede prevenir que el sistema operativo entre en modo de suspension o apague la pantalla. Esto es critico para tareas de larga duracion donde un agente puede estar procesando durante horas.

### 8.1 Implementacion por Plataforma

| Plataforma | Mecanismo | Descripcion |
|------------|-----------|-------------|
| **Windows** | Power save blocker | Usa la API de Windows para prevenir que el sistema entre en suspension mientras hay agentes activos. |
| **macOS** | IOKit assertion | Crea una asercion IOKit (`kIOPMAssertionTypeNoIdleSleep`) que previene la suspension por inactividad. |
| **Linux** | systemd inhibitor | Usa el mecanismo de inhibicion de systemd (`systemd-inhibit`) para bloquear la suspension. |

### 8.2 Condiciones de Activacion

La prevencion de suspension se activa **solo** cuando se cumplen ambas condiciones:

1. **Al menos un agente en estado `working`**: Si todos los agentes estan en `done`, `waiting` o `blocked`, no se previene la suspension.
2. **El usuario tiene la preferencia habilitada**: Es una configuracion explicitamente activable en las preferencias del ADE. No se activa por defecto sin consentimiento del usuario.

### 8.3 Auto-liberacion por Seguridad

Como medida de seguridad para evitar que un agente colgado mantenga el sistema despierto indefinidamente:

- **Timeout de 2 horas**: Si ningun agente reporta actividad en 2 horas, la prevencion de suspension se libera automaticamente, independientemente del estado reportado.
- Esto protege contra escenarios donde un agente se queda en estado `working` pero en realidad esta colgado o sin responder.
- Si el agente vuelve a reportar actividad, la prevencion se reactiva automaticamente.
