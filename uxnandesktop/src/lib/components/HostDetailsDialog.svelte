<script lang="ts">
  import { untrack } from "svelte";
  // A host's own page: where it stands, a step-by-step check of the way there,
  // what the machine has, and the terminals its engine holds — including ones a
  // previous run of the app left there. Opened from its row in Settings → Hosts.
  //
  // The check never signs in to find out (`ssh_host_doctor`): it reads what the
  // app knows and probes the first hop over TCP, so running it costs nothing
  // and asks nothing. Steps that need a session say so until there is one.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import StatusDot, { type StatusTone } from "$lib/components/StatusDot.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import HostBridgeSection from "$lib/components/HostBridgeSection.svelte";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import { hostAgents } from "$lib/agentAvailability";
  import { AGENT_CATALOG } from "$lib/agentCatalog";
  import Combobox from "$lib/components/Combobox.svelte";
  import {
    sshHostCarrier,
    sshHostDoctor,
    sshHostSessionEnd,
    sshHostSessions,
    sshHostSetCarrier,
  } from "$lib/api";
  import { currentOS } from "$lib/platform";
  import { HOST_STATE_TONE, hosts } from "$lib/state/hosts.svelte";
  import { sessions } from "$lib/state/sessions.svelte";
  import { expectation } from "$lib/target";
  import { relativeTime } from "$lib/relativeTime";
  import { toastError } from "$lib/toast";
  import type {
    HostDoctor,
    HostSession,
    SshCarrier,
    SshCarrierView,
    SshHost,
    SystemSshNeed,
  } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, text } from "$lib/design";

  let {
    open = $bindable(false),
    host,
    onforget,
  }: {
    open?: boolean;
    host: SshHost;
    /** Ask to forget the host — the caller owns that confirmation. */
    onforget: () => void;
  } = $props();

  const standing = $derived(hosts.stateOf(host.id));
  const connected = $derived(standing === "connected");
  const latency = $derived(sessions.latencyOf(host.id));
  const inventory = $derived(hosts.inventories[host.id]);
  const agents = $derived(inventory ? hostAgents(AGENT_CATALOG, inventory) : []);

  const stateLine = $derived(
    [
      i18n.t(`hostPage.state.${standing}`),
      connected && latency !== null ? i18n.t("hostPage.latency", { ms: latency }) : "",
      `${host.user}@${host.hostname}${host.port === 22 ? "" : `:${host.port}`}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  // --- The check ---------------------------------------------------------------

  let doctor = $state<HostDoctor | null>(null);
  let checking = $state(false);

  async function check() {
    if (checking) return;
    checking = true;
    try {
      doctor = await sshHostDoctor(host.id);
    } catch (e) {
      toastError(e);
    } finally {
      checking = false;
    }
  }

  interface Step {
    key: string;
    label: string;
    tone: StatusTone;
    detail: string;
  }

  /** The check, worded: one row per step, its state and what it found. */
  const steps = $derived.by((): Step[] => {
    const d = doctor;
    if (!d) return [];
    const K = "hostPage.check" as const;
    const pending = i18n.t(`${K}.needsConnection`);
    const out: Step[] = [];
    out.push(
      d.routeError
        ? { key: "route", label: i18n.t(`${K}.route`), tone: "error", detail: d.routeError }
        : {
            key: "route",
            label: i18n.t(`${K}.route`),
            tone: "ok",
            detail: d.proxyCommand
              ? i18n.t(`${K}.routeProxy`)
              : d.hops.length > 1
                ? i18n.t(`${K}.routeVia`, { hops: d.hops.join(" → ") })
                : i18n.t(`${K}.routeDirect`),
          },
    );
    out.push(
      d.proxyCommand
        ? { key: "reach", label: i18n.t(`${K}.reach`), tone: "off", detail: i18n.t(`${K}.reachProxy`) }
        : d.reachError
          ? { key: "reach", label: i18n.t(`${K}.reach`), tone: "error", detail: d.reachError }
          : {
              key: "reach",
              label: i18n.t(`${K}.reach`),
              tone: "ok",
              detail: i18n.t(`${K}.reachMs`, { ms: d.reachMs ?? 0 }),
            },
    );
    out.push({
      key: "key",
      label: i18n.t(`${K}.hostKey`),
      tone: d.keySettled ? "ok" : "warn",
      detail: d.keySettled ? i18n.t(`${K}.hostKeyKnown`) : i18n.t(`${K}.hostKeyNew`),
    });
    out.push({
      key: "auth",
      label: i18n.t(`${K}.signIn`),
      tone: d.connected ? "ok" : "off",
      detail: d.connected ? i18n.t(`${K}.signedIn`) : pending,
    });
    out.push({
      key: "shell",
      label: i18n.t(`${K}.shell`),
      tone: d.shell ? "ok" : "off",
      detail: d.shell ?? pending,
    });
    out.push(
      d.engine
        ? {
            key: "engine",
            label: i18n.t(`${K}.engine`),
            tone: "ok",
            detail: i18n.t(`${K}.engineRuns`, {
              version: d.engine.version,
              platform: `${d.engine.os}/${d.engine.arch}`,
            }),
          }
        : d.engineError
          ? {
              key: "engine",
              label: i18n.t(`${K}.engine`),
              tone: "error",
              detail: i18n.t(`${K}.engineFailed`, { reason: d.engineError }),
            }
          : { key: "engine", label: i18n.t(`${K}.engine`), tone: "off", detail: pending },
    );
    out.push({
      key: "rtt",
      label: i18n.t(`${K}.roundTrip`),
      tone: d.roundTripMs !== null ? "ok" : "off",
      detail:
        d.roundTripMs !== null
          ? i18n.t(`${K}.reachMs`, { ms: d.roundTripMs })
          : d.connected
            ? i18n.t(`${K}.needsEngine`)
            : pending,
    });
    out.push({
      key: "agent",
      label: i18n.t(`${K}.forwardAgent`),
      tone: d.forwardAgent ? "ok" : "off",
      detail: d.forwardAgent ? i18n.t(`${K}.forwardAgentOn`) : i18n.t(`${K}.forwardAgentOff`),
    });
    return out;
  });

  // --- What carries the connection ------------------------------------------------

  let carrierView = $state<SshCarrierView | null>(null);
  let carrierChanged = $state(false);
  const live = $derived(sessions.systemOf(host.id));

  const carrierGroups = $derived([
    {
      items: (["auto", "builtin", "system"] as const).map((value) => ({
        value,
        label: i18n.t(`hostPage.carrier.${value}`),
      })),
    },
  ]);

  function reasonOf(need: { code: string; file?: string | null }): string {
    return i18n.t(`hostPage.systemNeed.${need.code as SystemSshNeed["code"]}`, {
      file: need.file ?? "",
    });
  }

  /** What carries it now, when connected; what will, when not. */
  const carrierLine = $derived.by(() => {
    if (connected) {
      return live
        ? i18n.t("hostPage.carrierSystemNow", { reason: reasonOf(live) })
        : i18n.t("hostPage.carrierBuiltinNow");
    }
    const view = carrierView;
    if (!view) return "";
    return view.system
      ? i18n.t("hostPage.carrierSystemNext", { reason: reasonOf(view.system) })
      : i18n.t("hostPage.carrierBuiltinNext");
  });

  /** Whether the system ssh carries it, or would — when it does on Windows,
   *  every channel is its own login, which the page says. */
  const viaSystem = $derived(connected ? live !== null : Boolean(carrierView?.system));

  async function loadCarrier() {
    try {
      carrierView = await sshHostCarrier(host.id);
    } catch {
      carrierView = null;
    }
  }

  async function setCarrier(value: string) {
    const carrier = value as SshCarrier;
    if ((host.carrier ?? "auto") === carrier) return;
    try {
      const updated = await sshHostSetCarrier(host.id, carrier);
      hosts.hosts = hosts.hosts.map((h) => (h.id === updated.id ? updated : h));
      carrierChanged = connected;
      await loadCarrier();
    } catch (e) {
      toastError(e);
    }
  }

  // --- The host's terminals -----------------------------------------------------

  let held = $state<HostSession[] | null>(null);
  let ending = $state<HostSession | null>(null);
  let endOpen = $state(false);

  async function loadSessions() {
    if (!connected) {
      held = null;
      return;
    }
    try {
      held = await sshHostSessions(host.id);
    } catch {
      held = [];
    }
  }

  async function endSession() {
    const target = ending;
    if (!target) return;
    const generation = sessions.generationOf(host.id);
    if (generation === undefined) return;
    try {
      await sshHostSessionEnd(host.id, target.session, expectation(`ssh:${host.id}`, generation));
    } catch (e) {
      toastError(e);
    }
    ending = null;
    await loadSessions();
  }

  function folderName(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || path;
  }

  // Open → check and list; a connection that comes or goes → again. Only
  // those two are what this reacts to: what the check itself reads and writes
  // (`checking`, `doctor`) is untracked, or each run would start the next.
  $effect(() => {
    if (!open) return;
    void connected;
    untrack(() => {
      void check();
      void loadSessions();
      void loadCarrier();
    });
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content size="medium">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{host.label}</Dialog.Title>
      <Dialog.Description class={cn(text.body, "flex items-center gap-2")}>
        <StatusDot tone={HOST_STATE_TONE[standing]} />
        <span class="truncate">{stateLine}</span>
      </Dialog.Description>
    </Dialog.Header>

    <Dialog.Body class="flex flex-col gap-5 py-0">
      <section class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-3">
          <h3 class={text.section}>{i18n.t("hostPage.checkTitle")}</h3>
          <Button variant="ghost" size="sm" disabled={checking} onclick={() => void check()}>
            {#if checking}
              <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {/if}
            {i18n.t("hostPage.checkAgain")}
          </Button>
        </div>
        {#if steps.length === 0}
          <p class={text.meta}>{i18n.t("hostPage.checking")}</p>
        {:else}
          <ul class="flex flex-col">
            {#each steps as step (step.key)}
              <li class="flex items-start gap-2.5 rounded-md px-1 py-1.5">
                <span class="mt-1.5 flex shrink-0"><StatusDot tone={step.tone} /></span>
                <span class={cn(text.body, "w-36 shrink-0")}>{step.label}</span>
                <span class={cn(text.meta, "min-w-0 flex-1 break-words")}>{step.detail}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class={text.section}>{i18n.t("hostPage.carrierTitle")}</h3>
          <Combobox
            value={host.carrier ?? "auto"}
            groups={carrierGroups}
            triggerClass={field.selectStandard}
            searchPlaceholder={i18n.t("common.search")}
            onChange={(v) => void setCarrier(v)}
          />
        </div>
        {#if carrierLine}
          <p class={text.meta}>{carrierLine}</p>
        {/if}
        {#if carrierChanged}
          <p class={text.meta}>{i18n.t("hostPage.carrierChanged")}</p>
        {/if}
        {#if viaSystem && currentOS() === "windows"}
          <p class={text.meta}>{i18n.t("hostPage.carrierUnshared")}</p>
        {/if}
        {#if (host.carrier ?? "auto") === "auto" && !viaSystem}
          <p class={text.meta}>{i18n.t("hostPage.carrierAutoHint")}</p>
        {/if}
      </section>

      <section class="flex flex-col gap-1.5">
        <h3 class={text.section}>{i18n.t("hostPage.machineTitle")}</h3>
        {#if !inventory}
          <p class={text.meta}>{i18n.t("hostPage.machineUnknown")}</p>
        {:else}
          <p class={text.meta}>
            {[
              inventory.os,
              inventory.git || i18n.t("hostPage.noGit"),
              inventory.multiplexer || i18n.t("hosts.noMultiplexer"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {#if agents.length === 0}
            <p class={text.meta}>{i18n.t("hosts.agentsNone")}</p>
          {:else}
            <ul class="flex flex-col">
              {#each agents as agent (agent.key)}
                <li class="flex items-center gap-2.5 rounded-md px-1 py-1">
                  <AgentLogo logo={agent.logo} class="size-4 shrink-0" />
                  <span class={cn(text.body, "min-w-0 flex-1 truncate")}>{agent.name}</span>
                  {#if agent.version}
                    <span class={cn(text.meta, "max-w-[45%] truncate font-mono")} title={agent.version}>
                      {agent.version}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      <HostBridgeSection {host} {connected} />

      <section class="flex flex-col gap-1.5">
        <h3 class={text.section}>{i18n.t("hostPage.sessionsTitle")}</h3>
        {#if !connected}
          <p class={text.meta}>{i18n.t("hostPage.sessionsOffline")}</p>
        {:else if held === null}
          <p class={text.meta}>{i18n.t("hostPage.checking")}</p>
        {:else if held.length === 0}
          <p class={text.meta}>{i18n.t("hostPage.sessionsNone")}</p>
        {:else}
          <ul class="flex flex-col">
            {#each held as s (s.session)}
              <li class="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <StatusDot tone={s.alive ? "ok" : "off"} />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class={cn(text.body, "truncate")} title={s.cwd}>{folderName(s.cwd)}</span>
                  <span class={cn(text.meta, "truncate")}>
                    {[
                      relativeTime(Date.now() - s.startedAgoMs, i18n.locale),
                      !s.alive
                        ? i18n.t("hostPage.sessionEnded")
                        : s.tab
                          ? i18n.t("hostPage.sessionShown")
                          : i18n.t("hostPage.sessionNotShown"),
                    ].join(" · ")}
                  </span>
                </span>
                {#if s.alive}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => {
                      ending = s;
                      endOpen = true;
                    }}
                  >
                    {i18n.t("hostPage.sessionEnd")}
                  </Button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </Dialog.Body>

    <Dialog.Footer>
      <Button variant="ghost" class="mr-auto text-destructive" onclick={onforget}>
        {i18n.t("hostPage.forget")}
      </Button>
      {#if connected}
        <Button variant="outline" onclick={() => hosts.disconnect(host.id)}>
          {i18n.t("hosts.disconnect")}
        </Button>
      {:else}
        <Button disabled={standing === "connecting"} onclick={() => hosts.connect(host.id)}>
          {standing === "connecting" ? i18n.t("hosts.connecting") : i18n.t("hosts.connect")}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={endOpen}
  title={i18n.t("hostPage.sessionEndTitle", { folder: ending ? folderName(ending.cwd) : "" })}
  description={i18n.t("hostPage.sessionEndBody", { host: host.label })}
  confirmLabel={i18n.t("hostPage.sessionEnd")}
  danger
  onconfirm={() => void endSession()}
/>
