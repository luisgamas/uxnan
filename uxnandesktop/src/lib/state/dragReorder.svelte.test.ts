/**
 * Starting a drag on a row that is itself a control.
 *
 * Reported from the app: project cards could not be reordered by hand. Their
 * identity region — the icon and the name, which is the whole card — is a
 * `<button>` so the keyboard can reach it, and the gesture refuses to start on
 * a control. So pressing anywhere a user would press did nothing, while the
 * worktree rows underneath (a plain `div`) dragged fine.
 *
 * The events are dispatched for real rather than hand-built: what decides the
 * outcome is `event.target`, which only a dispatched event has.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createDragReorder } from './dragReorder.svelte';

/** A row as the sidebar builds one: the drag host, with a control inside it. */
function row(handle: boolean) {
  const host = document.createElement('div');
  host.setAttribute('data-drag-key', 'a');
  host.setAttribute('data-drag-index', '0');
  host.setPointerCapture = () => {};
  host.releasePointerCapture = () => {};
  const control = document.createElement('button');
  if (handle) control.setAttribute('data-drag-handle', '');
  const label = document.createElement('span');
  control.appendChild(label);
  host.appendChild(control);
  document.body.appendChild(host);

  const drag = createDragReorder({ keys: () => ['a', 'b'], onCommit: () => {} });
  host.addEventListener('pointerdown', (e) => drag.pointerDown(e as PointerEvent, 'a'));
  host.addEventListener('pointermove', (e) => drag.pointerMove(e as PointerEvent));
  return { host, control, label, drag };
}

const pointer = (type: string, y: number) =>
  new PointerEvent(type, { button: 0, pointerId: 1, clientX: 10, clientY: y, bubbles: true });

// jsdom has no hit-testing; the drop slot is resolved from it and is not what
// these tests are about. Answering "nothing under the pointer" keeps the
// gesture's own state machine — the part being tested — running normally.
document.elementFromPoint ??= () => null;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createDragReorder', () => {
  it('starts on a control that is marked as the row handle', () => {
    // Pressed on the label *inside* the button — where a user actually presses.
    const { host, label, drag } = row(true);

    label.dispatchEvent(pointer('pointerdown', 10));
    host.dispatchEvent(pointer('pointermove', 60));

    expect(drag.draggingKey).toBe('a');
  });

  it('still refuses to start on an ordinary control', () => {
    // The reason the rule exists at all: a row's action buttons must keep
    // working as buttons instead of becoming drag targets.
    const { host, control, drag } = row(false);

    control.dispatchEvent(pointer('pointerdown', 10));
    host.dispatchEvent(pointer('pointermove', 60));

    expect(drag.draggingKey).toBeNull();
  });
});
