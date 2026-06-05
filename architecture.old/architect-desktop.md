# Arquitectura de un Agent Development Environment (ADE) Ligero

> Documento de arquitectura de alto nivel para diseñar un ADE minimalista y competitivo.
> Basado en el análisis funcional de herramientas existentes en el ecosistema de desarrollo con agentes AI.
> Fecha: 2026-06-05

---

## Tabla de Contenidos

1. [Visión General](#1-visión-general)
2. [Gestión de Proyectos y Worktrees (Sidebar Izquierda)](#2-gestión-de-proyectos-y-worktrees-sidebar-izquierda)
3. [Área Central: Terminales y Vistas](#3-área-central-terminales-y-vistas)
4. [Sidebar Derecha: Diffs y Review](#4-sidebar-derecha-diffs-y-review)
5. [Manejo de Git, Worktrees y Ramas](#5-manejo-de-git-worktrees-y-ramas)
6. [Funcionalidades Core de Orquestación](#6-funcionalidades-core-de-orquestación)
7. [Mapa de Conexiones entre Módulos](#7-mapa-de-conexiones-entre-módulos)
8. [Stack Tecnológico](#8-stack-tecnológico)
9. [Funcionalidades Mínimas Viables (MVP)](#9-funcionalidades-mínimas-viables-mvp)
10. [Fases de Implementación](#10-fases-de-implementación)

---

## 1. Visión General

### Qué es un ADE

Un **Agent Development Environment** es un entorno de escritorio diseñado para que desarrolladores trabajen **en paralelo con múltiples agentes AI de línea de comandos** (Claude Code, Codex CLI, OpenCode, Aider, etc.). A diferencia de un IDE tradicional que se centra en editar código, un ADE se centra en:

- **Orquestar** múltiples agentes ejecutándose simultáneamente.
- **Aislar** cada tarea en su propio espacio de trabajo (worktree de git).
- **Monitorear** en tiempo real qué está haciendo cada agente.
- **Revisar** los cambios que los agentes producen antes de integrarlos.

### Principio Fundamental: Terminal-Céntrico

El ADE **no integra SDKs ni librerías de agentes**. En su lugar, trata a cada agente como un proceso CLI que corre dentro de un pseudoterminal. Esto tiene ventajas enormes:

- **Compatibilidad universal**: Cualquier agente CLI funciona sin modificar el ADE.
- **Desacoplamiento**: El ADE no depende de versiones, APIs o protocolos de ningún agente específico.
- **Transparencia**: El usuario ve exactamente lo que el agente ve (entrada/salida del terminal).
- **Simplicidad**: No hay que implementar protocolos de comunicación complejos con cada agente.

### Diseño de Tres Paneles

La interfaz se organiza en tres áreas principales:

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

---

## 2. Gestión de Proyectos y Worktrees (Sidebar Izquierda)

### 2.1 Qué Funcionalidad Proporciona

La barra lateral izquierda es el **centro de navegación y organización** del ADE. Su propósito es permitir al usuario gestionar múltiples repositorios y múltiples espacios de trabajo (worktrees) dentro de cada repositorio, con visibilidad inmediata del estado de cada agente.

#### Modelo de Datos Jerárquico

El ADE organiza el trabajo en tres niveles anidados:

```
Grupo de Proyectos (opcional, organizacional)
  +-- Repositorio (un directorio git o carpeta)
       +-- Worktree Principal (el checkout original)
       +-- Worktree A (checkout paralelo - rama feature-x)
       +-- Worktree B (checkout paralelo - rama fix-bug-y)
       +-- Worktree C (checkout paralelo - rama refactor-z)
```

**Repositorio**: Representa un repositorio git (o carpeta no-git). Cada repositorio almacena:
- Ruta en el sistema de archivos.
- Nombre visible para el usuario.
- Tipo (git o carpeta simple).
- Configuración de dónde se crean los worktrees asociados.
- Grupo al que pertenece (para organizar la barra lateral).

**Worktree (Espacio de Trabajo)**: Representa un checkout independiente de git. Es la unidad fundamental de aislamiento. Cada worktree almacena:
- Referencia a su repositorio padre.
- Nombre descriptivo asignado por el usuario.
- Rama de git actual.
- Si fue creado por el ADE o existía previamente.
- Timestamps de creación y última actividad.
- Agente que se lanzó al crearlo.
- Estado de lectura/no-leído (si el agente terminó mientras el usuario no estaba mirando).
- Referencia opcional a un issue o PR vinculado.
- Relación padre-hijo con otros worktrees (para agentes que generan sub-tareas).

**Grupo de Proyectos**: Agrupación visual y colapsable de repositorios. Sirve para organizar la sidebar cuando el usuario trabaja con muchos repositorios.

#### Tarjetas de Worktree

Cada worktree se muestra como una tarjeta compacta que presenta:
- **Nombre de la rama** (identidad visual principal).
- **Indicadores de estado del agente** (trabajando, esperando, bloqueado, completado).
- **Badges contextuales** (PR abierto, issue vinculado, cambios sin revisar).
- **Indicador de no-leído** (cuando el agente terminó y el usuario no ha revisado).
- **Acciones rápidas** (fijar/desfijar, menú contextual).

#### Modos de Agrupación en la Sidebar

El usuario puede agrupar los worktrees de varias formas:
- **Por estado**: Fijados, Recientes, Todos, Archivados.
- **Por linaje**: Worktrees hijos agrupados bajo su padre (para orquestación).
- **Por estado de trabajo** (tipo Kanban): Por hacer, En progreso, En revisión, Completado.

### 2.2 Por Qué es Importante para Workflows con Agentes Paralelos

- **Contexto inmediato**: Sin salir de la sidebar, el usuario sabe qué está haciendo cada agente en cada worktree. Esto es crítico cuando tienes 5-10 agentes corriendo en paralelo.
- **Aislamiento de tareas**: Cada tarea/feature/fix tiene su propio worktree con su propio agente. No hay contaminación entre tareas.
- **Navegación rápida**: Cambiar de contexto entre agentes es un click. No hay `cd`, no hay `git stash`, no hay cambio de rama.
- **Gestión de atención**: Los indicadores de "no-leído" y "completado" ayudan al usuario a priorizar su atención entre múltiples agentes.
- **Escala**: Sin esta organización, manejar más de 2-3 agentes simultáneos sería caos.

### 2.3 Módulos y Conexiones Lógicas Imprescindibles

```
[Módulo de Persistencia] <---> [Estado de Repositorios y Worktrees]
         |                               |
         v                               v
[Descubridor de Repos] <--> [Motor Git (worktree list)]
                                         |
                                         v
                              [Módulo de Sidebar UI]
                                    |         |
                                    v         v
                         [Estado de Agentes]  [Motor de Terminales]
```

- **Módulo de Persistencia**: Guarda y carga la lista de repos, worktrees y sus metadatos.
- **Motor Git**: Ejecuta `git worktree list` para descubrir worktrees existentes.
- **Estado de Agentes**: Alimenta los badges e indicadores de la sidebar.
- **Motor de Terminales**: Se activa al cambiar de worktree (muestra/oculta terminales).

### 2.4 Flujos Clave

#### Crear un Worktree
1. El usuario abre el diálogo "Crear Espacio de Trabajo".
2. Selecciona repositorio, rama base, y opcionalmente un agente para lanzar.
3. El ADE calcula una ruta en el directorio de workspaces.
4. Se ejecuta `git worktree add` con la rama correspondiente.
5. Se almacenan los metadatos (nombre, agente, timestamp).
6. La sidebar revela el nuevo worktree con scroll automático.
7. Opcionalmente se lanza el agente seleccionado en un terminal nuevo.

#### Cambiar de Worktree
1. El usuario hace click en una tarjeta de worktree.
2. Se activa el worktree en el estado reactivo de Svelte.
3. Los tabs/terminales del worktree anterior se ocultan (pero siguen corriendo).
4. Los tabs/terminales del nuevo worktree se muestran.
5. Se actualiza el estado visual de la sidebar.

#### Eliminar un Worktree
1. El usuario solicita eliminar desde el menú contextual.
2. Se ejecuta una verificación previa: ¿hay cambios sin commitear?
3. Si hay cambios sucios, se bloquea la eliminación y se notifica.
4. Si está limpio: se matan los terminales, se ejecuta `git worktree remove`, se limpia la rama asociada.
5. La sidebar se actualiza.

---

## 3. Área Central: Terminales y Vistas

### 3.1 Qué Funcionalidad Proporciona

El área central es donde ocurre la interacción directa con los agentes. Es un **multiplexor de terminales con capacidad de split y tabs**, similar a tmux pero integrado en la interfaz gráfica con conciencia de agentes.

#### Modelo Conceptual: Árbol de Layout

El área central se organiza como un **árbol binario recursivo** de paneles:

```
TabGroup Layout (por worktree)
  +-- Split Horizontal
       +-- Hoja (TabGroup 1: Terminal con Claude Code)
       +-- Split Vertical
            +-- Hoja (TabGroup 2: Terminal con bash)
            +-- Hoja (TabGroup 3: Terminal con Codex)
```

Cada **hoja** del árbol contiene un **grupo de tabs**, y cada tab puede ser:
- **Terminal**: Un emulador de terminal con xterm.js conectado a un proceso PTY.
- **Editor**: Un editor de código (CodeMirror 6) para edición rápida.
- **Visor de Diff**: Un comparador de cambios lado a lado.
- **Navegador Embebido**: Un webview para previsualizar aplicaciones web.

Cada **tab de terminal** puede a su vez tener **splits internos** (múltiples paneles PTY dentro de un mismo tab), similar a como funcionan los splits en Vim o tmux.

#### Dos Niveles de Splitting

Esto es importante y distingue al ADE de un terminal convencional:

1. **Splits de TabGroup** (nivel alto): Divide el área central en regiones independientes, cada una con su propia barra de tabs. Permite ver terminales de diferentes propósitos lado a lado.

2. **Splits de Pane dentro de un Tab** (nivel bajo): Dentro de un mismo tab de terminal, divide el área en múltiples paneles PTY. Cada pane es un proceso independiente.

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

#### Gestión de Terminales y PTY

Cada terminal funciona así:

- **Emulación**: Se usa una librería de emulación de terminal (tipo xterm.js) que renderiza en un canvas/WebGL la salida del proceso dentro del webview de Tauri.
- **PTY (Pseudoterminal)**: Cada pane tiene un proceso PTY gestionado por el backend Rust (vía crate `portable-pty` o similar). Este PTY ejecuta un shell (bash, zsh, PowerShell) o directamente un agente CLI.
- **Flujo bidireccional**: Lo que el usuario teclea en el webview va al backend Rust vía Tauri commands/events, que lo escribe al PTY (stdin). Lo que el PTY produce (stdout) fluye de vuelta al frontend vía Tauri events para renderizarse en xterm.js.
- **Buffers con límite**: Los terminales ocultos (en tabs no activos) acumulan output en un buffer limitado en el backend Rust (ej: 2MB). Si se desborda, se marca como "stale" y se recupera del backend al volver a ser visible.
- **Secuencias de escape especiales**: Los agentes pueden emitir secuencias OSC (Operating System Command) para reportar su estado al ADE. Esto permite al ADE saber si el agente está trabajando, esperando input, o terminó.

> **Nota sobre Zellij/tmux como alternativa**: En lugar de gestionar PTYs directamente desde Rust, existe la opción de delegar la multiplexación de terminales a un motor externo como **Zellij** (escrito en Rust) o **tmux**. El ADE lanzaría Zellij como subproceso y se comunicaría vía su API de socket/IPC para crear panes, enviar input, y leer output. **Ventaja**: Zellij ya resuelve splits, tabs, scrollback, y session persistence. **Desventaja**: Añade una dependencia externa, complica la instalación en Windows (Zellij no tiene soporte nativo de Windows aún), y limita el control fino sobre el renderizado en el webview. **Recomendación para MVP**: Gestionar PTYs directamente con `portable-pty` en Rust para máxima portabilidad (Windows/macOS/Linux). Evaluar Zellij como backend alternativo en una fase posterior si se necesita session persistence avanzada o detach/reattach.

### 3.2 Por Qué es Importante para Workflows con Agentes Paralelos

- **Paralelismo verdadero**: Cada pane es un proceso PTY independiente. 5 agentes en 5 panes corren literalmente en paralelo, sin interferencia.
- **Historiales independientes**: Cada pane tiene su propio scrollback. Puedes revisar lo que hizo un agente mientras otro sigue trabajando.
- **Cero overhead al cambiar**: Ocultar un tab/pane no mata el proceso. El agente sigue trabajando en background. Cuando vuelves, ves el output acumulado.
- **Contexto espacial**: Al tener splits, puedes ver a un agente codificando a la izquierda y ejecutar tests a la derecha. Esto es imposible con una sola terminal.
- **Flexibilidad de layout**: Cada worktree puede tener su propio layout de tabs y splits, adaptado a la tarea.

### 3.3 Módulos y Conexiones Lógicas Imprescindibles

```
[Motor de Layout] <---> [Árbol de Splits/TabGroups]
       |                          |
       v                          v
[Gestor de Tabs]           [Gestor de Panes]
       |                          |
       v                          v
[Fábrica de Contenido]     [Conexión PTY <-> xterm]
  (terminal/editor/diff)         |
                                 v
                         [Backend Rust: PTY Manager]
                         (portable-pty + tokio)
                                 |
                                 v
                         [Shell/Agente CLI]
```

- **Motor de Layout**: Almacena y renderiza el árbol binario de splits con ratios ajustables (Svelte reactivo).
- **Gestor de Tabs**: Maneja la barra de tabs por cada grupo (crear, cerrar, reordenar, MRU).
- **Conexión PTY**: Establece el flujo bidireccional entre xterm.js (webview) y el PTY (backend Rust) vía Tauri commands y events.
- **PTY Manager**: Vive en el backend Rust, crea y destruye pseudoterminales con `portable-pty`, gestiona buffers async con Tokio para tabs ocultos.

### 3.4 Ciclo de Vida de una Sesión de Terminal con Agente

1. **Creación**: El usuario crea un tab o el ADE lo crea automáticamente al abrir un worktree.
2. **Spawn del PTY**: El backend Rust crea un pseudoterminal con `portable-pty` usando el shell configurado, en el directorio del worktree.
3. **Conexión**: El frontend Svelte conecta xterm.js al PTY vía Tauri events. Input del teclado se envía al backend con `invoke()` (Tauri command); output del PTY se emite al frontend con `emit()` (Tauri event).
4. **Lanzamiento del agente**: El usuario escribe el comando del agente (ej: `claude`) o el ADE lo lanza automáticamente si el worktree fue creado con un agente predefinido.
5. **Ejecución**: El agente corre interactivamente. El usuario puede escribir prompts, el agente responde, edita archivos, ejecuta comandos.
6. **Monitoreo**: Secuencias OSC o heurísticas de título de terminal permiten al ADE detectar el estado del agente.
7. **Background**: Si el usuario cambia de tab/worktree, el PTY sigue corriendo en el backend Rust. El buffer async (Tokio) acumula output.
8. **Restauración**: Al volver al tab, el backend envía un snapshot del buffer acumulado al frontend para sincronizar xterm.js.
9. **Terminación**: El usuario cierra el tab o el worktree. El backend envía SIGTERM al proceso, espera un timeout configurable, luego SIGKILL si no responde.
10. **Limpieza**: Se liberan recursos del PTY en Rust (drop automático), se actualiza el estado del store reactivo de Svelte, se guarda el scrollback opcionalmente.

---

## 4. Sidebar Derecha: Diffs y Review

### 4.1 Qué Funcionalidad Proporciona

La barra lateral derecha es el **centro de revisión de cambios**. Su propósito es presentar al usuario todos los cambios que los agentes (o él mismo) han hecho en el worktree activo, y darle herramientas para revisar, aprobar, descartar o modificar esos cambios antes de commitearlos.

#### Árbol de Estado Git

El componente principal es un árbol de archivos modificados, organizado por área:

```
Cambios (unstaged)
  +-- archivo-a.ts  [modificado]
  +-- archivo-b.ts  [añadido]
  +-- archivo-c.ts  [eliminado]

Staged
  +-- archivo-d.ts  [modificado]

Sin rastrear (untracked)
  +-- archivo-nuevo.ts
```

Cada entrada del árbol muestra:
- **Ruta del archivo** con icono de tipo (añadido, modificado, eliminado, renombrado).
- **Conteo de líneas** añadidas/eliminadas.
- **Estado de conflicto** si aplica (conflicto de merge, rebase, cherry-pick).
- **Acciones rápidas**: stage, unstage, descartar cambios.

#### Visor de Diffs

Al seleccionar un archivo del árbol, se abre el visor de diffs que soporta dos modos:

1. **Inline (unificado)**: Muestra las líneas añadidas y eliminadas en un solo flujo vertical. Más compacto, mejor para cambios dispersos.

2. **Side-by-side (lado a lado)**: Muestra el archivo original a la izquierda y el modificado a la derecha. Mejor para comparar estructura.

Características del visor de diffs:

- **Scroll virtual**: Para changesets grandes (cientos de archivos), solo se renderizan los diffs visibles en pantalla. Los demás se cargan bajo demanda.
- **Carga progresiva**: Los diffs de archivos individuales se obtienen lazily conforme el usuario navega. Esto evita bloquear la UI cuando un agente modifica 50+ archivos.
- **Navegación por archivo**: Un árbol lateral permite saltar directamente a cualquier archivo del changeset.
- **Timeout de protección**: Si un diff individual tarda más de 30 segundos en calcularse, se aborta para no colgar la interfaz.
- **Diffs de imágenes**: Comparación visual antes/después para archivos de imagen.

#### Operaciones Sobre Cambios

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

#### Comentarios en Diffs

El usuario puede añadir **anotaciones a nivel de línea** en los diffs:
- Útil para dejar notas al agente (ej: "revisa esta lógica").
- Se persisten en el metadato del worktree.
- Pueden ser enviados al agente como contexto adicional.

#### Composición de Commits

Integrada en el panel de cambios:
- **Editor de mensaje de commit** con soporte markdown.
- **Generación AI del mensaje**: Un botón para que el agente genere automáticamente un mensaje de commit basado en los cambios staged.
- **Botón de acción primaria** contextual: Commit, Push, Sync, o Publish según el estado de la rama.

### 4.2 Por Qué es Importante para Workflows con Agentes Paralelos

- **Los agentes producen cambios masivos**: Un agente puede modificar 20-50 archivos en una sola sesión. Sin un visor de diffs eficiente, revisar esos cambios sería imposible.
- **Revisión antes de commit**: El ADE actúa como "code review" entre el agente y el commit. El usuario valida que los cambios son correctos antes de integrarlos.
- **Staging parcial**: Permite al usuario aceptar parte de los cambios de un agente y descartar otros. Esto es común cuando el agente se "pasa de listo".
- **Feedback al agente**: Los comentarios en diffs permiten al usuario señalar problemas específicos y relanzar al agente con contexto.
- **No bloquear la UI**: La carga lazy y el scroll virtual son esenciales cuando múltiples agentes están generando cambios simultáneamente.

### 4.3 Módulos y Conexiones Lógicas Imprescindibles

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

- **Polling de Git Status**: El backend Rust ejecuta `git2` (o `git status` vía CLI) cada pocos segundos con Tokio timers. Se pausa cuando la ventana no es visible. Los resultados se emiten al frontend vía Tauri events.
- **Store Reactivo de Svelte**: Almacena el estado por worktree (archivos modificados, staged, conflictos) usando `$state` y `$derived` de Svelte 5.
- **Visor de Diffs**: Usa CodeMirror 6 (más ligero que Monaco) con extensión de diff y carga lazy. Alternativa: Monaco si se necesita paridad con VS Code.
- **Operaciones Git**: Stage, unstage, y discard se ejecutan en el backend Rust vía `git2` crate o invocando git CLI como subproceso.

### 4.4 Fuentes de Diff Soportadas

El visor debe manejar al menos tres fuentes de diff:

1. **Uncommitted**: Working tree vs HEAD. Es el más común, muestra los cambios que el agente acaba de hacer.
2. **Branch**: Rama actual vs rama base. Muestra el changeset completo de una feature branch.
3. **Commit**: Un commit individual. Muestra qué cambió ese commit específico.

Cada fuente pasa por una **capa de deduplicación** que evita calcular el mismo diff múltiples veces si el usuario lo abre en diferentes contextos.

---

## 5. Manejo de Git, Worktrees y Ramas

### 5.1 Concepto General: Worktrees como Unidad de Aislamiento

El ADE usa **git worktrees** como su mecanismo fundamental de aislamiento, NO el cambio de rama tradicional (`git checkout`/`git switch`).

#### Por Qué Worktrees y No Ramas

| Aspecto | Ramas tradicionales | Worktrees |
|---------|---------------------|-----------|
| Aislamiento | Ninguno. Solo hay un directorio de trabajo. | Total. Cada worktree es un directorio independiente. |
| Paralelismo | Imposible. Solo una rama activa a la vez. | Total. N worktrees = N ramas activas simultáneamente. |
| Cambio de contexto | Costoso. `git stash` + `git checkout` + reinstalar deps. | Instantáneo. Solo cambiar qué directorio mira la UI. |
| Agentes paralelos | Imposible. Un agente bloquearía al otro. | Natural. Cada agente trabaja en su propio directorio. |
| Consumo de disco | Mínimo (un solo checkout). | Mayor (un checkout por worktree). Se mitiga con sparse checkout. |

Los worktrees son la pieza clave que hace posible el paradigma de desarrollo con múltiples agentes paralelos. Sin ellos, el concepto de ADE no funciona.

#### Ciclo de Vida de un Worktree

```
CREACIÓN                  USO ACTIVO               FINALIZACIÓN
---------                 ----------               ------------
git worktree add    --->  Agente trabaja     --->  Revisión de cambios
Configurar rama           Cambios en archivos      Commit + Push
Almacenar metadatos       Monitoring en sidebar    git worktree remove
Lanzar agente             Diffs en sidebar dcha    Limpiar rama (safe)
```

### 5.2 Flujos Core de Orquestación Git

#### Creación de Worktree

El flujo de creación es el más complejo y tiene varias garantías:

1. **Resolver la referencia base**: El usuario selecciona una rama base. El ADE la resuelve a una referencia completa, verificando que existe. Se prueba un orden de prioridad: referencia simbólica de HEAD remoto, luego `main`, luego `master`, con fallback a ramas locales.

2. **Crear el worktree**: Se ejecuta `git worktree add` con la opción de no rastrear upstream automáticamente. Esto evita que la rama nueva herede el estado de tracking de la base, previniendo reportes falsos de "detrás de upstream" antes del primer push.

3. **Configurar push automático**: Se establece `push.autoSetupRemote=true` en la configuración del repo (una sola vez) para que `git push` sin argumentos cree automáticamente la rama remota.

4. **Refrescar la referencia base local**: Si la base es una rama remota (ej: `origin/main`), se puede hacer fast-forward de la rama local correspondiente para que el worktree empiece desde lo más reciente. Esto solo se hace si la rama local no tiene cambios propios.

5. **Atomicidad**: Si cualquier paso falla, se limpia el worktree parcialmente creado y su rama.

#### Eliminación de Worktree

La eliminación tiene múltiples salvaguardas:

1. **Preflight de limpieza**: Se ejecuta `git status` en el worktree. Si hay cambios sin commitear, la eliminación se bloquea (a menos que sea forzada).

2. **Eliminación del worktree**: `git worktree remove` + `git worktree prune`.

3. **Limpieza de rama inteligente**:
   - Se intenta borrar la rama con `git branch -d` (safe delete, falla si hay commits sin mergear).
   - Si el delete falla pero los cambios fueron mergeados vía squash, se analiza si la rama es "patch-equivalente" a la base. Si lo es, se borra con seguridad.
   - Si no se puede confirmar que los cambios están mergeados, la rama se preserva y se notifica al usuario.

4. **Verificación post-eliminación**: Se re-lista los worktrees para confirmar que no quedó en un estado inconsistente.

#### Monitoreo de Estado Git

El estado git se mantiene actualizado con un ciclo de polling:

- **Intervalo**: Cada 3 segundos se consulta el estado git del worktree activo (vía `git2::Repository::statuses()` o `git status` como fallback).
- **Optimización**: Se pausa cuando la ventana no es visible. Se reanuda al volver.
- **Coalescencia**: Si el status tarda más que el intervalo, no se acumulan requests. Se ejecuta uno más al final.
- **Detección de conflictos**: Se detecta si hay un merge, rebase o cherry-pick en curso.
- **Estado upstream**: Se calcula cuántos commits está "ahead" y "behind" respecto a la rama remota.

#### Gestión de Ramas

**Nomenclatura**: Las ramas se crean con un prefijo configurable (ej: `usuario/feature-name`, `custom/feature-name`, o sin prefijo). Los nombres se sanitizan para eliminar caracteres no válidos.

**Detección de base por defecto**: Al crear una rama, el ADE prueba en orden un conjunto de bases conocidas (HEAD remoto, main, master, etc.) para determinar la base más adecuada.

### 5.3 Capa de Ejecución Git

Todas las operaciones git pasan por un **módulo centralizado en el backend Rust** que proporciona:

- **Doble motor: `git2` + CLI fallback**: La crate `git2` (bindings de libgit2) se usa para operaciones de alta frecuencia (status, diff, stage, log) donde la velocidad importa. Para operaciones de worktree (`git worktree add/remove/list`) y otras que libgit2 no soporta completamente, se invoca git CLI como subproceso vía `tokio::process::Command`.
- **Soporte multiplataforma nativo**: Rust compila nativamente para Windows, macOS y Linux. Para repos en WSL desde Windows, se detectan rutas UNC (`\\wsl.localhost\...`) y se enrutan los comandos a través de `wsl.exe`.
- **Async con Tokio**: Todas las operaciones git se ejecutan en un runtime async para no bloquear ni el backend ni el frontend. Las operaciones pesadas (fetch, clone) corren en threads dedicados del pool de Tokio.
- **Reintentos con backoff**: Para operaciones de red (fetch, push), reintentos con espera exponencial ante errores transitorios (502, 503, timeout).
- **Protección de idempotencia**: Las operaciones mutativas (POST, PUT, DELETE en APIs remotas) NO se reintentan para evitar duplicados.

> **Por qué `git2` y no solo CLI**: `git2` es significativamente más rápido para operaciones repetitivas como status polling (evita el overhead de crear un subproceso cada 3 segundos). Además, permite acceso directo al index y al object store de git para operaciones de staging parcial. Sin embargo, `git2` tiene limitaciones con worktrees y algunas operaciones avanzadas, por lo que el fallback a CLI es necesario.

### 5.4 Por Qué es Importante para Workflows con Agentes Paralelos

- **Aislamiento seguro**: Cada agente trabaja en su propio directorio sin riesgo de corromper el trabajo de otro agente.
- **Limpieza segura**: La lógica de eliminación protege contra pérdida accidental de trabajo no mergeado.
- **Actualización continua**: El polling de git status permite que la UI refleje en tiempo real los cambios que los agentes están haciendo.
- **Escalabilidad**: El sistema funciona igual con 1 worktree que con 20.

---

## 6. Funcionalidades Core de Orquestación

### 6.1 Monitoreo de Estado de Agentes en Tiempo Real

El ADE necesita saber en todo momento qué está haciendo cada agente. Esto se logra con un **sistema de hooks multicapa**:

#### Capa 1: Servidor de Hooks HTTP Local

El ADE levanta un servidor HTTP en localhost que los agentes pueden usar para reportar su estado:

- **Protocolo**: POST a un endpoint local con payload que incluye: estado actual (working, blocked, waiting, done), prompt del usuario, tipo de agente, herramienta en uso, y si fue interrumpido.
- **Caché persistente**: El último estado de cada agente se guarda en disco con un TTL de 7 días. Esto permite que al reiniciar el ADE, la sidebar muestre el estado correcto.
- **Broadcast**: Cada cambio de estado se difunde al frontend vía Tauri events para actualización inmediata de la UI.

Los estados posibles de un agente son:

| Estado | Significado | Indicador Visual |
|--------|-------------|-----------------|
| `working` | Procesando activamente | Punto verde animado |
| `blocked` | Esperando respuesta de otro sistema | Punto amarillo |
| `waiting` | Esperando input del usuario | Punto naranja parpadeante |
| `done` | Terminó su tarea | Punto azul/check |

#### Capa 2: Detección por Título de Terminal

Como fallback para agentes que no soportan hooks nativos, el ADE analiza el título del terminal y la salida del proceso para inferir el estado del agente. Esto permite monitorear agentes desconocidos sin que estos necesiten integración explícita.

#### Capa 3: Detección de Proceso en Ejecución

El ADE detecta qué proceso está corriendo en primer plano en cada PTY. Si el proceso coincide con un agente conocido (por nombre del ejecutable), se activa el tracking automático.

#### Staleness y Limpieza

- Si un agente no reporta estado en 30 minutos, su estado se marca como "stale".
- Los estados stale se muestran diferente en la UI (opacidad reducida).
- Al cabo de 7 días sin actividad, el registro se elimina del caché.

### 6.2 Lanzamiento y Control de Agentes CLI

#### Flujo de Lanzamiento

```
1. Usuario crea worktree (o tab nuevo)
2. El ADE consulta si hay un agente predefinido para el worktree
3. Si hay: se prepara el comando con argumentos y variables de entorno
4. Se crea el PTY en el directorio del worktree
5. Se inyecta el comando de startup al PTY
6. El agente arranca y comienza a reportar estado
```

#### Tipos de Contenido por Tab

Cada tab en el área central puede contener:
- **Terminal con agente**: Proceso interactivo con detección de estado.
- **Terminal shell puro**: Bash/zsh/PowerShell sin agente, para operaciones manuales.
- **Editor de archivos**: Para edición directa rápida.
- **Visor de diff**: Para revisión inline de cambios.
- **Navegador embebido**: Para previsualizar aplicaciones web.

#### Control del Agente

El usuario puede:
- **Interrumpir**: Ctrl+C envía SIGINT al proceso del agente.
- **Matar**: Cerrar el tab envía SIGTERM, espera, luego SIGKILL.
- **Relanzar**: Crear un nuevo tab en el mismo worktree y volver a ejecutar el comando.
- **Prompt directo**: Escribir en el terminal para enviar instrucciones al agente.

### 6.3 Sincronización y Persistencia entre Componentes

El ADE con Tauri 2 tiene tres "actores" principales que necesitan mantenerse sincronizados:

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
|                   |      - Selección activa
|                   |      - Interacción del usuario
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

> **Diferencia clave con Electron**: En Electron, la comunicación main<->renderer es vía `ipcMain`/`ipcRenderer` con serialización JSON. En Tauri 2, se usan **Tauri commands** (`#[tauri::command]` en Rust, `invoke()` en JS) para request/response, y **Tauri events** (`emit()`/`listen()`) para streaming unidireccional (ideal para output de terminal). Los events de Tauri son más eficientes porque evitan el overhead de serializar respuestas completas — perfecto para streaming de bytes de PTY.

#### Flujo de Sincronización

**Agente modifica archivos** ->
1. El agente escribe en el filesystem del worktree.
2. El backend Rust (timer Tokio cada 3 seg) ejecuta `git2::Repository::statuses()` para detectar cambios.
3. Emite un Tauri event `git:status-changed` con el estado actualizado.
4. El store reactivo de Svelte (`$state`) se actualiza automáticamente.
5. Si el usuario está viendo el diff, el componente de diff se re-renderiza reactivamente.

**Agente cambia de estado** ->
1. El agente emite un hook HTTP (o secuencia OSC detectada en el stream de PTY).
2. El backend Rust lo recibe, lo normaliza, lo cachea en memoria + disco.
3. Emite un Tauri event `agent:status-changed` con el nuevo estado.
4. La sidebar izquierda (Svelte) actualiza el badge del worktree reactivamente.
5. Si el agente terminó, el backend Rust dispara una notificación nativa del OS vía Tauri notification plugin.

**Usuario interactúa con terminal** ->
1. El evento de teclado llega al componente xterm.js en el webview.
2. Se envía al backend Rust vía `invoke('pty_write', { ptyId, data })` (Tauri command).
3. El backend Rust escribe al PTY correspondiente.
4. El PTY responde con output.
5. El backend emite un Tauri event `pty:output:{ptyId}` con los bytes.
6. xterm.js en el frontend recibe el event y renderiza.

#### Persistencia

El ADE persiste su estado usando **Serde** (serialización/deserialización en Rust) a un archivo JSON en el directorio de datos de la aplicación (obtenido vía `app.path().app_data_dir()` en Tauri 2), con las siguientes garantías:

| Dato | ¿Persiste? | Protección |
|------|-----------|-----------|
| Lista de repos y worktrees | Sí | Escritura atómica (write-rename) + 5 backups rotativos |
| Layout de tabs y splits | Sí | Guardado con debounce de 250ms (Tokio timer) |
| Estado de agentes (último) | Sí | TTL de 7 días, caché separado |
| Scrollback de terminal | Sí | Por pane, hasta 50MB por worktree |
| Configuración y preferencias | Sí | En el store principal |
| Credenciales y secretos | Sí | **Encriptados** vía Tauri plugin `tauri-plugin-stronghold` o keyring del OS |

> **Ventaja de Rust para persistencia**: La serialización con Serde es extremadamente rápida y type-safe. Los structs de Rust se serializan directamente a JSON sin riesgo de campos undefined o tipos incorrectos. Además, el patrón write-rename para escritura atómica es trivial en Rust con `std::fs::rename()`.

### 6.4 Prevención de Suspensión del Sistema

Cuando un agente está trabajando activamente, el ADE puede prevenir que el sistema entre en suspensión:

- **Windows**: Power save blocker.
- **macOS**: Aserción IOKit.
- **Linux**: Inhibidor de systemd.

Esto se activa solo cuando hay al menos un agente en estado `working` y el usuario tiene la preferencia habilitada. Se libera automáticamente si ningún agente reporta actividad en 2 horas.

### 6.5 Notificaciones

El sistema de notificaciones cubre:

- **Completación de agente**: Notificación nativa del OS cuando un agente llega al estado `done`.
- **Badge en dock/taskbar**: Contador de agentes con cambios no-leídos.
- **Indicador en sidebar**: Badge rojo en la tarjeta del worktree.
- **Limpieza automática**: Al enfocar la ventana, se limpian los badges.

### 6.6 Orquestación Multi-Agente

Para escenarios avanzados donde un agente coordinador gestiona múltiples agentes trabajadores:

- **Grafo de tareas**: Se mantiene un grafo en memoria de relaciones padre-hijo entre agentes.
- **Routing de mensajes**: Un coordinador puede enviar mensajes a agentes específicos por tipo (ej: `@claude`, `@codex`).
- **Backpressure**: El coordinador no envía el siguiente mensaje hasta que el agente worker esté idle.
- **Fan-out**: Un mensaje puede distribuirse a todos los agentes de un tipo simultáneamente.

### 6.7 Módulos y Conexiones Lógicas Imprescindibles

```
[Servidor de Hooks (axum)] <--- [Agentes CLI vía HTTP POST]
        |
        v
[Caché de Estado de Agentes] ---> [Tauri Events] ---> [Estado Svelte ($state)]
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
     +-- Encriptación de secretos
     +-- Migraciones de esquema
```

---

## 7. Mapa de Conexiones entre Módulos

Este diagrama muestra cómo **todos los módulos se conectan** para formar el ADE completo con el stack **Rust + Tauri 2 + Svelte 5**:

```
+================================================================+
|                    FRONTEND (Svelte 5 + Webview)                |
|                                                                 |
|  [Estado Reactivo Svelte 5]                                    |
|     |-- $state: Repos/Worktrees                                |
|     |-- $state: Terminales/Tabs/Layout                         |
|     |-- $state: Estado Git (por worktree)                      |
|     |-- $state: Estado de Agentes                              |
|     |-- $state: UI (sidebar, selección activa)                 |
|     +-- $derived: Datos computados (filtros, agrupaciones)     |
|                                                                 |
|  [Componentes UI (Svelte + shadcn-svelte + Tailwind)]          |
|     |-- Sidebar Izquierda (navega worktrees)                   |
|     |-- Área Central (xterm.js + splits + tabs)                |
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
|     |-- repo_add / repo_remove / repo_list                     |
|     |-- worktree_create / worktree_remove / worktree_list      |
|     |-- pty_create / pty_write / pty_resize / pty_close        |
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
|     |-- Buffer async (tokio::sync::mpsc)                       |
|     |-- Snapshot/restore de buffers                             |
|     |-- Detección de procesos foreground                       |
|     +-- Emite eventos: pty:output:{id}                         |
|                                                                 |
|  [Servidor de Hooks de Agentes (hyper/axum)]                   |
|     |-- HTTP server localhost (async, Tokio)                   |
|     |-- Caché de último estado (HashMap + Serde)               |
|     +-- Emite eventos: agent:status-changed                    |
|                                                                 |
|  [Persistencia (Serde JSON)]                                   |
|     |-- Lectura/escritura atómica (write-rename)               |
|     |-- Backups rotativos (5 copias)                           |
|     |-- Encriptación: tauri-plugin-stronghold / keyring        |
|     +-- Migraciones de esquema (versionado)                    |
|                                                                 |
|  [Notificaciones (tauri-plugin-notification)]                  |
|     |-- Notificaciones OS nativas                              |
|     +-- Badge en Dock/Taskbar                                  |
|                                                                 |
|  [Prevención de suspensión]                                    |
|     +-- Power save blocker nativo (API del OS)                 |
+================================================================+
                     |
                     v
+================================================================+
|              PROCESOS EXTERNOS (PTYs vía portable-pty)          |
|                                                                 |
|  [Shell 1] --> [Agente Claude Code] --> modifica archivos      |
|  [Shell 2] --> [Agente Codex CLI] --> modifica archivos        |
|  [Shell 3] --> [bash/zsh/PowerShell] --> comandos manuales     |
|  [Shell N] --> [Agente N] --> ...                              |
+================================================================+
```

### Flujos Críticos de Datos

1. **Agente modifica archivo** -> Backend Rust (git2 polling) -> Tauri event `git:status-changed` -> Store Svelte -> Sidebar derecha actualiza diffs.
2. **Agente reporta estado** -> Servidor hooks Rust (hyper/axum) -> Tauri event `agent:status-changed` -> Store Svelte -> Sidebar izquierda actualiza badge.
3. **Usuario escribe en terminal** -> xterm.js -> `invoke('pty_write')` -> Backend Rust -> PTY stdin -> Respuesta -> Tauri event `pty:output` -> xterm.js renderiza.
4. **Usuario cambia worktree** -> Store Svelte actualiza activo -> Tabs/terminales se muestran/ocultan -> Backend re-enfoca git polling al nuevo worktree.
5. **Usuario crea worktree** -> `invoke('worktree_create')` -> Backend Rust (git2/CLI) crea worktree -> Serde guarda metadatos -> Tauri event -> Store Svelte -> Sidebar revela nuevo.
6. **Agente termina** -> Hook `done` -> Backend Rust -> `tauri-plugin-notification` -> Badge en sidebar -> Usuario revisa diffs.

---

## 8. Stack Tecnológico

### Stack Principal

| Tecnología | Qué es | Para qué la usamos | Ventajas clave |
|------------|--------|---------------------|----------------|
| **Rust** | Lenguaje de programación de sistemas | Todo el núcleo pesado: gestión de git worktrees, procesos de terminales (PTY), servidor HTTP de hooks, monitoreo de agentes, filesystem, operaciones git, lógica de orquestación, persistencia. | Extrema ligereza y bajo uso de RAM/CPU. Seguridad de memoria (sin crashes por null/dangling pointers). Concurrencia segura con Tokio. Excelente para crecer (SSH, Docker, etc.) sin perder rendimiento. |
| **Tauri 2** | Framework para apps de escritorio | Une el frontend con el backend Rust y genera la app nativa para Windows, macOS y Linux. Provee el sistema de commands/events para comunicación backend-frontend. | Mucho más ligero que Electron (usa webview del sistema, no Chromium). Bajo consumo de RAM (30-100MB típico vs 200-500MB de Electron). Seguridad fuerte (permisos explícitos por capability). Fácil de empaquetar y distribuir. |
| **Svelte 5** | Framework frontend | Construir la interfaz: sidebars, layout de tres paneles, tabs, splits, estado en tiempo real, command palette, etc. | Muy ligero (menos runtime overhead que React/Vue). `$state` y `$derived` (Runes) eliminan la necesidad de librerías de estado externas como Zustand. Excelente rendimiento en actualizaciones en tiempo real. Código simple y mantenible. |
| **shadcn-svelte** | Colección de componentes UI para Svelte | Botones, sidebars, tabs, modales, tablas, tooltips, command palette, dark mode, etc. | Componentes modernos, accesibles y personalizables. Ligero (solo copias lo que usas). Basado en Bits UI (equivalente de Radix para Svelte). Look profesional sin esfuerzo. |
| **Tailwind CSS** | Framework de CSS utilitario | Estilos rápidos y consistentes de toda la aplicación. | Muy ligero (purge automático de clases no usadas). Alta velocidad de desarrollo. Fácil de mantener y escalar. |

### Tecnologías Complementarias

| Tecnología | Capa | Propósito |
|------------|------|-----------|
| **xterm.js** | Frontend | Emulador de terminal en el webview. Renderiza output de PTY en canvas/WebGL. |
| **CodeMirror 6** | Frontend | Editor de código y visor de diffs. Más ligero que Monaco (~300KB vs ~5MB). Extensible con plugins. |
| **portable-pty** (crate) | Backend Rust | Crear y gestionar pseudoterminales multiplataforma (Windows/macOS/Linux). |
| **git2** (crate) | Backend Rust | Operaciones git de alta frecuencia (status, diff, stage, log) sin crear subprocesos. Bindings de libgit2. |
| **Tokio** | Backend Rust | Runtime async para no bloquear el backend. Manejo de PTY I/O, timers, HTTP server, todo async. |
| **Serde** | Backend Rust | Serialización/deserialización type-safe de configuración, estado, y persistencia a JSON. |
| **hyper** o **axum** | Backend Rust | HTTP server local async para recibir hooks de agentes. Minimalista y rápido. |
| **tauri-plugin-notification** | Tauri Plugin | Notificaciones nativas del OS. |
| **tauri-plugin-stronghold** | Tauri Plugin | Almacenamiento encriptado de credenciales y secretos. Alternativa: keyring del OS. |
| **TanStack Virtual** (svelte) | Frontend | Scroll virtual para listas largas (worktrees, archivos en diff). |

### Comparación de Recursos: Este Stack vs Electron

| Métrica | Electron (referencia) | Tauri 2 + Rust |
|---------|----------------------|----------------|
| RAM en reposo | 200-500 MB | 30-100 MB |
| Tamaño del instalador | 150-300 MB | 5-15 MB |
| Tiempo de arranque | 2-5 segundos | <1 segundo |
| Bundled runtime | Chromium + Node.js completos | Webview del OS (ya instalado) |
| Seguridad | Todo permitido por defecto | Permisos explícitos por capability |
| Overhead de IPC | JSON serialization sobre IPC channel | Tauri commands con serialización Serde (más rápido) |

### Nota sobre Zellij/tmux como Motor de Terminal

Existe la opción de delegar la multiplexación de terminales a **Zellij** (escrito en Rust, moderno) o **tmux** (ubicuo en Linux/macOS):

| Aspecto | PTY directo (portable-pty) | Zellij/tmux como backend |
|---------|---------------------------|--------------------------|
| **Portabilidad** | Windows + macOS + Linux | Solo macOS + Linux (Zellij no soporta Windows nativo) |
| **Control** | Total (splits, buffers, lifecycle en tu código) | Limitado a la API del multiplexor |
| **Complejidad** | Mayor (debes implementar buffer management, scrollback) | Menor (el multiplexor ya lo resuelve) |
| **Session persistence** | Debes implementar | Gratis (detach/reattach) |
| **Dependencia externa** | Ninguna (todo embebido) | Requiere Zellij/tmux instalado |

**Recomendación**: Usar `portable-pty` directo para el MVP (máxima portabilidad). Evaluar Zellij como backend opcional en fases futuras para usuarios de macOS/Linux que quieran session persistence.

---

## 9. Funcionalidades Mínimas Viables (MVP)

Estas son las funcionalidades **estrictamente necesarias** para un ADE ligero que sea competitivo en usabilidad:

### Tier 1: Indispensable (Sin esto no es un ADE)

#### T1.1 - Gestión de Worktrees
- [ ] Agregar repositorios al ADE.
- [ ] Crear worktrees con selección de rama base.
- [ ] Listar worktrees por repositorio en la sidebar.
- [ ] Cambiar de worktree activo con un click (muestra/oculta terminales asociados).
- [ ] Eliminar worktrees con verificación de cambios sucios.
- [ ] Limpieza segura de rama al eliminar worktree.
- [ ] Persistencia de la lista de repos y worktrees en disco.

#### T1.2 - Terminales con PTY
- [ ] Crear tabs de terminal dentro de cada worktree.
- [ ] Emulación de terminal completa (xterm.js en frontend + portable-pty en backend Rust).
- [ ] Split horizontal y vertical de panes dentro de un tab.
- [ ] Cada pane = un proceso PTY independiente.
- [ ] Los terminales siguen corriendo cuando el tab/worktree no está visible.
- [ ] Buffer limitado para terminales ocultos con mecanismo de recuperación.
- [ ] Matar procesos al cerrar tab/pane.
- [ ] Persistencia del layout de tabs/splits por worktree.

#### T1.3 - Monitoreo de Estado de Agentes
- [ ] Servidor HTTP local para recibir hooks de estado de agentes.
- [ ] Parsing de estados: working, waiting, blocked, done.
- [ ] Indicador visual de estado en la tarjeta del worktree (sidebar).
- [ ] Indicador visual de estado en la barra de tabs del terminal.
- [ ] Notificación OS cuando un agente completa su tarea.
- [ ] Badge de "no-leído" en worktrees con agentes completados.
- [ ] Caché de último estado con persistencia (sobrevive reinicios).

#### T1.4 - Visor de Diffs y Control de Cambios
- [ ] Panel de estado git mostrando archivos modificados/staged/untracked.
- [ ] Polling automático de `git status` (cada ~3 segundos).
- [ ] Visor de diffs inline (unificado).
- [ ] Operaciones: stage, unstage, discard a nivel de archivo.
- [ ] Composición de commit con editor de mensaje.
- [ ] Refresh automático cuando el agente modifica archivos.

### Tier 2: Importante (Mejora significativa de UX)

#### T2.1 - Mejoras de Visor de Diffs
- [ ] Modo side-by-side (lado a lado) además de inline.
- [ ] Scroll virtual para changesets grandes.
- [ ] Carga lazy de diffs por archivo (bajo demanda).
- [ ] Stage/unstage a nivel de hunk (parcial).
- [ ] Navegación de archivo a archivo dentro del changeset.
- [ ] Generación AI de mensaje de commit.

#### T2.2 - Mejoras de Terminal
- [ ] Splits de TabGroup (dividir el área central en regiones con tabs independientes).
- [ ] Drag & drop de tabs entre TabGroups.
- [ ] Lanzamiento automático de agente al crear worktree.
- [ ] Auto-detección de agente por nombre de proceso en el PTY.
- [ ] Detección de estado vía título de terminal (fallback para agentes sin hooks).

#### T2.3 - Mejoras de Sidebar
- [ ] Agrupación por estado (Fijados, Recientes, Archivados).
- [ ] Indicador de actividad reciente (timestamp de última actividad PTY).
- [ ] Scroll virtualizado para muchos worktrees.
- [ ] Búsqueda/filtrado rápido de worktrees.
- [ ] Grupos de proyectos (carpetas organizacionales).

#### T2.4 - Robustez de Persistencia
- [ ] Escritura atómica con backups rotativos.
- [ ] Migraciones de esquema para actualizaciones de versión.
- [ ] Encriptación de datos sensibles (API keys, tokens) vía keychain del OS.

#### T2.5 - Prevención de Suspensión
- [ ] Bloquear suspensión del sistema cuando hay agentes activos.
- [ ] Auto-liberación después de período de inactividad.

### Tier 3: Nice to Have (Diferenciadores)

#### T3.1 - Orquestación Multi-Agente
- [ ] Grafo de relaciones padre-hijo entre worktrees/agentes.
- [ ] Routing de mensajes entre agentes coordinados.
- [ ] Visualización de linaje en la sidebar.

#### T3.2 - Revisión Avanzada
- [ ] Comentarios inline en diffs (anotaciones del usuario).
- [ ] Diffs de imágenes (antes/después visual).
- [ ] Vista de diff de branch completa (no solo uncommitted).
- [ ] Integración con PRs de GitHub/GitLab.

#### T3.3 - Navegador Embebido
- [ ] Webview integrado para previsualizar aplicaciones web.
- [ ] Tabs de navegador dentro del área central.

#### T3.4 - Terminal Flotante
- [ ] Panel de terminal desacoplable/flotante independiente de los worktrees.

---

## 10. Fases de Implementación

### Fase 0: Infraestructura Base (2-3 semanas)

**Objetivo**: Tener una aplicación de escritorio vacía con el skeleton de tres paneles y la comunicación backend-frontend funcionando.

**Backend Rust:**
- Inicializar proyecto Tauri 2 con `cargo tauri init`.
- Configurar Tokio como runtime async.
- Implementar structs base con Serde para el modelo de datos (Repo, Worktree, Settings).
- Implementar persistencia JSON básica (lectura/escritura atómica con write-rename y debounce vía Tokio timer).
- Registrar los primeros Tauri commands de prueba para validar comunicación.

**Frontend Svelte 5:**
- Configurar proyecto Svelte 5 con Vite + Tailwind CSS.
- Instalar y configurar shadcn-svelte (componentes base: Button, Dialog, Sidebar).
- Implementar el layout de tres paneles con resize handles (CSS grid + drag handlers).
- Implementar estado reactivo base con `$state` de Svelte 5 (repos, worktree activo, UI state).
- Conectar frontend con backend vía `invoke()` y validar round-trip de datos.

**Entregable**: Ventana de escritorio nativa con tres paneles vacíos redimensionables. Store reactivo Svelte funcional. Persistencia Serde básica. Comunicación Tauri commands/events validada.

### Fase 1: Terminal Core (2-3 semanas)

**Objetivo**: Poder ejecutar comandos en una terminal integrada con tabs y splits.

**Backend Rust:**
- Integrar crate `portable-pty` para gestión de pseudoterminales.
- Implementar PTY manager: crear, escribir, redimensionar, cerrar PTYs.
- Implementar streaming de output PTY a frontend vía Tauri events (`emit('pty:output:{id}', bytes)`).
- Implementar buffer async con `tokio::sync::mpsc` para PTYs de tabs ocultos.
- Registrar Tauri commands: `pty_create`, `pty_write`, `pty_resize`, `pty_close`.

**Frontend Svelte 5:**
- Integrar xterm.js en un componente Svelte.
- Conectar xterm.js al backend: input vía `invoke('pty_write')`, output vía `listen('pty:output')`.
- Implementar barra de tabs de terminal (crear, cerrar, reordenar).
- Implementar splits de panes dentro de un tab (árbol binario recursivo con drag-to-resize).
- Implementar persistencia de layout de tabs/splits en el estado (Serde vía backend).

**Entregable**: Terminal funcional con tabs y splits. Se puede ejecutar cualquier comando. Múltiples PTYs en paralelo.

### Fase 2: Git y Worktrees (2-3 semanas)

**Objetivo**: Crear, listar y gestionar worktrees de git.

**Backend Rust:**
- Integrar crate `git2` para operaciones git de alta frecuencia.
- Implementar módulo git: `git2::Repository::open()`, status, branch list.
- Implementar operaciones de worktree vía CLI (`tokio::process::Command`): add, remove, list.
- Implementar resolución de rama base por defecto (probing: origin/HEAD, main, master).
- Implementar preflight de eliminación (verificar cambios sucios con `git2::statuses()`).
- Implementar limpieza segura de rama al eliminar worktree.
- Registrar Tauri commands: `repo_add`, `worktree_create`, `worktree_remove`, `worktree_list`.

**Frontend Svelte 5:**
- Implementar sidebar izquierda con lista jerárquica de repos y worktrees (shadcn-svelte Sidebar + Tree).
- Implementar tarjetas de worktree con nombre de rama e indicadores.
- Implementar cambio de worktree activo (click -> muestra/oculta terminales asociados).
- Implementar diálogo de "Crear Espacio de Trabajo" (selección de repo, rama base, agente).
- Conectar creación de worktree con creación automática de terminal.

**Entregable**: Sidebar funcional con worktrees. Se puede crear un worktree, lanzar un agente, cambiar entre worktrees, y eliminar worktrees de forma segura.

### Fase 3: Estado Git y Diffs (2-3 semanas)

**Objetivo**: Ver y actuar sobre los cambios de archivos en tiempo real.

**Backend Rust:**
- Implementar polling de `git2::Repository::statuses()` cada 3 segundos con Tokio interval.
- Emitir Tauri events `git:status-changed` con la lista de archivos modificados/staged/untracked.
- Implementar operaciones: stage (`git2::Index::add_path`), unstage, discard.
- Implementar commit (`git2::Repository::commit`).
- Implementar diff vía `git2::Diff` para obtener hunks y líneas modificadas.
- Pausar polling cuando la ventana pierde visibilidad (Tauri window focus events).

**Frontend Svelte 5:**
- Implementar sidebar derecha con árbol de archivos organizado por área (Changes, Staged, Untracked).
- Integrar CodeMirror 6 con extensión de diff para visor inline.
- Implementar acciones por archivo: stage, unstage, discard (botones en cada fila del árbol).
- Implementar compositor de commit con textarea para mensaje.
- Conectar `listen('git:status-changed')` a actualización reactiva del árbol.

**Entregable**: Panel de cambios funcional. Se ven los diffs de lo que el agente modifica en tiempo real. Se pueden stagear archivos y commitear.

### Fase 4: Monitoreo de Agentes (1-2 semanas)

**Objetivo**: Saber qué está haciendo cada agente en cada worktree.

**Backend Rust:**
- Implementar HTTP server local con `axum` o `hyper` (async, Tokio) para recibir hooks POST de agentes.
- Implementar parsing y normalización de payloads de estado (working, waiting, blocked, done).
- Implementar caché persistente de último estado (HashMap + Serde a JSON, TTL de 7 días).
- Emitir Tauri events `agent:status-changed` ante cada cambio.
- Implementar notificaciones OS vía `tauri-plugin-notification` para agentes completados.

**Frontend Svelte 5:**
- Agregar indicadores visuales de estado en las tarjetas de worktree (sidebar izquierda): punto de color con animación según estado.
- Agregar indicadores de estado en la barra de tabs del terminal.
- Implementar badge de "no-leído" para worktrees con agentes completados.
- Implementar limpieza de badges al enfocar el worktree.

**Entregable**: Monitoreo en tiempo real de agentes. Badges en sidebar. Notificaciones nativas del OS al completar.

### Fase 5: Pulido y UX (2-3 semanas)

**Objetivo**: Hacer la experiencia fluida y robusta.

**Backend Rust:**
- Implementar diff por hunk para stage parcial (usando `git2::Diff::foreach` + index manipulation).
- Implementar backups rotativos de persistencia (5 copias).
- Implementar migraciones de esquema para futuros cambios de formato.
- Implementar prevención de suspensión del sistema (APIs nativas del OS) cuando hay agentes activos.
- Implementar encriptación de secretos vía `tauri-plugin-stronghold`.

**Frontend Svelte 5:**
- Implementar modo side-by-side para diffs (CodeMirror 6 con dos editores sincronizados).
- Implementar scroll virtual con TanStack Virtual en diffs y sidebar.
- Implementar stage/unstage por hunk en la UI del diff viewer.
- Agregar búsqueda/filtrado rápido de worktrees en la sidebar.
- Implementar splits de TabGroup (nivel alto: dividir área central en regiones independientes).
- Testing E2E de flujos principales con Playwright o WebdriverIO.

**Entregable**: ADE MVP completo, pulido y listo para uso diario.

### Estimación Total: 11-17 semanas

Esto asume un desarrollador full-stack (Rust + Svelte) trabajando full-time. Con **dos desarrolladores** (uno enfocado en backend Rust, otro en frontend Svelte), se puede comprimir a **6-10 semanas** porque las interfaces entre backend y frontend están bien definidas (Tauri commands/events actúan como contrato).

> **Nota sobre la curva de aprendizaje de Rust**: Si el equipo es nuevo en Rust, agregar 2-3 semanas adicionales de ramp-up. Los conceptos de ownership, borrowing, y async con Tokio requieren práctica. La crate `git2` en particular tiene una API verbose que toma tiempo dominar. Considerar empezar con operaciones git vía CLI (`tokio::process::Command`) y migrar a `git2` incrementalmente donde el rendimiento lo justifique.

---

## Resumen Ejecutivo

Un ADE ligero competitivo necesita **cuatro pilares** fundamentales:

1. **Worktrees como unidad de trabajo**: Cada tarea vive en su propio directorio aislado. Sin esto, no hay paralelismo real.

2. **Terminal multiplexada con PTYs**: Cada agente corre en su propio pseudoterminal. El usuario puede ver, interactuar y cambiar entre agentes sin interrumpir su ejecución.

3. **Monitoreo reactivo de estado**: El ADE sabe en todo momento qué está haciendo cada agente y mantiene al usuario informado mediante indicadores visuales y notificaciones.

4. **Revisión de cambios integrada**: Un visor de diffs en tiempo real que permite al usuario revisar, aprobar parcialmente, y commitear los cambios de los agentes sin salir del ADE.

### Por qué este stack (Rust + Tauri 2 + Svelte 5)

El stack **Rust + Tauri 2 + Svelte 5 + shadcn-svelte + Tailwind** está elegido específicamente para maximizar ligereza y rendimiento:

- **Rust en el backend** garantiza bajo consumo de RAM/CPU, seguridad de memoria, y concurrencia segura. Un PTY manager en Rust con Tokio consume una fracción de lo que consumiría uno equivalente en Node.js.
- **Tauri 2** elimina el overhead de bundlear Chromium + Node.js (que es lo que hace Electron pesado). Usa el webview nativo del OS, resultando en instaladores de 5-15MB en lugar de 150-300MB.
- **Svelte 5** con Runes (`$state`, `$derived`) elimina la necesidad de librerías de estado externas (Zustand, Redux) y tiene el menor runtime overhead de los frameworks frontend modernos.
- **CodeMirror 6** en lugar de Monaco reduce ~4.7MB de bundle para el visor de diffs.

El diferenciador clave respecto a herramientas existentes es el **enfoque terminal-céntrico**: el ADE no necesita saber nada sobre los agentes. Solo necesita saber cómo ejecutar terminales, detectar estados, y mostrar diffs. Esto lo hace ligero, extensible, y compatible con cualquier agente presente o futuro.

### Crates de Rust Esenciales (Referencia Rápida)

| Crate | Versión sugerida | Propósito |
|-------|-----------------|-----------|
| `tauri` | 2.x | Framework de app de escritorio |
| `tokio` | 1.x | Runtime async (timers, channels, spawn) |
| `serde` + `serde_json` | 1.x | Serialización/deserialización |
| `git2` | 0.19+ | Operaciones git nativas (libgit2) |
| `portable-pty` | 0.8+ | Pseudoterminales multiplataforma |
| `axum` o `hyper` | 0.7+ / 1.x | HTTP server para hooks de agentes |
| `notify` | 7.x | File system watcher (alternativa a polling) |
| `keyring` | 3.x | Acceso al keychain del OS para secretos |
