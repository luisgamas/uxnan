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
  import { chat } from "$lib/bridge/chat.svelte";
  import type { Conversation } from "$lib/bridge/conversation.svelte";
  import { toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  let {
    block,
    threadId,
    conversation,
  }: {
    block: unknown;
    threadId: string;
    conversation: Conversation;
  } = $props();

  const b = $derived(
    block && typeof block === "object" ? (block as Record<string, unknown>) : ({} as Record<string, unknown>),
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
  let answering = $state(false);

  async function decide(decision: ApprovalDecision) {
    answering = true;
    try {
      await chat.answerApproval(threadId, approvalId, decision);
    } catch (err) {
      toastError(err);
    } finally {
      answering = false;
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
    answering = true;
    try {
      await chat.answerQuestion(threadId, questionId, skip ? questions.map(() => []) : picks);
    } catch (err) {
      toastError(err);
    } finally {
      answering = false;
    }
  }

  // --- diffs ---------------------------------------------------------------
  const diffLines = $derived(str(b.diff).split("\n").filter((l) => l.length > 0));

  // --- plan / subagent -----------------------------------------------------
  const blockState = $derived(
    b.state && typeof b.state === "object" ? (b.state as Record<string, unknown>) : {},
  );
  const steps = $derived(
    (Array.isArray(blockState.steps) ? blockState.steps : [])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({ text: str(s.description) || str(s.text), status: str(s.status) })),
  );

  const rowClass =
    "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground";
</script>

{#if type === "command_execution"}
  {@const status = str(b.status)}
  {@const exit = num(b.exitCode)}
  <div class="min-w-0">
    <button type="button" class={rowClass} onclick={() => (open = !open)} aria-expanded={open}>
      <Icon icon={ArrowRight01Icon} class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90")} />
      <Icon icon={CommandLineIcon} class={cn(icon.decorative, "shrink-0")} />
      <span class="min-w-0 flex-1 truncate font-mono">{str(b.command)}</span>
      {#if status === "running"}
        <Spinner class="size-3 shrink-0" />
      {:else if status === "error" || (exit !== null && exit !== 0)}
        <span class="shrink-0 text-[11px] text-destructive">
          {exit !== null ? i18n.t("chat.exitCode", { code: String(exit) }) : i18n.t("chat.failed")}
        </span>
      {/if}
    </button>
    {#if open && str(b.output)}
      <pre
        class="uxnan-scroll mx-2 mt-1 max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all">{str(b.output)}</pre>
    {/if}
  </div>
{:else if type === "diff"}
  {@const add = num(b.additions) ?? 0}
  {@const del = num(b.deletions) ?? 0}
  <div class="min-w-0">
    <button
      type="button"
      class={rowClass}
      onclick={() => (open = !open)}
      aria-expanded={open}
      disabled={diffLines.length === 0}
    >
      <Icon icon={ArrowRight01Icon} class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90", diffLines.length === 0 && "opacity-0")} />
      <Icon icon={FileEditIcon} class={cn(icon.decorative, "shrink-0")} />
      <span class="min-w-0 flex-1 truncate font-mono">{str(b.filename)}</span>
      <span class="shrink-0 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">+{add}</span>
      <span class="shrink-0 font-mono text-[11px] text-red-600 dark:text-red-400">−{del}</span>
    </button>
    {#if open}
      <div class="uxnan-scroll mx-2 mt-1 max-h-80 overflow-auto rounded-md border border-border/50 font-mono text-[11px] leading-4">
        {#each diffLines as line, i (i)}
          <div
            class={cn(
              "whitespace-pre px-2",
              line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              line.startsWith("-") && !line.startsWith("---") && "bg-red-500/10 text-red-700 dark:text-red-300",
              line.startsWith("@@") && "text-muted-foreground",
            )}
          >{line}</div>
        {/each}
      </div>
    {/if}
  </div>
{:else if type === "tool"}
  {@const summary = toolSummary(b.input)}
  <div class="min-w-0">
    <button
      type="button"
      class={rowClass}
      onclick={() => (open = !open)}
      aria-expanded={open}
      disabled={!str(b.output)}
    >
      <Icon icon={ArrowRight01Icon} class={cn(icon.status, "shrink-0 transition-transform", open && "rotate-90", !str(b.output) && "opacity-0")} />
      <Icon icon={Wrench01Icon} class={cn(icon.decorative, "shrink-0")} />
      <span class="shrink-0 font-medium">{str(b.toolName)}</span>
      {#if summary}<span class="min-w-0 flex-1 truncate font-mono">{summary}</span>{/if}
      {#if b.isError === true}
        <span class="shrink-0 text-[11px] text-destructive">{i18n.t("chat.failed")}</span>
      {/if}
    </button>
    {#if open && str(b.output)}
      <pre
        class="uxnan-scroll mx-2 mt-1 max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all">{str(b.output)}</pre>
    {/if}
  </div>
{:else if type === "approval" && approvalId}
  {@const risk = str(req.risk)}
  <div class="my-1 rounded-lg border border-border/70 bg-card p-3 shadow-xs">
    <div class="flex items-start gap-2">
      <Icon icon={ShieldKeyIcon} class={cn(icon.nav, "mt-0.5 shrink-0 text-amber-600 dark:text-amber-400")} />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class={text.bodyStrong}>{str(req.action)}</span>
        {#if str(req.detail)}
          <code class="break-all rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">{str(req.detail)}</code>
        {/if}
        {#if risk === "high"}
          <span class="text-[11px] text-destructive">{i18n.t("chat.riskHigh")}</span>
        {/if}
      </div>
    </div>
    {#if approvalOutcome}
      <p class={cn(text.meta, "mt-2 flex items-center gap-1")}>
        <Icon
          icon={approvalOutcome.decision === "reject" ? Cancel01Icon : Tick02Icon}
          class={icon.status}
        />
        {approvalOutcome.timedOut
          ? i18n.t("chat.approvalTimedOut")
          : i18n.t(`chat.approvalDecision.${approvalOutcome.decision}`)}
      </p>
    {:else}
      <div class="mt-2.5 flex flex-wrap justify-end gap-1.5">
        <Button size="xs" variant="ghost" disabled={answering} onclick={() => void decide("reject")}>
          {i18n.t("chat.reject")}
        </Button>
        <Button size="xs" variant="outline" disabled={answering} onclick={() => void decide("approveSession")}>
          {i18n.t("chat.approveSession")}
        </Button>
        <Button size="xs" disabled={answering} onclick={() => void decide("approve")}>
          {i18n.t("chat.approve")}
        </Button>
      </div>
    {/if}
  </div>
{:else if type === "question" && questionId}
  <div class="my-1 flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-3 shadow-xs">
    {#each questions as q, qi (qi)}
      <div class="flex flex-col gap-1.5">
        <div class="flex items-start gap-2">
          <Icon icon={HelpCircleIcon} class={cn(icon.nav, "mt-0.5 shrink-0 text-sky-600 dark:text-sky-400")} />
          <div class="flex min-w-0 flex-col">
            {#if q.header}<span class={text.menuLabel}>{q.header}</span>{/if}
            <span class={text.bodyStrong}>{q.question}</span>
          </div>
        </div>
        {#if questionOutcome}
          {@const chosen = questionOutcome.answers[qi] ?? []}
          <p class={cn(text.meta, "pl-6")}>
            {chosen.length > 0 ? chosen.join(", ") : i18n.t("chat.questionSkipped")}
          </p>
        {:else}
          <div class="flex flex-col gap-1 pl-6">
            {#each q.options as option (option.label)}
              {@const selected = (picks[qi] ?? []).includes(option.label)}
              <button
                type="button"
                class={cn(
                  "flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  selected
                    ? "border-ring/60 bg-accent text-accent-foreground"
                    : "border-border/60 hover:bg-foreground/[0.04]",
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
    {:else if !questionOutcome}
      <div class="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" disabled={answering} onclick={() => void answer(true)}>
          {i18n.t("chat.skip")}
        </Button>
        <Button
          size="xs"
          disabled={answering || picks.every((p) => p.length === 0)}
          onclick={() => void answer(false)}
        >
          {i18n.t("chat.submit")}
        </Button>
      </div>
    {/if}
  </div>
{:else if type === "plan" && steps.length > 0}
  <div class="my-1 rounded-lg border border-border/60 px-3 py-2">
    <div class="mb-1 flex items-center gap-1.5">
      <Icon icon={TaskDone01Icon} class={cn(icon.decorative, "text-muted-foreground")} />
      <span class={text.menuLabel}>{str(blockState.title) || i18n.t("chat.plan")}</span>
    </div>
    <ul class="flex flex-col gap-0.5">
      {#each steps as step, i (i)}
        <li class="flex items-start gap-2 text-[12px]">
          <span
            class={cn(
              "mt-1 size-2 shrink-0 rounded-full border",
              step.status === "completed" && "border-emerald-500 bg-emerald-500",
              step.status === "in_progress" && "border-sky-500 bg-sky-500/40",
              step.status !== "completed" && step.status !== "in_progress" && "border-muted-foreground/50",
            )}
          ></span>
          <span class={cn(step.status === "completed" && "text-muted-foreground line-through")}>{step.text}</span>
        </li>
      {/each}
    </ul>
  </div>
{:else if type === "subagent"}
  <div class={cn(rowClass, "cursor-default hover:bg-transparent")}>
    <Icon icon={UserMultipleIcon} class={cn(icon.decorative, "shrink-0")} />
    <span class="min-w-0 flex-1 truncate">{str(blockState.name) || i18n.t("chat.subagent")}</span>
    {#if str(blockState.status)}<span class="shrink-0 text-[11px]">{str(blockState.status)}</span>{/if}
  </div>
{:else if type === "system" && str(b.text)}
  {@const kind = str(b.kind)}
  <div
    class={cn(
      "my-1 flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[12px]",
      kind === "error" && "bg-destructive/10 text-destructive",
      kind === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      kind !== "error" && kind !== "warning" && "bg-muted/60 text-muted-foreground",
    )}
  >
    <Icon icon={Alert02Icon} class={cn(icon.decorative, "mt-0.5 shrink-0")} />
    <span class="min-w-0 break-words whitespace-pre-wrap">{str(b.text)}</span>
  </div>
{:else if type === "code" && str(b.code)}
  <pre
    class="uxnan-scroll my-1 max-h-80 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-4">{str(b.code)}</pre>
{:else if type === "image" && str(b.base64Data) && str(b.mimeType).startsWith("image/")}
  <img
    src={`data:${str(b.mimeType)};base64,${str(b.base64Data)}`}
    alt=""
    class="my-1 max-h-72 max-w-full rounded-md border border-border/50"
  />
{:else if type === "compaction"}
  <div class="my-2 flex items-center gap-2 text-[11px] text-muted-foreground">
    <span class="h-px flex-1 bg-border/70"></span>
    {i18n.t("chat.compacted")}
    <span class="h-px flex-1 bg-border/70"></span>
  </div>
{/if}
