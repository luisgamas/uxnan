import { describe, it, expect } from "vitest";

import { focusContextOf } from "./router";

describe("focusContextOf", () => {
  it("tells a terminal, an editor, a text field and the rest apart", () => {
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const inXterm = document.createElement("textarea");
    xterm.append(inXterm);
    expect(focusContextOf(inXterm)).toBe("terminal");

    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const content = document.createElement("div");
    cm.append(content);
    expect(focusContextOf(content)).toBe("editor");

    expect(focusContextOf(document.createElement("textarea"))).toBe("text");
    const input = document.createElement("input");
    expect(focusContextOf(input)).toBe("text");
    input.type = "checkbox";
    expect(focusContextOf(input)).toBe("app");
    expect(focusContextOf(document.createElement("button"))).toBe("app");
    expect(focusContextOf(null)).toBe("app");
  });
});
