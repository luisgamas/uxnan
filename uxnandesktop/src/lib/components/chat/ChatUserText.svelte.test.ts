import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../../test/render";
import ChatUserText from "./ChatUserText.svelte";
import { textPreviewOf } from "./ChatSentAttachment.svelte";
import type { ChatChip } from "$lib/bridge/inlineMessage";

const chip = (name: string, kind: "image" | "file" = "file"): ChatChip => ({
  id: name,
  name,
  kind,
  mimeType: kind === "image" ? "image/png" : "text/plain",
  load: () => Promise.resolve("data:image/png;base64,AAAA"),
});

/** jsdom lays nothing out: give every element the height a long text has. */
function tall(px: number) {
  return vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(px);
}

afterEach(() => vi.restoreAllMocks());

describe("ChatUserText", () => {
  it("folds a long message under Show more, and unfolds it", async () => {
    tall(900);
    const { screen, user } = mount(ChatUserText, { props: { text: "a\\n".repeat(60) } });
    const more = await screen.findByRole("button", { name: "Show more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-folded]")).not.toBeNull();
    await user.click(more);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-folded]")).toBeNull();
  });

  it("draws a short message as it is", () => {
    tall(40);
    const { screen } = mount(ChatUserText, { props: { text: "fix the build" } });
    expect(screen.getByText("fix the build")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws each attachment inside the words, where it was written", async () => {
    tall(40);
    const { screen } = mount(ChatUserText, {
      props: { text: "first ￼ then ￼", attachments: [chip("a.png", "image"), chip("b.txt")] },
    });
    const bubble = screen.getByText(/first/);
    const order = [...bubble.childNodes]
      .map((n) => (n.nodeType === Node.TEXT_NODE ? n.nodeValue : (n as HTMLElement).textContent))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    expect(order).toBe("first a.png then b.txt");
    expect(await screen.findByRole("button", { name: "Open a.png" })).toBeTruthy();
    expect(bubble.textContent).not.toContain("￼");
  });

  it("puts an attachment with no place in the words after them", () => {
    tall(40);
    const { screen } = mount(ChatUserText, { props: { text: "old message", attachments: [chip("c.txt")] } });
    const bubble = screen.getByText(/old message/);
    expect(bubble.querySelector("br")).not.toBeNull();
    expect(bubble.textContent).toContain("c.txt");
  });

  it("previews the start of a text file", () => {
    expect(textPreviewOf(`data:text/plain;base64,${btoa("hello\nworld")}`)).toBe("hello\nworld");
    expect(textPreviewOf("data:text/plain;base64,@@@")).toBe("");
    expect(textPreviewOf(`data:text/plain;base64,${btoa("x".repeat(9000))}`)).toHaveLength(4001);
  });
});

