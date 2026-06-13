<script lang="ts">
  // Unified-diff viewer on CodeMirror 6 (read-only): virtual-scrolls large diffs
  // and lets the user select/search, with per-line add/remove/hunk coloring via
  // line decorations. (Side-by-side is a Phase 5 follow-up.)
  import { onMount, onDestroy } from "svelte";
  import {
    Decoration,
    EditorView,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
  } from "@codemirror/view";
  import { EditorState, RangeSetBuilder } from "@codemirror/state";

  let { diff }: { diff: string } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  function classForLine(t: string): string | null {
    if (t.startsWith("@@")) return "cm-diff-hunk";
    if (t.startsWith("+++") || t.startsWith("---")) return "cm-diff-meta";
    if (t.startsWith("+")) return "cm-diff-add";
    if (t.startsWith("-")) return "cm-diff-del";
    if (/^(diff |index |new file|deleted file|rename |similarity )/.test(t))
      return "cm-diff-meta";
    return null;
  }

  function buildDecorations(v: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (let i = 1; i <= v.state.doc.lines; i++) {
      const line = v.state.doc.line(i);
      const cls = classForLine(line.text);
      if (cls) builder.add(line.from, line.from, Decoration.line({ class: cls }));
    }
    return builder.finish();
  }

  const highlighter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) {
        this.decorations = buildDecorations(v);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = buildDecorations(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const theme = EditorView.theme({
    "&": { backgroundColor: "transparent", color: "inherit", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: "12px",
      lineHeight: "1.5",
      overflow: "auto",
    },
    ".cm-content": { padding: "4px 0" },
    ".cm-line": { padding: "0 8px" },
  });

  onMount(() => {
    view = new EditorView({
      doc: diff,
      parent: host,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        highlighter,
        theme,
      ],
    });
  });

  // Swap the document when the selected file's diff changes.
  $effect(() => {
    const next = diff;
    if (view && next !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    }
  });

  onDestroy(() => view?.destroy());
</script>

<div
  bind:this={host}
  class="h-full overflow-hidden rounded-md border border-border bg-background"
></div>

<style>
  :global(.cm-diff-add) {
    background-color: rgb(16 185 129 / 0.12);
    color: rgb(4 120 87);
  }
  :global(.dark .cm-diff-add) {
    color: rgb(110 231 183);
  }
  :global(.cm-diff-del) {
    background-color: rgb(239 68 68 / 0.12);
    color: rgb(185 28 28);
  }
  :global(.dark .cm-diff-del) {
    color: rgb(252 165 165);
  }
  :global(.cm-diff-hunk) {
    background-color: rgb(14 165 233 / 0.12);
    color: rgb(3 105 161);
  }
  :global(.dark .cm-diff-hunk) {
    color: rgb(125 211 252);
  }
  :global(.cm-diff-meta) {
    opacity: 0.6;
  }
</style>
