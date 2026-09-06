import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app.svelte";

beforeEach(() => {
  app.closeBrowser();
  app.settings.rightSidebarOpen = true;
  vi.spyOn(app, "persistSettings").mockResolvedValue();
});

afterEach(() => {
  app.closeBrowser();
  vi.restoreAllMocks();
});

describe("browser and review panel layout", () => {
  it("temporarily hides an open review panel and restores it after repeated navigation", () => {
    app.openBrowser("http://localhost:3000");
    expect(app.rightSidebarVisible).toBe(false);
    expect(app.settings.rightSidebarOpen).toBe(true);
    app.openBrowser("http://localhost:4000");
    app.closeBrowser();
    expect(app.rightSidebarVisible).toBe(true);
    expect(app.persistSettings).not.toHaveBeenCalled();
  });

  it("keeps a previously closed review panel closed across browser toggle cycles", () => {
    app.settings.rightSidebarOpen = false;
    for (let cycle = 0; cycle < 2; cycle++) {
      app.toggleBrowser();
      expect(app.browserOpen).toBe(true);
      expect(app.rightSidebarVisible).toBe(false);
      app.toggleBrowser();
      expect(app.rightSidebarVisible).toBe(false);
    }
    expect(app.persistSettings).not.toHaveBeenCalled();
  });

  it("switches from the browser to the review panel on an explicit review toggle", () => {
    app.settings.rightSidebarOpen = false;
    app.openBrowser();
    app.toggleRightSidebar();
    expect(app.browserOpen).toBe(false);
    expect(app.rightSidebarVisible).toBe(true);
    expect(app.persistSettings).toHaveBeenCalledOnce();
  });

  it("still saves ordinary review-panel toggles and ignores repeated browser closes", () => {
    app.toggleRightSidebar();
    expect(app.rightSidebarVisible).toBe(false);
    app.closeBrowser();
    app.closeBrowser();
    expect(app.rightSidebarVisible).toBe(false);
    app.toggleRightSidebar();
    expect(app.rightSidebarVisible).toBe(true);
    expect(app.persistSettings).toHaveBeenCalledTimes(2);
  });
});
