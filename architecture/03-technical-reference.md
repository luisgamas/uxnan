# Uxnan — Guia de Referencia Tecnica

> **Version:** 1.0.0
> **Fecha:** 2026-06-04
> **Estado:** Documento activo — se actualiza con cada cambio arquitectonico relevante
> **Plataformas objetivo:** Android (principal), iOS (principal)
> **Stack:** Flutter / Dart, Clean Architecture, Riverpod

> Este documento forma parte de la documentacion tecnica de Uxnan. Ver tambien: [01-product-vision.md](01-product-vision.md) | [02-technical-specification.md](02-technical-specification.md)

---

## Tabla de contenidos

1. [Convenciones de codigo del proyecto](#1-convenciones-de-codigo-del-proyecto)
   - [1.1 Nomenclatura de archivos](#11-nomenclatura-de-archivos)
   - [1.2 Organizacion de widgets](#12-organizacion-de-widgets)
   - [1.3 Nomenclatura de providers (Riverpod 3.x manual)](#13-nomenclatura-de-providers-riverpod-3x-manual)
   - [1.4 Convenciones de commits (Conventional Commits)](#14-convenciones-de-commits-conventional-commits)
   - [1.5 Reglas de imports entre capas](#15-reglas-de-imports-entre-capas)
   - [1.6 lib/core/ vs lib/domain/](#16-libcore-vs-libdomain)
2. [Flujos de autenticacion por agente](#2-flujos-de-autenticacion-por-agente)
   - [2.1 Flujo generico de autenticacion](#21-flujo-generico-de-autenticacion)
   - [2.2 Flujos especificos por agente](#22-flujos-especificos-por-agente)
   - [2.3 Pantallas y componentes de UI para autenticacion](#23-pantallas-y-componentes-de-ui-para-autenticacion)
3. [Variables de entorno y configuracion del proyecto desde cero](#3-variables-de-entorno-y-configuracion-del-proyecto-desde-cero)
   - [3.1 Estructura del main.dart](#31-estructura-del-maindart)
   - [3.2 Estructura del app.dart](#32-estructura-del-appdart)
   - [3.3 Flavors (dev/staging/prod)](#33-flavors-devstagingprod)
   - [3.4 Configuracion de Firebase](#34-configuracion-de-firebase)
   - [3.5 Variables de entorno del Bridge](#35-variables-de-entorno-del-bridge)
   - [3.6 Secuencia de DI wiring en el primer arranque](#36-secuencia-de-di-wiring-en-el-primer-arranque)
4. [Consideraciones de plataforma Android vs iOS](#4-consideraciones-de-plataforma-android-vs-ios)
5. [Criterios de calidad](#5-criterios-de-calidad)
6. [Guia de contribucion al bridge](#6-guia-de-contribucion-al-bridge)
7. [Glosario tecnico](#7-glosario-tecnico)

---

## 1. Convenciones de codigo del proyecto

Esta seccion define las convenciones que todo el equipo debe seguir al escribir codigo en el proyecto Uxnan. El objetivo es mantener consistencia, facilitar code reviews y reducir la friccion de onboarding para nuevos contribuidores.

### 1.1 Nomenclatura de archivos

Todo archivo Dart sigue la convencion `snake_case.dart`. No se usan guiones, camelCase ni PascalCase en nombres de archivo.

| Categoria | Patron | Ejemplos |
|---|---|---|
| Archivos de codigo general | `snake_case.dart` | `session_coordinator.dart`, `thread_manager.dart`, `incoming_message_processor.dart` |
| Archivos de test | `<nombre>_test.dart` | `session_coordinator_test.dart`, `thread_manager_test.dart` |
| Archivos generados (drift) | `<nombre>.g.dart` | `local_database.g.dart` |
| Archivos generados (freezed) | `<nombre>.freezed.dart` | `thread.freezed.dart`, `message.freezed.dart` |
| Tablas de base de datos (drift) | `<nombre>_table.dart` | `threads_table.dart`, `messages_table.dart`, `trusted_devices_table.dart` |
| Entidades de dominio | Sustantivo en singular | `thread.dart`, `message.dart`, `project.dart`, `turn.dart`, `secure_session.dart` |
| Value objects | Sustantivo descriptivo | `rpc_message.dart`, `text_fingerprint.dart`, `context_window_usage.dart` |
| Enumeraciones | Sustantivo o adjetivo | `agent_id.dart`, `connection_phase.dart`, `turn_status.dart` |
| Repositorios (interfaz) | `i_<nombre>_repository.dart` (dentro de `domain/repositories/`) | Uso alternativo aceptado: nombre sin prefijo `i_` si la interfaz es la clase abstracta directa |
| Repositorios (implementacion) | `drift_<nombre>_repository.dart` o `<tecnologia>_<nombre>_repository.dart` | `drift_thread_repository.dart`, `secure_storage_session_repository.dart` |
| Adaptadores de plataforma | `<nombre>_adapter.dart` | `qr_scanner_adapter.dart`, `push_notification_adapter.dart`, `haptic_adapter.dart` |
| Constantes | `<dominio>_constants.dart` | `protocol_constants.dart`, `app_constants.dart` |
| Extensiones | `<tipo>_ext.dart` | `string_ext.dart`, `datetime_ext.dart`, `uint8list_ext.dart` |

**Regla general:** el nombre del archivo debe reflejar la clase o concepto principal que contiene. Un archivo = una clase publica principal (excepto clases auxiliares estrechamente relacionadas).

### 1.2 Organizacion de widgets

La capa de presentacion organiza los widgets por pantalla, con sub-widgets colocados junto a su pantalla padre. Los widgets reutilizables viven en `lib/presentation/widgets/`.

#### Convenciones de nombrado por tipo de widget

| Tipo de widget | Patron de archivo | Patron de clase | Ejemplo |
|---|---|---|---|
| Pantalla principal | `<nombre>_screen.dart` | `<Nombre>Screen` (`StatelessWidget` o `ConsumerWidget`) | `conversation_screen.dart` / `ConversationScreen` |
| View model de pantalla | `<nombre>_view_model.dart` | `<Nombre>ViewModel` (`StateNotifier`) | `conversation_view_model.dart` / `ConversationViewModel` |
| Widget reutilizable | `<nombre>_widget.dart` o nombre descriptivo | `<Nombre>Widget` o nombre descriptivo | `connection_status_indicator.dart` / `ConnectionStatusIndicator` |
| Bottom sheet | `<nombre>_sheet.dart` | `<Nombre>Sheet` | `branch_selector_sheet.dart` / `BranchSelectorSheet` |
| Dialogo | `<nombre>_dialog.dart` | `<Nombre>Dialog` | `update_prompt_dialog.dart` / `UpdatePromptDialog` |
| Card | `<nombre>_card.dart` | `<Nombre>Card` | `command_execution_card.dart` / `CommandExecutionCard` |
| Overlay | `<nombre>_overlay.dart` | `<Nombre>Overlay` | `worktree_handoff_overlay.dart` / `WorktreeHandoffOverlay` |
| Renderer especializado | `<nombre>_renderer.dart` | `<Nombre>Renderer` | `markdown_renderer.dart` / `MarkdownRenderer` |

#### Estructura de carpetas por pantalla

Cada pantalla vive en su propia carpeta dentro de `lib/presentation/screens/`. Los sub-widgets que solo se usan en esa pantalla se colocan como archivos hermanos o en subcarpetas tematicas:

```
lib/presentation/screens/conversation/
├── conversation_screen.dart          # pantalla principal
├── conversation_view_model.dart      # view model de la pantalla
├── timeline/
│   ├── timeline_widget.dart
│   ├── timeline_reducer.dart
│   └── timeline_snapshot.dart
├── messages/
│   ├── message_renderer.dart
│   ├── markdown_renderer.dart
│   ├── code_block_widget.dart
│   └── command_execution_card.dart
├── composer/
│   ├── composer_widget.dart
│   ├── attachment_picker.dart
│   └── mention_autocomplete.dart
└── git/
    ├── git_actions_toolbar.dart
    ├── diff_viewer.dart
    └── branch_selector_sheet.dart
```

**Regla:** un widget se promueve a `lib/presentation/widgets/` solo cuando lo usan dos o mas pantallas distintas. Hasta entonces, permanece colocado junto a su pantalla.

**Una pantalla, un Screen:** cada archivo `*_screen.dart` contiene exactamente un `StatelessWidget` o `ConsumerWidget` que representa la pantalla completa. No se colocan multiples pantallas en el mismo archivo.

### 1.3 Nomenclatura de providers (Riverpod 3.x manual)

El proyecto utiliza Riverpod 3.x con declaracion manual de providers (sin code generation). Esto permite control explicito sobre el ciclo de vida, la inyeccion de dependencias y el naming.

> **Nota (Riverpod 3.x, 2026-06-05):** los ejemplos de esta sección que usan `StateNotifierProvider` corresponden a la API 2.x; en 3.x se sustituyen por `NotifierProvider` / `AsyncNotifierProvider` (clases `Notifier` / `AsyncNotifier`). Los `Provider`, `StreamProvider`, `FutureProvider` y `*.family` se mantienen igual. Ya implementados con este patrón: `databaseProvider`, `threadRepositoryProvider`, `composerDraftRepositoryProvider` y `appRouterProvider`.

#### Patron general

```dart
final <nombre>Provider = <TipoProvider>((ref) => ...);
```

El nombre del provider siempre termina en `Provider` y usa `camelCase`.

#### Tipos de providers segun ciclo de vida

| Ciclo de vida | Tipo de provider | Uso |
|---|---|---|
| Singleton / keepAlive | `Provider`, `StateNotifierProvider` | Servicios que viven toda la sesion de la app: repositorios, coordinadores, managers |
| Efimero / autoDispose | `Provider.autoDispose`, `StreamProvider.autoDispose` | Estado de UI que debe liberarse al salir de la pantalla |
| Familia parametrizada | `<Tipo>.family<Resultado, Parametro>` | Providers que dependen de un parametro (ej. threadId) |

#### Convenciones por capa

**Providers de infraestructura (singletons):**

```dart
// lib/presentation/providers/infrastructure_providers.dart

// Base de datos
final databaseProvider = Provider<UxnanDatabase>((ref) => UxnanDatabase());

// Almacenamiento seguro
final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

// Repositorios
final threadRepositoryProvider = Provider<IThreadRepository>((ref) =>
    DriftThreadRepository(ref.watch(databaseProvider)));

final messageRepositoryProvider = Provider<IMessageRepository>((ref) =>
    DriftMessageRepository(ref.watch(databaseProvider)));

final trustedDeviceRepositoryProvider = Provider<ITrustedDeviceRepository>((ref) =>
    DriftTrustedDeviceRepository(ref.watch(databaseProvider)));
```

**Providers de aplicacion (coordinadores y managers):**

```dart
// lib/presentation/providers/application_providers.dart

final sessionCoordinatorProvider = Provider<SessionCoordinator>((ref) =>
    SessionCoordinator(
      trustedDeviceRepo: ref.watch(trustedDeviceRepositoryProvider),
      secureSessionRepo: ref.watch(secureSessionRepositoryProvider),
      secureStore: ref.watch(secureStoreProvider),
    ));

final threadManagerProvider = Provider<ThreadManager>((ref) =>
    ThreadManager(
      threadRepo: ref.watch(threadRepositoryProvider),
      messageRepo: ref.watch(messageRepositoryProvider),
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    ));

final gitActionManagerProvider = Provider<GitActionManager>((ref) =>
    GitActionManager(
      sessionCoordinator: ref.watch(sessionCoordinatorProvider),
    ));
```

**Providers de estado derivado (UI):**

```dart
// lib/presentation/providers/ui_providers.dart

// Stream de estado de conexion
final connectionPhaseProvider = StreamProvider<ConnectionPhase>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.connectionPhaseStream;
});

// Threads reactivos
final threadsProvider = StreamProvider<List<Thread>>((ref) {
  final threadManager = ref.watch(threadManagerProvider);
  return threadManager.threadsStream;
});

// Timeline por thread (family)
final timelineProvider = FutureProvider.autoDispose
    .family<TurnTimelineSnapshot, String>((ref, threadId) async {
  final threadManager = ref.watch(threadManagerProvider);
  return threadManager.getTimeline(threadId);
});

// Auth status por agente (family)
final authStatusProvider = FutureProvider.autoDispose
    .family<AuthStatus, String>((ref, agentId) async {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  return coordinator.getAuthStatus(agentId);
});
```

#### Ubicacion de archivos de providers

| Tipo | Ubicacion |
|---|---|
| Providers de UI (estado derivado, view models) | `lib/presentation/providers/` |
| Providers de infraestructura (repositorios, adapters) | `lib/presentation/providers/infrastructure_providers.dart` |
| Providers de aplicacion (coordinadores, managers) | `lib/presentation/providers/application_providers.dart` |

**Nota:** los providers viven en `presentation/` porque Riverpod es una herramienta de la capa de presentacion. Los coordinadores y managers son de la capa de aplicacion, pero sus providers se declaran en presentacion para que los widgets puedan consumirlos.

### 1.4 Convenciones de commits (Conventional Commits)

Todos los commits siguen el formato [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<scope>): <descripcion>
```

#### Tipos permitidos

| Tipo | Significado |
|---|---|
| `feat` | Nueva funcionalidad visible para el usuario |
| `fix` | Correccion de un bug |
| `refactor` | Cambio de estructura sin cambiar comportamiento |
| `docs` | Cambios en documentacion |
| `test` | Adicion o modificacion de tests |
| `chore` | Tareas de mantenimiento (dependencias, configuracion) |
| `perf` | Mejora de rendimiento |
| `ci` | Cambios en pipelines de CI/CD |
| `build` | Cambios en el sistema de build (pubspec, gradle, Podfile) |

#### Scopes del proyecto

| Scope | Area del sistema |
|---|---|
| `domain` | Capa de dominio: entidades, value objects, enums, interfaces de repositorio |
| `infra` | Capa de infraestructura: repositorios concretos, transporte, storage, crypto |
| `ui` | Capa de presentacion: pantallas, widgets, providers, theme, router |
| `bridge` | Bridge daemon (Node.js): adapters, handlers, estado |
| `relay` | Relay server (Node.js, opcional / self-hosted; solo como fallback off-LAN) |
| `transport` | Transporte seguro: WebSocket, SecureTransport, handshake |
| `crypto` | Criptografia: key generation, envelope crypto, handshake crypto |
| `git` | Integracion Git: handler, modelos, UI de Git |
| `pairing` | Modulo de pairing y onboarding |
| `ssh` | Terminal SSH |

#### Ejemplos

```
feat(transport): add WebSocket reconnection with exponential backoff
fix(crypto): correct HKDF salt concatenation order
refactor(ui): extract ConnectionStatusIndicator to shared widgets
docs: update technical reference with auth flows
test(domain): add unit tests for ThreadManager
chore: bump flutter_riverpod to 2.5.1
perf(ui): virtualize timeline list for 100+ messages
ci: add iOS release build to GitHub Actions
build: configure drift code generation in build.yaml
feat(bridge): add pi-agent adapter
fix(relay): prevent duplicate push on rapid reconnect
```

#### Breaking changes

Se indican con `!` despues del scope:

```
feat(transport)!: change handshake protocol to v2
```

Y opcionalmente con un footer `BREAKING CHANGE:` en el cuerpo del commit:

```
feat(transport)!: change handshake protocol to v2

BREAKING CHANGE: el campo `protocolVersion` ahora es obligatorio en clientHello.
Los bridges anteriores a v1.2.0 no son compatibles.
```

### 1.5 Reglas de imports entre capas

La arquitectura Clean Architecture impone restricciones estrictas sobre que capa puede importar de otra. Estas reglas se verifican mediante analisis estatico y code review.

```
┌─────────────────────────────────────────────────┐
│                  presentation/                   │
│  Puede importar: domain/, application/           │
│  NO importa: infrastructure/                     │
├─────────────────────────────────────────────────┤
│                  application/                    │
│  Puede importar: domain/                         │
│  NO importa: infrastructure/, presentation/      │
├─────────────────────────────────────────────────┤
│                 infrastructure/                  │
│  Puede importar: domain/                         │
│  NO importa: application/, presentation/         │
├─────────────────────────────────────────────────┤
│                    domain/                       │
│  NO importa: infrastructure/, application/,      │
│              presentation/                       │
├─────────────────────────────────────────────────┤
│                     core/                        │
│  NO importa: ninguna otra capa                   │
│  (puede ser importado por todas las capas)       │
└─────────────────────────────────────────────────┘
```

#### Reglas en detalle

| Capa | Puede importar | NO puede importar |
|---|---|---|
| `domain/` | Nada de otras capas (Dart puro) | `infrastructure/`, `application/`, `presentation/` |
| `application/` | `domain/` | `infrastructure/`, `presentation/` |
| `infrastructure/` | `domain/` (implementa interfaces de repositorio) | `application/`, `presentation/` |
| `presentation/` | `domain/`, `application/` (via providers) | `infrastructure/` directamente |
| `core/` | Ninguna otra capa | Todas las demas capas |

#### Principio fundamental

La capa de `presentation/` **nunca** importa `infrastructure/` directamente. La conexion entre presentacion e infraestructura se realiza a traves de:

1. Interfaces de repositorio definidas en `domain/`
2. Implementaciones concretas en `infrastructure/`
3. Providers en `presentation/providers/` que instancian las implementaciones y las exponen como las interfaces

```dart
// CORRECTO: el provider instancia la implementacion concreta
final threadRepositoryProvider = Provider<IThreadRepository>((ref) =>
    DriftThreadRepository(ref.watch(databaseProvider)));

// INCORRECTO: un widget importa directamente la implementacion
// import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
```

#### Formato de imports

Todos los imports usan la forma de paquete completo:

```dart
// CORRECTO
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/core/constants/protocol_constants.dart';

// INCORRECTO (imports relativos)
import '../../../domain/entities/thread.dart';
import '../../managers/thread_manager.dart';
```

### 1.6 lib/core/ vs lib/domain/

Estos dos directorios pueden generar confusion porque ambos contienen codigo "base" del proyecto. La distincion es conceptual:

#### `lib/core/` — Utilidades transversales

Contiene codigo que **no modela ningun concepto de negocio**. Son herramientas genericas que podrian usarse en cualquier proyecto Flutter:

```
lib/core/
├── constants/
│   ├── protocol_constants.dart       # SECURE_PROTOCOL_VERSION, HKDF_INFO_TAG, etc.
│   └── app_constants.dart            # timeouts, tamanios de pagina, limites
├── errors/
│   ├── app_exception.dart            # excepciones base de la app
│   ├── rpc_exception.dart            # errores de protocolo JSON-RPC
│   └── transport_exception.dart      # errores de transporte WebSocket
├── extensions/
│   ├── string_ext.dart               # extensiones sobre String
│   ├── datetime_ext.dart             # extensiones sobre DateTime
│   └── uint8list_ext.dart            # extensiones sobre Uint8List (hex, base64)
└── utils/
    ├── logger.dart                   # logger estructurado de la app
    └── debouncer.dart                # debouncer generico
```

Caracteristicas de `core/`:
- No importa nada de `domain/`, `application/`, `infrastructure/` ni `presentation/`
- No contiene Flutter imports (excepto `foundation.dart` si es necesario para `Uint8List`)
- Es agnostico al dominio y a la infraestructura
- Puede ser importado por **todas** las capas

#### `lib/domain/` — Modelos y reglas de negocio

Contiene codigo que **modela conceptos del dominio de Uxnan**: threads, mensajes, sesiones, dispositivos de confianza, Git, workspaces. Es el vocabulario del sistema:

```
lib/domain/
├── entities/           # Thread, Message, Turn, Project, TrustedDevice, SecureSession, ...
├── value_objects/      # RpcMessage, TextFingerprint, ContextWindowUsage, JsonValue, ...
├── enums/              # MessageRole, TurnStatus, ConnectionPhase, AgentId, ...
├── repositories/       # IThreadRepository, IMessageRepository, ITrustedDeviceRepository, ...
└── usecases/           # ConnectToBridge, SendMessage, GetGitStatus, StartPairing, ...
```

Caracteristicas de `domain/`:
- Dart puro: **no** depende de Flutter ni de ningun paquete externo
- Define interfaces (repositorios, adaptadores) que `infrastructure/` implementa
- Puede importar `core/` para utilidades
- Es importado por `application/`, `infrastructure/` y `presentation/`

#### Regla de decision

| Pregunta | Respuesta | Ubicacion |
|---|---|---|
| Modela un concepto de negocio de Uxnan? | Si | `domain/` |
| Es una utilidad/helper generica? | Si | `core/` |
| Es una entidad, value object o enum del dominio? | Si | `domain/` |
| Es una constante de protocolo o limite tecnico? | Si | `core/constants/` |
| Es una excepcion especifica del protocolo de comunicacion? | Si | `core/errors/` |
| Es una extension sobre un tipo basico de Dart? | Si | `core/extensions/` |
| Es una interfaz de repositorio? | Si | `domain/repositories/` |
| Es un use case? | Si | `domain/usecases/` |

> **Nota:** este proyecto usa `core/` para utilidades transversales. En proyectos que siguen la convencion `config/`, el contenido equivalente se ubicaria en `config/`.

---

## 2. Flujos de autenticacion por agente

Uxnan soporta multiples agentes de codificacion, cada uno con su propio mecanismo de autenticacion. El principio fundamental es que **la autenticacion siempre ocurre en la PC** (a traves del bridge), nunca en el movil. Los tokens, API keys y credenciales **jamas** llegan a la app movil: el bridge sanitiza toda la informacion de autenticacion antes de enviarla al telefono.

### 2.1 Flujo generico de autenticacion

Independientemente del agente, el flujo de autenticacion sigue este patron:

```
[App]       Se conecta al bridge (handshake E2EE completo)
[App]       ConnectionPhase -> connected
[App]       Llama getAuthStatus para el agente activo del proyecto actual
                ↓
[Bridge]    account-status.js genera snapshot sanitizado:
            {
              agentId: "<id>",
              requiresLogin: <bool>,
              loginInProgress: <bool>,
              authenticatedProvider: "<provider>" | null,
              displayName: "<email o nombre>" | null,
              transportMode: "local",
              platform: "<darwin|win32|linux>"
            }
                ↓
[App]       Recibe AuthStatus (nunca contiene tokens ni keys)
                ↓
            ┌─ requiresLogin == false ──→ Flujo normal: cargar threads, conversaciones
            │
            └─ requiresLogin == true  ──→ Mostrar indicador de auth requerida en UI
                                          Instrucciones: "Complete el login en su PC"
                                          Esperar notificacion stream/auth/updated
```

#### Metodos JSON-RPC involucrados

| Metodo | Direccion | Descripcion |
|---|---|---|
| `getAuthStatus` | App -> Bridge | Obtiene el estado de autenticacion sanitizado del agente activo |
| `account/read` | App -> Bridge | Lee el estado de cuenta del agente (sanitizado) |
| `account/login/start` | App -> Bridge | Inicia el flujo de login en la PC (el bridge abre el navegador o solicita la key) |
| `account/login/cancel` | App -> Bridge | Cancela un login en progreso |
| `account/logout` | App -> Bridge | Cierra la sesion del agente |
| `stream/auth/updated` | Bridge -> App | Notificacion cuando el estado de auth cambia (login completado, logout, etc.) |

#### Principio de sanitizacion

El archivo `account-status.js` del bridge es responsable de garantizar que **ningun** campo del snapshot contenga informacion sensible:

- Tokens OAuth: eliminados
- API keys: eliminadas
- Refresh tokens: eliminados
- Solo se expone: `agentId`, `requiresLogin`, `loginInProgress`, `authenticatedProvider`, `displayName`, `transportMode`, `platform`

Si un adaptador de agente retorna informacion de auth que contiene datos sensibles, `account-status.js` los filtra antes de construir el payload de respuesta. Esta sanitizacion es **obligatoria** para todos los adaptadores, incluidos los custom.

### 2.2 Flujos especificos por agente

#### 2.2.1 Codex (OpenAI) — OAuth

Codex utiliza autenticacion OAuth con la plataforma de OpenAI. El flujo es interactivo y requiere un navegador en la PC.

```
[App]       getAuthStatus -> { requiresLogin: true, agentId: "codex" }
[App]       Muestra: "Autenticacion requerida — Inicie sesion con OpenAI en su PC"
[App]       Llama account/login/start { agentId: "codex" }
                ↓
[Bridge]    codex-adapter.js inicia flujo OAuth
[Bridge]    Abre navegador en la PC con URL de autorizacion de OpenAI
[PC]        Usuario inicia sesion en openai.com en el navegador
[PC]        OpenAI redirige con token OAuth al bridge local
                ↓
[Bridge]    Recibe token OAuth, lo almacena localmente (NUNCA lo envia al movil)
[Bridge]    Emite notificacion:
            stream/auth/updated {
              agentId: "codex",
              requiresLogin: false,
              authenticatedProvider: "openai",
              displayName: "dev@example.com"
            }
                ↓
[App]       Recibe stream/auth/updated
[App]       Actualiza authStatusProvider
[App]       Oculta indicador de auth requerida
[App]       Muestra: "Conectado como dev@example.com"
[App]       Procede a cargar threads y conversaciones
```

**Estado en la UI durante el login:** la app muestra el texto "Esperando inicio de sesion en su PC..." con un indicador de actividad. Si el usuario cancela, la app llama `account/login/cancel`.

#### 2.2.2 OpenCode — API Key

OpenCode soporta multiples proveedores de LLM (Anthropic, OpenAI, Gemini, Bedrock, Groq, Azure, OpenRouter). La autenticacion es por API key, configurada en los ajustes del proyecto en la PC.

```
[App]       getAuthStatus -> { requiresLogin: true, agentId: "opencode" }
[App]       Muestra: "Configure la API key del proveedor en su PC"
                ↓
[Bridge]    La key se configura en las variables de entorno de la PC
            o en el archivo de configuracion del proyecto.
            Ejemplos:
            - ANTHROPIC_API_KEY (si el provider es Anthropic)
            - OPENAI_API_KEY (si el provider es OpenAI)
            - GOOGLE_API_KEY (si el provider es Google)
                ↓
[PC]        Usuario configura la variable de entorno o archivo de config
[Bridge]    Detecta que la key esta disponible (healthCheck del adapter)
[Bridge]    Emite: stream/auth/updated {
              agentId: "opencode",
              requiresLogin: false,
              authenticatedProvider: "anthropic",  // o el provider configurado
              displayName: null
            }
                ↓
[App]       Recibe stream/auth/updated
[App]       Muestra: "Conectado via Anthropic"
```

**Nota:** la API key configurada en la PC **nunca** se transmite al movil. La app solo conoce el nombre del proveedor (`authenticatedProvider`), no la credencial en si.

El campo `agentConfig.apiKeyEnvVar` en la configuracion del proyecto indica que variable de entorno buscar (ej. `"ANTHROPIC_API_KEY"`), pero ese valor es resuelto unicamente por el bridge.

#### 2.2.3 Claude Code (Anthropic) — OAuth o API Key

Claude Code soporta dos mecanismos de autenticacion:

**Opcion A: OAuth via claude.ai**

```
[App]       getAuthStatus -> { requiresLogin: true, agentId: "claude-code" }
[App]       Muestra: "Autenticacion requerida — Inicie sesion con Anthropic en su PC"
[App]       Llama account/login/start { agentId: "claude-code" }
                ↓
[Bridge]    claude-code-adapter.js inicia flujo OAuth
[Bridge]    Abre navegador en la PC con URL de autorizacion de claude.ai
[PC]        Usuario inicia sesion en claude.ai
[PC]        Anthropic redirige al bridge local con token
                ↓
[Bridge]    Almacena token localmente
[Bridge]    Emite: stream/auth/updated {
              agentId: "claude-code",
              requiresLogin: false,
              authenticatedProvider: "anthropic",
              displayName: "user@example.com"
            }
```

**Opcion B: API Key (ANTHROPIC_API_KEY)**

```
[PC]        Usuario configura ANTHROPIC_API_KEY en su entorno
[Bridge]    claude-code-adapter.js detecta la key en el entorno
[Bridge]    Emite: stream/auth/updated {
              agentId: "claude-code",
              requiresLogin: false,
              authenticatedProvider: "anthropic-api-key",
              displayName: null
            }
```

En ambos casos, el bridge maneja el flujo localmente y la app solo recibe el estado sanitizado.

#### 2.2.4 Gemini CLI (Google) — API Key

Gemini CLI utiliza una Google API Key configurada en el entorno de la PC. No tiene flujo de login interactivo.

```
[App]       getAuthStatus -> { requiresLogin: true, agentId: "gemini-cli" }
[App]       Muestra: "Configure GOOGLE_API_KEY en su PC"
                ↓
[PC]        Usuario configura GOOGLE_API_KEY en su entorno
[Bridge]    gemini-cli-adapter.js detecta la key
[Bridge]    Emite: stream/auth/updated {
              agentId: "gemini-cli",
              requiresLogin: false,
              authenticatedProvider: "google",
              displayName: null
            }
```

**Nota:** Gemini CLI es open-source y puede integrarse con Gemini Code Assist. La API key se obtiene desde Google AI Studio o Google Cloud Console.

#### 2.2.5 pi-agent (earendil-works/pi) — API Key multi-proveedor

pi-agent soporta multiples proveedores de LLM (Anthropic, OpenAI, Google, etc.). La API key se configura en la configuracion del proyecto, especificamente en `agentConfig`.

```
[App]       getAuthStatus -> { requiresLogin: true, agentId: "pi-agent" }
[App]       Muestra: "Configure la API key del proveedor en su PC"
                ↓
[PC]        Usuario configura la key correspondiente al proveedor:
            - ANTHROPIC_API_KEY (si usa Anthropic)
            - OPENAI_API_KEY (si usa OpenAI)
            - GOOGLE_API_KEY (si usa Google)
            La key se configura en el entorno o en agentConfig del proyecto
                ↓
[Bridge]    pi-agent-adapter.js detecta que la key esta disponible
[Bridge]    Emite: stream/auth/updated {
              agentId: "pi-agent",
              requiresLogin: false,
              authenticatedProvider: "anthropic",  // o el proveedor configurado
              displayName: null
            }
```

#### 2.2.6 Resumen comparativo

| Agente | Mecanismo de auth | Interaccion requerida en PC | Tokens llegan al movil |
|---|---|---|---|
| **Codex** | OAuth (OpenAI) | Si: login en navegador | No, nunca |
| **OpenCode** | API Key (multi-proveedor) | No interactivo: configurar env var | No, nunca |
| **Claude Code** | OAuth (claude.ai) o API Key | Si (OAuth) o no (API key) | No, nunca |
| **Gemini CLI** | API Key (Google) | No interactivo: configurar env var | No, nunca |
| **pi-agent** | API Key (multi-proveedor) | No interactivo: configurar env var o agentConfig | No, nunca |

### 2.3 Pantallas y componentes de UI para autenticacion

#### No existe una pantalla de login dedicada

La autenticacion en Uxnan no es un flujo de la app movil, sino de la PC. Por lo tanto:

- **No hay** un `LoginScreen` ni un formulario de credenciales en la app
- **No hay** campos de texto para API keys en la app
- **No hay** botones de "Iniciar sesion con Google/OpenAI/Anthropic" en la app

La autenticacion se gestiona a traves de indicadores de estado integrados en las pantallas existentes.

#### Componentes de UI para auth

**1. Indicador en la ConversationScreen:**

El estado de autenticacion se muestra como un banner o badge en el AppBar de la `ConversationScreen`:

```dart
// En el AppBar de ConversationScreen
// Si requiresLogin == true:
//   - Badge de color warning en el titulo
//   - Subtitulo: "Autenticacion requerida"
// Si authenticatedProvider != null:
//   - Badge de color success
//   - Subtitulo: "Conectado via <provider>"
```

**2. Card informativa de auth requerida:**

Cuando `requiresLogin: true`, se muestra una card informativa dentro de la conversation con instrucciones especificas para cada agente:

```dart
// AuthRequiredCard — widget dentro de la timeline o como banner superior
// Contenido dinamico segun el agente:

// Para Codex (OAuth):
//   titulo: "Complete el login en su PC"
//   subtitulo: "Abra el navegador en su PC e inicie sesion con OpenAI"
//   accion: boton "Iniciar login" que llama account/login/start

// Para agentes con API key (OpenCode, Gemini CLI, pi-agent):
//   titulo: "Configure la API key en su PC"
//   subtitulo: "Ejecute en su terminal: export <API_KEY_VAR>=<su-key>"
//   sin boton de accion (no hay flujo interactivo)

// Para Claude Code:
//   titulo: "Complete el login en su PC"
//   subtitulo: "Inicie sesion con Anthropic o configure ANTHROPIC_API_KEY"
//   accion: boton "Iniciar login" que llama account/login/start
```

**3. Actualizacion reactiva:**

La app escucha la notificacion `stream/auth/updated` del bridge. Cuando llega:

1. Se actualiza el `authStatusProvider` (invalidacion reactiva via Riverpod)
2. Los widgets que dependen del provider se reconstruyen automaticamente
3. El banner/card de auth requerida desaparece
4. El indicador del AppBar cambia a estado conectado
5. Se procede a cargar los threads del agente

```dart
// En el procesamiento de mensajes entrantes:
// IncomingMessageProcessor clasifica stream/auth/updated como AuthStatusEvent
// El provider se invalida y los consumidores se actualizan reactivamente

ref.listen(authStatusProvider(agentId), (previous, next) {
  next.when(
    data: (status) {
      if (!status.requiresLogin && previous?.value?.requiresLogin == true) {
        // Auth completada: cargar threads
        ref.read(threadManagerProvider).loadThreads();
      }
    },
    loading: () {},
    error: (_, __) {},
  );
});
```

---

## 3. Variables de entorno y configuracion del proyecto desde cero

Esta seccion documenta todo lo necesario para configurar el proyecto Flutter de Uxnan desde cero, incluyendo la estructura de arranque, flavors de compilacion, Firebase, variables de entorno del bridge y la secuencia de inyeccion de dependencias.

### 3.1 Estructura del main.dart

El entrypoint de la app inicializa los servicios core antes de montar el arbol de widgets. El orden de inicializacion es critico.

```dart
// lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:uxnan/app.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Firebase initialization (requerido para push notifications)
  await Firebase.initializeApp();

  // 2. Database initialization (drift/SQLite)
  final database = UxnanDatabase();

  // 3. ProviderScope con overrides para servicios pre-inicializados
  runApp(
    ProviderScope(
      overrides: [
        databaseProvider.overrideWithValue(database),
      ],
      child: const UxnanApp(),
    ),
  );
}
```

**Notas sobre el orden de inicializacion:**

1. `WidgetsFlutterBinding.ensureInitialized()` es obligatorio antes de cualquier operacion asincrona en `main()`.
2. Firebase se inicializa primero porque `firebase_messaging` necesita estar listo para recibir push notifications desde el arranque, incluyendo tokens background.
3. La base de datos se instancia antes de montar el arbol porque los repositorios la necesitan inmediatamente. Se pasa como override al `ProviderScope` para evitar la inicializacion lazy.
4. El `ProviderScope` envuelve toda la app, lo que permite que cualquier widget acceda a cualquier provider.

### 3.2 Estructura del app.dart

El widget raiz de la app configura Material, tema, router y localizacion.

```dart
// lib/app.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

class UxnanApp extends ConsumerWidget {
  const UxnanApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'Uxnan',
      themeMode: ThemeMode.system,
      theme: buildUxnanTheme(brightness: Brightness.light),
      darkTheme: buildUxnanTheme(brightness: Brightness.dark),
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    );
  }
}
```

**Decisiones de diseno:**

- `ConsumerWidget` en lugar de `StatelessWidget` porque la app necesita acceder al provider del router (que puede depender del estado de sesion para redirects).
- `MaterialApp.router` en lugar de `MaterialApp` porque usamos `go_router` para navegacion declarativa.
- `buildUxnanTheme()` es una funcion pura definida en `lib/presentation/theme/uxnan_theme.dart` que construye el `ThemeData` de Material 3 con los tokens de diseno del proyecto.
- La app sigue el tema del sistema (`ThemeMode.system`) y expone variantes clara y oscura para preservar la identidad visual en ambos modos.
- Las localizaciones se generan desde los archivos ARB en `l10n/` usando `flutter_localizations` + `intl`.

**Configuracion del router:**

```dart
// lib/presentation/router/app_router.dart
final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, __) => const AppShellScreen(), routes: [
        GoRoute(path: 'home', builder: (_, __) => const HomeScreen()),
        GoRoute(
          path: 'conversation/:threadId',
          builder: (_, s) => ConversationScreen(
            threadId: s.pathParameters['threadId']!,
          ),
        ),
        GoRoute(path: 'settings', builder: (_, __) => const SettingsScreen()),
        GoRoute(path: 'devices', builder: (_, __) => const MyDevicesScreen()),
        GoRoute(path: 'projects', builder: (_, __) => const ProjectsScreen()),
        GoRoute(path: 'terminal', builder: (_, __) => const TerminalScreen()),
      ]),
      GoRoute(path: '/onboarding', builder: (_, __) => const OnboardingScreen()),
      GoRoute(path: '/pairing', builder: (_, __) => const QrScannerScreen()),
    ],
  );
});
```

### 3.3 Flavors (dev/staging/prod)

El proyecto usa `--dart-define` para inyectar configuracion en tiempo de compilacion. No se usan archivos `.env` ni paquetes de configuracion adicionales.

> **Direccion (2026-06):** el producto es **bridge-first**. La direccion del
> bridge y (opcionalmente) la URL del relay **vienen del `PairingPayload`
> del QR** — no se inyectan en tiempo de compilacion. Esto permite que un
> mismo APK funcione contra cualquier bridge (LAN / Tailscale / relay)
> sin recompilar. `RELAY_URL` se elimino de la lista de variables de
> compilacion.

#### Variables de compilacion

| Variable | Dev | Staging | Prod |
|---|---|---|---|
| `ENV` | `dev` | `staging` | `prod` |
| `ENABLE_LOGGING` | `true` | `true` | `false` |

#### Comandos de compilacion

```bash
# Desarrollo
flutter run --dart-define=ENV=dev \
            --dart-define=ENABLE_LOGGING=true

# Staging
flutter run --dart-define=ENV=staging \
            --dart-define=ENABLE_LOGGING=true

# Produccion
flutter build apk --release \
            --dart-define=ENV=prod \
            --dart-define=ENABLE_LOGGING=false

flutter build ios --release \
            --dart-define=ENV=prod \
            --dart-define=ENABLE_LOGGING=false
```

#### Acceso en codigo

```dart
// lib/core/constants/app_constants.dart

class AppConstants {
  /// Entorno actual: dev, staging o prod.
  static const env = String.fromEnvironment(
    'ENV',
    defaultValue: 'prod',
  );

  /// Habilita logging detallado (solo dev y staging).
  static const enableLogging = bool.fromEnvironment(
    'ENABLE_LOGGING',
    defaultValue: false,
  );

  /// Modo desarrollo (conveniencia).
  static bool get isDev => env == 'dev';

  /// Modo staging (conveniencia).
  static bool get isStaging => env == 'staging';

  /// Modo produccion (conveniencia).
  static bool get isProd => env == 'prod';
}
```

**Ventajas de `--dart-define`:**
- Las constantes se resuelven en tiempo de compilacion (tree-shaking elimina codigo dead)
- No requieren archivos de configuracion en el repositorio
- No hay riesgo de exponer secrets en el bundle (las defines son constantes, no keys)
- Compatibles con CI/CD: se pasan como argumentos del job de build

### 3.4 Configuracion de Firebase

Firebase es necesario para push notifications (FCM en Android, APNs via FCM en iOS).

#### Android

1. Crear proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Registrar la app Android con el package name `dev.luisgamas.uxnanmobile`
3. Descargar `google-services.json` y colocarlo en:

```
android/app/google-services.json
```

4. Verificar que `android/build.gradle` incluye el plugin de Google Services:

```groovy
// android/build.gradle
buildscript {
    dependencies {
        classpath 'com.google.gms:google-services:4.4.0'
    }
}
```

5. Verificar que `android/app/build.gradle` aplica el plugin:

```groovy
// android/app/build.gradle
apply plugin: 'com.google.gms.google-services'
```

#### iOS

1. En el mismo proyecto de Firebase Console, registrar la app iOS con el bundle ID `dev.luisgamas.uxnanmobile`
2. Descargar `GoogleService-Info.plist` y colocarlo en:

```
ios/Runner/GoogleService-Info.plist
```

3. Configurar APNs en Firebase Console:
   - Subir la Authentication Key (.p8) de Apple Developer
   - O configurar el certificado APNs (.p12)

4. Habilitar push notifications en Xcode:
   - Signing & Capabilities -> + Capability -> Push Notifications
   - Signing & Capabilities -> + Capability -> Background Modes -> Remote notifications

#### Consideraciones por flavor

Si se necesitan configuraciones de Firebase separadas por flavor (dev/staging/prod), se pueden usar archivos distintos:

```
android/app/src/dev/google-services.json
android/app/src/staging/google-services.json
android/app/src/prod/google-services.json
```

Y en iOS, mediante build phases que copian el `.plist` correcto segun el scheme.

Para el MVP, un solo proyecto de Firebase es suficiente. La separacion por flavor se implementa post-MVP si es necesario.

### 3.5 Variables de entorno del Bridge

Estas variables **no** son parte de la app Flutter, pero son esenciales para los desarrolladores que configuran el entorno completo de Uxnan.

#### Variables del bridge (PC)

El bridge no usa variables de entorno propias obligatorias. Las credenciales de los agentes se configuran en el entorno del sistema operativo de la PC:

| Variable | Agente | Descripcion |
|---|---|---|
| `OPENAI_API_KEY` | Codex, OpenCode (si provider=openai) | API key de OpenAI |
| `ANTHROPIC_API_KEY` | Claude Code, OpenCode (si provider=anthropic), pi-agent | API key de Anthropic |
| `GOOGLE_API_KEY` | Gemini CLI, OpenCode (si provider=google) | API key de Google AI |

El bridge lee estas variables del entorno del proceso. La app movil **nunca** las conoce.

#### Variables del relay (opcional, self-hosted)

> **Direccion (2026-06):** el relay es **opcional y self-hosted**. La
> ruta primaria del producto es LAN-direct / Tailscale-direct. Si
> despliegas tu propio relay off-LAN, estas son sus variables de entorno
> (documentadas tambien en `relay/docs/`):

| Variable | Descripcion | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP/WS del relay | `8787` |
| `UXNAN_FCM_SERVICE_ACCOUNT` | Ruta al service account de Firebase (opcional; si esta, activa el sender FCM del relay). **Equivalente para el bridge:** `~/.uxnan/firebase-service-account.json` | `/secrets/firebase-sa.json` |
| `RELAY_LOG` | Nivel de log (`debug` / `info` / `warn` / `error`) | `info` |

> **APNs** ya no se usa directamente desde el relay: la ruta recomendada
> es **FCM-for-both** (iOS via FCM gateway). Por eso las variables APNs
> (`APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY_PATH` /
> `APNS_ENVIRONMENT` / `APNS_TOPIC`) **se eliminaron** del relay. Si
> el Firebase project no tiene un APNs `.p8` key uploaded, el relay
> solo entrega a Android.
>
> **Multi-sesion / auth-on-forwarding / dedupe-persistence** del relay
> siguen siendo **opcionales** (solo importan para un relay publico/
> compartido; ver `relay/FOR-DEV.md`).

### 3.6 Secuencia de DI wiring en el primer arranque

Al abrir la app por primera vez, la cadena de inyeccion de dependencias se resuelve en el siguiente orden. Cada nivel depende de que el nivel anterior este disponible.

```
Nivel 0: Flutter Engine
├── WidgetsFlutterBinding.ensureInitialized()
└── Firebase.initializeApp()

Nivel 1: ProviderScope (raiz del arbol de Riverpod)
├── databaseProvider         → UxnanDatabase (drift/SQLite)
│                              Crea o abre la base de datos local.
│                              En primer arranque, ejecuta migraciones y crea tablas.
└── secureStoreProvider      → SecureStore (flutter_secure_storage)
                               Wrapper sobre Keychain (iOS) / EncryptedSharedPreferences (Android).

Nivel 2: Repositorios (dependen de Nivel 1)
├── threadRepositoryProvider        → DriftThreadRepository(database)
├── messageRepositoryProvider       → DriftMessageRepository(database)
├── trustedDeviceRepositoryProvider → DriftTrustedDeviceRepository(database)
├── projectRepositoryProvider       → DriftProjectRepository(database)
├── secureSessionRepositoryProvider → SecureStorageSessionRepository(secureStore)
└── composerDraftRepositoryProvider → DriftComposerDraftRepository(database)

Nivel 3: Adaptadores de plataforma (independientes)
├── pushAdapterProvider             → PushNotificationAdapter()
├── qrScannerAdapterProvider        → QrScannerAdapter()
└── hapticAdapterProvider           → HapticAdapter()

Nivel 4: Coordinadores y managers (dependen de Niveles 2 y 3)
├── sessionCoordinatorProvider      → SessionCoordinator(
│                                       trustedDeviceRepo,
│                                       secureSessionRepo,
│                                       secureStore)
├── threadManagerProvider           → ThreadManager(
│                                       threadRepo, messageRepo,
│                                       sessionCoordinator)
├── composerManagerProvider         → ComposerManager(
│                                       draftRepo, sessionCoordinator)
├── gitActionManagerProvider        → GitActionManager(sessionCoordinator)
├── syncManagerProvider             → SyncManager(
│                                       sessionCoordinator,
│                                       threadManager, messageRepo)
└── notificationManagerProvider     → NotificationManager(
                                        pushAdapter, sessionCoordinator,
                                        secureStore)

Nivel 5: Estado derivado de UI (dependen de Nivel 4)
├── connectionPhaseProvider         → Stream<ConnectionPhase>
├── threadsProvider                 → Stream<List<Thread>>
├── activeThreadProvider            → StateNotifier<Thread?>
├── timelineProvider(threadId)      → FutureProvider.family
├── gitRepoStateProvider            → StateNotifier<GitRepoState?>
├── composerProvider                → StateNotifier<ComposerState>
├── authStatusProvider(agentId)     → FutureProvider.family
└── projectsProvider                → Stream<List<Project>>
```

#### Flujo de decision en el primer arranque

```
main() ejecuta
    ↓
ProviderScope se monta
    ↓
AppShellScreen se construye
    ↓
SessionCoordinator se inicializa (via provider)
    ↓
SessionCoordinator.checkExistingSession():
    ├── trustedDeviceRepo.getDevices()
    │       ↓
    │   ┌── Hay TrustedDevices guardados? ──→ Si
    │   │   └── Intenta trusted reconnect automatico
    │   │       └── ConnectionPhase: connecting -> handshaking -> connected
    │   │       └── Navega a HomeScreen / SidebarScreen
    │   │
    │   └── No hay TrustedDevices ──→ Primer arranque
    │       └── Genera PhoneIdentity (Ed25519) si no existe
    │       └── Persiste en SecureStore
    │       └── Navega a OnboardingScreen
    │           └── Usuario completa onboarding
    │           └── Escanea QR → pairing → handshake
    │           └── Navega a HomeScreen
```

**Nota sobre lazy initialization:** Riverpod inicializa los providers de forma lazy (cuando se leen por primera vez). Sin embargo, `databaseProvider` se pasa como override con un valor ya instanciado para garantizar que la base de datos este lista antes de que cualquier repositorio la necesite. El `SessionCoordinator` se lee desde `AppShellScreen`, lo cual fuerza su inicializacion al montar la pantalla raiz.

---

## 4. Consideraciones de plataforma Android vs iOS

### 4.1 Diferencias de implementacion

| Feature | Android | iOS |
|---|---|---|
| Almacenamiento seguro | `EncryptedSharedPreferences` + Android Keystore (API 23+) | Keychain Services (iOS 9+) |
| Push notifications | Firebase Cloud Messaging (FCM) | APNs (directo o via FCM gateway) |
| Permiso de red local | No requerido (acceso a LAN directo) | Requiere `NSLocalNetworkUsageDescription` + probe nativo |
| QR Scanner | CameraX + ML Kit | AVFoundation + Apple Vision |
| SSH | dartssh2 (puro Dart) | dartssh2 (puro Dart) |
| Criptografia acelerada | JCE + Android Keystore | CryptoKit (Swift) via FFI |
| Background execution | WorkManager para sync | BGAppRefreshTask (limitado por iOS) |
| Notificaciones background | FCM high-priority | APNs background push |

### 4.2 Permiso de red local en iOS

iOS requiere que el usuario autorice explicitamente el acceso a la red local (LAN) mediante un popup del sistema. Este popup solo aparece cuando se hace un socket probe a la red local:

```dart
// Plugin nativo: ios/Classes/LocalNetworkPlugin.swift
// Realiza un socket UDP probe a 224.0.0.0 (multicast) para triggear el popup

class LocalNetworkPermissionAdapter {
  Future<LocalNetworkPermissionStatus> request() async {
    if (Platform.isIOS) {
      return await _methodChannel.invokeMethod('requestLocalNetworkPermission');
    }
    return LocalNetworkPermissionStatus.granted; // Android no requiere
  }
}
```

La declaracion en `Info.plist`:
```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Uxnan necesita acceso a la red local para conectarse al bridge instalado en tu PC.</string>
<key>NSBonjourServices</key>
<array><string>_uxnan-bridge._tcp</string></array>
```

### 4.3 Background push en Android

```kotlin
// android/app/src/main/kotlin/.../UxnanFirebaseService.kt
class UxnanFirebaseService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    // Mostrar notificacion local si la app esta en background
    // flutter_local_notifications gestiona esto via FlutterLocalNotificationsPlugin
  }
  override fun onNewToken(token: String) {
    // Token FCM actualizado — notificar a Flutter via EventChannel
  }
}
```

### 4.4 Tamanios de pantalla

La UI debe adaptarse a:
- **Telefonos pequenios:** 360dp x 640dp (minimo soportado)
- **Telefonos estandar:** 390-430dp x 844-932dp (iPhone 14/15, Pixel 7-8)
- **Telefonos grandes:** 412-480dp x 900-1000dp (Galaxy S24 Ultra)
- **Tablets (opcional en v1):** layout de dos paneles sidebar + conversacion

---

## 5. Criterios de calidad

| Metrica | Objetivo |
|---|---|
| Test coverage (unit) | > 80% de logica de dominio y aplicacion |
| Test coverage (widget) | > 60% de pantallas principales |
| Lint/analisis estatico | 0 warnings con `flutter analyze` |
| Performance (frames) | 0 jank en timeline con 100 mensajes |
| Tamanio APK release (Android) | < 25 MB |
| Tamanio IPA release (iOS) | < 20 MB |

---

## 6. Guia de contribucion al bridge

### 6.1 Agregar un nuevo adaptador de agente

Para agregar soporte a un nuevo agente de codificacion en el bridge, se deben seguir estos pasos:

**Paso 1: Crear el archivo del adaptador**

```
uxnan-bridge/src/adapters/mi-agente-adapter.js
```

**Paso 2: Extender BaseAgentAdapter**

```javascript
const BaseAgentAdapter = require('./base-adapter');

class MiAgenteAdapter extends BaseAgentAdapter {
  constructor(bridgeHandlers) {
    super(bridgeHandlers);
    this.agentId = 'mi-agente';           // identificador unico
    this.displayName = 'Mi Agente CLI';
    this.capabilities = {
      planMode: false,                    // ver shared/src/agents/agent-capabilities.ts
      streaming: true,
      approvals: false,
      forking: false,
      images: false,
      reportsContextUsage: false,
      // autonomous: false,               // opcional; ausente = false
    };
  }

  async initialize(config) {
    // Verificar que el binario del agente existe
    this.binaryPath = await this._resolveBinary(config.binaryPath, [
      '/usr/local/bin/mi-agente',
      path.join(process.env.HOME, '.local/bin/mi-agente'),
    ]);
    this.config = config;
  }

  async listThreads({ projectId } = {}) {
    // Implementar: retornar lista de threads en formato Uxnan
    // [{ id, title, cwd, status, lastActivity, agentId: this.agentId }]
  }

  async startThread({ cwd, message, projectId }) {
    // Implementar: iniciar nueva conversacion
  }

  async sendTurn(threadId, { content }) {
    // Implementar: enviar mensaje al agente
    // Debe emitir eventos de dominio a traves de this.emitDomainEvent()
  }

  async getAuthStatus() {
    // Implementar: retornar estado de auth sanitizado
    return {
      agentId: this.agentId,
      requiresLogin: false,
      authenticatedProvider: null,
    };
  }
}

module.exports = MiAgenteAdapter;
```

**Paso 3: Registrar en handler-router.js**

```javascript
// src/handler-router.js
const adapters = {
  codex: require('./adapters/codex-adapter'),
  opencode: require('./adapters/opencode-adapter'),
  'claude-code': require('./adapters/claude-code-adapter'),
  'gemini-cli': require('./adapters/gemini-cli-adapter'),
  'pi-agent': require('./adapters/pi-agent-adapter'),
  'mi-agente': require('./adapters/mi-agente-adapter'),   // <- nuevo
};
```

**Paso 4: Declarar en la documentacion de la app**

Agregar el nuevo agente a la lista de `AgentId` en la app Flutter:

```dart
// lib/domain/enums/agent_id.dart
enum AgentId {
  codex,
  opencode,
  claudeCode,
  geminiCli,
  piAgent,
  miAgente,    // <- nuevo
  custom,
}
```

### 6.2 Convenciones del bridge

- **Sanitizacion obligatoria:** cualquier respuesta que contenga tokens, API keys, o credenciales debe sanitizarse antes de enviarse al telefono. Usar `account-status.js` como referencia.
- **Errores tipados:** siempre retornar errores como `{ code: -32XXX, message: "...", data: { agentId, originalError: "..." } }` — nunca strings crudos.
- **No blocking:** los handlers deben ser asincronos y no bloquear el event loop de Node.js.
- **Buffer de outbound:** el bridge automaticamente bufferea todo lo que envia al telefono en `secure-transport.js`. No es responsabilidad del adaptador.
- **Paths absolutos:** siempre resolver paths relativos a absolutos antes de operar con el filesystem.

---

## 7. Glosario tecnico

| Termino | Definicion |
|---|---|
| **ADE** | Agentic Development Environment — entorno de desarrollo asistido por agentes de IA |
| **Agent Adapter** | Modulo del bridge que normaliza la comunicacion con un agente especifico (Codex, OpenCode, etc.) |
| **APNs** | Apple Push Notification service — servicio de notificaciones push de Apple |
| **AES-256-GCM** | Advanced Encryption Standard de 256 bits en modo Galois/Counter — cifrado autenticado |
| **Bridge** | Daemon local que corre en la PC del usuario y actua como intermediario entre el movil y el agente |
| **catch-up** | Proceso de reenvio de mensajes perdidos al reconectar, usando el buffer de outbound del bridge |
| **cwd** | Current Working Directory — directorio raiz del proyecto en la PC |
| **dedupeKey** | Clave unica usada para prevenir envio duplicado de notificaciones push |
| **drift** | ORM para SQLite en Flutter, sucesor de moor |
| **E2EE** | End-to-End Encryption — cifrado de extremo a extremo |
| **Ed25519** | Algoritmo de firma digital basado en curva eliptica (Edwards curve) |
| **FCM** | Firebase Cloud Messaging — servicio de notificaciones push de Google (Android) |
| **fingerprint** | Hash SHA-256 del contenido de un mensaje usado para deduplicacion |
| **HKDF** | HMAC-based Key Derivation Function — funcion de derivacion de claves |
| **handshake** | Proceso de autenticacion mutua y establecimiento de clave de sesion E2EE |
| **JSON-RPC 2.0** | Protocolo de llamada a procedimiento remoto basado en JSON, sin estado |
| **JSONL** | JSON Lines — formato de archivo donde cada linea es un objeto JSON independiente |
| **keyEpoch** | Contador de renegociaciones de clave; incrementa si se derivan nuevas claves |
| **local-first** | Arquitectura donde el estado primario vive en el dispositivo del usuario, no en un servidor central |
| **MCP** | Model Context Protocol — protocolo estandar para conectar agentes LLM con herramientas externas |
| **notificationSecret** | Secreto compartido para autorizar `POST /push/notify` al relay (fallback de push) |
| **outbound buffer** | Buffer circular del bridge (max 500 msgs / 10 MB) para reenvio al reconectar |
| **pairing** | Proceso de vincular criptograficamente el telefono con un bridge especifico en una PC (QR o codigo manual) |
| **PairingPayload** | Estructura v2 transportada en el QR (Base64(utf8(JSON))) o devuelta por `GET /pair/resolve?code=`. Campos: `v:2`, `relay?` (opcional), `hosts?: string[]` (LAN + Tailscale), `sessionId`, `macDeviceId`, `macIdentityPublicKey`, `expiresAt`, `displayName` |
| **phoneDeviceId** | UUID unico generado al instalar la app en un telefono concreto |
| **PhoneIdentity** | Par de claves Ed25519 que identifican permanentemente al telefono |
| **plan mode** | Modo de operacion de algunos agentes donde proponen un plan antes de ejecutar cambios |
| **QR bootstrap** | Modo de handshake inicial que requiere escanear el QR del bridge |
| **ReAct** | Reason and Act — paradigma de agentes que alterna entre razonamiento y accion |
| **relay** | (Opcional, self-hosted) Servidor WebSocket stateless que reenvia envelopes E2EE opacos como fallback off-LAN. La ruta primaria del producto es LAN-direct / Tailscale-direct y no usa relay. |
| **Riverpod** | Framework de gestion de estado reactivo para Flutter basado en providers (3.x manual en este proyecto) |
| **rollout** | Proceso de entrega de eventos del runtime del agente al bridge |
| **seq** | Numero de secuencia monotonico por lado (bridge/iphone) para prevenir replay attacks |
| **sessionId** | UUID que identifica una sesion de conexion bridge-relay-movil |
| **SecureSession** | Objeto inmutable que encapsula el material criptografico de una sesion E2EE activa |
| **subagent** | Agente subordinado lanzado por el agente principal para una subtarea |
| **transcript** | Concatenacion de valores del handshake sobre los que se firma con Ed25519 |
| **TrustedDevice** | Registro persistido de un bridge (Mac/PC) de confianza |
| **trusted reconnect** | Modo de reconexion que no requiere re-escanear el QR |
| **turn** | Unidad de interaccion en la conversacion: un mensaje del usuario + respuesta del asistente |
| **timeline** | Vista ordenada cronologicamente de todos los mensajes y eventos de un thread |
| **worktree** | Copia de trabajo de Git que permite tener multiples branches abiertos simultaneamente |
| **X25519** | Protocolo de intercambio de claves Diffie-Hellman sobre curva eliptica de Bernstein |
