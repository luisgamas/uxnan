import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1234 → "1.2k". Used for star / download counters. */
export function compactNumber(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Maps t from [inMin, inMax] onto [outMin, outMax], clamped at both ends. */
export function mapRange(
  t: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const p = Math.min(1, Math.max(0, (t - inMin) / (inMax - inMin)));
  return outMin + p * (outMax - outMin);
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Standard ease-out cubic — the curve the scroll choreography is drawn to. */
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
