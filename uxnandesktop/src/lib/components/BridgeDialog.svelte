<script lang="ts">
  // The Bridge window, from anywhere it is offered (the sidebar's Bridge row,
  // Settings → Bridge & mobile, the welcome tour). Top to bottom: the bridge's
  // state and version, with its update when a newer one is out (the same
  // `bridgeInstall` owner Settings uses); the devices — each paired phone and
  // whether it is connected now, and any other desktop on the bridge; and
  // "Connect a phone" — the one pairing surface (`PhonePairing.svelte`, the
  // same the welcome tour shows): the running bridge's own QR and code, a
  // countdown, and the phone by name once it arrives. "Pair another" starts
  // over; several phones can be paired.
  //
  // With a host's `target` it is that host's own bridge (`02g` §5.18): the
  // phone pairs with it as one more PC. Installing, updating and starting it
  // are the host page's business, so none of that is offered here.
  import { untrack } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import RotateCcwIcon from "@hugeicons/core-free-icons/Rotate01Icon";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
  import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
  import ConnectionRouteLabel, { phoneRoutes } from "$lib/components/ConnectionRouteLabel.svelte";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { toastError } from "$lib/toast";
  import { bridges } from "$lib/bridge/client.svelte";
  import { chatFor } from "$lib/bridge/chat.svelte";
  import { hosts } from "$lib/state/hosts.svelte";
  import { sshHostId, type TargetId } from "$lib/target";
  import PhonePairing from "$lib/components/PhonePairing.svelte";
  import type { TrustedDevice } from "$shared/models/session";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";

  let {
    open = $bindable(false),
    target,
  }: {
    open?: boolean;
    /** A host's own bridge; this machine's when unset. */
    target?: TargetId;
  } = $props();

  // A dialog is for one machine for as long as it lives.
  const machine = untrack(() => target);
  const onHost = sshHostId(machine);
  const bridge = bridges.for(machine);
  const chat = chatFor(machine);

  /** The pairing surface (`PhonePairing`): the phone that just paired, and
   *  whether a QR is being fetched, for the footer's actions. */
  let pairing = $state<ReturnType<typeof PhonePairing> | null>(null);
  let paired = $state<TrustedDevice | null>(null);
  let loading = $state(false);

  const bridgeOn = $derived(bridge.status.state === "connected");
  const bridgeStarting = $derived(bridge.status.state === "connecting");

  function connectedPhoneIds(): Set<string> {
    return new Set(chat.clients.filter((c) => c.kind === "phone").map((c) => c.id));
  }

  // ---- the bridge's state and update ----
  const version = $derived(
    bridge.status.state === "connected" ? bridge.status.bridgeVersion : null,
  );
  // This machine's bridge only: a host's is updated where it runs.
  const offer = $derived(bridgeOn && !onHost ? bridgeInstall.offer : null);
  const updating = $derived(!onHost && (bridgeInstall.updating || bridgeInstall.installing));
  const failure = $derived(onHost ? null : (bridgeInstall.status?.update?.failure ?? null));
  const stateLine = $derived(
    updating
      ? i18n.t("bridge.panelUpdating")
      : bridgeOn
        ? i18n.t("bridge.panelOnline", { version: version ?? "" })
        : bridgeStarting
          ? i18n.t("bridge.pairStarting")
          : i18n.t("bridge.panelOffline"),
  );

  async function update() {
    try {
      await bridgeInstall.update();
    } catch (err) {
      toastError(err);
    }
  }

  // ---- the devices ----
  const phonesOnline = $derived(connectedPhoneIds());
  /** How each connected phone reaches the bridge (LAN, Tailscale or relay). */
  const routes = $derived(phoneRoutes(chat.clients));
  const desktops = $derived(bridgeOn ? chat.clients.filter((c) => c.kind === "desktop") : []);

  /** What a phone is, in one quiet line. */
  function aboutPhone(device: (typeof chat.devices)[number]): string {
    return [
      device.model,
      device.osVersion && device.platform
        ? `${device.platform === "ios" ? "iOS" : "Android"} ${device.osVersion}`
        : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }

</script>

<Dialog.Root bind:open>
  <Dialog.Content size="medium">
    <Dialog.Header>
      <Dialog.Title class={text.title}>
        {onHost ? i18n.t("bridge.panelTitleHost", { host: hosts.labelOf(onHost) }) : i18n.t("bridge.panelTitle")}
      </Dialog.Title>
      <Dialog.Description class={cn(text.body, "flex items-center gap-2")}>
        <StatusDot tone={updating ? "busy" : bridgeOn ? "ok" : bridgeStarting ? "busy" : "off"} />
        {stateLine}
      </Dialog.Description>
    </Dialog.Header>

    <Dialog.Body class="flex flex-col gap-5 py-0">
      {#if offer || updating || failure}
        <section class="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {#if updating}
              <Spinner class={icon.button} aria-hidden="true" />
            {:else}
              <Icon icon={DownloadIcon} class={icon.button} />
            {/if}
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class={cn(text.bodyStrong, "truncate")}>
              {#if updating}
                {i18n.t("bridge.panelUpdating")}
              {:else if offer?.version}
                {i18n.t("bridge.panelUpdateTo", { version: offer.version })}
              {:else if offer}
                {i18n.t("bridge.panelOlder")}
              {:else}
                {i18n.t("bridge.updateFailed")}
              {/if}
            </span>
            {#if failure && !updating}
              <span class={cn(text.meta, "line-clamp-2")}>{failure.message}</span>
            {:else}
              <span class={text.meta}>{i18n.t("sidebar.bridgeUpdateHint")}</span>
            {/if}
          </span>
          {#if offer && !updating}
            <Button size="sm" onclick={() => void update()}>{i18n.t("bridge.updateAction")}</Button>
          {/if}
        </section>
      {/if}

      <section class="flex flex-col gap-1.5">
        <h3 class={text.section}>{i18n.t("bridge.panelDevices")}</h3>
        {#if chat.devices.length === 0 && desktops.length === 0}
          <p class={text.meta}>{i18n.t("bridge.panelNoDevices")}</p>
        {:else}
          <ul class="flex flex-col">
            {#each chat.devices as device (device.deviceId)}
              {@const online = bridgeOn && phonesOnline.has(device.deviceId)}
              <li class="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <Icon icon={SmartphoneIcon} class={cn(icon.action, "shrink-0 text-muted-foreground")} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class={cn(text.body, "truncate")}>{device.displayName}</span>
                  {#if aboutPhone(device)}
                    <span class={cn(text.meta, "truncate")}>{aboutPhone(device)}</span>
                  {/if}
                </span>
                <span class={cn(text.meta, "flex shrink-0 items-center gap-1.5")}>
                  <StatusDot tone={online ? "ok" : "off"} />
                  {online ? i18n.t("bridge.panelDeviceOnline") : i18n.t("bridge.panelDeviceOffline")}
                  {#if online && routes.get(device.deviceId)}
                    <span class="text-muted-foreground/60" aria-hidden="true">·</span>
                    <ConnectionRouteLabel route={routes.get(device.deviceId)} />
                  {/if}
                </span>
              </li>
            {/each}
            {#each desktops as desktop (desktop.id)}
              <li class="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <Icon icon={ComputerIcon} class={cn(icon.action, "shrink-0 text-muted-foreground")} />
                <span class={cn(text.body, "min-w-0 flex-1 truncate")}>{desktop.name}</span>
                <span class={cn(text.meta, "flex shrink-0 items-center gap-1.5")}>
                  <StatusDot tone="ok" />
                  {i18n.t("bridge.panelDeviceOnline")}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="flex flex-col items-center gap-3">
        <div class="flex w-full flex-col gap-0.5">
          <h3 class={text.section}>
            {paired ? i18n.t("bridge.pairDoneTitle") : i18n.t("bridge.pairTitle")}
          </h3>
          <p class={text.meta}>
            {#if paired}
              {i18n.t("bridge.pairDoneDesc")}
            {:else if bridgeOn}
              {i18n.t("bridge.pairDesc")}
            {:else}
              {i18n.t("bridge.pairOffDesc")}
            {/if}
          </p>
        </div>
        <PhonePairing bind:this={pairing} bind:paired bind:loading active={open} target={machine} />
      </section>
    </Dialog.Body>

    <Dialog.Footer>
      {#if paired}
        <Button variant="ghost" onclick={() => pairing?.restart()}>{i18n.t("bridge.pairAnother")}</Button>
        <Button onclick={() => (open = false)}>{i18n.t("common.done")}</Button>
      {:else}
        <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.close")}</Button>
        {#if bridgeOn}
          <Button variant="outline" disabled={loading} onclick={() => void pairing?.regenerate()}>
            <Icon icon={RotateCcwIcon} data-icon="inline-start" />
            {i18n.t("bridge.pairRegenerate")}
          </Button>
        {/if}
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
