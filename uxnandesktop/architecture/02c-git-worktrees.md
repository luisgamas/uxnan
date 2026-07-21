# Git, Worktrees y Diffs

> Documento de referencia para el manejo de Git, worktrees y diffs en el Uxnan Desktop ADE.
> Fuente: Secciones 4 y 5 de `architect-desktop.md`.

---

## Tabla de Contenidos

1. [Worktrees como Unidad de Aislamiento](#1-worktrees-como-unidad-de-aislamiento)
2. [Flujos Core de Worktrees](#2-flujos-core-de-worktrees)
3. [Capa de Ejecución Git (Backend Rust)](#3-capa-de-ejecución-git-backend-rust)
4. [Visor de Diffs](#4-visor-de-diffs)
5. [Módulos y Conexiones](#5-módulos-y-conexiones)

---

## 1. Worktrees como Unidad de Aislamiento

El ADE usa **git worktrees** como su mecanismo fundamental de aislamiento, NO el cambio de rama tradicional (`git checkout`/`git switch`).

### 1.1 Por Qué Worktrees y No Ramas

| Aspecto | Ramas tradicionales | Worktrees |
|---------|---------------------|-----------|
| Aislamiento | Ninguno. Solo hay un directorio de trabajo. | Total. Cada worktree es un directorio independiente. |
| Paralelismo | Imposible. Solo una rama activa a la vez. | Total. N worktrees = N ramas activas simultáneamente. |
| Cambio de contexto | Costoso. `git stash` + `git checkout` + reinstalar deps. | Instantáneo. Solo cambiar qué directorio mira la UI. |
| Agentes paralelos | Imposible. Un agente bloquearía al otro. | Natural. Cada agente trabaja en su propio directorio. |
| Consumo de disco | Mínimo (un solo checkout). | Mayor (un checkout por worktree). Se mitiga con sparse checkout. |

Los worktrees son la pieza clave que hace posible el paradigma de desarrollo con múltiples agentes paralelos. Sin ellos, el concepto de ADE no funciona.

### 1.2 Ciclo de Vida de un Worktree

```
CREACIÓN                  USO ACTIVO               FINALIZACIÓN
---------                 ----------               ------------
git worktree add    --->  Agente trabaja     --->  Revisión de cambios
Configurar rama           Cambios en archivos      Commit + Push
Almacenar metadatos       Monitoring en sidebar    git worktree remove
Lanzar agente             Diffs en sidebar dcha    Limpiar rama (opcional)
```

---

## 2. Flujos Core de Worktrees

### 2.1 Creación de Worktree

La creación se hace desde dos accesos —el **diálogo dedicado** (`NewWorktreeDialog`,
atajo + estado vacío) y el **lanzador "+"** de la tarjeta de proyecto
(`LauncherDialog`, opción «Nuevo worktree»)— que comparten **el mismo formulario**
(`WorktreeCreateFields`), de modo que nunca se desincronizan. Ofrece **dos modos** y
una **ubicación opcional**:

- **Rama nueva** (por defecto): el usuario escribe un nombre de rama —o pulsa
  **generar** para uno automático, amistoso y único (`wt/<adjetivo>-<sustantivo>`,
  con sufijo numérico si colisiona)— y elige una **rama base**. Se crea con
  `git worktree add --no-track -b <rama> <ruta> <base>`.
- **Rama existente**: el usuario elige **cualquier rama local o remota** del
  repositorio (las que ya están en un worktree se muestran deshabilitadas, porque
  git rechaza un segundo checkout). Una rama **local** se saca directamente
  (`git worktree add <ruta> <rama>`); una **remota-solo** (`origin/<rama>` sin
  contraparte local) obtiene una rama local con tracking
  (`git worktree add --track -b <rama> <ruta> origin/<rama>`).
- **Ubicación**: por defecto la carpeta hermana automática `<repo>--<rama>`; el
  usuario puede **editar la ruta** o **explorar** hasta una carpeta padre (con el
  explorador in-app compartido). Una ruta personalizada debe ser absoluta y no
  existir; se normaliza a barras `/`.

El flujo del backend (comando `worktree_create` con `fromExisting` y `path`
opcionales) tiene varias garantías:

1. **Resolver la referencia base** *(solo modo rama nueva)*: El usuario selecciona una rama base. El ADE la resuelve a una referencia completa, verificando que existe. Se prueba un orden de prioridad: referencia simbólica de HEAD remoto, luego `main`, luego `master`, con fallback a ramas locales.

2. **Crear el worktree**: Se ejecuta `git worktree add` (con `--no-track -b` en modo rama nueva, para que la rama nueva no herede el tracking de la base y no se reporte como "detrás de upstream" antes del primer push; con checkout directo o `--track -b` en modo rama existente). Tras crearlo se **re-lista** con `git worktree list` para devolver la entrada tal como git la reporta (ruta/rama/head canónicas), de modo que incluso una ruta personalizada coincide con la clave de workspace del frontend.

3. **Configurar push automático**: Se establece `push.autoSetupRemote=true` en la configuración del repo (una sola vez) para que `git push` sin argumentos cree automáticamente la rama remota.

4. **Refrescar la referencia base local**: Si la base es una rama remota (ej: `origin/main`), se puede hacer fast-forward de la rama local correspondiente para que el worktree empiece desde lo más reciente. Esto solo se hace si la rama local no tiene cambios propios.

5. **Atomicidad**: Si cualquier paso falla, se limpia el worktree parcialmente creado y su rama.

6. **Almacenar metadatos**: Se guardan nombre, agente asociado, timestamp de creación.

7. **Lanzar agente** (opcional): Si el worktree fue creado con un agente predefinido, se lanza automáticamente en un terminal nuevo.

Los flujos **worktree-native de GitHub** (*checkout* de un PR e *iniciar trabajo* sobre
un issue; ver `docs/github.md`) construyen su worktree en el backend — `git worktree add`
sobre `pull/<n>/head` y sobre la rama ligada de `gh issue develop`, respectivamente — pero
**terminan por este mismo camino**: el usuario confirma en un diálogo hermano del de
*Nuevo worktree* (nombre de rama editable, agente a lanzar, previsualización de la carpeta)
y el resultado se adopta con los pasos 6–7 compartidos, de modo que un worktree nacido de
GitHub queda registrado, activo y **con su agente lanzado** igual que cualquier otro.

### 2.2 Cambio de Worktree

1. El usuario hace click en una tarjeta de worktree.
2. Se activa el worktree en el estado reactivo de Svelte.
3. Los tabs/terminales del worktree anterior se ocultan (pero siguen corriendo).
4. Los tabs/terminales del nuevo worktree se muestran.
5. Se actualiza el estado visual de la sidebar.

### 2.3 Eliminación de Worktree

Eliminar un worktree **solo elimina el worktree** por defecto; la limpieza de
ramas es **opt-in** (el usuario nunca pierde una rama sin pedirlo). El diálogo de
confirmación (`RemoveWorktreeDialog`) ofrece dos casillas —desmarcadas por
defecto— y el backend (`worktree_remove` con un `cleanup`:
`deleteLocal`/`forceLocal`/`deleteRemote`) actúa así:

1. **Preflight de limpieza**: Se ejecuta `git status` en el worktree. Si hay cambios sin commitear, la eliminación se bloquea (a menos que sea forzada). Si está limpio: se matan los terminales asociados.

2. **Eliminación del worktree**: `git worktree remove` + `git worktree prune` (+ borrado del directorio con reintentos en Windows).

3. **Rama local** *(solo si se marca "Eliminar rama local")*:
   - Se intenta borrar con `git branch -d` (safe delete, falla si hay commits sin mergear).
   - Si `-d` falla y el usuario marcó **Forzar**, se borra con `git branch -D`.
   - Si `-d` falla sin forzar, se analiza si la rama es "patch-equivalente" a la base (squash-merge); si lo es, se borra con seguridad (`-D`). Si no, la rama se **conserva** y se reporta como "sin mergear" para que la UI ofrezca forzar.

4. **Rama remota** *(solo si se marca "Eliminar rama remota")*: si `origin/<rama>` existe, se borra con `git push origin --delete <rama>`. Un fallo (offline, protegida, sin `origin`) se reporta como aviso —la eliminación local del worktree ya tuvo éxito—.

El `RemoveOutcome` reporta el destino de cada rama (borrada / squash-merge / conservada-sin-mergear / error remoto) para el toast compuesto.

---

## 3. Capa de Ejecución Git (Backend Rust)

Todas las operaciones git pasan por un **módulo centralizado en el backend Rust**.

### 3.1 Doble Motor: git2 + CLI Fallback

- La crate **`git2`** (bindings de libgit2) se usa para operaciones de alta frecuencia (status, diff, stage, log) donde la velocidad importa.
- Para operaciones de worktree (`git worktree add/remove/list`) y otras que libgit2 no soporta completamente, se invoca **git CLI** como subproceso vía `tokio::process::Command`.

> **Por qué `git2` y no solo CLI**: `git2` es significativamente más rápido para operaciones repetitivas como status polling (evita el overhead de crear un subproceso cada 3 segundos). Además, permite acceso directo al index y al object store de git para operaciones de staging parcial. Sin embargo, `git2` tiene limitaciones con worktrees y algunas operaciones avanzadas, por lo que el fallback a CLI es necesario.

### 3.2 Características del Motor

- **Soporte multiplataforma nativo**: Rust compila nativamente para Windows, macOS y Linux. Para repos en WSL desde Windows, se detectan rutas UNC (`\\wsl.localhost\...`) y se enrutan los comandos a través de `wsl.exe`.

- **Async con Tokio**: Todas las operaciones git se ejecutan en un runtime async para no bloquear ni el backend ni el frontend. Las operaciones pesadas (fetch, clone) corren en threads dedicados del pool de Tokio.

- **Reintentos con backoff exponencial**: Para operaciones de red (fetch, push), reintentos con espera exponencial ante errores transitorios (502, 503, timeout).

- **Protección de idempotencia**: Las operaciones mutativas (POST, PUT, DELETE en APIs remotas) NO se reintentan para evitar duplicados.

### 3.3 Monitoreo de Estado Git

El estado git se mantiene actualizado con un ciclo de polling:

- **Intervalo**: Cada 3 segundos se consulta el estado git del worktree activo vía `git2::Repository::statuses()` (o `git status` como fallback).
- **Optimización**: Se pausa cuando la ventana no es visible. Se reanuda al volver.
- **Coalescencia**: Si el status tarda más que el intervalo, no se acumulan requests. Se ejecuta uno más al final.
- **Detección de conflictos**: Se detecta si hay un merge, rebase o cherry-pick en curso.
- **Estado upstream**: Se calcula cuántos commits está "ahead" y "behind" respecto a la rama remota.

La sidebar mantiene además una reconciliación ligera cada 3 segundos de la lista
de worktrees de cada repositorio registrado. Esto cubre worktrees creados fuera
del ADE por agentes o por Git; solo se reasigna una lista cuando cambian sus
entradas, para no perturbar el orden estabilizado de las vistas del panel.

### 3.4 Gestión de Ramas

- **Nomenclatura**: Las ramas se crean con un prefijo configurable (ej: `usuario/feature-name`, `custom/feature-name`, o sin prefijo). Los nombres se sanitizan para eliminar caracteres no válidos.
- **Detección de base por defecto**: Al crear una rama, el ADE prueba en orden un conjunto de bases conocidas (HEAD remoto, main, master, etc.) para determinar la base más adecuada.
- **Listas para los selectores**: `branch_list` devuelve las ramas **locales** (para el selector de base y el de rama existente), las ramas **remotas** de `origin` (short-name, para poder sacar en un worktree una rama que solo existe en remoto) y la base por defecto resuelta.
- **Limpieza de ramas al eliminar**: es **opt-in** (ver §2.3) — borrar un worktree no borra su rama salvo que el usuario lo pida (local con `-d`/`-D`+squash-safety, y/o remota con `git push origin --delete`).

---

## 4. Visor de Diffs

### 4.1 Modos de Visualización

Al seleccionar un archivo del árbol de estado git, se abre el visor de diffs que soporta dos modos:

1. **Inline (unificado)**: Muestra las líneas añadidas y eliminadas en un solo flujo vertical. Más compacto, mejor para cambios dispersos.

2. **Side-by-side (lado a lado)**: Muestra el archivo original a la izquierda y el modificado a la derecha. Mejor para comparar estructura.

### 4.2 Características Técnicas

- **Scroll virtual**: Para changesets grandes (cientos de archivos), solo se renderizan los diffs visibles en pantalla. Los demás se cargan bajo demanda.
- **Carga progresiva**: Los diffs de archivos individuales se obtienen lazily conforme el usuario navega. Esto evita bloquear la UI cuando un agente modifica 50+ archivos.
- **Navegación por archivo**: Un árbol lateral permite saltar directamente a cualquier archivo del changeset.
- **Timeout de protección (30 segundos)**: Si un diff individual tarda más de 30 segundos en calcularse, se aborta para no colgar la interfaz.
- **Diffs de imágenes**: Comparación visual antes/después para archivos de imagen.

### 4.3 Operaciones sobre Cambios

Las operaciones disponibles operan a tres niveles de granularidad:

**Nivel de archivo completo:**
- Stage individual (mover a staged).
- Unstage individual (sacar de staged).
- Descartar cambios (revertir a HEAD).

**Nivel bulk (todos los archivos):**
- Stage all, Unstage all, Discard all (con confirmación).

**Nivel de hunk/parcial:**
- Stage por hunk: Seleccionar bloques de cambios individuales dentro de un archivo para hacer stage parcial.
- Esto usa el sistema de patching de git internamente.

### 4.4 Comentarios en Diffs

El usuario puede añadir **anotaciones a nivel de línea** en los diffs:
- Útil para dejar notas al agente (ej: "revisa esta lógica").
- Se persisten en el metadato del worktree.
- Pueden ser enviados al agente como contexto adicional.

### 4.5 Composición de Commits

Integrada en el panel de cambios (`ChangesPanel.svelte`):
- **Editor de mensaje de commit** (resumen/summary) siempre visible.
- **Opciones opcionales colapsadas** (`shadcn-svelte` Collapsible, cerradas por
  defecto): **descripción extendida** (cuerpo del commit), **coautores**
  (`Co-authored-by:` trailers, lista add/remove de `Nombre <email>`), **enmendar
  el último commit** (`--amend`) y **sign-off** (`Signed-off-by:`, `-s`). El
  mensaje final se compone en el frontend (`git.svelte.ts → buildCommitMessage`):
  resumen + línea en blanco + cuerpo + línea en blanco + trailers
  `Co-authored-by:`; el sign-off lo añade git (`-s`) usando la identidad
  configurada. El comando backend `git_commit(path, message, amend, signOff)`.
- **Botón de acción primaria** contextual: Commit / Amend commit según el estado
  del composer; Push / Pull aparecen cuando hay ahead/behind.
- **Generación AI del mensaje** (opcional, opt-in): cuando se activa en
  **Configuración → Mensaje de commit con IA**, aparece un botón **Generar** en el
  composer que redacta el mensaje a partir del diff staged. La configuración es
  **no técnica**: el usuario elige un **agente** (solo se pueden seleccionar los
  instalados de entre Claude Code, Codex, Gemini, OpenCode y Pi) y un **modelo**;
  no hay comando ni argumentos que configurar. El backend resuelve cada CLI igual
  que el bridge (`src-tauri/src/agentcli.rs`: `node <entry.js>` para instalaciones
  npm, binario nativo si existe — así el lanzamiento no interactivo funciona en
  Windows sin shell) y lo ejecuta de forma **no interactiva** (subproceso de una
  sola pasada — no un PTY — con stdin cerrado, timeout de 120 s y `kill_on_drop`;
  sin API/SDK/keys de proveedor). Los modelos se descubren por agente: estáticos
  para Claude (versiones concretas exactas, p. ej. `claude-opus-4-8`, mantenidas
  en `agentcli.rs::CLAUDE_MODELS` con una guía de actualización — sin alias
  "latest") y Gemini (lista curada), o en vivo para OpenCode (`opencode models`),
  Pi (`pi --list-models`) y Codex (`codex app-server` `model/list`); siempre con
  una opción **Predeterminado** (sin flag de modelo). El selector de modelo es
  **buscable y con scroll** (`AiModelPicker.svelte`) porque algunos agentes
  listan cientos de modelos.
  Comandos: `git_generate_commit_message`, `ai_commit_agents`, `ai_commit_models`
  (`src-tauri/src/aicommit.rs`). La configuración vive en `AppSettings.aiCommit`
  (`AiCommitSettings`: `agentId`, `model`, idioma, Conventional Commits, cuerpo
  extendido, instrucciones extra), **desactivada por defecto**. Lista de agentes
  soportados en `src/lib/aiCommitPresets.ts`.

### 4.6 Fuentes de Diff

El visor maneja tres fuentes de diff:

1. **Uncommitted**: Working tree vs HEAD. Es el más común, muestra los cambios que el agente acaba de hacer.
2. **Branch**: Rama actual vs rama base. Muestra el changeset completo de una feature branch.
3. **Commit**: Un commit individual, o **una sola porción de archivo** de él (el
   diff se parte por archivo en el frontend). Muestra qué cambió ese commit —
   entero, o el archivo elegido desde la lista expandida en Historial.

Cada fuente pasa por una **capa de deduplicación** que evita calcular el mismo diff múltiples veces si el usuario lo abre en diferentes contextos.

---

## 5. Módulos y Conexiones

El siguiente diagrama muestra cómo se conectan los módulos de Git, diffs y worktrees:

```
[Polling de Git Status] ---> [Store Reactivo Svelte: Estado Git por Worktree]
        |                              |
        v                              v
[Backend Rust: git2/CLI]       [Árbol de Archivos UI (Svelte)]
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

### Descripción de Componentes

- **Polling de Git Status**: El backend Rust ejecuta `git2` (o `git status` vía CLI) cada 3 segundos con Tokio timers. Se pausa cuando la ventana no es visible. Los resultados se emiten al frontend vía Tauri events.
- **Store Reactivo de Svelte**: Almacena el estado por worktree (archivos modificados, staged, conflictos) usando `$state` y `$derived` de Svelte 5.
- **Visor de Diffs**: Usa CodeMirror 6 (más ligero que Monaco) con extensión de diff y carga lazy. Alternativa: Monaco si se necesita paridad con VS Code.
- **Operaciones Git**: Stage, unstage, y discard se ejecutan en el backend Rust vía `git2` crate o invocando git CLI como subproceso.

---

## 6. Pestaña de Archivos y Editor

El panel derecho expone **hasta cuatro vistas mediante pestañas** (`RightPanel.svelte`
con `shadcn-svelte` Tabs). De izquierda a derecha:

1. **Archivos** (`FileTreePanel.svelte`): el árbol de archivos completo del
   worktree/proyecto activo, no solo los archivos con cambios.
2. **Cambios** (`ChangesPanel.svelte`): el visor de control de versiones descrito
   en las secciones 3–4 (estado/diff/stage/commit/push/pull).
3. **Historial** (`HistoryPanel.svelte`): el log de commits del worktree activo,
   con un grafo de ramas opcional (ver §6.4).
4. **GitHub** (`GithubPanel.svelte`, opcional): vista contextual del worktree activo
   con el PR de su rama (resumen de checks + acciones rápidas) y los runs de CI de
   esa rama. Solo aparece cuando el repo es de GitHub y el tab está habilitado
   (`AppSettings.github.rightPanelTab`). Las vistas grandes (review/diff/logs) se
   abren en la **sección GitHub** de pantalla completa (integración `gh`-backed; ver
   `docs/github.md`).

El estado git del worktree activo se carga en el padre `RightPanel` (siempre
montado), de modo que la pestaña Archivos colorea su árbol aunque la pestaña
Cambios esté desmontada. La pestaña Historial mantiene su propio store
(`history.svelte.ts`) que sobrevive al cambio de pestaña y se refresca tras
commit/push/pull.

### 6.1 Árbol de Archivos

- **Carga perezosa por carpeta**: el backend lista un nivel de directorio bajo
  demanda al expandir (comando `fs_list_dir`), de modo que árboles grandes
  (`node_modules`, `target`) nunca se cargan hasta abrirse. Estado en el store
  `fileTree.svelte.ts` (sobrevive al cambio de pestaña; se resetea al cambiar de
  worktree). Carpetas primero, luego archivos, orden alfabético; `.git` oculto.
- **Coloreo por cambio git**: cada archivo con un cambio rastreable se colorea
  (untracked = verde, eliminado = rojo, modificado = ámbar) reutilizando el mismo
  estado git del panel de cambios; las **carpetas padre** que contienen cambios
  también se colorean (ámbar) para poder rastrear visualmente dónde hay cambios.
- **Auto-refresco (watcher de filesystem)**: el backend vigila la raíz del
  worktree activo (`src-tauri/src/fswatch.rs`, `notify` + debounce, `.git`
  filtrado) y emite el evento `fs:changed`; el árbol recarga **solo** los
  directorios afectados conservando la expansión, de modo que archivos
  creados/eliminados en disco (p. ej. por un agente) aparecen sin recargar a
  mano. El watcher se apunta al worktree activo centralmente (`+page.svelte`).
- **Abrir archivo**: un clic en un archivo lo abre como **pestaña de archivo**
  en el área central (ver §6.2).
- **Búsqueda en todo el proyecto**: la lupa filtra recursivamente **todo** el
  worktree (comando backend `fs_search_files`, walker `ignore` de ripgrep —
  respeta `.gitignore` y salta `.git`), no solo las carpetas ya expandidas. Las
  coincidencias se muestran **como árbol** (mismo diseño de carpetas/archivos que
  el navegador — los archivos hallados anidados bajo sus carpetas ancestro
  colapsables), no como lista plana. Debounced, con tope de resultados (aviso de
  "afina la búsqueda") y guardia de secuencia para descartar respuestas obsoletas.
  **"Buscar en la carpeta"** raíza la misma búsqueda en un subárbol (chip limpiable).
- **Toolbar + archivos ocultos**: botones primarios (buscar · contraer · recargar)
  + un menú de desbordamiento **`…`** (`ui/dropdown-menu`) con acciones secundarias —
  **Revelar en el explorador** y un toggle **"Mostrar archivos ocultos"** (dotfiles)
  que filtra tanto el árbol como la búsqueda. La fila del árbol vive en
  `FileTreeRow.svelte` (compartida por el árbol y el árbol de resultados).
- **Arrastrar a la terminal**: arrastrar una fila (archivo/carpeta) sobre una
  terminal escribe su ruta (entre comillas si tiene espacios) en el PTY, **sin
  ejecutarla**, y **pasa el foco a esa terminal** para seguir escribiendo ahí. Se
  implementa con **eventos de puntero** (no dnd HTML5, que Tauri suprime en el
  WebView — igual que el reordenamiento de pestañas): un umbral distingue clic de
  arrastre y el destino se resuelve con `data-pty-id` bajo el puntero. Helper
  compartido `terminal/terminalDrop.ts`, reutilizado también por el drop OS-nativo.
- **Menú contextual (clic derecho) por ítem**: cada archivo/carpeta ofrece
  operaciones completas reutilizando `ui/context-menu`
  (`FileTreeContextMenu.svelte`): New File · New Folder · Copiar ruta / ruta
  relativa · Duplicar *(archivo)* · Añadir como proyecto *(carpeta)* · Abrir en
  terminal *(carpeta)* · Ver archivo · Contraer carpeta · Buscar en la carpeta
  *(acota la búsqueda a un subárbol, con chip limpiable)* · Revelar en el
  explorador · Renombrar · Eliminar. **Eliminar mueve a la papelera del SO** (crate
  `trash`, recuperable) tras el `ConfirmDialog` destructivo compartido. Las
  pestañas de archivo abiertas **siguen un renombrado o se cierran al eliminar**
  (`terminals.repathTabs` / `closeTabsUnder`).
- **Crear y renombrar son inline al estilo VSCode**: en vez de un modal, New File /
  New Folder insertan una **fila de entrada editable** (`FileTreeDraftRow.svelte`) en
  el sitio de creación, y **Renombrar** convierte la fila del ítem en un input en el
  sitio (`FileTreeRow.svelte`, con el basename preseleccionado). Ambos comparten el
  mismo campo (`TreeInlineInput.svelte`): Enter confirma, Esc cancela, blur confirma si
  es válido, y un error del backend se muestra inline. En **crear**, el nombre puede ser
  una **ruta intercalada** (`carpeta/archivo.js`) que crea las carpetas intermedias
  (estilo `mkdir -p`, reutilizando las existentes) sin sobrescribir la hoja; **renombrar**
  es un cambio de nombre "desnudo" (`fs_rename` + `validate_bare_name`). Al ser inline no
  tocan el pointer-lock del `<body>` que el diálogo modal tenía que sortear (el antiguo
  `FileNamePromptDialog` se eliminó). Solo **eliminar** conserva su `ConfirmDialog`
  destructivo.
- **Crear desde la barra + selección**: además del menú contextual, el menú **"…"**
  de la cabecera ofrece New File / New Folder — útil cuando el árbol es grande y no
  hay hueco vacío donde abrir el clic derecho. El destino sigue a VSCode: la **carpeta
  seleccionada** (o el **padre** de un archivo seleccionado), o la **raíz** si no hay
  selección. **El resalte de fila lo maneja la selección** (último clic,
  `fileTree.selectedEntry`), no el estado "abierto en pestaña" — así **Esc** / el clic
  en vacío lo limpian y varios archivos abiertos ya no se ven todos seleccionados;
  estar abierto es solo una pista sutil (texto en negrita).
- **Deseleccionar + acciones de raíz**: **Esc** limpia la selección; el **área vacía
  bajo el árbol** es clicable (estilo VSCode): un clic limpia la selección y un **clic
  derecho** abre las acciones de la **raíz del proyecto** (New File / New Folder en la
  raíz del worktree, Revelar, Contraer todo), alcanzables aunque un árbol grande no
  deje hueco vacío para el clic derecho.
- **Atajos de teclado** (estilo VSCode, sobre la fila seleccionada; `onPanelKeydown`):
  **F2** renombra y **Supr** (o **Cmd+Backspace** en macOS) mueve a la papelera del SO —
  reutilizan el mismo diálogo de renombrado y el `ConfirmDialog` destructivo del menú
  contextual—; **Enter/Espacio** abren el archivo o pliegan/despliegan la carpeta (nativo
  del `<button>` de la fila). No se disparan mientras se escribe en la búsqueda ni en un
  input de creación inline.
- Backend: `fs_create_file` / `fs_create_dir` aceptan una **ruta relativa intercalada**
  (crean las carpetas intermedias; hoja sin-clobber; guardas contra `..`, segmentos
  vacíos, `\` y escapes fuera del directorio) · `fs_delete` / `fs_duplicate`.
  `fs_rename` mantiene la guarda de nombre "desnudo" (`validate_bare_name`).

### 6.2 Visor de Archivos (panel central)

Al abrir un archivo se crea **una sola pestaña** en el árbol de regiones del área
central (`FileTabView.svelte`), con un **selector de vista Editar / Vista previa /
Cambios** — solo aparecen las vistas que el archivo admite. Previsualizaciones,
editores y terminales son pestañas del mismo `TabGroup` (ver `02b-terminal-engine.md`
§3.1/§3.3), por lo que conviven y permiten **splits mixtos** (p. ej. terminal a la
izquierda / editor a la derecha). El estado vivo de cada pestaña (contenido, dirty, y
—perezosamente— el diff de trabajo) vive en registros por id en el store de terminales,
no en el árbol serializado, así CodeMirror/xterm nunca se remontan al dividir/reordenar
y escribir no ensucia el layout persistido. **Cada vista visitada permanece montada**
(se alterna la visibilidad), de modo que cambiar de vista no remonta el editor ni vuelve
a leer git. Las pestañas de archivo se restauran al reiniciar (por ruta, con su vista);
las de commit son transitorias. **Abrir (o activar) una pestaña de archivo no roba el
foco al editor** (estilo VSCode): el foco se queda donde estaba —p. ej. en el árbol de
archivos— para que **Esc** y los atajos del árbol sigan operables; se hace clic dentro
del editor para colocar el cursor. `FileEditor.svelte` solo re-mide CodeMirror al
hacerse visible (nunca `.focus()`). Los atajos globales (Ctrl+Tab, Ctrl+W…) no se ven
afectados: los resuelve un manejador a nivel de `window` sin importar qué panel tiene el
foco.

La pestaña reúne lo que antes eran pestañas separadas: **abrir un archivo y revisar su
diff ya no crean dos pestañas**. Al hacer clic en un archivo cambiado del panel de
Cambios se **enfoca su pestaña y salta a la vista Cambios** (`terminals.openFileChanges`)
en lugar de abrir un diff aparte, y el diff se lee de git **una sola vez**. Vistas:

- **Editar** — edición real con CodeMirror 6 + **resaltado de sintaxis** por extensión
  (`editorLang.ts`: JS/TS/JSON/CSS/HTML/Markdown/Rust/Python/YAML/XML/C++/Java/PHP/
  SQL/Go), números de línea, historial y el **medianil de cambios git** (líneas
  añadidas resaltadas + *peek* de líneas eliminadas bajo demanda, derivado de
  `git_diff_head` → `parseHeadDiff`). **Guardado**: botón **Guardar** en la cabecera
  de la pestaña o **Ctrl/Cmd+S** (`fs_write_file`, atómico temp+rename). Indicador de
  cambios sin guardar. No disponible para imágenes ráster (binarias) ni archivos
  > 2 MiB (`fs_read_file` reporta `binary` / `tooLarge`).
- **Vista previa** — **multimodal**:
  - **Imágenes** (`png/jpg/gif/webp/bmp/ico/svg/avif/tif`) se renderizan sobre un
    fondo ajedrezado con **ajustar / zoom / tamaño real** y una línea de metadatos
    (dimensiones · tamaño). El backend `fs_read_data_url` lee el archivo local a un
    `data:` URL (MIME por extensión + *sniff* de bytes mágicos, tope 25 MiB). SVG se
    previsualiza como imagen y **también** se edita como código.
  - **Markdown** se renderiza con un parser propio sobre `@lezer/markdown`
    (`markdown.ts` → AST tipado; `MarkdownView.svelte` con marcado Svelte, **sin
    `{@html}`** — el HTML crudo se muestra como texto escapado, sin superficie XSS).
    `.md` abre en la fuente con un botón de Vista previa; los enlaces se abren
    externamente y las imágenes locales se resuelven vía `fs_read_data_url`.
- **Cambios** — el diff de trabajo del archivo (unificado / lado a lado, staging por
  hunk, diff visual de imágenes), con un toggle **staged / sin stage** (`DiffPane.svelte`
  + `DiffViewerState`, sub-estado perezoso keyed por el id de la pestaña, liberado con
  ella). Vaciar el diff (stagear/descartar el último hunk) **no cierra** la pestaña:
  vuelve a Editar cuando esa vista existe (nunca cierra un editor con cambios sin
  guardar). Un archivo **eliminado** en disco abre directo en Cambios (Editar/Vista
  previa deshabilitadas).

- **Aviso de cambios sin guardar** al cerrar: pregunta **Guardar / Descartar / Cancelar**
  (`SaveDiscardDialog` + `confirm.svelte.ts`) en todas las rutas de cierre; cerrar una
  región con varios archivos sucios pregunta una sola vez.
- **Cambio externo en disco** (`fs:changed`): con ediciones sin guardar muestra una
  barra **Recargar / Mantener mis cambios**; una pestaña limpia recarga sola; la vista
  Cambios recarga su diff.

### 6.3 Comandos Tauri (sistema de archivos)

| Comando | Descripción |
|---|---|
| `fs_list_dir(path)` | Lista un nivel de directorio (carpetas primero, luego archivos; `.git` oculto). |
| `fs_read_file(path)` | Lee un archivo de texto para el editor (flags `binary` / `tooLarge`). |
| `fs_read_data_url(path)` | Lee un archivo de imagen local a un `data:<mime>;base64,…` para la vista previa (MIME por extensión + sniff; tope 25 MiB; rechaza no-imágenes). |
| `fs_write_file(path, content)` | Sobrescribe un archivo (atómico: temp + rename). |
| `git_diff_head(path, file)` | Diff working-tree-vs-`HEAD` de un archivo, para el medianil del editor. |
| `reveal_path(path)` | Revela una ruta en el explorador de archivos del SO (plugin opener). |
| `editors_detect()` | Detecta los editores/IDEs GUI instalados (sonda `which` en el `PATH` **+** un escaneo por SO de rutas de instalación —Windows: `Program Files`/perfil; macOS: `.app` en `/Applications`), para los menús **«Abrir con»**. |
| `native_text_editor()` | El editor de texto nativo del SO (Notepad / TextEdit / uno detectado en Linux), ofrecido para archivos de texto. |
| `open_in_editor(command, args, path)` | Abre una ruta (carpeta o archivo) en un editor externo: `command` + `args` + la ruta al final; en Windows un `.exe` se lanza directo y **sin ventana**, un nombre de CLI (`.cmd`/`.bat`) vía `cmd /C` sin ventana; en macOS `open -a`, directo en el resto. |
| `fs_set_watch(path?)` | Apunta (o limpia) el watcher de filesystem al worktree activo; emite `fs:changed` al crearse/eliminarse/editarse archivos. |
| `git_numstat(path)` | Líneas añadidas/eliminadas por archivo vs `HEAD` (`+a −d` en la lista de cambios). |

La barra de la pestaña Archivos ofrece además: **búsqueda/filtro** por nombre,
**contraer/expandir todas** las carpetas, **abrir en el explorador del SO**
(`reveal_path`) y actualizar. Los menús de la tarjeta de proyecto (⋯), del
clic-derecho sobre ramas/worktrees y de cada entrada del árbol —además del menú
«Más acciones» de la pestaña Archivos— incluyen **«Abrir con»** para lanzar la
carpeta/archivo en un editor externo: los editores instalados se detectan solos
(`editors_detect`, incluso sin CLI en el `PATH`) y se lanzan con `open_in_editor`;
para archivos de **texto** también se ofrece el editor nativo del SO
(`native_text_editor`). **Configuración → Abrir con** (`AppSettings.openWith`)
permite ocultar detectados, **explorar** el equipo para añadir cualquier app
(selector nativo, `@tauri-apps/plugin-dialog`), añadir editores personalizados y
fijar el **icono** de cada editor (favicon automático o imagen/glifo propio).
Los atajos de teclado de la app son configurables
en **Configuración → Atajos de teclado** (`AppSettings.keybindings`,
`keybindings.ts`); p. ej. `Ctrl/Cmd+W` cierra la pestaña activa del área central
(con la guarda de cambios sin guardar si es un archivo sucio).

Acceso de archivos no confinado (la propia máquina del usuario, igual que
`browse_dirs`). Implementación: `src-tauri/src/fs.rs` + `git::diff_head`.

### 6.4 Pestaña Historial y Grafo de Ramas

La pestaña **Historial** (`HistoryPanel.svelte`) muestra el log de commits del
worktree activo. Características:

- **Log paginado y virtualizado**: el backend devuelve commits del más reciente
  al más antiguo en orden topológico (`git_log(path, limit, skip)`); el frontend
  los renderiza con `VirtualList` y pagina con un botón **Cargar más**. El estado
  vive en `history.svelte.ts` (sobrevive al cambio de pestaña; se marca obsoleto
  tras commit/push/pull para refrescarse la próxima vez que se muestra).
- **Fila de commit**: badges de decoración (`HEAD`, ramas, `tag:`), resumen,
  hash corto, autor y **tiempo relativo localizado** (`Intl.RelativeTimeFormat`).
- **Estados**: sin worktree, no es repo (el log falla), repo sin commits, sin
  resultados de filtro. **Filtro** cliente por resumen/hash/autor.
- **Expandir commit → archivos → diff por archivo**: un clic en un commit lo
  **expande en línea** mostrando su lista de archivos modificados (letra de estado
  A/M/D/R + ruta); un clic en un archivo abre **solo la porción de ese archivo**
  del diff del commit como **pestaña central** de solo-lectura (`CommitPane.svelte`
  + `DiffView`, respaldada por un `CommitViewerState` con filtro `file`, registrado
  en el store de terminales). Backend: se usa el **mismo** `git_show(path, hash)`
  (diff vs primer padre; `hash` validado como hexadecimal) — el diff completo se
  **parte por archivo en el frontend** (`diffParse.ts → splitCommitDiff /
  commitFileDiff`, con tests unitarios), sin comandos nuevos. La lista de archivos
  se cachea por hash en `history.svelte.ts` (los commits son inmutables). Los
  diffs por archivo son mucho más legibles que un único blob gigante.
- **Hover-card de detalles**: al pasar el cursor sobre un commit aparece una
  tarjeta flotante (`ui/hover-card`, sobre `bits-ui LinkPreview`) con el título
  completo, el cuerpo del mensaje, el hash corto y completo, el autor (nombre ·
  email), la fecha absoluta localizada y las refs.
- **Grafo de ramas integrado**: un toggle dibuja un *gutter* SVG de carriles de
  colores (ramas, merges, separaciones) a la izquierda de cada commit. Los
  carriles se calculan **puramente en el frontend** a partir de los `parents` de
  cada commit (`gitGraph.ts → computeGraph`): cada carril mantiene el hash que
  espera a continuación; el commit ocupa el/los carriles que lo esperaban (el más
  a la izquierda es su nodo, el resto son aristas de merge que colapsan en él), su
  primer padre continúa en el mismo carril y cada padre extra abre/reutiliza otro.
  **Color estable por rama** (estilo VS Code): a cada carril se le asigna un id
  de color al nacer que conserva toda su vida (un carril reutilizado recibe uno
  nuevo), de modo que una rama mantiene su color aunque cambie de columna — en
  vez de colorear por índice de columna, donde ramas distintas que comparten
  columna se verían iguales. Las aristas de branch/merge se dibujan con
  **conectores de esquina redondeada** (vertical → arco → horizontal, como VS
  Code) en lugar de diagonales rectas, y los **merge commits** llevan un punto
  sólido con un **anillo de contorno separado**. El grafo solo se muestra sobre
  el log sin filtrar (un filtro rompería las cadenas de padres).

#### Comandos Tauri (historial)

| Comando | Descripción |
|---|---|
| `git_log(path, limit, skip)` | Lista el historial del worktree (más reciente primero, topológico). Motor `git2` (revwalk) con fallback CLI; un `HEAD` sin nacer (repo sin commits) devuelve lista vacía. |
| `git_show(path, hash)` | Diff unificado que introdujo un commit (vs su primer padre). `git2` con fallback `git show`; `hash` validado como hexadecimal. |
| `git_commit(path, message, amend, signOff)` | Commit de lo staged; `amend` reescribe `HEAD`, `signOff` añade `Signed-off-by:` (`-s`). |

Implementación: `src-tauri/src/git.rs` + `gitfast.rs` (`CommitInfo`, `log`,
`show`, `commit`).
