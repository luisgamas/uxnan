<script lang="ts">
  // Settings as a full-screen view (replaces the three-panel body while open).
  // The title bar stays mounted at the window level so window controls always
  // work. The status bar is hidden in settings mode to give the content more
  // room. Close with the back button, the gear in the title bar, or Escape.

  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as HoverCard from "$lib/components/ui/hover-card";
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
  import { USAGE_CATALOG, usageProvider, defaultStatusBarPick } from "$lib/usageCatalog";
  import { statusMeta } from "$lib/usageFormat";
  import { detectAgents, usageDetect } from "$lib/api";
  import { usage } from "$lib/state/usage.svelte";
  import type { UsageProvider } from "$lib/types";
  import * as Tabs from "$lib/components/ui/tabs";
  import ProviderUsageEditor from "./ProviderUsageEditor.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { updater } from "$lib/state/updater.svelte";
  import { appVersion } from "$lib/api";
  import type {
    UpdaterSettings,
    UpdateChannel,
    InstallPolicy,
    BrowserSettings,
    BrowserLinkPolicy,
    McpInjection,
    McpInfo,
  } from "$lib/types";
  import { mcpInfo } from "$lib/api";
  import { clipboardWrite } from "$lib/clipboard";
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
  import { divider, icon, iconButton, panel, tab, text } from "$lib/design";
  import PaletteIcon from "@lucide/svelte/icons/palette";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import LanguagesIcon from "@lucide/svelte/icons/languages";
  import KeyboardIcon from "@lucide/svelte/icons/keyboard";
  import WebhookIcon from "@lucide/svelte/icons/webhook";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import XIcon from "@lucide/svelte/icons/x";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import CheckIcon from "@lucide/svelte/icons/check";

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

  // --- Providers (usage statistics) -----------------------------------------
  // Which catalog providers are present on the machine (null = not checked yet).
  let usagePresent = $state<Set<UsageProvider> | null>(null);
  async function detectProviders() {
    try {
      usagePresent = new Set(await usageDetect(USAGE_CATALOG.map((p) => p.id)));
    } catch {
      usagePresent = new Set(); // backend unreachable (e.g. web preview)
    }
  }
  // On opening the Providers pane: detect presence once, then load fresh usage.
  $effect(() => {
    if (app.settingsOpen && app.settingsSection === "providers") {
      if (usagePresent === null) void detectProviders();
      void usage.ensureFresh();
    }
  });

  const usageConfigs = $derived(app.settings.usageProviders ?? []);
  const isProviderActive = (id: UsageProvider) =>
    usageConfigs.some((c) => c.provider === id);
  const providerPresent = (id: UsageProvider) => usagePresent?.has(id) ?? false;

  // The provider tab currently shown. Kept valid as the list changes.
  let activeProviderTab = $state<string>("");
  $effect(() => {
    const ids = usageConfigs.map((c) => c.provider);
    if (ids.length > 0 && !ids.includes(activeProviderTab as UsageProvider)) {
      activeProviderTab = ids[0];
    }
  });

  function addProvider(id: UsageProvider) {
    const meta = usageProvider(id);
    if (!meta || isProviderActive(id)) return;
    if (!app.settings.usageProviders) app.settings.usageProviders = [];
    app.settings.usageProviders.push({
      provider: id,
      refreshMinutes: null,
      statusBar: defaultStatusBarPick(),
    });
    activeProviderTab = id; // jump to the newly added provider's tab
    persistNow();
    usage.reschedule();
    void usage.refreshOne(id);
  }
  function removeProvider(id: UsageProvider) {
    app.settings.usageProviders = usageConfigs.filter((c) => c.provider !== id);
    persistNow();
    usage.reschedule();
  }
  // A card edited a field (refresh interval / status-bar picks): persist soon.
  const onProviderChange = () => schedulePersist();

  // Combobox: providers not yet activated, with an "installed?" hint.
  const addProviderGroups = $derived<ComboGroup[]>([
    {
      items: USAGE_CATALOG.filter((p) => !isProviderActive(p.id)).map((p) => ({
        value: p.id,
        label: p.name,
        keywords: [p.id],
        meta: providerPresent(p.id) ? undefined : i18n.t("providers.notDetected"),
      })),
    },
  ]);

  // Global refresh-interval options (the per-provider select adds a "Global").
  const usageRefreshGroups: ComboGroup[] = [
    {
      items: [
        { value: "1", label: i18n.t("providers.every1m") },
        { value: "5", label: i18n.t("providers.every5m") },
        { value: "15", label: i18n.t("providers.every15m") },
        { value: "60", label: i18n.t("providers.every60m") },
        { value: "0", label: i18n.t("providers.refreshManual") },
      ],
    },
  ];

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
  /** Live download fraction (0–1, or null when the total is unknown), for the
   *  Updates panel's inline progress copy — mirrors the update toast/banner. */
  const updatePct = $derived(updater.progressFraction);

  // --- Integrated browser ---------------------------------------------------
  // Merge over a full default so reads/writes are always complete (state saved
  // before this feature, or the web preview, may lack the object).
  const BROWSER_DEFAULT: BrowserSettings = {
    enabled: true,
    linkPolicy: "internal",
    allowAgents: true,
    terminalLinks: true,
    homepage: "",
    mcpEnabled: true,
    mcpInjection: "workspace",
    mcpDisabledAgents: [],
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

  // --- Agent browser MCP (Settings → Browser) -------------------------------
  // Runtime coordinates + supported-agent catalog, loaded once when the Browser
  // section is first opened (needs the local hook server to be listening).
  let mcpData = $state<McpInfo | null>(null);
  let mcpLoaded = $state(false);
  async function loadMcp() {
    try {
      mcpData = await mcpInfo();
    } catch {
      mcpData = null;
    }
    mcpLoaded = true;
  }
  $effect(() => {
    if (app.settingsSection === "browser" && !mcpLoaded) void loadMcp();
  });
  const MCP_MODES: { value: McpInjection; labelKey: MessageKey; descKey: MessageKey }[] = [
    { value: "workspace", labelKey: "browser.mcpModeWorkspace", descKey: "browser.mcpModeWorkspaceDesc" },
    { value: "global", labelKey: "browser.mcpModeGlobal", descKey: "browser.mcpModeGlobalDesc" },
    { value: "off", labelKey: "browser.mcpModeOff", descKey: "browser.mcpModeOffDesc" },
  ];
  const mcpModeGroups = $derived<ComboGroup[]>([
    { items: MCP_MODES.map((m) => ({ value: m.value, label: i18n.t(m.labelKey) })) },
  ]);
  // Helper text under the injection row tracks the selected mode.
  const mcpModeDesc = $derived(
    i18n.t(MCP_MODES.find((m) => m.value === br.mcpInjection)?.descKey ?? "browser.mcpInjectionDesc"),
  );
  function mcpAgentOn(id: string): boolean {
    return !(br.mcpDisabledAgents ?? []).includes(id);
  }
  function toggleMcpAgent(id: string, on: boolean) {
    const next = new Set(br.mcpDisabledAgents ?? []);
    if (on) next.delete(id);
    else next.add(id);
    setBr({ mcpDisabledAgents: [...next] });
    persistNow();
  }
  // Ready-to-paste MCP server config (standard `mcpServers` http shape) for wiring
  // an agent by hand. Empty until the endpoint is known.
  const mcpSnippet = $derived(
    mcpData?.endpoint
      ? JSON.stringify(
          {
            mcpServers: {
              [mcpData.serverName]: {
                type: "http",
                url: mcpData.endpoint,
                headers: { Authorization: `Bearer ${mcpData.token ?? ""}` },
              },
            },
          },
          null,
          2,
        )
      : "",
  );
  let mcpCopied = $state(false);
  let mcpCopyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyMcpSnippet() {
    if (!mcpSnippet) return;
    await clipboardWrite(mcpSnippet);
    mcpCopied = true;
    clearTimeout(mcpCopyTimer);
    mcpCopyTimer = setTimeout(() => (mcpCopied = false), 1500);
  }
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
        { id: "providers", key: "settings.providers", icon: GaugeIcon },
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
      <TooltipSimple title={i18n.t("common.close")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon-sm"
            class={iconButton.action}
            aria-label={i18n.t("common.close")}
            onclick={close}
          >
            <ArrowLeftIcon class={icon.button} />
          </Button>
        {/snippet}
      </TooltipSimple>
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
                      <TooltipSimple title={i18n.t("shortcuts.rebind")}>
                        {#snippet children(tp)}
                          <button
                            {...tp}
                            type="button"
                            class={cn(
                              "inline-flex h-7 min-w-24 shrink-0 items-center justify-center rounded-md border px-2 font-mono",
                              text.body,
                              isCapturing
                                ? "border-primary text-primary"
                                : "border-border hover:bg-accent/50",
                            )}
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
                        {/snippet}
                      </TooltipSimple>
                      <TooltipSimple title={i18n.t("shortcuts.disable")}>
                        {#snippet children(tp)}
                          <Button
                            {...tp}
                            variant="ghost"
                            size="icon"
                            class={iconButton.action}
                            disabled={chord === ""}
                            onclick={() => setBinding(action.id, "")}
                          >
                            <XIcon class={icon.button} />
                          </Button>
                        {/snippet}
                      </TooltipSimple>
                      <TooltipSimple title={i18n.t("shortcuts.reset")}>
                        {#snippet children(tp)}
                          <Button
                            {...tp}
                            variant="ghost"
                            size="icon"
                            class={iconButton.action}
                            disabled={chord === action.default}
                            onclick={() => resetBinding(action.id)}
                          >
                            <RotateCcwIcon class={icon.button} />
                          </Button>
                        {/snippet}
                      </TooltipSimple>
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
        {:else if app.settingsSection === "providers"}
          <div class="flex flex-col gap-6">
            <SettingsSection title={i18n.t("settings.providers")} description={i18n.t("settings.providersDesc")}>
              <div class="divide-y divide-border/60">
                <SettingsRow label={i18n.t("providers.refreshInterval")} description={i18n.t("providers.refreshIntervalDesc")}>
                  {#snippet control()}
                    <Combobox
                      value={String(app.settings.usageRefreshMinutes ?? 5)}
                      groups={usageRefreshGroups}
                      triggerClass="w-44"
                      onChange={(v) => {
                        app.settings.usageRefreshMinutes = Number(v);
                        persistNow();
                        usage.reschedule();
                      }}
                    />
                  {/snippet}
                </SettingsRow>
                <SettingsRow label={i18n.t("providers.statusBarEnabled")} description={i18n.t("providers.statusBarEnabledDesc")}>
                  {#snippet control()}
                    <Switch
                      checked={app.settings.usageStatusBarEnabled !== false}
                      onCheckedChange={(c) => {
                        app.settings.usageStatusBarEnabled = c;
                        persistNow();
                      }}
                    />
                  {/snippet}
                </SettingsRow>
              </div>
            </SettingsSection>

            <!-- Your providers: a section label OUTSIDE the container, then one
                 coherent container holding the add-header (title · desc ·
                 combobox), a subtle divider, and a tab per activated provider.
                 Each tab shows that provider's live data + status-bar options. -->
            {#snippet providerPrefix(item: ComboItem)}
              <AgentLogo logo={usageProvider(item.value as UsageProvider)?.logo ?? item.value} class="size-4" />
            {/snippet}
            <section class="space-y-4">
              <h2 class={text.pageTitle}>{i18n.t("providers.yourProviders")}</h2>
              <div class={panel.settingsBody}>
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div class="min-w-0 space-y-1">
                    <h3 class={text.heading}>{i18n.t("providers.addProvider")}</h3>
                    <p class="max-w-md text-[13px] leading-5 text-muted-foreground">{i18n.t("providers.yourProvidersDesc")}</p>
                  </div>
                  <Combobox
                    value=""
                    groups={addProviderGroups}
                    triggerClass="w-56"
                    placeholder={i18n.t("providers.addPick")}
                    searchPlaceholder={i18n.t("common.search")}
                    itemPrefix={providerPrefix}
                    onChange={(v) => addProvider(v as UsageProvider)}
                  />
                </div>
                <div class="mt-5 border-t border-border/60 pt-5">
                  {#if usagePresent === null && usageConfigs.length === 0}
                    <p class={cn("py-2 text-center", text.meta)}>{i18n.t("settings.detecting")}</p>
                  {:else if usageConfigs.length === 0}
                    <p class={cn("py-2 text-center", text.meta)}>{i18n.t("providers.empty")}</p>
                  {:else}
                    <Tabs.Root bind:value={activeProviderTab} class="flex flex-col gap-5">
                      <Tabs.List class={cn("h-8 shrink-0 justify-start gap-1 rounded-none bg-transparent p-0", divider.bottom)}>
                        {#each usageConfigs as config (config.provider)}
                          {@const m = usageProvider(config.provider)}
                          {@const snap = usage.byProvider[config.provider]}
                          {@const st = statusMeta(snap?.status ?? "notInstalled")}
                          <Tabs.Trigger
                            value={config.provider}
                            class={cn("gap-1.5 px-3 text-[13px]", tab.base, activeProviderTab === config.provider ? tab.activeLine : tab.inactiveLine)}
                          >
                            <AgentLogo logo={m?.logo ?? config.provider} class="size-4" />
                            {m?.name ?? config.provider}
                            <span class={cn("size-1.5 shrink-0 rounded-full", st.dot)}></span>
                          </Tabs.Trigger>
                        {/each}
                      </Tabs.List>
                      {#each usageConfigs as config (config.provider)}
                        <Tabs.Content value={config.provider}>
                          <ProviderUsageEditor
                            {config}
                            snapshot={usage.byProvider[config.provider]}
                            loading={usage.loading}
                            onchange={onProviderChange}
                            onremove={() => removeProvider(config.provider)}
                            onrefresh={() => usage.refreshOne(config.provider)}
                          />
                        </Tabs.Content>
                      {/each}
                    </Tabs.Root>
                  {/if}
                </div>
              </div>
            </section>
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
                    {:else if updater.status === "available"}
                      {i18n.t("updates.bannerAvailable", { version: updater.update?.version ?? "" })}
                    {:else if updater.status === "downloading"}
                      {updatePct !== null
                        ? i18n.t("updates.bannerDownloadingPct", {
                            version: updater.update?.version ?? "",
                            pct: String(Math.round(updatePct * 100)),
                          })
                        : i18n.t("updates.bannerDownloading", { version: updater.update?.version ?? "" })}
                    {:else if updater.status === "downloaded"}
                      {i18n.t("updates.bannerDownloaded", { version: updater.update?.version ?? "" })}
                    {:else if updater.status === "installing"}
                      {i18n.t("updates.bannerInstalling")}
                    {:else}
                      {i18n.t("updates.lastChecked", { when: lastCheckedLabel })}
                    {/if}
                  </p>
                  <!-- Amber note: installing restarts the app and stops the running agent. -->
                  {#if updater.status === "downloaded" && updater.agentsBusy}
                    <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <TriangleAlertIcon class={icon.decorative} />
                      <span class={text.indicator}>{i18n.t("updates.agentsBusyWarning")}</span>
                    </span>
                  {/if}
                </div>

                <!-- Phase-aware actions: mirror the update toast so the user can
                     download / install straight from Settings, consistent with the
                     install policy. Falls back to "Check now" when idle. -->
                <div class="flex shrink-0 items-center gap-1.5">
                  {#if updater.status === "available"}
                    <Button size="sm" onclick={() => void updater.download()}>
                      <DownloadIcon data-icon="inline-start" />
                      {i18n.t("updates.download")}
                    </Button>
                  {:else if updater.status === "downloading"}
                    <Button size="sm" disabled>
                      <LoaderIcon data-icon="inline-start" class="animate-spin" />
                      {updatePct !== null
                        ? i18n.t("updates.bannerDownloadingPct", {
                            version: updater.update?.version ?? "",
                            pct: String(Math.round(updatePct * 100)),
                          })
                        : i18n.t("updates.download")}
                    </Button>
                  {:else if updater.status === "downloaded"}
                    {#if updater.agentsBusy}
                      <Button size="sm" onclick={() => updater.installWhenIdle()}>
                        {i18n.t("updates.installWhenIdle")}
                      </Button>
                      <Button variant="outline" size="sm" onclick={() => void updater.installNow()}>
                        {i18n.t("updates.installNow")}
                      </Button>
                    {:else}
                      <Button size="sm" onclick={() => void updater.installNow()}>
                        {i18n.t("updates.installNow")}
                      </Button>
                    {/if}
                  {:else if updater.status === "installing"}
                    <Button size="sm" disabled>
                      <LoaderIcon data-icon="inline-start" class="animate-spin" />
                      {i18n.t("updates.bannerInstalling")}
                    </Button>
                  {:else}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updater.status === "checking"}
                      onclick={() => void updater.checkNow()}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      {i18n.t("updates.checkNow")}
                    </Button>
                  {/if}
                </div>
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
                {#snippet help()}
                  <HoverCard.Root>
                    <HoverCard.Trigger>
                      {#snippet child({ props })}
                        <button
                          {...props}
                          type="button"
                          class="inline-flex text-muted-foreground/70 transition-colors hover:text-foreground"
                          aria-label={i18n.t("updates.installPolicyHelpTitle")}
                        >
                          <CircleHelpIcon class="size-3.5" />
                        </button>
                      {/snippet}
                    </HoverCard.Trigger>
                    <HoverCard.Content class="w-80">
                      <p class={cn("mb-2 font-medium text-foreground", text.body)}>{i18n.t("updates.installPolicyHelpTitle")}</p>
                      <dl class="space-y-2">
                        {#each [["updates.policyAsk", "updates.policyAskHelp"], ["updates.policyWhenIdle", "updates.policyWhenIdleHelp"], ["updates.policyManual", "updates.policyManualHelp"]] as [nameKey, helpKey] (nameKey)}
                          <div>
                            <dt class={cn("font-medium text-foreground", text.body)}>{i18n.t(nameKey as never)}</dt>
                            <dd class="text-[12px] leading-5 text-muted-foreground">{i18n.t(helpKey as never)}</dd>
                          </div>
                        {/each}
                      </dl>
                    </HoverCard.Content>
                  </HoverCard.Root>
                {/snippet}
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
          <SettingsSection bare title={i18n.t("settings.browser")} description={i18n.t("settings.browserDesc")}>
            <div class="space-y-6">
              <!-- Integrated browser settings. -->
              <div class={panel.settingsBody}>
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
              </div>

              <!-- Agent browser MCP — its own titled group (title outside the card). -->
              <div class="space-y-2">
                <span class={cn("px-1", text.section)}>{i18n.t("browser.mcpHeading")}</span>
                <div class={panel.settingsBody}>
                  <div class="divide-y divide-border/60">
                  <SettingsRow label={i18n.t("browser.mcpEnabled")} description={i18n.t("browser.mcpEnabledDesc")}>
                    {#snippet control()}
                      <Switch
                        checked={br.mcpEnabled}
                        disabled={!br.enabled}
                        onCheckedChange={(c) => { setBr({ mcpEnabled: c }); persistNow(); }}
                      />
                    {/snippet}
                  </SettingsRow>

                  <SettingsRow label={i18n.t("browser.mcpInjection")} description={mcpModeDesc}>
                    {#snippet control()}
                      <Combobox
                        value={br.mcpInjection}
                        groups={mcpModeGroups}
                        disabled={!br.enabled || !br.mcpEnabled}
                        triggerClass="w-56"
                        searchPlaceholder={i18n.t("common.search")}
                        onChange={(v) => { setBr({ mcpInjection: v as McpInjection }); persistNow(); }}
                      />
                    {/snippet}
                  </SettingsRow>

                  {#if mcpData && mcpData.agents.length > 0}
                    <SettingsRow label={i18n.t("browser.mcpAgents")} description={i18n.t("browser.mcpAgentsDesc")}>
                      {#snippet children()}
                        <div class="flex flex-wrap gap-x-6 gap-y-2.5">
                          {#each mcpData?.agents ?? [] as agent (agent.id)}
                            <label class="flex items-center gap-2 text-[13px]">
                              <Switch
                                checked={mcpAgentOn(agent.id)}
                                disabled={!br.enabled || !br.mcpEnabled || br.mcpInjection === "off"}
                                onCheckedChange={(c) => toggleMcpAgent(agent.id, c)}
                              />
                              <span class="text-foreground/80">{agent.label}</span>
                            </label>
                          {/each}
                        </div>
                      {/snippet}
                    </SettingsRow>
                  {/if}

                  <SettingsRow label={i18n.t("browser.mcpSnippet")} description={i18n.t("browser.mcpSnippetDesc")}>
                    {#snippet children()}
                      {#if mcpSnippet}
                        <div class="relative mt-1 w-full">
                          <Button
                            variant="ghost"
                            size="sm"
                            class="absolute right-1.5 top-1.5 h-6 gap-1 px-1.5 text-[11px]"
                            onclick={copyMcpSnippet}
                          >
                            {#if mcpCopied}
                              <CheckIcon class="size-3" />{i18n.t("browser.mcpCopied")}
                            {:else}
                              <CopyIcon class="size-3" />{i18n.t("browser.mcpCopy")}
                            {/if}
                          </Button>
                          <pre class="scrollbar-sleek overflow-x-auto rounded-lg border border-border/50 bg-muted/40 p-3 pr-16 font-mono text-[11px] leading-relaxed text-foreground/80">{mcpSnippet}</pre>
                        </div>
                      {:else}
                        <span class="text-[12px] text-muted-foreground">{i18n.t("browser.mcpWaiting")}</span>
                      {/if}
                    {/snippet}
                  </SettingsRow>
                </div>
                </div>
              </div>
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
