<script lang="ts">
  // Integrated developer-browser panel (the right-side "4th panel") of the
  // workspace on screen.
  //
  // This component draws the browser **chrome** (toolbar + address bar) and an
  // empty slot. The page itself is a native child webview of the main window,
  // owned by the backend (`src-tauri/src/browser/host.rs`) and one per
  // workspace; `state/browser.svelte.ts` decides which page is on screen. The
  // panel's one job towards the page is to report its slot: where the page
  // goes, and whether it can be drawn right now.
  //
  // A native view always paints above the app's DOM — no `z-index` can put
  // anything in front of it — so the page must step aside whenever something
  // in the app has to be on top: Settings or Automations over the panels, the
  // window hidden, or a floating layer (dialog, menu, popover, select)
  // overlapping the slot. Floating layers come from `$lib/overlayLayer`, which
  // the shared `ui/` primitives register with, so every dialog in the app —
  // present and future — opens in front of the page instead of behind it.
  //
  // The slot is measured on change, not every frame: a `ResizeObserver`, the
  // window's resize, visibility and overlay changes. Only while a floating
  // layer is up (menus position and animate themselves) does it follow frames.

  import { onMount, untrack } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import {
    browserBack,
    browserDevtools,
    browserForward,
    browserNavigate,
    browserRefresh,
    browserReload,
    browserStop,
    browserZoom,
    openExternal,
  } from "$lib/api";
  import { app } from "$lib/state/app.svelte";
  import { browser } from "$lib/state/browser.svelte";
  import { normalizeAddress, displayAddress, isSecureAddress, stepZoom } from "$lib/browserAddress";
  import { overlayCovers, onOverlayChange, overlayLayerCount } from "$lib/overlayLayer";
  import { toast } from "$lib/toast";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { cn } from "$lib/utils";
  import { focus, icon } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
  import ArrowRightIcon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import RotateCwIcon from "@hugeicons/core-free-icons/RotateClockwiseIcon";
  import StopIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import LockIcon from "@hugeicons/core-free-icons/SquareLock02Icon";
  import GlobeIcon from "@hugeicons/core-free-icons/Globe02Icon";
  import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon";
  import CodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";

  /** How often the page is asked for what the engine does not push (an in-page
   *  URL change, history), while it is on screen. */
  const REFRESH_MS = 1500;

  let slot = $state<HTMLDivElement | null>(null);
  let addressEl = $state<HTMLInputElement | null>(null);
  let address = $state("");
  /** The person is editing the address: page navigations must not overwrite it. */
  let editing = $state(false);
  let unavailable = $state(false);

  const session = $derived(browser.active);
  const workspace = $derived(browser.activeKey);
  const loading = $derived(session?.loading ?? false);
  const secure = $derived(isSecureAddress(session?.url ?? ""));
  const zoom = $derived(session?.zoom ?? 1);

  // Keep the address bar on the page's URL unless the person is typing.
  $effect(() => {
    const url = session?.url ?? "";
    if (!untrack(() => editing)) address = displayAddress(url);
  });

  let raf = 0;
  let lastKey = "";

  /** Measure the slot and report it to the store. */
  function report(): void {
    raf = 0;
    if (!slot) {
      browser.setSlot(null, false);
      return;
    }
    const r = slot.getBoundingClientRect();
    const bounds = {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
    const showable =
      !app.settingsOpen &&
      !app.automationsOpen &&
      document.visibilityState !== "hidden" &&
      bounds.width > 1 &&
      bounds.height > 1 &&
      // A dialog/menu/popover over the slot has to win: only layers that
      // actually OVERLAP it count — a menu in the left sidebar has no business
      // blanking the page on the far right.
      !overlayCovers(r);
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height},${showable}`;
    if (key !== lastKey) {
      lastKey = key;
      browser.setSlot(bounds, showable);
    }
    // Floating layers move and animate while mounted: follow them frame by
    // frame, and only while one is up.
    if (overlayLayerCount() > 0) schedule();
  }

  function schedule(): void {
    if (!raf) raf = requestAnimationFrame(report);
  }

  // Full-screen views over the panels, and the workspace on screen changing.
  $effect(() => {
    void app.settingsOpen;
    void app.automationsOpen;
    void workspace;
    lastKey = "";
    schedule();
  });

  onMount(() => {
    const ro = new ResizeObserver(schedule);
    if (slot) ro.observe(slot);
    const offOverlay = onOverlayChange(schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    void listen<{ workspace: string; path: string | null; success: boolean }>(
      "browser:downloaded",
      (e) => {
        if (e.payload.success && e.payload.path) {
          toast.success(i18n.t("browser.downloaded", { path: e.payload.path }));
        } else {
          toast.error(i18n.t("browser.downloadFailed"));
        }
      },
    )
      .then((u) => (disposed ? u() : unlisteners.push(u)))
      .catch(() => {});

    const refresh = setInterval(() => {
      const s = browser.active;
      if (s?.live && !editing && document.visibilityState !== "hidden") {
        void browserRefresh(s.workspace).catch(() => {});
      }
    }, REFRESH_MS);

    return () => {
      disposed = true;
      for (const u of unlisteners) u();
      clearInterval(refresh);
      ro.disconnect();
      offOverlay();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (raf) cancelAnimationFrame(raf);
      // The panel is gone: nothing may be drawn over its old slot.
      browser.setSlot(null, false);
    };
  });

  // Open the page when the panel appears for a session that has none yet
  // (the globe toggle, a restored workspace).
  $effect(() => {
    const s = session;
    if (s?.open && !s.live && s.url) {
      untrack(() => {
        void browser.open(s.url, s.workspace).catch(() => (unavailable = true));
      });
    }
  });

  function go(): void {
    const target = normalizeAddress(address);
    editing = false;
    addressEl?.blur();
    if (!target) return;
    address = displayAddress(target);
    const s = browser.active;
    if (s?.live) {
      s.url = target;
      void browserNavigate(s.workspace, target).catch((e) => toast.error(String(e?.message ?? e)));
    } else {
      void browser.open(target).catch(() => (unavailable = true));
    }
  }

  function cancelEdit(): void {
    editing = false;
    address = displayAddress(session?.url ?? "");
    addressEl?.blur();
  }

  function reloadOrStop(hard = false): void {
    if (!session?.live) return;
    if (loading && !hard) void browserStop(workspace).catch(() => {});
    else void browserReload(workspace, hard).catch(() => {});
  }

  function setZoom(next: number): void {
    if (!session?.live) return;
    void browserZoom(workspace, next).then((s) => browser.apply(s)).catch(() => {});
  }

  function onAddressKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  /** Shortcuts while the keyboard is in the panel's chrome (the page itself
   *  keeps its own keys once it has focus). */
  function onPanelKey(e: KeyboardEvent): void {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "l") {
      e.preventDefault();
      addressEl?.focus();
      addressEl?.select();
    } else if (key === "r") {
      e.preventDefault();
      reloadOrStop(e.shiftKey);
    } else if (key === "[" || (key === "arrowleft" && !e.shiftKey)) {
      e.preventDefault();
      void browserBack(workspace).catch(() => {});
    } else if (key === "]" || (key === "arrowright" && !e.shiftKey)) {
      e.preventDefault();
      void browserForward(workspace).catch(() => {});
    } else if (key === "=" || key === "+") {
      e.preventDefault();
      setZoom(stepZoom(zoom, 1));
    } else if (key === "-") {
      e.preventDefault();
      setZoom(stepZoom(zoom, -1));
    } else if (key === "0") {
      e.preventDefault();
      setZoom(1);
    }
  }

  const toolButton = cn(
    focus.ring,
    "text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40",
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full w-full flex-col bg-background" onkeydown={onPanelKey}>
  <!-- Window-controls drag strip. When the browser is open it is the right-most
       panel, so the min/max/close overlay (fixed top-right, rendered in
       +page.svelte) lands over *this* panel. Mirror the right panel's top band
       (h-9 drag strip) so those controls float over an empty strip instead of
       covering the toolbar buttons below. -->
  <div data-tauri-drag-region class="h-9 shrink-0 border-b border-border/60"></div>

  <div class="flex shrink-0 items-center gap-0.5 border-b border-border/60 px-1.5 py-1">
    <TooltipSimple title={i18n.t("browser.back")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={toolButton}
          aria-label={i18n.t("browser.back")}
          disabled={!session?.live || session.canGoBack === false}
          onclick={() => void browserBack(workspace).catch(() => {})}
        >
          <Icon icon={ArrowLeftIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("browser.forward")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={toolButton}
          aria-label={i18n.t("browser.forward")}
          disabled={!session?.live || session.canGoForward === false}
          onclick={() => void browserForward(workspace).catch(() => {})}
        >
          <Icon icon={ArrowRightIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={loading ? i18n.t("browser.stop") : i18n.t("browser.reload")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={toolButton}
          aria-label={loading ? i18n.t("browser.stop") : i18n.t("browser.reload")}
          disabled={!session?.live}
          onclick={(e: MouseEvent) => reloadOrStop(e.shiftKey)}
        >
          <Icon icon={loading ? StopIcon : RotateCwIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>

    <div class="relative ml-0.5 min-w-0 flex-1">
      <Icon
        icon={secure ? LockIcon : GlobeIcon}
        class={cn(
          icon.decorative,
          "pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground/70",
        )}
      />
      <Input
        bind:ref={addressEl}
        density="compact"
        class="w-full bg-card pl-7 font-mono text-xs"
        type="text"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        placeholder={i18n.t("browser.addressPlaceholder")}
        aria-label={i18n.t("browser.address")}
        title={session?.title || undefined}
        bind:value={address}
        onfocus={(e: FocusEvent) => {
          editing = true;
          (e.currentTarget as HTMLInputElement).select();
        }}
        onblur={() => {
          if (editing) cancelEdit();
        }}
        onkeydown={onAddressKey}
      />
      {#if loading}
        <div
          class="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 overflow-hidden rounded-full"
          aria-hidden="true"
        >
          <div class="browser-progress h-full w-1/3 rounded-full bg-primary/70"></div>
        </div>
      {/if}
    </div>

    {#if zoom !== 1}
      <TooltipSimple title={i18n.t("browser.zoomReset")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="xs"
            class={cn(toolButton, "h-6 px-1.5 font-mono text-[11px] tabular-nums")}
            aria-label={i18n.t("browser.zoomReset")}
            onclick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </Button>
        {/snippet}
      </TooltipSimple>
    {/if}

    <TooltipSimple title={i18n.t("browser.openExternal")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={toolButton}
          aria-label={i18n.t("browser.openExternal")}
          disabled={!session?.url || session.url === "about:blank"}
          onclick={() => void openExternal(session?.url ?? "").catch(() => {})}
        >
          <Icon icon={ExternalLinkIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("browser.devtools")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={toolButton}
          aria-label={i18n.t("browser.devtools")}
          disabled={!session?.live}
          onclick={() => void browserDevtools(workspace).catch(() => {})}
        >
          <Icon icon={CodeIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("browser.close")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={toolButton}
          aria-label={i18n.t("browser.close")}
          onclick={() => app.closeBrowser()}
        >
          <Icon icon={XIcon} class={icon.action} />
        </Button>
      {/snippet}
    </TooltipSimple>
  </div>

  <!-- The page slot: the workspace's page is placed over this element. -->
  <div bind:this={slot} class="relative min-h-0 flex-1 bg-muted/40">
    {#if unavailable}
      <div
        class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"
      >
        <p>{i18n.t("browser.unavailable")}</p>
        <Button
          variant="outline"
          size="sm"
          class="text-xs hover:bg-accent hover:text-foreground"
          onclick={() => void openExternal(normalizeAddress(address) ?? "").catch(() => {})}
        >
          {i18n.t("browser.openExternal")}
        </Button>
      </div>
    {/if}
  </div>
</div>

<style>
  .browser-progress {
    animation: browser-progress 1.1s ease-in-out infinite;
  }
  @keyframes browser-progress {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .browser-progress {
      animation: none;
      width: 100%;
      opacity: 0.5;
    }
  }
</style>
