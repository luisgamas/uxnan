<script lang="ts">
  // Integrated developer-browser panel (the right-side "4th panel").
  //
  // This component renders the browser **chrome** (toolbar + address bar) in the
  // main window's DOM, plus an empty content slot. The page itself lives in a
  // separate, frameless `WebviewWindow` (managed by the Rust `browser_window_*`
  // commands) — a real system webview, so it loads any site (Google included) and
  // has real DevTools. We glue that window over this slot: every frame we measure
  // the slot's rect and, when it changes, push it to the backend, which converts it
  // to screen coords and repositions the owned window. We hide the window whenever
  // the slot isn't visible (panel closed, or the Settings overlay is on top), since
  // an owned window always paints above the main one.
  //
  // In the web preview (no Tauri) the window commands throw and we show a hint.

  import { onDestroy, onMount, untrack } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    browserWindowBack,
    browserWindowClose,
    browserWindowDevtools,
    browserWindowForward,
    browserWindowHide,
    browserWindowNavigate,
    browserWindowOpen,
    browserWindowReload,
    browserWindowSetBounds,
    browserWindowShow,
    openExternal,
  } from "$lib/api";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import RotateCwIcon from "@lucide/svelte/icons/rotate-cw";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import BugIcon from "@lucide/svelte/icons/bug";
  import XIcon from "@lucide/svelte/icons/x";

  let slot = $state<HTMLDivElement | null>(null);
  let address = $state(untrack(() => app.browserUrl));
  let unavailable = $state(false);

  // Plain (non-reactive) lifecycle bookkeeping for the imperative window calls.
  let created = false;
  let shown = false;
  let lastNavigated = untrack(() => app.browserUrl);
  let last = { x: -1, y: -1, w: -1, h: -1 };
  let raf = 0;

  type Bounds = { x: number; y: number; w: number; h: number };

  /** Slot geometry in CSS (logical) px relative to the main window content, or
   *  null when the slot shouldn't show the window (hidden / Settings overlay). */
  function measure(): Bounds | null {
    if (!slot || app.settingsOpen) return null;
    if (document.visibilityState === "hidden") return null;
    const r = slot.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return null;
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  }

  async function ensureOpen(b: Bounds): Promise<void> {
    if (created) return;
    created = true;
    try {
      await browserWindowOpen(lastNavigated, b.x, b.y, b.w, b.h);
      shown = true;
      last = b;
    } catch {
      created = false;
      unavailable = true;
    }
  }

  async function hideWindow(): Promise<void> {
    if (created && shown) {
      shown = false;
      try {
        await browserWindowHide();
      } catch {
        // backend gone — ignore
      }
    }
  }

  function tick(): void {
    const b = measure();
    if (!b) {
      void hideWindow();
    } else if (!created) {
      void ensureOpen(b);
    } else {
      if (b.x !== last.x || b.y !== last.y || b.w !== last.w || b.h !== last.h) {
        last = b;
        void browserWindowSetBounds(b.x, b.y, b.w, b.h).catch(() => {});
      }
      if (!shown) {
        shown = true;
        void browserWindowShow().catch(() => {});
      }
    }
    raf = requestAnimationFrame(tick);
  }

  // Navigate when the target changes from outside (an agent/link reusing the panel).
  $effect(() => {
    const u = app.browserUrl;
    if (created && u && u !== lastNavigated) {
      lastNavigated = u;
      address = u;
      void browserWindowNavigate(u).catch(() => {});
    }
  });

  onMount(() => {
    raf = requestAnimationFrame(tick);
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const track = (p: Promise<UnlistenFn>) =>
      void p.then((u) => (disposed ? u() : unlisteners.push(u)));

    track(
      listen<{ url: string }>("browser:navigated", (e) => {
        lastNavigated = e.payload.url;
        address = e.payload.url;
      }),
    );

    // Re-dock when the main window moves or resizes. The docked window is placed
    // in absolute screen coords (main window origin + the slot's offset), but the
    // slot's window-relative rect doesn't change on a move — so nothing else would
    // re-push its bounds, stranding the browser at the old screen position while
    // the app moves away. Invalidating `last` makes the next rAF tick re-place it
    // from the new origin. (An owned child window doesn't follow its parent on
    // Windows.) Skipped in the web preview, where there's no Tauri window.
    try {
      const win = getCurrentWindow();
      const invalidate = () => (last = { x: -1, y: -1, w: -1, h: -1 });
      track(win.onMoved(invalidate));
      track(win.onResized(invalidate));
    } catch {
      // No Tauri runtime (browser preview) — nothing to track.
    }

    return () => {
      disposed = true;
      for (const u of unlisteners) u();
    };
  });

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    void browserWindowClose().catch(() => {});
  });

  /** Turn an address-bar entry into a navigable URL: keep explicit schemes and
   *  `about:`; use http for localhost/loopback (dev servers), else https. */
  function normalizeUrl(input: string): string {
    const s = input.trim();
    if (!s) return "about:blank";
    if (/^about:/i.test(s)) return s;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(s)) return `http://${s}`;
    return `https://${s}`;
  }

  function go(): void {
    const u = normalizeUrl(address);
    address = u;
    lastNavigated = u;
    if (created) void browserWindowNavigate(u).catch(() => {});
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  }
</script>

<div class="flex h-full w-full flex-col bg-background">
  <!-- Window-controls drag strip. When the browser is open it is the right-most
       panel, so the min/max/close overlay (fixed top-right, rendered in
       +page.svelte) lands over *this* panel. Mirror the right panel's top band
       (h-9 drag strip) so those controls float over an empty strip instead of
       covering the toolbar buttons below — which is what happened before. -->
  <div data-tauri-drag-region class="h-9 shrink-0 border-b border-border/60"></div>

  <!-- Toolbar / address bar (lives in the main window; the page window docks below) -->
  <div class="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1">
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.back")}
      aria-label={i18n.t("browser.back")}
      onclick={() => void browserWindowBack().catch(() => {})}
    >
      <ArrowLeftIcon class="size-4" />
    </button>
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.forward")}
      aria-label={i18n.t("browser.forward")}
      onclick={() => void browserWindowForward().catch(() => {})}
    >
      <ArrowRightIcon class="size-4" />
    </button>
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.reload")}
      aria-label={i18n.t("browser.reload")}
      onclick={() => void browserWindowReload().catch(() => {})}
    >
      <RotateCwIcon class="size-4" />
    </button>
    <input
      class="min-w-0 flex-1 rounded border border-input bg-card px-2 py-1 text-xs outline-none focus:border-ring"
      type="text"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      placeholder={i18n.t("browser.addressPlaceholder")}
      bind:value={address}
      onkeydown={onKey}
    />
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.openExternal")}
      aria-label={i18n.t("browser.openExternal")}
      onclick={() => void openExternal(address).catch(() => {})}
    >
      <ExternalLinkIcon class="size-4" />
    </button>
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.devtools")}
      aria-label={i18n.t("browser.devtools")}
      onclick={() => void browserWindowDevtools().catch(() => {})}
    >
      <BugIcon class="size-4" />
    </button>
    <button
      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={i18n.t("browser.close")}
      aria-label={i18n.t("browser.close")}
      onclick={() => app.closeBrowser()}
    >
      <XIcon class="size-4" />
    </button>
  </div>

  <!-- Content slot: the docked browser window is positioned over this element. -->
  <div bind:this={slot} class="relative min-h-0 flex-1 bg-muted/40">
    {#if unavailable}
      <div
        class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"
      >
        <p>{i18n.t("browser.unavailable")}</p>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent hover:text-foreground"
          onclick={() => void openExternal(address).catch(() => {})}
        >
          {i18n.t("browser.openExternal")}
        </button>
      </div>
    {/if}
  </div>
</div>
