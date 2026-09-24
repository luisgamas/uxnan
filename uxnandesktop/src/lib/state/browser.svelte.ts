// The integrated browser, per workspace.
//
// Every workspace (a worktree, or the Global space) has its own browser
// session: the page it shows and that page's live state. Whether it is on
// screen is the right dock's call (`state/dock.svelte.ts`): the page shows
// while the dock of its workspace shows the Browser surface. The page itself is a child webview of the main window owned by the
// backend (`src-tauri/src/browser/host.rs`); this store decides which page is
// on screen and where, and mirrors what the backend reports about each one.
//
// The rules it enforces:
//
// - **Only the workspace on screen shows its page.** Switching workspace hides
//   the previous page and shows the next one's (when its dock shows the
//   browser); a page never follows the person into a workspace it was not
//   opened in. Switching surface or closing the dock hides the page and keeps
//   it; only closing the page (the toolbar's close) releases it.
// - **A page opened for another workspace stays in it.** An agent working in a
//   background worktree gets its page loaded there, hidden, and its dock set to
//   the browser, so the person finds it when they visit that workspace.
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
  browserApprovals,
  browserCapture,
  browserClose,
  browserOpen,
  browserSessions,
  browserSetBounds,
  browserSetVisible,
  type BrowserApproval,
  type BrowserBounds,
  type BrowserPageState,
} from "$lib/api";
import { terminals } from "$lib/state/terminals.svelte";
import { dock } from "$lib/state/dock.svelte";
import type { BrowserCloseAction } from "$lib/types";

/** How many pages may be alive at once, across every workspace. */
export const MAX_LIVE_PAGES = 3;

/** How long a page about to be covered waits for its still image before it
 *  hides anyway (a dialog should not open late for it). */
const FREEZE_WAIT_MS = 180;

/** The size a page is laid out at before any panel slot has been measured. */
const DEFAULT_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 520, height: 720 };

/** One workspace's browser. */
export interface BrowserSession {
  workspace: string;
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
  /** What agents are waiting for the person to approve, oldest first. */
  approvals = $state<BrowserApproval[]>([]);
  /** A still image of the page on screen, drawn in its slot while a dialog or
   *  menu covers the panel and the page itself has to hide — so the panel
   *  keeps showing the page behind the dialog instead of going blank. */
  placeholder = $state<{ workspace: string; src: string } | null>(null);

  /** The oldest approval waiting in `workspace`, if any. */
  approvalFor(workspace = this.activeKey): BrowserApproval | null {
    return this.approvals.find((a) => a.workspace === workspace) ?? null;
  }

  /** The panel slot on screen, and whether a page can be drawn in it now. */
  private slot: BrowserBounds | null = null;
  private slotShowable = false;
  /** Whether the slot is hidden because an overlay covers it (as opposed to
   *  Settings, the window hidden, no panel). */
  private covered = false;
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

  /** Whether the dock of `workspace` (default: on screen) shows the browser. */
  isShown(workspace = this.activeKey): boolean {
    return dock.showing(workspace) === "browser";
  }

  private ensure(workspace: string): BrowserSession {
    const existing = this.sessions[workspace];
    if (existing) return existing;
    this.sessions[workspace] = blank(workspace);
    return this.sessions[workspace];
  }

  /** Open `url` in a workspace's browser — the one on screen by default — and
   *  turn its dock to the browser. A page opened for a workspace that is not
   *  on screen loads hidden and waits for the person to visit it. */
  async open(url: string, workspace = this.activeKey): Promise<void> {
    const session = this.ensure(workspace);
    session.url = url;
    session.title = "";
    dock.show("browser", workspace);
    await this.load(workspace, url);
  }

  /** Close a workspace's page (the toolbar's close). The Browser surface stays
   *  where it is, empty, ready for another address. */
  close(workspace = this.activeKey): void {
    const session = this.sessions[workspace];
    if (!session) return;
    this.release(workspace);
    session.url = "";
    session.title = "";
    session.canGoBack = null;
    session.canGoForward = null;
  }

  /** The toolbar's ✕, as Settings → Browser says (`closeAction`): clear the
   *  page (`blank`), go back to the home page (`home` — cleared when there is
   *  none), or close the browser and the dock with it (`dock`). */
  async dismiss(action: BrowserCloseAction, homeUrl: string | null, workspace = this.activeKey): Promise<void> {
    if (action === "home" && homeUrl) {
      await this.open(homeUrl, workspace);
      return;
    }
    this.close(workspace);
    if (action === "dock") dock.hide(workspace);
  }

  /** Release a workspace's page but keep its URL, so showing it again reloads
   *  where it was (a sleeping workspace, or room for another page). */
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
    return workspace === this.activeKey && this.isShown(workspace) && this.slotShowable;
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
    // A page that is gone says where it *was*; what the session remembers is
    // the app's call — a closed page is forgotten (the toolbar's ✕), a
    // released one keeps its URL. Taking the dead page's URL back reloaded a
    // page the person had just closed.
    if (state.live) session.url = state.url || session.url;
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

  /** The panel on screen reports its slot: where a page goes, whether one may
   *  be drawn now, and — when not — whether a dialog or menu is the reason.
   *  `null` = no panel. */
  setSlot(bounds: BrowserBounds | null, showable: boolean, covered = false): void {
    this.slot = bounds ?? this.slot;
    this.slotShowable = !!bounds && showable;
    this.covered = !!bounds && !showable && covered;
    if (!this.covered && !this.slotShowable) this.placeholder = null;
    this.sync();
  }

  /** Hide a page an overlay is about to cover, leaving a still image of it in
   *  the slot. The capture gets a moment; the page hides either way. */
  private async freezeThenHide(workspace: string): Promise<void> {
    const capture = browserCapture(workspace).then(
      (src) => {
        if (this.covered && this.shown.get(workspace) === false) this.placeholder = { workspace, src };
      },
      () => {},
    );
    await Promise.race([capture, new Promise((r) => setTimeout(r, FREEZE_WAIT_MS))]);
    // The overlay may have gone while the image was taken.
    if (this.shown.get(workspace) !== false) return;
    await browserSetVisible(workspace, false)
      .then((s) => this.apply(s))
      .catch(() => {});
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
        const wasShown = this.shown.get(ws) === true;
        this.shown.set(ws, visible);
        if (visible) {
          session.lastShown = Date.now();
          void browserSetVisible(ws, true)
            .then((s) => {
              this.apply(s);
              if (this.placeholder?.workspace === ws) this.placeholder = null;
            })
            .catch(() => {});
        } else if (wasShown && ws === active && this.covered) {
          void this.freezeThenHide(ws);
        } else {
          if (this.placeholder?.workspace === ws) this.placeholder = null;
          void browserSetVisible(ws, false)
            .then((s) => this.apply(s))
            .catch(() => {});
        }
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
      await listen<BrowserApproval>("browser:approval", (e) => {
        this.approvals = [...this.approvals.filter((a) => a.id !== e.payload.id), e.payload];
      });
      await listen<{ id: string }>("browser:approval-done", (e) => {
        this.approvals = this.approvals.filter((a) => a.id !== e.payload.id);
      });
      this.approvals = await browserApprovals();
      for (const state of await browserSessions()) this.apply(state);
      this.sync();
    } catch {
      // No Tauri runtime (web preview) — nothing to mirror.
    }
  }
}

export const browser = new BrowserStore();
