import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the interface recreations on this page.
 *
 * These are not screenshots. Every panel below is real DOM, so it stays sharp at
 * any resolution, follows the light/dark toggle, and can be driven frame by
 * frame from the scroll position — none of which a rendered image or video can
 * do.
 */

export type AgentStatus = "working" | "needs-you" | "done" | "idle";

export const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "bg-accent",
  "needs-you": "bg-warning",
  done: "bg-positive",
  idle: "bg-faint-foreground/60",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
  idle: "Idle",
};

export function StatusDot({
  status,
  pulse = false,
  className,
}: {
  status: AgentStatus;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "size-[7px] shrink-0 rounded-full",
        STATUS_COLOR[status],
        className,
      )}
      style={
        pulse ? { animation: "ux-pulse-dot 1.9s ease-in-out infinite" } : undefined
      }
    />
  );
}

/** The app window shell: rounded frame, hairline border, flat (no elevation). */
export function WindowFrame({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl bg-surface-raised hairline",
        className,
      )}
    >
      {title !== undefined && <TitleBar>{title}</TitleBar>}
      {children}
    </div>
  );
}

export function TitleBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 bg-surface px-3">
      <span className="flex gap-1.5">
        <span className="size-[7px] rounded-full bg-danger/70" />
        <span className="size-[7px] rounded-full bg-warning/70" />
        <span className="size-[7px] rounded-full bg-positive/70" />
      </span>
      <div className="ml-1 min-w-0 flex-1 truncate text-[10px] font-medium text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/** A section header inside a sidebar or panel — 11px, uppercase, muted. */
export function PanelLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2.5 py-1.5 text-[9px] font-medium uppercase tracking-[0.11em] text-faint-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "positive" | "warning";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-sunken text-muted-foreground",
    accent: "bg-accent-tint text-accent",
    positive: "bg-positive/12 text-positive",
    warning: "bg-warning/15 text-warning",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A blinking terminal caret. */
export function Caret() {
  return (
    <span
      className="ml-px inline-block h-[11px] w-[6px] translate-y-[2px] bg-accent"
      style={{ animation: "ux-caret 1.1s step-end infinite" }}
    />
  );
}

/**
 * An agent's CLI logo on a light chip.
 *
 * The marks come straight from the apps' own asset folders and are a mix of full
 * colour, flat black and `currentColor`. Putting every one of them on the same
 * light tile means all of them stay legible in both themes without per-logo
 * filters or invert hacks.
 */
export function AgentMark({
  logo,
  name,
  className,
  imgClassName,
}: {
  logo: string;
  name: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-white ring-1 ring-black/[0.06] dark:ring-white/10",
        className,
      )}
      title={name}
    >
      <img
        src={`/agents/${logo}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className={cn("size-[62%] object-contain text-black", imgClassName)}
      />
    </span>
  );
}

/** Placeholder text as a soft bar — used where real copy would be noise. */
export function Bar({
  w,
  className,
  tone = "muted",
}: {
  w: string;
  className?: string;
  tone?: "muted" | "strong" | "faint";
}) {
  const tones = {
    strong: "bg-foreground/25 dark:bg-foreground/35",
    muted: "bg-foreground/15 dark:bg-foreground/22",
    faint: "bg-foreground/9 dark:bg-foreground/14",
  } as const;
  return (
    <span
      className={cn("block h-[5px] rounded-full", tones[tone], className)}
      style={{ width: w }}
    />
  );
}
