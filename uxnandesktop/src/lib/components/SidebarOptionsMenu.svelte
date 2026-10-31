<script lang="ts">
  // The left panel's one options menu: how to open a terminal (the default
  // shell, or any configured profile), how the tree is drawn (view, both sorts),
  // what it holds back (hidden worktrees) and refresh. With the attention pill and
  // the add-project button it is all the header shows, so what used to be a row of
  // buttons is one keystroke away here.
  //
  // The held-back count rides on the trigger as a badge, so "something is hidden
  // from you" is still visible with the menu closed; the per-project line and
  // the empty state say the same thing where it matters.
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Icon } from "$lib/components/ui/icon";
  import KeyChord from "./KeyChord.svelte";
  import { icon, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { i18n } from "$lib/i18n";
  import { formatChord, resolveBinding } from "$lib/keyboard";
  import type { SidebarGroupBy, SortMode } from "$lib/types";
  import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";

  // The five sort modes offered for each axis (projects and worktrees). "manual"
  // and the two "name" modes don't drift over time; "recent"/"attention" do (they
  // read agent state), so the rendered order is frozen between settle windows.
  const SORT_MODES: { value: SortMode; label: () => string }[] = [
    { value: "manual", label: () => i18n.t("sidebar.sortManual") },
    { value: "name-asc", label: () => i18n.t("sidebar.sortNameAsc") },
    { value: "name-desc", label: () => i18n.t("sidebar.sortNameDesc") },
    { value: "recent", label: () => i18n.t("sidebar.sortRecent") },
    { value: "attention", label: () => i18n.t("sidebar.sortAttention") },
  ];

  const VIEW_MODES: { value: SidebarGroupBy; label: () => string }[] = [
    { value: "none", label: () => i18n.t("sidebar.viewTree") },
    { value: "status", label: () => i18n.t("sidebar.viewStatus") },
    { value: "review", label: () => i18n.t("sidebar.viewReview") },
  ];
  const viewLabel = (mode: SidebarGroupBy) => VIEW_MODES.find((m) => m.value === mode)?.label() ?? "";

  const terminalBinding = $derived(resolveBinding("newTerminal"));

  function profileLabel(name: string): string {
    return name.trim() || i18n.t("terminal.unnamedProfile");
  }

  const heldBack = $derived(projects.hiddenCount);
  // The hidden-worktree controls appear once anything is set aside: worktrees
  // the user hid, and worktrees created outside Uxnan (held back while untouched).
  // Two different things, named apart: the checkbox only *looks* at them (and
  // counts what is held back, like the badge); the action *ends* the hiding —
  // every hidden mark goes and every external worktree becomes known.
  const anyHidden = $derived((app.settings.hiddenWorktrees?.length ?? 0) > 0 || heldBack > 0);

  const label = $derived(
    heldBack > 0
      ? i18n.plural(heldBack, "sidebar.optionsHiddenOne", "sidebar.optionsHiddenOther")
      : i18n.t("sidebar.options"),
  );

  const sortLabel = (mode: SortMode) =>
    SORT_MODES.find((m) => m.value === mode)?.label() ?? "";
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <TooltipSimple title={label}>
        {#snippet children(tp)}
          <Button
            variant="ghost"
            size="icon-xs"
            class="relative"
            {...tp}
            {...props}
            aria-label={label}
          >
            <Icon icon={SlidersHorizontalIcon} class={icon.action} />
            {#if heldBack > 0}
              <!-- Primary while the panel is holding rows back from you; quiet
                   once you chose to look at them. `aria-hidden`: the label says it. -->
              <span
                aria-hidden="true"
                data-testid="sidebar-options-badge"
                class={cn(
                  "pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none tabular-nums",
                  projects.showHidden
                    ? "bg-foreground/15 text-foreground"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {heldBack > 99 ? "99+" : heldBack}
              </span>
            {/if}
          </Button>
        {/snippet}
      </TooltipSimple>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content width="standard" align="end">
    <!-- New terminal: the default shell is one item; the configured profiles
         (if any) are a submenu, as the "+" menu offered them. -->
    <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => app.openTerminal()}>
      <Icon icon={TerminalIcon} class={icon.button} />
      <span class="flex-1 truncate">{i18n.t("terminal.newTerminal")}</span>
      {#if terminalBinding}
        <KeyChord chord={terminalBinding} />
      {/if}
    </DropdownMenu.Item>
    {#if app.terminalProfiles.length > 0}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger class={cn(text.menu, "gap-2")}>
          <Icon icon={TerminalIcon} class={cn(icon.button, "opacity-0")} />
          <span class="flex-1 truncate">{i18n.t("terminal.chooseProfile")}</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent width="simple" viewport="compact">
          {#each app.terminalProfiles as p (p.id)}
            <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => app.openTerminal({ profileId: p.id })}>
              <Icon icon={TerminalIcon} class={icon.button} />
              <span class="flex-1 truncate">{profileLabel(p.name)}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {/if}
    <DropdownMenu.Separator />
    <!-- View and both sorts are submenus that show their current value: three
         five-way choices inline would make this menu scroll in a short window. -->
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger class={text.menu}>
        <span class="flex-1 truncate">{i18n.t("sidebar.view")}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{viewLabel(projects.groupBy)}</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent width="simple" viewport="compact">
        <DropdownMenu.RadioGroup
          value={projects.groupBy}
          onValueChange={(v) => projects.setGroupBy(v as SidebarGroupBy)}
        >
          {#each VIEW_MODES as m (m.value)}
            <DropdownMenu.RadioItem class={text.menu} value={m.value}>{m.label()}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger class={text.menu}>
        <span class="flex-1 truncate">{i18n.t("sidebar.sortProjectsBy")}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{sortLabel(projects.projectSort)}</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent width="simple" viewport="compact">
        <DropdownMenu.RadioGroup
          value={projects.projectSort}
          onValueChange={(v) => projects.setProjectSort(v as SortMode)}
        >
          {#each SORT_MODES as m (m.value)}
            <DropdownMenu.RadioItem class={text.menu} value={m.value}>{m.label()}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger class={text.menu}>
        <span class="flex-1 truncate">{i18n.t("sidebar.sortWorktreesBy")}</span>
        <span class="shrink-0 text-xs text-muted-foreground">{sortLabel(projects.worktreeSort)}</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent width="simple" viewport="compact">
        <DropdownMenu.RadioGroup
          value={projects.worktreeSort}
          onValueChange={(v) => projects.setWorktreeSort(v as SortMode)}
        >
          {#each SORT_MODES as m (m.value)}
            <DropdownMenu.RadioItem class={text.menu} value={m.value}>{m.label()}</DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>

    {#if anyHidden}
      <!-- Only once something is hidden: a panel nobody filtered stays as it
           was. The first item is a view switch (the marks stay), the second
           removes the marks for good. -->
      <DropdownMenu.Separator />
      <DropdownMenu.CheckboxItem
        class={text.menu}
        checked={projects.showHidden}
        onCheckedChange={(on) => projects.setShowHidden(on)}
      >
        <span class="flex-1 truncate">
          {i18n.t("sidebar.viewHidden")}{heldBack > 0 ? ` (${heldBack})` : ""}
        </span>
      </DropdownMenu.CheckboxItem>
      <DropdownMenu.Item class={text.menu} onclick={() => projects.showAllHidden()}>
        {i18n.t("sidebar.stopHiding")}
      </DropdownMenu.Item>
    {/if}

    <DropdownMenu.Separator />
    <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => void projects.init()}>
      <Icon icon={RefreshCwIcon} class={icon.button} />
      <span class="flex-1 truncate">{i18n.t("sidebar.refresh")}</span>
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
