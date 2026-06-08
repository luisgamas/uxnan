# Uxnan

![Status](https://img.shields.io/badge/STATUS-ALPHA-orange?style=for-the-badge)
![Monorepo](https://img.shields.io/badge/MONOREPO-5_PROJECTS-blue?style=for-the-badge)
![E2EE](https://img.shields.io/badge/E2EE-AES--256--GCM-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)
![Platforms](https://img.shields.io/badge/PLATFORMS-Android_%7C_iOS_%7C_Windows_%7C_macOS_%7C_Linux-lightgrey?style=for-the-badge)

> [Leer en español](README.es.md)

Uxnan (pronounced /uʃ.nan/) is a toolkit I'm building to solve a very specific problem I have as a developer: **controlling AI coding agents from anywhere, without my hardware becoming the bottleneck.**

## Why this project exists

I work with CLI coding agents (Claude Code, Codex CLI, OpenCode, Gemini CLI, pi-agent) every day. They're extraordinary tools, but the current workflow has real friction:

- **When I step away from my PC**, I lose all visibility into what the agent is doing. I can't check its progress, approve changes, or send new instructions from my phone.
- **Existing desktop solutions are excellent**, but many assume high-end hardware. On my current setup, running a heavy IDE + multiple agents + an Electron environment consumes more resources than I can afford.
- **There's no provider-agnostic mobile tool** that works with any agent, not just one in particular.

Uxnan was born to solve exactly that. It's not an agent — it's the **control plane** for the agents I already use.

## What each component does

### `uxnanmobile/` — Mobile App

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Material Design](https://img.shields.io/badge/Material_Design_3-757575?style=for-the-badge&logo=materialdesign&logoColor=white)

A Flutter app for Android and iOS that works as a remote control for agents running on my PC. From my phone I can watch conversations in real time, send instructions, commit+push, review diffs, and receive notifications when an agent finishes a task.

The connection is end-to-end encrypted (E2EE). The relay server never sees the content of my messages.

> Full technical specification: [`architecture/`](architecture/00-index.md)

### `uxnandesktop/` — Desktop App (ADE)

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=000000)
![Svelte](https://img.shields.io/badge/Svelte_5-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=000000)

A lightweight Agent Development Environment built with Tauri 2, Rust, and Svelte 5. Unlike Electron-based alternatives that consume 200-500 MB of RAM just by existing, this ADE uses the native OS webview and targets 30-100 MB of RAM.

The core idea: each task lives in its own git worktree with its own agent running in an independent pseudoterminal. I can have 5 agents working in parallel without one blocking another, switch between them with a click (no `git stash`, no `git checkout`), and review each one's changes in an integrated diff viewer before committing.

It doesn't integrate any agent's SDK. It's terminal-centric: any CLI agent works without modification.

> Full technical specification: [`uxnandesktop/architecture/`](uxnandesktop/architecture/00-index.md)

### `bridge/` — Bridge Daemon

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JSON RPC](https://img.shields.io/badge/JSON--RPC_2.0-000000?style=for-the-badge&logo=json&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)

A Node.js daemon that runs on the PC and connects the mobile app to local agents. It translates protocol differences between agents (Codex uses native JSON-RPC, Claude Code uses JSONL, pi-agent uses JSONL RPC, etc.) and exposes a unified interface to the phone.

It works in two modes:
- **Standalone**: installed separately for those who only want mobile remote control without installing the desktop app.
- **Embedded**: the desktop app integrates it as a child process, eliminating the need to install it separately.

> Bridge specification: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (section 5.8)
> Desktop integration: [`uxnandesktop/architecture/02e-bridge-integration.md`](uxnandesktop/architecture/02e-bridge-integration.md)

### `relay/` — Relay Server

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![E2EE](https://img.shields.io/badge/E2EE_OPAQUE-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)

A Node.js server that relays encrypted messages between the phone and the bridge when they're not on the same local network. It only sees opaque E2EE envelopes — never the plaintext content.

On a local network (LAN), the phone connects directly to the bridge without going through the relay.

> Relay specification: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (section 5.10)

### `shared/` — Shared Contracts

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![JSON Schema](https://img.shields.io/badge/JSON_Schema-000000?style=for-the-badge&logo=json&logoColor=white)

TypeScript type definitions and JSON-RPC schemas consumed by the bridge, the relay, and used as reference for the mobile app (Dart) and desktop (Rust). A change to an RPC method is reflected here and all components stay in sync.

> JSON-RPC contracts: [`architecture/02b-contracts-and-requirements.md`](architecture/02b-contracts-and-requirements.md) (section 1)

### `architecture/` — Technical Documentation (Mobile)

Complete specification (PRD + SRS) for the mobile app: product vision, system architecture with all 10 modules, communication contracts, implementation guide with manual Riverpod 3.x and Material Design 3, and technical reference with conventions and glossary.

### `architecture.old/` — Original Whitepapers

The monolithic original documents that preceded the current documentation. Preserved as historical reference.

## Stack

| Component | Technology |
|---|---|
| Mobile app | Flutter / Dart, Riverpod 3.x (manual), Material Design 3, drift (SQLite) |
| Desktop app | Rust, Tauri 2, Svelte 5, shadcn-svelte, Tailwind CSS, xterm.js, CodeMirror 6 |
| Bridge | Node.js |
| Relay | Node.js |
| Security | X25519 + Ed25519 + AES-256-GCM + HKDF-SHA256 |

## Security

![X25519](https://img.shields.io/badge/X25519-Key_Exchange-2ea44f?style=for-the-badge)
![Ed25519](https://img.shields.io/badge/Ed25519-Signatures-2ea44f?style=for-the-badge)
![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-Encryption-2ea44f?style=for-the-badge)
![HKDF-SHA256](https://img.shields.io/badge/HKDF--SHA256-Key_Derivation-2ea44f?style=for-the-badge)

All communication between the mobile app and the PC goes through a real E2EE channel. The relay server is transport-only — it never sees plaintext. Session keys are derived via X25519 ephemeral key exchange, authenticated with Ed25519 identity signatures, and used for AES-256-GCM symmetric encryption.

## Current status

![Phase](https://img.shields.io/badge/PHASE-ALPHA_(MVP_in_progress)-orange?style=for-the-badge)

The mobile MVP and its PC-side stack are implemented and run end-to-end with a
real agent; the desktop app has not been started.

| Component | Status |
|---|---|
| `uxnanmobile/` | **MVP wired.** QR pairing + trusted reconnect, E2EE transport with auto-reconnect (heartbeat), streaming conversation, real model picker, Git (status/commit/push), per-PC thread scoping, FCM push registration (gated). |
| `bridge/` | **Implemented.** E2EE transport (relay + LAN), **OpenCode, Claude Code and Codex wired as real agents** (each spawns its official local CLI over stdio — no provider API/SDK/keys), per-thread agent/model/project selection (`agent/list`, `agent/models`, `project/list`), Git + workspace + checkpoints, conversation engine, push (gated), resilient relay reconnection. |
| `relay/` | **Implemented.** E2EE envelope relay by `sessionId`, per-IP rate limiting, peer-close on disconnect, push endpoints (gated on Firebase/APNs creds). |
| `shared/` | **Implemented.** JSON-RPC + E2EE contracts, validators. |
| `uxnandesktop/` | **Not started** — architecture spec only. |

Push notifications are code-complete but **gated**: real delivery needs a Firebase
project + native config (see each component's `FOR-HUMAN.md`). The next agent
(Gemini) follows the OpenCode/Claude Code/Codex recipe in `bridge/FOR-DEV.md`.
Per-component progress lives in each `CHANGELOG.md`; pending work in each
`FOR-DEV.md`. How to run/test: [`TESTING.md`](TESTING.md).

---

*Uxnan — a name with no relation to or derivation from any existing product.*
