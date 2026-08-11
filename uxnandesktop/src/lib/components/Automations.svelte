<script lang="ts">
  // The Automations screen (spec `02f` §6) — a full-screen view inside the
  // window, built like Settings: a header, a section rail on the left, and a
  // centered content column. It overlays the still-mounted body, so terminals
  // and PTYs survive a visit here untouched.
  //
  // Everything happens **inline**. The only floating surface is the shared
  // destructive confirm, because "delete this automation" genuinely deserves to
  // interrupt.
  import { app, type AutomationsSection } from "$lib/state/app.svelte";
  import { automations } from "$lib/state/automations.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { aiCommitAgents } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, row, text } from "$lib/design";
  import { Icon } from "$lib/components/ui/icon";
  import LayoutDashboardIcon from "@hugeicons/core-free-icons/DashboardSquare01Icon";
  import CalendarClockIcon from "@hugeicons/core-free-icons/CalendarClockIcon";
  import HistoryIcon from "@hugeicons/core-free-icons/HistoryIcon";
  import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
  import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
  import AutomationsOverview from "./automations/AutomationsOverview.svelte";
  import AutomationList from "./automations/AutomationList.svelte";
  import AutomationRuns from "./automations/AutomationRuns.svelte";
  import AutomationTemplates from "./automations/AutomationTemplates.svelte";
  import AutomationSettings from "./automations/AutomationSettings.svelte";
  import WorkspaceAppBar from "./WorkspaceAppBar.svelte";

  const navGroups = [
    {
      titleKey: "automations.groupWork",
      items: [
        { id: "overview", key: "automations.overview", icon: LayoutDashboardIcon },
        { id: "list", key: "automations.list", icon: CalendarClockIcon },
        { id: "runs", key: "automations.runs", icon: HistoryIcon },
      ],
    },
    {
      titleKey: "automations.groupLibrary",
      items: [
        { id: "templates", key: "automations.templates", icon: SparklesIcon },
        { id: "settings", key: "automations.settings", icon: SlidersHorizontalIcon },
      ],
    },
  ] as const;

  function close() {
    app.closeAutomations();
  }

  // Load once when the screen opens; a later visit reuses what's in the store
  // (each section refreshes what it actually shows). On a machine that has never
  // seen them, the shipped examples are offered right after — an empty list
  // makes every section here look like a dead end, and the examples are what
  // the feature's shape is easiest to read from.
  $effect(() => {
    if (!app.automationsOpen) return;
    void automations.load().then(async () => {
      const installed = await aiCommitAgents().catch(() => [] as string[]);
      await automations.seedExamples(installed, projects.allWorktrees()[0]?.path ?? "");
    });
  });

  function onKeyDown(e: KeyboardEvent) {
    if (!app.automationsOpen) return;
    // Never steal Escape from an open menu/dialog or a text field mid-edit.
    const el = e.target as HTMLElement | null;
    if (el?.closest("[data-bits-floating-content-wrapper], input, textarea")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if app.automationsOpen}
  <div class="flex h-full w-full flex-col bg-background text-foreground">
    <!-- Header. Draggable like the Settings one; the button inside is not part
         of the drag region. The right padding clears the floating window
         controls. -->
    <WorkspaceAppBar title={i18n.t("automations.title")} onback={close} />

    <div class="flex min-h-0 flex-1">
      <!-- Section rail: titled groups + settings-nav rows, the same recipe the
           Settings screen uses, so the two read as one family. -->
      <nav
        class="scrollbar-sleek flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/60 p-2"
        aria-label={i18n.t("automations.title")}
      >
        {#each navGroups as group (group.titleKey)}
          <div class="flex flex-col gap-0.5">
            <span class={cn("px-2 pb-0.5", text.section)}>{i18n.t(group.titleKey)}</span>
            {#each group.items as item (item.id)}
              {@const glyph = item.icon}
              <button
                class={cn(
                  row.settingsNav,
                  app.automationsSection === item.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                onclick={() => (app.automationsSection = item.id as AutomationsSection)}
              >
                <Icon icon={glyph} class={icon.button} />
                {i18n.t(item.key)}
              </button>
            {/each}
          </div>
        {/each}
      </nav>

      <div class="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-8 py-7">
        <div class="mx-auto w-full max-w-4xl pb-16">
          {#if automations.error}
            <p
              class={cn(
                "mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-600 dark:text-red-400",
                text.body,
              )}
            >
              {automations.error}
            </p>
          {/if}

          {#if app.automationsSection === "overview"}
            <AutomationsOverview />
          {:else if app.automationsSection === "list"}
            <AutomationList />
          {:else if app.automationsSection === "runs"}
            <AutomationRuns />
          {:else if app.automationsSection === "templates"}
            <AutomationTemplates />
          {:else}
            <AutomationSettings />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
