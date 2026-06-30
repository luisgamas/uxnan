<script lang="ts">
  // Diff viewer on CodeMirror 6 (read-only, virtual-scrolls large diffs). Two
  // modes: unified (one column) and a synced side-by-side. Per-hunk actions
  // (stage / unstage / discard) live in a small bar above the editor — kept out
  // of the CodeMirror render so they can never blank it out. Hunk actions are
  // emitted via `onHunk`; the parent applies the single-hunk sub-patch.
  import { onMount, onDestroy } from "svelte";
  import {
    Decoration,
    EditorView,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
  } from "@codemirror/view";
  import { EditorState, RangeSetBuilder } from "@codemirror/state";
  import { parseDiff, hunkPatch, toSideRows } from "$lib/diff";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { text as textToken } from "$lib/design";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ColumnsIcon from "@lucide/svelte/icons/columns-2";
  import AlignLeftIcon from "@lucide/svelte/icons/align-left";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import Undo2Icon from "@lucide/svelte/icons/undo-2";

  type HunkAction = "stage" | "unstage" | "discard";

  let {
    diff,
    area = null,
    onHunk,
  }: {
    diff: string;
    /** Which actions to offer per hunk; null = read-only (no buttons). */
    area?: "staged" | "changes" | null;
    onHunk?: (patch: string, action: HunkAction) => void;
  } = $props();

  let mode = $state<"unified" | "side">("unified");
  const parsed = $derived(parseDiff(diff));

  // Discard needs confirmation; hold the pending hunk patch until confirmed.
  let discardOpen = $state(false);
  let pendingPatch = $state<string | null>(null);

  function act(hunkIndex: number, action: HunkAction) {
    const hunk = parsed.hunks[hunkIndex];
    if (!hunk) return;
    const patch = hunkPatch(parsed, hunk);
    if (action === "discard") {
      pendingPatch = patch;
      discardOpen = true;
      return;
    }
    onHunk?.(patch, action);
  }

  /** Scroll the unified editor to a hunk's header line. */
  function scrollToHunk(hunkIndex: number) {
    const hunk = parsed.hunks[hunkIndex];
    if (!hunk || !unifiedView) return;
    const lineNo = Math.min(hunk.startLine + 1, unifiedView.state.doc.lines);
    const pos = unifiedView.state.doc.line(lineNo).from;
    unifiedView.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
  }

  // --- CodeMirror plumbing ---------------------------------------------------

  function classForLine(t: string): string | null {
    if (t.startsWith("@@")) return "cm-diff-hunk";
    if (t.startsWith("+++") || t.startsWith("---")) return "cm-diff-meta";
    if (t.startsWith("+")) return "cm-diff-add";
    if (t.startsWith("-")) return "cm-diff-del";
    if (/^(diff |index |new file|deleted file|rename |similarity )/.test(t))
      return "cm-diff-meta";
    return null;
  }

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
    ".cm-line": { padding: "0 8px" },
  });

  function lineHighlighter(classOf: (text: string, n: number) => string | null) {
    const build = (v: EditorView): DecorationSet => {
      const b = new RangeSetBuilder<Decoration>();
      for (let i = 1; i <= v.state.doc.lines; i++) {
        const line = v.state.doc.line(i);
        const cls = classOf(line.text, i);
        if (cls) b.add(line.from, line.from, Decoration.line({ class: cls }));
      }
      return b.finish();
    };
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(v: EditorView) {
          this.decorations = build(v);
        }
        update(u: ViewUpdate) {
          if (u.docChanged) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    );
  }

  // --- views (hosts are always mounted; visibility is CSS) -------------------

  let unifiedHost = $state<HTMLDivElement>();
  let leftHost = $state<HTMLDivElement>();
  let rightHost = $state<HTMLDivElement>();
  let unifiedView: EditorView | undefined;
  let leftView: EditorView | undefined;
  let rightView: EditorView | undefined;

  function sideClasses(rows: { kind: string }[], side: "left" | "right") {
    return (_t: string, n: number): string | null => {
      const r = rows[n - 1];
      if (!r) return null;
      if (r.kind === "hunk") return "cm-diff-hunk";
      if (r.kind === "del") return side === "left" ? "cm-diff-del" : "cm-side-empty";
      if (r.kind === "add") return side === "right" ? "cm-diff-add" : "cm-side-empty";
      return null;
    };
  }

  function makeView(host: HTMLDivElement, doc: string, classOf: (t: string, n: number) => string | null) {
    return new EditorView({
      doc,
      parent: host,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineHighlighter(classOf),
        baseTheme,
      ],
    });
  }

  function rebuild() {
    if (!unifiedHost || !leftHost || !rightHost) return;
    unifiedView?.destroy();
    leftView?.destroy();
    rightView?.destroy();

    unifiedView = makeView(unifiedHost, diff, classForLine);

    const rows = toSideRows(diff);
    leftView = makeView(leftHost, rows.map((r) => r.left ?? "").join("\n"), sideClasses(rows, "left"));
    rightView = makeView(rightHost, rows.map((r) => r.right ?? "").join("\n"), sideClasses(rows, "right"));

    // Sync vertical scroll between the two side panes.
    let syncing = false;
    const link = (from: EditorView, to: EditorView) =>
      from.scrollDOM.addEventListener("scroll", () => {
        if (syncing) return;
        syncing = true;
        to.scrollDOM.scrollTop = from.scrollDOM.scrollTop;
        syncing = false;
      });
    link(leftView, rightView);
    link(rightView, leftView);
    measureSoon();
  }

  /** CodeMirror paints from a measured height; a view created (or revealed) in a
   *  0-high / hidden container shows nothing until it remeasures. Nudge them. */
  function measureSoon() {
    requestAnimationFrame(() => {
      unifiedView?.requestMeasure();
      leftView?.requestMeasure();
      rightView?.requestMeasure();
    });
  }

  // Rebuild when the diff changes (hosts are always present, so no timing race).
  $effect(() => {
    void diff;
    rebuild();
  });

  // Remeasure the now-visible view(s) when the mode flips.
  $effect(() => {
    void mode;
    measureSoon();
  });

  let rootEl = $state<HTMLDivElement>();
  onMount(() => {
    if (!rootEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureSoon());
    ro.observe(rootEl);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    unifiedView?.destroy();
    leftView?.destroy();
    rightView?.destroy();
  });
</script>

<div bind:this={rootEl} class="flex h-full min-h-0 flex-col gap-1.5">
  <!-- Toolbar: per-hunk actions (left) + mode toggle (right) -->
  <div class="flex shrink-0 items-center gap-2">
    {#if area && mode === "unified" && parsed.hunks.length > 0}
      <div class="uxnan-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {#each parsed.hunks as h (h.index)}
          <div class="flex shrink-0 items-center overflow-hidden rounded-md border border-border">
            <button
              type="button"
              class={cn("px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground", textToken.indicator)}
              title={h.header}
              onclick={() => scrollToHunk(h.index)}
            >
              #{h.index + 1}
            </button>
            {#if area === "staged"}
              <button
                type="button"
                class="border-l border-border/60 px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={i18n.t("diff.unstageHunk")}
                onclick={() => act(h.index, "unstage")}
              >
                <MinusIcon class="size-3.5" />
              </button>
            {:else}
              <button
                type="button"
                class="border-l border-border/60 px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={i18n.t("diff.stageHunk")}
                onclick={() => act(h.index, "stage")}
              >
                <PlusIcon class="size-3.5" />
              </button>
              <button
                type="button"
                class="border-l border-border/60 px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                title={i18n.t("diff.discardHunk")}
                onclick={() => act(h.index, "discard")}
              >
                <Undo2Icon class="size-3.5" />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="min-w-0 flex-1"></div>
    {/if}

    <div class="inline-flex shrink-0 overflow-hidden rounded-md border border-border">
      <button
        type="button"
        class={cn(
          "flex items-center gap-1 px-2 py-0.5",
          textToken.indicator,
          mode === "unified" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        title={i18n.t("diff.unified")}
        onclick={() => (mode = "unified")}
      >
        <AlignLeftIcon class="size-3.5" />
        {i18n.t("diff.unified")}
      </button>
      <button
        type="button"
        class={cn(
          "flex items-center gap-1 border-l border-border/60 px-2 py-0.5",
          textToken.indicator,
          mode === "side" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
        title={i18n.t("diff.sideBySide")}
        onclick={() => (mode = "side")}
      >
        <ColumnsIcon class="size-3.5" />
        {i18n.t("diff.sideBySide")}
      </button>
    </div>
  </div>

  <!-- Both layouts stay mounted; only the active one is shown. -->
  <div
    bind:this={unifiedHost}
    class={cn(
      "min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background",
      mode !== "unified" && "hidden",
    )}
  ></div>
  <div class={cn("grid min-h-0 flex-1 grid-cols-2 gap-1", mode !== "side" && "hidden")}>
    <div bind:this={leftHost} class="min-h-0 overflow-hidden rounded-md border border-border bg-background"></div>
    <div bind:this={rightHost} class="min-h-0 overflow-hidden rounded-md border border-border bg-background"></div>
  </div>
</div>

<ConfirmDialog
  bind:open={discardOpen}
  title={i18n.t("diff.discardHunkTitle")}
  description={i18n.t("diff.discardHunkDesc")}
  confirmLabel={i18n.t("diff.discardHunk")}
  danger
  onconfirm={() => {
    if (pendingPatch) onHunk?.(pendingPatch, "discard");
    pendingPatch = null;
  }}
/>

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
  :global(.cm-side-empty) {
    background-color: rgb(127 127 127 / 0.06);
  }
</style>
