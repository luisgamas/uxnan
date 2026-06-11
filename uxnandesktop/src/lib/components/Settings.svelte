<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { app } from "$lib/state/app.svelte";
  import { i18n, LOCALES } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import type { Theme } from "$lib/types";
  import {
    TERMINAL_TEMPLATES,
    type TerminalTemplate,
  } from "$lib/terminalTemplates";
  import TerminalProfileEditor from "./TerminalProfileEditor.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import SlidersIcon from "@lucide/svelte/icons/sliders-horizontal";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import LanguagesIcon from "@lucide/svelte/icons/languages";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

  type Section = "general" | "language" | "terminal";
  let section = $state<Section>("general");

  // Persist (debounced for typing; immediate for discrete actions).
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void app.persistSettings(), 400);
  }
  function persistNow() {
    clearTimeout(saveTimer);
    void app.persistSettings();
  }

  const themes: { value: Theme; key: MessageKey }[] = [
    { value: "system", key: "settings.theme.system" },
    { value: "light", key: "settings.theme.light" },
    { value: "dark", key: "settings.theme.dark" },
  ];
  const themeLabel = $derived(
    i18n.t(
      themes.find((t) => t.value === app.settings.theme)?.key ??
        "settings.theme.system",
    ),
  );

  // Language: "system" + each available locale.
  const languageLabel = $derived.by(() => {
    if (app.settings.language === "system")
      return i18n.t("settings.language.system");
    return (
      LOCALES.find((l) => l.code === app.settings.language)?.name ??
      i18n.t("settings.language.system")
    );
  });

  const defaultProfileLabel = $derived.by(() => {
    const p = app.terminalProfiles.find(
      (x) => x.id === app.settings.defaultProfileId,
    );
    if (!p) return i18n.t("terminal.unnamedProfile");
    return p.name.trim() || i18n.t("terminal.unnamedProfile");
  });

  function addBlankProfile() {
    app.settings.terminalProfiles.push({
      id: crypto.randomUUID(),
      name: "",
      command: "",
      args: [],
    });
    persistNow();
  }
  function addFromTemplate(t: TerminalTemplate) {
    app.settings.terminalProfiles.push({
      id: crypto.randomUUID(),
      name: t.name,
      command: t.command,
      args: [...t.args],
    });
    persistNow();
  }
  function removeProfile(id: string) {
    app.settings.terminalProfiles = app.settings.terminalProfiles.filter(
      (p) => p.id !== id,
    );
    if (app.settings.defaultProfileId === id) {
      app.settings.defaultProfileId = app.settings.terminalProfiles[0]?.id ?? null;
    }
    persistNow();
  }

  const navItems = [
    { id: "general", key: "settings.general", icon: SlidersIcon },
    { id: "language", key: "settings.language", icon: LanguagesIcon },
    { id: "terminal", key: "settings.terminal", icon: TerminalIcon },
  ] as const;
</script>

<Dialog.Root bind:open={app.settingsOpen}>
  <Dialog.Content class="gap-0 p-0 sm:max-w-[660px]">
    <Dialog.Header class="border-b border-border px-4 py-3">
      <Dialog.Title>{i18n.t("settings.title")}</Dialog.Title>
    </Dialog.Header>

    <div class="flex min-h-[360px]">
      <!-- Section nav -->
      <nav class="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        {#each navItems as item (item.id)}
          {@const Icon = item.icon}
          <button
            class={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium",
              text.body,
              section === item.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
            onclick={() => (section = item.id)}
          >
            <Icon class={icon.button} />
            {i18n.t(item.key)}
          </button>
        {/each}
      </nav>

      <!-- Section content -->
      <div class="uxnan-scroll max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-4">
        {#if section === "general"}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.theme")}</span>
              <Select.Root
                type="single"
                value={app.settings.theme}
                onValueChange={(v) => {
                  app.settings.theme = v as Theme;
                  persistNow();
                }}
              >
                <Select.Trigger class="w-48">{themeLabel}</Select.Trigger>
                <Select.Content>
                  {#each themes as t (t.value)}
                    {@const label = i18n.t(t.key)}
                    <Select.Item value={t.value} {label}>{label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
        {:else if section === "language"}
          <div class="flex flex-col gap-1.5">
            <span class={cn("font-medium", text.body)}>{i18n.t("settings.language")}</span>
            <Select.Root
              type="single"
              value={app.settings.language}
              onValueChange={(v) => {
                app.settings.language = v ?? "system";
                persistNow();
              }}
            >
              <Select.Trigger class="w-56">{languageLabel}</Select.Trigger>
              <Select.Content>
                <Select.Item value="system" label={i18n.t("settings.language.system")}>
                  {i18n.t("settings.language.system")}
                </Select.Item>
                {#each LOCALES as locale (locale.code)}
                  <Select.Item value={locale.code} label={locale.name}>
                    {locale.name}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <p class={text.meta}>{i18n.t("settings.language.desc")}</p>
          </div>
        {:else}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>Default profile</span>
              <Select.Root
                type="single"
                value={app.settings.defaultProfileId ?? undefined}
                onValueChange={(v) => {
                  app.settings.defaultProfileId = v ?? null;
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">{defaultProfileLabel}</Select.Trigger>
                <Select.Content>
                  {#each app.terminalProfiles as p (p.id)}
                    {@const label = p.name.trim() || i18n.t("terminal.unnamedProfile")}
                    <Select.Item value={p.id} {label}>{label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>
                Used for new terminals unless you pick another from the "+" menu.
              </p>
            </div>

            <div class="flex items-center justify-between">
              <span class={cn("font-medium", text.body)}>Profiles</span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <Button variant="outline" size="sm" {...props}>
                      <PlusIcon data-icon="inline-start" />
                      Add profile
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  {/snippet}
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="min-w-48">
                  {#each TERMINAL_TEMPLATES as group (group.os)}
                    <DropdownMenu.Group>
                      <DropdownMenu.GroupHeading class={text.menuLabel}>
                        {group.os}
                      </DropdownMenu.GroupHeading>
                      {#each group.templates as t (t.name)}
                        <DropdownMenu.Item
                          class={text.menu}
                          onclick={() => addFromTemplate(t)}
                        >
                          <TerminalIcon class={icon.button} />
                          {t.name}
                        </DropdownMenu.Item>
                      {/each}
                    </DropdownMenu.Group>
                  {/each}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item class={text.menu} onclick={addBlankProfile}>
                    <PlusIcon class={icon.button} />
                    Blank profile
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>

            <div class="flex flex-col gap-2">
              {#each app.terminalProfiles as profile (profile.id)}
                <TerminalProfileEditor
                  {profile}
                  onchange={schedulePersist}
                  onremove={() => removeProfile(profile.id)}
                />
              {:else}
                <p class={cn("text-muted-foreground", text.body)}>
                  No profiles. Add one to choose how terminals are launched.
                </p>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
