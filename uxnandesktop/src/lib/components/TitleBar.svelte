<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";

  // Window controls degrade gracefully in a plain browser (no Tauri runtime).
  function windowAction(fn: (w: ReturnType<typeof getCurrentWindow>) => void) {
    try {
      fn(getCurrentWindow());
    } catch {
      // Not running inside Tauri (web preview) — ignore.
    }
  }

  function toggleLeft() {
    app.settings.leftSidebarOpen = !app.settings.leftSidebarOpen;
    void app.persistSettings();
  }
</script>

<!-- Custom title bar (the OS chrome is disabled via `decorations: false`).
     The bar itself is a drag region; interactive children are not. -->
<header
  data-tauri-drag-region
  class="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border bg-card px-2 text-sm"
>
  <!-- Hide the left-sidebar toggle while the settings view is open — the
       left side IS the settings menu, so toggling the project tree makes
       no sense. -->
  {#if !app.settingsOpen}
    <button
      class={cn(
        "flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
      title={i18n.t("titlebar.toggleLeft")}
      aria-label={i18n.t("titlebar.toggleLeft")}
      onclick={toggleLeft}
    >
      <PanelLeftIcon class={icon.button} />
    </button>
  {/if}

  <span data-tauri-drag-region class="font-semibold tracking-tight"
    >Uxnan Desktop</span
  >
  <span data-tauri-drag-region class="text-xs text-muted-foreground">ADE</span>
  <span
    class="rounded border border-border bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
    title={i18n.t("titlebar.alphaTooltip")}
  >
    Alpha
  </span>

  <!-- Draggable filler -->
  <div data-tauri-drag-region class="h-full flex-1"></div>

  <!-- Settings (toggle) -->
  <button
    class={cn(
      "flex size-7 items-center justify-center rounded hover:bg-accent hover:text-accent-foreground",
      app.settingsOpen ? "bg-accent text-accent-foreground" : "text-muted-foreground",
    )}
    title={i18n.t("titlebar.settings")}
    aria-label={i18n.t("titlebar.settings")}
    onclick={() => (app.settingsOpen = !app.settingsOpen)}
  >
    <SettingsIcon class={icon.button} />
  </button>

  <!-- Window controls -->
  <div class="ml-1 flex items-center">
    <button
      class="flex h-7 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title={i18n.t("titlebar.minimize")}
      aria-label={i18n.t("titlebar.minimize")}
      onclick={() => windowAction((w) => w.minimize())}
    >
      ﹣
    </button>
    <button
      class="flex h-7 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title={i18n.t("titlebar.maximize")}
      aria-label={i18n.t("titlebar.maximize")}
      onclick={() => windowAction((w) => w.toggleMaximize())}
    >
      ▢
    </button>
    <button
      class="flex h-7 w-9 items-center justify-center rounded text-muted-foreground hover:bg-destructive hover:text-white"
      title={i18n.t("titlebar.close")}
      aria-label={i18n.t("titlebar.close")}
      onclick={() => windowAction((w) => w.close())}
    >
      ✕
    </button>
  </div>
</header>
