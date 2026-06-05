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

Integrada en el panel de cambios:
- **Editor de mensaje de commit** con soporte markdown.
- **Generación AI del mensaje**: Un botón para que el agente genere automáticamente un mensaje de commit basado en los cambios staged.
- **Botón de acción primaria** contextual: Commit, Push, Sync, o Publish según el estado de la rama.

### 4.6 Fuentes de Diff

El visor maneja tres fuentes de diff:

1. **Uncommitted**: Working tree vs HEAD. Es el más común, muestra los cambios que el agente acaba de hacer.
2. **Branch**: Rama actual vs rama base. Muestra el changeset completo de una feature branch.
3. **Commit**: Un commit individual. Muestra qué cambió ese commit específico.

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
