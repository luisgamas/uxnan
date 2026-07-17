import { describe, it, expect } from "vitest";
import { renderMarkdown, type MdBlock, type MdInline } from "./markdown";

/** Flatten an inline run to its visible text (for terse assertions). */
function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        case "break":
          return "\n";
        case "image":
          return n.alt;
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}

describe("renderMarkdown", () => {
  it("parses ATX headings with their level and inline content", () => {
    const [h1, h2] = renderMarkdown("# Title\n\n## Sub _two_");
    expect(h1).toMatchObject({ type: "heading", level: 1 });
    expect(inlineText((h1 as Extract<MdBlock, { type: "heading" }>).children)).toBe("Title");
    expect(h2).toMatchObject({ type: "heading", level: 2 });
    const h2c = (h2 as Extract<MdBlock, { type: "heading" }>).children;
    expect(h2c.at(-1)).toMatchObject({ type: "em" });
    expect(inlineText(h2c)).toBe("Sub two");
  });

  it("parses inline emphasis, strong, strike and code in a paragraph", () => {
    const [p] = renderMarkdown("a **b** *c* ~~d~~ `e`");
    expect(p.type).toBe("paragraph");
    const kinds = (p as Extract<MdBlock, { type: "paragraph" }>).children.map((c) => c.type);
    expect(kinds).toContain("strong");
    expect(kinds).toContain("em");
    expect(kinds).toContain("del");
    expect(kinds).toContain("code");
  });

  it("extracts link href/title/label and image src/alt", () => {
    const [p] = renderMarkdown('see [docs](https://x.com "T") and ![a logo](./logo.png)');
    const kids = (p as Extract<MdBlock, { type: "paragraph" }>).children;
    const link = kids.find((c) => c.type === "link");
    expect(link).toMatchObject({ type: "link", href: "https://x.com", title: "T" });
    expect(inlineText([link!])).toBe("docs");
    const img = kids.find((c) => c.type === "image");
    expect(img).toMatchObject({ type: "image", src: "./logo.png", alt: "a logo" });
  });

  it("parses an autolink as a link to itself", () => {
    const [p] = renderMarkdown("<https://auto.link>");
    const link = (p as Extract<MdBlock, { type: "paragraph" }>).children[0];
    expect(link).toMatchObject({ type: "link", href: "https://auto.link" });
  });

  it("parses a blockquote's inner blocks and strips the quote marks", () => {
    const [bq] = renderMarkdown("> line one\n> line two");
    expect(bq.type).toBe("blockquote");
    const inner = (bq as Extract<MdBlock, { type: "blockquote" }>).children;
    expect(inner[0].type).toBe("paragraph");
    expect(inlineText((inner[0] as Extract<MdBlock, { type: "paragraph" }>).children)).not.toContain(
      ">",
    );
  });

  it("parses bullet lists including GFM task items", () => {
    const [list] = renderMarkdown("- plain\n- [ ] todo\n- [x] done");
    expect(list).toMatchObject({ type: "list", ordered: false });
    const items = (list as Extract<MdBlock, { type: "list" }>).items;
    expect(items.map((i) => i.checked)).toEqual([null, false, true]);
    expect(inlineText((items[1].children[0] as Extract<MdBlock, { type: "paragraph" }>).children)).toBe(
      "todo",
    );
  });

  it("parses an ordered list's starting number", () => {
    const [list] = renderMarkdown("3. three\n4. four");
    expect(list).toMatchObject({ type: "list", ordered: true, start: 3 });
  });

  it("parses a fenced code block with its language, verbatim", () => {
    const [code] = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(code).toEqual({ type: "codeBlock", lang: "ts", value: "const x = 1;" });
  });

  it("parses a GFM table with per-column alignment", () => {
    const [table] = renderMarkdown("| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    const t = table as Extract<MdBlock, { type: "table" }>;
    expect(t.align).toEqual(["left", "center", "right"]);
    expect(t.header.map(inlineText)).toEqual(["A", "B", "C"]);
    expect(t.rows[0].map(inlineText)).toEqual(["1", "2", "3"]);
  });

  it("emits a thematic break", () => {
    expect(renderMarkdown("---")[0]).toEqual({ type: "rule" });
  });

  it("carries a raw HTML block as escaped text (never executed)", () => {
    const [html] = renderMarkdown("<div onclick=x>hi</div>");
    expect(html).toEqual({ type: "html", value: "<div onclick=x>hi</div>" });
  });

  it("decodes entities and honors backslash escapes", () => {
    const [p] = renderMarkdown("A &amp; B and \\*not italic\\*");
    expect(inlineText((p as Extract<MdBlock, { type: "paragraph" }>).children)).toBe(
      "A & B and *not italic*",
    );
  });

  it("returns an empty list for empty input", () => {
    expect(renderMarkdown("")).toEqual([]);
    expect(renderMarkdown("   \n\n")).toEqual([]);
  });

  // --- GitHub-flavored bits that bot comments lean on -----------------------

  it("drops HTML comments, which GitHub hides", () => {
    // Bots use them as machine markers; rendering them buried the real comment.
    expect(renderMarkdown("<!-- summarize by coderabbit.ai -->")).toEqual([]);
    expect(renderMarkdown("<!-- a -->\n\n<!-- b -->")).toEqual([]);
  });

  it("keeps real HTML while stripping comments around it", () => {
    const [html] = renderMarkdown("<!-- marker --><div>hi</div>");
    expect(html).toEqual({ type: "html", value: "<div>hi</div>" });
  });

  it("renders a GitHub alert marker as an alert, not a link named !WARNING", () => {
    const [alert] = renderMarkdown("> [!WARNING]\n> Review limit reached");
    expect(alert.type).toBe("alert");
    const a = alert as Extract<MdBlock, { type: "alert" }>;
    expect(a.kind).toBe("warning");
    // The marker line itself is consumed, leaving only the body.
    expect(a.children).toHaveLength(1);
    expect(inlineText((a.children[0] as Extract<MdBlock, { type: "paragraph" }>).children)).toBe(
      "Review limit reached",
    );
  });

  it("recognizes every alert kind, case-insensitively", () => {
    for (const kind of ["note", "tip", "important", "warning", "caution"]) {
      const [b] = renderMarkdown(`> [!${kind.toUpperCase()}]\n> body`);
      expect(b.type).toBe("alert");
      expect((b as Extract<MdBlock, { type: "alert" }>).kind).toBe(kind);
    }
  });

  it("leaves an ordinary blockquote alone", () => {
    const [b] = renderMarkdown("> just a quote");
    expect(b.type).toBe("blockquote");
    // A bracketed link that isn't an alert marker must not be eaten either.
    const [c] = renderMarkdown("> [!NOTABLE]\n> body");
    expect(c.type).toBe("blockquote");
  });

  it("renders <details> as a disclosure with its body parsed as Markdown", () => {
    const [d] = renderMarkdown(
      "<details>\n<summary>How can I continue?</summary>\n\n**Wait** for the limit.\n</details>",
    );
    expect(d.type).toBe("details");
    const det = d as Extract<MdBlock, { type: "details" }>;
    expect(det.summary).toBe("How can I continue?");
    expect(det.children[0].type).toBe("paragraph");
  });

  it("keeps sibling <details> apart instead of nesting them in the first", () => {
    // Inside a blockquote no line is blank, so every disclosure lands in ONE HTML
    // block — a greedy match ran from the first opener to the LAST closer and ate
    // the sibling. This is the exact shape a coderabbitai[bot] comment produces.
    const [b] = renderMarkdown(
      "> [!WARNING]\n> limit reached\n>\n> <details>\n> <summary>How can I continue?</summary>\n>\n> Wait.\n>\n> </details>\n>\n> <details>\n> <summary>How do limits work?</summary>\n>\n> Per developer.\n>\n> </details>",
    );
    const alert = b as Extract<MdBlock, { type: "alert" }>;
    const details = alert.children.filter((c) => c.type === "details");
    expect(details.map((d) => (d as Extract<MdBlock, { type: "details" }>).summary)).toEqual([
      "How can I continue?",
      "How do limits work?",
    ]);
    // No stray "</details>" left rendering as raw HTML anywhere.
    expect(JSON.stringify(alert)).not.toContain("</details>");
  });

  it("leaves an unclosed <details> raw rather than swallowing the document", () => {
    const out = renderMarkdown("<details>\n<summary>Oops</summary>\n\nbody text");
    expect(out.some((b) => b.type === "details")).toBe(false);
    expect(out.some((b) => b.type === "paragraph")).toBe(true);
  });

  it("strips the quote markers Lezer leaves on HTML nested in a blockquote", () => {
    // Lezer reports the node's raw source range, so a `<details>` inside a `>`
    // quote arrives with a literal "> " on every line after the first — which
    // used to be dumped on screen verbatim.
    const [b] = renderMarkdown(
      "> [!WARNING]\n> body\n>\n> <details>\n> <summary>Why?</summary>\n> Because.\n> </details>",
    );
    const alert = b as Extract<MdBlock, { type: "alert" }>;
    const details = alert.children.find((c) => c.type === "details");
    expect(details).toBeDefined();
    expect((details as Extract<MdBlock, { type: "details" }>).summary).toBe("Why?");
  });
});
