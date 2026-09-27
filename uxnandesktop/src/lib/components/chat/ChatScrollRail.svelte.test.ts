/**
 * The chat's scroll rail: a mark per message sent, which shows that message
 * (and the end of its reply) when pointed at and jumps there when picked —
 * from the keyboard as well as the mouse.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders } from "../../../test/render";
import ChatScrollRail from "./ChatScrollRail.svelte";

const anchors = [
  { turnId: "a", preview: "fix the dialog", reply: "It fits now." },
  { turnId: "b", preview: "and the rail?" },
  { turnId: "c", preview: "thanks" },
];

describe("ChatScrollRail", () => {
  it("draws nothing for a single message", () => {
    const { screen } = mountWithProviders(ChatScrollRail, {
      props: { anchors: anchors.slice(0, 1), onselect: () => undefined },
    });
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("walks the messages with the arrows, previews each and jumps on Enter", async () => {
    const picked: number[] = [];
    const { screen, user } = mountWithProviders(ChatScrollRail, {
      props: { anchors, current: 2, onselect: (index: number) => void picked.push(index) },
    });
    const rail = screen.getByRole("slider", { name: "Messages in this conversation" });
    expect(rail.getAttribute("aria-valuetext")).toBe("thanks");

    rail.focus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByText("fix the dialog")).toBeTruthy();
    expect(screen.getByText("It fits now.")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(picked).toEqual([0]);
  });
});
