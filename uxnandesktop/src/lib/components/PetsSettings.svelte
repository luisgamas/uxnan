<script lang="ts">
  // Settings → Pets. Self-contained (like Settings → GitHub / Quick commands):
  // the master switch and behaviour rows, a library grid with a live preview,
  // and the import flow.
  //
  // Import carries a visible, dismissible provenance notice: uxnan ships only
  // its own pet, and anything the user brings in from Codex or a community pack
  // stays its author's work. That notice is the reason the backend records an
  // `origin` per imported pet.
  import { app } from "$lib/state/app.svelte";
  import { pets } from "$lib/state/pets.svelte";
  import { petsCodexDir, petsScan } from "$lib/api";
  import { animationFor } from "$lib/pets/status";
  import { PET_SIZES, nearestPetSize } from "$lib/pets/manifest";
  import type { ImportablePet, PetCorner } from "$lib/types";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import * as Dialog from "$lib/components/ui/dialog";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import SettingsSection from "./SettingsSection.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import FolderSelectDialog from "./FolderSelectDialog.svelte";
  import PetSprite from "./PetSprite.svelte";
  import PawPrintIcon from "@lucide/svelte/icons/paw-print";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import InfoIcon from "@lucide/svelte/icons/info";
  import XIcon from "@lucide/svelte/icons/x";
  import DownloadIcon from "@lucide/svelte/icons/download";

  const settings = $derived(app.petSettings);
  /** Preview cycles through the states so the user sees what each one looks like. */
  let previewState = $state<"idle" | "working" | "waiting" | "done" | "blocked">("idle");

  let folderOpen = $state(false);
  let importOpen = $state(false);
  let importing = $state(false);
  let candidates = $state<ImportablePet[]>([]);
  let candidateOrigin = $state("");
  let scanError = $state("");
  /** True when the last scan targeted the Codex folder, so an empty result can
   *  explain the specific reason (Codex's own pets aren't files on disk). */
  let scannedCodex = $state(false);
  /** Set once we know whether this machine has a Codex pets folder to offer. */
  let codexDir = $state<string | null>(null);

  const NOTICE_KEY = "import-provenance";
  const noticeDismissed = $derived((settings.dismissedNotices ?? []).includes(NOTICE_KEY));

  $effect(() => {
    if (!pets.loaded) void pets.load();
    void petsCodexDir()
      .then((d) => (codexDir = d))
      .catch(() => (codexDir = null));
  });

  // Resolve every library thumbnail from an effect — asking for a sheet from
  // markup would mutate store state mid-render (see `pets.sheet`).
  $effect(() => {
    for (const p of pets.library) void pets.ensureSheet(p.id);
  });

  function set(patch: Parameters<typeof app.updatePets>[0]): void {
    app.updatePets(patch);
  }

  function dismissNotice(): void {
    set({ dismissedNotices: [...(settings.dismissedNotices ?? []), NOTICE_KEY] });
  }

  const cornerGroups: ComboGroup[] = $derived([
    {
      items: [
        { value: "bottom-right", label: i18n.t("pets.corner.bottomRight") },
        { value: "bottom-left", label: i18n.t("pets.corner.bottomLeft") },
        { value: "top-right", label: i18n.t("pets.corner.topRight") },
        { value: "top-left", label: i18n.t("pets.corner.topLeft") },
      ],
    },
  ]);

  const SIZE_LABELS = ["pets.size.small", "pets.size.medium", "pets.size.large", "pets.size.huge"] as const;
  const sizeGroups: ComboGroup[] = $derived([
    {
      items: PET_SIZES.map((px, i) => ({ value: String(px), label: i18n.t(SIZE_LABELS[i]) })),
    },
  ]);

  /** Open the import browser on a folder of pets (or a single pet folder). */
  async function scanFolder(dir: string, origin: string, isCodex = false): Promise<void> {
    scanError = "";
    scannedCodex = isCodex;
    candidateOrigin = origin;
    try {
      candidates = await petsScan(dir);
      importOpen = true;
      if (candidates.length === 0) scanError = i18n.t("pets.importEmpty");
    } catch (err) {
      candidates = [];
      importOpen = true;
      scanError = err instanceof Error ? err.message : String(err);
    }
  }

  async function importOne(candidate: ImportablePet): Promise<void> {
    importing = true;
    const ok = await pets.import(candidate.dir, candidateOrigin, candidate.installed);
    importing = false;
    if (ok) {
      // Reflect the new "already installed" state without a second round-trip.
      candidates = candidates.map((c) =>
        c.id === candidate.id ? { ...c, installed: true } : c,
      );
    }
  }

  async function importAll(): Promise<void> {
    importing = true;
    for (const c of candidates) {
      await pets.import(c.dir, candidateOrigin, true);
    }
    candidates = candidates.map((c) => ({ ...c, installed: true }));
    importing = false;
  }
</script>

<SettingsSection title={i18n.t("settings.pets")} description={i18n.t("settings.pets.desc")} bare>
  <div class="space-y-6">
    <!-- Behaviour -->
    <div class="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/20 px-4 py-1">
      <SettingsRow label={i18n.t("pets.enable")} description={i18n.t("pets.enableDesc")}>
        {#snippet control()}
          <Switch
            checked={settings.enabled === true}
            onCheckedChange={(c) => {
              set({ enabled: c });
              if (c && !pets.loaded) void pets.load();
            }}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("pets.corner")} description={i18n.t("pets.cornerDesc")}>
        {#snippet control()}
          <Combobox
            value={settings.corner ?? "bottom-right"}
            groups={cornerGroups}
            disabled={settings.enabled !== true}
            triggerClass="w-56"
            searchPlaceholder={i18n.t("common.search")}
            onChange={(v) => set({ corner: v as PetCorner, offsetX: 16, offsetY: 16 })}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("pets.size")} description={i18n.t("pets.sizeDesc")}>
        {#snippet control()}
          <Combobox
            value={String(nearestPetSize(settings.size))}
            groups={sizeGroups}
            disabled={settings.enabled !== true}
            triggerClass="w-56"
            searchPlaceholder={i18n.t("common.search")}
            onChange={(v) => set({ size: Number(v) })}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("pets.animate")} description={i18n.t("pets.animateDesc")}>
        {#snippet control()}
          <Switch
            checked={settings.animate !== false}
            disabled={settings.enabled !== true}
            onCheckedChange={(c) => set({ animate: c })}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow label={i18n.t("pets.clickToFocus")} description={i18n.t("pets.clickToFocusDesc")}>
        {#snippet control()}
          <Switch
            checked={settings.clickToFocus !== false}
            disabled={settings.enabled !== true}
            onCheckedChange={(c) => set({ clickToFocus: c })}
          />
        {/snippet}
      </SettingsRow>
    </div>

    <!-- Library -->
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h3 class={cn("font-medium text-foreground", text.body)}>{i18n.t("pets.library")}</h3>
          <p class="text-[12px] leading-5 text-muted-foreground">
            {i18n.t("pets.libraryDesc")}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          {#if codexDir}
            <Button
              variant="outline"
              size="sm"
              onclick={() => scanFolder(codexDir ?? "", i18n.t("pets.originCodex"), true)}
            >
              <DownloadIcon class={icon.button} />
              {i18n.t("pets.importFromCodex")}
            </Button>
          {/if}
          <Button variant="outline" size="sm" onclick={() => (folderOpen = true)}>
            <FolderOpenIcon class={icon.button} />
            {i18n.t("pets.importFolder")}
          </Button>
        </div>
      </div>

      <!-- Provenance: shown until the user dismisses it. -->
      {#if !noticeDismissed}
        <div
          class="relative flex gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 pr-9"
        >
          <InfoIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p class="text-[12px] leading-5 text-muted-foreground">
            {i18n.t("pets.provenanceNotice")}
          </p>
          <button
            type="button"
            class="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={i18n.t("common.close")}
            onclick={dismissNotice}
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
      {/if}

      {#if pets.error}
        <p class="text-[12px] leading-5 text-destructive">{pets.error}</p>
      {/if}

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each pets.library as p (p.id)}
          {@const active = (settings.activePetId || pets.library[0]?.id) === p.id}
          {@const sheet = pets.sheet(p.id)}
          <!-- The remove action is a sibling of the select button, not nested
               inside it (a button inside a button is invalid markup). -->
          <div
            class={cn(
              "group relative rounded-xl border transition-colors",
              active ? "border-primary/60 bg-accent" : "border-border/60 hover:bg-accent/50",
            )}
          >
            <button
              type="button"
              class="flex w-full flex-col items-center gap-2 rounded-xl px-3 py-3 text-center"
              onclick={() => set({ activePetId: p.id })}
            >
              <div class="flex h-20 items-end justify-center">
                {#if sheet}
                  <PetSprite
                    pet={p}
                    {sheet}
                    animation={animationFor(previewState)}
                    size={72}
                    animate={settings.animate !== false}
                    flavour={false}
                  />
                {:else}
                  <PawPrintIcon class="size-8 text-muted-foreground/40" />
                {/if}
              </div>
              <span class="w-full truncate text-[13px] font-medium">{p.displayName}</span>
              {#if p.origin}
                <span class="w-full truncate text-[11px] text-muted-foreground">{p.origin}</span>
              {:else if p.source === "builtin"}
                <span class="w-full truncate text-[11px] text-muted-foreground">
                  {i18n.t("pets.bundled")}
                </span>
              {/if}
            </button>
            {#if p.source === "imported"}
              <button
                type="button"
                class="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label={i18n.t("pets.remove")}
                title={i18n.t("pets.remove")}
                onclick={() => void pets.remove(p.id)}
              >
                <Trash2Icon class="size-3.5" />
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Preview state switcher: see each agent state without waiting for one. -->
      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        <span class="text-[12px] text-muted-foreground">{i18n.t("pets.preview")}</span>
        {#each ["idle", "working", "waiting", "done", "blocked"] as const as s (s)}
          <button
            type="button"
            class={cn(
              "rounded-md px-2 py-1 text-[12px] transition-colors",
              previewState === s
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onclick={() => (previewState = s)}
          >
            {i18n.t(`pets.state.${s}`)}
          </button>
        {/each}
      </div>
    </div>
  </div>
</SettingsSection>

<FolderSelectDialog
  bind:open={folderOpen}
  title={i18n.t("pets.importFolderTitle")}
  description={i18n.t("pets.importFolderDesc")}
  onselect={(path) => scanFolder(path, i18n.t("pets.originFolder"))}
/>

<Dialog.Root bind:open={importOpen}>
  <Dialog.Content class="sm:max-w-[560px]">
    <Dialog.Title class="text-[15px] font-semibold">{i18n.t("pets.importTitle")}</Dialog.Title>
    <Dialog.Description class="text-[13px] text-muted-foreground">
      {i18n.t("pets.importDesc")}
    </Dialog.Description>

    <!-- Always shown in the import dialog (not dismissible here): this is the
         moment the user takes on someone else's artwork. -->
    <div class="flex gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
      <InfoIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p class="text-[12px] leading-5 text-muted-foreground">
        {i18n.t("pets.importAttribution")}
      </p>
    </div>

    <!-- An empty result is the common case and almost never a failure, so it
         explains *why* the folder is empty and what to do about it rather than
         just reporting nothing found. -->
    {#if scanError}
      <div class="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
        <p class="text-[12px] leading-5 text-foreground">{scanError}</p>
        <p class="text-[12px] leading-5 text-muted-foreground">
          {i18n.t(scannedCodex ? "pets.importEmptyCodex" : "pets.importEmptyFolder")}
        </p>
      </div>
    {/if}

    <div class="max-h-72 space-y-1.5 overflow-y-auto">
      {#each candidates as c (c.id)}
        <div class="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-medium">{c.displayName}</p>
            {#if c.description}
              <p class="truncate text-[12px] text-muted-foreground">{c.description}</p>
            {/if}
          </div>
          <Button
            variant={c.installed ? "ghost" : "outline"}
            size="sm"
            disabled={importing}
            onclick={() => importOne(c)}
          >
            {i18n.t(c.installed ? "pets.reimport" : "pets.import")}
          </Button>
        </div>
      {/each}
    </div>

    <div class="flex justify-end gap-2">
      {#if candidates.length > 1}
        <Button variant="outline" size="sm" disabled={importing} onclick={importAll}>
          {i18n.t("pets.importAll")}
        </Button>
      {/if}
      <Button size="sm" onclick={() => (importOpen = false)}>{i18n.t("common.close")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
