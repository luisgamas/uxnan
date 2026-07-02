<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { i18n } from "$lib/i18n";
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
  <button
    class={btn}
    title={i18n.t("titlebar.minimize")}
    aria-label={i18n.t("titlebar.minimize")}
    onclick={() => windowAction((w) => w.minimize())}
  >
    <MinusIcon class="size-4" />
  </button>
  <button
    class={btn}
    title={i18n.t("titlebar.maximize")}
    aria-label={i18n.t("titlebar.maximize")}
    onclick={() => windowAction((w) => w.toggleMaximize())}
  >
    <SquareIcon class="size-3.5" />
  </button>
  <button
    class="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
    title={i18n.t("titlebar.close")}
    aria-label={i18n.t("titlebar.close")}
    onclick={() => windowAction((w) => w.close())}
  >
    <XIcon class="size-4" />
  </button>
</div>
