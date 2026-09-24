// Registry of the app's live floating layers — dialogs, menus, popovers and
// selects that portal into `<body>` and are meant to paint above everything.
//
// It exists for exactly one reason: the integrated browser's page is not DOM. It
// is a native child webview placed over the browser panel (`browser/host.rs`),
// and a native view ALWAYS paints above the app UI's web content — no
// `z-index` can put a dialog in front of it. The only way to let something in
// the app be on top is to hide the page while it is up. This registry is what
// tells the panel when.
//
// Registration lives in the shared `ui/` primitives (one call per floating
// content component), so every dialog and menu in the app is covered without a
// single feature component having to know the browser exists — and so a dialog
// added later inherits the behaviour for free.
//
// Deliberately NOT registered: tooltips and hover cards. They are transient and
// non-interactive, and the browser toolbar's own tooltips open right over the
// page slot — hiding the whole page to show one would flicker on every hover.
// They stay behind the page.

/** The minimum of a `DOMRect` this module needs (so tests need no DOM). */
export interface LayerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Live floating layers, in registration order. Plain `Set` on purpose:
 *  reactivity would only add cost — the browser panel subscribes instead. */
const layers = new Set<Element>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Register a floating layer for as long as it is mounted. Returns the
 *  unregister function, so a Svelte `$effect` can simply return it. */
export function registerOverlay(el: Element | null | undefined): () => void {
  if (!el) return () => {};
  layers.add(el);
  changed();
  return () => {
    if (layers.delete(el)) changed();
  };
}

/** Be told when a layer registers or unregisters. Returns the unsubscribe
 *  function. A layer that moves while mounted (a menu positioning itself)
 *  does not notify: a subscriber that cares tracks it while any are live. */
export function onOverlayChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether two rects share any area. Zero-area rects (a layer mid-teardown, or
 *  a `display:none` one) never overlap, which is what keeps a closing dialog
 *  from pinning the browser hidden. Pure, so it is unit-tested directly. */
export function rectsOverlap(a: LayerRect, b: LayerRect): boolean {
  if (a.right <= a.left || a.bottom <= a.top) return false;
  if (b.right <= b.left || b.bottom <= b.top) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Whether any live floating layer overlaps `rect` (viewport coordinates).
 *
 *  Overlap — not merely "something is open" — is the test on purpose: a menu in
 *  the left sidebar has no business blanking the browser page on the far right,
 *  while a modal's full-viewport scrim correctly hides it every time. */
export function overlayCovers(rect: LayerRect): boolean {
  for (const el of layers) {
    if (rectsOverlap(el.getBoundingClientRect(), rect)) return true;
  }
  return false;
}

/** How many layers are registered right now (test seam / diagnostics). */
export function overlayLayerCount(): number {
  return layers.size;
}
