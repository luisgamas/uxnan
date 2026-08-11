<script lang="ts">
  // Theme editor dialog. Edits a DRAFT theme (not yet saved): changes preview
  // live (the parent points app.previewTheme at this draft), and only persist
  // when the user hits Save. Cancel / closing discards. Visual editor (per-token
  // color inputs + fonts + base) plus a raw JSON tab.
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { Label } from "$lib/components/ui/label";
  import {
    THEME_TOKENS,
    DEFAULT_FONTS,
    BUNDLED_FONTS,
    themeToJson,
    type Theme,
    type ThemeColors,
  } from "$lib/theme";
  import { cn } from "$lib/utils";
  import { field, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import FontPicker from "./FontPicker.svelte";
  import EditorModeTabs from "./EditorModeTabs.svelte";
  import { Icon } from "$lib/components/ui/icon";

  let {
    open = $bindable(false),
    theme,
    title,
    onsave,
    oncancel,
  }: {
    open?: boolean;
    theme: Theme;
    title: string;
    onsave: () => void;
    oncancel: () => void;
  } = $props();

  let mode = $state<"visual" | "json">("visual");
  let jsonText = $state("");
  let jsonError = $state<string | null>(null);

  $effect(() => {
    if (open) {
      jsonText = themeToJson(theme);
      jsonError = null;
      mode = "visual";
    }
  });

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      theme.name = typeof parsed.name === "string" ? parsed.name : theme.name;
      if (parsed.base === "light" || parsed.base === "dark") theme.base = parsed.base;
      if (typeof parsed.radius === "string") theme.radius = parsed.radius;
      if (parsed.fonts && typeof parsed.fonts === "object") theme.fonts = parsed.fonts;
      if (parsed.colors && typeof parsed.colors === "object") {
        for (const key of THEME_TOKENS) {
          const v = parsed.colors[key];
          if (typeof v === "string") theme.colors[key] = v;
        }
      }
      jsonError = null;
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  const baseLabel = $derived(
    theme.base === "dark" ? i18n.t("settings.theme.dark") : i18n.t("settings.theme.light"),
  );

  function ensureFonts() {
    if (!theme.fonts) theme.fonts = {};
    return theme.fonts;
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) oncancel(); }}>
  <Dialog.Content size="large" class="flex max-h-[85vh] flex-col">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>

    <EditorModeTabs bind:value={mode} onJsonSelect={() => (jsonText = themeToJson(theme))}>
      {#snippet children()}
      <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto pr-1">
      <Tabs.Content value="visual">
        <div class="flex flex-col gap-3">
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <Label class={text.meta}>{i18n.t("appearance.name")}</Label>
              <Input bind:value={theme.name} />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={text.meta}>{i18n.t("appearance.base")}</Label>
              <Select.Root
                type="single"
                value={theme.base}
                onValueChange={(v) => { if (v === "light" || v === "dark") theme.base = v; }}
              >
                <Select.Trigger class={field.editorSelect}>{baseLabel}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="light" label={i18n.t("settings.theme.light")}>{i18n.t("settings.theme.light")}</Select.Item>
                  <Select.Item value="dark" label={i18n.t("settings.theme.dark")}>{i18n.t("settings.theme.dark")}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each [["title", "appearance.fontTitle"], ["body", "appearance.fontBody"], ["mono", "appearance.fontMono"]] as [key, labelKey] (key)}
              {@const k = key as "title" | "body" | "mono"}
              <div class="flex min-w-0 flex-col gap-1">
                <Label class={text.meta}>{i18n.t(labelKey as never)}</Label>
                <FontPicker
                  value={theme.fonts?.[k]}
                  placeholder={DEFAULT_FONTS[k].split(",")[0].replace(/"/g, "")}
                  bundled={k === "mono" ? [] : [...BUNDLED_FONTS]}
                  clearLabel={i18n.t("appearance.fontDefault")}
                  onChange={(v) => (ensureFonts()[k] = v)}
                />
              </div>
            {/each}
          </div>

          <div class="flex flex-col gap-1">
            <span class={text.section}>{i18n.t("appearance.colors")}</span>
            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {#each THEME_TOKENS as token (token)}
                <div class="flex items-center gap-1.5">
                  <span class="size-5 shrink-0 rounded border border-border" style:background-color={theme.colors[token]}></span>
                  <TooltipSimple title={token}>
                    {#snippet children(tp)}
                      <span {...tp} class={cn(field.editorLabel, "font-mono", text.indicator)}>{token}</span>
                    {/snippet}
                  </TooltipSimple>
                  <Input density="compact" class={cn(field.editor, "flex-1")} bind:value={theme.colors[token as keyof ThemeColors]} />
                </div>
              {/each}
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class={cn(field.editorLabel, text.meta)}>{i18n.t("appearance.radius")}</span>
              <Input density="compact" class={cn(field.editor, "flex-1")} value={theme.radius ?? ""} oninput={(e) => (theme.radius = e.currentTarget.value || undefined)} />
            </div>
          </div>
        </div>
      </Tabs.Content>
      <Tabs.Content value="json">
        <div class="flex flex-col gap-2">
          <p class={text.meta}>{i18n.t("appearance.jsonHelp")}</p>
          <Textarea class="h-72 font-mono text-[11px]" bind:value={jsonText} spellcheck={false} />
          {#if jsonError}<p class={cn("text-destructive", text.body)}>{jsonError}</p>{/if}
          <Button variant="outline" size="sm" class="self-start" onclick={applyJson}>{i18n.t("appearance.applyJson")}</Button>
        </div>
      </Tabs.Content>
      </div>
      {/snippet}
    </EditorModeTabs>

    <Dialog.Footer>
      <Button variant="outline" onclick={oncancel}>{i18n.t("common.cancel")}</Button>
      <Button onclick={onsave}>{i18n.t("appearance.save")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
