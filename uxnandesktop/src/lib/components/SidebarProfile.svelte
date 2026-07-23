<script lang="ts">
  // Left-sidebar footer: a configurable profile card (avatar + name + a line of
  // text), shadcn-sidebar-footer style. Clicking it opens a menu with the
  // GitHub and Settings sections (moved here from the quick-actions row) plus an
  // "Edit profile" entry. The avatar/name/description live in
  // `AppSettings.profile` and are edited via SidebarProfileDialog.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { cn } from "$lib/utils";
  import { icon, text, divider, row, focus } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { resolveBinding } from "$lib/keybindings";
  import KeyChord from "./KeyChord.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import SidebarProfileDialog from "./SidebarProfileDialog.svelte";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import GithubIcon from "@lucide/svelte/icons/git-pull-request";
  import PencilIcon from "@lucide/svelte/icons/pencil";

  let editOpen = $state(false);

  // Shortcut hints (the actions still fire from the global keybindings; these are
  // just discoverability cues in the menu).
  const settingsBinding = $derived(resolveBinding("openSettings"));
  const githubBinding = $derived(resolveBinding("openGitHub"));

  // Display fields with graceful fallbacks so the card always reads as intentional
  // (the user personalizes them from the Edit dialog).
  const displayName = $derived(
    app.sidebarProfile.name?.trim() || i18n.t("sidebarProfile.defaultName"),
  );
  const displayDesc = $derived(
    app.sidebarProfile.description?.trim() || i18n.t("sidebarProfile.defaultTagline"),
  );
  // Full name (+ description) as the hover title, so truncated text is recoverable.
  const titleText = $derived(displayDesc ? `${displayName} — ${displayDesc}` : displayName);
</script>

{#snippet avatarGlyph()}
  <UserRoundIcon class="size-5 text-muted-foreground" />
{/snippet}

<div class={cn("shrink-0 p-2", divider.top)}>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          title={titleText}
          class={cn(
            row.sidebar,
            focus.ring,
            "hover:bg-foreground/[0.055] data-[state=open]:bg-foreground/[0.055] dark:hover:bg-foreground/[0.065]",
          )}
        >
          <span
            class="relative flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border/60 bg-sidebar-foreground/[0.04]"
          >
            <EntityIcon value={app.sidebarProfile.icon} class="size-5" fallback={avatarGlyph} />
            {#if github.notifications > 0}
              <span
                class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar"
              ></span>
            {/if}
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class={cn("truncate text-sidebar-foreground", text.bodyStrong)}>
              {displayName}
            </span>
            {#if displayDesc}
              <span class={cn("truncate leading-4 text-muted-foreground", text.indicator)}>
                {displayDesc}
              </span>
            {/if}
          </span>
          <ChevronsUpDownIcon class={cn(icon.action, "shrink-0 text-muted-foreground/70")} />
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <!-- Opens to the right of the sidebar, bottom-aligned so it grows upward and
         never runs off the bottom of the window. -->
    <DropdownMenu.Content side="right" align="end" sideOffset={8} class="min-w-56">
      <!-- Identity header (mirrors the card, anchors the menu). -->
      <div class="flex items-center gap-2.5 px-2 py-1.5">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40"
        >
          <EntityIcon value={app.sidebarProfile.icon} class="size-5" fallback={avatarGlyph} />
        </span>
        <span class="flex min-w-0 flex-col">
          <span class={cn("truncate tracking-tight", text.bodyStrong)}>{displayName}</span>
          {#if displayDesc}
            <span class={cn("truncate leading-4 text-muted-foreground", text.indicator)}>
              {displayDesc}
            </span>
          {/if}
        </span>
      </div>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => app.openGitHub()}>
        <GithubIcon class={icon.button} />
        <span class="flex-1">{i18n.t("github.title")}</span>
        {#if github.notifications > 0}
          <span
            class="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
          >
            {github.notifications}
          </span>
        {:else if githubBinding}
          <KeyChord chord={githubBinding} />
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => app.openSettings()}>
        <SettingsIcon class={icon.button} />
        <span class="flex-1">{i18n.t("settings.title")}</span>
        {#if settingsBinding}
          <KeyChord chord={settingsBinding} />
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => (editOpen = true)}>
        <PencilIcon class={icon.button} />
        <span class="flex-1">{i18n.t("sidebarProfile.edit")}</span>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<SidebarProfileDialog bind:open={editOpen} />
