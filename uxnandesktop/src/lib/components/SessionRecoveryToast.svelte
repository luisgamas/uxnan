<script lang="ts">
  // Body of the "previous session ended unexpectedly" toast. Same elevated-card
  // recipe as UpdateToast (solid surface, border, shadow, dismiss in the corner)
  // so app-level notices read as one family.
  //
  // Shown at most once per launch, and only when the backend reports that the
  // previous session never reached its clean exit path. The point is not to
  // report the crash for its own sake — it is to explain the consequence the
  // user is about to notice anyway: terminal scrollback is persisted on the
  // clean path only, so those terminals come back empty.

  import { diagnostics } from "$lib/state/diagnostics.svelte";
  import { revealPath } from "$lib/api";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import XIcon from "@lucide/svelte/icons/x";

  const logPath = $derived(diagnostics.logPath);
</script>

<div
  class="relative flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border/70 bg-[var(--ux-elevated)] p-3.5 shadow-md"
  role="status"
>
  <TooltipSimple title={i18n.t("diagnostics.dismiss")}>
    {#snippet children(tp)}
      <Button
        {...tp}
        variant="ghost"
        size="icon-sm"
        class={cn(iconButton.sm, "absolute right-2 top-2")}
        aria-label={i18n.t("diagnostics.dismiss")}
        onclick={() => diagnostics.dismiss()}
      >
        <XIcon class={icon.button} />
      </Button>
    {/snippet}
  </TooltipSimple>

  <div class="flex min-w-0 items-start gap-2 pr-8">
    <TriangleAlertIcon
      class={cn(icon.button, "mt-0.5 shrink-0 text-amber-600 dark:text-amber-400")}
    />
    <span class={cn("min-w-0 text-foreground", text.heading)}>
      {i18n.t("diagnostics.uncleanTitle")}
    </span>
  </div>

  <span class={cn("min-w-0 text-muted-foreground", text.body)}>
    {i18n.t("diagnostics.uncleanBody")}
  </span>

  {#if logPath}
    <Button
      class="w-full"
      variant="outline"
      size="sm"
      onclick={() => void revealPath(logPath).catch(() => {})}
    >
      <FileTextIcon data-icon="inline-start" />
      {i18n.t("diagnostics.revealLog")}
    </Button>
  {/if}
</div>
