<script lang="ts">
  // Settings → Agents → Hooks. Out-of-the-box configs that POST precise
  // agent states to the ADE's local hook server, so the sidebar / tab bar
  // show working / waiting / done without manual setup. See
  // `docs/agent-hooks.md` and `architecture/02d-agent-monitoring.md` §1.1.

  import { onMount } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import * as Card from "$lib/components/ui/card";
  import { app } from "$lib/state/app.svelte";
  import {
    getClaudeHooksStatus,
    getHookInstall,
    getHookScripts,
    installClaudeHooks,
    uninstallClaudeHooks,
  } from "$lib/api";
  import type {
    ClaudeHooksStatus,
    HookInstall,
    HookScripts,
  } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { clipboardWrite } from "$lib/clipboard";
  import { icon, iconButton, text } from "$lib/design";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";

  type Platform = "bash" | "powershell" | "cmd";
  const PLATFORMS: { id: Platform; label: string }[] = [
    { id: "bash", label: "Bash" },
    { id: "powershell", label: "PowerShell" },
    { id: "cmd", label: "cmd" },
  ];

  let install = $state<HookInstall | null>(null);
  let scripts = $state<HookScripts | null>(null);
  let claudeStatus = $state<ClaudeHooksStatus | null>(null);
  let busy = $state<"install" | "uninstall" | null>(null);
  let showClaudeJson = $state(false);
  let platform = $state<Platform>("bash");
  // "copied" flash per copyable id (e.g. "claude-json", "wrapper-bash").
  let copied = $state<Record<string, boolean>>({});

  // `null` install means the startup step failed (the UI shows the wrapper
  // path label degraded). `null` status is the same — we treat both the
  // same: show a banner + disable install buttons.
  const degraded = $derived(install === null);
  const unavailable = $derived(
    claudeStatus?.unavailable === true && !claudeStatus?.installed,
  );

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
    await refreshClaudeStatus();
  });

  async function refreshClaudeStatus() {
    try {
      claudeStatus = await getClaudeHooksStatus();
    } catch {
      claudeStatus = null;
    }
  }

  async function doInstall() {
    busy = "install";
    try {
      claudeStatus = await installClaudeHooks();
    } catch (err) {
      // Surface as "unavailable" so the UI shows the error path.
      claudeStatus = {
        installed: false,
        fileExists: claudeStatus?.fileExists ?? false,
        unavailable: true,
        detail: err instanceof Error ? err.message : String(err),
      };
    } finally {
      busy = null;
    }
  }

  async function doUninstall() {
    busy = "uninstall";
    try {
      claudeStatus = await uninstallClaudeHooks();
    } catch (err) {
      claudeStatus = {
        installed: claudeStatus?.installed ?? false,
        fileExists: claudeStatus?.fileExists ?? true,
        unavailable: true,
        detail: err instanceof Error ? err.message : String(err),
      };
    } finally {
      busy = null;
    }
  }

  /** The hooks switch: installs/uninstalls now AND persists whether to keep them
   *  installed on startup, so an uninstall isn't re-added next launch. */
  async function toggleHooks(on: boolean) {
    app.settings.autoInstallHooks = on;
    void app.persistSettings();
    if (on) await doInstall();
    else await doUninstall();
    // Keep the global status-bar indicator in sync with this change.
    void app.refreshHooksStatus();
  }

  async function copy(id: string, text: string) {
    if (!text) return;
    try {
      await clipboardWrite(text);
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

  // Status badge for the Claude card. We never claim installed unless the
  // marker is actually present (we mirror the Rust `read_claude_status`).
  const claudeBadge = $derived.by(() => {
    if (!claudeStatus) {
      return { variant: "secondary" as const, label: i18n.t("settings.detecting") };
    }
    if (claudeStatus.unavailable && !claudeStatus.installed) {
      return {
        variant: "destructive" as const,
        label: i18n.t("hooks.claudeStatusUnavailable"),
      };
    }
    if (claudeStatus.installed) {
      return {
        variant: "secondary" as const,
        label: i18n.t("hooks.claudeStatusInstalled", {
          path: claudeStatus.detail,
        }),
      };
    }
    if (!claudeStatus.fileExists) {
      return {
        variant: "outline" as const,
        label: i18n.t("hooks.claudeStatusMissing"),
      };
    }
    return {
      variant: "outline" as const,
      label: i18n.t("hooks.claudeStatusNotInstalled"),
    };
  });

  const wrapperScript = $derived.by(() => {
    if (!scripts) return "";
    return platform === "bash"
      ? scripts.wrapperBash
      : platform === "powershell"
        ? scripts.wrapperPowershell
        : scripts.wrapperCmd;
  });
  const wrapperPath = $derived.by(() => {
    if (!install) return "";
    return platform === "bash"
      ? install.wrapperBash
      : platform === "powershell"
        ? install.wrapperPowershell
        : install.wrapperCmd;
  });
  const wrapperUsage = $derived(
    i18n.t("hooks.wrapperUsage", { script: wrapperPath || "<path>" }),
  );
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <span class={cn("font-medium", text.body)}>{i18n.t("hooks.title")}</span>
    <p class={text.meta}>{i18n.t("hooks.desc")}</p>
  </div>

  {#if degraded}
    <p class={text.meta}>
      {i18n.t("settings.detecting")}
    </p>
  {/if}

  <!-- Claude Code: install the ready-made `hooks` config in `~/.claude/settings.json`. -->
  <Card.Root>
    <Card.Header class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col gap-1">
          <Card.Title class="flex items-center gap-2">
            <BotIcon class={icon.button} />
            {i18n.t("hooks.claudeTitle")}
          </Card.Title>
          <Card.Description>{i18n.t("hooks.claudeDesc")}</Card.Description>
        </div>
        <Badge variant={claudeBadge.variant}>{claudeBadge.label}</Badge>
      </div>
    </Card.Header>
    <Card.Content class="flex flex-col gap-2">
      {#if install}
        <p class={cn("truncate font-mono", text.meta)}>
          {install.claudeSettingsPath}
        </p>
      {/if}
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class={text.subheading}>{i18n.t("hooks.autoInstall")}</span>
          <span class={text.meta}>
            {busy !== null
              ? i18n.t(busy === "install" ? "hooks.installing" : "hooks.uninstalling")
              : i18n.t("hooks.autoInstallDesc")}
          </span>
        </div>
        <Switch
          checked={claudeStatus?.installed ?? false}
          disabled={busy !== null || unavailable || degraded}
          onCheckedChange={toggleHooks}
        />
      </div>
      <Collapsible.Root bind:open={showClaudeJson}>
        <Collapsible.Trigger
          class={cn(
            "flex items-center gap-1 self-start rounded-md px-1.5 py-1 hover:bg-muted",
            text.meta,
          )}
        >
          <ChevronDownIcon
            class={cn(
              icon.button,
              "transition-transform",
              showClaudeJson && "rotate-180",
            )}
          />
          {showClaudeJson ? i18n.t("hooks.hideJson") : i18n.t("hooks.showJson")}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="relative mt-2">
            <Button
              variant="ghost"
              size="icon-sm"
              class={cn(iconButton.action, "absolute right-1 top-1 z-10")}
              title={i18n.t("hooks.copy")}
              onclick={() => scripts && copy("claude-json", scripts.claudeJson)}
            >
              {#if copied["claude-json"]}
                <CheckIcon class={icon.button} />
              {:else}
                <CopyIcon class={icon.button} />
              {/if}
            </Button>
            <pre
              class={cn(
                "max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 pr-10",
                text.meta,
                "whitespace-pre font-mono",
              )}>{scripts?.claudeJson ?? "…"}</pre>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </Card.Content>
  </Card.Root>

  <!-- Generic wrapper: bash / PowerShell / cmd, one per platform. -->
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
        <Button
          variant="ghost"
          size="icon-sm"
          class={cn(iconButton.action, "absolute right-1 top-1 z-10")}
          title={i18n.t("hooks.copy")}
          onclick={() => copy(`wrapper-${platform}`, wrapperScript)}
        >
          {#if copied[`wrapper-${platform}`]}
            <CheckIcon class={icon.button} />
          {:else}
            <CopyIcon class={icon.button} />
          {/if}
        </Button>
        <pre
          class={cn(
            "max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 pr-10",
            text.meta,
            "whitespace-pre font-mono",
          )}>{wrapperScript || "…"}</pre>
      </div>
    </Card.Content>
  </Card.Root>
</div>
