<script lang="ts">
  // What a chat tab shows while there is no bridge to talk to. A chat is a
  // conversation the bridge drives (so the phone sees it too); without one
  // there is nothing to show, and this says why and offers the one action
  // that fixes it — never a silent empty pane.
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon";
  import { app } from "$lib/state/app.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  const status = $derived(bridge.status);

  function connect() {
    // Managed: use a running bridge, or start one — the path that works on
    // a machine with the bridge installed and nothing else set up.
    app.settings.bridge = { ...app.settings.bridge, mode: "managed" };
    void app.persistSettings();
  }
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
  {#if status.state === "connecting"}
    <Spinner class="size-5 text-muted-foreground" />
    <p class={text.meta}>{i18n.t("bridge.statusConnecting")}</p>
  {:else}
    <Icon icon={PlugSocketIcon} class={cn(icon.empty, "text-muted-foreground/60")} />
    <div class="flex max-w-sm flex-col gap-1">
      <h2 class={text.title}>{i18n.t("chat.gateTitle")}</h2>
      <p class={text.meta}>
        {#if status.state === "off"}
          {i18n.t("chat.gateOff")}
        {:else if status.state === "unavailable"}
          {i18n.t(`bridge.unavailable.${status.reason}`)}
        {/if}
      </p>
      {#if status.state === "unavailable" && status.detail}
        <p class={cn(text.meta, "break-words font-mono text-[11px]")}>{status.detail}</p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if status.state === "off"}
        <Button size="sm" onclick={connect}>{i18n.t("chat.gateConnect")}</Button>
      {:else}
        <Button size="sm" variant="outline" onclick={() => void bridge.retry()}>
          {i18n.t("bridge.retry")}
        </Button>
      {/if}
      <Button size="sm" variant="ghost" onclick={() => app.openSettings("bridge")}>
        {i18n.t("chat.gateSettings")}
      </Button>
    </div>
  {/if}
</div>
