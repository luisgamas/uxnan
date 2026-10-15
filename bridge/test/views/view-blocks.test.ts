import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewBlocks, type ViewBlock } from '@uxnan/shared';
import {
  compactNumber,
  escapeHtml,
  formatNumber,
  niceTicks,
} from '../../src/views/blocks/format.js';
import { VIEW_BLOCKS_CSS } from '../../src/views/blocks/blocks-css.js';
import { VIEW_BLOCKS_SCRIPT } from '../../src/views/blocks/blocks-script.js';
import { renderViewBlocks } from '../../src/views/blocks/render-blocks.js';

/** Validates raw input through the shared contract, then renders it. */
function render(raw: unknown): { html: string; height: number } {
  const parsed = parseViewBlocks(raw);
  if (!parsed.ok) assert.fail(`the contract rejected the test input: ${parsed.error}`);
  return renderViewBlocks(parsed.blocks);
}

/** Renders one block, returning the body only (the page wrapper is tested apart). */
function body(block: unknown): string {
  const { html } = render([block]);
  const start = html.indexOf('<div class="ux-blocks">');
  const end = html.indexOf('<script>');
  return html.slice(start, end);
}

/** The number of occurrences of a substring. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('escapeHtml neutralises markup in every context', () => {
  assert.equal(escapeHtml(`a & <b> "c" 'd'`), 'a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;');
});

test('an agent label with markup never reaches the page unescaped', () => {
  const html = body({
    type: 'bar-chart',
    items: [{ label: '<img src=x onerror=alert(1)>', value: 3 }],
  });
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  const table = body({
    type: 'table',
    columns: [{ label: '"><script>x</script>' }],
    rows: [['<svg onload=alert(1)>']],
  });
  assert.equal(table.includes('<script>x'), false);
  assert.equal(table.includes('<svg'), false);
});

test('an attribute value cannot break out of its quotes', () => {
  const html = body({
    type: 'choices',
    options: [{ label: 'Go', message: '" onclick="alert(1)' }],
  });
  assert.equal(html.includes('onclick="alert'), false);
  assert.ok(html.includes('data-message="&quot; onclick=&quot;alert(1)"'));
});

test('formatNumber groups thousands, limits decimals and never prints -0 or NaN', () => {
  assert.equal(formatNumber(1234.5), '1,234.5');
  assert.equal(formatNumber(1234.567), '1,234.57');
  assert.equal(formatNumber(1234.567, 0), '1,235');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(-0.001), '0');
  assert.equal(formatNumber(Number.NaN), '—');
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), '—');
});

test('compactNumber gives the short axis forms', () => {
  assert.equal(compactNumber(0), '0');
  assert.equal(compactNumber(950), '950');
  assert.equal(compactNumber(1200), '1.2K');
  assert.equal(compactNumber(12000), '12K');
  assert.equal(compactNumber(1500000), '1.5M');
  assert.equal(compactNumber(2000000000), '2B');
  assert.equal(compactNumber(-2500), '-2.5K');
});

test('niceTicks cover the range with evenly spaced nice steps and include zero', () => {
  assert.deepEqual(niceTicks(0, 100), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(0, 1), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(niceTicks(120, 480), [0, 200, 400, 600]);
  assert.deepEqual(niceTicks(0, 0), [0, 0.25, 0.5, 0.75, 1]);
  const negative = niceTicks(-12, 30);
  assert.equal(negative[0]! <= -12 && negative.at(-1)! >= 30, true);
  assert.ok(negative.includes(0));
  for (const ticks of [niceTicks(3, 7), niceTicks(-4, -1), niceTicks(0.002, 0.0031, 3)]) {
    const steps = ticks.slice(1).map((tick, i) => Number((tick - ticks[i]!).toPrecision(9)));
    assert.ok(
      steps.every((step) => step === steps[0]),
      `evenly spaced: ${ticks}`,
    );
    assert.ok(ticks.every((tick) => Number.isFinite(tick)));
  }
});

test('text blocks render paragraphs with bold and code, and escape everything else', () => {
  const html = body({
    type: 'text',
    text: 'First **bold** and `api/x` <i>.\n\nSecond paragraph.',
  });
  assert.equal(count(html, '<p>'), 2);
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<code>api/x</code>'));
  assert.ok(html.includes('&lt;i&gt;'));
});

test('a stats block renders one tile per item with its trend colour and accent dot', () => {
  const html = body({
    type: 'stats',
    items: [
      { label: 'Revenue', value: 48210, trend: 'up', detail: '+12%' },
      { label: 'Churn', value: '3.4%', trend: 'down', tone: 'warning' },
      { label: 'Latency', value: '182 ms', tone: 'accent' },
    ],
  });
  assert.equal(html.match(/<div class="ux-stat">/g)?.length, 3);
  // The accent is a dot before the label, never an edge.
  assert.equal(count(html, 'class="ux-stat-dot"'), 1);
  assert.equal(html.includes('ux-stat-accent'), false);
  assert.ok(html.includes('class="ux-trend ux-c-success"'));
  // A tone wins over the trend for the arrow colour.
  assert.ok(html.includes('class="ux-trend ux-c-warning"'));
  assert.ok(html.includes('data-num="48210"'));
  assert.ok(html.includes('>48,210<'));
});

test('a bar chart draws one value bar per item, widths from the largest value', () => {
  const html = body({
    type: 'bar-chart',
    title: 'Sales',
    items: [
      { label: 'A', value: 50 },
      { label: 'B', value: 100 },
    ],
  });
  assert.equal(count(html, 'class="ux-bar ux-bar-accent"'), 2);
  assert.ok(html.includes('width:50%'));
  assert.ok(html.includes('width:100%'));
  assert.ok(html.includes('<h3 class="ux-title">Sales</h3>'));
});

test('a bar chart with negative values draws a zero line and bars growing left', () => {
  const html = body({
    type: 'bar-chart',
    items: [
      { label: 'down', value: -50 },
      { label: 'up', value: 50 },
    ],
  });
  assert.ok(html.includes('class="ux-zero"'));
  assert.ok(html.includes('border-radius:3px 0 0 3px'));
  assert.ok(html.includes('border-radius:0 3px 3px 0'));
  assert.equal(html.includes('NaN'), false);
});

test('a bar chart whose values are all zero still renders without NaN widths', () => {
  const html = body({ type: 'bar-chart', items: [{ label: 'a', value: 0 }] });
  assert.ok(html.includes('width:0%'));
  assert.equal(html.includes('NaN'), false);
  assert.equal(html.includes('Infinity'), false);
});

test('highlighting mutes the rest of the bars; without highlight all bars are accent', () => {
  const highlighted = body({
    type: 'bar-chart',
    items: [
      { label: 'a', value: 1, highlight: true },
      { label: 'b', value: 2 },
    ],
  });
  assert.equal(count(highlighted, 'ux-bar-accent'), 1);
  assert.equal(count(highlighted, 'ux-bar-muted'), 1);
  const plain = body({
    type: 'bar-chart',
    items: [
      { label: 'a', value: 1 },
      { label: 'b', value: 2 },
    ],
  });
  assert.equal(plain.includes('ux-bar-muted'), false);
});

test('a baseline adds the legend, a thin baseline bar and the old-to-new value', () => {
  const html = body({
    type: 'bar-chart',
    unit: 'ms',
    better: 'lower',
    baselineLabel: 'Antes',
    valueLabel: 'Después',
    items: [{ label: 'api', value: 120, baseline: 180 }],
  });
  assert.ok(html.includes('class="ux-legend"'));
  assert.ok(html.includes('>Antes<'));
  assert.ok(html.includes('>Después<'));
  assert.equal(count(html, 'class="ux-bar ux-bar-base"'), 1);
  assert.ok(html.includes('>180</span> → <span'));
  assert.ok(html.includes('>120 ms</span>'));
  // A drop with better=lower is an improvement: success colour, signed change.
  assert.ok(html.includes('ux-delta ux-c-success'));
  assert.ok(html.includes('data-num="-33.3"'));
  assert.ok(html.includes('data-prefix="+"') === false);
});

test('a baseline without a direction keeps the change muted, and a worse change is danger', () => {
  const unset = body({
    type: 'bar-chart',
    items: [{ label: 'x', value: 200, baseline: 100 }],
  });
  assert.ok(unset.includes('ux-delta ux-c-muted'));
  const worse = body({
    type: 'bar-chart',
    better: 'lower',
    items: [{ label: 'x', value: 200, baseline: 100 }],
  });
  assert.ok(worse.includes('ux-delta ux-c-danger'));
  assert.ok(worse.includes('data-prefix="+"'));
});

test('a line chart draws one path per series and breaks it at null', () => {
  const html = body({
    type: 'line-chart',
    labels: ['a', 'b', 'c', 'd'],
    series: [{ name: 'one', values: [1, null, 3, 4] }],
  });
  const paths = html.match(/<path class="ux-line" d="([^"]*)"/g) ?? [];
  assert.equal(paths.length, 1);
  // Two runs: a lone point at index 0 and a run from index 2 to 3.
  assert.equal(count(paths[0]!, 'M'), 2);
  assert.ok(paths[0]!.includes(' h0.01'));
  // A single series is also drawn as an area (one per series, all runs in it).
  assert.equal(count(html, 'class="ux-area"'), 1);
});

test('a multi-series line chart has a legend and one colour per series', () => {
  const html = body({
    type: 'line-chart',
    labels: ['a', 'b'],
    series: [
      { name: 'one', values: [1, 2] },
      { name: 'two', values: [2, 1] },
    ],
  });
  assert.ok(html.includes('class="ux-legend"'));
  assert.ok(html.includes('stroke:var(--color-chart-1)'));
  assert.ok(html.includes('stroke:var(--color-chart-2)'));
  assert.equal(count(html, 'class="ux-dot"'), 2);
  assert.equal(html.includes('class="ux-area"'), false);
});

test('a line chart shows at most six x labels, always the first and the last', () => {
  const labels = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
  const html = body({
    type: 'line-chart',
    labels,
    series: [{ name: 's', values: labels.map((_, i) => i) }],
  });
  assert.equal(count(html, 'class="ux-xl'), 6);
  assert.ok(html.includes('class="ux-xl ux-xl-first"'));
  assert.ok(html.includes('class="ux-xl ux-xl-last"'));
  assert.ok(html.includes('>M12<'));
});

test('a line chart carries its data for the hover script as an escaped attribute', () => {
  const html = body({
    type: 'line-chart',
    unit: 'ms',
    labels: ['a', 'b'],
    series: [{ name: 'x"y', values: [1, null] }],
  });
  assert.ok(html.includes('data-series="'));
  assert.equal(html.includes('"x"y"'), false);
  const match = /data-series="([^"]*)"/.exec(html);
  assert.ok(match);
  const data = JSON.parse(match[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'")) as {
    labels: string[];
    series: { name: string; values: (number | null)[] }[];
  };
  assert.deepEqual(data.labels, ['a', 'b']);
  assert.equal(data.series[0]?.name, 'x"y');
  assert.deepEqual(data.series[0]?.values, [1, null]);
});

test('a breakdown draws one segment per part with rounded whole percentages', () => {
  const html = body({
    type: 'breakdown',
    items: [
      { label: 'Search', value: 2 },
      { label: 'Direct', value: 1 },
      { label: 'Social', value: 1 },
    ],
  });
  assert.equal(count(html, 'class="ux-seg"'), 3);
  assert.equal(count(html, 'class="ux-breakdown-row"'), 3);
  assert.ok(html.includes('>50%<'));
  assert.ok(html.includes('>25%<'));
  assert.equal(html.includes('NaN'), false);
});

test('a table highlights its row and right-aligns number columns with null cells dashed', () => {
  const html = body({
    type: 'table',
    columns: [
      { label: 'Plan' },
      { label: 'Price', format: 'number' },
      { label: 'Share', format: 'percent' },
    ],
    rows: [
      ['Free', 0, 10],
      ['Pro', null, 90.5],
    ],
    highlightRow: 1,
  });
  // The header row plus the one plain body row.
  assert.equal(count(html, '<tr>'), 2);
  assert.equal(count(html, '<tr class="ux-hl">'), 1);
  assert.equal(count(html, '<th class="ux-num">'), 2);
  assert.ok(html.includes('<span class="ux-na">—</span>'));
  assert.ok(html.includes('>90.5%<'));
  assert.ok(html.includes('class="ux-table-wrap"'));
});

test('a steps list draws markers with their status and a connector between them', () => {
  const html = body({
    type: 'list',
    style: 'steps',
    items: [
      { title: 'One', status: 'done' },
      { title: 'Two', status: 'current' },
      { title: 'Three' },
      { title: 'Four', status: 'failed' },
    ],
  });
  assert.equal(count(html, 'class="ux-step"'), 4);
  assert.ok(html.includes('ux-m-done'));
  assert.ok(html.includes('ux-m-current'));
  assert.ok(html.includes('ux-m-pending'));
  assert.ok(html.includes('ux-m-failed'));
  assert.ok(html.includes('<ol class="ux-steps">'));
});

test('a checklist has markers but no rail, and bullets and numbers use plain lists', () => {
  const checklist = body({ type: 'list', style: 'checklist', items: [{ title: 'a' }] });
  assert.ok(checklist.includes('<ul class="ux-checks">'));
  assert.equal(checklist.includes('ux-steps'), false);
  const bullets = body({ type: 'list', items: [{ title: 'a', detail: 'why' }] });
  assert.ok(bullets.includes('<ul class="ux-list">'));
  assert.ok(bullets.includes('ux-item-detail'));
  const numbered = body({ type: 'list', style: 'numbered', items: [{ title: 'a' }] });
  assert.ok(numbered.includes('<ol class="ux-list">'));
});

test('a callout carries a tone glyph before its title and no edge accent', () => {
  const html = body({ type: 'callout', tone: 'danger', title: 'Stop', text: 'Do not deploy' });
  assert.ok(html.includes('ux-callout-danger'));
  assert.ok(html.includes('ux-callout-title'));
  assert.ok(html.includes('class="ux-glyph ux-callout-icon"'));
  // The icon is the first child: it sits at the start of the title row.
  assert.ok(html.indexOf('ux-callout-icon') < html.indexOf('ux-callout-title'));
  const defaults = body({ type: 'callout', text: 'Note' });
  assert.ok(defaults.includes('ux-callout-info'));
  assert.ok(defaults.includes('<circle'));
  // Without a title the icon and the text share the first row.
  assert.equal(defaults.includes('ux-callout-title'), false);
  for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
    assert.equal(count(body({ type: 'callout', tone, text: 'x' }), '<svg'), 1, tone);
  }
});

test('a compare block marks the highlighted option with a stronger border and a check', () => {
  const html = body({
    type: 'compare',
    options: [
      { title: 'A', points: [{ label: 'x', value: '1' }] },
      { title: 'B', highlight: true, points: [{ label: 'x', value: '2' }] },
    ],
  });
  assert.equal(count(html, '<article class="ux-card'), 2);
  assert.equal(count(html, 'ux-card-hl'), 1);
  // One check, on the highlighted card only, and no words of its own.
  assert.equal(count(html, 'class="ux-glyph ux-card-check"'), 1);
  assert.equal(count(html, '<dt>x</dt>'), 2);
  assert.equal(count(html, 'class="ux-point"'), 2);
});

test('choices render a button per option carrying the message or the label', () => {
  const html = body({
    type: 'choices',
    prompt: 'Next?',
    options: [{ label: 'Compare', message: 'Compare the plans' }, { label: 'Stop' }],
  });
  assert.equal(count(html, 'class="ux-choice"'), 2);
  assert.ok(html.includes('data-message="Compare the plans"'));
  assert.ok(html.includes('data-message="Stop"'));
  assert.ok(html.includes('>Next?<'));
});

test('the page is one complete document with the stylesheet and the script', () => {
  const { html } = render([{ type: 'text', text: 'hi' }]);
  assert.ok(html.startsWith('<html><head><style>'));
  assert.ok(html.endsWith('</script></body></html>'));
  assert.ok(html.includes(VIEW_BLOCKS_CSS));
  assert.ok(html.includes(VIEW_BLOCKS_SCRIPT));
});

test('the height estimate is clamped and grows with the content', () => {
  const short = render([{ type: 'callout', text: 'x' }]).height;
  assert.ok(short >= 80 && short <= 1600);
  const long = render(
    Array.from({ length: 16 }, () => ({
      type: 'table',
      columns: [{ label: 'a' }],
      rows: Array.from({ length: 200 }, () => ['x']),
    })),
  ).height;
  assert.equal(long, 1600);
  assert.ok(short < long);
});

test('no rendered page carries NaN, Infinity or a literal colour', () => {
  const blocks: unknown[] = [
    { type: 'text', text: 'Hi' },
    { type: 'stats', items: [{ label: 'a', value: 0, trend: 'flat' }] },
    { type: 'bar-chart', better: 'higher', items: [{ label: 'a', value: 0, baseline: 0 }] },
    { type: 'line-chart', labels: ['a', 'b'], series: [{ name: 's', values: [0, null] }] },
    {
      type: 'breakdown',
      items: [
        { label: 'a', value: 0 },
        { label: 'b', value: 1 },
      ],
    },
    { type: 'table', columns: [{ label: 'a', format: 'number' }], rows: [[0]] },
    { type: 'list', items: [{ title: 'a' }] },
    { type: 'callout', text: 'x' },
    {
      type: 'compare',
      options: [
        { title: 'a', points: [{ label: 'x', value: 'y' }] },
        { title: 'b', points: [{ label: 'x', value: 'y' }] },
      ],
    },
    { type: 'choices', options: [{ label: 'a' }] },
  ];
  const { html } = render(blocks);
  assert.equal(html.includes('NaN'), false);
  assert.equal(html.includes('Infinity'), false);
});

test('the stylesheet uses theme variables only, no literal colour', () => {
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(VIEW_BLOCKS_CSS), false);
  assert.equal(/\b(rgb|rgba|hsl|hsla)\(/i.test(VIEW_BLOCKS_CSS), false);
  assert.ok(VIEW_BLOCKS_CSS.includes('var(--color-chart-1)'));
});

test('the stylesheet has no edge stripes and no inset shadow', () => {
  // A border thicker than 1px on any edge is the generic "accent stripe".
  assert.equal(/border-(left|right|top|bottom)(-width)?:\s*[2-9]/.test(VIEW_BLOCKS_CSS), false);
  assert.equal(/box-shadow:\s*inset/i.test(VIEW_BLOCKS_CSS), false);
  // The only one-edge borders are neutral hairlines (the stats cells draw
  // their separators with a left and a top one).
  const hairline = 'color-mix\\(in srgb, var\\(--color-border-primary\\) 70%, transparent\\)';
  const edges = VIEW_BLOCKS_CSS.match(/border-(top|bottom|left|right)\s*:[^;}]*/g) ?? [];
  assert.ok(edges.length > 0);
  for (const edge of edges) {
    assert.match(
      edge,
      new RegExp(
        `^border-(top|bottom|left|right):\\s*(0|1px solid (${hairline}|var\\(--color-chart-grid\\)))$`,
      ),
    );
  }
});

test('the stylesheet keeps to the neutral language: no gradients, no uppercase, no blue tints', () => {
  assert.equal(/gradient\(/i.test(VIEW_BLOCKS_CSS), false);
  assert.equal(/text-transform\s*:\s*uppercase/i.test(VIEW_BLOCKS_CSS), false);
  // Highlights are the neutral text tint, never a chart-colour wash.
  assert.equal(
    /background:\s*color-mix\(in srgb, var\(--color-chart-1\)/.test(VIEW_BLOCKS_CSS),
    false,
  );
  // Only the floating tooltip carries a box shadow.
  const shadows = VIEW_BLOCKS_CSS.match(/box-shadow:[^;}]*/g) ?? [];
  assert.equal(shadows.length, 1);
  assert.ok(VIEW_BLOCKS_CSS.includes('.ux-tip{'));
});

test('the stats block is one hairline frame whose cells draw the separators', () => {
  // Each cell draws its own left and top hairline and is pulled 1px over the
  // frame, which clips the outer ones: separators survive any wrap or count.
  assert.match(VIEW_BLOCKS_CSS, /\.ux-stat\{[^}]*margin:-1px 0 0 -1px/);
});

test('the script is strict, listens for the locale event and wires the choices', () => {
  assert.ok(VIEW_BLOCKS_SCRIPT.includes("'use strict'"));
  assert.ok(VIEW_BLOCKS_SCRIPT.includes('uxnan-theme'));
  assert.ok(
    VIEW_BLOCKS_SCRIPT.includes('window.uxnan.sendMessage') ||
      VIEW_BLOCKS_SCRIPT.includes('window.uxnan &&'),
  );
});

test('every block type renders in one view', () => {
  const types: ViewBlock['type'][] = [
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
  ];
  const raw = [
    { type: 'text', text: 'a' },
    { type: 'stats', items: [{ label: 'a', value: 1 }] },
    { type: 'bar-chart', items: [{ label: 'a', value: 1 }] },
    { type: 'line-chart', labels: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] },
    {
      type: 'breakdown',
      items: [
        { label: 'a', value: 1 },
        { label: 'b', value: 1 },
      ],
    },
    { type: 'table', columns: [{ label: 'a' }], rows: [['x']] },
    { type: 'list', items: [{ title: 'a' }] },
    { type: 'callout', text: 'x' },
    {
      type: 'compare',
      options: [
        { title: 'a', points: [{ label: 'x', value: 'y' }] },
        { title: 'b', points: [{ label: 'x', value: 'y' }] },
      ],
    },
    { type: 'choices', options: [{ label: 'a' }] },
  ];
  const { html } = render(raw);
  for (const type of types) {
    const cls =
      type === 'text'
        ? 'ux-text'
        : `ux-${type === 'table' ? 'table-block' : type === 'list' ? 'list-block' : type}`;
    assert.ok(html.includes(cls), `missing ${cls}`);
  }
});

test('a baseline without labels writes no words of its own', () => {
  const html = body({
    type: 'bar-chart',
    items: [{ label: 'api', value: 120, baseline: 180 }],
  });
  assert.equal(html.includes('class="ux-legend"'), false);
  assert.equal(/Before|After/.test(html), false);
  assert.equal(/Before|After/.test(VIEW_BLOCKS_SCRIPT), false);
});
