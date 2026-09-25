/**
 * The chat composer's keys: Enter sends, and on an empty composer ↑ / ↓ walk
 * the thread's earlier messages (the recall the phone and a terminal offer).
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders } from "../../../test/render";
import ChatComposer from "./ChatComposer.svelte";

describe("ChatComposer", () => {
  it("recalls earlier messages with ↑ and walks back with ↓", async () => {
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { history: ["first", "second"], onsend: () => undefined },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("{ArrowUp}");
    expect(box.value).toBe("second");
    await user.keyboard("{ArrowUp}");
    expect(box.value).toBe("first");
    await user.keyboard("{ArrowDown}");
    expect(box.value).toBe("second");
    await user.keyboard("{ArrowDown}");
    expect(box.value).toBe("");
  });

  it("never replaces text being written, and sends it on Enter", async () => {
    const sent: string[] = [];
    const { screen, user } = mountWithProviders(ChatComposer, {
      props: { history: ["old"], onsend: (t: string) => void sent.push(t) },
    });
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(box);
    await user.keyboard("new idea{ArrowUp}");
    expect(box.value).toBe("new idea");
    await user.keyboard("{Enter}");
    expect(sent).toEqual(["new idea"]);
    expect(box.value).toBe("");
  });
});
