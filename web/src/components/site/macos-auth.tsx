"use client";

import { useEffect, useState } from "react";
import { Check, Copy, TriangleAlert, X } from "lucide-react";

import { links, MACOS_QUARANTINE_COMMAND } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Full orange card: how to authorise the experimental macOS build once.
 * Used under the hero download row and inside the post-download dialog.
 */
export function MacAuthCard({
  className,
  fallback,
}: {
  className?: string;
  /** True when the build is only on nightly. */
  fallback?: boolean;
}) {
  return (
    <div
      className={cn(
        // Opaque base (surface-raised + solid warning mix) — never alpha-only
        // yellow, or the card disappears over a modal scrim.
        "rounded-2xl border border-warning/40 p-5 text-left md:p-6",
        "bg-surface-raised",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(180deg, color-mix(in oklab, var(--warning) 14%, var(--surface-raised)) 0%, var(--surface-raised) 72%)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-warning/35 bg-surface-raised text-warning">
          <TriangleAlert className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[1.0625rem] font-semibold leading-snug text-foreground">
            macOS is experimental — authorise once
          </h3>
          <p className="mt-2 text-[14.5px] leading-[1.65] text-muted-foreground">
            Builds are unsigned (not notarised). Open the{" "}
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">
              .dmg
            </code>
            , drag into{" "}
            <b className="font-medium text-foreground">Applications</b>, then use{" "}
            <b className="font-medium text-foreground">
              System Settings → Privacy &amp; Security → Open Anyway
            </b>
            , or run this in Terminal:
          </p>
          {fallback && (
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              This build is currently on the{" "}
              <b className="font-medium text-foreground">nightly</b> channel only.
            </p>
          )}
          <CopyCommand command={MACOS_QUARANTINE_COMMAND} className="mt-4" />
          <a
            href={links.macosGuide}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-[14px] font-medium text-accent hover:underline"
          >
            Full macOS install guide →
          </a>
        </div>
      </div>
    </div>
  );
}

/** Modal shown right after a macOS installer download starts. */
export function MacAuthDialog({
  open,
  onClose,
  fallback,
}: {
  open: boolean;
  onClose: () => void;
  fallback?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--foreground)_55%,transparent)] backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="macos-auth-title"
        className="relative z-10 w-full max-w-[32rem] overflow-hidden rounded-2xl border border-border bg-surface-raised"
      >
        <div className="relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-lg border border-border bg-surface-raised text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden />
          </button>
          <MacAuthCard
            fallback={fallback}
            className="rounded-none border-0 pr-12 shadow-none"
          />
          <p id="macos-auth-title" className="sr-only">
            macOS authorisation required
          </p>
        </div>
        <div className="border-t border-border bg-surface-raised p-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-border bg-surface py-3 text-[15px] font-medium text-foreground hover:bg-surface-sunken"
          >
            Got it — download started
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyCommand({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-surface-sunken p-2",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-[12.5px] text-foreground">
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-surface-sunken"
        aria-label="Copy command"
      >
        {copied ? (
          <Check className="size-4 text-positive" aria-hidden />
        ) : (
          <Copy className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>
    </div>
  );
}
