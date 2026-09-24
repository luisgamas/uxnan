// The file editor's find panel: CodeMirror's search engine (`@codemirror/search`
// — query, highlights, next/previous, replace) with the app's own bar in place
// of the library's (`EditorFindPanel.svelte`).

import { mount, unmount } from "svelte";
import type { Panel, EditorView, ViewUpdate } from "@codemirror/view";
import { getSearchQuery, search, setSearchQuery } from "@codemirror/search";
import type { Extension } from "@codemirror/state";

import EditorFindPanel from "$lib/components/EditorFindPanel.svelte";

/** Mount the app's bar as the editor's top panel, and keep it told about the
 *  query and every document or selection change. `context` is the editor's
 *  component context (tooltips need their provider): the bar is its own root. */
function createFindPanel(view: EditorView, context: Map<unknown, unknown>): Panel {
  const dom = document.createElement("div");
  const live = $state({ query: getSearchQuery(view.state), rev: 0 });
  const component = mount(EditorFindPanel, { target: dom, props: { view, live }, context });
  return {
    dom,
    top: true,
    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) live.query = effect.value;
        }
      }
      if (update.docChanged || update.selectionSet) live.rev += 1;
    },
    destroy() {
      void unmount(component);
    },
  };
}

/** Find / replace for the file editor (Mod+F opens it through `searchKeymap`).
 *  Pass the editor component's `getAllContexts()`. */
export function editorFind(context: Map<unknown, unknown>): Extension {
  return search({ top: true, createPanel: (view) => createFindPanel(view, context) });
}
