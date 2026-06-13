<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import { clipboardRead, clipboardWrite } from "$lib/clipboard";
  import { terminals } from "$lib/state/terminals.svelte";
  import { agentMonitor } from "$lib/state/agentMonitor.svelte";
  import { app } from "$lib/state/app.svelte";

  // xterm colors follow the app theme (light/dark).
  const palette = $derived(app.terminalPalette());

  let {
    id,
    focused,
    cwd,
    shell,
    args,
    runCommand,
    onexit,
  }: {
    id: string;
    focused: boolean;
    cwd?: string;
    shell?: string;
    args?: string[];
    runCommand?: string;
    onexit?: () => void;
  } = $props();

  // Give an interactive shell a moment to load its profile and draw a prompt
  // before we type the agent command into it (otherwise it can land mid-init).
  const RUN_COMMAND_DELAY_MS = 400;

  let el: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
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
    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      // Bounded scrollback caps per-terminal memory (hidden terminals stay
      // mounted, so this is the effective limit on their retained output).
      scrollback: 5000,
      fontFamily:
        'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
      theme: { ...palette },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — xterm falls back to the DOM renderer.
    }

    // Custom key handling (everything else — Ctrl+←/→ word nav, Home/End, … —
    // falls through to xterm's defaults and on to the PTY):
    //  - Shift+Enter / Alt+Enter insert a newline (xterm otherwise collapses
    //    them to a plain Enter, so agents can't get a multi-line prompt).
    //  - Ctrl+C copies when there's a selection, else passes through as SIGINT.
    //  - Ctrl+V pastes once (preventDefault stops a duplicate native paste).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      // Close this terminal: Cmd+W (mac) or Ctrl+Shift+W. Plain Ctrl+W is left
      // for the shell's delete-word-backward.
      if (e.key.toLowerCase() === "w" && (e.metaKey || (e.ctrlKey && e.shiftKey))) {
        void terminals.closeTabAnywhere(id);
        e.preventDefault();
        return false;
      }
      if (e.key === "Enter" && (e.shiftKey || e.altKey) && !e.ctrlKey) {
        invoke("pty_write", { id, data: "\n" }).catch(() => {});
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
      return true;
    });

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

    await invoke("pty_create", {
      id,
      cwd,
      shell,
      args,
      cols: term.cols || 80,
      rows: term.rows || 24,
    }).catch(() => {});

    // Agent launch: type the command into the freshly-started shell. Running it
    // inside the shell (rather than as the PTY process) lets PATH/PATHEXT shims
    // resolve (`codex.cmd`/`.ps1`), which spawning the bare command cannot.
    if (runCommand) {
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

  // Re-theme the live terminal when the app theme changes.
  $effect(() => {
    if (term) term.options.theme = { ...palette };
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
  style:background-color={palette.background}
></div>
