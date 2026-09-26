<script lang="ts" module>
  /** One row of the panel: an agent command or a file of the project. */
  export type Suggestion =
    | { kind: "command"; command: import("$shared/agents/agent-capabilities").AgentCommand }
    | { kind: "file"; path: string; isDir: boolean };
</script>

<script lang="ts">
  // What the composer can complete, over it: the agent's commands while a
  // `/command` is being typed (grouped as the agent names them: skills, its
  // own commands, built-ins), or the project's files for an `@mention`. The
  // composer keeps the focus and drives it (↑ ↓ move, Enter or Tab picks, Esc
  // closes); a click picks too. Built on the menus' own surface and row
  // tokens, so it reads like every other list of choices in the app.
  import { cn } from "$lib/utils";
  import { overlay, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { Spinner } from "$lib/components/ui/spinner";

  let {
    items,
    active = 0,
    loading = false,
    emptyLabel,
    onpick,
    onhover,
  }: {
    items: Suggestion[];
    active?: number;
    loading?: boolean;
    emptyLabel: string;
    onpick: (item: Suggestion) => void;
    onhover?: (index: number) => void;
  } = $props();

  function groupOf(item: Suggestion): string {
    if (item.kind === "file") return "file";
    return item.command.source === "skill"
      ? "skill"
      : item.command.source === "builtin"
        ? "builtin"
        : item.command.source === "acp"
          ? "acp"
          : "custom";
  }

  /** Headings where the group changes (the list arrives grouped). */
  const heading = (index: number): string | null => {
    const group = groupOf(items[index]!);
    if (group === "file") return null;
    if (index > 0 && groupOf(items[index - 1]!) === group) return null;
    return i18n.t(
      group === "skill"
        ? "chat.commandGroup.skill"
        : group === "builtin"
          ? "chat.commandGroup.builtin"
          : group === "acp"
            ? "chat.commandGroup.acp"
            : "chat.commandGroup.custom",
    );
  };

  let list = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  });

</script>

<div
  class={cn(overlay.menuSurface, "w-full")}
  role="listbox"
  aria-label={i18n.t("chat.suggestionsLabel")}
>
  <div bind:this={list} class={overlay.menuCompactViewport}>
    {#if loading && items.length === 0}
      <div class={cn(overlay.item, "flex items-center gap-2 text-muted-foreground")}>
        <Spinner aria-label={i18n.t("common.loading")} />
      </div>
    {:else if items.length === 0}
      <div class={cn(overlay.item, "text-muted-foreground")}>{emptyLabel}</div>
    {/if}
    {#each items as item, index (item.kind === "file" ? item.path : `/${item.command.name}`)}
      {@const title = heading(index)}
      {#if title}
        <div class={cn(overlay.label, "text-muted-foreground")}>{title}</div>
      {/if}
      <button
        type="button"
        role="option"
        aria-selected={index === active}
        data-index={index}
        class={cn(
          overlay.item,
          "flex w-full min-w-0 items-baseline gap-2 rounded-md text-left",
          index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        )}
        onmousedown={(e) => e.preventDefault()}
        onmouseenter={() => onhover?.(index)}
        onclick={() => onpick(item)}
      >
        {#if item.kind === "command"}
          <span class="shrink-0 font-medium">/{item.command.name}</span>
          {#if item.command.argumentHint}
            <span class={cn(text.meta, "shrink-0 font-mono")}>{item.command.argumentHint}</span>
          {/if}
          {#if item.command.description}
            <span class={cn(text.meta, "min-w-0 flex-1 truncate")}>{item.command.description}</span>
          {/if}
        {:else}
          <span class="min-w-0 flex-1 truncate font-mono text-[12px]">
            {item.path}{item.isDir ? "/" : ""}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</div>
