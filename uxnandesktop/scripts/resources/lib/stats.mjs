/**
 * Summary statistics for a scenario's samples.
 *
 * Every number the benchmark publishes is produced here, so the definitions live
 * in one place: which percentile method, how a rate is derived from cumulative
 * CPU time, and how a soak's memory trend is fitted. All functions are pure and
 * return `null` for "not measurable" — never `0`, which would read as a real
 * measurement of nothing (the same rule the collectors follow with
 * `unsupported`).
 */

/** Sort a copy ascending, dropping anything that isn't a finite number. */
function finiteSorted(values) {
  return values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
}

/**
 * Linear-interpolated percentile (the "R-7" definition — what NumPy and Excel
 * use). `p` is a fraction: `0.95` for P95. Returns `null` for an empty sample.
 */
export function percentile(values, p) {
  const xs = finiteSorted(values);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const rank = (xs.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
}

/** Arithmetic mean, or `null` for an empty sample. */
export function mean(values) {
  const xs = finiteSorted(values);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Largest value, or `null` for an empty sample. */
export function max(values) {
  const xs = finiteSorted(values);
  return xs.length === 0 ? null : xs[xs.length - 1];
}

/** Smallest value, or `null` for an empty sample. */
export function min(values) {
  const xs = finiteSorted(values);
  return xs.length === 0 ? null : xs[0];
}

/**
 * Least-squares slope of `points` (`{x, y}`) — the memory trend a soak run is
 * really asking about. `x` is in milliseconds and the result is **per hour**, so
 * a verdict can be phrased as "grew 12 MB/h". Needs at least two distinct `x`
 * values; otherwise `null`.
 */
export function slopePerHour(points) {
  const pts = points.filter(
    (p) => Number.isFinite(p?.x) && typeof p?.y === "number" && Number.isFinite(p.y),
  );
  if (pts.length < 2) return null;
  const n = pts.length;
  const sumX = pts.reduce((a, p) => a + p.x, 0);
  const sumY = pts.reduce((a, p) => a + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return null;
  return (num / den) * 3_600_000;
}

/**
 * Turn two cumulative CPU-time readings into a rate.
 *
 * Collectors report **cumulative** processor time per process (that is what
 * every OS exposes cheaply and without a perf-counter subscription), so a rate
 * only exists between two samples. The result is *percent of one core*: 100
 * means one core fully busy, 400 means four. Dividing by the core count is left
 * to the caller ([`cpuPercentOfMachine`]) so both framings stay explicit in the
 * report rather than being silently mixed.
 *
 * A negative delta (a process died and its time left the total) clamps to 0.
 */
export function cpuPercentOfCore(prevCpuMs, cpuMs, elapsedMs) {
  if (![prevCpuMs, cpuMs, elapsedMs].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  if (elapsedMs <= 0) return null;
  return Math.max(0, ((cpuMs - prevCpuMs) / elapsedMs) * 100);
}

/** Re-express a percent-of-one-core figure against the whole machine. */
export function cpuPercentOfMachine(percentOfCore, cores) {
  if (percentOfCore === null || !Number.isFinite(cores) || cores <= 0) return null;
  return percentOfCore / cores;
}

/** Round to `digits` decimals, passing `null`/non-finite through untouched. */
export function round(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Relative change from `base` to `candidate`, as a fraction (`0.15` = +15 %).
 * `null` when either side is missing, or when the baseline is 0 (a percentage
 * against zero is not a meaningful statement — the absolute delta carries it).
 */
export function relativeDelta(base, candidate) {
  if (typeof base !== "number" || typeof candidate !== "number") return null;
  if (!Number.isFinite(base) || !Number.isFinite(candidate) || base === 0) return null;
  return (candidate - base) / Math.abs(base);
}

/**
 * Summarise one metric across a scenario's samples: the shape every metric in
 * the result document uses. Returns `null` when nothing was measurable, so a
 * missing metric stays visibly missing.
 */
export function summarize(values, digits = 2) {
  const xs = finiteSorted(values);
  if (xs.length === 0) return null;
  return {
    n: xs.length,
    p50: round(percentile(xs, 0.5), digits),
    p95: round(percentile(xs, 0.95), digits),
    mean: round(mean(xs), digits),
    min: round(min(xs), digits),
    max: round(max(xs), digits),
  };
}
