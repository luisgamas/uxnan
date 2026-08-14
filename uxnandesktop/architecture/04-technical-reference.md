# 04 - Referencia Tecnica: MVP, Fases, Convenciones y Glosario

> Referencia tecnica completa del Uxnan Desktop ADE.
> Cubre el checklist de funcionalidades minimas viables, las fases de implementacion,
> convenciones de codigo y glosario de terminos tecnicos.
> Fuente: secciones 9 y 10 de `architect-desktop.md`, con extensiones para Bridge.
> Fecha de la version inicial: 2026-06-05.
> **Fecha de la sincronizacion ALPHA: 2026-06-17** (ver `00-index.md` → *Estado de implementacion*).
>
> **Regla de mantenimiento (ver `AGENTS.md` → *Spec drift control (non-negotiable)*):**
> este documento es parte de la **fuente de verdad** de la arquitectura del ADE.
> Cualquier item marcado `DONE` en `uxnandesktop/FOR-DEV.md` debe reflejarse
> aquí en el mismo conjunto de cambios. La spec NO debe quedar atrás del
> código en un release.

---

## 1. Funcionalidades Minimas Viables (MVP)

Estas son las funcionalidades **estrictamente necesarias** para un ADE ligero que sea competitivo en usabilidad. Se organizan en tres tiers de prioridad.

---

### Tier 1: Indispensable (Sin esto no es un ADE)

#### T1.1 - Gestion de Worktrees

- [ ] Agregar repositorios al ADE.
- [ ] Crear worktrees con seleccion de rama base.
- [ ] Listar worktrees por repositorio en la sidebar.
- [ ] Cambiar de worktree activo con un click (muestra/oculta terminales asociados).
- [ ] Eliminar worktrees con verificacion de cambios sucios.
- [ ] Limpieza segura de rama al eliminar worktree.
- [ ] Persistencia de la lista de repos y worktrees en disco.

#### T1.2 - Terminales con PTY

- [ ] Crear tabs de terminal dentro de cada worktree.
- [ ] Emulacion de terminal completa (xterm.js en frontend + portable-pty en backend Rust).
- [ ] Split horizontal y vertical de panes dentro de un tab.
- [ ] Cada pane = un proceso PTY independiente.
- [ ] Los terminales siguen corriendo cuando el tab/worktree no esta visible.
- [ ] Buffer limitado para terminales ocultos con mecanismo de recuperacion.
- [ ] Matar procesos al cerrar tab/pane.
- [ ] Persistencia del layout de tabs/splits por worktree.

#### T1.3 - Monitoreo de Estado de Agentes

- [ ] Servidor HTTP local para recibir hooks de estado de agentes.
- [ ] Parsing de estados: working, waiting, blocked, done.
- [ ] Indicador visual de estado en la tarjeta del worktree (sidebar).
- [ ] Indicador visual de estado en la barra de tabs del terminal.
- [ ] Notificacion OS cuando un agente completa su tarea.
- [ ] Badge de "no-leido" en worktrees con agentes completados.
- [ ] Cache de ultimo estado con persistencia (sobrevive reinicios).

#### T1.4 - Visor de Diffs y Control de Cambios

- [ ] Panel de estado git mostrando archivos modificados/staged/untracked.
- [ ] Polling automatico de `git status` (cada ~3 segundos).
- [ ] Visor de diffs inline (unificado).
- [ ] Operaciones: stage, unstage, discard a nivel de archivo.
- [ ] Composicion de commit con editor de mensaje.
- [ ] Refresh automatico cuando el agente modifica archivos.

---

### Tier 2: Importante (Mejora significativa de UX)

#### T2.1 - Mejoras de Visor de Diffs

- [ ] Modo side-by-side (lado a lado) ademas de inline.
- [ ] Scroll virtual para changesets grandes.
- [ ] Carga lazy de diffs por archivo (bajo demanda).
- [ ] Stage/unstage a nivel de hunk (parcial).
- [ ] Navegacion de archivo a archivo dentro del changeset.
- [ ] Generacion AI de mensaje de commit.

#### T2.2 - Mejoras de Terminal

- [ ] Splits de TabGroup (dividir el area central en regiones con tabs independientes).
- [ ] Drag & drop de tabs entre TabGroups.
- [ ] Lanzamiento automatico de agente al crear worktree.
- [ ] Auto-deteccion de agente por nombre de proceso en el PTY.
- [ ] Deteccion de estado via titulo de terminal (fallback para agentes sin hooks).

#### T2.3 - Mejoras de Sidebar

- [ ] Agrupacion por estado (Fijados, Recientes, Archivados).
- [ ] Indicador de actividad reciente (timestamp de ultima actividad PTY).
- [ ] Scroll virtualizado para muchos worktrees.
- [ ] Busqueda/filtrado rapido de worktrees.
- [ ] Grupos de proyectos (carpetas organizacionales).

#### T2.4 - Robustez de Persistencia

- [ ] Escritura atomica con backups rotativos.
- [ ] Migraciones de esquema para actualizaciones de version.
- [ ] Encriptacion de datos sensibles (API keys, tokens) via keychain del OS.

#### T2.5 - Prevencion de Suspension

- [ ] Bloquear suspension del sistema cuando hay agentes activos.
- [ ] Auto-liberacion despues de periodo de inactividad.

---

### Tier 3: Nice to Have (Diferenciadores)

#### T3.1 - Orquestacion Multi-Agente — ✅ Hecho (consola de orquestacion, `02d` §3)

- [x] Grafo de relaciones coordinador→workers (en memoria; el usuario designa el
      coordinador). La creacion *automatica* de workers por el coordinador queda
      como follow-up (necesita un canal agente→ADE; `FOR-DEV.md`).
- [x] Routing de mensajes entre agentes coordinados (por tipo / todos / workers,
      con fan-out y backpressure por agente).
- [~] Visualizacion de linaje: se muestra en la **consola de orquestacion**, no
      anidada en la sidebar izquierda (`02d` §3.4; mover al arbol del proyecto es
      el follow-up de `FOR-DEV.md`).

#### T3.2 - Revision Avanzada

- [ ] Comentarios inline en diffs (anotaciones del usuario).
- [x] Diffs de imagenes (antes/despues visual). — Hecho (ver `02c` §4.2).
- [x] Vista de diff de branch completa (no solo uncommitted). — Hecho (fuente de
      diff `branch`, `02c` §4.6; y el diff completo de un PR vía `gh pr diff`).
- [~] Integracion con PRs de GitHub/GitLab. — **GitHub: hecho** (integración
      `gh`-backed: vista GitHub inline por-proyecto (centro+derecha, abierta desde el
      menú ⋯ de la tarjeta **o el menú contextual de cualquier fila de worktree**,
      ambas por `github.openSection`) + tab contextual del panel derecho +
      review/merge/**close/reopen** de PRs, con **CI en sección expandible** en el detalle
      + **popover** en el head-commit del timeline y por fila en la lista, **diff separado
      por archivo** (colapsado por defecto + expandir/contraer todo), un **timeline estilo
      GitHub** (riel vertical cronológico: descripción + comentarios + veredictos de review
      + commits (con badge **Verificado**) + eventos — labeled/assigned/closed/merged/… vía
      la Timeline Events API; bodies/comentarios/reviews como **Markdown** con imágenes
      inline) con **campos para comentar**, **reviewers**, **iconos de estado** con color,
      **barras de búsqueda**, **fechas relativas** localizadas, el detalle del PR
      separado en pestañas **Conversación / Archivos cambiados**, y las herramientas
      review/merge/close en una **barra inferior** disponible desde ambas pestañas
      (merge/approve/request-changes **restringidos a PRs abiertos**); al crear un PR se
      **eligen sus ramas `base ← head`** (cualquiera de los dos lados puede ser
      cualquier rama, local o de `origin`; por defecto la rama por defecto del repo y la
      rama activa, fijada a la del worktree en el tab del panel derecho);
      el **merge respeta la protección de ramas**: los métodos son los del repo ∩ los de
      las **rulesets** de la rama base (`gh api …/rules/branches/{base}`; el endpoint
      clásico `/branches/{b}/protection` devuelve 404 en ramas protegidas por ruleset),
      un PR bloqueado **explica por qué**, y las salidas son **auto-merge** (`--auto`,
      solo si el repo lo permite) y **bypass de administrador** (`--admin`, ofrecido en
      **cualquier** PR bloqueado —`viewerCanAdminister` no ve los `bypass_actors` de una
      ruleset y falla en GHES—, tras confirmación); issues
      (list/view/create/**close/reopen**), Actions logs, PR/issue↔worktree (tras un
      diálogo de ajustes: nombre de rama, agente a lanzar, previsualización de carpeta),
      **redacción de PR con IA** configurada en una sección propia calcada de
      Settings → AI commit (interruptor, agente con logos + estado de instalación,
      `AiModelPicker`, idioma, instrucciones),
      badges y lectura pasiva dentro del popover del backend en la barra de estado
      (sin leer + rate limit, punto en el icono del backend y fila hacia
      Settings → GitHub); `src-tauri/src/github.rs`, `docs/github.md`).
      **GitLab: pendiente** (el enfoque `gh`-centrico es
      GitHub-only; ver `FOR-DEV.md → "GitHub integration — follow-ups"`).

#### T3.3 - Navegador Embebido

- [ ] Webview integrado para previsualizar aplicaciones web.
- [ ] Tabs de navegador dentro del area central.

#### T3.4 - Terminal Flotante

- [ ] Panel de terminal desacoplable/flotante independiente de los worktrees.

#### T3.5 - Integracion Bridge [NUEVO]

- [ ] Bridge embebido como sidecar de Tauri (proceso Node.js gestionado).
- [ ] Conexion movil desde la interfaz de escritorio.
- [ ] Emparejamiento QR desde la GUI del ADE.

#### T3.6 - Mascotas (pets) — ✅ Hecho (`02d` §1.7)

- [x] Companero animado opcional (apagado por defecto) que refleja el estado
      preciso de los agentes: `working`→`running`, `waiting`→`waiting`,
      `done`→`review`, `blocked`→`failed`, nadie reportando→`idle`; los reportes
      stale (§1.5) se ignoran.
- [x] **Una sola mascota**, con el estado mas urgente ganando (`waiting` →
      `blocked` → `done` → `working`). El modo colonia (una por agente) se
      construyo y se retiro por no aportar sobre la barra lateral.
- [x] **Ventana propia de escritorio (por defecto, desactivable)** — sin bordes,
      transparente, siempre encima, visible sobre otras apps y con uxnan
      minimizado; drag nativo de ventana (correcto en DPI/multi-monitor),
      posicion persistida y validada contra los monitores vivos, capability
      propia (`pet.json`), carga por query segun el modo (`/?window=pet` en dev,
      `index.html?window=pet` empaquetada) y **traer uxnan al frente al clic
      como interruptor propio, apagado por defecto** (`02d` §1.7).
- [x] **Interactividad de puntero**: la mascota mira al cursor mientras descansa
      (las 16 poses v2 de las filas 9-10, zona muerta al frente), reacciona al
      clic con un salto y sostiene la pose de mirar-abajo mientras se arrastra.
- [x] Clic en la mascota revela la terminal de su agente; arrastrable, se acomoda
      en la esquina mas cercana.
- [x] Formato en disco **compatible con Codex** (`pet.json`/`avatar.json` + hoja
      de sprites), asi que los paquetes de la comunidad cargan sin cambios;
      importacion desde `~/.codex/pets` o cualquier carpeta como **copia
      validante** (solo manifiesto + hoja referenciada).
- [x] uxnan incluye **solo su propia mascota**; el resto lo importa el usuario y
      su arte sigue siendo de su autor (avisos de procedencia + `ORIGIN` por
      mascota).
- [x] Interruptor en el menu de perfil de la sidebar + seccion **Settings → Pets**
      (grupo General). `src-tauri/src/pets.rs`, `src/lib/pets/`,
      [`docs/pets.md`](../docs/pets.md).
- [ ] Generacion de mascotas con IA ("hatch") — pendiente, requiere generacion de
      imagenes consistente en ~72 cuadros (`FOR-DEV.md → "Pets — follow-ups"`).

---

## 2. Fases de Implementacion

> **Estado de las fases (snapshot 2026-06-16):** Phases 0-5 + la pista cross-
> cutting (S) estan **completas** (ver `00-index.md` → *Estado de implementacion*
> y `uxnandesktop/CHANGELOG.md`). Phase 6 (integracion del bridge) es la
> **unica fase restante** y es **opcional para uso standalone**. Las
> estimaciones en semanas que aparecen debajo son las **originales de la
> definicion inicial**; ver `uxnandesktop/FOR-DEV.md` para el detalle real
> de lo que falta y por que.

---

### Fase 0: Infraestructura Base (2-3 semanas)

**Objetivo**: Tener una aplicacion de escritorio vacia con el skeleton de tres paneles y la comunicacion backend-frontend funcionando.

#### Backend Rust

- Inicializar proyecto Tauri 2 con `cargo tauri init`.
- Configurar Tokio como runtime async.
- Implementar structs base con Serde para el modelo de datos (Repo, Worktree, Settings).
- Implementar persistencia JSON basica (lectura/escritura atomica con write-rename y debounce via Tokio timer).
- Registrar los primeros Tauri commands de prueba para validar comunicacion.

#### Frontend Svelte 5

- Configurar proyecto Svelte 5 con Vite + Tailwind CSS.
- Instalar y configurar shadcn-svelte (componentes base: Button, Dialog, Sidebar).
- Implementar el layout de tres paneles con resize handles (CSS grid + drag handlers).
- Implementar estado reactivo base con `$state` de Svelte 5 (repos, worktree activo, UI state).
- Conectar frontend con backend via `invoke()` y validar round-trip de datos.

#### Entregable

Ventana de escritorio nativa con tres paneles vacios redimensionables. Store reactivo Svelte funcional. Persistencia Serde basica. Comunicacion Tauri commands/events validada.

---

### Fase 1: Terminal Core (2-3 semanas)

**Objetivo**: Poder ejecutar comandos en una terminal integrada con tabs y splits.

#### Backend Rust

- Integrar crate `portable-pty` para gestion de pseudoterminales.
- Implementar PTY manager: crear, escribir, redimensionar, cerrar PTYs.
- Implementar streaming de output PTY a frontend via Tauri events (`emit('pty:output:{id}', bytes)`).
- Implementar buffer async con `tokio::sync::mpsc` para PTYs de tabs ocultos.
- Registrar Tauri commands: `pty_create`, `pty_write`, `pty_resize`, `pty_close`.

#### Frontend Svelte 5

- Integrar xterm.js en un componente Svelte.
- Conectar xterm.js al backend: input via `invoke('pty_write')`, output via `listen('pty:output')`.
- Implementar barra de tabs de terminal (crear, cerrar, reordenar).
- Implementar splits de panes dentro de un tab (arbol binario recursivo con drag-to-resize).
- Implementar persistencia de layout de tabs/splits en el estado (Serde via backend).

#### Entregable

Terminal funcional con tabs y splits. Se puede ejecutar cualquier comando. Multiples PTYs en paralelo.

---

### Fase 2: Git y Worktrees (2-3 semanas)

**Objetivo**: Crear, listar y gestionar worktrees de git.

#### Backend Rust

- Integrar crate `git2` para operaciones git de alta frecuencia.
- Implementar modulo git: `git2::Repository::open()`, status, branch list.
- Implementar operaciones de worktree via CLI (`tokio::process::Command`): add, remove, list.
- Implementar resolucion de rama base por defecto (probing: origin/HEAD, main, master).
- Implementar preflight de eliminacion (verificar cambios sucios con `git2::statuses()`).
- Implementar limpieza segura de rama al eliminar worktree.
- Registrar Tauri commands: `repo_add`, `worktree_create`, `worktree_remove`, `worktree_list`.

#### Frontend Svelte 5

- Implementar sidebar izquierda con lista jerarquica de repos y worktrees (shadcn-svelte Sidebar + Tree).
- Implementar tarjetas de worktree con nombre de rama e indicadores.
- Implementar cambio de worktree activo (click -> muestra/oculta terminales asociados).
- Implementar dialogo de "Crear Espacio de Trabajo" (seleccion de repo, rama base, agente).
- Conectar creacion de worktree con creacion automatica de terminal.

#### Entregable

Sidebar funcional con worktrees. Se puede crear un worktree, lanzar un agente, cambiar entre worktrees, y eliminar worktrees de forma segura.

---

### Fase 3: Estado Git y Diffs (2-3 semanas)

**Objetivo**: Ver y actuar sobre los cambios de archivos en tiempo real.

#### Backend Rust

- Implementar polling de `git2::Repository::statuses()` cada 3 segundos con Tokio interval.
- Emitir Tauri events `git:status-changed` con la lista de archivos modificados/staged/untracked.
- Implementar operaciones: stage (`git2::Index::add_path`), unstage, discard.
- Implementar commit (`git2::Repository::commit`).
- Implementar diff via `git2::Diff` para obtener hunks y lineas modificadas.
- Pausar polling cuando la ventana pierde visibilidad (Tauri window focus events).

#### Frontend Svelte 5

- Implementar sidebar derecha con arbol de archivos organizado por area (Changes, Staged, Untracked).
- Integrar CodeMirror 6 con extension de diff para visor inline.
- Implementar acciones por archivo: stage, unstage, discard (botones en cada fila del arbol).
- Implementar compositor de commit con textarea para mensaje.
- Conectar `listen('git:status-changed')` a actualizacion reactiva del arbol.

#### Entregable

Panel de cambios funcional. Se ven los diffs de lo que el agente modifica en tiempo real. Se pueden stagear archivos y commitear.

---

### Fase 4: Monitoreo de Agentes (1-2 semanas)

**Objetivo**: Saber que esta haciendo cada agente en cada worktree.

#### Backend Rust

- Implementar HTTP server local con `axum` o `hyper` (async, Tokio) para recibir hooks POST de agentes.
- Implementar parsing y normalizacion de payloads de estado (working, waiting, blocked, done).
- Implementar cache persistente de ultimo estado (HashMap + Serde a JSON, TTL de 7 dias).
- Emitir Tauri events `agent:status-changed` ante cada cambio.
- Implementar notificaciones OS via `tauri-plugin-notification` para agentes completados.

#### Frontend Svelte 5

- Agregar indicadores visuales de estado en las tarjetas de worktree (sidebar izquierda): punto de color con animacion segun estado.
- Agregar indicadores de estado en la barra de tabs del terminal.
- Implementar badge de "no-leido" para worktrees con agentes completados.
- Implementar limpieza de badges al enfocar el worktree.

#### Entregable

Monitoreo en tiempo real de agentes. Badges en sidebar. Notificaciones nativas del OS al completar.

---

### Fase 5: Pulido y UX (2-3 semanas)

**Objetivo**: Hacer la experiencia fluida y robusta.

#### Backend Rust

- Implementar diff por hunk para stage parcial (usando `git2::Diff::foreach` + index manipulation).
- Implementar backups rotativos de persistencia (5 copias).
- Implementar migraciones de esquema para futuros cambios de formato.
- Implementar prevencion de suspension del sistema (APIs nativas del OS) cuando hay agentes activos.
- Implementar encriptacion de secretos via `tauri-plugin-stronghold`.

#### Frontend Svelte 5

- Implementar modo side-by-side para diffs (CodeMirror 6 con dos editores sincronizados).
- Implementar scroll virtual con TanStack Virtual en diffs y sidebar.
- Implementar stage/unstage por hunk en la UI del diff viewer.
- Agregar busqueda/filtrado rapido de worktrees en la sidebar.
- Implementar splits de TabGroup (nivel alto: dividir area central en regiones independientes).
- Testing E2E de flujos principales con Playwright o WebdriverIO.

#### Auto-updater in-app — ✅ Hecho (adición post-plan)

- `tauri-plugin-updater` envuelto en `src-tauri/src/updater.rs`: comandos
  `updater_check` / `updater_download` / `updater_staged` /
  `updater_discard_staged` / `updater_install`.
- **Descarga e instalación separadas a propósito**: descargar es en segundo plano
  (no molesta a los agentes); instalar reinicia la app y por tanto **detiene los
  agentes** (cada agente es un hijo PTY del proceso), así que la instalación está
  guardada por la actividad de agentes (instala al quedar inactivos, o con
  confirmación explícita). Antes de instalar se cierran las terminales limpiamente.
- **Canales** `stable`/`nightly` (default stable), mapeados al flag `prerelease`
  de GitHub (no al tag): release normal → stable, release marcado pre-release →
  nightly; endpoint por canal apuntando a un `latest.json` rodante. La comparacion
  de versiones usa la base numerica (`0.0.X`) que empaqueta el MSI; el nombre
  completo (con `-alpha.YYYYMMDD`) se muestra via `app_version`.
- UI: un **toast sonner fijado** (`UpdateToast.svelte`, orquestado por
  `updateToast.ts` con id estable + `duration: Infinity`, reemplaza al antiguo
  banner fijo superior) + acciones de **descargar/instalar dentro de
  Settings → Updates** (coherentes con la política de instalación); store
  `state/updater.svelte.ts`; i18n EN/ES.
- **Buscar es independiente del ciclo de vida.** En Settings → Updates conviven
  **dos botones**: *Buscar ahora*, presente en todos los estados, y la acción de
  fase (*Descargar* / *Instalar*), que solo aparece cuando existe. Buscar es un
  flag propio (`checking`) superpuesto a `status`, no un estado: una comprobación
  —o su fallo— nunca descarta una descarga ya lista para instalar. `checkOutcome`
  (`updaterLogic.ts`) decide el resultado comparando la versión ofrecida con la
  preparada: `keepStaged` si son la misma (la comprobación se hace contra la
  versión **en ejecución**, así que reofrece indefinidamente la ya descargada) y
  `superseded` si el canal ofrece otra distinta, en cuyo caso se desarma la
  instalación diferida, se **descarta el instalador preparado**
  (`updater_discard_staged`, esperado antes de la descarga nueva para que no
  borre la que acaba de llegar) y se descarga la nueva. La app solo ofrece la
  última: una versión anterior ya no era instalable —`updater_install` rechaza
  el desajuste de versión— y quien la quiera la baja del Release de GitHub. Esto
  es lo que permite recoger una release posterior mientras la primera espera a
  que los agentes queden inactivos, sin reiniciar la app. Firma minisign gratuita (`pubkey` en
  `tauri.conf.json`), independiente del code-signing del SO. **Distribucion macOS
  EXPERIMENTAL:** el CI genera dos DMG por arquitectura (Intel `x86_64` + Apple
  Silicon `aarch64`) con **firma ad-hoc** (`bundle.macOS.signingIdentity "-"`,
  `hardenedRuntime false`, `minimumSystemVersion 11.0`) — sin cuenta Apple; el
  usuario autoriza Gatekeeper a mano (`docs/install-macos.md`), y el `PATH` de un
  arranque desde Finder se enriquece al inicio (`path_env.rs`) para detectar los CLI
  de Homebrew/npm. La notarizacion con Apple Developer ID queda como via opcional
  futura. Detalle operativo en `docs/updates.md`; clave de firma en `FOR-HUMAN.md`.

#### Pirámide de pruebas — ✅ Hecho (adición post-plan)

`03-implementation-guide.md` bosquejaba Testing Library y Playwright; esto es lo
que quedó implementado, y en qué se apartó de aquel boceto. Documentación
operativa en `docs/testing.md`.

- **Cinco capas**, cada una con un trabajo que la anterior no puede hacer: L0
  estática, L1 unidad, L2 componentes Svelte en jsdom, L3 backend contra
  directorios temporales, L4 la app real conducida de extremo a extremo, L5
  checklist manual (cuentas, artefactos firmados, hardware físico). La separación
  existe por velocidad: casi todo se demuestra en una capa de milisegundos, que es
  lo que permite mantener pequeñas —y por tanto fiables— las capas caras.
- **Vitest se divide en dos proyectos** (`vitest.workspace.ts`). El proyecto
  `node` no carga el compilador de Svelte ni jsdom; el proyecto `dom` monta
  componentes reales. Los tests de componente son `*.svelte.test.ts`.
- **El doble se coloca por debajo de `api.ts`, no en su lugar.** Se usa el
  `mockIPC` propio de Tauri, así que `src/lib/api.ts` se ejecuta de verdad —sus
  nombres de comando, su serialización de argumentos— y solo es falso el proceso
  del otro lado. Un comando renombrado rompe un test en lugar de coincidir
  calladamente con un mock que nadie actualizó. **No hizo falta tocar código de
  producción.**
- **Driver E2E: WebdriverIO + `tauri-driver`**, decidido por spike y no por
  preferencia, verificado en Windows: **ocho recorridos, 24 pruebas, ~39 s**, verdes en
  ejecuciones consecutivas y sin procesos residuales (arranque, restauracion de
  sesion, terminales en split, workspace dormido, proyecto git, agente y cadena
  de hooks, ventana del browser, y un perfil de una build anterior). Cada spec
  arranca su propia app desde un perfil sembrado para el, asi que preparar un
  recorrido no cuesta clics y las aserciones siguen pasando por la UI real, IPC
  real y backend real. Dos trampas
  de esta capa quedaron cubiertas: `tauri-driver` entrega un webview en
  `about:blank` en vez de engancharse a la ventana ya navegada —todo devuelve un
  documento vacio y parece que la app no renderiza— y `tauri:options.env` **no
  llegaba a la app**, que arrancaba leyendo el perfil real del desarrollador; la
  sesion navega ahora al origen de la app (con IPC vivo: `invoke("ping")`
  responde `"pong"`) y **se niega a ejecutar** si la app bajo prueba tiene algun
  proyecto. Playwright era la
  alternativa y **no puede** conducir una ventana Tauri; podría servir el frontend
  por su cuenta, pero un test que nunca cruza IPC es un test de componente con un
  navegador al lado, y llamarlo E2E sería justo el autoengaño que esta capa
  pretende evitar. Comparativa, versiones fijadas y limitaciones declaradas en
  `docs/testing.md`.
- **Fixtures que no pueden alcanzar la máquina real**: un `gh` falso con pestillo
  obligatorio que depura credenciales de su log, un **shim de PATH** que resuelve
  cada CLI que la app invoca dentro de un directorio de dobles —un test que se
  olvide de simular uno recibe "blocked by the test harness" en vez de hablar con
  GitHub—, y perfiles de aplicación desechables y heredados. El repositorio Git,
  el agente sustituto y el servidor loopback se **comparten** con el banco de
  recursos en vez de duplicarse.
- **Matriz de calidad viva** (`tests/quality-matrix.json`), legible por máquina y
  verificada contra el repositorio: una fila que declara una capa debe citar un
  fichero que exista, una fila parcialmente cubierta debe declarar su hueco, y
  ninguna puede listar una capa como cubierta y planificada a la vez. Registra lo
  que **no** está probado con el mismo cuidado que lo que sí.
- **CI**: los tests de componente entran en el gate obligatorio desde el primer
  día; E2E vive en `e2e-desktop.yml` (Windows, **solo bajo demanda**) y no
  bloquea. El nocturno se retiró tras medir por qué nunca pasó en un runner de
  GitHub: allí el proceso navegador arranca **sin `--remote-debugging-port`**,
  así que nada queda escuchando y la sesión de WebDriver no llega a crearse.
  Descartados el emparejamiento del driver, la versión del runtime (se forzó el
  runner al mismo 151.0.4129.59 de la máquina donde sí pasa) y
  `webviewOptions.userDataFolder`. E2E es, por tanto, una capa **local**; la
  evidencia está en la cabecera del workflow y en `uxnandesktop/FOR-DEV.md`.
- **Decisión (2026-08-04): la app no lleva el switch de automatización.** Hacer
  que el binario pase `--remote-debugging-port` por su cuenta
  (`additional_browser_args` de wry) haría funcionar el runner, y se descarta:
  no se distribuye comportamiento de testeo en el binario que instala el usuario,
  y una app que puede abrir un puerto de depuración a petición es otro producto.
  Perder E2E en CI es el coste aceptado.
- **Restricción conocida**: E2E no puede convivir con otra instancia de uxnan
  —misma compartición del proceso navegador de WebView2 que ya afecta al banco de
  recursos— y el teardown mata **por PID, nunca por nombre**, porque una barrida
  por nombre se llevaría por delante el uxnan real del desarrollador.

Pendientes en `FOR-DEV.md` → *Test pyramid — follow-ups*.

#### Banco de pruebas de recursos — ✅ Hecho (adición post-plan)

La promesa de bajo consumo (`01-product-vision.md` §"Justificación de Tauri 2 sobre
Electron") pasa de objetivo declarado a contrato medible. Vive en
`scripts/resources/` y se documenta en `docs/resource-benchmarks.md`.

- **Doce escenarios canónicos** (R00–R11): proceso frío, reposo, 1 y 4 terminales,
  workspace dormido, agente trabajando, repositorio Git grande (10 000 archivos),
  browser, GitHub, pet apagado/capa/overlay, soak de 2 h, y reinicio con
  restauración. Cada uno declara pregunta, preparación determinista, ventana de
  estabilización descartada y ventana de medición.
- **Tres cubetas que nunca se suman**: `own` (la app + los auxiliares que crea su
  runtime), `managed` (más shells, ConPTY, `git`/`gh`, sidecars) y `external` (lo
  que el usuario ejecutó dentro de una shell). La atribución es **estructural** —
  descenso padre/hijo desde un PID que el propio harness lanzó — nunca por nombre:
  un proceso homónimo anterior no puede contarse, y uno renombrado no puede
  escaparse. El nombre solo decide *en qué* cubeta cae un descendiente (¿es shell?,
  ¿es auxiliar del webview?), replicando la lista de shells por las que desciende
  `procscan.rs`.
- **Los escenarios alcanzan su estado sembrando el perfil persistido de la app**
  (`AppData` + `SavedTerminalLayout`) en un directorio desechable, no conduciendo
  la UI. Eso los hace reproducibles hoy, sin esperar al driver E2E, y garantiza que
  el banco jamás lea ni escriba el perfil real.
- **`UXNAN_DATA_DIR`** (`src-tauri/src/datadir.rs`) es la única pieza de producción
  que el banco necesita: reubica el directorio de datos para un proceso — app,
  comandos que leen `<app-data>`, y runner headless de automatizaciones. Rechaza
  rutas relativas (dependerían del directorio de trabajo, así que el mismo comando
  podría apuntar a dos perfiles distintos). Un `env::var_os` al arranque; no altera
  nada de lo medido.
- **Una build de depuración usa su propio perfil** (`<default>-dev`, mismo
  `datadir.rs`), y el override sigue mandando por encima. No es orden: son el
  mismo producto pero no el mismo *código*, y serde descarta los campos que no
  sabe nombrar — así que cada guardado de la build más vieja borra los datos de la
  nueva. Compartir perfil entre la app instalada y una build de desarrollo de la
  rama de hosts remotos borró los hosts SSH y los proyectos que viven en ellos una
  y otra vez, y cada vez parecía que la app perdía sus propios ajustes. Dos builds
  de desarrollo siguen compartiendo `-dev`; para separarlas está `UXNAN_DATA_DIR`.
- **Fixtures locales, offline y deterministas**: repositorio Git generado cuyo hash
  de commit es función de sus argumentos (autor, committer y ambas fechas fijados,
  PRNG con semilla), agente sustituto que reproduce la *forma* de la carga de un
  agente sin modelo, red ni credenciales, y una página fija servida en loopback.
- **Presupuestos por plataforma** (absolutos; no comparables entre sistemas) más un
  **comparador contra línea base** que solo falla si una métrica empeora en términos
  relativos **y** absolutos a la vez. Arranca en `mode: "warn"`: recoge datos sin
  bloquear hasta conocer el ruido del hardware de referencia.
- **Privacidad**: los colectores no leen líneas de comando, entornos ni títulos de
  ventana; cada documento se depura antes de escribirse (usuario, host y los
  nombres de carpeta *bajo* el home, que son los nombres de proyecto) y la escritura
  se **rechaza** si algo personal sobrevive. Sin telemetría ni red.
- **Restricción conocida**: WebView2 mantiene un proceso navegador por carpeta de
  datos de usuario, así que una segunda instancia de Uxnan adjunta sus renderers al
  navegador de la primera y quedan fuera del árbol medido (el resultado reportaría
  solo el proceso Rust, ~27 MB, omitiendo el webview entero). El harness se niega a
  arrancar con otra instancia viva y marca inválida cualquier ejecución que nunca
  vio un webview dentro de su propio árbol.
- **CI** (`.github/workflows/resource-benchmarks.yml`): nocturno y bajo demanda en
  un runner Windows; sube resultados y reporte, y **nunca falla el build** — una VM
  compartida da señal de tendencia, no un gate.

Pendientes en `FOR-DEV.md` → *Resource benchmarks — follow-ups*: promover la línea
base de Windows y rellenar su presupuesto, pasar a `enforce` tras dos semanas de
ejecuciones reales, ejecutar el colector Unix en hardware real, y automatizar
R07/R08 cuando exista el driver E2E.

#### Modo de recursos — ✅ Hecho (adición post-plan)

Sobre el monitor de recursos en-app (`src-tauri/src/resources.rs`,
`docs/resource-monitoring.md`) se construye un **modo de recursos** con presets
explícitos — `Efficient` / `Balanced` / `Performance` — que gobierna el trabajo
en segundo plano sin degradar en silencio (`docs/resource-mode.md`).

- **Motor de políticas puro** (`src/lib/resources/policy.ts`:
  `ResourceProfile`, `ResourceCapabilities`, `ResolvedResourcePolicy`): cada
  consumidor lee la política resuelta en vez de replicar condiciones desde
  settings. `Balanced` es el predeterminado y **replica exactamente las
  constantes previas al modo** (un test lo fija), así que la migración no
  cambia nada. Persistencia aditiva en `AppSettings.resourceMode`
  (`{ profile, overrides, autoSleep, schemaVersion: 1 }`, `null` = heredar),
  validación sin residuos (perfil desconocido → `balanced`, override
  inválido → heredar, `schemaVersion` más nuevo → `balanced` sin overrides) y
  límites duros de seguridad fuera de los overrides.
- **Consumidores gobernados, en caliente y reversibles**: barrido de estado
  Git de todos los worktrees + reconciliación de la lista, sondeo de
  GitHub/proveedores (factores con suelo de 30 s; `0` sigue siendo manual),
  concurrencia de orquestación (2/4/4–6), retención del historial del monitor
  (nuevo comando `resources_set_policy` → `set_history_seconds`, 60–600 s) y
  las animaciones decorativas de la mascota. Los refrescos forzados (foco,
  actividad de agente, acciones git propias, todo botón manual) corren siempre.
- **El paralelismo extra de `Performance` exige evidencia**: la orquestación es
  el primer consumidor del *lease* `budget` del monitor (3 s), tomado solo con
  una ejecución activa, y concede el 5.º/6.º paso solo si un resumen fresco
  muestra CPU propia conocida y < 50 %.
- **Auto-dormir workspaces tras doble compuerta** (nivel del preset + feature
  flag apagado por defecto): sugerencias confirmadas por el usuario; el nivel
  `auto` nunca duerme un workspace con agente trabajando (solo sugiere) y
  reutiliza el ciclo sleep/wake existente de `terminals.svelte.ts`, sin
  duplicar lifecycle.
- **La degradación siempre se explica**: cada superficie relajada muestra un
  indicador con «refrescar ahora» que no cambia el preset.
- **Matriz de eficiencia por preset cableada en el banco**
  (`--resource-profile`), pendiente de medirse con la app cerrada.

Pendientes en `FOR-DEV.md` → *Resource mode — follow-ups*: capturar la matriz
por preset (app cerrada), el soak multiplataforma del flag de auto-dormir, un
E2E de cambio de preset y los detectores de agentes deliberadamente fuera de la
política en v1.

#### Entregable

ADE MVP completo, pulido y listo para uso diario.

---

### Fase 6: Integracion Bridge (2-3 semanas) [NUEVO]

**Objetivo**: Permitir que la aplicacion de escritorio funcione como bridge para la app movil, habilitando emparejamiento y gestion desde la GUI.

#### Backend Rust

- Configurar Tauri sidecar para el proceso Node.js del bridge.
- Implementar canal IPC (stdin/stdout JSON-RPC) entre Rust y el proceso bridge.
- Implementar gestion del ciclo de vida del bridge (inicio, detencion, reinicio, health check).
- Implementar Tauri command para generar codigo QR de emparejamiento.

#### Frontend Svelte 5

- Implementar seccion Settings -> Conexion Movil.
- Implementar dialogo de visualizacion de codigo QR para emparejamiento.
- Implementar indicador de telefono conectado en la UI.
- Implementar gestion de telefonos de confianza (listar, revocar).

#### Entregable

El escritorio puede servir como bridge para la app movil. Emparejamiento desde la GUI. Experiencia de instalacion unica (single-install).

---

### Estimacion Total

| Escenario | 1 desarrollador | 2 desarrolladores |
|-----------|-----------------|-------------------|
| Fases 0-5 (original) | 11-17 semanas | 6-10 semanas |
| Fases 0-6 (con bridge) | 13-20 semanas | 7-12 semanas |

Esto asume un desarrollador full-stack (Rust + Svelte) trabajando full-time. Con **dos desarrolladores** (uno enfocado en backend Rust, otro en frontend Svelte), se puede comprimir significativamente porque las interfaces entre backend y frontend estan bien definidas (Tauri commands/events actuan como contrato).

> **Nota sobre la curva de aprendizaje de Rust**: Si el equipo es nuevo en Rust, agregar 2-3 semanas adicionales de ramp-up. Los conceptos de ownership, borrowing, y async con Tokio requieren practica. La crate `git2` en particular tiene una API verbose que toma tiempo dominar. Considerar empezar con operaciones git via CLI (`tokio::process::Command`) y migrar a `git2` incrementalmente donde el rendimiento lo justifique.

---

## 3. Convenciones de Codigo

---

### 3.1 Rust (Backend)

| Aspecto | Convencion |
|---------|------------|
| Funciones y variables | `snake_case` |
| Tipos, structs, enums | `PascalCase` |
| Manejo de errores | `Result<T, E>` con `thiserror` para errores custom |
| Operaciones I/O | Siempre async con Tokio |
| Modulos | Un archivo por modulo, re-export desde `mod.rs` |
| Tests unitarios | En el mismo archivo con `#[cfg(test)]` |
| Tests de integracion | En directorio `tests/` |

### 3.2 Svelte 5 (Frontend)

| Aspecto | Convencion |
|---------|------------|
| Componentes | `PascalCase.svelte` |
| Estado mutable | `$state` rune |
| Estado computado | `$derived` rune |
| Props | `$props()` rune |
| Efectos secundarios | `$effect()` rune |
| Funciones y variables | `camelCase` |

### 3.3 Tailwind CSS

| Aspecto | Convencion |
|---------|------------|
| Estrategia | Utility-first, evitar CSS custom |
| Modo oscuro | Via prefijo `dark:` |
| Design tokens | Definidos en `tailwind.config.js` |

### 3.4 Commits

Se sigue la especificacion de **Conventional Commits**:

```
type(scope): mensaje descriptivo
```

**Tipos permitidos:**

| Tipo | Uso |
|------|-----|
| `feat` | Nueva funcionalidad |
| `fix` | Correccion de bug |
| `refactor` | Refactorizacion sin cambio de comportamiento |
| `docs` | Documentacion |
| `test` | Tests |
| `chore` | Tareas de mantenimiento |
| `ci` | Configuracion de CI/CD |

**Scopes permitidos:**

| Scope | Area |
|-------|------|
| `rust` | Backend Rust general |
| `svelte` | Frontend Svelte general |
| `terminal` | Motor de terminales y PTY |
| `git` | Operaciones git y worktrees |
| `agent` | Monitoreo de agentes |
| `bridge` | Integracion bridge movil |
| `ui` | Interfaz de usuario general |
| `config` | Configuracion y persistencia |

---

## 4. Glosario Tecnico

| Termino | Definicion |
|---------|------------|
| **ADE** | Agent Development Environment. Entorno de escritorio disenado para orquestar multiples agentes AI de linea de comandos en paralelo. |
| **Worktree** | Checkout independiente de git que permite trabajar en multiples ramas simultaneamente, cada una en su propio directorio. Es la unidad fundamental de aislamiento del ADE. |
| **PTY (Pseudoterminal)** | Dispositivo de terminal virtual que proporciona un canal bidireccional de I/O para procesos. Permite que el ADE ejecute shells y agentes como si estuvieran en una terminal real. |
| **Pane** | Panel individual de terminal/PTY dentro de un tab. Cada pane es un proceso PTY independiente con su propio shell o agente. |
| **TabGroup** | Coleccion de tabs dentro de una region del area central. Cada TabGroup tiene su propia barra de tabs y puede contener multiples tabs de terminal, editor o diff. |
| **Split** | Division del area central en regiones horizontales o verticales. Existe a dos niveles: splits de TabGroup (nivel alto) y splits de pane dentro de un tab (nivel bajo). |
| **Bridge** | Daemon Node.js que conecta la app movil con los agentes CLI del PC. Gestiona la comunicacion bidireccional, tunelizacion de terminales y ejecucion de comandos remotos. |
| **Relay** | Servidor intermediario para conectividad WAN con E2EE. Permite que el bridge y la app movil se comuniquen cuando no estan en la misma red local. |
| **E2EE** | End-to-End Encryption. Cifrado de extremo a extremo que garantiza que solo el emisor y receptor pueden leer los mensajes, ni siquiera el relay intermediario. |
| **Sidecar** | Proceso externo empaquetado y gestionado por Tauri. Se distribuye junto con la aplicacion y Tauri gestiona su ciclo de vida (inicio, detencion, reinicio). |
| **OSC** | Operating System Command. Secuencia de escape de terminal que permite a los procesos comunicar metadatos al emulador de terminal (por ejemplo, cambiar el titulo o reportar estado). |
| **Runes** | Sistema de reactividad de Svelte 5 basado en las primitivas `$state`, `$derived` y `$effect`. Reemplaza el sistema de stores de Svelte 4 con una API mas explicita y eficiente. |
| **git2** | Crate de Rust que proporciona bindings nativos para libgit2. Se usa para operaciones git de alta frecuencia (status, diff, stage, log) sin el overhead de crear subprocesos. |
| **portable-pty** | Crate de Rust para gestion de pseudoterminales multiplataforma (Windows, macOS, Linux). Permite crear, escribir, redimensionar y cerrar PTYs de forma programatica. |
| **Tokio** | Runtime async para Rust. Proporciona un event loop, timers, channels (`mpsc`), y un pool de threads para ejecutar operaciones I/O sin bloquear el hilo principal. |
| **Serde** | Framework de serializacion/deserializacion para Rust. Convierte structs de Rust a JSON (y viceversa) de forma type-safe y extremadamente rapida. |
| **axum/hyper** | Frameworks de servidor HTTP para Rust. `hyper` es la capa de protocolo HTTP de bajo nivel; `axum` es un framework web ergonomico construido sobre `hyper` y Tokio. Se usan para el servidor local de hooks de agentes. |
| **xterm.js** | Libreria de emulacion de terminal para la web. Renderiza output con WebGLAddon dentro del webview de Tauri y usa DOM como fallback. Soporta colores, mouse, resize y secuencias de escape completas. |
| **CodeMirror 6** | Editor de codigo para la web, utilizado en el ADE como visor de diffs. Mas ligero que Monaco (~300KB vs ~5MB). Extensible con plugins para diff inline y side-by-side. |
| **shadcn-svelte** | Coleccion de componentes UI para Svelte basada en Bits UI (equivalente de Radix). Proporciona botones, dialogos, sidebars, tabs, tooltips y otros componentes accesibles y personalizables. |
| **Tauri Command** | Mecanismo de IPC request/response de Tauri. El frontend invoca una funcion Rust anotada con `#[tauri::command]` usando `invoke()` en JavaScript. Ideal para operaciones que necesitan un resultado. |
| **Tauri Event** | Mecanismo de IPC streaming de Tauri. El backend emite eventos con `emit()` y el frontend los escucha con `listen()`. Ideal para flujos continuos como output de terminal o cambios de estado. |
| **Hook** | Peticion HTTP POST que un agente CLI envia al servidor local del ADE para reportar cambios de estado (working, waiting, blocked, done). Es el mecanismo principal de comunicacion agente -> ADE. |
| **Staleness** | Degradacion basada en timeout de la informacion de estado de un agente. Si un agente no reporta estado en 30 minutos, su estado se marca como "stale" y se muestra con opacidad reducida en la UI. Despues de 7 dias sin actividad, el registro se elimina del cache. |
