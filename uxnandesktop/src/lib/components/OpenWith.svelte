<script lang="ts">
  // The shared "Open with →" submenu: opens the target `path` (a project /
  // worktree folder, or a file-tree entry) in an external editor/IDE. Used from
  // both a DropdownMenu (project-card ⋯, file-tree "More actions") and a
  // ContextMenu (worktree right-click, file-tree entry right-click), so it takes
  // the menu family's components as `menu` and renders them — one body, no
  // per-family duplication. The editor list (detected + custom) and the launch
  // both live in the `openWith` store.
  import type { Component } from "svelte";
  import { openWith } from "$lib/state/openWith.svelte";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import EntityIcon from "./EntityIcon.svelte";
  import AppWindowIcon from "@lucide/svelte/icons/app-window";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import SettingsIcon from "@lucide/svelte/icons/settings";

  /** The Sub/SubTrigger/SubContent/Item/Separator quintet of a bits-ui menu
   *  family (DropdownMenu or ContextMenu) — same shape in both. */
  interface MenuParts {
    Sub: Component<any>;
    SubTrigger: Component<any>;
    SubContent: Component<any>;
    Item: Component<any>;
    Separator: Component<any>;
  }

  // `menu` is a stable namespace passed by the caller (DropdownMenu / ContextMenu);
  // render its members directly (`<menu.Sub>` …) so nothing is captured at init.
  let {
    menu,
    path,
    textFile = false,
  }: {
    menu: MenuParts;
    path: string;
    /** The target is a plain-text file → also offer the native text editor. */
    textFile?: boolean;
  } = $props();

  const editors = $derived(openWith.menuEditors);
  // The native text editor, offered only for text files (once it has loaded).
  const native = $derived(textFile ? openWith.nativeText : null);

  function warm(): void {
    void openWith.ensureLoaded();
    void openWith.ensureIcons();
  }
</script>

{#snippet editorGlyph()}
  <AppWindowIcon class={cn(icon.button, "text-muted-foreground")} />
{/snippet}

<menu.Sub>
  <menu.SubTrigger class={text.menu} onpointerenter={warm}>
    <AppWindowIcon />
    {i18n.t("openWith.label")}
  </menu.SubTrigger>
  <menu.SubContent class="uxnan-scroll max-h-80 min-w-52 overflow-y-auto">
    {#if native}
      <menu.Item class={text.menu} onclick={() => void openWith.openNative(path)}>
        <FileTextIcon />
        <span class="truncate">{native.name}</span>
      </menu.Item>
      <menu.Separator />
    {/if}
    {#if editors.length}
      {#each editors as ed (ed.id)}
        <menu.Item class={text.menu} onclick={() => void openWith.open(path, ed)}>
          <EntityIcon value={ed.icon ?? openWith.favicon(ed)} class="size-4" fallback={editorGlyph} />
          <span class="truncate">{ed.name}</span>
        </menu.Item>
      {/each}
      <menu.Separator />
    {:else if !native}
      <menu.Item class={text.menu} disabled>
        {openWith.loaded ? i18n.t("openWith.none") : i18n.t("openWith.detecting")}
      </menu.Item>
    {/if}
    <menu.Item class={text.menu} onclick={() => app.openSettings("openWith")}>
      <SettingsIcon />
      {i18n.t("openWith.manage")}
    </menu.Item>
  </menu.SubContent>
</menu.Sub>
