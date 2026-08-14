<script lang="ts">
  // One agent inside a settings list: its brand mark and name on the left, its
  // control — a Switch in both lists that use this — on the right, exactly like
  // every other settings row. Per-agent extras (the config the ADE writes) hang
  // off an optional disclosure that opens *under* the row, so a list of twenty
  // agents still reads as a list and never grows a nav rail of its own.
  //
  // Shared by Settings → Hooks and Settings → Browser so the two per-agent
  // lists read as one thing; both consume `SettingsRow`, which owns the
  // `row.settings` geometry.
  //
  // The disclosure is hand-rolled rather than a `Collapsible`: its trigger and
  // its content sit in different cells of `SettingsRow`'s grid, which one
  // wrapping Root element cannot span.
  import type { Snippet } from "svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";

  let {
    logo,
    name,
    description,
    path,
    note,
    noteTone = "muted",
    control: controlSnippet,
    details,
    detailsLabel,
    onDetailsOpen,
  }: {
    /** Logo key for `AgentLogo` (the generic Bot glyph stands in when empty). */
    logo?: string | null;
    /** The product's name, as the catalog spells it. */
    name: string;
    /** One line on what this agent's integration actually reports/does. */
    description?: string;
    /** The config file the wiring lands in — shown mono and truncated. */
    path?: string;
    /** An exceptional-state line under the path (not on this machine, an
     *  install that failed). Absent for the normal case: the switch already
     *  says whether the agent is wired. */
    note?: string;
    noteTone?: "muted" | "warning";
    /** Right-aligned control. */
    control?: Snippet;
    /** Content revealed under the row; omitted → the row has no disclosure. */
    details?: Snippet;
    /** Accessible name for the disclosure button. */
    detailsLabel?: string;
    /** Fired on open/close, so a caller can fetch the detail on demand rather
     *  than one round-trip per agent up front. */
    onDetailsOpen?: (open: boolean) => void;
  } = $props();

  let open = $state(false);
  const contentId = $props.id();

  function toggle() {
    open = !open;
    onDetailsOpen?.(open);
  }
</script>

{#snippet detailsCell()}
  <div id={contentId} class="pt-1">{@render details?.()}</div>
{/snippet}

<SettingsRow
  label={name}
  {description}
  children={open && details ? detailsCell : undefined}
>
  {#snippet leading()}
    <AgentLogo {logo} class={icon.brand} />
  {/snippet}

  {#snippet meta()}
    {#if path}
      <p class={cn("truncate font-mono", text.meta)} title={path}>{path}</p>
    {/if}
    {#if note}
      <p
        class={cn(
          text.meta,
          noteTone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {note}
      </p>
    {/if}
  {/snippet}

  {#snippet control()}
    <div class="flex items-center gap-1">
      {@render controlSnippet?.()}
      {#if details}
        <Button
          variant="ghost"
          size="icon-sm"
          class={cn(iconButton.action, "shrink-0 text-muted-foreground")}
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={detailsLabel}
          title={detailsLabel}
          onclick={toggle}
        >
          <Icon
            icon={ChevronDownIcon}
            class={cn(icon.button, "transition-transform", open && "rotate-180")}
          />
        </Button>
      {/if}
    </div>
  {/snippet}
</SettingsRow>
