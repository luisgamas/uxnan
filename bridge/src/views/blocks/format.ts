/**
 * Text and number helpers for the block renderer. Every page is rendered on
 * the bridge in English-grouped numbers; the page's own script re-formats the
 * same numbers in the person's locale when the host reports one.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes text for HTML element content and quoted attributes. Every string an
 * agent sent goes through this before it reaches a page, so no block can add
 * markup, an attribute or a script.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** The em dash shown where a number is missing (a `null` cell, a value that is not finite). */
export const MISSING = '—';

const formatters = new Map<number, Intl.NumberFormat>();

/**
 * A number with thousands separators and at most `maxFractionDigits` decimals
 * (`1234.5` → `"1,234.5"`). Negative zero reads as `"0"`; a value that is not
 * finite reads as {@link MISSING} so no page ever shows `NaN` or `Infinity`.
 */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return MISSING;
  let formatter = formatters.get(maxFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFractionDigits });
    formatters.set(maxFractionDigits, formatter);
  }
  const text = formatter.format(value);
  return text === '-0' ? '0' : text;
}

/**
 * A short number for chart axes: `950`, `1.2K`, `12K`, `1.5M`, `2B`. Axis
 * labels must stay narrow, so the scaled figure keeps one decimal below ten
 * and none above.
 */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  const magnitude = Math.abs(value);
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (magnitude >= size) {
      const scaled = value / size;
      const digits = Math.abs(scaled) < 10 ? 1 : 0;
      return formatNumber(scaled, digits) + suffix;
    }
  }
  return formatNumber(value, 2);
}

/** The "nice" steps an axis may use: 1, 2, 2.5, 5 (times a power of ten). */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** The smallest nice step that is at least `raw`. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exponent;
  const nice = NICE_STEPS.find((step) => step >= base - 1e-9) ?? 10;
  // Built from text so the step is the exact decimal (2.5e-3), not a float product.
  return Number(`${nice}e${exponent}`);
}

/**
 * Evenly spaced "nice" tick values (steps of 1, 2, 2.5, 5 times a power of
 * ten) that cover `[min, max]`, aiming for about `count` intervals. When `min`
 * is not negative the axis starts at 0, so a bar or area never floats above a
 * phantom baseline.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let low = Number.isFinite(min) && Number.isFinite(max) ? Math.min(min, max) : 0;
  let high = Number.isFinite(min) && Number.isFinite(max) ? Math.max(min, max) : 1;
  if (low >= 0) low = 0;
  if (high === low) high = low + 1;
  const intervals = Math.max(1, Math.round(count));
  const step = niceStep((high - low) / intervals);
  const first = Math.floor(low / step + 1e-9);
  const last = Math.ceil(high / step - 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) {
    const tick = Number((k * step).toPrecision(12));
    ticks.push(tick === 0 ? 0 : tick);
  }
  return ticks;
}
