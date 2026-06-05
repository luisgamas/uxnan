# 04 - Referencia Tecnica: MVP, Fases, Convenciones y Glosario

> Referencia tecnica completa del Uxnan Desktop ADE.
> Cubre el checklist de funcionalidades minimas viables, las fases de implementacion,
> convenciones de codigo y glosario de terminos tecnicos.
> Fuente: secciones 9 y 10 de `architect-desktop.md`, con extensiones para Bridge.
> Fecha: 2026-06-05

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

#### T3.1 - Orquestacion Multi-Agente

- [ ] Grafo de relaciones padre-hijo entre worktrees/agentes.
- [ ] Routing de mensajes entre agentes coordinados.
- [ ] Visualizacion de linaje en la sidebar.

#### T3.2 - Revision Avanzada

- [ ] Comentarios inline en diffs (anotaciones del usuario).
- [ ] Diffs de imagenes (antes/despues visual).
- [ ] Vista de diff de branch completa (no solo uncommitted).
- [ ] Integracion con PRs de GitHub/GitLab.

#### T3.3 - Navegador Embebido

- [ ] Webview integrado para previsualizar aplicaciones web.
- [ ] Tabs de navegador dentro del area central.

#### T3.4 - Terminal Flotante

- [ ] Panel de terminal desacoplable/flotante independiente de los worktrees.

#### T3.5 - Integracion Bridge [NUEVO]

- [ ] Bridge embebido como sidecar de Tauri (proceso Node.js gestionado).
- [ ] Conexion movil desde la interfaz de escritorio.
- [ ] Emparejamiento QR desde la GUI del ADE.

---

## 2. Fases de Implementacion

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
| **xterm.js** | Libreria de emulacion de terminal para la web. Renderiza output de terminal en un canvas/WebGL dentro del webview de Tauri. Soporta colores, mouse, resize y secuencias de escape completas. |
| **CodeMirror 6** | Editor de codigo para la web, utilizado en el ADE como visor de diffs. Mas ligero que Monaco (~300KB vs ~5MB). Extensible con plugins para diff inline y side-by-side. |
| **shadcn-svelte** | Coleccion de componentes UI para Svelte basada en Bits UI (equivalente de Radix). Proporciona botones, dialogos, sidebars, tabs, tooltips y otros componentes accesibles y personalizables. |
| **Tauri Command** | Mecanismo de IPC request/response de Tauri. El frontend invoca una funcion Rust anotada con `#[tauri::command]` usando `invoke()` en JavaScript. Ideal para operaciones que necesitan un resultado. |
| **Tauri Event** | Mecanismo de IPC streaming de Tauri. El backend emite eventos con `emit()` y el frontend los escucha con `listen()`. Ideal para flujos continuos como output de terminal o cambios de estado. |
| **Hook** | Peticion HTTP POST que un agente CLI envia al servidor local del ADE para reportar cambios de estado (working, waiting, blocked, done). Es el mecanismo principal de comunicacion agente -> ADE. |
| **Staleness** | Degradacion basada en timeout de la informacion de estado de un agente. Si un agente no reporta estado en 30 minutos, su estado se marca como "stale" y se muestra con opacidad reducida en la UI. Despues de 7 dias sin actividad, el registro se elimina del cache. |
