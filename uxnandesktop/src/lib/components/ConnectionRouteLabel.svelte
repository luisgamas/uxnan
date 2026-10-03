<script lang="ts" module>
  import type { ConnectionRoute } from "$shared/models/session";
  import type { ClientPresence } from "$shared/models/sync";

  /** Each connected phone's route, by device id, as presence reports it
   *  (`stream/presence/updated` / `sync/changes`). A phone on a bridge that
   *  predates `route` is simply absent. */
  export function phoneRoutes(clients: readonly ClientPresence[]): Map<string, ConnectionRoute> {
    const routes = new Map<string, ConnectionRoute>();
    for (const client of clients) {
      if (client.kind === "phone" && client.route) routes.set(client.id, client.route);
    }
    return routes;
  }
</script>

<script lang="ts">
  // How a phone is connected to the bridge right now — on the same network,
  // over Tailscale, or through the user's relay — as one quiet icon + word.
  // The same three icons Settings → Remote access uses to explain those ways,
  // so the label reads as "this one" of them. No route (the desktop itself, or
  // a bridge too old to say) draws nothing.
  import { Icon, type IconNode } from "$lib/components/ui/icon";
  import WifiIcon from "@hugeicons/core-free-icons/Wifi01Icon";
  import GlobeLockIcon from "@hugeicons/core-free-icons/GlobeLockIcon";
  import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";

  let { route, class: className }: { route?: ConnectionRoute | null; class?: string } = $props();

  const ROUTES: Record<ConnectionRoute, { icon: IconNode; label: MessageKey; hint: MessageKey }> = {
    lan: { icon: WifiIcon, label: "route.lan", hint: "route.lanHint" },
    tailscale: { icon: GlobeLockIcon, label: "route.tailscale", hint: "route.tailscaleHint" },
    relay: { icon: CloudServerIcon, label: "route.relay", hint: "route.relayHint" },
  };
  const shown = $derived(route ? ROUTES[route] : null);
</script>

{#if shown}
  <span
    class={cn("inline-flex shrink-0 items-center gap-1", className)}
    title={i18n.t(shown.hint)}
    data-route={route}
  >
    <Icon icon={shown.icon} class="size-3" />
    {i18n.t(shown.label)}
  </span>
{/if}
