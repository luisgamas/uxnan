import { describe, expect, it } from "vitest";
import { highlightMarkdownCode } from "./markdownHighlight";

describe("highlightMarkdownCode", () => {
  it("marks supported language tokens while preserving all source text", () => {
    const source = 'const answer: number = 42;\nconsole.log("ok");';
    const runs = highlightMarkdownCode(source, "ts");
    expect(runs.map((run) => run.text).join("")).toBe(source);
    expect(runs.some((run) => run.classes.includes("tok-keyword"))).toBe(true);
    expect(runs.some((run) => run.classes.includes("tok-number"))).toBe(true);
  });

  it("keeps unknown languages as one plain verbatim run", () => {
    expect(highlightMarkdownCode("raw <&>", "unknown")).toEqual([
      { text: "raw <&>", classes: "" },
    ]);
  });
});
