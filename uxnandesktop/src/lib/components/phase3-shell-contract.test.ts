import { readFileSync } from "node:fs";
import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";

type Node = {
  type?: string;
  name?: string;
  attributes?: Array<{ name?: string; value?: unknown }>;
  children?: Node[];
};

const source = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

function attribute(node: Node, name: string) {
  return node.attributes?.find((item) => item.name === name);
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(textValue).join("");
  if (!value || typeof value !== "object") return "";
  const item = value as { type?: string; data?: string; raw?: string };
  return item.type === "Text" ? item.data ?? item.raw ?? "" : "";
}

function astChildren(node: Node, seen = new Set<object>()): Node[] {
  if (!node || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  const result: Node[] = [];
  const collect = (value: unknown, key?: string) => {
    if (!value || typeof value !== "object" || key === "metadata") return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    const candidate = value as Node;
    if (typeof candidate.type === "string") {
      result.push(candidate);
      return;
    }
    for (const [childKey, childValue] of Object.entries(candidate)) {
      collect(childValue, childKey);
    }
  };
  for (const [key, value] of Object.entries(node)) collect(value, key);
  return result;
}

function descendants(node: Node, seen = new Set<object>()): Node[] {
  return astChildren(node, seen).flatMap((child) => [child, ...descendants(child, seen)]);
}

function interactiveViolations(root: Node) {
  const violations: string[] = [];
  const walk = (node: Node, interactiveAncestors: string[]) => {
    if (isInteractive(node) && interactiveAncestors.length) {
      violations.push(`${interactiveAncestors.join("/")} > ${node.name}`);
    }
    const next = isInteractive(node)
      ? [...interactiveAncestors, node.name ?? "unknown"]
      : interactiveAncestors;
    for (const child of astChildren(node)) walk(child, next);
  };
  walk(root, []);
  return violations;
}

function isInteractive(node: Node) {
  if (node.type !== "Element" && node.type !== "InlineComponent") return false;
  const role = textValue(attribute(node, "role")?.value);
  return ["button", "a", "input", "select", "textarea", "summary", "Button"].includes(
    node.name ?? "",
  ) || role === "button";
}

describe("phase-three shell contracts", () => {
  it("keeps ProjectCard interactive elements out of interactive ancestors", () => {
    const root = parse(source("ProjectCard.svelte")).html as Node;
    expect(interactiveViolations(root)).toEqual([]);
    const nodes = descendants(root);
    expect(nodes.some((node) => node.name === "button" && attribute(node, "type"))).toBe(true);
    expect(source("ProjectCard.svelte")).toContain("row.projectHeader");
    expect(source("ProjectCard.svelte")).toContain("row.projectSummary");
  });

  it("walks interactive descendants in an else branch", () => {
    const fixture = parse(
      "<button>{#if ok}<span>safe</span>{:else}<button>nested</button>{/if}</button>",
    ).html as Node;
    expect(interactiveViolations(fixture)).toEqual(["button > button"]);
  });

  it("keeps WorktreeSearch ARIA structure and virtualization contract coupled", () => {
    const palette = source("WorktreeSearch.svelte");
    const root = parse(palette).html as Node;
    const nodes = descendants(root);
    const roles = nodes
      .map((node) => textValue(attribute(node, "role")?.value))
      .filter(Boolean);
    expect(roles.filter((role) => role === "combobox")).toHaveLength(1);
    expect(roles.filter((role) => role === "listbox")).toHaveLength(1);
    expect(roles).toContain("option");
    expect(nodes.some((node) => textValue(attribute(node, "id")?.value) === "worktree-search-results")).toBe(true);
    expect(palette).toContain("aria-expanded={projects.paletteOpen}");
    expect(palette).toContain("activeIdx >= 0 ? `worktree-search-result-${activeIdx}` : undefined");
    expect(palette).toContain("estimateSize={52}");
    expect(palette).toContain("overlay.paletteViewport");
  });

  it("keeps the audited shell menus on the shared standard width role", () => {
    const leftSidebar = source("LeftSidebar.svelte");
    const fileTree = source("FileTreePanel.svelte");
    const profile = source("SidebarProfile.svelte");
    expect(leftSidebar).toMatch(/<DropdownMenu\.Content width="standard" align="end">[\s\S]*?terminal\.newDefault/);
    expect(fileTree).toMatch(/<DropdownMenu\.Content width="standard" align="end">[\s\S]*?fileTree\.newFile/);
    expect(profile).toContain('<DropdownMenu.SubContent width="standard" viewport="compact">');
    expect(profile).toContain("pets.library");
  });

  it("keeps agent-space capacity and terminal close target contracts", () => {
    const agentSpace = source("AgentSpace.svelte");
    const worktree = source("WorktreeRow.svelte");
    const terminal = source("TerminalArea.svelte");
    expect(agentSpace).toContain('<Button\n            {...tp}\n            variant="ghost"\n            size="xs"');
    expect(agentSpace).toContain('<Button\n                  {...tp}\n                  variant="ghost"\n                  size="icon-xs"');
    expect(agentSpace).toContain("row.agentAvatarStrip");
    expect(agentSpace).toContain("row.agentSpaceDetail");
    expect(agentSpace).toContain("visibleAgentCount");
    expect(agentSpace).toContain("bind:this={avatarStrip}");
    expect(agentSpace).not.toContain("onMount");
    expect(agentSpace).toContain("const strip = avatarStrip");
    expect(agentSpace).toContain("observer.observe(strip)");
    expect(agentSpace).toContain("return () => observer.disconnect()");
    expect(worktree).toContain('class="w-full min-w-0 pl-6 pr-1 pb-1"');
    expect(terminal).toContain("data-tab-close");
    expect(terminal).toContain("iconButton.xs");
    expect(terminal).toContain("×");
    expect(terminal).not.toContain("Cancel01Icon");
  });

  it("keeps worktree and active-agent selection surfaces distinct", () => {
    const agentRow = source("AgentRow.svelte");
    const worktree = source("WorktreeRow.svelte");
    expect(agentRow).not.toContain("surface.activeNested");
    expect(agentRow).toContain("row.agentActiveIndicator");
    expect(agentRow).toContain('aria-hidden="true"');
    expect(worktree).toContain("surface.active");
  });
});
