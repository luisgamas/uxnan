<script lang="ts">
  // A newer bridge, one row under the phone — only while there is one to
  // install, so an up-to-date sidebar stays as it was. One click asks the
  // bridge to update itself (`bridgeInstall.update`): it stops, installs the
  // published version and its service brings it back, never under a running
  // turn. The same update the phone offers, through the same owner.
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
  import { i18n } from "$lib/i18n";
  import { toastError } from "$lib/toast";
  import { cn } from "$lib/utils";
  import { focus, icon, row } from "$lib/design";

  const offer = $derived(bridgeInstall.offer);
  const busy = $derived(bridgeInstall.updating || bridgeInstall.installing);
  const label = $derived(
    busy
      ? i18n.t("sidebar.bridgeUpdating")
      : offer?.version
        ? i18n.t("sidebar.bridgeUpdate", { version: offer.version })
        : i18n.t("sidebar.bridgeUpdateOlder"),
  );

  async function update() {
    try {
      await bridgeInstall.update();
    } catch (err) {
      toastError(err);
    }
  }
</script>

{#if offer || busy}
  <button
    class={cn(row.sidebar, row.sidebarInactive, focus.ring)}
    title={i18n.t("sidebar.bridgeUpdateHint")}
    disabled={busy}
    onclick={() => void update()}
  >
    {#if busy}
      <Spinner class={cn(icon.action, "shrink-0")} aria-label={i18n.t("common.loading")} />
    {:else}
      <Icon icon={DownloadIcon} class={cn(icon.action, "shrink-0 text-primary")} />
    {/if}
    <span class="min-w-0 flex-1 truncate">{label}</span>
  </button>
{/if}
