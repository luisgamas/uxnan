<script lang="ts">
  // The right dock (`state/dock.svelte.ts`): one panel, the surfaces the
  // workspace on screen has — Files · Git · GitHub · Browser.
  //
  // Its appbar — the top band every panel starts with — holds one thing: the
  // surface selector, the same searchable-list control the GitHub view uses to
  // switch between pull requests, issues and CI. Each option carries what is
  // worth knowing without opening it (changes, checks, an agent waiting). The
  // window controls float over the appbar's right end (the dock is always the
  // right-most panel), which `titlebarInsets` leaves free. Opening and closing
  // the dock is the status bar's button — there is no second close here.
  //
  // Nothing chosen yet (the first time a workspace opens its dock) shows the
  // chooser: one card per surface the workspace has. Only the shown surface is
  // mounted; leaving the browser hides its page without closing it
  // (`state/browser.svelte.ts`).

  import FileTreePanel from "./FileTreePanel.svelte";
  import GitSurface from "./GitSurface.svelte";
  import GithubPanel from "./GithubPanel.svelte";
  import BrowserPanel from "./BrowserPanel.svelte";
  import Combobox, { type ComboGroup, type ComboItem } from "./Combobox.svelte";
  import KeyChord from "./KeyChord.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import { app } from "$lib/state/app.svelte";
  import { dock } from "$lib/state/dock.svelte";
  import { browser } from "$lib/state/browser.svelte";
  import { BADGE_TEXT, BADGE_TONE, SURFACE_META } from "$lib/dockSurfaces";
  import { shell, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { isMac, resolveBinding } from "$lib/keybindings";
  import { titlebarInsets } from "$lib/titlebar";
  import { cn } from "$lib/utils";
  import type { DockSurface } from "$lib/types";

  const shown = $derived(dock.surfaceOf());

  /** The muted line an option carries: what the surface would tell you. */
  function metaOf(surface: DockSurface): string | undefined {
    const badge = dock.badge(surface);
    if (badge?.kind === "count") {
      return i18n.plural(badge.value, "rightPanel.changedOne", "rightPanel.changedOther");
    }
    if (badge?.kind === "dot") return i18n.t(BADGE_TEXT[badge.tone]);
    if (surface === "browser") {
      const url = browser.active?.url;
      if (url && url !== "about:blank") {
        try {
          return new URL(url).host;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  const groups = $derived<ComboGroup[]>([
    {
      items: dock.surfaces.map((surface) => ({
        value: surface,
        label: i18n.t(SURFACE_META[surface].labelKey),
        meta: metaOf(surface),
      })),
    },
  ]);

  /** Show a surface. The browser goes through `openBrowser`, which resumes the
   *  workspace's page or loads the home page when there is none. */
  function choose(surface: DockSurface): void {
    if (surface === "browser") void app.openBrowser().catch(() => {});
    else dock.show(surface);
  }

</script>

{#snippet surfaceIcon(item: ComboItem)}
  {@const surface = item.value as DockSurface}
  {@const badge = dock.badge(surface)}
  <span class="relative flex shrink-0">
    <Icon icon={SURFACE_META[surface].icon} class="size-4" />
    {#if badge?.kind === "dot"}
      <span class={cn("absolute -top-0.5 -right-0.5 size-1.5 rounded-full", BADGE_TONE[badge.tone])}></span>
    {/if}
  </span>
{/snippet}

<div class="flex h-full min-h-0 w-full flex-col">
  <div
    data-tauri-drag-region
    class={cn(
      shell.appBar,
      shell.rightPanelHeader,
      "flex items-center gap-1 px-1.5",
      titlebarInsets({ left: false, right: true }, isMac),
    )}
  >
    <Combobox
      value={shown ?? undefined}
      {groups}
      placeholder={i18n.t("dock.choose")}
      searchable={false}
      triggerVariant="ghost"
      triggerClass="h-7 w-auto max-w-full gap-1 px-2 text-[13px] font-medium"
      align="start"
      itemPrefix={surfaceIcon}
      onChange={(v) => choose(v as DockSurface)}
    />
    <div data-tauri-drag-region class="min-w-0 flex-1 self-stretch"></div>
  </div>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {#if shown === "files"}
      <FileTreePanel />
    {:else if shown === "git"}
      <GitSurface />
    {:else if shown === "github"}
      <GithubPanel />
    {:else if shown === "browser"}
      <BrowserPanel />
    {:else}
      <!-- The chooser: nothing picked yet in this workspace. -->
      <div class="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
        <div class="mb-4 text-center">
          <p class={text.title}>{i18n.t("dock.chooserTitle")}</p>
          <p class={cn(text.meta, "mt-1")}>{i18n.t("dock.chooserSubtitle")}</p>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
          {#each dock.surfaces as surface (surface)}
            {@const meta = SURFACE_META[surface]}
            <button
              type="button"
              class="group flex flex-col items-start gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-3 text-left transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onclick={() => choose(surface)}
            >
              <span class="flex w-full items-center justify-between">
                <Icon icon={meta.icon} class="size-5 text-muted-foreground group-hover:text-foreground" />
                <KeyChord chord={resolveBinding(meta.action)} />
              </span>
              <span class={text.bodyStrong}>{i18n.t(meta.labelKey)}</span>
              <span class={cn(text.meta, "leading-snug")}>{i18n.t(meta.descKey)}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
