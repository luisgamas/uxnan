<script lang="ts">
  // The editor — a full page inside the section, never a dialog. Editing an
  // automation means reading its whole shape at once (folder, cadence, graph,
  // policy); a modal that covers the thing being edited would fight that.
  import { untrack } from "svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, icon, panel, text } from "$lib/design";
  import { automations } from "$lib/state/automations.svelte";
  import { aiCommitAgents } from "$lib/api";
  import type { Automation } from "$lib/automations/types";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import FolderSelectDialog from "$lib/components/FolderSelectDialog.svelte";
  import SchedulePicker from "./SchedulePicker.svelte";
  import StepGraphEditor from "./StepGraphEditor.svelte";
  import Combobox from "$lib/components/Combobox.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";

  let {
    automation,
    onback,
  }: { automation: Automation; onback: () => void } = $props();

  // A working copy, so an abandoned edit changes nothing. Deliberately taken
  // once: the draft is the user's in-progress edit, and re-syncing it to the
  // stored automation mid-edit would throw their typing away.
  let draft = $state<Automation>(
    untrack(() => structuredClone($state.snapshot(automation))),
  );
  let saving = $state(false);
  let folderOpen = $state(false);
  let tagsText = $state(draft.tags.join(", "));

  let installedAgents = $state<string[]>([]);
  $effect(() => {
    if (installedAgents.length > 0) return;
    void aiCommitAgents()
      .then((a) => (installedAgents = a))
      .catch(() => {});
  });

  const overlapGroups = $derived([
    {
      items: (["skip", "queue", "cancelPrevious"] as const).map((v) => ({
        value: v,
        label: i18n.t(`automations.overlap.${v}`),
      })),
    },
  ]);

  /** Everything wrong with the draft, mirroring the backend's own rules so the
   *  Save button can explain itself instead of failing on the round trip. */
  const problems = $derived.by(() => {
    const out: string[] = [];
    if (!draft.name.trim()) out.push(i18n.t("automations.errNoName"));
    if (!draft.workingDir.trim()) out.push(i18n.t("automations.errNoFolder"));
    if (draft.steps.length === 0) out.push(i18n.t("automations.errNoSteps"));
    for (const s of draft.steps) {
      if (!s.agent.trim()) out.push(i18n.t("automations.errStepAgent", { id: s.id }));
      if (!s.prompt.trim()) out.push(i18n.t("automations.errStepPrompt", { id: s.id }));
    }
    return out;
  });

  async function save() {
    saving = true;
    draft.tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const ok = await automations.save($state.snapshot(draft) as Automation);
    saving = false;
    if (ok) onback();
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="sm" onclick={onback}>
      <Icon icon={ArrowLeftIcon} data-icon="inline-start" />
      {i18n.t("common.back")}
    </Button>
    <span class="flex-1"></span>
    <Button size="sm" disabled={saving || problems.length > 0} onclick={save}>
      {i18n.t("common.save")}
    </Button>
  </div>

  <SettingsSection
    title={i18n.t("automations.identity")}
    description={i18n.t("automations.identityDesc")}
  >
    <div class={cn("divide-y divide-border/50", panel.settingsBody)}>
      <SettingsRow label={i18n.t("automations.name")}>
        {#snippet control()}
          <Input class={cn(field.selectWide, "min-w-0")} bind:value={draft.name} />
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("automations.tags")}
        description={i18n.t("automations.tagsDesc")}
      >
        {#snippet control()}
          <Input class={cn(field.selectWide, "min-w-0")} bind:value={tagsText} placeholder="review, nightly" />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("automations.description")}>
        {#snippet children()}
          <Textarea rows={2} bind:value={draft.description} />
        {/snippet}
      </SettingsRow>
    </div>
  </SettingsSection>

  <SettingsSection
    title={i18n.t("automations.where")}
    description={i18n.t("automations.whereDesc")}
  >
    <div class={cn("divide-y divide-border/50", panel.settingsBody)}>
      <SettingsRow label={i18n.t("automations.folder")}>
        {#snippet children()}
          <div class="flex items-center gap-2">
            <Input class="min-w-0 flex-1 font-mono text-xs" bind:value={draft.workingDir} />
            <Button variant="outline" size="sm" onclick={() => (folderOpen = true)}>
              <Icon icon={FolderIcon} class={icon.action} />
              {i18n.t("automations.browse")}
            </Button>
          </div>
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("automations.worktreePerRun")}
        description={i18n.t("automations.worktreePerRunDesc")}
      >
        {#snippet control()}
          <Switch
            checked={draft.worktreePerRun}
            onCheckedChange={(c) => (draft.worktreePerRun = c)}
          />
        {/snippet}
      </SettingsRow>
    </div>
  </SettingsSection>

  <SettingsSection
    title={i18n.t("automations.when")}
    description={i18n.t("automations.whenDesc")}
  >
    <div class={panel.settingsBody}>
      <SchedulePicker bind:schedule={draft.schedule} />
    </div>
  </SettingsSection>

  <SettingsSection
    title={i18n.t("automations.graph")}
    description={i18n.t("automations.graphDesc")}
    bare
  >
    <StepGraphEditor bind:steps={draft.steps} {installedAgents} />
  </SettingsSection>

  <SettingsSection
    title={i18n.t("automations.policy")}
    description={i18n.t("automations.policyDesc")}
  >
    <div class={cn("divide-y divide-border/50", panel.settingsBody)}>
      <SettingsRow
        label={i18n.t("automations.catchUp")}
        description={i18n.t("automations.catchUpDesc")}
      >
        {#snippet control()}
          <Switch
            checked={draft.policy.catchUp}
            onCheckedChange={(c) => (draft.policy.catchUp = c)}
          />
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("automations.overlapLabel")}
        description={i18n.t("automations.overlapDesc")}
      >
        {#snippet control()}
          <Combobox
            value={draft.policy.overlap}
            groups={overlapGroups}
            triggerClass={field.selectStandard}
            searchPlaceholder={i18n.t("common.search")}
            onChange={(v) => (draft.policy.overlap = v as typeof draft.policy.overlap)}
          />
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("automations.precondition")}
        description={i18n.t("automations.preconditionDesc")}
      >
        {#snippet children()}
          <Input
            class="font-mono text-xs"
            placeholder="git log --since=1.day --oneline"
            value={draft.policy.precondition?.command ?? ""}
            oninput={(e) => {
              const command = (e.currentTarget as HTMLInputElement).value;
              draft.policy.precondition = command.trim()
                ? { command, timeoutSeconds: draft.policy.precondition?.timeoutSeconds ?? 30 }
                : null;
            }}
          />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("automations.maxRunMinutes")}>
        {#snippet control()}
          <Input
            type="number"
            min="1"
            class={field.editorNumber}
            value={String(draft.policy.maxRunMinutes)}
            oninput={(e) => {
              const n = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(n)) draft.policy.maxRunMinutes = Math.max(1, Math.floor(n));
            }}
          />
        {/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("automations.keepRuns")}
        description={i18n.t("automations.keepRunsDesc")}
      >
        {#snippet control()}
          <Input
            type="number"
            min="1"
            class={field.editorNumber}
            value={String(draft.policy.keepRuns)}
            oninput={(e) => {
              const n = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(n)) draft.policy.keepRuns = Math.max(1, Math.floor(n));
            }}
          />
        {/snippet}
      </SettingsRow>
    </div>
  </SettingsSection>

  {#if problems.length > 0}
    <ul class={cn("flex list-disc flex-col gap-1 pl-5 text-amber-600 dark:text-amber-400", text.meta)}>
      {#each problems as problem (problem)}
        <li>{problem}</li>
      {/each}
    </ul>
  {/if}
</div>

<!-- The one floating surface the editor uses, and only because picking a folder
     is a modal act by nature. -->
<FolderSelectDialog
  bind:open={folderOpen}
  title={i18n.t("automations.folderTitle")}
  description={i18n.t("automations.folderDesc")}
  onselect={(path) => (draft.workingDir = path)}
/>
