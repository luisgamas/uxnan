# Design language

The site borrows the product's own materials: the near-black neutral shell Uxnan
Desktop runs in, the mint and blue that Uxnan Mobile uses for live state, and the
two faces both apps ship with. Nothing on the page is decorative for its own
sake — if a surface is on screen, it is either the product or the argument.

## Tokens

Defined once in [`src/app/globals.css`](../src/app/globals.css) under `@theme`,
consumed as Tailwind utilities (`bg-panel`, `text-muted`, `border-line`…).

| Token | Value | Used for |
|---|---|---|
| `ink` / `ink-soft` | `#08080a` / `#0b0b0e` | page and window backgrounds |
| `panel` / `card` / `raise` | `#121216` / `#16161b` / `#1c1c22` | panels, tiles, active rows |
| `fg` / `muted` / `dim` / `faint` | `#fafafa` → `#4d4d57` | four steps of text, in that order |
| `line` / `line-2` | white at 8% / 14% | hairlines; nothing heavier than 1px |
| `brand` / `brand-lit` | `#1b6ef3` / `#5a97ff` | ambient light, links, "done" |
| `live` | `#00c896` | running agents, success, prompts |
| `orange` | `#f97316` | "waiting on you" — an agent needs *your* input |
| `amber` | `#f5a524` | "blocked" — an agent is waiting on another system; also the running-command hint |

Both brand seeds are the mobile app's (`uxnanmobile/lib/presentation/theme/colors.dart`).
Accent is rationed: a whole section may pass without any.

**Type.** Geist for everything, JetBrains Mono for terminals, paths, commands and
eyebrows — the same pairing the desktop app uses. Display headings are weight 500
with `-0.042em` tracking; body copy stays at 14.5–17px and never goes lighter
than `muted` for anything a reader must actually read.

**Motion.** Reveal on scroll (14px rise, 700ms, one observer per block, then
disconnected), a 2.4s pulse on live status dots, a blinking caret, a slow sweep
on the worktree strip. Everything respects `prefers-reduced-motion`. No
scroll-linked animation, no per-frame React work.

## Mockup fidelity

The mockups are the product's credibility on this page. They must read as the
same software a visitor is about to download.

**Rules:**

1. **Copy the shipped UI, not an idealized one.** The title bar says
   `Uxnan Desktop` with the `ALPHA` chip because that is what the app shows;
   worktree tabs, the `Ctrl P` search hint, the `Files / Changes / History /
   GitHub` panel order, the `auto mode on (shift+tab to cycle)` footer and the
   `▶▶` marker are all lifted from the real window. The phone screens follow the
   Material 3 "Neural Expressive" language documented in
   `uxnanmobile/docs/neural-expressive-design.md`: light surfaces, 16–20px
   rounded cards, tinted icon squares, mint containers for live state, a
   floating pill composer with the `+` turn-tools button.
2. **Only show states the product can actually be in.** Four agents, one of them
   idle; a subagent nested under its parent; a queued message that "delivers
   mid-turn" — each of those is a real feature. Never invent a control.
3. **Never show an agent that is not offered.** The seven come from `AGENTS` in
   `src/lib/site.ts`; the deprecated Gemini CLI must not appear.
4. **Keep the content plausible and boring.** Branch names, repo names and
   terminal output describe work on this monorepo. No invented customers, no
   fake handles, no personal paths.
5. **Marks come from `assets/agents/` at the repository root** — the same seven
   SVGs the root READMEs render. `scripts/sync-agent-marks.mjs` copies them into
   `public/agents/` before dev and build, so `public/agents/` is git-ignored and
   the two surfaces cannot drift. Nothing is fetched from a third party at page
   load. Update a mark once, in `assets/agents/`.
6. **Lift the dark marks, never the light ones.** `codex.svg` is authored with
   `fill="currentColor"`, which resolves to **black** inside an `<img>`, and
   `opencode` / `pi` / `grok` ship grey — all four are invisible or muddy on this
   page's dark tiles, so `INVERT_ON_DARK` (`src/lib/site.ts`) flips them to
   near-white there. The phone mockups must **not** invert: their tiles are
   white, which is exactly where a black mark belongs. Claude's orange and
   Antigravity's gradient are never touched.

## Phone mockups scale, they do not resize

Every phone screen is authored once at a canonical **260 × 563** box — a
1080 × 2340 device at 0.24 — and `<Phone width={…}>` scales that box with a
`transform`. Type, radii and spacing therefore keep the app's real proportions
whether the frame is 186 px in a trio or 236 px on its own, exactly like a
screenshot would. **Never size a phone's contents to its frame**: that is what
made the first pass look like a tablet UI shrunk down. Sizes inside the screens
are the app's own dp values × 0.24.

When the apps change their chrome, these components are part of the change set —
a mockup of a UI that no longer exists is worse than no mockup.

## Responsiveness

The desktop window drops its project rail below `md` and its right panel below
`lg`, keeping the terminal — the part that carries the message — at every width.
The hero phone appears at `lg`, the floating agents card at `xl`. The phone trio
in the mobile section collapses to the middle screen alone on small viewports.
Nothing scrolls horizontally at 320px.
