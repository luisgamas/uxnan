"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchReleaseData, type RepoStats } from "./releases";
import { DOWNLOADS_FALLBACK, GITHUB_STARS_FALLBACK } from "./site";

/** True only after hydration — guards anything that reads `window`. */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Reveals every `[data-reveal]` element once it enters the viewport by flipping
 * `data-visible`, which `globals.css` animates. One observer for the whole page,
 * re-scanned whenever the DOM changes, so sections don't each carry their own.
 */
export function useRevealOnScroll() {
  useEffect(() => {
    const nodes = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const delay = el.dataset.revealDelay;
          if (delay) el.style.animationDelay = `${delay}ms`;
          el.dataset.visible = "true";
          observer.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    const scan = () => {
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
        if (nodes.has(el)) return;
        nodes.add(el);
        observer.observe(el);
      });
    };

    scan();
    const mutation = new MutationObserver(scan);
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);
}

/**
 * Writes a section's scroll progress (0 → 1) into a CSS custom property on the
 * element itself, so the choreography can be expressed entirely in CSS `calc()`
 * without re-rendering React on every frame.
 *
 * `0` is the moment the section's top reaches the top of the viewport; `1` is
 * when its bottom reaches the bottom.
 *
 * @param varName custom property to write, defaults to `--p`
 */
export function useScrollProgress<T extends HTMLElement>(varName = "--p") {
  const ref = useRef<T>(null);
  const frame = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let stage = "";

    const measure = () => {
      frame.current = 0;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const raw = travel <= 0 ? (rect.top <= 0 ? 1 : 0) : -rect.top / travel;
      const progress = Math.min(1, Math.max(0, raw));
      el.style.setProperty(varName, String(progress));

      // A coarse phase flag so CSS can hide faded-out content from the tab
      // order. Written only when it flips, not on every frame.
      const next = progress > 0.42 ? "far" : "near";
      if (next !== stage) {
        stage = next;
        el.dataset.stage = next;
      }
    };

    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [varName]);

  return ref;
}

/** Tracks whether the page has been scrolled past `offset` (for the sticky header). */
export function useScrolledPast(offset = 12) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > offset);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [offset]);
  return past;
}

export type Theme = "light" | "dark";

/**
 * Light/dark toggle. The initial class is applied by the inline script in
 * `layout.tsx` before first paint (dark by default); this hook only keeps React
 * in sync with it and persists the user's explicit choice.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const apply = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("uxnan-theme", next);
    } catch {
      /* Storage denied — the toggle still works for this visit. */
    }
    setTheme(next);
  }, []);

  const toggle = useCallback(
    () => apply(document.documentElement.classList.contains("dark") ? "light" : "dark"),
    [apply],
  );

  return { theme, setTheme: apply, toggle };
}

/**
 * Live repo stats — stars, and the summed download count of every release
 * asset ever published — shared by every surface that shows them (the hero's
 * own stats line, the mobile menu overlay) so there is exactly one fetch
 * implementation and one fallback behaviour to keep honest.
 *
 * Starts from the static floors (`GITHUB_STARS_FALLBACK`, `DOWNLOADS_FALLBACK`)
 * so a caller never renders a blank or a loading state, then swaps to the live
 * numbers the moment the public API answers. A rate-limited or failed fetch
 * just keeps the floor — see `docs/content.md`.
 */
export function useRepoStats(): RepoStats {
  const [stats, setStats] = useState<RepoStats>({
    stars: GITHUB_STARS_FALLBACK,
    downloads: DOWNLOADS_FALLBACK,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchReleaseData(controller.signal)
      .then((data) => {
        if (data.stats) setStats(data.stats);
      })
      .catch(() => {
        /* Keep the static floor — a failed or rate-limited fetch is not a
         * reason to show a blank or a broken counter. */
      });
    return () => controller.abort();
  }, []);

  return stats;
}

/** Closes a popover on outside click and on Escape. */
export function useDismissable(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}
