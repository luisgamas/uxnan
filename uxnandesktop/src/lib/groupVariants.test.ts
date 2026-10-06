/**
 * Group state variants stay keyed by the group's class.
 *
 * Tailwind's stock `group-hover:` / `group-focus-within:` / `group-focus:`
 * compile to `:is(:where(.group):hover *)`, and WebKit cannot key style
 * invalidation on a class inside `:where()`: every element whose hover or focus
 * changed made it walk and re-match every node below it — ~120 ms per focus
 * change on a large workspace, twice per tab switch. `app.css` redefines those
 * variants with the class outside `:where()`; this keeps the stock forms from
 * creeping back.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const APP_CSS = readFileSync(join(SRC, "app.css"), "utf8");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = sources(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** Custom variants `app.css` defines. */
const DEFINED = new Set(
  [...APP_CSS.matchAll(/@custom-variant\s+([a-z0-9-]+)/g)].map((m) => m[1]),
);

describe("group state variants", () => {
  it("redefines the stock pseudo-class group variants with the class outside :where()", () => {
    for (const name of ["group-hover", "group-focus-within"]) {
      expect(DEFINED.has(name), name).toBe(true);
    }
    const definitions = APP_CSS.split("@custom-variant").filter((block) =>
      /^\s*group-(hover|focus)/.test(block),
    );
    expect(definitions.length).toBeGreaterThan(0);
    for (const block of definitions) {
      // Only the variant's own definition (up to the next blank line).
      const own = block.split(/\n\s*\n/)[0] ?? "";
      expect(own, own).not.toContain(":where(");
      expect(own, own).toMatch(/\.group(\\\/[a-z-]+)?:(hover|focus-within|focus) \*/);
    }
  });

  it("never uses the stock named form, which is no longer generated", () => {
    // `group-hover/name:` silently produces no CSS once `group-hover` is a
    // custom variant — the control it reveals would never appear.
    const offenders = FILES.filter(({ text }) =>
      /\bgroup-(hover|focus-within|focus|focus-visible|active)\/[a-z-]+:/.test(text),
    ).map(({ path }) => path.slice(SRC.length));
    expect(offenders).toEqual([]);
  });

  it("only uses pseudo-class group variants that app.css defines", () => {
    const used = new Set<string>();
    for (const { text } of FILES) {
      for (const m of text.matchAll(/\b(group-(?:hover|focus-within|focus|focus-visible|active)(?:-[a-z]+)*):/g)) {
        used.add(m[1]!);
      }
    }
    const undefinedVariants = [...used].filter((name) => !DEFINED.has(name));
    expect(undefinedVariants).toEqual([]);
  });
});
