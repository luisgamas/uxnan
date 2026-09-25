<script lang="ts">
  // The top band of a view that takes over the workspace — Settings,
  // Automations, the GitHub view: the 40px appbar every panel starts with, a
  // back button that closes the view, its title, and (optionally) the view's
  // own controls after the title and at the right end. One component, so these
  // views keep one height, one back button in one place, and never lose it to
  // a scroll.
  import type { Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { shell, icon } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keyboard";
  import { cn } from "$lib/utils";
  import { titlebarInsets, type TitlebarEdges } from "$lib/titlebar";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";

  let {
    title,
    onback,
    edges = { left: true, right: true },
    controls,
    actions,
  }: {
    title: string;
    onback: () => void;
    /** The window's top corners this bar reaches. A full-screen view spans
     *  the window (both); the GitHub view shares it with the sidebar and the
     *  dock. */
    edges?: TitlebarEdges;
    /** The view's own controls, after the title (a section switcher). */
    controls?: Snippet;
    /** Actions at the bar's right end (refresh). */
    actions?: Snippet;
  } = $props();
</script>

<header
  data-tauri-drag-region
  class={cn(shell.appBar, shell.workspaceHeader, titlebarInsets(edges, isMac))}
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
  <h1 data-tauri-drag-region class="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h1>
  {@render controls?.()}
  <div data-tauri-drag-region class="min-w-0 flex-1 self-stretch"></div>
  {@render actions?.()}
</header>
