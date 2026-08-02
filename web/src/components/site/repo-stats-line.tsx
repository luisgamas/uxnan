"use client";

import { Download, Star } from "lucide-react";

import { useRepoStats } from "@/lib/hooks";
import { links } from "@/lib/site";
import { cn, compactNumber } from "@/lib/utils";

/**
 * Plain-text star + download counters — not a pill or a button.
 *
 * There used to be two live counters on the same page (this one, and a
 * bordered pill in the header): the header's `hidden lg:inline-flex` also
 * meant it vanished below `lg`, so a phone visitor saw neither. Now there is
 * exactly one live counter, reused wherever it needs to show — the hero
 * (visible at every width) and the mobile menu overlay — via the shared
 * `useRepoStats` hook, so both surfaces start from the same fallback and swap
 * to the same live numbers together.
 */
export function RepoStatsLine({
  className,
  ...rest
}: { className?: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  const stats = useRepoStats();

  return (
    <p
      className={cn(
        "flex items-center justify-center gap-4 text-[13px] text-faint-foreground",
        className,
      )}
      {...rest}
    >
      <a
        href={links.github}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1.5 hover:text-foreground"
      >
        <Star className="size-3.5" aria-hidden />
        {compactNumber(stats.stars)} stars
      </a>
      <span className="h-3 w-px bg-border" aria-hidden />
      <a
        href={links.releases}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-1.5 hover:text-foreground"
      >
        <Download className="size-3.5" aria-hidden />
        {compactNumber(stats.downloads)} downloads
      </a>
    </p>
  );
}
