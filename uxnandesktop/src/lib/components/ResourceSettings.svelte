<script lang="ts">
  // Settings → Resources: the feature switch, the opt-in background orphan
  // sweep, an explanation of the attribution confidences, and the manual
  // diagnostics export. The export is consent-first: the dialog lists every
  // field of the already-sanitized document, and only a confirmation writes a
  // file (via the OS save dialog — nothing is ever uploaded).
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import { app } from "$lib/state/app.svelte";
  import { resourcesExport, fsWriteFile } from "$lib/api";
  import type { ResourceExport, ResourceSettings } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { Icon } from "$lib/components/ui/icon";
  import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";

  const settings = $derived(app.settings.resources ?? {});

  function set(patch: Partial<ResourceSettings>): void {
    app.settings.resources = { ...app.settings.resources, ...patch };
    void app.persistSettings();
  }

  // --- export (consent-first) ------------------------------------------------

  let exportDoc = $state<ResourceExport | null>(null);
  let exportOpen = $state(false);
  let exportBusy = $state(false);
  let exportError = $state<string | null>(null);
  let exportSaved = $state(false);

  /** Fetch the sanitized document and show its field list for consent. */
  async function beginExport(): Promise<void> {
    exportError = null;
    exportSaved = false;
    exportBusy = true;
    try {
      exportDoc = await resourcesExport();
      exportOpen = true;
    } catch (e) {
      exportError = e instanceof Error ? e.message : String(e);
    } finally {
      exportBusy = false;
    }
  }

  /** Write the exact document the dialog showed, via the OS save dialog. */
  async function confirmExport(): Promise<void> {
    if (!exportDoc) return;
    exportError = null;
    exportBusy = true;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const stamp = new Date(exportDoc.exportedAtMs).toISOString().slice(0, 10);
      const path = await save({
        defaultPath: `uxnan-resources-${stamp}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return; // user cancelled the OS dialog
      await fsWriteFile(path, JSON.stringify(exportDoc, null, 2));
      exportSaved = true;
      exportOpen = false;
    } catch (e) {
      exportError = e instanceof Error ? e.message : String(e);
    } finally {
      exportBusy = false;
    }
  }
</script>

<SettingsSection
  title={i18n.t("settings.resources")}
  description={i18n.t("settings.resourcesDesc")}
  bare
>
  <div class="space-y-6">
    <div class="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/20 px-4 py-1">
      <SettingsRow label={i18n.t("resources.enable")} description={i18n.t("resources.enableDesc")}>
        {#snippet control()}
          <Switch
            checked={settings.enabled !== false}
            onCheckedChange={(c) => set({ enabled: c })}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={i18n.t("resources.orphanSweep")}
        description={i18n.t("resources.orphanSweepDesc")}
      >
        {#snippet control()}
          <Switch
            checked={settings.orphanSweep === true}
            disabled={settings.enabled === false}
            onCheckedChange={(c) => set({ orphanSweep: c })}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={i18n.t("resources.sweepInterval")}
        description={i18n.t("resources.sweepIntervalDesc")}
        for="resource-sweep-interval"
      >
        {#snippet control()}
          <Input
            id="resource-sweep-interval"
            type="number"
            class="w-20 text-right tabular-nums"
            min={15}
            max={30}
            disabled={settings.enabled === false || settings.orphanSweep !== true}
            value={settings.orphanSweepSeconds ?? 20}
            onchange={(e) => {
              const raw = Number((e.currentTarget as HTMLInputElement).value);
              // The backend clamps too; clamping here keeps the field honest.
              const clamped = Number.isFinite(raw) ? Math.min(30, Math.max(15, Math.round(raw))) : 20;
              set({ orphanSweepSeconds: clamped });
            }}
          />
        {/snippet}
      </SettingsRow>
    </div>

    <!-- What the confidences mean — the vocabulary every row in the popover uses. -->
    <div class="space-y-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
      <span class={text.section}>{i18n.t("resources.confidenceTitle")}</span>
      <ul class={cn("space-y-1.5", text.meta)}>
        <li>
          <span class="font-medium text-foreground">{i18n.t("resources.confidenceExactName")}</span>
          — {i18n.t("resources.confidenceExact")}
        </li>
        <li>
          <span class="font-medium text-foreground"
            >{i18n.t("resources.confidenceInferredName")} (~)</span
          >
          — {i18n.t("resources.confidenceInferred")}
        </li>
        <li>
          <span class="font-medium text-foreground"
            >{i18n.t("resources.confidenceUnknownName")} (?)</span
          >
          — {i18n.t("resources.confidenceUnknown")}
        </li>
      </ul>
    </div>

    <div class="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/20 px-4 py-1">
      <SettingsRow label={i18n.t("resources.export")} description={i18n.t("resources.exportDesc")}>
        {#snippet control()}
          <Button
            variant="outline"
            size="sm"
            disabled={exportBusy || settings.enabled === false}
            onclick={beginExport}
          >
            <Icon icon={DownloadIcon} class="size-3.5" />
            {i18n.t("resources.exportButton")}
          </Button>
        {/snippet}
      </SettingsRow>
      {#if exportSaved}
        <p class={cn("py-2 text-green-600 dark:text-green-400", text.meta)}>
          {i18n.t("resources.exportSaved")}
        </p>
      {/if}
      {#if exportError && !exportOpen}
        <p class={cn("py-2 text-destructive", text.meta)}>{exportError}</p>
      {/if}
    </div>
  </div>
</SettingsSection>

<Dialog.Root bind:open={exportOpen}>
  <Dialog.Content size="medium">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("resources.exportTitle")}</Dialog.Title>
      <Dialog.Description>{i18n.t("resources.exportFieldsIntro")}</Dialog.Description>
    </Dialog.Header>

    {#if exportDoc}
      <ul
        class={cn(
          "max-h-56 list-disc space-y-0.5 overflow-y-auto rounded-md border border-border/50 bg-muted/20 py-2 pl-7 pr-3",
          text.meta,
        )}
        data-testid="export-fields"
      >
        {#each exportDoc.fields as field (field)}
          <li>{field}</li>
        {/each}
      </ul>
      <p class={text.meta}>{i18n.t("resources.exportSanitizedNote")}</p>
    {/if}
    {#if exportError}
      <p class={cn("text-destructive", text.meta)}>{exportError}</p>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (exportOpen = false)}>
        {i18n.t("common.cancel")}
      </Button>
      <Button disabled={exportBusy || !exportDoc} onclick={confirmExport}>
        {i18n.t("resources.exportConfirm")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
