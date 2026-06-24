# Uxnan — Documentación Técnica (Especificación Móvil)

> **Versión:** 1.2.0
> **Fecha:** 2026-06-17
> **Estado:** Definición inicial — borrador técnico completo, sincronizado con código ALPHA
> **Plataformas objetivo:** Android (principal), iOS (principal)
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod 3.x (manual)
> **Monorepo:** Este directorio (`architecture/`) contiene la especificación PRD+SRS de la app móvil Flutter.

> **Regla de mantenimiento (ver `AGENTS.md` → *Spec drift control (non-negotiable)*):**
> esta carpeta es la **fuente de verdad** para la arquitectura del sistema.
> Cualquier item marcado `DONE` / `DONE & validated end-to-end` en
> `uxnanmobile/FOR-DEV.md`, `bridge/FOR-DEV.md`, `relay/FOR-DEV.md` o
> `uxnandesktop/FOR-DEV.md` debe reflejarse aquí **en el mismo conjunto de
> cambios**, no solo en el `CHANGELOG.md`. Si un item contradice esta spec,
> abrir un `FOR-DRIFT` en el `FOR-DEV.md` correspondiente. La spec NO debe
> quedar atrás del código en un release.

---

## Documentos

| # | Documento | Descripción | Audiencia |
|---|---|---|---|
| 01 | [Visión del Producto](01-product-vision.md) | Qué es Uxnan, qué ofrece, cómo funciona, flujos críticos, MVP y roadmap | Product owners, stakeholders, nuevos miembros del equipo |
| 02a | [Arquitectura del Sistema y Módulos](02a-system-architecture.md) | Arquitectura detallada, interfaz de adaptadores, todos los módulos del sistema (dominio, servicios, infra, UI, pairing, timeline, Git, bridge, transporte, relay), modelos de dominio, estructura de directorios | Desarrolladores, arquitectos |
| 02b | [Contratos, Requisitos y Paquetes](02b-contracts-and-requirements.md) | Contratos JSON-RPC, paquetes Flutter recomendados, requisitos funcionales y no funcionales, seguridad y criptografía, gestión de estado y persistencia | Desarrolladores, QA |
| 02c | [Guía de Implementación](02c-implementation-guide.md) | Providers Riverpod 3.x, adaptadores de agente, diseño UI/M3, plan de pruebas, CI/CD, i18n, permisos, despliegue, manejo de errores, base de datos Drift, reconexión, SSH, onboarding, settings, apéndices técnicos | Desarrolladores, contribuidores |
| 03 | [Guía de Referencia Técnica](03-technical-reference.md) | Convenciones de código, nomenclatura, commits, reglas de imports entre capas, flujos de autenticación por agente, bootstrap del proyecto, flavors, consideraciones de plataforma, glosario | Desarrolladores, onboarding técnico |

---

## Estado de implementación

> Esta sección registra el avance de implementación frente a la especificación; se actualiza con cada incremento. La rama de trabajo de la app móvil es `uxnanmobile`. El detalle por incremento vive en `uxnanmobile/CHANGELOG.md`. Snapshot vivo de "dónde estamos vs. dónde queríamos estar" en `uxnanmobile/FOR-DEV.md` (sección *Recommended next steps* + *What still blocks a complete MVP*).

**uxnanmobile (Flutter) — rama `uxnanmobile`:**

| Área | Estado | Notas |
|---|---|---|
| Bootstrap (Android+iOS, package Dart `uxnan`, bundle `dev.luisgamas.uxnanmobile`) | ✅ Hecho | `flutter analyze` sin issues; `minSdk` 24, iOS 15 |
| Estructura de capas (`core/`, `domain/`, `application/`, `infrastructure/`, `presentation/`) | ✅ Hecho | Ver 02a §7 |
| Capa `core/` (constantes de protocolo, errores tipados, extensiones, logger/debouncer) | ✅ Hecho | — |
| Enums de dominio | ✅ Hecho | 02a §5.1.2 |
| Sistema visual M3 (tokens + tema adaptativo claro/oscuro) | ✅ Hecho | 02c §3.1 |
| **Lenguaje de diseño "Neural Expressive" (M3 Expressive)** | ✅ Hecho | `uxnanmobile/docs/neural-expressive-design.md`; Icon Surfaces, top bar transparente + scroll veil, pill input flotante, card lists con esquinas dinámicas, spring-motion tokens |
| Arranque (`main`/`app`/router), i18n (en/es) | ✅ Hecho | — |
| Persistencia drift (esquema completo de 7 tablas + `UxnanDatabase`) | ✅ Hecho | 02c §10 |
| Repositorios drift: `Thread`, `ComposerDraft`, `Message`, `Turn`, `Project`, `TrustedDevice`, `git_action_log` (+ providers DI) | ✅ Hecho | — |
| Gestión de estado | Riverpod **3.x** manual | Decisión 2026-06-05 (ver abajo); API `Notifier`/`NotifierProvider` |
| Primitivas crypto E2EE (key gen, handshake Ed25519/X25519/HKDF, envelope AES-256-GCM, fingerprint) | ✅ Hecho | 02a §5.9; verificado con vectores RFC/NIST |
| Mecánica de transporte (WebSocket, handshake `performHandshake`, `SecureChannel` seq/replay, correlador, backoff, outbound buffer) | ✅ Hecho | 02a §5.9; handshake de 2 partes probado en memoria |
| Orquestación `SessionCoordinator` (ConnectionPhase + reconexión + providers Riverpod) + `SecureStore`/`PhoneIdentityStore` + `TransportSelector` (relay, **direct LAN/Tailscale**) | ✅ Hecho | 02a §5.2.1; probado con bridge simulado (connect, RPC, reconexión) y validado on-device en LAN/Tailscale (post-Windows-Firewall) |
| `IncomingMessageProcessor` + integración WS en vivo contra bridge real | ✅ Hecho | Probado físicamente (móvil ↔ bridge ↔ relay + móvil ↔ bridge directo en LAN/Tailscale) |
| **Descubrimiento LAN / Tailscale (vía `hosts` en el QR, sin mDNS obligatorio)** | ✅ Hecho (host-first) | El bridge anuncia `hosts: string[]` en el `PairingPayload`; el móvil los prueba primero y cae al relay. mDNS queda como follow-up opcional (FOR-DEV). |
| Reconexión robusta: heartbeat `bridge/status`, single-flight, ping WS, "Verificar conexión", sessionId estable | ✅ Hecho | 02c §11 |
| Pairing — **lógica** (`PairingPayload` v2, `PairingValidator`, `TrustedDevice` repo, `processPairingPayload`) | ✅ Hecho | 02a §5.5; **QR + código manual** (manual es bridge-first, no relay — ver §5.5.3) |
| Pairing — **UI** (onboarding 4 páginas, `QrScannerScreen`, `UpdatePromptDialog`, `ManualCodeScreen`, `MyDevicesScreen`, rutas) | ✅ Hecho | M3; verificado on-device en Android |
| Conversación/timeline — **dominio + datos** (`MessageContent` polimórfico, `Message`/`Turn`, `DriftMessageRepository`, `MessageDeduplicator`, `TurnTimelineSnapshot` + reducer) | ✅ Hecho | 02a §5.6/§6.2 |
| Conversación — **managers** (`ThreadManager`, `IncomingMessageProcessor`, eventos de dominio + streaming, **per-thread in-memory buffer** que sobrevive a la navegación) | ✅ Hecho | 02a §5.2.2/§5.2.5 |
| Conversación — **UI** (`ConversationScreen` con M3 + Neural Expressive, renderers, composer anclado abajo) cableada a datos reales | ✅ Hecho | Sin samples; modelo/agente del thread, git por `cwd` real |
| **Indicador "Responding…" por thread** | ✅ Hecho | `ThreadActivity` + `threadActivityProvider`; spinner por thread en lista y conversación |
| Flujo **Nueva conversación** (proyecto `project/list` + agente `agent/list` + modelo `agent/models` + **folder browser** `workspace/browseDirs`) + **selector de modelos** (`thread/setModel`, `AgentModel[]` estructurado) | ✅ Hecho | M3; skip onboarding si ya hay PC |
| **Adjuntar imágenes** (image picker, base64 inline, thumbnail strip, image-only message) | ✅ Hecho (gated by `AgentCapabilities.images`) | Envío en `turn/send { attachments }`; `text` ahora opcional |
| **Voz → texto** en el composer (`speech_to_text`) | ✅ Hecho | Verificado on-device (Android); iOS pending `NSMicrophoneUsageDescription`/`NSSpeechRecognitionUsageDescription` (FOR-HUMAN) |
| **Stop the turn** mid-run | ✅ Hecho | `turn/cancel` desde el composer |
| **Per-model run-option knobs** (data-driven, `AgentModel.options`) | ✅ Hecho | Renderizado genérico (`enum`/`toggle`); el bridge anuncia por modelo |
| **Context-usage indicator** (porcentaje si el modelo tiene ventana; token count si no; **0 baseline** para agentes con `reportsContextUsage`) | ✅ Hecho | `usage { tokens, contextWindow? }` en `turn/completed` |
| **Per-agent `auth/status`** (banner en conversación, red dot en lista, "Check sign-in" en nueva-conversación, auto-refresh en resume) | ✅ Hecho | Sanitizado (nunca tokens) |
| **Interactive approval** (Approve / Reject / "allow session", persistido) | ✅ Hecho (app + bridge) | El bridge emite un `approval` content block; el móvil responde con `turn/send { approvalResponse }`. La decisión se persiste en SharedPreferences y la card queda en estado "Decision recorded" tras scroll/restart. **Echo demo + Claude Code (`PreToolUse` hook) + Codex (`codex app-server` elicitations) + Gemini (`BeforeTool` hook) funcionan end-to-end**; OpenCode/pi documentados como gap (sus modos headless no exponen protocolo pre-tool). |
| **Threads por PC + connection-targeted live actions** | ✅ Hecho | `Thread.deviceId`; todas las acciones live apuntan al PC con canal real; browsing es read-only |
| **Acciones por thread** (rename, archive/unarchive, delete, copy id) | ✅ Hecho | `thread/rename|archive|unarchive|delete`; archival en pantalla separada |
| **Remove device** (unpair) | ✅ Hecho | Envía `bridge/removeTrustedDevice` con el id del teléfono, luego borra local |
| **Git** (status, commit, push, pull, branches, switchBranch, createBranch, createWorktree, discard, undoCommit, createPr, revert, deleteBranch, removeWorktree, per-file `git/diff`) | ✅ Hecho | UI: full-screen `GitScreen` con staging por hunk, switch con auto-stash, smart PR, undo-commit, diff per-file unificado |
| **Push FCM** (registro de token, notificaciones locales, deep-link, preferencias Replies/Errors, foreground suppression, persistencia entre reinicios, multi-device) | ✅ Hecho (gated) | **Push directo desde el bridge** (`uxnan-bridge` lazy-loads `firebase-admin`); el relay es fallback opcional; Android LIVE; iOS pending APNs key en Firebase (FOR-HUMAN) |
| **Settings** (theme, language, notification preferences, personalization) | ✅ Hecho | Persistido vía `AppearancePreferencesStore` / `NotificationPreferencesStore` |
| **Custom themes** (temas personalizables) | ✅ Hecho | El usuario diseña temas Material 3 en una **librería multi-tema** con una pantalla **Theme Manager dedicada** (`ThemeManagerScreen`), separada de Personalización. Un `CustomTheme` puede ser **single-brightness** (light-only o dark-only) o **dual**; el lado faltante se deriva de los key colors del lado autorado vía Material 3 (`fromDualSchemes` / `single` / `derivedFromSeed`). El Theme Manager muestra un **grid de cards de preview en vivo** (dual = light\|dark lado a lado, single = un panel) con chip de brillo + badges *Active*/*Built-in*; tap activa, **long-press** entra en multi-select para borrar/exportar en bloque; *New* / *Import* / *Export all* / *Reset* viven en el `NeTopBar`. Import/Export usan **bottom sheets** (`theme_sheets.dart`) y aceptan formatos nativo, Material Theme Builder y flat (object o array). Personalización quedó adelgazada: picker de theme-mode (un *dual* deja libre System/Light/Dark; un *single* fuerza su brillo vía `effectiveThemeModeProvider`/`themePickerEnabledProvider`), una card compacta de custom-theme (master switch + entrada al manager con preview del activo) y el idioma. El editor ([`CustomThemeEditorScreen`](../../uxnanmobile/lib/presentation/screens/settings/custom_theme_editor_screen.dart)) muestra tabs Light/Dark solo para un dual (un single muestra su lado + *Add a {light/dark} side*), con HSV picker por rol y *Derive from seed*. Persistido en `shared_preferences` (`uxnan.appearance.customThemes` JSON array, `…activeCustomThemeId`, `…useCustomTheme`); `schemaVersion` 1→2 (docs v1 cargan como dual). Ver `02c-implementation-guide.md` §3.1. |
| **Persistencia de sort/density** | ✅ Hecho | `ThreadListPreferencesStore` persiste sort + density de la lista de threads |
| **Project-level thread scoping** | ⏳ Pendiente (deshabilitado en UI) | Implementado (chips + filtro + bridge) pero apagado vía `_projectFilterEnabled=false`; habilitar con una vista de filtros avanzados |
| **Migración iOS (build, APNs, Info.plist, signing)** | ⏳ Bloqueado por FOR-HUMAN | El primer build de iOS solo es posible en macOS; sin APNs key la entrega iOS queda diferida |

> Detalle completo del avance en `uxnanmobile/CHANGELOG.md`; lo pendiente, en `uxnanmobile/FOR-DEV.md`.

> **Decisión de gestión de estado (2026-06-05):** el proyecto usa **Riverpod 3.x** manual (no 2.x). Los ejemplos de la especificación que usan `StateNotifierProvider` (API 2.x) se adaptan a la API moderna `Notifier`/`NotifierProvider`/`AsyncNotifierProvider`. Sigue sin usarse `riverpod_generator`.

---

## Estructura del Monorepo

El proyecto Uxnan está organizado como un monorepo que agrupa todos los componentes del ecosistema:

```
uxnan/                           # Monorepo raíz
├── architecture/                # Documentación de arquitectura del ecosistema (especificación móvil; fuente de verdad)
├── uxnanmobile/                 # Proyecto Flutter (Android + iOS)
├── bridge/                      # Node.js daemon para PC (standalone o embebido en desktop)
├── uxnandesktop/                # App de escritorio ADE (Tauri 2 + Rust + Svelte 5)
├── relay/                       # Node.js relay server (opcional, self-hosted)
├── shared/                      # Contratos compartidos (tipos, JSON-RPC schemas)
└── README.md
```

| Carpeta | Descripción |
|---|---|
| `architecture/` | Contiene la especificación completa (PRD + SRS) de la app móvil Flutter: visión del producto, arquitectura del sistema, contratos, guía de implementación y referencia técnica. Es la **fuente de verdad** para la arquitectura del sistema móvil y de los contratos cross-component (E2EE, JSON-RPC, bridge, relay). Sujeto a la regla de control de desfase en `AGENTS.md`. |
| `uxnanmobile/` | Proyecto Flutter que implementa la app móvil de Uxnan para Android e iOS. Su especificación técnica vive en `architecture/`. |
| `bridge/` | Daemon Node.js para PC que actúa como puente entre la app móvil y los recursos de la computadora (Git, sistema de archivos, terminal). Es un componente standalone que también puede integrarse dentro de la app de escritorio (`uxnandesktop/`). |
| `uxnandesktop/` | App de escritorio ADE (Agente de Desarrollo Embarcado) construida con Tauri 2, Rust y Svelte 5. Contiene su propia documentación técnica en `uxnandesktop/architecture/`. |
| `relay/` | Servidor relay Node.js que facilita la comunicación entre la app móvil y el bridge/desktop cuando no hay conexión directa en red local. **Opcional y self-hosted** (2026-06): la ruta primaria del producto es LAN-direct / Tailscale-direct; el relay es el fallback off-LAN hospedado por el propio usuario. |
| `shared/` | Contratos compartidos entre todos los componentes: definiciones de tipos TypeScript, schemas JSON-RPC y cualquier otra interfaz común que necesiten consumir múltiples proyectos del monorepo. |

---

## Convenciones de esta documentación

- **Idioma:** Español como idioma principal. Código y nombres técnicos en inglés.
- **Código fuente:** Los bloques de código son especificaciones de referencia, no código listo para copiar-pegar. Representan la estructura y el contrato esperado.
- **Riverpod:** Todos los providers se declaran manualmente (sin `riverpod_generator`). Ver convenciones en el documento 03.
- **Arquitectura:** Clean Architecture con capas `domain/`, `infrastructure/`, `presentation/`, y `core/` para utilidades transversales.
- **Material Design 3:** El sistema visual usa tokens M3 centralizados con `ColorScheme` semántico.

---

## Origen

Estos documentos fueron derivados del whitepaper original `whitepaper.md` (v1.0.0, 2026-06-03) y reorganizados en documentos enfocados por tema. No se ha perdido información del documento original; se ha adaptado ligeramente la gestión de estado (Riverpod manual 3.x) y el sistema visual (Material Design 3 semántico).

Posteriormente, el proyecto se reestructuró como monorepo para agrupar todos los componentes del ecosistema Uxnan (app móvil, bridge, app de escritorio, relay y contratos compartidos) en un único repositorio. Los whitepapers originales (`architect-mobile.md` y `architect-desktop.md`) se trasladaron a `architecture.old/` como referencia histórica, y esta carpeta (`architecture/`) se consolidó como la especificación técnica oficial de la app móvil.

---

> **Nota:** Este índice y los documentos de `architecture/` son la fuente de verdad para la especificación de la app móvil Uxnan y para los contratos cross-component (E2EE §5.9, bridge §5.8, relay §5.10). Para la app de escritorio, consultar la documentación técnica en `uxnandesktop/architecture/`. El monorepo aplica la regla de control de desfase en `AGENTS.md` → *Spec drift control (non-negotiable)* para mantener esta spec sincronizada con el código.
