<script lang="ts">
  // The values a step's prompt can carry, offered where the prompt is written.
  //
  // `{{steps.s1.output}}` is invisible knowledge: nobody discovers it by looking
  // at a text box. So every value this automation can plant is listed here in
  // plain language, one click away, next to the field it goes into — the same
  // idea as the orchestration console's context picker, with the variables that
  // exist on this side.
  //
  // Inserting a value from an earlier step also makes this step **wait** for it,
  // because a prompt that quotes a step it does not depend on is the classic way
  // to end up with an empty hand-off.
  import { untrack } from "svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import type { Step } from "$lib/automations/types";
  import { Button } from "$lib/components/ui/button";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CornerDownLeftIcon from "@lucide/svelte/icons/corner-down-left";

  let {
    step,
    earlier,
    all,
    oninsert,
  }: {
    /** The step being edited. */
    step: Step;
    /** Steps declared before it — the only ones it can wait for. */
    earlier: Step[];
    /** Every step, for previous-run values (which need no dependency). */
    all: Step[];
    /** Insert `token` at the cursor; `dependsOn` is the step to start waiting for. */
    oninsert: (token: string, dependsOn?: string) => void;
  } = $props();

  /** Which group is expanded. Only the *initial* choice depends on whether
   *  there are earlier steps — after that it is the user's, so adding a step
   *  must not reopen a group they closed. */
  let openGroup = $state<string | null>(
    untrack(() => (earlier.length > 0 ? "steps" : "run")),
  );
  function toggle(id: string) {
    openGroup = openGroup === id ? null : id;
  }

  function label(s: Step): string {
    return s.title.trim() || s.id;
  }

  // The run-level group sits outside any block, so its open state is derived
  // here rather than with an inline `{@const}`.
  const runOpen = $derived(openGroup === "run");
</script>

<div class="flex flex-col gap-1">
  <span class={text.section}>{i18n.t("automations.varTitle")}</span>
  <p class={text.meta}>{i18n.t("automations.varIntro")}</p>

  <div class="mt-1 flex flex-col gap-1">
    <!-- Values produced earlier in this same run. -->
    {#if earlier.length > 0}
      {@const isOpen = openGroup === "steps"}
      <div class="overflow-hidden rounded-md border border-border/60 bg-background">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
          onclick={() => toggle("steps")}
        >
          <ChevronRightIcon
            class={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <span class={cn("min-w-0 flex-1", text.body)}>{i18n.t("automations.varFromStep")}</span>
          <span class={text.meta}>{earlier.length}</span>
        </button>
        {#if isOpen}
          <div class="flex flex-col border-t border-border/50">
            {#each earlier as s (s.id)}
              {@const waits = step.dependsOn.includes(s.id)}
              <div class="flex items-start gap-2 px-2 py-1.5">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <code class="rounded bg-muted px-1 py-px text-[10px] text-foreground">
                      {s.id}
                    </code>
                    <span class={cn("min-w-0 truncate", text.body)}>{label(s)}</span>
                  </div>
                  <div class={cn("mt-0.5", text.meta)}>
                    {i18n.t("automations.varStepOutputDesc", { title: label(s) })}
                  </div>
                  {#if !waits}
                    <div class={cn("mt-0.5", text.meta)}>
                      {i18n.t("automations.varWillWait", { id: s.id })}
                    </div>
                  {/if}
                </div>
                <div class="flex shrink-0 flex-col gap-1">
                  <TooltipSimple title={`{{steps.${s.id}.output}}`}>
                    {#snippet children(tp)}
                      <Button
                        {...tp}
                        variant="outline"
                        size="sm"
                        class="h-6 px-2 text-[11px]"
                        onclick={() => oninsert(`{{steps.${s.id}.output}}`, s.id)}
                      >
                        <CornerDownLeftIcon class="mr-1 size-3" />
                        {i18n.t("automations.varItsAnswer")}
                      </Button>
                    {/snippet}
                  </TooltipSimple>
                  <TooltipSimple title={`{{steps.${s.id}.title}}`}>
                    {#snippet children(tp)}
                      <Button
                        {...tp}
                        variant="ghost"
                        size="sm"
                        class="h-6 px-2 text-[11px]"
                        onclick={() => oninsert(`{{steps.${s.id}.title}}`, s.id)}
                      >
                        {i18n.t("automations.varItsName")}
                      </Button>
                    {/snippet}
                  </TooltipSimple>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Values from the previous run: available to any step, including the
         first, and never a dependency — they come from a run that already
         finished. -->
    {#if all.length > 0}
      {@const isOpen = openGroup === "prev"}
      <div class="overflow-hidden rounded-md border border-border/60 bg-background">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
          onclick={() => toggle("prev")}
        >
          <ChevronRightIcon
            class={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
          />
          <span class={cn("min-w-0 flex-1", text.body)}>{i18n.t("automations.varFromPrev")}</span>
        </button>
        {#if isOpen}
          <div class="flex flex-col border-t border-border/50">
            <p class={cn("px-2 pt-1.5", text.meta)}>{i18n.t("automations.varPrevIntro")}</p>
            {#each all as s (s.id)}
              <div class="flex items-start gap-2 px-2 py-1.5">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <code class="rounded bg-muted px-1 py-px text-[10px] text-foreground">
                      {s.id}
                    </code>
                    <span class={cn("min-w-0 truncate", text.body)}>{label(s)}</span>
                  </div>
                  <div class={cn("mt-0.5", text.meta)}>
                    {i18n.t("automations.varPrevOutputDesc", { title: label(s) })}
                  </div>
                </div>
                <TooltipSimple title={`{{prev.${s.id}.output}}`}>
                  {#snippet children(tp)}
                    <Button
                      {...tp}
                      variant="outline"
                      size="sm"
                      class="h-6 shrink-0 px-2 text-[11px]"
                      onclick={() => oninsert(`{{prev.${s.id}.output}}`)}
                    >
                      <CornerDownLeftIcon class="mr-1 size-3" />
                      {i18n.t("automations.varInsert")}
                    </Button>
                  {/snippet}
                </TooltipSimple>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Values about the run itself. -->
    <div class="overflow-hidden rounded-md border border-border/60 bg-background">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
        onclick={() => toggle("run")}
      >
        <ChevronRightIcon
          class={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            runOpen && "rotate-90",
          )}
        />
        <span class={cn("min-w-0 flex-1", text.body)}>{i18n.t("automations.varAboutRun")}</span>
      </button>
      {#if runOpen}
        <div class="flex items-start gap-2 border-t border-border/50 px-2 py-1.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <code class="rounded bg-muted px-1 py-px text-[10px] text-foreground">
                workingDir
              </code>
            </div>
            <div class={cn("mt-0.5", text.meta)}>{i18n.t("automations.varWorkingDirDesc")}</div>
          </div>
          <TooltipSimple title={"{{workingDir}}"}>
            {#snippet children(tp)}
              <Button
                {...tp}
                variant="outline"
                size="sm"
                class="h-6 shrink-0 px-2 text-[11px]"
                onclick={() => oninsert("{{workingDir}}")}
              >
                <CornerDownLeftIcon class="mr-1 size-3" />
                {i18n.t("automations.varInsert")}
              </Button>
            {/snippet}
          </TooltipSimple>
        </div>
      {/if}
    </div>
  </div>
</div>
