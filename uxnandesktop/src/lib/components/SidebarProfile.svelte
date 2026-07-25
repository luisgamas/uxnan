<script lang="ts">
  // Left-sidebar footer: a configurable profile card (avatar + name + a line of
  // text), shadcn-sidebar-footer style. Clicking it opens a menu with Settings
  // plus an "Edit profile" entry. The avatar/name/description live in
  // `AppSettings.profile` and are edited via SidebarProfileDialog.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { icon, text, divider, row, focus } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { resolveBinding } from "$lib/keybindings";
  import KeyChord from "./KeyChord.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import SidebarProfileDialog from "./SidebarProfileDialog.svelte";
  import { pets } from "$lib/state/pets.svelte";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import PawPrintIcon from "@lucide/svelte/icons/paw-print";
  import CheckIcon from "@lucide/svelte/icons/check";

  let editOpen = $state(false);

  // Pet companion: the quick on/off lives here (the full options are in
  // Settings → Pets). Turning it on loads the library on demand, so a user who
  // never enables pets never pays for them.
  const petsOn = $derived(app.petSettings.enabled === true);

  function togglePets(): void {
    const enabled = !petsOn;
    app.updatePets({ enabled });
    if (enabled && !pets.loaded) void pets.load();
  }

  function choosePet(id: string): void {
    app.updatePets({ activePetId: id, enabled: true });
  }

  // Shortcut hint (the action still fires from the global keybindings; this is
  // just a discoverability cue in the menu).
  const settingsBinding = $derived(resolveBinding("openSettings"));

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
      <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => app.openSettings()}>
        <SettingsIcon class={icon.button} />
        <span class="flex-1">{i18n.t("settings.title")}</span>
        {#if settingsBinding}
          <KeyChord chord={settingsBinding} />
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <!-- Pet companion: a quick on/off, plus a picker once more than one pet is
           installed. Everything else lives in Settings → Pets. -->
      <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={togglePets}>
        <PawPrintIcon class={icon.button} />
        <span class="flex-1">{i18n.t(petsOn ? "pets.hide" : "pets.show")}</span>
      </DropdownMenu.Item>
      {#if petsOn && pets.library.length > 1}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger class={cn(text.menu, "gap-2")}>
            <PawPrintIcon class={cn(icon.button, "opacity-0")} />
            <span class="flex-1">{i18n.t("pets.choose")}</span>
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent class="max-h-72 min-w-48 overflow-y-auto">
            {#each pets.library as p (p.id)}
              <DropdownMenu.Item
                class={cn(text.menu, "gap-2")}
                onclick={() => choosePet(p.id)}
              >
                <CheckIcon
                  class={cn(icon.button, pets.active?.id === p.id ? "" : "opacity-0")}
                />
                <span class="flex-1 truncate">{p.displayName}</span>
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      {/if}
      <DropdownMenu.Separator />
      <DropdownMenu.Item class={cn(text.menu, "gap-2")} onclick={() => (editOpen = true)}>
        <PencilIcon class={icon.button} />
        <span class="flex-1">{i18n.t("sidebarProfile.edit")}</span>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<SidebarProfileDialog bind:open={editOpen} />
