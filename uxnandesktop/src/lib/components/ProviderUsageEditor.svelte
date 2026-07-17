<script lang="ts">
  // The body of one provider's tab in Settings → Providers: its live usage data
  // (quota windows / credit / account) plus its refresh interval and status-bar
  // visibility options. The tab strip (logo · name · status dot) and selection
  // live in the parent; this is just the active panel.
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Select from "$lib/components/ui/select";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { usageProvider } from "$lib/usageCatalog";
  import {
    accountTypeLabelKey,
    formatCredit,
    formatReset,
    formatResetAbsolute,
    statusMeta,
  } from "$lib/usageFormat";
  import type { ProviderUsage, UsageProviderConfig } from "$lib/types";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { usageCodexRedeemReset } from "$lib/api";
  import { toast, toastError } from "$lib/toast";
  import UsageMeter from "./UsageMeter.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import EyeOffIcon from "@lucide/svelte/icons/eye-off";

  let {
    config,
    snapshot,
    loading = false,
    onchange,
    onremove,
    onrefresh,
  }: {
    config: UsageProviderConfig;
    snapshot: ProviderUsage | undefined;
    loading?: boolean;
    onchange: () => void;
    onremove: () => void;
    onrefresh: () => void;
  } = $props();

  const meta = $derived(usageProvider(config.provider));
  const status = $derived(statusMeta(snapshot?.status ?? "notInstalled"));
  const statusLabel = $derived(i18n.t(status.labelKey));

  // Refresh interval: "global" (follow the app default), "0" (manual only), or a
  // per-provider minute value.
  const GLOBAL = "global";
  const intervalValue = $derived(
    config.refreshMinutes == null ? GLOBAL : String(config.refreshMinutes),
  );
  const intervalOptions = [
    { value: GLOBAL, key: "providers.refreshGlobal" },
    { value: "1", key: "providers.every1m" },
    { value: "5", key: "providers.every5m" },
    { value: "15", key: "providers.every15m" },
    { value: "60", key: "providers.every60m" },
    { value: "0", key: "providers.refreshManual" },
  ] as const;
  const intervalLabel = $derived(
    i18n.t(intervalOptions.find((o) => o.value === intervalValue)?.key ?? "providers.refreshGlobal"),
  );
  function setInterval(v: string) {
    config.refreshMinutes = v === GLOBAL ? null : Number(v);
    onchange();
  }

  const hint = $derived.by(() => {
    const s = snapshot?.status;
    if (!snapshot?.message || s === "ok") return null;
    return {
      message: snapshot.message,
      tone:
        s === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : s === "authRequired"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "border-border/60 bg-muted/40 text-muted-foreground",
    };
  });

  const updatedAt = $derived(
    snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : null,
  );
  const creditReset = $derived(formatReset(snapshot?.credit?.resetsAt));
  const creditResetAbs = $derived(formatResetAbsolute(snapshot?.credit?.resetsAt));
  // A prepaid balance has a remaining `available` amount but no spend/`limit`.
  const creditIsBalance = $derived(
    snapshot?.credit?.limit == null && snapshot?.credit?.available != null,
  );
  const accountTypeLabel = $derived(
    snapshot?.account?.accountType
      ? i18n.t(accountTypeLabelKey(snapshot.account.accountType))
      : null,
  );
  // Combined reset line for the credit balance ("resets in 2d · Jul 12").
  const creditResetLine = $derived.by(() => {
    const parts: string[] = [];
    if (creditReset) parts.push(`${i18n.t("providers.resetsIn")} ${creditReset}`);
    if (creditResetAbs) parts.push(creditResetAbs);
    return parts.length > 0 ? parts.join(" · ") : null;
  });
  // Codex "reset credits" (reinicios) — redeemable rate-limit resets.
  const resetEntries = $derived(snapshot?.resetCredits?.entries ?? []);
  const resetCreditsExpiry = $derived(formatReset(snapshot?.resetCredits?.nextExpiresAt));
  // Per-credit expiry list for the card ("2d · 5d · 12d").
  const resetExpiryList = $derived(
    resetEntries
      .map((e) => formatReset(e.expiresAt))
      .filter((s): s is string => !!s)
      .join(" · "),
  );
  // Confirmation body: which reset gets used (the soonest-expiring), how many
  // remain afterward, and when each remaining one expires.
  const redeemDescription = $derived.by(() => {
    const first = formatReset(resetEntries[0]?.expiresAt);
    if (resetEntries.length <= 1) {
      return first
        ? i18n.t("providers.redeemConfirmLast", { time: first })
        : i18n.t("providers.redeemConfirmBody");
    }
    const rest = resetEntries
      .slice(1)
      .map((e) => formatReset(e.expiresAt))
      .filter((s): s is string => !!s)
      .join(", ");
    const head = first
      ? i18n.t("providers.redeemConfirmFirst", { time: first })
      : i18n.t("providers.redeemConfirmBody");
    return rest
      ? `${head} ${i18n.t("providers.redeemConfirmRemaining", { count: resetEntries.length - 1, list: rest })}`
      : head;
  });

  // Account identity is blurred until clicked (it's a personal email).
  let accountRevealed = $state(false);

  // Redeem a Codex rate-limit reset (behind a confirmation), then refresh so the
  // count + windows update.
  let confirmRedeemOpen = $state(false);
  function redeemMessageKey(code: string): MessageKey {
    switch (code) {
      case "reset":
        return "providers.redeemOk";
      case "nothing_to_reset":
        return "providers.redeemNothing";
      case "no_credit":
        return "providers.redeemNoCredit";
      case "already_redeemed":
        return "providers.redeemAlready";
      default:
        return "providers.redeemDone";
    }
  }
  async function redeemReset() {
    try {
      const code = await usageCodexRedeemReset();
      const msg = i18n.t(redeemMessageKey(code));
      if (code === "reset") toast.success(msg);
      else toast.info(msg);
      onrefresh();
    } catch (e) {
      toastError(e);
    }
  }

  // --- Status-bar visibility ------------------------------------------------
  // `*` is a sentinel for "the primary (first) window"; toggling resolves it to
  // concrete window ids against the live snapshot.
  function resolvePicks(): string[] {
    const picks = config.statusBar.windows ?? [];
    if (!snapshot || !picks.includes("*")) return picks;
    const first = snapshot.windows[0]?.id;
    const rest = picks.filter((p) => p !== "*");
    return first ? [first, ...rest.filter((r) => r !== first)] : rest;
  }
  const isWindowPicked = (id: string) => resolvePicks().includes(id);
  function toggleWindow(id: string, on: boolean) {
    const cur = new Set(resolvePicks());
    if (on) cur.add(id);
    else cur.delete(id);
    config.statusBar.windows = [...cur];
    onchange();
  }
</script>

<div class="flex flex-col gap-4">
  <!-- Toolbar: status / plan + refresh + remove -->
  <div class="flex items-center gap-2">
    <span class={cn("size-1.5 shrink-0 rounded-full", status.dot)}></span>
    <span class={cn("min-w-0 flex-1 truncate", text.meta)}>{statusLabel}</span>
    <TooltipSimple title={i18n.t("providers.refreshNow")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          disabled={loading}
          aria-label={i18n.t("providers.refreshNow")}
          onclick={onrefresh}
        >
          <RefreshCwIcon class={cn(icon.button, loading && "animate-spin")} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("providers.removeProvider")}>
      {#snippet children(tp)}
        <Button {...tp} variant="ghost" size="icon-sm" onclick={onremove}>
          <Trash2Icon class={icon.button} />
        </Button>
      {/snippet}
    </TooltipSimple>
  </div>

  <!-- Live data (windows / credit / account) grouped on a single soft surface. -->
  {#if snapshot && (snapshot.windows.length > 0 || snapshot.credit || snapshot.account?.email || snapshot.account?.plan || snapshot.account?.organization)}
    <div class="flex flex-col gap-3.5 rounded-lg bg-muted/40 px-3.5 py-3">
      {#if snapshot.windows.length > 0}
        <div class="flex flex-col gap-3">
          <span class={text.meta}>{i18n.t("providers.usedCaption")}</span>
          <div class="flex flex-col gap-3.5">
            {#each snapshot.windows as w (w.id)}
              <UsageMeter window={w} />
            {/each}
          </div>
        </div>
      {/if}

      {#if snapshot.credit}
        <div class={cn("flex items-center justify-between gap-2", snapshot.windows.length > 0 && "border-t border-border/40 pt-3")}>
          <span class={cn("text-foreground", text.body)}>{i18n.t("providers.credit")}</span>
          <span class="font-mono text-xs text-muted-foreground">
            {#if creditIsBalance}
              {formatCredit(snapshot.credit.available ?? 0, snapshot.credit.currency)}&nbsp;{i18n.t("providers.available")}
            {:else}
              {formatCredit(snapshot.credit.used, snapshot.credit.currency)}
              {#if snapshot.credit.limit != null}
                &nbsp;/&nbsp;{formatCredit(snapshot.credit.limit, snapshot.credit.currency)}
              {/if}
            {/if}
            {#if creditResetLine}&nbsp;· {creditResetLine}{/if}
          </span>
        </div>
      {/if}

      {#if snapshot.resetCredits}
        <div class={cn("flex flex-col gap-1.5", (snapshot.windows.length > 0 || snapshot.credit) && "border-t border-border/40 pt-3")}>
          <div class="flex items-center justify-between gap-2">
            <span class={cn("text-foreground", text.body)}>{i18n.t("providers.resets")}</span>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">
                {i18n.t("providers.resetsCount", { count: snapshot.resetCredits.available })}
              </span>
              {#if config.provider === "codex" && snapshot.resetCredits.available > 0}
                <Button
                  variant="outline"
                  class="h-6 px-2 text-xs"
                  onclick={() => (confirmRedeemOpen = true)}
                >
                  {i18n.t("providers.redeemReset")}
                </Button>
              {/if}
            </div>
          </div>
          {#if resetExpiryList}
            <span class={text.meta}>
              {resetEntries.length <= 1
                ? i18n.t("providers.resetsExpireOne")
                : i18n.t("providers.resetsExpireMany")}
              {resetExpiryList}
            </span>
          {:else if resetCreditsExpiry}
            <span class={text.meta}>{i18n.t("providers.resetsNextExpires", { time: resetCreditsExpiry })}</span>
          {/if}
        </div>
      {/if}

      {#if snapshot.account?.email || snapshot.account?.plan || snapshot.account?.organization || accountTypeLabel}
        <div class={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", (snapshot.windows.length > 0 || snapshot.credit || snapshot.resetCredits) && "border-t border-border/40 pt-3", text.meta)}>
          {#if snapshot.account?.email}
            <span>{i18n.t("providers.authenticatedAs")}</span>
            <button
              type="button"
              class="flex min-w-0 items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground"
              title={i18n.t(accountRevealed ? "providers.hideAccount" : "providers.revealAccount")}
              onclick={() => (accountRevealed = !accountRevealed)}
            >
              {#if accountRevealed}
                <EyeIcon class="size-3 shrink-0" />
              {:else}
                <EyeOffIcon class="size-3 shrink-0" />
              {/if}
              <span class={cn("truncate transition-[filter] duration-150", !accountRevealed && "select-none blur-[5px]")}>
                {snapshot.account.email}
              </span>
            </button>
          {/if}
          {#if snapshot.account?.plan}
            <span class="whitespace-nowrap">{#if snapshot.account?.email}·&nbsp;{/if}{snapshot.account.plan}</span>
          {/if}
          {#if accountTypeLabel}
            <span
              class="rounded-full border border-border/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >{accountTypeLabel}</span>
          {/if}
          {#if snapshot.account?.organization}
            <span class="truncate">·&nbsp;{snapshot.account.organization}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if hint}
    <div class={cn("rounded-md border px-2.5 py-1.5", text.meta, hint.tone)}>{hint.message}</div>
  {/if}

  <!-- Refresh interval -->
  <div class="flex items-center gap-2">
    <span class={cn("shrink-0", text.meta)}>{i18n.t("providers.refreshInterval")}</span>
    <Select.Root type="single" value={intervalValue} onValueChange={setInterval}>
      <Select.Trigger class="h-8 flex-1 text-xs">{intervalLabel}</Select.Trigger>
      <Select.Content>
        {#each intervalOptions as opt (opt.value)}
          <Select.Item value={opt.value} label={i18n.t(opt.key)}>{i18n.t(opt.key)}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <!-- Status bar: whether (and what of) this provider surfaces in the bottom
       status-bar popover. -->
  <div class="flex flex-col gap-2.5 border-t border-border/50 pt-3.5">
    <label class="flex cursor-pointer items-center justify-between gap-2">
      <span class={cn("text-foreground", text.body)}>{i18n.t("providers.showInStatusBar")}</span>
      <Switch
        checked={config.statusBar.show}
        onCheckedChange={(c) => {
          config.statusBar.show = c;
          onchange();
        }}
      />
    </label>
    {#if config.statusBar.show}
      <div class="flex flex-col gap-2 pl-1">
        {#if snapshot && snapshot.windows.length > 0}
          {#each snapshot.windows as w (w.id)}
            <label class="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={isWindowPicked(w.id)}
                onCheckedChange={(c) => toggleWindow(w.id, c === true)}
              />
              <span class={cn("text-foreground", text.body)}>{w.label}</span>
            </label>
          {/each}
        {:else}
          <span class={text.meta}>{i18n.t("providers.noWindowsToPick")}</span>
        {/if}
        <label class="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={config.statusBar.showPlan === true}
            onCheckedChange={(c) => {
              config.statusBar.showPlan = c === true;
              onchange();
            }}
          />
          <span class={cn("text-foreground", text.body)}>{i18n.t("providers.showPlan")}</span>
        </label>
        {#if meta?.hasCredit}
          <label class="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={config.statusBar.showCredit === true}
              onCheckedChange={(c) => {
                config.statusBar.showCredit = c === true;
                onchange();
              }}
            />
            <span class={cn("text-foreground", text.body)}>{i18n.t("providers.showCredit")}</span>
          </label>
        {/if}
        <label class="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={config.statusBar.showResetTime === true}
            onCheckedChange={(c) => {
              config.statusBar.showResetTime = c === true;
              onchange();
            }}
          />
          <span class={cn("text-foreground", text.body)}>{i18n.t("providers.showResetTime")}</span>
        </label>
        {#if meta?.hasResetCredits}
          <label class="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={config.statusBar.showResetCredits === true}
              onCheckedChange={(c) => {
                config.statusBar.showResetCredits = c === true;
                onchange();
              }}
            />
            <span class={cn("text-foreground", text.body)}>{i18n.t("providers.showResets")}</span>
          </label>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Provenance + last update -->
  <div class="flex items-center justify-between {text.meta}">
    <span>
      {#if snapshot?.source === "token"}{i18n.t("providers.sourceToken")}
      {:else}{i18n.t("providers.sourceNone")}{/if}
    </span>
    {#if updatedAt}<span>{i18n.t("providers.updated")} {updatedAt}</span>{/if}
  </div>
</div>

<!-- Confirm before redeeming a Codex reset (which one, how many remain, expiries). -->
<ConfirmDialog
  bind:open={confirmRedeemOpen}
  title={i18n.t("providers.redeemConfirmTitle")}
  description={redeemDescription}
  confirmLabel={i18n.t("providers.redeemReset")}
  onconfirm={redeemReset}
/>
