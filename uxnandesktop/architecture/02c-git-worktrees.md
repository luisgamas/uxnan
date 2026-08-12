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

### 2.0 Project registration

The Projects sidebar registers folders through one **Add project** dialog. A
single primary input starts in automatic mode and distinguishes explicit local
paths from `owner/repository`, HTTPS, and SSH repository references; Local and
GitHub tabs can force the interpretation. Local input drives the adjacent folder
list and keeps the existing single-folder or detected sub-repository selection.
A recognized GitHub input replaces that list with the repository result, rejects
other hosts at the input boundary, derives an editable destination under the
user's home directory, and executes
`github_clone` followed by the normal `repo_add` path. Successful registration
loads the canonical worktree list and focuses the primary worktree. A failed
clone is reported without deleting a partial destination automatically.
The default destination is `<home>/uxnan/<repository>`; the backend creates its
missing parent directories. A native OS directory picker can replace that parent
without introducing a second project-import dialog. Clone transfers use a bounded
15-minute timeout rather than the one-minute budget used by API-shaped GitHub
queries. Clones retain full history while using `--filter=blob:none`, deferring file
objects until a checkout needs them instead of paying the full object transfer up
front. They are deliberately not shallow clones, because later branch, diff, and
worktree operations require complete history.

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
- **Ubicación**: la decide el backend (`worktreeloc.rs`) a partir de los ajustes,
  y el formulario solo la **previsualiza** pidiéndosela (`worktree_preview_path`).
  El usuario puede además **editar la ruta** o **explorar** hasta una carpeta
  padre (con el explorador in-app compartido) para esa creación concreta; una
  ruta personalizada debe ser absoluta y no existir, y se normaliza a barras `/`.

#### 2.1.1 Dónde se crea un worktree

Tres disposiciones, elegidas en **Ajustes → Git → Ubicación de los worktrees**
(`AppSettings.worktrees.location`, con `worktrees.root` para la personalizada) y
sobrescribibles por proyecto (`RepoData.worktreeRoot`):

| Modo | Ruta | Para qué |
|---|---|---|
| `managed` (por defecto) | `<home>/uxnan/worktrees/<repo>/<rama>` | Agrupa los checkouts de un repositorio en una carpeta que la app gestiona, junto a la que ya usa el clon (`<home>/uxnan/<repo>`) |
| `sibling` | `<padre>/<repo>--<rama>` | El comportamiento anterior, para quien lo prefiera |
| `custom` | `<raíz elegida>/<repo>/<rama>` | La misma agrupación en otro volumen o en una ruta más corta |

Reglas que aplica el resolver, en este orden:

1. **La clave del repositorio se mide desde su worktree PRINCIPAL** (la primera
   entrada de `git worktree list`). Crear un worktree estando dentro de otro no
   debe anidar el nuevo bajo el anterior.
2. **La rama se sanea a un nombre de carpeta válido en todos los sistemas**: `/`
   y `\` → `-`; se eliminan los caracteres que Windows rechaza (`<>:"|?*` y los
   de control); se recortan los puntos y espacios finales que Windows elimina en
   silencio; se escapan los nombres de dispositivo reservados (`CON`, `NUL`,
   `COM1`…); y se corta a 60 caracteres respetando la última palabra.
3. **Dos proyectos con el mismo nombre de carpeta no comparten grupo**: la
   carpeta de grupo lleva un marcador `.uxnan-repo` con la ruta canónica del
   repositorio; si ya pertenece a otro, el grupo pasa a `<repo>-<hash8>` (FNV-1a
   de esa ruta, escrito a mano para que sea estable entre versiones y
   reproducible desde el bridge).
4. **Un destino ocupado toma el siguiente sufijo libre** (`-2`, `-3`, …), porque
   `git worktree add` rechaza una carpeta existente.
5. **Un repositorio en WSL se resuelve dentro de la distro**
   (`//wsl.localhost/<distro>/<home>/uxnan/worktrees/…`), nunca en el lado
   Windows del recurso 9P: un checkout ahí es lento y pierde los modos de
   fichero.
6. La ruta se devuelve siempre con barras `/`, la forma en que git reporta los
   worktrees y con la que el frontend indexa sus espacios de trabajo.

**Nada se migra.** Los worktrees existentes se leen de `git worktree list` y
siguen funcionando donde estén; el ajuste solo afecta a los que se creen a partir
de entonces. Por el mismo motivo, los flujos de PR e issue comprueban si ya hay
un worktree **en esa rama** (preguntándoselo a git) en lugar de mirar si existe
una ruta concreta.

El flujo del backend (comando `worktree_create` con `fromExisting` y `path`
opcionales) tiene varias garantías:

1. **Resolver la referencia base** *(solo modo rama nueva)*: El usuario selecciona una rama base. El ADE la resuelve a una referencia completa, verificando que existe. Se prueba un orden de prioridad: referencia simbólica de HEAD remoto, luego `main`, luego `master`, con fallback a ramas locales.

2. **Crear el worktree**: Se ejecuta `git worktree add` (con `--no-track -b` en modo rama nueva, para que la rama nueva no herede el tracking de la base y no se reporte como "detrás de upstream" antes del primer push; con checkout directo o `--track -b` en modo rama existente). Tras crearlo se **re-lista** con `git worktree list` para devolver la entrada tal como git la reporta (ruta/rama/head canónicas), de modo que incluso una ruta personalizada coincide con la clave de workspace del frontend.

3. **Configurar push automático**: Se establece `push.autoSetupRemote=true` en la configuración del repo (una sola vez) para que `git push` sin argumentos cree automáticamente la rama remota.

4. **Refrescar la referencia base local**: Si la base es una rama remota (ej: `origin/main`), se puede hacer fast-forward de la rama local correspondiente para que el worktree empiece desde lo más reciente. Esto solo se hace si la rama local no tiene cambios propios.

5. **Atomicidad**: Si cualquier paso falla, se limpia el worktree parcialmente creado y su rama.

6. **Almacenar metadatos**: Se guardan nombre, agente asociado, timestamp de creación.

7. **Lanzar agente** (opcional): Si el worktree fue creado con un agente predefinido, se lanza automáticamente en un terminal nuevo.

GitHub-native worktree flows are available both from item details and from the
project-card **+** launcher. New, Worktree, PR, and Issue tabs replace one source
area instead of nesting separate forms. New is first and selected by default for
git projects, preserving the existing name-first creation path. The launcher lists open pull requests or issues and
accepts a scoped number or full URL; full URLs must belong to the launcher's
repository. GitHub item naming is automatic: PRs keep their real head branch
and issues use `<number>-<title-slug>`; the filesystem destination is not
exposed in this flow. The user chooses zero or more post-create actions
(terminal profiles, agents, browser). The backend
checks out `pull/<n>/head` or runs the linked `gh issue develop` flow, then both
results enter the same frontend adoption path as manual creation. Targeted fetches
use `--no-tags` because tags are unrelated to materializing the selected ref. The
frontend refreshes the canonical list, activates the new workspace, saves the item
title as its note, and runs the selected actions without awaiting project-wide status
hydration; the new worktree's badge refresh continues in the background. Remote item bodies are never forwarded to an
agent implicitly. If GitHub explicitly refuses linked-branch creation because
the account lacks mutation rights, the issue flow creates the same branch as a
local worktree instead; unrelated GitHub failures are not swallowed.

The name-first New field also acts as a source router for GitHub work-item
references. Full PR/issue URLs and labeled references carry their source type;
neutral `<number>` / `#<number>` input is resolved once through the active
repository's shared issue endpoint, whose response identifies whether the item is
a PR or an issue, and then switches to the appropriate source. Item-list filtering treats a lone `#` as incomplete input, resolves
complete numeric references exactly, and otherwise searches the title, author,
branch, and metadata shown by each row.

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

> **Un solo diálogo, prellenado.** No hay una acción "cerrar espacio" aparte: en
> la cabeza del usuario hay **una** intención — deshacerse de este worktree — y
> partirla en dos según cuánta limpieza viene predecidida es una distinción del
> implementador, no suya. Lo que cambia es cuánto puede contestar el diálogo por
> él: cuando el espacio está `done`, `removalDefaults`
> (`$lib/worktree-removal.ts`) llega con "eliminar rama local" **ya marcada** y
> una línea explicando por qué. Reglas: los valores por defecto nunca destruyen
> más de lo obvio (solo se premarca una rama cuyos commits ya aterrizaron, para
> que el `-d` seguro la acepte); **forzar nunca es un default** y vive bajo
> **Avanzado**, contraído; y las advertencias (cambios sin commitear, commits sin
> subir, agente vivo) **avisan pero no bloquean** — a veces borrar un callejón sin
> salida es exactamente lo que se quiere.

3. **Rama local** *(solo si se marca "Eliminar rama local")*:
   - Se intenta borrar con `git branch -d` (safe delete, falla si hay commits sin mergear).
   - Si `-d` falla y el usuario marcó **Forzar**, se borra con `git branch -D`.
   - Si `-d` falla sin forzar, se analiza si la rama es "patch-equivalente" a la base (squash-merge); si lo es, se borra con seguridad (`-D`). Si no, la rama se **conserva** y se reporta como "sin mergear" para que la UI ofrezca forzar.
   - **Un `-D` que git rechaza NO es un no-op.** Se distingue de "no lo intentamos"
     (`local_branch_unmerged`) mediante `local_branch_error`, que lleva la razón —
     git rechaza mientras la rama siga *checked out* en algún lado, que es
     justamente lo que deja un worktree a medio eliminar (en Windows, un proceso
     que aún sostiene su carpeta). Sin ese campo el resultado quedaba todo en
     `false` y, como el toast se compone de esas banderas, la app anunciaba
     "worktree eliminado" mientras la rama seguía ahí.

4. **Rama remota** *(solo si se marca "Eliminar rama remota")*: si `origin/<rama>` existe, se borra con `git push origin --delete <rama>`. Un fallo (offline, protegida, sin `origin`) se reporta como aviso —la eliminación local del worktree ya tuvo éxito—.

### Nota por worktree — «¿por qué existe esto?»

Cada worktree puede llevar una **nota** libre (`worktreeNotes` en `app.settings`,
por ruta). Se siembra con el nombre en palabras que escribiste al crearlo y se
edita después desde el menú de la fila; se ve en el hover card, junto a la
identidad.

Existe porque **la rama solo guarda un slug** de ese nombre: plegado, sin acentos
y recortado a 50 caracteres en el límite de palabra. La nota conserva la frase
entera, que es lo que contesta «¿de qué iba esto?» tres semanas después. Se borra
sola al eliminar el worktree, para que el mapa no acumule rutas muertas.

### ¿Este espacio ya terminó? (consulta de solo lectura)

`branch_integrated(path, branch)` responde si la rama **ya aterrizó** en la base
por defecto — ancestría real (`merge-base --is-ancestor`) o **squash**
(`is_squash_merged`) — **sin borrar nada**.

> **Una rama que nunca se movió NO ha aterrizado: no ha empezado** —
> `branch_has_diverged`, la guarda que corre *antes* de la ancestría.
>
> La ancestría sola no distingue los dos casos: una rama que no aportó nada tiene
> todos sus commits trivialmente alcanzables desde la base, así que
> `--is-ancestor` dice que sí sobre un worktree que creaste esta mañana y no
> tocaste. Sin la guarda, el chip «integrada» aparecía en espacios recién
> montados y el **cierre en lote** los barría como seguros.
>
> **Por qué no basta comparar tips.** Fue el primer intento y solo cubre el caso
> en que la base no se ha movido. En cuanto la base avanza, una rama intacta deja
> de compartir su tip y vuelve a parecer aterrizada — reportado desde uso real.
>
> **Por qué el reflog.** Dos ramas pueden ser *literalmente el mismo commit*
> (crea una desde el tip de otra y no toques ninguna) y una haber aterrizado
> trabajo real mientras la otra jamás empezó. Ningún recorrido del grafo puede
> separarlas, porque no hay nada que recorrer que las diferencie. Lo que las
> separa es el **movimiento**, y git lo registra: la entrada más vieja del reflog
> de la rama es el commit donde nació (`git rev-list -g <rama> | tail -1`).
>
> **Respaldo sin reflog** (expirado a los 90 días, deshabilitado, o una rama de un
> clon que nunca lo tuvo): la forma de la historia. Un tip que cae sobre la cadena
> de **primer padre** de la base es simplemente un punto anterior de esa línea, no
> una contribución; el tip de una rama mergeada cuelga de ella como segundo padre
> de un merge. Es más débil — no ve el caso de los dos refs en el mismo commit —
> pero cubre el común: creada desde la base, sin tocar, base avanzada.
>
> **Ante la duda, `false`.** Reportar de menos cuesta un cierre manual; reportar
> de más ofrece borrar trabajo que nunca ocurrió. Un merge por *fast-forward*
> queda sub-reportado a propósito por esa misma regla.
>
> Es deliberadamente la misma detección
que corre `remove_worktree` camino de un borrado seguro: lo que la sidebar declare
"terminado" es, por construcción, lo que la eliminación aceptaría limpiar. La rama
base contesta `false` (nunca se propone cerrar aquello sobre lo que todo aterriza),
y cualquier error de git también, para no invitar a cerrar un repo ilegible.

En el frontend, `classifyCompletion` (`$lib/worktree-completion.ts`) compone el
veredicto con datos ya cacheados — el PR, el status del árbol, los agentes vivos —
más ese bit:

| Veredicto | Significa | ¿Ofrece cerrar? |
|---|---|---|
| `done` | PR mergeado, o git confirma que la rama aterrizó | **sí** |
| `abandoned` | PR cerrado sin mergear | **sí** |
| `inert` | limpio, sin commits sin subir y sin agente — pero nada lo *prueba* | no: solo se atenúa |
| `active` | todo lo demás | no |

La distinción `inert` vs `done` es la regla central: "no se ha movido en un rato"
describe a toda rama a la que piensas volver el lunes, así que jamás propone un
borrado. La llamada a git se paga **solo** para worktrees que ya se ven quietos
(`shouldCheckIntegration`), se pacea con el barrido de status existente, y su
respuesta se descarta en cuanto los commits de la rama se mueven.

El `RemoveOutcome` reporta el destino de cada rama (borrada / squash-merge / conservada-sin-mergear / **borrado local rechazado** / error remoto) para el toast compuesto. Los dos casos de error se avisan aparte del toast de éxito, porque el worktree sí se eliminó.

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

Cada snapshot emitido también incluye el commit `HEAD` actual. Esta consulta de
referencia reutiliza el repositorio ya abierto para el escaneo de estado, por lo
que no añade un segundo recorrido del working tree. Así, un commit o amend
externo sobre un árbol limpio también cambia el snapshot: Cambios se mantiene al
día, se refresca el Historial cacheado y se relee el contexto GitHub activo aunque
la rama no tenga upstream y `ahead`/`behind` sigan en cero.

La sidebar mantiene además una reconciliación ligera cada 3 segundos de la lista
de worktrees de cada repositorio registrado. Esto cubre worktrees creados fuera
del ADE por agentes o por Git; solo se reasigna una lista cuando cambian sus
entradas, para no perturbar el orden estabilizado de las vistas del panel.

**Barrido de estado de TODAS las tarjetas.** El watcher de 3 s sigue una sola
ruta —la del worktree activo—, así que los indicadores del resto de tarjetas
(cambios pendientes, ahead/behind) solo se refrescaban cuando aparecía o
desaparecía un worktree: un agente lanzado en el repo padre, o en otro worktree,
dejaba la tarjeta afectada en blanco hasta que se hacía clic en ella. El store
`projects` ejecuta ahora un **barrido de todos los worktrees conocidos**
(`sweepStatuses`), limitado a uno cada `SWEEP_MS` (15 s), sin solapamiento y
omitido con la ventana oculta; la política vive en `shouldSweep`
(`statusSweepRegistry.ts`, TS puro y con tests). Tres señales lo **fuerzan** de
inmediato: un agente que cambia de estado (hook), la ventana recuperando el foco,
y las acciones git propias (commit / push / pull / fetch). Los sitios que no
pueden importar `projects` —el listener de agentes, al que `projects` sí
importa— piden el barrido a través de `statusSweepRegistry`, evitando un ciclo de
imports (mismo patrón que `flushRegistry`).

**Insignias de PR fuera del worktree activo.** El contexto de GitHub también se
cargaba solo para el worktree activo. El poll de `github` refresca ahora, además,
hasta `BADGE_TICK_CAP` (2) worktrees no activos por ciclo. El orden de prioridad
vive en `pickBadgeTargets` (`githubRefresh.ts`, TS puro y con tests): **primero
los que no tienen insignia alguna** —información ausente pesa más que información
vieja—, después aquellos cuyo estado git acaba de cambiar
(`projects.takeChangedPaths()` — cuando una rama gana commits o se publica es
justo cuando aparece o cambia su PR) y, si sobra cupo, uno en rotación. Una ruta
señalada que no entra en el cupo se **arrastra** al ciclo siguiente en lugar de
perderse: el store de proyectos la entrega una sola vez y nada volvería a
anunciarla. Cada contexto es una llamada a `gh` contra el rate limit, de ahí el
tope por ciclo; `loadContextFor` escribe únicamente en la caché por ruta que
alimenta las insignias, sin tocar el `context` que lee el panel derecho.

Como `setInterval` dispara *después* del intervalo, al arrancar la app todo lo que
depende del poll (medidor de rate limit, contador de notificaciones e insignias de
los worktrees no activos) quedaba vacío durante un intervalo completo y luego se
llenaba de dos en dos. `github.prime()` hace una **pasada única acotada** en cuanto
el poll se arma o se resuelve el inicio de sesión —lo que ocurra más tarde—: lotes
del mismo ancho que un ciclo normal, con tope `PRIME_MAX_PATHS` (24) escalado por
el factor de GitHub del perfil de recursos. Un intervalo de `0` (solo manual) queda
fuera, como cualquier otra lectura automática.

**Un refresco de fondo no puede quitar nada.** Es la regla que gobierna al panel
derecho de GitHub y se aplica en tres sitios:

1. El panel **no se desmonta mientras relee**. El marcador *Loading…* solo aparece
   cuando de verdad no hay nada que mostrar para el worktree activo (primera
   lectura, o «no es un repositorio de GitHub»). Condicionar el cuerpo entero a
   «hay una lectura en vuelo» era lo que lo sustituía cada 45 s y se llevaba por
   delante un formulario **Crear PR** abierto.
2. Un `null` aislado es un **fallo de lectura, no una respuesta**.
   `github_repo_context` devuelve `Option<RepoContext>`, así que un lock de git,
   un `gh` lento o una red caída son indistinguibles de «esto ya no es un repo de
   GitHub»; `resolveContext` exige que el `null` se repita antes de creerlo. Un
   worktree que nunca tuvo contexto sigue respondiendo al instante.
3. Un formulario **Crear PR** sin enviar se aparca en `github.prDrafts`, indexado
   por el dueño del formulario (`worktree:<ruta>` para la pestaña del panel
   derecho, `section:<ruta>` para el de la sección — ambos pueden estar abiertos
   sobre el mismo repo y no significan lo mismo). Cualquier remontaje lo
   restaura; solo lo descartan crear el PR o pulsar **Cancelar**.

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
- **Comprobar el remoto (fetch)**: junto al botón de **actualizar** (que solo
  relee el working tree local), la cabecera ofrece un botón de **fetch**
  (icono cloud-download) que ejecuta `git fetch` del remoto de la rama actual y
  recalcula ahead/behind. Es de **solo lectura** (nunca toca el working tree): si
  el remoto trae commits nuevos, avisa cuántos y el botón **Pull** aparece (vía la
  barra ahead/behind); si no, avisa que **«todo está actualizado»**. El comando
  backend `git_fetch(path)` (`git::fetch_remote` → `WorktreeStatus` refrescado);
  el frontend actualiza ahead/behind con el resultado (`git.svelte.ts →
  fetchRemote`, flag `git.fetching` que además silencia el listener de estado en
  vivo mientras corre).
- **Generación AI del mensaje** (opcional, opt-in): cuando se activa en
  **Configuración → Mensaje de commit con IA**, aparece un botón **Generar** en el
  composer que redacta el mensaje a partir del diff staged. La configuración es
  **no técnica**: el usuario elige un **agente** (solo se pueden seleccionar los
  instalados de la lista curada `AI_COMMIT_AGENTS` — un **subconjunto** del conjunto headless, porque un agente ademas tiene que responder una lista de modelos) y un **modelo**;
  no hay comando ni argumentos que configurar. El backend resuelve cada CLI igual
  que el bridge (`src-tauri/src/agentcli.rs`: `node <entry.js>` para instalaciones
  npm, binario nativo si existe — así el lanzamiento no interactivo funciona en
  Windows sin shell) y lo ejecuta de forma **no interactiva** a través de
  `agentrun::run_headless` — el mismo runner de una sola pasada que usan el motor
  de orquestación y las automatizaciones (subproceso, no un PTY; timeout de 120 s
  y `kill_on_drop`; sin API/SDK/keys de proveedor). El prompt viaja por el canal
  que cada CLI prefiere (`agentcli::prompt_delivery`): **stdin** para Claude,
  Codex y OpenCode, **archivo de prompt** para Grok, y `argv` (acotado) para
  Antigravity, que no admite otro. Importa porque el prompt lleva un diff y la
  línea de comandos es el único canal que el SO limita (~32 KiB en Windows). Los modelos se descubren por agente: estáticos
  para Claude (versiones concretas exactas, p. ej. `claude-opus-4-8`, mantenidas
  en `agentcli.rs::CLAUDE_MODELS` con una guía de actualización — sin alias
  "latest"), o en vivo para OpenCode (`opencode models`), Antigravity
  (`agy models`), Grok (`grok models`) y Codex (`codex app-server` `model/list`);
  siempre con una opción **Predeterminado** (sin flag de modelo). El selector de modelo es
  **buscable y con scroll** (`AiModelPicker.svelte`) porque algunos agentes
  listan cientos de modelos.
  Comandos: `git_generate_commit_message`, `ai_commit_agents`, `ai_commit_models`
  (`src-tauri/src/aicommit.rs`). La configuración vive en `AppSettings.aiCommit`
  (`AiCommitSettings`: `agentId`, `model`, idioma, Conventional Commits, cuerpo
  extendido, instrucciones extra), **desactivada por defecto**. Lista de agentes
  soportados en `src/lib/aiCommitPresets.ts`: se ofrecen **Claude Code, Codex,
  OpenCode, Grok y Antigravity**.

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
4. **GitHub** (`GithubPanel.svelte`, opcional): resumen contextual del repo al que
   pertenece el worktree activo — el PR de su rama (resumen de checks + acciones
   rápidas) y, debajo, los **5 PR**, los **5 runs de CI** y los **5 issues** más
   recientes del repositorio (cualquier estado; los runs **ya no se filtran por
   rama**, que era lo que hacía que la lista repitiera siempre las mismas
   ejecuciones). Cada fila **abre el detalle dentro de la app** —
   `github.openSection(repoPath, section, detail)` deja la vista inline mostrando
   ese review, ese log o ese hilo— y cada issue ofrece, al pasar el ratón,
   `GithubWorktreeDialog` para arrancar su worktree. La cabecera abre la vista de
   GitHub del proyecto y refresca (con tooltip que dice qué relee). Los iconos y
   tonos de estado son los de `$lib/githubDisplay`, compartidos con la vista
   inline. Solo aparece cuando el repo es de GitHub y el tab está habilitado
   (`AppSettings.github.rightPanelTab`). Cada poll configurado de GitHub refresca
   tanto el contexto de la rama como las tres listas del resumen del repositorio
   (PR, ejecuciones de CI e issues), incluso si no cambiaron el nombre de la rama
   ni el JSON del contexto. Las respuestas async llevan guardas de secuencia y se
   limpian al cambiar de worktree, por lo que una petición lenta del repositorio
   anterior no puede repintar el panel activo. Ese refresco **actualiza en sitio**:
   no sustituye el panel por un marcador de carga ni desmonta lo que hay en
   pantalla, y un formulario **Crear PR** a medio escribir sobrevive tanto al poll
   como a un remontaje (§3.3, «Un refresco de fondo no puede quitar nada»). Las
   vistas grandes (review/diff/logs) se
   abren en la **vista GitHub inline por-proyecto** (`GitHub.svelte`), que ocupa el
   centro + panel derecho dejando visibles el sidebar izquierdo y el navegador. Se
   abre desde el menú **⋯** de cada tarjeta de proyecto y desde el menú contextual
   de **cualquier fila de worktree** (**GitHub → Pull Requests / Issues / Actions**,
   siempre sobre el proyecto propietario y por el mismo camino,
   `github.openSection`; la fila es la única entrada cuando el sidebar está
   **agrupado por estado** y no se dibuja ninguna tarjeta),
   muestra solo la sección elegida con un selector de sección +
   cerrar/actualizar en su propia barra, y se cierra al activar cualquier worktree
   (`app.githubInline`; integración `gh`-backed; ver `docs/github.md`). La sección de
   ajustes/cuenta de GitHub vive en **Configuración → GitHub** (`GithubSettings.svelte`).

El estado git del worktree activo se carga en el shell siempre montado
(`+page.svelte`), de modo que la pestaña Archivos colorea su árbol aunque el
panel derecho esté cerrado o la pestaña Cambios esté desmontada. La pestaña
Historial mantiene su propio store (`history.svelte.ts`), que sobrevive al cambio
de pestaña. Las operaciones commit/push/pull de Uxnan refrescan inmediatamente un
log ya cargado, y el watcher de estado hace lo mismo cuando un commit externo
cambia `HEAD`.

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
foco. **La selección de texto** usa la selección **nativa** (el editor no habilita
`drawSelection()`), así que tiene **forma de texto** y se corta al final de cada línea
—como VSCode— en vez de un bloque de ancho completo; se tiñe del **`--primary`** del tema
a baja opacidad con `color: inherit`, de modo que hereda el color del tema, es translúcida
y **nunca oculta ni recolorea** el texto seleccionado en ningún tema (mismo criterio en el
diff y en el `::selection` global de `app.css`; las terminales conservan su propia
selección). El cursor pasa a ser el nativo, coloreado con `caret-color`.

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
  - **PDF** is validated by extension or `%PDF-` signature, transported through the
    same bounded 25 MiB `data:` URL, and handed to the webview's native PDF renderer.
    An explicit fallback appears when a platform webview has no PDF renderer. The CSP
    allows only `object-src data:` and keeps `frame-src 'none'`.
  - **Markdown** uses an in-house parser built on `@lezer/markdown` (`markdown.ts` →
    typed AST; `MarkdownView.svelte` with Svelte markup and **no `{@html}`**). A safe
    subset of presentational README HTML (alignment, links, images/badges, emphasis,
    headings, code, and `kbd`) becomes typed nodes; scripts, events, styles, embedded
    documents, and unsafe URLs are discarded. A `.md` file opens in source mode with
    a Preview action and supports language-aware fenced-code highlighting,
    GitHub-style heading ids, anchor navigation, and relative sibling-file links that
    open the existing file tab. Local images use `fs_read_data_url` (including
    URL-encoded paths and `?raw=true` suffixes); remote images use the shared HTTP
    reader's bounded 25 MiB preview mode, preserving animated GIF bytes without
    transcoding. Safe inline-HTML images inside loose README tables are preserved,
    relative assets resolve against Windows, macOS/Linux, and UNC document paths,
    and explicit HTML dimensions survive. The scroller fills the panel and uses the
    same native overflow treatment as the CodeMirror Edit and Changes views, keeping
    its bar at the right edge while the article remains centered.
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
| `fs_read_data_url(path)` | Reads a local image or PDF into a preview `data:<mime>;base64,…` URL (extension + signature sniffing, 25 MiB cap, all other formats rejected). |
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
  vive en `history.svelte.ts` y sobrevive al cambio de pestaña. Las operaciones
  commit/push/pull de Uxnan refrescan inmediatamente un log ya cargado. El watcher
  de 3 segundos hace lo mismo cuando cambia el `HEAD` de su snapshot, cubriendo
  commits y amends hechos por agentes o clientes Git externos; un log aún no
  cargado conserva la carga perezosa hasta mostrarse por primera vez.
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
