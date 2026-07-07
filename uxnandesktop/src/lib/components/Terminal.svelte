<script lang="ts" module>
  // Terminal ids that have already been sent their agent launch command. Module
  // scope (shared across mounts) so a remount never re-types the command into an
  // already-running agent.
  const launchedIds = new Set<string>();

  /** Read CSI parameter `i` as a non-negative integer, or `def` when absent.
   *  (xterm hands sub-parameters as `number[]`; the keyboard sequences here
   *  never use them, so those are treated as absent.) */
  function numParam(params: (number | number[])[], i: number, def: number): number {
    const v = params[i];
    return typeof v === "number" && v >= 0 ? v : def;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { CanvasAddon } from "@xterm/addon-canvas";
  import { LigaturesAddon } from "@xterm/addon-ligatures";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import "@xterm/xterm/css/xterm.css";
  import { openUrl } from "$lib/api";
  import { clipboardRead, clipboardWrite } from "$lib/clipboard";
  import { terminals } from "$lib/state/terminals.svelte";
  import { agentMonitor } from "$lib/state/agentMonitor.svelte";
  import { app } from "$lib/state/app.svelte";
  import { KeyboardProtocol } from "$lib/terminal/keyboardProtocol";
  import { matchAction, isMac } from "$lib/keybindings";
  import { projects } from "$lib/state/projects.svelte";

  // Effective terminal appearance (general theme base + per-terminal overrides:
  // font, size, line height, spacing, weight, ligatures, cursor, ANSI colors).
  const termOpts = $derived(app.resolveTerminal());

  let {
    id,
    focused,
    cwd,
    shell,
    args,
    runCommand,
    env,
    onexit,
  }: {
    id: string;
    focused: boolean;
    cwd?: string;
    shell?: string;
    args?: string[];
    runCommand?: string;
    env?: [string, string][];
    onexit?: () => void;
  } = $props();

  // Give an interactive shell a moment to load its profile and draw a prompt
  // before we type the agent command into it (otherwise it can land mid-init).
  const RUN_COMMAND_DELAY_MS = 400;

  let el: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  // Kept when the Canvas renderer is active so a resize/reveal can force a clean
  // repaint (clearing the glyph atlas) and drop any stale frame.
  let renderer: CanvasAddon | undefined;
  // Kitty/CSI-u keyboard protocol state for this terminal. Dormant until an app
  // running in the PTY negotiates it; see `keyboardProtocol.ts`.
  const kbd = new KeyboardProtocol();
  let unlisteners: UnlistenFn[] = [];
  let resizeObserver: ResizeObserver | undefined;
  // Pending animation frames: the settled-grid fit loop, and the post-fit repaint.
  let stableFitRaf: number | null = null;
  let repaintRaf: number | null = null;
  // Tracks display:none → shown transitions so a revealed pane repaints even when
  // its grid size is unchanged (a hidden canvas can keep its pre-hide pixels).
  let wasVisible = false;
  // Last size sent to the PTY — we only resize on a real change, so a redundant
  // resize doesn't fire SIGWINCH and make a full-screen agent TUI repaint/jump.
  let lastCols = 0;
  let lastRows = 0;

  // --- Copy / paste --------------------------------------------------------
  function copySelection() {
    const selection = term?.getSelection();
    if (selection) void clipboardWrite(selection);
  }
  async function pasteClipboard() {
    const text = await clipboardRead();
    if (text) term?.paste(text); // fires onData → pty_write
  }
  const hasSelection = () => !!term?.getSelection();

  // Minimum measured pane size we'll fit to. Below this (a transient near-zero
  // measurement mid-layout, or a collapsed pane) the fit is skipped so the PTY is
  // never pinned to a 2-column grid that a full-screen agent would reflow to.
  const MIN_FIT_WIDTH_PX = 40;
  const MIN_FIT_HEIGHT_PX = 24;

  function hasVisibleGeometry(): boolean {
    const r = el.getBoundingClientRect();
    return r.width >= MIN_FIT_WIDTH_PX && r.height >= MIN_FIT_HEIGHT_PX;
  }

  function proposeDimensions(): { cols: number; rows: number } | null {
    try {
      return fit?.proposeDimensions() ?? null;
    } catch {
      return null;
    }
  }

  // Force one clean repaint of the whole viewport on the next frame. When a pane
  // is revealed from display:none, a canvas renderer can keep compositing its
  // pre-hide pixels for cells it deems unchanged; clearing the glyph atlas and
  // refreshing every row rebuilds the frame from the buffer. A cheap safety net —
  // the Canvas renderer already repaints cleanly on a normal resize.
  function forceRepaint() {
    if (repaintRaf !== null) cancelAnimationFrame(repaintRaf);
    repaintRaf = requestAnimationFrame(() => {
      repaintRaf = null;
      if (!term) return;
      try {
        renderer?.clearTextureAtlas();
      } catch {
        // Renderer swapped or disposed — the refresh below still repaints.
      }
      try {
        term.refresh(0, Math.max(0, term.rows - 1));
      } catch {
        // Terminal may have been disposed; ignore.
      }
    });
  }

  // Fit the xterm grid to the pane, resize the PTY only on a real grid change,
  // and repaint whenever the canvas dimensions actually changed.
  function applyFit() {
    if (!term || !fit || !hasVisibleGeometry()) return;
    const beforeCols = term.cols;
    const beforeRows = term.rows;
    try {
      fit.fit();
    } catch {
      // Container not measurable yet; a later resize will retry.
      return;
    }
    if (term.cols !== lastCols || term.rows !== lastRows) {
      lastCols = term.cols;
      lastRows = term.rows;
      invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(
        () => {},
      );
    }
    if (term.cols !== beforeCols || term.rows !== beforeRows) forceRepaint();
  }

  // Re-fit only once the proposed grid stops changing between animation frames.
  // A divider drag or window resize fires many intermediate sizes; applying each
  // one spams the PTY with SIGWINCH and briefly wobbles the scrollbar (a
  // one-column anchor). Waiting for the proposed grid to repeat across two frames
  // (capped at MAX_STABILITY_FRAMES) applies only the settled size. The
  // ResizeObserver restarts this wait on every layout change.
  const MAX_STABILITY_FRAMES = 8;
  function fitToPane() {
    if (stableFitRaf !== null) cancelAnimationFrame(stableFitRaf);
    let frames = 0;
    let previous: { cols: number; rows: number } | null = null;
    const tick = () => {
      stableFitRaf = null;
      if (!term || !fit || !hasVisibleGeometry()) return;
      const next = proposeDimensions();
      if (!next) {
        applyFit();
        return;
      }
      // Proposed grid already matches the live terminal — nothing to do.
      if (term.cols === next.cols && term.rows === next.rows) return;
      // Same proposal two frames running — the layout has settled; apply it.
      if (previous && previous.cols === next.cols && previous.rows === next.rows) {
        applyFit();
        return;
      }
      previous = next;
      if (++frames >= MAX_STABILITY_FRAMES) {
        applyFit();
        return;
      }
      stableFitRaf = requestAnimationFrame(tick);
    };
    stableFitRaf = requestAnimationFrame(tick);
  }

  onMount(async () => {
    const t = app.resolveTerminal();
    term = new Terminal({
      cursorBlink: t.cursorBlink,
      cursorStyle: t.cursorStyle,
      fontSize: t.fontSize,
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fontWeight: t.fontWeight as never,
      // Bounded scrollback caps per-terminal memory (hidden terminals stay
      // mounted, so this is the effective limit on their retained output).
      scrollback: 5000,
      fontFamily: t.fontFamily,
      theme: { ...t.theme },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Ligatures need the DOM renderer, so they're mutually exclusive with the
    // Canvas renderer. Canvas is preferred over WebGL here: it repaints cleanly
    // on resize (WebGL could leave a stale sliver of the previous frame stuck at
    // the right edge on WebView2), and is plenty fast for agent TUIs.
    if (t.ligatures) {
      try {
        term.loadAddon(new LigaturesAddon());
      } catch {
        // Ligatures addon unavailable — plain DOM rendering still works.
      }
    } else {
      try {
        renderer = new CanvasAddon();
        term.loadAddon(renderer);
      } catch {
        // Canvas renderer unavailable — xterm falls back to the DOM renderer.
        renderer = undefined;
      }
    }

    // Make printed URLs clickable, routed through the integrated-browser link
    // policy (in-app tab / OS browser / prompt). Gated on the setting; like
    // ligatures, the choice applies to terminals created after it changes.
    if (app.settings.browser?.terminalLinks ?? true) {
      try {
        term.loadAddon(
          new WebLinksAddon((event, uri) => {
            // Like VS Code: only Ctrl/Cmd-click follows a link; a plain click is
            // just text selection (so links don't open by accident).
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            void openUrl(uri).catch(() => {});
          }),
        );
      } catch {
        // web-links addon unavailable — URLs just stay non-clickable.
      }
    }

    // Layer 2 monitoring: agents that update the terminal title (OSC 0/2) report
    // their state in it ("thinking…", "waiting for input", "done"); map it.
    term.onTitleChange((title) => agentMonitor.noteTitle(id, title));

    const ptyWrite = (data: string) => invoke("pty_write", { id, data }).catch(() => {});

    // Custom key handling (everything else — Ctrl+←/→ word nav, Home/End, … —
    // falls through to xterm's defaults and on to the PTY):
    //  - Configurable app shortcuts (close tab, tab cycle, split focus) win even
    //    while a terminal is focused — the global +page handler ignores keys
    //    inside xterm, so they're matched here against the user's chords.
    //  - Ctrl+C copies when there's a selection, else passes through as SIGINT.
    //  - Ctrl+V pastes once (preventDefault stops a duplicate native paste).
    //  - When an app negotiates the Kitty/CSI-u keyboard protocol, keys are
    //    encoded for it (dormant otherwise — existing behaviour is unchanged).
    //  - Shift+Enter / Alt+Enter insert a newline (xterm otherwise collapses
    //    them to a plain Enter, so agents can't get a multi-line prompt).
    term.attachCustomKeyEventHandler((e) => {
      // Key release matters only to the protocol's event-type reporting.
      if (e.type === "keyup") {
        const seq = kbd.encodeKeyUp(e);
        if (seq !== null) {
          ptyWrite(seq);
          e.preventDefault();
          return false;
        }
        return true;
      }
      if (e.type !== "keydown") return true;

      // Configurable app shortcuts that always win, even under the keyboard
      // protocol. `closeCenter` (default Ctrl/⌘+W) closes this tab with the
      // usual unsaved-file prompt; the others cycle tabs / move split focus.
      // Anything else (Ctrl+W rebound away, other actions) falls through to the
      // shell as before.
      switch (matchAction(e)) {
        case "closeCenter":
          void terminals.closeTabAnywhere(id);
          e.preventDefault();
          return false;
        case "newTerminal":
          app.openTerminal();
          e.preventDefault();
          return false;
        case "newGlobalTerminal":
          app.openGlobalTerminal();
          e.preventDefault();
          return false;
        case "splitRight":
          app.splitActiveTerminal("row");
          e.preventDefault();
          return false;
        case "splitDown":
          app.splitActiveTerminal("col");
          e.preventDefault();
          return false;
        case "cycleTabNext":
          terminals.cycleTab(true);
          e.preventDefault();
          return false;
        case "cycleTabPrev":
          terminals.cycleTab(false);
          e.preventDefault();
          return false;
        case "focusSplitNext":
          terminals.focusSplit(1);
          e.preventDefault();
          return false;
        case "focusSplitPrev":
          terminals.focusSplit(-1);
          e.preventDefault();
          return false;
        case "newWorktree":
          projects.requestNewWorktree();
          e.preventDefault();
          return false;
      }

      // Copy / paste on the platform's primary modifier: ⌘ on macOS, Ctrl
      // elsewhere. On macOS this keeps Ctrl+C as the shell's SIGINT (only ⌘+C
      // copies); on Windows/Linux Ctrl+C copies when there's a selection.
      const primaryMod = isMac ? e.metaKey : e.ctrlKey;
      if (primaryMod && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === "c" && term?.hasSelection()) {
          copySelection();
          term.clearSelection();
          e.preventDefault();
          return false;
        }
        if (key === "v") {
          e.preventDefault();
          void pasteClipboard();
          return false;
        }
      }

      // Modern keyboard protocol: encode the key when an app has enabled it.
      const seq = kbd.encodeKeyDown(e);
      if (seq !== null) {
        ptyWrite(seq);
        e.preventDefault();
        return false;
      }

      // Multi-line prompt convenience (when the protocol isn't driving keys).
      if (e.key === "Enter" && (e.shiftKey || e.altKey) && !e.ctrlKey) {
        ptyWrite("\n");
        e.preventDefault();
        return false;
      }
      return true;
    });

    // Kitty/CSI-u protocol negotiation: an app enables/queries it via these
    // prefixed `… u` sequences. The handlers update `kbd`'s flag stack; a query
    // is answered straight back to the PTY. Registered only on this terminal's
    // parser, disposed with it.
    for (const handler of [
      term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
        ptyWrite(kbd.queryReply());
        return true;
      }),
      term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
        kbd.push(numParam(params, 0, 0));
        return true;
      }),
      term.parser.registerCsiHandler({ prefix: "<", final: "u" }, (params) => {
        kbd.pop(numParam(params, 0, 1));
        return true;
      }),
      term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (params) => {
        kbd.set(numParam(params, 0, 0), numParam(params, 1, 1));
        return true;
      }),
    ]) {
      unlisteners.push(() => handler.dispose());
    }

    // Subscribe BEFORE spawning so no early output is missed.
    unlisteners.push(
      await listen<number[]>(`pty:output:${id}`, (e) => {
        term?.write(new Uint8Array(e.payload));
        agentMonitor.noteOutput(id);
      }),
    );
    unlisteners.push(
      await listen(`pty:exit:${id}`, () => {
        onexit?.();
      }),
    );

    // Let the layout settle so the first fit measures real dimensions.
    await tick();
    fitToPane();

    // `created` is false when the PTY already existed — i.e. this xterm is a
    // *remount* onto a live session (e.g. the tab was dragged to another region,
    // which recreates its Svelte component). Default to true on failure (web
    // preview) so we don't chase a snapshot that can't exist.
    const created = await invoke<boolean>("pty_create", {
      id,
      cwd,
      shell,
      args,
      env,
      cols: term.cols || 80,
      rows: term.rows || 24,
    }).catch(() => true);

    // Remount: replay the backend's retained output so the fresh xterm shows the
    // scrollback it had before, instead of an empty screen until the next byte.
    if (created === false) {
      try {
        const snap = await invoke<{ data: number[]; stale: boolean }>("pty_snapshot", { id });
        if (snap.data.length) {
          term?.reset();
          term?.write(new Uint8Array(snap.data));
        }
      } catch {
        // No snapshot (unknown id / not in Tauri) — keep the live stream only.
      }
    }

    // Agent launch: type the command into the freshly-started shell. Running it
    // inside the shell (rather than as the PTY process) lets PATH/PATHEXT shims
    // resolve (`codex.cmd`/`.ps1`), which spawning the bare command cannot.
    if (runCommand && !launchedIds.has(id)) {
      launchedIds.add(id);
      setTimeout(() => {
        invoke("pty_write", { id, data: `${runCommand}\r` }).catch(() => {});
      }, RUN_COMMAND_DELAY_MS);
    }

    term.onData((data) => {
      invoke("pty_write", { id, data }).catch(() => {});
    });

    // Coalesce a burst of layout changes (divider drag, window resize) into a
    // single settled-grid fit, so the PTY isn't spammed with SIGWINCH and the
    // scrollbar doesn't wobble mid-resize. A display:none → shown transition also
    // forces a repaint, since a hidden canvas can keep compositing stale pixels.
    resizeObserver = new ResizeObserver(() => {
      const visible = hasVisibleGeometry();
      if (visible && !wasVisible) forceRepaint();
      wasVisible = visible;
      fitToPane();
    });
    resizeObserver.observe(el);
    term.focus();

    // Expose imperative copy/paste/focus so the context menu can drive them.
    terminals.registerController(id, {
      copy: copySelection,
      paste: pasteClipboard,
      hasSelection,
      focus: () => term?.focus(),
    });
  });

  // When this pane becomes the focused one, re-fit and grab keyboard focus.
  // (Re-fitting on tab/pane resize is handled by the ResizeObserver above.)
  $effect(() => {
    if (focused && term) {
      queueMicrotask(() => {
        fitToPane();
        term?.focus();
      });
    }
  });

  // Re-apply appearance live when the theme or terminal overrides change. Font
  // and color changes apply in place; toggling ligatures needs a new terminal
  // (the renderer addon can't swap live), so that takes effect on next open.
  $effect(() => {
    const t = termOpts;
    if (!term) return;
    term.options.theme = { ...t.theme };
    term.options.fontSize = t.fontSize;
    term.options.fontFamily = t.fontFamily;
    term.options.lineHeight = t.lineHeight;
    term.options.letterSpacing = t.letterSpacing;
    term.options.fontWeight = t.fontWeight as never;
    term.options.cursorStyle = t.cursorStyle;
    term.options.cursorBlink = t.cursorBlink;
    fitToPane();
  });

  onDestroy(() => {
    terminals.unregisterController(id);
    unlisteners.forEach((fn) => fn());
    resizeObserver?.disconnect();
    if (stableFitRaf !== null) cancelAnimationFrame(stableFitRaf);
    if (repaintRaf !== null) cancelAnimationFrame(repaintRaf);
    term?.dispose();
  });
</script>

<!-- Inset the terminal a few px from the top and left edges for breathing room
     while keeping the right and bottom edges flush with the pane: the width is
     reduced by exactly the left margin (and the height by the top margin), so the
     xterm viewport — and its scrollbar — sit hard against the right seam with no
     wasted gutter. The FitAddon reserves the scrollbar's width as a column gutter,
     so glyphs never slide under the scrollbar or the right panel. The background
     matches the xterm theme so the inset blends seamlessly. -->
<div
  bind:this={el}
  style:width="calc(100% - 4px)"
  style:height="calc(100% - 4px)"
  style:margin-top="4px"
  style:margin-left="4px"
  style:background-color={termOpts.theme.background}
></div>
