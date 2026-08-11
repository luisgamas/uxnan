<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import QuickCommandsMenu from "./QuickCommandsMenu.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import MinusIcon from "@hugeicons/core-free-icons/MinusSignIcon";
  import SquareIcon from "@hugeicons/core-free-icons/SquareIcon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import { focus, shell } from "$lib/design";
  import { icon as iconSize } from "$lib/design";
  import { isMac } from "$lib/keybindings";
  import { cn } from "$lib/utils";

  // Window controls degrade gracefully in a plain browser (no Tauri runtime).
  function windowAction(fn: (w: ReturnType<typeof getCurrentWindow>) => void) {
    try {
      fn(getCurrentWindow());
    } catch {
      // Not running inside Tauri (web preview) — ignore.
    }
  }

  const btn =
    `${shell.titlebarControl} ${focus.ring} text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`;
</script>

<!-- Windows/Linux use custom controls because their OS chrome is disabled.
     macOS keeps its native traffic lights and only renders Quick Commands here.
     The controls are fixed to the
     top-right of the viewport — not nested inside the right panel — so they stay
     reachable even when that panel is hidden (otherwise hiding it would leave no
     way to close the window). -->
<div class={cn(shell.appBarOverlay, shell.titlebar)} role="toolbar" aria-label={i18n.t("titlebar.controls")}>
  <!-- Quick-commands launcher: its own slot to the left of the window controls,
       so a hidden panel never covers it (same rationale as the controls). -->
  <QuickCommandsMenu />
  {#if !isMac}
  <TooltipSimple title={i18n.t("titlebar.minimize")}>
    {#snippet children(tp)}
      <button
        {...tp}
        class={btn}
        aria-label={i18n.t("titlebar.minimize")}
        onclick={() => windowAction((w) => w.minimize())}
      >
        <Icon icon={MinusIcon} class={iconSize.windowControl} />
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
        <Icon icon={SquareIcon} class={iconSize.windowMaximize} />
      </button>
    {/snippet}
  </TooltipSimple>
  <TooltipSimple title={i18n.t("titlebar.close")}>
    {#snippet children(tp)}
      <button
        {...tp}
        class={`${shell.titlebarControl} ${focus.ring} text-muted-foreground transition-colors hover:bg-destructive hover:text-white`}
        aria-label={i18n.t("titlebar.close")}
        onclick={() => windowAction((w) => w.close())}
      >
        <Icon icon={XIcon} class={iconSize.windowControl} />
      </button>
    {/snippet}
  </TooltipSimple>
  {/if}
</div>
