# Motor de Terminal y PTY — Uxnan Desktop ADE

> Documento de diseño del motor de terminal, gestión de pseudoterminales, sistema de layout (splits y tabs), ciclo de vida de sesiones, y control de agentes CLI.
> Extraído y expandido de la arquitectura general del ADE (secciones 3 y 6).
> Fecha: 2026-06-05

---

## Tabla de Contenidos

1. [Emulación de Terminal](#1-emulación-de-terminal)
2. [Gestión de PTY (Backend Rust)](#2-gestión-de-pty-backend-rust)
3. [Árbol de Layout — Splits y Tabs](#3-árbol-de-layout--splits-y-tabs)
4. [Ciclo de Vida de una Sesión de Terminal](#4-ciclo-de-vida-de-una-sesión-de-terminal)
5. [Lanzamiento y Control de Agentes](#5-lanzamiento-y-control-de-agentes)
6. [Nota sobre Zellij/tmux como Alternativa](#6-nota-sobre-zellijtmux-como-alternativa)
7. [Módulos y Conexiones](#7-módulos-y-conexiones)

---

## 1. Emulación de Terminal

El área central del ADE es donde ocurre la interacción directa con los agentes. Para renderizar terminales completas dentro de una aplicación de escritorio construida con Tauri, se utiliza **xterm.js** ejecutándose en el webview.

### Renderizado con xterm.js

xterm.js renderiza la salida del proceso PTY con **WebGLAddon** dentro del webview de Tauri, la ruta acelerada recomendada por xterm y usada por VS Code. Se usa para las terminales que activan ligaduras, que se dibujan a través del *character joiner* del propio renderer WebGL (no del renderer DOM), de modo que los glifos siempre quedan alineados a la cuadrícula monoespaciada y la selección de texto con el mouse cae exactamente donde corresponde.

**Orden de carga (importante):** el addon de ligaduras se carga **antes** de activar WebGL. xterm hornea su *atlas de texturas de glifos* al activarse WebGL; si el *character joiner* de ligaduras se registra después, sus glifos ligados nunca llegan al atlas ya horneado y se dibujan **duplicados/fantasma** sobre su forma plana en TUIs con muchas ligaduras (p. ej. Codex CLI) — xterm #3303. Cargando ligaduras primero, el atlas se construye con las ligaduras resueltas desde el primer frame.

**Contexto GPU acotado a los panes visibles:** cada renderer WebGL mantiene su propio contexto GPU y WebView2/Chromium **limita los contextos WebGL vivos (~16)**. Como cada terminal permanece montada en todos los workspaces, uxnan adjunta WebGL **solo mientras el pane está visible**: se adjunta al revelarse y, al ocultarse (o cerrarse) el contexto se **libera explícitamente** (`WEBGL_lose_context.loseContext()` + `canvas.width/height = 0`, porque en Windows/ANGLE un `dispose()` a secas no recupera el contexto de inmediato). Así el número de contextos vivos queda acotado a los pocos panes visibles sin importar cuántas terminales/worktrees haya abiertos; una terminal oculta sigue recibiendo su output en el buffer vía el fallback DOM (no se pierde nada) y repinta al revelarse. Ante una pérdida de contexto GPU en WebView2 el addon se recupera vía `onContextLoss` reinstalando en el siguiente frame, salvo una **re-pérdida rápida** (señal de estar por encima del presupuesto de contextos): en ese caso se queda en DOM en vez de entrar en un bucle. Solo los *reveals* de un pane oculto limpian el atlas de glifos (nunca un resize/refocus ordinario). El *reveal* además **re-sincroniza el viewport** (`syncViewport`: re-mide el tamaño de celda ya visible y llama `viewport.queueSync()` de xterm 6): mientras el pane estuvo oculto (caja `0×0`) el output que llegó creció el buffer pero el viewport quedó con un área de scroll obsoleta, dejando la barra de scroll corta del final real hasta la siguiente tecla; el viewport de xterm 6 no tiene `ResizeObserver`, así que un pane revelado no se re-sincroniza solo — uxnan lo fuerza para alcanzar el inicio/fin verdadero de inmediato **sin mover la posición del usuario**. DOM queda como fallback automático cuando WebGL no está disponible. Esto proporciona emulación de terminal completa:

- **Colores**: Soporte completo de colores ANSI (16 colores, 256 colores, true color 24-bit).
- **Cursor**: Movimiento, estilos (bloque, barra, underline), parpadeo configurable.
- **Scrollback**: Buffer de historial desplazable con scroll virtual para no degradar rendimiento en sesiones largas.
- **Selección y copiar/pegar**: Selección de texto con mouse, integración con el portapapeles del sistema operativo.
- **Secuencias de escape**: Soporte completo de secuencias VT100/VT220, xterm, y secuencias OSC (Operating System Command) que los agentes pueden emitir para reportar estado.
- **Protocolo de teclado moderno (Kitty / "CSI u")**: xterm.js no lo trae de fábrica, así que el ADE implementa la mitad del terminal en `src/lib/terminal/keyboardProtocol.ts`. Está **inactivo hasta que una app lo negocia** (vía `CSI ? u` / `CSI > u` / `CSI < u` / `CSI = u`, registradas con `registerCsiHandler`), de modo que el manejo de teclas existente no cambia. Activo, codifica las teclas como `CSI <code> ; <mods> [: <event>] u` y desambigua `Ctrl+I`/Tab, `Esc` y combinaciones `Ctrl`/`Alt`+letra; las teclas funcionales/de navegación caen a la codificación legacy de xterm (pendientes en `FOR-DEV.md`). El scroll en pantalla alterna (rueda → flechas) lo provee xterm.js de forma nativa.

### Flujo Bidireccional

La comunicación entre el usuario y el proceso PTY sigue un flujo bidireccional completo que atraviesa todas las capas de la arquitectura:

```
Usuario teclea en terminal
        |
        v
    xterm.js (captura evento de teclado en el webview)
        |
        v
    invoke('pty_write', { ptyId, data })   ← Tauri command (frontend → backend)
        |
        v
    Backend Rust (PTY Manager)
        |
        v
    PTY stdin (se escribe al pseudoterminal)
        |
        v
    Proceso (shell o agente) procesa input
        |
        v
    PTY stdout (el proceso responde)
        |
        v
    Backend Rust (lee output async con Tokio)
        |
        v
    emit('pty:output:{id}', bytes)         ← Tauri event (backend → frontend)
        |
        v
    xterm.js (renderiza output con WebGLAddon)
```

**Diferencia clave con Electron**: En Tauri 2, se usan **Tauri commands** (`#[tauri::command]` en Rust, `invoke()` en JS) para request/response, y **Tauri events** (`emit()`/`listen()`) para streaming unidireccional. Los events de Tauri son más eficientes porque evitan el overhead de serializar respuestas completas, lo cual es ideal para streaming de bytes de PTY.

---

## 2. Gestión de PTY (Backend Rust)

### Crate portable-pty

La gestión de pseudoterminales se realiza en el backend Rust mediante la crate **`portable-pty`**, que proporciona una abstracción multiplataforma para crear y gestionar PTYs en **Windows, macOS y Linux**. Cada pane en la interfaz corresponde a un proceso PTY independiente.

### Responsabilidades del PTY Manager

El módulo PTY Manager en el backend Rust es responsable de:

- **Spawn**: Crear nuevos pseudoterminales con el shell configurado del usuario (bash, zsh, PowerShell) en el directorio del worktree correspondiente.
- **Write**: Escribir datos al stdin del PTY (input del usuario o comandos inyectados).
- **Resize**: Redimensionar el PTY cuando el usuario ajusta el tamaño de un pane (filas/columnas).
- **Close**: Cerrar el PTY de forma ordenada (SIGTERM → timeout → SIGKILL) y liberar recursos.

### Cada Pane = Un Proceso PTY Independiente

Cada pane visible en la interfaz mantiene su propio proceso PTY. Esto garantiza aislamiento total: 5 agentes en 5 panes corren literalmente en paralelo, sin interferencia. Cada pane tiene su propio scrollback y su propio historial.

### Instancias xterm persistentes (sin snapshot ni replay)

Cada PTY sigue ejecutándose en background aunque su tab esté oculto, y **el
scrollback vive una sola vez, de forma autoritativa, en el buffer del xterm del
frontend** (acotado a 5 000 líneas por terminal). El backend no retiene
historial de output.

- **Una instancia xterm por tab, viva toda la vida del tab**: el frontend
  mantiene un registro de instancias por id (`src/lib/terminal/instances.ts`) —
  el modelo de VS Code. El componente Svelte (`Terminal.svelte`) es solo la
  *vista*: al montar **adopta** la instancia (re-parenta su elemento DOM al
  pane) y al desmontar la **aparca**; la instancia se destruye únicamente cuando
  el tab deja de existir en todos los workspaces.
- **Mover un tab a otra región** remonta el componente Svelte, pero el xterm
  (buffer, parser, addons, estado del protocolo de teclado, suscripciones a
  eventos PTY) sobrevive y solo se mueve su elemento (`appendChild` re-parenta el
  nodo). No se restaura ni se reproduce nada; las suscripciones `pty:output`
  viven en la instancia, así que ningún byte se pierde durante el movimiento.
- **Por qué no hay replay**: reproducir el stream crudo de bytes de una TUI a
  pantalla completa dentro de un xterm nuevo es incorrecto por construcción — un
  recorte puede empezar a mitad de secuencia de escape (desincroniza el parser),
  el replay compite con el output en vivo, y ConPTY descarta un resize al mismo
  tamaño, así que la TUI nunca repinta encima del daño. El mecanismo anterior
  (ring buffer de 256 KiB + `pty_snapshot`) se eliminó junto con el modelo de
  recrear-el-xterm que lo necesitaba.
- **Recarga del webview (dev/HMR)**: es el único caso en que `pty_create`
  devuelve `false` (PTY vivo sin xterm vivo). El frontend envía entonces un
  *nudge* de repintado — un resize que rebota el número de filas — para que la
  app en ejecución repinte su pantalla (ConPTY no tiene protocolo de reattach).

### Tauri Commands Registrados

El PTY Manager expone las siguientes operaciones como Tauri commands que el frontend puede invocar:

| Command | Descripción |
|---------|-------------|
| `pty_create` | Crea un nuevo pseudoterminal con shell configurado en un directorio específico. Devuelve `created` (`true` = sesión nueva; `false` = ya existía — solo ocurre cuando el webview se recargó sobre un backend vivo, y el frontend responde con el nudge de repintado) |
| `pty_write` | Escribe datos (input del usuario) al stdin del PTY |
| `pty_resize` | Ajusta las dimensiones (filas, columnas) del PTY |
| `pty_close` | Cierra el PTY de forma ordenada, matando el proceso asociado |

### Tauri Events Emitidos

Para el streaming de output (backend → frontend), se usan Tauri events:

| Event | Descripción |
|-------|-------------|
| `pty:output:{id}` | Emite los bytes de salida de un PTY específico. El `{id}` identifica el PTY para que el frontend enrute el output al componente xterm.js correcto. |

---

## 3. Árbol de Layout — Splits y Tabs

### 3.1 Modelo de Árbol Binario

El área central se organiza como un **árbol binario recursivo** de paneles. Esta estructura permite layouts flexibles y anidados:

```
TabGroup Layout (por worktree)
  +-- Split Horizontal
       +-- Hoja (TabGroup 1: Terminal con Claude Code)
       +-- Split Vertical
            +-- Hoja (TabGroup 2: Terminal con bash)
            +-- Hoja (TabGroup 3: Terminal con Codex)
```

Las características de este modelo son:

- **Recursivo**: Cada nodo del árbol es un split (horizontal o vertical) o una hoja.
- **Hojas con TabGroup**: Cada hoja del árbol contiene un **grupo de tabs** (TabGroup), no un pane individual. Esto permite que cada región del layout tenga su propia barra de tabs con múltiples tabs.
- **Tabs con contenido variado**: Cada tab dentro de un TabGroup puede contener un terminal, un editor, un visor de diff, o un navegador embebido.
- **Ratios ajustables**: Los splits tienen ratios de tamaño que el usuario puede ajustar arrastrando los drag handles entre regiones.

### 3.2 Dos Niveles de Splitting

Esto es importante y distingue al ADE de un terminal convencional. Existen dos niveles independientes de subdivisión:

#### Nivel 1: Splits de TabGroup (nivel alto)

Dividen el **área central** en regiones independientes, cada una con su propia barra de tabs. Esto permite ver terminales de diferentes propósitos lado a lado. Por ejemplo, un TabGroup para desarrollo a la izquierda y otro para pruebas a la derecha, cada uno con sus propios tabs.

#### Nivel 2: Splits de Pane dentro de un Tab (nivel bajo)

Dentro de un mismo **tab de terminal**, dividen el área en múltiples paneles PTY. Cada pane es un proceso PTY independiente. Esto es similar a los splits de Vim o tmux, pero operan dentro de un solo tab del TabGroup.

#### Ejemplo de Layout Complejo

La combinación de ambos niveles permite configuraciones sofisticadas:

```
+------------------------------------------+
| Tab: Claude Code  | Tab: Tests           |
|-------------------+----------------------|
| +-------+-------+ |                      |
| | Pane  | Pane  | | Pane único           |
| | (pty1)| (pty2)| | (pty3: npm test)     |
| |       |       | |                      |
| +-------+-------+ |                      |
+-------------------+----------------------+
  TabGroup 1 (split V)     TabGroup 2
         \________________________/
              Split Horizontal
```

En este ejemplo:
- Hay un **split horizontal de nivel alto** que divide el área central en dos TabGroups.
- **TabGroup 1** (izquierda) tiene un tab "Claude Code" que internamente tiene un **split vertical de nivel bajo** con dos panes PTY (pty1 y pty2).
- **TabGroup 2** (derecha) tiene un tab "Tests" con un solo pane (pty3 ejecutando `npm test`).

### 3.3 Tipos de Contenido por Tab

Cada tab en el área central puede contener distintos tipos de contenido:

| Tipo | Descripción |
|------|-------------|
| **Terminal con agente** | Proceso interactivo con detección de estado. El ADE monitorea si el agente está trabajando, esperando input, bloqueado o terminó, mediante secuencias OSC o heurísticas de título de terminal. |
| **Terminal shell puro** | Bash, zsh o PowerShell sin agente asociado. Para operaciones manuales del usuario (ejecutar comandos, inspeccionar archivos, etc.). |
| **Editor de archivos** | Utiliza **CodeMirror 6** para edición directa rápida de archivos dentro del ADE, sin necesidad de abrir un editor externo. **Implementado** como pestaña real (`FileEditor.svelte`), abierta desde el árbol de archivos. |
| **Visor de diff** | Para revisión inline de cambios. Permite al usuario ver los diffs que un agente ha producido sin salir del área central. **Implementado** como pestaña real (`DiffPane.svelte` + `DiffView.svelte`), abierta desde la lista de cambios. |
| **Navegador embebido** | Un webview integrado para previsualizar aplicaciones web que el agente está desarrollando o modificando. *(Pendiente — FOR-DEV.)* |

> **Estado:** terminal, editor y diff son pestañas del mismo `TabGroup` (modelo
> `GroupTab` = `terminal \| file \| diff` en `terminals.svelte.ts`), por lo que
> admiten **splits mixtos** (terminal + editor lado a lado). El estado vivo por
> pestaña (contenido/dirty/diff) vive en un registro por id fuera del árbol
> serializado, de modo que xterm/CodeMirror no se remontan al dividir/reordenar.
> Las pestañas de archivo se restauran al reiniciar (por ruta); las de diff son
> transitorias. El navegador embebido sigue pendiente.

---

## 4. Ciclo de Vida de una Sesión de Terminal

Cada sesión de terminal con agente sigue un ciclo de vida completo de 10 pasos, desde la creación hasta la limpieza de recursos:

### Paso 1: Creación

El usuario crea un tab manualmente o el ADE lo crea automáticamente al abrir un worktree. Si el worktree tiene un agente predefinido, el ADE crea el tab de forma proactiva.

### Paso 2: Spawn del PTY

El backend Rust crea un pseudoterminal con `portable-pty` usando el shell configurado del usuario (bash, zsh, PowerShell), estableciendo como directorio de trabajo el directorio del worktree correspondiente.

### Paso 3: Conexión

El frontend Svelte conecta xterm.js al PTY vía Tauri events. La conexión es bidireccional:
- **Input del teclado** se envía al backend con `invoke('pty_write')` (Tauri command).
- **Output del PTY** se emite al frontend con `emit('pty:output:{id}')` (Tauri event).

> **Orden crítico — la respuesta al query de arranque.** En Windows, ConPTY/PowerShell
> emiten al arrancar un query de posición de cursor (DSR `ESC[6n`) y **se bloquean
> hasta que el terminal responde**; xterm genera esa respuesta y la entrega por
> `onData`. Por eso `onData` (que reenvía la respuesta al PTY con `pty_write`) se
> registra **antes** de `pty_create`: el query llega *mientras* aún se espera
> `pty_create`, así que un `onData` tardío perdería la respuesta y el shell quedaría
> colgado sin imprimir nunca su prompt (panel en blanco intermitente). Un flag
> `replaying` suprime `onData` mientras se reproduce un snapshot en un xterm
> remontado, para que las respuestas a queries embebidos en esos bytes no se filtren
> como input al shell vivo.

### Paso 4: Lanzamiento del Agente

El usuario escribe el comando del agente (por ejemplo, `claude`) o el ADE lo lanza automáticamente si el worktree fue creado con un agente predefinido. El comando se inyecta directamente al stdin del PTY.

### Paso 5: Ejecución

El agente corre interactivamente dentro del PTY. El usuario puede escribir prompts, el agente responde, edita archivos, ejecuta comandos. Todo el flujo es visible en la terminal.

### Paso 6: Monitoreo

Secuencias **OSC** (Operating System Command) emitidas por el agente, o **heurísticas de título de terminal**, permiten al ADE detectar el estado del agente (working, waiting, blocked, done). Este estado se refleja en los indicadores visuales de la sidebar y la barra de tabs.

### Paso 7: Background

Si el usuario cambia de tab o de worktree, el PTY **sigue corriendo** en el backend Rust. No se mata el proceso. El buffer async (gestionado con `tokio::sync::mpsc`) acumula el output que el agente produce mientras está en background.

### Paso 8: Restauración

Al volver al tab, el backend envía un **snapshot del buffer** acumulado al frontend para sincronizar xterm.js. El usuario ve todo el output que el agente produjo mientras no estaba mirando, como si nunca hubiera salido del tab.

### Paso 9: Terminación

El usuario cierra el tab o el worktree. El backend envía **SIGTERM** al proceso del PTY, espera un **timeout configurable**, y luego envía **SIGKILL** si el proceso no responde. Esto garantiza una terminación ordenada cuando es posible y forzada cuando es necesario.

### Paso 10: Limpieza

Se liberan los recursos del PTY en Rust (drop automático del struct, que cierra file descriptors y libera memoria). Se actualiza el estado del **store reactivo de Svelte** para reflejar que el tab ya no existe. Opcionalmente, se guarda el **scrollback** de la sesión a disco para referencia futura.

---

## 4.b Arbitraje de teclado (atajo de app vs TUI/agente)

Con una terminal enfocada, xterm entrega cada tecla al handler
`attachCustomKeyEventHandler` (`Terminal.svelte`), que decide —vía el arbitrador
**puro** `decideTerminalKey` (`terminalArbiter.ts`)— si la maneja uxnan
(`preventDefault`, no va al PTY) o se envía al TUI/agente (`return true`).
Sustituye los dos `switch` hardcodeados previos (uno en `+page.svelte`, otro en
`Terminal.svelte`) por **una sola política por-atajo**:

- **Política por-atajo** (`DEFAULT_TERMINAL_POLICY` en `terminalArbiter.ts`,
  override en `AppSettings.terminalKeyPolicy`): cada acción es `app` (uxnan gana en
  la terminal — el "set reservado") o `terminal` (la tecla va al TUI). El default
  reserva los atajos de baja colisión (Mod+Shift / Mod+Alt) y cede los que
  shells/TUIs necesitan (Ctrl+W borrar-palabra, Ctrl+P historial, Ctrl+S XOFF,
  Ctrl+J newline, Ctrl+B prefijo tmux). **Multiplataforma:** los chords usan el
  token `Mod` (⌘ en macOS, Ctrl en Win/Linux) y `Alt` (⌥) vía `isMac`.
- **Modo foco (passthrough)** por-terminal (`terminalKeyboard.svelte.ts`): con él
  activo, **todas** las teclas van al TUI (excepto el propio toggle, para poder
  salir); un badge en la terminal lo indica y lo alterna.
- **Tecla líder** (tmux-style, `AppSettings.leaderKey`, opt-in): en una terminal,
  tras la tecla líder, el **siguiente** atajo va a uxnan sea cual sea su política —
  determinismo bajo demanda.
- **Despachador compartido** (`keyactions.ts` `runAppAction`): las acciones se
  ejecutan en un solo lugar, consultado tanto por el handler global (`+page`) como
  por el de la terminal, evitando que los dos caminos deriven.

Se configura en **Settings → Atajos de teclado** (un toggle uxnan/TUI por acción +
la tecla líder). La decisión pura (`decideTerminalKey`) tiene tests unitarios
(`terminalArbiter.test.ts`).

### Inferencia de interrupción (fallback de `done`)

El mismo handler **observa sin consumir** `Ctrl+C` (SIGINT, sin selección) y el
doble-`Esc`: si el agente estaba `working` y tras ~1.5 s no llegó un `Stop` ni
output nuevo (el `lastUpdate` del hook no cambió), sintetiza `done + interrupted`
en el display (`agentStatus.synthesizeInterruptedDone`), respetando el done-gate de
subagentes (`02d`). Un hook real posterior siempre re-sincroniza. Cubre un turno
abortado por el usuario que el CLI no reporta por hook.

---

## 5. Lanzamiento y Control de Agentes

### 5.1 Flujo de Lanzamiento

El lanzamiento de un agente sigue un flujo de 6 pasos orquestado entre el frontend y el backend:

1. **El usuario crea un worktree** (o un tab nuevo dentro de un worktree existente).
2. **El ADE consulta si hay un agente predefinido** para el worktree. Esto se determina por la configuración del worktree almacenada en los metadatos (qué agente se seleccionó al crearlo).
3. **Si hay un agente predefinido**: se prepara el comando completo con sus **argumentos** y **variables de entorno** necesarias.
4. **Se crea el PTY** en el directorio del worktree. El backend Rust invoca `portable-pty` especificando el directorio de trabajo y el shell.
5. **Se inyecta el comando de startup** al PTY. El comando del agente se escribe al stdin del PTY como si el usuario lo hubiera tecleado.
6. **El agente arranca** y comienza a reportar estado. El ADE empieza a monitorear via hooks HTTP, secuencias OSC, o heurísticas de título.

#### Comandos rápidos del usuario (lanzador ⚡)

El mismo mecanismo de "comando de una sola vez" (paso 5) alimenta los **comandos rápidos** definidos por el usuario. Persistidos en `AppData.quickCommands` (comando `quick_commands_set`, `#[serde(default)]`), cada uno tiene un **scope** (global / project / worktree — podado al eliminar su proyecto/worktree, del lado frontend que conoce las rutas vivas). Se lanzan desde un menú **⚡** en la barra superior (slot fijo junto a min/max/close; atajo `openQuickCommands` → `Mod+Shift+P`) que separa los comandos del *worktree/proyecto activo* de los *globales*. Al ejecutar (`projects.runQuickCommand`) se sustituyen variables `{worktree}`/`{branch}`/`{repo}`/`{repoName}`/`{path}`, se resuelve el shell (un perfil de terminal) y el cwd, y se despacha a una **pestaña nueva** (`terminals.create` con `runCommand`) o a la **terminal enfocada** (`pty_write`), corriendo de inmediato o solo pre-escribiendo el comando — un flag `runCommandExecute` omite el Enter final para el modo "solo escribir".

### 5.2 Control del Agente

Una vez que el agente está ejecutándose, el usuario tiene varias opciones de control:

| Acción | Mecanismo | Descripción |
|--------|-----------|-------------|
| **Interrumpir** | `Ctrl+C` | Envía SIGINT al proceso del agente. Esto interrumpe la operación actual del agente sin matarlo. El agente puede manejar la señal y responder apropiadamente. |
| **Matar** | Cerrar el tab | Envía SIGTERM al proceso, espera un timeout configurable, luego SIGKILL si no responde. Esto termina el agente definitivamente. |
| **Relanzar** | Crear nuevo tab | Se crea un nuevo tab en el mismo worktree y se vuelve a ejecutar el comando del agente. Esto es útil cuando el agente falló o se necesita reiniciarlo con un prompt diferente. |
| **Prompt directo** | Escribir en terminal | El usuario escribe directamente en el terminal para enviar instrucciones al agente. El input va al stdin del PTY y el agente lo recibe como input interactivo. |

---

## 6. Nota sobre Zellij/tmux como Alternativa

En lugar de gestionar PTYs directamente desde Rust con `portable-pty`, existe la opción de delegar la multiplexación de terminales a un motor externo como **Zellij** (escrito en Rust, moderno) o **tmux** (ubicuo en Linux/macOS). El ADE lanzaría el multiplexor como subproceso y se comunicaría vía su API de socket/IPC para crear panes, enviar input y leer output.

### Tabla Comparativa

| Aspecto | PTY directo (portable-pty) | Zellij/tmux como backend |
|---------|---------------------------|--------------------------|
| **Portabilidad** | Windows + macOS + Linux | Solo macOS + Linux (Zellij no soporta Windows nativo) |
| **Control** | Total (splits, buffers, lifecycle en tu código) | Limitado a la API del multiplexor |
| **Complejidad** | Mayor (debes implementar buffer management, scrollback) | Menor (el multiplexor ya lo resuelve) |
| **Session persistence** | Debes implementar | Gratis (detach/reattach) |
| **Dependencia externa** | Ninguna (todo embebido) | Requiere Zellij/tmux instalado |

### Ventajas del Enfoque con Multiplexor

- **Zellij/tmux ya resuelven** splits, tabs, scrollback y session persistence.
- **Detach/reattach** es gratuito: las sesiones sobreviven reinicios del ADE.
- **Menor código** que mantener en el lado del ADE.

### Desventajas del Enfoque con Multiplexor

- **Dependencia externa**: El usuario necesita Zellij o tmux instalado.
- **Sin soporte Windows**: Zellij no tiene soporte nativo de Windows, lo que elimina uno de los tres sistemas operativos objetivo.
- **Control limitado**: El ADE queda restringido a lo que la API del multiplexor expone. Personalización del renderizado en el webview es más difícil.
- **Complejidad de instalación**: Añade un paso de setup para el usuario.

### Recomendación

Usar **`portable-pty` directo** para el MVP, priorizando máxima portabilidad (Windows + macOS + Linux). Evaluar **Zellij como backend alternativo** en fases futuras para usuarios de macOS/Linux que deseen session persistence avanzada o detach/reattach sin implementación propia.

---

## 7. Módulos y Conexiones

### Diagrama de Conexión entre Módulos

El siguiente diagrama muestra cómo se conectan los módulos internos del motor de terminal y layout para formar el sistema completo:

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

### Descripción de Cada Módulo

| Módulo | Capa | Responsabilidad |
|--------|------|-----------------|
| **Motor de Layout** | Frontend (Svelte) | Almacena y renderiza el árbol binario de splits con ratios ajustables. Usa estado reactivo de Svelte 5 (`$state`, `$derived`) para mantener la estructura del layout. Los drag handles permiten al usuario ajustar las proporciones entre regiones. |
| **Árbol de Splits/TabGroups** | Frontend (Svelte) | Estructura de datos del árbol binario recursivo. Cada nodo es un split (horizontal/vertical con ratio) o una hoja (TabGroup). Soporta operaciones de inserción, eliminación y reestructuración. |
| **Gestor de Tabs** | Frontend (Svelte) | Maneja la barra de tabs por cada TabGroup: crear nuevos tabs, cerrar tabs existentes, reordenar/mover tabs entre regiones con arrastre por **pointer events** (`elementFromPoint`), mantener el orden MRU (Most Recently Used) para el ciclo `Ctrl+Tab`. |
| **Gestor de Panes** | Frontend (Svelte) | Maneja los splits de nivel bajo (dentro de un tab). Crea y destruye panes, gestiona el árbol binario interno de cada tab de terminal, y comunica cambios de tamaño al backend para el resize del PTY. |
| **Fábrica de Contenido** | Frontend (Svelte) | Instancia el componente correcto según el tipo de tab: componente xterm.js para terminales, CodeMirror 6 para editores, componente de diff para visores, o webview para navegador embebido. |
| **Conexión PTY ↔ xterm** | Frontend + Backend | Establece el flujo bidireccional entre xterm.js (webview) y el PTY (backend Rust) vía Tauri commands (`invoke('pty_write')`) y Tauri events (`listen('pty:output:{id}')`). |
| **Backend Rust: PTY Manager** | Backend (Rust) | Vive en el backend Rust. Crea y destruye pseudoterminales con `portable-pty`. No retiene historial de output (el buffer del xterm del frontend es la única copia; ver "Instancias xterm persistentes"). Emite output vía Tauri events. Maneja el ciclo de vida completo de cada PTY (spawn, write, resize, close, kill). |
| **Shell/Agente CLI** | Proceso Externo | El proceso final que corre dentro del PTY: un shell interactivo (bash, zsh, PowerShell) o un agente CLI (Claude Code, Codex CLI, Aider, etc.) que el usuario o el ADE lanzó. |

### Flujos de Datos Críticos

1. **Usuario escribe en terminal** → xterm.js captura input → `invoke('pty_write')` → Backend Rust → PTY stdin → proceso responde → PTY stdout → Backend Rust → `emit('pty:output:{id}')` → xterm.js renderiza.

2. **Usuario crea split** → Motor de Layout inserta nodo en árbol → Gestor de Panes crea nuevo pane → Fábrica de Contenido instancia xterm.js → Conexión PTY solicita `pty_create` al backend → PTY Manager spawns nuevo PTY → flujo bidireccional establecido.

3. **Tab se oculta** → Backend Rust continúa leyendo PTY stdout y emitiendo `pty:output:{id}` → el xterm (siempre montado, oculto con `display:none`) sigue consumiendo el stream hacia su buffer, así que no se pierde output ni scrollback; el pane oculto libera su contexto WebGL y repinta al revelarse.

   - **Mover/reordenar tab** → arrastre con **pointer events** (no HTML5 drag-and-drop: el drag-drop nativo de Tauri, usado para soltar archivos en la terminal, lo bloquea dentro del WebView) → `terminals.moveTab(tabId, toGroupId, toIndex?)`. Dentro de la misma región solo reordena (sin remontar); cruzando regiones se remonta el componente Svelte pero la instancia xterm viva se re-parenta (registro `src/lib/terminal/instances.ts`) — sin restauración ni replay.
   - **Atajos configurables** (Settings → Keyboard shortcuts, grupo "Terminal tabs & splits"): `cycleTabNext/Prev` → `terminals.cycleTab()` recorre los tabs de la región activa en orden MRU; `focusSplitNext/Prev` → `terminals.focusSplit()` mueve el foco entre regiones de split; `closeCenter` (Ctrl/⌘+W) cierra la pestaña activa (cualquier tipo) con confirmación de cambios sin guardar. Con una terminal enfocada los resuelve `Terminal.svelte` vía `matchAction` para que no lleguen al PTY.

4. **Tab se cierra** → Gestor de Tabs notifica → Conexión PTY invoca `pty_close` → Backend Rust envía SIGTERM → espera timeout → SIGKILL si necesario → recursos liberados (Rust drop) → store Svelte actualizado → scrollback guardado opcionalmente.
