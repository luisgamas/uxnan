// Live xterm instances, keyed by terminal id, that OUTLIVE their Svelte
// component — the VS Code model: a terminal's xterm (buffer, parser state,
// scrollback, addons, PTY event wiring) is created ONCE and only its DOM element
// moves when the pane moves. `Terminal.svelte` mounts *adopt* the instance
// (append its wrapper element, register view hooks) and *park* it on unmount
// (detach the wrapper, keep everything alive); the instance is disposed only
// when its tab truly closes.
//
// This replaces the old destroy-and-replay model, where dragging a tab to
// another region recreated xterm from scratch and replayed the backend's raw
// output ring buffer into it. Replaying a full-screen TUI's raw byte stream is
// unsound by construction: the ring could start mid-escape-sequence (parser
// desync → dropped/garbled cells), the replay raced live `pty:output` events,
// xterm's auto-replies to queries embedded in the replayed bytes had to be
// suppressed, and ConPTY drops a same-size resize so the TUI never repainted
// over the damage. Keeping the instance alive removes that entire failure class:
// nothing is ever replayed, no output event is ever missed mid-move, and the
// buffer/scrollback survive by simply never being destroyed.
//
// PTY lifecycle note: PTY event subscriptions (`pty:output:{id}`, `pty:exit:{id}`)
// live here, on the instance, so output keeps streaming into the buffer even
// during the brief parked window of a drag. The GPU (WebGL) renderer is NOT
// owned here — mounts attach/release it with pane visibility (see
// `Terminal.svelte`) so parked/hidden terminals never hold a GPU context; the
// handle lives on the instance only so a remount can find it.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "$lib/api";
import { agentMonitor } from "$lib/state/agentMonitor.svelte";
import { KeyboardProtocol } from "$lib/terminal/keyboardProtocol";
import { DEFAULT_TERMINAL_SCROLLBACK, SNAPSHOT_SCROLLBACK } from "$lib/terminal/scrollback";
import { scanForJunctionBlock, forgetJunctionBlock } from "$lib/terminal/windowsJunctionGuard";

/** Read CSI parameter `i` as a non-negative integer, or `def` when absent.
 *  (xterm hands sub-parameters as `number[]`; the keyboard sequences handled
 *  here never use them, so those are treated as absent.) */
function numParam(params: (number | number[])[], i: number, def: number): number {
  const v = params[i];
  return typeof v === "number" && v >= 0 ? v : def;
}

// Shell output is debounced before typing an agent command so profile scripts
// can finish drawing their prompt. Quiet shells still launch via the fallback.
const RUN_COMMAND_QUIET_MS = 160;
const RUN_COMMAND_FALLBACK_MS = 1800;

/** Spawn parameters for the instance's PTY (fixed per tab — they come from the
 *  tab's state and never change for a given id). */
export interface TerminalSpawnSpec {
  cwd?: string;
  shell?: string;
  args?: string[];
  /** One-shot agent command typed into the shell once it settles. */
  runCommand?: string;
  /** Whether `runCommand` is auto-run (Enter appended) or only pre-typed. */
  runCommandExecute?: boolean;
  env?: [string, string][];
}

/** Everything needed to build a fresh instance. */
export interface TerminalCreateOptions {
  /** Resolved appearance (theme/font/cursor) for the new xterm. */
  options: ITerminalOptions;
  /** Load the ligatures addon (must happen before WebGL — see Terminal.svelte). */
  ligatures: boolean;
  /** Make printed URLs Ctrl/Cmd-clickable via the integrated-browser policy. */
  webLinks: boolean;
  spec: TerminalSpawnSpec;
}

/** View-side callbacks of the currently-adopting mount. Empty while parked. */
export interface MountHooks {
  /** Runs after each PTY chunk is parsed (the mount un-pauses rendering). */
  onOutput?: () => void;
  /** Runs when the PTY process exits. */
  onExit?: () => void;
}

export interface TerminalInstance {
  readonly id: string;
  readonly term: Terminal;
  readonly fit: FitAddon;
  /** Serializes the PARSED screen+scrollback to ANSI (workspace sleep / the
   *  close-time snapshot). Unlike the removed raw-byte ring replay, this is
   *  sound by construction: it emits cell contents and attributes, never a
   *  mid-escape stream and never device queries. */
  readonly serializer: SerializeAddon;
  /** Kitty/CSI-u keyboard protocol state — negotiated by apps in the PTY, so it
   *  must survive remounts with the instance. */
  readonly kbd: KeyboardProtocol;
  /** The DOM element xterm renders into; mounts append/detach it to move panes. */
  readonly wrapper: HTMLDivElement;
  readonly spec: TerminalSpawnSpec;
  /** GPU renderer handle + last context-loss timestamp. Owned by mounts (bound
   *  to pane visibility); stored here so a remount finds the live addon. */
  renderer: WebglAddon | undefined;
  webglLossAt: number;
  /** Last grid the PTY is KNOWN to have (spawn size, or a `pty_resize` that was
   *  actually sent to a live session). Resize only on a real change, so a
   *  redundant SIGWINCH never makes a full-screen TUI repaint/jump. */
  lastCols: number;
  lastRows: number;
  /** Latest grid the view wants (from fits). Resizes requested before the PTY
   *  exists land here and are flushed right after spawn — a resize must never
   *  race `pty_create` (a swallowed NotFound used to poison the dedupe and leave
   *  the shell permanently on the wrong grid: prompts painted mid-screen, short
   *  names overwriting long ones). 0 = no fit has produced a grid yet. */
  desiredCols: number;
  desiredRows: number;
  /** The PTY accepts writes (spawn finished). */
  ptyReady: boolean;
  /** The backend rejected the spawn (missing shell / bad profile). */
  spawnFailed: boolean;
  /** The agent `runCommand` was already typed (never re-type into a live agent). */
  launched: boolean;
  /** `pty:exit` arrived while parked; the next adopting mount fires its onExit. */
  exitedWhileParked: boolean;
  /** Token of the adopting mount (null while parked). Guards against the
   *  mount/unmount overlap during a drag: Svelte may run the new mount before
   *  the old unmount, so release/dispose only act for the CURRENT adopter. */
  adopter: symbol | null;
  hooks: MountHooks;
  /* internal */
  launchTimer: ReturnType<typeof setTimeout> | undefined;
  disposables: (() => void)[];
}

const registry = new Map<string, TerminalInstance>();
/** In-flight creations, so two overlapping mounts of the same id (drag remount)
 *  never build two instances / spawn two PTYs. */
const pending = new Map<string, Promise<TerminalInstance>>();

export function getInstance(id: string): TerminalInstance | undefined {
  return registry.get(id);
}

/** Serialize a live instance's parsed screen + last `scrollback` lines as ANSI
 *  (for workspace sleep and the close-time snapshot). `null` when the instance
 *  doesn't exist or serialization throws. */
export function serializeInstance(id: string, scrollback = SNAPSHOT_SCROLLBACK): string | null {
  const inst = registry.get(id);
  if (!inst) return null;
  try {
    return inst.serializer.serialize({ scrollback });
  } catch {
    return null;
  }
}

/** Get-or-create the instance for `id`. `created` tells the caller whether it
 *  owns first-time setup (spawning the PTY). `host` is only used on creation. */
export async function acquireInstance(
  id: string,
  host: HTMLElement,
  build: () => TerminalCreateOptions,
): Promise<{ inst: TerminalInstance; created: boolean }> {
  const existing = registry.get(id);
  if (existing) return { inst: existing, created: false };
  const inFlight = pending.get(id);
  if (inFlight) return { inst: await inFlight, created: false };
  const creation = createInstance(id, host, build());
  pending.set(id, creation);
  try {
    const inst = await creation;
    registry.set(id, inst);
    return { inst, created: true };
  } finally {
    pending.delete(id);
  }
}

/** Adopt the instance into a mount: move its element under `host`, register the
 *  mount's hooks, and deliver an exit that happened while parked. */
export function adoptInstance(
  inst: TerminalInstance,
  host: HTMLElement,
  token: symbol,
  hooks: MountHooks,
): void {
  inst.adopter = token;
  inst.hooks = hooks;
  // appendChild MOVES the node when it's already parented elsewhere (a drag
  // remount that runs before the old unmount) — never a copy, never a remount
  // of xterm's internals.
  host.appendChild(inst.wrapper);
  if (inst.exitedWhileParked) {
    inst.exitedWhileParked = false;
    queueMicrotask(() => inst.hooks.onExit?.());
  }
}

/** Park the instance (unmount without closing): detach its element and drop the
 *  mount's hooks, keeping xterm + PTY wiring alive. No-op unless `token` is the
 *  current adopter (see `adopter`). Returns whether it released. */
export function releaseInstance(id: string, token: symbol): boolean {
  const inst = registry.get(id);
  if (!inst || inst.adopter !== token) return false;
  inst.adopter = null;
  inst.hooks = {};
  inst.wrapper.remove();
  return true;
}

/** Destroy the instance for real (its tab closed): unlisten PTY events, dispose
 *  xterm (which disposes its loaded addons, including any live renderer), and
 *  forget it. Idempotent. */
export function disposeInstance(id: string): void {
  const inst = registry.get(id);
  if (!inst) return;
  registry.delete(id);
  forgetJunctionBlock(id);
  if (inst.launchTimer) clearTimeout(inst.launchTimer);
  for (const dispose of inst.disposables.splice(0)) {
    try {
      dispose();
    } catch {
      // Listener already gone (teardown race) — keep disposing the rest.
    }
  }
  try {
    inst.term.dispose();
  } catch {
    // Core already torn down — nothing left to free.
  }
  inst.wrapper.remove();
}

/** Ask for the PTY grid to match the view's grid. This is the ONLY path that
 *  may call `pty_resize`, and it upholds two invariants that kill the
 *  spawn/resize race for good:
 *
 *  1. **Never resize a PTY that doesn't exist yet.** A fit can settle while
 *     `pty_create` is still in flight; sending the resize then hits NotFound,
 *     and swallowing it while recording the size as "sent" used to poison the
 *     change-dedupe — the correction was never retried, leaving ConPTY on the
 *     spawn-default 80×24 while xterm showed the real grid (PowerShell painting
 *     its prompt mid-screen, short names overwriting long ones, doubled
 *     headers). Pre-spawn requests are stashed in `desiredCols/Rows` and
 *     flushed by `spawnPty` the moment the session exists.
 *  2. **Never let a failed resize block a future one.** On a rejected
 *     `pty_resize` the known-grid is reset so the next fit retries instead of
 *     being deduped away. */
export function requestPtyResize(inst: TerminalInstance, cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0) return;
  inst.desiredCols = cols;
  inst.desiredRows = rows;
  if (!inst.ptyReady) return; // stashed — spawnPty flushes it
  if (cols === inst.lastCols && rows === inst.lastRows) return;
  inst.lastCols = cols;
  inst.lastRows = rows;
  invoke("pty_resize", { id: inst.id, cols, rows }).catch(() => {
    // Don't let a lost resize masquerade as the PTY's real grid.
    inst.lastCols = 0;
    inst.lastRows = 0;
  });
}

/** Spawn the instance's PTY (first-time setup, called by the creating mount
 *  after the first fit so the grid is real). Resolves `fresh: false` when the
 *  backend already had a live PTY for this id — that can only mean the webview
 *  reloaded (dev/HMR) over a surviving backend, since in-app remounts adopt the
 *  live instance and never respawn; a repaint nudge is sent for that case. On a
 *  backend rejection (missing shell / bad profile) resolves with `error` so the
 *  mount can surface it in the pane; outside Tauri (plain web preview) there is
 *  no backend and the spawn quietly reports `fresh: true`. */
export async function spawnPty(
  inst: TerminalInstance,
  cols: number,
  rows: number,
): Promise<{ fresh: boolean; error?: string }> {
  const { spec } = inst;
  try {
    const fresh = await invoke<boolean>("pty_create", {
      id: inst.id,
      cwd: spec.cwd,
      shell: spec.shell,
      args: spec.args,
      env: spec.env,
      cols,
      rows,
    });
    // The PTY now exists at exactly `cols`×`rows`; record that as the known
    // grid, then flush any fit that settled while the spawn was in flight so
    // the shell and xterm can never disagree about the grid.
    inst.lastCols = cols;
    inst.lastRows = rows;
    inst.ptyReady = true;
    if (inst.desiredCols > 0 && inst.desiredRows > 0) {
      requestPtyResize(inst, inst.desiredCols, inst.desiredRows);
    }
    // Quiet-prompt fallback: shells whose profile prints nothing still launch.
    scheduleAgentLaunch(inst, RUN_COMMAND_FALLBACK_MS);
    // Nudge against the grid the PTY was just synced to (not the spawn args —
    // the flush above may have moved it).
    if (!fresh) await nudgeRepaint(inst, inst.lastCols, inst.lastRows);
    return { fresh };
  } catch (e) {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      inst.spawnFailed = true;
      const error =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      return { fresh: true, error };
    }
    // Plain web preview — no backend to spawn; the xterm still renders.
    return { fresh: true };
  }
}

/** Ask a pre-existing PTY (webview reload over a live backend) for a full
 *  repaint. ConPTY has no reattach protocol and drops a same-size resize, so
 *  bounce the row count once: the real WINCH makes a full-screen TUI redraw its
 *  screen instead of leaving the fresh xterm empty until the next byte. */
async function nudgeRepaint(inst: TerminalInstance, cols: number, rows: number): Promise<void> {
  if (cols <= 0 || rows <= 0) return; // grid unknown (a resize just failed) — skip
  try {
    await invoke("pty_resize", { id: inst.id, cols, rows: Math.max(1, rows - 1) });
    await invoke("pty_resize", { id: inst.id, cols, rows });
    inst.lastCols = cols;
    inst.lastRows = rows;
  } catch {
    // Backend gone mid-call — nothing to repaint.
  }
}

/** Debounced one-shot typing of the agent launch command, once the PTY is ready
 *  and the shell's profile output has gone quiet. */
export function scheduleAgentLaunch(inst: TerminalInstance, delay = RUN_COMMAND_QUIET_MS): void {
  const { runCommand, runCommandExecute = true } = inst.spec;
  if (!runCommand || !inst.ptyReady || inst.spawnFailed || inst.launched) return;
  if (inst.launchTimer) clearTimeout(inst.launchTimer);
  inst.launchTimer = setTimeout(async () => {
    inst.launchTimer = undefined;
    try {
      // Auto-run appends Enter; "type only" leaves the line for the user to run.
      await invoke("pty_write", {
        id: inst.id,
        data: runCommandExecute ? `${runCommand}\r` : runCommand,
      });
      inst.launched = true;
    } catch {
      // Backend not ready for this write — stay retryable (next output chunk
      // or fallback reschedules).
    }
  }, delay);
}

async function createInstance(
  id: string,
  host: HTMLElement,
  opts: TerminalCreateOptions,
): Promise<TerminalInstance> {
  const wrapper = document.createElement("div");
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  // In the document before `open()` so xterm measures real font metrics.
  host.appendChild(wrapper);

  const term = new Terminal({
    ...opts.options,
    // Bounded scrollback caps per-terminal memory (instances stay alive for the
    // tab's whole life, so this is the effective limit on retained output). The
    // value is user-configurable (Settings → Terminal, passed in via
    // `opts.options.scrollback`); the fallback covers callers that don't set it.
    scrollback: opts.options.scrollback ?? DEFAULT_TERMINAL_SCROLLBACK,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  term.open(wrapper);

  // Ligatures are loaded BEFORE the WebGL renderer, on purpose. xterm bakes its
  // glyph texture atlas when WebGL activates; a ligatures addon loaded afterwards
  // registers its character joiner too late to reach the already-baked atlas, so
  // ligated glyphs render doubled/ghosted over their plain forms on ligature-heavy
  // TUIs (Codex) — xterm #3303. Registering the character joiner first means the
  // atlas is built with ligatures resolved from the very first frame. (WebGL is
  // attached later, per-mount, and only while the pane is visible.)
  if (opts.ligatures) {
    try {
      term.loadAddon(new LigaturesAddon());
    } catch {
      // Ligatures addon unavailable — glyphs still render, just without ligatures.
    }
  }

  // Make printed URLs clickable, routed through the integrated-browser link
  // policy (in-app tab / OS browser / prompt). Like VS Code: only Ctrl/Cmd-click
  // follows a link; a plain click is just text selection.
  if (opts.webLinks) {
    try {
      term.loadAddon(
        new WebLinksAddon((event, uri) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          void openUrl(uri).catch(() => {});
        }),
      );
    } catch {
      // web-links addon unavailable — URLs just stay non-clickable.
    }
  }

  const inst: TerminalInstance = {
    id,
    term,
    fit,
    serializer,
    kbd: new KeyboardProtocol(),
    wrapper,
    spec: opts.spec,
    renderer: undefined,
    webglLossAt: 0,
    lastCols: 0,
    lastRows: 0,
    desiredCols: 0,
    desiredRows: 0,
    ptyReady: false,
    spawnFailed: false,
    launched: false,
    exitedWhileParked: false,
    adopter: null,
    hooks: {},
    launchTimer: undefined,
    disposables: [],
  };

  const ptyWrite = (data: string) => invoke("pty_write", { id, data }).catch(() => {});

  // Layer 2 monitoring: agents that update the terminal title (OSC 0/2) report
  // their state in it ("thinking…", "waiting for input", "done"); map it.
  const titleSub = term.onTitleChange((title) => agentMonitor.noteTitle(id, title));
  inst.disposables.push(() => titleSub.dispose());

  // User input → PTY stdin. Wired at creation — BEFORE the PTY spawns — because
  // on Windows ConPTY/PowerShell emit a cursor-position query (DSR `ESC[6n`) at
  // startup and BLOCK until the terminal replies; xterm generates that reply and
  // delivers it here. If this handler didn't exist yet, the reply would be
  // dropped and the shell would hang forever without printing its prompt. With
  // instances there is also never a snapshot replay, so every reply xterm emits
  // belongs to the live shell — no suppression window needed.
  const dataSub = term.onData((data) => void ptyWrite(data));
  inst.disposables.push(() => dataSub.dispose());

  // Kitty/CSI-u protocol negotiation: an app enables/queries it via these
  // prefixed `… u` sequences. The handlers update `kbd`'s flag stack (which
  // must survive remounts — hence instance-level); a query is answered straight
  // back to the PTY.
  for (const handler of [
    term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
      void ptyWrite(inst.kbd.queryReply());
      return true;
    }),
    term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
      inst.kbd.push(numParam(params, 0, 0));
      return true;
    }),
    term.parser.registerCsiHandler({ prefix: "<", final: "u" }, (params) => {
      inst.kbd.pop(numParam(params, 0, 1));
      return true;
    }),
    term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (params) => {
      inst.kbd.set(numParam(params, 0, 0), numParam(params, 1, 1));
      return true;
    }),
  ]) {
    inst.disposables.push(() => handler.dispose());
  }

  // PTY event wiring lives on the INSTANCE (not the mount) so output keeps
  // streaming into the buffer while parked mid-drag — no event is ever missed,
  // which is what makes remount-without-replay lossless. Subscribed before
  // `pty_create` can run, so no early output is missed either. Outside Tauri
  // (plain web preview) `listen` rejects — the xterm still works locally.
  try {
    const unOutput = await listen<number[]>(`pty:output:${id}`, (e) => {
      const bytes = new Uint8Array(e.payload);
      inst.term.write(bytes, () => inst.hooks.onOutput?.());
      agentMonitor.noteOutput(id);
      scheduleAgentLaunch(inst);
      // Windows only: guide the user when a command trips the OS redirection-trust
      // mitigation on a junction/symlink in this path (see `windowsJunctionGuard`).
      scanForJunctionBlock(id, bytes);
    });
    const unExit = await listen(`pty:exit:${id}`, () => {
      if (inst.hooks.onExit) inst.hooks.onExit();
      else inst.exitedWhileParked = true;
    });
    inst.disposables.push(unOutput, unExit);
  } catch {
    // No Tauri event bus (web preview) — leave the terminal render-only.
  }

  return inst;
}
