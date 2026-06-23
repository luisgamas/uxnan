<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { i18n } from "$lib/i18n";

  // Window controls degrade gracefully in a plain browser (no Tauri runtime).
  function windowAction(fn: (w: ReturnType<typeof getCurrentWindow>) => void) {
    try {
      fn(getCurrentWindow());
    } catch {
      // Not running inside Tauri (web preview) — ignore.
    }
  }
</script>

<!-- Custom title bar (the OS chrome is disabled via `decorations: false`).
     The bar itself is a drag region; interactive children are not. The
     left-sidebar toggle and the Settings entry live elsewhere now (the status
     bar and the projects sidebar, respectively). -->
<header
  data-tauri-drag-region
  class="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border bg-card px-2 text-sm"
>
  <!-- Brand mark. Kept inside the drag region (purely decorative — no
       click handler) so the user can grab the title bar by the logo too.
       Two hand-authored variants: black stroke (`logo_nb`) on light themes,
       white stroke (`logo_wnb`) on dark themes — swapped via the `.dark`
       class so we never tint at runtime. Sources live in `static/`. -->
  <img
    src="/logo_nb.svg"
    alt=""
    aria-hidden="true"
    data-tauri-drag-region
    class="brand-mark h-5 w-5 block dark:hidden"
  />
  <img
    src="/logo_wnb.svg"
    alt=""
    aria-hidden="true"
    data-tauri-drag-region
    class="brand-mark hidden h-5 w-5 dark:block"
  />
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
