<script lang="ts">
  // The phone, one row under Search: "Connect a phone" until one is paired,
  // then the paired phone by name with whether it is connected right now (the
  // bridge's presence). Either way a click opens "Connect a phone" — the QR at
  // once, and the dialog notices the phone arrive.
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { connectPhone } from "$lib/bridge/connectPhone.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import StatusDot from "$lib/components/StatusDot.svelte";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, row, text } from "$lib/design";

  const connectedIds = $derived(
    new Set(chat.clients.filter((c) => c.kind === "phone").map((c) => c.id)),
  );
  // The phone to name: a connected one first, else the first paired.
  const phone = $derived(
    chat.devices.find((d) => connectedIds.has(d.deviceId)) ?? chat.devices[0] ?? null,
  );
  const others = $derived(Math.max(0, chat.devices.length - 1));
  const online = $derived(
    bridge.status.state === "connected" && phone !== null && connectedIds.has(phone.deviceId),
  );
  const label = $derived(
    phone === null
      ? i18n.t("sidebar.connectPhone")
      : others > 0
        ? i18n.t("sidebar.phoneAndOthers", { name: phone.displayName, n: String(others) })
        : phone.displayName,
  );
  const title = $derived(
    phone === null
      ? i18n.t("sidebar.connectPhoneHint")
      : online
        ? i18n.t("sidebar.phoneOnline", { name: phone.displayName })
        : i18n.t("sidebar.phoneOffline", { name: phone.displayName }),
  );
</script>

<button
  class={cn(row.sidebar, row.sidebarInactive, focus.ring)}
  {title}
  onclick={() => connectPhone.show()}
>
  <Icon icon={SmartphoneIcon} class={cn(icon.action, "shrink-0")} />
  <span class={cn("min-w-0 flex-1 truncate", phone === null && "text-sidebar-foreground/60")}>
    {label}
  </span>
  {#if phone !== null}
    <StatusDot tone={online ? "ok" : "off"} />
  {/if}
</button>
