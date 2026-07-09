<script lang="ts">
  // An agent's brand logo ringed by its status color — the building block of the
  // collapsed agent strip (uxnan's compact multi-agent summary). The ring reuses
  // the AgentStatusDot palette so status reads consistently across the sidebar.
  import { cn } from "$lib/utils";
  import AgentLogo from "./AgentLogo.svelte";
  import type { DisplayStatus } from "$lib/state/agentDisplay";

  let {
    logo,
    status,
    stale = false,
    class: className,
  }: {
    logo?: string | null;
    status: DisplayStatus;
    stale?: boolean;
    class?: string;
  } = $props();

  const RING: Record<DisplayStatus, string> = {
    working: "ring-emerald-500",
    blocked: "ring-amber-500",
    waiting: "ring-orange-500",
    done: "ring-sky-500",
    idle: "ring-muted-foreground/40",
  };
</script>

<span
  class={cn(
    "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-background ring-2",
    RING[status],
    stale && "opacity-50",
    className,
  )}
>
  <AgentLogo {logo} class="size-3" />
</span>
