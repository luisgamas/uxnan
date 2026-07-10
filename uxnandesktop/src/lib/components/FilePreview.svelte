<script lang="ts">
  // Preview pane for the file viewer's Preview mode: a rendered Markdown document
  // or an image viewer (fit / zoom / actual-size + a dimensions·size meta line).
  // Which one is decided by the owning tab from the file's type; SVG previews as
  // an image. Text stays editable via the tab's Edit mode.
  import { fsReadDataUrl } from "$lib/api";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import MarkdownView from "./MarkdownView.svelte";
  import ZoomInIcon from "@lucide/svelte/icons/zoom-in";
  import ZoomOutIcon from "@lucide/svelte/icons/zoom-out";
  import MaximizeIcon from "@lucide/svelte/icons/maximize";
  import ScanIcon from "@lucide/svelte/icons/scan";

  let {
    path,
    content = "",
    kind,
  }: { path: string; content?: string; kind: "image" | "markdown" } = $props();

  const baseDir = $derived(path.slice(0, path.lastIndexOf("/")) || null);

  // --- image branch ----------------------------------------------------------
  let dataUrl = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let natW = $state(0);
  let natH = $state(0);
  /** null = fit-to-view; a number = explicit scale factor (1 = actual size). */
  let zoom = $state<number | null>(null);
  const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

  // Load the image data URL whenever the target changes (image previews only).
  $effect(() => {
    if (kind !== "image") return;
    const target = path;
    dataUrl = null;
    loadError = null;
    zoom = null;
    void fsReadDataUrl(target)
      .then((url) => {
        if (path === target) dataUrl = url;
      })
      .catch((e: unknown) => {
        if (path === target) loadError = e instanceof Error ? e.message : String(e);
      });
  });

  /** Approximate decoded byte size of the loaded data URL (base64 → bytes). */
  const byteSize = $derived.by(() => {
    if (!dataUrl) return 0;
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
  });

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function zoomBy(dir: 1 | -1): void {
    const cur = zoom ?? 1;
    if (dir > 0) zoom = ZOOM_STEPS.find((s) => s > cur + 1e-6) ?? cur;
    else zoom = [...ZOOM_STEPS].reverse().find((s) => s < cur - 1e-6) ?? cur;
  }
</script>

{#if kind === "markdown"}
  <div class="h-full min-h-0 bg-background">
    <MarkdownView source={content} {baseDir} />
  </div>
{:else}
  <div class="relative flex h-full min-h-0 flex-col bg-background">
    <div class="ux-checker uxnan-scroll flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {#if loadError}
        <p class={cn("p-4 text-center", text.meta)}>{loadError}</p>
      {:else if !dataUrl}
        <p class={cn("p-4", text.meta)}>{i18n.t("common.loading")}</p>
      {:else}
        <img
          src={dataUrl}
          alt={path.split("/").pop()}
          class={cn(zoom === null && "max-h-full max-w-full object-contain")}
          style:width={zoom !== null && natW ? `${natW * zoom}px` : undefined}
          onload={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            natW = el.naturalWidth;
            natH = el.naturalHeight;
          }}
        />
      {/if}
    </div>

    {#if dataUrl && !loadError}
      <!-- Floating control cluster: zoom · fit · actual size + a meta line. -->
      <div
        class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
      >
        <div
          class="pointer-events-auto flex items-center gap-1 rounded-lg border border-border/70 bg-[var(--ux-elevated)] px-1.5 py-1 shadow-md"
        >
          <TooltipSimple title={i18n.t("preview.zoomOut")}>
            {#snippet children(tp)}
              <button
                {...tp}
                type="button"
                class={cn(iconButton.xs, "flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground")}
                aria-label={i18n.t("preview.zoomOut")}
                onclick={() => zoomBy(-1)}
              >
                <ZoomOutIcon class={icon.action} />
              </button>
            {/snippet}
          </TooltipSimple>
          <TooltipSimple title={i18n.t("preview.zoomIn")}>
            {#snippet children(tp)}
              <button
                {...tp}
                type="button"
                class={cn(iconButton.xs, "flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground")}
                aria-label={i18n.t("preview.zoomIn")}
                onclick={() => zoomBy(1)}
              >
                <ZoomInIcon class={icon.action} />
              </button>
            {/snippet}
          </TooltipSimple>
          <span class="mx-0.5 h-4 w-px bg-border/70" aria-hidden="true"></span>
          <TooltipSimple title={i18n.t("preview.fit")}>
            {#snippet children(tp)}
              <button
                {...tp}
                type="button"
                class={cn(iconButton.xs, "flex items-center justify-center rounded hover:bg-accent hover:text-foreground", zoom === null ? "text-foreground" : "text-muted-foreground")}
                aria-label={i18n.t("preview.fit")}
                onclick={() => (zoom = null)}
              >
                <MaximizeIcon class={icon.action} />
              </button>
            {/snippet}
          </TooltipSimple>
          <TooltipSimple title={i18n.t("preview.actualSize")}>
            {#snippet children(tp)}
              <button
                {...tp}
                type="button"
                class={cn(iconButton.xs, "flex items-center justify-center rounded hover:bg-accent hover:text-foreground", zoom === 1 ? "text-foreground" : "text-muted-foreground")}
                aria-label={i18n.t("preview.actualSize")}
                onclick={() => (zoom = 1)}
              >
                <ScanIcon class={icon.action} />
              </button>
            {/snippet}
          </TooltipSimple>
          {#if natW > 0}
            <span class="mx-0.5 h-4 w-px bg-border/70" aria-hidden="true"></span>
            <span class={cn("px-1 tabular-nums", text.indicator, "text-muted-foreground")}>
              {natW}×{natH}
              {#if byteSize > 0}· {formatBytes(byteSize)}{/if}
              {#if zoom !== null}· {Math.round(zoom * 100)}%{/if}
            </span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Light checkerboard so transparent PNGs read on any theme (mirrors ImageDiffView). */
  .ux-checker {
    background-image:
      linear-gradient(45deg, rgb(127 127 127 / 0.12) 25%, transparent 25%),
      linear-gradient(-45deg, rgb(127 127 127 / 0.12) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgb(127 127 127 / 0.12) 75%),
      linear-gradient(-45deg, transparent 75%, rgb(127 127 127 / 0.12) 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }
</style>
