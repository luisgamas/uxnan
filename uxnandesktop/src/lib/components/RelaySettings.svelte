<script lang="ts">
  // Settings → Bridge & mobile → Remote access: how a phone reaches this
  // computer away from home, and the user's own relay when there is one.
  //
  // The bridge owns the relay (architecture/02a §5.10) — it deploys it into the
  // user's Cloudflare account, keeps it connected and reports how it stands.
  // This section is a client of it, like the phone: it reads the one replica in
  // `relay` (`relay/status` + `stream/relay/updated`) and asks the bridge for
  // every change through `relay/*`. Errors are the bridge's own words.
  //
  // - Not set up: the three ways a phone connects (same network, Tailscale,
  //   your own relay), "Set up your relay", and "Use a relay you deployed"
  //   (its address, and this computer's key such a relay must list).
  // - Set up: on/off, its state, the phones using it, its address and version,
  //   and update / new address / remove.
  // - No bridge, or one too old for `relay/*`: the section stays, disabled,
  //   with the line that says why.
  import { Button } from "$lib/components/ui/button";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Switch } from "$lib/components/ui/switch";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Icon } from "$lib/components/ui/icon";
  import CodeBlock from "$lib/components/CodeBlock.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import StatusDot, { type StatusTone } from "$lib/components/StatusDot.svelte";
  import RelaySetupDialog from "$lib/components/RelaySetupDialog.svelte";
  import RelayTokenField from "$lib/components/RelayTokenField.svelte";
  import WifiIcon from "@hugeicons/core-free-icons/Wifi01Icon";
  import GlobeLockIcon from "@hugeicons/core-free-icons/GlobeLockIcon";
  import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
  import CloudUploadIcon from "@hugeicons/core-free-icons/CloudUploadIcon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import RefreshIcon from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
  import { bridge, bridgeErrorText } from "$lib/bridge/client.svelte";
  import { REMOTE_ACCESS_ANCHOR, relay, relayUpdateAvailable } from "$lib/bridge/relay.svelte";
  import { toast } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, text } from "$lib/design";
  import type { RelayConnectionState } from "$shared/models/relay";

  const connected = $derived(bridge.connected);
  const status = $derived(connected ? relay.status : null);
  const endpoint = $derived(status?.endpoint ?? null);
  /** Why the section is disabled, when it is. */
  const blocked = $derived(
    !connected ? i18n.t("relay.bridgeOff") : !relay.supported ? i18n.t("relay.unsupported") : null,
  );
  const updateAvailable = $derived(relayUpdateAvailable(status));
  const customOutdated = $derived(
    status?.provider === "custom" &&
      !!status.deployedVersion &&
      status.deployedVersion !== status.bundledVersion,
  );

  const TONES: Record<RelayConnectionState, StatusTone> = {
    connected: "ok",
    connecting: "busy",
    error: "error",
    off: "off",
  };

  const versionLine = $derived.by(() => {
    if (!status) return "";
    const { deployedVersion: deployed, bundledVersion: bundled } = status;
    if (customOutdated) return i18n.t("relay.versionCustomOld", { bundled });
    if (!updateAvailable) return i18n.t("relay.versionCurrent", { version: deployed ?? bundled });
    return deployed
      ? i18n.t("relay.versionUpdate", { deployed, bundled })
      : i18n.t("relay.versionUnknownUpdate", { bundled });
  });

  const phonesLine = $derived(
    !status || status.connectedPhones === 0
      ? i18n.t("relay.phonesNone")
      : i18n.plural(status.connectedPhones, "relay.phonesOne", "relay.phonesOther"),
  );

  // ---- not set up ----
  let setupOpen = $state(false);
  let useOpen = $state(false);
  let useUrl = $state("");
  let using = $state(false);
  let useError = $state<string | null>(null);

  async function useRelay(): Promise<void> {
    if (!useUrl.trim() || using) return;
    using = true;
    useError = null;
    try {
      await relay.use(useUrl.trim());
      useUrl = "";
      toast.success(i18n.t("relay.useOk"));
    } catch (err) {
      useError = bridgeErrorText(err);
    } finally {
      using = false;
    }
  }

  // ---- set up ----
  let toggling = $state(false);
  async function setEnabled(on: boolean): Promise<void> {
    toggling = true;
    try {
      await relay.setEnabled(on);
    } catch (err) {
      toast.error(bridgeErrorText(err));
    } finally {
      toggling = false;
    }
  }

  // Update: straight away with a remembered token, else ask for one.
  let updating = $state(false);
  let updateOpen = $state(false);
  let updateToken = $state("");
  let updateRemember = $state(false);
  let updateError = $state<string | null>(null);

  async function runUpdate(token?: string, remember?: boolean): Promise<boolean> {
    updating = true;
    try {
      const next = await relay.update(token, remember);
      toast.success(i18n.t("relay.updateOk", { version: next?.deployedVersion ?? status?.bundledVersion ?? "" }));
      return true;
    } finally {
      updating = false;
    }
  }

  async function update(): Promise<void> {
    if (!status?.tokenRemembered) {
      updateToken = "";
      updateRemember = false;
      updateError = null;
      updateOpen = true;
      return;
    }
    try {
      await runUpdate();
    } catch (err) {
      toast.error(bridgeErrorText(err));
    }
  }

  async function confirmUpdate(): Promise<boolean> {
    const token = updateToken;
    updateError = null;
    try {
      return await runUpdate(token, updateRemember);
    } catch (err) {
      updateError = bridgeErrorText(err);
      return false;
    } finally {
      updateToken = "";
    }
  }

  let rotateOpen = $state(false);
  async function confirmRotate(): Promise<void> {
    try {
      await relay.rotate();
      toast.success(i18n.t("relay.rotateOk"));
    } catch (err) {
      toast.error(bridgeErrorText(err));
    }
  }

  let removeOpen = $state(false);
  let removeDelete = $state(false);
  let removeToken = $state("");
  let removeError = $state<string | null>(null);
  const removeNeedsToken = $derived(removeDelete && !status?.tokenRemembered);

  function askRemove(): void {
    removeDelete = false;
    removeToken = "";
    removeError = null;
    removeOpen = true;
  }

  async function confirmRemove(): Promise<boolean> {
    const token = removeToken;
    removeError = null;
    try {
      await relay.remove({
        ...(removeDelete ? { deleteWorker: true } : {}),
        ...(removeNeedsToken ? { apiToken: token } : {}),
      });
      toast.success(i18n.t("relay.removeOk"));
      return true;
    } catch (err) {
      removeError = bridgeErrorText(err);
      return false;
    } finally {
      removeToken = "";
    }
  }
</script>

<SettingsSection id={REMOTE_ACCESS_ANCHOR} title={i18n.t("relay.title")} description={i18n.t("relay.desc")}>
  <div class="divide-y divide-border/60">
    {#if blocked}
      <SettingsRow description={blocked} />
    {:else if !status}
      <SettingsRow>
        {#snippet meta()}
          <p class={cn(text.meta, "flex items-center gap-2")}>
            <Spinner class="size-3.5" aria-hidden="true" />
            {i18n.t("relay.loading")}
          </p>
        {/snippet}
      </SettingsRow>
    {:else if !endpoint}
      <SettingsRow label={i18n.t("relay.waysLan")} description={i18n.t("relay.waysLanDesc")}>
        {#snippet leading()}
          <Icon icon={WifiIcon} class={cn(icon.nav, "text-muted-foreground")} />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("relay.waysTailscale")} description={i18n.t("relay.waysTailscaleDesc")}>
        {#snippet leading()}
          <Icon icon={GlobeLockIcon} class={cn(icon.nav, "text-muted-foreground")} />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("relay.waysRelay")} description={i18n.t("relay.waysRelayDesc")}>
        {#snippet leading()}
          <Icon icon={CloudServerIcon} class={cn(icon.nav, "text-muted-foreground")} />
        {/snippet}
        {#snippet control()}
          <Button size="sm" onclick={() => (setupOpen = true)}>{i18n.t("relay.setupAction")}</Button>
        {/snippet}
      </SettingsRow>
      <SettingsRow>
        <Collapsible.Root bind:open={useOpen}>
          <Collapsible.Trigger
            class={cn(
              "flex w-full items-center justify-between rounded-md py-1 text-left",
              text.bodyStrong,
              focus.ring,
            )}
          >
            {i18n.t("relay.useTitle")}
            <Icon
              icon={ChevronDownIcon}
              class={cn(icon.action, "text-muted-foreground transition-transform", useOpen && "rotate-180")}
            />
          </Collapsible.Trigger>
          <Collapsible.Content class="flex flex-col gap-4 pt-3">
            <div class="space-y-1.5">
              <Label for="relay-use-url">{i18n.t("relay.useUrl")}</Label>
              <div class="flex items-center gap-2">
                <Input
                  id="relay-use-url"
                  class="font-mono"
                  bind:value={useUrl}
                  placeholder="wss://relay.example.com"
                  autocomplete="off"
                  spellcheck={false}
                  disabled={using}
                  onkeydown={(e) => {
                    if (e.key === "Enter") void useRelay();
                  }}
                />
                <Button variant="outline" disabled={!useUrl.trim() || using} onclick={() => void useRelay()}>
                  {#if using}
                    <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                  {/if}
                  {i18n.t("relay.useAction")}
                </Button>
              </div>
              {#if useError}
                <p role="alert" class={cn(text.meta, "break-words text-destructive")}>{useError}</p>
              {/if}
            </div>
            <div class="space-y-1.5">
              <p class={cn(text.body, "font-medium")}>{i18n.t("relay.hostKey")}</p>
              <p class={text.meta}>{i18n.t("relay.hostKeyDesc")}</p>
              <CodeBlock value={status.hostKey} copyLabel={i18n.t("relay.hostKeyCopy")} />
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </SettingsRow>
    {:else}
      <SettingsRow label={i18n.t("relay.enabled")} description={i18n.t("relay.enabledDesc")}>
        {#snippet control()}
          <Switch
            checked={endpoint.enabled}
            disabled={toggling}
            aria-label={i18n.t("relay.enabled")}
            onCheckedChange={(on) => void setEnabled(on)}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("relay.status")}>
        {#snippet meta()}
          {#if status.state === "error" && status.lastError}
            <p role="alert" class={cn(text.meta, "break-words text-destructive")}>{status.lastError}</p>
          {:else if status.state === "connected"}
            <p class={text.meta}>{phonesLine}</p>
          {/if}
        {/snippet}
        {#snippet control()}
          <span class={cn("inline-flex items-center gap-1.5", text.body)}>
            <StatusDot tone={TONES[status.state]} />
            {i18n.t(`relay.state.${status.state}`)}
          </span>
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("relay.address")}>
        {#snippet meta()}
          <p class={cn(text.meta, "break-all font-mono")}>{endpoint.url}</p>
          <p class={text.meta}>
            {status.provider === "custom" ? i18n.t("relay.providerCustom") : i18n.t("relay.providerCloudflare")}
          </p>
        {/snippet}
        {#snippet control()}
          <Button variant="outline" size="sm" onclick={() => (rotateOpen = true)}>
            <Icon icon={RefreshIcon} data-icon="inline-start" />
            {i18n.t("relay.rotateAction")}
          </Button>
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("relay.version")} description={versionLine}>
        {#snippet control()}
          {#if updateAvailable}
            <Button size="sm" disabled={updating} onclick={() => void update()}>
              {#if updating}
                <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
                {i18n.t("relay.updating")}
              {:else}
                <Icon icon={CloudUploadIcon} data-icon="inline-start" />
                {i18n.t("relay.updateAction")}
              {/if}
            </Button>
          {/if}
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("relay.remove")} description={i18n.t("relay.removeDesc")}>
        {#snippet control()}
          <Button variant="destructive" size="sm" onclick={askRemove}>
            {i18n.t("relay.removeAction")}
          </Button>
        {/snippet}
      </SettingsRow>
    {/if}
  </div>
</SettingsSection>

<RelaySetupDialog bind:open={setupOpen} />

<ConfirmDialog
  bind:open={updateOpen}
  title={i18n.t("relay.updateTitle")}
  description={i18n.t("relay.updateDesc", { version: status?.bundledVersion ?? "" })}
  confirmLabel={i18n.t("relay.updateAction")}
  confirmDisabled={!updateToken.trim()}
  error={updateError}
  onconfirm={confirmUpdate}
  ondismiss={() => (updateToken = "")}
>
  <RelayTokenField id="relay-update" bind:token={updateToken} bind:remember={updateRemember} showRemember />
</ConfirmDialog>

<ConfirmDialog
  bind:open={rotateOpen}
  title={i18n.t("relay.rotateTitle")}
  description={i18n.t("relay.rotateDesc")}
  confirmLabel={i18n.t("relay.rotateAction")}
  onconfirm={confirmRotate}
/>

<!-- Only a relay this bridge deployed can be deleted from Cloudflare from
     here; a hand-deployed one is removed with nothing more to ask. -->
{#snippet removeOptions()}
  <div class="flex items-start gap-2.5">
    <Checkbox id="relay-remove-delete" bind:checked={removeDelete} />
    <div class="min-w-0 space-y-0.5">
      <Label for="relay-remove-delete">{i18n.t("relay.removeDelete")}</Label>
      <p class={text.meta}>{i18n.t("relay.removeDeleteDesc")}</p>
    </div>
  </div>
  {#if removeNeedsToken}
    <RelayTokenField id="relay-remove" bind:token={removeToken} />
  {/if}
{/snippet}

<ConfirmDialog
  bind:open={removeOpen}
  title={i18n.t("relay.removeTitle")}
  description={i18n.t("relay.removeConfirmDesc")}
  confirmLabel={i18n.t("relay.removeAction")}
  confirmDisabled={removeNeedsToken && !removeToken.trim()}
  error={removeError}
  danger
  onconfirm={confirmRemove}
  ondismiss={() => (removeToken = "")}
  children={status?.provider === "custom" ? undefined : removeOptions}
/>
