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
  import { AGENT_CATALOG, type CatalogAgent } from "$lib/agentCatalog";
  import { detectAgents } from "$lib/api";
  import TerminalProfileEditor from "./TerminalProfileEditor.svelte";
  import AgentProfileEditor from "./AgentProfileEditor.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import SlidersIcon from "@lucide/svelte/icons/sliders-horizontal";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";
  import LanguagesIcon from "@lucide/svelte/icons/languages";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

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

  // --- Agents ---------------------------------------------------------------
  // Which catalog commands are installed (null = not checked yet).
  let installed = $state<Set<string> | null>(null);
  async function detectInstalled() {
    try {
      const found = await detectAgents(AGENT_CATALOG.map((c) => c.command));
      installed = new Set(found);
    } catch {
      installed = new Set(); // backend unreachable (e.g. web preview)
    }
  }
  // Check installation the first time the Agents pane is opened.
  $effect(() => {
    if (app.settingsOpen && app.settingsSection === "agents" && installed === null) {
      void detectInstalled();
    }
  });

  const isInstalled = (c: CatalogAgent) => installed?.has(c.command) ?? false;
  const isConfigured = (c: CatalogAgent) =>
    app.agentProfiles.some((a) => a.command === c.command);

  function addCatalogAgent(c: CatalogAgent) {
    app.settings.agentProfiles.push({
      id: crypto.randomUUID(),
      name: c.name,
      command: c.command,
      args: [],
      terminalProfileId: null,
      icon: c.logo,
    });
    persistNow();
  }
  function addAllInstalled() {
    for (const c of AGENT_CATALOG) {
      if (isInstalled(c) && !isConfigured(c)) addCatalogAgent(c);
    }
  }
  function addCustomAgent() {
    app.settings.agentProfiles.push({
      id: crypto.randomUUID(),
      name: "",
      command: "",
      args: [],
      terminalProfileId: null,
      icon: null,
    });
    persistNow();
  }
  function removeAgent(id: string) {
    app.settings.agentProfiles = app.settings.agentProfiles.filter(
      (a) => a.id !== id,
    );
    persistNow();
  }
  // Installed catalog agents not yet configured (for the "Add all" button).
  const addableCount = $derived(
    AGENT_CATALOG.filter((c) => isInstalled(c) && !isConfigured(c)).length,
  );

  // Default agent (auto-launched on worktree create); "__none__" = off.
  const NO_DEFAULT_AGENT = "__none__";
  const defaultAgentLabel = $derived.by(() => {
    const id = app.settings.defaultAgentId;
    if (!id) return i18n.t("settings.defaultAgentNone");
    const a = app.agentProfiles.find((x) => x.id === id);
    return a?.name.trim() || a?.command || i18n.t("settings.defaultAgentNone");
  });

  // --- Terminal shells: detect which template commands are installed ---------
  const ALL_TEMPLATES = TERMINAL_TEMPLATES.flatMap((g) => g.templates);
  let shellsInstalled = $state<Set<string> | null>(null);
  async function detectShells() {
    try {
      const cmds = [...new Set(ALL_TEMPLATES.map((t) => t.command))];
      shellsInstalled = new Set(await detectAgents(cmds));
    } catch {
      shellsInstalled = new Set();
    }
  }
  $effect(() => {
    if (
      app.settingsOpen &&
      app.settingsSection === "terminal" &&
      shellsInstalled === null
    ) {
      void detectShells();
    }
  });
  const isShellInstalled = (t: TerminalTemplate) =>
    shellsInstalled?.has(t.command) ?? false;
  const shellConfigured = (t: TerminalTemplate) =>
    app.terminalProfiles.some(
      (p) => p.command === t.command && p.args.join(" ") === t.args.join(" "),
    );
  function addDetectedShells() {
    for (const t of ALL_TEMPLATES) {
      if (isShellInstalled(t) && !shellConfigured(t)) addFromTemplate(t);
    }
  }
  const addableShellCount = $derived(
    ALL_TEMPLATES.filter((t) => isShellInstalled(t) && !shellConfigured(t)).length,
  );

  const navItems = [
    { id: "general", key: "settings.general", icon: SlidersIcon },
    { id: "language", key: "settings.language", icon: LanguagesIcon },
    { id: "agents", key: "settings.agents", icon: BotIcon },
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
              app.settingsSection === item.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50",
            )}
            onclick={() => (app.settingsSection = item.id)}
          >
            <Icon class={icon.button} />
            {i18n.t(item.key)}
          </button>
        {/each}
      </nav>

      <!-- Section content -->
      <div class="uxnan-scroll max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-4">
        {#if app.settingsSection === "general"}
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
        {:else if app.settingsSection === "language"}
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
        {:else if app.settingsSection === "agents"}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.agents")}</span>
              <p class={text.meta}>{i18n.t("settings.agentsDesc")}</p>
            </div>

            <!-- Default agent: auto-launched when a worktree is created. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.defaultAgent")}</span>
              <Select.Root
                type="single"
                value={app.settings.defaultAgentId ?? NO_DEFAULT_AGENT}
                onValueChange={(v) => {
                  app.settings.defaultAgentId = v === NO_DEFAULT_AGENT ? null : (v ?? null);
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">{defaultAgentLabel}</Select.Trigger>
                <Select.Content>
                  <Select.Item value={NO_DEFAULT_AGENT} label={i18n.t("settings.defaultAgentNone")}>
                    {i18n.t("settings.defaultAgentNone")}
                  </Select.Item>
                  {#each app.launchableAgents as a (a.id)}
                    {@const label = a.name.trim() || a.command}
                    <Select.Item value={a.id} {label}>{label}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.defaultAgentDesc")}</p>
            </div>

            <!-- Agent idle notifications. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.agentNotifications")}</span>
              <Select.Root
                type="single"
                value={app.settings.agentNotifications === false ? "off" : "on"}
                onValueChange={(v) => {
                  app.settings.agentNotifications = v !== "off";
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">
                  {app.settings.agentNotifications === false ? i18n.t("common.off") : i18n.t("common.on")}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="on" label={i18n.t("common.on")}>{i18n.t("common.on")}</Select.Item>
                  <Select.Item value="off" label={i18n.t("common.off")}>{i18n.t("common.off")}</Select.Item>
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.agentNotificationsDesc")}</p>
            </div>

            <!-- Keep the system awake while an agent is working (opt-in). -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.preventSleep")}</span>
              <Select.Root
                type="single"
                value={app.settings.preventSleep === true ? "on" : "off"}
                onValueChange={(v) => {
                  app.settings.preventSleep = v === "on";
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">
                  {app.settings.preventSleep === true ? i18n.t("common.on") : i18n.t("common.off")}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="on" label={i18n.t("common.on")}>{i18n.t("common.on")}</Select.Item>
                  <Select.Item value="off" label={i18n.t("common.off")}>{i18n.t("common.off")}</Select.Item>
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.preventSleepDesc")}</p>
            </div>

            <!-- Catalog: every known agent; only the installed ones are addable. -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <span class={text.section}>{i18n.t("settings.agentsAvailable")}</span>
                {#if addableCount > 0}
                  <Button variant="outline" size="sm" onclick={addAllInstalled}>
                    <PlusIcon data-icon="inline-start" />
                    {i18n.t("settings.addAllInstalled")}
                  </Button>
                {/if}
              </div>
              {#if installed === null}
                <p class={text.meta}>{i18n.t("settings.detecting")}</p>
              {/if}
              <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {#each AGENT_CATALOG as c (c.id)}
                  {@const inst = isInstalled(c)}
                  {@const conf = isConfigured(c)}
                  <div
                    class={cn(
                      "flex items-center gap-2 rounded-md border border-border px-2 py-1.5",
                      !inst && "opacity-55",
                    )}
                  >
                    <AgentLogo logo={c.logo} class="size-4" />
                    <div class="min-w-0 flex-1">
                      <div class={cn("truncate", text.body)}>{c.name}</div>
                      <div class={cn("truncate font-mono", text.meta)}>{c.command}</div>
                    </div>
                    {#if conf}
                      <span class={cn("shrink-0", text.meta)}>{i18n.t("settings.agentAdded")}</span>
                    {:else if inst}
                      <Button
                        variant="ghost"
                        size="icon"
                        class={iconButton.action}
                        title={i18n.t("common.add")}
                        onclick={() => addCatalogAgent(c)}
                      >
                        <PlusIcon class={icon.button} />
                      </Button>
                    {:else}
                      <span class={cn("shrink-0", text.meta)}>{i18n.t("settings.agentNotFound")}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <!-- Configured agents -->
            <div class="flex items-center justify-between">
              <span class={text.section}>{i18n.t("settings.yourAgents")}</span>
              <Button variant="outline" size="sm" onclick={addCustomAgent}>
                <PlusIcon data-icon="inline-start" />
                {i18n.t("settings.addCustomAgent")}
              </Button>
            </div>
            <div class="flex flex-col gap-2">
              {#each app.agentProfiles as agent (agent.id)}
                <AgentProfileEditor
                  {agent}
                  onchange={schedulePersist}
                  onremove={() => removeAgent(agent.id)}
                />
              {:else}
                <p class={cn("text-muted-foreground", text.body)}>
                  {i18n.t("settings.noAgents")}
                </p>
              {/each}
            </div>
          </div>
        {:else}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.defaultProfile")}</span>
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
              <p class={text.meta}>{i18n.t("settings.defaultProfileDesc")}</p>
            </div>

            <div class="flex items-center justify-between gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.profiles")}</span>
              <div class="flex items-center gap-1.5">
                {#if addableShellCount > 0}
                  <Button variant="outline" size="sm" onclick={addDetectedShells}>
                    <PlusIcon data-icon="inline-start" />
                    {i18n.t("settings.addDetectedShells")}
                  </Button>
                {/if}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button variant="outline" size="sm" {...props}>
                        <PlusIcon data-icon="inline-start" />
                        {i18n.t("settings.addProfile")}
                        <ChevronDownIcon data-icon="inline-end" />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" class="min-w-52">
                    {#each TERMINAL_TEMPLATES as group (group.os)}
                      <DropdownMenu.Group>
                        <DropdownMenu.GroupHeading class={text.menuLabel}>
                          {group.os}
                        </DropdownMenu.GroupHeading>
                        {#each group.templates as t (t.name)}
                          {@const notFound = shellsInstalled !== null && !isShellInstalled(t)}
                          <DropdownMenu.Item
                            class={text.menu}
                            disabled={notFound}
                            onclick={() => addFromTemplate(t)}
                          >
                            <TerminalIcon class={icon.button} />
                            {t.name}
                            {#if notFound}
                              <span class={cn("ml-auto", text.meta)}>{i18n.t("settings.agentNotFound")}</span>
                            {/if}
                          </DropdownMenu.Item>
                        {/each}
                      </DropdownMenu.Group>
                    {/each}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item class={text.menu} onclick={addBlankProfile}>
                      <PlusIcon class={icon.button} />
                      {i18n.t("settings.blankProfile")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>
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
                  {i18n.t("settings.noProfiles")}
                </p>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
