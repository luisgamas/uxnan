<script lang="ts">
  // Settings → GitHub. The account/session panel, the GitHub integration toggles
  // (right-panel tab, status-bar indicator, poll interval, notifications, confirm
  // before create/merge) and AI PR-body authoring — all `gh`-backed via the
  // github store. Moved here from the (now inline, per-project) GitHub view so
  // configuration lives with the rest of the app's settings.
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { aiCommitAgents, aiCommitModels } from "$lib/api";
  import type { AgentModel } from "$lib/types";
  // The full list resolves a logo (deprecated entries included); the choices
  // helper decides what the picker actually offers.
  import { AI_COMMIT_AGENTS, aiCommitAgentChoices } from "$lib/aiCommitPresets";
  import { Switch } from "$lib/components/ui/switch";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import Combobox, { type ComboGroup } from "$lib/components/Combobox.svelte";
  import AiModelPicker from "$lib/components/AiModelPicker.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";

  function errText(e: unknown): string {
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return String(e);
  }

  function ensureGithub() {
    if (!app.settings.github) app.settings.github = {};
    return app.settings.github;
  }
  function persist() {
    void app.persistSettings();
  }

  // --- AI PR authoring (mirrors Settings → AI commit messages) ---------------
  /** Installed agents (null = not detected yet), so uninstalled ones show
   *  disabled rather than silently missing. */
  let aiAgentsInstalled = $state<Set<string> | null>(null);
  let aiModels = $state<AgentModel[]>([]);
  let aiModelsFor = $state(""); // which agent aiModels belongs to
  let aiModelsLoading = $state(false);
  /** Why discovery failed, if it did — distinct from an empty list (a broken or
   *  logged-out CLI is not the same as an agent with no models). */
  let aiModelsError = $state<string | null>(null);

  const aiAgentInstalled = (id: string) => aiAgentsInstalled?.has(id) ?? false;

  const aiAgentGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: "", label: i18n.t("github.settings.aiNone") },
        // A discontinued agent is only listed while it is the saved selection —
        // otherwise the field would read "none" while it kept drafting bodies.
        ...aiCommitAgentChoices(app.settings.github?.aiAgentId).map((a) => ({
          value: a.id,
          label: a.name,
          disabled: aiAgentsInstalled !== null && !aiAgentInstalled(a.id),
          meta: a.deprecated
            ? i18n.t("settings.agentDeprecated")
            : aiAgentsInstalled !== null && !aiAgentInstalled(a.id)
              ? i18n.t("settings.agentNotFound")
              : undefined,
        })),
      ],
    },
  ]);

  async function detectAiAgents() {
    try {
      aiAgentsInstalled = new Set(await aiCommitAgents());
    } catch {
      aiAgentsInstalled = new Set();
    }
  }

  async function loadAiModels(agent: string) {
    if (!agent) {
      aiModels = [];
      aiModelsFor = "";
      aiModelsError = null;
      return;
    }
    aiModelsLoading = true;
    aiModelsError = null;
    try {
      aiModels = await aiCommitModels(agent);
    } catch (e) {
      aiModels = [];
      aiModelsError = errText(e);
    } finally {
      aiModelsFor = agent;
      aiModelsLoading = false;
    }
  }

  function selectAiAgent(id: string) {
    ensureGithub().aiAgentId = id || undefined;
    ensureGithub().aiModel = undefined; // model ids are agent-specific
    persist();
    void loadAiModels(id);
  }

  // Language: "auto" + each app locale. Stored as the English language NAME, since
  // the backend prompt states it verbatim ("Write the description in Spanish").
  const aiLanguageGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: "auto", label: i18n.t("settings.aiCommitLanguageAuto") },
        { value: "English", label: i18n.t("settings.aiCommitLanguageEn") },
        { value: "Spanish", label: i18n.t("settings.aiCommitLanguageEs") },
      ],
    },
  ]);

  // The component only mounts while its Settings section is shown, so detect
  // installed agents on mount, then load the current agent's models once (the load
  // stamps aiModelsFor, so this doesn't loop).
  $effect(() => {
    if (aiAgentsInstalled === null) void detectAiAgents();
    const agent = app.settings.github?.aiAgentId ?? "";
    if (agent && aiModelsFor !== agent && !aiModelsLoading) void loadAiModels(agent);
  });
</script>

{#snippet aiAgentPrefix(item: { value: string })}
  {@const a = AI_COMMIT_AGENTS.find((x) => x.id === item.value)}
  {#if a}
    <AgentLogo logo={a.logo} class="size-4 shrink-0" />
  {/if}
{/snippet}

{#snippet pill(label: string)}
  <span
    class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
  >
    {label}
  </span>
{/snippet}

<div class="space-y-8">
  <!-- Account / Session. -->
  <SettingsSection title={i18n.t("github.account.title")} description={i18n.t("github.account.desc")}>
    <SettingsRow label={i18n.t("github.account.status")}>
      {#snippet control()}
        <span class={cn("inline-flex items-center gap-1.5", text.body)}>
          <span class={cn("size-2 rounded-full", github.available ? "bg-emerald-500" : "bg-muted-foreground/50")}></span>
          {github.available ? i18n.t("github.account.connected") : i18n.t("github.account.disconnected")}
        </span>
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.account.cli")}>
      {#snippet control()}
        <span class={cn(text.body)}>{github.status?.ghInstalled ? i18n.t("github.account.installed") : i18n.t("github.account.missing")}</span>
      {/snippet}
    </SettingsRow>
    {#if github.status?.login}
      <SettingsRow label={i18n.t("github.account.signedInAs")}>
        {#snippet control()}
          <span class={cn("font-medium", text.body)}>{github.status?.login}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if github.status?.host}
      <SettingsRow label={i18n.t("github.account.host")}>
        {#snippet control()}
          <span class={cn("font-mono", text.body)}>{github.status?.host}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if github.status && github.status.scopes.length > 0}
      <SettingsRow label={i18n.t("github.account.scopes")}>
        {#snippet control()}
          <div class="flex flex-wrap justify-end gap-1">
            {#each github.status?.scopes ?? [] as scope (scope)}{@render pill(scope)}{/each}
          </div>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if github.rateLimit}
      <SettingsRow label={i18n.t("github.account.rateLimit")}>
        {#snippet control()}
          <span class={cn(text.body)}>{i18n.t("github.account.rateLimitValue", { remaining: github.rateLimit?.remaining ?? 0, limit: github.rateLimit?.limit ?? 0 })}</span>
        {/snippet}
      </SettingsRow>
    {/if}
    {#if !github.available}
      <SettingsRow label={i18n.t("github.notSignedIn")}>
        {#snippet control()}
          <span class={cn("text-muted-foreground", text.meta)}>{i18n.t("github.account.signInHint")}</span>
        {/snippet}
      </SettingsRow>
    {/if}
  </SettingsSection>

  <!-- Integration toggles. -->
  <SettingsSection title={i18n.t("github.settings.title")} description={i18n.t("github.settings.desc")}>
    <SettingsRow label={i18n.t("github.settings.rightPanelTab")} description={i18n.t("github.settings.rightPanelTabDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.rightPanelTab ?? true}
          onCheckedChange={(v) => { ensureGithub().rightPanelTab = v; persist(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.statusBar")} description={i18n.t("github.settings.statusBarDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.statusBarEnabled ?? true}
          onCheckedChange={(v) => { ensureGithub().statusBarEnabled = v; persist(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.poll")} description={i18n.t("github.settings.pollDesc")}>
      {#snippet control()}
        <Input
          type="number"
          class="w-24"
          value={String(app.settings.github?.pollSeconds ?? 45)}
          onchange={(e) => { ensureGithub().pollSeconds = Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0); persist(); github.startPolling(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.notifications")} description={i18n.t("github.settings.notificationsDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.notificationsEnabled ?? false}
          onCheckedChange={(v) => { ensureGithub().notificationsEnabled = v; persist(); if (v) void github.refreshNotifications(); }}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label={i18n.t("github.settings.confirmPr")} description={i18n.t("github.settings.confirmPrDesc")}>
      {#snippet control()}
        <Switch
          checked={app.settings.github?.confirmPr ?? true}
          onCheckedChange={(v) => { ensureGithub().confirmPr = v; persist(); }}
        />
      {/snippet}
    </SettingsRow>
  </SettingsSection>

  <!-- AI PR authoring — the sibling of Settings → AI commit messages. -->
  <SettingsSection title={i18n.t("github.settings.ai")} description={i18n.t("github.settings.aiDesc")}>
    <div class="divide-y divide-border/60">
      <SettingsRow label={i18n.t("github.settings.aiEnabled")} description={i18n.t("github.settings.aiEnabledDesc")}>
        {#snippet control()}
          <Switch
            checked={app.settings.github?.aiEnabled ?? false}
            onCheckedChange={(v) => { ensureGithub().aiEnabled = v; persist(); }}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={i18n.t("github.settings.aiAgent")}
        description={aiAgentsInstalled !== null && aiAgentsInstalled.size === 0
          ? i18n.t("settings.aiCommitNoAgents")
          : i18n.t("github.settings.aiAgentDesc")}
      >
        {#snippet control()}
          <Combobox
            value={app.settings.github?.aiAgentId ?? ""}
            groups={aiAgentGroups}
            placeholder={i18n.t("github.settings.aiNone")}
            searchPlaceholder={i18n.t("common.search")}
            triggerClass="w-56"
            itemPrefix={aiAgentPrefix}
            onChange={selectAiAgent}
          />
        {/snippet}
      </SettingsRow>

      {#if app.settings.github?.aiAgentId && aiAgentInstalled(app.settings.github.aiAgentId)}
        <SettingsRow label={i18n.t("github.settings.aiModel")} description={i18n.t("settings.aiCommitModelDesc")}>
          {#snippet control()}
            <AiModelPicker
              models={aiModels}
              value={app.settings.github?.aiModel ?? ""}
              loading={aiModelsLoading}
              onSelect={(id) => { ensureGithub().aiModel = id || undefined; persist(); }}
            />
          {/snippet}
        </SettingsRow>
        {#if aiModelsError}
          <SettingsRow label={i18n.t("github.settings.aiModelsFailed")}>
            {#snippet children()}
              <p class={cn("mt-1 whitespace-pre-wrap text-destructive", text.meta)}>{aiModelsError}</p>
            {/snippet}
          </SettingsRow>
        {/if}
      {/if}

      <SettingsRow label={i18n.t("settings.aiCommitLanguage")} description={i18n.t("github.settings.aiLanguageDesc")}>
        {#snippet control()}
          <Combobox
            value={app.settings.github?.aiLanguage ?? "auto"}
            groups={aiLanguageGroups}
            triggerClass="w-56"
            searchPlaceholder={i18n.t("common.search")}
            onChange={(v) => { ensureGithub().aiLanguage = v; persist(); }}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("settings.aiCommitInstructions")} description={i18n.t("github.settings.aiInstructionsDesc")}>
        {#snippet children()}
          <Textarea
            class="mt-1 min-h-0 resize-none text-xs"
            rows={2}
            placeholder={i18n.t("github.settings.aiInstructionsPlaceholder")}
            value={app.settings.github?.aiInstructions ?? ""}
            onchange={(e) => { ensureGithub().aiInstructions = (e.currentTarget as HTMLTextAreaElement).value; persist(); }}
          />
        {/snippet}
      </SettingsRow>
    </div>
  </SettingsSection>
</div>
