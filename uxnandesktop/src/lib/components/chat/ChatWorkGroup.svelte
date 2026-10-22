<script lang="ts">
  // A run of consecutive steps (commands, edits, tool calls, thoughts) as one
  // unit, under a one-line summary ("Ran 3 commands · 2 edits · 4 thoughts"). While the turn runs the
  // group stays open, so the step in flight is in view, and a pulsing dot marks
  // it; once the turn settles it closes to the summary, which opens back to the
  // steps. A single step needs no group and renders as its own row.
  //
  // The history is bounded (plans/046): a page brings a settled run as ONE
  // summary (`WorkRunSegment`: its counts and its last step), and a live turn
  // streams each step as a preview. The header adds both up. Opening a settled
  // group reads its runs' steps (`turn/steps`), and draws them a window at a
  // time — a run of hundreds of steps opens as fast as one of ten, the rest a
  // click away (the bridge serves them in pages of its byte budget, read as
  // they are needed). A live group that began before this window read the
  // turn shows that run's latest step, with its earlier ones a click away.
  import { untrack } from "svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
  import { isWorkRunSegment, type WorkRunSegment } from "$shared/models/history";
  import ChatActivity from "./ChatActivity.svelte";
  import ChatOnDemand from "./ChatOnDemand.svelte";
  import type { Conversation } from "$lib/bridge/conversation.svelte";
  import { lastStepOf, runSize, summarizeWork, type WorkPart } from "$lib/bridge/timeline";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon } from "$lib/design";
  import ChatWorkingGlyph from "./ChatWorkingGlyph.svelte";

  /** How many steps of a run one reveal draws. */
  const STEP_WINDOW = 100;

  let {
    parts,
    live = false,
    liveThought,
    turnId,
    conversation,
  }: {
    parts: WorkPart[];
    live?: boolean;
    /** The thought the agent is writing now (its turn's last part), if any. */
    liveThought?: Record<string, unknown>;
    /** The turn the steps belong to, and the conversation that reads them. */
    turnId: string;
    conversation: Conversation;
  } = $props();

  let open = $state(untrack(() => live));
  // Close once the turn settles: what is left to read is the summary.
  $effect(() => {
    if (!live) open = false;
  });

  const summary = $derived(summarizeWork(parts));
  const runs = $derived(parts.filter(isWorkRunSegment));
  /** The one step of a group of one: a lone step, or a run of one. */
  const only = $derived.by(() => {
    if (summary.steps !== 1 || parts.length !== 1) return undefined;
    const part = parts[0];
    return isWorkRunSegment(part) ? part.last : part;
  });
  /** Whether [step] is the thought being written — by identity, or by its
   *  stored index when it came back from `turn/steps`. */
  function writing(step: unknown): boolean {
    if (!live || !liveThought || !step || typeof step !== "object") return false;
    const index = (step as Record<string, unknown>).index;
    return step === liveThought || (typeof index === "number" && index === liveThought.index);
  }
  const inFlight = $derived(
    live && (summary.running > 0 || (!!liveThought && parts.some((p) => writing(lastStepOf(p))))),
  );
  const label = $derived(
    [
      summary.commands && i18n.plural(summary.commands, "chat.workCommandsOne", "chat.workCommands"),
      summary.edits && i18n.plural(summary.edits, "chat.workEditsOne", "chat.workEdits"),
      summary.tools && i18n.plural(summary.tools, "chat.workToolsOne", "chat.workTools"),
      summary.thoughts && i18n.plural(summary.thoughts, "chat.workThoughtsOne", "chat.workThoughts"),
    ]
      .filter((p): p is string => typeof p === "string")
      .join(" · "),
  );

  /** How many of each run's steps are drawn, by the run's first index. */
  let shown = $state<Record<number, number>>({});

  // A settled group the user opens reads its runs' steps. A live one does not
  // by itself: it is open because it runs, and its earlier steps wait for a click.
  $effect(() => {
    if (!open || live) return;
    for (const run of runs) untrack(() => void conversation.loadSteps(turnId, run));
  });

  /** Draw the next window of [run]'s steps, reading the page they are on.
   *  (What is left to draw counts what the bridge served once every page is
   *  read, and the run's own count until then.) */
  function more(run: WorkRunSegment, retry: boolean) {
    const read = conversation.stepRun(turnId, run);
    const want = read && read.steps.length > 0 ? (shown[run.from] ?? STEP_WINDOW) + STEP_WINDOW : STEP_WINDOW;
    shown = { ...shown, [run.from]: want };
    if (retry || !read || (read.steps.length < want && read.next !== undefined)) {
      void conversation.loadSteps(turnId, run, retry);
    }
  }
</script>

{#snippet runSteps(run: WorkRunSegment)}
  {@const read = conversation.stepRun(turnId, run)}
  {@const count = Math.min(shown[run.from] ?? STEP_WINDOW, read?.steps.length ?? 0)}
  {#if read && read.steps.length > 0}
    {#each read.steps.slice(0, count) as step (step.index)}
      <ChatActivity block={step} {live} writing={writing(step)} {turnId} {conversation} />
    {/each}
  {/if}
  {#if !read && live}
    {#if runSize(run) > 1}
      <ChatOnDemand
        detail={undefined}
        label={i18n.plural(runSize(run) - 1, "chat.earlierStepsOne", "chat.earlierSteps")}
        onload={(retry) => more(run, retry)}
      />
    {/if}
    <ChatActivity block={run.last} {live} writing={writing(run.last)} {turnId} {conversation} />
  {:else}
    {@const total =
      read && !read.loading && read.error === undefined && read.next === undefined ? read.steps.length : runSize(run)}
    {@const left = total - count}
    <ChatOnDemand
      detail={read ?? { loading: true }}
      label={left > 0
        ? i18n.plural(Math.min(left, STEP_WINDOW), "chat.moreStepsOne", "chat.moreSteps")
        : undefined}
      onload={(retry) => more(run, retry)}
    />
  {/if}
{/snippet}

{#if only}
  <ChatActivity block={only} {live} writing={writing(only)} {turnId} {conversation} />
{:else}
  <Collapsible.Root bind:open>
    <Collapsible.Trigger class={chat.activity}>
      <Icon icon={Layers01Icon} class={cn(icon.decorative, "shrink-0 opacity-70")} />
      <span class="min-w-0 flex-1 truncate">{label}</span>
      {#if inFlight}
        <ChatWorkingGlyph />
      {:else if summary.failed > 0}
        <span class="shrink-0 text-destructive">
          {i18n.plural(summary.failed, "chat.workFailedOne", "chat.workFailed")}
        </span>
      {/if}
      <Icon
        icon={ArrowRight01Icon}
        class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90")}
      />
    </Collapsible.Trigger>
    <Collapsible.Content>
      <div class={chat.activityList}>
        {#each parts as part, i (i)}
          {#if isWorkRunSegment(part)}
            {@render runSteps(part)}
          {:else}
            <ChatActivity block={part} {live} writing={writing(part)} {turnId} {conversation} />
          {/if}
        {/each}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>
{/if}
