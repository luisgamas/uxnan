<script lang="ts">
  // Theme editor dialog. Edits a DRAFT theme (not yet saved): changes preview
  // live (the parent points app.previewTheme at this draft), and only persist
  // when the user hits Save. Cancel / closing discards. Visual editor (per-token
  // color inputs + fonts + base) plus a raw JSON tab.
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Label } from "$lib/components/ui/label";
  import {
    THEME_TOKENS,
    DEFAULT_FONTS,
    themeToJson,
    type Theme,
    type ThemeColors,
  } from "$lib/theme";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import CodeIcon from "@lucide/svelte/icons/code";
  import SlidersIcon from "@lucide/svelte/icons/sliders-horizontal";

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

  const COMMON_FONTS = ["Inter", "Roboto", "Segoe UI", "system-ui", "JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas"];

  function ensureFonts() {
    if (!theme.fonts) theme.fonts = {};
    return theme.fonts;
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) oncancel(); }}>
  <Dialog.Content class="flex max-h-[85vh] flex-col gap-3 sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>

    <div class="inline-flex shrink-0 self-start overflow-hidden rounded-md border border-border">
      <button
        type="button"
        class={cn("flex items-center gap-1 px-2 py-0.5", text.indicator, mode === "visual" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
        onclick={() => (mode = "visual")}
      >
        <SlidersIcon class="size-3.5" />{i18n.t("appearance.visual")}
      </button>
      <button
        type="button"
        class={cn("flex items-center gap-1 border-l border-border/60 px-2 py-0.5", text.indicator, mode === "json" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
        onclick={() => { jsonText = themeToJson(theme); mode = "json"; }}
      >
        <CodeIcon class="size-3.5" />JSON
      </button>
    </div>

    <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto pr-1">
      {#if mode === "visual"}
        <div class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-2">
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
                <Select.Trigger>{baseLabel}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="light" label={i18n.t("settings.theme.light")}>{i18n.t("settings.theme.light")}</Select.Item>
                  <Select.Item value="dark" label={i18n.t("settings.theme.dark")}>{i18n.t("settings.theme.dark")}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <datalist id="uxnan-fonts-editor">
            {#each COMMON_FONTS as f (f)}<option value={f}></option>{/each}
          </datalist>
          <div class="grid grid-cols-3 gap-2">
            {#each [["title", "appearance.fontTitle"], ["body", "appearance.fontBody"], ["mono", "appearance.fontMono"]] as [key, labelKey] (key)}
              <div class="flex flex-col gap-1">
                <Label class={text.meta}>{i18n.t(labelKey as never)}</Label>
                <Input
                  list="uxnan-fonts-editor"
                  placeholder={DEFAULT_FONTS[key as "title" | "body" | "mono"].split(",")[0]}
                  value={theme.fonts?.[key as "title" | "body" | "mono"] ?? ""}
                  oninput={(e) => (ensureFonts()[key as "title" | "body" | "mono"] = e.currentTarget.value || undefined)}
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
                  <span class={cn("w-28 shrink-0 truncate font-mono", text.indicator)} title={token}>{token}</span>
                  <Input class="h-7 min-w-0 flex-1 font-mono text-[11px]" bind:value={theme.colors[token as keyof ThemeColors]} />
                </div>
              {/each}
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class={cn("w-28 shrink-0", text.meta)}>{i18n.t("appearance.radius")}</span>
              <Input class="h-7 flex-1" value={theme.radius ?? ""} oninput={(e) => (theme.radius = e.currentTarget.value || undefined)} />
            </div>
          </div>
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          <p class={text.meta}>{i18n.t("appearance.jsonHelp")}</p>
          <Textarea class="h-72 font-mono text-[11px]" bind:value={jsonText} spellcheck={false} />
          {#if jsonError}<p class={cn("text-destructive", text.body)}>{jsonError}</p>{/if}
          <Button variant="outline" size="sm" class="self-start" onclick={applyJson}>{i18n.t("appearance.applyJson")}</Button>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={oncancel}>{i18n.t("common.cancel")}</Button>
      <Button onclick={onsave}>{i18n.t("appearance.save")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
