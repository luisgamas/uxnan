// CodeMirror language selection + syntax-highlight style for the file editor.
//
// Maps a file name's extension to a CodeMirror `LanguageSupport`, and defines a
// class-based `HighlightStyle` so the actual colors live in CSS (and can follow
// the app's light/dark theme via `.dark` overrides in `FileEditor.svelte`).

import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
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

/** Resolve a CodeMirror language for a file name, or null when none matches
 *  (the editor then loads as plain text — still editable, no highlighting). */
export function languageFor(fileName: string): Extension | null {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : fileName.toLowerCase();
  switch (ext) {
    case "js":
    case "cjs":
    case "mjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "cts":
    case "mts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "json":
    case "jsonc":
      return json();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return html();
    case "md":
    case "markdown":
      return markdown();
    case "rs":
      return rust();
    case "py":
    case "pyi":
      return python();
    case "yaml":
    case "yml":
      return yaml();
    case "xml":
    case "svg":
      return xml();
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return cpp();
    case "java":
      return java();
    case "php":
      return php();
    case "sql":
      return sql();
    case "go":
      return go();
    default:
      return null;
  }
}

/** Class-based highlight style — colors are defined in CSS (`.tok-*`), so the
 *  editor follows the app theme without rebuilding the extension on toggle. */
const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], class: "tok-keyword" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "tok-comment" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-number" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-func" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], class: "tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "tok-prop" },
  { tag: [t.operator, t.punctuation, t.bracket], class: "tok-op" },
  { tag: [t.meta, t.annotation, t.macroName], class: "tok-meta" },
  { tag: [t.variableName, t.labelName], class: "tok-var" },
  { tag: [t.heading, t.strong], class: "tok-strong" },
  { tag: [t.emphasis], class: "tok-em" },
  { tag: [t.invalid], class: "tok-invalid" },
]);

/** The syntax-highlighting extension (paired with the CSS in `FileEditor.svelte`). */
export const syntaxHighlight: Extension = syntaxHighlighting(highlightStyle);
