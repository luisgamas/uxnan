<script lang="ts">
  // Settings → Quick commands. Lists the user's commands grouped by scope
  // (global / project & worktree) with edit / duplicate / delete, and a dialog
  // editor: the essentials up top (name, command with insertable variables,
  // scope) and the rest under a collapsible "Advanced" group (run target, run
  // mode, working directory, shell, confirm). All mutations funnel through the
  // app store (persisted).
  import { onMount, tick } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import type {
    QuickCommand,
    QuickCommandCwd,
    QuickCommandRunMode,
    QuickCommandScope,
    QuickCommandTarget,
  } from "$lib/types";
  import SettingsSection from "./SettingsSection.svelte";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SquarePenIcon from "@lucide/svelte/icons/square-pen";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  const SHELL_DEFAULT = "__default__";

  /** Substitution variables offered as insertable chips (with an explanation). */
  const VARIABLES: { token: string; descKey: MessageKey }[] = [
    { token: "{worktree}", descKey: "commands.varWorktree" },
    { token: "{branch}", descKey: "commands.varBranch" },
    { token: "{repo}", descKey: "commands.varRepo" },
    { token: "{repoName}", descKey: "commands.varRepoName" },
    { token: "{path}", descKey: "commands.varPath" },
  ];

  // Load worktrees for every repo so the scope picker can bind to any of them
  // (they're otherwise loaded on demand as the sidebar expands).
  onMount(() => {
    for (const r of app.repos) void projects.loadWorktrees(r.id);
  });

  // --- Display grouping ------------------------------------------------------
  const repoName = (id: string | null | undefined) =>
    app.repos.find((r) => r.id === id)?.name ?? i18n.t("commands.unknownProject");
  const pathName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

  function scopeLabel(cmd: QuickCommand): string {
    if (cmd.scope === "global") return i18n.t("commands.scopeGlobal");
    if (cmd.scope === "project") return repoName(cmd.projectId);
    return cmd.worktreePath ? pathName(cmd.worktreePath) : i18n.t("commands.scopeWorktree");
  }

  const grouped = $derived.by(() => ({
    global: app.quickCommands.filter((c) => c.scope === "global"),
    scoped: app.quickCommands.filter((c) => c.scope !== "global"),
  }));

  // --- Editor ----------------------------------------------------------------
  let editorOpen = $state(false);
  let iconPickerOpen = $state(false);
  let advancedOpen = $state(false);
  let draft = $state<QuickCommand | null>(null);
  let isEdit = $state(false);
  let commandEl = $state<HTMLTextAreaElement | null>(null);

  // Delete confirmation.
  let deleteOpen = $state(false);
  let deleteTarget = $state<QuickCommand | null>(null);

  function blankCommand(): QuickCommand {
    return {
      id: crypto.randomUUID(),
      name: "",
      command: "",
      description: null,
      icon: null,
      scope: "global",
      projectId: projects.activeRepo?.id ?? app.repos[0]?.id ?? null,
      worktreePath: projects.activeWorktreePath ?? null,
      runMode: "execute",
      target: "newTab",
      cwd: "activeWorktree",
      customCwd: null,
      shellProfileId: null,
      confirm: false,
    };
  }

  function create(): void {
    draft = blankCommand();
    isEdit = false;
    advancedOpen = false;
    editorOpen = true;
  }

  function edit(cmd: QuickCommand): void {
    draft = { ...$state.snapshot(cmd) };
    isEdit = true;
    advancedOpen = false;
    editorOpen = true;
  }

  /** Insert a variable token at the command caret (or append when unfocused). */
  function insertVariable(token: string): void {
    if (!draft) return;
    const el = commandEl;
    if (el) {
      const start = el.selectionStart ?? draft.command.length;
      const end = el.selectionEnd ?? start;
      draft.command = draft.command.slice(0, start) + token + draft.command.slice(end);
      const pos = start + token.length;
      void tick().then(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    } else {
      draft.command += token;
    }
  }

  const canSave = $derived(
    !!draft &&
      draft.name.trim().length > 0 &&
      draft.command.trim().length > 0 &&
      (draft.scope !== "project" || !!draft.projectId) &&
      (draft.scope !== "worktree" || !!draft.worktreePath) &&
      (draft.cwd !== "custom" || draft.target === "active" || !!draft.customCwd?.trim()),
  );

  function save(): void {
    if (!draft || !canSave) return;
    const cmd = $state.snapshot(draft);
    // Clear bindings that don't apply to the chosen scope, so a moved command
    // never carries a stale project/worktree reference.
    if (cmd.scope !== "project") cmd.projectId = null;
    if (cmd.scope !== "worktree") cmd.worktreePath = null;
    if (isEdit) app.updateQuickCommand(cmd);
    else app.addQuickCommand(cmd);
    editorOpen = false;
  }

  // --- Combobox groups -------------------------------------------------------
  const scopeGroups: ComboGroup[] = [
    {
      items: [
        { value: "global", label: i18n.t("commands.scopeGlobal") },
        { value: "project", label: i18n.t("commands.scopeProject") },
        { value: "worktree", label: i18n.t("commands.scopeWorktree") },
      ],
    },
  ];
  const targetGroups: ComboGroup[] = [
    {
      items: [
        { value: "newTab", label: i18n.t("commands.targetNewTab") },
        { value: "active", label: i18n.t("commands.targetActive") },
      ],
    },
  ];
  const runModeGroups: ComboGroup[] = [
    {
      items: [
        { value: "execute", label: i18n.t("commands.runExecute") },
        { value: "typeOnly", label: i18n.t("commands.runTypeOnly") },
      ],
    },
  ];
  const cwdGroups: ComboGroup[] = [
    {
      items: [
        { value: "activeWorktree", label: i18n.t("commands.cwdActiveWorktree") },
        { value: "projectRoot", label: i18n.t("commands.cwdProjectRoot") },
        { value: "custom", label: i18n.t("commands.cwdCustom") },
      ],
    },
  ];
  const repoGroups = $derived<ComboGroup[]>([
    { items: app.repos.map((r) => ({ value: r.id, label: r.name, keywords: [r.path] })) },
  ]);
  const worktreeGroups = $derived<ComboGroup[]>(
    app.repos
      .map((r) => ({
        heading: r.name,
        items: projects.worktreesOf(r.id).map((w) => ({
          value: w.path,
          label: w.branch ?? pathName(w.path),
          meta: r.name,
          keywords: [w.path],
        })),
      }))
      .filter((g) => g.items.length > 0),
  );
  const shellGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: SHELL_DEFAULT, label: i18n.t("commands.shellDefault") },
        ...app.terminalProfiles.map((p) => ({
          value: p.id,
          label: p.name.trim() || p.command,
        })),
      ],
    },
  ]);
</script>

<SettingsSection bare title={i18n.t("settings.commands")} description={i18n.t("settings.commandsDesc")}>
  {#snippet headerAction()}
    <Button size="sm" onclick={create}>
      <PlusIcon data-icon="inline-start" />
      {i18n.t("commands.new")}
    </Button>
  {/snippet}

  {#if app.quickCommands.length === 0}
    <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-12 text-center">
      <ZapIcon class={cn(icon.empty, "text-muted-foreground")} />
      <p class={cn("max-w-sm", text.body)}>{i18n.t("commands.emptyState")}</p>
      <Button size="sm" variant="outline" onclick={create}>
        <PlusIcon data-icon="inline-start" />
        {i18n.t("commands.new")}
      </Button>
    </div>
  {:else}
    <div class="space-y-6">
      {#if grouped.global.length}
        <div class="space-y-2">
          <span class={cn("px-1", text.section)}>{i18n.t("commands.globalSection")}</span>
          {@render list(grouped.global)}
        </div>
      {/if}
      {#if grouped.scoped.length}
        <div class="space-y-2">
          <span class={cn("px-1", text.section)}>{i18n.t("commands.scopedSection")}</span>
          {@render list(grouped.scoped)}
        </div>
      {/if}
    </div>
  {/if}
</SettingsSection>

{#snippet list(items: QuickCommand[])}
  <div class="divide-y divide-border/60 rounded-xl border border-border/50 bg-card/50 px-4 shadow-xs">
    {#each items as cmd (cmd.id)}
      <div class="flex items-center gap-3 py-3">
        <EntityIcon value={cmd.icon} class="size-4 text-muted-foreground">
          {#snippet fallback()}<ZapIcon class="size-4 text-muted-foreground" />{/snippet}
        </EntityIcon>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class={cn("truncate", text.body)}>{cmd.name.trim() || cmd.command}</span>
            <span class={cn("shrink-0 rounded-full bg-muted px-1.5 py-0.5", text.indicator)}>
              {scopeLabel(cmd)}
            </span>
          </div>
          <div class={cn("truncate font-mono", text.meta)}>{cmd.command}</div>
        </div>
        <div class="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" class={iconButton.action} aria-label={i18n.t("common.edit")} title={i18n.t("common.edit")} onclick={() => edit(cmd)}>
            <SquarePenIcon class={icon.button} />
          </Button>
          <Button variant="ghost" size="icon" class={iconButton.action} aria-label={i18n.t("commands.duplicate")} title={i18n.t("commands.duplicate")} onclick={() => app.duplicateQuickCommand(cmd.id)}>
            <CopyIcon class={icon.button} />
          </Button>
          <Button variant="ghost" size="icon" class={iconButton.action} aria-label={i18n.t("common.delete")} title={i18n.t("common.delete")} onclick={() => { deleteTarget = cmd; deleteOpen = true; }}>
            <Trash2Icon class={icon.button} />
          </Button>
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<!-- Editor dialog. Custom header/footer bars (not Dialog.Header/Footer, whose
     negative-margin defaults assume the content's own padding) keep the actions
     inset and aligned; the single close affordance is the footer's Cancel. -->
<Dialog.Root bind:open={editorOpen}>
  <Dialog.Content
    showCloseButton={false}
    class="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
  >
    <div class="flex shrink-0 items-center border-b border-border/60 px-5 py-3.5">
      <Dialog.Title class={text.title}>
        {isEdit ? i18n.t("commands.editTitle") : i18n.t("commands.newTitle")}
      </Dialog.Title>
    </div>

    {#if draft}
      <div class="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <!-- Name + icon -->
        <div class="space-y-1.5">
          <span class={text.body}>{i18n.t("commands.fieldName")}</span>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              class="size-9 shrink-0"
              aria-label={i18n.t("commands.fieldIcon")}
              onclick={() => (iconPickerOpen = true)}
            >
              <EntityIcon value={draft.icon} class="size-4">
                {#snippet fallback()}<ZapIcon class="size-4 text-muted-foreground" />{/snippet}
              </EntityIcon>
            </Button>
            <Input bind:value={draft.name} placeholder={i18n.t("commands.namePlaceholder")} class="flex-1" />
          </div>
        </div>

        <!-- Command + insertable variables -->
        <div class="space-y-1.5">
          <span class={text.body}>{i18n.t("commands.fieldCommand")}</span>
          <Textarea
            bind:ref={commandEl}
            bind:value={draft.command}
            spellcheck={false}
            class="h-20 font-mono text-[12px]"
            placeholder="npm run dev"
          />
          <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span class={text.meta}>{i18n.t("commands.variablesLabel")}</span>
            {#each VARIABLES as v (v.token)}
              <TooltipSimple title={i18n.t(v.descKey)}>
                {#snippet children(tp)}
                  <button
                    {...tp}
                    type="button"
                    class="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onclick={() => insertVariable(v.token)}
                  >
                    {v.token}
                  </button>
                {/snippet}
              </TooltipSimple>
            {/each}
          </div>
        </div>

        <!-- Scope -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <span class={text.body}>{i18n.t("commands.fieldScope")}</span>
            <Combobox
              value={draft.scope}
              groups={scopeGroups}
              triggerClass="w-full"
              onChange={(v) => (draft && (draft.scope = v as QuickCommandScope))}
            />
          </div>
          {#if draft.scope === "project"}
            <div class="space-y-1.5">
              <span class={text.body}>{i18n.t("commands.fieldProject")}</span>
              <Combobox
                value={draft.projectId ?? undefined}
                groups={repoGroups}
                triggerClass="w-full"
                placeholder={i18n.t("commands.pickProject")}
                searchPlaceholder={i18n.t("common.search")}
                onChange={(v) => (draft && (draft.projectId = v))}
              />
            </div>
          {:else if draft.scope === "worktree"}
            <div class="space-y-1.5">
              <span class={text.body}>{i18n.t("commands.fieldWorktree")}</span>
              <Combobox
                value={draft.worktreePath ?? undefined}
                groups={worktreeGroups}
                triggerClass="w-full"
                placeholder={i18n.t("commands.pickWorktree")}
                searchPlaceholder={i18n.t("common.search")}
                onChange={(v) => (draft && (draft.worktreePath = v))}
              />
            </div>
          {/if}
        </div>

        <!-- Advanced options: a borderless disclosure — the fields reveal inline
             with the same styling as the section above, no nested card. -->
        <Collapsible.Root bind:open={advancedOpen} class="space-y-4">
          <Collapsible.Trigger
            class="flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground {text.body}"
          >
            <ChevronRightIcon class={cn("size-4 transition-transform", advancedOpen && "rotate-90")} />
            {i18n.t("commands.advanced")}
          </Collapsible.Trigger>
          <Collapsible.Content class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <span class={text.body}>{i18n.t("commands.fieldTarget")}</span>
                <Combobox
                  value={draft.target}
                  groups={targetGroups}
                  triggerClass="w-full"
                  onChange={(v) => (draft && (draft.target = v as QuickCommandTarget))}
                />
              </div>
              <div class="space-y-1.5">
                <span class={text.body}>{i18n.t("commands.fieldRunMode")}</span>
                <Combobox
                  value={draft.runMode}
                  groups={runModeGroups}
                  triggerClass="w-full"
                  onChange={(v) => (draft && (draft.runMode = v as QuickCommandRunMode))}
                />
              </div>
            </div>

            {#if draft.target === "newTab"}
              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <span class={text.body}>{i18n.t("commands.fieldCwd")}</span>
                  <Combobox
                    value={draft.cwd}
                    groups={cwdGroups}
                    triggerClass="w-full"
                    onChange={(v) => (draft && (draft.cwd = v as QuickCommandCwd))}
                  />
                </div>
                {#if draft.cwd === "custom"}
                  <div class="space-y-1.5">
                    <span class={text.body}>{i18n.t("commands.fieldCustomCwd")}</span>
                    <Input value={draft.customCwd ?? ""} oninput={(e) => (draft && (draft.customCwd = e.currentTarget.value || null))} placeholder="C:\\path\\to\\dir" />
                  </div>
                {/if}
              </div>
            {/if}

            <div class="space-y-1.5">
              <span class={text.body}>{i18n.t("commands.fieldShell")}</span>
              <Combobox
                value={draft.shellProfileId ?? SHELL_DEFAULT}
                groups={shellGroups}
                triggerClass="w-full"
                searchPlaceholder={i18n.t("common.search")}
                onChange={(v) => (draft && (draft.shellProfileId = v === SHELL_DEFAULT ? null : v))}
              />
            </div>

            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class={text.body}>{i18n.t("commands.fieldConfirm")}</div>
                <p class={text.meta}>{i18n.t("commands.confirmHint")}</p>
              </div>
              <Switch checked={draft.confirm} onCheckedChange={(v) => (draft && (draft.confirm = v))} />
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      </div>

      <div class="flex shrink-0 justify-end gap-2 border-t border-border/60 bg-muted/30 px-5 py-3.5">
        <Button variant="ghost" onclick={() => (editorOpen = false)}>{i18n.t("common.cancel")}</Button>
        <Button disabled={!canSave} onclick={save}>{i18n.t("common.save")}</Button>
      </div>

      <IconPicker
        bind:open={iconPickerOpen}
        title={i18n.t("commands.fieldIcon")}
        current={draft.icon}
        onselect={(v) => (draft && (draft.icon = v))}
      >
        {#snippet fallback()}<ZapIcon class="size-7 text-muted-foreground" />{/snippet}
      </IconPicker>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={deleteOpen}
  danger
  title={i18n.t("commands.deleteTitle", { name: deleteTarget?.name ?? "" })}
  description={i18n.t("commands.deleteDesc")}
  confirmLabel={i18n.t("common.delete")}
  onconfirm={() => {
    if (deleteTarget) app.removeQuickCommand(deleteTarget.id);
  }}
/>
