<script lang="ts">
  // Confirm, then redeem one of a provider's rate-limit resets through the bridge
  // (`usage/redeemReset`) — the one place both Settings → Providers and the
  // status-bar popover spend a reset. It never fires on its own: only the
  // confirm button redeems, the soonest-expiring reset, under a fresh key per
  // confirmation so a retry after a lost answer never spends a second one.
  import { i18n } from "$lib/i18n";
  import { usage } from "$lib/state/usage.svelte";
  import { toast, toastError } from "$lib/toast";
  import { formatReset } from "$lib/usageFormat";
  import type { ResetCredits, UsageProvider } from "$lib/types";
  import ConfirmDialog from "./ConfirmDialog.svelte";

  let {
    open = $bindable(false),
    provider,
    resets,
  }: { open?: boolean; provider: UsageProvider; resets: ResetCredits | undefined } = $props();

  const entries = $derived(resets?.entries ?? []);
  // Which reset gets used (the soonest-expiring), how many remain afterward,
  // and when each remaining one expires.
  const description = $derived.by(() => {
    const first = formatReset(entries[0]?.expiresAt);
    if (entries.length <= 1) {
      return first
        ? i18n.t("providers.redeemConfirmLast", { time: first })
        : i18n.t("providers.redeemConfirmBody");
    }
    const rest = entries
      .slice(1)
      .map((e) => formatReset(e.expiresAt))
      .filter((s): s is string => !!s)
      .join(", ");
    const head = first
      ? i18n.t("providers.redeemConfirmFirst", { time: first })
      : i18n.t("providers.redeemConfirmBody");
    return rest
      ? `${head} ${i18n.t("providers.redeemConfirmRemaining", { count: entries.length - 1, list: rest })}`
      : head;
  });

  async function redeem(): Promise<void> {
    try {
      await usage.redeemReset(provider, crypto.randomUUID(), entries[0]?.id);
      toast.success(i18n.t("providers.redeemOk"));
    } catch (e) {
      toastError(e);
    }
  }
</script>

<ConfirmDialog
  bind:open
  title={i18n.t("providers.redeemConfirmTitle")}
  {description}
  confirmLabel={i18n.t("providers.redeemReset")}
  onconfirm={redeem}
/>
