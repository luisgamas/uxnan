<script lang="ts">
  // Settings as a full-screen view (replaces the three-panel body while open).
  // The title bar stays mounted at the window level so window controls always
  // work. The status bar is hidden in settings mode to give the content more
  // room. Close with the back button, the gear in the title bar, or Escape.

  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
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
  import { AGENT_CATALOG, agentLogoKey, type CatalogAgent } from "$lib/agentCatalog";
  import { detectAgents } from "$lib/api";
  import { updater } from "$lib/state/updater.svelte";
  import { appVersion } from "$lib/api";
  import type {
    UpdaterSettings,
    UpdateChannel,
    InstallPolicy,
    BrowserSettings,
    BrowserLinkPolicy,
  } from "$lib/types";
  import TerminalProfileEditor from "./TerminalProfileEditor.svelte";
  import AgentProfileEditor from "./AgentProfileEditor.svelte";
  import AiModelPicker from "./AiModelPicker.svelte";
  import Combobox, { type ComboGroup, type ComboItem } from "./Combobox.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import AgentHooksPanel from "./AgentHooksPanel.svelte";
  import ThemeSettings from "./ThemeSettings.svelte";
  import SettingsSection from "./SettingsSection.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import {
    SHORTCUT_GROUPS,
    eventToChord,
    formatChord,
    resolveBinding,
  } from "$lib/keybindings";
  import { cn } from "$lib/utils";
  import { divider, icon, iconButton, text } from "$lib/design";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";
  import LanguagesIcon from "@lucide/svelte/icons/languages";
  import KeyboardIcon from "@lucide/svelte/icons/keyboard";
  import WebhookIcon from "@lucide/svelte/icons/webhook";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import XIcon from "@lucide/svelte/icons/x";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import GlobeIcon from "@lucide/svelte/icons/globe";

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
  // Default shell agents launch in (when an agent doesn't pin its own). The
  // "smart default" sentinel = cmd.exe on Windows, else the default terminal.
  const AGENT_SHELL_DEFAULT = "__smart__";

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

  // --- Updates --------------------------------------------------------------
  // Merge over a full default so reads/writes are always complete (state saved
  // before this feature, or the web preview, may lack the object).
  const UPDATER_DEFAULT: UpdaterSettings = {
    autoCheck: true,
    channel: "stable",
    autoDownload: true,
    installPolicy: "ask",
  };
  const up = $derived<UpdaterSettings>({
    ...UPDATER_DEFAULT,
    ...app.settings.updater,
  });
  function setUp(patch: Partial<UpdaterSettings>) {
    app.settings.updater = { ...UPDATER_DEFAULT, ...app.settings.updater, ...patch };
  }

  const UPDATE_CHANNELS: { value: UpdateChannel; labelKey: MessageKey; descKey: MessageKey }[] = [
    { value: "stable", labelKey: "updates.channelStable", descKey: "updates.channelStableDesc" },
    { value: "nightly", labelKey: "updates.channelNightly", descKey: "updates.channelNightlyDesc" },
  ];
  const INSTALL_POLICIES: { value: InstallPolicy; labelKey: MessageKey }[] = [
    { value: "ask", labelKey: "updates.policyAsk" },
    { value: "whenIdle", labelKey: "updates.policyWhenIdle" },
    { value: "manual", labelKey: "updates.policyManual" },
  ];
  // The running app's full version name (shown in the Updates pane). This is the
  // complete release name (e.g. 0.0.5-alpha.20260628), not the numeric MSI base.
  let currentVersion = $state("");
  $effect(() => {
    if (app.settingsOpen && app.settingsSection === "updates" && !currentVersion) {
      appVersion().then((v) => (currentVersion = v)).catch(() => {});
    }
  });
  const lastCheckedLabel = $derived(
    updater.lastChecked
      ? new Date(updater.lastChecked).toLocaleString()
      : i18n.t("updates.neverChecked"),
  );

  // --- Integrated browser ---------------------------------------------------
  // Merge over a full default so reads/writes are always complete (state saved
  // before this feature, or the web preview, may lack the object).
  const BROWSER_DEFAULT: BrowserSettings = {
    enabled: true,
    linkPolicy: "internal",
    allowAgents: true,
    terminalLinks: true,
    homepage: "",
  };
  const br = $derived<BrowserSettings>({
    ...BROWSER_DEFAULT,
    ...app.settings.browser,
  });
  function setBr(patch: Partial<BrowserSettings>) {
    app.settings.browser = { ...BROWSER_DEFAULT, ...app.settings.browser, ...patch };
  }
  const LINK_POLICIES: { value: BrowserLinkPolicy; labelKey: MessageKey; descKey: MessageKey }[] = [
    { value: "internal", labelKey: "browser.policyInternal", descKey: "browser.policyInternalDesc" },
    { value: "external", labelKey: "browser.policyExternal", descKey: "browser.policyExternalDesc" },
    { value: "ask", labelKey: "browser.policyAsk", descKey: "browser.policyAskDesc" },
  ];

  // Option groups for the unified `Combobox` selectors (one searchable design for
  // every single-select field). Agent fields carry a logo via the combobox's
  // `itemPrefix`, resolved from the value.
  const languageGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: "system", label: i18n.t("settings.language.system") },
        ...LOCALES.map((l) => ({ value: l.code, label: l.name })),
      ],
    },
  ]);
  const defaultAgentGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: NO_DEFAULT_AGENT, label: i18n.t("settings.defaultAgentNone") },
        ...app.launchableAgents.map((a) => ({
          value: a.id,
          label: a.name.trim() || a.command,
          keywords: [a.command],
        })),
      ],
    },
  ]);
  const agentShellGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: AGENT_SHELL_DEFAULT, label: i18n.t("settings.agentShellSmart") },
        ...app.terminalProfiles.map((p) => ({
          value: p.id,
          label: p.name.trim() || i18n.t("terminal.unnamedProfile"),
        })),
      ],
    },
  ]);
  const aiAgentGroups = $derived<ComboGroup[]>([
    {
      items: AI_COMMIT_AGENTS.map((a) => ({
        value: a.id,
        label: a.name,
        disabled: !aiAgentInstalled(a.id),
        meta:
          aiAgentsInstalled !== null && !aiAgentInstalled(a.id)
            ? i18n.t("settings.agentNotFound")
            : undefined,
      })),
    },
  ]);
  const aiLanguageGroups = $derived<ComboGroup[]>([
    { items: AI_LANGS.map((l) => ({ value: l.value, label: i18n.t(l.labelKey) })) },
  ]);
  const channelGroups = $derived<ComboGroup[]>([
    { items: UPDATE_CHANNELS.map((c) => ({ value: c.value, label: i18n.t(c.labelKey) })) },
  ]);
  const installPolicyGroups = $derived<ComboGroup[]>([
    { items: INSTALL_POLICIES.map((p) => ({ value: p.value, label: i18n.t(p.labelKey) })) },
  ]);
  const linkPolicyGroups = $derived<ComboGroup[]>([
    { items: LINK_POLICIES.map((p) => ({ value: p.value, label: i18n.t(p.labelKey) })) },
  ]);
  const profileGroups = $derived<ComboGroup[]>([
    {
      items: app.terminalProfiles.map((p) => ({
        value: p.id,
        label: p.name.trim() || i18n.t("terminal.unnamedProfile"),
      })),
    },
  ]);

  // Grouped section nav — titled groups (like the center "+" launcher) so a long
  // flat list reads as organized areas, while each item keeps the settings-nav
  // row recipe. Group headings use the shared `text.section` token for coherence
  // with the home left sidebar's section headers.
  const navGroups = [
    {
      titleKey: "settings.groupGeneral",
      items: [
        { id: "appearance", key: "settings.appearance", icon: PaletteIcon },
        { id: "language", key: "settings.language", icon: LanguagesIcon },
        { id: "shortcuts", key: "settings.shortcuts", icon: KeyboardIcon },
      ],
    },
    {
      titleKey: "settings.groupAgents",
      items: [
        { id: "agents", key: "settings.agents", icon: BotIcon },
        { id: "aicommit", key: "settings.aiCommit", icon: SparklesIcon },
        { id: "hooks", key: "settings.hooks", icon: WebhookIcon },
      ],
    },
    {
      titleKey: "settings.groupWorkspace",
      items: [
        { id: "terminal", key: "settings.terminal", icon: TerminalIcon },
        { id: "browser", key: "settings.browser", icon: GlobeIcon },
      ],
    },
    {
      titleKey: "settings.groupApp",
      items: [{ id: "updates", key: "settings.updates", icon: DownloadIcon }],
    },
  ] as const;
</script>

<svelte:window onkeydown={onKeyDown} />

{#if app.settingsOpen}
  <div class="flex h-full w-full flex-col bg-background text-foreground">
    <!-- Header (draggable on Tauri via the title bar; the buttons inside are
         not part of the drag region). -->
    <header
      data-tauri-drag-region
      class={cn("flex h-9 shrink-0 items-center gap-2 px-3", divider.bottom)}
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
      <!-- Section nav (left sidebar): titled groups + settings-nav rows. -->
      <nav
        class="scrollbar-sleek flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/60 p-2"
        aria-label={i18n.t("settings.title")}
      >
        {#each navGroups as group (group.titleKey)}
          <div class="flex flex-col gap-0.5">
            <span class={cn("px-2 pb-0.5", text.section)}>{i18n.t(group.titleKey)}</span>
            {#each group.items as item (item.id)}
              {@const Icon = item.icon}
              <button
                class={cn(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight transition-colors",
                  app.settingsSection === item.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                onclick={() => (app.settingsSection = item.id)}
              >
                <Icon class={icon.button} />
                {i18n.t(item.key)}
              </button>
            {/each}
          </div>
        {/each}
      </nav>

      <!-- Section content (centered column; text stays left-aligned). The extra
           bottom padding lets the last options scroll clear of the window edge. -->
      <!-- Each section uses the clean-desktop pattern: a `SettingsSection` header
           (title + description over a divider), with a soft `panel.settingsBody`
           band of `SettingsRow`s for settings-style sections, or `bare` (header
           only) for sections whose body is a self-contained list/editor (agents
           catalog, hooks, shortcuts, terminal profiles) to avoid card-in-card.
           The right control per setting: a Switch for on/off, a Select only for
           3+ choices; borders only where they divide. -->
      <div class="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-8 py-7">
        <div class="mx-auto w-full max-w-3xl pb-16">
        {#if app.settingsSection === "appearance"}
          <ThemeSettings />
        {:else if app.settingsSection === "language"}
          <SettingsSection
            title={i18n.t("settings.language")}
            description={i18n.t("settings.language.desc")}
          >
            <SettingsRow label={i18n.t("settings.language")}>
              {#snippet control()}
                <Combobox
                  value={app.settings.language}
                  groups={languageGroups}
                  triggerClass="w-56"
                  searchPlaceholder={i18n.t("common.search")}
                  onChange={(v) => { app.settings.language = v; persistNow(); }}
                />
              {/snippet}
            </SettingsRow>
          </SettingsSection>
        {:else if app.settingsSection === "shortcuts"}
          <SettingsSection bare title={i18n.t("settings.shortcuts")} description={i18n.t("settings.shortcutsDesc")}>
            <div class="space-y-6">
            {#each SHORTCUT_GROUPS as group (group.titleKey)}
              <div class="space-y-2">
                <span class={cn("px-1", text.section)}>{i18n.t(group.titleKey)}</span>
                <div class="divide-y divide-border/60 rounded-xl border border-border/50 bg-card/50 px-5 shadow-xs">
                  {#each group.actions as action (action.id)}
                    {@const chord = resolveBinding(action.id)}
                    {@const isCapturing = capturing === action.id}
                    <div class="flex items-center gap-3 py-3">
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
          </SettingsSection>
        {:else if app.settingsSection === "agents"}
          <div class="flex flex-col gap-6">
            <SettingsSection title={i18n.t("settings.agents")} description={i18n.t("settings.agentsDesc")}>
              <div class="divide-y divide-border/60">
                <SettingsRow label={i18n.t("settings.defaultAgent")} description={i18n.t("settings.defaultAgentDesc")}>
                  {#snippet control()}
                    <Combobox
                      value={app.settings.defaultAgentId ?? NO_DEFAULT_AGENT}
                      groups={defaultAgentGroups}
                      triggerClass="w-56"
                      searchPlaceholder={i18n.t("common.search")}
                      itemPrefix={agentPrefix}
                      onChange={(v) => {
                        app.settings.defaultAgentId = v === NO_DEFAULT_AGENT ? null : v;
                        persistNow();
                      }}
                    />
                  {/snippet}
                </SettingsRow>

                <SettingsRow label={i18n.t("settings.agentShell")} description={i18n.t("settings.agentShellDesc")}>
                  {#snippet control()}
                    <Combobox
                      value={app.settings.agentShellProfileId ?? AGENT_SHELL_DEFAULT}
                      groups={agentShellGroups}
                      triggerClass="w-72 max-w-full"
                      searchPlaceholder={i18n.t("common.search")}
                      onChange={(v) => {
                        app.settings.agentShellProfileId = v === AGENT_SHELL_DEFAULT ? null : v;
                        persistNow();
                      }}
                    />
                  {/snippet}
                </SettingsRow>

                <SettingsRow label={i18n.t("settings.agentNotifications")} description={i18n.t("settings.agentNotificationsDesc")}>
                  {#snippet control()}
                    <Switch
                      checked={app.settings.agentNotifications !== false}
                      onCheckedChange={(c) => { app.settings.agentNotifications = c; persistNow(); }}
                    />
                  {/snippet}
                </SettingsRow>

                <SettingsRow label={i18n.t("settings.preventSleep")} description={i18n.t("settings.preventSleepDesc")}>
                  {#snippet control()}
                    <Switch
                      checked={app.settings.preventSleep === true}
                      onCheckedChange={(c) => { app.settings.preventSleep = c; persistNow(); }}
                    />
                  {/snippet}
                </SettingsRow>
              </div>
            </SettingsSection>

            <!-- One agents list: configured agents first (each row expands to its
                 command / args / shell / env config), then the remaining known
                 agents to add — greyed when not found on PATH. -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2">
                <span class={text.section}>{i18n.t("settings.yourAgents")}</span>
                <div class="flex items-center gap-1.5">
                  {#if addableCount > 0}
                    <Button variant="outline" size="sm" onclick={addAllInstalled}>
                      <PlusIcon data-icon="inline-start" />
                      {i18n.t("settings.addAllInstalled")}
                    </Button>
                  {/if}
                  <Button variant="outline" size="sm" onclick={addCustomAgent}>
                    <PlusIcon data-icon="inline-start" />
                    {i18n.t("settings.addCustomAgent")}
                  </Button>
                </div>
              </div>
              {#if installed === null}
                <p class={text.meta}>{i18n.t("settings.detecting")}</p>
              {/if}
              <div class="flex flex-col divide-y divide-border/60 rounded-xl border border-border/50 bg-card/50 px-5 shadow-xs">
                {#each app.agentProfiles as agent (agent.id)}
                  <AgentProfileEditor
                    {agent}
                    onchange={schedulePersist}
                    onremove={() => removeAgent(agent.id)}
                  />
                {/each}
                {#each AGENT_CATALOG.filter((c) => !isConfigured(c)) as c (c.id)}
                  {@const inst = isInstalled(c)}
                  <div class={cn("flex items-center gap-2.5 py-2.5", !inst && "opacity-55")}>
                    <span class="flex size-7 shrink-0 items-center justify-center">
                      <AgentLogo logo={c.logo} class="size-5" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class={cn("truncate font-medium text-foreground", text.body)}>{c.name}</div>
                      <div class="truncate font-mono text-[11px] leading-4 text-muted-foreground">{c.command}</div>
                    </div>
                    {#if inst}
                      <Button variant="ghost" size="sm" class="h-7 shrink-0 gap-1" onclick={() => addCatalogAgent(c)}>
                        <PlusIcon class={icon.button} />
                        {i18n.t("common.add")}
                      </Button>
                    {:else}
                      <span class={cn("shrink-0", text.meta)}>{i18n.t("settings.agentNotFound")}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

          </div>
        {:else if app.settingsSection === "aicommit"}
          <SettingsSection title={i18n.t("settings.aiCommit")} description={i18n.t("settings.aiCommitDesc")}>
            <div class="divide-y divide-border/60">
              <SettingsRow label={i18n.t("settings.aiCommitEnabled")} description={i18n.t("settings.aiCommitEnabledDesc")}>
                {#snippet control()}
                  <Switch
                    checked={ai.enabled}
                    onCheckedChange={(c) => { setAi({ enabled: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow
                label={i18n.t("settings.aiCommitAgent")}
                description={aiAgentsInstalled !== null && aiAgentsInstalled.size === 0
                  ? i18n.t("settings.aiCommitNoAgents")
                  : i18n.t("settings.aiCommitAgentDesc")}
              >
                {#snippet control()}
                  <Combobox
                    value={ai.agentId}
                    groups={aiAgentGroups}
                    placeholder={i18n.t("settings.aiCommitAgentNone")}
                    searchPlaceholder={i18n.t("common.search")}
                    triggerClass="w-56"
                    itemPrefix={aiAgentPrefix}
                    onChange={(v) => selectAiAgent(v)}
                  />
                {/snippet}
              </SettingsRow>

              {#if ai.agentId && aiAgentInstalled(ai.agentId)}
                <SettingsRow label={i18n.t("settings.aiCommitModel")} description={i18n.t("settings.aiCommitModelDesc")}>
                  {#snippet control()}
                    <AiModelPicker
                      models={aiModels}
                      value={ai.model}
                      loading={aiModelsLoading}
                      onSelect={(id) => { setAi({ model: id }); persistNow(); }}
                    />
                  {/snippet}
                </SettingsRow>
              {/if}

              <SettingsRow label={i18n.t("settings.aiCommitLanguage")} description={i18n.t("settings.aiCommitLanguageDesc")}>
                {#snippet control()}
                  <Combobox
                    value={ai.language}
                    groups={aiLanguageGroups}
                    triggerClass="w-56"
                    searchPlaceholder={i18n.t("common.search")}
                    onChange={(v) => { setAi({ language: v }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("settings.aiCommitConventional")} description={i18n.t("settings.aiCommitConventionalDesc")}>
                {#snippet control()}
                  <Switch
                    checked={ai.conventional}
                    onCheckedChange={(c) => { setAi({ conventional: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("settings.aiCommitBody")} description={i18n.t("settings.aiCommitBodyDesc")}>
                {#snippet control()}
                  <Switch
                    checked={ai.includeBody}
                    onCheckedChange={(c) => { setAi({ includeBody: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("settings.aiCommitInstructions")} description={i18n.t("settings.aiCommitInstructionsDesc")}>
                {#snippet children()}
                  <Textarea
                    class="mt-1 min-h-0 resize-none text-xs"
                    rows={2}
                    placeholder={i18n.t("settings.aiCommitInstructionsPlaceholder")}
                    value={ai.instructions}
                    oninput={(e) => setAi({ instructions: e.currentTarget.value })}
                    onchange={persistNow}
                  />
                {/snippet}
              </SettingsRow>
            </div>
          </SettingsSection>
        {:else if app.settingsSection === "hooks"}
          <SettingsSection bare title={i18n.t("settings.hooks")} description={i18n.t("settings.hooksDesc")}>
            <AgentHooksPanel />
          </SettingsSection>
        {:else if app.settingsSection === "updates"}
          <SettingsSection title={i18n.t("settings.updates")} description={i18n.t("settings.updatesDesc")}>
            <div class="divide-y divide-border/60">
              <!-- Current version + manual check (a plain row, not a boxed card). -->
              <div class="flex items-center justify-between gap-3 py-3.5 first:pt-0">
                <div class="min-w-0 space-y-0.5">
                  <div class={cn("font-medium text-foreground", text.body)}>
                    {i18n.t("updates.currentVersion", { version: currentVersion || "—" })}
                  </div>
                  <p class="text-[12px] leading-5 text-muted-foreground">
                    {#if updater.status === "checking"}
                      {i18n.t("updates.checking")}
                    {:else if updater.status === "available" || updater.status === "downloading" || updater.status === "downloaded"}
                      {i18n.t("updates.bannerAvailable", { version: updater.update?.version ?? "" })}
                    {:else}
                      {i18n.t("updates.lastChecked", { when: lastCheckedLabel })}
                    {/if}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updater.status === "checking" ||
                    updater.status === "downloading" ||
                    updater.status === "installing"}
                  onclick={() => void updater.checkNow()}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  {i18n.t("updates.checkNow")}
                </Button>
              </div>

              <SettingsRow label={i18n.t("updates.channel")} description={i18n.t("updates.channelDesc")}>
                {#snippet control()}
                  <Combobox
                    value={up.channel}
                    groups={channelGroups}
                    triggerClass="w-56"
                    searchPlaceholder={i18n.t("common.search")}
                    onChange={(v) => {
                      setUp({ channel: v as UpdateChannel });
                      persistNow();
                      void updater.checkNow();
                    }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("updates.autoCheck")} description={i18n.t("updates.autoCheckDesc")}>
                {#snippet control()}
                  <Switch
                    checked={up.autoCheck}
                    onCheckedChange={(c) => { setUp({ autoCheck: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("updates.autoDownload")} description={i18n.t("updates.autoDownloadDesc")}>
                {#snippet control()}
                  <Switch
                    checked={up.autoDownload}
                    onCheckedChange={(c) => { setUp({ autoDownload: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("updates.installPolicy")} description={i18n.t("updates.installPolicyDesc")}>
                {#snippet control()}
                  <Combobox
                    value={up.installPolicy}
                    groups={installPolicyGroups}
                    triggerClass="w-56"
                    searchPlaceholder={i18n.t("common.search")}
                    onChange={(v) => { setUp({ installPolicy: v as InstallPolicy }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>
            </div>
          </SettingsSection>
        {:else if app.settingsSection === "browser"}
          <SettingsSection
            title={i18n.t("settings.browser")}
            description={i18n.t("settings.browserDesc")}
          >
            <div class="divide-y divide-border/60">
              <!-- On/off settings are Switches (not on/off comboboxes). -->
              <SettingsRow label={i18n.t("browser.enabled")} description={i18n.t("browser.enabledDesc")}>
                {#snippet control()}
                  <Switch
                    checked={br.enabled}
                    onCheckedChange={(c) => { setBr({ enabled: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <!-- Link policy has three options, so it stays a Select. -->
              <SettingsRow label={i18n.t("browser.linkPolicy")} description={i18n.t("browser.linkPolicyDesc")}>
                {#snippet control()}
                  <Combobox
                    value={br.linkPolicy}
                    groups={linkPolicyGroups}
                    disabled={!br.enabled}
                    triggerClass="w-56"
                    searchPlaceholder={i18n.t("common.search")}
                    onChange={(v) => { setBr({ linkPolicy: v as BrowserLinkPolicy }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("browser.allowAgents")} description={i18n.t("browser.allowAgentsDesc")}>
                {#snippet control()}
                  <Switch
                    checked={br.allowAgents}
                    disabled={!br.enabled}
                    onCheckedChange={(c) => { setBr({ allowAgents: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("browser.terminalLinks")} description={i18n.t("browser.terminalLinksDesc")}>
                {#snippet control()}
                  <Switch
                    checked={br.terminalLinks}
                    disabled={!br.enabled}
                    onCheckedChange={(c) => { setBr({ terminalLinks: c }); persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>

              <SettingsRow label={i18n.t("browser.homepage")} description={i18n.t("browser.homepageDesc")}>
                {#snippet control()}
                  <Input
                    class="w-72 max-w-full"
                    value={br.homepage}
                    placeholder={i18n.t("browser.homepagePlaceholder")}
                    disabled={!br.enabled}
                    oninput={(e) => setBr({ homepage: e.currentTarget.value })}
                    onchange={() => persistNow()}
                  />
                {/snippet}
              </SettingsRow>
            </div>
          </SettingsSection>
        {:else}
          <SettingsSection bare title={i18n.t("settings.terminal")} description={i18n.t("settings.terminalDesc")}>
            <div class="rounded-xl border border-border/50 bg-card/50 px-7 py-4 shadow-xs">
              <SettingsRow label={i18n.t("settings.defaultProfile")} description={i18n.t("settings.defaultProfileDesc")}>
                {#snippet control()}
                  <Combobox
                    value={app.settings.defaultProfileId ?? undefined}
                    groups={profileGroups}
                    placeholder={i18n.t("terminal.chooseProfile")}
                    triggerClass="w-56"
                    searchPlaceholder={i18n.t("common.search")}
                    onChange={(v) => { app.settings.defaultProfileId = v; persistNow(); }}
                  />
                {/snippet}
              </SettingsRow>
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

            {#if app.terminalProfiles.length > 0}
              <!-- One list: each profile is a row that expands to its command/args. -->
              <div class="flex flex-col divide-y divide-border/60 rounded-xl border border-border/50 bg-card/50 px-5 shadow-xs">
                {#each app.terminalProfiles as profile (profile.id)}
                  <TerminalProfileEditor
                    {profile}
                    onchange={schedulePersist}
                    onremove={() => removeProfile(profile.id)}
                  />
                {/each}
              </div>
            {:else}
              <p class={cn("text-muted-foreground", text.body)}>
                {i18n.t("settings.noProfiles")}
              </p>
            {/if}
          </SettingsSection>
        {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Leading logo for the agent selectors (shown on the trigger and each row),
     resolved from the item value. -->
{#snippet agentPrefix(item: ComboItem)}
  {#if item.value !== NO_DEFAULT_AGENT}
    {@const a = app.launchableAgents.find((x) => x.id === item.value)}
    {#if a}<AgentLogo logo={agentLogoKey(a.icon, a.command)} class="size-4 shrink-0" />{/if}
  {/if}
{/snippet}

{#snippet aiAgentPrefix(item: ComboItem)}
  {@const a = AI_COMMIT_AGENTS.find((x) => x.id === item.value)}
  {#if a}<AgentLogo logo={a.logo} class="size-4 shrink-0" />{/if}
{/snippet}
