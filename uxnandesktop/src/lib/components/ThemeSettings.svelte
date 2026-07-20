<script lang="ts">
  // Appearance pane: two sub-tabs.
  //  - Interface: app theme grid (System + built-ins + custom), a global font
  //    override (wins over each theme's fonts), and the theme editor.
  //  - Terminal: terminal theme grid (Inherit + presets) that overrides the app
  //    theme in the terminal only, plus the terminal theme editor.
  // New/Edit open a DRAFT in the editor (previewed live, saved only on Save).
  import { untrack } from "svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import { app } from "$lib/state/app.svelte";
  import {
    BUILTIN_IDS,
    BUNDLED_FONTS,
    DEFAULT_FONTS,
    TERMINAL_INHERIT_ID,
    duplicateTheme,
    duplicateTerminalTheme,
    newTerminalThemeId,
    normalizeImportedThemes,
    normalizeImportedTerminalThemes,
    resolveTerminal,
    terminalTemplateFor,
    themeToJson,
    terminalThemeToJson,
    type Theme,
    type TerminalTheme,
    type TerminalThemePreset,
  } from "$lib/theme";
  import { fsReadFile, fsWriteFile } from "$lib/api";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import ThemeEditor from "./ThemeEditor.svelte";
  import TerminalThemeEditor from "./TerminalThemeEditor.svelte";
  import SettingsSection from "./SettingsSection.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import FontPicker from "./FontPicker.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import ClipboardPasteIcon from "@lucide/svelte/icons/clipboard-paste";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import CheckIcon from "@lucide/svelte/icons/check";

  let error = $state<string | null>(null);
  // Transient success line for a completed import (e.g. "Imported 3 themes").
  let notice = $state<string | null>(null);


  function persist() {
    void app.persistSettings();
  }
  function ensureFonts() {
    if (!app.settings.fonts) app.settings.fonts = {};
    return app.settings.fonts;
  }
  function ensureTermFonts(): TerminalTheme {
    if (!app.settings.terminalFonts) app.settings.terminalFonts = {};
    return app.settings.terminalFonts;
  }
  function setTermFontNum(key: keyof TerminalTheme, raw: string) {
    const v = raw.trim() === "" ? undefined : Number(raw);
    (ensureTermFonts() as unknown as Record<string, unknown>)[key] = Number.isFinite(v as number) ? v : undefined;
    persist();
  }
  function setTermFontStr(key: keyof TerminalTheme, raw: string) {
    (ensureTermFonts() as unknown as Record<string, unknown>)[key] = raw.trim() === "" ? undefined : raw;
    persist();
  }
  // Baseline terminal typography (preset → app theme) shown as the font-section
  // placeholders, so the global override hints what it inherits.
  const termFontBase = $derived(resolveTerminal(app.resolveActiveTheme().base, app.resolveActiveTerminalTheme()));
  const tf = $derived(app.settings.terminalFonts ?? {});

  const activeId = $derived(app.settings.activeThemeId ?? "system");
  const customThemes = $derived(app.settings.customThemes ?? []);
  const activeTermId = $derived(app.settings.activeTerminalThemeId ?? TERMINAL_INHERIT_ID);
  const termThemes = $derived(app.settings.terminalThemes ?? []);

  function selectTheme(id: string) {
    app.settings.activeThemeId = id;
    persist();
  }
  function selectTerm(id: string) {
    app.settings.activeTerminalThemeId = id;
    persist();
  }

  // --- App theme editor (draft) -------------------------------------------
  let themeEditorOpen = $state(false);
  let themeDraft = $state<Theme | null>(null);
  let themeIsNew = $state(false);
  let themeOriginalId: string | null = null;

  function newTheme() {
    themeDraft = duplicateTheme(app.resolveActiveTheme(), i18n.t("appearance.newThemeName"));
    themeIsNew = true;
    themeOriginalId = null;
    app.previewTheme = themeDraft;
    themeEditorOpen = true;
  }
  function editTheme(theme: Theme) {
    themeDraft = structuredClone($state.snapshot(theme)) as Theme;
    themeIsNew = false;
    themeOriginalId = theme.id;
    app.previewTheme = themeDraft;
    themeEditorOpen = true;
  }
  function closeThemeEditor(save: boolean) {
    if (!themeDraft) return;
    if (save) {
      if (themeIsNew) {
        app.settings.customThemes = [...customThemes, themeDraft];
      } else {
        app.settings.customThemes = customThemes.map((t) => (t.id === themeOriginalId ? themeDraft! : t));
      }
      app.settings.activeThemeId = themeDraft.id;
      persist();
    }
    app.previewTheme = null;
    themeEditorOpen = false;
    themeDraft = null;
  }
  function duplicateThemeAction(theme: Theme) {
    const copy = duplicateTheme(theme);
    app.settings.customThemes = [...customThemes, copy];
    persist();
    editTheme(copy);
  }
  function removeTheme(id: string) {
    app.settings.customThemes = customThemes.filter((t) => t.id !== id);
    if (activeId === id) selectTheme("system");
    persist();
  }

  // --- Terminal theme editor (draft) --------------------------------------
  let termEditorOpen = $state(false);
  let termDraft = $state<TerminalThemePreset | null>(null);
  let termIsNew = $state(false);
  let termOriginalId: string | null = null;

  function newTermTheme() {
    const base = app.resolveActiveTerminalTheme();
    const name = i18n.t("appearance.newThemeName");
    const baseKind: "light" | "dark" = base?.base ?? app.resolveActiveTheme().base;
    const seeded = terminalTemplateFor(baseKind);
    seeded.id = newTerminalThemeId();
    seeded.name = name;
    if (base) {
      Object.assign(seeded, duplicateTerminalTheme(base, name));
      seeded.base = baseKind;
    }
    termDraft = seeded;
    termIsNew = true;
    termOriginalId = null;
    app.previewTerminalTheme = termDraft;
    termEditorOpen = true;
  }
  function editTermTheme(preset: TerminalThemePreset) {
    termDraft = structuredClone($state.snapshot(preset)) as TerminalThemePreset;
    termIsNew = false;
    termOriginalId = preset.id;
    app.previewTerminalTheme = termDraft;
    termEditorOpen = true;
  }
  function closeTermEditor(save: boolean) {
    if (!termDraft) return;
    if (save) {
      if (termIsNew) {
        app.settings.terminalThemes = [...termThemes, termDraft];
      } else {
        app.settings.terminalThemes = termThemes.map((t) => (t.id === termOriginalId ? termDraft! : t));
      }
      app.settings.activeTerminalThemeId = termDraft.id;
      persist();
    }
    app.previewTerminalTheme = null;
    termEditorOpen = false;
    termDraft = null;
  }
  function duplicateTermAction(preset: TerminalThemePreset) {
    const copy = duplicateTerminalTheme(preset);
    app.settings.terminalThemes = [...termThemes, copy];
    persist();
    editTermTheme(copy);
  }
  function removeTermTheme(id: string) {
    app.settings.terminalThemes = termThemes.filter((t) => t.id !== id);
    if (activeTermId === id) selectTerm(TERMINAL_INHERIT_ID);
    persist();
  }

  // --- Import / export (shared) -------------------------------------------
  let pasteOpen = $state(false);
  let pasteText = $state("");
  let pasteKind: "theme" | "terminal" = "theme";
  let importingKind = $state<"theme" | "terminal" | null>(null);

  function openPaste(kind: "theme" | "terminal") {
    pasteKind = kind;
    pasteText = "";
    error = null;
    notice = null;
    pasteOpen = true;
  }
  async function importFile(kind: "theme" | "terminal") {
    error = null;
    notice = null;
    importingKind = kind;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      // Multi-select: each file may itself carry one theme or a whole list.
      const picked = await open({ multiple: true, filters: [{ name: "Theme JSON", extensions: ["json"] }] });
      if (picked == null) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return;
      const raws: string[] = [];
      for (const p of paths) {
        const { content } = await fsReadFile(p);
        raws.push(content);
      }
      importRaws(kind, raws);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      importingKind = null;
    }
  }
  /** Single-source paste import (one text blob that may hold one theme or a list). */
  function importJson(kind: "theme" | "terminal", raw: string) {
    importRaws(kind, [raw]);
  }
  /** Import one or more JSON blobs (files or a pasted document). Each blob may be
   *  a single theme, an array of themes, or a `{ themes: [...] }` wrapper; results
   *  accumulate across every blob and the last valid one becomes active. */
  function importRaws(kind: "theme" | "terminal", raws: string[]) {
    error = null;
    notice = null;
    const errors: string[] = [];
    const parseEach = (raw: string): unknown | undefined => {
      try {
        return JSON.parse(raw);
      } catch {
        errors.push(i18n.t("appearance.invalidJson"));
        return undefined;
      }
    };
    if (kind === "theme") {
      const added: Theme[] = [];
      for (const raw of raws) {
        const parsed = parseEach(raw);
        if (parsed === undefined) continue;
        const { themes, errors: errs } = normalizeImportedThemes(parsed);
        added.push(...themes);
        errors.push(...errs);
      }
      if (added.length) {
        app.settings.customThemes = [...customThemes, ...added];
        app.settings.activeThemeId = added[added.length - 1].id;
        persist();
      }
      finishImport(added.length, errors);
    } else {
      const added: TerminalThemePreset[] = [];
      for (const raw of raws) {
        const parsed = parseEach(raw);
        if (parsed === undefined) continue;
        const { presets, errors: errs } = normalizeImportedTerminalThemes(parsed);
        added.push(...presets);
        errors.push(...errs);
      }
      if (added.length) {
        app.settings.terminalThemes = [...termThemes, ...added];
        app.settings.activeTerminalThemeId = added[added.length - 1].id;
        persist();
      }
      finishImport(added.length, errors);
    }
  }
  /** Report the outcome of a batch import: a success line when anything landed
   *  (with a soft warning for any skipped entries), else the first error. */
  function finishImport(count: number, errors: string[]) {
    if (count > 0) {
      notice = i18n.plural(count, "appearance.importedOne", "appearance.importedMany");
      if (errors.length) error = i18n.plural(errors.length, "appearance.skippedOne", "appearance.skippedMany");
      pasteOpen = false;
    } else {
      error = errors[0] ?? i18n.t("appearance.invalidJson");
    }
  }
  async function exportFile(name: string, json: string) {
    error = null;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: `${name.replace(/[^\w.-]+/g, "-")}.json`, filters: [{ name: "Theme JSON", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      await fsWriteFile(path, json);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const appBase = $derived(app.resolveActiveTheme().base);

  // --- Terminal selection: one theme, or a separate one per light/dark -------
  const termMode = $derived(app.settings.terminalThemeMode ?? "single");
  const termLightId = $derived(app.settings.terminalThemeLightId ?? TERMINAL_INHERIT_ID);
  const termDarkId = $derived(app.settings.terminalThemeDarkId ?? TERMINAL_INHERIT_ID);
  function setTermMode(separate: boolean) {
    app.settings.terminalThemeMode = separate ? "scheme" : "single";
    persist();
  }
  function setTermScheme(which: "light" | "dark", id: string) {
    if (which === "light") app.settings.terminalThemeLightId = id;
    else app.settings.terminalThemeDarkId = id;
    persist();
  }
  const presetBase = (p: TerminalThemePreset): "light" | "dark" => (p.base === "light" ? "light" : "dark");

  // --- Name list + live color preview (local; does NOT apply to the whole app) --
  // The theme lists show one name per row; clicking a row previews its colors in
  // the side panel, and "Use" applies it. Preview ids default to the active
  // selection and are kept valid as the lists change.
  const SYSTEM_ID = "system";
  let previewThemeId = $state<string>(untrack(() => activeId));
  $effect(() => {
    const known = previewThemeId === SYSTEM_ID || app.allThemes().some((t) => t.id === previewThemeId);
    if (!known) previewThemeId = activeId;
  });
  const previewTheme = $derived(app.allThemes().find((t) => t.id === previewThemeId));
  // System has no single palette — preview the OS-resolved light/dark theme.
  const previewAppColors = $derived(
    previewThemeId === SYSTEM_ID ? app.resolveActiveTheme().colors : previewTheme?.colors,
  );
  const previewAppName = $derived(
    previewThemeId === SYSTEM_ID ? i18n.t("settings.theme.system") : (previewTheme?.name ?? ""),
  );

  const darkThemes = $derived(termThemes.filter((p) => presetBase(p) === "dark"));
  const lightThemes = $derived(termThemes.filter((p) => presetBase(p) === "light"));

  // Per-scope terminal preview: single mode has one list+preview; "separate
  // schemes" mode has a dark and a light list, each with its own preview terminal
  // (the surrounding UI stays on the app theme — only the mini terminal recolors).
  type TermScope = "single" | "dark" | "light";
  let previewTermSingle = $state<string>(untrack(() => activeTermId));
  let previewTermDark = $state<string>(untrack(() => termDarkId));
  let previewTermLight = $state<string>(untrack(() => termLightId));
  $effect(() => { if (previewTermSingle !== TERMINAL_INHERIT_ID && !termThemes.some((p) => p.id === previewTermSingle)) previewTermSingle = activeTermId; });
  $effect(() => { if (previewTermDark !== TERMINAL_INHERIT_ID && !termThemes.some((p) => p.id === previewTermDark)) previewTermDark = termDarkId; });
  $effect(() => { if (previewTermLight !== TERMINAL_INHERIT_ID && !termThemes.some((p) => p.id === previewTermLight)) previewTermLight = termLightId; });

  const termPreviewId = (scope: TermScope) =>
    scope === "dark" ? previewTermDark : scope === "light" ? previewTermLight : previewTermSingle;
  function setTermPreview(scope: TermScope, id: string) {
    if (scope === "dark") previewTermDark = id;
    else if (scope === "light") previewTermLight = id;
    else previewTermSingle = id;
  }
  const termActiveId = (scope: TermScope) =>
    scope === "dark" ? termDarkId : scope === "light" ? termLightId : activeTermId;
  function useTerm(scope: TermScope, id: string) {
    if (scope === "single") selectTerm(id);
    else setTermScheme(scope, id);
    setTermPreview(scope, id);
  }
  function termColorsFor(id: string) {
    const p = termThemes.find((x) => x.id === id) ?? null;
    return resolveTerminal(p ? presetBase(p) : appBase, p).theme;
  }
  const termNameFor = (id: string) =>
    termThemes.find((x) => x.id === id)?.name ?? i18n.t("appearance.inherit");

  // The color roles listed under the app-theme preview (label i18n key → color key).
  const APP_SWATCHES = [
    ["appearance.color.background", "background"],
    ["appearance.color.foreground", "foreground"],
    ["appearance.color.primary", "primary"],
    ["appearance.color.secondary", "secondary"],
    ["appearance.color.accent", "accent"],
    ["appearance.color.muted", "muted"],
    ["appearance.color.destructive", "destructive"],
    ["appearance.color.border", "border"],
  ] as const;
</script>

<div class="flex flex-col gap-6">
  {#if notice}<p class={cn("text-primary", text.body)}>{notice}</p>{/if}
  {#if error}<p class={cn("text-destructive", text.body)}>{error}</p>{/if}

  <!-- ===== Interface ===== -->
  <SettingsSection title={i18n.t("appearance.tabInterface")} description={i18n.t("appearance.interfaceDesc")}>
    <!-- Fonts + Themes as section items (label left, controls right) -->
    <div class="divide-y divide-border/60">
      {#each [["title", "appearance.fontTitle", "appearance.fontTitleDesc"], ["body", "appearance.fontBody", "appearance.fontBodyDesc"], ["mono", "appearance.fontMono", "appearance.fontMonoDesc"]] as [key, labelKey, descKey] (key)}
        {@const k = key as "title" | "body" | "mono"}
        <SettingsRow label={i18n.t(labelKey as never)} description={i18n.t(descKey as never)}>
          {#snippet control()}
            <FontPicker
              value={app.settings.fonts?.[k]}
              placeholder={DEFAULT_FONTS[k].split(",")[0].replace(/"/g, "")}
              bundled={k === "mono" ? [] : [...BUNDLED_FONTS]}
              clearLabel={i18n.t("appearance.fontDefault")}
              triggerClass="w-64"
              onChange={(v) => { ensureFonts()[k] = v; persist(); }}
            />
          {/snippet}
        </SettingsRow>
      {/each}
      <SettingsRow label={i18n.t("appearance.themesLabel")} description={i18n.t("appearance.themesRowDesc")}>
        {#snippet control()}
          <div class="flex flex-wrap items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" disabled={importingKind !== null} onclick={() => importFile("theme")}>
              {#if importingKind === "theme"}
                <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
              {:else}
                <UploadIcon data-icon="inline-start" />
              {/if}
              {i18n.t("appearance.import")}
            </Button>
            <Button variant="outline" size="sm" onclick={() => openPaste("theme")}><ClipboardPasteIcon data-icon="inline-start" />{i18n.t("appearance.paste")}</Button>
            <Button size="sm" onclick={newTheme}><PlusIcon data-icon="inline-start" />{i18n.t("appearance.newTheme")}</Button>
          </div>
        {/snippet}
      </SettingsRow>
    </div>

    <!-- Theme name list (scrolls) + a live color preview -->
    <div class="mt-4 grid items-start gap-3 lg:grid-cols-2">
      <div class="uxnan-scroll max-h-80 overflow-y-auto rounded-lg border border-border/50 bg-background/40">
        <div class="divide-y divide-border/50">
          {@render themeRow(SYSTEM_ID, i18n.t("settings.theme.system"), null)}
          {#each app.allThemes() as theme (theme.id)}
            {@render themeRow(theme.id, theme.name, theme)}
          {/each}
        </div>
      </div>
      {@render appPreview()}
    </div>
    </SettingsSection>

  <!-- ===== Terminal ===== -->
  <SettingsSection title={i18n.t("appearance.tabTerminal")} description={i18n.t("appearance.terminalDesc")}>
    <!-- Typography + Themes as section items -->
    <div class="divide-y divide-border/60">
      <SettingsRow label={i18n.t("terminalTheme.font")} description={i18n.t("appearance.termFamilyDesc")}>
        {#snippet control()}
          <FontPicker
            value={tf.fontFamily ?? undefined}
            placeholder={termFontBase.fontFamily.split(",")[0].replace(/"/g, "")}
            clearLabel={i18n.t("appearance.fontInherit")}
            triggerClass="w-64"
            onChange={(v) => setTermFontStr("fontFamily", v ?? "")}
          />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("terminalTheme.size")} description={i18n.t("appearance.termSizeDesc")}>
        {#snippet control()}
          <Input type="number" class="w-24" value={tf.fontSize ?? ""} placeholder={String(termFontBase.fontSize)} oninput={(e) => setTermFontNum("fontSize", e.currentTarget.value)} />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("terminalTheme.lineHeight")} description={i18n.t("appearance.termLineHeightDesc")}>
        {#snippet control()}
          <Input type="number" step="0.05" class="w-24" value={tf.lineHeight ?? ""} placeholder={String(termFontBase.lineHeight)} oninput={(e) => setTermFontNum("lineHeight", e.currentTarget.value)} />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("terminalTheme.letterSpacing")} description={i18n.t("appearance.termLetterSpacingDesc")}>
        {#snippet control()}
          <Input type="number" step="0.5" class="w-24" value={tf.letterSpacing ?? ""} placeholder={String(termFontBase.letterSpacing)} oninput={(e) => setTermFontNum("letterSpacing", e.currentTarget.value)} />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("terminalTheme.ligatures")} description={i18n.t("appearance.termLigaturesDesc")}>
        {#snippet control()}
          <Switch checked={tf.ligatures ?? false} onCheckedChange={(c) => { ensureTermFonts().ligatures = c; persist(); }} />
        {/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("appearance.themesLabel")} description={i18n.t("appearance.termThemesRowDesc")}>
        {#snippet control()}
          <div class="flex flex-wrap items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" disabled={importingKind !== null} onclick={() => importFile("terminal")}>
              {#if importingKind === "terminal"}
                <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
              {:else}
                <UploadIcon data-icon="inline-start" />
              {/if}
              {i18n.t("appearance.import")}
            </Button>
            <Button variant="outline" size="sm" onclick={() => openPaste("terminal")}><ClipboardPasteIcon data-icon="inline-start" />{i18n.t("appearance.paste")}</Button>
            <Button size="sm" onclick={newTermTheme}><PlusIcon data-icon="inline-start" />{i18n.t("appearance.newTheme")}</Button>
          </div>
        {/snippet}
      </SettingsRow>
    </div>

    <!-- Optional: a separate terminal theme per light/dark app theme -->
    <label class="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 px-3.5 py-2.5">
      <div class="min-w-0">
        <div class={cn("text-foreground", text.body)}>{i18n.t("appearance.separateSchemes")}</div>
        <p class={text.meta}>{i18n.t("appearance.separateSchemesDesc")}</p>
      </div>
      <Switch checked={termMode === "scheme"} onCheckedChange={setTermMode} />
    </label>

    <!-- Theme lists (scroll) + live mini-terminal previews -->
    {#if termMode === "single"}
      <div class="mt-4">{@render termBlock("single", termThemes)}</div>
    {:else}
      <div class="mt-4 space-y-1.5">
        <span class={cn("px-1", text.section)}>{i18n.t("appearance.darkThemes")}</span>
        {@render termBlock("dark", darkThemes)}
      </div>
      <div class="mt-5 space-y-1.5">
        <span class={cn("px-1", text.section)}>{i18n.t("appearance.lightThemes")}</span>
        {@render termBlock("light", lightThemes)}
      </div>
    {/if}
    </SettingsSection>
</div>

{#snippet appPreview()}
  {@const c = previewAppColors}
  {#if c}
    <div class="overflow-hidden rounded-lg border" style:background-color={c.background} style:border-color={c.border} style:color={c.foreground}>
      <div class="flex flex-col gap-3.5 p-4">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-sm font-semibold" style:color={c.foreground}>{previewAppName}</span>
          <span class="shrink-0 rounded px-2 py-0.5 text-[10px]" style:background-color={c.muted} style:color={c.mutedForeground}>{i18n.t("appearance.previewLabel")}</span>
        </div>
        <p class="text-[13px]" style:color={c.mutedForeground}>The quick brown fox jumps over the lazy dog.</p>
        <div class="grid grid-cols-4 gap-2.5">
          {#each APP_SWATCHES as [labelKey, colorKey] (colorKey)}
            <div class="flex flex-col gap-1">
              <span class="h-10 rounded-md" style:background-color={c[colorKey]} style="box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent)"></span>
              <span class="truncate text-[10px]" style:color={c.mutedForeground}>{i18n.t(labelKey as never)}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <p class={cn("rounded-lg border border-border/50 py-10 text-center", text.meta)}>{i18n.t("appearance.selectToPreview")}</p>
  {/if}
{/snippet}

{#snippet themeMenu(theme: Theme)}
  {@const isCustom = !BUILTIN_IDS.has(theme.id)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="ghost" size="icon" class={cn(iconButton.action, "shrink-0")} title={i18n.t("common.more")} {...props}><MoreVerticalIcon class={icon.button} /></Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-44">
      {#if isCustom}<DropdownMenu.Item class={text.menu} onclick={() => editTheme(theme)}><PencilIcon class={icon.button} />{i18n.t("appearance.edit")}</DropdownMenu.Item>{/if}
      <DropdownMenu.Item class={text.menu} onclick={() => duplicateThemeAction(theme)}><CopyIcon class={icon.button} />{i18n.t("appearance.duplicate")}</DropdownMenu.Item>
      <DropdownMenu.Item class={text.menu} onclick={() => exportFile(theme.name, themeToJson(theme))}><DownloadIcon class={icon.button} />{i18n.t("appearance.exportFile")}</DropdownMenu.Item>
      <DropdownMenu.Item class={text.menu} onclick={() => void clipboardWrite(themeToJson(theme))}><CopyIcon class={icon.button} />{i18n.t("appearance.copyJson")}</DropdownMenu.Item>
      {#if isCustom}
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" class={text.menu} onclick={() => removeTheme(theme.id)}><Trash2Icon class={icon.button} />{i18n.t("common.remove")}</DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

{#snippet termMenu(preset: TerminalThemePreset)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="ghost" size="icon" class={cn(iconButton.action, "shrink-0")} title={i18n.t("common.more")} {...props}><MoreVerticalIcon class={icon.button} /></Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-44">
      <DropdownMenu.Item class={text.menu} onclick={() => editTermTheme(preset)}><PencilIcon class={icon.button} />{i18n.t("appearance.edit")}</DropdownMenu.Item>
      <DropdownMenu.Item class={text.menu} onclick={() => duplicateTermAction(preset)}><CopyIcon class={icon.button} />{i18n.t("appearance.duplicate")}</DropdownMenu.Item>
      <DropdownMenu.Item class={text.menu} onclick={() => exportFile(preset.name, terminalThemeToJson(preset))}><DownloadIcon class={icon.button} />{i18n.t("appearance.exportFile")}</DropdownMenu.Item>
      <DropdownMenu.Item class={text.menu} onclick={() => void clipboardWrite(terminalThemeToJson(preset))}><CopyIcon class={icon.button} />{i18n.t("appearance.copyJson")}</DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item variant="destructive" class={text.menu} onclick={() => removeTermTheme(preset.id)}><Trash2Icon class={icon.button} />{i18n.t("common.remove")}</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

{#snippet termPreview(scope: TermScope)}
  {@const t = termColorsFor(termPreviewId(scope))}
  <div class="overflow-hidden rounded-lg border border-border/50 font-mono text-[11px] leading-5" style:background-color={t.background} style:color={t.foreground}>
    <div class="flex items-center gap-1.5 border-b px-3 py-1.5" style="border-color: color-mix(in srgb, currentColor 15%, transparent)">
      <span class="size-2 rounded-full" style:background-color={t.red}></span>
      <span class="size-2 rounded-full" style:background-color={t.yellow}></span>
      <span class="size-2 rounded-full" style:background-color={t.green}></span>
      <span class="ml-1 truncate text-[10px] opacity-70">{termNameFor(termPreviewId(scope))}</span>
    </div>
    <div class="flex select-none flex-col gap-0.5 p-3">
      <div><span style:color={t.green}>➜</span> <span style:color={t.cyan}>~/uxnan</span> <span style:color={t.blue}>git:(</span><span style:color={t.red}>main</span><span style:color={t.blue}>)</span> npm run build</div>
      <div>Compiling <span style:color={t.yellow}>uxnan-desktop</span>…</div>
      <div><span style:color={t.green}>✓</span> built in 1.2s</div>
      <div><span style:color={t.red}>error</span>: could not resolve <span style:color={t.magenta}>./missing</span></div>
      <div><span style:background-color={t.selectionBackground ?? t.blue} style:color={t.background}>selected text</span> plain output</div>
      <div><span style:color={t.magenta}>const</span> answer = <span style:color={t.yellow}>42</span>;</div>
    </div>
  </div>
{/snippet}

{#snippet termRow(scope: TermScope, id: string, name: string, preset: TerminalThemePreset | null)}
  {@const isActive = termActiveId(scope) === id}
  <div class={cn("flex items-center gap-2 px-3 py-2 transition-colors", termPreviewId(scope) === id ? "bg-accent/60" : "hover:bg-foreground/[0.04]")}>
    <button type="button" class="min-w-0 flex-1 truncate text-left text-[13px] text-foreground" onclick={() => setTermPreview(scope, id)}>{name}</button>
    {#if isActive}<CheckIcon class={cn(icon.decorative, "shrink-0 text-primary")} />{/if}
    <Button variant={isActive ? "ghost" : "outline"} size="sm" class="h-7 shrink-0 px-2.5 text-xs" disabled={isActive} onclick={() => useTerm(scope, id)}>
      {i18n.t(isActive ? "appearance.inUse" : "appearance.use")}
    </Button>
    {#if preset}{@render termMenu(preset)}{/if}
  </div>
{/snippet}

{#snippet themeRow(id: string, name: string, theme: Theme | null)}
  {@const isActive = activeId === id}
  <div class={cn("flex items-center gap-2 px-3 py-2 transition-colors", previewThemeId === id ? "bg-accent/60" : "hover:bg-foreground/[0.04]")}>
    <button type="button" class="min-w-0 flex-1 truncate text-left text-[13px] text-foreground" onclick={() => (previewThemeId = id)}>{name}</button>
    {#if isActive}<CheckIcon class={cn(icon.decorative, "shrink-0 text-primary")} />{/if}
    <Button variant={isActive ? "ghost" : "outline"} size="sm" class="h-7 shrink-0 px-2.5 text-xs" disabled={isActive} onclick={() => { selectTheme(id); previewThemeId = id; }}>
      {i18n.t(isActive ? "appearance.inUse" : "appearance.use")}
    </Button>
    {#if theme}{@render themeMenu(theme)}{/if}
  </div>
{/snippet}

{#snippet termBlock(scope: TermScope, presets: TerminalThemePreset[])}
  <div class="grid items-start gap-3 lg:grid-cols-2">
    <div class="uxnan-scroll max-h-80 overflow-y-auto rounded-lg border border-border/50 bg-background/40">
      <div class="divide-y divide-border/50">
        {@render termRow(scope, TERMINAL_INHERIT_ID, i18n.t("appearance.inherit"), null)}
        {#each presets as preset (preset.id)}
          {@render termRow(scope, preset.id, preset.name, preset)}
        {/each}
      </div>
    </div>
    {@render termPreview(scope)}
  </div>
{/snippet}

{#if themeDraft}
  <ThemeEditor
    bind:open={themeEditorOpen}
    theme={themeDraft}
    title={themeIsNew ? i18n.t("appearance.newTheme") : i18n.t("appearance.editTheme")}
    onsave={() => closeThemeEditor(true)}
    oncancel={() => closeThemeEditor(false)}
  />
{/if}
{#if termDraft}
  <TerminalThemeEditor
    bind:open={termEditorOpen}
    preset={termDraft}
    title={termIsNew ? i18n.t("appearance.newTheme") : i18n.t("appearance.editTheme")}
    onsave={() => closeTermEditor(true)}
    oncancel={() => closeTermEditor(false)}
  />
{/if}

<Dialog.Root bind:open={pasteOpen}>
  <Dialog.Content class="sm:max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("appearance.pasteTitle")}</Dialog.Title>
      <Dialog.Description>{i18n.t("appearance.pasteDesc")}</Dialog.Description>
    </Dialog.Header>
    <Textarea class="h-56 font-mono text-[11px]" bind:value={pasteText} spellcheck={false} />
    {#if error}<p class={cn("text-destructive", text.body)}>{error}</p>{/if}
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (pasteOpen = false)}>{i18n.t("common.cancel")}</Button>
      <Button disabled={!pasteText.trim()} onclick={() => importJson(pasteKind, pasteText)}>{i18n.t("appearance.import")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
