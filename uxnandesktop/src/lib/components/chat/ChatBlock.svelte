<script lang="ts">
  // One structured block of an agent's turn — what the phone calls a content
  // block (`MessageContent`): a command it ran, a file it changed, a tool call,
  // its plan, an approval it asks for, a question it puts to the user.
  //
  // Everything the bridge sends crosses a process boundary, so every field is
  // read defensively; an unknown block type renders nothing rather than
  // breaking the turn (the bridge may add kinds this build does not know).
  //
  // Approvals and questions are live: answered here they settle at once; when
  // another client answers (or they time out), the bridge's
  // `stream/approval|question/resolved` settles this card too.
  //
  // Composed from the shared primitives: `Collapsible` for the work log,
  // `DiffView` for a changed file, `Badge` for small states, `Button` with the
  // async-feedback `Spinner` for the card actions (docs/design-tokens.md).
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import { Spinner } from "$lib/components/ui/spinner";
  import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
  import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
  import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon";
  import ShieldKeyIcon from "@hugeicons/core-free-icons/ShieldKeyIcon";
  import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
  import TaskDone01Icon from "@hugeicons/core-free-icons/TaskDone01Icon";
  import UserMultipleIcon from "@hugeicons/core-free-icons/UserMultipleIcon";
  import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
  import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
  import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
  import type { ApprovalDecision } from "$shared/models/approval";
  import DiffView from "$lib/components/DiffView.svelte";
  import { chat as chatStore } from "$lib/bridge/chat.svelte";
  import type { Conversation } from "$lib/bridge/conversation.svelte";
  import { toUnifiedPatch } from "$lib/bridge/diffPatch";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { chat, icon, row, text } from "$lib/design";

  let {
    block,
    threadId,
    conversation,
    live = true,
  }: {
    block: unknown;
    threadId: string;
    conversation: Conversation;
    /** The block's turn is still running. An approval or question in a turn
     *  that ended is settled whatever this window saw — without this, a card
     *  answered while the tab was closed would offer its buttons again. */
    live?: boolean;
  } = $props();

  const b = $derived(
    block && typeof block === "object"
      ? (block as Record<string, unknown>)
      : ({} as Record<string, unknown>),
  );
  const type = $derived(typeof b.type === "string" ? b.type : "");
  let open = $state(false);

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  /** Approval/question payloads arrive flat or nested under `request`. */
  const req = $derived(
    b.request && typeof b.request === "object" ? (b.request as Record<string, unknown>) : b,
  );

  // --- tool summary --------------------------------------------------------
  function toolSummary(input: unknown): string {
    if (!input || typeof input !== "object") return "";
    const i = input as Record<string, unknown>;
    for (const key of ["command", "file_path", "path", "url", "pattern", "query", "description"]) {
      if (typeof i[key] === "string" && (i[key] as string).length > 0) return i[key] as string;
    }
    return "";
  }

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

  // --- diffs ---------------------------------------------------------------
  const patch = $derived(type === "diff" ? toUnifiedPatch(str(b.filename), str(b.diff)) : null);

  // --- plan / subagent -----------------------------------------------------
  const blockState = $derived(
    b.state && typeof b.state === "object" ? (b.state as Record<string, unknown>) : {},
  );
  const steps = $derived(
    (Array.isArray(blockState.steps) ? blockState.steps : [])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({ text: str(s.description) || str(s.text), status: str(s.status) })),
  );
</script>

{#snippet chevron(expandable: boolean)}
  <Icon
    icon={ArrowRight01Icon}
    class={cn(
      icon.status,
      "shrink-0 transition-transform",
      open && "rotate-90",
      !expandable && "invisible",
    )}
  />
{/snippet}

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

{#if type === "command_execution"}
  {@const status = str(b.status)}
  {@const exit = num(b.exitCode)}
  {@const output = str(b.output)}
  <Collapsible.Root bind:open>
    <Collapsible.Trigger class={chat.activity} disabled={!output}>
      {@render chevron(!!output)}
      <Icon icon={CommandLineIcon} class={cn(icon.decorative, "shrink-0")} />
      <span class="min-w-0 flex-1 truncate font-mono">{str(b.command)}</span>
      {#if status === "running"}
        <Spinner class={icon.status} aria-label={i18n.t("chat.working")} />
      {:else if status === "error" || (exit !== null && exit !== 0)}
        <Badge variant="destructive">
          {exit !== null ? i18n.t("chat.exitCode", { code: String(exit) }) : i18n.t("chat.failed")}
        </Badge>
      {/if}
    </Collapsible.Trigger>
    <Collapsible.Content>
      <pre class={cn(chat.output, "mx-2 mt-1")}>{output}</pre>
    </Collapsible.Content>
  </Collapsible.Root>
{:else if type === "diff"}
  <Collapsible.Root bind:open>
    <Collapsible.Trigger class={chat.activity} disabled={!patch}>
      {@render chevron(!!patch)}
      <Icon icon={FileEditIcon} class={cn(icon.decorative, "shrink-0")} />
      <span class="min-w-0 flex-1 truncate font-mono">{str(b.filename)}</span>
      <span class={cn(text.indicator, "shrink-0 font-mono text-emerald-600 dark:text-emerald-400")}>
        +{num(b.additions) ?? 0}
      </span>
      <span class={cn(text.indicator, "shrink-0 font-mono text-red-600 dark:text-red-400")}>
        −{num(b.deletions) ?? 0}
      </span>
    </Collapsible.Trigger>
    <Collapsible.Content>
      {#if patch}
        <div class="mx-2 mt-1 h-72 overflow-hidden rounded-md border border-border/60">
          <DiffView diff={patch} />
        </div>
      {/if}
    </Collapsible.Content>
  </Collapsible.Root>
{:else if type === "tool"}
  {@const summary = toolSummary(b.input)}
  {@const output = str(b.output)}
  <Collapsible.Root bind:open>
    <Collapsible.Trigger class={chat.activity} disabled={!output}>
      {@render chevron(!!output)}
      <Icon icon={Wrench01Icon} class={cn(icon.decorative, "shrink-0")} />
      <span class="shrink-0 font-medium">{str(b.toolName)}</span>
      {#if summary}<span class="min-w-0 flex-1 truncate font-mono">{summary}</span>{/if}
      {#if b.isError === true}
        <Badge variant="destructive">{i18n.t("chat.failed")}</Badge>
      {/if}
    </Collapsible.Trigger>
    <Collapsible.Content>
      <pre class={cn(chat.output, "mx-2 mt-1")}>{output}</pre>
    </Collapsible.Content>
  </Collapsible.Root>
{:else if type === "approval" && approvalId}
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
{:else if type === "subagent"}
  <div class={cn(chat.activity, "cursor-default hover:bg-transparent hover:text-muted-foreground")}>
    <Icon icon={ArrowRight01Icon} class={cn(icon.status, "invisible shrink-0")} />
    <Icon icon={UserMultipleIcon} class={cn(icon.decorative, "shrink-0")} />
    <span class="min-w-0 flex-1 truncate">{str(blockState.name) || i18n.t("chat.subagent")}</span>
    {#if str(blockState.status)}<Badge variant="secondary">{str(blockState.status)}</Badge>{/if}
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
