"use client";

import { Moon, Sun } from "lucide-react";

import { useMounted, useTheme } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const mounted = useMounted();

  return (
    <button
      type="button"
      onClick={toggle}
      // Before hydration we cannot know which class the inline script applied,
      // so the icon is only revealed once the real theme is readable.
      aria-label={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} theme` : "Switch theme"}
      className={cn(
        "grid size-11 place-items-center rounded-xl border border-border bg-surface-raised",
        "text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <span className={cn("transition-opacity", mounted ? "opacity-100" : "opacity-0")}>
        {theme === "dark" ? (
          <Sun className="size-[18px]" aria-hidden />
        ) : (
          <Moon className="size-[18px]" aria-hidden />
        )}
      </span>
    </button>
  );
}
