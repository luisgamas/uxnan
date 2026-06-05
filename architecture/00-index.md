# Uxnan — Documentación Técnica (Especificación Móvil)

> **Versión:** 1.1.0  
> **Fecha:** 2026-06-05  
> **Estado:** Definición inicial — borrador técnico completo  
> **Plataformas objetivo:** Android (principal), iOS (principal)  
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod 3.x (manual)  
> **Monorepo:** Este directorio (`architecture/`) contiene la especificación PRD+SRS de la app móvil Flutter.

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

> Esta sección registra el avance de implementación frente a la especificación; se actualiza con cada incremento. La rama de trabajo de la app móvil es `uxnanmobile`. El detalle por incremento vive en `uxnanmobile/CHANGELOG.md`.

**uxnanmobile (Flutter) — rama `uxnanmobile`:**

| Área | Estado | Notas |
|---|---|---|
| Bootstrap (Android+iOS, package Dart `uxnan`, bundle `com.uxnan.mobile`) | ✅ Hecho | `flutter analyze` sin issues; `minSdk` 24, iOS 15 |
| Estructura de capas (`core/`, `domain/`, `application/`, `infrastructure/`, `presentation/`) | ✅ Hecho | Ver 02a §7 |
| Capa `core/` (constantes de protocolo, errores tipados, extensiones, logger/debouncer) | ✅ Hecho | — |
| Enums de dominio | ✅ Hecho | 02a §5.1.2 |
| Sistema visual M3 (tokens + tema dark-first) | ✅ Hecho | 02c §3.1 |
| Arranque (`main`/`app`/router), i18n (en/es) | ✅ Hecho | — |
| Persistencia drift (esquema completo de 7 tablas + `UxnanDatabase`) | ✅ Hecho | 02c §10 |
| Repositorios drift: `Thread`, `ComposerDraft` (+ providers DI) | ✅ Hecho | `Message`/`Turn`/`Project`/`TrustedDevice` diferidos a su módulo |
| Gestión de estado | Riverpod **3.x** manual | Decisión 2026-06-05 (ver abajo); API `Notifier`/`NotifierProvider` |
| Primitivas crypto E2EE (key gen, handshake Ed25519/X25519/HKDF, envelope AES-256-GCM, fingerprint) | ✅ Hecho | 02a §5.9; verificado con vectores RFC/NIST |
| Transporte seguro (WebSocket, seq/replay, correlación, selección LAN/relay) + orquestación `SessionCoordinator` | ⏳ Pendiente | Próximo módulo (02a §5.9.2–5.9.4) |
| Pairing/onboarding · conversación/streaming · Git · push | ⏳ Pendiente | — |

> **Decisión de gestión de estado (2026-06-05):** el proyecto usa **Riverpod 3.x** manual (no 2.x). Los ejemplos de la especificación que usan `StateNotifierProvider` (API 2.x) se adaptan a la API moderna `Notifier`/`NotifierProvider`/`AsyncNotifierProvider`. Sigue sin usarse `riverpod_generator`.

---

## Estructura del Monorepo

El proyecto Uxnan está organizado como un monorepo que agrupa todos los componentes del ecosistema:

```
uxnan/                           # Monorepo raíz
├── architecture/                # Documentación de arquitectura del ecosistema (especificación móvil)
├── architecture.old/            # Whitepapers originales como referencia histórica
├── uxnanmobile/                 # Proyecto Flutter (Android + iOS)
├── bridge/                      # Node.js daemon para PC (standalone)
├── uxnandesktop/                # App de escritorio ADE (Tauri 2 + Rust + Svelte 5)
├── relay/                       # Node.js relay server
├── shared/                      # Contratos compartidos (tipos, JSON-RPC schemas)
└── README.md
```

| Carpeta | Descripción |
|---|---|
| `architecture/` | Contiene la especificación completa (PRD + SRS) de la app móvil Flutter: visión del producto, arquitectura del sistema, contratos, guía de implementación y referencia técnica. Es el directorio donde se encuentra este índice. |
| `architecture.old/` | Contiene los whitepapers originales (`architect-mobile.md` y `architect-desktop.md`) como referencia histórica. Estos documentos precedieron la reorganización actual y se conservan para trazabilidad. |
| `uxnanmobile/` | Proyecto Flutter que implementa la app móvil de Uxnan para Android e iOS. Su especificación técnica vive en `architecture/`. |
| `bridge/` | Daemon Node.js para PC que actúa como puente entre la app móvil y los recursos de la computadora (Git, sistema de archivos, terminal). Es un componente standalone que también puede integrarse dentro de la app de escritorio (`uxnandesktop/`). |
| `uxnandesktop/` | App de escritorio ADE (Agente de Desarrollo Embarcado) construida con Tauri 2, Rust y Svelte 5. Contiene su propia documentación técnica en `uxnandesktop/architecture/`. |
| `relay/` | Servidor relay Node.js que facilita la comunicación entre la app móvil y el bridge/desktop cuando no hay conexión directa en red local. |
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

> **Nota:** Este índice y los documentos de `architecture/` son la fuente de verdad para la especificación de la app móvil Uxnan. Para la app de escritorio, consultar la documentación técnica en `uxnandesktop/architecture/`. Los whitepapers originales se conservan en `architecture.old/`.
