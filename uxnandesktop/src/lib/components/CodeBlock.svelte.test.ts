/**
 * The shared copyable block (commands, scripts, output) and the shared status
 * dot: the shapes Settings → Bridge & mobile, the hooks panel and the GitHub
 * and SSH panes now draw with, instead of each keeping its own copy.
 */

import { describe, expect, it } from "vitest";
import { mount, mountWithProviders, until } from "../../test/render";
import CodeBlock from "./CodeBlock.svelte";
import StatusDot from "./StatusDot.svelte";

describe("CodeBlock", () => {
  it("shows the text and copies it, confirming for a moment", async () => {
    const { screen, backend, user } = mountWithProviders(CodeBlock, {
      props: { value: "npm install -g uxnan-bridge@latest" },
      commands: { "plugin:clipboard-manager|write_text": () => null },
    });
    expect(screen.getByText("npm install -g uxnan-bridge@latest")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await until(() => backend.called("plugin:clipboard-manager|write_text"));
    expect(backend.lastCallTo("plugin:clipboard-manager|write_text")?.args).toMatchObject({
      text: "npm install -g uxnan-bridge@latest",
    });
  });

  it("offers no copy button for output that is only read", () => {
    const { screen } = mount(CodeBlock, { props: { value: "added 1 package", copyable: false } });
    expect(screen.getByText("added 1 package")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StatusDot", () => {
  it("names its state when given a label, and stays silent otherwise", () => {
    const labelled = mount(StatusDot, { props: { tone: "ok", label: "Connected" } });
    expect(labelled.screen.getByRole("img", { name: "Connected" })).toBeTruthy();
    const quiet = mount(StatusDot, { props: { tone: "off" } });
    expect(quiet.screen.container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
