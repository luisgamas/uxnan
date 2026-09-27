import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../../test/render";
import ChatUserText from "./ChatUserText.svelte";

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
});
