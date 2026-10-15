import type {
  ViewBarChartBlock,
  ViewBlock,
  ViewBreakdownBlock,
  ViewCalloutBlock,
  ViewChoicesBlock,
  ViewCompareBlock,
  ViewLineChartBlock,
  ViewListBlock,
  ViewListItem,
  ViewStatItem,
  ViewStatsBlock,
  ViewTableBlock,
  ViewTableCell,
  ViewTextBlock,
} from '@uxnan/shared';
import { VIEW_BLOCKS_CSS } from './blocks-css.js';
import { VIEW_BLOCKS_SCRIPT } from './blocks-script.js';
import { MISSING, compactNumber, escapeHtml, formatNumber, niceTicks } from './format.js';

/**
 * Renders validated view blocks into one complete page. The page carries its
 * own stylesheet and script, so the bridge only has to wrap it with the CSP
 * and the protocol bootstrap like any other view. Every text an agent sent is
 * escaped here; numbers are formatted from finite values only.
 */

/** The gap between blocks, and the body padding the page keeps. */
const BLOCK_GAP = 20;
const BODY_PADDING = 32;
/** The width the height estimate assumes, the common width of a chat view. */
const ESTIMATE_WIDTH = 700;

/** The colour of series `index`: the six categorical chart colours, in order. */
function seriesColor(index: number): string {
  return `var(--color-chart-${(index % 6) + 1})`;
}

/**
 * A unit as shown after a number: a word gets a space (`120 ms`), a symbol
 * does not (`12%`). Empty when there is no unit.
 */
function unitSuffix(unit: string | undefined): string {
  if (!unit) return '';
  return /^[a-z]/i.test(unit) ? ` ${unit}` : unit;
}

/** A plain-text `h3` title, or nothing when the block has none. */
function title(text: string | undefined): string {
  return text === undefined ? '' : `<h3 class="ux-title">${escapeHtml(text)}</h3>`;
}

/**
 * A number rendered with its raw value attached, so the page can re-format it
 * in the person's locale. Prefix and suffix are kept around the number.
 */
function numberSpan(
  value: number,
  options: {
    tag?: 'span' | 'div';
    className?: string;
    digits?: number;
    prefix?: string;
    suffix?: string;
  } = {},
): string {
  const digits = options.digits ?? 2;
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  const tag = options.tag ?? 'span';
  const attributes = [`data-num="${String(value)}"`, `data-digits="${digits}"`];
  if (prefix) attributes.push(`data-prefix="${escapeHtml(prefix)}"`);
  if (suffix) attributes.push(`data-suffix="${escapeHtml(suffix)}"`);
  const className = options.className ? ` class="${options.className}"` : '';
  return `<${tag}${className} ${attributes.join(' ')}>${escapeHtml(
    prefix + formatNumber(value, digits) + suffix,
  )}</${tag}>`;
}

/**
 * The `data-tip-*` attributes a hover tooltip reads at hover time (so it follows
 * the locale). Keys left `undefined` are omitted.
 */
function tipAttributes(fields: Record<string, string | undefined>): string {
  let out = '';
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out += ` data-tip-${key}="${escapeHtml(value)}"`;
  }
  return out;
}

/** Text with inline `**bold**` and `` `code` `` only; everything else is literal. */
function inlineMarkup(text: string): string {
  return text
    .split(/(`[^`\n]+`)/)
    .map((part, index) => {
      if (index % 2 === 1) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return escapeHtml(part).replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    })
    .join('');
}

function renderText(block: ViewTextBlock): string {
  const paragraphs = block.text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  return `<section class="ux-block ux-text">${paragraphs
    .map((paragraph) => `<p>${inlineMarkup(paragraph)}</p>`)
    .join('')}</section>`;
}

const TREND_GLYPH: Record<NonNullable<ViewStatItem['trend']>, string> = {
  up: '▲',
  down: '▼',
  flat: '▶︎',
};

/** The arrow colour: the tone wins when given, otherwise the trend decides. */
function trendColorClass(item: ViewStatItem): string {
  switch (item.tone) {
    case 'accent':
      return 'ux-c-accent';
    case 'success':
    case 'warning':
    case 'danger':
      return `ux-c-${item.tone}`;
    case 'neutral':
      return 'ux-c-muted';
    case undefined:
      if (item.trend === 'up') return 'ux-c-success';
      if (item.trend === 'down') return 'ux-c-danger';
      return 'ux-c-muted';
  }
}

function renderStats(block: ViewStatsBlock): string {
  const tiles = block.items.map((item) => {
    const dot =
      item.tone === 'accent' ? '<span class="ux-stat-dot" aria-hidden="true"></span>' : '';
    const value =
      typeof item.value === 'number'
        ? numberSpan(item.value, { tag: 'div', className: 'ux-stat-value' })
        : `<div class="ux-stat-value">${escapeHtml(item.value)}</div>`;
    const arrow = item.trend
      ? `<span class="ux-trend ${trendColorClass(item)}">${TREND_GLYPH[item.trend]}</span>`
      : '';
    const detail =
      item.detail !== undefined || item.trend
        ? `<div class="ux-stat-detail">${arrow}${escapeHtml(item.detail ?? '')}</div>`
        : '';
    return `<div class="ux-stat"><div class="ux-stat-label">${dot}${escapeHtml(
      item.label,
    )}</div>${value}${detail}</div>`;
  });
  return `<section class="ux-block ux-stats">${tiles.join('')}</section>`;
}

function sortBars(items: ViewBarChartBlock['items'], sort: ViewBarChartBlock['sort']) {
  if (sort === 'desc') return [...items].sort((a, b) => b.value - a.value);
  if (sort === 'asc') return [...items].sort((a, b) => a.value - b.value);
  return items;
}

/** Rounds a percentage or position to a tenth of a thousandth, for compact attributes. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function renderBarChart(block: ViewBarChartBlock): string {
  const items = sortBars(block.items, block.sort);
  const highlighted = items.some((item) => item.highlight === true);
  const hasBaseline = items.some((item) => item.baseline !== undefined);
  const values = items.flatMap((item) =>
    item.baseline === undefined ? [item.value] : [item.value, item.baseline],
  );
  // The axis covers zero and every value; bars grow from zero, left or right.
  const low = Math.min(0, ...values);
  const span = Math.max(0, ...values) - low || 1;
  const bar = (value: number, className: string): string => {
    const start = Math.min(0, value);
    const end = Math.max(0, value);
    const left = round(((start - low) / span) * 100);
    const width = round(((end - start) / span) * 100);
    const radius = value < 0 ? '3px 0 0 3px' : '0 3px 3px 0';
    return `<span class="ux-bar ${className}" style="left:${left}%;width:${width}%;border-radius:${radius}"></span>`;
  };
  const zeroLine =
    low < 0 ? `<span class="ux-zero" style="left:${round((-low / span) * 100)}%"></span>` : '';
  // No words of our own in the page: without the agent's labels the legend is
  // left out and the value cell's "old → new" says it.
  const fromLabel = block.baselineLabel ?? '';
  const toLabel = block.valueLabel ?? '';

  const rows = items.map((item) => {
    const color = highlighted && item.highlight !== true ? 'ux-bar-muted' : 'ux-bar-accent';
    const hasItemBaseline = item.baseline !== undefined;
    const suffix = unitSuffix(block.unit);
    let change: number | undefined;
    if (item.baseline !== undefined && item.baseline !== 0) {
      change = Math.round(((item.value - item.baseline) / Math.abs(item.baseline)) * 1000) / 10;
    }
    const tip = tipAttributes({
      label: item.label,
      value: String(item.value),
      suffix,
      from: hasItemBaseline ? String(item.baseline) : undefined,
      'from-label': hasItemBaseline && fromLabel ? fromLabel : undefined,
      'to-label': hasItemBaseline && toLabel ? toLabel : undefined,
      change: change === undefined ? undefined : String(change),
    });
    const baselineBar = item.baseline === undefined ? '' : bar(item.baseline, 'ux-bar-base');
    const track = `<div class="ux-bar-track${hasItemBaseline ? ' ux-bar-track-base' : ''}"${tip}>${zeroLine}${baselineBar}${bar(
      item.value,
      `${color}${hasItemBaseline ? ' ux-bar-main' : ''}`,
    )}</div>`;
    const label = `<div class="ux-bar-label"${tip}>${escapeHtml(item.label)}</div>`;
    let valueCell: string;
    if (item.baseline === undefined) {
      valueCell = numberSpan(item.value, { suffix });
    } else {
      let delta = '';
      if (change !== undefined) {
        const direction = block.better;
        let tone = 'ux-c-muted';
        if (direction !== undefined && change !== 0) {
          const improved = direction === 'higher' ? change > 0 : change < 0;
          tone = improved ? 'ux-c-success' : 'ux-c-danger';
        }
        delta = numberSpan(change, {
          digits: 1,
          prefix: change > 0 ? '+' : '',
          suffix: '%',
          className: `ux-delta ${tone}`,
        });
      }
      valueCell = `${numberSpan(item.baseline, {})} → ${numberSpan(item.value, { suffix })}${delta}`;
    }
    return `${label}${track}<div class="ux-bar-value"${tip}>${valueCell}</div>`;
  });

  const legend =
    hasBaseline && (fromLabel || toLabel)
      ? `<div class="ux-legend"><span class="ux-legend-item"><span class="ux-swatch ux-bg-base"></span>${escapeHtml(
          fromLabel,
        )}</span><span class="ux-legend-item"><span class="ux-swatch ux-bg-accent"></span>${escapeHtml(
          toLabel,
        )}</span></div>`
      : '';
  return `<section class="ux-block ux-bar-chart">${title(block.title)}${legend}<div class="ux-bars">${rows.join(
    '',
  )}</div></section>`;
}

/** The runs of consecutive non-null points, each as its index and value. */
function runsOf(values: (number | null)[]): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push({ index, value });
    }
  });
  if (current.length) runs.push(current);
  return runs;
}

function renderLineChart(block: ViewLineChartBlock): string {
  const numbers = block.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null),
  );
  const ticks = niceTicks(
    numbers.length ? Math.min(...numbers) : 0,
    numbers.length ? Math.max(...numbers) : 1,
    4,
  );
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const span = high - low || 1;
  const count = block.labels.length;
  // The plot is a 1000 x 200 box: x across the width, y from the top.
  const x = (index: number): number => round(count > 1 ? (index / (count - 1)) * 1000 : 0);
  const y = (value: number): number => round((1 - (value - low) / span) * 200);
  const suffix = unitSuffix(block.unit);

  const grid = ticks
    .map((tick) => `<line class="ux-grid-line" x1="0" x2="1000" y1="${y(tick)}" y2="${y(tick)}"/>`)
    .join('');
  const single = block.series.length === 1;
  const paths = block.series.map((series, k) => {
    const color = seriesColor(k);
    const runs = runsOf(series.values);
    const line = runs
      .map(
        (run) =>
          run
            .map((point, j) => `${j === 0 ? 'M' : 'L'}${x(point.index)} ${y(point.value)}`)
            .join(' ') + (run.length === 1 ? ' h0.01' : ''),
      )
      .join(' ');
    const area =
      single && k === 0
        ? runs
            .map((run) => {
              const first = run[0];
              const last = run.at(-1);
              if (!first || !last) return '';
              const top = run.map((point) => `L${x(point.index)} ${y(point.value)}`).join(' ');
              return `M${x(first.index)} 200 ${top} L${x(last.index)} 200 Z`;
            })
            .join(' ')
        : '';
    return (
      (area ? `<path class="ux-area" d="${area}" style="fill:${color}"/>` : '') +
      `<path class="ux-line" d="${line}" style="stroke:${color}"/>`
    );
  });

  const dots = block.series.map((series, k) => {
    const last = runsOf(series.values).at(-1)?.at(-1);
    if (!last) return '';
    return `<span class="ux-dot" style="left:${round(x(last.index) / 10)}%;top:${y(last.value)}px;background:${seriesColor(k)}"></span>`;
  });

  const tickLabels = ticks.map((tick) => compactNumber(tick));
  const widest = tickLabels.reduce((a, b) => (b.length > a.length ? b : a), '');
  const yTicks = ticks.map(
    (tick, index) =>
      `<span class="ux-ytick" style="top:${round(y(tick) / 2)}%">${escapeHtml(tickLabels[index] ?? MISSING)}</span>`,
  );

  const shown = new Set<number>();
  if (count <= 6) for (let i = 0; i < count; i++) shown.add(i);
  else for (let k = 0; k < 6; k++) shown.add(Math.round((k * (count - 1)) / 5));
  const xLabels = [...shown]
    .sort((a, b) => a - b)
    .map((index) => {
      const modifier = index === 0 ? ' ux-xl-first' : index === count - 1 ? ' ux-xl-last' : '';
      return `<span class="ux-xl${modifier}" style="left:${round((index / (count - 1)) * 100)}%">${escapeHtml(
        block.labels[index] ?? '',
      )}</span>`;
    });

  const data = {
    labels: block.labels,
    suffix,
    lo: low,
    hi: high,
    series: block.series.map((series, k) => ({
      name: series.name,
      color: seriesColor(k),
      values: series.values,
    })),
  };
  const legend =
    block.series.length > 1
      ? `<div class="ux-legend">${block.series
          .map(
            (series, k) =>
              `<span class="ux-legend-item"><span class="ux-swatch-line" style="background:${seriesColor(
                k,
              )}"></span>${escapeHtml(series.name)}</span>`,
          )
          .join('')}</div>`
      : '';
  const unit = block.unit ? `<div class="ux-unit">${escapeHtml(block.unit)}</div>` : '';

  return `<section class="ux-block ux-line-chart">${title(block.title)}${legend}<div class="ux-line-grid">${unit}<div class="ux-yaxis"><span class="ux-ysizer">${escapeHtml(
    widest,
  )}</span>${yTicks.join('')}</div><div class="ux-plot" data-series="${escapeHtml(
    JSON.stringify(data),
  )}"><svg viewBox="0 0 1000 200" preserveAspectRatio="none" width="100%" height="200"><g>${grid}</g>${paths.join(
    '',
  )}</svg>${dots.join('')}</div><div class="ux-xaxis">${xLabels.join('')}</div></div></section>`;
}

function renderBreakdown(block: ViewBreakdownBlock): string {
  const total = block.items.reduce((sum, item) => sum + item.value, 0);
  const suffix = unitSuffix(block.unit);
  const segments = block.items.map((item, k) => {
    const share = Math.round((item.value / total) * 100);
    const tip = tipAttributes({
      label: item.label,
      value: String(item.value),
      suffix,
      share: String(share),
    });
    return `<span class="ux-seg" style="flex:${round((item.value / total) * 100)} 1 0px;background:${seriesColor(
      k,
    )}"${tip}></span>`;
  });
  const rows = block.items.map((item, k) => {
    const share = Math.round((item.value / total) * 100);
    const tip = tipAttributes({
      label: item.label,
      value: String(item.value),
      suffix,
      share: String(share),
    });
    return `<li class="ux-breakdown-row"${tip}><span class="ux-swatch" style="background:${seriesColor(
      k,
    )}"></span><span class="ux-breakdown-label">${escapeHtml(item.label)}</span>${numberSpan(
      item.value,
      { className: 'ux-breakdown-value', suffix },
    )}${numberSpan(share, { className: 'ux-breakdown-pct', digits: 0, suffix: '%' })}</li>`;
  });
  return `<section class="ux-block ux-breakdown">${title(block.title)}<div class="ux-stack">${segments.join(
    '',
  )}</div><ul class="ux-breakdown-list">${rows.join('')}</ul></section>`;
}

function renderTableCell(
  cell: ViewTableCell,
  format: 'text' | 'number' | 'percent' | undefined,
): string {
  const numeric = format === 'number' || format === 'percent';
  const className = numeric ? ' class="ux-num"' : '';
  if (cell === null) return `<td${className}><span class="ux-na">${MISSING}</span></td>`;
  if (typeof cell === 'number') {
    return `<td${className}>${numberSpan(cell, { suffix: format === 'percent' ? '%' : '' })}</td>`;
  }
  return `<td${className}>${escapeHtml(cell)}</td>`;
}

function renderTable(block: ViewTableBlock): string {
  const head = block.columns
    .map((column) => {
      const numeric = column.format === 'number' || column.format === 'percent';
      return `<th${numeric ? ' class="ux-num"' : ''}>${escapeHtml(column.label)}</th>`;
    })
    .join('');
  const body = block.rows
    .map((row, index) => {
      const highlight = index === block.highlightRow ? ' class="ux-hl"' : '';
      const cells = row.map((cell, c) => renderTableCell(cell, block.columns[c]?.format));
      return `<tr${highlight}>${cells.join('')}</tr>`;
    })
    .join('');
  return `<section class="ux-block ux-table-block">${title(block.title)}<div class="ux-table-wrap"><table class="ux-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

/** The stroke paths of the status glyphs, drawn in a 16 x 16 box. */
const CIRCLE_CHECK = '<circle cx="8" cy="8" r="6.25"/><path d="M5.4 8.2 7.2 10 10.6 6.4"/>';

const CALLOUT_GLYPH: Record<'info' | 'success' | 'warning' | 'danger', string> = {
  info: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.4v3.6M8 4.9v.01"/>',
  success: CIRCLE_CHECK,
  warning: '<path d="M8 2.2 14.6 13.6H1.4Z"/><path d="M8 6.6v3.2M8 11.6v.01"/>',
  danger: '<circle cx="8" cy="8" r="6.25"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>',
};

const MARK_GLYPH: Record<'done' | 'failed', string> = {
  done: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6 9.5 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  failed:
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3 9 9M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

/** A step or checklist entry: a status marker, the title and the optional detail. */
function renderMarkedItem(item: ViewListItem): string {
  const detail =
    item.detail === undefined ? '' : `<div class="ux-step-detail">${escapeHtml(item.detail)}</div>`;
  const status = item.status ?? 'pending';
  const glyph = status === 'done' || status === 'failed' ? MARK_GLYPH[status] : '';
  const mark = `<span class="ux-marker ux-m-${status}">${glyph}</span>`;
  return `<li class="ux-step">${mark}<div class="ux-step-title">${escapeHtml(item.title)}</div>${detail}</li>`;
}

function renderList(block: ViewListBlock): string {
  const style = block.style ?? 'bullets';
  let body: string;
  if (style === 'steps') {
    body = `<ol class="ux-steps">${block.items.map(renderMarkedItem).join('')}</ol>`;
  } else if (style === 'checklist') {
    body = `<ul class="ux-checks">${block.items.map(renderMarkedItem).join('')}</ul>`;
  } else {
    const tag = style === 'numbered' ? 'ol' : 'ul';
    const items = block.items.map((item) => {
      const detail =
        item.detail === undefined
          ? ''
          : `<span class="ux-item-detail">${escapeHtml(item.detail)}</span>`;
      return `<li>${escapeHtml(item.title)}${detail}</li>`;
    });
    body = `<${tag} class="ux-list">${items.join('')}</${tag}>`;
  }
  return `<section class="ux-block ux-list-block">${title(block.title)}${body}</section>`;
}

function renderCallout(block: ViewCalloutBlock): string {
  const tone = block.tone ?? 'info';
  const icon = `<svg class="ux-glyph ux-callout-icon" viewBox="0 0 16 16" aria-hidden="true">${CALLOUT_GLYPH[tone]}</svg>`;
  const heading =
    block.title === undefined
      ? ''
      : `<div class="ux-callout-title">${escapeHtml(block.title)}</div>`;
  return `<section class="ux-block ux-callout ux-callout-${tone}">${icon}${heading}<div class="ux-callout-text">${escapeHtml(
    block.text,
  )}</div></section>`;
}

function renderCompare(block: ViewCompareBlock): string {
  const cards = block.options.map((option) => {
    const highlight = option.highlight ? ' ux-card-hl' : '';
    // The check only marks the chosen option; it carries no words of its own.
    const check = option.highlight
      ? `<svg class="ux-glyph ux-card-check" viewBox="0 0 16 16" aria-hidden="true">${CIRCLE_CHECK}</svg>`
      : '';
    const subtitle =
      option.subtitle === undefined
        ? ''
        : `<div class="ux-card-sub">${escapeHtml(option.subtitle)}</div>`;
    const points = option.points
      .map(
        (point) =>
          `<div class="ux-point"><dt>${escapeHtml(point.label)}</dt><dd>${escapeHtml(
            point.value,
          )}</dd></div>`,
      )
      .join('');
    return `<article class="ux-card${highlight}"><div class="ux-card-head"><div class="ux-card-title">${escapeHtml(
      option.title,
    )}</div>${check}</div>${subtitle}<dl class="ux-points">${points}</dl></article>`;
  });
  return `<section class="ux-block ux-compare">${cards.join('')}</section>`;
}

function renderChoices(block: ViewChoicesBlock): string {
  const prompt =
    block.prompt === undefined
      ? ''
      : `<p class="ux-choices-prompt">${escapeHtml(block.prompt)}</p>`;
  const buttons = block.options.map(
    (option) =>
      `<button type="button" class="ux-choice" data-message="${escapeHtml(
        option.message ?? option.label,
      )}">${escapeHtml(option.label)}</button>`,
  );
  return `<section class="ux-block ux-choices">${prompt}<div class="ux-choice-row">${buttons.join(
    '',
  )}</div></section>`;
}

function renderBlock(block: ViewBlock): string {
  switch (block.type) {
    case 'text':
      return renderText(block);
    case 'stats':
      return renderStats(block);
    case 'bar-chart':
      return renderBarChart(block);
    case 'line-chart':
      return renderLineChart(block);
    case 'breakdown':
      return renderBreakdown(block);
    case 'table':
      return renderTable(block);
    case 'list':
      return renderList(block);
    case 'callout':
      return renderCallout(block);
    case 'compare':
      return renderCompare(block);
    case 'choices':
      return renderChoices(block);
  }
}

/** Lines of text at a given width, one line at least. */
function linesFor(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(Array.from(text).length / charsPerLine));
}

/**
 * A rough height of one block at {@link ESTIMATE_WIDTH}. It only sizes the
 * frame before the page measures itself, so it aims for the right order of
 * magnitude, not the pixel.
 */
function estimateHeight(block: ViewBlock): number {
  switch (block.type) {
    case 'text': {
      const paragraphs = block.text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
      const lines = paragraphs.reduce((sum, p) => sum + linesFor(p, 95), 0);
      return lines * 21 + Math.max(0, paragraphs.length - 1) * 8;
    }
    case 'stats': {
      const columns = Math.max(1, Math.floor((ESTIMATE_WIDTH + 10) / 150));
      const rows = Math.ceil(block.items.length / columns);
      const tile = block.items.some((item) => item.detail !== undefined || item.trend) ? 82 : 62;
      return rows * tile + Math.max(0, rows - 1) * 10;
    }
    case 'bar-chart': {
      const base = block.items.some((item) => item.baseline !== undefined);
      const legend = base ? 24 : 0;
      const row = base ? 30 : 22;
      return (
        (block.title ? 24 : 0) +
        legend +
        block.items.length * row +
        Math.max(0, block.items.length - 1) * 8
      );
    }
    case 'line-chart':
      return (
        (block.title ? 24 : 0) +
        (block.series.length > 1 ? 24 : 0) +
        (block.unit ? 16 : 0) +
        200 +
        22
      );
    case 'breakdown': {
      const rows = block.items.length;
      return (block.title ? 24 : 0) + 16 + 10 + rows * 22 + Math.max(0, rows - 1) * 6;
    }
    case 'table':
      return (block.title ? 24 : 0) + 30 + block.rows.length * 34;
    case 'list': {
      const gap = block.style === 'steps' ? 12 : block.style === 'checklist' ? 8 : 6;
      const rows = block.items.reduce(
        (sum, item) => sum + 20 + (item.detail === undefined ? 0 : linesFor(item.detail, 100) * 17),
        0,
      );
      return (block.title ? 24 : 0) + rows + Math.max(0, block.items.length - 1) * gap;
    }
    case 'callout': {
      const text = block.text.split('\n').reduce((sum, line) => sum + linesFor(line, 95), 0);
      return 20 + (block.title ? 24 : 0) + text * 19.5;
    }
    case 'compare': {
      const columns = Math.max(1, Math.floor((ESTIMATE_WIDTH + 10) / 190));
      let total = 0;
      for (let start = 0; start < block.options.length; start += columns) {
        const rowCards = block.options.slice(start, start + columns);
        const tallest = Math.max(
          ...rowCards.map(
            (option) => 24 + 20 + (option.subtitle ? 18 : 0) + 10 + option.points.length * 29,
          ),
        );
        total += tallest;
      }
      const rows = Math.ceil(block.options.length / columns);
      return total + Math.max(0, rows - 1) * 10;
    }
    case 'choices': {
      // Greedy packing of the buttons into rows at the estimated width.
      let rows = 1;
      let used = 0;
      for (const option of block.options) {
        const width = 26 + Array.from(option.label).length * 7.2;
        if (used > 0 && used + 8 + width > ESTIMATE_WIDTH) {
          rows += 1;
          used = width;
        } else {
          used += (used > 0 ? 8 : 0) + width;
        }
      }
      return (block.prompt ? 24 : 0) + rows * 30 + Math.max(0, rows - 1) * 8;
    }
  }
}

/**
 * The page for a list of validated blocks: one document, the shared stylesheet,
 * and the behaviour script. `height` estimates the rendered height at about
 * 700 px wide and is used only as the first frame height, clamped to 80..1600.
 */
export function renderViewBlocks(blocks: ViewBlock[]): { html: string; height: number } {
  const body = blocks.map(renderBlock).join('');
  const content = blocks.reduce((sum, block) => sum + estimateHeight(block), 0);
  const gaps = Math.max(0, blocks.length - 1) * BLOCK_GAP;
  const height = Math.min(1600, Math.max(80, Math.round(content + gaps + BODY_PADDING)));
  const html = `<html><head><style>${VIEW_BLOCKS_CSS}</style></head><body><div class="ux-blocks">${body}</div><script>${VIEW_BLOCKS_SCRIPT}</script></body></html>`;
  return { html, height };
}
