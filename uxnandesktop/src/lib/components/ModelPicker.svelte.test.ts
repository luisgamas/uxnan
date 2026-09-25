/**
 * The app's one model picker (AI commit, PR drafts, orchestration steps, the
 * chat composer): models grouped by provider, the default first, and — in a
 * chat — the model's run options on top of the list.
 */

import { describe, expect, it } from "vitest";
import { mountWithProviders, until } from "../../test/render";
import ModelPicker from "./ModelPicker.svelte";
import ChatAccessMenu from "./chat/ChatAccessMenu.svelte";

const MODELS = [
  { id: "anthropic/claude-sonnet-5", displayName: "anthropic/claude-sonnet-5" },
  { id: "openai/gpt-6", displayName: "openai/gpt-6", description: "Fast and cheap" },
];

describe("ModelPicker", () => {
  it("shows the chosen model without its provider and picks another from its group", async () => {
    const picked: string[] = [];
    const { screen, user } = mountWithProviders(ModelPicker, {
      props: { models: MODELS, value: "anthropic/claude-sonnet-5", onSelect: (id: string) => picked.push(id) },
    });
    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger.textContent).toContain("claude-sonnet-5");
    expect(trigger.textContent).not.toContain("anthropic/");
    await user.click(trigger);
    expect(await screen.findByText("openai")).toBeTruthy();
    await user.click(await screen.findByText("gpt-6"));
    await until(() => picked.length === 1);
    expect(picked).toEqual(["openai/gpt-6"]);
  });

  it("offers the default first, and the run options above the list", async () => {
    const { screen, user } = mountWithProviders(ModelPicker, {
      props: {
        models: MODELS,
        value: "",
        options: [
          {
            key: "reasoning",
            kind: "enum",
            label: "Reasoning",
            values: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
            default: "low",
          },
        ],
        onSelect: () => undefined,
      },
    });
    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger.textContent).toContain("Default model · Low");
    await user.click(trigger);
    await user.click(await screen.findByText("High"));
    await until(() => trigger.textContent?.includes("Default model · High") ?? false);
  });
});

describe("ChatAccessMenu", () => {
  it("shows the thread's mode and changes it from the menu", async () => {
    const chosen: string[] = [];
    const { screen, user } = mountWithProviders(ChatAccessMenu, {
      props: { value: "fullAccess", onChange: (m: string) => chosen.push(m) },
    });
    const trigger = screen.getByRole("button", { name: "Access mode" });
    expect(trigger.textContent).toContain("Full access");
    await user.click(trigger);
    await user.click(await screen.findByText("Ask first"));
    await until(() => chosen.length === 1);
    expect(chosen).toEqual(["requestApproval"]);
  });
});
