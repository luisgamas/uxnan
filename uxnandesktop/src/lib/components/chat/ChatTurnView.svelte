<script lang="ts">
  // One turn of a chat: the user's message and the agent's answer.
  //
  // The answer renders from `segments` when the bridge sent them (the text
  // and work blocks in the order the agent produced them), grouped by
  // `timeline.ts`: consecutive steps become one work group.
  //
  //  - While the turn runs everything is in view, with a "Working for 12s" line
  //    under it.
  //  - Once it settles, the work that led to the answer folds behind one line
  //    ("Worked for 1m 3s"). The closing answer stays open, and the files the
  //    turn changed are gathered into one card at its end.
  //
  // A turn without ordering info (an older record, the native-history
  // fallback) shows its blocks first, then its text.
  import { untrack } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
  import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
  import type { Turn } from "$shared/models/thread";
  import MarkdownView from "$lib/components/MarkdownView.svelte";
  import ChatBlock from "./ChatBlock.svelte";
  import ChatMessageMeta from "./ChatMessageMeta.svelte";
  import ChatWorkGroup from "./ChatWorkGroup.svelte";
  import { assistantOf, userText, type Conversation } from "$lib/bridge/conversation.svelte";
  import {
    changedFiles,
    formatElapsed,
    groupParts,
    splitAnswer,
    type TimelineItem,
  } from "$lib/bridge/timeline";
  import { splitStreamingMarkdown } from "$lib/bridge/streamingMarkdown";
  import { terminals } from "$lib/state/terminals.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, focus, icon, row, text } from "$lib/design";

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
  const answered = $derived(turn.status !== "queued" && turn.status !== "cancelled");
  let thinkingOpen = $state(false);
  let workOpen = $state(false);

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
  const items = $derived(groupParts(parts));
  const split = $derived(splitAnswer(items));
  const files = $derived(streaming ? [] : changedFiles(parts));
  /** The closing answer's text, for its copy button. */
  const answerText = $derived(
    split.answer.map((i) => (i.kind === "text" ? i.text : "")).join("\n\n"),
  );

  // --- elapsed time ---------------------------------------------------------
  let now = $state(untrack(() => Date.now()));
  $effect(() => {
    if (!streaming) return;
    now = Date.now();
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(tick);
  });
  const elapsed = $derived(
    streaming
      ? formatElapsed(now - turn.createdAt)
      : turn.completedAt
        ? formatElapsed(turn.completedAt - turn.createdAt)
        : null,
  );
  const foldLabel = $derived.by(() => {
    if (turn.status === "aborted") {
      return elapsed ? i18n.t("chat.stoppedAfter", { time: elapsed }) : i18n.t("chat.stopped");
    }
    if (turn.status === "error") {
      return elapsed ? i18n.t("chat.failedAfter", { time: elapsed }) : i18n.t("chat.failed");
    }
    return elapsed ? i18n.t("chat.workedFor", { time: elapsed }) : i18n.t("chat.showWork");
  });

  function openFile(path: string) {
    const absolute = path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) ? path : `${cwd}/${path}`;
    terminals.openFile(absolute, cwd);
  }
</script>

{#snippet thinking()}
  {#if assistant?.thinking}
    <Collapsible.Root bind:open={thinkingOpen}>
      <Collapsible.Trigger class={chat.activity}>
        <Icon icon={BrainIcon} class={cn(icon.decorative, "shrink-0 opacity-70")} />
        <span class="flex-1">{i18n.t("chat.thinking")}</span>
        <Icon
          icon={ArrowRight01Icon}
          class={cn(icon.status, "shrink-0 transition-transform", thinkingOpen && "rotate-90")}
        />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p class={cn(text.meta, "ml-3 whitespace-pre-wrap border-l border-border/60 py-1 pl-3 leading-5")}>
          {assistant.thinking}
        </p>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
{/snippet}

{#snippet timeline(list: TimelineItem[], live: boolean)}
  {#each list as item, i (i)}
    {#if item.kind === "text"}
      <!-- One MarkdownView per settled chunk: a chunk that did not change keeps
           its parsed document and DOM, so a streamed update re-renders only the
           chunk still being written (`streamingMarkdown.ts`). -->
      <div class={cn(text.body, chat.prose, live && "chat-streaming")}>
        {#each splitStreamingMarkdown(item.text) as chunk, ci (ci)}
          <MarkdownView source={chunk} baseDir={cwd} inline onopenfile={openFile} />
        {/each}
      </div>
    {:else if item.kind === "work"}
      <ChatWorkGroup blocks={item.blocks} {live} />
    {:else}
      <ChatBlock block={item.block} {threadId} {conversation} {live} compact />
    {/if}
  {/each}
{/snippet}

<div class="flex flex-col gap-2">
  {#if prompt}
    <div class="group/message flex flex-col items-end gap-0.5">
      <div class={cn(chat.userBubble, turn.status === "cancelled" && "opacity-60")}>{prompt}</div>
      <ChatMessageMeta text={prompt} at={turn.createdAt} align="end" />
    </div>
    {#if turn.status === "cancelled"}
      <p class={cn(text.meta, "-mt-1 text-right")}>{i18n.t("chat.cancelled")}</p>
    {/if}
  {/if}

  {#if answered}
    <div class="group/message flex min-w-0 flex-col gap-1">
      {#if streaming}
        {@render thinking()}
        {@render timeline(items, true)}
        <div class={cn(text.meta, "flex items-center gap-2 px-2 py-1")}>
          <span class={chat.runningDot}></span>
          <span class="tabular-nums">{i18n.t("chat.workingFor", { time: elapsed ?? "" })}</span>
        </div>
      {:else}
        {#if split.work.length > 0 || assistant?.thinking}
          <Collapsible.Root bind:open={workOpen}>
            <div class="flex items-center gap-2 px-0.5">
              <Collapsible.Trigger class={cn(chat.fold, focus.ring)}>
                <span class="tabular-nums">{foldLabel}</span>
                <Icon
                  icon={ArrowRight01Icon}
                  class={cn(icon.status, "shrink-0 transition-transform", workOpen && "rotate-90")}
                />
              </Collapsible.Trigger>
              <span class={chat.foldRule} aria-hidden="true"></span>
            </div>
            <Collapsible.Content>
              <div class="mt-1 flex flex-col gap-1 border-l border-border/60 pl-2">
                {@render thinking()}
                {@render timeline(split.work, false)}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        {:else if turn.status === "aborted" && split.answer.length === 0}
          <p class={cn(text.meta, "px-2")}>{i18n.t("chat.stopped")}</p>
        {/if}

        {@render timeline(split.answer, false)}

        {#if files.length > 0}
          <div class={cn(chat.card, "mt-1 flex flex-col gap-0.5 p-1.5")}>
            <span class={cn(text.menuLabel, "px-1.5 pb-1 pt-0.5")}>
              {i18n.plural(files.length, "chat.filesChangedOne", "chat.filesChanged")}
            </span>
            {#each files as file (file.filename)}
              <button type="button" class={cn(row.list, row.listInactive)} onclick={() => openFile(file.filename)}>
                <Icon icon={FileEditIcon} class={cn(icon.decorative, "shrink-0 opacity-70")} />
                <span class="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-foreground/90">
                  {file.filename}
                </span>
                <span class={cn(text.indicator, "shrink-0 font-mono text-emerald-600 dark:text-emerald-400")}>
                  +{file.additions}
                </span>
                <span class={cn(text.indicator, "shrink-0 font-mono text-red-600 dark:text-red-400")}>
                  −{file.deletions}
                </span>
              </button>
            {/each}
          </div>
        {/if}

        {#if answerText}
          <ChatMessageMeta text={answerText} at={turn.completedAt} />
        {/if}
      {/if}
    </div>
  {/if}
</div>
