"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import { formatCount, isRepoStats, type RepoStats } from "@/lib/repo-stats";

type RepoStatsRowProps = {
  initialStats: RepoStats | null;
};

/**
 * The static build supplies an immediate fallback; the same-origin Pages
 * Function replaces it with a cached, current value after hydration.
 */
export function RepoStatsRow({ initialStats }: RepoStatsRowProps) {
  const [stats, setStats] = useState<RepoStats | null>(initialStats);

  useEffect(() => {
    let active = true;

    fetch("/api/stats", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (active && isRepoStats(value)) setStats(value);
      })
      .catch(() => {
        // The build-time value remains visible when the live endpoint is down.
      });

    return () => {
      active = false;
    };
  }, []);

  if (!stats) return null;

  return (
    <p className="mt-3.5 flex items-center justify-center gap-4 text-[12.5px] text-faint">
      <span className="inline-flex items-center gap-1.5">
        <HugeiconsIcon icon={StarIcon} className="size-3.5 text-amber" />
        <span className="text-muted">{formatCount(stats.stars)}</span>
        stars
      </span>
      <span className="inline-flex items-center gap-1.5">
        <HugeiconsIcon icon={DownloadIcon} className="size-3.5" />
        <span className="text-muted">{formatCount(stats.downloads)}</span>
        downloads
      </span>
    </p>
  );
}
