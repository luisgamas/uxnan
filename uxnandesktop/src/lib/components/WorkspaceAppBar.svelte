<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { shell, icon } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import { cn } from "$lib/utils";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";

  let { title, onback }: { title: string; onback: () => void } = $props();
</script>

<header
  data-tauri-drag-region
  class={cn(
    shell.appBar,
    shell.workspaceHeader,
    isMac ? cn(shell.macTrafficLightsInset, "pr-10") : "pr-40",
  )}
>
  <TooltipSimple title={i18n.t("common.close")}>
    {#snippet children(tp)}
      <Button
        {...tp}
        variant="ghost"
        size="icon-sm"
        class={shell.appBarAction}
        aria-label={i18n.t("common.close")}
        onclick={onback}
      >
        <Icon icon={ArrowLeftIcon} class={icon.button} />
      </Button>
    {/snippet}
  </TooltipSimple>
  <h1 class="text-sm font-semibold tracking-tight">{title}</h1>
</header>
