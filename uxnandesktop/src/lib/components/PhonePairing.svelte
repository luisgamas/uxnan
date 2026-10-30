<script lang="ts">
  // Pairing a phone with a machine's bridge: the one pairing surface, shown in
  // the Bridge window and in the welcome tour.
  //
  // - Bridge on: the RUNNING bridge's own payload (`bridge_pairing_qr` →
  //   `bridge/generatePairingQr`: its LAN hosts, its session, the pairing window
  //   armed) drawn as a QR, never one from a second process — plus its manual
  //   code (`bridge/pairingCode`, what `uxnan-bridge code` prints) for a phone
  //   that types it, and a countdown to when the payload expires.
  // - Paired: a phone that was not paired when pairing began appears in the
  //   bridge's list (`stream/devices/updated`), or a paired one connects —
  //   either way the QR gives way to that phone.
  // - Bridge off: the one action that turns it on (this machine), or where to
  //   start it (a host's own bridge).
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import CheckCircleIcon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import { clipboardWrite } from "$lib/clipboard";
  import { bridges } from "$lib/bridge/client.svelte";
  import { chatFor } from "$lib/bridge/chat.svelte";
  import { hosts } from "$lib/state/hosts.svelte";
  import { sshHostId, type TargetId } from "$lib/target";
  import { app } from "$lib/state/app.svelte";
  import { formatCountdown } from "$lib/clock";
  import type { TrustedDevice } from "$shared/models/session";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";

  let {
    active,
    target,
    paired = $bindable(null),
    loading = $bindable(false),
    size = "size-56",
  }: {
    /** Pairing runs while this is true (the dialog or the tour step is open). */
    active: boolean;
    /** A host's own bridge; this machine's when unset. */
    target?: TargetId;
    /** The phone that just paired (or connected), once one has. */
    paired?: TrustedDevice | null;
    /** A QR is being fetched. */
    loading?: boolean;
    /** The QR's box size (a Tailwind size class). */
    size?: string;
  } = $props();

  // One pairing surface is for one machine for as long as it lives.
  const machine = untrack(() => target);
  const onHost = sshHostId(machine);
  const bridge = bridges.for(machine);
  const chat = chatFor(machine);

  let svg = $state<string | null>(null);
  let code = $state<string | null>(null);
  let codeCopied = $state(false);
  let codeCopiedTimer: ReturnType<typeof setTimeout> | undefined;
  let expiresAt = $state(0);
  let now = $state(Date.now());
  let error = $state<string | null>(null);

  const bridgeOn = $derived(bridge.status.state === "connected");
  const bridgeStarting = $derived(bridge.status.state === "connecting");
  const remaining = $derived(Math.max(0, Math.round((expiresAt - now) / 1000)));
  const expired = $derived(svg !== null && remaining === 0);

  // What was already there when pairing began, so a newcomer stands out.
  let knownDevices = new Set<string>();
  let knownConnected = new Set<string>();
  let pairedId = $state<string | null>(null);
  $effect(() => {
    paired = pairedId === null ? null : (chat.devices.find((d) => d.deviceId === pairedId) ?? null);
  });

  function connectedPhoneIds(): Set<string> {
    return new Set(chat.clients.filter((c) => c.kind === "phone").map((c) => c.id));
  }

  /** Start over: a fresh QR, and watch for the next phone. */
  export function restart(): void {
    knownDevices = new Set(chat.devices.map((d) => d.deviceId));
    knownConnected = connectedPhoneIds();
    pairedId = null;
    void regenerate();
  }

  /** A fresh QR from the running bridge. */
  export async function regenerate(): Promise<void> {
    loading = true;
    error = null;
    try {
      const qr = await invoke<{ svg: string; expiresAt: number; code?: string | null }>(
        "bridge_pairing_qr",
        onHost ? { target: machine } : {},
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

  // Active with the bridge on (or once it comes on): start pairing.
  $effect(() => {
    if (!active || !bridgeOn) return;
    untrack(restart);
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  // Notice the phone arrive: newly paired, or a paired one connecting.
  $effect(() => {
    if (!active || !bridgeOn || pairedId !== null) return;
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
      "flex items-center justify-center rounded-lg bg-white p-2 ring-1 ring-border/60",
      size,
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
      {i18n.t("bridge.pairWaiting", { time: formatCountdown(remaining) })}
    {/if}
  </p>

  {#if code && svg && !expired}
    <div class="flex flex-wrap items-center justify-center gap-2">
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
    {:else if onHost}
      <p class={cn(text.meta, "text-center")}>
        {i18n.t("bridge.pairHostOff", { host: hosts.labelOf(onHost) })}
      </p>
    {:else}
      <Button onclick={turnBridgeOn}>{i18n.t("bridge.pairTurnOn")}</Button>
      <p class={cn(text.meta, "text-center")}>{i18n.t("bridge.pairTurnOnHint")}</p>
    {/if}
  </div>
{/if}
