<script lang="ts">
  // Settings → Hosts: the remote machines this app can run agents on.
  //
  // The list is the screen. Adding is a small form under it and importing is a
  // list of what the user already wrote in `~/.ssh/config` — neither gets a
  // card of its own, because a settings pane with three competing surfaces
  // reads as three features instead of one.
  //
  // Everything that needs the user (an unknown key, a password, a key that
  // changed) arrives as a dialog raised from the store, not as state each row
  // has to interpret.
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import RemoteFolderPicker from "$lib/components/RemoteFolderPicker.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ServerIcon from "@hugeicons/core-free-icons/ServerStack01Icon";
  import KeyIcon from "@hugeicons/core-free-icons/Key01Icon";
  import DeleteIcon from "@hugeicons/core-free-icons/Delete02Icon";
  import AlertIcon from "@hugeicons/core-free-icons/Alert01Icon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
  import { hosts } from "$lib/state/hosts.svelte";
  import { terminals, GLOBAL_WORKSPACE } from "$lib/state/terminals.svelte";
  import { app } from "$lib/state/app.svelte";
  import type { SshHost } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, panel, text } from "$lib/design";

  let addOpen = $state(false);
  let importOpen = $state(false);
  let removing = $state<string | null>(null);
  /** The host whose folders are being browsed, if any. */
  let picking = $state<SshHost | null>(null);
  let pickerOpen = $state(false);
  let secret = $state("");

  // A new host, with the fields OpenSSH itself needs and nothing more. Anything
  // else (identity files, proxies) comes from the user's own config on import.
  let draftLabel = $state("");
  let draftUser = $state("");
  let draftHostname = $state("");
  let draftPort = $state("22");
  // Advanced, but not hidden behind another fold: a key file and a jump host are
  // ordinary things to need, and burying them makes the form look like it cannot
  // do them at all.
  let draftIdentity = $state("");
  let draftProxyJump = $state("");
  let draftForwardAgent = $state(false);

  const canSubmitDraft = $derived(draftHostname.trim().length > 0 && draftUser.trim().length > 0);

  onMount(() => {
    void hosts.load();
  });

  async function submitDraft(): Promise<void> {
    if (!canSubmitDraft) return;
    const port = Number.parseInt(draftPort, 10);
    const added = await hosts.add({
      label: draftLabel.trim() || `${draftUser.trim()}@${draftHostname.trim()}`,
      hostname: draftHostname.trim(),
      port: Number.isFinite(port) && port > 0 ? port : 22,
      user: draftUser.trim(),
      identityFiles: draftIdentity.trim() ? [draftIdentity.trim()] : [],
      proxyJump: draftProxyJump.trim() || null,
      forwardAgent: draftForwardAgent,
      source: "manual",
    });
    if (added) {
      draftLabel = draftUser = draftHostname = "";
      draftIdentity = draftProxyJump = "";
      draftForwardAgent = false;
      draftPort = "22";
      addOpen = false;
    }
  }

  // Read the user's SSH config the first time the section is opened, not on a
  // click handler: the trigger already owns the open state, and a second writer
  // made the chevron and the content disagree.
  $effect(() => {
    if (importOpen && hosts.configAliases.length === 0) void hosts.loadConfigAliases();
  });

  /** Agent ids the host reported, sorted so the line does not reshuffle
   *  between renders. */
  function agentNames(inventory: { agents: Record<string, string> }): string[] {
    return Object.keys(inventory.agents).sort();
  }

  /** Open a terminal that lives on this host and go to it. The settings screen
   *  closes, because the point of the button is the terminal, not the setting. */
  function openTerminal(host: SshHost): void {
    terminals.create({
      title: host.label,
      target: `ssh:${host.id}`,
      // The Global space, not whatever project happens to be active: this
      // terminal belongs to no local project, and filing it under one would put
      // a tab for another machine inside a folder it has nothing to do with.
      // Once a project can live on a host, it opens in *that* project instead.
      workspace: GLOBAL_WORKSPACE,
      // No cwd: the host's own login shell decides, which lands the user in
      // their home directory there — the same place `ssh <host>` would.
    });
    app.settingsOpen = false;
  }

  function submitSecret(): void {
    const value = secret;
    secret = "";
    void hosts.submitPendingCredential(value);
  }
</script>

<SettingsSection title={i18n.t("hosts.title")} description={i18n.t("hosts.description")}>
  {#if hosts.error}
    <div
      class="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
      role="alert"
    >
      <Icon icon={AlertIcon} class={cn(icon.action, "mt-0.5 shrink-0 text-destructive")} />
      <p class={cn(text.body, "min-w-0 text-destructive")}>{hosts.error}</p>
    </div>
  {/if}

  {#if hosts.hosts.length === 0}
    <div class="flex flex-col items-center gap-2 py-8 text-center">
      <Icon icon={ServerIcon} class={cn(icon.empty, "text-muted-foreground/50")} />
      <p class={cn(text.body, "text-muted-foreground")}>{i18n.t("hosts.empty")}</p>
    </div>
  {:else}
    <ul class="divide-y divide-border/50">
      {#each hosts.hosts as host (host.id)}
        {@const connected = hosts.isConnected(host.id)}
        {@const busy = hosts.isBusy(host.id)}
        {@const inventory = hosts.inventories[host.id]}
        <li class="flex min-h-12 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <span
            class={cn(
              "size-1.5 shrink-0 rounded-full",
              connected ? "bg-emerald-500" : "bg-muted-foreground/30",
            )}
            title={connected ? i18n.t("hosts.connected") : i18n.t("hosts.disconnected")}
          ></span>
          <div class="min-w-0 flex-1">
            <p class={cn(text.bodyStrong, "truncate")}>{host.label}</p>
            <p class={cn(text.meta, "truncate")}>
              {host.user}@{host.hostname}{host.port === 22 ? "" : `:${host.port}`}
            </p>
            {#if inventory}
              <!-- What the machine itself reported. Only shown once it has
                   answered, so an empty line never reads as "nothing there". -->
              <p class={cn(text.meta, "truncate")}>
                {[
                  inventory.os,
                  agentNames(inventory).length > 0
                    ? i18n.t("hosts.agentsFound", { agents: agentNames(inventory).join(", ") })
                    : i18n.t("hosts.agentsNone"),
                  inventory.multiplexer || i18n.t("hosts.noMultiplexer"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            {/if}
          </div>
          {#if connected}
            <Button variant="outline" size="sm" onclick={() => openTerminal(host)}>
              {i18n.t("hosts.openTerminal")}
            </Button>
            <Button variant="ghost" size="sm" onclick={() => { picking = host; pickerOpen = true; }}>
              {i18n.t("hosts.addProject")}
            </Button>
            <Button variant="ghost" size="sm" onclick={() => hosts.disconnect(host.id)}>
              {i18n.t("hosts.disconnect")}
            </Button>
          {:else}
            <Button variant="outline" size="sm" disabled={busy} onclick={() => hosts.connect(host.id)}>
              {busy ? i18n.t("hosts.connecting") : i18n.t("hosts.connect")}
            </Button>
          {/if}
          <button
            type="button"
            class={cn(
              "rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-destructive",
              focus.ring,
            )}
            title={i18n.t("hosts.remove")}
            onclick={() => (removing = host.id)}
          >
            <Icon icon={DeleteIcon} class={icon.action} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="mt-5 space-y-3 border-t border-border/50 pt-5">
    <Collapsible.Root bind:open={addOpen}>
      <Collapsible.Trigger
        class={cn(
          "flex w-full items-center justify-between rounded-md py-1 text-left",
          text.bodyStrong,
          focus.ring,
        )}
      >
        {i18n.t("hosts.addTitle")}
        <Icon
          icon={ChevronDownIcon}
          class={cn(icon.action, "text-muted-foreground transition-transform", addOpen && "rotate-180")}
        />
      </Collapsible.Trigger>
      <Collapsible.Content class="pt-3">
        <div class="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <div class="space-y-1.5">
            <Label for="host-user">{i18n.t("hosts.fieldUser")}</Label>
            <Input id="host-user" bind:value={draftUser} placeholder="dev" autocomplete="off" />
          </div>
          <div class="space-y-1.5">
            <Label for="host-name">{i18n.t("hosts.fieldHostname")}</Label>
            <Input
              id="host-name"
              bind:value={draftHostname}
              placeholder="10.0.0.5"
              autocomplete="off"
            />
          </div>
          <div class="space-y-1.5">
            <Label for="host-port">{i18n.t("hosts.fieldPort")}</Label>
            <Input id="host-port" bind:value={draftPort} inputmode="numeric" autocomplete="off" />
          </div>
          <div class="space-y-1.5">
            <Label for="host-label">{i18n.t("hosts.fieldLabel")}</Label>
            <Input
              id="host-label"
              bind:value={draftLabel}
              placeholder={i18n.t("hosts.fieldLabelHint")}
              autocomplete="off"
            />
          </div>
        </div>
        <div class="mt-3 space-y-3 border-t border-border/50 pt-3">
          <div class="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div class="space-y-1.5">
              <Label for="host-identity">{i18n.t("hosts.fieldIdentity")}</Label>
              <Input
                id="host-identity"
                bind:value={draftIdentity}
                placeholder="~/.ssh/id_ed25519"
                autocomplete="off"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="host-jump">{i18n.t("hosts.fieldProxyJump")}</Label>
              <Input
                id="host-jump"
                bind:value={draftProxyJump}
                placeholder={i18n.t("hosts.fieldProxyJumpHint")}
                autocomplete="off"
              />
            </div>
          </div>
          <div class="flex items-start gap-2.5">
            <Checkbox id="host-forward" bind:checked={draftForwardAgent} />
            <div class="min-w-0 space-y-0.5">
              <Label for="host-forward">{i18n.t("hosts.fieldForwardAgent")}</Label>
              <p class={text.meta}>{i18n.t("hosts.fieldForwardAgentHint")}</p>
            </div>
          </div>
        </div>
        <div class="mt-3 flex justify-end">
          <Button size="sm" disabled={!canSubmitDraft} onclick={submitDraft}>
            {i18n.t("hosts.addAction")}
          </Button>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>

    <Collapsible.Root bind:open={importOpen}>
      <Collapsible.Trigger
        class={cn(
          "flex w-full items-center justify-between rounded-md py-1 text-left",
          text.bodyStrong,
          focus.ring,
        )}
      >
        {i18n.t("hosts.importTitle")}
        <Icon
          icon={ChevronDownIcon}
          class={cn(
            icon.action,
            "text-muted-foreground transition-transform",
            importOpen && "rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content class="pt-2">
        {#if hosts.configAliases.length === 0}
          <p class={cn(text.meta, "py-2")}>{i18n.t("hosts.importEmpty")}</p>
        {:else}
          <ul class={cn(panel.settingsPreview, "divide-y divide-border/50 overflow-y-auto")}>
            {#each hosts.configAliases as alias (alias.alias)}
              {@const already = hosts.isAliasRegistered(alias.alias)}
              <li class="flex min-h-10 items-center gap-3 px-3 py-2">
                <div class="min-w-0 flex-1">
                  <p class={cn(text.body, "truncate")}>{alias.alias}</p>
                </div>
                {#if already}
                  <span class={cn(text.meta, "shrink-0")}>{i18n.t("hosts.importAlready")}</span>
                {:else}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => hosts.addFromAlias(alias.alias)}
                  >
                    {i18n.t("hosts.importAdd")}
                  </Button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </Collapsible.Content>
    </Collapsible.Root>
  </div>
</SettingsSection>

<!-- First contact with a machine: show the fingerprint and let the user decide.
     Nothing is written until they do, and connecting continues on its own once
     they have — confirming *was* the decision to connect. -->
<ConfirmDialog
  open={hosts.pendingKey !== null}
  title={i18n.t("hosts.trustTitle", { host: hosts.pendingKey?.label ?? "" })}
  description={i18n.t("hosts.trustBody", {
    fingerprint: hosts.pendingKey?.fingerprint ?? "",
    algorithm: hosts.pendingKey?.algorithm ?? "",
  })}
  confirmLabel={i18n.t("hosts.trustConfirm")}
  onconfirm={() => hosts.trustPendingKey()}
  oncancel={() => (hosts.pendingKey = null)}
/>

<!-- A key that *changed* is not a prompt. There is nothing to confirm here,
     only something to be told, so this dialog offers no way to proceed. -->
<Dialog.Root
  open={hosts.keyMismatch !== null}
  onOpenChange={(open) => {
    if (!open) hosts.dismissKeyMismatch();
  }}
>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("hosts.mismatchTitle", { host: hosts.keyMismatch?.label ?? "" })}</Dialog.Title>
      <Dialog.Description>{i18n.t("hosts.mismatchBody")}</Dialog.Description>
    </Dialog.Header>
    <dl class="space-y-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
      <div>
        <dt class={text.meta}>{i18n.t("hosts.mismatchStored")}</dt>
        <dd class="break-all font-mono text-[12px]">{hosts.keyMismatch?.stored}</dd>
      </div>
      <div>
        <dt class={text.meta}>{i18n.t("hosts.mismatchPresented")}</dt>
        <dd class="break-all font-mono text-[12px]">{hosts.keyMismatch?.presented}</dd>
      </div>
    </dl>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => hosts.dismissKeyMismatch()}>
        {i18n.t("common.close")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- A password or a key passphrase. Held for one attempt and never stored, so
     the field is cleared the moment it is handed over. -->
<Dialog.Root
  open={hosts.pendingCredential !== null}
  onOpenChange={(open) => {
    if (!open) {
      hosts.pendingCredential = null;
      secret = "";
    }
  }}
>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        {hosts.pendingCredential?.kind === "passphrase"
          ? i18n.t("hosts.passphraseTitle")
          : i18n.t("hosts.passwordTitle", { host: hosts.pendingCredential?.label ?? "" })}
      </Dialog.Title>
      <Dialog.Description>
        {#if hosts.pendingCredential?.kind === "passphrase"}
          {i18n.t("hosts.passphraseBody", { path: hosts.pendingCredential?.path ?? "" })}
        {:else if (hosts.pendingCredential?.attempted.length ?? 0) > 0}
          {i18n.t("hosts.passwordAfterRefused", {
            attempted: (hosts.pendingCredential?.attempted ?? []).join(", "),
          })}
        {:else}
          {i18n.t("hosts.passwordBody")}
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex items-center gap-2">
      <Icon icon={KeyIcon} class={cn(icon.action, "shrink-0 text-muted-foreground")} />
      <Input
        type="password"
        bind:value={secret}
        autocomplete="off"
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === "Enter") submitSecret();
        }}
      />
    </div>
    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => {
          hosts.pendingCredential = null;
          secret = "";
        }}
      >
        {i18n.t("common.cancel")}
      </Button>
      <Button disabled={secret.length === 0} onclick={submitSecret}>
        {i18n.t("hosts.connect")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  open={removing !== null}
  title={i18n.t("hosts.removeTitle", { host: hosts.labelOf(removing ?? "") })}
  description={i18n.t("hosts.removeBody")}
  confirmLabel={i18n.t("hosts.remove")}
  danger
  onconfirm={async () => {
    if (removing) await hosts.remove(removing);
    removing = null;
  }}
  oncancel={() => (removing = null)}
/>

{#if picking}
  <!-- Keyed on the host so switching from one to another starts a fresh browse
       rather than showing the previous machine's folders. -->
  {#key picking.id}
    <RemoteFolderPicker
      hostId={picking.id}
      hostLabel={picking.label}
      open={pickerOpen}
      onOpenChange={(next) => {
        pickerOpen = next;
        if (!next) picking = null;
      }}
    />
  {/key}
{/if}
