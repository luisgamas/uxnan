<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { Terminal } from "@xterm/xterm";
  import type { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import { i18n } from "$lib/i18n";
  import { clipboardRead, clipboardWrite } from "$lib/clipboard";
  import { terminals } from "$lib/state/terminals.svelte";
  import { app } from "$lib/state/app.svelte";
  import {
    acquireInstance,
    adoptInstance,
    releaseInstance,
    disposeInstance,
    spawnPty,
    type TerminalInstance,
  } from "$lib/terminal/instances";
  import { arbitrateTerminalKey, isMac, type ArbiterContext } from "$lib/keybindings";
  import { runAppAction } from "$lib/keyactions";
  import { terminalKeyboard } from "$lib/state/terminalKeyboard.svelte";
  import { agentStatus } from "$lib/state/agentStatus.svelte";

  // This component is the VIEW of a terminal: it adopts the persistent xterm
  // instance for `id` (see `$lib/terminal/instances`), parents its element into
  // this pane, and drives everything visibility-shaped — fit/resize, the GPU
  // renderer's lifecycle, repaints, focus, theme. The xterm itself (buffer,
  // parser, PTY event wiring) lives on the instance and SURVIVES this component:
  // dragging a tab to another region remounts the component but only re-parents
  // the same DOM element, so nothing is replayed and no output is ever missed.
  // The instance is disposed here only when its tab no longer exists.

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
    runCommandExecute = true,
    env,
    onexit,
  }: {
    id: string;
    focused: boolean;
    cwd?: string;
    shell?: string;
    args?: string[];
    runCommand?: string;
    /** Whether `runCommand` is auto-run (Enter appended) or only pre-typed. */
    runCommandExecute?: boolean;
    env?: [string, string][];
    onexit?: () => void;
  } = $props();

  let el: HTMLDivElement;
  let inst: TerminalInstance | undefined;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  // Identifies THIS mount as the instance's adopter. During a drag remount
  // Svelte may run the new mount before the old unmount, so every teardown
  // effect is gated on still being the current adopter.
  const mountToken = Symbol("terminal-mount");
  let destroyed = false;
  let resizeObserver: ResizeObserver | undefined;
  // Pending animation frames: the settled-grid fit loop, and the post-fit repaint.
  let stableFitRaf: number | null = null;
  let repaintRaf: number | null = null;
  // Tracks display:none → shown transitions so a revealed pane repaints even when
  // its grid size is unchanged (a hidden canvas can keep its pre-hide pixels).
  let wasVisible = false;
  // Debounced release of a hidden pane's GPU context (see `releaseRenderer`): a
  // hidden terminal drops its scarce WebGL context so many background terminals
  // never exhaust WebView2's live-context budget. Debounced so a rapid tab flick
  // doesn't thrash attach/release.
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

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

  // Defeat xterm's render-pause gate. xterm's RenderService uses an
  // IntersectionObserver to pause rendering when it thinks the terminal isn't
  // visible (a CPU saving for hidden tabs). In WebView2 that observer can latch a
  // *freshly created or just-revealed* pane as "not intersecting" and then never
  // fire the resume callback, so every write is swallowed (`refreshRows` only sets
  // `_needsFullRefresh` while paused) and the pane shows just its blinking cursor —
  // the intermittent blank-terminal bug, independent of the WebGL/DOM renderer.
  //
  // When we KNOW the pane is visible (real geometry) but the service is still
  // paused, clear the flag ourselves, flush any resize it deferred, and drive a full
  // refresh. Genuinely hidden panes (no geometry) are left paused, so the CPU saving
  // is preserved. Reaching into `_core._renderService` is guarded: if a future xterm
  // renames it, the optional chaining makes this a no-op instead of throwing. This is
  // the same workaround VS Code and other xterm embedders use for this exact gate.
  // (Verified against the installed xterm 6.0.0: `RenderService._isPaused` and
  // `_pausedResizeTask` are still the fields driving the gate.)
  // Returns true when it actually un-paused (so callers can repaint).
  function forceRenderResume(): boolean {
    if (!term) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rs = (term as any)?._core?._renderService;
    if (!rs || !rs._isPaused) return false; // not paused → fast path, nothing to do
    if (!hasVisibleGeometry()) return false; // genuinely hidden → keep it paused
    rs._isPaused = false;
    try {
      rs._pausedResizeTask?.flush?.();
    } catch {
      // No deferred resize / internal shape changed — the refresh below still paints.
    }
    try {
      term.refresh(0, Math.max(0, term.rows - 1));
    } catch {
      // Terminal disposed mid-call; ignore.
    }
    return true;
  }

  // One clean full-viewport redraw on the next frame, used after an ordinary grid
  // resize. It does NOT touch the glyph texture atlas: the atlas is shared across
  // same-config terminals and clearing it desyncs every other pane's render model
  // (xterm #4480) — it is managed exclusively by xterm. The plain `refresh` also
  // drives the DOM fallback.
  function forceRepaint() {
    if (repaintRaf !== null) cancelAnimationFrame(repaintRaf);
    repaintRaf = requestAnimationFrame(() => {
      repaintRaf = null;
      if (!term) return;
      try {
        term.refresh(0, Math.max(0, term.rows - 1));
      } catch {
        // Terminal may have been disposed; ignore.
      }
    });
  }

  // Repaint on a genuine hidden→visible reveal. A hidden canvas can keep its
  // pre-hide pixels, so the whole viewport is redrawn through them.
  //
  // The texture atlas is NEVER cleared here (or anywhere else). xterm shares ONE
  // glyph atlas per font config across every terminal with that config — still
  // true in xterm 6 (`CharAtlasCache`) — and `clearTextureAtlas()` wipes those
  // shared pages while resyncing only the CALLING terminal's render model
  // (`WebglRenderer.clearTextureAtlas` clears `_model` + redraws just its own
  // viewport; `TextureAtlas.clearTexture` never sets `_requestClearModel`, unlike
  // the page-merge path). Every OTHER live terminal keeps per-cell references into
  // the recycled pages and permanently draws the WRONG glyphs in any row it doesn't
  // repaint — a full-screen agent's scrolled-off transcript, exactly the reported
  // corruption ("memoria" → "mamoria"). A reveal needs no atlas clear anyway: glyph
  // bitmaps don't go stale while a pane is hidden, and a reveal either attaches a
  // fresh renderer (fresh model) or full-refreshes the existing one below.
  function revealRepaint() {
    if (repaintRaf !== null) cancelAnimationFrame(repaintRaf);
    repaintRaf = requestAnimationFrame(() => {
      repaintRaf = null;
      if (!term) return;
      try {
        term.refresh(0, Math.max(0, term.rows - 1));
      } catch {
        // Terminal may have been disposed; ignore.
      }
      // Recompute the scrollbar/scroll-area after the reveal (below).
      syncViewport();
    });
  }

  // Force xterm to recompute its viewport scroll area + scrollbar. While a pane is
  // hidden (a background tab/workspace reports a 0×0 box) any output that streams
  // in grows the buffer, but xterm's viewport is left with a stale scroll area — so
  // on reveal the scrollbar tops out before the true end of the buffer and the user
  // can't scroll to the real top/bottom until the next keypress nudges it (a keypress
  // triggers this same sync via xterm's scroll handler). xterm 6's viewport has NO
  // ResizeObserver, so a revealed pane never re-syncs on its own — we drive it here
  // so scrolling reaches the true extent immediately, without moving the user's
  // position. Mirrors xterm's own recompute: re-measure the now-visible cell size,
  // then sync the scroll area via `viewport.syncScrollArea()` — verified against
  // the installed xterm 6.0.0: the Viewport lives at `core.viewport`
  // (browser/Terminal.ts) and `syncScrollArea` is its sync method, the same one
  // xterm calls on dimension changes; a previously-used `_viewport.queueSync`
  // never existed in 6.0 and silently no-opped. Internal fields, guarded with
  // optional chaining: a future xterm rename becomes a no-op instead of throwing
  // (same posture as `forceRenderResume`), and a keypress still re-syncs as a
  // last resort.
  function syncViewport() {
    // Only while genuinely visible: measuring/syncing against a 0×0 hidden pane
    // would re-cache the stale (zero) scroll area we're trying to fix. A later
    // reveal re-runs this.
    if (!term || !hasVisibleGeometry()) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const core = (term as any)._core;
      // Re-measure the (now visible) cell size so the scroll-area math below uses
      // real dimensions rather than the zero a hidden pane may have cached.
      core?._charSizeService?.measure?.();
      // Recompute the scroll area + scrollbar against the current buffer length.
      core?.viewport?.syncScrollArea?.();
    } catch {
      // xterm internals renamed / terminal disposed — no-op (a keypress re-syncs).
    }
  }

  // Attach the WebGL renderer — but ONLY while this pane is actually visible. Each
  // xterm WebGL renderer holds its own GPU context, and WebView2/Chromium caps the
  // number of live WebGL contexts (~16); since every terminal stays mounted across
  // all workspaces, attaching WebGL to hidden panes too piles contexts up until the
  // browser starts evicting them — new terminals then get an immediately-lost
  // context (a blank pane) and the loss/recover cycle thrashes the compositor. So
  // WebGL is bound to the visible pane and released on hide (`releaseRenderer`).
  // The addon handle lives on the INSTANCE (it survives a drag remount along with
  // its canvas — a GPU context is not lost by re-parenting the DOM).
  //
  // On context loss we recover from a genuine one-off (WebView2 dropping the context
  // while a divider is dragged) by reattaching next frame, but NOT from a rapid
  // re-loss — that means we're over the context budget, so we stay on the DOM
  // fallback and let the next reveal reattach once contexts have been freed.
  function attachRenderer() {
    if (!inst || !term || inst.renderer || !hasVisibleGeometry()) return;
    const owner = inst;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        const now = Date.now();
        const rapid = now - owner.webglLossAt < 2000;
        owner.webglLossAt = now;
        disposeRenderer(webgl);
        if (!rapid) {
          requestAnimationFrame(() => {
            if (term && inst && !inst.renderer) attachRenderer();
            forceRepaint();
          });
        }
      });
      term.loadAddon(webgl);
      owner.renderer = webgl;
    } catch {
      // WebGL unavailable — xterm falls back to the DOM renderer.
      owner.renderer = undefined;
    }
  }

  // Dispose the accelerated addon defensively. xterm's WebGL disposer reaches into
  // the terminal core (to swap back to the DOM renderer), which throws if the core
  // is mid-teardown (unmount / HMR races); an uncaught throw there would leave xterm
  // with no renderer at all — a blank pane. Swallow it and clear the handle.
  function disposeRenderer(target: WebglAddon | undefined = inst?.renderer) {
    if (inst && inst.renderer === target) inst.renderer = undefined;
    try {
      target?.dispose();
    } catch {
      // Already disposed or core torn down — nothing else to clean up.
    }
  }

  // Release a hidden (or closing) pane's GPU context. `dispose()` alone reverts
  // xterm to the DOM renderer but on Windows/ANGLE does NOT reclaim the WebGL
  // context promptly — it waits for GC, so mounted-but-hidden terminals keep
  // counting against WebView2's live-context budget until new terminals can't get a
  // context (a blank pane). So after disposing we explicitly lose the context and
  // zero the canvas, freeing the slot now. xterm keeps streaming into the buffer via
  // the DOM fallback while hidden, so no output is lost; the next reveal reattaches.
  function releaseRenderer() {
    if (!inst?.renderer) return;
    // Capture the WebGL canvas BEFORE dispose detaches it. Queried on the
    // instance's wrapper (not `el`): the wrapper is where xterm's DOM lives, and
    // it may already be re-parented away from this mount's `el`.
    const canvases = Array.from(inst.wrapper.querySelectorAll("canvas"));
    disposeRenderer(inst.renderer);
    if (releaseTimer) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
    }
    for (const canvas of canvases) {
      let gl: WebGL2RenderingContext | null = null;
      try {
        gl = canvas.getContext("webgl2");
      } catch {
        gl = null;
      }
      if (!gl) continue; // a non-WebGL (DOM/2D) canvas — nothing to release
      try {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        // Context already lost — the slot is freed regardless.
      }
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  // Fit the xterm grid to the pane, resize the PTY only on a real grid change,
  // and repaint whenever the canvas dimensions actually changed.
  function applyFit() {
    if (!inst || !term || !fit || !hasVisibleGeometry()) return;
    const beforeCols = term.cols;
    const beforeRows = term.rows;
    const distanceFromBottom = term.buffer.active.baseY - term.buffer.active.viewportY;
    try {
      fit.fit();
    } catch {
      // Container not measurable yet; a later resize will retry.
      return;
    }
    if (term.cols !== inst.lastCols || term.rows !== inst.lastRows) {
      inst.lastCols = term.cols;
      inst.lastRows = term.rows;
      invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(
        () => {},
      );
    }
    if (term.cols !== beforeCols || term.rows !== beforeRows) forceRepaint();
    if (distanceFromBottom > 0) {
      term.scrollToLine(Math.max(0, term.buffer.active.baseY - distanceFromBottom));
    }
    // A settled fit means the pane is laid out and visible — a good moment to clear
    // any lingering paused-render latch that would otherwise leave it blank.
    forceRenderResume();
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

  // Undo a mount that lost the setup race: the component was destroyed while an
  // await in `onMount` was pending. Release ownership if we still hold it, and
  // dispose the instance when its tab is gone from every workspace.
  function abortMount() {
    if (inst && inst.adopter === mountToken) {
      releaseRenderer();
      releaseInstance(id, mountToken);
    }
    if (terminals.workspaceOfTab(id) === undefined) disposeInstance(id);
  }

  onMount(async () => {
    const t = app.resolveTerminal();
    const { inst: acquired, created } = await acquireInstance(id, el, () => ({
      options: {
        cursorBlink: t.cursorBlink,
        cursorStyle: t.cursorStyle,
        fontSize: t.fontSize,
        lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fontWeight: t.fontWeight as never,
        fontFamily: t.fontFamily,
        theme: { ...t.theme },
      },
      ligatures: t.ligatures,
      webLinks: app.settings.browser?.terminalLinks ?? true,
      spec: { cwd, shell, args, runCommand, runCommandExecute, env },
    }));
    if (destroyed) {
      // The pane died while the instance was being built (rapid open/close or a
      // drag racing creation). Nothing was spawned yet; drop what we made if the
      // tab is gone. (If another mount adopted meanwhile, this is a no-op.)
      abortMount();
      return;
    }
    inst = acquired;
    term = inst.term;
    fit = inst.fit;
    adoptInstance(inst, el, mountToken, {
      // The write callback runs once bytes are parsed into the buffer: if xterm's
      // render service latched this (visible) pane as paused, un-pause it so the
      // output actually paints instead of leaving a blank pane with a cursor.
      onOutput: () => forceRenderResume(),
      onExit: () => onexit?.(),
    });
    // An adopted instance may carry appearance from before this mount; re-apply
    // the current resolved options so a theme change never waits for the next
    // settings edit. (Fresh instances were just built from the same values.)
    if (!created) applyAppearance();

    const kbd = inst.kbd;
    const ptyWrite = (data: string) => invoke("pty_write", { id, data }).catch(() => {});

    // Leader (tmux-style one-shot override): after the leader chord, the next key
    // is routed to uxnan whatever its per-action terminal policy. Cleared after
    // one key or a short timeout.
    let leaderPending = false;
    let leaderTimer: ReturnType<typeof setTimeout> | undefined;
    // Interrupt inference (fallback for a missed Stop hook): watch — WITHOUT
    // consuming — for Ctrl+C (SIGINT, no selection) or a double-Escape, then after
    // a settle synthesize `done + interrupted`, but only if the agent is still
    // `working` and no genuine hook arrived meanwhile (so a real hook always wins).
    let lastEscAt = 0;
    let interruptTimer: ReturnType<typeof setTimeout> | undefined;
    const armInterrupt = () => {
      const armed = agentStatus.get(id);
      if (!armed || armed.status !== "working") return;
      const at = armed.lastUpdate;
      if (interruptTimer) clearTimeout(interruptTimer);
      interruptTimer = setTimeout(() => {
        const now = agentStatus.get(id);
        if (now && now.status === "working" && now.lastUpdate === at) {
          agentStatus.synthesizeInterruptedDone(id);
        }
      }, 1500);
    };
    const noteInterruptIntent = (e: KeyboardEvent) => {
      // Ctrl+C is SIGINT only when there's no selection (else it copies below).
      if (
        e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key.toLowerCase() === "c" &&
        !term?.hasSelection()
      ) {
        armInterrupt();
        return;
      }
      if (e.key === "Escape") {
        const now = Date.now();
        if (now - lastEscAt < 500) armInterrupt();
        lastEscAt = now;
      }
    };

    // Custom key handling (everything else — Ctrl+←/→ word nav, Home/End, … —
    // falls through to xterm's defaults and on to the PTY). Re-attached on every
    // mount (xterm keeps exactly one custom handler — attaching replaces the
    // previous mount's):
    //  - The arbiter (`keybindings.ts`) decides app-shortcut vs TUI/agent per the
    //    user's per-action policy, with a leader one-shot override and a
    //    per-terminal focus (passthrough) mode; a resolved app action runs through
    //    the shared dispatcher (same code as the global +page handler).
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

      // Interrupt inference watches (never consumes) for Ctrl+C / double-Esc.
      noteInterruptIntent(e);

      // Arbitrate app-shortcut vs TUI/agent per the user's per-action policy, with
      // the leader one-shot override and per-terminal focus (passthrough) mode. A
      // resolved app action runs through the shared dispatcher (same code as the
      // global +page handler); everything else falls through to the PTY below.
      const ctx: ArbiterContext = {
        passthrough: terminalKeyboard.passthrough(id),
        leaderPending,
      };
      const disp = arbitrateTerminalKey(e, ctx);
      // A pending leader is consumed by exactly one following key.
      if (leaderPending && disp.kind !== "leader") {
        leaderPending = false;
        if (leaderTimer) clearTimeout(leaderTimer);
      }
      if (disp.kind === "passthrough") {
        terminalKeyboard.toggle(id);
        e.preventDefault();
        return false;
      }
      if (disp.kind === "leader") {
        leaderPending = true;
        if (leaderTimer) clearTimeout(leaderTimer);
        leaderTimer = setTimeout(() => {
          leaderPending = false;
        }, 2000);
        e.preventDefault();
        return false;
      }
      if (disp.kind === "app" && runAppAction(disp.action, { terminalId: id })) {
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

    // Let the layout settle so the first fit measures real dimensions.
    await tick();
    if (destroyed) {
      abortMount();
      return;
    }
    fitToPane();
    // Now that the pane is laid out, bind the GPU renderer if it's the visible one.
    // A pane that mounts hidden (a background workspace/tab) stays on the DOM
    // fallback until it's revealed — the ResizeObserver below attaches WebGL then —
    // so it never holds a GPU context while off-screen.
    wasVisible = hasVisibleGeometry();
    if (wasVisible) {
      attachRenderer();
      forceRepaint();
      // xterm's IntersectionObserver may still latch this just-created pane as
      // hidden (an async first callback that races layout); make sure it renders.
      forceRenderResume();
    }

    // First-time setup only: spawn the PTY. Remounts adopt the live instance —
    // its PTY, buffer and scrollback are simply still there; nothing to restore.
    if (created) {
      const res = await spawnPty(inst, term.cols || 80, term.rows || 24);
      if (destroyed) {
        // The tab closed while the spawn was in flight; its close path ran
        // `pty_close` before the PTY existed, so close it here.
        if (terminals.workspaceOfTab(id) === undefined) {
          void invoke("pty_close", { id }).catch(() => {});
        }
        abortMount();
        return;
      }
      if (res.error !== undefined) {
        // Surface a real spawn failure (missing shell / bad profile) in the pane
        // instead of a silent black screen; the agent command is never typed
        // into a dead PTY (`spawnFailed` gates the launch).
        term.writeln(`\r\n\x1b[31m${i18n.t("terminal.spawnFailed")}\x1b[0m`);
        term.writeln(`\x1b[90m${res.error}\x1b[0m`);
      }
    }

    // Coalesce a burst of layout changes (divider drag, window resize) into a
    // single settled-grid fit, so the PTY isn't spammed with SIGWINCH and the
    // scrollbar doesn't wobble mid-resize. The same observer drives the GPU
    // renderer's lifecycle: a display:none pane reports a 0×0 box, so switching
    // workspace/tab is what tells a pane it went hidden or was revealed.
    resizeObserver = new ResizeObserver(() => {
      const visible = hasVisibleGeometry();
      if (visible) {
        // Cancel a pending release: the pane came back before we freed its context.
        if (releaseTimer) {
          clearTimeout(releaseTimer);
          releaseTimer = undefined;
        }
        if (!wasVisible) {
          // Revealed — reattach a GPU context (fresh render model) and repaint
          // through any stale pixels the hidden canvas kept.
          attachRenderer();
          revealRepaint();
        } else if (!inst?.renderer) {
          // Still visible but the renderer was dropped by a recovered context loss —
          // bring WebGL back now that we can.
          attachRenderer();
          forceRepaint();
        }
        // A visible pane must never stay stuck on xterm's paused render gate.
        forceRenderResume();
      } else if (wasVisible) {
        // Hidden — free the GPU context shortly (debounced so rapid tab flicking
        // doesn't thrash attach/release). xterm keeps streaming into its buffer via
        // the DOM fallback while hidden, so nothing is lost; the reveal above
        // reattaches WebGL and repaints.
        if (releaseTimer) clearTimeout(releaseTimer);
        releaseTimer = setTimeout(() => {
          releaseTimer = undefined;
          releaseRenderer();
        }, 400);
      }
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

  /** Apply the current resolved appearance to the live terminal. */
  function applyAppearance() {
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
  }

  // Re-apply appearance live when the theme or terminal overrides change. Font
  // and color changes apply in place; toggling ligatures is only wired at instance
  // creation (the ligatures addon isn't hot-swapped), so that takes effect on the
  // next terminal.
  $effect(() => {
    void termOpts;
    if (!term) return;
    applyAppearance();
    fitToPane();
  });

  onDestroy(() => {
    destroyed = true;
    resizeObserver?.disconnect();
    if (stableFitRaf !== null) cancelAnimationFrame(stableFitRaf);
    if (repaintRaf !== null) cancelAnimationFrame(repaintRaf);
    if (releaseTimer) clearTimeout(releaseTimer);
    // Only the CURRENT adopter tears down shared per-terminal state: during a
    // drag remount the new mount may already have adopted (and re-registered the
    // controller / re-parented the element) before this unmount runs.
    if (inst && inst.adopter === mountToken) {
      terminals.unregisterController(id);
      terminalKeyboard.clear(id);
      // Free the GPU context explicitly now (not at GC time) so opening/closing
      // and moving terminals never drifts toward WebView2's live-context budget.
      releaseRenderer();
      releaseInstance(id, mountToken);
      if (terminals.workspaceOfTab(id) === undefined) {
        // The tab is gone from every workspace — a real close, not a re-parent.
        disposeInstance(id);
      }
    }
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
  class="relative"
  style:width="calc(100% - 4px)"
  style:height="calc(100% - 4px)"
  style:margin-top="4px"
  style:margin-left="4px"
>
  <div
    bind:this={el}
    style:width="100%"
    style:height="100%"
    style:background-color={termOpts.theme.background}
  ></div>
  {#if terminalKeyboard.passthrough(id)}
    <!-- Focus mode: every key goes to the TUI/agent. Click to turn it back off. -->
    <button
      type="button"
      class="absolute right-2 top-1.5 z-10 flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-[3px] text-[10px] font-medium text-white shadow-sm transition-colors hover:bg-amber-500"
      title={i18n.t("terminal.focusModeOn")}
      onclick={() => terminalKeyboard.toggle(id)}
    >
      {i18n.t("terminal.focusMode")}
    </button>
  {/if}
</div>
