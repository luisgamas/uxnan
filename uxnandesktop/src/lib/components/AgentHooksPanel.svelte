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
  // listed first; the rest sit in a collapsed group. Per-agent installs are gated
  // by the master switch (install only when the feature is on, uninstall always,
  // so you can always clean up). The list comes from the backend registry —
  // wiring a new agent never edits this file.
  // See `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md` §1.1.

  import { onMount } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Switch } from "$lib/components/ui/switch";
  import { app } from "$lib/state/app.svelte";
  import {
    getHookInstall,
    getHookScripts,
    installAgentHooks,
    installAllHooks,
    listAgentHooks,
    renderAgentHooksConfig,
    uninstallAgentHooks,
  } from "$lib/api";
  import type { HookAgentEntry, HookInstall, HookScripts } from "$lib/types";
  import { backendAgentLogo, backendAgentName } from "$lib/agentCatalog";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { clipboardWrite } from "$lib/clipboard";
  import { focus, icon, iconButton, panel, text } from "$lib/design";
  import AgentSettingsRow from "./AgentSettingsRow.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
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
  let busy = $state<string | null>(null);
  let busyOperation = $state<"install" | "uninstall" | null>(null);
  /** Rendered config per agent, filled when its row is opened — the rows keep
   *  their own disclosure state, so this is keyed rather than a single slot. */
  let configTexts = $state<Record<string, string>>({});
  let othersOpen = $state(false);
  let platform = $state<Platform>("bash");
  let copied = $state<Record<string, boolean>>({});

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
  }

  /** Load the exact config the ADE writes for one agent, on demand — rendering
   *  every agent's up front would be one round-trip each for a disclosure most
   *  users never open. Re-read on every open, so a row reopened after an install
   *  or uninstall shows what is on disk now. */
  async function loadConfig(id: string, open: boolean) {
    if (!open) return;
    configTexts = { ...configTexts, [id]: "" };
    try {
      const text = await renderAgentHooksConfig(id);
      configTexts = { ...configTexts, [id]: text };
    } catch (err) {
      configTexts = { ...configTexts, [id]: err instanceof Error ? err.message : String(err) };
    }
  }

  async function act(id: string, operation: "install" | "uninstall") {
    busy = id;
    busyOperation = operation;
    try {
      const status =
        operation === "install" ? await installAgentHooks(id) : await uninstallAgentHooks(id);
      agents = agents.map((a) => (a.id === id ? { ...a, status } : a));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      agents = agents.map((a) =>
        a.id === id ? { ...a, status: { ...a.status, unavailable: true, detail } } : a,
      );
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
    } finally {
      busy = null;
      busyOperation = null;
    }
    await refreshAll();
    void app.refreshHooksStatus();
  }

  async function copy(id: string, value: string) {
    if (!value) return;
    try {
      await clipboardWrite(value);
    } catch {
      return;
    }
    copied = { ...copied, [id]: true };
    setTimeout(() => {
      const next = { ...copied };
      delete next[id];
      copied = next;
    }, 1200);
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

<!-- A copyable script/config block: the shared shape for the per-agent config
     and the generic wrapper. -->
{#snippet codeBlock(key: string, value: string)}
  <div class="relative">
    <TooltipSimple title={i18n.t("hooks.copy")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          class={cn(iconButton.action, "absolute right-1 top-1 z-10")}
          onclick={() => copy(key, value)}
        >
          {#if copied[key]}
            <Icon icon={CheckIcon} class={icon.button} />
          {:else}
            <Icon icon={CopyIcon} class={icon.button} />
          {/if}
        </Button>
      {/snippet}
    </TooltipSimple>
    <pre
      class={cn(
        "scrollbar-sleek max-h-72 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2 pr-10",
        text.meta,
        "whitespace-pre font-mono",
      )}>{value || "…"}</pre>
  </div>
{/snippet}

{#snippet groupHeader(title: string, description?: string)}
  <div class="px-1">
    <span class={text.section}>{title}</span>
    {#if description}<p class={cn("mt-1", text.meta)}>{description}</p>{/if}
  </div>
{/snippet}

<!-- One agent: name + what its reporter reports, installed by the switch on the
     right, with its config file and rendered config behind the disclosure. -->
{#snippet agentRow(entry: HookAgentEntry)}
  {@const stuck = blocked(entry)}
  {@const name = backendAgentName(entry.id)}
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
    onDetailsOpen={(open) => loadConfig(entry.id, open)}
  >
    {#snippet control()}
      {#if busy === entry.id}
        <Spinner aria-label={i18n.t("common.loading")} />
      {/if}
      <Switch
        checked={entry.status.installed}
        disabled={busy !== null || degraded || stuck || (!entry.status.installed && !featureOn)}
        aria-label={i18n.t("hooks.toggleAria", { agent: name })}
        onCheckedChange={(c) => act(entry.id, c ? "install" : "uninstall")}
      />
    {/snippet}
    {#snippet details()}
      {@render codeBlock(`${entry.id}-config`, configTexts[entry.id] ?? "")}
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

  <!-- The agents you actually have, open. -->
  {#if mine.length > 0}
    <div class="space-y-2">
      {@render groupHeader(i18n.t("hooks.groupInstalled"))}
      <div class={panel.settingsBody}>
        <div class="divide-y divide-border/60">
          {#each mine as entry (entry.id)}
            {@render agentRow(entry)}
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Everything else, folded: a reporter can be installed before its CLI is. -->
  {#if others.length > 0}
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

  <!-- Generic wrapper: bash / PowerShell / cmd / fish, one per platform. -->
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
        {@render codeBlock(`wrapper-${platform}`, wrapperScript)}
      </div>
    </div>
  </div>
</div>
