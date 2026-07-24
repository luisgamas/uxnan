"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Apple,
  ChevronDown,
  Download,
  Loader2,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";

import { MacAuthCard, MacAuthDialog } from "./macos-auth";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import {
  detectOs,
  fetchReleaseData,
  guessAppleSilicon,
  MACOS_IS_EXPERIMENTAL,
  OS_LABEL,
  resolveOsDownloads,
  type Channel,
  type DownloadOption,
  type OsKey,
  type ResolvedRelease,
} from "@/lib/releases";
import { links } from "@/lib/site";
import { cn, formatBytes } from "@/lib/utils";

export const OS_ICON: Record<OsKey, typeof Monitor> = {
  windows: Monitor,
  macos: Apple,
  linux: Terminal,
  android: Smartphone,
  unknown: Download,
};

/**
 * Primary download action for the visitor’s OS.
 *
 * - Resolves the best installer (stable, with nightly fallback).
 * - When that channel publishes **several formats** (.exe/.msi, .AppImage/.deb/…,
 *   arm/intel .dmg), a chevron opens a menu of every format so the hero stays
 *   one-click for the default and still offers the rest.
 * - On macOS, the experimental authorisation card sits under the detail line;
 *   clicking any macOS installer also opens a confirmation dialog.
 */
export function DownloadButton({
  size = "lg",
  align = "center",
  secondary = "button",
  extra,
  /** Show the full macOS auth card under the button (hero). */
  showMacAuthCard = false,
}: {
  size?: "md" | "lg";
  align?: "center" | "left";
  secondary?: "button" | "link";
  extra?: React.ReactNode;
  showMacAuthCard?: boolean;
}) {
  const [os, setOs] = useState<OsKey>("unknown");
  const [options, setOptions] = useState<DownloadOption[]>([]);
  const [channel, setChannel] = useState<Channel>("stable");
  const [fallback, setFallback] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [menuOpen, setMenuOpen] = useState(false);
  const [macDialog, setMacDialog] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const detected = detectOs();
    setOs(detected);

    const controller = new AbortController();
    fetchReleaseData(controller.signal)
      .then(({ releases }) => {
        const hasAny = Boolean(releases.stable || releases.nightly);
        const pack = resolveOsDownloads(detected, releases, "stable", guessAppleSilicon());
        if (pack) {
          setOptions(pack.options);
          setChannel(pack.channel);
          setFallback(pack.fallback);
        } else {
          setOptions([]);
        }
        setState(hasAny ? "ready" : "failed");
      })
      .catch(() => setState("failed"));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const Icon = OS_ICON[os];
  const isDesktopOs = os === "windows" || os === "macos" || os === "linux";
  const onAndroid = os === "android";
  const best = options[0] ?? null;
  const hasFormats = options.length > 1;
  const href = onAndroid ? links.playStore : (best?.url ?? links.releases);
  const direct = Boolean(best) && !onAndroid;

  const startDownload = (option: DownloadOption) => {
    // Programmatic navigation keeps multi-format picks working from the menu.
    const a = document.createElement("a");
    a.href = option.url;
    a.setAttribute("download", "");
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (os === "macos" && MACOS_IS_EXPERIMENTAL) {
      setMacDialog(true);
    }
    setMenuOpen(false);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col sm:w-auto",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
        <div ref={rootRef} className="relative flex w-full sm:w-auto">
          {hasFormats ? (
            <div className="flex w-full sm:w-auto">
              <a
                href={href}
                download=""
                onClick={(e) => {
                  if (os === "macos" && MACOS_IS_EXPERIMENTAL) {
                    e.preventDefault();
                    if (best) startDownload(best);
                  }
                }}
                className={buttonClasses(
                  "primary",
                  size,
                  "w-full rounded-r-none sm:w-auto",
                )}
              >
                {state === "loading" ? (
                  <Loader2 className="size-[18px] animate-spin" aria-hidden />
                ) : (
                  <Icon className="size-[18px]" aria-hidden />
                )}
                <span className="whitespace-nowrap">
                  {isDesktopOs ? `Download for ${OS_LABEL[os]}` : "Download"}
                </span>
              </a>
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                aria-label="Other installers for this platform"
                onClick={() => setMenuOpen((v) => !v)}
                className={buttonClasses(
                  "primary",
                  size,
                  "shrink-0 rounded-l-none border-l border-accent-foreground/15 px-3",
                )}
              >
                <ChevronDown
                  className={cn(
                    "size-[18px] transition-transform",
                    menuOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
            </div>
          ) : (
            <a
              href={href}
              {...(direct
                ? { download: "" }
                : { target: "_blank", rel: "noreferrer noopener" })}
              onClick={(e) => {
                if (direct && os === "macos" && MACOS_IS_EXPERIMENTAL && best) {
                  e.preventDefault();
                  startDownload(best);
                }
              }}
              className={buttonClasses("primary", size, "w-full sm:w-auto")}
            >
              {state === "loading" ? (
                <Loader2 className="size-[18px] animate-spin" aria-hidden />
              ) : (
                <Icon className="size-[18px]" aria-hidden />
              )}
              <span className="whitespace-nowrap">
                {onAndroid
                  ? "Get the Android app"
                  : isDesktopOs
                    ? `Download for ${OS_LABEL[os]}`
                    : "Download"}
              </span>
            </a>
          )}

          {menuOpen && hasFormats && (
            <ul
              id={menuId}
              className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 min-w-[16rem] overflow-hidden rounded-xl border border-border bg-surface-raised py-1 sm:left-auto sm:right-0 sm:w-[20rem]"
            >
              {options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => startDownload(option)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken"
                  >
                    <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-medium">{option.hint}</span>
                      <span className="block truncate font-mono text-[12px] text-faint-foreground">
                        {option.filename}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12.5px] tabular-nums text-faint-foreground">
                      {formatBytes(option.size)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {secondary === "button" && (
          <LinkButton
            href="/download/"
            variant="secondary"
            size={size}
            className="w-full sm:w-auto"
          >
            More downloads
          </LinkButton>
        )}
        {extra}
      </div>

      <DownloadDetail
        best={best}
        channel={channel}
        fallback={fallback}
        state={state}
        align={align}
        showLink={secondary === "link"}
        formatCount={options.length}
      />

      {showMacAuthCard && os === "macos" && MACOS_IS_EXPERIMENTAL && (
        <MacAuthCard
          fallback={fallback}
          className={cn(
            "mt-5 w-full max-w-[34rem]",
            align === "center" && "mx-auto",
          )}
        />
      )}

      <MacAuthDialog
        open={macDialog}
        onClose={() => setMacDialog(false)}
        fallback={fallback}
      />
    </div>
  );
}

function DownloadDetail({
  best,
  channel,
  fallback,
  state,
  align,
  showLink,
  formatCount,
}: {
  best: DownloadOption | null;
  channel: Channel;
  fallback: boolean;
  state: "loading" | "ready" | "failed";
  align: "center" | "left";
  showLink: boolean;
  formatCount: number;
}) {
  return (
    <div
      className={cn(
        "mt-3 max-w-[34rem] text-[13.5px] leading-relaxed text-muted-foreground",
        align === "center" ? "text-center" : "text-left",
      )}
    >
      <p className="min-h-[1.25rem]">
        {best ? (
          <>
            {best.hint}
            <span className="text-faint-foreground"> · </span>
            {formatBytes(best.size)}
            <span className="text-faint-foreground">
              {" · "}
              {channel} build
              {fallback ? " (fallback)" : ""}
            </span>
            {formatCount > 1 && (
              <span className="text-faint-foreground">
                {" · "}
                {formatCount} formats — use ▾
              </span>
            )}
          </>
        ) : state === "failed" ? (
          <>Opens GitHub Releases · every platform</>
        ) : state === "ready" ? (
          <>Pick your platform on the downloads page</>
        ) : (
          <>Free and open source · MPL-2.0</>
        )}
        {showLink && (
          <>
            <span className="text-faint-foreground"> · </span>
            <a
              href="/download/"
              className="font-medium text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
            >
              More downloads
            </a>
          </>
        )}
      </p>
    </div>
  );
}

/** Small helper so pages can render a channel's version without re-fetching. */
export function versionLabel(release: ResolvedRelease | null, channel: Channel) {
  return release ? `v${release.version}` : `no ${channel} build`;
}
