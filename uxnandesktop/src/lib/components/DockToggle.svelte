<script lang="ts">
  // The status bar's dock button — the one way to open and close the right
  // dock (`state/dock.svelte.ts`); which surface it shows is picked inside the
  // dock. It lights up when an agent waits for the person's approval somewhere
  // they cannot see it — another workspace, or this one with the browser not
  // shown — and then takes them there instead.

  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { dock } from "$lib/state/dock.svelte";
  import { browser } from "$lib/state/browser.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals, GLOBAL_WORKSPACE } from "$lib/state/terminals.svelte";
  import { focus, icon, shell } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { formatChord, resolveBinding } from "$lib/keyboard";
  import { cn } from "$lib/utils";
  import PanelRightIcon from "@hugeicons/core-free-icons/PanelRightIcon";

  /** An approval the person cannot see right now. */
  const waiting = $derived(
    browser.approvals.find((a) => a.workspace !== dock.activeKey || dock.showing() !== "browser") ??
      null,
  );

  const tip = $derived.by(() => {
    if (waiting) return i18n.t("browser.approvalPending");
    const chord = resolveBinding("toggleRightSidebar");
    const label = i18n.t("dock.toggle");
    return chord ? `${label} · ${formatChord(chord)}` : label;
  });

  function onClick(): void {
    if (!waiting) {
      dock.toggle();
      return;
    }
    // Go to the workspace where an agent waits, and show its browser there.
    const ws = waiting.workspace;
    if (ws !== dock.activeKey) {
      if (ws === GLOBAL_WORKSPACE) terminals.setWorkspace(ws);
      else projects.setActiveWorktree(ws);
    }
    dock.show("browser", ws);
  }
</script>

{#if dock.surfaces.length > 0}
  <TooltipSimple title={tip}>
    {#snippet children(props)}
      <button
        {...props}
        class={cn(
          shell.statusBarAction,
          focus.ring,
          "relative",
          dock.isOpen()
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        aria-label={tip}
        aria-pressed={dock.isOpen()}
        onclick={onClick}
      >
        <Icon icon={PanelRightIcon} class={icon.action} />
        {#if waiting}
          <span class="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" aria-hidden="true"></span>
        {/if}
      </button>
    {/snippet}
  </TooltipSimple>
{/if}
