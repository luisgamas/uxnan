<script lang="ts">
  // An agent's effective state (spec 02d §1.2) as one compact glyph:
  //   working  → a spinner (emerald)               — it is moving right now
  //   waiting  → a question bubble (orange)        — it needs *you*
  //   blocked  → a pause circle (amber)            — it needs another system
  //   done     → a check (sky)                     — the turn finished
  //   idle     → a quiet grey dot
  // A stale report (no update >30 min) is dimmed.
  //
  // `idle` deliberately keeps the plain dot: it is by far the most frequent state,
  // so a glyph there would be constant noise. "Glyph = something is happening /
  // dot = nothing is" is what makes the sidebar scannable at a glance.
  //
  // `waiting` keeps the *bubble* silhouette on purpose. At the 12px these glyphs
  // are drawn, `done` and `blocked` are already two rings with something inside;
  // a third ring (a "?" in a circle) reads as the same shape at a glance, so the
  // one state that is about *you* would be the hardest to spot. The bubble is
  // the only outline in the set that is not a circle.
  import { cn } from "$lib/utils";
  import { icon, stateHue } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Spinner } from "$lib/components/ui/spinner";
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

  /** State hue (`stateHue`, shared with the chat). Applied to the wrapper so
   *  `currentColor` reaches the spinner too. */
  const COLOR: Record<DisplayStatus, string> = stateHue;
  const label = $derived(i18n.t(`monitor.${status}`));
</script>

<TooltipSimple title={stale ? `${label} · ${i18n.t("monitor.stale")}` : label}>
  {#snippet children(tp)}
    <span
      {...tp}
      class={cn(
        "inline-flex size-4 shrink-0 items-center justify-center",
        COLOR[status],
        stale && "opacity-40",
        className,
      )}
    >
      {#if status === "working"}
        <!-- One layer turning on the compositor: the cheapest "moving right now"
             the webview can draw, one per working agent. -->
        <Spinner class="size-3.5" aria-hidden="true" role="presentation" />
      {:else if status === "waiting"}
        <Icon icon={MessageCircleQuestionMarkIcon} class={icon.decorative} />
      {:else if status === "blocked"}
        <Icon icon={CirclePauseIcon} class={icon.decorative} />
      {:else if status === "done"}
        <Icon icon={CircleCheckIcon} class={icon.decorative} />
      {:else}
        <span class="size-1.5 rounded-full bg-current"></span>
      {/if}
    </span>
  {/snippet}
</TooltipSimple>
