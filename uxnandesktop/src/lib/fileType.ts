// Lightweight, extension-based "is this a plain-text file?" check, used to decide
// whether the file-tree context menu offers the native text editor (Notepad /
// TextEdit / …) under "Open with". Deliberately name-only (no disk read): a broad
// allow-list of text/code/config extensions, plus a set of well-known
// extensionless text files (LICENSE, Dockerfile, …). Errs toward "text" for the
// common developer files, and simply omits the extra entry when unsure.

/** File extensions (without the dot, lowercase) treated as plain text. */
const TEXT_EXTENSIONS = new Set<string>([
  // Docs / prose
  "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "asciidoc", "log", "nfo",
  "tex", "rtf",
  // Data / config
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "config",
  "properties", "env", "csv", "tsv", "xml", "plist", "editorconfig", "lock",
  // Web
  "html", "htm", "xhtml", "css", "scss", "sass", "less", "svg", "vue", "svelte",
  "astro",
  // Scripting / programming
  "js", "cjs", "mjs", "jsx", "ts", "cts", "mts", "tsx", "py", "pyi", "rb", "php",
  "go", "rs", "java", "kt", "kts", "scala", "swift", "c", "h", "cc", "cpp", "cxx",
  "hpp", "hh", "cs", "fs", "fsx", "dart", "lua", "pl", "pm", "r", "jl", "ex", "exs",
  "erl", "hs", "elm", "clj", "cljs", "edn", "nim", "zig", "v", "sol", "groovy",
  "gradle", "sql", "graphql", "gql", "proto", "cmake", "m", "mm",
  // Shell / build
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "psd1", "bat", "cmd", "make", "mk",
  "dockerfile", "gitignore", "gitattributes", "gitconfig", "npmrc", "nvmrc",
  "prettierrc", "eslintrc", "babelrc", "patch", "diff",
]);

/** Extensionless filenames (lowercase) that are conventionally plain text. */
const TEXT_FILENAMES = new Set<string>([
  "license", "licence", "readme", "changelog", "authors", "contributors",
  "notice", "copying", "makefile", "dockerfile", "procfile", "gemfile",
  "rakefile", "brewfile", "vagrantfile", "caddyfile", ".gitignore",
  ".gitattributes", ".dockerignore", ".npmignore", ".env", ".editorconfig",
  ".prettierrc", ".eslintrc", ".babelrc",
]);

/** Whether a file name looks like a plain-text file (by extension or a known
 *  extensionless name). Directories are never text (check `isDir` before). */
export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_FILENAMES.has(lower)) return true;
  const dot = lower.lastIndexOf(".");
  // No extension (and not a known name) → treat as not-text (avoid opening a
  // binary in Notepad). A leading-dot dotfile with no other dot is handled above.
  if (dot <= 0) return false;
  return TEXT_EXTENSIONS.has(lower.slice(dot + 1));
}
