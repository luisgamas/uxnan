<script lang="ts">
  // Settings → Bridge & mobile: how the desktop connects to the Uxnan bridge —
  // the process that drives the conversations a chat tab shows, the same ones
  // the phone shows (plan 029, architecture/02a §5.8.15) — and getting that
  // bridge installed and current without leaving the app.
  //
  // Three modes and nothing hidden: `off` costs nothing at all, `attach` uses a
  // bridge the user already runs, `managed` also starts one when none runs and
  // stops it on exit. The status row says which state the connection is in; a
  // state that cannot be proven is never painted green.
  import { Button } from "$lib/components/ui/button";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Select from "$lib/components/ui/select";
  import { Switch } from "$lib/components/ui/switch";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import { app } from "$lib/state/app.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { toast } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, field, icon, text } from "$lib/design";
  import type { BridgeMode } from "$lib/types";

  const MODES = ["off", "attach", "managed"] as const satisfies readonly BridgeMode[];

  const mode = $derived<BridgeMode>(app.settings.bridge?.mode ?? "off");
  const autoUpdate = $derived(app.settings.bridge?.autoUpdate === true);
  const status = $derived(bridge.status);
  const info = $derived(bridgeInstall.info);
  const running = $derived(bridgeInstall.status);
  const result = $derived(bridgeInstall.lastResult);
  let outputOpen = $state(false);

  // What is installed is read when the pane opens and after every install.
  $effect(() => {
    void bridgeInstall.probe();
    void bridgeInstall.refreshStatus();
  });
  $effect(() => {
    if (bridgeInstall.installing) outputOpen = true;
  });

  function setBridge(patch: { mode?: BridgeMode; autoUpdate?: boolean }) {
    app.settings.bridge = { mode, ...app.settings.bridge, ...patch };
    void app.persistSettings();
  }

  /** Phones connected to the bridge right now (read when connected). */
  let phones = $state<{ deviceId: string; displayName: string; connectedAt: number }[]>([]);
  $effect(() => {
    if (status.state !== "connected") {
      phones = [];
      return;
    }
    void bridge
      .call<{ deviceId: string; displayName: string; connectedAt: number }[]>(
        "bridge/connectedPhones",
      )
      .then((list) => (phones = Array.isArray(list) ? list : []))
      .catch(() => (phones = []));
  });

  const statusLabel = $derived.by(() => {
    switch (status.state) {
      case "off":
        return i18n.t("bridge.statusOff");
      case "connecting":
        return i18n.t("bridge.statusConnecting");
      case "connected":
        return status.managed
          ? i18n.t("bridge.statusConnectedManaged", { version: status.bridgeVersion })
          : i18n.t("bridge.statusConnected", { version: status.bridgeVersion });
      case "unavailable":
        return i18n.t(`bridge.unavailable.${status.reason}`);
    }
  });

  /** A newer bridge is published than the one installed (or running). */
  const updateTo = $derived(running?.updateAvailable ? (running.latestVersion ?? null) : null);

  const versionLine = $derived.by(() => {
    if (!info) return i18n.t("bridge.checking");
    if (!info.installed) return info.npm ? i18n.t("bridge.notInstalledDesc") : i18n.t("bridge.needsNode");
    const installed = info.version
      ? i18n.t("bridge.versionInstalled", { version: info.version })
      : i18n.t("bridge.versionUnknown");
    return updateTo ? `${installed} · ${i18n.t("bridge.updateAvailable", { version: updateTo })}` : installed;
  });

  /** The running bridge is older than the one just installed: it needs a restart. */
  const restartNeeded = $derived(
    !!result?.ok &&
      !result.restarted &&
      status.state === "connected" &&
      !!info?.version &&
      status.bridgeVersion !== info.version,
  );

  async function install() {
    const done = await bridgeInstall.install();
    if (!done?.ok) return;
    toast.success(i18n.t("bridge.installOk", { version: done.version ?? "" }));
    // Installed for the first time with the connection off: connect now, the
    // reason the user pressed Install.
    if (mode === "off") setBridge({ mode: "managed" });
  }

  async function copyCommand() {
    if (!info) return;
    await clipboardWrite(info.command);
    toast.success(i18n.t("bridge.copied"));
  }
</script>

<div class="flex flex-col gap-10">
  <SettingsSection title={i18n.t("settings.bridge")} description={i18n.t("settings.bridgeDesc")}>
    <div class="divide-y divide-border/60">
      <SettingsRow label={i18n.t("bridge.mode")} description={i18n.t(`bridge.modeDesc.${mode}`)}>
        {#snippet control()}
          <Select.Root type="single" value={mode} onValueChange={(v) => setBridge({ mode: v as BridgeMode })}>
            <Select.Trigger class={field.selectWide} aria-label={i18n.t("bridge.mode")}>
              {i18n.t(`bridge.modeLabel.${mode}`)}
            </Select.Trigger>
            <Select.Content>
              {#each MODES as m (m)}
                <Select.Item value={m} label={i18n.t(`bridge.modeLabel.${m}`)}>
                  {i18n.t(`bridge.modeLabel.${m}`)}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("bridge.status")}>
        {#snippet meta()}
          {#if status.state === "unavailable" && status.detail}
            <span class={cn(text.meta, "break-words")}>{status.detail}</span>
          {/if}
        {/snippet}
        {#snippet control()}
          <div class="flex items-center gap-2">
            {#if status.state === "connecting"}
              <Spinner class={icon.status} aria-label={i18n.t("bridge.statusConnecting")} />
            {:else}
              <span
                class={cn(
                  "size-1.5 shrink-0 rounded-full",
                  status.state === "connected" ? "bg-emerald-500" : "bg-muted-foreground/30",
                  status.state === "unavailable" && "bg-amber-500",
                )}
                aria-hidden="true"
              ></span>
            {/if}
            <span class={text.body}>{statusLabel}</span>
            {#if status.state === "unavailable"}
              <Button variant="outline" size="sm" onclick={() => void bridge.retry()}>
                {i18n.t("bridge.retry")}
              </Button>
            {/if}
          </div>
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("bridge.version")} description={versionLine}>
        {#snippet meta()}
          {#if restartNeeded}
            <span class={cn(text.meta, "text-amber-700 dark:text-amber-400")}>
              {i18n.t("bridge.restartNeeded", { version: info?.version ?? "" })}
            </span>
          {/if}
          {#if result && !result.ok}
            <span class={cn(text.meta, "text-destructive")}>
              {result.permissionDenied ? i18n.t("bridge.permissionDenied") : i18n.t("bridge.installFailed")}
            </span>
          {/if}
        {/snippet}
        {#snippet control()}
          <div class="flex items-center gap-1.5">
            {#if info && (!info.installed || updateTo)}
              <Button
                size="sm"
                disabled={bridgeInstall.installing || !info.npm}
                onclick={() => void install()}
              >
                {#if bridgeInstall.installing}
                  <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                {/if}
                {#if bridgeInstall.installing}
                  {i18n.t(info.installed ? "bridge.updating" : "bridge.installing")}
                {:else}
                  {i18n.t(info.installed ? "bridge.updateAction" : "bridge.installAction")}
                {/if}
              </Button>
            {/if}
            {#if info}
              <TooltipSimple title={i18n.t("bridge.copyInstall")}>
                {#snippet children(tp)}
                  <Button
                    {...tp}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={i18n.t("bridge.copyInstall")}
                    onclick={() => void copyCommand()}
                  >
                    <Icon icon={Copy01Icon} class={icon.button} />
                  </Button>
                {/snippet}
              </TooltipSimple>
            {/if}
          </div>
        {/snippet}
        {#if bridgeInstall.log.length > 0}
          <Collapsible.Root bind:open={outputOpen} class="mt-2">
            <Collapsible.Trigger class={cn(chat.activity, "w-auto px-1")}>
              <Icon
                icon={ArrowRight01Icon}
                class={cn(icon.status, "transition-transform", outputOpen && "rotate-90")}
              />
              {i18n.t("bridge.showOutput")}
            </Collapsible.Trigger>
            <Collapsible.Content>
              <pre class={cn(chat.output, "mt-1")}>{bridgeInstall.log.join("\n")}</pre>
            </Collapsible.Content>
          </Collapsible.Root>
        {/if}
      </SettingsRow>

      <SettingsRow label={i18n.t("bridge.autoUpdate")} description={i18n.t("bridge.autoUpdateDesc")}>
        {#snippet control()}
          <Switch
            checked={autoUpdate}
            aria-label={i18n.t("bridge.autoUpdate")}
            onCheckedChange={(on) => setBridge({ autoUpdate: on })}
          />
        {/snippet}
      </SettingsRow>
    </div>
  </SettingsSection>

  {#if status.state === "connected"}
    <SettingsSection title={i18n.t("bridge.phones")} description={i18n.t("bridge.phonesDesc")}>
      <div class="divide-y divide-border/60">
        {#each phones as phone (phone.deviceId)}
          <SettingsRow label={phone.displayName}>
            {#snippet control()}
              <span class={text.meta}>
                {i18n.t("bridge.phoneSince", {
                  time: new Date(phone.connectedAt).toLocaleTimeString(i18n.locale),
                })}
              </span>
            {/snippet}
          </SettingsRow>
        {:else}
          <SettingsRow description={i18n.t("bridge.noPhones")} />
        {/each}
      </div>
    </SettingsSection>
  {/if}
</div>
