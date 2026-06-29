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
  import { clipboardRead, clipboardWrite } from "$lib/clipboard";
  import { terminals } from "$lib/state/terminals.svelte";
  import { agentMonitor } from "$lib/state/agentMonitor.svelte";
  import { app } from "$lib/state/app.svelte";
  import { KeyboardProtocol } from "$lib/terminal/keyboardProtocol";
  import { matchAction } from "$lib/keybindings";

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
  // Kitty/CSI-u keyboard protocol state for this terminal. Dormant until an app
  // running in the PTY negotiates it; see `keyboardProtocol.ts`.
  const kbd = new KeyboardProtocol();
  let unlisteners: UnlistenFn[] = [];
  let resizeObserver: ResizeObserver | undefined;
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
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

  // Re-fit (and resize the PTY) only when the pane is actually visible.
  function fitToPane() {
    if (!term || !fit || el.offsetParent === null) return;
    try {
      fit.fit();
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(
          () => {},
        );
      }
    } catch {
      // Container not measurable yet; a later resize will retry.
    }
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
    // Ligatures need the DOM renderer, so they're mutually exclusive with WebGL.
    if (t.ligatures) {
      try {
        term.loadAddon(new LigaturesAddon());
      } catch {
        // Ligatures addon unavailable — plain DOM rendering still works.
      }
    } else {
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL unavailable — xterm falls back to the DOM renderer.
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
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
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

    // Debounce refits: coalesce a burst of layout changes (divider drag, window
    // resize) into one resize so the PTY isn't spammed with SIGWINCH.
    resizeObserver = new ResizeObserver(() => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(fitToPane, 100);
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
    clearTimeout(fitTimer);
    term?.dispose();
  });
</script>

<!-- p-2 gives the terminal content breathing room; the FitAddon subtracts this
     padding so cols/rows still fit. The background matches the xterm theme so
     the padding blends seamlessly. -->
<div
  bind:this={el}
  class="h-full w-full p-2"
  style:background-color={termOpts.theme.background}
></div>
