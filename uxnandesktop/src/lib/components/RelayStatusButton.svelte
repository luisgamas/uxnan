<script lang="ts">
  // Status-bar relay indicator: how the user's own relay stands, at a glance —
  // the cloud icon tinted like the backend indicator (amber connecting, red
  // can't connect, muted off) — and a popover with the detail:
  // the state and the bridge's own words when it failed, the relay's address,
  // the phones reaching this computer through it, its version against the one
  // the bridge ships, and the way into Settings → Remote access.
  //
  // Same shape as the ports and usage indicators (icon trigger, top-aligned
  // status popover) and, like them, hidden when there is nothing to say: no
  // bridge, a bridge too old for `relay/*`, or no relay set up. The bridge row
  // in the sidebar already says whether the bridge itself is up, and Settings
  // → Remote access is where a relay is set up in the first place.
  //
  // Connected is two looks, because a relay can be up and carry nothing: phones
  // on the same network or over Tailscale reach the bridge directly. Standing by
  // (no phone on it, by the relay's own `connectedPhones`) is as quiet as off —
  // a muted icon, "Ready" — and only a relay actually carrying phones lights up
  // green, with their count beside the icon (the shape the orchestration count
  // has), so a lit cloud always means "a phone is using your relay right now".
  //
  // A client, never a second copy: it reads the one relay replica (`relay`) and
  // the one presence replica (`chat.clients`), and every change — updating the
  // relay included — happens in Settings → Remote access, where the token
  // prompt for that already lives.
  import * as Popover from "$lib/components/ui/popover";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Icon } from "$lib/components/ui/icon";
  import StatusDot, { type StatusTone } from "$lib/components/StatusDot.svelte";
  import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
  import CloudUploadIcon from "@hugeicons/core-free-icons/CloudUploadIcon";
  import { bridge } from "$lib/bridge/client.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { REMOTE_ACCESS_ANCHOR, relay, relayUpdateAvailable } from "$lib/bridge/relay.svelte";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon as iconSize, overlay, shell, text } from "$lib/design";
  import type { RelayConnectionState } from "$shared/models/relay";
  import {
    shouldPreventStatusPopoverAutoFocus,
    type StatusPopoverCloseReason,
  } from "./status-popover-focus";

  const status = $derived(bridge.connected && relay.supported ? relay.status : null);
  const endpoint = $derived(status?.endpoint ?? null);
  const shown = $derived(!!status && !!endpoint);

  /** The relay's own count of phones on it; the names come from presence,
   *  which says per phone how it is connected. */
  const phoneCount = $derived(status?.connectedPhones ?? 0);

  /** What the indicator shows: the bridge's state, with `connected` split by
   *  whether any phone is actually on the relay. */
  type RelayLook = Exclude<RelayConnectionState, "connected"> | "standby" | "inUse";
  const LOOKS: Record<RelayLook, { dot: StatusTone; icon: string }> = {
    inUse: { dot: "ok", icon: "text-green-600 dark:text-green-400" },
    // Healthy (the popover's dot says so) but carrying nothing: no tint.
    standby: { dot: "ok", icon: "" },
    connecting: { dot: "busy", icon: "text-amber-600 dark:text-amber-400" },
    error: { dot: "error", icon: "text-destructive" },
    off: { dot: "off", icon: "" },
  };
  const look = $derived<RelayLook>(
    status?.state === "connected"
      ? phoneCount > 0
        ? "inUse"
        : "standby"
      : (status?.state ?? "off"),
  );
  const tone = $derived(LOOKS[look]);
  const stateLabel = $derived(
    look === "inUse"
      ? i18n.t("relay.indicatorInUse")
      : look === "standby"
        ? i18n.t("relay.indicatorStandby")
        : i18n.t(`relay.state.${look}`),
  );

  const updateAvailable = $derived(relayUpdateAvailable(status));
  const customOutdated = $derived(
    status?.provider === "custom" &&
      !!status.deployedVersion &&
      status.deployedVersion !== status.bundledVersion,
  );

  const relayPhones = $derived(
    chat.clients
      .filter((c) => c.kind === "phone" && c.route === "relay")
      .map((c) => ({
        id: c.id,
        name: chat.devices.find((d) => d.deviceId === c.id)?.displayName ?? c.name,
      })),
  );

  const triggerLabel = $derived(
    look === "inUse"
      ? i18n.plural(phoneCount, "relay.indicatorInUseOne", "relay.indicatorInUseOther")
      : look === "standby"
        ? i18n.t("relay.indicatorStandbyTooltip")
        : i18n.t("relay.indicator", { state: stateLabel }),
  );

  let open = $state(false);
  let triggerRef = $state<HTMLButtonElement | null>(null);
  let contentRef = $state<HTMLElement | null>(null);
  let triggerTooltipOpen = $state(false);
  let closeReason = $state<StatusPopoverCloseReason>("programmatic");

  function onOpenChange(next: boolean): void {
    if (next) {
      closeReason = "programmatic";
      triggerTooltipOpen = false;
    }
  }

  function onInteractOutside(event?: PointerEvent): void {
    closeReason = "outside";
    open = false;
    const target = event?.target;
    if (target instanceof HTMLElement) queueMicrotask(() => target.focus());
  }

  // Same native-surface fallback the other status popovers keep.
  function onWindowPointerDown(event: PointerEvent): void {
    if (!open || !contentRef || !triggerRef) return;
    const target = event.target;
    if (target instanceof Node && !contentRef.contains(target) && !triggerRef.contains(target)) {
      onInteractOutside(event);
    }
  }

  /** Settings → Bridge & mobile, scrolled to Remote access (the section mounts
   *  a frame or two after the dialog opens). */
  async function openRemoteAccess(): Promise<void> {
    closeReason = "navigation";
    open = false;
    app.openSettings("bridge");
    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const section = document.getElementById(REMOTE_ACCESS_ANCHOR);
      if (section) {
        section.scrollIntoView?.({ block: "start", behavior: "smooth" });
        return;
      }
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#if shown && status && endpoint}
  <Popover.Root bind:open {onOpenChange}>
    <TooltipSimple bind:open={triggerTooltipOpen} title={triggerLabel}>
      {#snippet children(tp)}
        <Popover.Trigger
          bind:ref={triggerRef}
          {...tp}
          class={cn(
            look === "inUse" ? shell.statusBarItem : shell.statusBarAction,
            "relative text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          aria-label={triggerLabel}
          data-relay-state={status.state}
          data-relay-look={look}
        >
          <Icon
            icon={CloudServerIcon}
            class={cn(iconSize.action, tone.icon, status.state === "connecting" && "animate-pulse")}
          />
          {#if look === "inUse"}
            <span class={cn("font-medium tabular-nums", tone.icon)} data-relay-count>
              {phoneCount}
            </span>
          {/if}
          {#if updateAvailable}
            <span
              class="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-1 ring-background"
              aria-hidden="true"
            ></span>
          {/if}
        </Popover.Trigger>
      {/snippet}
    </TooltipSimple>

    <Popover.Content
      bind:ref={contentRef}
      align="end"
      side="top"
      width="status"
      padding="none"
      onInteractOutside={onInteractOutside}
      onEscapeKeydown={() => (closeReason = "escape")}
      onCloseAutoFocus={(event) => {
        triggerTooltipOpen = false;
        if (shouldPreventStatusPopoverAutoFocus(closeReason)) {
          event.preventDefault();
        } else {
          queueMicrotask(() => triggerRef?.focus());
        }
      }}
    >
      <div class="flex flex-col gap-2 p-3">
        <div class="flex items-center gap-2">
          <StatusDot tone={tone.dot} />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {i18n.t("relay.indicatorTitle")}
          </span>
          <span class={cn("shrink-0", text.meta)}>{stateLabel}</span>
        </div>
        <p class={cn(text.meta, "break-all font-mono")}>{endpoint.url}</p>
        {#if status.state === "error"}
          {#if status.lastError}
            <div
              role="alert"
              class={cn(
                "rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 break-words text-destructive",
                text.meta,
              )}
            >
              {status.lastError}
            </div>
          {/if}
        {:else if status.state === "off"}
          <p class={text.meta}>{i18n.t("relay.indicatorOffHint")}</p>
        {:else if status.state === "connecting"}
          <p class={text.meta}>{i18n.t("relay.indicatorConnectingHint")}</p>
        {/if}
      </div>

      {#if status.state === "connected"}
        <div class="flex flex-col gap-1.5 border-t border-border/60 p-3">
          <div class={overlay.dataRow}>
            <span class={cn("min-w-0 truncate", text.meta)}>{i18n.t("relay.indicatorPhones")}</span>
            <span
              class={cn(
                "shrink-0 font-medium tabular-nums",
                phoneCount > 0 ? "text-foreground" : "text-muted-foreground",
                text.body,
              )}
            >
              {phoneCount}
            </span>
          </div>
          {#if relayPhones.length > 0}
            <ul class="flex flex-col">
              {#each relayPhones as phone (phone.id)}
                <li class="flex min-w-0 items-center gap-2 py-0.5">
                  <Icon icon={SmartphoneIcon} class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class={cn("min-w-0 truncate text-foreground", text.body)}>{phone.name}</span>
                </li>
              {/each}
            </ul>
          {:else if phoneCount === 0}
            <p class={text.meta}>{i18n.t("relay.indicatorPhonesNone")}</p>
          {/if}
        </div>
      {/if}

      <div class="flex flex-col gap-2 border-t border-border/60 p-3">
        <div class={overlay.dataRow}>
          <span class={cn("min-w-0 truncate", text.meta)}>{i18n.t("relay.version")}</span>
          <span class={cn("shrink-0 font-medium tabular-nums text-foreground", text.body)}>
            {status.deployedVersion ?? "—"}
          </span>
        </div>
        {#if updateAvailable}
          <div class="flex items-center gap-2">
            <span class={cn("min-w-0 flex-1", text.meta)}>
              {i18n.t("relay.indicatorUpdate", { bundled: status.bundledVersion })}
            </span>
            <Button size="sm" class="shrink-0" onclick={() => void openRemoteAccess()}>
              <Icon icon={CloudUploadIcon} data-icon="inline-start" />
              {i18n.t("relay.updateAction")}
            </Button>
          </div>
        {:else if customOutdated}
          <p class={text.meta}>{i18n.t("relay.versionCustomOld", { bundled: status.bundledVersion })}</p>
        {/if}
      </div>

      <button
        type="button"
        class="flex w-full items-center gap-1.5 border-t border-border/60 px-3 py-2 text-muted-foreground hover:text-foreground {text.meta}"
        onclick={() => void openRemoteAccess()}
      >
        <Icon icon={SettingsIcon} class="size-3.5" />
        {i18n.t("relay.indicatorSettings")}
      </button>
    </Popover.Content>
  </Popover.Root>
{/if}
