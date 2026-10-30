/**
 * The catalog's logo resolution, which is the part that silently degrades: an
 * agent whose mark is missing renders the generic Bot glyph, and nothing fails
 * loudly when that happens. Every mark ships with the app from the
 * repository's single set (`assets/agents/`), so these assertions pin that
 * each catalog agent has its file there and that nothing is ever fetched.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_CATALOG,
  DRAWN_MARKS,
  agentIconSources,
  agentLogoKey,
  isMonochromeLogo,
  markFile,
} from "./agentCatalog";

const ASSETS = join(__dirname, "..", "..", "..", "assets", "agents");

describe("agentIconSources", () => {
  it("gives a drawn mark its SVG and every other agent its vendored favicon", () => {
    expect(agentIconSources("codex")).toEqual(["/agents/codex.svg"]);
    expect(agentIconSources("opencode")).toEqual(["/agents/opencode.png"]);
  });

  it("uses a custom logo as-is and asks for nothing else", () => {
    for (const custom of ["data:image/png;base64,AAA", "/local.svg"]) {
      expect(agentIconSources(custom)).toEqual([custom]);
    }
  });

  it("never offers a remote URL, so no logo is ever fetched", () => {
    expect(agentIconSources("https://x.invalid/a.png")).toEqual([]);
    expect(agentIconSources(null)).toEqual([]);
    expect(agentIconSources("not-in-the-catalog")).toEqual([]);
  });
});

describe("catalog coverage", () => {
  it("ships a mark for every agent from the repository's single set", () => {
    const missing = AGENT_CATALOG.filter((agent) => !existsSync(join(ASSETS, markFile(agent.logo))));
    expect(missing.map((a) => a.id)).toEqual([]);
  });

  it("keeps a drawn mark for exactly the four agents that have one", () => {
    expect([...DRAWN_MARKS].sort()).toEqual(["claudecode", "codex", "openclaude", "zero"]);
  });

  it("names where each favicon was taken from, for the vendoring script", () => {
    const sourceless = AGENT_CATALOG.filter((agent) => !agent.favicon && !DRAWN_MARKS.has(agent.logo));
    expect(sourceless.map((a) => a.id)).toEqual([]);
    // `gitlawb.com` is the personal site and serves neither product's mark.
    expect(AGENT_CATALOG.find((a) => a.id === "zero")?.favicon).toBe("zero.gitlawb.com");
    expect(AGENT_CATALOG.find((a) => a.id === "openclaude")?.favicon).toBe("openclaude.gitlawb.com");
  });

  it("matches a logo key from the command for agents added before icons existed", () => {
    expect(agentLogoKey(null, "claude")).toBe("claudecode");
    expect(agentLogoKey("custom", "claude")).toBe("custom");
    expect(agentLogoKey(null, "definitely-not-an-agent")).toBeNull();
  });
});

describe("isMonochromeLogo", () => {
  it("flags the bundled marks that are a single dark colour", () => {
    // Codex draws with `currentColor`, which an <img> resolves to black;
    // OpenClaude's paths are #000000. Both vanish on a dark theme untouched.
    expect(isMonochromeLogo("codex")).toBe(true);
    expect(isMonochromeLogo("openclaude")).toBe(true);
  });

  it("leaves coloured marks alone", () => {
    // Claude"s mark is orange and Zero"s is a dark tile with a lime glyph:
    // inverting either would break it.
    expect(isMonochromeLogo("claudecode")).toBe(false);
    expect(isMonochromeLogo("zero")).toBe(false);
  });

  it("never claims a custom logo or a favicon is monochrome", () => {
    expect(isMonochromeLogo("data:image/png;base64,AAA")).toBe(false);
    expect(isMonochromeLogo("https://example.invalid/favicon.png")).toBe(false);
    expect(isMonochromeLogo("/agents/codex.svg")).toBe(false);
    expect(isMonochromeLogo(null)).toBe(false);
    expect(isMonochromeLogo(undefined)).toBe(false);
  });
});
