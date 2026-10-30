<script lang="ts">
  // "Continue with another agent…" (architecture/02a §5.8.21): a NEW
  // conversation for the agent chosen here, in the same folder, whose first
  // message carries this one's context — prepared by the bridge, never an
  // invented summary. This conversation stays exactly as it is.
  //
  // In a chat: the new conversation opens and its first message (typed here or
  // later) carries the context. In a terminal: the bridge first delivers it
  // with the message typed here, then the agent's own session — which now holds
  // the context — is reopened in a terminal (`agentResume.ts`); only an agent
  // that can resume interactively offers it.
  import type { Thread, TransferStrategy } from "$shared/models/thread";
  import { TRANSFER_STRATEGIES } from "$shared/models/thread";
  import { chatOfThread } from "$lib/bridge/chat.svelte";
  import { chatActionUi } from "$lib/bridge/chatActions.svelte";
  import { bridgeAgentLogo, hookAgentForBridgeAgent } from "$lib/bridge/agents";
  import { resumeInvocation } from "$lib/agentResume";
  import { terminalSessionsFor } from "$lib/state/terminalSessions.svelte";
  import ModelPicker, { type PickerAgent } from "$lib/components/ModelPicker.svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Segmented } from "$lib/components/ui/segmented";
  import { Textarea } from "$lib/components/ui/textarea";
  import { SvelteSet } from "svelte/reactivity";
  import { errorMessage } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, row, text } from "$lib/design";

  let { source }: { source: Thread } = $props();

  const chat = $derived(chatOfThread(source.id));
  let open = $state(true);
  let agentId = $state<string | undefined>(undefined);
  let model = $state("");
  let strategy = $state<TransferStrategy>("selection");
  let where = $state<"chat" | "terminal">("chat");
  let message = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  // Preselect another agent than this conversation's — that is the point.
  $effect(() => {
    if (agentId) return;
    const others = chat.agents.filter((a) => a.available && a.agentId !== source.agentId);
    agentId = (others[0] ?? chat.agents.find((a) => a.available))?.agentId;
  });
  $effect(() => {
    if (agentId) void chat.modelsFor(agentId);
  });
  const browsing = new SvelteSet<string>();
  function browseAgent(id: string) {
    if (chat.cachedModels(id).length > 0 || browsing.has(id)) return;
    browsing.add(id);
    void chat.modelsFor(id).finally(() => browsing.delete(id));
  }
  const pickerAgents = $derived<PickerAgent[]>(
    chat.agents.map((a) => ({
      id: a.agentId,
      label: a.displayName,
      logo: bridgeAgentLogo(a.agentId),
      available: a.available,
      ...(a.available ? {} : { note: i18n.t("chat.notInstalled") }),
    })),
  );
  function pickModel(id: string, agent?: string) {
    if (agent && agent !== agentId) agentId = agent;
    model = id;
  }

  /** Whether the agent's own session can be reopened in a terminal here. */
  const resumable = $derived.by(() => {
    const hook = hookAgentForBridgeAgent(agentId);
    return !!hook && !!resumeInvocation({ agent: hook, id: "probe", capturedAt: 0 });
  });
  $effect(() => {
    if (!resumable && where === "terminal") where = "chat";
  });
  $effect(() => {
    if (where === "terminal" && message.trim().length === 0) {
      message = i18n.t("transfer.terminalBrief");
    }
  });

  const agentName = $derived(chat.agent(agentId)?.displayName ?? agentId ?? "");

  async function submit() {
    if (!agentId || busy) return;
    if (where === "terminal" && message.trim().length === 0) return;
    busy = true;
    error = null;
    try {
      const made = await chat.transfer({
        sourceThreadId: source.id,
        agentId,
        ...(model ? { model } : {}),
        strategy,
        ...(message.trim() ? { message } : {}),
        clientTransferId: crypto.randomUUID(),
      });
      chatActionUi.openContinuation(made.thread);
      if (where === "terminal") {
        void chatActionUi.openInTerminalOnceDelivered(
          made.thread.id,
          terminalSessionsFor(chat.target),
        );
      }
      open = false;
      chatActionUi.transferring = null;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(next) => {
    if (!next) chatActionUi.transferring = null;
  }}
>
  <Dialog.Content size="form">
    <Dialog.Header>
      <Dialog.Title class={text.title}>{i18n.t("transfer.title")}</Dialog.Title>
      <Dialog.Description class={text.meta}>
        {i18n.t("transfer.description", { title: source.title })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body class="flex flex-col gap-4">
      <div class="flex flex-col items-start gap-1.5">
        <span class={text.menuLabel}>{i18n.t("transfer.agent")}</span>
        <ModelPicker
          variant="pill"
          namesAgent
          agents={pickerAgents}
          {agentId}
          models={chat.cachedModels(agentId)}
          value={model}
          loading={chat.agents.length === 0}
          modelsOf={(id) => chat.cachedModels(id)}
          loadingOf={(id) => browsing.has(id)}
          onBrowse={browseAgent}
          onSelect={pickModel}
        />
      </div>

      <div class="flex flex-col gap-1.5" role="radiogroup" aria-label={i18n.t("transfer.strategy")}>
        <span class={text.menuLabel}>{i18n.t("transfer.strategy")}</span>
        <div class="overflow-hidden rounded-lg border border-border/60">
          {#each TRANSFER_STRATEGIES as value (value)}
            <button
              type="button"
              role="radio"
              aria-checked={strategy === value}
              class={cn(
                row.choice,
                "flex-col items-start gap-0.5 border-b border-border/50 last:border-b-0",
                strategy === value ? row.choiceActive : row.choiceInactive,
                focus.ring,
              )}
              onclick={() => (strategy = value)}
            >
              <span class="font-medium text-foreground">{i18n.t(`transfer.strategy.${value}`)}</span>
              <span class={text.meta}>{i18n.t(`transfer.strategyDesc.${value}`)}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class={text.menuLabel}>{i18n.t("transfer.where")}</span>
        <Segmented
          fill
          value={where}
          label={i18n.t("transfer.where")}
          options={[
            { value: "chat", label: i18n.t("transfer.whereChat") },
            {
              value: "terminal",
              label: i18n.t("transfer.whereTerminal"),
              disabled: !resumable,
              ...(resumable ? {} : { tooltip: i18n.t("transfer.noTerminal", { agent: agentName }) }),
            },
          ]}
          onValueChange={(v) => (where = v as "chat" | "terminal")}
        />
        {#if where === "terminal"}
          <p class={text.meta}>{i18n.t("transfer.terminalHint", { agent: agentName })}</p>
        {/if}
      </div>

      <div class="flex flex-col gap-1.5">
        <span class={text.menuLabel}>
          {where === "terminal" ? i18n.t("transfer.firstMessage") : i18n.t("transfer.firstMessageOptional")}
        </span>
        <Textarea
          bind:value={message}
          rows={3}
          placeholder={i18n.t("transfer.messagePlaceholder")}
          class="max-h-40 text-[13px]"
        />
        <p class={text.meta}>{i18n.t("transfer.messageHint")}</p>
      </div>
      {#if error}
        <p class="text-xs text-destructive">{error}</p>
      {/if}
    </Dialog.Body>
    <Dialog.Footer>
      <Button variant="ghost" size="sm" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
      <Button
        size="sm"
        disabled={!agentId || busy || (where === "terminal" && message.trim().length === 0)}
        onclick={() => void submit()}
      >
        {i18n.t("transfer.submit", { agent: agentName })}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
