/**
 * Declarative view blocks: what an agent sends instead of raw HTML.
 *
 * An agent describes a chart, a table or a set of follow-up choices as a short
 * list of typed blocks; the bridge renders them into one page with one design,
 * so every agent's charts look alike and stay readable in light and dark. The
 * contract is validated here, on the bridge, and every field is bounded so a
 * view cannot flood a chat or a WebView. Errors name the exact path and rule,
 * so an agent can fix its input and send it again.
 */

/** The block types an agent may send, in the order the docs list them. */
export const VIEW_BLOCK_TYPES = [
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
] as const;
export type ViewBlockType = (typeof VIEW_BLOCK_TYPES)[number];

/** Blocks in one view. Past this a page is a document, not a glance. */
export const VIEW_MAX_BLOCKS = 16;

/** The JSON size of the blocks array, in UTF-8 bytes: bounds a block view the
 *  way the raw HTML limit bounds an HTML view. */
export const VIEW_MAX_BLOCKS_BYTES = 64 * 1024;

/** The colour role of a stat, a compare point or a callout's emphasis. */
export type ViewTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** Prose: paragraphs separated by a blank line; `**bold**` and `` `code` `` only. */
export interface ViewTextBlock {
  type: 'text';
  text: string;
}

/** One figure in a row of stat tiles. */
export interface ViewStatItem {
  label: string;
  /** Shown as given when a string; a number is grouped by the locale. */
  value: string | number;
  detail?: string;
  trend?: 'up' | 'down' | 'flat';
  /** Wins over `trend` for the arrow colour, so a stat can say "this is bad". */
  tone?: ViewTone;
}

export interface ViewStatsBlock {
  type: 'stats';
  items: ViewStatItem[];
}

/** One horizontal bar. `baseline` is the old value, for before/after bars. */
export interface ViewBarItem {
  label: string;
  value: number;
  baseline?: number;
  highlight?: boolean;
}

export interface ViewBarChartBlock {
  type: 'bar-chart';
  title?: string;
  unit?: string;
  items: ViewBarItem[];
  /** Reorders the items; `none` keeps the agent's order (the default). */
  sort?: 'none' | 'desc' | 'asc';
  /** Legend text for the baseline bar (default "Before"). */
  baselineLabel?: string;
  /** Legend text for the value bar (default "After"). */
  valueLabel?: string;
  /** Which direction is an improvement; colours the % change when set. */
  better?: 'higher' | 'lower';
}

/** One named line; `null` breaks the line at that label. */
export interface ViewLineSeries {
  name: string;
  values: (number | null)[];
}

export interface ViewLineChartBlock {
  type: 'line-chart';
  title?: string;
  unit?: string;
  labels: string[];
  series: ViewLineSeries[];
}

/** One part of a whole. The parts are relative: they need not sum to 100. */
export interface ViewBreakdownItem {
  label: string;
  value: number;
}

export interface ViewBreakdownBlock {
  type: 'breakdown';
  title?: string;
  unit?: string;
  items: ViewBreakdownItem[];
}

export interface ViewTableColumn {
  label: string;
  /** `number` groups digits and `percent` appends `%`; both right-align. */
  format?: 'text' | 'number' | 'percent';
}

/** A cell: text, a number (formatted by its column) or `null` for "no value". */
export type ViewTableCell = string | number | null;

export interface ViewTableBlock {
  type: 'table';
  title?: string;
  columns: ViewTableColumn[];
  rows: ViewTableCell[][];
  /** Index into `rows` of the row to emphasise (the total, the winner). */
  highlightRow?: number;
}

export interface ViewListItem {
  title: string;
  detail?: string;
  status?: 'done' | 'current' | 'pending' | 'failed';
}

export interface ViewListBlock {
  type: 'list';
  title?: string;
  /** Default `bullets`. `steps` draws a rail; `checklist` draws markers only. */
  style?: 'bullets' | 'numbered' | 'steps' | 'checklist';
  items: ViewListItem[];
}

export interface ViewCalloutBlock {
  type: 'callout';
  /** Default `info`. */
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  text: string;
}

export interface ViewComparePoint {
  label: string;
  value: string;
}

export interface ViewCompareOption {
  title: string;
  subtitle?: string;
  /** Marks the option the agent recommends (a top border, nothing printed). */
  highlight?: boolean;
  points: ViewComparePoint[];
}

export interface ViewCompareBlock {
  type: 'compare';
  options: ViewCompareOption[];
}

/** A follow-up suggestion: clicking it proposes `message ?? label` to the person. */
export interface ViewChoiceOption {
  label: string;
  message?: string;
}

export interface ViewChoicesBlock {
  type: 'choices';
  prompt?: string;
  options: ViewChoiceOption[];
}

/** One block of a declarative view. */
export type ViewBlock =
  | ViewTextBlock
  | ViewStatsBlock
  | ViewBarChartBlock
  | ViewLineChartBlock
  | ViewBreakdownBlock
  | ViewTableBlock
  | ViewListBlock
  | ViewCalloutBlock
  | ViewCompareBlock
  | ViewChoicesBlock;

/** The outcome of {@link parseViewBlocks}: the blocks, or one error to fix. */
export type ParsedViewBlocks = { ok: true; blocks: ViewBlock[] } | { ok: false; error: string };

const TONES: readonly ViewTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];
const CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const;
const TRENDS = ['up', 'down', 'flat'] as const;
const SORTS = ['none', 'desc', 'asc'] as const;
const BETTER = ['higher', 'lower'] as const;
const COLUMN_FORMATS = ['text', 'number', 'percent'] as const;
const LIST_STYLES = ['bullets', 'numbered', 'steps', 'checklist'] as const;
const LIST_STATUSES = ['done', 'current', 'pending', 'failed'] as const;

/** Thrown inside the parser and turned into `{ ok: false }` at the boundary. */
class BlockError extends Error {}

type Fields = Record<string, unknown>;

function fail(at: string, rule: string): never {
  throw new BlockError(`${at} ${rule}`);
}

/** The code-point length: what an agent counts as characters. */
function length(text: string): number {
  return Array.from(text).length;
}

/** A short rendering of a rejected value for the error message. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40));
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return String(value);
  return value === undefined ? 'nothing' : typeof value;
}

function asObject(value: unknown, at: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(at, `must be an object, got ${show(value)}`);
  return value as Fields;
}

function requireArray(
  value: unknown,
  at: string,
  min: number,
  max: number,
  noun: string,
): unknown[] {
  if (!Array.isArray(value)) fail(at, 'must be an array');
  if (value.length < min || value.length > max)
    fail(at, `must have ${min} to ${max} ${noun}, got ${value.length}`);
  return value;
}

/** A required string: trimmed, non-empty, at most `max` characters. */
function requireText(value: unknown, at: string, max: number): string {
  if (value === undefined) fail(at, 'is required');
  if (typeof value !== 'string') fail(at, `must be a string, got ${show(value)}`);
  const text = value.trim();
  if (text === '') fail(at, 'must not be empty');
  if (length(text) > max) fail(at, `must be at most ${max} characters, got ${length(text)}`);
  return text;
}

/** An optional string: absent or blank means absent, otherwise bounded like {@link requireText}. */
function optionalText(value: unknown, at: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(at, `must be a string, got ${show(value)}`);
  const text = value.trim();
  if (text === '') return undefined;
  if (length(text) > max) fail(at, `must be at most ${max} characters, got ${length(text)}`);
  return text;
}

function requireNumber(value: unknown, at: string): number {
  if (value === undefined) fail(at, 'is required');
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(at, `must be a finite number, got ${show(value)}`);
  return value;
}

function optionalNumber(value: unknown, at: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, at);
}

function optionalBoolean(value: unknown, at: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(at, `must be true or false, got ${show(value)}`);
  return value;
}

function optionalEnum<T extends string>(
  value: unknown,
  at: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    fail(at, `must be one of: ${allowed.join(', ')} (got ${show(value)})`);
  return value as T;
}

/** Drops the keys whose value is `undefined`, so optional fields are absent, not undefined. */
function present<T extends object>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as T;
}

/** Markdown a `text` block would show as raw characters: a table row with a
 *  `|---|` divider, or a `#` heading. A weak model reaches for them when it
 *  forgets the other blocks; refusing with the block to use instead turns a
 *  page of pipes into a retry. */
const MARKDOWN_TABLE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+\S/m;

function parseText(v: Fields, at: string): ViewTextBlock {
  const text = requireText(v['text'], `${at}.text`, 4000);
  if (MARKDOWN_TABLE.test(text))
    fail(`${at}.text`, 'has a Markdown table, which shows as raw pipes: send it as a table block');
  if (MARKDOWN_HEADING.test(text))
    fail(
      `${at}.text`,
      'has a Markdown heading (#), which shows as raw text: give the next block a title instead',
    );
  return { type: 'text', text };
}

function parseStats(v: Fields, at: string): ViewStatsBlock {
  const items = requireArray(v['items'], `${at}.items`, 1, 6, 'items').map((raw, i) => {
    const ip = `${at}.items[${i}]`;
    const item = asObject(raw, ip);
    const value = item['value'];
    if (typeof value !== 'string' && typeof value !== 'number')
      fail(`${ip}.value`, `must be a string or a finite number, got ${show(value)}`);
    return present<ViewStatItem>({
      label: requireText(item['label'], `${ip}.label`, 60),
      value:
        typeof value === 'number'
          ? requireNumber(value, `${ip}.value`)
          : requireText(value, `${ip}.value`, 40),
      detail: optionalText(item['detail'], `${ip}.detail`, 80),
      trend: optionalEnum(item['trend'], `${ip}.trend`, TRENDS),
      tone: optionalEnum(item['tone'], `${ip}.tone`, TONES),
    });
  });
  return { type: 'stats', items };
}

function parseBarChart(v: Fields, at: string): ViewBarChartBlock {
  const items = requireArray(v['items'], `${at}.items`, 1, 40, 'items').map((raw, i) => {
    const ip = `${at}.items[${i}]`;
    const item = asObject(raw, ip);
    return present<ViewBarItem>({
      label: requireText(item['label'], `${ip}.label`, 60),
      value: requireNumber(item['value'], `${ip}.value`),
      baseline: optionalNumber(item['baseline'], `${ip}.baseline`),
      highlight: optionalBoolean(item['highlight'], `${ip}.highlight`),
    });
  });
  return present<ViewBarChartBlock>({
    type: 'bar-chart',
    title: optionalText(v['title'], `${at}.title`, 120),
    unit: optionalText(v['unit'], `${at}.unit`, 12),
    items,
    sort: optionalEnum(v['sort'], `${at}.sort`, SORTS),
    baselineLabel: optionalText(v['baselineLabel'], `${at}.baselineLabel`, 24),
    valueLabel: optionalText(v['valueLabel'], `${at}.valueLabel`, 24),
    better: optionalEnum(v['better'], `${at}.better`, BETTER),
  });
}

function parseLineChart(v: Fields, at: string): ViewLineChartBlock {
  const labels = requireArray(v['labels'], `${at}.labels`, 2, 200, 'labels').map((raw, i) =>
    requireText(raw, `${at}.labels[${i}]`, 24),
  );
  const series = requireArray(v['series'], `${at}.series`, 1, 6, 'series').map((raw, i) => {
    const sp = `${at}.series[${i}]`;
    const item = asObject(raw, sp);
    const values = item['values'];
    if (!Array.isArray(values)) fail(`${sp}.values`, 'must be an array');
    if (values.length !== labels.length)
      fail(
        `${sp}.values`,
        `must have one value per label (${labels.length}), got ${values.length}`,
      );
    return {
      name: requireText(item['name'], `${sp}.name`, 40),
      values: values.map((value, k) => {
        if (value === null) return null;
        if (typeof value !== 'number' || !Number.isFinite(value))
          fail(`${sp}.values[${k}]`, `must be a finite number or null, got ${show(value)}`);
        return value;
      }),
    };
  });
  return present<ViewLineChartBlock>({
    type: 'line-chart',
    title: optionalText(v['title'], `${at}.title`, 120),
    unit: optionalText(v['unit'], `${at}.unit`, 12),
    labels,
    series,
  });
}

function parseBreakdown(v: Fields, at: string): ViewBreakdownBlock {
  const items = requireArray(v['items'], `${at}.items`, 2, 6, 'items').map((raw, i) => {
    const ip = `${at}.items[${i}]`;
    const item = asObject(raw, ip);
    const value = requireNumber(item['value'], `${ip}.value`);
    if (value < 0) fail(`${ip}.value`, `must be zero or more, got ${value}`);
    return { label: requireText(item['label'], `${ip}.label`, 60), value };
  });
  const sum = items.reduce((total, item) => total + item.value, 0);
  if (!Number.isFinite(sum) || sum <= 0)
    fail(`${at}.items`, 'values must sum to a finite number above 0');
  return present<ViewBreakdownBlock>({
    type: 'breakdown',
    title: optionalText(v['title'], `${at}.title`, 120),
    unit: optionalText(v['unit'], `${at}.unit`, 12),
    items,
  });
}

function parseTable(v: Fields, at: string): ViewTableBlock {
  const columns = requireArray(v['columns'], `${at}.columns`, 1, 10, 'columns').map((raw, i) => {
    const cp = `${at}.columns[${i}]`;
    const column = asObject(raw, cp);
    return present<ViewTableColumn>({
      label: requireText(column['label'], `${cp}.label`, 60),
      format: optionalEnum(column['format'], `${cp}.format`, COLUMN_FORMATS),
    });
  });
  const rows = requireArray(v['rows'], `${at}.rows`, 1, 200, 'rows').map((raw, r) => {
    const rp = `${at}.rows[${r}]`;
    if (!Array.isArray(raw)) fail(rp, 'must be an array');
    if (raw.length !== columns.length)
      fail(rp, `must have one value per column (${columns.length}), got ${raw.length}`);
    return raw.map((cell, c): ViewTableCell => {
      const cp = `${rp}[${c}]`;
      if (cell === null) return null;
      if (typeof cell === 'number') return requireNumber(cell, cp);
      if (typeof cell === 'string') return cell.trim();
      return fail(cp, `must be a string, a number or null, got ${show(cell)}`);
    });
  });
  const highlight = v['highlightRow'];
  if (
    highlight !== undefined &&
    (typeof highlight !== 'number' ||
      !Number.isInteger(highlight) ||
      highlight < 0 ||
      highlight >= rows.length)
  )
    fail(
      `${at}.highlightRow`,
      `must be an integer from 0 to ${rows.length - 1}, got ${show(highlight)}`,
    );
  return present<ViewTableBlock>({
    type: 'table',
    title: optionalText(v['title'], `${at}.title`, 120),
    columns,
    rows,
    highlightRow: highlight as number | undefined,
  });
}

function parseList(v: Fields, at: string): ViewListBlock {
  const items = requireArray(v['items'], `${at}.items`, 1, 40, 'items').map((raw, i) => {
    const ip = `${at}.items[${i}]`;
    const item = asObject(raw, ip);
    return present<ViewListItem>({
      title: requireText(item['title'], `${ip}.title`, 200),
      detail: optionalText(item['detail'], `${ip}.detail`, 400),
      status: optionalEnum(item['status'], `${ip}.status`, LIST_STATUSES),
    });
  });
  return present<ViewListBlock>({
    type: 'list',
    title: optionalText(v['title'], `${at}.title`, 120),
    style: optionalEnum(v['style'], `${at}.style`, LIST_STYLES),
    items,
  });
}

function parseCallout(v: Fields, at: string): ViewCalloutBlock {
  return present<ViewCalloutBlock>({
    type: 'callout',
    tone: optionalEnum(v['tone'], `${at}.tone`, CALLOUT_TONES),
    title: optionalText(v['title'], `${at}.title`, 120),
    text: requireText(v['text'], `${at}.text`, 1000),
  });
}

function parseCompare(v: Fields, at: string): ViewCompareBlock {
  const options = requireArray(v['options'], `${at}.options`, 2, 4, 'options').map((raw, i) => {
    const op = `${at}.options[${i}]`;
    const option = asObject(raw, op);
    const points = requireArray(option['points'], `${op}.points`, 1, 12, 'points').map(
      (pointRaw, k) => {
        const pp = `${op}.points[${k}]`;
        const point = asObject(pointRaw, pp);
        return {
          label: requireText(point['label'], `${pp}.label`, 60),
          value: requireText(point['value'], `${pp}.value`, 120),
        };
      },
    );
    return present<ViewCompareOption>({
      title: requireText(option['title'], `${op}.title`, 60),
      subtitle: optionalText(option['subtitle'], `${op}.subtitle`, 80),
      highlight: optionalBoolean(option['highlight'], `${op}.highlight`),
      points,
    });
  });
  return { type: 'compare', options };
}

function parseChoices(v: Fields, at: string): ViewChoicesBlock {
  const options = requireArray(v['options'], `${at}.options`, 1, 6, 'options').map((raw, i) => {
    const op = `${at}.options[${i}]`;
    const option = asObject(raw, op);
    return present<ViewChoiceOption>({
      label: requireText(option['label'], `${op}.label`, 80),
      message: optionalText(option['message'], `${op}.message`, 1000),
    });
  });
  return present<ViewChoicesBlock>({
    type: 'choices',
    prompt: optionalText(v['prompt'], `${at}.prompt`, 200),
    options,
  });
}

const PARSERS: { [K in ViewBlockType]: (v: Fields, at: string) => ViewBlock } = {
  text: parseText,
  stats: parseStats,
  'bar-chart': parseBarChart,
  'line-chart': parseLineChart,
  breakdown: parseBreakdown,
  table: parseTable,
  list: parseList,
  callout: parseCallout,
  compare: parseCompare,
  choices: parseChoices,
};

function parseBlock(raw: unknown, at: string): ViewBlock {
  const v = asObject(raw, at);
  const type = v['type'];
  if (typeof type !== 'string' || !(VIEW_BLOCK_TYPES as readonly string[]).includes(type))
    fail(`${at}.type`, `must be one of: ${VIEW_BLOCK_TYPES.join(', ')} (got ${show(type)})`);
  return PARSERS[type as ViewBlockType](v, at);
}

function parseBlocks(value: unknown): ViewBlock[] {
  if (!Array.isArray(value)) fail('blocks', 'must be an array of blocks');
  if (value.length < 1 || value.length > VIEW_MAX_BLOCKS)
    fail('blocks', `must have 1 to ${VIEW_MAX_BLOCKS} blocks, got ${value.length}`);
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    fail('blocks', 'must be plain JSON data');
  }
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > VIEW_MAX_BLOCKS_BYTES)
    fail('blocks', `are ${bytes} bytes of JSON; the limit is ${VIEW_MAX_BLOCKS_BYTES} bytes`);
  return value.map((raw, i) => parseBlock(raw, `blocks[${i}]`));
}

/**
 * Validates the `blocks` argument of a view. The result is either the blocks
 * with every optional field trimmed and absent ones left out, or one error
 * message naming the path and the rule that failed (for the agent to fix).
 * Unknown fields are dropped, never rejected.
 */
export function parseViewBlocks(value: unknown): ParsedViewBlocks {
  try {
    return { ok: true, blocks: parseBlocks(value) };
  } catch (error) {
    if (error instanceof BlockError) return { ok: false, error: error.message };
    throw error;
  }
}
