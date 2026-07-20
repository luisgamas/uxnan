<script lang="ts">
  // A shared dialog for choosing a project's or branch's icon. Sources:
  //   - a curated built-in glyph (+ an accent color) — the quick, upload-free way;
  //   - a custom image from a local file;
  //   - a custom image from an http(s) URL (fetched in the backend, no CORS);
  //   - a git host account avatar (when a repo id resolves an `origin` owner);
  //   - reset to the default glyph.
  // Every image source is rasterized to a small square PNG `data:` URL so it
  // persists inline and offline. The chosen value is handed back via `onselect`.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Spinner } from "$lib/components/ui/spinner";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { fileToLogoDataUrl, rasterizeToSquarePng } from "$lib/logo";
  import { BUILTIN_COLORS, buildBuiltinIcon } from "$lib/iconCatalog";
  import { BUILTIN_ICONS, resolveBuiltinIcon } from "$lib/iconRegistry";
  import { imageFetchDataUrl, repoRemoteOwner } from "$lib/api";
  import EntityIcon from "./EntityIcon.svelte";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import LinkIcon from "@lucide/svelte/icons/link";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import BanIcon from "@lucide/svelte/icons/ban";
  import PipetteIcon from "@lucide/svelte/icons/pipette";

  let {
    open = $bindable(false),
    title,
    current,
    repoId,
    fallback,
    onselect,
  }: {
    open?: boolean;
    /** Dialog title (e.g. "Project icon" / "Branch icon"). */
    title: string;
    /** The current icon value being edited. */
    current?: string | null;
    /** When set (a git project), offers the account avatar option. */
    repoId?: string;
    /** The default glyph, shown in the preview when no icon is chosen. */
    fallback: Snippet;
    /** Called with the chosen value (builtin key or data URL), or null to reset. */
    onselect: (value: string | null) => void;
  } = $props();

  // The value being composed (null = default). Applied only on Save.
  let pending = $state<string | null>(null);
  // Accent color for a built-in glyph: a hex string, or null for no tint.
  let currentColor = $state<string | null>(null);
  let urlInput = $state("");
  let busy = $state(false);
  let busySource = $state<"file" | "avatar" | "url" | null>(null);
  let error = $state<string | null>(null);
  // Resolved git-host avatar URL (null until/unless a repo origin resolves one).
  let avatarUrl = $state<string | null>(null);

  const PREVIEW_SIZE = 128;

  // Color keys map 1:1 to `iconPicker.color.<key>` message keys (all present in
  // both locales); the cast bridges the dynamic key to the typed `t()`.
  const colorLabel = (key: string) => i18n.t(`iconPicker.color.${key}` as MessageKey);

  // Initialize each time the dialog opens: seed from `current`, derive the color
  // of a built-in selection, and probe the repo's remote for an avatar option.
  $effect(() => {
    if (!open) return;
    pending = current ?? null;
    currentColor = resolveBuiltinIcon(current)?.color ?? null;
    urlInput = "";
    error = null;
    busy = false;
    busySource = null;
    avatarUrl = null;
    if (repoId) {
      repoRemoteOwner(repoId)
        .then((owner) => (avatarUrl = owner?.avatarUrl ?? null))
        .catch(() => (avatarUrl = null));
    }
  });

  const pendingBuiltin = $derived(resolveBuiltinIcon(pending));
  // Whether the current color is a preset (else it's a custom hex → shown in the
  // custom swatch).
  const matchedPreset = $derived(
    currentColor == null
      ? null
      : (BUILTIN_COLORS.find((c) => c.value.toLowerCase() === currentColor!.toLowerCase()) ?? null),
  );
  const isPresetColor = $derived(matchedPreset != null);
  // A human caption for the active color: "No color" / a preset name / the custom
  // hex — so the row is self-explanatory (the custom swatch opens the OS picker).
  const colorCaption = $derived(
    currentColor == null
      ? colorLabel("default")
      : matchedPreset
        ? colorLabel(matchedPreset.key)
        : `${colorLabel("custom")} · ${currentColor.toUpperCase()}`,
  );

  function pickBuiltin(name: string) {
    error = null;
    pending = buildBuiltinIcon(name, currentColor);
  }
  function pickColor(color: string | null) {
    currentColor = color;
    // Re-tint the current built-in selection (a no-op for a custom image).
    if (pendingBuiltin) pending = buildBuiltinIcon(pendingBuiltin.name, color);
  }

  let fileInput = $state<HTMLInputElement | null>(null);
  async function onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = ""; // allow re-picking the same file
    if (!file) return;
    error = null;
    busy = true;
    busySource = "file";
    try {
      pending = await fileToLogoDataUrl(file, PREVIEW_SIZE);
    } catch {
      error = i18n.t("iconPicker.fileError");
    } finally {
      busy = false;
      busySource = null;
    }
  }

  async function fetchInto(url: string, source: "avatar" | "url") {
    error = null;
    busy = true;
    busySource = source;
    try {
      const dataUrl = await imageFetchDataUrl(url);
      pending = await rasterizeToSquarePng(dataUrl, PREVIEW_SIZE);
    } catch (e) {
      error = e instanceof Error ? e.message : i18n.t("iconPicker.urlError");
    } finally {
      busy = false;
      busySource = null;
    }
  }

  function save() {
    onselect(pending);
    open = false;
  }
  function reset() {
    onselect(null);
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{i18n.t("iconPicker.desc")}</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-5 py-1">
      <!-- Live preview of the pending selection. -->
      <div class="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/40 px-4 py-3">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
          <EntityIcon value={pending} class="size-6" {fallback} />
        </div>
        <div class="min-w-0">
          <div class={cn("font-medium", text.body)}>{i18n.t("iconPicker.preview")}</div>
          <div class={text.meta}>
            {pendingBuiltin
              ? i18n.t("iconPicker.sourceBuiltin")
              : pending
                ? i18n.t("iconPicker.sourceImage")
                : i18n.t("iconPicker.sourceDefault")}
          </div>
        </div>
      </div>

      <!-- Built-in glyphs + accent color. -->
      <div class="flex flex-col gap-2.5">
        <span class={text.section}>{i18n.t("iconPicker.builtin")}</span>
        <div class="flex flex-wrap items-center gap-1.5">
          <!-- Default (no tint). -->
          <button
            type="button"
            class={cn(
              "flex size-5 items-center justify-center rounded-full border transition-transform hover:scale-110",
              currentColor == null ? "border-foreground ring-1 ring-foreground/30" : "border-border/60",
            )}
            title={colorLabel("default")}
            aria-label={colorLabel("default")}
            aria-pressed={currentColor == null}
            onclick={() => pickColor(null)}
          >
            <BanIcon class="size-3 text-muted-foreground" />
          </button>
          {#each BUILTIN_COLORS as c (c.key)}
            {@const selected = currentColor?.toLowerCase() === c.value.toLowerCase()}
            <button
              type="button"
              class={cn(
                "size-5 rounded-full border transition-transform hover:scale-110",
                selected ? "border-foreground ring-1 ring-foreground/30" : "border-border/40",
              )}
              style={`background-color:${c.value}`}
              title={colorLabel(c.key)}
              aria-label={colorLabel(c.key)}
              aria-pressed={selected}
              onclick={() => pickColor(c.value)}
            ></button>
          {/each}
          <!-- Custom color: a native color well styled as a swatch. -->
          <label
            class={cn(
              "relative flex size-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-transform hover:scale-110",
              currentColor != null && !isPresetColor
                ? "border-foreground ring-1 ring-foreground/30"
                : "border-border/60",
            )}
            title={colorLabel("custom")}
            style={currentColor != null && !isPresetColor ? `background-color:${currentColor}` : undefined}
          >
            {#if isPresetColor || currentColor == null}
              <PipetteIcon class="size-3 text-muted-foreground" />
            {/if}
            <input
              type="color"
              class="absolute inset-0 size-full cursor-pointer opacity-0"
              value={currentColor ?? "#8b5cf6"}
              oninput={(e) => pickColor((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <!-- Active-color caption: names the preset, "No color", or the custom
               hex, so the last (pipette) swatch is clearly a full color picker. -->
          <span class={cn("ml-1", text.meta)}>{colorCaption}</span>
        </div>
        <div class="uxnan-scroll grid max-h-40 grid-cols-9 gap-1 overflow-y-auto pr-1">
          {#each BUILTIN_ICONS as b (b.name)}
            {@const Icon = b.Icon}
            {@const selected = pendingBuiltin?.name === b.name}
            <button
              type="button"
              class={cn(
                "flex aspect-square items-center justify-center rounded-md border transition-colors",
                selected
                  ? "border-foreground/30 bg-[var(--ux-sidebar-accent)] text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
              )}
              style={selected && pendingBuiltin?.color ? `color:${pendingBuiltin.color}` : undefined}
              title={b.name}
              aria-label={b.name}
              aria-pressed={selected}
              onclick={() => pickBuiltin(b.name)}
            >
              <Icon class="size-4" />
            </button>
          {/each}
        </div>
      </div>

      <!-- Custom image sources: file · URL · account avatar. -->
      <div class="flex flex-col gap-2.5">
        <span class={text.section}>{i18n.t("iconPicker.custom")}</span>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onclick={() => fileInput?.click()}>
            {#if busySource === "file"}
              <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {:else}
              <UploadIcon data-icon="inline-start" />
            {/if}
            {i18n.t("iconPicker.fromFile")}
          </Button>
          {#if avatarUrl}
            <Button variant="outline" size="sm" disabled={busy} onclick={() => fetchInto(avatarUrl!, "avatar")}>
              {#if busySource === "avatar"}
                <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
              {/if}
              {i18n.t("iconPicker.fromAvatar")}
            </Button>
          {/if}
        </div>
        <div class="flex gap-2">
          <div class="relative min-w-0 flex-1">
            <LinkIcon class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80" />
            <Input
              class="pl-8"
              placeholder={i18n.t("iconPicker.urlPlaceholder")}
              bind:value={urlInput}
              autocomplete="off"
              spellcheck={false}
              onkeydown={(e) => e.key === "Enter" && urlInput.trim() && fetchInto(urlInput.trim(), "url")}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !urlInput.trim()}
            onclick={() => fetchInto(urlInput.trim(), "url")}
          >
            {#if busySource === "url"}
              <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
            {/if}
            {i18n.t("iconPicker.fetch")}
          </Button>
        </div>
      </div>

      {#if error}
        <p class="text-xs break-words text-destructive">{error}</p>
      {/if}
    </div>

    <Dialog.Footer class="sm:justify-between">
      <Button variant="ghost" class="text-muted-foreground" onclick={reset}>
        <RotateCcwIcon class={icon.button} />
        {i18n.t("iconPicker.reset")}
      </Button>
      <Button disabled={busy} onclick={save}>{i18n.t("common.save")}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<input
  bind:this={fileInput}
  type="file"
  accept="image/*"
  class="hidden"
  onchange={onFile}
/>
