<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Icon } from "$lib/components/ui/icon";
  import { tab } from "$lib/design";
  import { cn } from "$lib/utils";
  import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
  import SlidersIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
  import { i18n } from "$lib/i18n";

  export type EditorMode = "visual" | "json";

  let {
    value = $bindable<EditorMode>("visual"),
    onJsonSelect,
    children,
  }: {
    value?: EditorMode;
    onJsonSelect?: () => void;
    children?: Snippet;
  } = $props();

  function selectMode(next: string) {
    const nextMode = next === "json" ? "json" : "visual";
    if (nextMode === "json") onJsonSelect?.();
    value = nextMode;
  }
</script>

<Tabs.Root bind:value onValueChange={selectMode} class="min-h-0 flex-1 gap-3">
  <Tabs.List class={tab.segmentedList}>
    <Tabs.Trigger
      value="visual"
      class={cn(
        tab.segmentedTrigger,
        value === "visual"
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon icon={SlidersIcon} class="size-3.5" />{i18n.t("appearance.visual")}
    </Tabs.Trigger>
    <Tabs.Trigger
      value="json"
      class={cn(
        tab.segmentedTrigger,
        value === "json"
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon icon={CodeIcon} class="size-3.5" />JSON
    </Tabs.Trigger>
  </Tabs.List>

  {@render children?.()}
</Tabs.Root>
