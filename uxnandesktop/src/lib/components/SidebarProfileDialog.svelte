<script lang="ts">
  // Editor for the left-sidebar footer profile card: a configurable avatar
  // (reusing the shared IconPicker, same as project-card icons), a display name
  // and a short description line. The avatar is committed immediately by the
  // IconPicker; the name/description are committed on Save. Everything persists
  // into `AppSettings.profile` via `app.updateProfile`.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import UserRoundIcon from "@lucide/svelte/icons/user-round";
  import PencilIcon from "@lucide/svelte/icons/pencil";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let name = $state("");
  let description = $state("");
  let iconPickerOpen = $state(false);

  // Seed the editable fields from the persisted profile each time it opens.
  $effect(() => {
    if (!open) return;
    name = app.sidebarProfile.name ?? "";
    description = app.sidebarProfile.description ?? "";
  });

  function save() {
    app.updateSidebarProfile({ name: name.trim(), description: description.trim() });
    open = false;
  }
</script>

{#snippet avatarGlyph()}
  <UserRoundIcon class="size-6 text-muted-foreground" />
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("sidebarProfile.editTitle")}</Dialog.Title>
      <Dialog.Description>{i18n.t("sidebarProfile.editDesc")}</Dialog.Description>
    </Dialog.Header>

    <div class="flex min-w-0 flex-col gap-5 py-1">
      <!-- Identity: avatar (click to change) + display name. -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="group relative flex size-12 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 transition-colors hover:border-border hover:bg-muted"
          title={i18n.t("sidebarProfile.changeIcon")}
          aria-label={i18n.t("sidebarProfile.changeIcon")}
          onclick={() => (iconPickerOpen = true)}
        >
          <EntityIcon value={app.sidebarProfile.icon} class="size-6" fallback={avatarGlyph} />
          <span
            class="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs group-hover:text-foreground"
          >
            <PencilIcon class="size-3" />
          </span>
        </button>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <label for="profile-name" class={cn("font-medium", text.body)}>
            {i18n.t("sidebarProfile.name")}
          </label>
          <Input
            id="profile-name"
            bind:value={name}
            placeholder={i18n.t("sidebarProfile.namePlaceholder")}
            autocomplete="off"
            onkeydown={(e) => e.key === "Enter" && save()}
          />
        </div>
      </div>

      <!-- Description (the line under the name). -->
      <div class="flex flex-col gap-1.5">
        <label for="profile-desc" class={cn("font-medium", text.body)}>
          {i18n.t("sidebarProfile.description")}
        </label>
        <Input
          id="profile-desc"
          bind:value={description}
          placeholder={i18n.t("sidebarProfile.descriptionPlaceholder")}
          autocomplete="off"
          onkeydown={(e) => e.key === "Enter" && save()}
        />
        <p class={text.meta}>{i18n.t("sidebarProfile.descriptionHint")}</p>
      </div>
    </div>

    <Dialog.Footer>
      <Button onclick={save}>{i18n.t("common.save")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("sidebarProfile.iconTitle")}
  current={app.sidebarProfile.icon}
  fallback={avatarGlyph}
  onselect={(value) => app.updateSidebarProfile({ icon: value })}
/>
