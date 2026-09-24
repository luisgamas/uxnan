<script lang="ts">
  // One structured block of an agent's turn — what the phone calls a content
  // block (`MessageContent`). This dispatches it to its face:
  //
  //  - a step of work (a command, an edit, a tool call, a subagent) → `ChatActivity`
  //  - an approval or a question → `ChatRequest` (a card, or in the timeline
  //    a one-line record while the card waits above the composer)
  //  - a plan, a notice, a code block, an image, a compaction marker → drawn here
  //
  // Everything the bridge sends crosses a process boundary, so every field is
  // read defensively; an unknown block type renders nothing rather than
  // breaking the turn (the bridge may add kinds this build does not know).
  import { Icon } from "$lib/components/ui/icon";
  import TaskDone01Icon from "@hugeicons/core-free-icons/TaskDone01Icon";
  import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
  import ChatActivity from "./ChatActivity.svelte";
  import ChatRequest from "./ChatRequest.svelte";
  import type { Conversation } from "$lib/bridge/conversation.svelte";
  import { isActivity } from "$lib/bridge/timeline";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    block,
    threadId,
    conversation,
    live = true,
    compact = false,
  }: {
    block: unknown;
    threadId: string;
    conversation: Conversation;
    /** The block's turn is still running (see `ChatRequest`). */
    live?: boolean;
    /** Approvals and questions as their one-line timeline record. */
    compact?: boolean;
  } = $props();

  const b = $derived(
    block && typeof block === "object"
      ? (block as Record<string, unknown>)
      : ({} as Record<string, unknown>),
  );
  const type = $derived(typeof b.type === "string" ? b.type : "");
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const req = $derived(
    b.request && typeof b.request === "object" ? (b.request as Record<string, unknown>) : b,
  );

  // --- plan ----------------------------------------------------------------
  const blockState = $derived(
    b.state && typeof b.state === "object" ? (b.state as Record<string, unknown>) : {},
  );
  const steps = $derived(
    (Array.isArray(blockState.steps) ? blockState.steps : [])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({ text: str(s.description) || str(s.text), status: str(s.status) })),
  );
</script>

{#if isActivity(b)}
  <ChatActivity block={b} />
{:else if (type === "approval" && str(req.approvalId)) || (type === "question" && str(req.questionId))}
  <ChatRequest block={b} {threadId} {conversation} {live} {compact} />
{:else if type === "plan" && steps.length > 0}
  <div class={cn(chat.card, "my-1")}>
    <div class="mb-1.5 flex items-center gap-1.5">
      <Icon icon={TaskDone01Icon} class={cn(icon.decorative, "text-muted-foreground")} />
      <span class={text.menuLabel}>{str(blockState.title) || i18n.t("chat.plan")}</span>
    </div>
    <ul class="flex flex-col gap-1">
      {#each steps as step, i (i)}
        <li class={cn(text.body, "flex items-start gap-2")}>
          <span
            class={cn(
              "mt-1.5 size-2 shrink-0 rounded-full border",
              step.status === "completed" && "border-emerald-500 bg-emerald-500",
              step.status === "in_progress" && "border-sky-500 bg-sky-500/40",
              step.status !== "completed" &&
                step.status !== "in_progress" &&
                "border-muted-foreground/50",
            )}
          ></span>
          <span class={cn(step.status === "completed" && "text-muted-foreground line-through")}>
            {step.text}
          </span>
        </li>
      {/each}
    </ul>
  </div>
{:else if type === "system" && str(b.text)}
  {@const kind = str(b.kind)}
  <div
    class={cn(
      "my-1 flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs",
      kind === "error" && "bg-destructive/10 text-destructive",
      kind === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      kind !== "error" && kind !== "warning" && "bg-muted/60 text-muted-foreground",
    )}
  >
    <Icon icon={Alert02Icon} class={cn(icon.decorative, "mt-0.5 shrink-0")} />
    <span class="min-w-0 whitespace-pre-wrap break-words">{str(b.text)}</span>
  </div>
{:else if type === "code" && str(b.code)}
  <pre class={cn(chat.output, "my-1 max-h-80 whitespace-pre break-normal")}>{str(b.code)}</pre>
{:else if type === "image" && str(b.base64Data) && str(b.mimeType).startsWith("image/")}
  <img
    src={`data:${str(b.mimeType)};base64,${str(b.base64Data)}`}
    alt=""
    class="my-1 max-h-72 max-w-full rounded-md border border-border/50"
  />
{:else if type === "compaction"}
  <div class={cn(text.meta, "my-2 flex items-center gap-2")}>
    <span class="h-px flex-1 bg-border/70"></span>
    {i18n.t("chat.compacted")}
    <span class="h-px flex-1 bg-border/70"></span>
  </div>
{/if}
