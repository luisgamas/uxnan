<script lang="ts">
  // Editable file viewer on CodeMirror 6, rendered inside a center **file tab**
  // (one instance per open file; its state is the `FileEditorState` passed in).
  // Syntax-highlighted, with a git change gutter: added lines get a light
  // highlight, and a small left-edge marker peeks the *removed* lines on demand
  // (we never show the full diff inline). Save with the button or Ctrl/Cmd+S →
  // writes to disk and refreshes the change indicators. A banner appears when the
  // file changes on disk while you hold unsaved edits (reload vs keep).
  import { onDestroy, untrack } from "svelte";
  import {
    Decoration,
    EditorView,
    GutterMarker,
    WidgetType,
    gutter,
    keymap,
    lineNumbers,
    type DecorationSet,
  } from "@codemirror/view";
  import { EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import type { FileEditorState } from "$lib/state/files.svelte";
  import { languageFor, syntaxHighlight } from "$lib/editorLang";
  import { resolveBinding, toCodeMirrorKey } from "$lib/keybindings";
  import { parseHeadDiff } from "$lib/diff";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import FileIcon from "@lucide/svelte/icons/file";
  import SaveIcon from "@lucide/svelte/icons/save";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";

  let { fileState, active = false }: { fileState: FileEditorState; active?: boolean } =
    $props();

  // --- change gutter: added-line highlight + removed-line peek ---------------

  /** A gutter marker flagging lines removed (vs HEAD) just before a doc line. */
  class RemovedMarker extends GutterMarker {
    lines: string[];
    constructor(lines: string[]) {
      super();
      this.lines = lines;
    }
    toDOM() {
      const el = document.createElement("span");
      el.className = "cm-removed-marker";
      el.textContent = "▾";
      el.title = i18n.t("editor.removedPeek", { n: this.lines.length });
      return el;
    }
  }

  /** Inline (read-only) block showing the removed lines, toggled by the marker. */
  class RemovedPeek extends WidgetType {
    lines: string[];
    constructor(lines: string[]) {
      super();
      this.lines = lines;
    }
    eq(other: RemovedPeek) {
      return other.lines.join("\n") === this.lines.join("\n");
    }
    toDOM() {
      const wrap = document.createElement("div");
      wrap.className = "cm-removed-peek";
      for (const ln of this.lines) {
        const row = document.createElement("div");
        row.className = "cm-removed-peek-line";
        row.textContent = ln.length ? ln : " ";
        wrap.appendChild(row);
      }
      return wrap;
    }
    ignoreEvent() {
      return false;
    }
  }

  const setAdded = StateEffect.define<DecorationSet>();
  const setRemoved = StateEffect.define<RangeSet<GutterMarker>>();
  const togglePeek = StateEffect.define<{ pos: number; lines: string[] }>();
  const clearPeek = StateEffect.define<null>();

  const addedField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setAdded)) deco = e.value;
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const removedField = StateField.define<RangeSet<GutterMarker>>({
    create: () => RangeSet.empty,
    update(set, tr) {
      set = set.map(tr.changes);
      for (const e of tr.effects) if (e.is(setRemoved)) set = e.value;
      return set;
    },
  });

  const peekField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(clearPeek)) deco = Decoration.none;
        if (e.is(togglePeek)) {
          const { pos, lines } = e.value;
          let exists = false;
          deco.between(pos, pos, () => {
            exists = true;
          });
          deco = exists
            ? deco.update({ filter: (from) => from !== pos })
            : deco.update({
                add: [
                  Decoration.widget({
                    widget: new RemovedPeek(lines),
                    block: true,
                    side: -1,
                  }).range(pos),
                ],
              });
        }
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const changeGutter = gutter({
    class: "cm-change-gutter",
    markers: (v) => v.state.field(removedField),
    domEventHandlers: {
      mousedown(view, line) {
        let found: string[] | null = null;
        view.state.field(removedField).between(line.from, line.from, (_f, _t, m) => {
          found = (m as RemovedMarker).lines;
        });
        if (found) {
          view.dispatch({ effects: togglePeek.of({ pos: line.from, lines: found }) });
          return true;
        }
        return false;
      },
    },
  });

  /** Build the added-line decoration set + removed gutter markers for a doc. */
  function buildGutter(editorState: EditorState, diff: string) {
    const { added, removed } = parseHeadDiff(diff);
    const lineCount = editorState.doc.lines;
    const addedRanges = [...added]
      .filter((n) => n >= 1 && n <= lineCount)
      .sort((a, b) => a - b)
      .map((n) => Decoration.line({ class: "cm-added-line" }).range(editorState.doc.line(n).from));
    const removedRanges = [...removed.entries()]
      .map(([n, lines]) => {
        const pos = editorState.doc.line(Math.min(Math.max(1, n), lineCount)).from;
        return new RemovedMarker(lines).range(pos);
      })
      .sort((a, b) => a.from - b.from);
    return {
      added: Decoration.set(addedRanges, true),
      removed: RangeSet.of(removedRanges, true),
    };
  }

  // --- CodeMirror plumbing ---------------------------------------------------

  const baseTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", color: "inherit", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--ux-font-mono)",
      fontSize: "12px",
      lineHeight: "1.5",
      overflow: "auto",
    },
    ".cm-content": { padding: "4px 0" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none" },
  });

  let host = $state<HTMLDivElement>();
  let view: EditorView | undefined;

  function doSave() {
    if (!view) return;
    void fileState.save(view.state.doc.toString());
  }

  function build() {
    view?.destroy();
    view = undefined;
    if (!host) return; // binary / too-large / loading: no editor to build
    const content = untrack(() => fileState.baseline);
    const diff = untrack(() => fileState.headDiff);
    const name = untrack(() => fileState.name);
    const lang = languageFor(name);

    const saveKey = toCodeMirrorKey(resolveBinding("saveFile"));
    const editorState = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          ...(saveKey
            ? [{ key: saveKey, preventDefault: true, run: () => (doSave(), true) }]
            : []),
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        ...(lang ? [lang] : []),
        syntaxHighlight,
        addedField,
        removedField,
        peekField,
        changeGutter,
        baseTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const doc = u.state.doc.toString();
            fileState.content = doc;
            fileState.dirty = doc !== fileState.baseline;
          }
        }),
      ],
    });
    view = new EditorView({ state: editorState, parent: host });
    const g = buildGutter(view.state, diff);
    view.dispatch({ effects: [setAdded.of(g.added), setRemoved.of(g.removed)] });
  }

  // Rebuild the document only when a new file is loaded (rev bump). Reading the
  // content/diff under `untrack` keeps this effect from re-running on save.
  $effect(() => {
    void fileState.rev;
    void host;
    build();
  });

  // Refresh the gutter when the HEAD diff changes (e.g. after a save) without
  // tearing down the editor — preserves cursor/scroll and unsaved edits.
  $effect(() => {
    const diff = fileState.headDiff;
    if (!view) return;
    const g = buildGutter(view.state, diff);
    view.dispatch({ effects: [clearPeek.of(null), setAdded.of(g.added), setRemoved.of(g.removed)] });
  });

  // When this tab becomes active (also after a rebuild), the pane went from
  // hidden (display:none → zero-size) to visible: re-measure so CodeMirror
  // paints, and take focus for editing.
  $effect(() => {
    void fileState.rev;
    if (!active || !view) return;
    requestAnimationFrame(() => {
      view?.requestMeasure();
      view?.focus();
    });
  });

  onDestroy(() => view?.destroy());
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
  <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
    <FileIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
    <span class={cn("min-w-0 flex-1 truncate font-mono", text.body)} title={fileState.path}>
      {fileState.rel || fileState.name}
      {#if fileState.dirty}<span class="text-amber-600 dark:text-amber-400" title={i18n.t("editor.unsaved")}>●</span>{/if}
    </span>
    {#if !fileState.binary && !fileState.tooLarge}
      <Button
        variant="ghost"
        size="sm"
        class={cn("h-6", text.body)}
        disabled={!fileState.dirty || fileState.saving}
        title={i18n.t("editor.save")}
        onclick={doSave}
      >
        <SaveIcon data-icon="inline-start" />
        {fileState.saving ? i18n.t("editor.saving") : i18n.t("editor.save")}
      </Button>
    {/if}
  </header>

  {#if fileState.externallyChanged}
    <div
      class="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5"
    >
      <RefreshCwIcon class={cn(icon.decorative, "shrink-0 text-amber-600 dark:text-amber-400")} />
      <span class={cn("min-w-0 flex-1", text.body)}>{i18n.t("editor.externalChanged")}</span>
      <Button variant="outline" size="sm" class={cn("h-6", text.body)} onclick={() => void fileState.load()}>
        {i18n.t("editor.reload")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class={cn("h-6", text.body)}
        onclick={() => (fileState.externallyChanged = false)}
      >
        {i18n.t("editor.keepMine")}
      </Button>
    </div>
  {/if}

  {#if fileState.error}
    <div class="shrink-0 border-b border-border px-3 py-1.5">
      <p class={cn("text-destructive", text.body)}>{fileState.error}</p>
    </div>
  {/if}

  {#if fileState.loading}
    <p class={cn("p-4", text.meta)}>{i18n.t("common.loading")}</p>
  {:else if fileState.tooLarge}
    <p class={cn("p-4", text.meta)}>{i18n.t("editor.tooLarge")}</p>
  {:else if fileState.binary}
    <p class={cn("p-4", text.meta)}>{i18n.t("editor.binary")}</p>
  {:else}
    <div bind:this={host} class="min-h-0 flex-1 overflow-hidden"></div>
  {/if}
</div>

<style>
  /* Added lines (vs HEAD): light highlight + a left accent. */
  :global(.cm-added-line) {
    background-color: rgb(16 185 129 / 0.1);
    box-shadow: inset 2px 0 0 rgb(16 185 129 / 0.55);
  }
  :global(.dark .cm-added-line) {
    background-color: rgb(16 185 129 / 0.14);
  }
  /* Removed-lines gutter marker (click to peek). */
  :global(.cm-change-gutter) {
    width: 12px;
  }
  :global(.cm-removed-marker) {
    cursor: pointer;
    color: rgb(239 68 68 / 0.85);
    font-size: 10px;
    line-height: 1.5;
    display: block;
    text-align: center;
  }
  :global(.cm-removed-marker:hover) {
    color: rgb(220 38 38);
  }
  /* The peeked removed lines (read-only, red-tinted). */
  :global(.cm-removed-peek) {
    background-color: rgb(239 68 68 / 0.08);
    border-left: 2px solid rgb(239 68 68 / 0.55);
    padding: 2px 0;
    font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    overflow-x: auto;
  }
  :global(.cm-removed-peek-line) {
    padding: 0 8px 0 26px;
    color: rgb(185 28 28);
  }
  :global(.dark .cm-removed-peek-line) {
    color: rgb(252 165 165);
  }

  /* Syntax-highlight palette (class-based; follows the app theme). */
  :global(.tok-keyword) {
    color: rgb(168 85 247);
  }
  :global(.tok-comment) {
    color: rgb(107 114 128);
    font-style: italic;
  }
  :global(.tok-string) {
    color: rgb(22 163 74);
  }
  :global(.tok-number) {
    color: rgb(202 138 4);
  }
  :global(.tok-func) {
    color: rgb(37 99 235);
  }
  :global(.tok-type) {
    color: rgb(13 148 136);
  }
  :global(.tok-prop) {
    color: rgb(8 145 178);
  }
  :global(.tok-op) {
    color: rgb(100 116 139);
  }
  :global(.tok-meta) {
    color: rgb(217 119 6);
  }
  :global(.tok-var) {
    color: inherit;
  }
  :global(.tok-strong) {
    font-weight: 600;
  }
  :global(.tok-em) {
    font-style: italic;
  }
  :global(.tok-invalid) {
    color: rgb(220 38 38);
  }

  :global(.dark .tok-keyword) {
    color: rgb(196 154 255);
  }
  :global(.dark .tok-comment) {
    color: rgb(148 163 184);
  }
  :global(.dark .tok-string) {
    color: rgb(134 239 172);
  }
  :global(.dark .tok-number) {
    color: rgb(250 204 21);
  }
  :global(.dark .tok-func) {
    color: rgb(125 211 252);
  }
  :global(.dark .tok-type) {
    color: rgb(94 234 212);
  }
  :global(.dark .tok-prop) {
    color: rgb(103 232 249);
  }
  :global(.dark .tok-op) {
    color: rgb(148 163 184);
  }
  :global(.dark .tok-meta) {
    color: rgb(251 191 36);
  }
</style>
