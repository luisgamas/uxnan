<script lang="ts">
  // A chat tab before its first message: choose the agent (fixed for the life
  // of the conversation — another CLI cannot continue a native session) and,
  // optionally, a model (switchable later). Or pick up a conversation that
  // already runs in this folder — one started on the phone included — since
  // every client sees the same bridge threads.
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatModelPicker from "./ChatModelPicker.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgeAgentLogo } from "$lib/bridge/agents";
  import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  let { tab, active }: { tab: ChatTab; active: boolean } = $props();

  const agents = $derived(chat.agents);
  let agentId = $state<string | undefined>(undefined);
  let model = $state<string | undefined>(undefined);
  let optionValues = $state<Record<string, string | boolean>>({});
  let starting = $state(false);

  // Preselect: the agent the launcher asked for, else the first one installed.
  $effect(() => {
    if (agentId && agents.some((a) => a.agentId === agentId)) return;
    const wanted = agents.find((a) => a.agentId === tab.agentId && a.available);
    agentId = (wanted ?? agents.find((a) => a.available))?.agentId;
  });

  const models = $derived(chat.cachedModels(agentId));
  const runOptions = $derived(models.find((m) => m.id === model)?.options ?? []);
  const existing = $derived(chat.threadsFor(tab.cwd).filter((t) => t.status !== "archived"));
  const folder = $derived(tab.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? tab.cwd);

  function pickAgent(id: string) {
    if (id === agentId) return;
    agentId = id;
    model = undefined;
    optionValues = {};
  }

  async function start(text: string) {
    if (!agentId || starting) return;
    starting = true;
    try {
      const thread = await chat.startThread({ cwd: tab.cwd, agentId, model });
      terminals.bindChatThread(tab.id, thread.id);
      // The conversation is empty on the bridge, so the first page is known
      // without a round trip — and `send` titles the thread from this message.
      const conversation = chat.conversation(thread.id);
      conversation.loaded = true;
      await chat.send(thread.id, text, { options: optionValues });
    } catch (err) {
      toastError(err);
    } finally {
      starting = false;
    }
  }

  function openExisting(threadId: string) {
    // Another tab may already show it: focus that one instead of a twin.
    for (const { tab: other } of terminals.tabsWithWorkspace()) {
      if (other.kind === "chat" && other.threadId === threadId && other.id !== tab.id) {
        terminals.openChat({ cwd: tab.cwd, threadId });
        return;
      }
    }
    terminals.bindChatThread(tab.id, threadId);
  }

  function ago(ms: number): string {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return i18n.t("chat.justNow");
    if (minutes < 60) return i18n.t("chat.minutesAgo", { n: String(minutes) });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return i18n.t("chat.hoursAgo", { n: String(hours) });
    return new Date(ms).toLocaleDateString();
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pb-6 pt-10">
      <div class="flex flex-col items-center gap-2 text-center">
        <Icon icon={BubbleChatIcon} class={cn(icon.empty, "text-muted-foreground/70")} />
        <h2 class={text.title}>{i18n.t("chat.startTitle", { folder })}</h2>
        <p class={cn(text.meta, "max-w-md")}>{i18n.t("chat.startHint")}</p>
      </div>

      <section class="flex flex-col gap-2">
        <h3 class={text.section}>{i18n.t("chat.chooseAgent")}</h3>
        {#if agents.length === 0}
          <div class="flex items-center gap-2 py-2">
            <Spinner class="size-3.5" /><span class={text.meta}>{i18n.t("chat.agentsLoading")}</span>
          </div>
        {:else}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
            {#each agents as agent (agent.agentId)}
              <button
                type="button"
                disabled={!agent.available}
                aria-pressed={agent.agentId === agentId}
                onclick={() => pickAgent(agent.agentId)}
                class={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                  agent.agentId === agentId
                    ? "border-ring/60 bg-accent text-accent-foreground"
                    : "border-border/60 hover:bg-foreground/[0.04]",
                  !agent.available && "cursor-not-allowed opacity-50",
                )}
              >
                <AgentLogo logo={bridgeAgentLogo(agent.agentId)} class={icon.brand} />
                <span class="min-w-0 flex-1 truncate">{agent.displayName}</span>
                {#if !agent.available}
                  <span class="shrink-0 text-[10px] text-muted-foreground">{i18n.t("chat.notInstalled")}</span>
                {/if}
              </button>
            {/each}
          </div>
          <p class={cn(text.meta, "text-[11px]")}>{i18n.t("chat.agentFixedHint")}</p>
        {/if}
      </section>

      {#if existing.length > 0}
        <section class="flex flex-col gap-1">
          <h3 class={text.section}>{i18n.t("chat.continue")}</h3>
          {#each existing.slice(0, 8) as thread (thread.id)}
            <button
              type="button"
              class="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-foreground/[0.04]"
              onclick={() => openExisting(thread.id)}
            >
              <AgentLogo logo={bridgeAgentLogo(thread.agentId)} class={icon.brand} />
              <span class="min-w-0 flex-1 truncate">{thread.title}</span>
              <span class={cn(text.meta, "shrink-0 text-[11px]")}>{ago(thread.updatedAt)}</span>
            </button>
          {/each}
        </section>
      {/if}
    </div>
  </div>

  <div class="mx-auto w-full max-w-2xl shrink-0 px-5 pb-4">
    <ChatComposer
      disabled={!agentId || starting}
      runOptions={runOptions}
      bind:optionValues
      autofocus={active}
      placeholder={i18n.t("chat.startPlaceholder")}
      onsend={start}
    >
      {#snippet leading()}
        <ChatModelPicker {agentId} value={model} onchange={(m) => (model = m)} />
      {/snippet}
    </ChatComposer>
  </div>
</div>
