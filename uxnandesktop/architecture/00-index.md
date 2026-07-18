# Uxnan Desktop (ADE) — Documentacion Tecnica

> **Version:** 1.1.0
> **Fecha:** 2026-06-17
> **Estado:** Alpha-funcional (standalone); Phase 6 (bridge embebido) pendiente
> **Plataformas objetivo:** Windows, macOS, Linux
> **Stack:** Rust, Tauri 2, Svelte 5, shadcn-svelte, Tailwind CSS, xterm.js, CodeMirror 6
> **Monorepo:** Este directorio (`uxnandesktop/architecture/`) contiene la documentacion tecnica del Agent Development Environment (ADE) de escritorio.

> **Regla de mantenimiento (ver `AGENTS.md` → *Spec drift control (non-negotiable)*):**
> esta carpeta es la **fuente de verdad** de la arquitectura del ADE.
> Cualquier item marcado `DONE` / `DONE & validated end-to-end` en
> `uxnandesktop/FOR-DEV.md` debe reflejarse aquí en el **mismo conjunto de
> cambios**, no solo en el `CHANGELOG.md`. Si un item contradice esta spec,
> abrir un `FOR-DRIFT` en el `FOR-DEV.md` correspondiente. La spec NO debe
> quedar atrás del código en un release.

---

## Que es el ADE

El **Agent Development Environment** es una aplicacion de escritorio de tres paneles disenada para orquestar multiples agentes AI de linea de comandos (Claude Code, Codex CLI, OpenCode, Aider, Gemini CLI, entre otros) ejecutandose en paralelo. Cada agente corre dentro de su propio pseudoterminal y su propio git worktree, logrando aislamiento total entre tareas simultaneas.

El ADE no es un IDE: no edita codigo directamente. Es un **orquestador terminal-centrico** que permite al desarrollador supervisar, interactuar y revisar el trabajo de multiples agentes AI en tiempo real.

### Diseno de tres paneles

```
+-------------------+---------------------------+-------------------+
|                   |                           |                   |
|    SIDEBAR        |     AREA CENTRAL          |    SIDEBAR        |
|    IZQUIERDA      |     (Terminales y         |    DERECHA        |
|                   |      Vistas)              |                   |
|  - Proyectos      |                           |  - Diffs          |
|  - Worktrees      |  - Terminales con         |  - Review         |
|  - Estado de      |    agentes (xterm.js)     |  - Control de     |
|    agentes        |  - Splits/Tabs            |    cambios        |
|  - Navegacion     |  - Editor (CodeMirror 6)  |  - Staging        |
|                   |                           |                   |
+-------------------+---------------------------+-------------------+
```

---

## Documentos

| # | Documento | Descripcion | Audiencia |
|---|---|---|---|
| 01 | [Vision del Producto](01-product-vision.md) | Que es el ADE, principios fundamentales (terminal-centrico, worktrees como aislamiento), diseno de tres paneles, posicionamiento dentro del ecosistema Uxnan, MVP y roadmap | Product owners, stakeholders, nuevos miembros del equipo |
| 02a | [Arquitectura del Sistema](02a-system-architecture.md) | Tres paneles, modelo de datos (Repo, Worktree, Tab, Pane, AgentState), mapa de conexiones Backend Rust <-> Frontend Svelte <-> PTY, flujos de sincronizacion, persistencia Serde | Desarrolladores, arquitectos |
| 02b | [Motor de Terminales y PTY](02b-terminal-engine.md) | xterm.js, portable-pty, splits/tabs, buffers async con Tokio, ciclo de vida de sesiones de terminal, lanzamiento de agentes CLI, Tauri commands/events para PTY I/O bidireccional | Desarrolladores backend Rust + frontend Svelte |
| 02c | [Git, Worktrees y Diffs](02c-git-worktrees.md) | Worktree lifecycle (creacion, uso, eliminacion segura), git2 + CLI fallback, polling de status cada 3s, sidebar derecha con diffs, CodeMirror 6 como visor, staging parcial por hunk, commits, limpieza segura de ramas | Desarrolladores |
| 02d | [Monitoreo y Orquestacion de Agentes](02d-agent-monitoring.md) | Hook HTTP local (axum), deteccion por titulo de terminal y proceso en ejecucion, estados (working/waiting/blocked/done), cache persistente con TTL, notificaciones nativas del OS, orquestacion multi-agente con grafo de tareas | Desarrolladores |
| 02e | [Integracion del Bridge y Conexion Movil](02e-bridge-integration.md) | Bridge embebido vs standalone, como el desktop integra el bridge Node.js, conexion E2EE con la app movil, relay server, contratos compartidos entre componentes | Arquitectos, desarrolladores |
| 03 | [Guia de Implementacion](03-implementation-guide.md) | Stack detallado (Rust, Tauri 2, Svelte 5, shadcn-svelte, Tailwind CSS, xterm.js, CodeMirror 6), crates Rust esenciales, patrones Svelte 5 con Runes ($state/$derived), Tauri 2 commands/events, persistencia con Serde, seguridad con Stronghold, CI/CD multiplataforma | Desarrolladores, contribuidores |
| 04 | [Referencia Tecnica](04-technical-reference.md) | MVP checklist organizado en Tiers (Tier 1: indispensable, Tier 2: mejoras UX, Tier 3: diferenciadores), fases de implementacion con estimaciones (11-17 semanas), convenciones de codigo, glosario de terminos, referencia rapida de crates Rust | Desarrolladores, gestores de proyecto |

---

## Stack tecnologico

### Stack principal

| Tecnologia | Proposito en el ADE |
|---|---|
| **Rust** | Backend completo: gestion de git worktrees, procesos PTY, servidor HTTP de hooks, monitoreo de agentes, operaciones git, persistencia, logica de orquestacion |
| **Tauri 2** | Framework de app de escritorio. Une backend Rust con frontend Svelte. Commands para request/response, events para streaming (PTY I/O). Mucho mas ligero que Electron (webview nativo del OS, sin bundlear Chromium) |
| **Svelte 5** | Framework frontend. Layout de tres paneles, sidebars, tabs, splits, estado reactivo con Runes (`$state`, `$derived`). Sin necesidad de librerias de estado externas |
| **shadcn-svelte** | Componentes UI: botones, sidebars, tabs, modales, command palette, dark mode. Basado en Bits UI (equivalente de Radix para Svelte) |
| **Tailwind CSS** | Estilos utilitarios rapidos y consistentes. Purge automatico de clases no usadas |

### Tecnologias complementarias

| Tecnologia | Capa | Proposito |
|---|---|---|
| **xterm.js** | Frontend | Emulador de terminal en el webview. Renderiza output de PTY con WebGLAddon (DOM fallback) |
| **CodeMirror 6** | Frontend | Editor de codigo y visor de diffs. Mas ligero que Monaco (~300KB vs ~5MB) |
| **portable-pty** (crate) | Backend Rust | Crear y gestionar pseudoterminales multiplataforma (Windows/macOS/Linux) |
| **git2** (crate) | Backend Rust | Operaciones git de alta frecuencia (status, diff, stage, log) sin crear subprocesos. Bindings de libgit2 |
| **Tokio** (crate) | Backend Rust | Runtime async. Manejo de PTY I/O, timers, HTTP server, todo no-bloqueante |
| **Serde** (crate) | Backend Rust | Serializacion/deserializacion type-safe de configuracion, estado y persistencia a JSON |
| **axum** (crate) | Backend Rust | HTTP server local async para recibir hooks de estado de agentes |
| **tauri-plugin-notification** | Plugin Tauri | Notificaciones nativas del OS |
| **tauri-plugin-stronghold** | Plugin Tauri | Almacenamiento encriptado de credenciales y secretos |

---

## Convenciones fundamentales

### Terminal-centrico: sin integracion de SDKs de agentes

El ADE **no integra SDKs, librerias ni APIs de ningun agente AI**. Cada agente se trata como un proceso CLI que corre dentro de un pseudoterminal. Esto garantiza:

- **Compatibilidad universal**: Cualquier agente CLI presente o futuro funciona sin modificar el ADE.
- **Desacoplamiento total**: El ADE no depende de versiones, protocolos ni APIs de ningun agente especifico.
- **Transparencia**: El usuario ve exactamente lo que el agente ve (entrada/salida del terminal).
- **Simplicidad**: No hay protocolos de comunicacion complejos que implementar ni mantener por cada agente.

El monitoreo de estado de agentes se logra mediante tres capas de deteccion (hook HTTP local, titulo de terminal, deteccion de proceso), todas ellas no-invasivas y compatibles con agentes que no saben que estan siendo monitoreados.

### Worktrees como unidad de aislamiento

El ADE usa **git worktrees** como mecanismo fundamental de aislamiento, no el cambio de rama tradicional (`git checkout`/`git switch`). Cada tarea, cada agente, cada feature vive en su propio worktree: un directorio independiente con su propio checkout de git.

Esto es lo que hace posible el paralelismo real. Sin worktrees, multiples agentes trabajando en el mismo repositorio se pisarian mutuamente. Con worktrees, N agentes pueden trabajar en N ramas simultaneamente sin interferencia.

### Idioma y nomenclatura

- **Documentacion**: Espanol como idioma principal. Terminos tecnicos y nombres de codigo en ingles.
- **Bloques de codigo**: Son especificaciones de referencia que representan la estructura y el contrato esperado, no codigo listo para copiar-pegar.
- **Svelte 5**: Se usan Runes (`$state`, `$derived`) como sistema de reactividad. Sin stores legacy ni librerias de estado externas.
- **Tauri 2**: Commands (`#[tauri::command]` en Rust, `invoke()` en JS) para request/response. Events (`emit()`/`listen()`) para streaming unidireccional.

---

## Estado de implementacion

> Esta seccion registra el avance de implementacion frente a la especificacion;
> se actualiza con cada incremento (ver `uxnandesktop/CHANGELOG.md`). El detalle
> de lo que falta y por que vive en `uxnandesktop/FOR-DEV.md`.

**uxnandesktop (Tauri 2 ADE) — rama `uxnandesktop`:**

| Fase | Tema | Estado | Notas |
|---|---|---|---|
| **0** | Base infrastructure (3-panel shell, IPC, persistencia) | ✅ Hecho | Tauri 2 + SvelteKit SPA + persistencia atomica Serde + 5 rotating backups + sequential schema migrations |
| **1** | Terminal core (PTY, tabs, splits) | ✅ Hecho | `portable-pty 0.9`, xterm.js + WebGL renderer (DOM fallback), recursive `AreaNode` region layout, copy/paste, file-drop, layout persistence, kill-on-exit |
| **2** | Git & worktrees | ✅ Hecho | Hierarchical Projects tree, create/list/safe-remove, in-app directory picker, per-worktree terminal workspaces, status badges, agents track (manual + auto-launch) |
| **3** | Git status & diffs | ✅ Hecho | Live status watcher (3s, focus-paused), push/pull, CodeMirror 6 diff viewer (unified + side-by-side), hunk-level staging |
| **4** | Agent monitoring | ✅ Hecho | Three layers: Layer 1 axum HTTP hook server (precise working/blocked/waiting/done, persistent cache TTL 7d) + Layer 2 terminal-title OSC inference + Layer 3 process-tree detection (`procscan` + `sysinfo`); colored status dots, unread/done badges, custom logos, per-worktree agent override |
| **5** | Polish & UX | ✅ Hecho | Hunk staging, full-size center diff + side-by-side, 5 rotating backups, opt-in keep-awake (Windows UNTESTED macOS/Linux), worktree palette (Ctrl/Cmd+P), TabGroup split buttons, virtualized lists |
| **S** | Settings, design system & i18n (cross-cutting) | ✅ Hecho | Settings (theme + terminal profiles w/ OS templates), design tokens, full i18n (EN/ES), agents registry + install detection + manual + auto-launch |
| **6** | Bridge integration (mobile pairing) | ⏳ Pendiente | Tauri sidecar para el bridge + QR pairing; **opcional para standalone**; el bridge standalone es la referencia del contrato |
| **Ops** | CI/CD & release pipeline | 🟡 Parcial | Verify + release-desktop (draft + firma del updater) + manifiesto rodante por canal listos; **auto-updater in-app HECHO** (`updater.rs` + Settings → Updates, canales stable/nightly según el flag pre-release de GitHub). Falta: artwork final + **OS code-signing pago** + la **clave de firma del updater** (FOR-HUMAN) antes de distribuir |
| **S/Follow-up** | Estados precisos por agente (Claude Code, Codex, Gemini CLI, OpenCode, Pi) + wrapper generico | ✅ Hecho | Reporters multi-shell bundleados en `static/hooks/` + escritos a `<app-data>/hooks/` al arranque, auto-instalados: relay Node exec-form (Claude) / `node` (Gemini), hook `curl` + `trusted_hash` en `config.toml` (Codex, `codex_trust.rs`), plugin in-process (OpenCode), extensión in-process (Pi). **Endpoint file** para sobrevivir reinicios; reporters de shell sin construir JSON (headers). **Settings → Agents → Hooks** ofrece Install/Uninstall por agente + master switch, y el wrapper generico (Bash / PowerShell / cmd / fish) para cualquier CLI |
| **S/Follow-up** | Multi-agent orchestration (difusion + motor de corridas) | ✅ Hecho | Consola de dos pestañas (barra de estado, ≥2 agentes o cualquier corrida): **Difusion** (routing por tipo / todos / workers + fan-out, backpressure) y **motor de corridas** — DAG de pasos con paso de contexto (`{{steps.s1.output}}`), dependencias paralelo/fan-in, pasos **headless** (completado verificado por exit code), **compuertas HITL**, **reintentos**, persistencia durable + re-enganche, y **tools MCP** de orquestacion (`02d` §3). Remediacion/eval, routing WSL headless y creacion de pasos por un agente coordinador quedan como follow-up (`FOR-DEV.md`) |
| **S/Follow-up** | In-app auto-updater (`tauri-plugin-updater`) | ✅ Hecho | Settings → Updates: canales stable/nightly (segun el flag pre-release de GitHub, no el tag), descarga BG + instalacion con guardia de inactividad de agentes (un reinicio detiene agentes), **toast sonner fijado** + acciones descargar/instalar dentro de Settings → Updates, version completa, i18n EN/ES. Endpoint por canal + firma/CI en `docs/updates.md`; la clave de firma es item de `FOR-HUMAN.md` |
| **S/Follow-up** | Consumo de proveedores AI | ✅ Hecho | Settings → Providers lee de forma nativa y opt-in las credenciales propias de Codex, Claude, Copilot, Gemini y Grok para mostrar ventanas de cuota, reinicios, plan/cuenta y crédito sin cookies ni claves pegadas por el usuario. |
| **S/Follow-up** | E2E tests (Playwright / WebdriverIO + tauri-driver) + component tests | ⏳ Pendiente | Ya en verde: `cargo test` 256 passing + `npm test` 207 (Vitest, logica pura) + `npm run check` 0/0 + `cargo clippy` + `cargo fmt`. Faltan E2E y tests de componentes Svelte |

> Detalle completo del avance en `uxnandesktop/CHANGELOG.md`; lo pendiente, en `uxnandesktop/FOR-DEV.md`.

**Como el ADE se relaciona con el resto del monorepo (ver §02e):**
- El ADE standalone NO requiere el bridge embebido (Phase 6) para funcionar.
- Cuando un usuario quiere conectividad movil, tiene dos opciones:
  - **Instalar `uxnan-bridge` standalone** y conectar el movil a el.
  - **Activar Phase 6** (bridge embebido) en el ADE — el movil se conecta al ADE directamente.
- En ambos casos, la conexion movil ↔ bridge es E2EE (mismo protocolo) y
  funciona LAN-direct / Tailscale-direct (cero hosting). El relay
  (`../../relay/`) es **opcional y self-hosted** (ver
  `../../architecture/02a-system-architecture.md` §2 y §5.10).

---

## Estructura del monorepo

El proyecto Uxnan esta organizado como un monorepo que agrupa todos los componentes del ecosistema:

```
uxnan/                           # Monorepo raiz
├── architecture/                # Especificacion tecnica de la app movil Flutter (fuente de verdad cross-component)
├── bridge/                      # Node.js daemon para PC (standalone o embebido en desktop)
├── relay/                       # Node.js relay server (opcional, self-hosted)
├── shared/                      # Contratos compartidos (tipos, JSON-RPC schemas)
├── uxnandesktop/                # App de escritorio ADE
│   └── architecture/            # <-- Este directorio. Documentacion tecnica del ADE
│       ├── 00-index.md              # Este archivo (indice de documentacion)
│       ├── 01-product-vision.md     # Vision del producto
│       ├── 02a-system-architecture.md
│       ├── 02b-terminal-engine.md
│       ├── 02c-git-worktrees.md
│       ├── 02d-agent-monitoring.md
│       ├── 02e-bridge-integration.md
│       ├── 03-implementation-guide.md
│       └── 04-technical-reference.md
└── uxnanmobile/                 # Proyecto Flutter (Android + iOS)
```

### Relacion con otros componentes del monorepo

| Componente | Relacion con el ADE desktop |
|---|---|
| `../../architecture/` | Contiene la especificacion tecnica completa de la app movil Flutter **y los contratos cross-component** (E2EE §5.9, bridge §5.8, relay §5.10). El ADE desktop se complementa con la app movil: el movil permite monitorear y controlar agentes remotamente desde el telefono. Consultar ese directorio para la especificacion movil y los contratos JSON-RPC. |
| `../../shared/` | Contratos compartidos entre todos los componentes del ecosistema. Definiciones de tipos TypeScript, schemas JSON-RPC y cualquier interfaz comun que necesiten consumir multiples proyectos del monorepo. El ADE desktop y el bridge comparten estos contratos para la comunicacion entre ellos. |
| `../../bridge/` | Daemon Node.js que actua como puente entre la app movil y los recursos de la computadora (Git, sistema de archivos, terminal). **Puede correr de dos formas**: como proceso standalone independiente, o integrado dentro de la app de escritorio ADE (Phase 6). Cuando el desktop esta corriendo, puede levantar el bridge internamente para que la app movil se conecte directamente al ADE sin necesidad de un proceso separado. |
| `../../relay/` | Servidor relay Node.js que facilita la comunicacion entre la app movil y el bridge/desktop cuando no hay conexion directa en red local. **Opcional y self-hosted** (ver `../../architecture/02a-system-architecture.md` §2 y §5.10). El ADE puede conectarse al relay para ser accesible desde fuera de la red local, pero no es la ruta primaria. |

---

## Nota sobre el bridge

El modulo bridge (`../../bridge/`) tiene una relacion especial con el ADE desktop:

- **Modo standalone**: El bridge corre como un proceso Node.js independiente en la computadora del desarrollador. La app movil se conecta a el directamente para monitorear agentes, ver diffs y ejecutar comandos.
- **Modo embebido (Phase 6 — pendiente)**: El ADE desktop puede integrar el bridge internamente, levantando el servidor Node.js como un proceso hijo gestionado por Rust. Esto elimina la necesidad de que el usuario instale y ejecute el bridge por separado. La spec detallada esta en `02e-bridge-integration.md`.

En ambos modos, los contratos de comunicacion son los mismos (definidos en `../../shared/`). La conexion entre el bridge y la app movil usa encriptacion end-to-end (E2EE) y puede pasar por el relay (`../../relay/`) cuando no hay conectividad directa.

El documento **02e - Integracion del Bridge y Conexion Movil** detalla la arquitectura de esta integracion.

---

## Origen

Esta documentacion fue derivada del whitepaper original `architect-desktop.md` (2026-06-05), archivado en git bajo el tag `pre-architecture-old-archive` y eliminado del arbol de trabajo (su contenido se conserva en el historial de git). El whitepaper original fue el analisis de arquitectura de alto nivel que definio:

- La vision del ADE como entorno terminal-centrico para agentes AI paralelos.
- El diseno de tres paneles (sidebar izquierda, area central de terminales, sidebar derecha de diffs).
- El modelo de datos jerarquico (Repo, Worktree, TabGroup, Pane).
- El stack tecnologico (Rust + Tauri 2 + Svelte 5 + shadcn-svelte + Tailwind CSS).
- Las funcionalidades minimas viables organizadas en Tiers.
- Las fases de implementacion con estimaciones.

El contenido del whitepaper original se ha reorganizado en documentos enfocados por tema para facilitar la navegacion, la mantenibilidad y el desarrollo incremental. No se ha perdido informacion del documento original; se ha reestructurado y expandido donde fue necesario.

El directorio `../../architecture/` sigue el mismo patron de reorganizacion para la especificacion de la app movil Flutter, derivada del whitepaper `architect-mobile.md`.

---

> **Nota:** Este indice y los documentos de `uxnandesktop/architecture/` son la fuente de verdad para la especificacion del ADE de escritorio. Para la especificacion de la app movil y los contratos cross-component, consultar `../../architecture/`. Los whitepapers originales se conservan en el historial de git (tag `pre-architecture-old-archive`). Los contratos compartidos entre componentes viven en `../../shared/`.
