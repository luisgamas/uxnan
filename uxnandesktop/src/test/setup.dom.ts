/**
 * Global setup for the `dom` project.
 *
 * Everything here exists so an individual component test can be about the
 * component. The two rules it enforces:
 *
 * 1. **No test leaks into the next one.** The fake backend is torn down after
 *    every test, so a stray handler or listener cannot make an unrelated test
 *    pass (or fail) for reasons nobody can see in the file they are reading.
 * 2. **jsdom's gaps are filled once.** jsdom implements the DOM, not a browser:
 *    it has no layout engine, no `matchMedia`, no `ResizeObserver`, no clipboard.
 *    Components legitimately use those, and stubbing them per file would be
 *    noise. They are stubbed here as *inert* implementations — never as
 *    something that fakes a result a test might then assert on.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

import { uninstallFakeBackend } from "./tauri";

afterEach(() => {
  uninstallFakeBackend();
});

// --- jsdom gaps -------------------------------------------------------------

if (!window.matchMedia) {
  // The theme store asks for the OS colour scheme at import time. Answering
  // "light, and nothing will ever change" keeps it deterministic; a test that
  // cares about theme switching overrides this itself.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  // Panels and the terminal area observe their own size. jsdom has no layout,
  // so every element is 0×0 and the observer would never fire anyway — an inert
  // one is the honest stand-in.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// `Element.animate` is used by a few transitions; jsdom has no Web Animations.
if (!Element.prototype.animate) {
  Element.prototype.animate = (() => ({
    finished: Promise.resolve(),
    cancel() {},
    finish() {},
  })) as unknown as typeof Element.prototype.animate;
}

// `scrollIntoView` and friends: no layout, so they are no-ops rather than
// throwing and failing a test for a reason unrelated to what it asserts.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// A component that opens a pointer lock (the drag guards) would otherwise throw.
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// xterm probes for a canvas while measuring the character grid. jsdom has none
// and logs "Not implemented" on every mount, which buries real failures in
// noise. Returning `null` is what a browser does when the context type is
// unsupported, and xterm handles that by falling back — so this reports the
// truth rather than faking a drawing surface no assertion could rely on.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Console policy. Two opposite jobs: make a real problem impossible to miss,
// and keep known third-party noise from burying it.
//
// Promoted to a failure — these always mean the test itself is wrong:
//   · a prop the component does not declare (a renamed prop the test still passes)
//   · a lifecycle call outside a component (a helper mounting something wrongly)
//
// Suppressed — `derived_inert` fires from `bits-ui`'s dialog teardown when a
// modal is unmounted between tests. It is the library reading its own derived
// during destruction, not the app misbehaving, and it prints several times per
// dialog test. Everything else still reaches the terminal.
const FAIL_ON = ["was created with unknown prop", "lifecycle_outside_component"];
const SUPPRESS = ["derived_inert"];

const consoleError = console.error;
vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const text = String(args[0] ?? "");
  if (FAIL_ON.some((needle) => text.includes(needle))) {
    throw new Error(`Svelte reported a problem the test should not ignore:\n${text}`);
  }
  if (SUPPRESS.some((needle) => text.includes(needle))) return;
  consoleError(...args);
});

const consoleWarn = console.warn;
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
  const text = String(args[0] ?? "");
  if (SUPPRESS.some((needle) => text.includes(needle))) return;
  consoleWarn(...args);
});
