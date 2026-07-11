<script lang="ts">
  // Settings → Agents → Hooks. Out-of-the-box reporters that POST precise agent
  // states to the ADE's local hook server, so the sidebar / tab bar show
  // working / waiting / done / blocked without manual setup.
  //
  // Layout: one master card carries the "Install agent hooks" switch (the
  // feature's power) *and* a tab per supported agent (Claude Code, Codex, Gemini
  // CLI, OpenCode, Pi) — line tabs, same primitive + style as the right panel —
  // so each agent's status + install/uninstall live in its own pane instead of a
  // stack of cards. The generic wrapper (for any other CLI) is a separate card.
  // Per-agent actions are gated by the master switch: Install is available only
  // when the feature is on, Uninstall is always available so you can clean up.
  // See `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md` §1.1.

  import { onMount } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import * as Card from "$lib/components/ui/card";
  import { app } from "$lib/state/app.svelte";
  import {
    getClaudeHooksStatus,
    getCodexHooksStatus,
    getGeminiHooksStatus,
    getPiHooksStatus,
    getOpencodeHooksStatus,
    getHookInstall,
    getHookScripts,
    installClaudeHooks,
    uninstallClaudeHooks,
    installCodexHooks,
    uninstallCodexHooks,
    installGeminiHooks,
    uninstallGeminiHooks,
    installPiHooks,
    uninstallPiHooks,
    installOpencodeHooks,
    uninstallOpencodeHooks,
    installAllHooks,
  } from "$lib/api";
  import type { AgentHooksStatus, HookInstall, HookScripts } from "$lib/types";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { clipboardWrite } from "$lib/clipboard";
  import { icon, iconButton, tab as tabStyle, text } from "$lib/design";
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

  type AgentId = "claude" | "codex" | "gemini" | "opencode" | "pi";
  const AGENTS: AgentId[] = ["claude", "codex", "gemini", "opencode", "pi"];

  /** Short tab label (the tab strip stays compact); the full name + description
   *  live in the pane. */
  const SHORT: Record<AgentId, string> = {
    claude: "Claude",
    codex: "Codex",
    gemini: "Gemini",
    opencode: "OpenCode",
    pi: "Pi",
  };
  /** Catalog logo key for each agent (brand SVG → favicon → Bot fallback). */
  const LOGO: Record<AgentId, string> = {
    claude: "claudecode",
    codex: "codex",
    gemini: "gemini",
    opencode: "opencode",
    pi: "pi",
  };

  function agentTitle(id: AgentId): string {
    switch (id) {
      case "claude":
        return i18n.t("hooks.claudeTitle");
      case "codex":
        return i18n.t("hooks.codexTitle");
      case "gemini":
        return i18n.t("hooks.geminiTitle");
      case "opencode":
        return i18n.t("hooks.opencodeTitle");
      case "pi":
        return i18n.t("hooks.piTitle");
    }
  }
  function agentDesc(id: AgentId): string {
    switch (id) {
      case "claude":
        return i18n.t("hooks.claudeDesc");
      case "codex":
        return i18n.t("hooks.codexDesc");
      case "gemini":
        return i18n.t("hooks.geminiDesc");
      case "opencode":
        return i18n.t("hooks.opencodeDesc");
      case "pi":
        return i18n.t("hooks.piDesc");
    }
  }

  let install = $state<HookInstall | null>(null);
  let scripts = $state<HookScripts | null>(null);
  let statuses = $state<Record<AgentId, AgentHooksStatus | null>>({
    claude: null,
    codex: null,
    gemini: null,
    opencode: null,
    pi: null,
  });
  let busy = $state<AgentId | "all" | null>(null);
  let activeAgent = $state<AgentId>("claude");
  let showClaudeJson = $state(false);
  let platform = $state<Platform>("bash");
  let copied = $state<Record<string, boolean>>({});

  const degraded = $derived(install === null);
  /** The feature is "on" (the master switch) and usable — gates Install. */
  const featureOn = $derived(app.settings.autoInstallHooks !== false && !degraded);

  const GETTERS: Record<AgentId, () => Promise<AgentHooksStatus>> = {
    claude: getClaudeHooksStatus,
    codex: getCodexHooksStatus,
    gemini: getGeminiHooksStatus,
    opencode: getOpencodeHooksStatus,
    pi: getPiHooksStatus,
  };
  const INSTALLERS: Record<AgentId, () => Promise<AgentHooksStatus>> = {
    claude: installClaudeHooks,
    codex: installCodexHooks,
    gemini: installGeminiHooks,
    opencode: installOpencodeHooks,
    pi: installPiHooks,
  };
  const UNINSTALLERS: Record<AgentId, () => Promise<AgentHooksStatus>> = {
    claude: uninstallClaudeHooks,
    codex: uninstallCodexHooks,
    gemini: uninstallGeminiHooks,
    opencode: uninstallOpencodeHooks,
    pi: uninstallPiHooks,
  };

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
    for (const id of AGENTS) {
      try {
        statuses = { ...statuses, [id]: await GETTERS[id]() };
      } catch {
        statuses = { ...statuses, [id]: null };
      }
    }
  }

  function statusFor(id: AgentId): AgentHooksStatus | null {
    return statuses[id] ?? null;
  }

  async function doInstall(id: AgentId) {
    busy = id;
    try {
      statuses = { ...statuses, [id]: await INSTALLERS[id]() };
    } catch (err) {
      statuses = {
        ...statuses,
        [id]: {
          installed: false,
          fileExists: statusFor(id)?.fileExists ?? false,
          unavailable: true,
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      busy = null;
    }
  }

  async function doUninstall(id: AgentId) {
    busy = id;
    try {
      statuses = { ...statuses, [id]: await UNINSTALLERS[id]() };
    } catch (err) {
      statuses = {
        ...statuses,
        [id]: {
          installed: statusFor(id)?.installed ?? false,
          fileExists: statusFor(id)?.fileExists ?? true,
          unavailable: true,
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      busy = null;
    }
  }

  /** Master switch: installs / uninstalls every agent and persists the
   *  preference so an uninstall isn't re-added on the next launch. */
  async function toggleAllHooks(on: boolean) {
    app.settings.autoInstallHooks = on;
    void app.persistSettings();
    if (on) {
      busy = "all";
      try {
        await installAllHooks();
      } finally {
        busy = null;
      }
      await refreshAll();
    } else {
      for (const id of AGENTS) await doUninstall(id);
    }
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

  function badge(id: AgentId) {
    const s = statusFor(id);
    if (!s) return { variant: "secondary" as const, label: i18n.t("settings.detecting") };
    if (s.unavailable && !s.installed)
      return { variant: "destructive" as const, label: i18n.t("hooks.statusUnavailable") };
    if (s.installed)
      return { variant: "secondary" as const, label: i18n.t("hooks.statusInstalledShort") };
    if (!s.fileExists) return { variant: "outline" as const, label: i18n.t("hooks.statusMissing") };
    return { variant: "outline" as const, label: i18n.t("hooks.statusNotInstalled") };
  }

  /** Colored dot on a tab, telling installed / attention / not-installed apart. */
  function tone(id: AgentId): string {
    const s = statusFor(id);
    if (!s) return "bg-muted-foreground/30";
    if (s.installed) return "bg-emerald-500";
    if (s.unavailable) return "bg-amber-500";
    return "bg-muted-foreground/40";
  }

  const configPath = (id: AgentId): string => {
    if (!install) return "";
    switch (id) {
      case "claude":
        return install.claudeSettingsPath;
      case "codex":
        return install.codexHooksPath;
      case "gemini":
        return install.geminiSettingsPath;
      case "opencode":
        return install.opencodePluginPath;
      case "pi":
        return install.piExtensionPath;
    }
  };

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

<div class="flex flex-col gap-4">
  {#if degraded}
    <p class={text.meta}>{i18n.t("settings.detecting")}</p>
  {/if}

  <!-- Master container: the "Install agent hooks" switch + a tab per agent. -->
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
      <Tabs.Root bind:value={activeAgent} class="flex w-full flex-col gap-0">
        <!-- Line tabs (same style as the right panel): brand logo + short name
             + a status dot, over a hairline. -->
        <Tabs.List
          class="h-9 w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b border-border/60 bg-transparent px-0 py-0"
        >
          {#each AGENTS as id (id)}
            <Tabs.Trigger
              value={id}
              class={cn(
                "shrink-0 gap-1.5 whitespace-nowrap px-2.5 text-[13px]",
                tabStyle.base,
                activeAgent === id ? tabStyle.activeLine : tabStyle.inactiveLine,
              )}
            >
              <AgentLogo logo={LOGO[id]} class={icon.decorative} />
              {SHORT[id]}
              <span class={cn("size-1.5 shrink-0 rounded-full", tone(id))}></span>
            </Tabs.Trigger>
          {/each}
        </Tabs.List>

        {#each AGENTS as id (id)}
          {@const b = badge(id)}
          <Tabs.Content value={id} class="pt-4">
            <div class="flex flex-col gap-3">
              <!-- Name + status badge -->
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class={text.subheading}>{agentTitle(id)}</span>
                  <span class={text.meta}>{agentDesc(id)}</span>
                </div>
                <Badge variant={b.variant} class="shrink-0">{b.label}</Badge>
              </div>

              <!-- Config path -->
              {#if install}
                <p class={cn("truncate font-mono", text.meta)}>{configPath(id)}</p>
              {/if}

              <!-- Actions + gating hint -->
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  size="xs"
                  variant={statusFor(id)?.installed ? "outline" : "secondary"}
                  disabled={busy !== null || !featureOn}
                  onclick={() => doInstall(id)}
                >
                  {busy === id ? i18n.t("hooks.installing") : i18n.t("hooks.install")}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy !== null || !statusFor(id)?.installed}
                  onclick={() => doUninstall(id)}
                >
                  {i18n.t("hooks.uninstall")}
                </Button>
                {#if !featureOn && !degraded}
                  <span class={text.meta}>{i18n.t("hooks.enableToManage")}</span>
                {/if}
              </div>

              <!-- Claude: inspect / copy the exact JSON block -->
              {#if id === "claude" && scripts}
                <Collapsible.Root bind:open={showClaudeJson}>
                  <Collapsible.Trigger
                    class={cn(
                      "flex items-center gap-1 self-start rounded-md px-1.5 py-1 hover:bg-muted",
                      text.meta,
                    )}
                  >
                    <ChevronDownIcon
                      class={cn(icon.button, "transition-transform", showClaudeJson && "rotate-180")}
                    />
                    {showClaudeJson ? i18n.t("hooks.hideJson") : i18n.t("hooks.showJson")}
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
                            onclick={() => copy("claude-json", scripts?.claudeJson ?? "")}
                          >
                            {#if copied["claude-json"]}
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
                        )}>{scripts.claudeJson ?? "…"}</pre>
                    </div>
                  </Collapsible.Content>
                </Collapsible.Root>
              {/if}
            </div>
          </Tabs.Content>
        {/each}
      </Tabs.Root>
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
