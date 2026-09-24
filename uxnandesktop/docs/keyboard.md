# Keyboard shortcuts

Every key the app can hear goes through one layer, `src/lib/keyboard/`. It
decides who gets the key by **where the focus is**, so a shortcut never steals a
key a terminal, an editor or a text field needs, and a key those surfaces leave
alone still reaches the app. The spec is `architecture/02b` §4.b.

| File | Role |
|---|---|
| `chords.ts` | How a chord is written, read from a key event, compared and drawn (pure) |
| `actions.ts` | The registry: every action, its default chord per platform, its scope and its terminal policy (pure data) |
| `router.ts` | Who gets a key, by focus context (pure) |
| `run.ts` | Runs an action once it was decided — the only place actions run |
| `keyboard.svelte.ts` | The person's bindings and choices, the two UI entry points, and the native layer's sync |
| `src-tauri/src/keyboard.rs` | The native half: global shortcuts inside a browser page, the WebView2 engine keys |
| `src-tauri/src/menu.rs` | The macOS menu bar |

## Chords

A chord is `+`-joined, modifiers first in a fixed order: `Mod+Shift+P`,
`Ctrl+Tab`, `Alt+ArrowRight`. **`Mod` is the platform's primary modifier** — ⌘ on
macOS, Ctrl on Windows and Linux — so one binding means the natural thing on
every platform. `Ctrl` is the literal Control key: its own modifier on macOS
(⌃), the same as `Mod` elsewhere. Chords are compared in canonical form
(`normalizeChord`), and a key typed with Option (macOS) or AltGr reads as its
key, not the character it produced (⌥⌘S is `Mod+Alt+S`, not `Mod+Alt+ß`).

## Defaults

Most defaults are the same chord on every platform. Where a platform already
spends the natural chord, the registry gives a `{ mac, other }` pair:

| Action | macOS | Windows / Linux | Why |
|---|---|---|---|
| Next / previous tab | ⌃⇥ / ⌃⇧⇥ | Ctrl+Tab / Ctrl+Shift+Tab | ⌘⇥ is the app switcher and never reaches an app |
| Next / previous split | ⌥⌘→ / ⌥⌘← | Alt+→ / Alt+← | Ctrl+Alt+arrows switch desktops on GNOME and rotate the screen on some Windows drivers |
| Clear terminal | ⌘K | Ctrl+K goes to the shell (kill-line) unless you choose otherwise | ⌘K is the Mac convention |
| Sleep workspace | — | — | It ends the workspace's shells and idle agents: no chord you could hit by accident (it used to be Redo's). Assign one, or use the worktree row's menu |

Everything is rebindable in **Settings → Keyboard shortcuts**; an empty binding
turns an action off.

## Who gets a key

The router looks at the focused element:

- **Terminal** (xterm) — its own key hook routes first, before xterm acts:
  1. the **focus-mode** toggle always wins, so you can always leave focus mode;
  2. after the **leader key**, the next shortcut goes to Uxnan whatever its
     policy;
  3. in **focus mode** every key goes to the TUI;
  4. otherwise the action's **terminal policy**: *Uxnan* wins, or the key goes to
     the *TUI*. The defaults yield the chords a shell uses — Ctrl+W (delete
     word), Ctrl+P (history), Ctrl+S (XOFF), Ctrl+J (newline), Ctrl+B (tmux
     prefix), Ctrl+K (kill line), Ctrl+O — and reserve the rest. **On macOS a ⌘
     shortcut wins** unless you choose otherwise: ⌘ never reaches a shell.
- **Editor** (CodeMirror) and **text fields** (inputs, textareas, anything
  editable) keep typing, caret movement and selection, deletion, undo / redo,
  select all and the clipboard — so ⌘⇧Z redoes and ⌘⇧→ selects there even if an
  action uses that chord. A key the editor's own keymap handled (save, find) is
  left alone.
- **Anywhere else**, a bound chord runs its action.

Copy and paste in a terminal: ⌘C / ⌘V on macOS; Ctrl+C (with a selection —
without one it is SIGINT) / Ctrl+V, and the terminal convention Ctrl+Shift+C /
Ctrl+Shift+V, on Windows and Linux.

## Global shortcuts and the browser page

A browser page is a separate native webview: its keys never reach the app's UI,
and a page must never be able to call the app. Actions the registry marks
`global` — the dock and its surfaces, the sidebar, new terminals and
worktrees, the palettes, Settings, Automations — are therefore also heard
natively, and sent back to the UI as a `keyboard:action` event:

- **macOS** — through the **menu bar**, which carries those commands with your
  bindings (rebuilt when they or the language change). A menu shortcut runs only
  for a key the focused webview left unhandled, so the page gets its own keys
  first. In the app's UI the key is handled before it gets there, so an action
  never runs twice.
- **Windows** — the page's WebView2 reports accelerator keys (anything with Ctrl
  or Alt, the function keys) before the page sees them.
- **Linux** — the page's GTK widget reports its key presses.

Actions that act on what has focus (close tab, cycle tabs, splits, save) are not
global: with the page focused they belong to the page.

## The macOS menu bar

The app builds its own (`menu.rs`): the default one bound **Close Window to
⌘W** — ⌘W in a terminal closed the whole window — and its Quit ended the process
without the app's shutdown.

- **App** — About, Settings…, Services, Hide, Quit (⌘Q).
- **File** — New terminal, New global terminal, New worktree, Add project,
  Close Window (**⌘⇧W**).
- **Edit** — the standard editing items (how ⌘C / ⌘V / ⌘Z reach a text field).
- **View** — the panels, the palettes, full screen.
- **Window** — Minimize, Zoom.

A command bound to a chord a standard item already uses (⌘Z, ⌘C, ⌘Q, ⌘H…) is
listed without its shortcut. Windows and Linux have no menu bar: the window is
frameless and draws its own controls.

## Closing the app

Every way of closing the window — its button, Alt+F4, ⌘Q, Close Window — goes
through the same path: if an agent is mid-turn or a file has unsaved edits the
app asks first (`closeGuard`), then flushes pending writes and closes. A quit
that bypasses the window (the Dock's Quit, logging out) still stops every shell
and runs the backend's teardown.

## Engine keys

In release builds the main window has **no web inspector**, so F12 or
Ctrl+Shift+I cannot open DevTools on the app itself; on Windows, WebView2's
**browser keys are off** (F5 / Ctrl+R reloaded the whole UI, Ctrl+F and Ctrl+P
opened find and print, Alt+← navigated the app's history). Development builds
keep both, for debugging. A browser page keeps its own — it is a browser.

## Testing

`src/lib/keyboard/*.test.ts` cover the chord model, the router and the bindings;
`keyboard.rs` and `menu.rs` cover the native chord and key mapping and the menu
accelerators. What only a real machine shows — the menu bar, and the page
shortcuts on Windows and Linux — is on each platform's smoke checklist
(`docs/platform-support.md`).
