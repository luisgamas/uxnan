<script lang="ts">
  // What a chat tab on a host shows while that host's own bridge is not
  // connected (`02g` §5.18). The conversation lives on that machine's bridge,
  // so there is nothing to install or restart from here — only to say whose it
  // is, what it is doing, and to look again. The host's connection itself is
  // Settings → Hosts' business.
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon";
  import type { BridgeClientStore } from "$lib/bridge/client.svelte";
  import { hosts } from "$lib/state/hosts.svelte";
  import { sshHostId } from "$lib/target";
  import { app } from "$lib/state/app.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  let { bridge }: { bridge: BridgeClientStore } = $props();

  const host = $derived(hosts.labelOf(sshHostId(bridge.target) ?? ""));
  const status = $derived(bridge.status);
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
  {#if status.state === "connecting"}
    <Spinner class={cn(icon.nav, "text-muted-foreground")} />
    <p class={text.meta}>{i18n.t("chat.hostGateConnecting", { host })}</p>
  {:else}
    <Icon icon={PlugSocketIcon} class={cn(icon.empty, "text-muted-foreground/60")} />
    <div class="flex max-w-sm flex-col gap-1">
      <h2 class={text.title}>{i18n.t("chat.hostGateTitle", { host })}</h2>
      <p class={text.meta}>
        {status.state === "off" ? i18n.t("chat.hostGateOffline", { host }) : i18n.t("chat.hostGateNone", { host })}
      </p>
    </div>
    <div class="flex flex-wrap items-center justify-center gap-2">
      {#if status.state !== "off"}
        <Button size="sm" variant="outline" onclick={() => void bridge.retry()}>
          {i18n.t("bridge.retry")}
        </Button>
      {/if}
      <Button size="sm" variant="ghost" onclick={() => app.openSettings("hosts")}>
        {i18n.t("chat.hostGateSettings")}
      </Button>
    </div>
  {/if}
</div>
