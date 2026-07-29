import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_COMMIT_AGENTS,
  activatableAiCommitAgents,
  aiCommitAgentChoices,
} from "./aiCommitPresets";
import { AGENT_CATALOG } from "./agentCatalog";

/** The agent ids the Rust backend can drive headlessly, read from the source of
 *  truth rather than restated here — restating it is how the two fall out of
 *  step in the first place. */
function supportedInRust(): string[] {
  const source = readFileSync(
    new URL("../../src-tauri/src/agentcli.rs", import.meta.url),
    "utf-8",
  );
  const match = /pub const SUPPORTED:\s*\[&str;\s*\d+\]\s*=\s*\[([^\]]*)\]/s.exec(source);
  if (!match) throw new Error("could not find `SUPPORTED` in agentcli.rs");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("the AI-commit agent list", () => {
  it("only offers agents the backend can actually run", () => {
    // The list is a **curated subset**: an agent earns its place here by being
    // wired for this surface (a model list above all), not merely by being
    // drivable. So SUPPORTED may be longer — but an entry the backend cannot
    // run would resolve as "not installed" forever, which is the direction that
    // must never happen.
    const supported = new Set(supportedInRust());
    for (const agent of AI_COMMIT_AGENTS) {
      expect(supported, `${agent.id} is not in agentcli::SUPPORTED`).toContain(agent.id);
    }
  });

  it("has no duplicate entries", () => {
    const ids = AI_COMMIT_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every agent a logo key the catalog knows", () => {
    // A logo key with no catalog entry falls all the way through to the generic
    // bot glyph, which reads as a broken agent rather than a styling detail.
    const known = new Set(AGENT_CATALOG.map((a) => a.logo));
    for (const agent of AI_COMMIT_AGENTS) {
      expect(known, `${agent.id} has an unknown logo key`).toContain(agent.logo);
    }
  });

  it("offers exactly the five wired agents", () => {
    // Each of these resolves to a spawnable CLI, answers a model list and
    // returns its answer on stdout in print mode. Gemini CLI is discontinued
    // upstream and is deliberately not among them.
    expect(activatableAiCommitAgents().map((a) => a.id)).toEqual([
      "claude",
      "codex",
      "opencode",
      "grok",
      "agy",
    ]);
  });

  it("keeps a deprecated agent listed only while it is the saved selection", () => {
    // The backend runs whatever id the settings hold and never consults this
    // list, so hiding a still-configured agent would leave the field reading
    // "none" while that agent kept writing messages.
    const offered = activatableAiCommitAgents().map((a) => a.id);
    expect(aiCommitAgentChoices("claude").map((a) => a.id)).toEqual(offered);
    expect(aiCommitAgentChoices("").map((a) => a.id)).toEqual(offered);
    expect(aiCommitAgentChoices(null).map((a) => a.id)).toEqual(offered);
    expect(aiCommitAgentChoices(undefined).map((a) => a.id)).toEqual(offered);
    expect(aiCommitAgentChoices("gemini").map((a) => a.id)).toEqual([...offered, "gemini"]);
  });

  it("resolves a deprecated agent so a saved one keeps its name and logo", () => {
    const gemini = AI_COMMIT_AGENTS.find((a) => a.id === "gemini");
    expect(gemini?.name).toBe("Gemini CLI");
    expect(gemini?.logo).toBe("gemini");
    expect(gemini?.deprecated).toBe(true);
  });

  it("uses the command the backend resolves as the id", () => {
    // The id crosses the command boundary (`ai_commit_models`, the persisted
    // setting), so it has to be the CLI command — Antigravity is `agy` here,
    // even though the catalog calls the product "antigravity".
    for (const agent of AI_COMMIT_AGENTS) {
      const entry = AGENT_CATALOG.find((c) => c.logo === agent.logo);
      if (entry) expect(agent.id).toBe(entry.command);
    }
  });
});
