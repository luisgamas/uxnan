/**
 * The catalog's logo resolution, which is the part that silently degrades: an
 * agent with no bundled SVG and no `favicon` renders the generic Bot glyph, and
 * nothing fails loudly when that happens. These assertions pin the chain and the
 * three domains that were wrong or missing.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_CATALOG,
  agentIconSources,
  agentLogoKey,
  faviconUrl,
  isMonochromeLogo,
} from "./agentCatalog";

/** Agents whose mark ships as an asset under `static/agents/`. */
const BUNDLED = ["claudecode", "codex", "openclaude", "zero"];

describe("agentIconSources", () => {
  it("tries the bundled SVG first, then the product's favicon", () => {
    expect(agentIconSources("codex")).toEqual([
      "/agents/codex.svg",
      faviconUrl("openai.com"),
    ]);
  });

  it("uses a custom logo as-is and asks for nothing else", () => {
    for (const custom of ["data:image/png;base64,AAA", "https://x.invalid/a.png", "/local.svg"]) {
      expect(agentIconSources(custom)).toEqual([custom]);
    }
  });

  it("returns nothing for an agent with no logo at all", () => {
    expect(agentIconSources(null)).toEqual([]);
  });
});

describe("catalog coverage", () => {
  it("gives every agent a mark to fall back to", () => {
    // Without one of the two, the agent renders the generic glyph forever.
    const orphans = AGENT_CATALOG.filter(
      (agent) => !agent.favicon && !BUNDLED.includes(agent.logo),
    );
    expect(orphans.map((a) => a.id)).toEqual([]);
  });

  it("points the Gitlawb agents at their own subdomains", () => {
    // `gitlawb.com` is the personal site and serves neither product's mark.
    const zero = AGENT_CATALOG.find((a) => a.id === "zero");
    const openclaude = AGENT_CATALOG.find((a) => a.id === "openclaude");
    expect(zero?.favicon).toBe("zero.gitlawb.com");
    expect(openclaude?.favicon).toBe("openclaude.gitlawb.com");
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
