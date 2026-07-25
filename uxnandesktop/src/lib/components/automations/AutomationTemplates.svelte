<script lang="ts">
  // Ready-made **multi-agent** automations. Every one of these is impossible in
  // a "one agent, one prompt, one cron" design — that is the point of shipping
  // them: they teach the model of the feature by example, in one click.
  //
  // A template lands as a **paused** draft in the editor, so nothing starts
  // firing before the user has picked a folder and read what it will do.
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { panel, text } from "$lib/design";
  import { app } from "$lib/state/app.svelte";
  import { aiCommitAgents } from "$lib/api";
  import { newAutomation, newStep, type Automation, type Step } from "$lib/automations/types";
  import { automations } from "$lib/state/automations.svelte";
  import { Button } from "$lib/components/ui/button";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";

  let installed = $state<string[]>([]);
  $effect(() => {
    if (installed.length > 0) return;
    void aiCommitAgents()
      .then((a) => (installed = a))
      .catch(() => {});
  });

  /** Pick the nth distinct installed agent, wrapping — so a template really is
   *  multi-provider on a machine with two CLIs, not three copies of one. */
  function agentAt(i: number): string {
    if (installed.length === 0) return "";
    return installed[i % installed.length];
  }

  interface Template {
    id: string;
    titleKey: MessageKey;
    descKey: MessageKey;
    build: () => Step[];
  }

  const TEMPLATES: Template[] = [
    {
      id: "fan-in",
      titleKey: "automations.tplFanInTitle",
      descKey: "automations.tplFanInDesc",
      build: () => [
        { ...newStep("s1", agentAt(0)), title: i18n.t("automations.tplFanInS1"), prompt: i18n.t("automations.tplFanInS1Prompt") },
        { ...newStep("s2", agentAt(1)), title: i18n.t("automations.tplFanInS2"), prompt: i18n.t("automations.tplFanInS2Prompt") },
        {
          ...newStep("s3", agentAt(2)),
          title: i18n.t("automations.tplFanInS3"),
          prompt: i18n.t("automations.tplFanInS3Prompt"),
          dependsOn: ["s1", "s2"],
        },
      ],
    },
    {
      id: "consensus",
      titleKey: "automations.tplConsensusTitle",
      descKey: "automations.tplConsensusDesc",
      build: () => [
        { ...newStep("s1", agentAt(0)), title: i18n.t("automations.tplConsensusS1"), prompt: i18n.t("automations.tplConsensusPrompt") },
        { ...newStep("s2", agentAt(1)), title: i18n.t("automations.tplConsensusS2"), prompt: i18n.t("automations.tplConsensusPrompt") },
        {
          ...newStep("s3", agentAt(2)),
          title: i18n.t("automations.tplConsensusS3"),
          prompt: i18n.t("automations.tplConsensusJudge"),
          dependsOn: ["s1", "s2"],
        },
      ],
    },
    {
      id: "relay",
      titleKey: "automations.tplRelayTitle",
      descKey: "automations.tplRelayDesc",
      build: () => [
        {
          ...newStep("s1", agentAt(0)),
          title: i18n.t("automations.tplRelayS1"),
          prompt: i18n.t("automations.tplRelayPrompt"),
        },
      ],
    },
  ];

  function use(tpl: Template) {
    const draft: Automation = {
      ...newAutomation(crypto.randomUUID(), i18n.t(tpl.titleKey)),
      // Paused: a template must never start firing before it has been read.
      enabled: false,
      description: i18n.t(tpl.descKey),
      steps: tpl.build(),
    };
    automations.items = [...automations.items, draft];
    app.automationsSelectedId = draft.id;
    app.automationsSection = "list";
  }
</script>

<div class="flex flex-col gap-3">
  <p class={text.meta}>{i18n.t("automations.templatesDesc")}</p>
  {#each TEMPLATES as tpl (tpl.id)}
    <div class={cn("flex items-start gap-3 p-3.5", panel.card)}>
      <SparklesIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class={text.bodyStrong}>{i18n.t(tpl.titleKey)}</span>
        <span class={text.meta}>{i18n.t(tpl.descKey)}</span>
      </div>
      <Button variant="outline" size="sm" onclick={() => use(tpl)}>
        {i18n.t("automations.useTemplate")}
      </Button>
    </div>
  {/each}
</div>
