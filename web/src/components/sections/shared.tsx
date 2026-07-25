import * as React from "react";
import { cn } from "@/lib/utils";

export function Section({
  id,
  children,
  className,
  tone = "default",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "sunken";
}) {
  return (
    <section
      id={id}
      className={cn(
        "section relative",
        tone === "sunken" && "border-y border-border/60 bg-surface",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        align === "center" ? "mx-auto max-w-[52rem] text-center" : "max-w-[46rem]",
        className,
      )}
    >
      {eyebrow && (
        <p className="eyebrow" data-reveal>
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "text-[clamp(2rem,3.6vw,3rem)] font-semibold",
          eyebrow ? "mt-5" : "",
        )}
        data-reveal
        data-reveal-delay="60"
      >
        {title}
      </h2>
      {lead && (
        <p
          className="mt-6 text-[clamp(1.0625rem,1.35vw,1.1875rem)] leading-[1.7] text-muted-foreground"
          data-reveal
          data-reveal-delay="120"
        >
          {lead}
        </p>
      )}
    </div>
  );
}

/** The soft blue-washed card used across the feature surfaces. */
export function WashCard({
  children,
  className,
  delay,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      data-reveal
      data-reveal-delay={delay}
      className={cn(
        "card-wash relative overflow-hidden rounded-2xl border border-border/70 p-7 md:p-8",
        "transition-[border-color,background-color] duration-300",
        "can-hover:hover:border-accent/25",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FeatureTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[1.25rem] font-semibold leading-snug">{children}</h3>;
}

export function FeatureBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("mt-3 text-[15.5px] leading-[1.7] text-muted-foreground", className)}>
      {children}
    </p>
  );
}

/** A small icon tile — the visual anchor at the top of a feature card. */
export function IconTile({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: "accent" | "neutral";
}) {
  return (
    <span
      className={cn(
        "mb-5 grid size-11 place-items-center rounded-xl border",
        tone === "accent"
          ? "border-accent/20 bg-accent-tint text-accent"
          : "border-border bg-surface-raised text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
