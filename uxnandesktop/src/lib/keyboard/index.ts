// The app's keyboard layer — see `docs/keyboard.md`.
//
//  chords.ts            how a chord is written, read from an event and drawn
//  actions.ts           the registry: every action, its defaults and scope
//  router.ts            who gets a key, by where the focus is (pure)
//  run.ts               performs an action once it was decided
//  keyboard.svelte.ts   the person's bindings, the two UI entry points and the
//                       native layer (browser pages, the macOS menu bar)

export {
  eventToChord,
  formatChord,
  formatChordParts,
  isMac,
  normalizeChord,
  parseChord,
  toCodeMirrorKey,
} from "./chords";
export {
  KEY_ACTIONS,
  SHORTCUT_CATEGORIES,
  SHORTCUT_GROUPS,
  actionById,
  defaultChordOf,
  type KeyAction,
  type ShortcutCategory,
  type TerminalPolicy,
} from "./actions";
export { focusContextOf, routeKey, textOwnsChord, type KeyDisposition, type TerminalState } from "./router";
export { runAppAction } from "./run";
export {
  actionForChord,
  handleWindowKey,
  resolveBinding,
  resolveLeaderChord,
  resolveTerminalPolicy,
  routeTerminalKey,
  startNativeKeyboard,
} from "./keyboard.svelte";
