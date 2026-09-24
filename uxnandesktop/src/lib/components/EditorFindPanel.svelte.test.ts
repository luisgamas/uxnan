import { describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { getSearchQuery } from "@codemirror/search";

import { mountWithProviders, until } from "../../test/render";
import Fixture from "./editor-find-fixture.svelte";

async function open(doc: string) {
  let view: EditorView | undefined;
  const mounted = mountWithProviders(Fixture, { props: { doc, onView: (v: EditorView) => (view = v) } });
  await until(() => view !== undefined);
  return { ...mounted, view: view! };
}

describe("the editor's find bar", () => {
  it("is drawn with the app's controls and counts what it finds", async () => {
    const { screen, user, view } = await open("foo bar Foo foo");
    await user.type(screen.getByRole("textbox", { name: "Find" }), "foo");
    expect(getSearchQuery(view.state).search).toBe("foo");
    expect(await screen.findByText("1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Match case" }));
    expect(getSearchQuery(view.state).caseSensitive).toBe(true);
    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
  });

  it("says when nothing matches, and offers replace on demand", async () => {
    const { screen, user } = await open("alpha");
    await user.type(screen.getByRole("textbox", { name: "Find" }), "zzz");
    expect(await screen.findByText("No results")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Replace" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show replace" }));
    expect(screen.getByRole("textbox", { name: "Replace" })).toBeInTheDocument();
  });
});
