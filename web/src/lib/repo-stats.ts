export type RepoStats = { stars: number; downloads: number };

const INSTALLER = /\.(exe|msi|dmg|deb|rpm|AppImage|apk|aab)$/i;

/** Keep the public metric limited to files a visitor can install. */
export function isInstallerAsset(name: unknown): boolean {
  return typeof name === "string" && INSTALLER.test(name);
}

export function isRepoStats(value: unknown): value is RepoStats {
  if (typeof value !== "object" || value === null) return false;

  const stats = value as Record<string, unknown>;
  return (
    Number.isInteger(stats.stars) &&
    (stats.stars as number) >= 0 &&
    Number.isInteger(stats.downloads) &&
    (stats.downloads as number) >= 0
  );
}

/** 1_204 → "1,204"; 12_400 → "12.4k". */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return value.toLocaleString("en-US");
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
