<script lang="ts">
  // The Bridge window, from anywhere it is offered (the sidebar's Bridge row,
  // Settings → Bridge & mobile, the welcome tour). Top to bottom: the bridge's
  // state and version, with its update when a newer one is out (the same
  // `bridgeInstall` owner Settings uses); the devices — each paired phone and
  // whether it is connected now, and any other desktop on the bridge; and
  // "Connect a phone", whose QR shows at once and which notices the phone
  // arrive.
  //
  // - Bridge off: one button turns it on as the user's service (`managed`),
  //   then the QR follows.
  // - Bridge on: the RUNNING bridge's own payload (`bridge_pairing_qr` →
  //   `bridge/generatePairingQr`: its LAN hosts, its session, the pairing window
  //   armed) — exactly what `uxnan-bridge qr` prints. It expires; the dialog
  //   counts down and offers a fresh one. Under it, the same bridge's manual
  //   code (`bridge/pairingCode`, what `uxnan-bridge code` prints) for a phone
  //   that types it instead of scanning; an older bridge shows the QR alone.
  // - Paired: a phone that was not paired when the dialog opened appears in the
  //   bridge's list (`stream/devices/updated`), or a paired one connects
  //   (`stream/presence/updated`): the dialog says so, by the phone's name —
  //   which it keeps following, since the phone describes itself a moment
  //   after pairing. "Pair another" starts over; several phones can be paired.
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import RotateCcwIcon from "@hugeicons/core-free-icons/Rotate01Icon";
  import CheckCircleIcon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { clipboardWrite } from "$lib/clipboard";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
  import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
  import ConnectionRouteLabel, { phoneRoutes } from "$lib/components/ConnectionRouteLabel.svelte";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { toastError } from "$lib/toast";
  import { bridge } from "$lib/bridge/client.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let svg = $state<string | null>(null);
  /** The bridge's manual pairing code, when it has one to give. */
  let code = $state<string | null>(null);
  let codeCopied = $state(false);
  let codeCopiedTimer: ReturnType<typeof setTimeout> | undefined;
  let expiresAt = $state(0);
  let now = $state(Date.now());
  let loading = $state(false);
  let error = $state<string | null>(null);

  const bridgeOn = $derived(bridge.status.state === "connected");
  const bridgeStarting = $derived(bridge.status.state === "connecting");
  const remaining = $derived(Math.max(0, Math.round((expiresAt - now) / 1000)));
  const expired = $derived(svg !== null && remaining === 0);

  // What was already there when pairing began, so a newcomer stands out.
  let knownDevices = new Set<string>();
  let knownConnected = new Set<string>();
  let pairedId = $state<string | null>(null);
  const paired = $derived(
    pairedId === null ? null : (chat.devices.find((d) => d.deviceId === pairedId) ?? null),
  );

  function connectedPhoneIds(): Set<string> {
    return new Set(chat.clients.filter((c) => c.kind === "phone").map((c) => c.id));
  }

  function beginPairing(): void {
    knownDevices = new Set(chat.devices.map((d) => d.deviceId));
    knownConnected = connectedPhoneIds();
    pairedId = null;
    void load();
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const qr = await invoke<{ svg: string; expiresAt: number; code?: string | null }>(
        "bridge_pairing_qr",
      );
      svg = qr.svg;
      expiresAt = qr.expiresAt;
      code = qr.code ?? null;
      now = Date.now();
    } catch (err) {
      svg = null;
      code = null;
      error = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    } finally {
      loading = false;
    }
  }

  async function copyCode(): Promise<void> {
    if (!code) return;
    await clipboardWrite(code);
    codeCopied = true;
    clearTimeout(codeCopiedTimer);
    codeCopiedTimer = setTimeout(() => (codeCopied = false), 1200);
  }

  $effect(() => () => clearTimeout(codeCopiedTimer));

  /** Run the bridge as the user's service; the QR follows once it is up. */
  function turnBridgeOn(): void {
    app.settings.bridge = { ...app.settings.bridge, mode: "managed" };
    void app.persistSettings();
  }

  // Open with the bridge on (or once it comes on): start pairing.
  $effect(() => {
    if (!open || !bridgeOn) return;
    untrack(beginPairing);
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  // Notice the phone arrive: newly paired, or a paired one connecting.
  $effect(() => {
    if (!open || !bridgeOn || pairedId !== null) return;
    const fresh = chat.devices.find((d) => !knownDevices.has(d.deviceId));
    if (fresh) {
      pairedId = fresh.deviceId;
      return;
    }
    for (const id of connectedPhoneIds()) {
      if (!knownConnected.has(id) && chat.devices.some((d) => d.deviceId === id)) {
        pairedId = id;
        return;
      }
    }
  });

  // ---- the bridge's state and update ----
  const version = $derived(
    bridge.status.state === "connected" ? bridge.status.bridgeVersion : null,
  );
  const offer = $derived(bridgeOn ? bridgeInstall.offer : null);
  const updating = $derived(bridgeInstall.updating || bridgeInstall.installing);
  const failure = $derived(bridgeInstall.status?.update?.failure ?? null);
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

  /** What the paired phone is, in one quiet line. */
  const pairedAbout = $derived(
    paired
      ? [
          paired.model,
          paired.osVersion && paired.platform
            ? `${paired.platform === "ios" ? "iOS" : "Android"} ${paired.osVersion}`
            : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(" · ")
      : "",
  );
</script>

<Dialog.Root bind:open>
  <Dialog.Content size="medium">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{i18n.t("bridge.panelTitle")}</Dialog.Title>
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
      {#if paired}
        <div class="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon icon={SmartphoneIcon} class={icon.button} />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class={cn(text.bodyStrong, "truncate")}>{paired.displayName}</span>
            {#if pairedAbout}
              <span class={cn(text.meta, "truncate")}>{pairedAbout}</span>
            {/if}
          </span>
          <Icon icon={CheckCircleIcon} class={cn(icon.button, "shrink-0 text-emerald-500")} />
        </div>
      {:else if bridgeOn}
        <div
          class={cn(
            "flex size-56 items-center justify-center rounded-lg bg-white p-2 ring-1 ring-border/60",
            expired && "opacity-30",
          )}
        >
          {#if loading && !svg}
            <Spinner aria-label={i18n.t("common.loading")} />
          {:else if svg}
            <!-- Generated by the backend's QR encoder from the bridge's payload:
                 paths and rectangles only, no text from outside. -->
            <div class="size-full [&>svg]:size-full" role="img" aria-label={i18n.t("bridge.pairQrLabel")}>
              {@html svg}
            </div>
          {/if}
        </div>

        <p class={cn(text.meta, "min-h-4 text-center")}>
          {#if error}
            <span class="text-destructive">{error}</span>
          {:else if expired}
            {i18n.t("bridge.pairExpired")}
          {:else if svg}
            {i18n.t("bridge.pairWaiting", { seconds: String(remaining) })}
          {/if}
        </p>

        {#if code && svg && !expired}
          <div class="flex items-center gap-2">
            <span class={text.meta}>{i18n.t("bridge.pairCodeLabel")}</span>
            <span
              class="select-all rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-sm tracking-[0.18em] text-foreground"
            >
              {code}
            </span>
            <TooltipSimple title={i18n.t("bridge.pairCodeCopy")}>
              {#snippet children(tp)}
                <Button
                  {...tp}
                  variant="ghost"
                  size="icon-sm"
                  class={iconButton.action}
                  aria-label={i18n.t("bridge.pairCodeCopy")}
                  onclick={() => void copyCode()}
                >
                  <Icon icon={codeCopied ? CheckIcon : CopyIcon} class={icon.button} />
                </Button>
              {/snippet}
            </TooltipSimple>
          </div>
        {/if}
      {:else}
        <div class="flex w-full flex-col items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-4">
          {#if bridgeStarting}
            <Spinner aria-label={i18n.t("common.loading")} />
            <p class={cn(text.meta, "text-center")}>{i18n.t("bridge.pairStarting")}</p>
          {:else}
            <Button onclick={turnBridgeOn}>{i18n.t("bridge.pairTurnOn")}</Button>
            <p class={cn(text.meta, "text-center")}>{i18n.t("bridge.pairTurnOnHint")}</p>
          {/if}
        </div>
      {/if}
      </section>
    </Dialog.Body>

    <Dialog.Footer>
      {#if paired}
        <Button variant="ghost" onclick={beginPairing}>{i18n.t("bridge.pairAnother")}</Button>
        <Button onclick={() => (open = false)}>{i18n.t("common.done")}</Button>
      {:else}
        <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.close")}</Button>
        {#if bridgeOn}
          <Button variant="outline" disabled={loading} onclick={() => void load()}>
            <Icon icon={RotateCcwIcon} data-icon="inline-start" />
            {i18n.t("bridge.pairRegenerate")}
          </Button>
        {/if}
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
