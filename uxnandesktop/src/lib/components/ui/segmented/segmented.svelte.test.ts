import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { mount, mountWithProviders } from "../../../../test/render";
import Segmented from "./segmented.svelte";
import SegmentedToggles from "./segmented-toggles.svelte";

const views = [
  { value: "changes", label: "Changes", count: 3 },
  { value: "history", label: "History" },
];

describe("Segmented", () => {
  it("shows which option is chosen, with its count", () => {
    const { screen } = mount(Segmented, { props: { value: "changes", options: views, onValueChange: () => {} } });
    const changes = screen.getByRole("radio", { name: /Changes/ });
    expect(changes).toHaveAttribute("data-state", "on");
    expect(changes).toHaveTextContent("3");
    expect(screen.getByRole("radio", { name: "History" })).toHaveAttribute("data-state", "off");
  });

  it("reports a new choice, and keeps the chosen one when it is pressed again", async () => {
    const onValueChange = vi.fn();
    const { screen, user } = mount(Segmented, { props: { value: "changes", options: views, onValueChange } });
    await user.click(screen.getByRole("radio", { name: /Changes/ }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Changes/ })).toHaveAttribute("data-state", "on");
    await user.click(screen.getByRole("radio", { name: "History" }));
    expect(onValueChange).toHaveBeenCalledWith("history");
  });

  it("names a glyph-only option by its tooltip", () => {
    const { screen } = mountWithProviders(SegmentedToggles, {
      props: {
        value: ["case"],
        options: [
          { value: "case", glyph: "Aa", tooltip: "Match case" },
          { value: "regexp", glyph: ".*", tooltip: "Regex" },
        ],
        onValueChange: () => {},
      },
    });
    expect(screen.getByRole("button", { name: "Match case" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Regex" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches several options on and off", async () => {
    const onValueChange = vi.fn();
    const { screen, user } = mountWithProviders(SegmentedToggles, {
      props: {
        value: [],
        options: [{ value: "word", glyph: "ab", tooltip: "Whole word" }],
        onValueChange,
      },
    });
    await user.click(screen.getByRole("button", { name: "Whole word" }));
    expect(onValueChange).toHaveBeenCalledWith(["word"]);
  });
});

describe("the app's mode switches", () => {
  it("all draw the shared segmented control, not their own copy", () => {
    const root = join(process.cwd(), "src/lib/components");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".svelte") && /segmentedList|segmentedTrigger/.test(readFileSync(path, "utf8"))) {
          offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
