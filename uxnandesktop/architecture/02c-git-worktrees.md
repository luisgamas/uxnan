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
Lanzar agente             Diffs en sidebar dcha    Limpiar rama (safe)
```

---

## 2. Flujos Core de Worktrees

### 2.1 Creación de Worktree

El flujo de creación es el más complejo y tiene varias garantías:

1. **Resolver la referencia base**: El usuario selecciona una rama base. El ADE la resuelve a una referencia completa, verificando que existe. Se prueba un orden de prioridad: referencia simbólica de HEAD remoto, luego `main`, luego `master`, con fallback a ramas locales.

2. **Crear el worktree**: Se ejecuta `git worktree add` con la opción de no rastrear upstream automáticamente. Esto evita que la rama nueva herede el estado de tracking de la base, previniendo reportes falsos de "detrás de upstream" antes del primer push.

3. **Configurar push automático**: Se establece `push.autoSetupRemote=true` en la configuración del repo (una sola vez) para que `git push` sin argumentos cree automáticamente la rama remota.

4. **Refrescar la referencia base local**: Si la base es una rama remota (ej: `origin/main`), se puede hacer fast-forward de la rama local correspondiente para que el worktree empiece desde lo más reciente. Esto solo se hace si la rama local no tiene cambios propios.

5. **Atomicidad**: Si cualquier paso falla, se limpia el worktree parcialmente creado y su rama.

6. **Almacenar metadatos**: Se guardan nombre, agente asociado, timestamp de creación.

7. **Lanzar agente** (opcional): Si el worktree fue creado con un agente predefinido, se lanza automáticamente en un terminal nuevo.

### 2.2 Cambio de Worktree

1. El usuario hace click en una tarjeta de worktree.
2. Se activa el worktree en el estado reactivo de Svelte.
3. Los tabs/terminales del worktree anterior se ocultan (pero siguen corriendo).
4. Los tabs/terminales del nuevo worktree se muestran.
5. Se actualiza el estado visual de la sidebar.

### 2.3 Eliminación de Worktree

La eliminación tiene múltiples salvaguardas:

1. **Preflight de limpieza**: Se ejecuta `git status` en el worktree. Si hay cambios sin commitear, la eliminación se bloquea (a menos que sea forzada). Si está limpio: se matan los terminales asociados.

2. **Eliminación del worktree**: `git worktree remove` + `git worktree prune`.

3. **Limpieza de rama inteligente**:
   - Se intenta borrar la rama con `git branch -d` (safe delete, falla si hay commits sin mergear).
   - Si el delete falla pero los cambios fueron mergeados vía squash, se analiza si la rama es "patch-equivalente" a la base. Si lo es, se borra con seguridad.
   - Si no se puede confirmar que los cambios están mergeados, la rama se preserva y se notifica al usuario.

4. **Verificación post-eliminación**: Se re-lista los worktrees para confirmar que no quedó en un estado inconsistente.

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

### 3.4 Gestión de Ramas

- **Nomenclatura**: Las ramas se crean con un prefijo configurable (ej: `usuario/feature-name`, `custom/feature-name`, o sin prefijo). Los nombres se sanitizan para eliminar caracteres no válidos.
- **Detección de base por defecto**: Al crear una rama, el ADE prueba en orden un conjunto de bases conocidas (HEAD remoto, main, master, etc.) para determinar la base más adecuada.

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

El panel derecho expone **tres vistas mediante pestañas** (`RightPanel.svelte` con
`shadcn-svelte` Tabs). De izquierda a derecha:

1. **Archivos** (`FileTreePanel.svelte`): el árbol de archivos completo del
   worktree/proyecto activo, no solo los archivos con cambios.
2. **Cambios** (`ChangesPanel.svelte`): el visor de control de versiones descrito
   en las secciones 3–4 (estado/diff/stage/commit/push/pull).
3. **Historial** (`HistoryPanel.svelte`): el log de commits del worktree activo,
   con un grafo de ramas opcional (ver §6.4).

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
- **Menú contextual (clic derecho) por ítem**: cada archivo/carpeta ofrece
  operaciones completas reutilizando `ui/context-menu`
  (`FileTreeContextMenu.svelte`): New File · New Folder · Copiar ruta / ruta
  relativa · Duplicar *(archivo)* · Añadir como proyecto *(carpeta)* · Abrir en
  terminal *(carpeta)* · Ver archivo · Contraer carpeta · Buscar en la carpeta
  *(acota la búsqueda a un subárbol, con chip limpiable)* · Revelar en el
  explorador · Renombrar · Eliminar. Crear/renombrar pasan por un diálogo de
  nombre (`FileNamePromptDialog.svelte`) con validación de nombre "desnudo" y
  aviso de cambio de extensión. **Eliminar mueve a la papelera del SO** (crate
  `trash`, recuperable) tras el `ConfirmDialog` destructivo compartido. Backend:
  `fs_create_file` / `fs_create_dir` / `fs_delete` / `fs_duplicate`, con las
  mismas guardas de nombre/no-clobber que `fs_rename` (`validate_bare_name`). Las
  pestañas de archivo abiertas **siguen un renombrado o se cierran al eliminar**
  (`terminals.repathTabs` / `closeTabsUnder`).

### 6.2 Editor de Archivos (panel central)

`FileEditor.svelte` se renderiza como una **pestaña de archivo** en el árbol de
regiones del área central — ya no como un overlay superpuesto. Editores, diffs y
terminales son pestañas del mismo `TabGroup` (ver `02b-terminal-engine.md`
§3.1/§3.3), por lo que conviven entre pestañas y permiten **splits mixtos** (p.
ej. terminal a la izquierda / editor a la derecha). El estado vivo de cada
pestaña (contenido, dirty, diff) vive en un registro por id en el store de
terminales, no en el árbol serializado, así CodeMirror/xterm nunca se remontan al
dividir/reordenar y escribir no ensucia el layout persistido. Las pestañas de
archivo se restauran al reiniciar (por ruta); las de diff son transitorias.
Características:

- **Edición real con CodeMirror 6** + **resaltado de sintaxis** por extensión de
  archivo (`editorLang.ts`: JS/TS/JSON/CSS/HTML/Markdown/Rust/Python/YAML/XML/
  C++/Java/PHP/SQL/Go), números de línea e historial (undo/redo).
- **Medianil de cambios git** (no el diff completo): las **líneas añadidas** vs
  `HEAD` se resaltan con un color claro; un **marcador pequeño en la orilla
  izquierda** despliega bajo demanda **solo las líneas eliminadas** (peek), sin
  mostrar el diff completo. El medianil se deriva de `git diff HEAD -- <archivo>`
  (comando `git_diff_head`), parseado en `diff.ts` (`parseHeadDiff`).
- **Guardado**: botón **Guardar** o atajo **Ctrl/Cmd+S** → escribe el archivo
  (`fs_write_file`, escritura atómica temp+rename en el backend) y refresca el
  medianil + el estado git. Indicador de cambios sin guardar en la cabecera.
- **Guardas**: archivos binarios o demasiado grandes (> 2 MiB) no se editan; se
  muestra un aviso en lugar de cargar contenido (`fs_read_file` reporta los
  flags `binary` / `tooLarge`).
- **Aviso de cambios sin guardar**: cerrar una pestaña de archivo con ediciones
  pendientes pregunta **Guardar / Descartar / Cancelar** (`SaveDiscardDialog`
  + el servicio `confirm.svelte.ts`); cerrar una región con varios archivos
  sucios pregunta una sola vez. Aplica en todas las rutas de cierre.
- **Cambio externo en disco**: si el archivo abierto cambia en disco (evento
  `fs:changed`) mientras hay ediciones sin guardar, el editor muestra una barra
  **Recargar / Mantener mis cambios**; si la pestaña está limpia, recarga sola.
  Los visores de diff recargan su contenido.

### 6.3 Comandos Tauri (sistema de archivos)

| Comando | Descripción |
|---|---|
| `fs_list_dir(path)` | Lista un nivel de directorio (carpetas primero, luego archivos; `.git` oculto). |
| `fs_read_file(path)` | Lee un archivo de texto para el editor (flags `binary` / `tooLarge`). |
| `fs_write_file(path, content)` | Sobrescribe un archivo (atómico: temp + rename). |
| `git_diff_head(path, file)` | Diff working-tree-vs-`HEAD` de un archivo, para el medianil del editor. |
| `reveal_path(path)` | Revela una ruta en el explorador de archivos del SO (plugin opener). |
| `fs_set_watch(path?)` | Apunta (o limpia) el watcher de filesystem al worktree activo; emite `fs:changed` al crearse/eliminarse/editarse archivos. |
| `git_numstat(path)` | Líneas añadidas/eliminadas por archivo vs `HEAD` (`+a −d` en la lista de cambios). |

La barra de la pestaña Archivos ofrece además: **búsqueda/filtro** por nombre,
**contraer/expandir todas** las carpetas, **abrir en el explorador del SO**
(`reveal_path`) y actualizar. Los atajos de teclado de la app son configurables
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
