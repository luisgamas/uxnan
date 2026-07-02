<script lang="ts">
  // Appearance pane: two sub-tabs.
  //  - Interface: app theme grid (System + built-ins + custom), a global font
  //    override (wins over each theme's fonts), and the theme editor.
  //  - Terminal: terminal theme grid (Inherit + presets) that overrides the app
  //    theme in the terminal only, plus the terminal theme editor.
  // New/Edit open a DRAFT in the editor (previewed live, saved only on Save).
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
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
    normalizeImportedTheme,
    normalizeImportedTerminalTheme,
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
  import { icon, iconButton, surface, text } from "$lib/design";
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

  // Shared recipes so every appearance sub-block reads like the rest of Settings:
  // a soft card band for grouped rows, a selectable theme card in the app's
  // neutral selection language (`surface.active`), and the theme-card grid.
  const band = "rounded-xl border border-border/50 bg-card/50 px-5 py-1.5 shadow-xs";
  const grid = "grid grid-cols-2 gap-2.5 sm:grid-cols-3";
  function cardClass(selected: boolean): string {
    return cn(
      "flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
      selected ? cn(surface.active, "border-transparent") : "border-border/60 hover:bg-foreground/[0.04]",
    );
  }

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
  const swatchKeys = ["background", "primary", "accent", "secondary", "foreground"] as const;

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

  function openPaste(kind: "theme" | "terminal") {
    pasteKind = kind;
    pasteText = "";
    error = null;
    pasteOpen = true;
  }
  async function importFile(kind: "theme" | "terminal") {
    error = null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: "Theme JSON", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      const { content } = await fsReadFile(path);
      importJson(kind, content);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  function importJson(kind: "theme" | "terminal", raw: string) {
    error = null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      error = i18n.t("appearance.invalidJson");
      return;
    }
    if (kind === "theme") {
      const { theme, error: err } = normalizeImportedTheme(parsed);
      if (err || !theme) return (error = err ?? i18n.t("appearance.invalidJson"));
      app.settings.customThemes = [...customThemes, theme];
      app.settings.activeThemeId = theme.id;
    } else {
      const { preset, error: err } = normalizeImportedTerminalTheme(parsed);
      if (err || !preset) return (error = err ?? i18n.t("appearance.invalidJson"));
      app.settings.terminalThemes = [...termThemes, preset];
      app.settings.activeTerminalThemeId = preset.id;
    }
    persist();
    pasteOpen = false;
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

  /** Swatch colors for a terminal preset (Inherit = null), resolved against a
   *  base, for the card color bars. */
  function termSwatches(preset: TerminalThemePreset | null, base: "light" | "dark"): string[] {
    const t = resolveTerminal(base, preset).theme;
    return [t.background, t.foreground, t.green, t.blue, t.red];
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
  const darkThemes = $derived(termThemes.filter((p) => presetBase(p) === "dark"));
  const lightThemes = $derived(termThemes.filter((p) => presetBase(p) === "light"));
</script>

<div class="flex flex-col gap-6">
  {#if error}<p class={cn("text-destructive", text.body)}>{error}</p>{/if}

  <!-- ===== Interface ===== -->
  <SettingsSection bare title={i18n.t("appearance.tabInterface")} description={i18n.t("appearance.interfaceDesc")}>
    <div class="flex flex-col gap-6">

      <!-- Fonts (override every theme's fonts) -->
      <div class="space-y-2">
        <div class="space-y-0.5 px-1">
          <span class={text.section}>{i18n.t("appearance.fonts")}</span>
          <p class={text.meta}>{i18n.t("appearance.fontsDesc")}</p>
        </div>
        <div class={band}>
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
          </div>
        </div>
      </div>

      <!-- Themes -->
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 px-1">
          <span class={text.section}>{i18n.t("appearance.themesLabel")}</span>
          <div class="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onclick={() => importFile("theme")}><UploadIcon data-icon="inline-start" />{i18n.t("appearance.import")}</Button>
            <Button variant="outline" size="sm" onclick={() => openPaste("theme")}><ClipboardPasteIcon data-icon="inline-start" />{i18n.t("appearance.paste")}</Button>
            <Button size="sm" onclick={newTheme}><PlusIcon data-icon="inline-start" />{i18n.t("appearance.newTheme")}</Button>
          </div>
        </div>
        <!-- Scroll-capped so a large collection stays bounded, not a runaway grid. -->
        <div class="uxnan-scroll max-h-[22rem] overflow-y-auto">
          <div class={grid}>
            <button type="button" class={cardClass(activeId === "system")} onclick={() => selectTheme("system")}>
              <div class="flex h-8 overflow-hidden rounded border border-border/70">
                <div class="flex-1 bg-white"></div>
                <div class="flex-1 bg-neutral-900"></div>
              </div>
              <div class="flex items-center gap-1">
                <span class={cn("flex-1 truncate", text.body)}>{i18n.t("settings.theme.system")}</span>
                {#if activeId === "system"}<CheckIcon class={cn(icon.decorative, "text-primary")} />{/if}
              </div>
            </button>

            {#each app.allThemes() as theme (theme.id)}
              {@const isActive = activeId === theme.id}
              {@const isCustom = !BUILTIN_IDS.has(theme.id)}
              <div class={cardClass(isActive)}>
                <button type="button" class="flex flex-col gap-2 text-left" onclick={() => selectTheme(theme.id)}>
                  <div class="flex h-8 overflow-hidden rounded border border-border/70">
                    {#each swatchKeys as k (k)}<div class="flex-1" style:background-color={theme.colors[k]}></div>{/each}
                  </div>
                </button>
                <div class="flex items-center gap-1">
                  <button type="button" class={cn("min-w-0 flex-1 truncate text-left", text.body)} onclick={() => selectTheme(theme.id)}>{theme.name}</button>
                  {#if isActive}<CheckIcon class={cn(icon.decorative, "shrink-0 text-primary")} />{/if}
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
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>

    </div>
  </SettingsSection>

  <!-- ===== Terminal ===== -->
  <SettingsSection bare title={i18n.t("appearance.tabTerminal")} description={i18n.t("appearance.terminalDesc")}>
    <div class="flex flex-col gap-6">

      <!-- Typography (terminal font override — wins over each terminal theme) -->
      <div class="space-y-2">
        <div class="space-y-0.5 px-1">
          <span class={text.section}>{i18n.t("appearance.fonts")}</span>
          <p class={text.meta}>{i18n.t("appearance.terminalFontsDesc")}</p>
        </div>
        <div class={band}>
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
          </div>
        </div>
      </div>

      <!-- Terminal themes -->
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 px-1">
          <span class={text.section}>{i18n.t("appearance.themesLabel")}</span>
          <div class="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onclick={() => importFile("terminal")}><UploadIcon data-icon="inline-start" />{i18n.t("appearance.import")}</Button>
            <Button variant="outline" size="sm" onclick={() => openPaste("terminal")}><ClipboardPasteIcon data-icon="inline-start" />{i18n.t("appearance.paste")}</Button>
            <Button size="sm" onclick={newTermTheme}><PlusIcon data-icon="inline-start" />{i18n.t("appearance.newTheme")}</Button>
          </div>
        </div>
        <p class={cn("px-1", text.meta)}>{i18n.t("appearance.terminalThemesDesc")}</p>

        <!-- Optional: a separate terminal theme per light/dark app theme -->
        <div class={band}>
          <SettingsRow label={i18n.t("appearance.separateSchemes")} description={i18n.t("appearance.separateSchemesDesc")}>
            {#snippet control()}
              <Switch checked={termMode === "scheme"} onCheckedChange={setTermMode} />
            {/snippet}
          </SettingsRow>
        </div>

        {#if termMode === "single"}
          <div class="uxnan-scroll max-h-[22rem] overflow-y-auto">
            <div class={grid}>
              {@render termCard(null, "single", appBase)}
              {#each termThemes as preset (preset.id)}{@render termCard(preset, "single", presetBase(preset))}{/each}
            </div>
          </div>
        {:else}
          <div class="space-y-1.5">
            <span class={cn("px-1", text.section)}>{i18n.t("appearance.darkThemes")}</span>
            <div class="uxnan-scroll max-h-[22rem] overflow-y-auto">
              <div class={grid}>
                {@render termCard(null, "dark", "dark")}
                {#each darkThemes as preset (preset.id)}{@render termCard(preset, "dark", "dark")}{/each}
              </div>
            </div>
          </div>
          <div class="space-y-1.5">
            <span class={cn("px-1", text.section)}>{i18n.t("appearance.lightThemes")}</span>
            <div class="uxnan-scroll max-h-[22rem] overflow-y-auto">
              <div class={grid}>
                {@render termCard(null, "light", "light")}
                {#each lightThemes as preset (preset.id)}{@render termCard(preset, "light", "light")}{/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

    </div>
  </SettingsSection>
</div>

{#snippet termCard(preset: TerminalThemePreset | null, scope: "single" | "dark" | "light", base: "light" | "dark")}
  {@const id = preset ? preset.id : TERMINAL_INHERIT_ID}
  {@const selected = scope === "single" ? activeTermId === id : scope === "dark" ? termDarkId === id : termLightId === id}
  <div class={cardClass(selected)}>
    <button type="button" class="flex flex-col gap-2 text-left" onclick={() => (scope === "single" ? selectTerm(id) : setTermScheme(scope, id))}>
      <div class="flex h-8 overflow-hidden rounded border border-border/70">
        {#each termSwatches(preset, base) as c, i (i)}<div class="flex-1" style:background-color={c}></div>{/each}
      </div>
    </button>
    <div class="flex items-center gap-1">
      <button type="button" class={cn("min-w-0 flex-1 truncate text-left", text.body)} onclick={() => (scope === "single" ? selectTerm(id) : setTermScheme(scope, id))}>
        {preset ? preset.name : i18n.t("appearance.inherit")}
      </button>
      {#if selected}<CheckIcon class={cn(icon.decorative, "shrink-0 text-primary")} />{/if}
      {#if preset}
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
      {/if}
    </div>
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
