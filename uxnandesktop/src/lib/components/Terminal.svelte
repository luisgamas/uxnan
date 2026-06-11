<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";

  let {
    id,
    active,
    cwd,
    onexit,
  }: { id: string; active: boolean; cwd?: string; onexit?: () => void } =
    $props();

  let el: HTMLDivElement;
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let unlisteners: UnlistenFn[] = [];
  let resizeObserver: ResizeObserver | undefined;

  // Re-fit (and resize the PTY) only when the pane is actually visible.
  function fitToPane() {
    if (!term || !fit || el.offsetParent === null) return;
    try {
      fit.fit();
      invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(
        () => {},
      );
    } catch {
      // Container not measurable yet; a later resize will retry.
    }
  }

  onMount(async () => {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
      theme: {
        background: "#0b0b0c",
        foreground: "#e6e6e6",
        cursor: "#e6e6e6",
      },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — xterm falls back to the DOM renderer.
    }

    // Subscribe BEFORE spawning so no early output is missed.
    unlisteners.push(
      await listen<number[]>(`pty:output:${id}`, (e) => {
        term?.write(new Uint8Array(e.payload));
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
      cols: term.cols || 80,
      rows: term.rows || 24,
    }).catch(() => {});

    term.onData((data) => {
      invoke("pty_write", { id, data }).catch(() => {});
    });

    resizeObserver = new ResizeObserver(() => fitToPane());
    resizeObserver.observe(el);
    term.focus();
  });

  // When this tab becomes active (was hidden, now shown), re-fit and focus.
  $effect(() => {
    if (active && term) {
      queueMicrotask(() => {
        fitToPane();
        term?.focus();
      });
    }
  });

  onDestroy(() => {
    unlisteners.forEach((fn) => fn());
    resizeObserver?.disconnect();
    term?.dispose();
  });
</script>

<div bind:this={el} class="h-full w-full"></div>
