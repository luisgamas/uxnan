<script lang="ts">
  // An approval or a question the agent put to the user — the part of a turn
  // that waits on a person. Answered here it settles at once; answered on the
  // phone (or timed out) the bridge's `stream/approval|question/resolved`
  // settles it here too.
  //
  // Two faces: the full card, pinned above the composer while it is open (the
  // chat's request dock), and a `compact` one-line record in the timeline that
  // says what was asked and how it ended.
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import ShieldKeyIcon from "@hugeicons/core-free-icons/ShieldKeyIcon";
  import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
  import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
  import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
  import type { ApprovalDecision } from "$shared/models/approval";
  import { chat as chatStore } from "$lib/bridge/chat.svelte";
  import type { Conversation } from "$lib/bridge/conversation.svelte";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, row, text } from "$lib/design";

  let {
    block,
    threadId,
    conversation,
    live = true,
    compact = false,
  }: {
    block: Record<string, unknown>;
    threadId: string;
    conversation: Conversation;
    /** The request's turn is still running. One in a turn that ended is
     *  settled whatever this window saw — without this, a card answered while
     *  the tab was closed would offer its buttons again. */
    live?: boolean;
    /** The timeline's one-line record instead of the answerable card. */
    compact?: boolean;
  } = $props();

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const type = $derived(str(block.type));
  /** Payloads arrive flat or nested under `request`. */
  const req = $derived(
    block.request && typeof block.request === "object"
      ? (block.request as Record<string, unknown>)
      : block,
  );

  // --- approvals -----------------------------------------------------------
  const approvalId = $derived(str(req.approvalId));
  const approvalOutcome = $derived(approvalId ? conversation.approvals[approvalId] : undefined);
  /** Which action is in flight, so only its button shows the spinner. */
  let answering = $state<string | null>(null);

  async function decide(decision: ApprovalDecision) {
    answering = decision;
    try {
      await chatStore.answerApproval(threadId, approvalId, decision);
    } catch (err) {
      toastError(err);
    } finally {
      answering = null;
    }
  }

  // --- questions -----------------------------------------------------------
  interface QuestionView {
    question: string;
    header: string;
    multiple: boolean;
    options: { label: string; description: string }[];
  }
  const questionId = $derived(str(req.questionId));
  const questions = $derived.by<QuestionView[]>(() => {
    const raw = Array.isArray(req.questions) ? req.questions : [];
    return raw
      .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
      .map((q) => ({
        question: str(q.question),
        header: str(q.header),
        multiple: q.multiple === true,
        options: (Array.isArray(q.options) ? q.options : [])
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map((o) => ({ label: str(o.label), description: str(o.description) })),
      }));
  });
  const questionOutcome = $derived(questionId ? conversation.questions[questionId] : undefined);
  let picks = $state<string[][]>([]);
  $effect(() => {
    if (picks.length !== questions.length) picks = questions.map(() => []);
  });

  function toggle(qi: number, label: string, multiple: boolean) {
    const current = picks[qi] ?? [];
    const next = multiple
      ? current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label]
      : [label];
    picks = picks.map((p, i) => (i === qi ? next : p));
  }

  async function answer(skip: boolean) {
    answering = skip ? "skip" : "submit";
    try {
      await chatStore.answerQuestion(threadId, questionId, skip ? questions.map(() => []) : picks);
    } catch (err) {
      toastError(err);
    } finally {
      answering = null;
    }
  }
</script>

{#snippet actionButton(
  id: string,
  label: string,
  variant: "default" | "outline" | "ghost",
  run: () => void,
)}
  <Button size="sm" {variant} disabled={answering !== null} onclick={run}>
    {#if answering === id}
      <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
    {/if}
    {label}
  </Button>
{/snippet}

{#if compact}
  {@const outcome = type === "approval" ? approvalOutcome : questionOutcome}
  <div class={cn(chat.activity, "cursor-default hover:bg-transparent hover:text-muted-foreground")}>
    <Icon
      icon={type === "approval" ? ShieldKeyIcon : HelpCircleIcon}
      class={cn(
        icon.decorative,
        "shrink-0",
        type === "approval" ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400",
      )}
    />
    <span class="min-w-0 flex-1 truncate text-foreground/80">
      {type === "approval" ? str(req.action) : (questions[0]?.question ?? "")}
    </span>
    <span class={cn(text.indicator, "shrink-0", !outcome && live && "text-amber-700 dark:text-amber-300")}>
      {#if approvalOutcome}
        {approvalOutcome.timedOut
          ? i18n.t("chat.approvalTimedOut")
          : i18n.t(`chat.approvalDecision.${approvalOutcome.decision}`)}
      {:else if questionOutcome}
        {questionOutcome.timedOut
          ? i18n.t("chat.questionTimedOut")
          : questionOutcome.answers.flat().join(", ") || i18n.t("chat.questionSkipped")}
      {:else if live}
        {i18n.t("chat.waitingForYou")}
      {:else}
        {i18n.t("chat.noLongerPending")}
      {/if}
    </span>
  </div>
{:else}
  {#if type === "approval" && approvalId}
    <div class={cn(chat.card, "my-1 flex flex-col gap-2.5")}>
      <div class="flex items-start gap-2">
        <Icon
          icon={ShieldKeyIcon}
          class={cn(icon.nav, "mt-0.5 shrink-0 text-amber-600 dark:text-amber-400")}
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <div class="flex items-start gap-2">
            <span class={cn(text.bodyStrong, "min-w-0 flex-1")}>{str(req.action)}</span>
            {#if str(req.risk) === "high"}
              <Badge variant="destructive">{i18n.t("chat.riskHigh")}</Badge>
            {/if}
          </div>
          {#if str(req.detail)}
            <code class="break-all rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]"
              >{str(req.detail)}</code
            >
          {/if}
        </div>
      </div>
      {#if !approvalOutcome && !live}
        <p class={text.meta}>{i18n.t("chat.noLongerPending")}</p>
      {:else if approvalOutcome}
        <p class={cn(text.meta, "flex items-center gap-1")}>
          <Icon
            icon={approvalOutcome.decision === "reject" ? Cancel01Icon : Tick02Icon}
            class={icon.status}
          />
          {approvalOutcome.timedOut
            ? i18n.t("chat.approvalTimedOut")
            : i18n.t(`chat.approvalDecision.${approvalOutcome.decision}`)}
        </p>
      {:else}
        <div class="flex flex-wrap justify-end gap-1.5">
          {@render actionButton("reject", i18n.t("chat.reject"), "ghost", () => void decide("reject"))}
          {@render actionButton("approveSession", i18n.t("chat.approveSession"), "outline", () =>
            void decide("approveSession"),
          )}
          {@render actionButton("approve", i18n.t("chat.approve"), "default", () =>
            void decide("approve"),
          )}
        </div>
      {/if}
    </div>
  {:else if type === "question" && questionId}
    <div class={cn(chat.card, "my-1 flex flex-col gap-3")}>
      {#each questions as q, qi (qi)}
        <div class="flex flex-col gap-1.5">
          <div class="flex items-start gap-2">
            <Icon
              icon={HelpCircleIcon}
              class={cn(icon.nav, "mt-0.5 shrink-0 text-sky-600 dark:text-sky-400")}
            />
            <div class="flex min-w-0 flex-col">
              {#if q.header}<span class={text.menuLabel}>{q.header}</span>{/if}
              <span class={text.bodyStrong}>{q.question}</span>
            </div>
          </div>
          {#if !questionOutcome && !live}
            <p class={cn(text.meta, "pl-6")}>{i18n.t("chat.noLongerPending")}</p>
          {:else if questionOutcome}
            {@const chosen = questionOutcome.answers[qi] ?? []}
            <p class={cn(text.meta, "pl-6")}>
              {chosen.length > 0 ? chosen.join(", ") : i18n.t("chat.questionSkipped")}
            </p>
          {:else}
            <div class="flex flex-col overflow-hidden rounded-md border border-border/60">
              {#each q.options as option (option.label)}
                {@const selected = (picks[qi] ?? []).includes(option.label)}
                <button
                  type="button"
                  class={cn(
                    row.choice,
                    selected ? row.choiceActive : row.choiceInactive,
                    "flex-col items-start gap-0.5",
                  )}
                  aria-pressed={selected}
                  onclick={() => toggle(qi, option.label, q.multiple)}
                >
                  <span>{option.label}</span>
                  {#if option.description}<span class={text.meta}>{option.description}</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if questionOutcome?.timedOut}
        <p class={text.meta}>{i18n.t("chat.questionTimedOut")}</p>
      {:else if !questionOutcome && live}
        <div class="flex justify-end gap-1.5">
          {@render actionButton("skip", i18n.t("chat.skip"), "ghost", () => void answer(true))}
          <Button
            size="sm"
            disabled={answering !== null || picks.every((p) => p.length === 0)}
            onclick={() => void answer(false)}
          >
            {#if answering === "submit"}
              <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {/if}
            {i18n.t("chat.submit")}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
{/if}
