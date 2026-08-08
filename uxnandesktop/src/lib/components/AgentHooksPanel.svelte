<script lang="ts">
  // Settings → Agents → Hooks. Out-of-the-box reporters that POST precise agent
  // states to the ADE's local hook server, so the sidebar / tab bar show
  // working / waiting / done / blocked without manual setup.
  //
  // Layout: one master card carries the "Install agent hooks" switch (the
  // feature's power) and a master–detail list — agents down the left, the
  // selected one's status + actions on the right. It replaced a tab strip, which
  // stopped working the moment the ADE could report for more agents than fit on
  // one line; the list also groups by whether the CLI is actually on this
  // machine, so the ones you use are the ones you see first. The generic wrapper
  // (for any other CLI) is a separate card. Per-agent actions are gated by the
  // master switch: Install only when the feature is on, Uninstall always, so you
  // can always clean up. The agent list itself comes from the backend registry —
  // wiring a new agent never edits this file.
  // See `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md` §1.1.

  import { onMount } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import * as Card from "$lib/components/ui/card";
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
  import { AGENT_CATALOG } from "$lib/agentCatalog";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { clipboardWrite } from "$lib/clipboard";
  import { icon, iconButton, text } from "$lib/design";
  import AgentLogo from "./AgentLogo.svelte";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";

  type Platform = "bash" | "powershell" | "cmd" | "fish";
  const PLATFORMS: { id: Platform; label: string }[] = [
    { id: "bash", label: "Bash" },
    { id: "powershell", label: "PowerShell" },
    { id: "cmd", label: "cmd" },
    { id: "fish", label: "fish" },
  ];

  /** The hook kind → the catalog id that carries its product name and logo. They
   *  are the same string for every agent but Claude Code, whose CLI is `claude`
   *  and whose catalog entry is `claudecode`. */
  function catalogId(id: string): string {
    return id === "claude" ? "claudecode" : id;
  }

  function agentName(id: string): string {
    return AGENT_CATALOG.find((c) => c.id === catalogId(id))?.name ?? id;
  }

  function agentLogo(id: string): string {
    return AGENT_CATALOG.find((c) => c.id === catalogId(id))?.logo ?? "";
  }

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
  let activeAgent = $state<string>("claude");
  let configOpen = $state(false);
  let configText = $state("");
  let platform = $state<Platform>("bash");
  let copied = $state<Record<string, boolean>>({});

  const degraded = $derived(install === null);
  /** The feature is "on" (the master switch) and usable — gates Install. */
  const featureOn = $derived(app.settings.autoInstallHooks !== false && !degraded);

  /** Agents this machine actually has, and the rest — two groups so a long list
   *  still opens on something meaningful. */
  const mine = $derived(agents.filter((a) => a.present));
  const others = $derived(agents.filter((a) => !a.present));
  const selected = $derived(agents.find((a) => a.id === activeAgent) ?? null);

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
    // Open on an agent the user actually has, rather than always on the first.
    if (mine.length > 0 && !mine.some((a) => a.id === activeAgent)) {
      activeAgent = mine[0].id;
    }
  });

  async function refreshAll() {
    try {
      agents = await listAgentHooks();
    } catch {
      agents = [];
    }
  }

  /** Load the exact config the ADE writes for the selected agent, on demand —
   *  rendering every agent's up front would be one round-trip each for a
   *  disclosure most users never open. */
  async function toggleConfig(open: boolean) {
    configOpen = open;
    if (!open) return;
    configText = "";
    try {
      configText = await renderAgentHooksConfig(activeAgent);
    } catch (err) {
      configText = err instanceof Error ? err.message : String(err);
    }
  }

  function selectAgent(id: string) {
    activeAgent = id;
    configOpen = false;
    configText = "";
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

  function badge(entry: HookAgentEntry | null) {
    if (!entry) return { variant: "secondary" as const, label: i18n.t("settings.detecting") };
    const s = entry.status;
    if (s.unavailable && !s.installed)
      return { variant: "destructive" as const, label: i18n.t("hooks.statusUnavailable") };
    if (s.installed)
      return { variant: "secondary" as const, label: i18n.t("hooks.statusInstalledShort") };
    if (!s.fileExists) return { variant: "outline" as const, label: i18n.t("hooks.statusMissing") };
    return { variant: "outline" as const, label: i18n.t("hooks.statusNotInstalled") };
  }

  /** Colored dot on a row, telling installed / attention / not-installed apart. */
  function tone(entry: HookAgentEntry): string {
    if (entry.status.installed) return "bg-emerald-500";
    if (entry.status.unavailable) return "bg-amber-500";
    return "bg-muted-foreground/40";
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

{#snippet agentRow(entry: HookAgentEntry)}
  <button
    type="button"
    onclick={() => selectAgent(entry.id)}
    class={cn(
      "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight transition-colors",
      activeAgent === entry.id
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    )}
  >
    <AgentLogo logo={agentLogo(entry.id)} class={icon.decorative} />
    <span class="min-w-0 flex-1 truncate">{agentName(entry.id)}</span>
    <span class={cn("size-1.5 shrink-0 rounded-full", tone(entry))}></span>
  </button>
{/snippet}

<div class="flex flex-col gap-4">
  {#if degraded}
    <p class={text.meta}>{i18n.t("settings.detecting")}</p>
  {/if}

  <!-- Master container: the "Install agent hooks" switch + the agent list. -->
  <Card.Root>
    <Card.Header class="gap-3">
      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 flex-col gap-1">
          <Card.Title class="flex items-center gap-2">
            <BotIcon class={icon.button} />
            {i18n.t("hooks.autoInstall")}
          </Card.Title>
          <Card.Description>{i18n.t("hooks.autoInstallDesc")}</Card.Description>
        </div>
        <div class="flex shrink-0 items-center gap-2 pt-0.5">
          {#if busy === "all"}
            <Spinner aria-label={i18n.t("common.loading")} />
            <span class={text.meta}>{i18n.t("hooks.installing")}</span>
          {/if}
          <Switch
            checked={app.settings.autoInstallHooks}
            disabled={busy !== null || degraded}
            onCheckedChange={toggleAllHooks}
          />
        </div>
      </div>
    </Card.Header>

    <Card.Content>
      <div class="flex gap-4">
        <!-- Agent list: the ones on this machine first, everything else after. -->
        <nav
          class="scrollbar-sleek max-h-[26rem] w-44 shrink-0 overflow-y-auto border-r border-border/50 pr-2"
          aria-label={i18n.t("hooks.agentListLabel")}
        >
          {#if mine.length > 0}
            <p
              class="flex h-8 items-center px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground"
            >
              {i18n.t("hooks.groupInstalled")}
            </p>
            {#each mine as entry (entry.id)}
              {@render agentRow(entry)}
            {/each}
          {/if}
          {#if others.length > 0}
            <p
              class="flex h-8 items-center px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground"
            >
              {i18n.t("hooks.groupOthers")}
            </p>
            {#each others as entry (entry.id)}
              {@render agentRow(entry)}
            {/each}
          {/if}
        </nav>

        <!-- Detail for the selected agent. -->
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          {#if selected}
            {@const b = badge(selected)}
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class={text.subheading}>{agentName(selected.id)}</span>
                <span class={text.meta}>{agentDesc(selected.id)}</span>
              </div>
              <Badge variant={b.variant} class="shrink-0">{b.label}</Badge>
            </div>

            {#if selected.configPath}
              <p class={cn("truncate font-mono", text.meta)}>{selected.configPath}</p>
            {/if}

            {#if !selected.present}
              <p class={text.meta}>{i18n.t("hooks.notOnThisMachine")}</p>
            {/if}

            <div class="flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant={selected.status.installed ? "outline" : "secondary"}
                disabled={busy !== null || !featureOn}
                onclick={() => act(selected.id, "install")}
              >
                {#if busy === selected.id && busyOperation === "install"}
                  <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                {/if}
                {busy === selected.id ? i18n.t("hooks.installing") : i18n.t("hooks.install")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy !== null || !selected.status.installed}
                onclick={() => act(selected.id, "uninstall")}
              >
                {#if busy === selected.id && busyOperation === "uninstall"}
                  <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                {/if}
                {i18n.t("hooks.uninstall")}
              </Button>
              {#if !featureOn && !degraded}
                <span class={text.meta}>{i18n.t("hooks.enableToManage")}</span>
              {/if}
            </div>

            <!-- Inspect / copy the exact config the ADE installs (a `hooks`
                 block for the config agents, the plugin/extension source for
                 OpenCode and Pi). -->
            <Collapsible.Root open={configOpen} onOpenChange={toggleConfig}>
              <Collapsible.Trigger
                class={cn(
                  "flex items-center gap-1 self-start rounded-md px-1.5 py-1 hover:bg-muted",
                  text.meta,
                )}
              >
                <ChevronDownIcon
                  class={cn(icon.button, "transition-transform", configOpen && "rotate-180")}
                />
                {configOpen ? i18n.t("hooks.hideConfig") : i18n.t("hooks.showConfig")}
              </Collapsible.Trigger>
              <Collapsible.Content>
                <div class="relative mt-2">
                  <TooltipSimple title={i18n.t("hooks.copy")}>
                    {#snippet children(tp)}
                      <Button
                        {...tp}
                        variant="ghost"
                        size="icon-sm"
                        class={cn(iconButton.action, "absolute right-1 top-1 z-10")}
                        onclick={() => copy(`${activeAgent}-config`, configText)}
                      >
                        {#if copied[`${activeAgent}-config`]}
                          <CheckIcon class={icon.button} />
                        {:else}
                          <CopyIcon class={icon.button} />
                        {/if}
                      </Button>
                    {/snippet}
                  </TooltipSimple>
                  <pre
                    class={cn(
                      "max-h-72 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2 pr-10",
                      text.meta,
                      "whitespace-pre font-mono",
                    )}>{configText || "…"}</pre>
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          {:else}
            <p class={text.meta}>{i18n.t("settings.detecting")}</p>
          {/if}
        </div>
      </div>
    </Card.Content>
  </Card.Root>

  <!-- Generic wrapper: bash / PowerShell / cmd / fish, one per platform. -->
  <Card.Root>
    <Card.Header class="pb-2">
      <Card.Title class="flex items-center gap-2">
        <TerminalIcon class={icon.button} />
        {i18n.t("hooks.wrapperTitle")}
      </Card.Title>
      <Card.Description>{i18n.t("hooks.wrapperDesc")}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-2">
      {#if install}
        <p class={cn("truncate font-mono", text.meta)}>
          {i18n.t("hooks.installedAt", { path: install.dir })}
        </p>
      {/if}
      <div class="flex flex-wrap items-center gap-1">
        {#each PLATFORMS as p (p.id)}
          <Button
            variant={platform === p.id ? "secondary" : "outline"}
            size="xs"
            onclick={() => (platform = p.id)}
          >
            {p.label}
          </Button>
        {/each}
      </div>
      <p class={cn("font-mono", text.meta)}>{wrapperUsage}</p>
      <div class="relative">
        <TooltipSimple title={i18n.t("hooks.copy")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon-sm"
              class={cn(iconButton.action, "absolute right-1 top-1 z-10")}
              onclick={() => copy(`wrapper-${platform}`, wrapperScript)}
            >
              {#if copied[`wrapper-${platform}`]}
                <CheckIcon class={icon.button} />
              {:else}
                <CopyIcon class={icon.button} />
              {/if}
            </Button>
          {/snippet}
        </TooltipSimple>
        <pre
          class={cn(
            "max-h-72 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2 pr-10",
            text.meta,
            "whitespace-pre font-mono",
          )}>{wrapperScript || "…"}</pre>
      </div>
    </Card.Content>
  </Card.Root>
</div>
