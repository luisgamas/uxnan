# Uxnan Desktop ADE - Guia de Implementacion

> Patrones tecnicos detallados para la implementacion del Agent Development Environment.
> Complementa la arquitectura de alto nivel con codigo, configuraciones y decisiones de ingenieria.
> Fecha: 2026-06-05

---

## Tabla de Contenidos

1. [Stack Tecnologico Detallado](#1-stack-tecnologico-detallado)
2. [Patrones de Backend Rust](#2-patrones-de-backend-rust)
3. [Patrones de Frontend Svelte 5](#3-patrones-de-frontend-svelte-5)
4. [Seguridad](#4-seguridad)
5. [CI/CD y Distribucion](#5-cicd-y-distribucion)
6. [Rendimiento](#6-rendimiento)

---

## 1. Stack Tecnologico Detallado

### 1.1 Stack Principal

| Tecnologia | Que es | Para que la usamos | Ventajas clave |
|------------|--------|---------------------|----------------|
| **Rust** | Lenguaje de programacion de sistemas | Todo el nucleo pesado: gestion de git worktrees, procesos de terminales (PTY), servidor HTTP de hooks, monitoreo de agentes, filesystem, operaciones git, logica de orquestacion, persistencia. | Extrema ligereza y bajo uso de RAM/CPU. Seguridad de memoria (sin crashes por null/dangling pointers). Concurrencia segura con Tokio. Excelente para crecer (SSH, Docker, etc.) sin perder rendimiento. |
| **Tauri 2** | Framework para apps de escritorio | Une el frontend con el backend Rust y genera la app nativa para Windows, macOS y Linux. Provee el sistema de commands/events para comunicacion backend-frontend. | Mucho mas ligero que Electron (usa webview del sistema, no Chromium). Bajo consumo de RAM (30-100MB tipico vs 200-500MB de Electron). Seguridad fuerte (permisos explicitos por capability). Facil de empaquetar y distribuir. |
| **Svelte 5** | Framework frontend | Construir la interfaz: sidebars, layout de tres paneles, tabs, splits, estado en tiempo real, command palette, etc. | Muy ligero (menos runtime overhead que React/Vue). `$state` y `$derived` (Runes) eliminan la necesidad de librerias de estado externas como Zustand. Excelente rendimiento en actualizaciones en tiempo real. Codigo simple y mantenible. |
| **shadcn-svelte** | Coleccion de componentes UI para Svelte | Botones, sidebars, tabs, modales, tablas, tooltips, command palette, dark mode, etc. | Componentes modernos, accesibles y personalizables. Ligero (solo copias lo que usas). Basado en Bits UI (equivalente de Radix para Svelte). Look profesional sin esfuerzo. |
| **Tailwind CSS** | Framework de CSS utilitario | Estilos rapidos y consistentes de toda la aplicacion. | Muy ligero (purge automatico de clases no usadas). Alta velocidad de desarrollo. Facil de mantener y escalar. |

### 1.2 Tecnologias Complementarias

| Tecnologia | Capa | Proposito |
|------------|------|-----------|
| **xterm.js** | Frontend | Emulador de terminal en el webview. Renderiza output de PTY en canvas/WebGL. |
| **CodeMirror 6** | Frontend | Editor de codigo y visor de diffs. Mas ligero que Monaco (~300KB vs ~5MB). Extensible con plugins. |
| **portable-pty** (crate) | Backend Rust | Crear y gestionar pseudoterminales multiplataforma (Windows/macOS/Linux). |
| **git2** (crate) | Backend Rust | Operaciones git de alta frecuencia (status, diff, stage, log) sin crear subprocesos. Bindings de libgit2. |
| **Tokio** | Backend Rust | Runtime async para no bloquear el backend. Manejo de PTY I/O, timers, HTTP server, todo async. |
| **Serde** | Backend Rust | Serializacion/deserializacion type-safe de configuracion, estado, y persistencia a JSON. |
| **hyper** o **axum** | Backend Rust | HTTP server local async para recibir hooks de agentes. Minimalista y rapido. |
| **tauri-plugin-notification** | Tauri Plugin | Notificaciones nativas del OS. |
| **tauri-plugin-stronghold** | Tauri Plugin | Almacenamiento encriptado de credenciales y secretos. Alternativa: keyring del OS. |
| **TanStack Virtual** (svelte) | Frontend | Scroll virtual para listas largas (worktrees, archivos en diff). |

### 1.3 Crates de Rust Esenciales

Referencia rapida de las dependencias de Rust que forman el nucleo del backend:

| Crate | Version sugerida | Proposito |
|-------|-----------------|-----------|
| `tauri` | 2.x | Framework de app de escritorio. Provee commands, events, plugins y empaquetado multiplataforma. |
| `tokio` | 1.x | Runtime async (timers, channels, spawn). Todas las operaciones de I/O, red y git pasan por Tokio. |
| `serde` + `serde_json` | 1.x | Serializacion/deserializacion type-safe. Persistencia de estado, configuracion y cache a JSON. |
| `git2` | 0.19+ | Operaciones git nativas via bindings de libgit2. Status, diff, stage, log, branch ops. |
| `portable-pty` | 0.8+ | Pseudoterminales multiplataforma. Crea y gestiona PTYs en Windows, macOS y Linux. |
| `axum` o `hyper` | 0.7+ / 1.x | HTTP server local para recibir hooks de agentes. Async sobre Tokio. |
| `notify` | 7.x | File system watcher (alternativa o complemento al polling de git status). |
| `keyring` | 3.x | Acceso al keychain del OS para almacenar secretos de forma segura. |

---

## 2. Patrones de Backend Rust

### 2.1 Tauri Commands

Los Tauri Commands son el mecanismo principal de comunicacion request/response entre el frontend (Svelte) y el backend (Rust). Se definen con el atributo `#[tauri::command]` y se invocan desde JavaScript con `invoke()`.

Cada command es una funcion async de Rust que recibe parametros tipados, ejecuta logica de negocio y retorna un resultado serializable (via Serde). Los commands se registran en el builder de la aplicacion Tauri y quedan expuestos al frontend de forma controlada.

#### Lista Completa de Commands Planificados

**Gestion de Repositorios:**
- `repo_add` - Agregar una carpeta al ADE por ruta (git o no; las carpetas no-git son proyectos válidos sin worktrees — `RepoData.is_git` lo registra)
- `repo_remove` - Eliminar un repositorio de la lista del ADE
- `repo_list` - Listar todos los repositorios registrados

**Gestion de Worktrees:**
- `worktree_create` - Crear un worktree nuevo con rama base y configuracion
- `worktree_remove` - Eliminar un worktree con verificacion de cambios sucios
- `worktree_list` - Listar worktrees de un repositorio

**Gestion de Terminales (PTY):**
- `pty_create` - Crear un nuevo pseudoterminal en un directorio dado
- `pty_write` - Enviar datos (input del usuario) al stdin del PTY
- `pty_resize` - Redimensionar el PTY (columnas/filas) al cambiar tamano del panel
- `pty_close` - Cerrar el PTY y matar el proceso asociado

**Operaciones Git:**
- `git_stage` - Mover archivo(s) al area de staging (`git2::Index::add_path`)
- `git_unstage` - Sacar archivo(s) del area de staging
- `git_discard` - Descartar cambios de un archivo (revertir a HEAD)
- `git_commit` - Crear un commit con los archivos staged y un mensaje
- `git_status` - Obtener el estado actual del worktree (archivos modificados/staged/untracked)
- `git_diff` - Obtener el diff de un archivo especifico (hunks y lineas)
- `git_push` - Push de la rama actual al remoto
- `git_pull` - Pull de cambios del remoto

**Estado de Agentes y Configuracion:**
- `agent_status_get` - Obtener el ultimo estado conocido de un agente
- `settings_update` - Actualizar preferencias de la aplicacion

**Bridge Movil:**
- `bridge_start` - Iniciar el servidor de bridge para conexion movil
- `bridge_stop` - Detener el servidor de bridge
- `bridge_status` - Consultar si el bridge esta activo y conectado
- `bridge_generate_qr` - Generar codigo QR para que el movil se conecte

#### Patron de Codigo de un Command

```rust
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub id: String,
    pub name: String,
    pub branch: String,
    pub path: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub message: String,
    pub code: String,
}

// El state compartido se inyecta automaticamente por Tauri
pub struct AppState {
    pub repos: tokio::sync::RwLock<Vec<RepoData>>,
    pub persistence: tokio::sync::Mutex<PersistenceManager>,
}

#[tauri::command]
pub async fn worktree_create(
    state: State<'_, AppState>,
    repo_id: String,
    branch_name: String,
    base_branch: Option<String>,
) -> Result<WorktreeInfo, CommandError> {
    // 1. Resolver rama base (probing: origin/HEAD, main, master)
    let base = resolve_base_branch(&repo_id, base_branch).await?;

    // 2. Ejecutar git worktree add via CLI (git2 no soporta worktrees)
    let output = tokio::process::Command::new("git")
        .args(["worktree", "add", "-b", &branch_name, &worktree_path, &base])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| CommandError {
            message: e.to_string(),
            code: "GIT_EXEC_FAILED".into(),
        })?;

    // 3. Configurar push.autoSetupRemote
    // 4. Persistir metadatos via Serde
    let mut repos = state.repos.write().await;
    // ... actualizar estado y guardar a disco ...

    Ok(WorktreeInfo {
        id: generate_id(),
        name: branch_name.clone(),
        branch: branch_name,
        path: worktree_path,
        created_at: now_timestamp(),
    })
}
```

Desde el frontend, la invocacion es directa:

```typescript
import { invoke } from '@tauri-apps/api/core';

const worktree = await invoke<WorktreeInfo>('worktree_create', {
  repoId: 'repo-abc',
  branchName: 'feature/nueva-funcionalidad',
  baseBranch: 'main',
});
```

### 2.2 Tauri Events

Los Tauri Events son el mecanismo de comunicacion unidireccional para streaming de datos del backend al frontend. Se usan con `emit()` en Rust y `listen()` en JavaScript. Son ideales para datos que cambian frecuentemente o llegan en flujo continuo.

#### Por que Events en vez de Commands para Streaming

Los commands siguen un patron request/response: el frontend pide, el backend responde. Para datos que fluyen continuamente (output de terminal, cambios de estado git, actualizaciones de agentes), usar commands implicaria polling constante desde el frontend, serializando respuestas completas cada vez. Los events permiten que el backend envie solo los deltas cuando ocurren, sin que el frontend tenga que preguntar repetidamente. Esto reduce drasticamente el overhead de serializacion y la latencia.

#### Lista Completa de Events Planificados

| Evento | Origen | Payload | Proposito |
|--------|--------|---------|-----------|
| `git:status-changed` | Timer Tokio (polling cada 3s) | Lista de archivos con estado (modified/staged/untracked) | Actualizar sidebar derecha con cambios del worktree activo |
| `agent:status-changed` | Servidor de hooks HTTP | ID del agente, nuevo estado (working/waiting/blocked/done) | Actualizar badges e indicadores en sidebar izquierda |
| `pty:output:{id}` | PTY Manager | Bytes crudos del stdout del PTY | Alimentar xterm.js con output del terminal en tiempo real |
| `notification:agent-completed` | Modulo de notificaciones | ID del agente, worktree, timestamp | Disparar notificacion nativa del OS |
| `bridge:connection-changed` | Bridge server | Estado de conexion (connected/disconnected/error) | Actualizar indicador de bridge en la UI |
| `bridge:mobile-connected` | Bridge server | Info del dispositivo movil conectado | Mostrar confirmacion de conexion al usuario |

#### Patron de Emision desde Rust

```rust
use tauri::{AppHandle, Emitter};

// Emitir evento de cambio de estado git
fn emit_git_status(app: &AppHandle, worktree_id: &str, status: &GitStatus) {
    app.emit("git:status-changed", serde_json::json!({
        "worktreeId": worktree_id,
        "files": status.files,
        "ahead": status.ahead,
        "behind": status.behind,
    })).ok();
}

// Emitir output de PTY (alta frecuencia)
fn emit_pty_output(app: &AppHandle, pty_id: &str, data: &[u8]) {
    app.emit(&format!("pty:output:{}", pty_id), data).ok();
}
```

#### Patron de Recepcion en Svelte

```typescript
import { listen } from '@tauri-apps/api/event';
import { onMount, onDestroy } from 'svelte';

let unlisten: (() => void) | undefined;

onMount(async () => {
  unlisten = await listen('git:status-changed', (event) => {
    const payload = event.payload as GitStatusPayload;
    gitStatus = payload; // $state reactivo
  });
});

onDestroy(() => {
  unlisten?.();
});
```

### 2.3 Async con Tokio

Todas las operaciones del backend se ejecutan de forma asincrona con Tokio para no bloquear ni el hilo principal de Rust ni el frontend. Esta arquitectura es fundamental porque el ADE gestiona multiples PTYs, polling de git, y un servidor HTTP simultaneamente.

#### Operaciones Pesadas en Thread Pool Dedicado

Las operaciones de red (fetch, clone, push, pull) y operaciones git computacionalmente costosas se ejecutan en threads dedicados del pool de Tokio usando `tokio::task::spawn_blocking` o `tokio::spawn` con el runtime multi-thread:

```rust
// Fetch en thread dedicado para no bloquear el runtime principal
let result = tokio::task::spawn_blocking(move || {
    let repo = git2::Repository::open(&repo_path)?;
    let mut remote = repo.find_remote("origin")?;
    remote.fetch(&["main"], None, None)?;
    Ok::<_, git2::Error>(())
}).await??;
```

#### PTY I/O via Canales mpsc

La comunicacion entre los PTYs y el sistema de eventos de Tauri se gestiona con canales `tokio::sync::mpsc`. Cada PTY tiene un par de canales: uno para input (frontend -> PTY) y otro para output (PTY -> frontend):

```rust
use tokio::sync::mpsc;

// Canal para output del PTY (PTY -> frontend via Tauri events)
let (tx, mut rx) = mpsc::channel::<Vec<u8>>(256);

// Task que lee del PTY y envia al canal
tokio::spawn(async move {
    let mut buf = [0u8; 4096];
    loop {
        match pty_reader.read(&mut buf).await {
            Ok(n) if n > 0 => { tx.send(buf[..n].to_vec()).await.ok(); }
            _ => break,
        }
    }
});

// Task que recibe del canal y emite eventos Tauri
tokio::spawn(async move {
    while let Some(data) = rx.recv().await {
        app.emit(&format!("pty:output:{}", pty_id), &data).ok();
    }
});
```

#### Timer Intervals para Polling

El polling de git status usa `tokio::time::interval` con logica de coalescencia para evitar acumular requests si una operacion tarda mas que el intervalo:

```rust
use tokio::time::{interval, Duration};

let mut ticker = interval(Duration::from_secs(3));

loop {
    ticker.tick().await;

    // Si la ventana no es visible, pausar el polling
    if !window_visible.load(Ordering::Relaxed) {
        continue;
    }

    let status = compute_git_status(&repo_path).await;
    emit_git_status(&app, &worktree_id, &status);
}
```

#### Debounce para Persistencia

La persistencia de layout y estado usa un patron de debounce con Tokio para evitar escrituras excesivas a disco. Cada cambio reinicia un timer de 250ms; solo cuando el timer expira sin nuevos cambios se escribe:

```rust
use tokio::time::{sleep, Duration};
use tokio::sync::Notify;

let notify = Arc::new(Notify::new());

// Cada vez que el estado cambia, se notifica
notify.notify_one();

// Task de debounce
tokio::spawn(async move {
    loop {
        notify.notified().await;
        sleep(Duration::from_millis(250)).await;
        persist_state_to_disk(&state).await;
    }
});
```

### 2.4 Persistencia con Serde

El ADE persiste todo su estado usando Serde para serializacion/deserializacion type-safe a JSON. Esto garantiza que los structs de Rust se convierten directamente a JSON sin riesgo de campos `undefined` o tipos incorrectos, algo comun en soluciones basadas en JavaScript.

#### Structs Serializados a JSON

Cada pieza de estado tiene su struct con derive de `Serialize` y `Deserialize`:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AppData {
    pub version: u32,  // Para migraciones de esquema
    pub repos: Vec<RepoData>,
    pub settings: AppSettings,
    pub agent_cache: Vec<AgentStateEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoData {
    pub id: String,
    pub name: String,
    pub path: String,
    pub worktrees: Vec<WorktreeData>,
    pub is_git: bool, // false = carpeta plana (sin worktrees/branches); paneles git vacíos
}
```

#### Escritura Atomica: write-rename

Para evitar corrupcion de datos si la aplicacion se cierra durante una escritura, se usa el patron de escritura atomica: escribir a un archivo temporal y luego renombrarlo. Este patron es trivial en Rust con `std::fs::rename()`:

```rust
use std::fs;
use std::path::Path;

fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, data)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}
```

#### 5 Backups Rotativos

Antes de cada escritura atomica, el archivo actual se rota a un backup:

```rust
fn rotate_backups(path: &Path, max_backups: usize) -> std::io::Result<()> {
    // Rotar: .bak.4 -> .bak.5 (eliminado), .bak.3 -> .bak.4, etc.
    for i in (1..max_backups).rev() {
        let from = path.with_extension(format!("bak.{}", i));
        let to = path.with_extension(format!("bak.{}", i + 1));
        if from.exists() {
            fs::rename(&from, &to)?;
        }
    }
    // Archivo actual -> .bak.1
    if path.exists() {
        let backup = path.with_extension("bak.1");
        fs::copy(path, &backup)?;
    }
    Ok(())
}
```

#### Directorio de Datos de la Aplicacion

En Tauri 2, el directorio de datos de la aplicacion se obtiene via la API de paths:

```rust
fn get_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir()
        .expect("No se pudo obtener el directorio de datos de la app")
}
```

Esto resuelve a rutas especificas del OS:
- **Windows**: `%APPDATA%/dev.luisgamas.uxnandesktop/`
- **macOS**: `~/Library/Application Support/dev.luisgamas.uxnandesktop/`
- **Linux**: `~/.local/share/dev.luisgamas.uxnandesktop/`

#### Migraciones de Esquema

Cada archivo JSON incluye un campo `version`. Al cargar, se verifica la version y se ejecutan funciones de migracion secuencialmente si es necesario:

```rust
fn load_and_migrate(path: &Path) -> Result<AppData, Error> {
    let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let version = raw["version"].as_u64().unwrap_or(1) as u32;

    let migrated = match version {
        1 => migrate_v1_to_v2(raw)?,
        2 => migrate_v2_to_v3(raw)?,
        3 => raw, // Version actual, sin migracion
        _ => return Err(Error::UnsupportedVersion(version)),
    };

    Ok(serde_json::from_value(migrated)?)
}
```

### 2.5 Motor Git (git2 + CLI)

El ADE utiliza un motor dual para operaciones git: la crate `git2` (bindings de libgit2) para operaciones de alta frecuencia donde la velocidad importa, y git CLI como subproceso para operaciones que libgit2 no soporta completamente.

#### Operaciones via git2

`git2` se usa para operaciones que se ejecutan frecuentemente y donde evitar el overhead de crear un subproceso marca la diferencia:

- **Status**: `git2::Repository::statuses()` - Polling cada 3 segundos, seria costoso crear un subproceso cada vez
- **Diff**: `git2::Diff::index_to_workdir()` - Obtener hunks y lineas modificadas
- **Stage**: `git2::Index::add_path()` - Agregar archivos al area de staging
- **Unstage**: Manipulacion del index para revertir al estado de HEAD
- **Log**: `git2::Revwalk` - Recorrer el historial de commits
- **Branch ops**: Crear, listar y eliminar ramas locales
- **Commit**: `git2::Repository::commit()` - Crear commits con archivos staged

#### Operaciones via CLI

El CLI de git se usa cuando `git2` tiene limitaciones o no soporta la operacion:

- **Worktree add/remove/list**: libgit2 tiene soporte limitado para worktrees
- **Fetch**: Autenticacion compleja (SSH keys, credential helpers) es mas robusta con git CLI
- **Push**: Misma razon que fetch; ademas maneja push.autoSetupRemote
- **Operaciones avanzadas**: Rebase, cherry-pick, merge con estrategias

#### Ejecucion Async de CLI

Todos los comandos CLI se ejecutan via `tokio::process::Command` para no bloquear el runtime:

```rust
use tokio::process::Command;

async fn git_worktree_add(
    repo_path: &str,
    worktree_path: &str,
    branch: &str,
    base: &str,
) -> Result<(), GitError> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args([
            "worktree", "add",
            "--no-track",      // No heredar upstream de la base
            "-b", branch,      // Crear nueva rama
            worktree_path,     // Ruta del worktree
            base,              // Rama base
        ])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::CommandFailed(stderr.to_string()));
    }

    Ok(())
}
```

#### Deteccion de WSL

Para repositorios ubicados en WSL desde Windows, el ADE detecta rutas UNC y enruta los comandos a traves de `wsl.exe`:

```rust
fn is_wsl_path(path: &str) -> bool {
    path.starts_with("\\\\wsl.localhost\\") || path.starts_with("\\\\wsl$\\")
}

async fn git_command(repo_path: &str, args: &[&str]) -> Result<Output, GitError> {
    if is_wsl_path(repo_path) {
        // Convertir ruta UNC a ruta Linux dentro de WSL
        let linux_path = convert_unc_to_wsl_path(repo_path);
        Command::new("wsl.exe")
            .args(["git", "-C", &linux_path])
            .args(args)
            .output()
            .await
            .map_err(GitError::from)
    } else {
        Command::new("git")
            .current_dir(repo_path)
            .args(args)
            .output()
            .await
            .map_err(GitError::from)
    }
}
```

#### Reintentos con Backoff Exponencial

Las operaciones de red (fetch, push, pull) implementan reintentos con espera exponencial para manejar errores transitorios:

```rust
async fn retry_with_backoff<F, Fut, T, E>(
    max_retries: u32,
    operation: F,
) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut delay = Duration::from_millis(500);

    for attempt in 0..max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) if attempt < max_retries - 1 => {
                eprintln!("Intento {} fallido: {}. Reintentando en {:?}...",
                    attempt + 1, e, delay);
                tokio::time::sleep(delay).await;
                delay *= 2; // Backoff exponencial
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}
```

#### Proteccion de Idempotencia

Las operaciones mutativas **no se reintentan** para evitar duplicados. Esto aplica a push (que podria crear ramas remotas duplicadas), delete de ramas remotas, y cualquier operacion que modifique estado remoto de forma no idempotente:

```rust
// Fetch: SI se reintenta (es idempotente, solo lee)
let status = retry_with_backoff(3, || git_fetch(&repo_path)).await?;

// Push: NO se reintenta (podria duplicar commits en ciertos escenarios)
let status = git_push(&repo_path).await?;
```

---

## 3. Patrones de Frontend Svelte 5

### 3.1 Estado Reactivo ($state y $derived)

Svelte 5 introduce Runes (`$state`, `$derived`, `$effect`) que reemplazan los stores de Svelte 4 y eliminan la necesidad de librerias externas de estado como Zustand, Redux, Jotai o similares. Todo el estado de la aplicacion se gestiona con estas primitivas nativas.

#### $state para Estado Mutable

`$state` se usa para todo dato que puede cambiar durante la vida de la aplicacion:

```typescript
// Estado global de la aplicacion (en un modulo .svelte.ts)
export let repos = $state<Repo[]>([]);
export let worktrees = $state<Worktree[]>([]);
export let activeWorktreeId = $state<string | null>(null);
export let agentStates = $state<Map<string, AgentState>>(new Map());
export let gitStatusByWorktree = $state<Map<string, GitStatus>>(new Map());
export let uiState = $state({
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftSidebarWidth: 280,
  rightSidebarWidth: 350,
});
```

#### $derived para Datos Computados

`$derived` crea valores calculados que se actualizan automaticamente cuando sus dependencias cambian. No hay necesidad de `useMemo`, `computed()`, o selectores manuales:

```typescript
// Worktrees del repositorio activo, filtrados y ordenados
let activeWorktrees = $derived(
  worktrees
    .filter(wt => wt.repoId === activeRepoId)
    .sort((a, b) => b.lastActivity - a.lastActivity)
);

// Conteo de agentes por estado
let agentCounts = $derived({
  working: [...agentStates.values()].filter(a => a.status === 'working').length,
  waiting: [...agentStates.values()].filter(a => a.status === 'waiting').length,
  done: [...agentStates.values()].filter(a => a.status === 'done').length,
});

// Archivos agrupados por area (Changes, Staged, Untracked)
let groupedFiles = $derived({
  staged: currentGitStatus?.files.filter(f => f.staged) ?? [],
  unstaged: currentGitStatus?.files.filter(f => !f.staged && f.tracked) ?? [],
  untracked: currentGitStatus?.files.filter(f => !f.tracked) ?? [],
});
```

#### Ventaja: No se Necesitan Librerias Externas

Con `$state` y `$derived`, Svelte 5 cubre todos los casos de uso de estado que normalmente requeririan Zustand, Redux, Pinia, o similares en otros frameworks. El estado es granular y reactivo por defecto, sin boilerplate de actions, reducers, o subscriptions explicitas.

### 3.2 Integracion con Tauri

La comunicacion entre el frontend Svelte y el backend Rust usa dos mecanismos de Tauri: `invoke()` para request/response y `listen()` para eventos de streaming.

#### invoke() para Request/Response

Se usa cuando el frontend necesita solicitar una accion al backend y esperar el resultado:

```typescript
import { invoke } from '@tauri-apps/api/core';

// Crear worktree
async function createWorktree(repoId: string, branch: string) {
  try {
    const worktree = await invoke<WorktreeInfo>('worktree_create', {
      repoId,
      branchName: branch,
      baseBranch: 'main',
    });
    worktrees.push(worktree);
  } catch (error) {
    handleError(error as CommandError);
  }
}

// Escribir al PTY (alta frecuencia, pero sigue siendo request/response)
async function writeToTerminal(ptyId: string, data: string) {
  await invoke('pty_write', { ptyId, data });
}
```

#### listen() para Suscripciones a Eventos

Se usa para datos que fluyen continuamente del backend al frontend. El patron clave es suscribirse en `onMount` y desuscribirse en `onDestroy`:

```svelte
<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { onMount, onDestroy } from 'svelte';

  let unlisteners: (() => void)[] = [];

  onMount(async () => {
    // Suscribirse a cambios de estado git
    const u1 = await listen<GitStatusPayload>('git:status-changed', (event) => {
      gitStatusByWorktree.set(event.payload.worktreeId, event.payload);
    });

    // Suscribirse a cambios de estado de agentes
    const u2 = await listen<AgentStatusPayload>('agent:status-changed', (event) => {
      agentStates.set(event.payload.agentId, event.payload);
    });

    unlisteners = [u1, u2];
  });

  onDestroy(() => {
    unlisteners.forEach(fn => fn());
  });
</script>
```

#### Type Safety: Interfaces TypeScript que Reflejan Structs de Rust

Para mantener consistencia entre backend y frontend, las interfaces TypeScript deben reflejar exactamente los structs de Rust:

```typescript
// Espejo de los structs Rust en el frontend
interface WorktreeInfo {
  id: string;
  name: string;
  branch: string;
  path: string;
  createdAt: number; // camelCase en TS, snake_case en Rust (Serde rename)
}

interface GitStatusPayload {
  worktreeId: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

interface AgentStatusPayload {
  agentId: string;
  status: 'working' | 'waiting' | 'blocked' | 'done';
  worktreeId: string;
  timestamp: number;
}
```

### 3.3 Componentes UI (shadcn-svelte)

shadcn-svelte sigue un modelo de "copy-what-you-use": en lugar de instalar una libreria completa, se copian solo los componentes que se necesitan al proyecto. Esto mantiene el bundle ligero y permite personalizar cada componente sin restricciones.

#### Componentes Base del ADE

Los componentes de shadcn-svelte que el ADE utiliza como base:

- **Button** - Acciones primarias y secundarias en toda la UI
- **Dialog** - Modales para creacion de worktrees, confirmaciones, configuracion
- **Sidebar** - Estructura de la barra lateral izquierda con secciones colapsables
- **Tabs** - Barras de tabs en el area central (terminales) y sidebar derecha (diffs)
- **Tooltip** - Informacion contextual en iconos y badges compactos
- **Sheet** - Paneles deslizantes para configuracion y detalles extendidos

#### Accesibilidad

Todos los componentes de shadcn-svelte estan construidos sobre **Bits UI** (el equivalente de Radix UI para Svelte). Esto proporciona accesibilidad integrada de forma predeterminada:

- Navegacion por teclado completa
- Roles ARIA correctos
- Focus management automatico
- Screen reader support

#### Soporte de Dark Mode

El tema oscuro se implementa via la clase `dark` de Tailwind CSS:

```svelte
<!-- El tema se aplica a nivel de documento -->
<html class="dark">
  <!-- Todos los componentes respetan dark: automáticamente -->
</html>
```

Los componentes de shadcn-svelte ya incluyen variantes `dark:` en sus estilos. Para componentes personalizados, se sigue el mismo patron:

```svelte
<div class="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
  <!-- Contenido adaptable al tema -->
</div>
```

### 3.4 Terminal Rendering (xterm.js)

xterm.js es el emulador de terminal que corre dentro del webview de Tauri. Renderiza la salida del PTY en un canvas con soporte de aceleracion GPU.

#### Renderizado Canvas/WebGL en Componente Svelte

El componente de terminal encapsula xterm.js y gestiona su ciclo de vida:

```svelte
<script lang="ts">
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount, onDestroy } from 'svelte';

  let { ptyId }: { ptyId: string } = $props();
  let terminalEl: HTMLDivElement;
  let term: Terminal;

  onMount(async () => {
    term = new Terminal({ cursorBlink: true, fontSize: 14 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalEl);

    // GPU-accelerated rendering
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // Fallback a canvas renderer si WebGL no disponible
    }

    fitAddon.fit();

    // Input: usuario -> backend Rust -> PTY stdin
    term.onData((data) => {
      invoke('pty_write', { ptyId, data });
    });

    // Output: PTY stdout -> backend Rust -> xterm.js
    const unlisten = await listen<Uint8Array>(`pty:output:${ptyId}`, (event) => {
      term.write(event.payload);
    });

    // Cleanup
    return () => {
      unlisten();
      term.dispose();
    };
  });
</script>

<div bind:this={terminalEl} class="h-full w-full"></div>
```

#### Flujo de Datos Bidireccional

El flujo de datos entre xterm.js y el PTY pasa siempre por el backend Rust:

1. **Input (usuario -> PTY)**: Evento de teclado en xterm.js -> `invoke('pty_write', { ptyId, data })` -> Backend Rust escribe al stdin del PTY
2. **Output (PTY -> usuario)**: PTY produce stdout -> Backend Rust emite `pty:output:{id}` -> xterm.js recibe via `listen()` y renderiza

#### Addon: xterm-addon-fit

`xterm-addon-fit` recalcula automaticamente las dimensiones del terminal (columnas y filas) cuando el contenedor cambia de tamano. Al redimensionar, se notifica al backend para que ajuste el PTY:

```typescript
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// Al redimensionar el contenedor
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  invoke('pty_resize', {
    ptyId,
    cols: term.cols,
    rows: term.rows,
  });
});
resizeObserver.observe(terminalEl);
```

#### Addon: xterm-addon-webgl

`xterm-addon-webgl` usa WebGL para renderizar el terminal con aceleracion GPU. Esto mejora significativamente el rendimiento cuando hay output rapido y continuo (compilaciones, logs de agentes, etc.). Se carga con fallback al renderer canvas estandar si WebGL no esta disponible.

#### Addon Personalizado: Deteccion de Estado de Agente

Un addon personalizado parsea secuencias OSC (Operating System Command) en el stream de output para detectar el estado del agente. Los agentes que soportan el protocolo emiten secuencias como `\x1b]633;A;working\x07` para reportar su estado:

```typescript
class AgentStateAddon {
  private _disposables: IDisposable[] = [];

  activate(terminal: Terminal): void {
    // Interceptar secuencias OSC del agente
    this._disposables.push(
      terminal.parser.registerOscHandler(633, (data) => {
        const parts = data.split(';');
        if (parts[0] === 'A') {
          const status = parts[1]; // 'working', 'waiting', 'done', etc.
          onAgentStateChange(status);
        }
        return true;
      })
    );
  }

  dispose(): void {
    this._disposables.forEach(d => d.dispose());
  }
}
```

### 3.5 Diff Rendering (CodeMirror 6)

CodeMirror 6 se usa como motor de renderizado de diffs en lugar de Monaco Editor. La diferencia de tamano es significativa: ~300KB para CodeMirror 6 vs ~5MB para Monaco, una reduccion de ~4.7MB en el bundle.

#### Por que CodeMirror 6 y no Monaco

- **Tamano del bundle**: ~300KB vs ~5MB (Monaco incluye un editor completo tipo VS Code)
- **Arquitectura extensible**: Sistema de extensiones modular y composable
- **Rendimiento**: Renderizado incremental, ideal para documentos grandes
- **Ligero**: No incluye funcionalidades innecesarias para un visor de diffs (autocompletado, debugging, etc.)

#### Vista Side-by-Side con Dos Instancias

Para el modo lado a lado, se usan dos instancias de CodeMirror sincronizadas:

```svelte
<script lang="ts">
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';

  let leftEditor: HTMLDivElement;
  let rightEditor: HTMLDivElement;

  onMount(() => {
    const leftView = new EditorView({
      state: EditorState.create({
        doc: originalContent,
        extensions: [diffHighlighting('removed'), readOnly()],
      }),
      parent: leftEditor,
    });

    const rightView = new EditorView({
      state: EditorState.create({
        doc: modifiedContent,
        extensions: [diffHighlighting('added'), readOnly()],
      }),
      parent: rightEditor,
    });

    // Sincronizar scroll entre ambos paneles
    syncScroll(leftView, rightView);
  });
</script>

<div class="flex h-full">
  <div bind:this={leftEditor} class="flex-1 border-r" />
  <div bind:this={rightEditor} class="flex-1" />
</div>
```

#### Sincronizacion de Scroll entre Paneles

Para que ambos lados del diff se desplacen al unisono:

```typescript
function syncScroll(left: EditorView, right: EditorView) {
  let syncing = false;

  const syncFrom = (source: EditorView, target: EditorView) => {
    if (syncing) return;
    syncing = true;
    const scrollTop = source.scrollDOM.scrollTop;
    target.scrollDOM.scrollTop = scrollTop;
    syncing = false;
  };

  left.scrollDOM.addEventListener('scroll', () => syncFrom(left, right));
  right.scrollDOM.addEventListener('scroll', () => syncFrom(right, left));
}
```

#### Virtual Scrolling para Diffs Grandes

Para changesets con cientos de archivos, los diffs se renderizan bajo demanda usando virtual scrolling (TanStack Virtual). Solo los diffs visibles en la pantalla se calculan y renderizan. Al hacer scroll, los diffs que salen de vista se desmontan y los nuevos se cargan:

```svelte
<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';

  let parentRef: HTMLDivElement;

  const virtualizer = createVirtualizer({
    count: diffFiles.length,
    getScrollElement: () => parentRef,
    estimateSize: () => 200, // Altura estimada por archivo
    overscan: 3, // Pre-renderizar 3 elementos extra
  });
</script>

<div bind:this={parentRef} class="h-full overflow-auto">
  <div style="height: {$virtualizer.getTotalSize()}px; position: relative;">
    {#each $virtualizer.getVirtualItems() as item}
      <div style="position: absolute; top: {item.start}px; width: 100%;">
        <DiffFileViewer file={diffFiles[item.index]} />
      </div>
    {/each}
  </div>
</div>
```

---

## 4. Seguridad

### 4.1 Almacenamiento de Credenciales

Las credenciales y secretos nunca se almacenan en texto plano dentro de los archivos JSON de persistencia. El ADE ofrece dos mecanismos de almacenamiento seguro:

#### tauri-plugin-stronghold

Stronghold es una libreria de almacenamiento encriptado desarrollada por IOTA Foundation, integrada como plugin de Tauri. Proporciona una boveda encriptada para guardar API keys, tokens de autenticacion y cualquier secreto:

```rust
use tauri_plugin_stronghold::Stronghold;

// Guardar un secreto
async fn store_secret(stronghold: &Stronghold, key: &str, value: &[u8]) {
    stronghold
        .get_store("secrets")
        .insert(key.as_bytes().to_vec(), value.to_vec())
        .await
        .expect("Error al guardar secreto en Stronghold");
}

// Recuperar un secreto
async fn get_secret(stronghold: &Stronghold, key: &str) -> Option<Vec<u8>> {
    stronghold
        .get_store("secrets")
        .get(key.as_bytes())
        .await
        .ok()
        .flatten()
}
```

#### Keychain del OS via keyring

Como alternativa o complemento, la crate `keyring` permite usar el keychain nativo del sistema operativo (Windows Credential Manager, macOS Keychain, Linux Secret Service):

```rust
use keyring::Entry;

fn store_in_os_keychain(service: &str, user: &str, secret: &str) -> Result<(), keyring::Error> {
    let entry = Entry::new(service, user)?;
    entry.set_password(secret)?;
    Ok(())
}

fn get_from_os_keychain(service: &str, user: &str) -> Result<String, keyring::Error> {
    let entry = Entry::new(service, user)?;
    entry.get_password()
}
```

#### Regla Fundamental

**API keys, tokens, y secretos NUNCA se almacenan en archivos JSON planos.** La persistencia general del ADE (repos, worktrees, layout, preferencias) se guarda en JSON via Serde, pero cualquier dato sensible pasa obligatoriamente por Stronghold o el keychain del OS.

#### Bridge Embebido

Las claves de encriptacion end-to-end (E2EE) del bridge movil se mantienen dentro del proceso del bridge, no se exponen al backend general de Rust. Esto asegura que incluso si otro componente del ADE se ve comprometido, las claves del bridge permanecen aisladas.

### 4.2 Tauri Permissions

Tauri 2 introduce un modelo de seguridad basado en **capabilities** (capacidades explicitas). A diferencia de Electron donde todo esta permitido por defecto, en Tauri 2 cada permiso debe declararse explicitamente.

#### Permisos Explicitos por Capability

Solo los Tauri commands necesarios se exponen al frontend. Cada command debe estar listado en el archivo de capacidades:

```json
{
  "identifier": "main-window",
  "description": "Permisos para la ventana principal del ADE",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "notification:default",
    "stronghold:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        { "name": "git", "cmd": "git", "args": true }
      ]
    }
  ]
}
```

#### Restricciones de Acceso

- **No hay acceso arbitrario al filesystem desde el frontend**: El frontend solo puede leer/escribir archivos a traves de los Tauri commands definidos, no directamente.
- **Solo los commands registrados son accesibles**: Intentar invocar un command no registrado genera un error.
- **Acceso de red limitado**: El frontend solo puede comunicarse con localhost (servidor de hooks) y la URL del relay configurada para el bridge. No puede hacer requests arbitrarios a internet.

### 4.3 Procesos de Agente

Los agentes CLI corren dentro de pseudoterminales gestionados por el backend Rust. Esto proporciona aislamiento a nivel de OS:

- **Sandboxed en PTYs**: Cada agente corre en su propio proceso PTY independiente, con su propio filesystem view (el directorio del worktree). El aislamiento lo proporciona el OS, no el ADE.
- **Sin acceso directo desde el frontend**: El frontend no puede comunicarse directamente con los procesos de agente. Toda interaccion pasa por el backend Rust que actua como mediador.
- **Mediacion del backend**: El backend Rust controla que datos fluyen entre el frontend y los PTYs. Puede interceptar, filtrar o transformar datos si es necesario.

---

## 5. CI/CD y Distribucion

### 5.1 Build

#### Comando de Build de Produccion

El build se ejecuta con el CLI de Tauri:

```bash
cargo tauri build
```

Este comando compila el backend Rust en modo release, empaqueta el frontend Svelte (via Vite), y genera el instalador nativo para la plataforma actual.

#### Targets por Plataforma

| Plataforma | Formatos de Instalador | Notas |
|------------|----------------------|-------|
| **Windows** | `.msi`, `.exe` (NSIS) | Requiere NSIS para el instalador .exe |
| **macOS** | `.dmg`, `.app` | Requiere Xcode Command Line Tools |
| **Linux** | `.deb`, `.AppImage`, `.rpm` | AppImage es el mas portable |

#### Code Signing

Cada plataforma tiene requisitos especificos de firma de codigo:

- **Windows**: Certificado de firma de codigo (EV o standard) via SignTool. Necesario para evitar advertencias de SmartScreen.
- **macOS**: Apple Developer ID. Notarizacion obligatoria desde macOS 10.15+.
- **Linux**: Firma GPG opcional pero recomendada para paquetes .deb/.rpm.

### 5.2 Actualizaciones

#### Tauri Updater Plugin

Tauri incluye un plugin de actualizaciones automaticas que gestiona el ciclo completo:

```rust
// En la configuracion de Tauri (tauri.conf.json)
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://releases.uxnan.com/desktop/{{target}}/{{arch}}/{{current_version}}"
      ],
      "dialog": true,
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    }
  }
}
```

#### Frecuencia de Verificacion

- **Al iniciar**: Se verifica si hay una nueva version disponible.
- **Periodicamente**: Verificacion cada 6-12 horas mientras la app esta abierta.
- **Manual**: El usuario puede forzar una verificacion desde el menu de configuracion.

#### Versionado del Bridge

El sidecar del bridge movil se versiona junto con la aplicacion de escritorio. Cuando el desktop se actualiza, el bridge se actualiza automaticamente para mantener compatibilidad de protocolos.

### 5.3 Testing

#### Rust: Unit Tests

Los tests unitarios de Rust validan la logica del backend de forma aislada:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_resolve_base_branch_prefers_origin_head() {
        // ...
    }

    #[test]
    fn test_atomic_write_survives_crash() {
        // ...
    }

    #[test]
    fn test_schema_migration_v1_to_v2() {
        // ...
    }
}
```

Se ejecutan con:

```bash
cargo test
```

#### Svelte: Component Tests con Vitest

Los componentes de Svelte se testean con Vitest, que se integra nativamente con Vite:

```typescript
import { render, screen } from '@testing-library/svelte';
import WorktreeCard from './WorktreeCard.svelte';

test('muestra badge de agente activo', () => {
  render(WorktreeCard, {
    props: {
      worktree: { name: 'feature-x', branch: 'feature/x' },
      agentState: { status: 'working' },
    },
  });
  expect(screen.getByTestId('agent-badge')).toHaveClass('animate-pulse');
});
```

#### E2E: Playwright o WebdriverIO

Los tests end-to-end validan flujos completos de la aplicacion, incluyendo la comunicacion entre frontend y backend:

```typescript
import { test, expect } from '@playwright/test';

test('crear worktree y lanzar terminal', async ({ page }) => {
  // Abrir dialogo de crear worktree
  await page.click('[data-testid="create-worktree-btn"]');

  // Llenar formulario
  await page.fill('[data-testid="branch-name"]', 'feature/nueva');
  await page.selectOption('[data-testid="base-branch"]', 'main');
  await page.click('[data-testid="confirm-create"]');

  // Verificar que aparece en la sidebar
  await expect(page.locator('[data-testid="worktree-card"]'))
    .toContainText('feature/nueva');

  // Verificar que se abrio un terminal
  await expect(page.locator('.xterm-screen')).toBeVisible();
});
```

#### Integracion: Round-Trip de Commands/Events

Tests de integracion que validan el ciclo completo de Tauri commands y events, asegurando que los structs de Rust se serializan/deserializan correctamente en el frontend:

```rust
#[cfg(test)]
mod integration_tests {
    #[tokio::test]
    async fn test_worktree_create_command_roundtrip() {
        let app = create_test_app().await;
        let result: WorktreeInfo = app
            .invoke("worktree_create", json!({
                "repoId": "test-repo",
                "branchName": "test-branch",
                "baseBranch": "main",
            }))
            .await
            .unwrap();

        assert_eq!(result.branch, "test-branch");
        assert!(!result.id.is_empty());
    }
}
```

---

## 6. Rendimiento

### 6.1 Comparacion con Electron

La eleccion de Tauri 2 + Rust sobre Electron se justifica por diferencias significativas en consumo de recursos:

| Metrica | Electron (referencia) | Tauri 2 + Rust |
|---------|----------------------|----------------|
| **RAM en reposo** | 200-500 MB | 30-100 MB |
| **Tamano del instalador** | 150-300 MB | 5-15 MB |
| **Tiempo de arranque** | 2-5 segundos | <1 segundo |
| **Bundled runtime** | Chromium + Node.js completos | Webview del OS (ya instalado) |
| **Seguridad** | Todo permitido por defecto | Permisos explicitos por capability |
| **Overhead de IPC** | JSON serialization sobre IPC channel | Tauri commands con serializacion Serde (mas rapido) |

La diferencia en RAM es especialmente critica para un ADE donde el usuario tiene multiples PTYs, polling de git, un servidor HTTP de hooks y un visor de diffs corriendo simultaneamente. Cada MB de overhead del framework es un MB menos disponible para los procesos de agentes.

### 6.2 Optimizaciones Clave

Las siguientes optimizaciones se implementan para mantener el ADE responsivo incluso con muchos agentes y worktrees activos:

#### Polling Inteligente de Git Status

El polling de `git status` cada 3 segundos se **pausa automaticamente** cuando la ventana del ADE no es visible. Esto evita consumo innecesario de CPU cuando el usuario esta trabajando en otra aplicacion:

```rust
// El timer de polling verifica visibilidad antes de ejecutar
if !window_visible.load(Ordering::Relaxed) {
    continue; // Saltar este ciclo de polling
}
```

Al volver a enfocar la ventana, se ejecuta inmediatamente un ciclo de polling para actualizar el estado.

#### Buffers de Terminal Limitados

Los terminales ocultos (en tabs no activos) acumulan output en un buffer limitado de **2MB por terminal oculto**. Si el buffer se llena, los datos mas antiguos se descartan. Esto previene que terminales con output rapido y continuo (compilaciones, logs) consuman memoria indefinidamente:

```rust
const MAX_HIDDEN_BUFFER: usize = 2 * 1024 * 1024; // 2MB

struct PtyBuffer {
    data: VecDeque<u8>,
    max_size: usize,
}

impl PtyBuffer {
    fn push(&mut self, chunk: &[u8]) {
        self.data.extend(chunk);
        while self.data.len() > self.max_size {
            // Eliminar datos antiguos en bloques de 4KB
            self.data.drain(..4096);
        }
    }
}
```

#### Virtual Scroll en Sidebar y Diff Viewer

Tanto la lista de worktrees en la sidebar como la lista de archivos en el diff viewer usan **TanStack Virtual** para scroll virtual. Solo se renderizan los elementos visibles en pantalla, permitiendo manejar cientos de worktrees o archivos sin degradar el rendimiento.

#### Carga Lazy de Diffs por Archivo

Los diffs no se calculan para todos los archivos modificados al abrir el panel de cambios. Solo se calcula el diff del archivo que el usuario selecciona para ver. Esto es critico cuando un agente modifica 50+ archivos: calcular todos los diffs de golpe bloquearia la UI.

#### Persistencia con Debounce

Las escrituras a disco se agrupan con un debounce de **250ms** (timer Tokio). Cambios rapidos consecutivos (ej: el usuario redimensiona splits repetidamente) solo generan una escritura al final, no una por cada cambio.

#### CodeMirror 6 en vez de Monaco

La eleccion de CodeMirror 6 sobre Monaco para el visor de diffs ahorra **~4.7MB de bundle** (~300KB vs ~5MB). Esto reduce el tiempo de carga inicial de la aplicacion y el uso de memoria del webview. CodeMirror 6 proporciona todas las funcionalidades necesarias para un visor de diffs (syntax highlighting, line numbers, extensiones de diff, scroll sync) sin el peso de un editor completo tipo VS Code.

---

> **Nota**: Este documento detalla los patrones de implementacion. Para la arquitectura de alto nivel y las decisiones de diseno, consultar `architect-desktop.md`. Para las estructuras de datos y modelos, consultar `02-data-models.md`.
