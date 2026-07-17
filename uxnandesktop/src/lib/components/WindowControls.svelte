<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import QuickCommandsMenu from "./QuickCommandsMenu.svelte";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import SquareIcon from "@lucide/svelte/icons/square";
  import XIcon from "@lucide/svelte/icons/x";

  // Window controls degrade gracefully in a plain browser (no Tauri runtime).
  function windowAction(fn: (w: ReturnType<typeof getCurrentWindow>) => void) {
    try {
      fn(getCurrentWindow());
    } catch {
      // Not running inside Tauri (web preview) — ignore.
    }
  }

  const btn =
    "flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
</script>

<!-- Window controls. The OS chrome is disabled (`decorations: false`), so these
     are the only minimize/maximize/close affordance. They're fixed to the
     top-right of the viewport — not nested inside the right panel — so they stay
     reachable even when that panel is hidden (otherwise hiding it would leave no
     way to close the window). -->
<div class="fixed right-0 top-0 z-50 flex select-none items-center">
  <!-- Quick-commands launcher: its own slot to the left of the window controls,
       so a hidden panel never covers it (same rationale as the controls). -->
  <QuickCommandsMenu />
  <TooltipSimple title={i18n.t("titlebar.minimize")}>
    {#snippet children(tp)}
      <button
        {...tp}
        class={btn}
        aria-label={i18n.t("titlebar.minimize")}
        onclick={() => windowAction((w) => w.minimize())}
      >
        <MinusIcon class="size-4" />
      </button>
    {/snippet}
  </TooltipSimple>
  <TooltipSimple title={i18n.t("titlebar.maximize")}>
    {#snippet children(tp)}
      <button
        {...tp}
        class={btn}
        aria-label={i18n.t("titlebar.maximize")}
        onclick={() => windowAction((w) => w.toggleMaximize())}
      >
        <SquareIcon class="size-3.5" />
      </button>
    {/snippet}
  </TooltipSimple>
  <TooltipSimple title={i18n.t("titlebar.close")}>
    {#snippet children(tp)}
      <button
        {...tp}
        class="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
        aria-label={i18n.t("titlebar.close")}
        onclick={() => windowAction((w) => w.close())}
      >
        <XIcon class="size-4" />
      </button>
    {/snippet}
  </TooltipSimple>
</div>
