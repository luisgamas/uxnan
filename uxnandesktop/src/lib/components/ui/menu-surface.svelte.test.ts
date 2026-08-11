import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "../../../test/render";
import { overlayLayerCount } from "$lib/overlayLayer";
import MenuSurfaceFixture from "./menu-surface-fixture.svelte";

describe("MenuSurface", () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  function setViewport(width = 320, height = 240): void {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  }

  it("focuses the first item and wraps ArrowUp/ArrowDown/Home/End", async () => {
    const { screen, user } = mount(MenuSurfaceFixture);
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
  });

  it("closes on Escape and Tab while restoring optional keyboard-origin focus", async () => {
    const origin = document.createElement("button");
    origin.textContent = "origin";
    document.body.append(origin);
    origin.focus();
    const onClose = vi.fn();
    const { screen, user } = mount(MenuSurfaceFixture, { props: { onClose } });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "underlying target" })).toHaveFocus();

    const tabClose = vi.fn();
    const tabMenu = mount(MenuSurfaceFixture, { props: { onClose: tabClose } });
    await tabMenu.user.keyboard("{Tab}");
    expect(tabClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on an outside pointer while preserving the underlying target focus", async () => {
    const onClose = vi.fn();
    const { screen, user } = mount(MenuSurfaceFixture, { props: { onClose } });
    const target = screen.getByRole("button", { name: "underlying target" });
    await user.click(target);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(target).toHaveFocus();
  });

  it("clamps the measured surface rect to an 8px viewport inset", async () => {
    setViewport();
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute("role") === "menu") {
        return new DOMRect(0, 0, 180, 140);
      }
      return originalRect.call(this);
    };
    const { screen } = mount(MenuSurfaceFixture, { props: { x: 310, y: 230 } });
    const menu = screen.getByRole("menu");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(menu.style.left).toBe("132px");
    expect(menu.style.top).toBe("92px");
  });

  it("registers its surface with the native overlay layer", () => {
    const before = overlayLayerCount();
    mount(MenuSurfaceFixture);
    expect(overlayLayerCount()).toBe(before + 1);
  });
});
