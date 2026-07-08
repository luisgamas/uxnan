<script lang="ts">
  // Status-bar usage indicator: a gauge icon that opens a popover with the
  // providers + windows the user chose to surface (Settings → Providers → Status
  // bar). Mirrors the backend indicator's shape (icon trigger → top-aligned
  // popover). Hidden entirely when the feature is off or nothing is pinned.
  import * as Popover from "$lib/components/ui/popover";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { app } from "$lib/state/app.svelte";
  import { usage } from "$lib/state/usage.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { usageProvider } from "$lib/usageCatalog";
  import { formatCredit } from "$lib/usageFormat";
  import type { ProviderUsage, UsageProviderConfig, UsageWindow } from "$lib/types";
  import AgentLogo from "./AgentLogo.svelte";
  import UsageMeter from "./UsageMeter.svelte";
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SettingsIcon from "@lucide/svelte/icons/settings";

  // Providers pinned to the status bar, in configured order.
  const pinned = $derived(
    (app.settings.usageProviders ?? []).filter((c) => c.statusBar?.show),
  );
  const enabled = $derived(app.settings.usageStatusBarEnabled !== false && pinned.length > 0);

  /** Resolve the windows a config chose to show against its snapshot. The `*`
   *  sentinel means "the primary (first) window". */
  function shownWindows(config: UsageProviderConfig, snap: ProviderUsage | undefined): UsageWindow[] {
    if (!snap || snap.windows.length === 0) return [];
    const picks = config.statusBar.windows ?? [];
    if (picks.includes("*")) {
      const first = snap.windows[0];
      const extras = snap.windows.filter((w) => w.id !== first.id && picks.includes(w.id));
      return [first, ...extras];
    }
    return snap.windows.filter((w) => picks.includes(w.id));
  }

  // Worst used-% across everything shown → the icon's tint (calm/amber/red).
  const worst = $derived.by(() => {
    let max = 0;
    for (const c of pinned) {
      for (const w of shownWindows(c, usage.byProvider[c.provider])) {
        max = Math.max(max, w.usedPercent);
      }
    }
    return max;
  });
  const iconTint = $derived(
    worst >= 90
      ? "text-destructive"
      : worst >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground",
  );

  // Controlled so navigating to settings can close it explicitly.
  let open = $state(false);
  function onOpenChange(next: boolean) {
    if (next) void usage.ensureFresh();
  }
</script>

{#if enabled}
  <Popover.Root bind:open {onOpenChange}>
    <TooltipSimple title={i18n.t("providers.statusBarTooltip")}>
      {#snippet children(tp)}
        <Popover.Trigger
          {...tp}
          class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label={i18n.t("providers.statusBarTooltip")}
        >
          <GaugeIcon class={cn("size-3.5", iconTint)} />
        </Popover.Trigger>
      {/snippet}
    </TooltipSimple>
    <Popover.Content align="end" side="top" class="w-72 p-0">
      <div class="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div class="min-w-0 space-y-0.5">
          <div class="text-sm font-medium leading-tight text-foreground">{i18n.t("providers.usageTitle")}</div>
          <div class={text.meta}>{i18n.t("providers.usedCaption")}</div>
        </div>
        <TooltipSimple title={i18n.t("providers.refreshNow")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon-sm"
              disabled={usage.loading}
              aria-label={i18n.t("providers.refreshNow")}
              onclick={() => void usage.refresh()}
            >
              <RefreshCwIcon class={cn("size-3.5", usage.loading && "animate-spin")} />
            </Button>
          {/snippet}
        </TooltipSimple>
      </div>

      <div class="scrollbar-sleek flex max-h-80 flex-col divide-y divide-border/50 overflow-y-auto px-3">
        {#each pinned as config (config.provider)}
          {@const meta = usageProvider(config.provider)}
          {@const snap = usage.byProvider[config.provider]}
          {@const windows = shownWindows(config, snap)}
          <div class="flex flex-col gap-1.5 py-2.5">
            <div class="flex items-center gap-1.5">
              <AgentLogo logo={meta?.logo ?? config.provider} class="size-3.5" />
              <span class={cn("truncate text-foreground", text.body)}>{meta?.name ?? config.provider}</span>
              {#if config.statusBar.showPlan && snap?.account?.plan}
                <span class="ml-auto truncate text-[11px] text-muted-foreground">{snap.account.plan}</span>
              {/if}
            </div>
            {#if windows.length > 0}
              {#each windows as w (w.id)}
                <UsageMeter window={w} compact />
              {/each}
            {:else}
              <span class={text.meta}>{i18n.t("providers.noData")}</span>
            {/if}
            {#if config.statusBar.showCredit && snap?.credit}
              <span class="font-mono text-[11px] text-muted-foreground">
                {formatCredit(snap.credit.used, snap.credit.currency)}
                {#if snap.credit.limit != null}&nbsp;/&nbsp;{formatCredit(snap.credit.limit, snap.credit.currency)}{/if}
              </span>
            {/if}
          </div>
        {/each}
      </div>

      <button
        type="button"
        class="flex w-full items-center gap-1.5 border-t border-border/60 px-3 py-2 text-muted-foreground hover:text-foreground {text.meta}"
        onclick={() => {
          open = false;
          app.openSettings("providers");
        }}
      >
        <SettingsIcon class="size-3.5" />
        {i18n.t("providers.manage")}
      </button>
    </Popover.Content>
  </Popover.Root>
{/if}
