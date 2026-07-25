# 02f — Automatizaciones

> **Audiencia:** desarrolladores, arquitectos.
> **Resumen ejecutivo:** una **automatizacion** es una tarea **desatendida y
> recurrente** que corre en su propia carpeta de trabajo — un repo o cualquier
> carpeta — **con la app cerrada**, y que ejecuta un **grafo multi-agente**:
> varios proveedores trabajando en paralelo y otro agente consumiendo sus
> salidas. El programador del sistema operativo dispara un **runner headless**
> del mismo binario; el motor vive en Rust.
>
> **Estado: IMPLEMENTADO** (modelo, almacenamiento, plantillas, ejecutor del
> grafo, precondicion, worktree por corrida, runner `--automation-run`, registro
> en el programador del SO, superficie de comandos e interfaz completa).
> Validado de punta a punta en Windows: una tarea real dispara el runner con la
> app cerrada y deja su registro. **Pendiente:** validar el registro en
> macOS/Linux en hardware real, notificacion nativa desde el runner y recoleccion
> de los worktrees por corrida. Ver `FOR-DEV.md`.

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

## 5. Registro en el programador del SO

Al guardar o habilitar una automatizacion la app da de alta la tarea; al
deshabilitarla o borrarla, la da de baja. Todo **por usuario, sin permisos de
administrador**:

| SO | Mecanismo | Recuperacion de corridas perdidas |
|---|---|---|
| Windows | XML de Task Scheduler → `schtasks /Create /XML /TN uxnan-automation-<id> /F` | `StartWhenAvailable` |
| macOS | LaunchAgent `~/Library/LaunchAgents/dev.luisgamas.uxnandesktop.automation.<id>.plist` + `launchctl bootstrap gui/<uid>` | reintento al despertar / iniciar sesion |
| Linux | `~/.config/systemd/user/uxnan-automation-<id>.{service,timer}` + `systemctl --user enable --now` | `Persistent=true` (solo `OnCalendar`) |

Se usa el **XML** de Task Scheduler y no las banderas cortas de `schtasks`
porque las banderas no pueden expresar las cuatro cosas que importan:
ejecucion **oculta**, **politica de instancia multiple** (que *es* la politica de
solape, ahora respaldada por el SO y no solo por el runner), **limite de tiempo
de ejecucion** y **recuperacion de perdidas**.

Un intervalo se emite como trigger de **repeticion**; los presets de hora de
reloj como trigger de **calendario**, que se mantiene anclado al reloj de pared
donde un intervalo derivaria con el cambio de horario. En systemd la distincion
importa aun mas: `Persistent=` (la recuperacion) **solo aplica a `OnCalendar`**,
asi que un intervalo monotonico deliberadamente **no** lo emite en vez de
declarar una recuperacion que no ocurriria.

### 5.1 Estructura y verificacion

Cada modulo de plataforma separa un **constructor puro** (el XML / plist /
unidades, compilado y unit-testeado en **todas** las plataformas — ahi es donde
viven los errores) de la **invocacion**, que si va detras de `cfg`. Por eso una
maquina Windows valida igualmente el plist de macOS y las unidades de systemd.

Ademas hay una prueba de **ida y vuelta contra el programador real**
(`#[ignore]`, se corre a proposito: `cargo test -- --ignored windows_round_trip`)
que da de alta, consulta, da de baja y repite la baja. Es la unica forma de
detectar el fallo al que este modulo mas expuesto esta: que Task Scheduler
rechace el documento con un mensaje que no dice nada de la causa real.

**Sin comparar textos de error.** Distinguir "la tarea no existe" de "no puedo
ver el almacen de tareas" mirando el mensaje es una trampa: esta **localizado**,
asi que en un Windows en espanol, aleman o japones ninguna comparacion acierta y
toda automatizacion se reportaria como fallida. En su lugar, cuando la consulta
falla se **sondea** si el programador responde en absoluto: si responde, la
tarea simplemente no esta; si no responde, eso si es un fallo que el usuario
debe ver.

### 5.2 Superficie de comandos

`automations/commands.rs` mantiene un invariante que la UI no deberia tener que
recordar: **la definicion en disco y la tarea del SO se mueven juntas**. Guardar
registra o da de baja, borrar elimina tarea e historial, y **toda mutacion
devuelve el `SchedulerStatus` resultante** para que la interfaz muestre la verdad
en lugar de suponer exito. "Ejecutar ahora" lanza **el mismo subproceso runner**
que lanza el SO, solo etiquetado como `manual`.

### 5.3 Degradacion honesta (requisito, no detalle)

Si el registro falla (SO no soportado, politica corporativa, permisos), la
automatizacion **no se rompe** y **no se pierde**: se guarda igual, el
`SchedulerStatus` devuelto lleva **el mensaje del SO tal cual**, y la ficha debe
decirlo con todas sus letras con accion para reintentar. Nunca una
automatizacion que aparenta estar activa sin estarlo.

**Limitacion documentada, no disimulada:** en Windows la tarea corre con
`InteractiveToken`, es decir **solo con el usuario con sesion iniciada**.
Ejecutar con la sesion cerrada exigiria almacenar la contrasena del usuario, y
eso no se hace. macOS y Linux **no estan validados en hardware real** todavia
(`FOR-DEV.md`).

---

## 6. Interfaz

Vista **a pantalla completa dentro de la ventana**, igual que Configuraciones:
un overlay (`absolute inset-0 z-30`) sobre la region de contenido, asi que tapa
los tres paneles y la barra de estado **sin desmontar el cuerpo** — ninguna
terminal ni PTY se destruye por entrar aqui. Se abre desde el menu del perfil del
panel izquierdo (`SidebarProfile`) y con **`Mod+Shift+A`**, reconfigurable en
Ajustes → Atajos como cualquier otro. Mientras esta abierta se apropia del
teclado (incluido `Escape`), igual que Configuraciones.

Riel de secciones a la izquierda (mismo patron y tokens que `Settings.svelte`,
para que las dos pantallas se lean como una familia) y **todo el contenido
inline**. Los unicos flotantes son el confirmador destructivo compartido y el
selector de carpeta, que es modal por naturaleza.

| Seccion | Contenido |
|---|---|
| Resumen | Lo que **requiere atencion** primero (activas que el SO no esta disparando), proximas ejecuciones, actividad reciente |
| Automatizaciones | La lista, con busqueda y agrupado conmutable por **agente principal**, **tipo de tarea**, **frecuencia**, **carpeta** y **estado**. Cada fila lleva la **pila de logos de todos los agentes** que participan, ejecutar-ahora, pausar/reanudar y el menu ⋯ (editar, crear a partir de, borrar) |
| Editor | Pagina completa: identidad → carpeta propia (con explorador) → frecuencia (con **vista previa de las proximas 5 ejecuciones**) → grafo de pasos → politica. Valida contra las mismas reglas que el backend, asi que Guardar explica por que esta deshabilitado en vez de fallar en el viaje de ida y vuelta |
| Ejecuciones | Historial global filtrable por automatizacion y por resultado; por paso muestra el **prompt tal como se envio**, la salida capturada, el exit code, stderr y el motivo de cada omision |
| Plantillas | Automatizaciones multi-agente listas (fan-in, consenso entre proveedores, relevo diario). Llegan **en pausa** al editor: una plantilla nunca empieza a dispararse antes de que la lean |
| Ajustes | Diagnostico del programador del SO (cuantas activas estan realmente registradas, con re-comprobacion) y donde viven las corridas |

### 6.1 El indicador de programacion

`SchedulerBadge` es la valvula de honestidad de §5.3 hecha pixel: dice el estado
en los cuatro casos y, cuando el registro fallo, muestra **el mensaje del sistema
operativo tal cual**. El Resumen levanta esas automatizaciones a lo alto de la
pantalla, porque "activa pero el SO no la va a disparar" es el modo de fallo que
mas importa ver.

### 6.2 La matematica de calendario vive aqui

La vista previa de proximas ejecuciones y el `startBoundary` que se manda al
backend se calculan en `automations/schedule.ts` (puro, unit-testeado), no en
Rust — ver §2.1. El backend no hace aritmetica de calendario y el programador del
SO sigue siendo la autoridad sobre *cuando*; esto es presentacion y el instante
inicial del registro.

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
| `automations/oscheduler/` | Registro en el programador del SO: `mod.rs` (API + estado) · `windows.rs` (XML de Task Scheduler) · `macos.rs` (LaunchAgent) · `linux.rs` (unidades systemd) |
| `automations/commands.rs` | Comandos Tauri; mantiene definicion y tarea del SO sincronizadas |
| `src/lib/automations/` | Frontend puro: `types.ts` (contratos), `schedule.ts` (calendario + vista previa), `display.ts` (agrupado, etiquetas, tonos) |
| `src/lib/state/automations.svelte.ts` | Store: carga, mutaciones y sondeo del historial mientras la pantalla esta abierta |
| `src/lib/components/Automations.svelte` | Marco de la pantalla + riel de secciones |
| `src/lib/components/automations/` | Lista, detalle, editor, selector de frecuencia, editor del grafo, vista de corrida, plantillas, ajustes, indicador de programacion |
