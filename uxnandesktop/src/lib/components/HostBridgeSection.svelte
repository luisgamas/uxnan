<script lang="ts">
  // A host page's bridge (`02g` §5.18): the host's own `uxnan-bridge`, which
  // runs its chats and serves its phone. The host engine finds it (one the user
  // installed is the one used), installs it into the account, and keeps it
  // running; this section shows where it stands and asks the engine for each
  // change. How phones reach it: through the user's relay by default — the
  // host opens no port — or, only if the owner turns it on, its LAN listener
  // (the same network, or a tailnet).
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Switch } from "$lib/components/ui/switch";
  import StatusDot, { type StatusTone } from "$lib/components/StatusDot.svelte";
  import RelaySetupDialog from "$lib/components/RelaySetupDialog.svelte";
  import BridgeDialog from "$lib/components/BridgeDialog.svelte";
  import { hostBridgeInstall, hostBridgeSetLan, hostBridgeStatus, hostBridgeSupervise } from "$lib/api";
  import { bridges } from "$lib/bridge/client.svelte";
  import { relay as localRelay, relayFor } from "$lib/bridge/relay.svelte";
  import { isUnknownMethodError } from "$lib/bridge/client.svelte";
  import { toast } from "$lib/toast";
  import { sessions } from "$lib/state/sessions.svelte";
  import { expectation, type TargetId } from "$lib/target";
  import { toastError } from "$lib/toast";
  import type { HostBridgeState, SshHost } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  let { host, connected }: { host: SshHost; connected: boolean } = $props();

  const target = $derived(`ssh:${host.id}` as TargetId);
  const link = $derived(bridges.for(target));
  const relay = $derived(relayFor(target));

  let standing = $state<HostBridgeState | null>(null);
  let busy = $state<"install" | "start" | "stop" | "lan" | null>(null);
  let installTail = $state<string[]>([]);
  let relayOpen = $state(false);
  let joining = $state(false);

  /** This machine's relay can take the host without a token being typed:
   *  set up here and its token remembered. */
  const canShareRelay = $derived(
    !!localRelay.status?.endpoint && localRelay.status.tokenRemembered === true,
  );

  /** Put the host's bridge on this machine's relay: this bridge admits its key
   *  (`relay/admitHost`, with the remembered token), then the host's bridge
   *  uses the relay's address. A local bridge too old to admit, or a token
   *  that is not remembered, falls back to setting the relay up for the host. */
  async function shareRelay() {
    const url = localRelay.status?.endpoint?.url;
    const hostKey = relay.status?.hostKey;
    if (!url || !hostKey) return;
    joining = true;
    try {
      await localRelay.admitHost(hostKey);
      await relay.use(url);
      toast.success(i18n.t("hostBridge.relayShared", { host: host.label }));
    } catch (e) {
      if (isUnknownMethodError(e)) {
        toast(i18n.t("hostBridge.relayShareUnsupported"));
        relayOpen = true;
      } else {
        toastError(e);
      }
    } finally {
      joining = false;
    }
  }
  let pairOpen = $state(false);

  export async function refresh(): Promise<void> {
    if (!connected) {
      standing = null;
      return;
    }
    try {
      standing = await hostBridgeStatus(host.id);
    } catch (e) {
      standing = null;
      toastError(e);
    }
  }

  function fence() {
    const generation = sessions.generationOf(host.id);
    if (generation === undefined) throw new Error(`no live connection to ${host.label}`);
    return expectation(target, generation);
  }

  async function act(kind: NonNullable<typeof busy>, run: () => Promise<HostBridgeState | null>) {
    busy = kind;
    try {
      const next = await run();
      if (next) standing = next;
    } catch (e) {
      toastError(e);
    } finally {
      busy = null;
    }
  }

  function install() {
    installTail = [];
    void act("install", async () => {
      const done = await hostBridgeInstall(host.id, fence());
      if (!done.ok) installTail = done.tail;
      return hostBridgeStatus(host.id);
    });
  }

  const linked = $derived(link.status.state === "connected");

  interface Row {
    label: string;
    tone: StatusTone;
    detail: string;
  }

  /** Where the bridge stands, worded. */
  const bridgeRow = $derived.by((): Row | null => {
    const s = standing;
    if (!s) return null;
    const label = i18n.t("hostBridge.bridge");
    if (!s.install) {
      return s.node
        ? { label, tone: "off", detail: i18n.t("hostBridge.notInstalled") }
        : { label, tone: "error", detail: i18n.t("hostBridge.needsNode") };
    }
    const kind = s.install.kind === "own" ? i18n.t("hostBridge.own") : i18n.t("hostBridge.managed");
    const version = `${kind} · ${s.install.version}`;
    if (s.running !== null && s.supervised) {
      return { label, tone: "ok", detail: `${version} · ${i18n.t("hostBridge.keptRunning")}` };
    }
    if (s.running !== null) {
      return { label, tone: "ok", detail: `${version} · ${i18n.t("hostBridge.runningElsewhere")}` };
    }
    if (s.lastError) return { label, tone: "error", detail: `${version} · ${s.lastError}` };
    return { label, tone: "off", detail: `${version} · ${i18n.t("hostBridge.stopped")}` };
  });

  const linkRow = $derived.by((): Row => {
    const label = i18n.t("hostBridge.link");
    const st = link.status.state;
    if (st === "connected") return { label, tone: "ok", detail: i18n.t("hostBridge.linked") };
    if (st === "connecting") return { label, tone: "busy", detail: i18n.t("hostBridge.linking") };
    return { label, tone: "off", detail: i18n.t("hostBridge.notLinked") };
  });

  const relayRow = $derived.by((): Row => {
    const label = i18n.t("hostBridge.relay");
    const status = relay.status;
    if (!linked) return { label, tone: "off", detail: i18n.t("hostBridge.relayNeedsLink") };
    if (!status?.endpoint) {
      return {
        label,
        tone: "off",
        detail: canShareRelay ? i18n.t("hostBridge.relayNotShared") : i18n.t("hostBridge.relayNone"),
      };
    }
    if (!status.endpoint.enabled) return { label, tone: "off", detail: i18n.t("hostBridge.relayOff") };
    return status.state === "connected"
      ? { label, tone: "ok", detail: i18n.t("hostBridge.relayOn") }
      : { label, tone: "busy", detail: i18n.t(`relay.state.${status.state}`) };
  });

  $effect(() => {
    void connected;
    void refresh();
  });
</script>

<section class="flex flex-col gap-1.5">
  <div class="flex items-center justify-between gap-3">
    <h3 class={text.section}>{i18n.t("hostBridge.title")}</h3>
    {#if standing && linked}
      <Button variant="ghost" size="sm" onclick={() => (pairOpen = true)}>
        {i18n.t("hostBridge.pair")}
      </Button>
    {/if}
  </div>
  {#if !connected}
    <p class={text.meta}>{i18n.t("hostBridge.offline")}</p>
  {:else if !standing || !bridgeRow}
    <p class={text.meta}>{i18n.t("hostPage.checking")}</p>
  {:else}
    <ul class="flex flex-col">
      {#each [bridgeRow, linkRow, relayRow] as row (row.label)}
        <li class="flex items-start gap-2.5 rounded-md px-1 py-1.5">
          <span class="mt-1.5 flex shrink-0"><StatusDot tone={row.tone} /></span>
          <span class={cn(text.body, "w-36 shrink-0")}>{row.label}</span>
          <span class={cn(text.meta, "min-w-0 flex-1 break-words")}>{row.detail}</span>
        </li>
      {/each}
    </ul>

    <div class="flex flex-wrap items-center gap-2">
      {#if !standing.install && standing.node}
        <Button size="sm" disabled={busy !== null} onclick={install}>
          {#if busy === "install"}
            <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {i18n.t("hostBridge.installing")}
          {:else}
            {i18n.t("hostBridge.install")}
          {/if}
        </Button>
      {:else if standing.install && standing.running === null && !standing.supervise}
        <Button
          size="sm"
          disabled={busy !== null}
          onclick={() => void act("start", () => hostBridgeSupervise(host.id, true, fence()))}
        >
          {i18n.t("hostBridge.start")}
        </Button>
      {:else if standing.supervise}
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onclick={() => void act("stop", () => hostBridgeSupervise(host.id, false, fence()))}
        >
          {i18n.t("hostBridge.stop")}
        </Button>
      {/if}
      {#if linked && !relay.status?.endpoint}
        {#if canShareRelay}
          <Button size="sm" variant="outline" disabled={joining} onclick={() => void shareRelay()}>
            {#if joining}
              <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {/if}
            {i18n.t("hostBridge.relayShare")}
          </Button>
        {:else}
          <Button size="sm" variant="outline" onclick={() => (relayOpen = true)}>
            {i18n.t("hostBridge.relaySetup")}
          </Button>
        {/if}
      {/if}
    </div>
    {#if busy === "install"}
      <p class={text.meta}>{i18n.t("hostBridge.installingHint")}</p>
    {/if}
    {#if installTail.length > 0}
      <pre class={cn(text.meta, "max-h-28 overflow-auto rounded-md bg-muted/40 p-2 font-mono whitespace-pre-wrap")}>{installTail.join("\n")}</pre>
    {/if}

    {#if standing.install}
      <!-- The one way to publish a port on that machine, and the owner's
           choice: off by default, said plainly what it opens. -->
      <div class="flex items-start gap-3 rounded-md px-1 py-1.5">
        <span class="flex min-w-0 flex-1 flex-col">
          <span class={text.body}>{i18n.t("hostBridge.lan")}</span>
          <span class={text.meta}>
            {standing.lan ? i18n.t("hostBridge.lanOn", { host: host.label }) : i18n.t("hostBridge.lanOff", { host: host.label })}
          </span>
        </span>
        <Switch
          checked={standing.lan}
          disabled={busy !== null}
          aria-label={i18n.t("hostBridge.lan")}
          onCheckedChange={(on) => void act("lan", () => hostBridgeSetLan(host.id, on, fence()))}
        />
      </div>
    {/if}
  {/if}
</section>

<RelaySetupDialog bind:open={relayOpen} {relay} />
{#if pairOpen}
  <BridgeDialog bind:open={pairOpen} {target} />
{/if}
