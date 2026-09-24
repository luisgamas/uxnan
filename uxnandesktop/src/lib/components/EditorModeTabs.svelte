<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Segmented } from "$lib/components/ui/segmented";
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

<!-- The panels (`Tabs.Content` in the caller) follow the same value. -->
<Tabs.Root bind:value class="min-h-0 flex-1 gap-3">
  <Segmented
    {value}
    options={[
      { value: "visual", label: i18n.t("appearance.visual"), icon: SlidersIcon },
      { value: "json", label: "JSON", icon: CodeIcon },
    ]}
    onValueChange={selectMode}
    class="self-start"
  />

  {@render children?.()}
</Tabs.Root>
