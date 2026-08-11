<script lang="ts">
  // Terminal theme editor dialog. Edits a DRAFT terminal preset (previewed live
  // via app.previewTerminalTheme), persisted only on Save. Every field overrides
  // the app theme *in the terminal only*; unset fields inherit (shown as the
  // placeholder), and an "overrides" dot marks the ones you've set.
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Label } from "$lib/components/ui/label";
  import { Switch } from "$lib/components/ui/switch";
  import { app } from "$lib/state/app.svelte";
  import {
    ANSI_TOKENS,
    TERMINAL_FIELDS,
    resolveTerminal,
    terminalThemeToJson,
    type TerminalTheme,
    type TerminalThemePreset,
  } from "$lib/theme";
  import { cn } from "$lib/utils";
  import { field, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { Icon } from "$lib/components/ui/icon";
  import FontPicker from "./FontPicker.svelte";
  import EditorModeTabs from "./EditorModeTabs.svelte";

  let {
    open = $bindable(false),
    preset,
    title,
    onsave,
    oncancel,
  }: {
    open?: boolean;
    preset: TerminalThemePreset;
    title: string;
    onsave: () => void;
    oncancel: () => void;
  } = $props();

  let mode = $state<"visual" | "json">("visual");
  let jsonText = $state("");
  let jsonError = $state<string | null>(null);

  $effect(() => {
    if (open) {
      jsonText = terminalThemeToJson(preset);
      jsonError = null;
      mode = "visual";
    }
  });

  // Inherited defaults (the app theme's terminal values) — shown as placeholders
  // and used to flag which fields are overridden.
  const inherited = $derived(resolveTerminal(app.resolveActiveTheme().base, null));
  const isSet = (key: keyof TerminalTheme) =>
    preset[key] !== undefined && preset[key] !== null && preset[key] !== "";

  function setNum(key: keyof TerminalTheme, raw: string) {
    const v = raw.trim() === "" ? undefined : Number(raw);
    (preset as unknown as Record<string, unknown>)[key] = Number.isFinite(v as number) ? v : undefined;
  }
  function setStr(key: keyof TerminalTheme, raw: string) {
    (preset as unknown as Record<string, unknown>)[key] = raw.trim() === "" ? undefined : raw;
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      if (typeof parsed.name === "string") preset.name = parsed.name;
      for (const key of TERMINAL_FIELDS) {
        const v = (parsed as Record<string, unknown>)[key];
        (preset as unknown as Record<string, unknown>)[key] = v === "" ? undefined : v;
      }
      jsonError = null;
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  const cursorLabel = $derived(
    preset.cursorStyle === "underline"
      ? i18n.t("terminalTheme.cursorUnderline")
      : preset.cursorStyle === "bar"
        ? i18n.t("terminalTheme.cursorBar")
        : i18n.t("terminalTheme.cursorBlock"),
  );

  const baseColorFields = [
    ["background", "terminalTheme.background"],
    ["foreground", "terminalTheme.foreground"],
    ["cursor", "terminalTheme.cursor"],
    ["selectionBackground", "terminalTheme.selection"],
  ] as const;
</script>

{#snippet overrideDot(on: boolean)}
  {#if on}
    <TooltipSimple title={i18n.t("terminalTheme.overrides")}>
      {#snippet children(tp)}
        <span
          {...tp}
          class={cn("size-1.5 shrink-0 rounded-full", on ? "bg-primary" : "bg-transparent")}
        ></span>
      {/snippet}
    </TooltipSimple>
  {:else}
    <span class="size-1.5 shrink-0 rounded-full bg-transparent"></span>
  {/if}
{/snippet}

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) oncancel(); }}>
  <Dialog.Content size="large" class="flex max-h-[85vh] flex-col">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{i18n.t("terminalTheme.overrideNote")}</Dialog.Description>
    </Dialog.Header>

    <EditorModeTabs bind:value={mode} onJsonSelect={() => (jsonText = terminalThemeToJson(preset))}>
      {#snippet children()}
      <div class="uxnan-scroll min-h-0 flex-1 overflow-y-auto pr-1">
      <Tabs.Content value="visual">
        <div class="flex flex-col gap-3">
          <div class="grid gap-2 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <Label class={text.meta}>{i18n.t("appearance.name")}</Label>
              <Input bind:value={preset.name} />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={text.meta}>{i18n.t("appearance.base")}</Label>
              <Select.Root type="single" value={preset.base ?? "dark"} onValueChange={(v) => { if (v === "light" || v === "dark") preset.base = v; }}>
                <Select.Trigger class={field.editorSelect}>{(preset.base ?? "dark") === "dark" ? i18n.t("settings.theme.dark") : i18n.t("settings.theme.light")}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="dark" label={i18n.t("settings.theme.dark")}>{i18n.t("settings.theme.dark")}</Select.Item>
                  <Select.Item value="light" label={i18n.t("settings.theme.light")}>{i18n.t("settings.theme.light")}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div class="col-span-2 flex flex-col gap-1 sm:col-span-3">
              <Label class={cn("flex items-center gap-1", text.meta)}>{@render overrideDot(isSet("fontFamily"))}{i18n.t("terminalTheme.font")}</Label>
              <FontPicker
                value={preset.fontFamily ?? undefined}
                placeholder={inherited.fontFamily.split(",")[0].replace(/"/g, "")}
                clearLabel={i18n.t("appearance.fontInherit")}
                onChange={(v) => setStr("fontFamily", v ?? "")}
              />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={cn("flex items-center gap-1", text.meta)}>{@render overrideDot(isSet("fontSize"))}{i18n.t("terminalTheme.size")}</Label>
              <Input density="compact" class={field.editorNumber} type="number" value={preset.fontSize ?? ""} placeholder={String(inherited.fontSize)} oninput={(e) => setNum("fontSize", e.currentTarget.value)} />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={cn("flex items-center gap-1", text.meta)}>{@render overrideDot(isSet("lineHeight"))}{i18n.t("terminalTheme.lineHeight")}</Label>
              <Input density="compact" class={field.editorNumber} type="number" step="0.05" value={preset.lineHeight ?? ""} placeholder={String(inherited.lineHeight)} oninput={(e) => setNum("lineHeight", e.currentTarget.value)} />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={cn("flex items-center gap-1", text.meta)}>{@render overrideDot(isSet("letterSpacing"))}{i18n.t("terminalTheme.letterSpacing")}</Label>
              <Input density="compact" class={field.editorNumber} type="number" step="0.5" value={preset.letterSpacing ?? ""} placeholder={String(inherited.letterSpacing)} oninput={(e) => setNum("letterSpacing", e.currentTarget.value)} />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={cn("flex items-center gap-1", text.meta)}>{@render overrideDot(isSet("fontWeight"))}{i18n.t("terminalTheme.weight")}</Label>
              <Input density="compact" class={field.editor} value={preset.fontWeight != null ? String(preset.fontWeight) : ""} placeholder={String(inherited.fontWeight)} oninput={(e) => setStr("fontWeight", e.currentTarget.value)} />
            </div>
            <div class="flex flex-col gap-1">
              <Label class={cn("flex items-center gap-1", text.meta)}>{@render overrideDot(isSet("cursorStyle"))}{i18n.t("terminalTheme.cursorStyle")}</Label>
              <Select.Root type="single" value={preset.cursorStyle ?? "block"} onValueChange={(v) => setStr("cursorStyle", v ?? "block")}>
              <Select.Trigger size="compact" class={field.editorSelect}>{cursorLabel}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="block" label={i18n.t("terminalTheme.cursorBlock")}>{i18n.t("terminalTheme.cursorBlock")}</Select.Item>
                  <Select.Item value="underline" label={i18n.t("terminalTheme.cursorUnderline")}>{i18n.t("terminalTheme.cursorUnderline")}</Select.Item>
                  <Select.Item value="bar" label={i18n.t("terminalTheme.cursorBar")}>{i18n.t("terminalTheme.cursorBar")}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div class="flex items-center gap-6">
            <div class="flex items-center gap-2">
              <Switch checked={preset.ligatures ?? false} onCheckedChange={(c) => (preset.ligatures = c)} />
              <Label class={text.body}>{i18n.t("terminalTheme.ligatures")}</Label>
            </div>
            <div class="flex items-center gap-2">
              <Switch checked={preset.cursorBlink ?? true} onCheckedChange={(c) => (preset.cursorBlink = c)} />
              <Label class={text.body}>{i18n.t("terminalTheme.cursorBlink")}</Label>
            </div>
          </div>
          <p class={text.meta}>{i18n.t("terminalTheme.ligaturesNote")}</p>

          <div class="flex flex-col gap-1.5">
            <span class={text.section}>{i18n.t("terminalTheme.colors")}</span>
            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {#each baseColorFields as [key, labelKey] (key)}
                <div class="flex items-center gap-1.5">
                  {@render overrideDot(isSet(key))}
                  <span class="size-5 shrink-0 rounded border border-border" style:background-color={(inherited.theme as Record<string, string>)[key]}></span>
                  <span class={cn(field.editorLabelShort, text.indicator)}>{i18n.t(labelKey)}</span>
                  <Input density="compact" class={cn(field.editor, "flex-1")} value={(preset as unknown as Record<string, string>)[key] ?? ""} placeholder={(inherited.theme as Record<string, string>)[key]} oninput={(e) => setStr(key as keyof TerminalTheme, e.currentTarget.value)} />
                </div>
              {/each}
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class={text.section}>{i18n.t("terminalTheme.ansi")}</span>
            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {#each ANSI_TOKENS as token (token)}
                <div class="flex items-center gap-1.5">
                  {@render overrideDot(isSet(token))}
                  <span class="size-5 shrink-0 rounded border border-border" style:background-color={(inherited.theme as Record<string, string>)[token]}></span>
                  <TooltipSimple title={token}>
                    {#snippet children(tp)}
                      <span {...tp} class={cn(field.editorLabelShort, "font-mono", text.indicator)}>{token}</span>
                    {/snippet}
                  </TooltipSimple>
                  <Input density="compact" class={cn(field.editor, "flex-1")} value={(preset as unknown as Record<string, string>)[token] ?? ""} placeholder={(inherited.theme as Record<string, string>)[token]} oninput={(e) => setStr(token, e.currentTarget.value)} />
                </div>
              {/each}
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
