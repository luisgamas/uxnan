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
  import { WebglAddon } from "@xterm/addon-webgl";
  import { LigaturesAddon } from "@xterm/addon-ligatures";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import "@xterm/xterm/css/xterm.css";
  import { openUrl } from "$lib/api";
  import { i18n } from "$lib/i18n";
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

  // Shell output is debounced before typing an agent command so profile scripts
  // can finish drawing their prompt. Quiet shells still launch via the fallback.
  const RUN_COMMAND_QUIET_MS = 160;
  const RUN_COMMAND_FALLBACK_MS = 1800;

  let el: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  // Kept when the WebGL renderer is active so a resize/reveal can force a clean
  // repaint (clearing the glyph atlas) and drop any stale frame.
  let renderer: WebglAddon | undefined;
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
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  let ptyReady = false;

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

  // Force one clean repaint of the whole viewport on the next frame. The WebGL
  // renderer diffs against a cached cell model and skips cells it deems unchanged,
  // so after a resize/reveal it can keep compositing stale pixels for those cells
  // (a leftover sliver of the previous frame). `clearTextureAtlas()` resets that
  // model and requests a full redraw; the `refresh` covers the DOM fallback. This
  // is the repaint used on every ordinary resize — no context teardown needed.
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

  // Load the WebGL renderer and wire GPU context-loss recovery. WebView2 can drop
  // the GL context under heavy compositing (e.g. while dragging a panel divider);
  // without this handler the addon keeps compositing a frozen/garbage frame — the
  // "stale frame" artifact. On a real loss we dispose the dead addon (xterm falls
  // back to the DOM renderer) and reattach a fresh WebGL surface on the next frame,
  // staying on DOM only if WebGL won't come back. Mirrors xterm's recommended setup
  // (and VS Code's). Ordinary resizes/reveals just forceRepaint — they never tear
  // the context down, which is both cheaper and avoids the disposer-throws race.
  function attachRenderer() {
    if (!term) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        disposeRenderer(webgl);
        requestAnimationFrame(() => {
          if (term && !renderer) attachRenderer();
          forceRepaint();
        });
      });
      term.loadAddon(webgl);
      renderer = webgl;
    } catch {
      // WebGL unavailable — xterm falls back to the DOM renderer.
      renderer = undefined;
    }
  }

  // Dispose the accelerated addon defensively. xterm's WebGL disposer reaches into
  // the terminal core (to swap back to the DOM renderer), which throws if the core
  // is mid-teardown (unmount / HMR races); an uncaught throw there would leave xterm
  // with no renderer at all — a blank pane. Swallow it and clear our handle.
  function disposeRenderer(target: WebglAddon | undefined = renderer) {
    if (renderer === target) renderer = undefined;
    try {
      target?.dispose();
    } catch {
      // Already disposed or core torn down — nothing else to clean up.
    }
  }

  // Fit the xterm grid to the pane, resize the PTY only on a real grid change,
  // and repaint whenever the canvas dimensions actually changed.
  function applyFit() {
    if (!term || !fit || !hasVisibleGeometry()) return;
    const beforeCols = term.cols;
    const beforeRows = term.rows;
    const distanceFromBottom = term.buffer.active.baseY - term.buffer.active.viewportY;
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
    if (distanceFromBottom > 0) {
      term.scrollToLine(Math.max(0, term.buffer.active.baseY - distanceFromBottom));
    }
  }

  function scheduleAgentLaunch(delay = RUN_COMMAND_QUIET_MS) {
    if (!runCommand || !ptyReady || launchedIds.has(id)) return;
    if (launchTimer) clearTimeout(launchTimer);
    launchTimer = setTimeout(async () => {
      launchTimer = undefined;
      try {
        await invoke("pty_write", { id, data: `${runCommand}\r` });
        launchedIds.add(id);
      } catch {
        // Leave the id retryable if the backend was not ready for this write.
      }
    }, delay);
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
    // WebGL is the primary renderer in every case. The ligatures addon renders
    // through WebGL's character joiner (the WebGL renderer resolves joined ranges
    // itself — the same path VS Code uses), so ligatures are NOT mutually exclusive
    // with the accelerated renderer. Falling back to the DOM renderer for ligatures
    // is what let the browser shape text off the monospace grid, drifting glyphs
    // away from their cells and breaking mouse selection (it anchored to the grid
    // while glyphs sat elsewhere). Load WebGL first, then stack ligatures on top;
    // DOM stays the fallback only when WebGL itself is unavailable.
    attachRenderer();
    if (t.ligatures) {
      try {
        term.loadAddon(new LigaturesAddon());
      } catch {
        // Ligatures addon unavailable — glyphs still render, just without ligatures.
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
        scheduleAgentLaunch();
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
    let created = true;
    let spawnFailed = false;
    try {
      created = await invoke<boolean>("pty_create", {
        id,
        cwd,
        shell,
        args,
        env,
        cols: term.cols || 80,
        rows: term.rows || 24,
      });
      ptyReady = true;
    } catch (e) {
      // Only a real backend rejection means the shell failed to spawn (a missing
      // shell / bad profile). Surface it in the pane instead of a silent black
      // screen, and don't type the agent command into a dead PTY. In a plain web
      // preview there's no Tauri backend at all — keep `created = true` there.
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        spawnFailed = true;
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : String(e);
        term?.writeln(`\r\n\x1b[31m${i18n.t("terminal.spawnFailed")}\x1b[0m`);
        term?.writeln(`\x1b[90m${msg}\x1b[0m`);
      }
    }

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

    // Wait for shell output to settle before typing. PowerShell profiles often
    // take longer than a fixed delay; the fallback covers a silent prompt.
    if (runCommand && !spawnFailed && !launchedIds.has(id)) {
      scheduleAgentLaunch(RUN_COMMAND_FALLBACK_MS);
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
  // and color changes apply in place; toggling ligatures is only wired at mount
  // (the ligatures addon isn't hot-swapped here), so that takes effect on next open.
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
    if (launchTimer) clearTimeout(launchTimer);
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
