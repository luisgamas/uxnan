<script lang="ts">
  // A block of text to read or copy — a command, a script, a config snippet,
  // a tool's output — in the app's one shape: a quiet bordered monospace pane
  // with a copy button in its corner (a check for a moment once copied).
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
  import { clipboardWrite } from "$lib/clipboard";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";

  let {
    value,
    copyable = true,
    copyLabel,
    class: className,
  }: {
    value: string;
    /** Offer the copy button (off for output that is only read). */
    copyable?: boolean;
    /** The copy button's tooltip (default "Copy"). */
    copyLabel?: string;
    /** Extra classes on the pane (e.g. a different max height). */
    class?: string;
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    if (!value) return;
    await clipboardWrite(value);
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1200);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<div class="relative">
  {#if copyable}
    <TooltipSimple title={copyLabel ?? i18n.t("common.copy")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          class={cn(iconButton.action, "absolute right-1 top-1 z-10")}
          aria-label={copyLabel ?? i18n.t("common.copy")}
          onclick={() => void copy()}
        >
          <Icon icon={copied ? CheckIcon : CopyIcon} class={icon.button} />
        </Button>
      {/snippet}
    </TooltipSimple>
  {/if}
  <pre
    class={cn(
      "scrollbar-sleek max-h-72 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2",
      copyable && "pr-10",
      text.meta,
      "whitespace-pre font-mono",
      className,
    )}>{value || "…"}</pre>
</div>
