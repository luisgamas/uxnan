<script lang="ts">
  // Settings → Bridge & mobile: how the desktop connects to the Uxnan bridge —
  // the process that drives the conversations a chat tab shows, the same ones
  // the phone shows (architecture/02a §5.8.15) — and getting that bridge
  // installed, current and running without leaving the app.
  //
  // Built like the other panes: `SettingsSection` + `SettingsRow`, the mode in
  // the settings' `Combobox`, the state as a `StatusDot`, the actions laid out
  // like Settings → Updates (a check that is always there, the phase action
  // only when there is one), and the command and npm's output in `CodeBlock`.
  //
  // Three modes and nothing hidden: `off` costs nothing at all, `attach` uses a
  // bridge the user already runs, `managed` keeps it running as the user's
  // service (so the phone works while Uxnan is closed). A state that cannot be
  // proven is never painted green.
  //
  // With the bridge connected: the phones connected right now (presence, live),
  // pairing a new one, and the start folder the projects list is explored from —
  // settings every client shares (architecture/02a §5.8.17).
  import { Button } from "$lib/components/ui/button";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Switch } from "$lib/components/ui/switch";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import Combobox, { type ComboGroup } from "$lib/components/Combobox.svelte";
  import CodeBlock from "$lib/components/CodeBlock.svelte";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import StatusDot, { type StatusTone } from "$lib/components/StatusDot.svelte";
  import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
  import RotateCcwIcon from "@hugeicons/core-free-icons/Rotate01Icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import { app } from "$lib/state/app.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import BridgePairDialog from "$lib/components/BridgePairDialog.svelte";
  import QrCodeIcon from "@hugeicons/core-free-icons/QrCodeIcon";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, focus, icon, text } from "$lib/design";
  import type { BridgeMode } from "$lib/types";

  const MODES = ["off", "attach", "managed"] as const satisfies readonly BridgeMode[];

  const mode = $derived<BridgeMode>(app.settings.bridge?.mode ?? "off");
  const autoUpdate = $derived(app.settings.bridge?.autoUpdate === true);
  const status = $derived(bridge.status);
  const info = $derived(bridgeInstall.info);
  const running = $derived(bridgeInstall.status);
  const result = $derived(bridgeInstall.lastResult);
  let outputOpen = $state(false);

  const modeGroups = $derived<ComboGroup[]>([
    { items: MODES.map((m) => ({ value: m, label: i18n.t(`bridge.modeLabel.${m}`) })) },
  ]);

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

  /** Phones connected to the bridge right now — presence, kept live by the
   *  bridge (`stream/presence/updated`). */
  const phones = $derived(chat.clients.filter((c) => c.kind === "phone"));
  let pairOpen = $state(false);

  let choosingHome = $state(false);
  async function chooseHome() {
    if (choosingHome) return;
    choosingHome = true;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: true,
        title: i18n.t("bridge.home"),
        ...(chat.settings?.home ? { defaultPath: chat.settings.home } : {}),
      });
      if (typeof selected !== "string") return;
      await chat.setHome(selected);
      toast.success(i18n.t("bridge.homeChanged"));
    } catch (err) {
      toastError(err);
    } finally {
      choosingHome = false;
    }
  }

  const tone = $derived<StatusTone>(
    status.state === "connected"
      ? "ok"
      : status.state === "connecting"
        ? "busy"
        : status.state === "unavailable"
          ? "warn"
          : "off",
  );

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

  /** The running bridge predates the desktop channel: only an update helps. */
  const outdated = $derived(status.state === "unavailable" && status.reason === "outdated");
  /** A newer bridge is published than the one running. */
  const updateTo = $derived(running?.updateAvailable ? (running.latestVersion ?? null) : null);
  /** The running bridge is not the version installed now: a restart picks it up. */
  const restartNeeded = $derived(
    (status.state === "unavailable" && status.reason === "channelOff") ||
      (!!result?.ok &&
        !result.restarted &&
        status.state === "connected" &&
        !!info?.version &&
        status.bridgeVersion !== info.version),
  );
  /** Install / Update is on offer: missing, behind, or too old to talk to. */
  const offerInstall = $derived(!!info && (!info.installed || !!updateTo || outdated));

  const versionLine = $derived.by(() => {
    if (!info) return i18n.t("bridge.checking");
    if (!info.installed) return info.npm ? i18n.t("bridge.notInstalledDesc") : i18n.t("bridge.needsNode");
    const installed = info.version
      ? i18n.t("bridge.versionInstalled", { version: info.version })
      : i18n.t("bridge.versionUnknown");
    return updateTo ? `${installed} · ${i18n.t("bridge.updateAvailable", { version: updateTo })}` : installed;
  });

  async function install() {
    const done = await bridgeInstall.install();
    if (!done?.ok) return;
    toast.success(i18n.t("bridge.installOk", { version: done.version ?? "" }));
    // Installed with the connection off: connect now, the reason the user
    // pressed Install.
    if (mode === "off") setBridge({ mode: "managed" });
  }

  async function restart() {
    try {
      await bridgeInstall.restart();
      toast.success(i18n.t("bridge.restartOk"));
    } catch (err) {
      toastError(err);
    }
  }

  async function checkAgain() {
    await bridgeInstall.probe();
    bridge.retry();
  }
</script>

<div class="flex flex-col gap-10">
  <SettingsSection title={i18n.t("settings.bridge")} description={i18n.t("settings.bridgeDesc")}>
    <div class="divide-y divide-border/60">
      <SettingsRow label={i18n.t("bridge.mode")} description={i18n.t(`bridge.modeDesc.${mode}`)}>
        {#snippet control()}
          <Combobox
            value={mode}
            groups={modeGroups}
            searchable={false}
            triggerClass={field.selectWide}
            onChange={(v) => setBridge({ mode: v as BridgeMode })}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("bridge.status")}>
        {#snippet meta()}
          {#if status.state === "unavailable" && status.detail}
            <p class={cn(text.meta, "break-words")}>{status.detail}</p>
          {/if}
        {/snippet}
        {#snippet control()}
          <div class="flex flex-wrap items-center justify-end gap-2">
            <span class={cn("inline-flex items-center gap-1.5", text.body)}>
              <StatusDot {tone} />
              {statusLabel}
            </span>
            {#if restartNeeded && mode !== "off"}
              <Button size="sm" disabled={bridgeInstall.restarting} onclick={() => void restart()}>
                {#if bridgeInstall.restarting}
                  <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                  {i18n.t("bridge.restarting")}
                {:else}
                  {i18n.t("bridge.restartAction")}
                {/if}
              </Button>
            {:else if status.state === "unavailable"}
              <Button variant="outline" size="sm" onclick={() => void bridge.retry()}>
                {i18n.t("bridge.retry")}
              </Button>
            {/if}
          </div>
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("bridge.version")} description={versionLine}>
        {#snippet meta()}
          {#if result && !result.ok}
            <p class={cn(text.meta, "text-destructive")}>
              {result.permissionDenied ? i18n.t("bridge.permissionDenied") : i18n.t("bridge.installFailed")}
            </p>
          {/if}
        {/snippet}
        {#snippet control()}
          <!-- Like Settings → Updates: the check is always there; the phase
               action only when there is one to take. -->
          <div class="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={bridgeInstall.probing || bridgeInstall.installing}
              onclick={() => void checkAgain()}
            >
              {#if bridgeInstall.probing}
                <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
              {:else}
                <Icon icon={RotateCcwIcon} data-icon="inline-start" />
              {/if}
              {i18n.t("bridge.checkAgain")}
            </Button>
            {#if offerInstall && info}
              <Button size="sm" disabled={bridgeInstall.installing || !info.npm} onclick={() => void install()}>
                {#if bridgeInstall.installing}
                  <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                  {i18n.t(info.installed ? "bridge.updating" : "bridge.installing")}
                {:else}
                  <Icon icon={DownloadIcon} data-icon="inline-start" />
                  {i18n.t(info.installed ? "bridge.updateAction" : "bridge.installAction")}
                {/if}
              </Button>
            {/if}
          </div>
        {/snippet}
        {#if offerInstall && info}
          <div class="space-y-1.5">
            <p class={text.meta}>{i18n.t("bridge.orRunIt")}</p>
            <CodeBlock value={info.command} />
          </div>
        {/if}
        {#if bridgeInstall.log.length > 0}
          <Collapsible.Root bind:open={outputOpen} class="mt-2">
            <Collapsible.Trigger
              class={cn("flex w-full items-center justify-between rounded-md py-1 text-left", text.meta, focus.ring)}
            >
              {i18n.t("bridge.showOutput")}
              <Icon
                icon={ChevronDownIcon}
                class={cn(icon.action, "text-muted-foreground transition-transform", outputOpen && "rotate-180")}
              />
            </Collapsible.Trigger>
            <Collapsible.Content class="pt-1.5">
              <CodeBlock value={bridgeInstall.log.join("\n")} copyable={false} class="max-h-48" />
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
        {#each phones as phone (phone.id)}
          <SettingsRow label={phone.name}>
            {#snippet control()}
              <span class={text.meta}>
                {i18n.t("bridge.phoneSince", {
                  time: new Date(phone.since).toLocaleTimeString(i18n.locale),
                })}
              </span>
            {/snippet}
          </SettingsRow>
        {:else}
          <SettingsRow description={i18n.t("bridge.noPhones")} />
        {/each}
        <SettingsRow>
          {#snippet control()}
            <Button variant="outline" size="sm" onclick={() => (pairOpen = true)}>
              <Icon icon={QrCodeIcon} data-icon="inline-start" />
              {i18n.t("bridge.pairAction")}
            </Button>
          {/snippet}
        </SettingsRow>
      </div>
    </SettingsSection>

    <SettingsSection title={i18n.t("bridge.projects")} description={i18n.t("bridge.projectsDesc")}>
      <div class="divide-y divide-border/60">
        <SettingsRow label={i18n.t("bridge.home")} description={i18n.t("bridge.homeDesc")}>
          {#snippet meta()}
            {#if chat.settings?.home}
              <p class={cn(text.meta, "break-all font-mono")}>{chat.settings.home}</p>
            {/if}
          {/snippet}
          {#snippet control()}
            <Button variant="outline" size="sm" disabled={choosingHome} onclick={() => void chooseHome()}>
              {i18n.t("bridge.homeChange")}
            </Button>
          {/snippet}
        </SettingsRow>
      </div>
    </SettingsSection>

    <BridgePairDialog bind:open={pairOpen} />
  {/if}
</div>
