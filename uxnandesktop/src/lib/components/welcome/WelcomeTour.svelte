<script lang="ts">
  // The welcome tour: what Uxnan is, and leaving it ready to use — text on the
  // left, the apps themselves (or the step's own controls) on the right. The
  // pictures are the same recreations of Uxnan Desktop and Uxnan Mobile the
  // website shows (`mock/`), in the app's own tokens so they follow the theme.
  //
  // The story, one step each: agents side by side · chat or terminal, and the
  // conversation continues on the phone · reaching this computer from anywhere
  // (LAN, Tailscale, the user's own relay) · agents that work together
  // (`uxnan-cli`) · turning on the agents found here — the same owner Settings
  // → Agents uses (`catalogAgents`), every one checked by default · pairing a
  // phone with the running bridge's own QR (`PhonePairing`) · ready: the
  // bridge running as the user's service, the agents on, the phone paired.
  //
  // Shown once per tour version on start (`welcome.showIfNew`), reopened from
  // the profile menu. ← → or the dots move between steps; Enter goes on;
  // closing it — Esc, Skip or Done — records it as seen. The motion respects
  // "reduce motion".
  import { untrack } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import KeyChord from "$lib/components/KeyChord.svelte";
  import StatusDot, { type StatusTone } from "$lib/components/StatusDot.svelte";
  import PhonePairing from "$lib/components/PhonePairing.svelte";
  import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
  import WifiIcon from "@hugeicons/core-free-icons/Wifi01Icon";
  import ShieldKeyIcon from "@hugeicons/core-free-icons/ShieldKeyIcon";
  import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
  import LockIcon from "@hugeicons/core-free-icons/LockIcon";
  import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import TerminalIcon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
  import CheckCircleIcon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
  import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
  import MockDesktop from "./mock/MockDesktop.svelte";
  import MockPhone from "./mock/MockPhone.svelte";
  import { welcome } from "$lib/state/welcome.svelte";
  import { catalogAgents } from "$lib/state/catalogAgents.svelte";
  import { bridge } from "$lib/bridge/client.svelte";
  import { bridgeInstall } from "$lib/bridge/install.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { AGENT_CATALOG } from "$lib/agentCatalog";
  import type { TrustedDevice } from "$shared/models/session";
  import { resolveBinding } from "$lib/keyboard/keyboard.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  const STEPS = ["welcome", "anywhere", "reach", "team", "agents", "phone", "ready"] as const;
  type Step = (typeof STEPS)[number];

  let index = $state(0);
  let nextButton = $state<HTMLButtonElement | null>(null);
  const step = $derived<Step>(STEPS[index]!);
  const last = $derived(index === STEPS.length - 1);

  // Reopened: start from the beginning, with what is on this computer now.
  $effect(() => {
    if (!welcome.open) return;
    index = 0;
    untrack(() => {
      void catalogAgents.detect();
      void bridgeInstall.refreshStatus();
    });
  });

  // ---- agents: the ones found here, all checked unless told otherwise ----
  const found = $derived(catalogAgents.found);
  /** Commands the user unchecked (default: every found agent is checked). */
  let unchecked = $state<Set<string>>(new Set());
  const toTurnOn = $derived(
    found.filter((c) => !catalogAgents.isConfigured(c) && !unchecked.has(c.command)),
  );
  const agentsOn = $derived(found.filter((c) => catalogAgents.isConfigured(c)).length);
  function toggle(command: string, on: boolean): void {
    const next = new Set(unchecked);
    if (on) next.delete(command);
    else next.add(command);
    unchecked = next;
  }

  // ---- the bridge ----
  const status = $derived(bridge.status);
  const asService = $derived(
    status.state === "connected" && bridgeInstall.status?.host?.launchedBy === "service",
  );
  const bridgeTone = $derived<StatusTone>(
    status.state === "connected"
      ? "ok"
      : status.state === "connecting" || bridgeInstall.installing
        ? "busy"
        : status.state === "unavailable"
          ? "warn"
          : "off",
  );
  const bridgeLine = $derived.by(() => {
    if (bridgeInstall.installing) return i18n.t("bridge.settingUp");
    switch (status.state) {
      case "connected":
        return asService
          ? i18n.t("welcome.bridge.service", { version: status.bridgeVersion })
          : i18n.t("bridge.statusConnected", { version: status.bridgeVersion });
      case "connecting":
        return i18n.t("bridge.statusConnecting");
      case "unavailable":
        return i18n.t(`bridge.unavailable.${status.reason}`);
      case "off":
        return i18n.t("welcome.bridge.off");
    }
  });

  /** The phone that paired during the tour, or one already paired. */
  let pairedNow = $state<TrustedDevice | null>(null);
  const phone = $derived(pairedNow ?? chat.devices[0] ?? null);

  const shortcuts = $derived([
    { label: i18n.t("welcome.ready.search"), chord: resolveBinding("worktreePalette") },
    { label: i18n.t("welcome.ready.addProject"), chord: resolveBinding("addProject") },
    { label: i18n.t("welcome.ready.newTerminal"), chord: resolveBinding("newTerminal") },
    { label: i18n.t("welcome.ready.settings"), chord: resolveBinding("openSettings") },
  ]);

  function go(next: number) {
    index = Math.max(0, Math.min(STEPS.length - 1, next));
  }

  /** Next — on the agents step, turning on the checked ones first. */
  function advance() {
    if (step === "agents" && toTurnOn.length > 0) catalogAgents.add(toTurnOn);
    go(index + 1);
  }

  function finish() {
    welcome.done();
  }

  function addProject() {
    finish();
    projects.pickerOpen = true;
  }

  function turnBridgeOn() {
    app.settings.bridge = { ...app.settings.bridge, mode: "managed" };
    void app.persistSettings();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      if (last) finish();
      else advance();
    } else return;
    e.preventDefault();
  }

  const titleKey = {
    welcome: "welcome.welcome.title",
    anywhere: "welcome.anywhere.title",
    reach: "welcome.reach.title",
    team: "welcome.team.title",
    agents: "welcome.agents.title",
    phone: "welcome.phone.title",
    ready: "welcome.ready.title",
  } as const;
  const bodyKey = {
    welcome: "welcome.welcome.body",
    anywhere: "welcome.anywhere.body",
    reach: "welcome.reach.body",
    team: "welcome.team.body",
    agents: "welcome.agents.body",
    phone: "welcome.phone.body",
    ready: "welcome.ready.body",
  } as const;
  /** Steps whose right side is something to do, not a picture. */
  const interactive = $derived(step === "agents" || step === "phone" || step === "ready");

  /** The `uxnan-cli` example, split where it may wrap. */
  const CLI_EXAMPLE = ["uxnan-cli", "terminal create", "--agent codex", "--worktree branch:feat/login"];

  const routes = [
    { icon: WifiIcon, title: "welcome.reach.lan", body: "welcome.reach.lanBody" },
    { icon: ShieldKeyIcon, title: "welcome.reach.tailscale", body: "welcome.reach.tailscaleBody" },
    { icon: CloudIcon, title: "welcome.reach.relay", body: "welcome.reach.relayBody" },
  ] as const;
</script>

<Dialog.Root
  bind:open={welcome.open}
  onOpenChange={(open) => {
    if (!open) finish();
  }}
>
  <Dialog.Content
    size="workspace"
    composition="sectioned"
    class="overflow-hidden"
    {onkeydown}
    onOpenAutoFocus={(e) => {
      e.preventDefault();
      nextButton?.focus();
    }}
  >
    <div class="grid grid-cols-1 md:min-h-[30rem] md:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <section class="flex min-w-0 flex-col gap-3 px-7 pb-5 pt-7">
        {#if step === "welcome"}
          <p class={cn(text.section, "text-primary")}>{i18n.t("welcome.eyebrow")}</p>
        {/if}
        <Dialog.Title class="font-title text-2xl font-semibold leading-tight tracking-tight">
          {i18n.t(titleKey[step])}
        </Dialog.Title>
        <Dialog.Description class={cn(text.body, "leading-6 text-muted-foreground")}>
          {i18n.t(bodyKey[step])}
        </Dialog.Description>

        {#if step === "team"}
          <!-- One unbreakable chip per token: a flag never splits from its
               value, and a narrow column wraps between tokens only. -->
          <code
            class="mt-1 flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-xs leading-5 text-foreground"
          >
            <Icon icon={TerminalIcon} class={cn(icon.action, "mt-0.5 shrink-0 text-muted-foreground")} />
            <span class="flex min-w-0 flex-wrap gap-x-1.5">
              {#each CLI_EXAMPLE as token (token)}
                <span class="whitespace-nowrap">{token}</span>
              {/each}
            </span>
          </code>
        {:else if step === "phone"}
          <p class={cn(text.body, "mt-1 flex items-center gap-2")}>
            <StatusDot tone={bridgeTone} />
            <span class="min-w-0">{bridgeLine}</span>
          </p>
        {:else if step === "ready"}
          <ul class="mt-1 flex flex-col gap-1.5">
            {#each shortcuts as shortcut (shortcut.label)}
              <li class={cn(text.body, "flex items-center justify-between gap-3")}>
                <span class="text-muted-foreground">{shortcut.label}</span>
                {#if shortcut.chord}<KeyChord chord={shortcut.chord} />{/if}
              </li>
            {/each}
          </ul>
          {#if app.repos.length === 0}
            <div>
              <Button class="mt-2" onclick={addProject}>
                <Icon icon={FolderAddIcon} data-icon="inline-start" />
                {i18n.t("welcome.ready.addFirstProject")}
              </Button>
            </div>
          {/if}
        {/if}
      </section>

      <section
        class={cn(
          "relative flex min-w-0 items-center justify-center overflow-hidden border-border/50 bg-muted/40 px-7 py-8 max-md:border-t md:border-l",
          !interactive && "max-md:hidden",
        )}
        aria-hidden={interactive ? undefined : "true"}
        inert={!interactive}
      >
        {#key step}
          <div class="welcome-stage relative w-full">
            {#if step === "welcome"}
              <div class="pb-6 pr-10">
                <MockDesktop />
              </div>
              <div class="absolute -bottom-2 right-0">
                <MockPhone width={112} />
              </div>
            {:else if step === "anywhere"}
              <div class="pb-6 pr-16">
                <MockDesktop center="chat" />
              </div>
              <div class="absolute -bottom-2 right-0">
                <MockPhone width={128} screen="chat" />
              </div>
            {:else if step === "reach"}
              <div class="mx-auto flex max-w-md flex-col gap-4">
                <div class="flex items-center justify-between gap-3 px-1">
                  <span class="flex flex-col items-center gap-1.5">
                    <span class="flex size-10 items-center justify-center rounded-lg bg-background shadow-xs ring-1 ring-border/60">
                      <Icon icon={SmartphoneIcon} class={icon.nav} />
                    </span>
                    <span class={text.meta}>{i18n.t("welcome.reach.phone")}</span>
                  </span>
                  <span class="relative h-px flex-1 bg-border">
                    <span
                      class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/60"
                    >
                      <Icon icon={LockIcon} class={icon.status} />
                      {i18n.t("welcome.reach.e2ee")}
                    </span>
                  </span>
                  <span class="flex flex-col items-center gap-1.5">
                    <span class="flex size-10 items-center justify-center rounded-lg bg-background shadow-xs ring-1 ring-border/60">
                      <Icon icon={ComputerIcon} class={icon.nav} />
                    </span>
                    <span class={text.meta}>{i18n.t("welcome.reach.computer")}</span>
                  </span>
                </div>
                <ul class="flex flex-col gap-2">
                  {#each routes as route, i (route.title)}
                    <li
                      class="welcome-rise flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-xs"
                      style="--welcome-delay: {i * 70}ms"
                    >
                      <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon icon={route.icon} class={icon.button} />
                      </span>
                      <span class="flex min-w-0 flex-col gap-0.5">
                        <span class={text.bodyStrong}>{i18n.t(route.title)}</span>
                        <span class={text.meta}>{i18n.t(route.body)}</span>
                      </span>
                    </li>
                  {/each}
                </ul>
              </div>
            {:else if step === "team"}
              <MockDesktop center="tools" />
            {:else if step === "agents"}
              {#if catalogAgents.installed === null}
                <div class="flex flex-col items-center gap-2">
                  <Spinner aria-label={i18n.t("common.loading")} />
                  <p class={text.meta}>{i18n.t("settings.detecting")}</p>
                </div>
              {:else if found.length === 0}
                <div class="flex flex-col gap-3">
                  <p class={cn(text.body, "text-center text-muted-foreground")}>{i18n.t("welcome.agents.none")}</p>
                  <div class="grid grid-cols-2 gap-2 opacity-50 lg:grid-cols-3">
                    {#each AGENT_CATALOG.slice(0, 6) as agent (agent.id)}
                      <div class="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2.5">
                        <AgentLogo logo={agent.logo} class="size-5 shrink-0" />
                        <span class={cn(text.bodyStrong, "truncate")}>{agent.name}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <div class="flex flex-col gap-2">
                  <div class="uxnan-scroll grid max-h-[22rem] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {#each found as agent, i (agent.id)}
                      {@const on = catalogAgents.isConfigured(agent)}
                      <label
                        class={cn(
                          "welcome-rise flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-xs transition-colors hover:border-border",
                          on && "cursor-default",
                        )}
                        style="--welcome-delay: {i * 50}ms"
                      >
                        <Checkbox
                          checked={on || !unchecked.has(agent.command)}
                          disabled={on}
                          aria-label={agent.name}
                          onCheckedChange={(value) => toggle(agent.command, value === true)}
                        />
                        <AgentLogo logo={agent.logo} class="size-5 shrink-0" />
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span class={cn(text.bodyStrong, "truncate")}>{agent.name}</span>
                          <span class={cn(text.meta, "truncate font-mono")}>{agent.command}</span>
                        </span>
                        {#if on}
                          <span class={cn(text.meta, "shrink-0")}>{i18n.t("welcome.agents.alreadyOn")}</span>
                        {/if}
                      </label>
                    {/each}
                  </div>
                  <p class={cn(text.meta, "px-1")}>
                    {toTurnOn.length > 0
                      ? i18n.t("welcome.agents.willTurnOn", { count: String(toTurnOn.length) })
                      : i18n.t("welcome.agents.nothingToTurnOn")}
                  </p>
                </div>
              {/if}
            {:else if step === "phone"}
              <div class="flex flex-col items-center gap-3">
                <PhonePairing active={welcome.open && step === "phone"} bind:paired={pairedNow} size="size-52" />
              </div>
            {:else}
              <ul class="mx-auto flex max-w-sm flex-col gap-2">
                <li class="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-xs">
                  <Icon
                    icon={asService ? CheckCircleIcon : AlertCircleIcon}
                    class={cn(icon.button, "mt-0.5 shrink-0", asService ? "text-emerald-500" : "text-muted-foreground")}
                  />
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class={text.bodyStrong}>{i18n.t("welcome.ready.bridge")}</span>
                    <span class={text.meta}>{bridgeLine}</span>
                  </span>
                  {#if status.state === "off"}
                    <Button size="sm" variant="outline" onclick={turnBridgeOn}>{i18n.t("bridge.pairTurnOn")}</Button>
                  {/if}
                </li>
                <li class="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-xs">
                  <Icon
                    icon={agentsOn > 0 ? CheckCircleIcon : AlertCircleIcon}
                    class={cn(icon.button, "mt-0.5 shrink-0", agentsOn > 0 ? "text-emerald-500" : "text-muted-foreground")}
                  />
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class={text.bodyStrong}>{i18n.t("welcome.ready.agents")}</span>
                    <span class={text.meta}>
                      {agentsOn > 0
                        ? i18n.t("welcome.ready.agentsOn", { count: String(agentsOn) })
                        : i18n.t("welcome.ready.agentsNone")}
                    </span>
                  </span>
                </li>
                <li class="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-xs">
                  <Icon
                    icon={phone ? CheckCircleIcon : SmartphoneIcon}
                    class={cn(icon.button, "mt-0.5 shrink-0", phone ? "text-emerald-500" : "text-muted-foreground")}
                  />
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class={text.bodyStrong}>{i18n.t("welcome.ready.phone")}</span>
                    <span class={text.meta}>
                      {phone
                        ? i18n.t("welcome.ready.phonePaired", { name: phone.displayName })
                        : i18n.t("welcome.ready.phoneLater")}
                    </span>
                  </span>
                </li>
              </ul>
            {/if}
          </div>
        {/key}
      </section>
    </div>

    <footer class="flex flex-wrap items-center gap-3 border-t border-border/60 bg-muted/30 px-5 py-3">
      <div class="flex items-center gap-1.5" role="tablist" aria-label={i18n.t("welcome.progress")}>
        {#each STEPS as s, i (s)}
          <button
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={i18n.t(titleKey[s])}
            class={cn(
              "h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none",
              i === index ? "w-6 bg-primary" : "w-1.5 bg-foreground/20 hover:bg-foreground/40",
            )}
            onclick={() => go(i)}
          ></button>
        {/each}
      </div>
      <span class="flex-1"></span>
      {#if !last}
        <Button variant="ghost" onclick={finish}>{i18n.t("welcome.skip")}</Button>
      {/if}
      {#if index > 0}
        <Button variant="outline" onclick={() => go(index - 1)}>{i18n.t("welcome.back")}</Button>
      {/if}
      {#if last}
        <Button bind:ref={nextButton} onclick={finish}>{i18n.t("welcome.done")}</Button>
      {:else}
        <Button bind:ref={nextButton} onclick={advance}>
          {step === "agents" && toTurnOn.length > 0
            ? i18n.t("welcome.agents.turnOn", { count: String(toTurnOn.length) })
            : i18n.t("welcome.next")}
        </Button>
      {/if}
    </footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Each step's picture comes in gently; cards rise one after the other
     (`--welcome-delay`). */
  :global(.welcome-rise) {
    animation: welcome-rise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: var(--welcome-delay, 0ms);
  }
  .welcome-stage {
    animation: welcome-rise 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes welcome-rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.welcome-rise),
    .welcome-stage {
      animation: none;
    }
  }
</style>
