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

### `uxnanmobile/` — App Móvil

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Material Design](https://img.shields.io/badge/Material_Design_3-757575?style=for-the-badge&logo=materialdesign&logoColor=white)

App Flutter para Android e iOS que funciona como control remoto de los agentes que corren en mi PC. Desde el teléfono puedo ver conversaciones en tiempo real, enviar instrucciones, hacer commit+push, revisar diffs y recibir notificaciones cuando un agente termina una tarea.

La conexión es cifrada de extremo a extremo (E2EE). El servidor relay nunca ve el contenido de mis mensajes.

> Especificación técnica completa: [`architecture/`](architecture/00-index.md)

### `uxnandesktop/` — App de Escritorio (ADE)

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=000000)
![Svelte](https://img.shields.io/badge/Svelte_5-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=000000)

Un Agent Development Environment ligero construido con Tauri 2, Rust y Svelte 5. A diferencia de las alternativas basadas en Electron que consumen 200-500 MB de RAM solo por existir, este ADE usa el webview nativo del sistema operativo y apunta a 30-100 MB de RAM.

La idea central: cada tarea vive en su propio git worktree con su propio agente corriendo en un pseudoterminal independiente. Puedo tener 5 agentes trabajando en paralelo sin que uno bloquee al otro, cambiar entre ellos con un click (sin `git stash`, sin `git checkout`), y revisar los cambios de cada uno en un visor de diffs integrado antes de hacer commit.

No integra SDKs de ningún agente. Es terminal-céntrico: cualquier agente CLI funciona sin modificar nada.

> Especificación técnica completa: [`uxnandesktop/architecture/`](uxnandesktop/architecture/00-index.md)

### `bridge/` — Bridge Daemon

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JSON RPC](https://img.shields.io/badge/JSON--RPC_2.0-000000?style=for-the-badge&logo=json&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)

Daemon Node.js que corre en la PC y conecta la app móvil con los agentes locales. Traduce las diferencias de protocolo entre agentes (Codex usa JSON-RPC nativo, Claude Code usa JSONL, pi-agent usa JSONL RPC, etc.) y expone una interfaz unificada hacia el teléfono.

Funciona en dos modos:
- **Standalone**: se instala por separado para quienes solo quieren el control remoto desde el móvil sin instalar la app de escritorio.
- **Embebido**: la app de escritorio lo integra como proceso hijo, eliminando la necesidad de instalarlo por separado.

> Especificación del bridge: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (sección 5.8)
> Integración con desktop: [`uxnandesktop/architecture/02e-bridge-integration.md`](uxnandesktop/architecture/02e-bridge-integration.md)

### `relay/` — Relay Server

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![E2EE](https://img.shields.io/badge/E2EE_OPACO-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)

Servidor Node.js que retransmite mensajes cifrados entre el teléfono y el bridge cuando no están en la misma red local. Solo ve envelopes E2EE opacos — nunca el contenido en texto claro.

En red local (LAN), el teléfono se conecta directamente al bridge sin pasar por el relay.

> Especificación del relay: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (sección 5.10)

### `shared/` — Contratos Compartidos

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![JSON Schema](https://img.shields.io/badge/JSON_Schema-000000?style=for-the-badge&logo=json&logoColor=white)

Definiciones de tipos TypeScript y schemas JSON-RPC que consumen el bridge, el relay y sirven de referencia para la app móvil (Dart) y el desktop (Rust). Un cambio en un método RPC se refleja aquí y todos los componentes se mantienen sincronizados.

> Contratos JSON-RPC: [`architecture/02b-contracts-and-requirements.md`](architecture/02b-contracts-and-requirements.md) (sección 1)

### `architecture/` — Documentación Técnica (Móvil)

Especificación completa (PRD + SRS) de la app móvil: visión del producto, arquitectura del sistema con los 10 módulos, contratos de comunicación, guía de implementación con Riverpod 3.x manual y Material Design 3, y referencia técnica con convenciones y glosario.

### `architecture.old/` — Whitepapers Originales

Los documentos monolíticos originales que precedieron la documentación actual. Se conservan como referencia histórica.

## Stack

| Componente | Tecnología |
|---|---|
| App móvil | Flutter / Dart, Riverpod 3.x (manual), Material Design 3, drift (SQLite) |
| App desktop | Rust, Tauri 2, Svelte 5, shadcn-svelte, Tailwind CSS, xterm.js, CodeMirror 6 |
| Bridge | Node.js |
| Relay | Node.js |
| Seguridad | X25519 + Ed25519 + AES-256-GCM + HKDF-SHA256 |

## Seguridad

![X25519](https://img.shields.io/badge/X25519-Intercambio_de_Claves-2ea44f?style=for-the-badge)
![Ed25519](https://img.shields.io/badge/Ed25519-Firmas-2ea44f?style=for-the-badge)
![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-Cifrado-2ea44f?style=for-the-badge)
![HKDF-SHA256](https://img.shields.io/badge/HKDF--SHA256-Derivación_de_Claves-2ea44f?style=for-the-badge)

Toda la comunicación entre la app móvil y la PC pasa por un canal E2EE real. El servidor relay es solo transporte — nunca ve texto plano. Las claves de sesión se derivan mediante intercambio de claves efímeras X25519, autenticadas con firmas de identidad Ed25519, y usadas para cifrado simétrico AES-256-GCM.

## Estado actual

![Phase](https://img.shields.io/badge/FASE-ALPHA_(MVP_en_progreso)-orange?style=for-the-badge)

El MVP móvil y su stack del lado PC están implementados y funcionan de punta a
punta con un agente real; la app de escritorio aún no se ha comenzado.

| Componente | Estado |
|---|---|
| `uxnanmobile/` | **MVP cableado.** Pairing QR + reconexión confiable, transporte E2EE con reconexión automática (heartbeat), conversación con streaming, selector de modelos real, Git (status/commit/push), threads por PC, registro de push FCM (gated). |
| `bridge/` | **Implementado.** Transporte E2EE (relay + LAN), **OpenCode cableado como agente real** (`opencode run --format json`), selección de agente/modelo/proyecto por thread (`agent/list`, `agent/models`, `project/list`), Git + workspace + checkpoints, motor de conversación, push (gated), reconexión resiliente al relay. |
| `relay/` | **Implementado.** Relay de sobres E2EE por `sessionId`, rate-limit por IP, cierre del peer al desconectar, endpoints de push (gated por credenciales Firebase/APNs). |
| `shared/` | **Implementado.** Contratos JSON-RPC + E2EE, validadores. |
| `uxnandesktop/` | **Sin comenzar** — solo especificación. |

Las push notifications están completas en código y **Android ya está activo**
contra un proyecto Firebase; iOS queda pendiente de una clave APNs (macOS + cuenta
Apple Developer). Para activarlas en tu propia cuenta de Firebase, probar la
entrega y decidir qué es seguro subir al repo, ver
[`relay/docs/push-notifications.md`](relay/docs/push-notifications.md) (checklist
de assets en el `FOR-HUMAN.md` de cada componente). El siguiente agente (Gemini) sigue la receta de
OpenCode/Claude Code/Codex en `bridge/FOR-DEV.md`. El avance por componente vive en
cada `CHANGELOG.md`; lo pendiente en cada `FOR-DEV.md`. La documentación por
componente (instalación, config, agentes, testing, deploy) vive en
[`bridge/docs/`](bridge/docs/) y [`relay/docs/`](relay/docs/).

---

*Uxnan — un nombre que no tiene ninguna relación ni derivación de ningún producto existente.*
