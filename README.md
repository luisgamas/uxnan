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

### `uxnanmobile/` — Mobile App (Flutter, Android + iOS)

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Material Design](https://img.shields.io/badge/Material_Design_3-757575?style=for-the-badge&logo=materialdesign&logoColor=white)

A Flutter app that works as a remote control for agents running on my PC. From my phone I can watch conversations in real time, send instructions, attach images, dictate via voice, commit+push, review diffs, and receive notifications when an agent finishes a task.

The connection is end-to-end encrypted (E2EE) and is **bridge-first**: the phone tries the bridge's direct LAN/Tailscale addresses first, and falls back to a self-hosted relay only for off-LAN access. The relay — when used — only ever sees opaque E2EE envelopes.

> Full technical specification: [`architecture/`](architecture/00-index.md)

### `uxnandesktop/` — Desktop App (ADE, Tauri 2 + Rust + Svelte 5)

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=000000)
![Svelte](https://img.shields.io/badge/Svelte_5-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=white)

A lightweight **Agent Development Environment** built with Tauri 2, Rust, and Svelte 5. Unlike Electron-based alternatives that consume 200-500 MB of RAM just by existing, this ADE uses the native OS webview and targets 30-100 MB of RAM.

The core idea: each task lives in its own git worktree with its own agent running in an independent pseudoterminal. I can have 5 agents working in parallel without one blocking another, switch between them with a click (no `git stash`, no `git checkout`), and review each one's changes in an integrated diff viewer (CodeMirror 6, unified + side-by-side, hunk-level staging) before committing.

It doesn't integrate any agent's SDK. It's terminal-centric: any CLI agent works without modification. **Phases 0–5 + the cross-cutting track (S) are complete** — the ADE is alpha-functional as a standalone app. The only remaining phase is **Phase 6 (embedded bridge / mobile pairing)**, which is *optional for standalone use*.

> Full technical specification: [`uxnandesktop/architecture/`](uxnandesktop/architecture/00-index.md)

### `bridge/` — Bridge Daemon (Node.js, runs on the PC)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JSON RPC](https://img.shields.io/badge/JSON--RPC_2.0-000000?style=for-the-badge&logo=json&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)

The **local control-plane daemon** that connects the mobile app to local agents. It implements the bridge side of the E2EE protocol (X25519 + HKDF + Ed25519 + AES-256-GCM), spawns each agent's **official local CLI** over stdio (no provider API / SDK / keys), and exposes a unified JSON-RPC interface (60 methods + 8 streaming notifications) to the phone.

It works in two modes:
- **Standalone** (default): installed separately for those who only want mobile remote control without installing the desktop app.
- **Embedded**: the desktop app integrates it as a child process (Phase 6 of `uxnandesktop/`, *optional for standalone*).

**Real agents wired:** OpenCode, Claude Code, Codex, pi, Gemini CLI. Each runs the official CLI in the thread's cwd with `shell:false`; the bridge parses its native stream format and emits structured `stream/content/block` events (command / diff / tool) plus `stream/thinking/delta` (reasoning). **Aider** is the only one not yet wired (recipe in `bridge/FOR-DEV.md`).

> Bridge specification: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (section 5.8)
> Desktop integration: [`uxnandesktop/architecture/02e-bridge-integration.md`](uxnandesktop/architecture/02e-bridge-integration.md)

### `relay/` — Relay Server (Node.js, **optional / self-hosted**)

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![E2EE](https://img.shields.io/badge/E2EE_OPAQUE-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)

A stateless WebSocket relay that forwards **opaque E2EE envelopes** between the phone and the bridge when they're not on the same LAN/Tailscale network. It only ever sees encrypted frames — never plaintext, keys, code, or diffs.

The relay is now **optional and self-hosted**: the product's primary paths are **LAN-direct** and **Tailscale-direct** (zero hosting, zero credentials). The relay is the hosted off-LAN fallback for users who want to run their own. Push notifications are sent **by the bridge directly** (FCM HTTP v1, lazy `firebase-admin`) and work on any transport; the relay's `/push/*` endpoints stay as a hosted fallback.

> Relay specification: [`architecture/02a-system-architecture.md`](architecture/02a-system-architecture.md) (section 5.10)

### `shared/` — Shared Contracts (TypeScript, ESM, Node >=18)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![JSON Schema](https://img.shields.io/badge/JSON_Schema-000000?style=for-the-badge&logo=json&logoColor=white)

The single source of truth for **JSON-RPC + E2EE contracts** consumed by the bridge and the relay (the mobile app keeps hand-synced Dart equivalents). Authoritative exports:

- **JSON-RPC** envelope types + constructors, error codes (`-32000..-32008` + standard), typed method registry (compile-time-locked to `METHOD_NAMES`).
- **E2EE** handshake messages, transcript builder, `SecureEnvelope`, `PairingPayload` v2 (with `hosts: string[]` for direct addressing).
- **Domain models** (thread/turn/message, git, workspace, project, auth, session, approval) and **agent contracts** (`IAgentAdapter`, `AgentCapabilities`, `AgentConfig`).
- **Validation**: Ajv-backed validators for requests, responses, E2EE envelopes, pairing payloads, push payloads.

> JSON-RPC contracts: [`architecture/02b-contracts-and-requirements.md`](architecture/02b-contracts-and-requirements.md) (section 1)

## Stack

| Component | Technology |
|---|---|
| Mobile app | Flutter / Dart, Riverpod 3.x (manual), Material Design 3 (+ Neural Expressive), drift (SQLite) |
| Desktop app | Rust, Tauri 2, Svelte 5 (Runes), shadcn-svelte, Tailwind v4, xterm.js, CodeMirror 6 |
| Bridge | Node.js (TypeScript, ESM, Node >=18) |
| Relay | Node.js (TypeScript, ESM, Node >=18) — optional / self-hosted |
| Shared contracts | TypeScript (ESM, Node >=18), Ajv validators |
| Security | X25519 + Ed25519 + AES-256-GCM + HKDF-SHA256 |

## Security

![X25519](https://img.shields.io/badge/X25519-Key_Exchange-2ea44f?style=for-the-badge)
![Ed25519](https://img.shields.io/badge/Ed25519-Signatures-2ea44f?style=for-the-badge)
![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-Encryption-2ea44f?style=for-the-badge)
![HKDF-SHA256](https://img.shields.io/badge/HKDF--SHA256-Key_Derivation-2ea44f?style=for-the-badge)

All communication between the mobile app and the PC goes through a real E2EE channel. The relay — when used — is transport-only and never sees plaintext. Session keys are derived via X25519 ephemeral key exchange, authenticated with Ed25519 identity signatures, and used for AES-256-GCM symmetric encryption. Bridge payloads are sanitized: `auth/status` is per-agent, never returns tokens, and detects login only by the existence of well-known auth files.

## Current status

![Phase](https://img.shields.io/badge/PHASE-ALPHA_(MVP_in_progress)-orange?style=for-the-badge)

The mobile MVP runs end-to-end against the bridge with **5 real agents** (OpenCode, Claude Code, Codex, pi, Gemini CLI). The desktop ADE is alpha-functional as a standalone app. Per-component status:

| Component | Status |
|---|---|
| `uxnanmobile/` | **MVP wired (Android alpha-ready).** QR pairing + manual-code pairing + trusted reconnect, E2EE transport (LAN/Tailscale-direct + relay fallback), streaming conversation with **structured agent turns** (work log, changed files, thinking — all interleaved), per-PC threads with **connection-targeted multi-PC status**, **structured model picker** (readable names, default badge, alias resolved version, per-model run-option knobs), **persisted context-usage meter** (%, gated on `reportsContextUsage`), **voice->text dictation**, **image attachments** (photo library + camera), **stop-the-turn** mid-run, **per-agent sign-in status** (`auth/status`), **interactive approval** (Approve / Reject / "always allow this session"), **Remove device**, per-thread actions (rename / archive / delete / copy id), **folder browser** (`workspace/browseDirs`), **relay-vs-direct transport indicator**, **notification deep-link**, full **Git screen** (per-file diff, branch switch with auto-stash, smart PR, undo-commit), settings + notification preferences + scroll-on-send, **personalized push copy** + foreground suppression, FCM push registration (gated). iOS pending FOR-HUMAN assets. |
| `bridge/` | **Implemented.** E2EE transport (LAN `http+ws` + optional relay), **5 real agents wired** (OpenCode, Claude Code, Codex, pi, Gemini CLI) + per-thread/project agent+model, **structured `AgentModel[]` discovery**, **per-turn token usage**, **thinking + structured commands/tools/diffs** for every agent, **interactive approval intake** (Echo demo + Claude Code opt-in `PreToolUse` hook), **image attachments** (CLI-agnostic file-path), **plug-and-play folder browsing** (`workspace/browseDirs`), **per-project agent/model pins**, **sanitized per-agent `auth/status`**, git + workspace + **checkpoints with true worktree restore + retention pruning**, **on-disk `turn/list` history fallback** (Claude/Codex/OpenCode/pi JSONL/JSON stores), **direct FCM push from the bridge** (persisted, per-phone target, prune-on-untrust), **manual-code pairing** (`GET /pair/resolve?code=`) + **mDNS discovery** (`_uxnan._tcp.local`), autostart per OS, file logging. **Aider** is the last planned agent (FOR-DEV). |
| `relay/` | **Implemented — now OPTIONAL / self-hosted.** E2EE envelope relay by `sessionId`, per-IP rate limiting, peer-close + stale-socket handling, **CSWSH `Origin` check on upgrades**, push endpoints (`/push/register|notify`, FCM, gated on creds) with **atomic state persistence** to `~/.uxnan/relay-state.json` (token registry + dedupe window with TTL 7d + cap 10k) as a **fallback** (the bridge is the primary push path). |
| `shared/` | **Implemented.** JSON-RPC + E2EE contracts, **60 methods** + 8 streaming notifications, Ajv validators, `PairingPayload` v2 (relay optional + hosts), per-model run-option knobs, image attachments, interactive approval. |
| `uxnandesktop/` | **Alpha-functional (standalone).** Tauri 2 + Rust + Svelte 5 ADE. **Phases 0-5 + cross-cutting (S) complete.** Three-panel resizable shell, atomic JSON persistence (5 rotating backups + sequential migrations), PTY terminals (xterm WebGL + DOM fallback) with tabs + nested splits, git worktrees with per-worktree terminal workspaces, git status/diff/stage/commit/push/pull (3s focus-paused watcher, CodeMirror 6 diff viewer, hunk-level staging), **Layer 1 HTTP hook server** (axum: precise `working/blocked/waiting/done`, persistent cache) + Layer 2 terminal-title (OSC) + Layer 3 process-tree, native idle notifications, custom agent logos, per-worktree agent override, full EN/ES i18n, design tokens, agents registry + manual + auto-launch, worktree palette (Ctrl/Cmd+P), virtualized lists, opt-in keep-awake (Windows). Phase 6 (embedded bridge / mobile pairing) is the only remaining phase, *optional for standalone use*. |

**Push notifications** are code-complete and **Android is live**; iOS delivery is
pending an APNs key (macOS + Apple Developer). **Push is sent directly by the
bridge** (FCM HTTP v1) on any transport — direct LAN, Tailscale, or relay — so
it works without a hosted relay. The relay's `/push/*` endpoints remain as an
optional hosted fallback.

**iOS** is not yet alpha-ready: the Podfile is generated on the first macOS
build, the APNs key must be uploaded to Firebase, and `Info.plist` usage
strings (camera, mic, local network, photo library) are pending — see
`uxnanmobile/FOR-HUMAN.md`.

Per-component progress lives in each `CHANGELOG.md`; pending work in each
`FOR-DEV.md`. Per-component docs (install, config, agents, testing, deploy)
live in [`bridge/docs/`](bridge/docs/), [`relay/docs/`](relay/docs/),
[`uxnanmobile/docs/`](uxnanmobile/docs/), and
[`uxnandesktop/docs/`](uxnandesktop/docs/). The project applies
[`AGENTS.md` -> "Spec drift control"](AGENTS.md): every `DONE` in any
`FOR-DEV.md` is reflected in `architecture/` in the same change set.

---

*Uxnan — a name with no relation to or derivation from any existing product.*
