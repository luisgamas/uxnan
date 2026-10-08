import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEW_ANNOTATION_LIMITS,
  VIEW_DEFAULT_HEIGHT,
  VIEW_MAX_HEIGHT,
  VIEW_MIN_HEIGHT,
  clampViewHeight,
  formatViewAnnotations,
  isViewAnnotation,
  isViewId,
  isViewToolName,
  viewIdInOutput,
} from '../src/index.js';

const ID = '0123456789abcdef0123456789abcdef';

test('isViewId takes 32 lowercase hex characters only', () => {
  assert.equal(isViewId(ID), true);
  assert.equal(isViewId(ID.toUpperCase()), false);
  assert.equal(isViewId(ID.slice(1)), false);
  assert.equal(isViewId(`../${ID}`), false);
  assert.equal(isViewId(42), false);
});

test('viewIdInOutput finds the marker anywhere in a tool answer', () => {
  assert.equal(viewIdInOutput(`Shown inline. uxnan-view:${ID}`), ID);
  assert.equal(viewIdInOutput(`[{"type":"text","text":"uxnan-view:${ID}"}]`), ID);
  assert.equal(viewIdInOutput('uxnan-view:nothex'), undefined);
  assert.equal(viewIdInOutput(''), undefined);
});

test('isViewToolName recognizes every way an agent spells the tool', () => {
  for (const name of [
    'view_show',
    'mcp__uxnan__view_show',
    'uxnan_view_show',
    'uxnan.view_show',
    'uxnan/view_show',
    'uxnan: view_show',
  ]) {
    assert.equal(isViewToolName(name), true, name);
  }
  for (const name of ['mcp__uxnan-browser__browser_open', 'show_view', 'preview_show', 'Read']) {
    assert.equal(isViewToolName(name), false, name);
  }
});

test('clampViewHeight keeps a height inside the inline range', () => {
  assert.equal(clampViewHeight(10), VIEW_MIN_HEIGHT);
  assert.equal(clampViewHeight(99999), VIEW_MAX_HEIGHT);
  assert.equal(clampViewHeight(300.6), 301);
  assert.equal(clampViewHeight(Number.NaN), VIEW_DEFAULT_HEIGHT);
});

test('isViewAnnotation accepts a bounded description and rejects the rest', () => {
  const ok = {
    selector: 'main > button',
    tag: 'button',
    text: 'Save',
    rect: { x: 1, y: 2, width: 3, height: 4 },
  };
  assert.equal(isViewAnnotation(ok), true);
  assert.equal(isViewAnnotation({ ...ok, selector: '' }), false);
  assert.equal(isViewAnnotation({ ...ok, tag: 'Button<script>' }), false);
  assert.equal(
    isViewAnnotation({ ...ok, text: 'x'.repeat(VIEW_ANNOTATION_LIMITS.text + 1) }),
    false,
  );
  assert.equal(isViewAnnotation({ ...ok, rect: { x: 1, y: 2, width: 3 } }), false);
  assert.equal(isViewAnnotation(null), false);
});

test('formatViewAnnotations writes one readable entry per element', () => {
  const text = formatViewAnnotations('Usage', [
    {
      annotation: {
        selector: '#total',
        tag: 'td',
        text: ' 42\n units ',
        rect: { x: 0, y: 0, width: 1, height: 1 },
      },
      note: ' should be bold ',
    },
    {
      annotation: { selector: 'svg', tag: 'svg', rect: { x: 0, y: 0, width: 1, height: 1 } },
      note: '',
    },
  ]);
  assert.equal(
    text,
    'On the view "Usage":\n\n1. `#total` (<td>)\n   Text:  42 units \n   Note: should be bold\n\n2. `svg` (<svg>)',
  );
});
