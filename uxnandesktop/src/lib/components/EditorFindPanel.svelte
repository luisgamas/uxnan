<script lang="ts">
  // The file editor's find / replace bar (Mod+F), drawn with the app's own
  // controls. CodeMirror still does the searching — the query, the match
  // highlights, next / previous, replace — through `@codemirror/search`; this
  // is only its face, mounted as the editor's top panel (`lib/editorFind.svelte.ts`).

  import type { EditorView } from "@codemirror/view";
  import {
    SearchQuery,
    closeSearchPanel,
    findNext,
    findPrevious,
    replaceAll,
    replaceNext,
    setSearchQuery,
  } from "@codemirror/search";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Icon } from "$lib/components/ui/icon";
  import { SegmentedToggles } from "$lib/components/ui/segmented";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { divider, icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import ArrowDownIcon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import ArrowRightIcon from "@hugeicons/core-free-icons/ArrowRight01Icon";
  import ArrowUpIcon from "@hugeicons/core-free-icons/ArrowUp01Icon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";

  let {
    view,
    live,
  }: {
    view: EditorView;
    /** What the editor tells the panel: the current query and a revision that
     *  moves with every document or selection change. */
    live: { query: SearchQuery; rev: number };
  } = $props();

  let replaceOpen = $state(false);

  /** CodeMirror focuses and selects the panel field marked `main-field` when
   *  Mod+F is pressed with the panel already open. */
  const MAIN_FIELD: Record<string, string> = { "main-field": "true" };

  const options = $derived(
    [
      live.query.caseSensitive && "case",
      live.query.wholeWord && "word",
      live.query.regexp && "regexp",
    ].filter(Boolean) as string[],
  );

  /** Change the query (CodeMirror highlights the matches as it goes). */
  function update(change: Partial<{ search: string; replace: string; options: string[] }>): void {
    const q = live.query;
    const opts = change.options ?? options;
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: change.search ?? q.search,
          replace: change.replace ?? q.replace,
          caseSensitive: opts.includes("case"),
          wholeWord: opts.includes("word"),
          regexp: opts.includes("regexp"),
        }),
      ),
    });
  }

  /** Matches in the document and which one the selection is on — counted up to
   *  a ceiling, so a huge file never stalls the bar. */
  const MAX_COUNT = 999;
  const matches = $derived.by(() => {
    void live.rev;
    const q = live.query;
    if (!q.search || !q.valid) return null;
    const { from } = view.state.selection.main;
    const cursor = q.getCursor(view.state);
    let total = 0;
    let current = 0;
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      total += 1;
      if (!current && next.value.from >= from) current = total;
      if (total > MAX_COUNT) break;
    }
    return { total, current };
  });

  const countLabel = $derived.by(() => {
    if (!matches) return "";
    if (matches.total === 0) return i18n.t("editor.search.noResults");
    const total = matches.total > MAX_COUNT ? `${MAX_COUNT}+` : String(matches.total);
    return i18n.t("editor.search.count", { current: matches.current || 1, total });
  });

  function close(): void {
    closeSearchPanel(view);
    view.focus();
  }

  function onFindKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function onReplaceKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceNext(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
</script>

{#snippet action(title: string, glyph: typeof XIcon, run: () => void, disabled = false)}
  <TooltipSimple {title}>
    {#snippet children(tp)}
      <Button
        {...tp}
        variant="ghost"
        size="icon-xs"
        class={cn(iconButton.xs, "text-muted-foreground")}
        aria-label={title}
        {disabled}
        onclick={run}
      >
        <Icon icon={glyph} class={icon.action} />
      </Button>
    {/snippet}
  </TooltipSimple>
{/snippet}

<div class={cn("flex flex-col gap-1.5 bg-background px-2 py-1.5", divider.bottom)}>
  <div class="flex min-w-0 items-center gap-1.5">
    <TooltipSimple title={i18n.t(replaceOpen ? "editor.search.hideReplace" : "editor.search.showReplace")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-xs"
          class={cn(iconButton.xs, "text-muted-foreground")}
          aria-label={i18n.t("editor.search.showReplace")}
          aria-expanded={replaceOpen}
          onclick={() => (replaceOpen = !replaceOpen)}
        >
          <Icon icon={ArrowRightIcon} class={cn(icon.action, "transition-transform", replaceOpen && "rotate-90")} />
        </Button>
      {/snippet}
    </TooltipSimple>
    <Input
      density="compact"
      class={cn("h-7 min-w-0 flex-1", text.body)}
      placeholder={i18n.t("editor.search.find")}
      aria-label={i18n.t("editor.search.find")}
      {...MAIN_FIELD}
      value={live.query.search}
      oninput={(e) => update({ search: e.currentTarget.value })}
      onkeydown={onFindKey}
    />
    <span class={cn(text.meta, "min-w-16 shrink-0 text-right tabular-nums")} aria-live="polite">{countLabel}</span>
    <SegmentedToggles
      value={options}
      label={i18n.t("editor.search.options")}
      options={[
        { value: "case", glyph: "Aa", tooltip: i18n.t("editor.search.matchCase") },
        { value: "word", glyph: "ab", tooltip: i18n.t("editor.search.byWord"), class: "underline underline-offset-2" },
        { value: "regexp", glyph: ".*", tooltip: i18n.t("editor.search.regexp"), class: "font-mono" },
      ]}
      onValueChange={(next) => update({ options: next })}
    />
    {@render action(i18n.t("editor.search.previous"), ArrowUpIcon, () => findPrevious(view), !matches?.total)}
    {@render action(i18n.t("editor.search.next"), ArrowDownIcon, () => findNext(view), !matches?.total)}
    {@render action(i18n.t("editor.search.close"), XIcon, close)}
  </div>
  {#if replaceOpen}
    <div class="flex min-w-0 items-center gap-1.5 pl-[34px]">
      <Input
        density="compact"
        class={cn("h-7 min-w-0 flex-1", text.body)}
        placeholder={i18n.t("editor.search.replace")}
        aria-label={i18n.t("editor.search.replace")}
        value={live.query.replace}
        oninput={(e) => update({ replace: e.currentTarget.value })}
        onkeydown={onReplaceKey}
      />
      <Button variant="ghost" size="xs" disabled={!matches?.total} onclick={() => replaceNext(view)}>
        {i18n.t("editor.search.replaceOne")}
      </Button>
      <Button variant="ghost" size="xs" disabled={!matches?.total} onclick={() => replaceAll(view)}>
        {i18n.t("editor.search.replaceAll")}
      </Button>
    </div>
  {/if}
</div>
