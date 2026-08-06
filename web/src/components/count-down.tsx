"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts down from a deliberately bad number to the measured one, and settles
 * from red to green as it lands. Server-rendered with the real value, so the
 * page still states the truth if this never runs.
 */
export function CountDown({
  to,
  from = 999,
  unit = "MB",
  duration = 1400,
}: {
  to: number;
  from?: number;
  unit?: string;
  duration?: number;
}) {
  const [value, setValue] = useState(to);
  const [settled, setSettled] = useState(true);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    setValue(from);
    setSettled(false);

    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();

        const started = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - started) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          setValue(Math.round(from + (to - from) * eased));
          if (progress < 1) frame = requestAnimationFrame(step);
          else setSettled(true);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.5 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, from, duration]);

  /* Red while it is falling, green as it lands, white once it settles — the
     colour tells the same story as the number. */
  const progress = from === to ? 1 : (from - value) / (from - to);
  const colour = settled
    ? "var(--color-fg)"
    : `color-mix(in oklab, var(--color-live) ${Math.round(progress * 100)}%, var(--color-danger))`;

  return (
    <span
      ref={ref}
      className="tabular-nums transition-colors duration-700"
      style={{ color: colour }}
    >
      {value} {unit}
    </span>
  );
}
