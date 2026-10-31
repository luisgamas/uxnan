<script lang="ts">
  // The body of one provider's tab in Settings → Providers: its live usage data
  // (quota windows / credit / account) plus its refresh interval and status-bar
  // visibility options. The tab strip (logo · name · status dot) and selection
  // live in the parent; this is just the active panel.
  import { formatClock } from "$lib/clock";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Badge } from "$lib/components/ui/badge";
  import { Spinner } from "$lib/components/ui/spinner";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { divider, field, focus, icon, text } from "$lib/design";
  import { resolveStatusBarWindows, usageProvider } from "$lib/usageCatalog";
  import { accountTypeLabelKey, formatReset, formatResetAbsolute, statusMeta } from "$lib/usageFormat";
  import { balanceLabel, formatBalanceFigure, windowLabel } from "$lib/usageLabels";
  import type { ProviderUsage, UsageProviderConfig } from "$lib/types";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import UsageMeter from "./UsageMeter.svelte";
  import RedeemResetDialog from "./RedeemResetDialog.svelte";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import StatusDot from "./StatusDot.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import Trash2Icon from "@hugeicons/core-free-icons/Delete02Icon";
  import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import EyeIcon from "@hugeicons/core-free-icons/EyeIcon";
  import EyeOffIcon from "@hugeicons/core-free-icons/EyeOffIcon";

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
  const intervalGroups = $derived<ComboGroup[]>([
    { items: intervalOptions.map((o) => ({ value: o.value, label: i18n.t(o.key) })) },
  ]);
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
    snapshot?.updatedAt ? formatClock(new Date(snapshot.updatedAt)) : null,
  );
  const balances = $derived(snapshot?.credits ?? []);
  // The plan, said once: its name when the provider reports one, else the
  // kind of account (an account type derived from that same plan would only
  // repeat it — "Free · Free").
  const planBadge = $derived(
    snapshot?.account?.plan ??
      (snapshot?.account?.accountType
        ? i18n.t(accountTypeLabelKey(snapshot.account.accountType))
        : null),
  );
  /** A balance's reset line ("resets in 2d · Jul 12"), or null. */
  function balanceResetLine(resetsAt: number | undefined): string | null {
    const parts: string[] = [];
    const countdown = formatReset(resetsAt);
    const absolute = formatResetAbsolute(resetsAt);
    if (countdown) parts.push(`${i18n.t("providers.resetsIn")} ${countdown}`);
    if (absolute) parts.push(absolute);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  // Rate-limit resets the provider granted (Codex's, Claude Code's).
  const resetEntries = $derived(snapshot?.resetCredits?.entries ?? []);
  const resetCreditsExpiry = $derived(formatReset(snapshot?.resetCredits?.nextExpiresAt));
  // Account identity is blurred until clicked (it's a personal email).
  let accountRevealed = $state(false);

  // Redeem a reset the bridge can spend (Codex), behind a confirmation.
  let confirmRedeemOpen = $state(false);

  // --- Status-bar visibility ------------------------------------------------
  // The ticked checkboxes are exactly what the status bar shows
  // (`resolveStatusBarWindows`: the `*` sentinel, and picks that no longer match
  // any window, both mean the first one). A toggle writes back concrete ids of
  // the current windows only, so stale ids from an older reader drop out.
  const pickedIds = $derived(
    resolveStatusBarWindows(config.statusBar.windows, snapshot?.windows).map((w) => w.id),
  );
  const isWindowPicked = (id: string) => pickedIds.includes(id);
  function toggleWindow(id: string, on: boolean) {
    const cur = new Set(pickedIds);
    if (on) cur.add(id);
    else cur.delete(id);
    config.statusBar.windows = (snapshot?.windows ?? []).map((w) => w.id).filter((w) => cur.has(w));
    onchange();
  }
</script>

<div class="flex flex-col gap-4">
  <!-- Toolbar: status / plan + refresh + remove -->
  <div class="flex items-center gap-2">
    <StatusDot tone={status.tone} />
    <span class={cn("min-w-0 truncate", text.meta)}>{statusLabel}</span>
    {#if planBadge}
      <Badge variant="outline" class="max-w-48 shrink-0 truncate text-muted-foreground">{planBadge}</Badge>
    {/if}
    <span class="flex-1"></span>
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
          {#if loading}
            <Spinner class={icon.button} />
          {:else}
            <Icon icon={RefreshCwIcon} class={icon.button} />
          {/if}
        </Button>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("providers.removeProvider")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          aria-label={i18n.t("providers.removeProvider")}
          onclick={onremove}
        >
          <Icon icon={Trash2Icon} class={icon.button} />
        </Button>
      {/snippet}
    </TooltipSimple>
  </div>

  <!-- Live data (windows / credit / account) grouped on a single soft surface. -->
  {#if snapshot && (snapshot.windows.length > 0 || balances.length > 0 || snapshot.resetCredits || snapshot.account?.email || snapshot.account?.organization)}
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

      {#if balances.length > 0}
        <div class={cn("flex flex-col gap-2", snapshot.windows.length > 0 && cn(divider.top, "pt-3"))}>
          {#each balances as balance, i (i)}
            {@const resetLine = balanceResetLine(balance.resetsAt)}
            <div class="flex items-baseline justify-between gap-3">
              <span class={cn("min-w-0 truncate text-foreground", text.body)}>{balanceLabel(balance)}</span>
              <span class="shrink-0 text-right text-xs text-muted-foreground">
                <span class="font-mono tabular-nums">{formatBalanceFigure(balance)}</span>{#if resetLine}&nbsp;· {resetLine}{/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      {#if snapshot.resetCredits}
        <div class={cn("flex flex-col gap-1.5", (snapshot.windows.length > 0 || balances.length > 0) && cn(divider.top, "pt-3"))}>
          <div class="flex items-center justify-between gap-2">
            <span class={cn("text-foreground", text.body)}>{i18n.t("providers.resets")}</span>
            <div class="flex items-center gap-2">
              <span class={text.meta}>
                {i18n.t("providers.resetsCount", { count: snapshot.resetCredits.available })}
              </span>
              {#if !snapshot.resetCredits.redeemCommand && snapshot.resetCredits.available > 0}
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => (confirmRedeemOpen = true)}
                >
                  {i18n.t("providers.redeemReset")}
                </Button>
              {/if}
            </div>
          </div>
          {#if resetEntries.length > 0}
            <ul class="flex flex-col gap-0.5">
              {#each resetEntries as entry, i (entry.id ?? i)}
                {@const expires = formatReset(entry.expiresAt)}
                <li class={cn("flex items-baseline justify-between gap-3", text.meta)}>
                  <span class="min-w-0 truncate">{entry.title || i18n.t("providers.resetEntry")}</span>
                  {#if expires}<span class="shrink-0">{i18n.t("providers.resetsExpiresIn", { time: expires })}</span>{/if}
                </li>
              {/each}
            </ul>
          {:else if resetCreditsExpiry}
            <span class={text.meta}>{i18n.t("providers.resetsNextExpires", { time: resetCreditsExpiry })}</span>
          {/if}
          {#if snapshot.resetCredits.redeemCommand}
            <!-- The CLI spends these itself, interactively: say how, offer no button. -->
            <span class={text.meta}>
              {i18n.t("providers.redeemInCli", { cli: meta?.cli ?? config.provider, command: snapshot.resetCredits.redeemCommand })}
            </span>
          {/if}
        </div>
      {/if}

      {#if snapshot.account?.email || snapshot.account?.organization}
        <div class={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", (snapshot.windows.length > 0 || balances.length > 0 || snapshot.resetCredits) && cn(divider.top, "pt-3"), text.meta)}>
          {#if snapshot.account?.email}
            <span>{i18n.t("providers.authenticatedAs")}</span>
            <Button
              variant="ghost"
              size="sm"
              class={cn("min-w-0 max-w-full justify-start gap-1 px-1 text-muted-foreground transition-colors hover:text-foreground", focus.ring)}
              aria-label={i18n.t(accountRevealed ? "providers.hideAccount" : "providers.revealAccount")}
              title={i18n.t(accountRevealed ? "providers.hideAccount" : "providers.revealAccount")}
              onclick={() => (accountRevealed = !accountRevealed)}
            >
              {#if accountRevealed}
                <Icon icon={EyeIcon} class={cn(icon.status, "shrink-0")} />
              {:else}
                <Icon icon={EyeOffIcon} class={cn(icon.status, "shrink-0")} />
              {/if}
              <span class={cn("truncate transition-[filter] duration-150", !accountRevealed && "select-none blur-[5px]")}>
                {snapshot.account.email}
              </span>
            </Button>
          {/if}
          {#if snapshot.account?.organization}
            <!-- An organization is often named after its owner's email
                 ("me@x.com's Organization"): it hides and shows with it. -->
            <span class="truncate">{#if snapshot.account?.email}·&nbsp;{/if}<span
                class={cn("transition-[filter] duration-150", !accountRevealed && "select-none blur-[5px]")}
                >{snapshot.account.organization}</span
              ></span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if hint}
    <div class={cn("rounded-md border px-2.5 py-1.5", text.meta, hint.tone)}>
      <div>{hint.message}</div>

    </div>
  {/if}

  <!-- Refresh interval -->
  <div class="flex items-center justify-between gap-2">
    <span class={cn("min-w-0 truncate", text.meta)}>{i18n.t("providers.refreshInterval")}</span>
    <Combobox
      value={intervalValue}
      groups={intervalGroups}
      searchable={false}
      triggerClass={field.selectNarrow}
      ariaLabel={i18n.t("providers.refreshInterval")}
      onChange={setInterval}
    />
  </div>

  <!-- Status bar: whether (and what of) this provider surfaces in the bottom
       status-bar popover. -->
  <div class={cn("flex flex-col gap-2.5 pt-3.5", divider.top)}>
    <label class="flex min-h-8 cursor-pointer items-center justify-between gap-2 py-1">
      <span class={cn("text-foreground", text.body)}>{i18n.t("providers.showInStatusBar")}</span>
      <Switch
        aria-label={i18n.t("providers.showInStatusBar")}
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
            <label class="flex min-h-8 cursor-pointer items-center gap-2 py-1">
              <Checkbox
                aria-label={windowLabel(w)}
                checked={isWindowPicked(w.id)}
                onCheckedChange={(c) => toggleWindow(w.id, c === true)}
              />
              <span class={cn("text-foreground", text.body)}>{windowLabel(w)}</span>
            </label>
          {/each}
        {:else}
          <!-- Two different situations used to share one sentence, and it named
               the wrong one. A provider read that came back `ok` and has no
               windows is not waiting on a sign-in — the account simply has no
               quota window to meter, which is what a pay-as-you-go Grok account
               looks like: live, authenticated, billed by spend rather than by a
               percentage. Telling that user to "refresh once signed in" sends
               them to fix a login that is already fine. -->
          <span class={text.meta}>
            {i18n.t(
              snapshot?.status === "ok"
                ? "providers.noWindowsForAccount"
                : "providers.noWindowsToPick",
            )}
          </span>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Provenance + last update -->
  <div class="flex items-center justify-between {text.meta}">
    <span>
      {#if snapshot?.source === "cli"}{i18n.t("providers.sourceCli", { cli: meta?.cli ?? config.provider })}
      {:else}{i18n.t("providers.sourceNone")}{/if}
    </span>
    {#if updatedAt}<span>{i18n.t("providers.updated")} {updatedAt}</span>{/if}
  </div>
</div>

<!-- Confirm before redeeming a reset (which one, how many remain, expiries). -->
<RedeemResetDialog bind:open={confirmRedeemOpen} provider={config.provider} resets={snapshot?.resetCredits} />
