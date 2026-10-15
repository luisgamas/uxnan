<script lang="ts">
  // A subagent the agent delegated to — its own card in the turn, not one more
  // row of the work log: what it was asked to do, whether it is still working,
  // and its report, which opens in place. The phone draws the same card.
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Badge } from "$lib/components/ui/badge";
  import { Icon } from "$lib/components/ui/icon";
  import UserMultipleIcon from "@hugeicons/core-free-icons/UserMultipleIcon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import MarkdownView from "$lib/components/MarkdownView.svelte";
  import { activityFailed, activityRunning } from "$lib/bridge/timeline";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";
  import ChatWorkingGlyph from "./ChatWorkingGlyph.svelte";
  import ShimmerText from "../ShimmerText.svelte";

  let {
    block,
    live = true,
  }: {
    block: Record<string, unknown>;
    /** Its turn is still running: only then is a running subagent animated. */
    live?: boolean;
  } = $props();

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const sub = $derived(
    block.state && typeof block.state === "object" ? (block.state as Record<string, unknown>) : {},
  );
  const name = $derived(str(sub.name) || i18n.t("chat.subagent"));
  const report = $derived(str(sub.output).trim());
  const running = $derived(live && activityRunning(block));
  const failed = $derived(activityFailed(block));
  let open = $state(false);
</script>

<Collapsible.Root bind:open class={cn(chat.card, "my-1 p-0")}>
  <Collapsible.Trigger
    class={cn(chat.activity, "w-full rounded-[inherit] px-3 py-2")}
    disabled={!report}
  >
    <Icon
      icon={UserMultipleIcon}
      class={cn(icon.decorative, "shrink-0", failed ? "text-destructive" : "opacity-70")}
    />
    <span class={cn(text.menuLabel, "shrink-0")}>{i18n.t("chat.subagent")}</span>
    <ShimmerText
      active={running}
      class={cn("min-w-0 flex-1 truncate text-left", failed ? "text-destructive" : "text-foreground/80")}
    >
      {name}
    </ShimmerText>
    {#if running}
      <ChatWorkingGlyph />
    {:else if failed}
      <Badge variant="destructive">{i18n.t("chat.failed")}</Badge>
    {/if}
    <Icon
      icon={ArrowRight01Icon}
      class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90", !report && "invisible")}
    />
  </Collapsible.Trigger>
  <Collapsible.Content>
    {#if report}
      <div class={cn(text.body, "border-t border-border/50 px-3 py-2")}>
        <MarkdownView source={report} inline />
      </div>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>
