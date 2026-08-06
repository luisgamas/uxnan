"use client";

import { useEffect, useState } from "react";
import { LINKS } from "@/lib/site";

type OS = "windows" | "macos" | "linux" | null;

function detect(): OS {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows|Win64|WOW64/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "macos";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

const LABEL: Record<NonNullable<OS>, string> = {
  windows: "Download for Windows",
  macos: "Download for macOS",
  linux: "Download for Linux",
};

/**
 * The label resolves to the visitor's platform after hydration; the server
 * render is the neutral one, so no layout shift and no wrong label in the HTML.
 */
export function DownloadButton({
  size = "lg",
  className = "",
}: {
  size?: "lg" | "sm";
  className?: string;
}) {
  const [os, setOs] = useState<OS>(null);
  useEffect(() => setOs(detect()), []);

  const label = os ? LABEL[os] : "Download for desktop";
  const pad = size === "lg" ? "px-5 py-3 text-[15px]" : "px-3.5 py-2 text-[13px]";

  return (
    <a
      href={LINKS.releases}
      className={`group inline-flex items-center justify-center gap-2 rounded-xl bg-fg font-semibold text-ink transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white ${pad} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={size === "lg" ? "size-4" : "size-3.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
      </svg>
      {label}
    </a>
  );
}
