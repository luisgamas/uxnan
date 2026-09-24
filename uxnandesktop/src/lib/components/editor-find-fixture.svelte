<script lang="ts">
  // Test fixture: a bare CodeMirror editor with the find bar, its panel open.
  import { getAllContexts, onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { openSearchPanel } from "@codemirror/search";
  import { editorFind } from "$lib/editorFind.svelte";

  let { doc, onView }: { doc: string; onView?: (view: EditorView) => void } = $props();

  const contexts = getAllContexts();
  let host: HTMLDivElement;

  onMount(() => {
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [editorFind(contexts)] }),
      parent: host,
    });
    openSearchPanel(view);
    onView?.(view);
    return () => view.destroy();
  });
</script>

<div bind:this={host}></div>
