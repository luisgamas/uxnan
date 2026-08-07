<script lang="ts">
  // An agent's brand logo ringed by its status color — the building block of the
  // collapsed agent strip (uxnan's compact multi-agent summary). The ring reuses
  // the AgentStatusIndicator palette so status reads consistently across the
  // sidebar. The ring stays a ring on purpose: the Comet Trail matrix would be
  // illegible inside a 20px avatar, and the strip only needs "who + how".
  import { cn } from "$lib/utils";
  import AgentLogo from "./AgentLogo.svelte";
  import type { DisplayStatus } from "$lib/state/agentDisplay";

  let {
    logo,
    status,
    stale = false,
    size = "md",
    class: className,
  }: {
    logo?: string | null;
    status: DisplayStatus;
    stale?: boolean;
    /** `md` (20px) for the worktree agent strip; `sm` (16px) for the denser
     *  project-card summary, where the strip shares a line with other counters. */
    size?: "sm" | "md";
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
    "inline-flex shrink-0 items-center justify-center rounded-full bg-background",
    size === "sm" ? "size-4 ring-[1.5px]" : "size-5 ring-2",
    RING[status],
    stale && "opacity-50",
    className,
  )}
>
  <AgentLogo {logo} class={size === "sm" ? "size-2.5" : "size-3"} />
</span>
