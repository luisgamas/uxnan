<script lang="ts">
  // Settings as a full-screen view (replaces the three-panel body while open).
  // The title bar stays mounted at the window level so window controls always
  // work. The status bar is hidden in settings mode to give the content more
  // room. Close with the back button, the gear in the title bar, or Escape.

  import * as Select from "$lib/components/ui/select";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { app } from "$lib/state/app.svelte";
  import { i18n, LOCALES } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { AI_COMMIT_AGENTS } from "$lib/aiCommitPresets";
  import { aiCommitAgents, aiCommitModels } from "$lib/api";
  import type { AiCommitSettings, AgentModel } from "$lib/types";
  import {
    TERMINAL_TEMPLATES,
    type TerminalTemplate,
  } from "$lib/terminalTemplates";
  import { AGENT_CATALOG, type CatalogAgent } from "$lib/agentCatalog";
  import { detectAgents } from "$lib/api";
  import TerminalProfileEditor from "./TerminalProfileEditor.svelte";
  import AgentProfileEditor from "./AgentProfileEditor.svelte";
  import AiModelPicker from "./AiModelPicker.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentHooksPanel from "./AgentHooksPanel.svelte";
  import ThemeSettings from "./ThemeSettings.svelte";
  import {
    SHORTCUT_GROUPS,
    eventToChord,
    formatChord,
    resolveBinding,
  } from "$lib/keybindings";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";
  import LanguagesIcon from "@lucide/svelte/icons/languages";
  import KeyboardIcon from "@lucide/svelte/icons/keyboard";
  import WebhookIcon from "@lucide/svelte/icons/webhook";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import XIcon from "@lucide/svelte/icons/x";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";

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

  function close() {
    app.settingsOpen = false;
  }

  // --- Keyboard-shortcut rebinding ------------------------------------------
  // The action id being rebound (capturing the next chord), or null.
  let capturing = $state<string | null>(null);

  function setBinding(id: string, chord: string) {
    app.settings.keybindings = { ...(app.settings.keybindings ?? {}), [id]: chord };
    persistNow();
  }
  function resetBinding(id: string) {
    const { [id]: _drop, ...rest } = app.settings.keybindings ?? {};
    app.settings.keybindings = rest;
    persistNow();
  }

  // Escape closes the settings view (standard for full-screen panels). While
  // capturing a shortcut, keystrokes are consumed here instead (Escape cancels).
  // The global handler in `+page.svelte` bails whenever settings are open, so
  // app shortcuts never fire over this view.
  function onKeyDown(e: KeyboardEvent) {
    if (capturing) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        capturing = null;
        return;
      }
      const chord = eventToChord(e);
      if (chord) {
        setBinding(capturing, chord);
        capturing = null;
      }
      return;
    }
    if (e.key === "Escape" && app.settingsOpen) {
      e.preventDefault();
      close();
    }
  }

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

  // --- AI commit message ----------------------------------------------------
  // Settings persisted before this feature (or the web preview) may lack the
  // object; merge over a full default so reads/writes are always complete.
  const AI_DEFAULT: AiCommitSettings = {
    enabled: false,
    agentId: "",
    model: "",
    language: "auto",
    conventional: true,
    includeBody: true,
    instructions: "",
  };
  const ai = $derived<AiCommitSettings>({ ...AI_DEFAULT, ...app.settings.aiCommit });
  function setAi(patch: Partial<AiCommitSettings>) {
    app.settings.aiCommit = { ...AI_DEFAULT, ...app.settings.aiCommit, ...patch };
  }

  // Which supported agents are installed (null = not checked yet).
  let aiAgentsInstalled = $state<Set<string> | null>(null);
  async function detectAiAgents() {
    try {
      aiAgentsInstalled = new Set(await aiCommitAgents());
    } catch {
      aiAgentsInstalled = new Set();
    }
  }
  const aiAgentInstalled = (id: string) => aiAgentsInstalled?.has(id) ?? false;
  const aiAgentLabel = $derived(
    AI_COMMIT_AGENTS.find((a) => a.id === ai.agentId)?.name ||
      i18n.t("settings.aiCommitAgentNone"),
  );

  // Models for the selected agent (loaded on demand from its CLI).
  let aiModels = $state<AgentModel[]>([]);
  let aiModelsFor = $state(""); // the agent aiModels belongs to
  let aiModelsLoading = $state(false);
  async function loadAiModels(agentId: string) {
    if (!agentId) {
      aiModels = [];
      aiModelsFor = "";
      return;
    }
    aiModelsLoading = true;
    try {
      aiModels = await aiCommitModels(agentId);
    } catch {
      aiModels = [];
    } finally {
      aiModelsFor = agentId;
      aiModelsLoading = false;
    }
  }
  function selectAiAgent(id: string) {
    setAi({ agentId: id, model: "" }); // model ids are agent-specific
    persistNow();
    void loadAiModels(id);
  }
  // On opening the pane: detect installed agents, then load the current agent's
  // models once (the load stamps aiModelsFor, so this doesn't loop).
  $effect(() => {
    if (!(app.settingsOpen && app.settingsSection === "aicommit")) return;
    if (aiAgentsInstalled === null) void detectAiAgents();
    if (ai.agentId && aiModelsFor !== ai.agentId && !aiModelsLoading) {
      void loadAiModels(ai.agentId);
    }
  });

  // Language: "auto" + each app locale (stored as the English language name so
  // the backend prompt can name it verbatim, e.g. "Write the message in Spanish").
  const AI_LANGS = [
    { value: "auto", labelKey: "settings.aiCommitLanguageAuto" as MessageKey },
    { value: "English", labelKey: "settings.aiCommitLanguageEn" as MessageKey },
    { value: "Spanish", labelKey: "settings.aiCommitLanguageEs" as MessageKey },
  ];
  const aiLanguageLabel = $derived(
    i18n.t(AI_LANGS.find((l) => l.value === ai.language)?.labelKey ?? "settings.aiCommitLanguageAuto"),
  );

  const navItems = [
    { id: "appearance", key: "settings.appearance", icon: PaletteIcon },
    { id: "language", key: "settings.language", icon: LanguagesIcon },
    { id: "shortcuts", key: "settings.shortcuts", icon: KeyboardIcon },
    { id: "agents", key: "settings.agents", icon: BotIcon },
    { id: "aicommit", key: "settings.aiCommit", icon: SparklesIcon },
    { id: "hooks", key: "settings.hooks", icon: WebhookIcon },
    { id: "terminal", key: "settings.terminal", icon: TerminalIcon },
  ] as const;
</script>

<svelte:window onkeydown={onKeyDown} />

{#if app.settingsOpen}
  <div class="flex h-full w-full flex-col bg-background text-foreground">
    <!-- Header (draggable on Tauri via the title bar; the buttons inside are
         not part of the drag region). -->
    <header
      class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        class={iconButton.action}
        title={i18n.t("common.close")}
        aria-label={i18n.t("common.close")}
        onclick={close}
      >
        <ArrowLeftIcon class={icon.button} />
      </Button>
      <h1 class="text-sm font-semibold tracking-tight">
        {i18n.t("settings.title")}
      </h1>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Section nav (left sidebar) -->
      <nav
        class="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border p-2"
        aria-label={i18n.t("settings.title")}
      >
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

      <!-- Section content (centered column; text stays left-aligned). The extra
           bottom padding lets the last options scroll clear of the window edge. -->
      <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto p-6">
        <div class="mx-auto w-full max-w-2xl pb-16">
        {#if app.settingsSection === "appearance"}
          <ThemeSettings />
        {:else if app.settingsSection === "language"}
          <div class="flex flex-col gap-1.5">
            <span class={text.heading}>{i18n.t("settings.language")}</span>
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
        {:else if app.settingsSection === "shortcuts"}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <span class={text.heading}>{i18n.t("settings.shortcuts")}</span>
              <p class={text.meta}>{i18n.t("settings.shortcutsDesc")}</p>
            </div>
            {#each SHORTCUT_GROUPS as group (group.titleKey)}
              <div class="flex flex-col gap-1.5">
                <span class={text.section}>{i18n.t(group.titleKey)}</span>
                <div class="flex flex-col divide-y divide-border rounded-md border border-border">
                  {#each group.actions as action (action.id)}
                    {@const chord = resolveBinding(action.id)}
                    {@const isCapturing = capturing === action.id}
                    <div class="flex items-center gap-3 px-3 py-2">
                      <div class="min-w-0 flex-1">
                        <div class={text.body}>{i18n.t(action.labelKey)}</div>
                        <div class={cn("truncate", text.meta)}>{i18n.t(action.descKey)}</div>
                      </div>
                      <button
                        type="button"
                        class={cn(
                          "inline-flex h-7 min-w-24 shrink-0 items-center justify-center rounded-md border px-2 font-mono",
                          text.body,
                          isCapturing
                            ? "border-primary text-primary"
                            : "border-border hover:bg-accent/50",
                        )}
                        title={i18n.t("shortcuts.rebind")}
                        onclick={() => (capturing = isCapturing ? null : action.id)}
                      >
                        {#if isCapturing}
                          {i18n.t("shortcuts.press")}
                        {:else if chord}
                          {formatChord(chord)}
                        {:else}
                          <span class="text-muted-foreground">{i18n.t("shortcuts.disabled")}</span>
                        {/if}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class={iconButton.action}
                        disabled={chord === ""}
                        title={i18n.t("shortcuts.disable")}
                        onclick={() => setBinding(action.id, "")}
                      >
                        <XIcon class={icon.button} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class={iconButton.action}
                        disabled={chord === action.default}
                        title={i18n.t("shortcuts.reset")}
                        onclick={() => resetBinding(action.id)}
                      >
                        <RotateCcwIcon class={icon.button} />
                      </Button>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if app.settingsSection === "agents"}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <span class={text.heading}>{i18n.t("settings.agents")}</span>
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
        {:else if app.settingsSection === "aicommit"}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <span class={text.heading}>{i18n.t("settings.aiCommit")}</span>
              <p class={text.meta}>{i18n.t("settings.aiCommitDesc")}</p>
            </div>

            <!-- Master switch. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitEnabled")}</span>
              <Select.Root
                type="single"
                value={ai.enabled ? "on" : "off"}
                onValueChange={(v) => {
                  setAi({ enabled: v === "on" });
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">
                  {ai.enabled ? i18n.t("common.on") : i18n.t("common.off")}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="on" label={i18n.t("common.on")}>{i18n.t("common.on")}</Select.Item>
                  <Select.Item value="off" label={i18n.t("common.off")}>{i18n.t("common.off")}</Select.Item>
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.aiCommitEnabledDesc")}</p>
            </div>

            <!-- Agent: only the supported CLIs; not-installed ones are disabled. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitAgent")}</span>
              <Select.Root
                type="single"
                value={ai.agentId}
                onValueChange={(v) => v && selectAiAgent(v)}
              >
                <Select.Trigger class="w-56">
                  {#if ai.agentId}
                    <span class="flex items-center gap-2">
                      <AgentLogo
                        logo={AI_COMMIT_AGENTS.find((a) => a.id === ai.agentId)?.logo}
                        class="size-4"
                      />
                      {aiAgentLabel}
                    </span>
                  {:else}
                    {i18n.t("settings.aiCommitAgentNone")}
                  {/if}
                </Select.Trigger>
                <Select.Content>
                  {#each AI_COMMIT_AGENTS as a (a.id)}
                    {@const inst = aiAgentInstalled(a.id)}
                    <Select.Item value={a.id} label={a.name} disabled={!inst}>
                      <span class="flex items-center gap-2">
                        <AgentLogo logo={a.logo} class="size-4" />
                        {a.name}
                        {#if aiAgentsInstalled !== null && !inst}
                          <span class={cn("ml-auto", text.meta)}>{i18n.t("settings.agentNotFound")}</span>
                        {/if}
                      </span>
                    </Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              {#if aiAgentsInstalled !== null && aiAgentsInstalled.size === 0}
                <p class={text.meta}>{i18n.t("settings.aiCommitNoAgents")}</p>
              {:else}
                <p class={text.meta}>{i18n.t("settings.aiCommitAgentDesc")}</p>
              {/if}
            </div>

            <!-- Model: the CLI's default, plus whatever models it reports
                 (searchable + scrollable — some agents list hundreds). -->
            {#if ai.agentId && aiAgentInstalled(ai.agentId)}
              <div class="flex flex-col gap-1.5">
                <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitModel")}</span>
                <AiModelPicker
                  models={aiModels}
                  value={ai.model}
                  loading={aiModelsLoading}
                  onSelect={(id) => {
                    setAi({ model: id });
                    persistNow();
                  }}
                />
                <p class={text.meta}>{i18n.t("settings.aiCommitModelDesc")}</p>
              </div>
            {/if}

            <!-- Language. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitLanguage")}</span>
              <Select.Root
                type="single"
                value={ai.language}
                onValueChange={(v) => {
                  setAi({ language: v ?? "auto" });
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">{aiLanguageLabel}</Select.Trigger>
                <Select.Content>
                  {#each AI_LANGS as l (l.value)}
                    <Select.Item value={l.value} label={i18n.t(l.labelKey)}>
                      {i18n.t(l.labelKey)}
                    </Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.aiCommitLanguageDesc")}</p>
            </div>

            <!-- Conventional Commits subject. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitConventional")}</span>
              <Select.Root
                type="single"
                value={ai.conventional ? "on" : "off"}
                onValueChange={(v) => {
                  setAi({ conventional: v === "on" });
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">
                  {ai.conventional ? i18n.t("common.on") : i18n.t("common.off")}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="on" label={i18n.t("common.on")}>{i18n.t("common.on")}</Select.Item>
                  <Select.Item value="off" label={i18n.t("common.off")}>{i18n.t("common.off")}</Select.Item>
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.aiCommitConventionalDesc")}</p>
            </div>

            <!-- Extended body. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitBody")}</span>
              <Select.Root
                type="single"
                value={ai.includeBody ? "on" : "off"}
                onValueChange={(v) => {
                  setAi({ includeBody: v === "on" });
                  persistNow();
                }}
              >
                <Select.Trigger class="w-56">
                  {ai.includeBody ? i18n.t("common.on") : i18n.t("common.off")}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="on" label={i18n.t("common.on")}>{i18n.t("common.on")}</Select.Item>
                  <Select.Item value="off" label={i18n.t("common.off")}>{i18n.t("common.off")}</Select.Item>
                </Select.Content>
              </Select.Root>
              <p class={text.meta}>{i18n.t("settings.aiCommitBodyDesc")}</p>
            </div>

            <!-- Extra instructions. -->
            <div class="flex flex-col gap-1.5">
              <span class={cn("font-medium", text.body)}>{i18n.t("settings.aiCommitInstructions")}</span>
              <Textarea
                class="min-h-0 resize-none text-xs"
                rows={2}
                placeholder={i18n.t("settings.aiCommitInstructionsPlaceholder")}
                value={ai.instructions}
                oninput={(e) => setAi({ instructions: e.currentTarget.value })}
                onchange={persistNow}
              />
              <p class={text.meta}>{i18n.t("settings.aiCommitInstructionsDesc")}</p>
            </div>
          </div>
        {:else if app.settingsSection === "hooks"}
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <span class={text.heading}>{i18n.t("settings.hooks")}</span>
              <p class={text.meta}>{i18n.t("settings.hooksDesc")}</p>
            </div>
            <AgentHooksPanel />
          </div>
        {:else}
          <div class="flex flex-col gap-4">
            <span class={text.heading}>{i18n.t("settings.terminal")}</span>
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
    </div>
  </div>
{/if}
