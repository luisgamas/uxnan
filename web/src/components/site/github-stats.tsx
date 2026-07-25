"use client";

import { useEffect, useState } from "react";
import { Download, Star } from "lucide-react";

import { fetchReleaseData, type RepoStats } from "@/lib/releases";
import { links } from "@/lib/site";
import { cn, compactNumber } from "@/lib/utils";

/**
 * Live GitHub counters — stars, and the summed download count of every release
 * asset ever published. Renders nothing until the numbers actually arrive, so
 * the page never shows a placeholder zero that then jumps.
 */
export function GitHubStats({ className }: { className?: string }) {
  const [stats, setStats] = useState<RepoStats | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchReleaseData(controller.signal)
      .then((data) => setStats(data.stats))
      .catch(() => setStats(null));
    return () => controller.abort();
  }, []);

  if (!stats) return null;

  return (
    <a
      href={links.github}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-3 rounded-full border border-border bg-surface-raised px-3.5 py-1.5",
        "text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      {stats.stars > 0 && (
        <span className="flex items-center gap-1.5">
          <Star className="size-3.5 text-warning" aria-hidden />
          <span className="font-medium text-foreground">
            {compactNumber(stats.stars)}
          </span>
          <span className="sr-only">GitHub stars</span>
        </span>
      )}
      {stats.stars > 0 && stats.downloads > 0 && (
        <span aria-hidden className="h-3.5 w-px bg-border" />
      )}
      {stats.downloads > 0 && (
        <span className="flex items-center gap-1.5">
          <Download className="size-3.5 text-accent" aria-hidden />
          <span className="font-medium text-foreground">
            {compactNumber(stats.downloads)}
          </span>
          <span>downloads</span>
        </span>
      )}
    </a>
  );
}
