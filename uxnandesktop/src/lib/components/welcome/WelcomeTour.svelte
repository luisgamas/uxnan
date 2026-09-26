<script lang="ts">
  // The welcome tour: what Uxnan is and what it can do, in six short steps —
  // text on the left, the apps themselves on the right: the same recreations
  // of Uxnan Desktop and Uxnan Mobile the website shows (`mock/`), the desktop
  // in the app's own tokens so it follows the theme. The motion respects
  // "reduce motion". Shown once on the first start (`welcome.showIfNew`), reopened
  // from the profile menu. ← → or the dots move between steps; Enter goes on;
  // closing it — Esc, Skip or Done — records it as seen.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import KeyChord from "$lib/components/KeyChord.svelte";
  import SmartphoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
  import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
  import MockDesktop from "./mock/MockDesktop.svelte";
  import MockPhone from "./mock/MockPhone.svelte";
  import { welcome } from "$lib/state/welcome.svelte";
  import { connectPhone } from "$lib/bridge/connectPhone.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { AGENT_CATALOG } from "$lib/agentCatalog";
  import { detectAgents } from "$lib/api";
  import { resolveBinding } from "$lib/keyboard/keyboard.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";

  const STEPS = ["welcome", "modes", "phone", "team", "agents", "ready"] as const;
  type Step = (typeof STEPS)[number];

  let index = $state(0);
  let nextButton = $state<HTMLButtonElement | null>(null);
  const step = $derived<Step>(STEPS[index]!);
  const last = $derived(index === STEPS.length - 1);

  // Reopened: start from the beginning.
  $effect(() => {
    if (welcome.open) index = 0;
  });

  // The agents on this computer, found the way Settings → Agents finds them.
  let installed = $state<string[] | null>(null);
  $effect(() => {
    if (!welcome.open || installed !== null) return;
    detectAgents(AGENT_CATALOG.map((c) => c.command))
      .then((found) => (installed = found))
      .catch(() => (installed = []));
  });
  const found = $derived(AGENT_CATALOG.filter((c) => installed?.includes(c.command)));

  const shortcuts = $derived([
    { label: i18n.t("welcome.ready.search"), chord: resolveBinding("worktreePalette") },
    { label: i18n.t("welcome.ready.addProject"), chord: resolveBinding("addProject") },
    { label: i18n.t("welcome.ready.newTerminal"), chord: resolveBinding("newTerminal") },
    { label: i18n.t("welcome.ready.settings"), chord: resolveBinding("openSettings") },
  ]);

  function go(next: number) {
    index = Math.max(0, Math.min(STEPS.length - 1, next));
  }

  function finish() {
    welcome.done();
  }

  function connect() {
    finish();
    connectPhone.show();
  }

  function addProject() {
    finish();
    projects.pickerOpen = true;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      if (last) finish();
      else go(index + 1);
    } else return;
    e.preventDefault();
  }

  const titleKey = {
    welcome: "welcome.welcome.title",
    modes: "welcome.modes.title",
    phone: "welcome.phone.title",
    team: "welcome.team.title",
    agents: "welcome.agents.title",
    ready: "welcome.ready.title",
  } as const;
  const bodyKey = {
    welcome: "welcome.welcome.body",
    modes: "welcome.modes.body",
    phone: "welcome.phone.body",
    team: "welcome.team.body",
    agents: "welcome.agents.body",
    ready: "welcome.ready.body",
  } as const;
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
    <div class="grid min-h-[28rem] grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
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

        {#if step === "phone"}
          <div>
            <Button class="mt-1" onclick={connect}>
              <Icon icon={SmartphoneIcon} data-icon="inline-start" />
              {i18n.t("welcome.phone.connect")}
            </Button>
          </div>
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
        class="relative flex min-w-0 items-center justify-center overflow-hidden border-l border-border/50 bg-muted/40 px-7 py-8"
        aria-hidden="true"
        inert
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
            {:else if step === "modes"}
              <MockDesktop center="chat" />
            {:else if step === "phone"}
              <div class="flex items-end justify-center gap-5">
                <MockPhone width={150} class="mb-6 -rotate-3" />
                <MockPhone width={170} screen="chat" />
              </div>
            {:else if step === "team"}
              <MockDesktop center="tools" />
            {:else if step === "agents"}
              <div class="grid grid-cols-3 gap-2">
                {#each installed === null ? [] : found.length > 0 ? found : AGENT_CATALOG.slice(0, 6) as agent, i (agent.id)}
                  <div
                    class={cn(
                      "welcome-rise flex items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-xs",
                      found.length === 0 && "opacity-50",
                    )}
                    style="--welcome-delay: {i * 60}ms"
                  >
                    <AgentLogo logo={agent.logo} class="size-5 shrink-0" />
                    <span class="flex min-w-0 flex-col">
                      <span class={cn(text.bodyStrong, "truncate")}>{agent.name}</span>
                      <span class={cn(text.meta, "truncate font-mono")}>{agent.command}</span>
                    </span>
                  </div>
                {/each}
              </div>
            {:else}
              <MockDesktop />
            {/if}
          </div>
        {/key}
      </section>
    </div>

    <footer class="flex items-center gap-3 border-t border-border/60 bg-muted/30 px-5 py-3">
      <div class="flex items-center gap-1.5" role="tablist" aria-label={i18n.t("welcome.progress")}>
        {#each STEPS as s, i (s)}
          <button
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={i18n.t(titleKey[s])}
            class={cn(
              "h-1.5 rounded-full transition-all duration-300",
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
        <Button bind:ref={nextButton} onclick={() => go(index + 1)}>{i18n.t("welcome.next")}</Button>
      {/if}
    </footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Each step's picture comes in gently; the agent cards rise one after the
     other (`--welcome-delay`). */
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
