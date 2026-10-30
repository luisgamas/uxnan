<script lang="ts">
  // What a chat tab shows while there is no bridge to talk to. A chat is a
  // conversation the bridge drives (so the phone sees it too); without one
  // there is nothing to show, and this says why and offers the one action that
  // fixes it — setting up the bridge this app carries when there is none, or
  // putting it in place of one too old to talk to the desktop, restarting it
  // when an older process still runs — so nobody has to leave the app, and
  // never a silent empty pane.
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon";
  import { app } from "$lib/state/app.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  const status = $derived(bridge.status);
  const info = $derived(bridgeInstall.info);
  /** This app carries a bridge it can put in place. */
  const carries = $derived(!!info?.bundledVersion);
  const reason = $derived(status.state === "unavailable" ? status.reason : null);
  /** No bridge anywhere: set up the one this app carries. */
  const missing = $derived(reason === "notInstalled");
  /** The running bridge predates the desktop channel, or the registered one
   *  does not start: the app's own bridge takes its place. */
  const replace = $derived(carries && (reason === "outdated" || reason === "serviceFailed"));
  /** A bridge runs without the channel the installed version has: restart it. */
  const stale = $derived(reason === "channelOff");
  const result = $derived(bridgeInstall.lastResult);

  $effect(() => {
    void bridgeInstall.probe();
  });

  function connect() {
    // Managed: use a running bridge, or start one — the path that works on a
    // machine with a bridge, or with nothing but this app.
    app.settings.bridge = { ...app.settings.bridge, mode: "managed" };
    void app.persistSettings();
  }

  async function install() {
    const done = await bridgeInstall.install();
    if (done?.ok) connect();
  }

  async function restart() {
    try {
      await bridgeInstall.restart();
    } catch (err) {
      toastError(err);
    }
  }
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
  {#if status.state === "connecting" || bridgeInstall.installing}
    <Spinner class={cn(icon.nav, "text-muted-foreground")} />
    <p class={text.meta}>
      {bridgeInstall.installing ? i18n.t("bridge.settingUp") : i18n.t("bridge.statusConnecting")}
    </p>
  {:else}
    <Icon icon={PlugSocketIcon} class={cn(icon.empty, "text-muted-foreground/60")} />
    <div class="flex max-w-sm flex-col gap-1">
      <h2 class={text.title}>
        {missing ? i18n.t("chat.gateInstallTitle") : i18n.t("chat.gateTitle")}
      </h2>
      <p class={text.meta}>
        {#if missing}
          {carries ? i18n.t("chat.gateInstallDesc") : i18n.t("bridge.noBundledRuntime")}
        {:else if status.state === "off"}
          {i18n.t("chat.gateOff")}
        {:else if status.state === "unavailable"}
          {i18n.t(`bridge.unavailable.${status.reason}`)}
        {/if}
      </p>
      {#if result && !result.ok}
        <p class={cn(text.meta, "break-words text-destructive")}>
          {result.rolledBack ? i18n.t("bridge.rolledBack") : i18n.t("bridge.installFailed")}
          {#if result.error}<span class="font-mono">{result.error}</span>{/if}
        </p>
      {:else if status.state === "unavailable" && status.detail && !missing}
        <p class={cn(text.meta, "break-words font-mono")}>{status.detail}</p>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if (missing && carries) || replace}
        <Button size="sm" onclick={() => void install()}>
          {i18n.t(missing ? "bridge.setUpAction" : "bridge.useOwnAction")}
        </Button>
      {:else if stale}
        <Button size="sm" disabled={bridgeInstall.restarting} onclick={() => void restart()}>
          {#if bridgeInstall.restarting}
            <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {i18n.t("bridge.restarting")}
          {:else}
            {i18n.t("bridge.restartAction")}
          {/if}
        </Button>
      {:else if status.state === "off"}
        <Button size="sm" onclick={connect}>{i18n.t("chat.gateConnect")}</Button>
      {/if}
      {#if status.state === "unavailable" && !missing}
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
