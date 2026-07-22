# UI Engineering Guide — Neural Expressive & Material 3 Expressive for Flutter
## Design System for the Age of Artificial Intelligence · Revision 2.0

> **Revision note:** This version corrects technical errors from v1.0, incorporates
> verified information from the real Gemini redesign (I/O 2026) and from the official
> M3 Expressive specifications (I/O 2025), and extends the guide with full coverage
> of responsive breakpoints (Compact → Extra-Large) and canonical layout patterns.

---

## Table of Contents

1. [Introduction and Real Context](#1-introduction-and-real-context)
2. [Pillars of the Design System](#2-pillars-of-the-design-system)
   - [Spring-Physics-Based Motion System](#21-spring-physics-based-motion-system)
   - [Shape and Expressive Geometry System](#22-shape-and-expressive-geometry-system)
   - [Typographic System](#23-typographic-system)
   - [HCT Color System](#24-hct-color-system)
3. [Responsive Breakpoints and Window Classes](#3-responsive-breakpoints-and-window-classes)
4. [Component Specifications](#4-component-specifications)
   - [Scaffold and Main Layout](#41-scaffold-and-main-layout)
   - [AppBar / Header](#42-appbar--header)
   - [Floating Input Field (Prompt Pill)](#43-floating-input-field-prompt-pill)
   - [Navigation Drawer / Sidebar](#44-navigation-drawer--sidebar)
   - [Expressive Buttons and Groups](#45-expressive-buttons-and-groups)
   - [Cards and Lists](#46-cards-and-lists)
   - [Progress Indicators](#47-progress-indicators)
   - [Inline Voice Interface](#48-inline-voice-interface)
5. [Component Decision Matrix](#5-component-decision-matrix)
6. [Implementation in Flutter](#6-implementation-in-flutter)
   - [M3E Motion Tokens](#61-m3e-motion-tokens)
   - [Breakpoint Helper](#62-breakpoint-helper)
   - [Widget: Expressive Card with Dynamic Radii](#63-widget-expressive-card-with-dynamic-radii)
   - [Widget: Responsive Navigation Drawer](#64-widget-responsive-navigation-drawer)
   - [Widget: Floating Pill Input](#65-widget-floating-pill-input)
   - [Widget: Material 3 Expressive Loading Indicator](#66-widget-material-3-expressive-loading-indicator)
7. [Governance, Accessibility, and Performance](#7-governance-accessibility-and-performance)

---

## 1. Introduction and Real Context

### 1.1 What Neural Expressive Is (and What It Is NOT)

**Neural Expressive** is the visual design language that Google rolled out globally on
**May 19, 2026** at Google I/O, fundamentally redesigning the Gemini app on Android,
iOS, and web. Gemini Vice President Josh Woodward described it as "a vibrant, dynamic,
and completely reimagined language, built specifically for the age of AI."

It is important to delimit its real scope:

- ✅ **It is:** A design language *specific to Gemini*, built **on top of** Material 3
  Expressive (M3E), which adapts its principles to the context of conversational AI interfaces.
- ✅ **It is:** A philosophy of information presentation: AI responses should not be
  "walls of text," but rather *designed editorial objects* with clear visual hierarchy.
- ❌ **It is not:** A system independent of M3E. It is an application layer on top of M3E.
- ❌ **It is not:** Exclusively the glass effect or pulsing gradients. Those are optional
  *state* components (model processing); they are not the base structure.
- ❌ **It is not:** Only aesthetics. Its primary goal is **reducing cognitive load** and
  **faster localization of critical information**.

**Material 3 Expressive (M3E)** was announced at Google I/O 2025 and rolled out on
Pixel devices with Android 16 in September 2025. It is the evolution (not replacement)
of Material You (M3), with a focus on physics-based motion, expressive components, and
variable typography. Neural Expressive is the implementation of M3E in the Gemini product.

### 1.2 The Fundamental Principle: From Chat-Log to Editorial Object

The central premise of Neural Expressive: **the AI response is a design object,
not a stream of text**. This implies:

1. The most critical information occupies the top with emphasized typography (large,
   bold, visually isolated).
2. Supporting content is presented in cards, timelines, or inline visualizations,
   not in flat paragraphs.
3. The interface *communicates state*: when the model processes, the UI moves in a way
   that reflects that cognitive activity (Gemini's pulsing "glowbar" is an example).

### 1.3 Your Usage Context (Without the Glass Effect)

This guide assumes you implement **the structural and compositional principles** of
Neural Expressive with **solid, clean materials**, without reproducing the
gradient/glow effects specific to Gemini's branding. The result is a modern, airy UI
with low visual noise, perfect for any conversational, productivity, or dashboard app.

---

## 2. Pillars of the Design System

### 2.1 Spring-Physics-Based Motion System

M3E completely replaces Bézier curves with a **damped spring physics** engine. This
enables animations that interrupt and redirect naturally, reflecting the inertia and
mass of real objects.

A spring is defined by two parameters:
- **Stiffness (k):** How rigid/fast the spring is. Higher k = faster animation.
- **Damping Ratio (ζ):** How quickly oscillations are damped. `ζ = 1.0` = no
  bounce (critical damping). `ζ < 1.0` = visible, elastic bounce.

#### Table of Official M3E Tokens

| Token | Stiffness (k) | Damping (ζ) | Behavior | Recommended Use |
|:------|:------------:|:-----------:|:---------------|:----------------|
| `effectsFast` | 3800 | 1.00 | ~150 ms, no bounce | Switches, checkboxes, micro tactile feedback |
| `effectsDefault` | 1600 | 1.00 | ~300 ms, no bounce | Color transitions, menu fades |
| `effectsSlow` | 800 | 1.00 | ~500 ms, no bounce | Illustration appearance, backgrounds |
| `spatialFast` | 1400 | 0.90 | Fast, slight overshoot (~10%) | Icon surfaces, filter chips, button feedback |
| `spatialDefault` | 700 | 0.90 | Organic, ~10% overshoot | Bottom sheets, panels, drawer *opening* |
| `spatialSlow` | 300 | 0.90 | Dramatic, high inertia | Hero animations, full-screen containers |
| `bouncySpatial` | 400 | 0.40 | Large bounce (~40% overshoot) | FAB menu, small chips, pickers — **SMALL elements ONLY** |
| `snappySpatial` | 1000 | 0.75 | Fast with slight bounce | Card drag, carousels |

> ⚠️ **Critical correction from v1.0:** The damping values in the table are **ratios**
> (0.0–1.0), not absolute values. Flutter's `SpringDescription` class uses *critical*
> damping calculated as `2 * sqrt(stiffness * mass)`, so the `damping` parameter
> in Flutter **is not the same** as M3's `dampingRatio`. See section 6.1 for
> the correct implementation.

> ⚠️ **v1.0 error — Drawer with `bouncySpatial`:** The `bouncySpatial` physics (k=400,
> ζ=0.40) **must never be used on the drawer**. A 40% overshoot on a large surface
> like the drawer is perceived as an involuntary open/close loop, not as
> expressive elasticity. Correct rules:
> - **Drawer opening:** `spatialDefault` (k=700, ζ=0.90) — ~320 ms, minimal overshoot.
> - **Drawer closing:** `spatialFast` (k=1400, ζ=0.90) — ~240 ms, decisive and clean.
> - `bouncySpatial` is reserved for elements of ≤ 56 dp.

#### Expressive vs Standard Scheme

M3E defines two *motion schemes* applicable globally:

- **Expressive (recommended):** Springs with slight overshoot. For hero moments, FABs,
  main-screen transitions. It is Gemini's default scheme.
- **Standard:** Springs with critical damping, no bounce. For high-information-density
  apps or more formal contexts (dashboards, productivity tools).

You can mix them: use Expressive in impactful moments and Standard in low-profile
functional transitions.

---

### 2.2 Shape and Expressive Geometry System

M3E expands the morphological library to **35 figures** (polygons, stars, asymmetric
petals). The key rule: **shape has no fixed functional semantics**. A wavy shape
does not necessarily mean "loading"; it can be a decorative mask for an avatar.

#### Corner Radii by Container Category

| Token Role | dp | Typical Use |
|:---|:---:|:---|
| `shape.none` | 0 | Separators, dividers |
| `shape.extraSmall` | 4 | Internal chips, badges |
| `shape.small` | 8 | Compact buttons, tooltips |
| `shape.medium` | 12 | Internal cards, text fields |
| `shape.large` | 16 | Main cards, bottom sheets |
| `shape.extraLarge` | 28 | Modal dialogs, expanded FABs |
| `shape.full` | 50%+ | Pills, avatars, icon surfaces |

#### Visual Tension Principle

Combine rounded and angular shapes in the same layout to create compositional
"tension" that directs the gaze. Example: a card with `shape.large` (16 dp) next
to a button with `shape.full` (pill) creates expressive contrast without visual noise.

#### Dynamic Radii in Lists (Dynamic Corner Cards)

For grouped lists, the radii adjust according to position to communicate cohesion:

```text
First item:    topLeft=24, topRight=24, bottomLeft=4, bottomRight=4
Middle items:  all radii = 4 dp
Last item:     topLeft=4, topRight=4, bottomLeft=24, bottomRight=24
Single item:   all radii = 24 dp
Gap between items: 3 dp (not 8 dp — the small gap reinforces the group's visual cohesion)
```

---

### 2.3 Typographic System

**Google Sans Flex** operates as the primary variable font in the Gemini/M3E
ecosystem. Its three axes of variation:

1. **Weight (100–1000):** The most critical information in the AI-response context
   is rendered with high weights (700–900) at the top of the content. The
   body text uses medium weights (400–500).
2. **Optical Size:** Automatically adjusts the tracking and stroke contrast to
   maintain legibility from 11 sp (microcopy) up to 57+ sp (display hero).
3. **Grade / Softness:** Softens letter terminals to connote warmth vs intellectual
   rigor according to the content context.

#### Neural Expressive Typographic Scale

| Style | Size | Weight | Use in AI app |
|:-------|:----:|:------:|:--------------|
| `displayLarge` | 57 sp | 400 | Welcome screen, splash |
| `displayMedium` | 45 sp | 400 | Central greeting ("How can I help you?") |
| `headlineLarge` | 32 sp | 700 | Critical summary at the start of an AI response |
| `headlineMedium` | 28 sp | 600 | Section titles in an editorial response |
| `titleLarge` | 22 sp | 500 | Conversation names in the drawer |
| `titleMedium` | 16 sp | 500–600 | Card headers, navigation labels |
| `bodyLarge` | 16 sp | 400 | Main body of an AI response |
| `bodyMedium` | 14 sp | 400 | Secondary content, metadata |
| `labelLarge` | 14 sp | 500 | Button text |
| `labelMedium` | 12 sp | 500 | Chip labels, badges |

---

### 2.4 HCT Color System

The **HCT (Hue, Chroma, Tone)** color space is the foundation of M3's dynamic color.
For implementations with solid materials (your case), the key roles:

| Color Role | Primary Use |
|:-------------|:--------------|
| `surface` | Main screen background |
| `surfaceContainer` | Internal card backgrounds |
| `surfaceContainerHigh` | Icon surfaces in the AppBar, backgrounds of selected items |
| `surfaceContainerHighest` | Input fields, active chips |
| `onSurface` | Primary text and icons |
| `onSurfaceVariant` | Secondary text and icons |
| `primary` | Primary actions, primary buttons |
| `primaryContainer` | Background of active selection elements |
| `secondaryContainer` | Selected item in the navigation drawer |
| `outline` | Card borders, separators |
| `outlineVariant` | Subtle borders, list dividers |

> **Brand gradient (optional):** The Neural Expressive gradients (indigo→purple→
> luminescent yellow) are optional for apps that want that effect. For solid-material
> apps, use `primary` and `primaryContainer` from M3's dynamic system.

---

## 3. Responsive Breakpoints and Window Classes

M3E defines **five** official breakpoints (updated from M3's original three):

| Breakpoint | Width | Typical Devices | Navigation | Layout |
|:-----------|:-----:|:---------------------|:-----------|:-------|
| **Compact** | < 600 dp | Phones in portrait | Bottom NavBar | 1 pane |
| **Medium** | 600–839 dp | Portrait tablets, closed foldables | Navigation Rail | 1–2 panes |
| **Expanded** | 840–1199 dp | Landscape tablets, open foldables | Permanent drawer / expanded rail | 2 panes |
| **Large** | 1200–1599 dp | Laptops, small monitors | Permanent drawer | 2–3 panes |
| **Extra-Large** | ≥ 1600 dp | Large monitors, TV | Wide permanent drawer | 3+ panes |

### Navigation Rules by Breakpoint

```text
Compact  → Bottom NavigationBar (3–5 destinations)
Medium   → Navigation Rail (collapsed, no labels or with short labels)
Expanded → Permanent Standard Navigation Drawer (320 dp, pinned)
Large    → Permanent Standard Navigation Drawer (320 dp)
Extra-L  → Permanent Standard Navigation Drawer (can expand to 400 dp)
```

### Content Margins by Breakpoint

| Breakpoint | Lateral margin | Max content width |
|:-----------|:--------------:|:-----------------:|
| Compact | 16 dp | 100% |
| Medium | 24 dp | 100% |
| Expanded | 24 dp | 840 dp (centered) |
| Large | 32 dp | 1040 dp (centered) |
| Extra-Large | 32 dp | 1200 dp (centered) |

### Layout Diagrams by Breakpoint

```text
COMPACT (< 600 dp) — Phone Portrait
┌─────────────────────────┐
│ [≡ Model▾]    [tmp] [👤] │  ← Header 56 dp
├─────────────────────────┤
│                         │
│    [Logo / Gemini]      │  ← Greeting area
│  "How can I help?"      │
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
│ [🏠] │  "How can I help?"       │
│ [💬] │                          │
│ [📚] │  ┌──────────────────┐   │
│      │  │ ➕  [input]   🎙️ │   │  ← Pill input
│      │  └──────────────────┘   │
└──────┴──────────────────────────┘
Rail: 80 dp wide, icons without labels (or 136 dp with labels)

EXPANDED (840–1199 dp) — Tablet Landscape / Foldable
┌────────────┬────────────────────┐
│  DRAWER    │                    │
│  320 dp    │  [Model▾]  [👤]   │
│  (pinned)  │                    │
│ [New Chat] │  [Logo]            │
│ [Search]   │ "How can I        │
│ [Library]  │  help?"           │
│ [Settings] │                    │
│            │  ┌──────────────┐  │
│  ─────     │  │ ➕ [input] 🎙│  │
│  [👤 User] │  └──────────────┘  │
└────────────┴────────────────────┘
```

---

## 4. Component Specifications

### 4.1 Scaffold and Main Layout

The Scaffold in Neural Expressive is structured in layers:

```text
Layer 1 (base):     Surface — screen background, solid color
Layer 2 (content):  Scroll area — responses, chat, content
Layer 3 (overlay):  Floating pill input — absolute position over the content
Layer 4 (chrome):   Transparent AppBar with veil — always on top
Layer 5 (nav):      Bottom NavBar / Rail / Drawer (depending on breakpoint)
```

**AppBar with veil (scroll gradient):**
The AppBar is transparent. When there is scrollable content below it, a vertical
gradient is applied to prevent the content text from visually colliding with the
header controls:

```text
surface @ opacity 0.95  →  surface @ 0.75  →  transparent
(top edge)                  (middle)            (bottom edge of the veil)
Veil height: ~64 dp
```

> ⚠️ **Do not use** an AppBar with a solid background on screens with scrollable
> content. The subtle veil keeps the controls legible without "cutting off" the content.

---

### 4.2 AppBar / Header

**Height:** 56 dp (standard M3 top bar)
**Asymmetric structure:**

```text
Left:    [≡ or ←]  [Model Picker Dropdown 36 dp]
Center:  empty (no title on the main screen) or active conversation title
Right:   [Temporary Chats Icon]  [Avatar/Profile 40 dp]
```

#### Icon Surfaces in a Transparent AppBar

When the AppBar is transparent, **all action buttons must have a solid surface**.
They are not icons floating over content — they are *Icon Surfaces*:

- **Shape:** `BoxShape.circle` (not StadiumBorder)
- **Container size:** 40 dp diameter / Touch area: 48×48 dp (accessibility)
- **Background color:** `surfaceContainerHigh` — never `primary` or `primaryContainer`
  (the neutral color prevents them from competing with the brand mark)
- **Inner icon:** 20 dp, color `onSurface` or `onSurfaceVariant`
- **Tactile physics:** `spatialFast` (k=1400, ζ=0.90), scale 1.0 → 0.92 on press

**Applies to:** menu button (hamburger), temporary chats button, search button,
any secondary header action.

#### Model Picker Dropdown

- Height: 36 dp
- Shape: `StadiumBorder`
- Color: `surfaceContainerHigh`
- Content: active model icon + name + chevron
- When expanding: use `spatialDefault` for opening the menu

---

### 4.3 Floating Input Field (Prompt Pill)

```text
┌────────────────────────────────────────────────────────┐
│  ➕   [  Type a message...              ]  🎙️  [↑] │
└────────────────────────────────────────────────────────┘
   Height: 56 dp
   Shape: StadiumBorder (radius = 28 dp = height/2)
   Color: surfaceContainerHighest
   Lateral margin: 24 dp idle → 16 dp focused on compact
   Bottom margin: 16 dp + SafeArea bottom
   Position: floating over the content (not anchored to the keyboard)
```

**"+" Menu (Unified Plus Menu):**
With only Photo library and Camera available, tapping "➕" opens a compact
anchored M3 popup menu with two icon-and-label rows. A bottom sheet is reserved
for a future larger action set; persistent turn context is not mixed into this
menu.

**Slash-command palette:**
Typing `/` or `@` opens an auxiliary surface 8 dp above the composer. Both use
the same elevated `surfaceContainerHigh`, conventional rounded rectangle and
header structure: a 36 dp primary-container trigger (`/` or `@`) followed by
the palette title. This shared hierarchy makes them sibling extensions while
their rows remain task-specific. Slash commands form a continuous list with
56 dp minimum targets, 40 dp neutral icon surfaces, names and one-line
descriptions; workspace rows retain their navigation and loading states.
Neither palette turns every entry into a card, and both follow the composer's
reduced-motion setting.

Reasoning/run-option and approval controls live as a tightly left-aligned icon
group in a compact horizontal shelf above the pill. Each keeps a 48 dp touch
target around a 38 dp neutral circular surface with a 24 dp glyph, matching the
38 dp visual height and `surfaceContainerHigh` tone of the context, token, and
edit pills on the right. The shelf starts folded to one chevron by default and
expands on tap, for a quiet conversation surface. Tooltips carry the
option/value labels. Approval uses semantic status colors: success for Approve
for me, warning for Request approval, and error for Full access.
When the reader scrolls away from the latest message far enough to reveal the
scroll shortcut, this auxiliary shelf and any autonomous-agent notice slide
toward the composer, fade, and collapse. The transition must be clipped to its
shrinking layout region: the composer veil is translucent, so translated chrome
must never remain painted below the pill. Run-option popup menus retain composer
focus and use a live position builder so keyboard geometry changes cannot leave
the menu detached from its control.
While a turn is active but has no response text yet, it begins with a 14 dp
expressive progress indicator and an italic on-surface-variant
"Agent responding…" label. A semantic-color skeleton sweep moves across the
label and freezes under reduced motion. As soon as response text exists, the
label disappears and the loader moves inline immediately after the latest
token, acting as the response's trailing writing cursor.

**Pill Input states:**
```text
Default:    surfaceContainerHighest, no border, compact idle footprint
Focused:    no outline, elevation 2, expands horizontally/vertically
With text:  send button (↑) appears beside the always-available voice action
Running:    stop replaces send; voice remains an independent action
```

The Git commit composer reuses these same focus states, including the 24→16 dp
compact-screen side margins, 4→8 dp vertical padding, elevation 0→2, 220 ms
ease-out transition, and reduced-motion fallback. It retains its task-specific
morph from a stadium into a 24 dp rounded surface when commit details are open.

---

### 4.4 Navigation Drawer / Sidebar

#### ✅ Fundamental Rule: Push, not Overlay

The drawer **pushes** the main content horizontally; it does not cover it with a scrim.
The displaced main content acts as a visual anchor that communicates "you are still in the app."

#### Drawer Width by Breakpoint

| Breakpoint | Behavior | Width |
|:-----------|:--------------|:------|
| **Compact** (< 600 dp) | Modal, slides from the left edge | **100% of the screen** |
| **Medium** (600–839 dp) | Modal, capped fixed width | 320 dp (absolute maximum) |
| **Expanded+** (≥ 840 dp) | **Permanent / Pinned** — no opening animation | 320 dp |

> ✅ **Confirmed:** On **Compact (mobile)**, the drawer occupies **100% of the screen
> width**. This is how Gemini implemented it in Neural Expressive. The user does not see
> the main content while the drawer is open — they are in "their own space," like a
> clean full screen.

#### Smooth Parallax (only on Compact and Medium)

During opening/closing, the main content moves with a slight offset relative to
the drawer to create a sense of depth:

```text
Δ_content = W_drawer × (1 - α) × p

Where:
  p = animation progress [0.0 → 1.0]
  α = 0.06 (parallax factor)
  W_drawer = drawer width in dp

Result: when the drawer is 100% open (p=1), the content
has moved 94% of the drawer's width, leaving a visible "sliver"
of ≈ 19 dp on a 360 dp phone.
```

This sliver communicates that the content is still there, "pushed," not covered.

#### Drawer Animation Physics

```text
Opening:  spatialDefault (k=700, ζ=0.90)  → clean movement, ~320 ms
Closing:  spatialFast  (k=1400, ζ=0.90)  → decisive and fast, ~240 ms
Parallax: bouncySpatial (k=400, ζ=0.40)  → background content only (NOT the drawer)
```

#### Internal Drawer Layout (3 Zones)

```text
┌──────────────────────────────────┐
│ [Logo / Brand]         [✕ close] │  ← Header ~88 dp
│                                  │     The close button follows the Icon Surface rule:
│                                  │     circular 40 dp, surfaceContainerHigh
├──────────────────────────────────┤
│                                  │
│  🔮  New Chat                    │  ← Destinations (expandable zone)
│  🔍  Search Chats                │     Spacing between items: ≥ 20 dp
│  📚  Library                     │     Selected item: secondaryContainer background
│  📓  Notebooks                   │       + w600 typographic weight
│  ⚙️  Settings                    │     Icons: ultra-thin stroke family
│                                  │     Horizontal padding: 20 dp
│  ── Recent ──                    │
│    Conversation 1                │
│    Conversation 2                │
│                                  │
├──────────────────────────────────┤
│ [👤] User name                   │  ← Footer ~72 dp + SafeArea
│      Plan / Workspace  [chevron] │     Avatar: 40 dp with brand gradient
└──────────────────────────────────┘
```

> **Close button:** Anchored to the **right edge of the drawer** (not the right edge
> of the screen). On compact, this means it is at ~95-100% of the screen width.
> On expanded, it is 320 dp from the left edge.

---

### 4.5 Expressive Buttons and Groups

#### Connected Button Groups (replacing Segmented Buttons)

Segmented buttons are **officially deprecated** in M3E for new apps.
Their replacement is the **Connected Button Groups**:

```text
┌─────────────┐┌─────────────┐┌──────────────┐
│   Button 1  ││   Button 2  ││   Button 3   │
└─────────────┘└─────────────┘└──────────────┘
   Gap between buttons: 3 dp
   Height: 40 dp
   Radii: dynamic (outer = 20 dp, inner = 4 dp, same as the card lists)
   Maximum options: 5 (to avoid overflow on Compact)
```

**"Neighbor Squish" effect:** When pressing a button, the adjacent ones compress
slightly along the collision axis. This requires coordinated animation with `spatialFast`.

#### Split Buttons

```text
┌───────────────────────────────────┬──────────────┐
│         Primary Action            │   ▾ (arrow)  │
└───────────────────────────────────┴──────────────┘
  Height: 40 dp
  Outer radius: 20 dp (StadiumBorder on the outer corners)
  Internal separation: 2 dp (divider line)
  On expand: the icon rotates 180°, the dropdown's inner radius goes from 20 dp → 7 dp
```

#### FAB and FAB Menu

- The standard FAB (56 dp) expands morphologically when tapped, becoming
  a card with a list of secondary options.
- It definitively replaces the Speed Dial pattern.
- Animation: `bouncySpatial` (k=400, ζ=0.40) — here it is indeed appropriate, since it
  is a small element.
- Bidirectional scroll shortcuts are a quieter exception: conversation
  **Jump to latest** and git-history **Back to top** reuse the same 52 dp
  circular `surfaceContainerHighest` control with `onSurfaceVariant` glyph,
  subtle `outlineVariant` edge and low elevation. They stay bottom-centered and
  avoid the more prominent brand/secondary tones reserved for primary actions.

#### Button Hierarchy by Size

| Size | Height | Use |
|:-------|:---:|:----|
| Extra Small (XS) | 32 dp | Filter chips, inline actions |
| Small (S) | 40 dp | Connected groups, split buttons |
| Medium (M) | 48 dp | Secondary screen actions |
| Large (L) | 56 dp | FAB, primary CTAs |
| Extra Large (XL) | 96 dp | Single CTA on low-density screens |

---

### 4.6 Cards and Lists

#### Dynamic Corner Card List

Radius rule for grouped lists (gap = 3 dp):

```dart
// First item of the group
BorderRadius.only(
  topLeft:     Radius.circular(24),
  topRight:    Radius.circular(24),
  bottomLeft:  Radius.circular(4),
  bottomRight: Radius.circular(4),
)

// Middle items
BorderRadius.all(Radius.circular(4))

// Last item of the group
BorderRadius.only(
  topLeft:     Radius.circular(4),
  topRight:    Radius.circular(4),
  bottomLeft:  Radius.circular(24),
  bottomRight: Radius.circular(24),
)

// Single item (no neighbors)
BorderRadius.all(Radius.circular(24))
```

#### Dismissible Cards with Neighbour-Pull

When swipe-to-dismissing an item:
- The adjacent items (up to 3 in each direction) shift elastically toward
  the dragged item, visually anticipating the space that will be left.
- Maximum neighbor displacement: 8–12 dp
- Neighbor animation: `spatialDefault` (k=700, ζ=0.90)

#### Deleting a List Item (fade → collapse → commit)

When a row is deleted from a data-driven list (the thread list is the canonical
case, `presentation/screens/threads/thread_tile.dart`), animate the row out
**before** the underlying source drops it, so the list never pops:

- On confirm, put the row in a *deleting* state: dim the card to ~0.4 opacity,
  ignore pointer input, and float the shared `PolygonLoader` over it (the app's
  one loading language — never a bare `CircularProgressIndicator`).
- Play a single controller (~320 ms): **fade** the card over the first half
  (`Interval(0, 0.5, easeOut)`), then **collapse** its height over the second
  half (`Interval(0.3, 1, easeInOut)`, `SizeTransition` anchored
  `Alignment.topCenter`) so the rows below slide up under it.
- Commit the data mutation (e.g. the cascading repository delete) **only after**
  the animation completes — the source list then rebuilds while this slot is
  already invisible, so no neighbour jumps.
- Give each row a stable `ValueKey(id)` so its animation state follows the item
  rather than the list index, and honour `MediaQuery.disableAnimations` by
  dropping the row without the transition.

#### Expandable Cards

- Expansion with `spatialSlow` (k=300, ζ=0.90) to maximize the sense of inertia
  when unfolding supporting content.
- Auto-collapse of other cards in the same group: `effectsDefault` for the fade of
  the internal content + `spatialDefault` for the geometric collapse.

#### When Not to Use Cards

Cards are not the default treatment for every repeated item. Use a flat list
with quiet `outlineVariant` separators when continuity between rows carries
meaning or when card chrome would compete with the primary visualization. Git
history is the canonical example: its branch graph must read as one continuous
lane system, so commits stay flat and width-constrained. Commit-detail files
also use expandable flat rows; only an opened diff receives tonal containment
to separate code from surrounding metadata.

---

### 4.7 Progress Indicators

#### Wavy LinearProgressIndicator

A variant of the linear progress indicator with a sinusoidal wave active during the
horizontal advance. It communicates activity without blocking the UI.

#### Polygonal Loading Indicator (Shape Morphing)

A replacement for the `CircularProgressIndicator` for processes of < 5 seconds.

Use normalized rounded polygons and feature-aware cubic morphing; never pair raw
vertices by index. The canonical indeterminate sequence is `soft burst → 9-sided
cookie → pentagon → pill → sunny → 4-sided cookie → oval`.

#### Contained Loading Indicator

The morphing polygon is housed in a solid `secondaryContainer` container, ideal
for isolating the loading state over a specific section without blocking the rest of
the UI.

---

### 4.8 Inline Voice Interface

During an active voice conversation, a panel that blocks the screen is **not** used.
A 64 dp tall **inline pill** is implemented, anchored at the bottom of the screen:

```text
┌──────────────────────────────────────────────────────┐
│  [📷] [🖥️]     ≈≈≈≈≈[waveform]≈≈≈≈≈      [🔇] [✕]  │
└──────────────────────────────────────────────────────┘
  Height: 64 dp
  Shape: StadiumBorder
  Color: surfaceContainerHigh
  Left: camera + screen share buttons
  Center: animated waveform (real-time audio level)
  Right: mute button + close-channel button
```

Responses spoken by Gemini appear as text in the main space of the screen,
visible and copyable without closing the voice channel.

---

## 5. Component Decision Matrix

| Info Density | Option Volume | Required Action | Recommended Component | Justification |
|:---|:---|:---|:---|:---|
| **Low** | 1 action | Direct confirmation/execution | **XL/L Button** | Maximum touch area, single focus |
| **Low** | 2–5 options | Exclusive or multi selection | **Connected Button Group** | Replaces segmented buttons; neighbor physics |
| **Low–Medium** | > 5 options | Continuous filtering / labels | **Chips + Horizontal Scroll** | Groups do not tolerate > 5 without overflow |
| **Medium** | Independent records | Informational navigation, dismiss | **M3E Card List (dynamic radii)** | Gap 3 dp + asymmetry communicates cohesion |
| **High** | Hierarchical structures | On-demand reading | **Expandable Card List** | Auto-collapse reduces excessive scrolling |
| **High** | Mass selection with metadata | Search + associative filtering | **Dropdown + Fuzzy Search + Chip Tags** | Avoids saturation; inline animated chips |
| **Variable** | N/A | Structured AI response | **Editorial Layout** (bold titles + cards + inline media) | Central principle of Neural Expressive |

**Conversation implementation:** the assistant's answer remains the editorial
foreground. Secondary process information (reasoning, tool activity, and file
changes) uses quiet borderless tonal disclosures, collapsed by default; opening
reasoning or activity auto-collapses the previously open process disclosure in
that same turn. Streaming follows the latest response only until the user
manually scrolls, and long user prompts use an expandable visual-line preview
so neither automation nor message length takes control of the reading surface.
A minimal, reusable **message scroll rail** (`lib/presentation/widgets/message_scroll_rail.dart`)
— faint at rest on the right edge, one short tick per user message — is hidden
while the timeline sits at the bottom and slides in from the right edge (with a
fade) when the user scrolls up, the same signal that hides the composer ribbon.
A slight drag then reveals a dock-style fisheye and a message preview, and on
release glides smoothly (ease-in/out with a final settle) to the picked message,
then it auto-hides; it is a self-contained,
dependency-free widget fed by a memoized `railAnchorsProvider`. Floating scroll
shortcuts are **bottom-centered** and transient (jump-to-latest in the
conversation, back-to-top in the git history), keeping them clear of the left
turn-controls and right token/context indicators on the composer ribbon.

---

## 6. Implementation in Flutter

### 6.1 M3E Motion Tokens

> **Important technical correction:** `SpringDescription` in Flutter uses the **critical**
> damping coefficient (`damping`), not the `dampingRatio`. The relationship is:
>
> `critical_damping = dampingRatio × 2 × sqrt(stiffness × mass)`
>
> For `mass = 1.0`: `critical_damping = dampingRatio × 2 × sqrt(stiffness)`

```dart
import 'package:flutter/physics.dart';
import 'dart:math' as math;

/// Converts the M3E tokens (dampingRatio + stiffness) to a SpringDescription
/// compatible with Flutter, which uses critical damping instead of dampingRatio.
class M3ESprings {
  /// Computes the critical damping coefficient for Flutter.
  static double _criticalDamping({
    required double stiffness,
    required double dampingRatio,
    double mass = 1.0,
  }) {
    return dampingRatio * 2.0 * math.sqrt(stiffness * mass);
  }

  // ─── Effects Tokens (Non-Spatial) — no bounce ───────────────────────────
  // For: color changes, opacity, fades

  static SpringDescription get effectsFast => SpringDescription(
    mass: 1.0,
    stiffness: 3800.0,
    damping: _criticalDamping(stiffness: 3800, dampingRatio: 1.0),
    // ≈ 123.3 — critical damping, ~150 ms
  );

  static SpringDescription get effectsDefault => SpringDescription(
    mass: 1.0,
    stiffness: 1600.0,
    damping: _criticalDamping(stiffness: 1600, dampingRatio: 1.0),
    // ≈ 80.0 — critical damping, ~300 ms
  );

  static SpringDescription get effectsSlow => SpringDescription(
    mass: 1.0,
    stiffness: 800.0,
    damping: _criticalDamping(stiffness: 800, dampingRatio: 1.0),
    // ≈ 56.6 — critical damping, ~500 ms
  );

  // ─── Spatial Tokens — with slight bounce ─────────────────────────────────
  // For: position, size, rotation movements

  /// Fast with slight overshoot (~10%). Icon surfaces, chips, button feedback.
  static SpringDescription get spatialFast => SpringDescription(
    mass: 1.0,
    stiffness: 1400.0,
    damping: _criticalDamping(stiffness: 1400, dampingRatio: 0.90),
    // ≈ 67.3 — ~240 ms
  );

  /// Organic and responsive. Bottom sheets, drawer opening, panels.
  static SpringDescription get spatialDefault => SpringDescription(
    mass: 1.0,
    stiffness: 700.0,
    damping: _criticalDamping(stiffness: 700, dampingRatio: 0.90),
    // ≈ 47.6 — ~320 ms
  );

  /// Dramatic with high inertia. Hero animations, full-screen expansions.
  static SpringDescription get spatialSlow => SpringDescription(
    mass: 1.0,
    stiffness: 300.0,
    damping: _criticalDamping(stiffness: 300, dampingRatio: 0.90),
    // ≈ 31.2 — ~500 ms
  );

  /// Large bounce (~40% overshoot). ONLY for small elements (≤56 dp):
  /// FAB menu, chips, pickers. NEVER for drawers or large surfaces.
  static SpringDescription get bouncySpatial => SpringDescription(
    mass: 1.0,
    stiffness: 400.0,
    damping: _criticalDamping(stiffness: 400, dampingRatio: 0.40),
    // ≈ 16.0 — visible expressive bounce
  );

  /// Fast return with slight oscillation. Card drag, carousels.
  static SpringDescription get snappySpatial => SpringDescription(
    mass: 1.0,
    stiffness: 1000.0,
    damping: _criticalDamping(stiffness: 1000, dampingRatio: 0.75),
    // ≈ 47.4
  );
}

/// Helper to apply a spring to an AnimationController.
extension SpringControllerExtension on AnimationController {
  TickerFuture animateWithSpring({
    required double target,
    required SpringDescription spring,
    double initialVelocity = 0.0,
  }) {
    final simulation = SpringSimulation(
      spring,
      value,         // current position
      target,        // target position
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

/// Breakpoint categories based on M3 (5 levels).
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
    if (isCompact) return double.infinity; // 100% of the screen
    return 320.0; // absolute cap for medium and above
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

/// Widget that exposes the current breakpoint to its descendants.
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

/// Root widget that computes the breakpoint from the available width.
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

### 6.3 Widget: Expressive Card with Dynamic Radii

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Position of the item within a group of cards.
enum CardGroupPosition { first, middle, last, single }

/// M3E card with dynamic corner radii according to its position in the group.
/// Includes elastic tactile feedback with spring physics.
class M3EExpressiveCard extends StatefulWidget {
  final Widget child;
  final CardGroupPosition position;
  final VoidCallback? onTap;
  final double outerRadius; // Outer corner radius
  final double innerRadius; // Inner corner radius (adjacent to neighbors)
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

  // Minimum scale at the moment of press
  static const double _pressedScale = 0.97;

  @override
  void initState() {
    super.initState();
    _scaleController = AnimationController(
      vsync: this,
      // Maximum safety duration; the spring finishes earlier
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
      target: 1.0, // toward _pressedScale from 1.0
      spring: M3ESprings.spatialFast,
    );
    // Shortcut: we use forward to compress
    _scaleController.forward();
  }

  void _onTapUp(TapUpDetails _) {
    _scaleController.animateWithSpring(
      target: 0.0, // return to scale 1.0
      spring: M3ESprings.spatialFast,
    );
    _scaleController.reverse();
  }

  void _onTapCancel() {
    _scaleController.reverse();
  }

  /// Computes the BorderRadius according to the position in the group.
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

/// Wrapper to build a list of M3EExpressiveCards with a 3 dp gap.
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

### 6.4 Widget: Responsive Navigation Drawer

```dart
import 'package:flutter/material.dart';

/// Responsive drawer that implements the Neural Expressive rules:
/// - Compact: 100% width, push to the content
/// - Medium: 320 dp max, push to the content
/// - Expanded+: permanent/pinned, no animation
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

  // Parallax factor: the content moves at 94% of the drawer's width
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

    // On expanded+, the drawer is permanent: there is no animation
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

    // Compact and Medium: modal drawer with physics push
    final drawerWidth = bp.isCompact
        ? screenWidth               // 100% on compact
        : bp.drawerWidth.clamp(0.0, screenWidth); // 320 dp capped on medium

    return AnimatedBuilder(
      animation: _drawerController,
      builder: (context, _) {
        final progress = _drawerController.value;
        // The content moves 94% of the drawer's width (parallax α=0.06)
        final contentOffset = drawerWidth * _parallaxFactor * progress;

        return Stack(
          children: [
            // Body displaced (parallax push)
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

            // Drawer sliding from the left
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

/// Inner content of the drawer with the 3 zones: header, destinations, footer.
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

            // ── Destinations (expandable) ───────────────────────────────────
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

/// Circular Icon Surface (for AppBar and drawer header).
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
      // Minimum touch area: 48×48 dp (accessibility)
      width: 48,
      height: 48,
      child: Center(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            width: 40, // Visual container: 40 dp
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

### 6.5 Widget: Floating Pill Input

```dart
import 'package:flutter/material.dart';

/// Floating pill-style input field — Neural Expressive style.
/// It is positioned over the content, decoupled from the keyboard.
class M3EPillInput extends StatefulWidget {
  final TextEditingController? controller;
  final String hintText;
  final VoidCallback? onPlusPressed;   // Opens the attachments/tools bottom sheet
  final VoidCallback? onVoicePressed;
  final ValueChanged<String>? onSubmitted;

  const M3EPillInput({
    super.key,
    this.controller,
    this.hintText = 'Type a message...',
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
          // Subtle shadow only when focused — not as a base state
        ),
        child: Row(
          children: [
            const SizedBox(width: 4),

            // "+" button — opens the attachments and tools bottom sheet
            IconButton(
              icon: const Icon(Icons.add),
              iconSize: 20,
              color: colorScheme.onSurfaceVariant,
              onPressed: widget.onPlusPressed,
            ),

            // Expandable text field
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

            // Right button: send (if there is text) or microphone (if there is no text)
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

### 6.6 Widget: Material 3 Expressive Loading Indicator

Uxnan exposes one shared `PolygonLoader` from
`lib/presentation/widgets/expressive_progress.dart`. It preserves the app's
compact `size` / semantic `color` API while delegating the geometry to
`material_loading_indicator`, the MIT-licensed Flutter port of AndroidX
Material 3's `LoadingIndicator`.

The production implementation must not interpolate raw polygon vertices by
index. Shapes with different feature counts need `RoundedPolygon` feature
matching and cubic-curve correspondence through `Morph`; otherwise corners
cross, collapse, or jump between frames. The canonical indeterminate sequence
is soft burst → 9-sided cookie → pentagon → pill → sunny → 4-sided cookie →
oval, with the Material rotation and 650 ms scale/morph cycle.

Because the canonical component owns a 48 dp canvas, Uxnan scales it through a
`FittedBox` to each call site's requested size without changing its internal
proportions. The wrapper isolates repainting and disables its ticker under
`MediaQuery.disableAnimations`, leaving the first expressive shape visible
and semantic for reduced-motion users.

**Every indeterminate spinner in the app is this widget.** `PolygonLoader` owns
its own `SizedBox.square` + `RepaintBoundary`, so a call site passes `size`
directly instead of wrapping it (its default is 18 dp — the repo lints a
redundant `size: 18`). The sizes in use, by context:

| Context | `size` |
| --- | --- |
| Full-screen / `SliverFillRemaining` empty state | 48 |
| Section block (heatmap, provider cards, licenses) | `UxnanSpacing.xxl` (32) |
| Sheet / picker | 22–28 |
| Inline beside text, in a button, or a header action | 10–20 |

**The one exception — a gauge is not a loader.** `PolygonLoader` is
indeterminate *by design*: it has no `value`. Two call sites therefore keep a
`CircularProgressIndicator`, because each draws a number the user reads — the
conversation's **context-usage ring** (percent of the model window used) and
Settings ▸ Updates' **download progress** (fraction of the APK fetched).
Converting them would silently discard that information. `loader_consistency_test.dart`
enforces both halves of this rule: no stray spinner anywhere else, and those two
sites still passing a `value:`.
---

## 7. Governance, Accessibility, and Performance

### 7.1 Accessibility — Non-Negotiable

| Requirement | Value | Application |
|:----------|:------|:-----------|
| Minimum touch area | 48×48 dp | All interactive elements, including 40 dp Icon Surfaces |
| Text/background contrast | 4.5:1 | Text in `bodyLarge`, `bodyMedium`, `labelLarge` |
| Icon/background contrast | 3.0:1 | Navigation and action icons |
| `semanticLabel` | Required | All icon-only buttons |
| `Semantics(checked:)` | Required | Toggle groups, checkboxes |
| Reduced motion | Respect | Detect `MediaQuery.of(ctx).disableAnimations` and use `effectsDefault` |

```dart
// Detect reduced-motion preference
final reducedMotion = MediaQuery.of(context).disableAnimations;
final spring = reducedMotion
    ? M3ESprings.effectsDefault  // no bounce, resolves quickly
    : M3ESprings.spatialDefault; // normal behavior
```

### 7.2 Expressive Moderation Rule

**A maximum of 1–2 high-impact expressive moments per screen.**

The expressive moments are: Hero animations, expanded FAB, polygonal morphing,
`bouncySpatial`. The rest of the UI uses Standard or Spatial tokens without bounce.

The goal of Neural Expressive is to **reduce visual noise**, not increase it.
An excess of simultaneous animations contradicts the system's fundamental principle.

### 7.3 Performance

- Complex animations (polygon morphing, Hero transitions): use `RepaintBoundary`
  to isolate the subtree from the paint layer of the rest of the UI.
- Under reduced motion, freeze the shared indicator on its first expressive
  shape instead of running its rotation/morph ticker.
- Verify that all `AnimationController`s are disposed in `dispose()`.
- In long lists (> 100 items), the dynamic radii are computed without overhead
  at paint time (they are just `BorderRadius`, no shaders).

### 7.4 Implementation Checklist

Before marking a widget as "complete" in your design system:

- [ ] Are the spring physics tokens used correct for the element's size?
- [ ] Does the drawer use `spatialDefault` on opening and `spatialFast` on closing?
- [ ] Do the Icon Surfaces have 40 dp visual and 48 dp touch area?
- [ ] Is the drawer in Compact 100% of the screen width?
- [ ] In Expanded+, is the drawer permanent (no opening animation)?
- [ ] Do the grouped lists have a 3 dp gap and dynamic radii (24/4)?
- [ ] Does loading use the shared feature-matched `PolygonLoader`?
- [ ] Is `bouncySpatial` used ONLY on elements ≤ 56 dp?
- [ ] Is there support for accessibility `disableAnimations`?
- [ ] Do the icon-only button texts have a `semanticLabel`?
- [ ] Does the color contrast meet WCAG AA (4.5:1 text, 3:1 icons)?

### 7.5 Onboarding and Connection Entry Points

The no-devices state is the body of the standard Devices screen, not a separate
bare scaffold. It retains the transparent Devices app bar and its pairing,
profile, and settings actions. Its centered hero uses the bundled Uxnan mark
(`logo_fg.svg`) in the semantic `onSurface` color instead of a generic device
or network glyph.

Onboarding uses a calm, solid `surface` backdrop. Do not place a persistent
grid, glow, or full-screen decorative gradient behind the entire flow: those
patterns compete with changing page content and make setup feel disconnected
from the product. Let decorative agent logos breathe directly on the canvas;
do not trap them inside another card. Use the app's established rounded-
rectangle hero geometry and a cohesive floating navigation surface. Connection
alternatives use the same hero geometry and constrained content width so QR and
manual-code entry feel like one journey.

Ambient logo motion is decorative and must freeze when
`MediaQuery.disableAnimationsOf(context)` is true.

---

*Guide produced based on verified sources: Google I/O 2025 (M3E announcement),
Google I/O 2026 (Neural Expressive launch), official specifications at m3.material.io,
technical coverage from 9to5Google, Android Authority, and UrDesign Magazine.*
