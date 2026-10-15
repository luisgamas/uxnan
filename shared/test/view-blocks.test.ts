import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEW_BLOCK_TYPES,
  VIEW_MAX_BLOCKS,
  VIEW_MAX_BLOCKS_BYTES,
  parseViewBlocks,
} from '../src/index.js';

/** The parsed blocks, or a failed assertion carrying the validator's error. */
function ok(value: unknown) {
  const result = parseViewBlocks(value);
  if (!result.ok) assert.fail(`expected valid blocks, got: ${result.error}`);
  return result.blocks;
}

/** The validator's error for a value that must be rejected. */
function error(value: unknown): string {
  const result = parseViewBlocks(value);
  if (result.ok) assert.fail('expected the blocks to be rejected');
  return result.error;
}

test('VIEW_BLOCK_TYPES lists the ten block types and the limits are set', () => {
  assert.deepEqual(
    [...VIEW_BLOCK_TYPES],
    [
      'text',
      'stats',
      'bar-chart',
      'line-chart',
      'breakdown',
      'table',
      'list',
      'callout',
      'compare',
      'choices',
    ],
  );
  assert.equal(VIEW_MAX_BLOCKS, 16);
  assert.equal(VIEW_MAX_BLOCKS_BYTES, 64 * 1024);
});

test('a text block is valid and its text is trimmed', () => {
  assert.deepEqual(ok([{ type: 'text', text: '  Hello **world**  ' }]), [
    { type: 'text', text: 'Hello **world**' },
  ]);
  assert.match(error([{ type: 'text', text: '   ' }]), /^blocks\[0\]\.text must not be empty$/);
  assert.match(error([{ type: 'text' }]), /^blocks\[0\]\.text is required$/);
  assert.match(
    error([{ type: 'text', text: 'x'.repeat(4001) }]),
    /blocks\[0\]\.text must be at most 4000/,
  );
});

test('a stats block keeps string and numeric values, trims and drops unknown fields', () => {
  const [block] = ok([
    {
      type: 'stats',
      items: [
        {
          label: ' Revenue ',
          value: 1234.5,
          detail: ' +4% ',
          trend: 'up',
          tone: 'success',
          extra: 1,
        },
        { label: 'Status', value: 'Healthy' },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'stats',
    items: [
      { label: 'Revenue', value: 1234.5, detail: '+4%', trend: 'up', tone: 'success' },
      { label: 'Status', value: 'Healthy' },
    ],
  });
});

test('a stats block rejects bad values, trends and tones with the path', () => {
  assert.equal(
    error([{ type: 'stats', items: [{ label: 'a', value: true }] }]),
    'blocks[0].items[0].value must be a string or a finite number, got true',
  );
  assert.equal(
    error([{ type: 'stats', items: [{ label: 'a', value: Number.NaN }] }]),
    'blocks[0].items[0].value must be a finite number, got NaN',
  );
  assert.match(
    error([{ type: 'stats', items: [{ label: 'a', value: 1, trend: 'sideways' }] }]),
    /^blocks\[0\]\.items\[0\]\.trend must be one of: up, down, flat \(got "sideways"\)$/,
  );
  assert.match(
    error([{ type: 'stats', items: [{ label: 'a', value: 1, tone: 'accent-2' }] }]),
    /^blocks\[0\]\.items\[0\]\.tone must be one of: neutral, accent, success, warning, danger/,
  );
  assert.match(
    error([{ type: 'stats', items: Array.from({ length: 7 }, () => ({ label: 'a', value: 1 })) }]),
    /^blocks\[0\]\.items must have 1 to 6 items, got 7$/,
  );
});

test('a bar chart keeps baselines, highlights, sort and legend labels', () => {
  const [block] = ok([
    {
      type: 'bar-chart',
      title: 'Latency',
      unit: 'ms',
      sort: 'desc',
      baselineLabel: 'Before',
      valueLabel: 'After',
      better: 'lower',
      items: [
        { label: 'api', value: 120, baseline: 180, highlight: true },
        { label: 'db', value: -4 },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'bar-chart',
    title: 'Latency',
    unit: 'ms',
    sort: 'desc',
    baselineLabel: 'Before',
    valueLabel: 'After',
    better: 'lower',
    items: [
      { label: 'api', value: 120, baseline: 180, highlight: true },
      { label: 'db', value: -4 },
    ],
  });
});

test('a bar chart bounds its items and enums', () => {
  assert.match(
    error([{ type: 'bar-chart', items: [] }]),
    /^blocks\[0\]\.items must have 1 to 40 items, got 0$/,
  );
  assert.match(
    error([{ type: 'bar-chart', items: [{ label: 'a', value: Infinity }] }]),
    /^blocks\[0\]\.items\[0\]\.value must be a finite number/,
  );
  assert.match(
    error([{ type: 'bar-chart', sort: 'random', items: [{ label: 'a', value: 1 }] }]),
    /^blocks\[0\]\.sort must be one of: none, desc, asc/,
  );
  assert.match(
    error([{ type: 'bar-chart', unit: 'x'.repeat(13), items: [{ label: 'a', value: 1 }] }]),
    /^blocks\[0\]\.unit must be at most 12 characters, got 13$/,
  );
});

test('a line chart is valid when every series has one value per label', () => {
  const [block] = ok([
    {
      type: 'line-chart',
      unit: 'users',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Web', values: [1, null, 3] },
        { name: 'App', values: [0.5, 2, 2.5] },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'line-chart',
    unit: 'users',
    labels: ['Jan', 'Feb', 'Mar'],
    series: [
      { name: 'Web', values: [1, null, 3] },
      { name: 'App', values: [0.5, 2, 2.5] },
    ],
  });
});

test('a line chart rejects a series whose length differs from the labels', () => {
  const labels = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
  const values = Array.from({ length: 11 }, () => 1);
  assert.equal(
    error([
      {
        type: 'line-chart',
        labels,
        series: [
          { name: 'a', values: labels.map(() => 1) },
          { name: 'b', values },
        ],
      },
    ]),
    'blocks[0].series[1].values must have one value per label (12), got 11',
  );
});

test('a line chart rejects non-numeric values and out-of-range label counts', () => {
  assert.match(
    error([
      { type: 'line-chart', labels: ['a', 'b'], series: [{ name: 's', values: [1, 'two'] }] },
    ]),
    /^blocks\[0\]\.series\[0\]\.values\[1\] must be a finite number or null, got "two"$/,
  );
  assert.match(
    error([{ type: 'line-chart', labels: ['a'], series: [{ name: 's', values: [1] }] }]),
    /^blocks\[0\]\.labels must have 2 to 200 labels, got 1$/,
  );
  assert.match(
    error([
      {
        type: 'line-chart',
        labels: ['a', 'b'],
        series: [
          { name: 's', values: [1, 2] },
          ...Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, values: [1, 2] })),
        ],
      },
    ]),
    /^blocks\[0\]\.series must have 1 to 6 series, got 7$/,
  );
});

test('a breakdown is valid with non-negative parts that sum above zero', () => {
  const [block] = ok([
    {
      type: 'breakdown',
      title: 'Traffic',
      items: [
        { label: 'Search', value: 60 },
        { label: 'Direct', value: 40 },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'breakdown',
    title: 'Traffic',
    items: [
      { label: 'Search', value: 60 },
      { label: 'Direct', value: 40 },
    ],
  });
});

test('a breakdown rejects a sum of zero, negative parts and too few parts', () => {
  assert.equal(
    error([
      {
        type: 'breakdown',
        items: [
          { label: 'a', value: 0 },
          { label: 'b', value: 0 },
        ],
      },
    ]),
    'blocks[0].items values must sum to a finite number above 0',
  );
  assert.equal(
    error([
      {
        type: 'breakdown',
        items: [
          { label: 'a', value: -1 },
          { label: 'b', value: 3 },
        ],
      },
    ]),
    'blocks[0].items[0].value must be zero or more, got -1',
  );
  assert.match(
    error([{ type: 'breakdown', items: [{ label: 'a', value: 1 }] }]),
    /^blocks\[0\]\.items must have 2 to 6 items, got 1$/,
  );
});

test('a table is valid and keeps formats, null cells and a highlighted row', () => {
  const [block] = ok([
    {
      type: 'table',
      title: 'Plans',
      columns: [
        { label: 'Plan' },
        { label: 'Price', format: 'number' },
        { label: 'Share', format: 'percent' },
      ],
      rows: [
        [' Basic ', 9.5, 12],
        ['Pro', null, 48.25],
      ],
      highlightRow: 1,
    },
  ]);
  assert.deepEqual(block, {
    type: 'table',
    title: 'Plans',
    columns: [
      { label: 'Plan' },
      { label: 'Price', format: 'number' },
      { label: 'Share', format: 'percent' },
    ],
    rows: [
      ['Basic', 9.5, 12],
      ['Pro', null, 48.25],
    ],
    highlightRow: 1,
  });
});

test('a table rejects a row whose length differs from the columns', () => {
  assert.equal(
    error([
      {
        type: 'table',
        columns: [{ label: 'a' }, { label: 'b' }],
        rows: [['x', 1], ['y']],
      },
    ]),
    'blocks[0].rows[1] must have one value per column (2), got 1',
  );
});

test('a table rejects a highlight outside the rows and a non-integer index', () => {
  const table = (highlightRow: unknown) => [
    { type: 'table', columns: [{ label: 'a' }], rows: [['x'], ['y']], highlightRow },
  ];
  assert.equal(error(table(2)), 'blocks[0].highlightRow must be an integer from 0 to 1, got 2');
  assert.equal(error(table(-1)), 'blocks[0].highlightRow must be an integer from 0 to 1, got -1');
  assert.equal(error(table(0.5)), 'blocks[0].highlightRow must be an integer from 0 to 1, got 0.5');
  assert.equal(error(table('0')), 'blocks[0].highlightRow must be an integer from 0 to 1, got "0"');
  const [block] = ok(table(0));
  assert.equal(block?.type === 'table' ? block.highlightRow : undefined, 0);
});

test('a table rejects a cell that is neither text, a number nor null', () => {
  assert.equal(
    error([{ type: 'table', columns: [{ label: 'a' }], rows: [[{ x: 1 }]] }]),
    'blocks[0].rows[0][0] must be a string, a number or null, got object',
  );
});

test('a list is valid with its style and per-item status', () => {
  const [block] = ok([
    {
      type: 'list',
      style: 'steps',
      items: [
        { title: 'Plan', status: 'done' },
        { title: 'Build', detail: 'In progress', status: 'current' },
        { title: 'Ship' },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'list',
    style: 'steps',
    items: [
      { title: 'Plan', status: 'done' },
      { title: 'Build', detail: 'In progress', status: 'current' },
      { title: 'Ship' },
    ],
  });
  assert.match(
    error([{ type: 'list', items: [{ title: 'a', status: 'blocked' }] }]),
    /^blocks\[0\]\.items\[0\]\.status must be one of: done, current, pending, failed/,
  );
  assert.match(
    error([{ type: 'list', style: 'table', items: [{ title: 'a' }] }]),
    /^blocks\[0\]\.style must be one of: bullets, numbered, steps, checklist/,
  );
});

test('a callout keeps its tone and rejects an unknown one', () => {
  assert.deepEqual(ok([{ type: 'callout', text: ' Be careful. ' }]), [
    { type: 'callout', text: 'Be careful.' },
  ]);
  assert.deepEqual(ok([{ type: 'callout', tone: 'warning', title: 'Heads up', text: 'x' }]), [
    { type: 'callout', tone: 'warning', title: 'Heads up', text: 'x' },
  ]);
  assert.match(
    error([{ type: 'callout', tone: 'neutral', text: 'x' }]),
    /^blocks\[0\]\.tone must be one of: info, success, warning, danger/,
  );
});

test('compare needs two to four options and keeps the highlight flag', () => {
  const [block] = ok([
    {
      type: 'compare',
      options: [
        { title: 'A', subtitle: 'Cheap', points: [{ label: 'Cost', value: '$5' }] },
        { title: 'B', highlight: true, points: [{ label: 'Cost', value: '$9' }] },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'compare',
    options: [
      { title: 'A', subtitle: 'Cheap', points: [{ label: 'Cost', value: '$5' }] },
      { title: 'B', highlight: true, points: [{ label: 'Cost', value: '$9' }] },
    ],
  });
  assert.match(
    error([{ type: 'compare', options: [{ title: 'A', points: [{ label: 'x', value: 'y' }] }] }]),
    /^blocks\[0\]\.options must have 2 to 4 options, got 1$/,
  );
  assert.match(
    error([
      {
        type: 'compare',
        options: [
          { title: 'A', points: [] },
          { title: 'B', points: [{ label: 'x', value: 'y' }] },
        ],
      },
    ]),
    /^blocks\[0\]\.options\[0\]\.points must have 1 to 12 points, got 0$/,
  );
});

test('choices keep the message and default to the label when absent', () => {
  const [block] = ok([
    {
      type: 'choices',
      prompt: 'What next?',
      options: [
        { label: 'Compare plans', message: 'Compare the plans in detail' },
        { label: 'Stop' },
      ],
    },
  ]);
  assert.deepEqual(block, {
    type: 'choices',
    prompt: 'What next?',
    options: [
      { label: 'Compare plans', message: 'Compare the plans in detail' },
      { label: 'Stop' },
    ],
  });
  assert.match(
    error([{ type: 'choices', options: [{ label: 'x'.repeat(81) }] }]),
    /^blocks\[0\]\.options\[0\]\.label must be at most 80 characters, got 81$/,
  );
});

test('every block type is accepted in one view', () => {
  const blocks = [
    { type: 'text', text: 'Intro' },
    { type: 'stats', items: [{ label: 'a', value: 1 }] },
    { type: 'bar-chart', items: [{ label: 'a', value: 1 }] },
    { type: 'line-chart', labels: ['x', 'y'], series: [{ name: 's', values: [1, 2] }] },
    {
      type: 'breakdown',
      items: [
        { label: 'a', value: 1 },
        { label: 'b', value: 2 },
      ],
    },
    { type: 'table', columns: [{ label: 'a' }], rows: [['x']] },
    { type: 'list', items: [{ title: 'a' }] },
    { type: 'callout', text: 'Note' },
    {
      type: 'compare',
      options: [
        { title: 'a', points: [{ label: 'x', value: 'y' }] },
        { title: 'b', points: [{ label: 'x', value: 'z' }] },
      ],
    },
    { type: 'choices', options: [{ label: 'Go' }] },
  ];
  const parsed = ok(blocks);
  assert.deepEqual(
    parsed.map((block) => block.type),
    [...VIEW_BLOCK_TYPES],
  );
});

test('the blocks argument must be a non-empty array of at most sixteen blocks', () => {
  assert.equal(error({ type: 'text', text: 'x' }), 'blocks must be an array of blocks');
  assert.equal(error([]), 'blocks must have 1 to 16 blocks, got 0');
  assert.equal(
    error(Array.from({ length: 17 }, () => ({ type: 'text', text: 'x' }))),
    'blocks must have 1 to 16 blocks, got 17',
  );
});

test('an unknown or missing block type is rejected with the allowed list', () => {
  assert.equal(
    error([{ type: 'pie', text: 'x' }]),
    'blocks[0].type must be one of: text, stats, bar-chart, line-chart, breakdown, table, list, callout, compare, choices (got "pie")',
  );
  assert.match(
    error([{ type: 'text', text: 'ok' }, { text: 'no type' }]),
    /^blocks\[1\]\.type must be one of: text, stats, .* \(got nothing\)$/,
  );
  assert.equal(error(['text']), 'blocks[0] must be an object, got "text"');
});

test('the blocks are rejected above the byte limit as a whole', () => {
  // Each block is 4000 two-byte characters: eight fit under 64 KiB, nine do not.
  const block = { type: 'text', text: 'é'.repeat(4000) };
  assert.equal(ok(Array.from({ length: 8 }, () => block)).length, 8);
  assert.match(
    error(Array.from({ length: 9 }, () => block)),
    /^blocks are \d{5} bytes of JSON; the limit is 65536 bytes$/,
  );
});

test('blank optional fields are left out rather than kept as empty strings', () => {
  const [block] = ok([
    { type: 'bar-chart', title: '   ', unit: '', items: [{ label: 'a', value: 1, baseline: 0 }] },
  ]);
  assert.deepEqual(block, { type: 'bar-chart', items: [{ label: 'a', value: 1, baseline: 0 }] });
});

test('a value that is not plain JSON is rejected, not thrown', () => {
  const cyclic: Record<string, unknown> = { type: 'text', text: 'x' };
  cyclic['self'] = cyclic;
  assert.equal(error([cyclic]), 'blocks must be plain JSON data');
});

test('a value that is neither a string nor a valid number is reported at its path', () => {
  assert.equal(error([{ type: 'text', text: 42 }]), 'blocks[0].text must be a string, got 42');
});

test('a text block refuses Markdown it would show raw, naming the block to use', () => {
  const table = parseViewBlocks([
    { type: 'text', text: 'Plans:\n| Plan | Price |\n|---|---|\n| A | 5 |' },
  ]);
  assert.equal(table.ok, false);
  if (!table.ok) assert.match(table.error, /blocks\[0\]\.text has a Markdown table.*table block/);
  const heading = parseViewBlocks([{ type: 'text', text: '## Summary\nAll good.' }]);
  assert.equal(heading.ok, false);
  if (!heading.ok) assert.match(heading.error, /Markdown heading/);
  // A pipe or a hash in prose is fine.
  assert.equal(parseViewBlocks([{ type: 'text', text: 'Use a | b, see PR #357.' }]).ok, true);
});
