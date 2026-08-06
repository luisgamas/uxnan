/**
 * The test that proves the whole seam works: a component that renders, asks the
 * *real* `src/lib/api` layer for something, and re-renders on the answer — with
 * only the IPC transport faked.
 *
 * `AgentLogo` earns the coverage on its own merits. Its fallback chain (bundled
 * SVG → the product's favicon, fetched by the backend because the app's CSP
 * forbids the webview from loading it → a generic Bot glyph) is exactly the kind
 * of logic that looks obviously correct and silently wasn't: for a long time
 * every favicon-backed logo — most of the catalog — rendered as the Bot, because
 * the URL went straight into an `<img>` the CSP refused.
 *
 * So the assertions are about the chain, not about markup: the backend is asked
 * once per URL, a failure degrades to the glyph instead of a broken image, and
 * concurrent asks collapse into a single call.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mount, until } from "../../test/render";
import { failsWith } from "../../test/tauri";
import { clearRemoteLogoCache } from "$lib/agentLogoCache";
import AgentLogo from "./AgentLogo.svelte";

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

/** The session-wide memo would otherwise leak one test's answer into the next. */
beforeEach(() => clearRemoteLogoCache());
afterEach(() => clearRemoteLogoCache());

/** The `<img>` currently rendered, if any. */
function img(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img");
}

describe("AgentLogo", () => {
  it("renders a bundled SVG without going near the backend", async () => {
    // `claude` has a bundled asset, so the first candidate is local and no
    // fetch should happen at all.
    const { screen, backend } = mount(AgentLogo, { props: { logo: "claude" } });

    await until(() => img(screen.container) !== null, { label: "an image to render" });
    expect(img(screen.container)?.getAttribute("src")).toBe("/agents/claude.svg");
    expect(backend.called("image_fetch_data_url")).toBe(false);
  });

  it("shows the generic glyph when there is no logo to show", () => {
    const { screen, backend } = mount(AgentLogo, { props: { logo: null } });
    expect(img(screen.container)).toBeNull();
    expect(screen.container.querySelector("svg")).not.toBeNull();
    expect(backend.called("image_fetch_data_url")).toBe(false);
  });

  it("fetches a remote logo through the backend and renders it inline", async () => {
    // The webview cannot load an http(s) image under the app's CSP, so the URL
    // must reach the Rust side and come back as a `data:` URL.
    const { screen, backend } = mount(AgentLogo, {
      props: { logo: "https://example.invalid/favicon.png" },
      commands: { image_fetch_data_url: () => PIXEL },
    });

    await until(() => img(screen.container)?.getAttribute("src") === PIXEL, {
      label: "the fetched logo to render",
    });

    const call = backend.lastCallTo("image_fetch_data_url");
    expect(call?.args.url).toBe("https://example.invalid/favicon.png");
  });

  it("falls back to the glyph when the backend cannot fetch it", async () => {
    // Offline, blocked, 404 — all the same to the user, and none of them may
    // leave a broken <img> on screen.
    const { screen, backend } = mount(AgentLogo, {
      props: { logo: "https://example.invalid/missing.png" },
      commands: { image_fetch_data_url: failsWith("NETWORK", "unreachable") },
    });

    await until(() => backend.called("image_fetch_data_url"), { label: "the fetch attempt" });
    await until(() => screen.container.querySelector("svg") !== null, {
      label: "the fallback glyph",
    });
    expect(img(screen.container)).toBeNull();
  });

  it("asks the backend once per URL, however many components want it", async () => {
    const url = "https://example.invalid/shared.png";
    const first = mount(AgentLogo, {
      props: { logo: url },
      commands: { image_fetch_data_url: () => PIXEL },
    });
    await until(() => img(first.screen.container)?.getAttribute("src") === PIXEL, {
      label: "the first logo",
    });
    expect(first.backend.callsTo("image_fetch_data_url")).toHaveLength(1);

    // A second mount in the same session reads the memo; the fresh fake backend
    // would record a call if one were made.
    const second = mount(AgentLogo, { props: { logo: url } });
    await until(() => img(second.screen.container)?.getAttribute("src") === PIXEL, {
      label: "the memoized logo",
    });
    expect(second.backend.called("image_fetch_data_url")).toBe(false);
  });

  it("inverts a monochrome bundled mark so a dark theme cannot swallow it", async () => {
    // Codex's SVG draws with `currentColor`, which an <img> resolves to black.
    const { screen } = mount(AgentLogo, { props: { logo: "codex" } });

    await until(() => img(screen.container) !== null, { label: "the mark to render" });
    expect(img(screen.container)?.className).toContain("dark:invert");
  });

  it("leaves a coloured mark and a fetched favicon untouched", async () => {
    // Claude's mark is orange; inverting it would be vandalism. A favicon is
    // not ours to recolour either.
    const claude = mount(AgentLogo, { props: { logo: "claudecode" } });
    await until(() => img(claude.screen.container) !== null, { label: "the bundled mark" });
    expect(img(claude.screen.container)?.className).not.toContain("dark:invert");

    const remote = mount(AgentLogo, {
      props: { logo: "https://example.invalid/favicon.png" },
      commands: { image_fetch_data_url: () => PIXEL },
    });
    await until(() => img(remote.screen.container)?.getAttribute("src") === PIXEL, {
      label: "the fetched logo",
    });
    expect(img(remote.screen.container)?.className).not.toContain("dark:invert");
  });

  it("remembers a failure too, so a dead URL is not retried on every render", async () => {
    const url = "https://example.invalid/dead.png";
    const first = mount(AgentLogo, {
      props: { logo: url },
      commands: { image_fetch_data_url: failsWith("NETWORK", "unreachable") },
    });
    await until(() => first.backend.called("image_fetch_data_url"), { label: "the first attempt" });

    const second = mount(AgentLogo, { props: { logo: url } });
    await until(() => second.screen.container.querySelector("svg") !== null, {
      label: "the fallback glyph",
    });
    expect(second.backend.called("image_fetch_data_url")).toBe(false);
  });
});
