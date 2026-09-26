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
  import { connectPhone } from "$lib/bridge/connectPhone.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import { Input } from "$lib/components/ui/input";
  import PencilIcon from "@hugeicons/core-free-icons/PencilIcon";
  import DeleteIcon from "@hugeicons/core-free-icons/Delete02Icon";
  import type { TrustedDevice } from "$shared/models/session";
  import QrCodeIcon from "@hugeicons/core-free-icons/QrCodeIcon";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, focus, icon, iconButton, text } from "$lib/design";
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

  /** Every paired phone, named as every client names it
   *  (`stream/devices/updated`), and which of them are connected right now. */
  const phones = $derived(chat.devices);
  const connectedIds = $derived(
    new Set(chat.clients.filter((c) => c.kind === "phone").map((c) => c.id)),
  );

  /** What a phone is, in one quiet line: model · OS · app version. */
  function phoneAbout(phone: TrustedDevice): string {
    const os =
      phone.osVersion && phone.platform
        ? `${phone.platform === "ios" ? "iOS" : "Android"} ${phone.osVersion}`
        : null;
    return [phone.model, os, phone.appVersion ? `Uxnan ${phone.appVersion}` : null]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }

  // Renaming a phone happens in place: its row turns into the name field.
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");
  function startRename(phone: TrustedDevice): void {
    renamingId = phone.deviceId;
    renameValue = phone.displayName;
  }
  async function commitRename(): Promise<void> {
    const id = renamingId;
    if (id === null) return;
    renamingId = null;
    const current = phones.find((p) => p.deviceId === id)?.displayName;
    if (renameValue.trim() === current) return;
    try {
      await chat.renamePhone(id, renameValue.trim());
    } catch (err) {
      toastError(err);
    }
  }

  let removing = $state<TrustedDevice | null>(null);
  let removeOpen = $state(false);
  async function confirmRemove(): Promise<void> {
    const phone = removing;
    if (!phone) return;
    try {
      await chat.removePhone(phone.deviceId);
      toast.success(i18n.t("bridge.phoneRemoved", { name: phone.displayName }));
    } catch (err) {
      toastError(err);
    }
  }

  // The PC's name, edited in place and saved when the field is left.
  let pcName = $state("");
  $effect(() => {
    pcName = chat.settings?.name ?? "";
  });
  async function commitPcName(): Promise<void> {
    const next = pcName.trim();
    if (next === (chat.settings?.name ?? "")) return;
    try {
      await chat.setPcName(next);
      toast.success(i18n.t("bridge.pcNameChanged"));
    } catch (err) {
      pcName = chat.settings?.name ?? "";
      toastError(err);
    }
  }

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
  /** The update on offer for the running bridge (the bridge's own, or the
   *  app's installer for a bridge that cannot update itself). */
  const offer = $derived(bridgeInstall.offer);
  const updateTo = $derived(offer?.version ?? null);
  /** Why the bridge's last update failed, as the bridge that came back says. */
  const updateFailure = $derived(running?.update?.phase === "failed" ? (running.update.failure ?? null) : null);
  /** The running bridge is not the version installed now: a restart picks it up. */
  const restartNeeded = $derived(
    (status.state === "unavailable" && status.reason === "channelOff") ||
      (!!result?.ok &&
        !result.restarted &&
        status.state === "connected" &&
        !!info?.version &&
        status.bridgeVersion !== info.version),
  );
  /** The app's installer is on offer: no bridge, or one too old to talk to. */
  const offerInstall = $derived(!!info && (!info.installed || outdated));

  const versionLine = $derived.by(() => {
    if (!info) return i18n.t("bridge.checking");
    if (!info.installed) return info.npm ? i18n.t("bridge.notInstalledDesc") : i18n.t("bridge.needsNode");
    const installed = info.version
      ? i18n.t("bridge.versionInstalled", { version: info.version })
      : i18n.t("bridge.versionUnknown");
    if (bridgeInstall.updating) {
      const target = bridgeInstall.pendingVersion ?? running?.update?.targetVersion ?? "";
      return `${installed} · ${i18n.t("bridge.updatingTo", { version: target })}`;
    }
    if (!offer) return installed;
    return `${installed} · ${
      updateTo ? i18n.t("bridge.updateAvailable", { version: updateTo }) : i18n.t("bridge.olderThanApp")
    }`;
  });

  async function install() {
    const done = await bridgeInstall.install();
    if (!done?.ok) return;
    toast.success(i18n.t("bridge.installOk", { version: done.version ?? "" }));
    // Installed with the connection off: connect now, the reason the user
    // pressed Install.
    if (mode === "off") setBridge({ mode: "managed" });
  }

  async function update() {
    try {
      await bridgeInstall.update();
    } catch (err) {
      toastError(err);
    }
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
          {:else if updateFailure}
            <p class={cn(text.meta, "text-destructive")}>
              {updateFailure.reason === "permission" ? i18n.t("bridge.permissionDenied") : i18n.t("bridge.updateFailed")}
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
            {#if !offerInstall && offer}
              <Button size="sm" disabled={bridgeInstall.installing || bridgeInstall.updating} onclick={() => void update()}>
                {#if bridgeInstall.installing || bridgeInstall.updating}
                  <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                  {i18n.t("bridge.updating")}
                {:else}
                  <Icon icon={DownloadIcon} data-icon="inline-start" />
                  {i18n.t("bridge.updateAction")}
                {/if}
              </Button>
            {/if}
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
        {:else if updateFailure}
          <div class="space-y-1.5">
            <p class={cn(text.meta, "break-words")}>{updateFailure.message}</p>
            {#if updateFailure.command}
              <p class={text.meta}>{i18n.t("bridge.orRunIt")}</p>
              <CodeBlock value={updateFailure.command} />
            {/if}
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
        {#each phones as phone (phone.deviceId)}
          {@const connected = connectedIds.has(phone.deviceId)}
          <SettingsRow label={renamingId === phone.deviceId ? undefined : phone.displayName}>
            {#snippet meta()}
              {#if renamingId === phone.deviceId}
                <Input
                  class={cn(field.selectStandard, "w-full")}
                  aria-label={i18n.t("bridge.phoneRename")}
                  bind:value={renameValue}
                  maxlength={80}
                  autofocus
                  onblur={() => void commitRename()}
                  onkeydown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") renamingId = null;
                  }}
                />
              {/if}
              <p class={cn(text.meta, "flex min-w-0 items-center gap-1.5")}>
                <StatusDot tone={connected ? "ok" : "off"} />
                <span class="truncate">
                  {connected ? i18n.t("bridge.phoneConnected") : i18n.t("bridge.phoneAway")}{phoneAbout(phone)
                    ? ` · ${phoneAbout(phone)}`
                    : ""}
                </span>
              </p>
            {/snippet}
            {#snippet control()}
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class={cn(iconButton.action, "text-muted-foreground")}
                  aria-label={i18n.t("bridge.phoneRename")}
                  title={i18n.t("bridge.phoneRename")}
                  onclick={() => startRename(phone)}
                >
                  <Icon icon={PencilIcon} class={icon.button} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class={cn(iconButton.action, "text-muted-foreground hover:text-destructive")}
                  aria-label={i18n.t("bridge.phoneRemove")}
                  title={i18n.t("bridge.phoneRemove")}
                  onclick={() => {
                    removing = phone;
                    removeOpen = true;
                  }}
                >
                  <Icon icon={DeleteIcon} class={icon.button} />
                </Button>
              </div>
            {/snippet}
          </SettingsRow>
        {:else}
          <SettingsRow description={i18n.t("bridge.noPhones")} />
        {/each}
        <SettingsRow>
          {#snippet control()}
            <Button variant="outline" size="sm" onclick={() => connectPhone.show()}>
              <Icon icon={QrCodeIcon} data-icon="inline-start" />
              {i18n.t("bridge.pairAction")}
            </Button>
          {/snippet}
        </SettingsRow>
      </div>
    </SettingsSection>

    <SettingsSection title={i18n.t("bridge.shared")} description={i18n.t("bridge.sharedDesc")}>
      <div class="divide-y divide-border/60">
        <SettingsRow label={i18n.t("bridge.pcName")} description={i18n.t("bridge.pcNameDesc")}>
          {#snippet control()}
            <Input
              class={cn(field.selectStandard, "w-56")}
              aria-label={i18n.t("bridge.pcName")}
              bind:value={pcName}
              maxlength={80}
              onblur={() => void commitPcName()}
              onkeydown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          {/snippet}
        </SettingsRow>
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

    <ConfirmDialog
      bind:open={removeOpen}
      title={i18n.t("bridge.phoneRemoveTitle", { name: removing?.displayName ?? "" })}
      description={i18n.t("bridge.phoneRemoveDesc")}
      confirmLabel={i18n.t("bridge.phoneRemove")}
      danger
      onconfirm={confirmRemove}
    />
  {/if}
</div>
