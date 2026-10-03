<script lang="ts">
  // Settings → Agents → Hooks. Out-of-the-box reporters that POST precise agent
  // states to the ADE's local hook server, so the sidebar / tab bar show
  // working / waiting / done / blocked without manual setup.
  //
  // Layout: the ordinary settings language — `SettingsRow`s in a
  // `panel.settingsBody` band, grouped under `text.section` headers. The master
  // "Install agent hooks" switch is the first row; then one `AgentSettingsRow`
  // per agent (the row Settings → Browser lists its agents with, so the two read
  // as one thing), its reporter installed or removed by the switch on the right
  // (it *is* a boolean, so it reads like every other setting), its config file
  // under the name and the rendered config behind the row's own disclosure.
  // This replaced a master–detail card with a nav
  // rail of its own: the rail nested a second navigation surface inside a pane
  // that already has one, and hid the one thing the panel exists to answer —
  // which of your agents are wired, at a glance. Agents on this machine are
  // listed first; the rest sit in a collapsed group. With hosts connected, the
  // group's title becomes a machine picker — this one by default, or a host,
  // whose own agents (wired there by its engine with the same installer, only
  // the ones that host has) replace the list. One machine at a time, so thirty
  // saved hosts never make the pane thirty lists long, and a host is asked only
  // when it is picked. Per-agent installs are gated
  // by the master switch (install only when the feature is on, uninstall always,
  // so you can always clean up). The list comes from the backend registry —
  // wiring a new agent never edits this file.
  // See `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md` §1.1.

  import { onMount } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Switch } from "$lib/components/ui/switch";
  import { app } from "$lib/state/app.svelte";
  import { hosts } from "$lib/state/hosts.svelte";
  import {
    getHookInstall,
    getHookScripts,
    hostHookConfig,
    hostHooks,
    setHostHook,
    installAgentHooks,
    installAllHooks,
    listAgentHooks,
    renderAgentHooksConfig,
    uninstallAgentHooks,
  } from "$lib/api";
  import type { HookAgentEntry, HookInstall, HookScripts } from "$lib/types";
  import { backendAgentLogo, backendAgentName } from "$lib/agentCatalog";
  import CodeBlock from "$lib/components/CodeBlock.svelte";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { field, focus, icon, panel, text } from "$lib/design";
  import AgentSettingsRow from "./AgentSettingsRow.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";

  type Platform = "bash" | "powershell" | "cmd" | "fish";
  const PLATFORMS: { id: Platform; label: string }[] = [
    { id: "bash", label: "Bash" },
    { id: "powershell", label: "PowerShell" },
    { id: "cmd", label: "cmd" },
    { id: "fish", label: "fish" },
  ];

  /** One line on what this agent's hook can report. Keyed by hook id, so a new
   *  agent needs its line here (and in `es.ts`) — the only copy this panel owns. */
  function agentDesc(id: string): string {
    // The id comes from the backend registry, so the key is built rather than
    // literal; a missing one renders as the key itself, which is visible enough
    // to catch in review.
    return i18n.t(`hooks.desc.${id}` as MessageKey);
  }

  let install = $state<HookInstall | null>(null);
  let scripts = $state<HookScripts | null>(null);
  let agents = $state<HookAgentEntry[]>([]);
  /** Whose hooks the list shows: this machine, or a connected host's id. */
  const LOCAL = "local";
  let machine = $state<string>(LOCAL);
  /** The picked host's agents, as its engine reports them. */
  let hostAgents = $state<HookAgentEntry[]>([]);
  let hostLoading = $state(false);
  let hostError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let busyOperation = $state<"install" | "uninstall" | null>(null);
  /** A row's key: the agent on this machine, or `<host>:<agent>` on a host. */
  function keyOf(id: string, host?: string): string {
    return host ? `${host}:${id}` : id;
  }

  /** The agents a host has, or whose reporter it already carries — a host is
   *  never offered another product's config folder. */
  function onHost(entries: HookAgentEntry[]): HookAgentEntry[] {
    return entries.filter((a) => a.present || a.status.installed);
  }

  const onThisMachine = $derived(machine === LOCAL);
  /** The machines the picker offers: this one, then each connected host. */
  const machines = $derived([LOCAL, ...hosts.connected]);

  function machineLabel(id: string): string {
    return id === LOCAL
      ? i18n.t("hooks.groupInstalled")
      : i18n.t("hooks.groupHost", { host: hosts.labelOf(id) });
  }

  /** A host that went away is not left on screen as if it answered. */
  $effect(() => {
    if (machine !== LOCAL && !hosts.connected.includes(machine)) machine = LOCAL;
  });

  async function loadHost(id: string) {
    hostLoading = true;
    hostError = null;
    hostAgents = [];
    try {
      const entries = await hostHooks(id);
      // A quicker pick of another machine wins.
      if (machine === id) hostAgents = entries;
    } catch (err) {
      if (machine === id) hostError = err instanceof Error ? err.message : String(err);
    } finally {
      if (machine === id) hostLoading = false;
    }
  }

  function pick(id: string) {
    machine = id;
    if (id !== LOCAL) void loadHost(id);
  }

  /** Rendered config per agent, filled when its row is opened — the rows keep
   *  their own disclosure state, so this is keyed rather than a single slot. */
  let configTexts = $state<Record<string, string>>({});
  let othersOpen = $state(false);
  let platform = $state<Platform>("bash");

  const degraded = $derived(install === null);
  /** The feature is "on" (the master switch) and usable — gates Install. */
  const featureOn = $derived(app.settings.autoInstallHooks !== false && !degraded);

  /** Agents this machine actually has, and the rest — two groups so the ones you
   *  use are the ones you see, and the long tail stays folded away. */
  const mine = $derived(agents.filter((a) => a.present));
  const others = $derived(agents.filter((a) => !a.present));

  onMount(async () => {
    try {
      install = await getHookInstall();
    } catch {
      install = null;
    }
    try {
      scripts = await getHookScripts();
    } catch {
      scripts = null;
    }
    await refreshAll();
  });

  async function refreshAll() {
    try {
      agents = await listAgentHooks();
    } catch {
      agents = [];
    }
    if (machine !== LOCAL) await loadHost(machine);
  }

  /** Load the exact config the ADE writes for one agent, on demand — rendering
   *  every agent's up front would be one round-trip each for a disclosure most
   *  users never open. Re-read on every open, so a row reopened after an install
   *  or uninstall shows what is on disk now. */
  async function loadConfig(id: string, open: boolean, host?: string) {
    if (!open) return;
    const key = keyOf(id, host);
    configTexts = { ...configTexts, [key]: "" };
    try {
      const text = host ? await hostHookConfig(host, id) : await renderAgentHooksConfig(id);
      configTexts = { ...configTexts, [key]: text };
    } catch (err) {
      configTexts = { ...configTexts, [key]: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Put a status on the row it belongs to — this machine's, or a host's. */
  function setStatus(id: string, host: string | undefined, update: (e: HookAgentEntry) => HookAgentEntry) {
    if (!host) {
      agents = agents.map((a) => (a.id === id ? update(a) : a));
      return;
    }
    if (host === machine) hostAgents = hostAgents.map((a) => (a.id === id ? update(a) : a));
  }

  async function act(id: string, operation: "install" | "uninstall", host?: string) {
    busy = keyOf(id, host);
    busyOperation = operation;
    try {
      const on = operation === "install";
      const status = host
        ? await setHostHook(host, id, on)
        : on
          ? await installAgentHooks(id)
          : await uninstallAgentHooks(id);
      setStatus(id, host, (a) => ({ ...a, status }));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setStatus(id, host, (a) => ({ ...a, status: { ...a.status, unavailable: true, detail } }));
    } finally {
      busy = null;
      busyOperation = null;
      void app.refreshHooksStatus();
    }
  }

  /** Master switch: installs / uninstalls every agent and persists the
   *  preference so an uninstall isn't re-added on the next launch. */
  async function toggleAllHooks(on: boolean) {
    app.settings.autoInstallHooks = on;
    void app.persistSettings();
    busy = "all";
    busyOperation = on ? "install" : "uninstall";
    try {
      if (on) {
        await installAllHooks();
      } else {
        for (const a of agents) {
          if (a.status.installed) await uninstallAgentHooks(a.id).catch(() => undefined);
        }
      }
      // The same switch for every connected host: its own agents, there.
      for (const host of hosts.connected) {
        const entries = await hostHooks(host).catch(() => [] as HookAgentEntry[]);
        for (const a of onHost(entries)) {
          if (a.status.installed !== on) {
            await setHostHook(host, a.id, on).catch(() => undefined);
          }
        }
      }
    } finally {
      busy = null;
      busyOperation = null;
    }
    await refreshAll();
    void app.refreshHooksStatus();
  }

  /** An agent whose CLI documents no usable hook can't be installed at all — its
   *  switch stays off and disabled, with the backend's reason under the name. */
  function blocked(entry: HookAgentEntry): boolean {
    return entry.status.unavailable && !entry.status.installed;
  }

  const wrapperScript = $derived.by(() => {
    if (!scripts) return "";
    return platform === "bash"
      ? scripts.wrapperBash
      : platform === "powershell"
        ? scripts.wrapperPowershell
        : platform === "cmd"
          ? scripts.wrapperCmd
          : scripts.wrapperFish;
  });

  const wrapperPath = $derived.by(() => {
    if (!install) return "";
    return platform === "bash"
      ? install.wrapperBash
      : platform === "powershell"
        ? install.wrapperPowershell
        : platform === "cmd"
          ? install.wrapperCmd
          : install.wrapperFish;
  });
  const wrapperUsage = $derived(i18n.t("hooks.wrapperUsage", { script: wrapperPath || "<path>" }));
</script>

{#snippet groupHeader(title: string, description?: string)}
  <div class="px-1">
    <span class={text.section}>{title}</span>
    {#if description}<p class={cn("mt-1", text.meta)}>{description}</p>{/if}
  </div>
{/snippet}

<!-- One agent: name + what its reporter reports, installed by the switch on the
     right, with its config file and rendered config behind the disclosure. -->
{#snippet agentRow(entry: HookAgentEntry, host?: string)}
  {@const stuck = blocked(entry)}
  {@const name = backendAgentName(entry.id)}
  {@const key = keyOf(entry.id, host)}
  <AgentSettingsRow
    logo={backendAgentLogo(entry.id)}
    {name}
    description={agentDesc(entry.id)}
    path={entry.configPath}
    note={stuck
      ? entry.status.detail || i18n.t("hooks.statusUnavailable")
      : !entry.status.fileExists && !entry.status.installed
        ? i18n.t("hooks.statusMissing")
        : undefined}
    noteTone={stuck ? "warning" : "muted"}
    detailsLabel={i18n.t("hooks.showConfig")}
    onDetailsOpen={(open) => loadConfig(entry.id, open, host)}
  >
    {#snippet control()}
      {#if busy === key}
        <Spinner aria-label={i18n.t("common.loading")} />
      {/if}
      <Switch
        checked={entry.status.installed}
        disabled={busy !== null || degraded || stuck || (!entry.status.installed && !featureOn)}
        aria-label={host
          ? i18n.t("hooks.toggleHostAria", { agent: name, host: hosts.labelOf(host) })
          : i18n.t("hooks.toggleAria", { agent: name })}
        onCheckedChange={(c) => act(entry.id, c ? "install" : "uninstall", host)}
      />
    {/snippet}
    {#snippet details()}
      <CodeBlock value={configTexts[key] ?? ""} copyLabel={i18n.t("hooks.copy")} />
    {/snippet}
  </AgentSettingsRow>
{/snippet}

<div class="flex flex-col gap-6">
  {#if degraded}
    <p class={cn("px-1", text.meta)}>{i18n.t("settings.detecting")}</p>
  {/if}

  <!-- The feature's power: one switch that installs / removes every reporter. -->
  <div class={panel.settingsBody}>
    <SettingsRow
      label={i18n.t("hooks.autoInstall")}
      description={i18n.t("hooks.autoInstallDesc")}
    >
      {#snippet control()}
        <div class="flex items-center gap-2">
          {#if busy === "all"}
            <Spinner aria-label={i18n.t("common.loading")} />
            <span class={text.meta}>
              {busyOperation === "uninstall"
                ? i18n.t("hooks.uninstalling")
                : i18n.t("hooks.installing")}
            </span>
          {/if}
          <Switch
            checked={app.settings.autoInstallHooks}
            disabled={busy !== null || degraded}
            aria-label={i18n.t("hooks.autoInstall")}
            onCheckedChange={toggleAllHooks}
          />
        </div>
      {/snippet}
    </SettingsRow>
  </div>

  {#if !featureOn && !degraded}
    <p class={cn("-mt-3 px-1", text.meta)}>{i18n.t("hooks.enableToManage")}</p>
  {/if}

  <!-- The agents of the machine picked — this one by default. -->
  <div class="space-y-2">
    {#if machines.length > 1}
      <div class="px-1">
        <Select.Root type="single" value={machine} onValueChange={(v) => v && pick(v)}>
          <Select.Trigger
            size="sm"
            class={field.selectStandard}
            aria-label={i18n.t("hooks.machineAria")}
          >
            <span class="truncate">{machineLabel(machine)}</span>
          </Select.Trigger>
          <Select.Content>
            {#each machines as id (id)}
              <Select.Item value={id} label={machineLabel(id)}>{machineLabel(id)}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        {#if !onThisMachine}<p class={cn("mt-1", text.meta)}>{i18n.t("hooks.hostDesc")}</p>{/if}
      </div>
    {:else if mine.length > 0}
      {@render groupHeader(i18n.t("hooks.groupInstalled"))}
    {/if}

    {#if onThisMachine}
      {#if mine.length > 0}
        <div class={panel.settingsBody}>
          <div class="divide-y divide-border/60">
            {#each mine as entry (entry.id)}
              {@render agentRow(entry)}
            {/each}
          </div>
        </div>
      {/if}
    {:else if hostLoading}
      <div class={cn("flex items-center gap-2 px-1", text.meta)}>
        <Spinner aria-label={i18n.t("common.loading")} />
        {i18n.t("hooks.hostReading")}
      </div>
    {:else if hostError}
      <p class={cn("px-1", text.meta)}>{hostError}</p>
    {:else if onHost(hostAgents).length === 0}
      <p class={cn("px-1", text.meta)}>{i18n.t("hooks.hostNone")}</p>
    {:else}
      <div class={panel.settingsBody}>
        <div class="divide-y divide-border/60">
          {#each onHost(hostAgents) as entry (entry.id)}
            {@render agentRow(entry, machine)}
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- Everything else, folded: a reporter can be installed before its CLI is. -->
  {#if onThisMachine && others.length > 0}
    <Collapsible.Root bind:open={othersOpen} class="space-y-2">
      <Collapsible.Trigger
        class={cn(
          "flex min-h-8 items-center gap-1.5 rounded-md px-1 hover:bg-muted/60",
          focus.ring,
        )}
      >
        <Icon
          icon={ChevronDownIcon}
          class={cn(
            icon.decorative,
            "text-muted-foreground transition-transform",
            othersOpen && "rotate-180",
          )}
        />
        <span class={text.section}>{i18n.t("hooks.groupOthers")}</span>
        <span class={cn("tabular-nums text-muted-foreground/70", text.indicator)}>
          {others.length}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content class="space-y-2">
        <p class={cn("px-1", text.meta)}>{i18n.t("hooks.notOnThisMachine")}</p>
        <div class={panel.settingsBody}>
          <div class="divide-y divide-border/60">
            {#each others as entry (entry.id)}
              {@render agentRow(entry)}
            {/each}
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}

  <!-- Generic wrapper: bash / PowerShell / cmd / fish, one per platform. Its
       paths are this machine's, so it is shown with this machine's agents. -->
  {#if onThisMachine}
    <div class="space-y-2">
      {@render groupHeader(i18n.t("hooks.wrapperTitle"), i18n.t("hooks.wrapperDesc"))}
      <div class={panel.settingsBody}>
        <div class="flex flex-col gap-2">
          {#if install}
            <p class={cn("truncate font-mono", text.meta)}>
              {i18n.t("hooks.installedAt", { path: install.dir })}
            </p>
          {/if}
          <div class="flex flex-wrap items-center gap-1">
            {#each PLATFORMS as p (p.id)}
              <Button
                variant={platform === p.id ? "secondary" : "outline"}
                size="sm"
                onclick={() => (platform = p.id)}
              >
                {p.label}
              </Button>
            {/each}
          </div>
          <p class={cn("font-mono", text.meta)}>{wrapperUsage}</p>
          <CodeBlock value={wrapperScript} copyLabel={i18n.t("hooks.copy")} />
        </div>
      </div>
    </div>
  {/if}
</div>
