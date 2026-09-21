/**
 * The per-agent switch for workers a coordinator starts — what the expanded
 * profile promises for each kind of CLI, and what the switch writes.
 *
 * The row reads the command as typed, so the three states are driven by three
 * commands: one with a reviewed tier, one that only reaches its edits-only
 * tier, one with no tier at all (disabled, with the reason).
 */

import { describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import AgentProfileEditor from "./AgentProfileEditor.svelte";
import type { AgentProfile } from "$lib/types";

const LABEL = "Automatic mode when launched by an agent";

function profile(command: string, over: Partial<AgentProfile> = {}): AgentProfile {
  return { id: `a-${command}`, name: command, command, args: [], ...over };
}

async function expanded(agent: AgentProfile, onchange = () => {}) {
  const mounted = mountWithProviders(AgentProfileEditor, {
    props: { agent, onchange, onremove: () => {} },
  });
  // The name button is the disclosure (`aria-expanded`), like every editor row.
  await mounted.user.click(mounted.screen.getByRole("button", { expanded: false, name: new RegExp(agent.command) }));
  return mounted;
}

describe("AgentProfileEditor — automatic mode when launched by an agent", () => {
  it("is on by default for a CLI with a reviewed tier, and says what that means", async () => {
    const { screen } = await expanded(profile("claude"));
    const toggle = screen.getByRole("switch", { name: LABEL });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/reviewed automatic mode; your own launches are not affected/)).toBeTruthy();
  });

  it("says edits are auto-approved and shell/MCP still prompt for an edits-only CLI", async () => {
    const { screen } = await expanded(profile("grok"));
    expect(screen.getByRole("switch", { name: LABEL }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/file edits; shell commands and MCP tools still prompt/)).toBeTruthy();
  });

  it("is disabled, off and explained for a CLI with no tier", async () => {
    const { screen } = await expanded(profile("opencode"));
    const toggle = screen.getByRole("switch", { name: LABEL });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("This CLI has no reviewed automatic mode; workers launch as configured.")).toBeTruthy();
  });

  it("writes the choice on the profile and reports the change", async () => {
    const agent = profile("codex");
    let changes = 0;
    const { screen, user } = await expanded(agent, () => changes++);
    await user.click(screen.getByRole("switch", { name: LABEL }));
    expect(agent.workersUnattended).toBe(false);
    expect(changes).toBe(1);
    expect(screen.getByRole("switch", { name: LABEL }).getAttribute("aria-checked")).toBe("false");
  });

  it("shows a profile switched off earlier as off", async () => {
    const { screen } = await expanded(profile("claude", { workersUnattended: false }));
    expect(screen.getByRole("switch", { name: LABEL }).getAttribute("aria-checked")).toBe("false");
  });
});
