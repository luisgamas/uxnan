<script lang="ts">
  // Contextual variable picker for the step editor. Lists the prior steps this one
  // can reference and, for each, its insertable fields — `output` / `summary` /
  // `title` — with a plain-language description and, once the step has run, a live
  // preview of the captured value (so you don't have to guess what `{{steps.s1.…}}`
  // holds). Clicking a field asks the editor to insert its token at the cursor and
  // add the dependency. Replaces the cryptic bare "insert output" chips.
  import { untrack } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RunStep } from "$lib/orchestration/run";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check-big";

  type Field = "output" | "summary" | "title";

  let {
    candidates,
    oninsert,
  }: {
    candidates: RunStep[];
    oninsert: (stepId: string, field: Field) => void;
  } = $props();

  const FIELDS: Field[] = ["output", "summary", "title"];

  // Expanded candidate rows (step ids). The most recent step opens by default so
  // the common "reference the previous step" case needs no click (initial only).
  let open = $state<Set<string>>(
    untrack(() => new Set(candidates.length ? [candidates[candidates.length - 1].id] : [])),
  );
  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    open = next;
  }

  function kindLabel(step: RunStep): string {
    if (step.kind === "headless") return i18n.t("orchestration.kindHeadless");
    if (step.kind === "gate") return i18n.t("orchestration.kindGate");
    return i18n.t("orchestration.kindInteractive");
  }

  function fieldLabel(f: Field): string {
    if (f === "output") return i18n.t("orchestration.varFieldOutput");
    if (f === "summary") return i18n.t("orchestration.varFieldSummary");
    return i18n.t("orchestration.varFieldTitle");
  }

  /** The captured value of a field, if the step already produced one. */
  function value(step: RunStep, f: Field): string | undefined {
    if (f === "title") return step.title || step.id;
    if (f === "output") return step.output?.trim() || undefined;
    return (step.summary ?? step.output)?.trim() || undefined;
  }

  /** One-line preview of a captured value (whitespace collapsed, truncated). */
  function preview(v: string): string {
    const line = v.replace(/\s+/g, " ").trim();
    return line.length > 140 ? `${line.slice(0, 137)}…` : line;
  }

  /** What a field *will* contain, for a step that hasn't produced output yet. */
  function hint(step: RunStep, f: Field): string {
    if (f === "title") return step.title || step.id;
    if (f === "summary") return i18n.t("orchestration.varSummaryHint");
    if (step.kind === "headless") return i18n.t("orchestration.varOutputHeadless");
    if (step.kind === "gate") return i18n.t("orchestration.varOutputGate");
    return i18n.t("orchestration.varOutputInteractive");
  }
</script>

<div class="flex flex-col gap-1">
  <span class={text.section}>{i18n.t("orchestration.insertContext")}</span>
  <div class="flex flex-col gap-1">
    {#each candidates as c, i (c.id)}
      {@const isOpen = open.has(c.id)}
      {@const ran = c.status === "completed"}
      <div class="overflow-hidden rounded-md border border-border/60 bg-background">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
          onclick={() => toggle(c.id)}
        >
          <ChevronRightIcon
            class={cn("size-3 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")}
          />
          <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">{i + 1}</span>
          <span class={cn("min-w-0 flex-1 truncate", text.body)}>{c.title || c.id}</span>
          {#if ran}
            <CircleCheckIcon class="size-3 shrink-0 text-emerald-500" />
          {/if}
          <span class={cn("shrink-0", text.meta)}>{kindLabel(c)}</span>
        </button>
        {#if isOpen}
          <div class="flex flex-col border-t border-border/50">
            {#each FIELDS as f (f)}
              {@const v = value(c, f)}
              <div class="flex items-start gap-2 px-2 py-1.5">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <code class="rounded bg-muted px-1 py-px text-[10px] text-foreground">{f}</code>
                    <span class={text.meta}>{fieldLabel(f)}</span>
                  </div>
                  <div
                    class={cn("mt-0.5 line-clamp-2", text.meta, !v && "italic text-muted-foreground/70")}
                  >
                    {v ? preview(v) : hint(c, f)}
                  </div>
                </div>
                <TooltipSimple title={`{{steps.${c.id}.${f}}}`}>
                  {#snippet children(tp)}
                    <Button
                      {...tp}
                      variant="outline"
                      size="sm"
                      class="h-6 shrink-0 px-2 text-[11px]"
                      onclick={() => oninsert(c.id, f)}
                    >
                      {i18n.t("orchestration.insert")}
                    </Button>
                  {/snippet}
                </TooltipSimple>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
