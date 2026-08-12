<script lang="ts">
  // Settings → Git: where new worktrees are created.
  //
  // Ordinary settings rows (label + control on the right), like every other
  // section — the layout is a one-of-three choice, not a screen of its own. The
  // shape the chosen layout produces is shown as the row's own helper line, so
  // the example is there without a card for each option.
  //
  // Only creation is affected: worktrees already on disk are read from
  // `git worktree list` and keep working where they are, which is why this
  // screen never offers to move anything.
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Select from "$lib/components/ui/select";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import FolderSelectDialog from "$lib/components/FolderSelectDialog.svelte";
  import { app } from "$lib/state/app.svelte";
  import { gitIdentity } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, text } from "$lib/design";
  import type { GitIdentity, WorktreeLocationMode } from "$lib/types";

  const MODES = ["managed", "sibling", "custom"] as const satisfies readonly WorktreeLocationMode[];

  let browseOpen = $state(false);

  // Who commits are authored as. Read once when the pane opens: it comes from
  // the global git config, which nothing in the app changes.
  let identity = $state<GitIdentity | null>(null);
  $effect(() => {
    void gitIdentity()
      .then((v) => (identity = v))
      .catch(() => (identity = {}));
  });

  const unset = $derived(i18n.t("settings.gitIdentityUnset"));

  const mode = $derived<WorktreeLocationMode>(app.settings.worktrees?.location ?? "managed");
  const root = $derived(app.settings.worktrees?.root ?? "");

  const modeLabel = $derived(i18n.t(`settings.worktreeMode.${mode}`));

  function set(patch: { location?: WorktreeLocationMode; root?: string | null }) {
    app.settings.worktrees = { ...app.settings.worktrees, ...patch };
    void app.persistSettings();
  }
</script>

{#snippet value(v: string | null | undefined, missing = unset)}
  <span class={cn(v ? "font-medium text-foreground" : "text-muted-foreground", text.body)}>
    {v || missing}
  </span>
{/snippet}

<div class="flex flex-col gap-10">
  <!-- Who commits are authored as. Read-only: this is git's own global config,
       which the app reads but never writes. -->
  <SettingsSection
    title={i18n.t("settings.gitIdentity")}
    description={i18n.t("settings.gitIdentityDesc")}
  >
    <div class="divide-y divide-border/60">
      <SettingsRow label={i18n.t("settings.gitIdentityName")}>
        {#snippet control()}{@render value(identity?.name)}{/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("settings.gitIdentityEmail")}>
        {#snippet control()}{@render value(identity?.email)}{/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("settings.gitDefaultBranch")}
        description={i18n.t("settings.gitDefaultBranchDesc")}
      >
        {#snippet control()}{@render value(identity?.defaultBranch, "master")}{/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("settings.gitVersion")}>
        {#snippet control()}
          {@render value(identity?.version, i18n.t("settings.gitMissing"))}
        {/snippet}
      </SettingsRow>
      {#if identity && !identity.name && !identity.email}
        <SettingsRow description={i18n.t("settings.gitIdentityHint")} />
      {/if}
    </div>
  </SettingsSection>

  <SettingsSection
    title={i18n.t("settings.worktreeLocation")}
    description={i18n.t("settings.worktreeLocationDesc")}
  >
    <div class="divide-y divide-border/60">
      <SettingsRow
        label={i18n.t("settings.worktreeLayout")}
        description={i18n.t(`settings.worktreeMode.${mode}Example`)}
      >
        {#snippet control()}
          <Select.Root
            type="single"
            value={mode}
            onValueChange={(v) => set({ location: v as WorktreeLocationMode })}
          >
            <Select.Trigger
              class={field.selectStandard}
              aria-label={i18n.t("settings.worktreeLayout")}
            >
              {modeLabel}
            </Select.Trigger>
            <Select.Content>
              {#each MODES as m (m)}
                <Select.Item value={m} label={i18n.t(`settings.worktreeMode.${m}`)}>
                  {i18n.t(`settings.worktreeMode.${m}`)}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {/snippet}
      </SettingsRow>

      {#if mode === "custom"}
        <SettingsRow
          label={i18n.t("settings.worktreeRoot")}
          description={i18n.t("settings.worktreeRootDesc")}
          for="worktree-root"
        >
          {#snippet control()}
            <div class="flex items-center gap-2">
              <Input
                id="worktree-root"
                class={cn(field.selectStandard, "font-mono text-[12px]")}
                value={root}
                spellcheck={false}
                autocomplete="off"
                placeholder={i18n.t("settings.worktreeRootPlaceholder")}
                oninput={(e) => set({ root: e.currentTarget.value })}
              />
              <Button variant="outline" size="sm" onclick={() => (browseOpen = true)}>
                {i18n.t("newWorktree.browse")}
              </Button>
            </div>
          {/snippet}
        </SettingsRow>
      {/if}
    </div>
  </SettingsSection>
</div>

<FolderSelectDialog
  bind:open={browseOpen}
  title={i18n.t("settings.worktreeRoot")}
  description={i18n.t("settings.worktreeRootDesc")}
  onselect={(path) => set({ root: path })}
/>
