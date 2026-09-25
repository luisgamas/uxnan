import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown, streamCoalesceWindow } from "./streamingMarkdown";

function lossless(source: string) {
  expect(splitStreamingMarkdown(source).join("")).toBe(source);
}

describe("splitStreamingMarkdown", () => {
  it("gives no chunks for empty input and one growing chunk without a blank line", () => {
    expect(splitStreamingMarkdown("")).toEqual([]);
    const source = "A single line still being written";
    expect(splitStreamingMarkdown(source)).toEqual([source]);
  });

  it("splits paragraphs, the last one being the tail", () => {
    const source = "First paragraph.\n\nSecond paragraph.\n\nThird, still";
    expect(splitStreamingMarkdown(source)).toEqual([
      "First paragraph.\n\n",
      "Second paragraph.\n\n",
      "Third, still",
    ]);
    lossless(source);
  });

  it("starts a fresh chunk at a heading", () => {
    expect(splitStreamingMarkdown("Intro.\n\n## Title\n\nBody.")).toEqual([
      "Intro.\n\n",
      "## Title\n\n",
      "Body.",
    ]);
  });

  it("never cuts inside a fenced code block, even an unterminated one", () => {
    const closed = "Code:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.";
    expect(splitStreamingMarkdown(closed)).toEqual([
      "Code:\n\n",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n",
      "After.",
    ]);
    const open = "Example:\n\n```ts\nfunction main() {\n\n  print(";
    expect(splitStreamingMarkdown(open)).toEqual(["Example:\n\n", "```ts\nfunction main() {\n\n  print("]);
    lossless(closed);
    lossless(open);
  });

  it("never cuts where the next line may continue the block above", () => {
    for (const source of [
      "Steps:\n\n- one\n\n- two\n\n- three",
      "Order:\n\n1. one\n\n2. two",
      "Said:\n\n> one thing\n\n> and another",
      "Table:\n\n| a | b |\n| - | - |\n\n| 1 | 2 |",
      "Like this:\n\n    indented code\n\n    and more",
      "See [the doc][d].\n\n[d]: https://example.com",
    ]) {
      expect(splitStreamingMarkdown(source)).toEqual([source]);
    }
  });

  it("keeps trailing blank lines in the tail and CRLF verbatim", () => {
    expect(splitStreamingMarkdown("A paragraph.\n\n")).toEqual(["A paragraph.\n\n"]);
    expect(splitStreamingMarkdown("One.\r\n\r\nTwo.")).toEqual(["One.\r\n\r\n", "Two."]);
  });

  it("never changes a settled chunk as the reply grows", () => {
    const reply = "Intro paragraph.\n\n## Plan\n\nFirst we read.\n\n```sh\nnpm test\n```\n\nDone, all green.";
    let settled: string[] = [];
    for (let i = 1; i <= reply.length; i += 1) {
      const chunks = splitStreamingMarkdown(reply.slice(0, i));
      const frozen = chunks.slice(0, -1);
      // Every chunk settled earlier is still there, unchanged.
      expect(frozen.slice(0, settled.length)).toEqual(settled);
      settled = frozen;
    }
    expect(settled.length).toBeGreaterThan(2);
  });
});

describe("streamCoalesceWindow", () => {
  it("is one frame for a short reply and grows with it up to 100 ms", () => {
    expect(streamCoalesceWindow(0)).toBe(16);
    expect(streamCoalesceWindow(600)).toBe(16);
    expect(streamCoalesceWindow(3_000)).toBe(50);
    expect(streamCoalesceWindow(60_000)).toBe(100);
  });
});
