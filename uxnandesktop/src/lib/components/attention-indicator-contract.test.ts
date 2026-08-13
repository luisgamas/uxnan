/**
 * The three places that tell you an agent wants something must speak one
 * vocabulary. They are written in three different files, none of them imports
 * the others, and nothing at runtime notices when one drifts — the sidebar just
 * quietly starts saying the same thing two ways.
 *
 * So this pins the shape of the vocabulary, not any particular glyph: change
 * the drawing if you like, but change it everywhere it means the same thing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** The Hugeicons subpath a component imports under `localName`. */
const glyphOf = (file: string, localName: string) => {
  const match = new RegExp(
    `import ${localName} from "@hugeicons/core-free-icons/(\\w+)"`,
  ).exec(source(file));
  expect(match, `${localName} import in ${file}`).not.toBeNull();
  return match![1];
};

describe("attention indicators", () => {
  it("marks the needs-you pill for both states it counts, not one of them", () => {
    // `needsYouCount` is the waiting **and** blocked pair, so borrowing either
    // state's glyph would tell you a question is pending when half of that
    // count is an agent stuck on someone else's API. A bell is the general
    // "something wants you" mark and stays true for both.
    const counted = readFileSync(
      new URL("../state/projects.svelte.ts", import.meta.url),
      "utf8",
    );
    expect(counted).toContain('s === "waiting" || s === "blocked"');

    const pill = glyphOf("LeftSidebar.svelte", "BellIcon");
    const indicator = source("AgentStatusIndicator.svelte");
    for (const stateGlyph of indicator.matchAll(
      /@hugeicons\/core-free-icons\/(\w+)/g,
    )) {
      expect(pill, "pill must not reuse a single state's glyph").not.toBe(stateGlyph[1]);
    }
  });

  it("keeps the waiting glyph off the circle silhouette its neighbours use", () => {
    // `done` and `blocked` are both rings at 12px. A "?" in a ring would make
    // the one state that is about *you* the hardest of the three to spot.
    const waiting = glyphOf("AgentStatusIndicator.svelte", "MessageCircleQuestionMarkIcon");
    expect(waiting).toMatch(/Chat|Bubble/);
    expect(waiting).not.toMatch(/Circle/);
  });

  it("draws unread the same way in a project row and a worktree row", () => {
    expect(glyphOf("ProjectCard.svelte", "MessageNotificationIcon")).toBe(
      glyphOf("WorktreeRow.svelte", "MessageNotificationIcon"),
    );
  });

  it("keeps the pill's mark readable next to its count", () => {
    // 12px `icon.status` is the in-row state size; inside the pill it sits
    // beside an 11px number and needs the 14px role to stay legible.
    const sidebar = source("LeftSidebar.svelte");
    const pill = sidebar.slice(sidebar.indexOf("projects.revealNeedsYou") - 700);
    expect(pill).toContain("icon={BellIcon} class={icon.decorative}");
  });

  it("ranks the brand logo above the state glyph beside it", () => {
    // These two sat at the same 12px, so "who is running" and "how it is doing"
    // carried equal weight and the mark was too small to identify at all.
    for (const name of ["AgentRow.svelte", "WorktreeRow.svelte"]) {
      expect(source(name), name).toContain("icon.brand");
    }
    const design = readFileSync(new URL("../design.ts", import.meta.url), "utf8");
    expect(design).toMatch(/brand: "size-4"/);
    // The state glyph is 14px: one notch under the mark, one over the 12px it
    // shares with in-row counters.
    const indicator = source("AgentStatusIndicator.svelte");
    expect(indicator).toContain("icon.decorative");
    expect(indicator).not.toContain("icon.status");
    expect(indicator).toContain("<CometTrail size={14} />");
  });

  it("sizes the needs-you pill like a badge, not like a control", () => {
    const sidebar = source("LeftSidebar.svelte");
    const pill = sidebar.slice(sidebar.indexOf("projects.revealNeedsYou") - 700);
    // `control.dense` is a 28px control height; on an 11px counter it paints a
    // pill far bigger than the text inside it.
    expect(pill).not.toContain("control.dense");
    expect(pill).toContain("px-1.5 py-0.5");
  });
});
