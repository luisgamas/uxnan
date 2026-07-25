# 02f — Automatizaciones

> **Audiencia:** desarrolladores, arquitectos.
> **Resumen ejecutivo:** una **automatizacion** es una tarea **desatendida y
> recurrente** que corre en su propia carpeta de trabajo — un repo o cualquier
> carpeta — **con la app cerrada**, y que ejecuta un **grafo multi-agente**:
> varios proveedores trabajando en paralelo y otro agente consumiendo sus
> salidas. El programador del sistema operativo dispara un **runner headless**
> del mismo binario; el motor vive en Rust.
>
> **Estado: NUCLEO IMPLEMENTADO** (modelo, almacenamiento, plantillas, ejecutor
> del grafo, precondicion, worktree por corrida y runner `--automation-run`).
> **Pendiente:** registro en el programador del SO (§4) y la interfaz (§5).
> Ver `FOR-DEV.md`.

---

## 1. Que la separa de la orquestacion (`02d` §3)

Las dos superficies ejecutan grafos de pasos, pero resuelven problemas distintos
y **no comparten motor**:

| | Consola de orquestacion (`02d` §3) | Automatizaciones (este documento) |
|---|---|---|
| Cuando | Ahora mismo, a mano | Programado, recurrente |
| Agentes | **Vivos**, en terminales del panel central | CLIs lanzados por el runner |
| Requiere la app abierta | Si (el motor vive en el webview) | **No** |
| Ambito | El worktree/proyecto activo | Su **propia carpeta**, independiente |
| Compuertas humanas | Si | No (es desatendido — §3.4) |
| Motor | TypeScript (`orchestrationRun.svelte.ts`) | **Rust** (`automations/`) |

Ambas conviven sin solaparse: lo interactivo y ad-hoc se queda en la consola; lo
programado y desatendido vive aqui.

### 1.1 Por que el motor esta en Rust

El motor de corridas de `02d` §3 vive en TypeScript **dentro del webview**, que
por definicion no existe cuando la app esta cerrada. Duplicar el scheduler en dos
lenguajes garantizaria desfase, asi que las automatizaciones tienen su propio
motor en Rust y **un unico camino de ejecucion**: tanto el programador del SO
como el boton "Ejecutar ahora" de la app lanzan **el mismo subproceso runner**.
Una corrida programada y una manual no pueden comportarse distinto.

---

## 2. Modelo

`src-tauri/src/automations/mod.rs`.

```rust
Automation {
  id, name, description, icon, enabled,
  tags: Vec<String>,          // "tipo de tarea": agrupa y filtra la lista
  working_dir: String,        // carpeta libre — repo o no; NO el proyecto activo
  worktree_per_run: bool,     // aislamiento opcional cuando working_dir es un repo
  base_branch: Option<String>,
  schedule: Schedule,
  policy: Policy,
  steps: Vec<Step>,           // el grafo
  created_at, updated_at,
}

Schedule =                    // sin variante de ejecucion unica: una automatizacion
  | Every { n, unit, starts_at }   //   es recurrente por definicion
  | DailyAt { hour, minute }
  | WeekdaysAt { hour, minute }
  | WeeklyAt { day, hour, minute }

Policy {
  catch_up: bool,             // recuperar una corrida perdida (maquina apagada)
  overlap: Skip | Queue | CancelPrevious,
  precondition: Option<{ command, timeout_seconds }>,
  max_run_minutes, keep_runs, notify_on,
}

Step {
  id, title, agent, model, prompt,
  depends_on: Vec<String>,    // paralelo + fan-in salen de aqui
  on_failure: Stop | Retry, max_attempts, timeout_ms,
}
```

### 2.1 Sin aritmetica de calendario en Rust

`schedule.rs` **no calcula proximas ocurrencias**. El programador del SO es el
componente que debe seguir disparando con la app cerrada, asi que es la unica
autoridad sobre *cuando*; Rust solo describe la frecuencia lo bastante bien para
emitir el trigger del SO y registrarla en el log. La vista previa de "proximas
ejecuciones" se calcula en el frontend (donde `Date` da calendario local gratis)
y es **solo visual**. Esto evita la dependencia `chrono` y, sobre todo, evita
duplicar la logica autoritativa en dos lenguajes.

No hay expresiones cron: no traducen limpio a ninguno de los tres programadores
(Task Scheduler y systemd no hablan cron), y el modelo de frecuencia cubre el
caso de uso.

### 2.2 Validacion

`validate()` es el respaldo que tambien protege un archivo editado a mano o una
automatizacion importada: nombre y carpeta presentes, horario valido, al menos un
paso, ids unicos, agente y prompt por paso, dependencias existentes, sin
autodependencia y **sin ciclos** (DFS con pila de recursion). El frontend
revalida lo mismo para dar realimentacion inmediata.

---

## 3. Ejecucion

### 3.1 El runner headless

`main.rs` inspecta los argumentos **antes** de que Tauri construya la ventana:

```
uxnan-desktop --automation-run <automationId> [--trigger scheduled|manual]
```

Con esa bandera toma una ruta Tokio pura y termina — sin webview, sin ventana y,
en Windows (binario de subsistema GUI), sin consola. Reutiliza lo ya probado:
`agentcli` (resolucion + recetas de modo print), `winproc` (spawn sin ventana) y
`agentrun` (timeout duro, `kill_on_drop`, captura de stdout/stderr/exit code).

**Enriquecimiento de `PATH` (no opcional).** Una corrida lanzada por el
programador del SO hereda un entorno aun mas pobre que un lanzamiento GUI
(launchd entrega el `PATH` minimo), asi que el runner llama a
`path_env::enrich_for_gui_launch()` antes de nada. Sin eso, en macOS **todos**
los agentes se resolverian como "no instalados" y la corrida fallaria a las 3 AM
sin nadie mirando.

Orden de una corrida: cargar y validar → politica de solape → precondicion →
worktree por corrida (opcional) → confianza de Codex → ejecutar el grafo → podar
historial. **Cada desenlace, incluida cada negativa, se escribe en el registro**:
una ejecucion que nadie vio tiene que poder explicarse despues.

Codigos de salida: `0` corrida terminada o saltada por una razon legitima,
`1` la corrida fallo, `2` la automatizacion no era ejecutable.

### 3.2 El grafo

`graph.rs` separa **logica pura** (promocion, listos, aplicacion de resultado,
derivacion de estado — unit-testeada sin procesos ni reloj ni disco) del
**pegamento asincrono** (`execute`, que lanza los CLIs con un tope de
concurrencia de 4 y reescribe el registro tras cada transicion).

- **Paralelo y fan-in** salen solo de `depends_on`: los pasos independientes se
  despachan juntos; uno que declara varias dependencias espera a todas.
- **Completado verificado:** un paso termina cuando su proceso **sale con 0**.
  Es la ventaja estructural sobre teclear en una terminal y adivinar cuando paro
  el agente.
- **Propagacion de omision:** si un paso falla, toda su rama descendente queda
  `skipped` (iterativo, no solo el hijo directo); las ramas independientes siguen.
- **Reintento:** `on_failure = Retry` devuelve el paso a la cola hasta agotar
  `max_attempts`.
- **Tope de tiempo:** superado `max_run_minutes`, los pasos en vuelo se abortan y
  se marcan fallidos con el motivo.

### 3.3 Paso de contexto

El prompt de un paso resuelve `{{…}}` contra:

| Token | Valor |
|---|---|
| `{{steps.s1.output}}` | stdout capturado del paso `s1` **en esta corrida** |
| `{{steps.s1.title}}` | titulo del paso `s1` |
| `{{prev.s1.output}}` | salida de `s1` en la **corrida anterior** de esta automatizacion |
| `{{workingDir}}` | directorio donde corre |

`prev.*` es lo que permite que una automatizacion recurrente **continue el
trabajo de ayer** en vez de empezar de cero. Una referencia desconocida o aun sin
valor resuelve a cadena vacia y queda anotada en `missing_refs` del registro: un
traspaso delgado se documenta, no mata la corrida.

### 3.4 Por que no hay compuertas humanas

Una tarea desatendida que se bloquea a las 3 AM esperando un clic esta rota. Una
automatizacion termina y **deja su resultado** (una rama, un reporte, la salida
capturada) mas una notificacion. Lo que necesita aprobacion en vivo pertenece a
la consola interactiva de `02d` §3.

### 3.5 Precondicion y aislamiento

- **Precondicion:** un comando de shell con timeout decide si la corrida procede
  (exit 0 = adelante). Barato para expresar "solo si hay commits nuevos" sin
  gastar un turno de agente. Su captura completa queda en el registro.
- **Worktree por corrida:** si la carpeta es un repo, cada ejecucion puede
  trabajar en su propio worktree sobre una rama `automation/<slug>-<id>`, de modo
  que el trabajo desatendido nunca toca el arbol que el usuario esta usando.
- **Confianza de Codex:** Codex se niega a ejecutar en una carpeta que no confia
  y lo pregunta de forma interactiva. El runner siembra la misma confianza que la
  app siembra al lanzar Codex en un workspace (`codex_trust::ensure_project_trust`,
  no destructiva e idempotente), y la receta headless de Codex pasa
  `--skip-git-repo-check` porque la carpeta de una automatizacion legitimamente
  puede no ser un repo.

---

## 4. Persistencia — un unico escritor por archivo

La app y un runner pueden estar vivos a la vez (una corrida dispara mientras
tienes uxnan abierto). En vez de bloquear un blob mutable compartido, **cada
archivo tiene exactamente un escritor**:

```
<app-data>/automations/
  automations.json                  ← definiciones. Escribe SOLO la app
  runs/<automationId>/<runId>.json  ← una corrida = un archivo. Escribe SOLO su runner
  logs/<runId>.log
```

Nunca hay lectura-modificacion-escritura entre procesos, asi que no hacen falta
locks ni hay actualizaciones perdidas. Como el runner reescribe **su propio**
archivo conforme avanzan los pasos, la app muestra **progreso en vivo** solo con
vigilar el directorio. Los datos derivados (ultima corrida, ultimas salidas) se
leen de `runs/`; el runner jamas escribe en la definicion.

Toda escritura usa el patron write-rename de `persistence.rs`: una escritura
interrumpida no puede dejar un registro a medio parsear. Un registro corrupto se
omite al listar en vez de ocultar el historial a su alrededor.

El runner resuelve el directorio de datos **sin handle de Tauri**, replicando lo
que `app_data_dir()` devuelve en cada plataforma a partir del `identifier` de
`tauri.conf.json`.

---

## 5. Registro en el programador del SO — PENDIENTE

Al guardar o habilitar una automatizacion la app dara de alta la tarea; al
deshabilitarla o borrarla, la dara de baja. Todo **por usuario, sin permisos de
administrador**:

| SO | Mecanismo | Recuperacion de corridas perdidas |
|---|---|---|
| Windows | XML de Task Scheduler → `schtasks /Create /XML /TN "Uxnan\<id>" /F` | `StartWhenAvailable` |
| macOS | LaunchAgent `~/Library/LaunchAgents/…automation.<id>.plist` + `launchctl` | reintento al iniciar sesion |
| Linux | `~/.config/systemd/user/uxnan-automation-<id>.{service,timer}` | `Persistent=true` |

Se usa el XML de Task Scheduler y no las banderas cortas de `schtasks` porque da
lo que importa: ejecucion oculta, politica de instancia multiple (que **es** la
politica de solape), limite de tiempo de ejecucion y recuperacion de perdidas.

**Degradacion honesta (requisito, no detalle):** si el registro falla (SO no
soportado, politica corporativa, permisos), la automatizacion **no se rompe**:
sigue disparandose mientras uxnan este abierto y la ficha lo dice con todas sus
letras, con accion para reintentar el registro. Nunca una automatizacion que
aparenta estar activa sin estarlo.

---

## 6. Interfaz — PENDIENTE

Vista **a pantalla completa dentro de la ventana**, igual que Configuraciones
(overlay sobre la region de contenido: tapa los tres paneles y la barra de
estado). Se abre desde el menu del perfil del panel izquierdo y con un atajo
global reconfigurable.

Riel de secciones a la izquierda (patron de `Settings.svelte`), y **todo el
contenido inline**: el unico flotante permitido es el dialogo de confirmacion
destructiva compartido.

| Seccion | Contenido |
|---|---|
| Resumen | Proximas ejecuciones, corridas en vivo, fallos recientes, estado del registro en el SO |
| Automatizaciones | La lista, agrupable por **agente principal**, **tipo de tarea**, **frecuencia**, **carpeta** y **estado** |
| Editor | Pagina completa: identidad → carpeta → frecuencia (con vista previa) → grafo de pasos → politica |
| Corridas | Historial filtrable; detalle con timeline, agente+modelo por paso, **prompt resuelto**, salida, exit code, duracion y error |
| Plantillas | Automatizaciones multi-agente listas para usar |
| Ajustes | Retencion, notificaciones, diagnostico del programador del SO |

---

## 7. Modulos

| Archivo | Responsabilidad |
|---|---|
| `automations/mod.rs` | Modelo, serde, validacion, deteccion de ciclos |
| `automations/schedule.rs` | Frecuencias (sin aritmetica de calendario) |
| `automations/store.rs` | Layout en disco, escritura atomica, retencion, solape |
| `automations/template.rs` | Resolucion de `{{…}}` (escaner propio, sin regex) |
| `automations/graph.rs` | Ejecutor del DAG (logica pura + pegamento async) + precondicion |
| `automations/runner.rs` | Modo `--automation-run`, ciclo de vida de la corrida |
