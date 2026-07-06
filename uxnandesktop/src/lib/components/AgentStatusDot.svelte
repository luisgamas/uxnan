<script lang="ts">
  // A colored status dot for an agent's effective state (spec 02d §1.2):
  //   working green (pulse) · blocked yellow · waiting orange (pulse) · done blue
  //   · idle gray. A stale report (no update >30 min) is dimmed.
  import { cn } from "$lib/utils";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import type { DisplayStatus } from "$lib/state/agentDisplay";

  let {
    status,
    stale = false,
    class: className,
  }: { status: DisplayStatus; stale?: boolean; class?: string } = $props();

  const COLOR: Record<DisplayStatus, string> = {
    working: "bg-emerald-500",
    blocked: "bg-amber-500",
    waiting: "bg-orange-500",
    done: "bg-sky-500",
    idle: "bg-muted-foreground/50",
  };
  // The attention states pulse; resting states are solid.
  const pulse = $derived(status === "working" || status === "waiting");
  const label = $derived(i18n.t(`monitor.${status}`));
</script>

<TooltipSimple title={stale ? `${label} · ${i18n.t("monitor.stale")}` : label}>
  {#snippet children(tp)}
    <span
      {...tp}
      class={cn(
        "relative inline-flex size-2 shrink-0 items-center justify-center",
        stale && "opacity-40",
        className,
      )}
    >
      {#if pulse}
        <span
          class={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", COLOR[status])}
        ></span>
      {/if}
      <span class={cn("relative size-1.5 rounded-full", COLOR[status])}></span>
    </span>
  {/snippet}
</TooltipSimple>
