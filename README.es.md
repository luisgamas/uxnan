# Uxnan

![Status](https://img.shields.io/badge/STATUS-ALPHA-orange?style=for-the-badge)
![Monorepo](https://img.shields.io/badge/MONOREPO-5_PROYECTOS-blue?style=for-the-badge)
![E2EE](https://img.shields.io/badge/E2EE-AES--256--GCM-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)
![Platforms](https://img.shields.io/badge/PLATAFORMAS-Android_%7C_iOS_%7C_Windows_%7C_macOS_%7C_Linux-lightgrey?style=for-the-badge)

> [Read in English](README.md)

Uxnan (pronunciado /uʃ.nan/) es un ecosistema de herramientas que construyo para resolver un problema muy concreto que tengo como desarrollador: **controlar agentes de codificación con IA desde cualquier lugar, sin que mi hardware se convierta en un cuello de botella.**

## Por qué existe este proyecto

Trabajo con agentes de codificación CLI (Claude Code, Codex CLI, OpenCode, Gemini CLI, pi-agent) todos los días. Son herramientas extraordinarias, pero el flujo de trabajo actual tiene fricciones reales:

- **Cuando me alejo de la PC**, pierdo visibilidad total sobre lo que el agente está haciendo. No puedo revisar su progreso, aprobar cambios o enviar nuevas instrucciones desde el teléfono.
- **Las soluciones de escritorio existentes son excelentes**, pero muchas asumen hardware de gama alta. En mi setup actual, correr un IDE pesado + múltiples agentes + un entorno Electron consume más recursos de los que puedo permitirme.
- **No existe una herramienta móvil agnóstica a proveedor** que funcione con cualquier agente, no solo con uno en particular.

Uxnan nace para resolver exactamente eso. No es un agente — es el **plano de control** para los agentes que ya uso.

## Qué hace cada componente

### `uxnanmobile/` — App Móvil (Flutter, Android + iOS)

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

App Flutter que funciona como control remoto de los agentes corriendo en mi PC. Desde el teléfono puedo ver conversaciones en tiempo real, enviar instrucciones, adjuntar imágenes, dictar por voz, hacer commit+push, revisar diffs y recibir notificaciones cuando un agente termina una tarea.

La conexión es E2EE real y es **bridge-first**: el teléfono prueba primero las direcciones directas LAN/Tailscale del bridge, y cae al relay self-hosted solo para acceso fuera de la LAN. El relay, cuando se usa, solo ve envelopes E2EE opacos.

> Especificación técnica completa: [`architecture/`](architecture/00-index.md)

### `uxnandesktop/` — App de Escritorio (ADE, Tauri 2 + Rust + Svelte 5)

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=000000)
![Svelte](https://img.shields.io/badge/Svelte_5-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=white)

Un **Agent Development Environment** ligero construido con Tauri 2, Rust y Svelte 5. A diferencia de las alternativas basadas en Electron que consumen 200-500 MB de RAM solo por existir, este ADE usa el webview nativo del OS y apunta a 30-100 MB de RAM.

La idea central: cada tarea vive en su propio git worktree con su propio agente corriendo en un pseudoterminal independiente. Puedo tener 5 agentes trabajando en paralelo sin que uno bloquee a otro, cambiar entre ellos con un click (sin `git stash`, sin `git checkout`), y revisar los cambios de cada uno en un visor de diffs integrado (CodeMirror 6, unificado + lado a lado, staging por hunk) antes de hacer commit.

No integra el SDK de ningún agente. Es terminal-centrico: cualquier agente CLI funciona sin modificación. **Las Fases 0-5 + la pista cross-cutting (S) están completas** — el ADE es alpha-funcional como app standalone. La única fase restante es la **Fase 6 (bridge embebido / pairing móvil)**, que es *opcional para uso standalone*.

> Especificación técnica completa: [`uxnandesktop/architecture/`](uxnandesktop/architecture/00-index.md)

### `bridge/` — Daemon Bridge (Node.js, corre en la PC)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JSON RPC](https://img.shields.io/badge/JSON--RPC_2.0-000000?style=for-the-badge&logo=json&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)

El **daemon de plano de control local** que conecta la app móvil con los agentes locales. Implementa el lado bridge del protocolo E2EE (X25519 + HKDF + Ed25519 + AES-256-GCM), lanza el **CLI local oficial** de cada agente sobre stdio (sin API / SDK / keys de proveedor), y expone una interfaz JSON-RPC unificada (59 métodos + 8 notificaciones de streaming) hacia el teléfono.

Funciona en dos modos:
- **Standalone** (por defecto): se instala por separado para quienes solo quieren el control remoto desde el móvil sin instalar la app de escritorio.
- **Embebido**: la app de escritorio lo integra como proceso hijo (Fase 6 de `uxnandesktop/`, *opcional para standalone*).

**Agentes reales cableados:** OpenCode, Claude Code, Codex, pi, Gemini CLI. Cada uno corre el CLI oficial en el `cwd` del thread con `shell:false`; el bridge parsea su formato nativo de stream y emite eventos estructurados `stream/content/block` (comando / diff / tool) más `stream/thinking/delta` (razonamiento). **Aider** es el único que no está cableado todavía (receta en `bridge/FOR-DEV.md`).

> Especificación del bridge: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (sección 5.8)
> Integración con desktop: [`uxnandesktop/architecture/02e-bridge-integration.md`](uxnandesktop/architecture/02e-bridge-integration.md)

### `relay/` — Servidor Relay (Node.js, **opcional / self-hosted**)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![E2EE](https://img.shields.io/badge/E2EE_OPACO-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)

Relay WebSocket stateless que reenvía **envelopes E2EE opacos** entre el teléfono y el bridge cuando no están en la misma red LAN/Tailscale. Solo ve frames cifrados — nunca plaintext, keys, código ni diffs.

El relay es ahora **opcional y self-hosted**: las rutas primarias del producto son **LAN-direct** y **Tailscale-direct** (cero hosting, cero credenciales). El relay es el fallback off-LAN hospedado para quien quiera correr el suyo. Las notificaciones push las envía **el bridge directamente** (FCM HTTP v1, `firebase-admin` lazy) y funcionan sobre cualquier transporte; los endpoints `/push/*` del relay quedan como fallback hospedado.

> Especificación del relay: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (sección 5.10)

### `shared/` — Contratos Compartidos (TypeScript, ESM, Node ≥18)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![JSON Schema](https://img.shields.io/badge/JSON_Schema-000000?style=for-the-badge&logo=json&logoColor=white)

La única fuente de verdad para los **contratos JSON-RPC + E2EE** que consumen el bridge y el relay (la app móvil mantiene equivalentes Dart sincronizados a mano). Exports autoritativos:

- **JSON-RPC**: tipos de envelope + constructores, códigos de error (`-32000..-32008` + estándar), registro de métodos tipado (locked en build-time contra `METHOD_NAMES`).
- **E2EE**: mensajes de handshake, transcript builder, `SecureEnvelope`, `PairingPayload` v2 (con `hosts: string[]` para direccionamiento directo).
- **Modelos de dominio** (thread/turn/message, git, workspace, project, auth, session, approval) y **contratos de agente** (`IAgentAdapter`, `AgentCapabilities`, `AgentConfig`).
- **Validación**: validadores basados en Ajv para requests, responses, envelopes E2EE, payloads de pairing y payloads de push.

> Contratos JSON-RPC: [`architecture/02b-contracts-and-requirements.md`](architecture/02b-contracts-and-requirements.md) (sección 1)

## Stack

| Componente | Tecnología |
|---|---|
| App móvil | Flutter / Dart, Riverpod 3.x (manual), Material Design 3 (+ Neural Expressive), drift (SQLite) |
| App desktop | Rust, Tauri 2, Svelte 5 (Runes), shadcn-svelte, Tailwind v4, xterm.js, CodeMirror 6 |
| Bridge | Node.js (TypeScript, ESM, Node ≥18) |
| Relay | Node.js (TypeScript, ESM, Node ≥18) — opcional / self-hosted |
| Contratos compartidos | TypeScript (ESM, Node ≥18), validadores Ajv |
| Seguridad | X25519 + Ed25519 + AES-256-GCM + HKDF-SHA256 |

## Seguridad

![X25519](https://img.shields.io/badge/X25519-Intercambio_de_Claves-2ea44f?style=for-the-badge)
![Ed25519](https://img.shields.io/badge/Ed25519-Firmas-2ea44f?style=for-the-badge)
![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-Cifrado-2ea44f?style=for-the-badge)
![HKDF-SHA256](https://img.shields.io/badge/HKDF--SHA256-Derivación_de_Claves-2ea44f?style=for-the-badge)

Toda la comunicación entre la app móvil y la PC pasa por un canal E2EE real. El relay, cuando se usa, es solo transporte y nunca ve texto plano. Las claves de sesión se derivan mediante intercambio de claves efímeras X25519, autenticadas con firmas de identidad Ed25519, y usadas para cifrado simétrico AES-256-GCM. Los payloads del bridge están sanitizados: `auth/status` es per-agente, nunca devuelve tokens y detecta el login solo por la existencia de archivos de auth conocidos.

## Estado actual

![Phase](https://img.shields.io/badge/PHASE-ALPHA_(MVP_en_progreso)-orange?style=for-the-badge)

El MVP móvil corre end-to-end contra el bridge con **5 agentes reales** (OpenCode, Claude Code, Codex, pi, Gemini CLI). El ADE de escritorio es alpha-funcional como app standalone. Estado por componente:

| Componente | Estado |
|---|---|
| `uxnanmobile/` | **MVP cableado (Android alpha-ready).** Pairing QR + por código manual + trusted reconnect, transporte E2EE (LAN/Tailscale-direct + fallback relay), conversación en streaming con **turnos estructurados del agente** (work log, changed files, thinking — todo intercalado), threads por PC con **status multi-PC truthful connection-targeted**, **selector de modelos estructurado** (nombres legibles, badge default, versión resuelta del alias, per-model run-option knobs), **medidor de uso de contexto persistido** (%, gated en `reportsContextUsage`), **dictado voz→texto**, **adjuntar imágenes** (galería + cámara), **stop-the-turn** mid-run, **sign-in status per-agente** (`auth/status`), **aprobación interactiva** (Approve / Reject / "always allow this session"), **Remove device**, acciones por thread (rename / archive / delete / copy id), **folder browser** (`workspace/browseDirs`), **indicador relay-vs-directo**, **deep-link de notificaciones**, **pantalla Git completa** (diff per-file, switch de rama con auto-stash, smart PR, undo-commit), settings + preferencias de notificación + scroll-on-send, **copy personalizado en push** + supresión en foreground, registro FCM (gated). iOS pendiente de assets FOR-HUMAN. |
| `bridge/` | **Implementado.** Transporte E2EE (LAN `http+ws` + relay opcional), **5 agentes reales cableados** (OpenCode, Claude Code, Codex, pi, Gemini CLI) + per-thread/project agent+model, **descubrimiento estructurado `AgentModel[]`**, **token usage per-turn**, **thinking + structured commands/tools/diffs** para cada agente, **intake de aprobación interactiva** (Echo demo + Claude Code opt-in `PreToolUse` hook), **adjuntar imágenes** (file-path CLI-agnóstico), **folder browsing plug-and-play** (`workspace/browseDirs`), **pins de agent/model per-proyecto**, **`auth/status` sanitizado per-agente**, git + workspace + **checkpoints con restore verdadero + retention pruning**, **fallback on-disk `turn/list` history** (Claude/Codex/OpenCode/pi JSONL/JSON stores), **FCM push directo desde el bridge** (persistido, target per-phone, prune-on-untrust), **manual-code pairing** (`GET /pair/resolve?code=`) + **descubrimiento mDNS** (`_uxnan._tcp.local`), autostart por OS, file logging. **Aider** es el último agente planeado (FOR-DEV). |
| `relay/` | **Implementado — ahora OPCIONAL / self-hosted.** Relay de envelopes E2EE por `sessionId`, rate limiting per-IP, peer-close + manejo de stale-socket, endpoints de push (`/push/register|notify`, FCM, gated en creds) como **fallback** (el bridge es la ruta primaria de push). |
| `shared/` | **Implementado.** Contratos JSON-RPC + E2EE, **59 métodos** + 8 notificaciones de streaming, validadores Ajv, `PairingPayload` v2 (relay opcional + hosts), per-model run-option knobs, image attachments, aprobación interactiva. |
| `uxnandesktop/` | **Alpha-funcional (standalone).** Tauri 2 + Rust + Svelte 5 ADE. **Fases 0-5 + cross-cutting (S) completas.** Shell de tres paneles redimensionable, persistencia JSON atómica (5 backups rotativos + migraciones secuenciales), terminales PTY (xterm WebGL + DOM fallback) con tabs + splits anidados, git worktrees con workspaces de terminal per-worktree, git status/diff/stage/commit/push/pull (watcher 3s focus-paused, visor de diffs CodeMirror 6, staging por hunk), **Layer 1 HTTP hook server** (axum: `working/blocked/waiting/done` preciso, cache persistente) + Layer 2 terminal-title (OSC) + Layer 3 process-tree, notificaciones nativas en idle, logos personalizados por agente, override de agente per-worktree, i18n completa EN/ES, design tokens, registro de agentes + manual + auto-launch, paleta de worktrees (Ctrl/Cmd+P), listas virtualizadas, keep-awake opt-in (Windows). Fase 6 (bridge embebido / pairing móvil) es la única fase restante, *opcional para uso standalone*. |

**Las notificaciones push** están code-complete y **Android está live**; la entrega en iOS está pendiente de una APNs key (macOS + Apple Developer). **El push lo envía directamente el bridge** (FCM HTTP v1) sobre cualquier transporte — LAN directo, Tailscale o relay — así que funciona sin un relay hospedado. Los endpoints `/push/*` del relay quedan como fallback hospedado opcional.

**iOS** no está alpha-ready todavía: el Podfile se genera en el primer build en macOS, la APNs key debe subirse a Firebase, y las usage strings de `Info.plist` (cámara, micrófono, red local, photo library) están pendientes — ver `uxnanmobile/FOR-HUMAN.md`.

El progreso por componente vive en cada `CHANGELOG.md`; lo pendiente en cada
`FOR-DEV.md`. La documentación operativa por componente (instalación,
configuración, agentes, testing, deploy) vive en [`bridge/docs/`](bridge/docs/),
[`relay/docs/`](relay/docs/), [`uxnanmobile/docs/`](uxnanmobile/docs/), y
[`uxnandesktop/docs/`](uxnandesktop/docs/). El proyecto aplica
[`AGENTS.md` → "Spec drift control"](AGENTS.md): cada `DONE` en cualquier
`FOR-DEV.md` se refleja en `architecture/` en el mismo conjunto de cambios.

---

*Uxnan — un nombre sin relación ni derivación de ningún producto existente.*
