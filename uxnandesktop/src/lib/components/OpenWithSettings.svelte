<script lang="ts">
  // Settings → Open with: manage the external editors/IDEs offered by every
  // "Open with →" menu. Two lists: the auto-detected editors (each can be hidden)
  // and the user's custom editors (a name + launch command + optional args). Both
  // persist to `app.settings.openWith`; the detected set is a live PATH probe from
  // the `openWith` store (refreshable here).
  import { app } from "$lib/state/app.svelte";
  import { openWith } from "$lib/state/openWith.svelte";
  import { i18n } from "$lib/i18n";
  import { currentOS } from "$lib/platform";
  import { toastError } from "$lib/toast";
  import { cn } from "$lib/utils";
  import { icon, iconButton, panel, text } from "$lib/design";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import SettingsSection from "./SettingsSection.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import type { ExternalEditor, OpenWithSettings } from "$lib/types";
  import AppWindowIcon from "@lucide/svelte/icons/app-window";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import FolderSearchIcon from "@lucide/svelte/icons/folder-search";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

  const OW_DEFAULT: OpenWithSettings = { customEditors: [], hiddenDetected: [] };
  // Merge over a full default so reads/writes are always complete (state saved
  // before this feature, or the web preview, may lack the object).
  const ow = $derived<OpenWithSettings>({ ...OW_DEFAULT, ...app.settings.openWith });
  function setOw(patch: Partial<OpenWithSettings>): void {
    app.settings.openWith = { ...OW_DEFAULT, ...app.settings.openWith, ...patch };
  }

  // Persist: debounced while typing, immediate for discrete actions.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePersist(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void app.persistSettings(), 400);
  }
  function persistNow(): void {
    clearTimeout(saveTimer);
    void app.persistSettings();
  }

  // Detect + warm favicons when the pane opens (idempotent).
  $effect(() => {
    void openWith.ensureLoaded();
    void openWith.ensureIcons();
  });

  const hiddenSet = $derived(new Set(ow.hiddenDetected));
  function setDetectedShown(id: string, shown: boolean): void {
    const next = new Set(ow.hiddenDetected);
    if (shown) next.delete(id);
    else next.add(id);
    setOw({ hiddenDetected: [...next] });
    persistNow();
  }

  // --- Per-editor icon override (IconPicker: builtin glyph / image / URL) -----
  // One shared picker, opened against a target editor (detected or custom).
  let iconPickerOpen = $state(false);
  let iconTarget = $state<{ kind: "detected" | "custom"; id: string } | null>(null);
  // The value currently stored for the open target (seeds the picker).
  const iconCurrent = $derived.by(() => {
    const t = iconTarget;
    if (!t) return null;
    return t.kind === "detected"
      ? (ow.detectedIcons?.[t.id] ?? null)
      : (ow.customEditors.find((e) => e.id === t.id)?.icon ?? null);
  });
  function openIconPicker(kind: "detected" | "custom", id: string): void {
    iconTarget = { kind, id };
    iconPickerOpen = true;
  }
  function setDetectedIcon(id: string, value: string | null): void {
    const next = { ...(ow.detectedIcons ?? {}) };
    if (value == null) delete next[id];
    else next[id] = value;
    setOw({ detectedIcons: next });
    persistNow();
  }
  function onIconSelect(value: string | null): void {
    const t = iconTarget;
    if (!t) return;
    if (t.kind === "detected") setDetectedIcon(t.id, value);
    else {
      updateEditor(t.id, { icon: value });
      persistNow();
    }
  }

  // --- Custom editors --------------------------------------------------------
  function addEditor(): void {
    setOw({
      customEditors: [
        ...ow.customEditors,
        { id: crypto.randomUUID(), name: "", command: "", args: [] },
      ],
    });
    persistNow();
  }

  // Browse the machine for an application to add (native OS file picker). On macOS
  // an `.app` bundle is launched via `open -a <bundle>`; elsewhere the executable
  // is launched directly. The base name seeds the editor name (editable after).
  let browsing = $state(false);
  async function browseForApp(): Promise<void> {
    if (browsing) return;
    browsing = true;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const os = currentOS();
      const filters =
        os === "windows"
          ? [{ name: i18n.t("openWith.applications"), extensions: ["exe", "cmd", "bat", "com"] }]
          : os === "macos"
            ? [{ name: i18n.t("openWith.applications"), extensions: ["app"] }]
            : undefined; // Linux executables often have no extension.
      const selected = await open({
        multiple: false,
        directory: false,
        title: i18n.t("openWith.browseTitle"),
        filters,
      });
      if (typeof selected !== "string") return;
      const base = selected.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? selected;
      const name = base.replace(/\.(app|exe|cmd|bat|com)$/i, "");
      const isMacApp = /\.app$/i.test(selected);
      setOw({
        customEditors: [
          ...ow.customEditors,
          {
            id: crypto.randomUUID(),
            name,
            command: isMacApp ? "open" : selected,
            args: isMacApp ? ["-a", selected] : [],
          },
        ],
      });
      persistNow();
    } catch (e) {
      toastError(e);
    } finally {
      browsing = false;
    }
  }
  function updateEditor(id: string, patch: Partial<ExternalEditor>): void {
    setOw({
      customEditors: ow.customEditors.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }
  function removeEditor(id: string): void {
    setOw({ customEditors: ow.customEditors.filter((e) => e.id !== id) });
    persistNow();
  }

  // Args are edited as a whitespace-separated string; committed (parsed) on blur
  // so intermediate spaces don't get eaten while typing. `undefined` = not being
  // edited (show the model value).
  let argsDraft = $state<Record<string, string>>({});
  function argsValue(e: ExternalEditor): string {
    return argsDraft[e.id] ?? e.args.join(" ");
  }
  function commitArgs(id: string): void {
    const raw = argsDraft[id];
    if (raw === undefined) return;
    const args = raw.trim() ? raw.trim().split(/\s+/) : [];
    updateEditor(id, { args });
    const { [id]: _drop, ...rest } = argsDraft;
    argsDraft = rest;
    persistNow();
  }
</script>

{#snippet editorGlyph()}
  <AppWindowIcon class={cn(icon.button, "text-muted-foreground")} />
{/snippet}

<div class="flex flex-col gap-6">
  <SettingsSection title={i18n.t("openWith.settingsTitle")} description={i18n.t("openWith.settingsDesc")}>
    {#snippet headerAction()}
      <Button variant="outline" size="sm" onclick={() => void openWith.refresh()}>
        <RefreshCwIcon data-icon="inline-start" class={cn(!openWith.loaded && "animate-spin")} />
        {i18n.t("openWith.refresh")}
      </Button>
    {/snippet}
    <p class={cn("flex items-center gap-2", text.meta)}>
      <AppWindowIcon class={cn(icon.decorative, "shrink-0")} />
      {i18n.t("openWith.settingsHint")}
    </p>
  </SettingsSection>

  <!-- Detected editors (toggle each on/off in the menus). -->
  <div class="space-y-2">
    <span class={cn("px-1", text.section)}>{i18n.t("openWith.detected")}</span>
    <div class={cn("flex flex-col divide-y divide-border/60", panel.settingsBody)}>
      {#if !openWith.loaded}
        <p class={cn("px-1 py-3", text.meta)}>{i18n.t("openWith.detecting")}</p>
      {:else if openWith.detected.length === 0}
        <p class={cn("px-1 py-3", text.meta)}>{i18n.t("openWith.noneDetected")}</p>
      {:else}
        {#each openWith.detected as ed (ed.id)}
          <div class="flex items-center gap-2.5 px-1 py-3">
            <TooltipSimple title={i18n.t("openWith.changeIcon")}>
              {#snippet children(tp)}
                <button
                  {...tp}
                  type="button"
                  class="flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors hover:border-border/60 hover:bg-foreground/[0.05]"
                  aria-label={i18n.t("openWith.changeIcon")}
                  onclick={() => openIconPicker("detected", ed.id)}
                >
                  <EntityIcon value={ow.detectedIcons?.[ed.id] ?? openWith.favicon(ed)} class="size-5" fallback={editorGlyph} />
                </button>
              {/snippet}
            </TooltipSimple>
            <div class="min-w-0 flex-1">
              <div class={cn("truncate font-medium text-foreground", text.body)}>{ed.name}</div>
              <div class="truncate font-mono text-[11px] leading-4 text-muted-foreground">{ed.command}</div>
            </div>
            <Switch
              checked={!hiddenSet.has(ed.id)}
              onCheckedChange={(c) => setDetectedShown(ed.id, c)}
              aria-label={ed.name}
            />
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Custom editors (name + launch command + optional args). -->
  <div class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2 px-1">
      <span class={text.section}>{i18n.t("openWith.custom")}</span>
      <div class="flex items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={browsing} onclick={browseForApp}>
          <FolderSearchIcon data-icon="inline-start" />
          {i18n.t("openWith.browse")}
        </Button>
        <Button variant="outline" size="sm" onclick={addEditor}>
          <PlusIcon data-icon="inline-start" />
          {i18n.t("openWith.addEditor")}
        </Button>
      </div>
    </div>
    <div class={cn("flex flex-col divide-y divide-border/60", panel.settingsBody)}>
      {#if ow.customEditors.length === 0}
        <p class={cn("px-1 py-3", text.meta)}>{i18n.t("openWith.customEmpty")}</p>
      {:else}
        {#each ow.customEditors as ed (ed.id)}
          <div class="flex flex-col gap-2 px-1 py-3">
            <div class="flex items-center gap-2">
              <TooltipSimple title={i18n.t("openWith.changeIcon")}>
                {#snippet children(tp)}
                  <button
                    {...tp}
                    type="button"
                    class="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background transition-colors hover:bg-foreground/[0.05]"
                    aria-label={i18n.t("openWith.changeIcon")}
                    onclick={() => openIconPicker("custom", ed.id)}
                  >
                    <EntityIcon value={ed.icon ?? openWith.favicon(ed)} class="size-5" fallback={editorGlyph} />
                  </button>
                {/snippet}
              </TooltipSimple>
              <Input
                class="h-8 flex-1"
                placeholder={i18n.t("openWith.namePlaceholder")}
                value={ed.name}
                oninput={(e) => { updateEditor(ed.id, { name: e.currentTarget.value }); schedulePersist(); }}
                onchange={persistNow}
              />
              <TooltipSimple title={i18n.t("common.remove")}>
                {#snippet children(tp)}
                  <Button
                    {...tp}
                    variant="ghost"
                    size="icon"
                    class={iconButton.action}
                    aria-label={i18n.t("common.remove")}
                    onclick={() => removeEditor(ed.id)}
                  >
                    <Trash2Icon class={icon.button} />
                  </Button>
                {/snippet}
              </TooltipSimple>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <Input
                class="h-8 flex-1 font-mono text-xs"
                placeholder={i18n.t("openWith.commandPlaceholder")}
                value={ed.command}
                oninput={(e) => { updateEditor(ed.id, { command: e.currentTarget.value }); schedulePersist(); }}
                onchange={persistNow}
              />
              <Input
                class="h-8 flex-1 font-mono text-xs"
                placeholder={i18n.t("openWith.argsPlaceholder")}
                value={argsValue(ed)}
                oninput={(e) => (argsDraft[ed.id] = e.currentTarget.value)}
                onchange={() => commitArgs(ed.id)}
                onblur={() => commitArgs(ed.id)}
              />
            </div>
          </div>
        {/each}
      {/if}
    </div>
    <p class={cn("px-1", text.meta)}>{i18n.t("openWith.customHint")}</p>
  </div>
</div>

<!-- Mounted once; opened against a detected or custom editor to set its icon. -->
<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("openWith.iconTitle")}
  current={iconCurrent}
  fallback={editorGlyph}
  onselect={onIconSelect}
/>
