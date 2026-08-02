import type { Parser } from "@lezer/common";
import { classHighlighter, highlightCode as emitHighlightedCode } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { go } from "@codemirror/lang-go";

export interface HighlightRun {
  text: string;
  classes: string;
}

function parserFor(lang: string): Parser | null {
  switch (lang.trim().toLowerCase()) {
    case "js":
    case "javascript":
    case "mjs":
    case "cjs":
      return javascript().language.parser;
    case "jsx":
      return javascript({ jsx: true }).language.parser;
    case "ts":
    case "typescript":
      return javascript({ typescript: true }).language.parser;
    case "tsx":
      return javascript({ typescript: true, jsx: true }).language.parser;
    case "json":
    case "jsonc":
      return json().language.parser;
    case "css":
    case "scss":
    case "less":
      return css().language.parser;
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return html().language.parser;
    case "md":
    case "markdown":
      return markdown().language.parser;
    case "rs":
    case "rust":
      return rust().language.parser;
    case "py":
    case "python":
      return python().language.parser;
    case "yaml":
    case "yml":
      return yaml().language.parser;
    case "xml":
    case "svg":
      return xml().language.parser;
    case "c":
    case "h":
    case "cpp":
    case "c++":
    case "cc":
    case "cxx":
    case "hpp":
      return cpp().language.parser;
    case "java":
      return java().language.parser;
    case "php":
      return php().language.parser;
    case "sql":
      return sql().language.parser;
    case "go":
    case "golang":
      return go().language.parser;
    default:
      return null;
  }
}

/** Produce safe text/class runs for a fenced block. Unknown languages remain
 * verbatim plain text; supported languages reuse the editor's installed Lezer
 * parsers and stable tok-* class vocabulary. */
export function highlightMarkdownCode(source: string, lang: string | null): HighlightRun[] {
  const parser = lang ? parserFor(lang) : null;
  if (!parser || !source) return source ? [{ text: source, classes: "" }] : [];
  const runs: HighlightRun[] = [];
  const push = (text: string, classes: string) => {
    if (!text) return;
    const previous = runs.at(-1);
    if (previous?.classes === classes) previous.text += text;
    else runs.push({ text, classes });
  };
  emitHighlightedCode(
    source,
    parser.parse(source),
    classHighlighter,
    (text, classes) => push(text, classes),
    () => push("\n", ""),
  );
  return runs;
}
