# Guía de Ingeniería de UI — Neural Expressive & Material 3 Expressive para Flutter
## Sistema de Diseño para la Era de la Inteligencia Artificial · Revisión 2.0

> **Nota de revisión:** Esta versión corrige errores técnicos de la v1.0, incorpora
> información verificada del redesign real de Gemini (I/O 2026) y de las especificaciones
> oficiales de M3 Expressive (I/O 2025), y extiende la guía con cobertura completa de
> breakpoints responsivos (Compact → Extra-Large) y patrones de layout canónicos.

---

## Índice de Contenido

1. [Introducción y Contexto Real](#1-introducción-y-contexto-real)
2. [Pilares del Sistema de Diseño](#2-pilares-del-sistema-de-diseño)
   - [Sistema de Movimiento basado en Física de Resortes](#21-sistema-de-movimiento-basado-en-física-de-resortes)
   - [Sistema de Formas y Geometría Expresiva](#22-sistema-de-formas-y-geometría-expresiva)
   - [Sistema Tipográfico](#23-sistema-tipográfico)
   - [Sistema de Color HCT](#24-sistema-de-color-hct)
3. [Breakpoints y Clases de Ventana Responsivos](#3-breakpoints-y-clases-de-ventana-responsivos)
4. [Especificaciones de Componentes](#4-especificaciones-de-componentes)
   - [Scaffold y Layout Principal](#41-scaffold-y-layout-principal)
   - [AppBar / Header](#42-appbar--header)
   - [Campo de Entrada Flotante (Prompt Pill)](#43-campo-de-entrada-flotante-prompt-pill)
   - [Navigation Drawer / Sidebar](#44-navigation-drawer--sidebar)
   - [Botones Expresivos y Grupos](#45-botones-expresivos-y-grupos)
   - [Tarjetas y Listas](#46-tarjetas-y-listas)
   - [Indicadores de Progreso](#47-indicadores-de-progreso)
   - [Interfaz de Voz Inline](#48-interfaz-de-voz-inline)
5. [Matriz de Decisión de Componentes](#5-matriz-de-decisión-de-componentes)
6. [Implementación en Flutter](#6-implementación-en-flutter)
   - [Tokens de Movimiento M3E](#61-tokens-de-movimiento-m3e)
   - [Breakpoint Helper](#62-breakpoint-helper)
   - [Widget: Tarjeta Expresiva con Radios Dinámicos](#63-widget-tarjeta-expresiva-con-radios-dinámicos)
   - [Widget: Navigation Drawer Responsivo](#64-widget-navigation-drawer-responsivo)
   - [Widget: Pill Input Flotante](#65-widget-pill-input-flotante)
   - [Widget: Indicador de Carga Poligonal (Shape Morphing)](#66-widget-indicador-de-carga-poligonal-shape-morphing)
7. [Gobernanza, Accesibilidad y Rendimiento](#7-gobernanza-accesibilidad-y-rendimiento)

---

## 1. Introducción y Contexto Real

### 1.1 Qué es Neural Expressive (y qué NO es)

**Neural Expressive** es el lenguaje de diseño visual que Google desplegó globalmente el
**19 de mayo de 2026** en Google I/O, rediseñando de raíz la app de Gemini en Android,
iOS y web. El vicepresidente de Gemini, Josh Woodward, lo describió como "un lenguaje
vibrante, dinámico y completamente reimaginado, construido específicamente para la era
de la IA".

Es importante delimitar su alcance real:

- ✅ **Es:** Un lenguaje de diseño *específico de Gemini*, construido **sobre** Material 3
  Expressive (M3E), que adapta sus principios al contexto de interfaces conversacionales con IA.
- ✅ **Es:** Una filosofía de presentación de información: las respuestas de IA no deben
  ser "paredes de texto", sino *objetos editoriales diseñados* con jerarquía visual clara.
- ❌ **No es:** Un sistema independiente de M3E. Es una capa de aplicación encima de M3E.
- ❌ **No es:** Exclusivamente el efecto de vidrio o gradientes pulsantes. Esos son
  componentes opcionales de *estado* (procesamiento del modelo); no son la estructura base.
- ❌ **No es:** Solo estética. Su objetivo principal es **reducción de carga cognitiva** y
  **localización más rápida de información crítica**.

**Material 3 Expressive (M3E)** fue anunciado en Google I/O 2025 y desplegado en
dispositivos Pixel con Android 16 en septiembre de 2025. Es la evolución (no reemplazo)
de Material You (M3), con foco en motion física, componentes expresivos y tipografía
variable. Neural Expressive es la implementación de M3E en el producto Gemini.

### 1.2 El Principio Fundamental: Del Chat-Log al Objeto Editorial

La premisa central de Neural Expressive: **la respuesta de la IA es un objeto de diseño,
no un flujo de texto**. Esto implica:

1. La información más crítica ocupa la parte superior con tipografía enfatizada (grande,
   bold, aislada visualmente).
2. El contenido de soporte se presenta en tarjetas, líneas de tiempo o visualizaciones
   inline, no en párrafos planos.
3. La interfaz *comunica estado*: cuando el modelo procesa, la UI se mueve de forma
   que refleja esa actividad cognitiva (el "glowbar" pulsante de Gemini es un ejemplo).

### 1.3 Tu Contexto de Uso (Sin Efecto Vidrio)

Esta guía asume que implementas **los principios estructurales y de composición** de
Neural Expressive con **materiales sólidos y limpios**, sin reproducir los efectos de
gradiente/glow propios del branding de Gemini. El resultado es una UI moderna, aireada
y de bajo ruido visual, perfecta para cualquier app conversacional, productividad o
dashboard.

---

## 2. Pilares del Sistema de Diseño

### 2.1 Sistema de Movimiento basado en Física de Resortes

M3E reemplaza por completo las curvas de Bézier por un motor de **física de resortes
amortiguados**. Esto permite animaciones que se interrumpen y redirigen naturalmente,
reflejando la inercia y masa de objetos reales.

Un resorte se define por dos parámetros:
- **Stiffness (k):** Qué tan rígido/rápido es el resorte. Mayor k = animación más rápida.
- **Damping Ratio (ζ):** Qué tan rápido se amortiguan las oscilaciones. `ζ = 1.0` = sin
  rebote (amortiguación crítica). `ζ < 1.0` = rebote visible y elástico.

#### Tabla de Tokens Oficiales M3E

| Token | Stiffness (k) | Damping (ζ) | Comportamiento | Uso Recomendado |
|:------|:------------:|:-----------:|:---------------|:----------------|
| `effectsFast` | 3800 | 1.00 | ~150 ms, sin rebote | Switches, checkboxes, feedback táctil micro |
| `effectsDefault` | 1600 | 1.00 | ~300 ms, sin rebote | Transiciones de color, fade de menús |
| `effectsSlow` | 800 | 1.00 | ~500 ms, sin rebote | Aparición de ilustraciones, fondos |
| `spatialFast` | 1400 | 0.90 | Rápido, overshoot leve (~10%) | Icon surfaces, chips de filtro, feedback de botones |
| `spatialDefault` | 700 | 0.90 | Orgánico, overshoot ~10% | Bottom sheets, paneles, drawer *apertura* |
| `spatialSlow` | 300 | 0.90 | Dramático, alta inercia | Hero animations, contenedores a pantalla completa |
| `bouncySpatial` | 400 | 0.40 | Gran rebote (~40% overshoot) | FAB menu, chips pequeños, pickers — **SOLO elementos pequeños** |
| `snappySpatial` | 1000 | 0.75 | Rápido con rebote leve | Drag de tarjetas, carruseles |

> ⚠️ **Corrección crítica de v1.0:** Los valores de damping en la tabla son **ratios**
> (0.0–1.0), no valores absolutos. La clase `SpringDescription` de Flutter usa el damping
> *crítico* calculado como `2 * sqrt(stiffness * mass)`, por lo que el parámetro `damping`
> en Flutter **no es el mismo** que el `dampingRatio` de M3. Ver sección 6.1 para
> la implementación correcta.

> ⚠️ **Error de v1.0 — Drawer con `bouncySpatial`:** La física `bouncySpatial` (k=400,
> ζ=0.40) **nunca debe usarse en el drawer**. Un overshoot del 40% en una superficie
> grande como el drawer se percibe como un bucle de apertura/cierre involuntario, no como
> elasticidad expresiva. Reglas correctas:
> - **Apertura del drawer:** `spatialDefault` (k=700, ζ=0.90) — ~320 ms, overshoot mínimo.
> - **Cierre del drawer:** `spatialFast` (k=1400, ζ=0.90) — ~240 ms, decisivo y limpio.
> - `bouncySpatial` queda reservado para elementos de ≤ 56 dp.

#### Esquema Expressive vs Standard

M3E define dos *motion schemes* aplicables globalmente:

- **Expressive (recomendado):** Springs con ligero overshoot. Para momentos hero, FABs,
  transiciones de pantalla principal. Es el esquema por defecto de Gemini.
- **Standard:** Springs con amortiguación crítica, sin rebote. Para apps de alta densidad
  de información o contextos más formales (dashboards, herramientas de productividad).

Puedes mezclarlos: usa Expressive en momentos de impacto y Standard en transiciones
funcionales de bajo perfil.

---

### 2.2 Sistema de Formas y Geometría Expresiva

M3E expande la biblioteca morfológica a **35 figuras** (polígonos, estrellas, pétalos
asimétricos). La regla clave: **la forma no tiene semántica funcional fija**. Una forma
ondulada no significa "cargando" obligatoriamente; puede ser una máscara decorativa para
un avatar.

#### Radios de Esquina por Categoría de Contenedor

| Rol del Token | dp | Uso típico |
|:---|:---:|:---|
| `shape.none` | 0 | Separadores, divisores |
| `shape.extraSmall` | 4 | Chips internos, badges |
| `shape.small` | 8 | Buttons compactos, tooltips |
| `shape.medium` | 12 | Cards internas, text fields |
| `shape.large` | 16 | Cards principales, bottom sheets |
| `shape.extraLarge` | 28 | Modal dialogs, FABs expandidos |
| `shape.full` | 50%+ | Pills, avatares, icon surfaces |

#### Principio de Tensión Visual

Combina formas redondeadas y angulares en el mismo layout para crear "tensión"
compositiva que dirige la mirada. Ejemplo: una tarjeta con `shape.large` (16 dp) junto
a un botón con `shape.full` (pill) crea contraste expresivo sin ruido visual.

#### Radios Dinámicos en Listas (Dynamic Corner Cards)

Para listas agrupadas, los radios se ajustan según posición para comunicar cohesión:

```
Primer elemento:   topLeft=24, topRight=24, bottomLeft=4, bottomRight=4
Elementos medios:  todos los radios = 4 dp
Último elemento:   topLeft=4, topRight=4, bottomLeft=24, bottomRight=24
Elemento único:    todos los radios = 24 dp
Gap entre items:   3 dp (no 8 dp — el gap pequeño refuerza la cohesión visual del grupo)
```

---

### 2.3 Sistema Tipográfico

**Google Sans Flex** opera como fuente variable primaria en el ecosistema Gemini/M3E.
Sus tres ejes de variación:

1. **Weight (100–1000):** La información más crítica en el contexto de respuesta IA
   se renderiza con weights altos (700–900) en la parte superior del contenido. El
   cuerpo del texto usa weights medios (400–500).
2. **Optical Size:** Ajusta automáticamente el tracking y el contraste de astas para
   mantener legibilidad desde 11 sp (microcopy) hasta 57+ sp (display hero).
3. **Grade / Softness:** Suaviza terminales de letras para connotar calidez vs rigor
   intelectual según el contexto del contenido.

#### Escala Tipográfica Neural Expressive

| Estilo | Size | Weight | Uso en app AI |
|:-------|:----:|:------:|:--------------|
| `displayLarge` | 57 sp | 400 | Pantalla de bienvenida, splash |
| `displayMedium` | 45 sp | 400 | Greeting central ("¿En qué puedo ayudarte?") |
| `headlineLarge` | 32 sp | 700 | Resumen crítico al inicio de respuesta IA |
| `headlineMedium` | 28 sp | 600 | Títulos de secciones en respuesta editorial |
| `titleLarge` | 22 sp | 500 | Nombres de conversaciones en el drawer |
| `titleMedium` | 16 sp | 500–600 | Headers de tarjetas, labels de navegación |
| `bodyLarge` | 16 sp | 400 | Cuerpo principal de respuesta IA |
| `bodyMedium` | 14 sp | 400 | Contenido secundario, metadatos |
| `labelLarge` | 14 sp | 500 | Texto de botones |
| `labelMedium` | 12 sp | 500 | Labels de chips, badges |

---

### 2.4 Sistema de Color HCT

El espacio de color **HCT (Hue, Chroma, Tone)** es la base del dynamic color de M3.
Para implementaciones con materiales sólidos (tu caso), los roles clave:

| Rol de Color | Uso Principal |
|:-------------|:--------------|
| `surface` | Fondo de pantalla principal |
| `surfaceContainer` | Fondos de cards internas |
| `surfaceContainerHigh` | Icon surfaces en AppBar, backgrounds de items seleccionados |
| `surfaceContainerHighest` | Input fields, chips activos |
| `onSurface` | Texto e iconos primarios |
| `onSurfaceVariant` | Texto e iconos secundarios |
| `primary` | Acciones principales, botones primarios |
| `primaryContainer` | Background de elementos de selección activa |
| `secondaryContainer` | Item seleccionado en navigation drawer |
| `outline` | Bordes de cards, separadores |
| `outlineVariant` | Bordes sutiles, divisores de lista |

> **Gradiente de marca (opcional):** Los gradientes de Neural Expressive (índigo→púrpura→
> amarillo luminiscente) son opcionales para apps que quieran ese efecto. Para apps de
> materiales sólidos, usa `primary` y `primaryContainer` del sistema dinámico de M3.

---

## 3. Breakpoints y Clases de Ventana Responsivos

M3E define **cinco breakpoints** oficiales (actualizados de las tres originales de M3):

| Breakpoint | Ancho | Dispositivos Típicos | Navegación | Layout |
|:-----------|:-----:|:---------------------|:-----------|:-------|
| **Compact** | < 600 dp | Teléfonos en portrait | Bottom NavBar | 1 pane |
| **Medium** | 600–839 dp | Tablets portrait, foldables cerrados | Navigation Rail | 1–2 panes |
| **Expanded** | 840–1199 dp | Tablets landscape, foldables abiertos | Drawer permanente / Rail expandido | 2 panes |
| **Large** | 1200–1599 dp | Laptops, monitores pequeños | Drawer permanente | 2–3 panes |
| **Extra-Large** | ≥ 1600 dp | Monitores grandes, TV | Drawer permanente ancho | 3+ panes |

### Reglas de Navegación por Breakpoint

```
Compact  → Bottom NavigationBar (3–5 destinos)
Medium   → Navigation Rail (colapsada, sin labels o con labels cortos)
Expanded → Standard Navigation Drawer permanente (320 dp, pineado)
Large    → Standard Navigation Drawer permanente (320 dp)
Extra-L  → Standard Navigation Drawer permanente (puede expandirse a 400 dp)
```

### Márgenes de Contenido por Breakpoint

| Breakpoint | Margin lateral | Max content width |
|:-----------|:--------------:|:-----------------:|
| Compact | 16 dp | 100% |
| Medium | 24 dp | 100% |
| Expanded | 24 dp | 840 dp (centrado) |
| Large | 32 dp | 1040 dp (centrado) |
| Extra-Large | 32 dp | 1200 dp (centrado) |

### Diagramas de Layout por Breakpoint

```
COMPACT (< 600 dp) — Teléfono Portrait
┌─────────────────────────┐
│ [≡ Model▾]    [tmp] [👤] │  ← Header 56 dp
├─────────────────────────┤
│                         │
│    [Logo / Gemini]      │  ← Greeting area
│  "¿En qué te ayudo?"   │
│                         │
│                         │
│  ┌─────────────────┐    │
│  │ ➕  [input]  🎙️ │    │  ← Pill input 56 dp, margin 16 dp
│  └─────────────────┘    │
├─────────────────────────┤
│  [🏠]  [📚]  [⭐]  [👤]  │  ← Bottom NavBar 80 dp
└─────────────────────────┘

MEDIUM (600–839 dp) — Tablet Portrait
┌──────┬──────────────────────────┐
│      │ [Model▾]      [tmp] [👤] │  ← Header
│ Rail │                          │
│      │   [Logo]                 │
│ [🏠] │  "¿En qué te ayudo?"    │
│ [💬] │                          │
│ [📚] │  ┌──────────────────┐   │
│      │  │ ➕  [input]   🎙️ │   │  ← Pill input
│      │  └──────────────────┘   │
└──────┴──────────────────────────┘
Rail: 80 dp ancho, iconos sin labels (o 136 dp con labels)

EXPANDED (840–1199 dp) — Tablet Landscape / Foldable
┌────────────┬────────────────────┐
│  DRAWER    │                    │
│  320 dp    │  [Model▾]  [👤]   │
│  (pinned)  │                    │
│ [New Chat] │  [Logo]            │
│ [Search]   │ "¿En qué te       │
│ [Library]  │  ayudo?"          │
│ [Settings] │                    │
│            │  ┌──────────────┐  │
│  ─────     │  │ ➕ [input] 🎙│  │
│  [👤 User] │  └──────────────┘  │
└────────────┴────────────────────┘
```

---

## 4. Especificaciones de Componentes

### 4.1 Scaffold y Layout Principal

El Scaffold en Neural Expressive se estructura en capas:

```
Layer 1 (base):     Surface — fondo de pantalla, color sólido
Layer 2 (content):  Área de scroll — respuestas, chat, contenido
Layer 3 (overlay):  Pill input flotante — posición absoluta sobre el content
Layer 4 (chrome):   AppBar transparente con velo — siempre encima
Layer 5 (nav):      Bottom NavBar / Rail / Drawer (según breakpoint)
```

**AppBar con velo (gradiente de scroll):**
El AppBar es transparente. Cuando hay contenido desplazable debajo, se aplica un
gradiente vertical que evita que el texto del contenido colisione visualmente con
los controles del header:

```
surface @ opacity 0.95  →  surface @ 0.75  →  transparent
(borde superior)            (mitad)             (borde inferior del velo)
Altura del velo: ~64 dp
```

> ⚠️ **No uses** un AppBar con fondo sólido en pantallas con contenido scrollable.
> El velo sutil mantiene los controles legibles sin "cortar" el contenido.

---

### 4.2 AppBar / Header

**Altura:** 56 dp (top bar estándar M3)
**Estructura asimétrica:**

```
Izquierda: [≡ o ←]  [Model Picker Dropdown 36 dp]
Centro:    vacío (no título en pantalla principal) o título de conversación activa
Derecha:   [Temporary Chats Icon]  [Avatar/Profile 40 dp]
```

#### Icon Surfaces en AppBar Transparente

Cuando el AppBar es transparente, **todos los botones de acción deben tener superficie
sólida**. No son iconos flotando sobre contenido — son *Icon Surfaces*:

- **Forma:** `BoxShape.circle` (no StadiumBorder)
- **Tamaño del contenedor:** 40 dp diámetro / Área de toque: 48×48 dp (accesibilidad)
- **Color de fondo:** `surfaceContainerHigh` — nunca `primary` ni `primaryContainer`
  (el color neutro evita que compitan con el brand mark)
- **Icono interior:** 20 dp, color `onSurface` o `onSurfaceVariant`
- **Física táctil:** `spatialFast` (k=1400, ζ=0.90), escala 1.0 → 0.92 en press

**Aplica a:** botón menú (hamburguesa), botón de chats temporales, botón de búsqueda,
cualquier acción secundaria del header.

#### Model Picker Dropdown

- Altura: 36 dp
- Forma: `StadiumBorder`
- Color: `surfaceContainerHigh`
- Contenido: ícono del modelo activo + nombre + chevron
- Al desplegarse: usa `spatialDefault` para la apertura del menú

---

### 4.3 Campo de Entrada Flotante (Prompt Pill)

```
┌────────────────────────────────────────────────────────┐
│  ➕   [  Escribe un mensaje...                ]   🎙️  │
└────────────────────────────────────────────────────────┘
   Altura: 56 dp
   Forma: StadiumBorder (radius = 28 dp = height/2)
   Color: surfaceContainerHighest
   Margin lateral: 16 dp en compact, 24 dp en medium+
   Margin inferior: 16 dp + SafeArea bottom
   Posición: flotante sobre el contenido (no anclado al teclado)
```

**Menú "+" (Unified Plus Menu):**
Al pulsar "➕", se despliega un **bottom sheet** (no un menú contextual flotante) con:
- Sección superior: carrusel horizontal de subida rápida (Photos, Camera, Recientes)
- Sección inferior (scroll): acceso a almacenamiento (Files, Drive, Notebooks) y
  herramientas AI (Deep Research, Canvas, Create Image, etc.)
- Animación de apertura: `spatialDefault` (k=700, ζ=0.90)

**Estados del Pill Input:**
```
Default:    surfaceContainerHighest, sin borde
Focused:    outline de 2 dp con color primary, sombra sutil elevation 2
With text:  aparece botón de envío (→) reemplazando el ícono de voz
```

---

### 4.4 Navigation Drawer / Sidebar

#### ✅ Regla Fundamental: Push, no Overlay

El drawer **empuja** el contenido principal horizontalmente, no lo cubre con un scrim.
El contenido principal desplazado actúa como ancla visual que comunica "sigues en la app".

#### Ancho del Drawer por Breakpoint

| Breakpoint | Comportamiento | Ancho |
|:-----------|:--------------|:------|
| **Compact** (< 600 dp) | Modal, desliza desde el borde izquierdo | **100% de la pantalla** |
| **Medium** (600–839 dp) | Modal, ancho fijo topado | 320 dp (máximo absoluto) |
| **Expanded+** (≥ 840 dp) | **Permanente / Pinned** — sin animación de apertura | 320 dp |

> ✅ **Confirmado:** En **Compact (móvil)**, el drawer ocupa el **100% del ancho de
> pantalla**. Así lo implementó Gemini en Neural Expressive. El usuario no ve contenido
> principal mientras el drawer está abierto — está en "su espacio" propio, como una
> pantalla completa limpia.

#### Parallax Suave (solo en Compact y Medium)

Durante la apertura/cierre, el contenido principal se desplaza con un leve desfase
respecto al drawer para crear sensación de profundidad:

```
Δ_content = W_drawer × (1 - α) × p

Donde:
  p = progreso de animación [0.0 → 1.0]
  α = 0.06 (factor de parallax)
  W_drawer = ancho del drawer en dp

Resultado: cuando el drawer está 100% abierto (p=1), el contenido
se desplazó el 94% del ancho del drawer, dejando un "sliver" visible
de ≈ 19 dp en un teléfono de 360 dp.
```

Este sliver comunica que el contenido sigue ahí, "empujado", no tapado.

#### Física de Animación del Drawer

```
Apertura: spatialDefault (k=700, ζ=0.90)  → movimiento limpio, ~320 ms
Cierre:   spatialFast  (k=1400, ζ=0.90)  → decisivo y rápido, ~240 ms
Parallax: bouncySpatial (k=400, ζ=0.40)  → solo el contenido background (NO el drawer)
```

#### Layout Interno del Drawer (3 Zonas)

```
┌──────────────────────────────────┐
│ [Logo / Brand]         [✕ close] │  ← Header ~88 dp
│                                  │     El botón close sigue regla Icon Surface:
│                                  │     circular 40 dp, surfaceContainerHigh
├──────────────────────────────────┤
│                                  │
│  🔮  New Chat                    │  ← Destinations (zona expandible)
│  🔍  Search Chats                │     Separación entre items: ≥ 20 dp
│  📚  Library                     │     Item seleccionado: fondo secondaryContainer
│  📓  Notebooks                   │       + peso tipográfico w600
│  ⚙️  Settings                    │     Iconos: familia de trazos ultradelgados
│                                  │     Padding horizontal: 20 dp
│  ── Recent ──                    │
│    Conversación 1                │
│    Conversación 2                │
│                                  │
├──────────────────────────────────┤
│ [👤] Nombre de usuario           │  ← Footer ~72 dp + SafeArea
│      Plan / Workspace  [chevron] │     Avatar: 40 dp con gradiente de marca
└──────────────────────────────────┘
```

> **Botón de cierre:** Anclado al **borde derecho del drawer** (no al borde derecho
> de la pantalla). En compact, esto significa que está al ~95-100% del ancho de pantalla.
> En expanded, está a 320 dp del borde izquierdo.

---

### 4.5 Botones Expresivos y Grupos

#### Connected Button Groups (reemplazo de Segmented Buttons)

Los botones segmentados están **oficialmente deprecados** en M3E para nuevas apps.
Su reemplazo son los **Connected Button Groups**:

```
┌─────────────┐┌─────────────┐┌──────────────┐
│   Button 1  ││   Button 2  ││   Button 3   │
└─────────────┘└─────────────┘└──────────────┘
   Gap entre botones: 3 dp
   Altura: 40 dp
   Radios: dinámicos (exteriores = 20 dp, interiores = 4 dp, igual que las card lists)
   Máximo de opciones: 5 (para evitar desbordamiento en Compact)
```

**Efecto "Neighbor Squish":** Al presionar un botón, los adyacentes se comprimen
ligeramente en el eje de colisión. Esto requiere animación coordinada con `spatialFast`.

#### Split Buttons

```
┌───────────────────────────────────┬──────────────┐
│         Acción Principal          │   ▾ (arrow)  │
└───────────────────────────────────┴──────────────┘
  Altura: 40 dp
  Radio exterior: 20 dp (StadiumBorder en las esquinas exteriores)
  Separación interna: 2 dp (línea divisoria)
  Al expandir: ícono rota 180°, radio interno del dropdown va de 20 dp → 7 dp
```

#### FAB y FAB Menu

- El FAB estándar (56 dp) se expande morfológicamente al pulsar, convirtiéndose
  en una tarjeta con lista de opciones secundarias.
- Reemplaza definitivamente el patrón Speed Dial.
- Animación: `bouncySpatial` (k=400, ζ=0.40) — aquí sí es apropiado por ser un
  elemento pequeño.

#### Jerarquía de Botones por Tamaño

| Tamaño | Alto | Uso |
|:-------|:---:|:----|
| Extra Small (XS) | 32 dp | Chips de filtro, acciones inline |
| Small (S) | 40 dp | Connected groups, split buttons |
| Medium (M) | 48 dp | Acciones secundarias de pantalla |
| Large (L) | 56 dp | FAB, CTA principales |
| Extra Large (XL) | 96 dp | CTA único en pantallas de baja densidad |

---

### 4.6 Tarjetas y Listas

#### Dynamic Corner Card List

Regla de radios para listas agrupadas (gap = 3 dp):

```dart
// Primer elemento del grupo
BorderRadius.only(
  topLeft:     Radius.circular(24),
  topRight:    Radius.circular(24),
  bottomLeft:  Radius.circular(4),
  bottomRight: Radius.circular(4),
)

// Elementos intermedios
BorderRadius.all(Radius.circular(4))

// Último elemento del grupo
BorderRadius.only(
  topLeft:     Radius.circular(4),
  topRight:    Radius.circular(4),
  bottomLeft:  Radius.circular(24),
  bottomRight: Radius.circular(24),
)

// Elemento único (sin vecinos)
BorderRadius.all(Radius.circular(24))
```

#### Dismissible Cards con Neighbour-Pull

Al hacer swipe-to-dismiss sobre un ítem:
- Los items adyacentes (hasta 3 en cada dirección) se desplazan elásticamente hacia
  el ítem arrastrado, anticipando visualmente el espacio que quedará.
- Desplazamiento máximo de los vecinos: 8–12 dp
- Animación del vecino: `spatialDefault` (k=700, ζ=0.90)

#### Expandable Cards

- Expansión con `spatialSlow` (k=300, ζ=0.90) para maximizar la sensación de inercia
  al desplegar contenido de soporte.
- Auto-collapse de otras tarjetas del mismo grupo: `effectsDefault` para el fade del
  contenido interno + `spatialDefault` para el colapso geométrico.

---

### 4.7 Indicadores de Progreso

#### LinearProgressIndicator Wavy

Variante del progreso lineal con onda sinusoidal activa durante el avance horizontal.
Comunica actividad sin bloquear la UI.

#### Loading Indicator Poligonal (Shape Morphing)

Reemplazo del `CircularProgressIndicator` para procesos de < 5 segundos.

**Regla técnica crítica:** La secuencia de formas debe contener **mínimo 2 figuras**.
Una secuencia de 1 forma no tiene transición y causa un crash de interpolación.

Secuencia recomendada: `cuadrado → triángulo → octágono → estrella → cuadrado (loop)`

#### Contained Loading Indicator

El polígono de morphing se aloja en un contenedor sólido `secondaryContainer`, ideal
para aislar el estado de carga sobre una sección específica sin bloquear el resto de
la UI.

---

### 4.8 Interfaz de Voz Inline

Durante conversación por voz activa, **no** se usa un panel que bloquea la pantalla.
Se implementa un **pill inline** de 64 dp de altura anclado en la base de la pantalla:

```
┌──────────────────────────────────────────────────────┐
│  [📷] [🖥️]     ≈≈≈≈≈[waveform]≈≈≈≈≈      [🔇] [✕]  │
└──────────────────────────────────────────────────────┘
  Alto: 64 dp
  Forma: StadiumBorder
  Color: surfaceContainerHigh
  Izquierda: botones cámara + screen share
  Centro: waveform animado (nivel de audio en tiempo real)
  Derecha: botón mute + botón cerrar canal
```

Las respuestas habladas por Gemini aparecen como texto en el espacio principal de la
pantalla, visibles y copiables sin cerrar el canal de voz.

---

## 5. Matriz de Decisión de Componentes

| Densidad Info | Volumen de Opciones | Acción Requerida | Componente Recomendado | Justificación |
|:---|:---|:---|:---|:---|
| **Baja** | 1 acción | Confirmación/ejecución directa | **XL/L Button** | Máxima área táctil, foco único |
| **Baja** | 2–5 opciones | Selección excluyente o multi | **Connected Button Group** | Reemplaza segmented buttons; física vecinal |
| **Baja–Media** | > 5 opciones | Filtrado continuo / etiquetas | **Chips + Scroll Horizontal** | Los groups no toleran > 5 sin overflow |
| **Media** | Registros independientes | Navegación informativa, dismiss | **M3E Card List (radios dinámicos)** | Gap 3 dp + asimetría comunica cohesión |
| **Alta** | Estructuras jerárquicas | Lectura bajo demanda | **Expandable Card List** | Auto-collapse reduce scroll excesivo |
| **Alta** | Selección masiva con metadatos | Búsqueda + filtrado asociativo | **Dropdown + Búsqueda Difusa + Chip Tags** | Evita saturación; chips animados inline |
| **Variable** | N/A | Respuesta de IA estructurada | **Editorial Layout** (títulos bold + cards + inline media) | Principio central de Neural Expressive |

---

## 6. Implementación en Flutter

### 6.1 Tokens de Movimiento M3E

> **Corrección técnica importante:** `SpringDescription` en Flutter usa el coeficiente
> de amortiguación **crítico** (`damping`), no el `dampingRatio`. La relación es:
>
> `damping_crítico = dampingRatio × 2 × sqrt(stiffness × mass)`
>
> Para `mass = 1.0`: `damping_crítico = dampingRatio × 2 × sqrt(stiffness)`

```dart
import 'package:flutter/physics.dart';
import 'dart:math' as math;

/// Convierte los tokens de M3E (dampingRatio + stiffness) a SpringDescription
/// compatible con Flutter, que usa damping crítico en lugar de dampingRatio.
class M3ESprings {
  /// Calcula el coeficiente de amortiguación crítica para Flutter.
  static double _criticalDamping({
    required double stiffness,
    required double dampingRatio,
    double mass = 1.0,
  }) {
    return dampingRatio * 2.0 * math.sqrt(stiffness * mass);
  }

  // ─── Tokens de Efectos (Non-Spatial) — sin rebote ───────────────────────
  // Para: cambios de color, opacidad, fades

  static SpringDescription get effectsFast => SpringDescription(
    mass: 1.0,
    stiffness: 3800.0,
    damping: _criticalDamping(stiffness: 3800, dampingRatio: 1.0),
    // ≈ 123.3 — amortiguación crítica, ~150 ms
  );

  static SpringDescription get effectsDefault => SpringDescription(
    mass: 1.0,
    stiffness: 1600.0,
    damping: _criticalDamping(stiffness: 1600, dampingRatio: 1.0),
    // ≈ 80.0 — amortiguación crítica, ~300 ms
  );

  static SpringDescription get effectsSlow => SpringDescription(
    mass: 1.0,
    stiffness: 800.0,
    damping: _criticalDamping(stiffness: 800, dampingRatio: 1.0),
    // ≈ 56.6 — amortiguación crítica, ~500 ms
  );

  // ─── Tokens Espaciales — con ligero rebote ───────────────────────────────
  // Para: movimientos de posición, tamaño, rotación

  /// Rápido con overshoot leve (~10%). Icon surfaces, chips, feedback botones.
  static SpringDescription get spatialFast => SpringDescription(
    mass: 1.0,
    stiffness: 1400.0,
    damping: _criticalDamping(stiffness: 1400, dampingRatio: 0.90),
    // ≈ 67.3 — ~240 ms
  );

  /// Orgánico y responsivo. Bottom sheets, drawer apertura, paneles.
  static SpringDescription get spatialDefault => SpringDescription(
    mass: 1.0,
    stiffness: 700.0,
    damping: _criticalDamping(stiffness: 700, dampingRatio: 0.90),
    // ≈ 47.6 — ~320 ms
  );

  /// Dramático con alta inercia. Hero animations, expansiones a pantalla completa.
  static SpringDescription get spatialSlow => SpringDescription(
    mass: 1.0,
    stiffness: 300.0,
    damping: _criticalDamping(stiffness: 300, dampingRatio: 0.90),
    // ≈ 31.2 — ~500 ms
  );

  /// Gran rebote (~40% overshoot). SOLO para elementos pequeños (≤56 dp):
  /// FAB menu, chips, pickers. NUNCA para drawers o superficies grandes.
  static SpringDescription get bouncySpatial => SpringDescription(
    mass: 1.0,
    stiffness: 400.0,
    damping: _criticalDamping(stiffness: 400, dampingRatio: 0.40),
    // ≈ 16.0 — rebote expresivo visible
  );

  /// Retorno rápido con oscilación leve. Drag de tarjetas, carruseles.
  static SpringDescription get snappySpatial => SpringDescription(
    mass: 1.0,
    stiffness: 1000.0,
    damping: _criticalDamping(stiffness: 1000, dampingRatio: 0.75),
    // ≈ 47.4
  );
}

/// Helper para aplicar un resorte a un AnimationController.
extension SpringControllerExtension on AnimationController {
  TickerFuture animateWithSpring({
    required double target,
    required SpringDescription spring,
    double initialVelocity = 0.0,
  }) {
    final simulation = SpringSimulation(
      spring,
      value,         // posición actual
      target,        // posición objetivo
      initialVelocity,
    );
    return animateWith(simulation);
  }
}
```

---

### 6.2 Breakpoint Helper

```dart
import 'package:flutter/material.dart';

/// Categorías de breakpoint basadas en M3 (5 niveles).
enum M3Breakpoint {
  compact,    // < 600 dp
  medium,     // 600–839 dp
  expanded,   // 840–1199 dp
  large,      // 1200–1599 dp
  extraLarge, // ≥ 1600 dp
}

extension M3BreakpointExtension on M3Breakpoint {
  bool get isCompact => this == M3Breakpoint.compact;
  bool get isAtLeastMedium => index >= M3Breakpoint.medium.index;
  bool get isAtLeastExpanded => index >= M3Breakpoint.expanded.index;
  bool get usesPermanentDrawer => isAtLeastExpanded;
  bool get usesBottomNav => isCompact;
  bool get usesRail => this == M3Breakpoint.medium;

  double get drawerWidth {
    if (isCompact) return double.infinity; // 100% de pantalla
    return 320.0; // tope absoluto para medium y superiores
  }

  double get contentMargin {
    switch (this) {
      case M3Breakpoint.compact:   return 16.0;
      case M3Breakpoint.medium:    return 24.0;
      case M3Breakpoint.expanded:  return 24.0;
      case M3Breakpoint.large:     return 32.0;
      case M3Breakpoint.extraLarge:return 32.0;
    }
  }

  double get maxContentWidth {
    switch (this) {
      case M3Breakpoint.compact:   return double.infinity;
      case M3Breakpoint.medium:    return double.infinity;
      case M3Breakpoint.expanded:  return 840.0;
      case M3Breakpoint.large:     return 1040.0;
      case M3Breakpoint.extraLarge:return 1200.0;
    }
  }
}

/// Widget que expone el breakpoint actual a sus descendientes.
class M3BreakpointProvider extends InheritedWidget {
  final M3Breakpoint breakpoint;

  const M3BreakpointProvider({
    super.key,
    required this.breakpoint,
    required super.child,
  });

  static M3Breakpoint of(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<M3BreakpointProvider>()!
        .breakpoint;
  }

  @override
  bool updateShouldNotify(M3BreakpointProvider oldWidget) =>
      breakpoint != oldWidget.breakpoint;
}

/// Widget raíz que calcula el breakpoint a partir del ancho disponible.
class M3AdaptiveLayout extends StatelessWidget {
  final Widget child;

  const M3AdaptiveLayout({super.key, required this.child});

  static M3Breakpoint _fromWidth(double width) {
    if (width < 600) return M3Breakpoint.compact;
    if (width < 840) return M3Breakpoint.medium;
    if (width < 1200) return M3Breakpoint.expanded;
    if (width < 1600) return M3Breakpoint.large;
    return M3Breakpoint.extraLarge;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final bp = _fromWidth(constraints.maxWidth);
        return M3BreakpointProvider(
          breakpoint: bp,
          child: child,
        );
      },
    );
  }
}
```

---

### 6.3 Widget: Tarjeta Expresiva con Radios Dinámicos

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Posición del ítem dentro de un grupo de tarjetas.
enum CardGroupPosition { first, middle, last, single }

/// Tarjeta M3E con radios de esquina dinámicos según posición en el grupo.
/// Incluye retroalimentación táctil elástica con física de resorte.
class M3EExpressiveCard extends StatefulWidget {
  final Widget child;
  final CardGroupPosition position;
  final VoidCallback? onTap;
  final double outerRadius; // Radio de esquinas exteriores
  final double innerRadius; // Radio de esquinas interiores (adyacentes a vecinos)
  final Color? backgroundColor;

  const M3EExpressiveCard({
    super.key,
    required this.child,
    required this.position,
    this.onTap,
    this.outerRadius = 24.0,
    this.innerRadius = 4.0,
    this.backgroundColor,
  });

  @override
  State<M3EExpressiveCard> createState() => _M3EExpressiveCardState();
}

class _M3EExpressiveCardState extends State<M3EExpressiveCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _scaleController;
  late Animation<double> _scaleAnimation;

  // Escala mínima en el momento de presión
  static const double _pressedScale = 0.97;

  @override
  void initState() {
    super.initState();
    _scaleController = AnimationController(
      vsync: this,
      // Duración máxima de seguridad; el resorte termina antes
      duration: const Duration(milliseconds: 600),
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: _pressedScale)
        .animate(_scaleController);
  }

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  void _onTapDown(TapDownDetails _) {
    HapticFeedback.lightImpact();
    _scaleController.animateWithSpring(
      target: 1.0, // hacia _pressedScale desde 1.0
      spring: M3ESprings.spatialFast,
    );
    // Atajo: usamos forward para comprimir
    _scaleController.forward();
  }

  void _onTapUp(TapUpDetails _) {
    _scaleController.animateWithSpring(
      target: 0.0, // regresar a escala 1.0
      spring: M3ESprings.spatialFast,
    );
    _scaleController.reverse();
  }

  void _onTapCancel() {
    _scaleController.reverse();
  }

  /// Calcula el BorderRadius según posición en el grupo.
  BorderRadius _buildRadius() {
    final o = Radius.circular(widget.outerRadius);
    final i = Radius.circular(widget.innerRadius);

    return switch (widget.position) {
      CardGroupPosition.first  => BorderRadius.only(
          topLeft: o, topRight: o, bottomLeft: i, bottomRight: i),
      CardGroupPosition.middle => BorderRadius.all(i),
      CardGroupPosition.last   => BorderRadius.only(
          topLeft: i, topRight: i, bottomLeft: o, bottomRight: o),
      CardGroupPosition.single => BorderRadius.all(o),
    };
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final radius = _buildRadius();

    return GestureDetector(
      onTapDown: _onTapDown,
      onTapUp: _onTapUp,
      onTapCancel: _onTapCancel,
      onTap: widget.onTap,
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) => Transform.scale(
          scale: _scaleAnimation.value,
          child: child,
        ),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          decoration: BoxDecoration(
            color: widget.backgroundColor ??
                colorScheme.surfaceContainerLow,
            borderRadius: radius,
          ),
          child: Material(
            color: Colors.transparent,
            borderRadius: radius,
            child: InkWell(
              borderRadius: radius,
              onTap: widget.onTap,
              child: widget.child,
            ),
          ),
        ),
      ),
    );
  }
}

/// Wrapper para construir una lista de M3EExpressiveCards con gap de 3 dp.
class M3ECardList extends StatelessWidget {
  final List<Widget> Function(int index, CardGroupPosition position) itemBuilder;
  final int itemCount;
  final double gap;

  const M3ECardList({
    super.key,
    required this.itemBuilder,
    required this.itemCount,
    this.gap = 3.0,
  });

  CardGroupPosition _positionFor(int index) {
    if (itemCount == 1) return CardGroupPosition.single;
    if (index == 0) return CardGroupPosition.first;
    if (index == itemCount - 1) return CardGroupPosition.last;
    return CardGroupPosition.middle;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(itemCount, (i) {
        return Padding(
          padding: EdgeInsets.only(bottom: i < itemCount - 1 ? gap : 0),
          child: Row(
            children: itemBuilder(i, _positionFor(i)),
          ),
        );
      }),
    );
  }
}
```

---

### 6.4 Widget: Navigation Drawer Responsivo

```dart
import 'package:flutter/material.dart';

/// Drawer responsivo que implementa las reglas Neural Expressive:
/// - Compact: 100% ancho, push al contenido
/// - Medium: 320 dp máx, push al contenido
/// - Expanded+: permanente/pinned, sin animación
class M3EAdaptiveScaffold extends StatefulWidget {
  final Widget body;
  final Widget drawerContent;
  final Widget? appBar;
  final Widget? bottomNav;
  final Widget? rail;

  const M3EAdaptiveScaffold({
    super.key,
    required this.body,
    required this.drawerContent,
    this.appBar,
    this.bottomNav,
    this.rail,
  });

  @override
  State<M3EAdaptiveScaffold> createState() => _M3EAdaptiveScaffoldState();
}

class _M3EAdaptiveScaffoldState extends State<M3EAdaptiveScaffold>
    with SingleTickerProviderStateMixin {
  late AnimationController _drawerController;
  bool _drawerOpen = false;

  // Factor de parallax: el contenido se mueve al 94% del ancho del drawer
  static const double _parallaxFactor = 0.94;

  @override
  void initState() {
    super.initState();
    _drawerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 320),
    );
  }

  @override
  void dispose() {
    _drawerController.dispose();
    super.dispose();
  }

  void openDrawer() {
    setState(() => _drawerOpen = true);
    _drawerController.animateWithSpring(
      target: 1.0,
      spring: M3ESprings.spatialDefault, // k=700, ζ=0.90
    );
    _drawerController.forward();
  }

  void closeDrawer() {
    _drawerController.animateWithSpring(
      target: 0.0,
      spring: M3ESprings.spatialFast, // k=1400, ζ=0.90
    );
    _drawerController.reverse().then((_) {
      if (mounted) setState(() => _drawerOpen = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final bp = M3BreakpointProvider.of(context);
    final screenWidth = MediaQuery.of(context).size.width;

    // En expanded+, el drawer es permanente: no hay animación
    if (bp.usesPermanentDrawer) {
      return Row(
        children: [
          SizedBox(
            width: bp.drawerWidth,
            child: widget.drawerContent,
          ),
          Expanded(child: widget.body),
        ],
      );
    }

    // Compact y Medium: drawer modal con physics push
    final drawerWidth = bp.isCompact
        ? screenWidth               // 100% en compact
        : bp.drawerWidth.clamp(0.0, screenWidth); // 320 dp topado en medium

    return AnimatedBuilder(
      animation: _drawerController,
      builder: (context, _) {
        final progress = _drawerController.value;
        // Contenido se mueve el 94% del ancho del drawer (parallax α=0.06)
        final contentOffset = drawerWidth * _parallaxFactor * progress;

        return Stack(
          children: [
            // Body desplazado (parallax push)
            Transform.translate(
              offset: Offset(contentOffset, 0),
              child: Scaffold(
                appBar: widget.appBar as PreferredSizeWidget?,
                body: widget.body,
                bottomNavigationBar: bp.usesBottomNav
                    ? widget.bottomNav
                    : null,
              ),
            ),

            // Drawer deslizándose desde la izquierda
            if (_drawerOpen || progress > 0)
              Transform.translate(
                offset: Offset(drawerWidth * (progress - 1), 0),
                child: SizedBox(
                  width: drawerWidth,
                  child: widget.drawerContent,
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Contenido interior del drawer con las 3 zonas: header, destinations, footer.
class M3EDrawerContent extends StatelessWidget {
  final VoidCallback onClose;
  final String brandName;
  final Widget? brandLogo;
  final List<M3EDrawerDestination> destinations;
  final String userName;
  final String userPlan;
  final Widget? userAvatar;

  const M3EDrawerContent({
    super.key,
    required this.onClose,
    required this.brandName,
    this.brandLogo,
    required this.destinations,
    required this.userName,
    required this.userPlan,
    this.userAvatar,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return SafeArea(
      child: ColoredBox(
        color: colorScheme.surface,
        child: Column(
          children: [
            // ── Header (~88 dp) ─────────────────────────────────────────────
            SizedBox(
              height: 88,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  children: [
                    if (brandLogo != null) brandLogo!,
                    const SizedBox(width: 12),
                    Text(brandName,
                        style: Theme.of(context).textTheme.titleLarge),
                    const Spacer(),
                    // Icon Surface: circular 40 dp, surfaceContainerHigh
                    _IconSurface(
                      icon: Icons.close,
                      onTap: onClose,
                      backgroundColor: colorScheme.surfaceContainerHigh,
                    ),
                  ],
                ),
              ),
            ),

            // ── Destinations (expandible) ───────────────────────────────────
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                itemCount: destinations.length,
                separatorBuilder: (_, __) => const SizedBox(height: 4),
                itemBuilder: (context, i) {
                  final dest = destinations[i];
                  return _DrawerDestinationItem(destination: dest);
                },
              ),
            ),

            // ── Footer (~72 dp) ─────────────────────────────────────────────
            const Divider(height: 1),
            SizedBox(
              height: 72,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  children: [
                    userAvatar ??
                        CircleAvatar(
                          radius: 20,
                          backgroundColor: colorScheme.primaryContainer,
                          child: Text(userName[0]),
                        ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(userName,
                              style: Theme.of(context).textTheme.titleMedium),
                          Text(userPlan,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(color: colorScheme.onSurfaceVariant)),
                        ],
                      ),
                    ),
                    Icon(Icons.expand_less,
                        color: colorScheme.onSurfaceVariant),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class M3EDrawerDestination {
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback? onTap;

  const M3EDrawerDestination({
    required this.icon,
    required this.label,
    this.isSelected = false,
    this.onTap,
  });
}

class _DrawerDestinationItem extends StatelessWidget {
  final M3EDrawerDestination destination;
  const _DrawerDestinationItem({required this.destination});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: destination.onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: destination.isSelected
              ? colorScheme.secondaryContainer
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(
              destination.icon,
              size: 20,
              color: destination.isSelected
                  ? colorScheme.onSecondaryContainer
                  : colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 16),
            Text(
              destination.label,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: destination.isSelected
                    ? FontWeight.w600
                    : FontWeight.w400,
                color: destination.isSelected
                    ? colorScheme.onSecondaryContainer
                    : colorScheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Icon Surface circular (para AppBar y header del drawer).
class _IconSurface extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final Color? backgroundColor;

  const _IconSurface({
    required this.icon,
    this.onTap,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return SizedBox(
      // Área de toque mínima: 48×48 dp (accesibilidad)
      width: 48,
      height: 48,
      child: Center(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            width: 40, // Contenedor visual: 40 dp
            height: 40,
            decoration: BoxDecoration(
              color: backgroundColor ?? colorScheme.surfaceContainerHigh,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              size: 20,
              color: colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}
```

---

### 6.5 Widget: Pill Input Flotante

```dart
import 'package:flutter/material.dart';

/// Campo de entrada tipo píldora flotante — estilo Neural Expressive.
/// Se posiciona sobre el contenido, desvinculado del teclado.
class M3EPillInput extends StatefulWidget {
  final TextEditingController? controller;
  final String hintText;
  final VoidCallback? onPlusPressed;   // Abre el bottom sheet de adjuntos/tools
  final VoidCallback? onVoicePressed;
  final ValueChanged<String>? onSubmitted;

  const M3EPillInput({
    super.key,
    this.controller,
    this.hintText = 'Escribe un mensaje...',
    this.onPlusPressed,
    this.onVoicePressed,
    this.onSubmitted,
  });

  @override
  State<M3EPillInput> createState() => _M3EPillInputState();
}

class _M3EPillInputState extends State<M3EPillInput> {
  late TextEditingController _controller;
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? TextEditingController();
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    if (widget.controller == null) _controller.dispose();
    _controller.removeListener(_onTextChanged);
    super.dispose();
  }

  void _onTextChanged() {
    final hasText = _controller.text.isNotEmpty;
    if (hasText != _hasText) setState(() => _hasText = hasText);
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bp = M3BreakpointProvider.of(context);

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: bp.contentMargin),
      child: Container(
        height: 56,
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(28), // StadiumBorder
          // Sombra sutil solo cuando está enfocado — no como estado base
        ),
        child: Row(
          children: [
            const SizedBox(width: 4),

            // Botón "+" — abre bottom sheet de adjuntos y herramientas
            IconButton(
              icon: const Icon(Icons.add),
              iconSize: 20,
              color: colorScheme.onSurfaceVariant,
              onPressed: widget.onPlusPressed,
            ),

            // Campo de texto expandible
            Expanded(
              child: TextField(
                controller: _controller,
                onSubmitted: widget.onSubmitted,
                style: Theme.of(context).textTheme.bodyLarge,
                decoration: InputDecoration(
                  hintText: widget.hintText,
                  hintStyle: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 0),
                ),
                maxLines: null,
                textInputAction: TextInputAction.send,
              ),
            ),

            // Botón derecho: enviar (si hay texto) o micrófono (si no hay texto)
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              transitionBuilder: (child, animation) => ScaleTransition(
                scale: animation,
                child: child,
              ),
              child: _hasText
                  ? IconButton(
                      key: const ValueKey('send'),
                      icon: const Icon(Icons.arrow_upward_rounded),
                      iconSize: 20,
                      color: colorScheme.primary,
                      onPressed: () =>
                          widget.onSubmitted?.call(_controller.text),
                    )
                  : IconButton(
                      key: const ValueKey('mic'),
                      icon: const Icon(Icons.mic_none_rounded),
                      iconSize: 20,
                      color: colorScheme.onSurfaceVariant,
                      onPressed: widget.onVoicePressed,
                    ),
            ),

            const SizedBox(width: 4),
          ],
        ),
      ),
    );
  }
}
```

---

### 6.6 Widget: Indicador de Carga Poligonal (Shape Morphing)

```dart
import 'package:flutter/material.dart';
import 'dart:math' as math;

/// Indicador de carga poligonal — reemplazo de CircularProgressIndicator.
/// Transiciona suavemente entre figuras geométricas usando interpolación
/// de coordenadas de vértices.
///
/// REGLA: la lista [shapes] debe tener ≥ 2 elementos.
/// Una sola forma no tiene transición y causa división por cero en el interpolador.
class M3EPolygonLoader extends StatefulWidget {
  final double size;
  final Color? color;
  final Duration cycleDuration;

  /// Número de lados de cada figura en la secuencia de morphing.
  /// Mínimo 2 figuras requerido.
  final List<int> shapes;

  const M3EPolygonLoader({
    super.key,
    this.size = 48.0,
    this.color,
    this.cycleDuration = const Duration(milliseconds: 1200),
    this.shapes = const [4, 3, 8, 6], // cuadrado → triángulo → octágono → hexágono
  }) : assert(shapes.length >= 2,
            'shapes debe contener al menos 2 figuras para evitar crash de interpolación');

  @override
  State<M3EPolygonLoader> createState() => _M3EPolygonLoaderState();
}

class _M3EPolygonLoaderState extends State<M3EPolygonLoader>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  int _currentShapeIndex = 0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.cycleDuration,
    )..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          setState(() {
            _currentShapeIndex =
                (_currentShapeIndex + 1) % widget.shapes.length;
          });
          _controller.forward(from: 0);
        }
      });
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? Theme.of(context).colorScheme.primary;
    final nextIndex = (_currentShapeIndex + 1) % widget.shapes.length;

    return AnimatedBuilder(
      animation: _controller,
      builder: (_, __) => CustomPaint(
        size: Size(widget.size, widget.size),
        painter: _PolygonMorphPainter(
          currentSides: widget.shapes[_currentShapeIndex],
          nextSides: widget.shapes[nextIndex],
          factor: _controller.value,
          color: color,
        ),
      ),
    );
  }
}

class _PolygonMorphPainter extends CustomPainter {
  final int currentSides;
  final int nextSides;
  final double factor;
  final Color color;

  const _PolygonMorphPainter({
    required this.currentSides,
    required this.nextSides,
    required this.factor,
    required this.color,
  });

  List<Offset> _getVertices(int sides, double radius, Offset center) {
    const initialAngle = -math.pi / 2;
    return List.generate(sides, (i) {
      final angle = initialAngle + (2 * math.pi / sides) * i;
      return Offset(
        center.dx + radius * math.cos(angle),
        center.dy + radius * math.sin(angle),
      );
    });
  }

  List<Offset> _interpolateVertices(
      List<Offset> from, List<Offset> to, double t) {
    final count = math.max(from.length, to.length);
    return List.generate(count, (i) {
      final a = from[i % from.length];
      final b = to[i % to.length];
      return Offset(
        a.dx + (b.dx - a.dx) * t,
        a.dy + (b.dy - a.dy) * t,
      );
    });
  }

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 * 0.85; // margen visual interior

    final current = _getVertices(currentSides, radius, center);
    final next = _getVertices(nextSides, radius, center);
    final points = _interpolateVertices(current, next, factor);

    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (final p in points.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    path.close();

    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..style = PaintingStyle.fill
        ..isAntiAlias = true,
    );
  }

  @override
  bool shouldRepaint(_PolygonMorphPainter old) =>
      old.currentSides != currentSides ||
      old.nextSides != nextSides ||
      old.factor != factor ||
      old.color != color;
}
```

---

## 7. Gobernanza, Accesibilidad y Rendimiento

### 7.1 Accesibilidad — No Negociable

| Requisito | Valor | Aplicación |
|:----------|:------|:-----------|
| Área de toque mínima | 48×48 dp | Todos los elementos interactivos, incluyendo Icon Surfaces de 40 dp |
| Contraste texto/fondo | 4.5:1 | Texto en `bodyLarge`, `bodyMedium`, `labelLarge` |
| Contraste iconos/fondo | 3.0:1 | Iconos de navegación y acción |
| `semanticLabel` | Requerido | Todos los botones solo-ícono |
| `Semantics(checked:)` | Requerido | Toggle groups, checkboxes |
| Reducción de movimiento | Respetar | Detectar `MediaQuery.of(ctx).disableAnimations` y usar `effectsDefault` |

```dart
// Detectar preferencia de movimiento reducido
final reducedMotion = MediaQuery.of(context).disableAnimations;
final spring = reducedMotion
    ? M3ESprings.effectsDefault  // sin rebote, resuelve rápido
    : M3ESprings.spatialDefault; // comportamiento normal
```

### 7.2 Regla de Moderación Expresiva

**Máximo 1–2 momentos expresivos de alto impacto por pantalla.**

Los momentos expresivos son: animaciones Hero, FAB expandido, morphing poligonal, 
`bouncySpatial`. El resto de la UI usa tokens Standard o Spatial sin bounce.

El objetivo de Neural Expressive es **reducir ruido visual**, no aumentarlo.
Un exceso de animaciones simultáneas contradice el principio fundamental del sistema.

### 7.3 Rendimiento

- Animaciones complejas (polygon morphing, Hero transitions): usar `RepaintBoundary`
  para aislar el subtree de la capa de pintura del resto de la UI.
- En dispositivos con < 4 GB RAM o GPU limitada, desactivar el morphing poligonal
  y usar `CircularProgressIndicator` como fallback.
- Verificar que todos los `AnimationController` se destruyen en `dispose()`.
- En listas largas (> 100 items), los radios dinámicos se calculan sin overhead
  en tiempo de pintado (son solo `BorderRadius`, sin shaders).

### 7.4 Checklist de Implementación

Antes de marcar un widget como "completo" en tu sistema de diseño:

- [ ] ¿Los tokens de física de resorte usados son los correctos para el tamaño del elemento?
- [ ] ¿El drawer usa `spatialDefault` en apertura y `spatialFast` en cierre?
- [ ] ¿Las Icon Surfaces tienen 40 dp visual y 48 dp de área de toque?
- [ ] ¿El drawer en Compact es 100% del ancho de pantalla?
- [ ] ¿En Expanded+ el drawer es permanente (sin animación de apertura)?
- [ ] ¿Las listas agrupadas tienen gap de 3 dp y radios dinámicos (24/4)?
- [ ] ¿La lista de formas del polygon loader tiene ≥ 2 figuras?
- [ ] ¿`bouncySpatial` se usa SOLO en elementos ≤ 56 dp?
- [ ] ¿Hay soporte para `disableAnimations` de accesibilidad?
- [ ] ¿Los textos de botones solo-ícono tienen `semanticLabel`?
- [ ] ¿El contraste de color cumple WCAG AA (4.5:1 texto, 3:1 iconos)?

---

*Guía generada con base en fuentes verificadas: Google I/O 2025 (M3E announcement),
Google I/O 2026 (Neural Expressive launch), especificaciones oficiales en m3.material.io,
cobertura técnica de 9to5Google, Android Authority y UrDesign Magazine.*