import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/api")>();
  const page = (workspace: string, url = "about:blank", visible = false) => ({
    workspace,
    live: true,
    url,
    title: "",
    loading: false,
    canGoBack: null,
    canGoForward: null,
    zoom: 1,
    visible,
    generation: 1,
  });
  return {
    ...actual,
    browserOpen: vi.fn(async (workspace: string, url: string, _b: unknown, visible: boolean) =>
      page(workspace, url, visible),
    ),
    browserSetVisible: vi.fn(async (workspace: string, visible: boolean) =>
      page(workspace, "about:blank", visible),
    ),
    browserSetBounds: vi.fn(async () => {}),
    browserClose: vi.fn(async () => {}),
    browserCapture: vi.fn(async () => "data:image/png;base64,AAAA"),
  };
});

import * as api from "$lib/api";
import { browser, pageToEvict, MAX_LIVE_PAGES, type BrowserSession } from "./browser.svelte";
import { terminals } from "./terminals.svelte";
import { dock } from "./dock.svelte";
import { app } from "./app.svelte";

const SLOT = { x: 800, y: 60, width: 520, height: 700 };

function session(workspace: string, live: boolean, lastShown: number): BrowserSession {
  return {
    workspace,
    url: "http://localhost:1",
    title: "",
    loading: false,
    canGoBack: null,
    canGoForward: null,
    zoom: 1,
    live,
    generation: 1,
    lastShown,
  };
}

describe("pageToEvict", () => {
  it("makes no room while under the cap", () => {
    const sessions = [session("a", true, 1), session("b", true, 2)];
    expect(pageToEvict(sessions, "c", "a", 3)).toBeNull();
  });

  it("releases the page shown longest ago, never the one on screen or being opened", () => {
    const sessions = [session("a", true, 1), session("b", true, 5), session("c", true, 3)];
    expect(pageToEvict(sessions, "d", "a", 3)).toBe("c");
    expect(pageToEvict(sessions, "d", "c", 3)).toBe("a");
  });

  it("ignores released pages and the one being reopened", () => {
    const sessions = [session("a", false, 0), session("b", true, 2), session("c", true, 4)];
    expect(pageToEvict(sessions, "a", "b", 2)).toBe("c");
    expect(pageToEvict(sessions, "c", "b", 2)).toBeNull();
  });
});

describe("the per-workspace browser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(app, "persistSettings").mockResolvedValue();
    for (const ws of Object.keys(browser.sessions)) delete browser.sessions[ws];
    app.settings.dock = { workspaces: {} };
    terminals.setWorkspace("");
    browser.setSlot(SLOT, true);
  });

  afterEach(() => {
    browser.setSlot(null, false);
  });

  it("shows the page of the workspace on screen", async () => {
    await browser.open("http://localhost:3000");
    expect(api.browserOpen).toHaveBeenCalledWith("", "http://localhost:3000", SLOT, true);
    expect(dock.showing("")).toBe("browser");
  });

  it("loads a page for another workspace hidden, and keeps it there", async () => {
    await browser.open("http://localhost:4000", "/work/tree");
    expect(api.browserOpen).toHaveBeenCalledWith("/work/tree", "http://localhost:4000", SLOT, false);
    // The dock on screen is untouched; the other workspace's turns to its page.
    expect(dock.showing("")).toBeNull();
    expect(dock.showing("/work/tree")).toBe("browser");
  });

  it("hides the page, and keeps it, when the dock leaves the browser", async () => {
    await browser.open("http://localhost:3000");
    vi.mocked(api.browserSetVisible).mockClear();
    dock.hide();
    browser.sync();
    expect(api.browserSetVisible).toHaveBeenCalledWith("", false);
    expect(api.browserClose).not.toHaveBeenCalled();
    expect(browser.sessions[""].live).toBe(true);
  });

  it("swaps pages when the workspace on screen changes", async () => {
    await browser.open("http://localhost:3000");
    await browser.open("http://localhost:4000", "/work/tree");
    vi.mocked(api.browserSetVisible).mockClear();
    terminals.setWorkspace("/work/tree");
    browser.sync();
    expect(api.browserSetVisible).toHaveBeenCalledWith("", false);
    expect(api.browserSetVisible).toHaveBeenCalledWith("/work/tree", true);
    terminals.setWorkspace("");
  });

  it("hides the page while the slot cannot show it", async () => {
    await browser.open("http://localhost:3000");
    vi.mocked(api.browserSetVisible).mockClear();
    browser.setSlot(SLOT, false);
    expect(api.browserSetVisible).toHaveBeenCalledWith("", false);
  });

  it("leaves a still image of the page under a dialog that covers it", async () => {
    await browser.open("http://localhost:3000");
    vi.mocked(api.browserSetVisible).mockClear();
    browser.setSlot(SLOT, false, true);
    await vi.waitFor(() => expect(api.browserSetVisible).toHaveBeenCalledWith("", false));
    expect(api.browserCapture).toHaveBeenCalledWith("");
    expect(browser.placeholder).toEqual({ workspace: "", src: "data:image/png;base64,AAAA" });
    // The dialog closes: the page comes back and the image goes.
    browser.setSlot(SLOT, true);
    await vi.waitFor(() => expect(browser.placeholder).toBeNull());
  });

  it("does not freeze the page for something that is not an overlay", async () => {
    await browser.open("http://localhost:3000");
    vi.mocked(api.browserCapture).mockClear();
    browser.setSlot(SLOT, false, false);
    expect(api.browserCapture).not.toHaveBeenCalled();
    expect(browser.placeholder).toBeNull();
  });

  it(`keeps at most ${MAX_LIVE_PAGES} pages alive`, async () => {
    for (let i = 0; i <= MAX_LIVE_PAGES; i++) {
      await browser.open(`http://localhost:${5000 + i}`, `/ws/${i}`);
    }
    const live = Object.values(browser.sessions).filter((s) => s.live);
    expect(live).toHaveLength(MAX_LIVE_PAGES);
    expect(api.browserClose).toHaveBeenCalledWith("/ws/0");
    // Released, not forgotten: its URL (and its dock) stay for when it is visited.
    expect(dock.showing("/ws/0")).toBe("browser");
    expect(browser.sessions["/ws/0"].url).toBe("http://localhost:5000");
  });

  it("closing the page releases it and leaves an empty browser in the dock", async () => {
    await browser.open("http://localhost:3000");
    browser.close();
    expect(api.browserClose).toHaveBeenCalledWith("");
    expect(browser.sessions[""].url).toBe("");
    expect(dock.showing("")).toBe("browser");
  });
});
