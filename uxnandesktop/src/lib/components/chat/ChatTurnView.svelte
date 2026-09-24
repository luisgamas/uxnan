<script lang="ts">
  // One turn of a chat: the user's message and the agent's answer.
  //
  // The answer renders from `segments` when the bridge sent them — prose and
  // work blocks in the order the agent produced them, so the work log sits
  // inline with the text it precedes, exactly as on the phone. A turn without
  // ordering info (an older record, the native-history fallback) falls back to
  // blocks first, then the text.
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
  import type { Turn } from "$shared/models/thread";
  import MarkdownView from "$lib/components/MarkdownView.svelte";
  import ChatBlock from "./ChatBlock.svelte";
  import { assistantOf, userText, type Conversation } from "$lib/bridge/conversation.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    turn,
    threadId,
    cwd,
    conversation,
  }: {
    turn: Turn;
    threadId: string;
    cwd: string;
    conversation: Conversation;
  } = $props();

  const prompt = $derived(userText(turn));
  const assistant = $derived(assistantOf(turn));
  const streaming = $derived(conversation.activeTurnId === turn.id);
  let thinkingOpen = $state(false);

  /** The answer as an ordered list of text runs and blocks. */
  const parts = $derived.by<unknown[]>(() => {
    if (!assistant) return [];
    if (Array.isArray(assistant.segments) && assistant.segments.length > 0) {
      return assistant.segments;
    }
    const blocks = Array.isArray(assistant.blocks) ? assistant.blocks : [];
    const content = typeof assistant.content === "string" ? assistant.content : "";
    return content ? [...blocks, { type: "text", text: content }] : blocks;
  });

  function isText(part: unknown): part is { type: "text"; text: string } {
    return (
      !!part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    );
  }

  function openFile(path: string) {
    const absolute = path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) ? path : `${cwd}/${path}`;
    terminals.openFile(absolute, cwd);
  }
</script>

<div class="flex flex-col gap-2">
  {#if prompt}
    <div class="flex justify-end">
      <div class={cn(chat.userBubble, turn.status === "cancelled" && "opacity-60")}>
        {prompt}
      </div>
    </div>
    {#if turn.status === "cancelled"}
      <p class={cn(text.meta, "text-right")}>{i18n.t("chat.cancelled")}</p>
    {/if}
  {/if}

  {#if turn.status !== "queued" && turn.status !== "cancelled" && turn.status !== "delivered"}
    <div class="flex min-w-0 flex-col gap-1">
      {#if assistant?.thinking}
        <Collapsible.Root bind:open={thinkingOpen}>
          <Collapsible.Trigger class={cn(chat.activity, "w-auto")}>
            <Icon
              icon={ArrowRight01Icon}
              class={cn(icon.status, "transition-transform", thinkingOpen && "rotate-90")}
            />
            <Icon icon={BrainIcon} class={icon.decorative} />
            {i18n.t("chat.thinking")}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <p class={cn(text.meta, "ml-3 whitespace-pre-wrap border-l-2 border-border/70 pl-3 leading-5")}>
              {assistant.thinking}
            </p>
          </Collapsible.Content>
        </Collapsible.Root>
      {/if}

      {#each parts as part, i (i)}
        {#if isText(part)}
          {#if part.text.trim()}
            <div class={cn(text.body, "min-w-0 leading-6")}>
              <MarkdownView source={part.text} baseDir={cwd} inline onopenfile={openFile} />
            </div>
          {/if}
        {:else}
          <ChatBlock block={part} {threadId} {conversation} live={streaming} />
        {/if}
      {/each}

      {#if streaming}
        <div class={cn(text.meta, "flex items-center gap-1.5 px-2 py-1")}>
          <Spinner class={icon.status} />
          {i18n.t("chat.working")}
        </div>
      {:else if turn.status === "aborted"}
        <p class={cn(text.meta, "px-2")}>{i18n.t("chat.stopped")}</p>
      {/if}
    </div>
  {/if}
</div>
