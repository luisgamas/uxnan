<script lang="ts">
  // An agent's effective state (spec 02d §1.2) as one compact glyph:
  //   working  → the Comet Trail matrix (emerald)  — it is moving right now
  //   waiting  → a question bubble (orange)        — it needs *you*
  //   blocked  → a pause circle (amber)            — it needs another system
  //   done     → a check (sky)                     — the turn finished
  //   idle     → a quiet grey dot
  // A stale report (no update >30 min) is dimmed.
  //
  // `idle` deliberately keeps the plain dot: it is by far the most frequent state,
  // so a glyph there would be constant noise. "Glyph = something is happening /
  // dot = nothing is" is what makes the sidebar scannable at a glance.
  import { cn } from "$lib/utils";
  import { icon } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import CometTrail from "./CometTrail.svelte";
  import type { DisplayStatus } from "$lib/state/agentDisplay";
  import { Icon } from "$lib/components/ui/icon";
  import CircleCheckIcon from "@hugeicons/core-free-icons/CircleCheckIcon";
  import CirclePauseIcon from "@hugeicons/core-free-icons/PauseCircleIcon";
  import MessageCircleQuestionMarkIcon from "@hugeicons/core-free-icons/ChatQuestionIcon";

  let {
    status,
    stale = false,
    class: className,
  }: { status: DisplayStatus; stale?: boolean; class?: string } = $props();

  /** State hue. Applied to the wrapper so `currentColor` reaches the comet too. */
  const COLOR: Record<DisplayStatus, string> = {
    working: "text-emerald-500",
    blocked: "text-amber-500",
    waiting: "text-orange-500",
    done: "text-sky-500",
    idle: "text-muted-foreground/50",
  };
  const label = $derived(i18n.t(`monitor.${status}`));
</script>

<TooltipSimple title={stale ? `${label} · ${i18n.t("monitor.stale")}` : label}>
  {#snippet children(tp)}
    <span
      {...tp}
      class={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        COLOR[status],
        stale && "opacity-40",
        className,
      )}
    >
      {#if status === "working"}
        <CometTrail size={12} />
      {:else if status === "waiting"}
        <Icon icon={MessageCircleQuestionMarkIcon} class={icon.status} />
      {:else if status === "blocked"}
        <Icon icon={CirclePauseIcon} class={icon.status} />
      {:else if status === "done"}
        <Icon icon={CircleCheckIcon} class={icon.status} />
      {:else}
        <span class="size-1.5 rounded-full bg-current"></span>
      {/if}
    </span>
  {/snippet}
</TooltipSimple>
