<script lang="ts">
  // A chat tab before its first message: choose the agent (fixed for the life
  // of the conversation — another CLI cannot continue a native session) and,
  // optionally, a model (switchable later). Or pick up a conversation that
  // already runs in this folder — one started on the phone included — since
  // every client sees the same bridge threads.
  //
  // The agent is chosen with the same `Combobox` + `AgentLogo` the new-worktree
  // dialog uses, the model with the shared `AiModelPicker`.
  import { Icon } from "$lib/components/ui/icon";
  import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
  import AgentLogo from "$lib/components/AgentLogo.svelte";
  import AiModelPicker from "$lib/components/AiModelPicker.svelte";
  import Combobox, { type ComboGroup, type ComboItem } from "$lib/components/Combobox.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import { chat } from "$lib/bridge/chat.svelte";
  import { bridgeAgentForCommand, bridgeAgentLogo } from "$lib/bridge/agents";
  import { app } from "$lib/state/app.svelte";
  import { terminals, type ChatTab } from "$lib/state/terminals.svelte";
  import { relativeTime } from "$lib/relativeTime";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat as chatTokens, icon, row, text } from "$lib/design";

  let { tab, active }: { tab: ChatTab; active: boolean } = $props();

  const agents = $derived(chat.agents);
  let agentId = $state<string | undefined>(undefined);
  let model = $state("");
  let optionValues = $state<Record<string, string | boolean>>({});
  let starting = $state(false);
  let modelsLoading = $state(false);

  // Preselect: the agent the launcher asked for, else the desktop's default
  // agent (Settings → Agents) when the bridge drives that CLI, else the first
  // one installed.
  $effect(() => {
    if (agentId && agents.some((a) => a.agentId === agentId)) return;
    const preferred = [tab.agentId, bridgeAgentForCommand(app.defaultAgent()?.command)];
    const wanted = preferred
      .map((id) => agents.find((a) => a.agentId === id && a.available))
      .find((a) => a !== undefined);
    agentId = (wanted ?? agents.find((a) => a.available))?.agentId;
  });

  $effect(() => {
    const id = agentId;
    if (!id) return;
    modelsLoading = true;
    void chat.modelsFor(id).finally(() => (modelsLoading = false));
  });

  const agentGroups = $derived<ComboGroup[]>([
    {
      items: agents.map((a) => ({
        value: a.agentId,
        label: a.displayName,
        disabled: !a.available,
        ...(a.available ? {} : { meta: i18n.t("chat.notInstalled") }),
      })),
    },
  ]);
  const models = $derived(chat.cachedModels(agentId));
  const runOptions = $derived(models.find((m) => m.id === model)?.options ?? []);
  const existing = $derived(chat.threadsFor(tab.cwd).filter((t) => t.status !== "archived"));
  const folder = $derived(
    tab.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? tab.cwd,
  );

  function pickAgent(id: string) {
    if (id === agentId) return;
    agentId = id;
    model = "";
    optionValues = {};
  }

  async function start(message: string) {
    if (!agentId || starting) return;
    starting = true;
    try {
      const thread = await chat.startThread({
        cwd: tab.cwd,
        agentId,
        ...(model ? { model } : {}),
      });
      terminals.bindChatThread(tab.id, thread.id);
      // The conversation is empty on the bridge, so the first page is known
      // without a round trip — and `send` titles the thread from this message.
      const conversation = chat.conversation(thread.id);
      conversation.loaded = true;
      await chat.send(thread.id, message, { options: optionValues });
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
</script>

{#snippet agentPrefix(item: ComboItem)}
  <AgentLogo logo={bridgeAgentLogo(item.value)} class={cn(icon.brand, "shrink-0")} />
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto">
    <div class={cn(chatTokens.column, "flex max-w-xl flex-col gap-6 pb-6 pt-12")}>
      <div class="flex flex-col items-center gap-2 text-center">
        <Icon icon={BubbleChatIcon} class={cn(icon.empty, "text-muted-foreground/60")} />
        <h2 class={text.title}>{i18n.t("chat.startTitle", { folder })}</h2>
        <p class={cn(text.meta, "max-w-md")}>{i18n.t("chat.startHint")}</p>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class={text.bodyStrong}>{i18n.t("chat.chooseAgent")}</span>
        <Combobox
          value={agentId}
          groups={agentGroups}
          placeholder={agents.length === 0 ? i18n.t("chat.agentsLoading") : ""}
          searchPlaceholder={i18n.t("common.search")}
          itemPrefix={agentPrefix}
          disabled={agents.length === 0}
          onChange={pickAgent}
        />
        <p class={text.meta}>{i18n.t("chat.agentFixedHint")}</p>
      </div>

      {#if existing.length > 0}
        <div class="flex flex-col gap-1">
          <span class={text.section}>{i18n.t("chat.continue")}</span>
          {#each existing.slice(0, 8) as thread (thread.id)}
            <button
              type="button"
              class={cn(row.list, row.listInactive)}
              onclick={() => openExisting(thread.id)}
            >
              <AgentLogo logo={bridgeAgentLogo(thread.agentId)} class={cn(icon.brand, "shrink-0")} />
              <span class="min-w-0 flex-1 truncate text-foreground">{thread.title}</span>
              <span class={cn(text.meta, "shrink-0")}>{relativeTime(thread.updatedAt, i18n.locale)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class={cn(chatTokens.column, "max-w-xl shrink-0 pb-4")}>
    <ChatComposer
      disabled={!agentId || starting}
      {runOptions}
      bind:optionValues
      autofocus={active}
      placeholder={i18n.t("chat.startPlaceholder")}
      onsend={start}
    >
      {#snippet leading()}
        <AiModelPicker
          {models}
          value={model}
          loading={modelsLoading}
          size="sm"
          triggerClass="max-w-56"
          disabled={!agentId}
          onSelect={(id) => (model = id)}
        />
      {/snippet}
    </ChatComposer>
  </div>
</div>
