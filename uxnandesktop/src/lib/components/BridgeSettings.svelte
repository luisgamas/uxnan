<script lang="ts">
  // Settings → Bridge & mobile: how the desktop connects to the Uxnan bridge,
  // the process that drives the conversations a chat tab shows — the same ones
  // the phone shows (plan 029, architecture/02a §5.8.15).
  //
  // Three modes and nothing hidden: `off` costs nothing at all, `attach` uses a
  // bridge the user already runs, `managed` also starts one when none runs and
  // stops it on exit. The status row says which state the connection is in and
  // what would fix it; a state that cannot be proven is never painted green.
  import { Button } from "$lib/components/ui/button";
  import * as Select from "$lib/components/ui/select";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Icon } from "$lib/components/ui/icon";
  import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
  import { app } from "$lib/state/app.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, icon, text } from "$lib/design";
  import { toast } from "$lib/toast";
  import type { BridgeMode } from "$lib/types";

  const MODES = ["off", "attach", "managed"] as const satisfies readonly BridgeMode[];
  const INSTALL_COMMAND = "npm install -g uxnan-bridge";

  const mode = $derived<BridgeMode>(app.settings.bridge?.mode ?? "off");
  const status = $derived(bridge.status);

  function setMode(next: BridgeMode) {
    app.settings.bridge = { ...app.settings.bridge, mode: next };
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

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      toast.success(i18n.t("bridge.copied"));
    } catch {
      /* clipboard unavailable */
    }
  }
</script>

<div class="flex flex-col gap-10">
  <SettingsSection title={i18n.t("settings.bridge")} description={i18n.t("settings.bridgeDesc")}>
    <div class="divide-y divide-border/60">
      <SettingsRow
        label={i18n.t("bridge.mode")}
        description={i18n.t(`bridge.modeDesc.${mode}`)}
      >
        {#snippet control()}
          <Select.Root type="single" value={mode} onValueChange={(v) => setMode(v as BridgeMode)}>
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
              <Spinner class={icon.decorative} />
            {:else}
              <span
                class={cn(
                  "size-2 shrink-0 rounded-full",
                  status.state === "connected" && "bg-emerald-500",
                  status.state === "unavailable" && "bg-amber-500",
                  status.state === "off" && "bg-muted-foreground/40",
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

      {#if status.state === "unavailable" && (status.reason === "notInstalled" || status.reason === "notRunning")}
        <SettingsRow
          label={i18n.t("bridge.install")}
          description={i18n.t(
            status.reason === "notInstalled" ? "bridge.installDesc" : "bridge.startDesc",
          )}
        >
          {#snippet control()}
            <div class="flex items-center gap-1.5">
              <code class="rounded bg-muted px-2 py-1 font-mono text-xs">
                {status.reason === "notInstalled" ? INSTALL_COMMAND : "uxnan-bridge start"}
              </code>
              {#if status.reason === "notInstalled"}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={i18n.t("bridge.copyInstall")}
                  onclick={() => void copyInstall()}
                >
                  <Icon icon={Copy01Icon} class={icon.action} />
                </Button>
              {/if}
            </div>
          {/snippet}
        </SettingsRow>
      {/if}
    </div>
  </SettingsSection>

  {#if status.state === "connected"}
    <SettingsSection
      title={i18n.t("bridge.phones")}
      description={i18n.t("bridge.phonesDesc")}
    >
      <div class="divide-y divide-border/60">
        {#each phones as phone (phone.deviceId)}
          <SettingsRow label={phone.displayName}>
            {#snippet control()}
              <span class={text.meta}>
                {i18n.t("bridge.phoneSince", {
                  time: new Date(phone.connectedAt).toLocaleTimeString(),
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
