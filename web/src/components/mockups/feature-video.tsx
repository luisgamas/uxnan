"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * A short, silent, real screen recording of the app — captured footage, not
 * another DOM recreation. Muted, looping, and lazy in two senses:
 *
 * - The `src` is only attached once the clip scrolls near the viewport, so a
 *   visitor who never reaches this section never fetches three video files.
 * - Playback never starts under `prefers-reduced-motion` — the clip still
 *   loads (so the frame is not empty), it simply sits on its first frame.
 *
 * Files live at `public/videos/<slug>.mp4` (H.264, no audio track). Until a
 * given file is dropped in, this renders an empty, correctly-sized frame
 * instead of a broken-media icon.
 *
 * The source is a fixed 1280×720 (16:9) capture, cropped by `object-fit:
 * cover` into the card's 4:3 frame — that only ever trims width (25% of it;
 * height always matches exactly), so `objectPosition`'s X is what matters and
 * its Y rides along for free. Per-clip values live in `features.tsx`, chosen
 * by seeking the real files frame by frame so the action each clip is named
 * for — not just whatever the centre happened to hold — stays in frame.
 */
export function FeatureVideo({
  slug,
  className,
  objectPosition = "50% 50%",
}: {
  slug: string;
  className?: string;
  objectPosition?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!video.src) video.src = `/videos/${slug}.mp4`;
        if (!reduceMotion) video.play().catch(() => {});
        io.disconnect();
      },
      { rootMargin: "160px" },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [slug]);

  return (
    <video
      ref={ref}
      className={cn("size-full object-cover", className)}
      style={{ objectPosition }}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
    />
  );
}
