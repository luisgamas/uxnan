// The integrated browser, per workspace.
//
// Every workspace (a worktree, or the Global space) has its own browser
// session: whether its panel is open, the page it shows and that page's live
// state. The page itself is a child webview of the main window owned by the
// backend (`src-tauri/src/browser/host.rs`); this store decides which page is
// on screen and where, and mirrors what the backend reports about each one.
//
// The rules it enforces:
//
// - **Only the workspace on screen shows its page.** Switching workspace hides
//   the previous page and shows the next one's (when its panel is open); a page
//   never follows the person into a workspace it was not opened in.
// - **A page opened for another workspace stays in it.** An agent working in a
//   background worktree gets its page loaded there, hidden, and the person
//   finds it when they visit that workspace.
// - **Pages cost memory, so few stay alive.** At most `MAX_LIVE_PAGES` exist at
//   once; opening one more closes the one shown longest ago (its URL is kept,
//   and it reloads when its workspace is visited). A workspace put to sleep
//   releases its page the same way.
//
// The panel (`BrowserPanel.svelte`) reports its slot — where a page may be
// drawn, and whether it can be drawn at all right now (a dialog or menu over
// it, Settings on top) — and `sync()` turns that into show/hide/place calls.

import { untrack } from "svelte";
import { listen } from "@tauri-apps/api/event";
import {
  browserClose,
  browserOpen,
  browserSessions,
  browserSetBounds,
  browserSetVisible,
  type BrowserBounds,
  type BrowserPageState,
} from "$lib/api";
import { terminals } from "$lib/state/terminals.svelte";

/** How many pages may be alive at once, across every workspace. */
export const MAX_LIVE_PAGES = 3;

/** The size a page is laid out at before any panel slot has been measured. */
const DEFAULT_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 520, height: 720 };

/** One workspace's browser. */
export interface BrowserSession {
  workspace: string;
  /** Whether the browser panel is open in this workspace. */
  open: boolean;
  /** The page's URL (the target, until the page reports its own). */
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean | null;
  canGoForward: boolean | null;
  zoom: number;
  /** Whether a live page exists in the backend. */
  live: boolean;
  /** Committed documents so far (from the backend). */
  generation: number;
  /** When this session was last on screen (LRU for `MAX_LIVE_PAGES`). */
  lastShown: number;
}

function blank(workspace: string): BrowserSession {
  return {
    workspace,
    open: false,
    url: "",
    title: "",
    loading: false,
    canGoBack: null,
    canGoForward: null,
    zoom: 1,
    live: false,
    generation: 0,
    lastShown: 0,
  };
}

function sameBounds(a: BrowserBounds | undefined, b: BrowserBounds): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The session to close to make room for another page: the live one shown
 *  longest ago, never `keep` (the one being opened) nor `active` (the one on
 *  screen). Pure, so it is unit-tested directly. */
export function pageToEvict(
  sessions: BrowserSession[],
  keep: string,
  active: string,
  max = MAX_LIVE_PAGES,
): string | null {
  const live = sessions.filter((s) => s.live && s.workspace !== keep);
  if (live.length < max) return null;
  const candidates = live
    .filter((s) => s.workspace !== active)
    .sort((a, b) => a.lastShown - b.lastShown);
  return candidates[0]?.workspace ?? null;
}

class BrowserStore {
  /** Every workspace's session, by workspace key. */
  sessions = $state<Record<string, BrowserSession>>({});

  /** The panel slot on screen, and whether a page can be drawn in it now. */
  private slot: BrowserBounds | null = null;
  private slotShowable = false;
  /** What was last asked of the backend, per workspace — so `sync()` only
   *  calls when something actually changes. */
  private shown = new Map<string, boolean>();
  private placed = new Map<string, BrowserBounds>();
  /** Page creations in flight, so two opens of one workspace never race. */
  private creating = new Map<string, Promise<void>>();
  private started = false;

  /** The workspace on screen. */
  get activeKey(): string {
    return terminals.activeWorkspace;
  }

  /** The session of the workspace on screen, if it has one. */
  get active(): BrowserSession | null {
    return this.sessions[this.activeKey] ?? null;
  }

  /** Whether the browser panel is open in `workspace` (default: on screen). */
  isOpen(workspace = this.activeKey): boolean {
    return this.sessions[workspace]?.open === true;
  }

  private ensure(workspace: string): BrowserSession {
    const existing = this.sessions[workspace];
    if (existing) return existing;
    this.sessions[workspace] = blank(workspace);
    return this.sessions[workspace];
  }

  /** Open `url` in a workspace's browser — the one on screen by default — and
   *  open its panel there. A page opened for a workspace that is not on screen
   *  loads hidden and waits for the person to visit it. */
  async open(url: string, workspace = this.activeKey): Promise<void> {
    const session = this.ensure(workspace);
    session.open = true;
    session.url = url;
    session.title = "";
    await this.load(workspace, url);
  }

  /** Close a workspace's browser: its panel and its page. */
  close(workspace = this.activeKey): void {
    const session = this.sessions[workspace];
    if (!session) return;
    session.open = false;
    this.release(workspace);
  }

  /** Release a workspace's page but keep its panel state and URL, so visiting
   *  it again reloads where it was (a sleeping workspace, or room for another
   *  page). */
  suspend(workspace: string): void {
    this.release(workspace);
  }

  private release(workspace: string): void {
    const session = this.sessions[workspace];
    if (!session?.live) return;
    session.live = false;
    session.loading = false;
    this.shown.delete(workspace);
    this.placed.delete(workspace);
    void browserClose(workspace).catch(() => {});
  }

  /** Whether `workspace`'s page should be on screen right now. */
  private wantsVisible(workspace: string): boolean {
    return workspace === this.activeKey && this.isOpen(workspace) && this.slotShowable;
  }

  /** Load `url` in a workspace's page, creating it (and making room) first. */
  private async load(workspace: string, url: string): Promise<void> {
    const inFlight = this.creating.get(workspace);
    if (inFlight) await inFlight;
    const session = this.ensure(workspace);
    const visible = this.wantsVisible(workspace);
    const bounds = this.slot ?? DEFAULT_BOUNDS;
    if (!session.live) {
      const evict = pageToEvict(Object.values(this.sessions), workspace, this.activeKey);
      if (evict) this.suspend(evict);
    }
    if (visible) session.lastShown = Date.now();
    const work = browserOpen(workspace, url, bounds, visible).then(
      (state) => {
        this.shown.set(workspace, visible);
        this.placed.set(workspace, bounds);
        this.apply(state);
      },
      (e) => {
        session.live = false;
        throw e;
      },
    );
    this.creating.set(workspace, work);
    try {
      await work;
    } finally {
      if (this.creating.get(workspace) === work) this.creating.delete(workspace);
    }
  }

  /** Mirror a state the backend reported. */
  apply(state: BrowserPageState): void {
    const session = this.ensure(state.workspace);
    session.live = state.live;
    session.url = state.url || session.url;
    session.title = state.title;
    session.loading = state.loading;
    session.canGoBack = state.canGoBack;
    session.canGoForward = state.canGoForward;
    session.zoom = state.zoom;
    session.generation = state.generation;
    if (!state.live) {
      this.shown.delete(state.workspace);
      this.placed.delete(state.workspace);
    }
  }

  /** The panel on screen reports its slot: where a page goes, and whether one
   *  may be drawn now. `null` = no panel. */
  setSlot(bounds: BrowserBounds | null, showable: boolean): void {
    this.slot = bounds ?? this.slot;
    this.slotShowable = !!bounds && showable;
    this.sync();
  }

  /** Bring every page in line with what should be on screen. */
  sync(): void {
    const active = this.activeKey;
    for (const session of Object.values(this.sessions)) {
      const ws = session.workspace;
      if (!session.live) {
        // The workspace on screen reopening a released page (it was put to
        // sleep, or made room for another): load it again where it was.
        if (ws === active && this.wantsVisible(ws) && session.url && !this.creating.has(ws)) {
          void this.load(ws, session.url).catch(() => {});
        }
        continue;
      }
      if (this.creating.has(ws)) continue;
      const visible = this.wantsVisible(ws);
      if (visible && this.slot && !sameBounds(this.placed.get(ws), this.slot)) {
        const bounds = { ...this.slot };
        this.placed.set(ws, bounds);
        void browserSetBounds(ws, bounds).catch(() => {});
      }
      if (this.shown.get(ws) !== visible) {
        this.shown.set(ws, visible);
        if (visible) session.lastShown = Date.now();
        void browserSetVisible(ws, visible)
          .then((s) => this.apply(s))
          .catch(() => {});
      }
    }
  }

  /** Subscribe to the backend (once): page state, and a re-sync of the pages
   *  that outlived a reload of the window. Also releases the page of a
   *  workspace that goes to sleep. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    $effect.root(() => {
      $effect(() => {
        // Tracks only the workspace on screen and which workspaces sleep; the
        // work itself is untracked, so the state it writes never re-runs it.
        void this.activeKey;
        const asleep = Object.keys(this.sessions).filter((ws) => terminals.isWorkspaceAsleep(ws));
        untrack(() => {
          for (const ws of asleep) this.suspend(ws);
          this.sync();
        });
      });
    });
    try {
      await listen<BrowserPageState>("browser:state", (e) => this.apply(e.payload));
      for (const state of await browserSessions()) {
        this.apply(state);
        this.ensure(state.workspace).open = true;
      }
      this.sync();
    } catch {
      // No Tauri runtime (web preview) — nothing to mirror.
    }
  }
}

export const browser = new BrowserStore();
