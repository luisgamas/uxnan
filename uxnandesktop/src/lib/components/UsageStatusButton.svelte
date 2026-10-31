<script lang="ts">
  // Status-bar usage indicator: a gauge icon that opens a popover with the
  // providers + windows the user chose to surface (Settings → Providers → Status
  // bar). Mirrors the backend indicator's shape (icon trigger → top-aligned
  // popover). Hidden entirely when the feature is off or nothing is pinned.
  //
  // Each provider is one block: its name and plan, then one line per window
  // (name · track · used-% · when it resets), then its money and its resets
  // when it has any. Every part is optional and simply absent when the
  // provider does not report it, so a provider with less data is a shorter
  // block, never an empty slot.
  import * as Popover from "$lib/components/ui/popover";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { app } from "$lib/state/app.svelte";
  import { usage } from "$lib/state/usage.svelte";
  import { resourceMode } from "$lib/state/resourceMode.svelte";
  import FreshnessHint from "./FreshnessHint.svelte";
  import { cn } from "$lib/utils";
  import { divider, icon as iconSize, overlay, shell, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { resolveStatusBarWindows, usageProvider } from "$lib/usageCatalog";
  import { formatReset, statusMeta } from "$lib/usageFormat";
  import { balanceLabel, formatBalanceFigure } from "$lib/usageLabels";
  import type { ProviderUsage, UsageProvider, UsageProviderConfig, UsageWindow } from "$lib/types";
  import RedeemResetDialog from "./RedeemResetDialog.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import StatusDot from "./StatusDot.svelte";
  import UsageMeter from "./UsageMeter.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import WalletIcon from "@hugeicons/core-free-icons/Wallet01Icon";
  import ResetIcon from "@hugeicons/core-free-icons/RotateClockwiseIcon";
  import { Icon } from "$lib/components/ui/icon";
  import GaugeIcon from "@hugeicons/core-free-icons/GaugeIcon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
  import {
    shouldPreventStatusPopoverAutoFocus,
    type StatusPopoverCloseReason,
  } from "./status-popover-focus";

  // Providers pinned to the status bar, in configured order.
  const pinned = $derived(
    (app.settings.usageProviders ?? []).filter((c) => c.statusBar?.show),
  );
  const enabled = $derived(app.settings.usageStatusBarEnabled !== false && pinned.length > 0);

  /** The windows a config chose to show, resolved against its snapshot. */
  function shownWindows(config: UsageProviderConfig, snap: ProviderUsage | undefined): UsageWindow[] {
    return resolveStatusBarWindows(config.statusBar.windows, snap?.windows);
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
  // The provider whose reset is being confirmed, if any (the dialog only asks;
  // nothing is redeemed until its confirm button is pressed).
  let redeemFor = $state<UsageProvider | null>(null);
  let redeemOpen = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let contentRef = $state<HTMLElement | null>(null);
  let statusTooltipOpen = $state(false);
  let refreshTooltipOpen = $state(false);
  let closeReason = $state<StatusPopoverCloseReason>("programmatic");

  function closeTooltips(): void {
    statusTooltipOpen = false;
    refreshTooltipOpen = false;
  }

  function onOpenChange(next: boolean) {
    if (next) {
      closeReason = "programmatic";
      closeTooltips();
      void usage.ensureFresh();
    }
  }

  function onInteractOutside(event?: PointerEvent): void {
    closeReason = "outside";
    open = false;
    const target = event?.target;
    if (target instanceof HTMLElement) queueMicrotask(() => target.focus());
  }

  // Bits UI owns the normal dismissible layer. This window fallback keeps the
  // pointer-to-terminal handoff deterministic when the host WebView targets a
  // native surface outside the DOM tree.
  function onWindowPointerDown(event: PointerEvent): void {
    if (!open || !contentRef || !triggerRef) return;
    const target = event.target;
    if (target instanceof Node && !contentRef.contains(target) && !triggerRef.contains(target)) {
      onInteractOutside(event);
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#if enabled}
  <Popover.Root bind:open {onOpenChange}>
    <TooltipSimple bind:open={statusTooltipOpen} title={i18n.t("providers.statusBarTooltip")}>
      {#snippet children(tp)}
        <Popover.Trigger
          bind:ref={triggerRef}
          {...tp}
          class={cn(
            shell.statusBarAction,
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          aria-label={i18n.t("providers.statusBarTooltip")}
        >
          <Icon icon={GaugeIcon} class={cn(iconSize.action, iconTint)} />
        </Popover.Trigger>
      {/snippet}
    </TooltipSimple>
    <Popover.Content
      bind:ref={contentRef}
      align="end"
      side="top"
      width="statusWide"
      padding="none"
      onInteractOutside={onInteractOutside}
      onEscapeKeydown={() => (closeReason = "escape")}
      onCloseAutoFocus={(event) => {
        closeTooltips();
        if (shouldPreventStatusPopoverAutoFocus(closeReason)) {
          event.preventDefault();
        } else {
          // The trigger is wrapped by TooltipSimple; keep Bits' default restoration
          // and repair the nested-scope fallback if it lands on document.body.
          queueMicrotask(() => triggerRef?.focus());
        }
      }}
    >
      <div class="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div class="min-w-0 space-y-0.5">
          <div class={cn(text.subheading, "leading-tight text-foreground")}>{i18n.t("providers.usageTitle")}</div>
          <div class={text.meta}>{i18n.t("providers.popoverCaption")}</div>
        </div>
        <span class="flex items-center gap-0.5">
          {#if resourceMode.freshness.usage}
            <FreshnessHint
              label={i18n.t("resourceMode.freshness.usage")}
              onrefresh={() => void usage.refresh()}
            />
          {/if}
          <TooltipSimple bind:open={refreshTooltipOpen} title={i18n.t("providers.refreshNow")}>
            {#snippet children(tp)}
              <Button
                {...tp}
                variant="ghost"
                size="icon-sm"
                disabled={usage.loading}
                aria-label={i18n.t("providers.refreshNow")}
                onclick={() => void usage.refresh()}
              >
                {#if usage.loading}
                  <Spinner class={iconSize.action} />
                {:else}
                  <Icon icon={RefreshCwIcon} class={iconSize.action} />
                {/if}
              </Button>
            {/snippet}
          </TooltipSimple>
        </span>
      </div>

      <div class="scrollbar-sleek flex max-h-[min(34rem,calc(100vh-11rem))] flex-col divide-y divide-border/50 overflow-y-auto px-3">
        {#each pinned as config (config.provider)}
          {@const meta = usageProvider(config.provider)}
          {@const snap = usage.byProvider[config.provider]}
          {@const windows = shownWindows(config, snap)}
          {@const status = snap ? statusMeta(snap.status) : null}
          <section class="flex flex-col gap-1 py-2.5" aria-label={meta?.name ?? config.provider}>
            <div class="flex min-h-6 min-w-0 items-center gap-2">
              <AgentLogo logo={meta?.logo ?? config.provider} class={cn(iconSize.decorative, "shrink-0")} />
              <span class={cn("min-w-0 shrink truncate font-medium text-foreground", text.body)}>{meta?.name ?? config.provider}</span>
              {#if snap?.account?.plan}
                <Badge variant="outline" class="max-w-40 shrink-0 truncate text-muted-foreground">{snap.account.plan}</Badge>
              {/if}
              {#if status && snap?.status !== "ok"}
                <span class="ml-auto flex shrink-0 items-center gap-1.5">
                  <StatusDot tone={status.tone} />
                  <span class={text.meta}>{i18n.t(status.labelKey)}</span>
                </span>
              {/if}
            </div>
            {#if windows.length > 0}
              <div class="flex flex-col gap-0.5 pl-6">
                {#each windows as w (w.id)}
                  <UsageMeter window={w} variant="row" />
                {/each}
              </div>
            {:else if !snap || snap.status === "ok"}
              <!-- Read fine, but the account has nothing to meter (an OpenCode
                   workspace with no Go plan, say): say so instead of "No data". -->
              <span class={cn("pl-6", text.meta)}>
                {snap?.status === "ok" ? i18n.t("providers.noQuota") : i18n.t("providers.noData")}
              </span>
            {:else if snap.message}
              <span class={cn("line-clamp-2 pl-6", text.meta)} title={snap.message}>{snap.message}</span>
            {/if}
            {#each snap?.credits ?? [] as balance, i (i)}
              {@const balanceReset = formatReset(balance.resetsAt)}
              <div class={cn("flex min-w-0 items-center gap-1.5 pl-6 text-muted-foreground", text.meta)}>
                <Icon icon={WalletIcon} class={cn(iconSize.status, "shrink-0")} />
                <span class="shrink-0 font-mono tabular-nums text-foreground">{formatBalanceFigure(balance)}</span>
                <span class="min-w-0 truncate">
                  · {balanceLabel(balance)}{#if balanceReset}&nbsp;· {i18n.t("providers.resetsIn")} {balanceReset}{/if}
                </span>
              </div>
            {/each}
            {#if snap?.resetCredits && snap.resetCredits.available > 0}
              {@const resets = snap.resetCredits}
              {@const nextExpiry = formatReset(resets.nextExpiresAt ?? resets.entries?.[0]?.expiresAt)}
              <div class={cn("flex min-w-0 items-center gap-1.5 pl-6 text-muted-foreground", text.meta)}>
                <Icon icon={ResetIcon} class={cn(iconSize.status, "shrink-0")} />
                <span class="min-w-0 truncate">
                  {i18n.t("providers.resets")}: {i18n.t("providers.resetsCount", { count: resets.available })}{#if nextExpiry}&nbsp;· {i18n.t("providers.resetsNextExpires", { time: nextExpiry })}{/if}
                </span>
                {#if !resets.redeemCommand}
                  <Button
                    variant="outline"
                    size="xs"
                    class="ml-auto shrink-0"
                    onclick={() => {
                      // The dialog lives outside the popover; close the popover
                      // so the confirmation is the one thing on screen.
                      closeReason = "navigation";
                      open = false;
                      redeemFor = config.provider;
                      redeemOpen = true;
                    }}
                  >
                    {i18n.t("providers.useReset")}
                  </Button>
                {/if}
              </div>
              {#if resets.redeemCommand}
                <span class={cn("pl-6 text-muted-foreground", text.meta)}>
                  {i18n.t("providers.redeemInCli", { cli: meta?.cli ?? config.provider, command: resets.redeemCommand })}
                </span>
              {/if}
            {/if}
          </section>
        {/each}
      </div>

      <Button
        variant="ghost"
        class={cn(
          // Full-bleed band at the popover's foot: its top hairline replaces
          // the button's own border, and only its bottom corners follow the
          // popover's radius so the hover fill stays inside the surface.
          "h-auto w-full justify-start gap-1.5 rounded-t-none border-0 px-3 py-2 font-normal",
          divider.top,
          text.meta,
        )}
        onclick={() => {
          closeReason = "navigation";
          open = false;
          app.openSettings("providers");
        }}
      >
        <Icon icon={SettingsIcon} class={iconSize.decorative} />
        {i18n.t("providers.manage")}
      </Button>
    </Popover.Content>
  </Popover.Root>
{/if}

{#if redeemFor}
  <RedeemResetDialog bind:open={redeemOpen} provider={redeemFor} resets={usage.byProvider[redeemFor]?.resetCredits} />
{/if}
