"use client";

import { useEffect, useRef } from "react";

/**
 * The hero's living background: a field of monospace glyphs that mutate, fall in
 * soft columns, and dissolve before they reach the bottom.
 *
 * Shape — the columns are **not** a uniform curtain. A depth profile keeps the
 * middle of the field shallow (roughly a quarter of the hero) and lets it reach
 * deeper towards the left and right edges, so only the outermost columns ever
 * cross the hero's vertical midpoint. The headline therefore always sits on
 * quiet, near-empty canvas while the composition still feels full corner to
 * corner.
 *
 * Interaction — glyphs near the pointer tint towards the accent blue and lose
 * some of their opacity, so moving the cursor across the field opens a soft,
 * blue-lit hole in it.
 *
 * Cost — plain 2D canvas rather than WebGL: this is a couple of thousand
 * `fillText` calls at 30 fps, it needs no shader pipeline, and it idles
 * completely when scrolled out of view or when the visitor asks for reduced
 * motion. That restraint is the same argument the product makes about itself.
 */

const GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>/\\|=+-*&^%$#@!?;:.,_~";

const CELL_W = 15;
const CELL_H = 21;
const FONT_PX = 13;
/** Radius of the pointer's influence, in CSS pixels. */
const POINTER_RADIUS = 140;
/** Glyph mutation and repaint cadence — 30 fps is plenty and halves the work. */
const FRAME_MS = 1000 / 30;

interface Column {
  /** Deepest row this column is allowed to reach. */
  maxRow: number;
  glyphs: string[];
  /** Head position in rows; negative while the drop is still above the field. */
  head: number;
  speed: number;
  trail: number;
  /** Frames to wait before the next drop starts. */
  cooldown: number;
  /** Per-column dimmer so the field never reads as a flat, uniform grid. */
  gain: number;
}

const randomGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

function readColor(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

export function GlyphField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let columns: Column[] = [];
    let width = 0;
    let height = 0;
    let rafId = 0;
    let last = 0;
    let visible = true;
    // Pointer position in CSS pixels, or null when the cursor is elsewhere.
    let pointer: { x: number; y: number } | null = null;
    let baseColor = "148 152 168";
    let hotColor = "47 107 255";

    const refreshColors = () => {
      baseColor = readColor(canvas, "--glyph", "148 152 168");
      hotColor = readColor(canvas, "--glyph-hot", "47 107 255");
    };

    /**
     * Builds the column silhouette. `shaped` rises steeply only near the edges,
     * which is what keeps the centre shallow and the corners deep.
     */
    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_PX}px ${getComputedStyle(canvas).getPropertyValue("--font-mono") || "monospace"}`;
      ctx.textBaseline = "top";

      const count = Math.ceil(width / CELL_W);
      const totalRows = Math.ceil(height / CELL_H);

      columns = Array.from({ length: count }, (_, i) => {
        const centreOffset = Math.abs((i + 0.5) / count - 0.5) * 2; // 0 centre → 1 edge
        const shaped = Math.pow(centreOffset, 2.2);
        const depth = (0.22 + shaped * 0.48) * (0.82 + Math.random() * 0.36);
        const maxRow = Math.max(3, Math.round(totalRows * Math.min(0.78, depth)));
        return {
          maxRow,
          glyphs: Array.from({ length: maxRow + 1 }, randomGlyph),
          head: -Math.random() * maxRow * 2,
          speed: 0.16 + Math.random() * 0.3,
          trail: 5 + Math.random() * 9,
          cooldown: 0,
          gain: 0.55 + Math.random() * 0.45,
        };
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const fontFamily =
        getComputedStyle(canvas).getPropertyValue("--font-mono").trim() || "monospace";
      ctx.font = `${FONT_PX}px ${fontFamily}`;

      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const x = c * CELL_W;

        for (let r = 0; r <= col.maxRow; r++) {
          const y = r * CELL_H;

          // Dissolve towards the end of the column so it never ends on a hard line.
          const depthFade = 1 - Math.pow(r / (col.maxRow + 1), 1.5);

          // Distance behind the falling head drives the bright trail.
          const behind = col.head - r;
          let pulse = 0;
          if (behind >= 0 && behind < col.trail) {
            pulse = Math.pow(1 - behind / col.trail, 1.8);
          }

          let alpha = (0.15 + pulse * 0.7) * depthFade * col.gain;
          if (alpha < 0.012) continue;

          let color = baseColor;
          if (pointer) {
            const dx = x + CELL_W / 2 - pointer.x;
            const dy = y + CELL_H / 2 - pointer.y;
            const dist = Math.hypot(dx, dy);
            if (dist < POINTER_RADIUS) {
              const near = Math.pow(1 - dist / POINTER_RADIUS, 1.4);
              // Tint towards the accent and let the glyphs recede at the same time.
              color = near > 0.08 ? hotColor : baseColor;
              alpha *= 1 - near * 0.62;
              alpha += near * 0.1;
            }
          }

          ctx.fillStyle = `rgb(${color} / ${alpha.toFixed(3)})`;
          ctx.fillText(col.glyphs[r], x, y);
        }
      }
    };

    const step = (time: number) => {
      rafId = requestAnimationFrame(step);
      if (!visible || time - last < FRAME_MS) return;
      last = time;

      for (const col of columns) {
        if (col.cooldown > 0) {
          col.cooldown -= 1;
        } else {
          col.head += col.speed;
          // The drop dies once its trail has cleared the bottom of the column.
          if (col.head - col.trail > col.maxRow) {
            col.head = -Math.random() * 6;
            col.cooldown = (20 + Math.random() * 130) | 0;
            col.speed = 0.16 + Math.random() * 0.3;
          }
        }
        // A sparse, continuous mutation keeps the whole field alive, not just
        // the columns that currently have a drop running through them.
        for (let i = 0; i < 2; i++) {
          const r = (Math.random() * (col.maxRow + 1)) | 0;
          col.glyphs[r] = randomGlyph();
        }
      }

      draw();
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onPointerLeave = () => {
      pointer = null;
    };

    refreshColors();
    build();
    draw();

    if (!reduceMotion) {
      rafId = requestAnimationFrame(step);
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
    }

    const resizeObserver = new ResizeObserver(() => {
      build();
      draw();
    });
    resizeObserver.observe(canvas);

    // Stop burning frames the moment the hero scrolls away.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    // Follow the light/dark toggle without rebuilding the field.
    const themeObserver = new MutationObserver(() => {
      refreshColors();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      resizeObserver.disconnect();
      io.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
