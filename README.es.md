# Uxnan

![Status](https://img.shields.io/badge/STATUS-ALPHA-orange?style=for-the-badge)
![Monorepo](https://img.shields.io/badge/MONOREPO-5_PROYECTOS-blue?style=for-the-badge)
![E2EE](https://img.shields.io/badge/E2EE-AES--256--GCM-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)
![Platforms](https://img.shields.io/badge/PLATAFORMAS-Android_%7C_iOS_%7C_Windows_%7C_macOS_%7C_Linux-lightgrey?style=for-the-badge)
![License](https://img.shields.io/badge/LICENCIA-MPL--2.0-2ea44f?style=for-the-badge)

> [Read in English](README.md)

Uxnan (pronunciado /uʃ.nan/) es un ecosistema de herramientas que construyo para
resolver un problema muy concreto que tengo como desarrollador: **controlar
agentes de codificación con IA desde cualquier lugar, sin que mi hardware se
convierta en un cuello de botella.**

## Por qué existe este proyecto

Trabajo con agentes de codificación CLI (Claude Code, Codex CLI, OpenCode, Gemini
CLI, pi-agent) todos los días. Son herramientas extraordinarias, pero el flujo de
trabajo actual tiene fricciones reales:

- **Cuando me alejo de la PC**, pierdo visibilidad total sobre lo que el agente
  está haciendo. No puedo revisar su progreso, aprobar cambios o enviar nuevas
  instrucciones desde el teléfono.
- **Las soluciones de escritorio existentes son excelentes**, pero muchas asumen
  hardware de gama alta. En mi setup actual, correr un IDE pesado + múltiples
  agentes + un entorno Electron consume más recursos de los que puedo
  permitirme.
- **No existe una herramienta móvil agnóstica a proveedor** que funcione con
  cualquier agente, no solo con uno en particular.

Uxnan nace para resolver exactamente eso. No es un agente — es el **plano de
control** para los agentes que ya uso.

## Cómo encaja todo

El teléfono nunca habla con un intermediario en la nube en claro. Se empareja con
el **bridge** que corre en tu PC y se conecta **primero de forma directa** —por
tu LAN o tu red Tailscale— y solo cae a un **relay** opcional y self-hosted
cuando estás fuera de casa. Sea cual sea la ruta, cada byte va cifrado de extremo
a extremo; el relay solo ve sobres sellados.

```text
   📱 uxnanmobile                  💻 tu PC
   (app Flutter)                   ┌──────────────────────────────┐
        │                          │  bridge  ──▶  CLIs de agentes │
        │   E2EE (X25519 +         │  (daemon)     claude · codex  │
        ├──── Ed25519 + ──────────▶│               opencode · pi   │
        │     AES-256-GCM)         │               gemini          │
        │                          └──────────────────────────────┘
        │                                      ▲
        └──── relay (opcional, ─────────────────┘
              self-hosted, solo fuera de la LAN —
              reenvía sobres sellados, no ve nada)

   uxnandesktop — una app de escritorio aparte, ligera, para correr y revisar
   esos mismos agentes en la propia PC. shared — los contratos que ambos hablan.
```

## Qué hace cada componente

Uxnan es un solo repositorio con cinco proyectos. Cada uno tiene su propio README
con la historia completa; aquí va la versión corta y a dónde ir después.

### 📱 [`uxnanmobile/`](uxnanmobile/README.md) — la app móvil

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-000000?style=for-the-badge&logo=apple&logoColor=white)

Una app Flutter (Android + iOS) que convierte tu teléfono en un control remoto de
los agentes en tu PC. Mira las conversaciones llegar en tiempo real, envía
instrucciones, adjunta imágenes, dicta por voz, revisa diffs, haz commit y push,
y recibe una notificación en cuanto un agente termina — todo sobre el canal
cifrado y bridge-first.

→ **[Lee el README de la app móvil](uxnanmobile/README.md)**

### 🖥️ [`uxnandesktop/`](uxnandesktop/README.md) — la app de escritorio

![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=000000)
![Svelte](https://img.shields.io/badge/Svelte_5-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=white)

Un **Agent Development Environment** ligero construido con Tauri 2, Rust y Svelte
5. A diferencia de las alternativas basadas en Electron que consumen 200-500 MB
de RAM solo por existir, este ADE usa el webview nativo del OS y apunta a 30-100
MB de RAM.

La idea central: cada tarea vive en su propio git worktree con su propio agente
corriendo en un pseudoterminal independiente. Puedo tener 5 agentes trabajando en
paralelo sin que uno bloquee a otro, cambiar entre ellos con un click (sin `git
stash`, sin `git checkout`), y revisar los cambios de cada uno en un visor de
diffs integrado (CodeMirror 6, unificado + lado a lado, staging por hunk) antes
de hacer commit.

No integra el SDK de ningún agente. Es terminal-centrico: cualquier agente CLI
funciona sin modificación.

→ **[Lee el README de la app de escritorio](uxnandesktop/README.md)**

### 🌉 [`bridge/`](bridge/README.md) — el daemon en tu PC

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JSON RPC](https://img.shields.io/badge/JSON--RPC_2.0-000000?style=for-the-badge&logo=json&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white)

El corazón del producto. Un pequeño daemon Node.js que corre en tu PC, mantiene
la conexión cifrada de extremo a extremo con tu teléfono (protocolo E2EE: X25519
+ HKDF + Ed25519 + AES-256-GCM) y maneja a los agentes por ti, lanzando el **CLI
local oficial** de cada uno tal como lo harías en una terminal. Sin API de
proveedor, sin SDK, sin keys: cada agente corre bajo la cuenta con la que ya
iniciaste sesión.

**Agentes reales cableados:** OpenCode, Claude Code, Codex, pi, Gemini CLI.

→ **[Lee el README del bridge](bridge/README.md)**

### 🔁 [`relay/`](relay/README.md) — el salto opcional fuera de la LAN

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![E2EE](https://img.shields.io/badge/E2EE_OPACO-0a0a0a?style=for-the-badge&logo=letsencrypt&logoColor=white)

Un relay WebSocket diminuto y stateless que puedes self-hostear para cuando tu
teléfono y tu PC no están en la misma red. Reenvía **sobres E2EE sellados** y
nada más — nunca ve tu código, tus diffs, tus keys ni una línea de texto plano.
La mayoría del tiempo ni lo necesitas.

→ **[Lee el README del relay](relay/README.md)**

### 📦 [`shared/`](shared/README.md) — el lenguaje común

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![JSON Schema](https://img.shields.io/badge/JSON_Schema-000000?style=for-the-badge&logo=json&logoColor=white)

La única fuente de verdad para los **contratos JSON-RPC + E2EE** que habla cada
parte de Uxnan. El bridge y el relay lo consumen directo; la app móvil mantiene
equivalentes en Dart sincronizados a mano. Si dos componentes necesitan ponerse
de acuerdo en la forma de un mensaje, se ponen de acuerdo aquí.

- **JSON-RPC**: tipos de envelope + constructores, códigos de error
  (`-32000..-32008` + estándar), registro de métodos tipado (locked en
  build-time contra `METHOD_NAMES`).
- **E2EE**: mensajes de handshake, transcript builder, `SecureEnvelope`,
  `PairingPayload` v2 (con `hosts: string[]` para direccionamiento directo).
- **Modelos de dominio** (thread/turn/message, git, workspace, project, auth,
  session, approval) y **contratos de agente** (`IAgentAdapter`,
  `AgentCapabilities`, `AgentConfig`).
- **Validación**: validadores basados en Ajv para requests, responses, envelopes
  E2EE, payloads de pairing y payloads de push.

→ **[Lee el README de los contratos compartidos](shared/README.md)**

## Seguridad

![X25519](https://img.shields.io/badge/X25519-Intercambio_de_Claves-2ea44f?style=for-the-badge)
![Ed25519](https://img.shields.io/badge/Ed25519-Firmas-2ea44f?style=for-the-badge)
![AES-256-GCM](https://img.shields.io/badge/AES--256--GCM-Cifrado-2ea44f?style=for-the-badge)
![HKDF-SHA256](https://img.shields.io/badge/HKDF--SHA256-Derivación_de_Claves-2ea44f?style=for-the-badge)

Aquí la privacidad no es una función, es el cimiento. Todo lo que viaja entre el
teléfono y la PC pasa por un canal cifrado de extremo a extremo real: las claves
de sesión salen de un intercambio efímero X25519, las identidades se autentican
con firmas Ed25519 y el tráfico se sella con AES-256-GCM. El relay, cuando
siquiera interviene, es puro transporte y jamás sostiene una clave. Las
respuestas del bridge también van sanitizadas — el estado de sesión, por ejemplo,
se reporta por agente y **nunca** devuelve un token.

Si encuentras una vulnerabilidad, por favor no abras un issue público — revisa
[`SECURITY.md`](SECURITY.md).

## Estado

![Phase](https://img.shields.io/badge/PHASE-ALPHA_(MVP_en_progreso)-orange?style=for-the-badge)

Uxnan está en **alpha**, y el ciclo central ya funciona de extremo a extremo.
Desde el teléfono puedo emparejarme con el bridge y mantener una conversación
real en streaming con **cinco agentes** —OpenCode, Claude Code, Codex, pi y
Gemini CLI— sobre el canal cifrado. La app de escritorio es alpha-funcional por
sí sola. Las notificaciones push están vivas en Android (iOS depende de assets de
Apple).

Aquí va la foto rápida; el estado detallado y siempre al día de cada proyecto
vive en su propio `FOR-DEV.md`:

| Proyecto | Cómo está | Detalle |
|---|---|---|
| [`uxnanmobile/`](uxnanmobile/README.md) | MVP cableado, Android alpha-ready; iOS pendiente de assets de Apple | [estado](uxnanmobile/FOR-DEV.md) |
| [`uxnandesktop/`](uxnandesktop/README.md) | Alpha-funcional como app standalone | [estado](uxnandesktop/FOR-DEV.md) |
| [`bridge/`](bridge/README.md) | Implementado; 5 agentes reales cableados | [estado](bridge/FOR-DEV.md) |
| [`relay/`](relay/README.md) | Implementado; opcional / self-hosted | [estado](relay/FOR-DEV.md) |
| [`shared/`](shared/README.md) | Implementado; contratos bloqueados en CI | [README](shared/README.md) |

Es software temprano, sin usuarios ni datos de producción todavía, así que las
cosas aún pueden cambiar donde una idea mejor lo justifique.

## Apoya el proyecto

Uxnan es gratis y de código abierto, hecho en abierto y en mi tiempo libre. Si te
resulta útil y quieres ayudar a que siga avanzando, un café ayuda muchísimo — y
de verdad se agradece. 🙏

<p align="center">
  <a href="https://sink.gamas.workers.dev/buymeacoffee">
    <img src="https://raw.githubusercontent.com/luisgamas/buttons-design/main/buy_me_a_coffe/buy_me_a_coffe_fill.png" width="200" alt="Buy Me a Coffee" />
  </a>
  <a href="https://sink.gamas.workers.dev/paypal-donations">
    <img src="https://raw.githubusercontent.com/luisgamas/buttons-design/main/paypal/paypal_fill.png" width="200" alt="Donate via PayPal" />
  </a>
  <a href="https://sink.gamas.workers.dev/github-sponsor">
    <img src="https://raw.githubusercontent.com/luisgamas/buttons-design/main/github_sponsor/github_sponsor_fill.png" width="200" alt="Sponsor on GitHub" />
  </a>
</p>

## Para colaboradores y desarrolladores

Si quieres compilar, correr o contribuir a Uxnan, todo lo que necesitas vive
fuera del README para que la documentación de arriba se mantenga enfocada:

- **[`CONTRIBUTING.md`](CONTRIBUTING.md)** — cómo preparar el entorno, los
  controles de calidad y cómo abrir un buen PR.
- **[`AGENTS.md`](AGENTS.md)** — la única fuente de verdad para convenciones,
  reglas de arquitectura y cómo se mantiene sincronizada la documentación. Léelo
  antes de cualquier cambio no trivial.
- **Docs por proyecto** — cada proyecto guarda guías enfocadas en su propio
  `docs/` y un `CHANGELOG.md`: [`bridge/docs/`](bridge/docs/) ·
  [`relay/docs/`](relay/docs/) · [`uxnanmobile/docs/`](uxnanmobile/docs/) ·
  [`uxnandesktop/docs/`](uxnandesktop/docs/).
- **La especificación** — los documentos de arquitectura son la fuente de verdad
  del comportamiento entre componentes:
  [`architecture/`](architecture/00-index.md) (móvil, bridge, relay, shared) y
  [`uxnandesktop/architecture/`](uxnandesktop/architecture/00-index.md)
  (escritorio).
- **Releases y versionado** — [`VERSIONS.md`](VERSIONS.md).

## Licencia

Uxnan se publica bajo la [Mozilla Public License 2.0](LICENSE).

---

*Uxnan — un nombre sin relación ni derivación de ningún producto existente.*
