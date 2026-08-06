import { describe, expect, it } from 'vitest';
import { overlayCovers, overlayLayerCount, rectsOverlap, registerOverlay } from './overlayLayer';

/** A fake layer element: only `getBoundingClientRect` is ever read. */
function layer(
  rect: Partial<DOMRect> & { left: number; top: number; right: number; bottom: number },
) {
  return { getBoundingClientRect: () => rect as DOMRect } as unknown as Element;
}

const SLOT = { left: 800, top: 100, right: 1200, bottom: 700 };

describe('rectsOverlap', () => {
  it('is true for boxes that share area', () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 5, top: 5, right: 15, bottom: 15 },
      ),
    ).toBe(true);
  });

  it('is false for disjoint boxes', () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 20, top: 0, right: 30, bottom: 10 },
      ),
    ).toBe(false);
  });

  it('treats touching edges as no overlap', () => {
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 10, top: 0, right: 20, bottom: 10 },
      ),
    ).toBe(false);
  });

  it('ignores zero-area rects (a layer mid-teardown must not pin the browser hidden)', () => {
    expect(
      rectsOverlap(
        { left: 5, top: 5, right: 5, bottom: 5 },
        { left: 0, top: 0, right: 10, bottom: 10 },
      ),
    ).toBe(false);
    expect(
      rectsOverlap(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 5, top: 5, right: 5, bottom: 15 },
      ),
    ).toBe(false);
  });
});

describe('overlay registry', () => {
  it('reports nothing while no layer is open', () => {
    expect(overlayLayerCount()).toBe(0);
    expect(overlayCovers(SLOT)).toBe(false);
  });

  it('a modal scrim (full viewport) covers the browser slot', () => {
    const off = registerOverlay(layer({ left: 0, top: 0, right: 1600, bottom: 900 }));
    expect(overlayCovers(SLOT)).toBe(true);
    off();
    expect(overlayCovers(SLOT)).toBe(false);
  });

  it('a menu that does not reach the slot leaves the page visible', () => {
    const off = registerOverlay(layer({ left: 10, top: 200, right: 260, bottom: 420 }));
    expect(overlayLayerCount()).toBe(1);
    expect(overlayCovers(SLOT)).toBe(false);
    off();
  });

  it('a menu that spills over the slot covers it', () => {
    const off = registerOverlay(layer({ left: 700, top: 90, right: 900, bottom: 300 }));
    expect(overlayCovers(SLOT)).toBe(true);
    off();
  });

  it('only clears once every layer is gone (nested menus)', () => {
    const offOuter = registerOverlay(layer({ left: 0, top: 0, right: 1600, bottom: 900 }));
    const offInner = registerOverlay(layer({ left: 900, top: 200, right: 1100, bottom: 400 }));
    expect(overlayLayerCount()).toBe(2);
    offOuter();
    expect(overlayCovers(SLOT)).toBe(true);
    offInner();
    expect(overlayCovers(SLOT)).toBe(false);
    expect(overlayLayerCount()).toBe(0);
  });

  it('unregistering twice is harmless, and a null ref registers nothing', () => {
    const off = registerOverlay(layer({ left: 0, top: 0, right: 1600, bottom: 900 }));
    off();
    off();
    expect(overlayLayerCount()).toBe(0);
    registerOverlay(null)();
    expect(overlayLayerCount()).toBe(0);
  });
});
