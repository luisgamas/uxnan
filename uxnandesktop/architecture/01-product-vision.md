# Uxnan Desktop — Visión del Producto

> **Versión:** 1.0.0  
> **Fecha:** 2026-06-05  
> **Estado:** Definición inicial — borrador técnico completo  
> **Plataformas objetivo:** Windows, macOS, Linux  
> **Stack:** Rust + Tauri 2 + Svelte 5 + shadcn-svelte + Tailwind CSS

> Este documento forma parte de la documentación técnica de Uxnan Desktop. Ver también: [00 — Índice](00-index.md) | [02a — Arquitectura del Sistema](02a-system-architecture.md) | [02b — Motor de Terminales y PTY](02b-terminal-engine.md) | [02c — Git, Worktrees y Diffs](02c-git-worktrees.md) | [02d — Monitoreo y Orquestación de Agentes](02d-agent-monitoring.md) | [02e — Integración del Bridge](02e-bridge-integration.md) | [03 — Guía de Implementación](03-implementation-guide.md) | [04 — Referencia Técnica](04-technical-reference.md)

---

## Tabla de contenidos

1. [Vision General](#1-visión-general)
2. [Diseño de Tres Paneles](#2-diseño-de-tres-paneles)
3. [Posicionamiento en el Ecosistema Uxnan](#3-posicionamiento-en-el-ecosistema-uxnan)
4. [Stack Tecnológico — Justificación](#4-stack-tecnológico--justificación)
5. [Agentes Soportados](#5-agentes-soportados)
6. [Diferenciadores Clave](#6-diferenciadores-clave)

---

## 1. Visión General

### Qué es un ADE (Agent Development Environment)

Un **Agent Development Environment** es un entorno de escritorio diseñado para que desarrolladores trabajen **en paralelo con múltiples agentes AI de línea de comandos** (Claude Code, Codex CLI, OpenCode, Aider, Gemini CLI, pi-agent, y cualquier agente futuro). A diferencia de un IDE tradicional que se centra en editar código manualmente, un ADE se centra en:

- **Orquestar** múltiples agentes ejecutándose simultáneamente.
- **Aislar** cada tarea en su propio espacio de trabajo (worktree de git).
- **Monitorear** en tiempo real qué está haciendo cada agente.
- **Revisar** los cambios que los agentes producen antes de integrarlos.

### Lo que un ADE NO es

Un ADE **no es un IDE**. No compite con VS Code, IntelliJ ni Neovim. No pretende ser el mejor editor de código ni ofrecer autocompletado inteligente. Su propósito es distinto: es la capa de orquestación, monitoreo y revisión que permite a un desarrollador supervisar N agentes de codificación trabajando en paralelo, cada uno en su propio espacio aislado. El usuario, en lo principal, no escribe código en el ADE — los agentes lo hacen; el usuario revisa, aprueba, descarta y coordina. (Nota de implementación: el panel central incluye un **tab editor de revisión** ligero — `FileEditor.svelte` + `fs.rs`, CodeMirror 6 con Ctrl/Cmd+S — para retoques rápidos durante la revisión; es una conveniencia, no un IDE ni el flujo central.)

### Los Cuatro Pilares

Un ADE ligero y competitivo se sustenta en cuatro pilares fundamentales:

1. **Worktrees como unidad de trabajo:** Cada tarea vive en su propio directorio aislado mediante git worktrees. Sin esto, no hay paralelismo real — un solo directorio de trabajo significa que solo un agente puede operar a la vez sin contaminar el trabajo de otro.

2. **Terminal multiplexada con PTYs:** Cada agente corre en su propio pseudoterminal. El usuario puede ver, interactuar y cambiar entre agentes sin interrumpir su ejecución. Los terminales ocultos siguen ejecutándose en background.

3. **Monitoreo reactivo de estado de agentes:** El ADE sabe en todo momento qué está haciendo cada agente (trabajando, esperando input, bloqueado, completado) y mantiene al usuario informado mediante indicadores visuales y notificaciones nativas del sistema operativo.

4. **Revisión de cambios integrada:** Un visor de diffs en tiempo real que permite al usuario revisar, aprobar parcialmente, y commitear los cambios de los agentes sin salir del ADE. El ADE actúa como "code review" entre el agente y el commit.

### Principio Fundamental: Terminal-Céntrico

El ADE **no integra SDKs ni librerías de agentes**. En su lugar, trata a cada agente como un **proceso CLI que corre dentro de un pseudoterminal** (PTY). Este principio es la decisión arquitectónica más importante del proyecto y tiene ventajas enormes:

- **Compatibilidad universal:** Cualquier agente CLI funciona sin modificar el ADE. Si un agente puede ejecutarse en una terminal, puede ejecutarse en el ADE. No hay que escribir adaptadores, plugins ni bindings específicos para cada agente.

- **Desacoplamiento:** El ADE no depende de versiones, APIs ni protocolos de ningún agente específico. Si un agente cambia su API interna, el ADE no se ve afectado porque nunca la usó.

- **Transparencia:** El usuario ve exactamente lo que el agente ve (la entrada y salida del terminal). No hay abstracción intermedia que oculte información o la transforme.

- **Simplicidad:** No hay que implementar protocolos de comunicación complejos con cada agente. El contrato es simplísimo: stdin, stdout y un proceso PTY.

> **Referencia:** Los detalles de implementación del principio terminal-céntrico, incluyendo el flujo bidireccional xterm.js <-> PTY <-> Backend Rust, se describen en [02b — Terminales y PTY](02b-terminal-engine.md).

---

## 2. Diseño de Tres Paneles

La interfaz de Uxnan Desktop se organiza en tres áreas principales que cubren todo el flujo de trabajo con agentes: navegar, ejecutar y revisar.

```
+-------------------+---------------------------+-------------------+
|                   |                           |                   |
|    SIDEBAR        |     ÁREA CENTRAL          |    SIDEBAR        |
|    IZQUIERDA      |     (Terminales y         |    DERECHA        |
|                   |      Vistas)              |                   |
|  - Proyectos      |                           |  - Diffs          |
|  - Worktrees      |  - Terminales con         |  - Review         |
|  - Estado de      |    agentes                |  - Control de     |
|    agentes        |  - Splits/Tabs            |    cambios        |
|  - Navegación     |  - Editor (opcional)      |  - Staging        |
|                   |                           |                   |
+-------------------+---------------------------+-------------------+
```

### Sidebar Izquierda: Navegación y Estado

La barra lateral izquierda es el **centro de navegación y organización** del ADE. Permite al usuario gestionar múltiples repositorios y múltiples espacios de trabajo (worktrees) dentro de cada repositorio, con visibilidad inmediata del estado de cada agente.

El modelo de datos es jerárquico:

```
Grupo de Proyectos (opcional, organizacional)
  +-- Repositorio (un directorio git o carpeta)
       +-- Worktree Principal (el checkout original)
       +-- Worktree A (checkout paralelo - rama feature-x)
       +-- Worktree B (checkout paralelo - rama fix-bug-y)
       +-- Worktree C (checkout paralelo - rama refactor-z)
```

Cada worktree se muestra como una **tarjeta compacta** con:
- Nombre de la rama (identidad visual principal).
- Indicadores de estado del agente (trabajando, esperando, bloqueado, completado).
- Badges contextuales (PR abierto, issue vinculado, cambios sin revisar).
- Indicador de no-leído (cuando el agente terminó y el usuario no ha revisado).
- Acciones rápidas (fijar/desfijar, menú contextual).

El usuario puede agrupar worktrees por estado (fijados, recientes, archivados), por linaje (worktrees hijos bajo su padre), o por estado de trabajo tipo Kanban (por hacer, en progreso, en revisión, completado).

### Área Central: Terminales Multiplexadas

El área central es donde ocurre la interacción directa con los agentes. Es un **multiplexor de terminales con capacidad de split y tabs**, similar a tmux pero integrado en la interfaz gráfica con conciencia de agentes.

El área se organiza como un **árbol binario recursivo** de paneles, donde cada hoja contiene un grupo de tabs. Cada tab puede ser un terminal con xterm.js + PTY, un editor de código (CodeMirror 6), un visor de diff, o un navegador embebido.

Los terminales soportan **dos niveles de splitting**:

1. **Splits de TabGroup** (nivel alto): Divide el área central en regiones independientes, cada una con su propia barra de tabs.
2. **Splits de Pane dentro de un Tab** (nivel bajo): Dentro de un mismo tab, divide el área en múltiples paneles PTY.

```
Ejemplo de layout complejo:
+------------------------------------------+
| Tab: Claude Code  | Tab: Tests           |
|-------------------+----------------------|
| +-------+-------+ |                      |
| | Pane  | Pane  | | Pane único           |
| | (pty1)| (pty2)| | (pty3: npm test)     |
| |       |       | |                      |
| +-------+-------+ |                      |
+-------------------+----------------------+
  TabGroup 1 (split V interno)  TabGroup 2
         \________________________/
              Split Horizontal
```

Cada pane es un proceso PTY independiente. Los terminales ocultos (en tabs no activos) siguen corriendo en background. Cuando el usuario vuelve a un tab, ve el output acumulado.

> **Referencia:** La arquitectura completa del motor de terminales, incluyendo el ciclo de vida de PTYs, buffers async con Tokio, y la alternativa Zellij/tmux, se describe en [02b — Terminales y PTY](02b-terminal-engine.md).

### Sidebar Derecha: Diffs y Review

La barra lateral derecha es el **centro de revisión de cambios**. Presenta al usuario todos los cambios que los agentes (o él mismo) han hecho en el worktree activo, con herramientas para revisar, aprobar, descartar o modificar esos cambios antes de commitearlos.

Los componentes principales son:

- **Árbol de estado git:** Archivos organizados por área (Changes, Staged, Untracked) con iconos de tipo, conteo de líneas y acciones rápidas.
- **Visor de diffs:** Soporta modo inline (unificado) y side-by-side (lado a lado) con scroll virtual, carga lazy progresiva y navegación por archivo.
- **Operaciones sobre cambios:** Stage/unstage/discard a nivel de archivo completo, a nivel bulk (todos), y a nivel de hunk (parcial).
- **Comentarios en diffs:** Anotaciones a nivel de línea para dejar notas al agente.
- **Compositor de commits:** Editor de mensaje con generación AI opcional del mensaje de commit.

> **Referencia:** La implementación del visor de diffs, operaciones de staging parcial y polling de git status se detallan en [02c — Git y Worktrees](02c-git-worktrees.md).

---

## 3. Posicionamiento en el Ecosistema Uxnan

Uxnan es un ecosistema de herramientas para desarrolladores que trabajan con agentes de codificación AI. Cada componente tiene un rol específico y están diseñados para complementarse.

### Uxnan Desktop — El ADE para Power Users

**Uxnan Desktop** es la aplicación de escritorio ADE para desarrolladores que quieren **orquestación completa** de múltiples agentes AI en su propia PC. Es la herramienta principal para quienes trabajan sentados frente a su computadora y necesitan:

- Lanzar y supervisar N agentes en paralelo, cada uno en su worktree aislado.
- Revisar diffs y hacer staging parcial antes de commitear.
- Ver el estado de todos los agentes de un vistazo.
- Layout de terminales flexible con splits y tabs.

Uxnan Desktop corre nativamente en **Windows, macOS y Linux** con un instalador de 5-15 MB gracias a Tauri 2.

### Uxnan Mobile — El Control Remoto

**Uxnan Mobile** (Flutter, Android + iOS) es el **control remoto** para agentes cuando el desarrollador se aleja del escritorio. No es un ADE completo — es un cliente inteligente que permite:

- Ver el estado en tiempo real de sesiones de agentes activos en la PC.
- Continuar conversaciones y enviar nuevas instrucciones.
- Revisar diffs, hacer commits y pushes desde el móvil.
- Recibir notificaciones push cuando un agente completa su tarea.

La app móvil no ejecuta agentes localmente. Se conecta al bridge (ver siguiente sección) para controlar los agentes que ya corren en la PC.

### El Bridge — Conectando Móvil con PC

El **Uxnan Bridge** es un daemon Node.js que corre en la PC del desarrollador y actúa como puente entre la app móvil y los recursos de la computadora (Git, filesystem, terminales, agentes). El bridge:

- Implementa **Agent Adapters** que normalizan las diferencias de protocolo entre agentes (Codex CLI, OpenCode, Claude Code, Gemini CLI, pi-agent) y exponen una interfaz JSON-RPC unificada.
- Gestiona sesiones de agentes, operaciones Git, y acceso al workspace.
- Acepta conexiones WebSocket con E2EE (cifrado de extremo a extremo).

**El bridge puede funcionar de dos maneras:**

1. **Standalone** (`../../bridge/`): Como daemon independiente que corre en la PC. Es la opción para usuarios que no quieren la app de escritorio — solo necesitan conectividad móvil hacia sus agentes.

2. **Embebido en Uxnan Desktop**: La app de escritorio puede **opcionalmente integrar la funcionalidad del bridge** dentro de su propio proceso. En este modo, los usuarios móviles se conectan directamente a la app de escritorio en lugar de necesitar un daemon bridge separado. Esto simplifica la configuración: un solo proceso en la PC sirve tanto como ADE local como punto de conexión para el móvil.

La decisión de usar bridge standalone o embebido depende del usuario:
- **Solo móvil, sin desktop:** Instala el bridge standalone. La app móvil se conecta al bridge.
- **Solo desktop, sin móvil:** Usa Uxnan Desktop sin activar el bridge embebido.
- **Desktop + móvil:** Activa el bridge embebido en Uxnan Desktop. El móvil se conecta al desktop directamente.

### El Relay — Conectividad WAN con E2EE

El **Uxnan Relay** es un servidor Node.js que facilita la comunicación entre la app móvil y el bridge/desktop cuando no están en la misma red local (LAN). El relay:

- Retransmite **envelopes cifrados opacos** — nunca ve el contenido en texto claro.
- Soporta las tres topologías de conexión:
  - **LAN directa:** Móvil -> Bridge/Desktop (sin relay).
  - **WAN via relay:** Móvil -> Relay -> Bridge/Desktop.
  - **Self-hosted:** El usuario puede desplegar su propio relay en un VPS o servidor doméstico.

### Diagrama de Interacción del Ecosistema

```
┌─────────────────────────────────────────────────────────────────┐
│                    PC del desarrollador                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Uxnan Desktop (ADE)                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │    │
│  │  │ Sidebar  │  │Terminales│  │  Diffs   │              │    │
│  │  │Worktrees │  │  + PTYs  │  │ + Review │              │    │
│  │  └──────────┘  └──────────┘  └──────────┘              │    │
│  │                                                         │    │
│  │  ┌──────────────────────────────────────┐  (opcional)   │    │
│  │  │      Bridge Embebido                  │              │    │
│  │  │  Agent Adapters + JSON-RPC + E2EE     │◄─── WS ─────┼──┐ │
│  │  └──────────────────────────────────────┘              │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
│                                                                │ │
│  ┌─────────────────────────────────┐  (alternativa standalone) │ │
│  │   Bridge Daemon (../../bridge/) │◄────────── WS ───────────┼─┘
│  │   Agent Adapters + JSON-RPC     │                          │
│  └─────────────────────────────────┘                          │
│                                                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ Claude Code  │ │  Codex CLI   │ │   OpenCode   │  ...     │
│  │  (agente)    │ │  (agente)    │ │  (agente)    │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
└────────────────────────────────┬───────────────────────────────┘
                                 │
                          E2EE WebSocket
                                 │
                    ┌────────────▼────────────┐
                    │    Uxnan Relay (WAN)     │
                    │  Retransmite envelopes   │
                    │  cifrados opacos         │
                    └────────────┬────────────┘
                                 │
                          E2EE WebSocket
                                 │
                    ┌────────────▼────────────┐
                    │    Uxnan Mobile          │
                    │  (Flutter, Android/iOS)  │
                    │  Control remoto          │
                    └─────────────────────────┘
```

> **Referencia:** Los detalles del protocolo de comunicación bridge, los Agent Adapters, y el handshake E2EE se documentan en la especificación del bridge (`../../bridge/`) y en la [documentación de arquitectura móvil](../../architecture/02a-system-architecture.md).

---

## 4. Stack Tecnológico — Justificación

### Stack Principal

| Tecnología | Qué es | Para qué la usamos | Ventajas clave |
|---|---|---|---|
| **Rust** | Lenguaje de programación de sistemas | Todo el backend pesado: gestión de git worktrees, procesos de terminales (PTY), servidor HTTP de hooks, monitoreo de agentes, filesystem, operaciones git, lógica de orquestación, persistencia. | Extrema ligereza y bajo uso de RAM/CPU. Seguridad de memoria (sin crashes por null/dangling pointers). Concurrencia segura con Tokio (runtime async). Excelente para crecer (SSH, Docker, etc.) sin perder rendimiento. FFI nativo para integrar con APIs del sistema operativo. |
| **Tauri 2** | Framework para apps de escritorio | Une el frontend con el backend Rust y genera la app nativa multiplataforma. Provee el sistema de commands/events para comunicación backend-frontend. | Usa el webview nativo del sistema operativo (no bundlea Chromium). Instaladores de 5-15 MB vs 150-300 MB de Electron. Bajo consumo de RAM (30-100 MB típico). Seguridad fuerte con permisos explícitos por capability. Fácil de empaquetar y distribuir. |
| **Svelte 5** | Framework frontend | Construir toda la interfaz: sidebars, layout de tres paneles, tabs, splits, estado en tiempo real, command palette, etc. | `$state` y `$derived` (Runes) eliminan la necesidad de librerías de estado externas como Zustand o Redux. Menor runtime overhead que React o Vue. Excelente rendimiento en actualizaciones en tiempo real. Código simple y mantenible. |
| **shadcn-svelte** | Colección de componentes UI | Botones, sidebars, tabs, modales, tablas, tooltips, command palette, dark mode, y más. | Componentes modernos, accesibles y personalizables. Ligero porque solo copias lo que usas (no hay dependencia de un paquete monolítico). Basado en Bits UI (equivalente de Radix para Svelte). Look profesional sin esfuerzo. |
| **Tailwind CSS** | Framework de CSS utilitario | Estilos rápidos y consistentes de toda la aplicación. | Muy ligero gracias al purge automático de clases no usadas en producción. Alta velocidad de desarrollo. Fácil de mantener y escalar. Integración nativa con shadcn-svelte. |

### Tecnologías Complementarias

| Tecnología | Capa | Propósito |
|---|---|---|
| **xterm.js** | Frontend | Emulador de terminal en el webview. Renderiza output de PTY en canvas/WebGL. Soporte completo de secuencias ANSI y colores. |
| **CodeMirror 6** | Frontend | Editor de código y visor de diffs. Significativamente más ligero que Monaco (~300 KB vs ~5 MB). Extensible con plugins. |
| **portable-pty** (crate) | Backend Rust | Crear y gestionar pseudoterminales multiplataforma (Windows, macOS, Linux). |
| **git2** (crate) | Backend Rust | Operaciones git de alta frecuencia (status, diff, stage, log) sin crear subprocesos. Bindings nativos de libgit2. |
| **Tokio** | Backend Rust | Runtime async para no bloquear ni el backend ni el frontend. Manejo de PTY I/O, timers, HTTP server, filesystem watching — todo async. |
| **Serde** | Backend Rust | Serialización/deserialización type-safe de configuración, estado, y persistencia a JSON. |
| **axum** o **hyper** | Backend Rust | HTTP server local async para recibir hooks de estado de agentes. Minimalista y rápido. |
| **tauri-plugin-notification** | Tauri Plugin | Notificaciones nativas del sistema operativo. |
| **tauri-plugin-stronghold** | Tauri Plugin | Almacenamiento encriptado de credenciales y secretos. Alternativa: keyring del OS. |
| **TanStack Virtual** (svelte) | Frontend | Scroll virtual para listas largas (worktrees, archivos en diff, changesets grandes). |

### Justificación del Backend en Rust

La elección de Rust para el backend no es accidental. Un ADE necesita gestionar simultáneamente:

- **N procesos PTY** con streaming de bytes en tiempo real.
- **Polling de git status** cada 3 segundos sin bloquear la UI.
- **Un HTTP server** para recibir hooks de agentes.
- **Persistencia a disco** con escritura atómica y backups rotativos.
- **Detección de procesos** en cada terminal.

En Node.js (Electron), cada una de estas tareas consume un event loop compartido. En Rust con Tokio, cada tarea corre como un future async independiente con overhead mínimo. Un PTY manager en Rust con Tokio consume una fracción de lo que consumiría uno equivalente en Node.js.

Además, la seguridad de memoria de Rust (ownership, borrowing) garantiza que no hay data races entre los múltiples PTYs y los timers de polling — algo que en JavaScript requiere disciplina manual y es fuente frecuente de bugs sutiles.

### Justificación de Tauri 2 sobre Electron

Tauri 2 elimina el overhead de bundlear Chromium + Node.js (que es lo que hace Electron pesado). Usa el webview nativo del sistema operativo.

| Métrica | Electron (referencia) | Tauri 2 + Rust |
|---|---|---|
| **RAM en reposo** | 200-500 MB | 30-100 MB |
| **Tamaño del instalador** | 150-300 MB | 5-15 MB |
| **Tiempo de arranque** | 2-5 segundos | < 1 segundo |
| **Bundled runtime** | Chromium + Node.js completos | Webview del OS (ya instalado) |
| **Seguridad** | Todo permitido por defecto | Permisos explícitos por capability |
| **Overhead de IPC** | JSON serialization sobre IPC channel | Tauri commands con serialización Serde (más rápido) |
| **Procesos de sistema** | 3+ procesos (main, renderer, GPU) | 1 proceso nativo + webview del OS |

La diferencia de 200-500 MB a 30-100 MB de RAM es especialmente relevante para un ADE que gestiona N agentes en paralelo — cada agente ya consume memoria propia. Si el ADE base consume 400 MB antes de que los agentes empiecen a trabajar, el sistema se satura más rápido.

### Justificación de Svelte 5 con Runes

Svelte 5 introduce **Runes** (`$state`, `$derived`, `$effect`) que son un sistema de reactividad granular a nivel de compilación. Esto elimina la necesidad de librerías de gestión de estado externas:

- `$state` reemplaza stores, Zustand, Redux, o Pinia.
- `$derived` reemplaza selectors o computed properties.
- `$effect` reemplaza watchers o useEffect.

Para un ADE que actualiza el estado de N agentes, N worktrees, y N terminales en tiempo real, la reactividad granular de Svelte 5 es ideal: solo se re-renderizan los componentes afectados por cada cambio de estado, sin reconciliación de virtual DOM.

### Justificación de CodeMirror 6 sobre Monaco

CodeMirror 6 (~300 KB de bundle) se elige sobre Monaco (~5 MB) para el visor de diffs porque:

- Un ADE no necesita la paridad completa con VS Code que Monaco ofrece.
- El ahorro de ~4.7 MB de bundle acelera significativamente el tiempo de arranque.
- CodeMirror 6 es extensible con plugins para diff, syntax highlighting, y fold.
- Para un visor de diffs (no un editor completo), CodeMirror 6 tiene todo lo necesario.

### Crates de Rust Esenciales (Referencia Rápida)

| Crate | Versión sugerida | Propósito |
|---|---|---|
| `tauri` | 2.x | Framework de app de escritorio |
| `tokio` | 1.x | Runtime async (timers, channels, spawn) |
| `serde` + `serde_json` | 1.x | Serialización/deserialización |
| `git2` | 0.19+ | Operaciones git nativas (libgit2) |
| `portable-pty` | 0.8+ | Pseudoterminales multiplataforma |
| `axum` o `hyper` | 0.7+ / 1.x | HTTP server para hooks de agentes |
| `notify` | 7.x | File system watcher (alternativa a polling) |
| `keyring` | 3.x | Acceso al keychain del OS para secretos |

> **Referencia:** Los detalles de cómo se usan estos crates en la práctica (commands de Tauri, eventos, serialización con Serde, motor git dual `git2` + CLI) se describen en [02a — Arquitectura del Sistema](02a-system-architecture.md).

---

## 5. Agentes Soportados

### Compatibilidad Universal por Diseño

Gracias al principio terminal-céntrico, Uxnan Desktop es compatible con **cualquier agente de codificación que funcione como CLI**. No se necesita integración específica ni adaptador para cada agente — si el agente corre en una terminal, corre en el ADE.

### Agentes Conocidos

| Agente | Tipo | Notas |
|---|---|---|
| **Claude Code** (Anthropic) | CLI interactivo | Soporta subagentes, MCP, skills, hooks. Arquitectura multi-dispositivo con sistema Bridge propio. |
| **Codex CLI** (OpenAI) | CLI interactivo | JSON-RPC 2.0 sobre WebSocket. Arquitectura local-first. |
| **OpenCode** (opencode.ai) | CLI interactivo | Soporta múltiples LLM providers. Arquitectura cliente/servidor diseñada para conexión remota. |
| **Aider** | CLI interactivo | Agente open-source popular. Soporta múltiples modelos. Usa git internamente para tracking de cambios. |
| **Gemini CLI** (Google) | CLI interactivo | Bucle ReAct con herramientas built-in y servidores MCP. Output JSON y stream-json para integración. |
| **pi-agent** | CLI interactivo | Agente minimalista con cuatro herramientas core. Modo RPC con framing JSONL. |
| **Cualquier agente futuro** | CLI | Por diseño, cualquier agente CLI nuevo funciona sin modificar el ADE. |

### Detección de Estado de Agentes

Aunque el ADE no requiere integración específica, sí puede detectar el estado de los agentes mediante un **sistema de hooks multicapa**:

**Capa 1 — Servidor de Hooks HTTP Local:**
El ADE levanta un servidor HTTP en localhost. Los agentes que lo soporten pueden reportar su estado vía POST a un endpoint local con payload que incluye: estado actual, prompt del usuario, tipo de agente, herramienta en uso. Los agentes como Claude Code y Codex CLI que soportan hooks de estado pueden configurarse para reportar a este endpoint.

**Capa 2 — Detección por Título de Terminal:**
Como fallback para agentes que no soportan hooks nativos, el ADE analiza el título del terminal (secuencias OSC) y la salida del proceso para inferir el estado del agente.

**Capa 3 — Detección de Proceso en Ejecución:**
El ADE detecta qué proceso está corriendo en primer plano en cada PTY. Si el proceso coincide con un agente conocido (por nombre del ejecutable), se activa el tracking automático.

Los estados posibles de un agente son:

| Estado | Significado | Indicador Visual |
|---|---|---|
| `working` | Procesando activamente | Punto verde animado |
| `blocked` | Esperando respuesta de otro sistema | Punto amarillo |
| `waiting` | Esperando input del usuario | Punto naranja parpadeante |
| `done` | Terminó su tarea | Punto azul / check |

Si un agente no reporta estado en 30 minutos, se marca como "stale" (opacidad reducida en la UI). Los estados stale se eliminan del cache tras 7 días sin actividad.

> **Referencia:** La implementación detallada del sistema de hooks, caché persistente, broadcast de eventos, y orquestación multi-agente se describe en [02d — Orquestación y Monitoreo](02d-agent-monitoring.md).

---

## 6. Diferenciadores Clave

### Paralelismo Real via Git Worktrees

A diferencia de herramientas que trabajan con cambio de ramas (`git checkout`/`git switch`), Uxnan Desktop usa **git worktrees** como mecanismo fundamental de aislamiento. Cada worktree es un checkout completo e independiente del repositorio.

| Aspecto | Ramas tradicionales | Worktrees (Uxnan Desktop) |
|---|---|---|
| **Aislamiento** | Ninguno. Solo hay un directorio de trabajo. | Total. Cada worktree es un directorio independiente. |
| **Paralelismo** | Imposible. Solo una rama activa a la vez. | Total. N worktrees = N ramas activas simultáneamente. |
| **Cambio de contexto** | Costoso. `git stash` + `git checkout` + reinstalar deps. | Instantáneo. Solo cambiar qué directorio mira la UI. |
| **Agentes paralelos** | Imposible. Un agente bloquearía al otro. | Natural. Cada agente trabaja en su propio directorio. |
| **Consumo de disco** | Mínimo (un solo checkout). | Mayor (un checkout por worktree). Se mitiga con sparse checkout. |

### Cero Costo de Cambio de Contexto

Cambiar de un agente a otro es un click en la sidebar. No hay `cd`, no hay `git stash`, no hay cambio de rama, no hay reinstalación de dependencias. Los terminales del worktree anterior se ocultan (pero siguen corriendo) y los del nuevo worktree se muestran. Es instantáneo.

### Monitoreo Simultáneo de N Agentes

Sin salir de la sidebar izquierda, el usuario sabe qué está haciendo cada agente en cada worktree. Indicadores de color, badges de "no-leído", y notificaciones nativas del OS mantienen al desarrollador informado sin necesidad de estar mirando cada terminal constantemente. Esto es crítico cuando se tienen 5-10 agentes corriendo en paralelo.

### Revisión de Cambios Antes de Commit

El ADE actúa como **code review entre el agente y el commit**. Los agentes producen cambios masivos — un agente puede modificar 20-50 archivos en una sola sesión. Sin un visor de diffs eficiente, revisar esos cambios sería imposible. La sidebar derecha presenta los cambios en tiempo real conforme el agente los produce, permitiendo al usuario validar antes de integrar.

### Staging Parcial

El usuario puede aceptar **parte** de los cambios de un agente y descartar otros. Esto es común cuando el agente se "pasa de listo" — por ejemplo, cuando refactoriza código que no se le pidió o introduce cambios estilísticos no deseados. El staging parcial opera a tres niveles: archivo completo, bulk (todos), y hunk (bloques de cambios individuales dentro de un archivo).

### Conectividad Móvil Opcional

Uxnan Desktop puede opcionalmente **embeber la funcionalidad del bridge**, permitiendo que la app móvil Uxnan se conecte directamente al desktop. El desarrollador puede alejarse de su escritorio y seguir monitoreando y controlando sus agentes desde el móvil, sin necesidad de un daemon bridge separado.

Para usuarios que no quieren la app de escritorio pero sí quieren conectividad móvil, el bridge standalone en `../../bridge/` proporciona la misma funcionalidad como daemon independiente.

### Cross-Platform

Uxnan Desktop corre en **Windows, macOS y Linux** con el mismo codebase. Gracias a Tauri 2 + Rust:

- El backend Rust compila nativamente para las tres plataformas.
- Los PTYs funcionan en las tres plataformas via `portable-pty`.
- Las operaciones git funcionan en las tres plataformas via `git2` + CLI.
- El webview nativo del OS renderiza la UI (WKWebView en macOS, WebView2 en Windows, WebKitGTK en Linux).
- Soporte especial para repos en WSL desde Windows (detección de rutas UNC `\\wsl.localhost\...` y enrutamiento de comandos a través de `wsl.exe`).

### Resumen de Diferenciadores

| Diferenciador | Descripción |
|---|---|
| Paralelismo real | Git worktrees, no cambio de ramas |
| Cero context-switch | Click en sidebar, sin stash/checkout |
| Monitoreo en tiempo real | N agentes simultáneos con indicadores visuales |
| Code review integrado | Diffs en tiempo real entre agente y commit |
| Staging parcial | Aceptar/descartar cambios granularmente |
| Terminal-céntrico | Cualquier agente CLI funciona sin integración |
| Conectividad móvil | Bridge embebido opcional para Uxnan Mobile |
| Cross-platform | Windows, macOS, Linux con instalador de 5-15 MB |
| Ligero | 30-100 MB RAM vs 200-500 MB de alternativas Electron |

> **Referencia:** Para la arquitectura detallada de cada pilar, consultar: [02a — Arquitectura del Sistema](02a-system-architecture.md) (estructura de módulos, comunicación backend-frontend, persistencia), [02b — Motor de Terminales y PTY](02b-terminal-engine.md) (motor de terminales, xterm.js, PTY lifecycle), [02c — Git, Worktrees y Diffs](02c-git-worktrees.md) (worktree lifecycle, capa de ejecución git, polling, staging), [02d — Monitoreo y Orquestación de Agentes](02d-agent-monitoring.md) (hooks, notificaciones, multi-agente), [04 — Referencia Técnica](04-technical-reference.md) (fases, MVP, estimaciones).
