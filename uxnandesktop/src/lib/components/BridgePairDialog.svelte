<script lang="ts">
  // "Connect a phone", from anywhere it is offered (the sidebar, Settings →
  // Bridge & mobile, the welcome tour): the QR shows at once, and the dialog
  // notices the phone arrive.
  //
  // - Bridge off: one button turns it on as the user's service (`managed`),
  //   then the QR follows.
  // - Bridge on: the RUNNING bridge's own payload (`bridge_pairing_qr` →
  //   `bridge/generatePairingQr`: its LAN hosts, its session, the pairing window
  //   armed) — exactly what `uxnan-bridge qr` prints. It expires; the dialog
  //   counts down and offers a fresh one.
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
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import { bridge } from "$lib/bridge/client.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let svg = $state<string | null>(null);
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
      const qr = await invoke<{ svg: string; expiresAt: number }>("bridge_pairing_qr");
      svg = qr.svg;
      expiresAt = qr.expiresAt;
      now = Date.now();
    } catch (err) {
      svg = null;
      error = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    } finally {
      loading = false;
    }
  }

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
  <Dialog.Content size="small">
    <Dialog.Header>
      <Dialog.Title class={text.title}>
        {paired ? i18n.t("bridge.pairDoneTitle") : i18n.t("bridge.pairTitle")}
      </Dialog.Title>
      <Dialog.Description class={text.body}>
        {#if paired}
          {i18n.t("bridge.pairDoneDesc")}
        {:else if bridgeOn}
          {i18n.t("bridge.pairDesc")}
        {:else}
          {i18n.t("bridge.pairOffDesc")}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <Dialog.Body class="flex flex-col items-center gap-3 py-0">
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
