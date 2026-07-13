<script lang="ts">
  // Reusable "create pull request" form (title + body, manual or AI-drafted),
  // shared by the GitHub section and the right-panel GitHub tab. Honors the
  // "Confirm PR actions" setting (GitHub → Settings) via the shared ConfirmDialog.
  import { untrack } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { surface } from "$lib/design";
  import { toast, toastError } from "$lib/toast";
  import { githubPrCreate, githubAiDraftPr, openExternal } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";

  let {
    worktreePath,
    defaultTitle = "",
    compact = false,
    onCreated,
    onCancel,
  }: {
    worktreePath: string | null;
    defaultTitle?: string;
    compact?: boolean;
    onCreated?: () => void;
    onCancel?: () => void;
  } = $props();

  // One-time seed from the branch name; the field is user-editable afterwards.
  let title = $state(untrack(() => defaultTitle));
  let body = $state("");
  let draft = $state(false);
  let busy = $state(false);
  let aiDrafting = $state(false);
  let confirmOpen = $state(false);

  const aiAgent = $derived(app.settings.github?.aiAgentId);

  function submit() {
    if (!worktreePath || !title.trim()) return;
    if (app.settings.github?.confirmPr ?? true) {
      confirmOpen = true;
    } else {
      void doCreate();
    }
  }

  async function doCreate(): Promise<boolean> {
    if (!worktreePath || !title.trim()) return false;
    busy = true;
    try {
      const url = await githubPrCreate(worktreePath, {
        title: title.trim(),
        body,
        draft,
      });
      toast.success(i18n.t("github.toast.prCreated"));
      await github.refreshContext();
      if (url) void openExternal(url);
      onCreated?.();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function draftBody() {
    if (!worktreePath || !aiAgent) return;
    aiDrafting = true;
    try {
      body = await githubAiDraftPr(worktreePath, aiAgent, app.settings.github?.aiModel ?? "");
    } catch (e) {
      toastError(e);
    } finally {
      aiDrafting = false;
    }
  }
</script>

<div class={cn("space-y-2 rounded-lg p-3", surface.panel)}>
  <Input placeholder={i18n.t("github.pr.titleLabel")} bind:value={title} />
  <div class="relative">
    <Textarea placeholder={i18n.t("github.pr.bodyLabel")} bind:value={body} rows={compact ? 4 : 5} />
    {#if aiAgent}
      <Button
        variant="ghost"
        size="sm"
        class="absolute right-1 top-1 h-6 gap-1 px-2"
        disabled={aiDrafting}
        onclick={draftBody}
      >
        {#if aiDrafting}
          <LoaderIcon class="size-3 animate-spin" />
        {:else}
          <SparklesIcon class="size-3" />
        {/if}
        {aiDrafting ? i18n.t("github.pr.generating") : i18n.t("github.pr.generateBody")}
      </Button>
    {/if}
  </div>
  <label class="flex items-center gap-2 text-[13px]">
    <Switch checked={draft} onCheckedChange={(v) => (draft = v)} />
    {i18n.t("github.pr.draftLabel")}
  </label>
  <div class="flex justify-end gap-2">
    {#if onCancel}
      <Button variant="ghost" size="sm" onclick={onCancel}>{i18n.t("common.cancel")}</Button>
    {/if}
    <Button size="sm" disabled={busy || !title.trim()} onclick={submit}>{i18n.t("github.pr.create")}</Button>
  </div>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={i18n.t("github.confirm.createTitle")}
  description={i18n.t("github.confirm.createDesc")}
  confirmLabel={i18n.t("github.pr.create")}
  onconfirm={doCreate}
/>
