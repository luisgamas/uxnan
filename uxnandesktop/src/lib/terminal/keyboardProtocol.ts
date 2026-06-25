// Modern keyboard protocol (Kitty / "CSI u") — terminal side.
//
// xterm.js has no built-in support for the progressive keyboard-enhancement
// protocol (https://sw.kovidgoyal.net/kitty/keyboard-protocol/). This module
// implements the terminal half: it tracks the flag stack an application
// negotiates and encodes key events as `CSI <code> ; <mods> [: <event>] u`.
//
// It is **dormant by default**: until an application explicitly enables the
// protocol (via the escape sequences below), `encode*` returns `null` and the
// caller falls back to xterm's normal key handling — so existing behaviour is
// untouched. Only when a Kitty-aware app opts in do we take over its keys.
//
// Negotiation sequences (handled in `Terminal.svelte` via `registerCsiHandler`):
//   - `CSI ? u`            query → reply `CSI ? <flags> u`
//   - `CSI > <flags> u`    push `<flags>` onto the stack
//   - `CSI < <number> u`   pop `<number>` levels (default 1)
//   - `CSI = <flags> ; <mode> u`  set current flags (mode 1=all, 2=set, 3=clear)
//
// Supported flags (others are reported as unsupported so apps degrade): the
// disambiguate, report-event-types and report-all-keys bits. Alternate-keys (4)
// and associated-text (16), the super/hyper/meta modifiers and a full
// functional-key table are left for a follow-up (see `FOR-DEV.md`); functional
// and navigation keys fall through to xterm's legacy encoding, which apps still
// understand.

/** Disambiguate escape codes (e.g. distinguish Ctrl+I from Tab, Esc from a seq). */
const FLAG_DISAMBIGUATE = 0b1;
/** Report press / repeat / release as the event-type field. */
const FLAG_REPORT_EVENT_TYPES = 0b10;
/** Report every key (including plain text) as an escape code. */
const FLAG_REPORT_ALL_KEYS = 0b1000;

/** The flag bits this implementation actually honours. An app that sets more
 *  gets only these back from a query, the protocol's designed degradation. */
const SUPPORTED_FLAGS = FLAG_DISAMBIGUATE | FLAG_REPORT_EVENT_TYPES | FLAG_REPORT_ALL_KEYS;

/** Unicode key codes for the keys the protocol names explicitly. */
const SPECIAL_CODES: Record<string, number> = {
  Escape: 27,
  Enter: 13,
  Tab: 9,
  Backspace: 127,
  " ": 32,
};

export type KeyEventType = "press" | "release";

export class KeyboardProtocol {
  /** Flag stack; the top entry is the active set. Empty = protocol disabled. */
  private stack: number[] = [];

  /** Whether any non-zero flag set is active (the encoder is live). */
  get active(): boolean {
    return this.flags !== 0;
  }

  /** The currently-active flag set (top of stack, or 0 when disabled). */
  get flags(): number {
    return this.stack.length ? this.stack[this.stack.length - 1] : 0;
  }

  /** Reset to the disabled state (e.g. on a full terminal reset). */
  reset(): void {
    this.stack = [];
  }

  /** Push a new flag set (`CSI > flags u`). */
  push(flags: number): void {
    this.stack.push(flags & SUPPORTED_FLAGS);
  }

  /** Pop `n` levels (`CSI < n u`), never underflowing past the disabled state. */
  pop(n: number): void {
    for (let i = 0; i < Math.max(1, n); i++) this.stack.pop();
  }

  /** Set the current flags (`CSI = flags ; mode u`): mode 1 replaces, 2 sets the
   *  given bits, 3 clears them. With an empty stack this seeds the first entry. */
  set(flags: number, mode: number): void {
    const current = this.flags;
    let next: number;
    if (mode === 2) next = current | flags;
    else if (mode === 3) next = current & ~flags;
    else next = flags;
    next &= SUPPORTED_FLAGS;
    if (this.stack.length) this.stack[this.stack.length - 1] = next;
    else this.stack.push(next);
  }

  /** The reply bytes for a query (`CSI ? u`) → `CSI ? <flags> u`. */
  queryReply(): string {
    return `\x1b[?${this.flags}u`;
  }

  /** Encode a keydown, or `null` to let xterm handle it (dormant / a key we
   *  leave to the legacy encoding). `repeat` flags auto-repeat events. */
  encodeKeyDown(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; repeat?: boolean }): string | null {
    return this.encode(e, "press", !!e.repeat);
  }

  /** Encode a keyup, or `null` when release reporting isn't enabled. */
  encodeKeyUp(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
    return this.encode(e, "release", false);
  }

  private encode(
    e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
    type: KeyEventType,
    repeat: boolean,
  ): string | null {
    const flags = this.flags;
    if (!flags) return null;

    const reportEvents = (flags & FLAG_REPORT_EVENT_TYPES) !== 0;
    if (type === "release" && !reportEvents) return null;

    const code = baseCode(e.key);
    if (code === null) return null; // functional / navigation key → legacy

    const ctrl = e.ctrlKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const meta = e.metaKey;
    const hasNonShiftMod = ctrl || alt || meta;
    const reportAll = (flags & FLAG_REPORT_ALL_KEYS) !== 0;
    const isSpecial = e.key in SPECIAL_CODES;

    // Decide whether to take the key over or leave it to xterm's legacy output.
    let take: boolean;
    if (reportAll) {
      take = true; // every key as an escape code
    } else if (e.key === "Escape") {
      take = true; // plain Escape is disambiguated from the start of a sequence
    } else if (isSpecial) {
      take = hasNonShiftMod || shift; // Tab/Enter/Backspace/Space only when modified
    } else {
      take = hasNonShiftMod; // text keys only for ctrl/alt/super combos
    }
    if (!take) return null;

    // Event-type field (only emitted when reporting is on): 1 press, 2 repeat,
    // 3 release.
    let ev = 1;
    if (reportEvents) {
      if (type === "release") ev = 3;
      else if (repeat) ev = 2;
    }

    const mods = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0);
    return buildCsiU(code, mods, ev);
  }
}

/** The unicode key code for a `KeyboardEvent.key`, or `null` for keys without a
 *  CSI-u text code here (arrows, F-keys, Home/End/PageUp…), which are left to
 *  xterm's legacy sequences. */
function baseCode(key: string): number | null {
  if (key in SPECIAL_CODES) return SPECIAL_CODES[key];
  // A single Unicode scalar (printable). `[...key]` counts code points, so a
  // surrogate-pair emoji is length 1, while named keys like "ArrowUp" aren't.
  if ([...key].length === 1) {
    return key.toLowerCase().codePointAt(0) ?? null;
  }
  return null;
}

/** `CSI <code> [; <mods> [: <event>]] u`. The `;mods` group is omitted when
 *  there are no modifiers and no event field (mods === 1, event === 1). */
function buildCsiU(code: number, mods: number, event: number): string {
  let s = `\x1b[${code}`;
  if (mods > 1 || event > 1) {
    s += `;${mods}`;
    if (event > 1) s += `:${event}`;
  }
  return s + "u";
}
