/**
 * `AgentLogo`: every mark ships with the app, so the chain — a custom logo,
 * else the agent's mark from `static/agents/` (a drawn SVG or its vendored
 * favicon PNG), else the generic Bot glyph — never reaches the backend or the
 * network, and a mark that fails to load degrades to the glyph instead of a
 * broken image.
 */

import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/svelte";

import { mount, until } from "../../test/render";
import AgentLogo from "./AgentLogo.svelte";

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

/** The `<img>` currently rendered, if any. */
function img(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img");
}

describe("AgentLogo", () => {
  it("renders a drawn mark from the app's own files", async () => {
    const { screen, backend } = mount(AgentLogo, { props: { logo: "claudecode" } });
    await until(() => img(screen.container) !== null, { label: "the mark" });
    expect(img(screen.container)?.getAttribute("src")).toBe("/agents/claudecode.svg");
    expect(backend.calls).toEqual([]);
  });

  it("renders a favicon agent's vendored PNG, never fetching it", async () => {
    const { screen, backend } = mount(AgentLogo, { props: { logo: "opencode" } });
    await until(() => img(screen.container) !== null, { label: "the favicon" });
    expect(img(screen.container)?.getAttribute("src")).toBe("/agents/opencode.png");
    expect(backend.called("image_fetch_data_url")).toBe(false);
  });

  it("uses a custom logo as it is", async () => {
    const { screen } = mount(AgentLogo, { props: { logo: PIXEL } });
    await until(() => img(screen.container) !== null, { label: "the custom logo" });
    expect(img(screen.container)?.getAttribute("src")).toBe(PIXEL);
  });

  it("shows the generic glyph when there is no logo, or the mark does not load", async () => {
    const none = mount(AgentLogo, { props: { logo: null } });
    expect(img(none.screen.container)).toBeNull();
    expect(none.screen.container.querySelector("svg")).not.toBeNull();

    const broken = mount(AgentLogo, { props: { logo: "pi" } });
    await until(() => img(broken.screen.container) !== null, { label: "the mark" });
    await fireEvent.error(img(broken.screen.container)!);
    await until(() => img(broken.screen.container) === null, { label: "the glyph" });
    expect(broken.screen.container.querySelector("svg")).not.toBeNull();
  });

  it("inverts a monochrome drawn mark so a dark theme cannot swallow it", async () => {
    const { screen } = mount(AgentLogo, { props: { logo: "codex" } });
    await until(() => img(screen.container) !== null, { label: "the mark" });
    expect(img(screen.container)?.className).toContain("dark:invert");
  });

  it("leaves a coloured mark and a favicon untouched", async () => {
    const claude = mount(AgentLogo, { props: { logo: "claudecode" } });
    await until(() => img(claude.screen.container) !== null, { label: "the drawn mark" });
    expect(img(claude.screen.container)?.className).not.toContain("dark:invert");
    const favicon = mount(AgentLogo, { props: { logo: "antigravity" } });
    await until(() => img(favicon.screen.container) !== null, { label: "the favicon" });
    expect(img(favicon.screen.container)?.className).not.toContain("dark:invert");
  });
});
