<script lang="ts" module>
  const TONE = {
    green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    amber: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    red: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300",
    blue: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };
</script>

<script lang="ts">
  // The bridge, one row under Search: its name, how many phones are connected
  // right now, and its state as a coloured badge — online, starting, needs
  // attention, stopped or failed, a newer version, or an update under way.
  // A click opens the Bridge
  // window (`bridgePanel`): the state and the update, the devices, the QR.
  import { bridge } from "$lib/bridge/client.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { bridgePanel } from "$lib/bridge/bridgePanel.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Icon } from "$lib/components/ui/icon";
  import ServerIcon from "@hugeicons/core-free-icons/ServerStack01Icon";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { focus, icon, row } from "$lib/design";

  const connected = $derived(bridge.status.state === "connected");
  const phonesOnline = $derived(connected ? chat.clients.filter((c) => c.kind === "phone").length : 0);
  const updating = $derived(bridgeInstall.updating || bridgeInstall.installing);
  const offer = $derived(connected ? bridgeInstall.offer : null);

  const failure = $derived(bridgeInstall.status?.update?.failure ?? null);

  // The badge IS the signal: its own colour says the state — green online,
  // amber something to look at, red stopped or failed, blue a new version.
  type State = "updating" | "update" | "failed" | "online" | "starting" | "attention" | "stopped";
  const state = $derived.by<State>(() => {
    const status = bridge.status;
    if (updating) return "updating";
    if (connected && failure) return "failed";
    if (offer) return "update";
    if (connected) return "online";
    if (status.state === "connecting") return "starting";
    if (status.state === "unavailable") return status.reason === "failed" ? "failed" : "attention";
    return "stopped";
  });
  const BADGE: Record<State, { key: MessageKey; tone: string }> = {
    updating: { key: "sidebar.bridgeBadgeUpdating", tone: "animate-pulse " + TONE.blue },
    update: { key: "sidebar.bridgeBadgeUpdate", tone: TONE.blue },
    failed: { key: "sidebar.bridgeBadgeFailed", tone: TONE.red },
    online: { key: "sidebar.bridgeBadgeOnline", tone: TONE.green },
    starting: { key: "sidebar.bridgeBadgeStarting", tone: "animate-pulse " + TONE.amber },
    attention: { key: "sidebar.bridgeBadgeAttention", tone: TONE.amber },
    stopped: { key: "sidebar.bridgeBadgeStopped", tone: TONE.red },
  };
  const title = $derived(
    state === "failed" && failure
      ? failure.message
      : state === "update"
      ? offer?.version
        ? i18n.t("sidebar.bridgeUpdate", { version: offer.version })
        : i18n.t("sidebar.bridgeUpdateOlder")
      : phonesOnline > 0
        ? i18n.t("sidebar.bridgePhones", { n: String(phonesOnline) })
        : i18n.t("sidebar.bridgeHint"),
  );
</script>

<button class={cn(row.sidebar, row.sidebarInactive, focus.ring)} {title} onclick={() => bridgePanel.show()}>
  <Icon icon={ServerIcon} class={cn(icon.action, "shrink-0")} />
  <span class="min-w-0 flex-1 truncate">{i18n.t("sidebar.bridge")}</span>
  {#if phonesOnline > 0}
    <span
      class="inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-sidebar-foreground/60"
      aria-label={i18n.t("sidebar.bridgePhones", { n: String(phonesOnline) })}
    >
      <Icon icon={SmartphoneIcon} class="size-3" />
      {phonesOnline}
    </span>
  {/if}
  <Badge variant="outline" class={cn("h-5 min-w-[4.5rem] shrink-0 px-2.5 text-[11px]", BADGE[state].tone)}>
    {i18n.t(BADGE[state].key)}
  </Badge>
</button>
