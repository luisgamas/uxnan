"use client";

import { useEffect, useState } from "react";
import {
  Apple,
  Check,
  Copy,
  Download,
  Loader2,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";

import { MacAuthDialog } from "@/components/site/macos-auth";
import { SiteShell } from "@/components/site/site-shell";
import { LinkButton } from "@/components/ui/button";
import {
  detectOs,
  downloadOptionsFor,
  fetchReleaseData,
  guessAppleSilicon,
  type Channel,
  type DownloadOption,
  type OsKey,
  type ResolvedRelease,
} from "@/lib/releases";
import {
  BRIDGE_INSTALL_COMMAND,
  links,
  PHONE_AGENT_COUNT,
} from "@/lib/site";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Every installer, in one place.
 *
 * Desktop: three equal columns with stable + nightly. Mobile + bridge below.
 * macOS authorisation is a dialog after a macOS download starts — not a permanent
 * yellow panel on the page.
 */
export default function DownloadClient() {
  const [releases, setReleases] = useState<Record<Channel, ResolvedRelease | null>>({
    stable: null,
    nightly: null,
  });
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [os, setOs] = useState<OsKey>("unknown");
  const [appleSilicon, setAppleSilicon] = useState(true);
  const [macDialog, setMacDialog] = useState(false);

  useEffect(() => {
    setOs(detectOs());
    setAppleSilicon(guessAppleSilicon());
    const controller = new AbortController();
    fetchReleaseData(controller.signal)
      .then((data) => {
        setReleases(data.releases);
        setState(data.releases.stable || data.releases.nightly ? "ready" : "failed");
      })
      .catch(() => setState("failed"));
    return () => controller.abort();
  }, []);

  const onMacDownload = () => setMacDialog(true);

  return (
    <SiteShell minimalHeader>
      <div className="shell pb-24 pt-[140px] md:pb-32">
        <div className="mx-auto max-w-[52rem] text-center">
          <p className="eyebrow justify-center">Downloads</p>
          <h1 className="mt-5 text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold">
            Get Uxnan
          </h1>
          <p className="mx-auto mt-6 max-w-[54ch] text-[17px] leading-[1.7] text-muted-foreground">
            Two independent products. Desktop installs on its own; Mobile needs the
            bridge on your PC and nothing else. Free under MPL-2.0.
          </p>
        </div>

        <div className="mt-14 lg:mt-16">
          <h2 className="text-center text-[1.25rem] font-semibold" data-reveal>
            Uxnan Desktop
          </h2>
          <div className="mt-8 grid gap-5 lg:grid-cols-3 lg:gap-6">
            <DesktopPlatformCard
              id="windows"
              title="Windows"
              icon={Monitor}
              detected={os === "windows"}
              stable={downloadOptionsFor("windows", releases.stable)}
              nightly={downloadOptionsFor("windows", releases.nightly)}
              state={state}
              stableVersion={releases.stable?.version}
              nightlyVersion={releases.nightly?.version}
            />
            <DesktopPlatformCard
              id="linux"
              title="Linux"
              icon={Terminal}
              detected={os === "linux"}
              stable={downloadOptionsFor("linux", releases.stable)}
              nightly={downloadOptionsFor("linux", releases.nightly)}
              state={state}
              stableVersion={releases.stable?.version}
              nightlyVersion={releases.nightly?.version}
            />
            <DesktopPlatformCard
              id="macos"
              title="macOS"
              icon={Apple}
              detected={os === "macos"}
              experimental
              experimentalNote={
                appleSilicon
                  ? "Experimental — unsigned. Your Mac looks like Apple Silicon."
                  : "Experimental — unsigned. Your Mac looks like Intel."
              }
              stable={downloadOptionsFor("macos", releases.stable, appleSilicon)}
              nightly={downloadOptionsFor("macos", releases.nightly, appleSilicon)}
              state={state}
              stableVersion={releases.stable?.version}
              nightlyVersion={releases.nightly?.version}
              onDownload={onMacDownload}
            />
          </div>
        </div>

        <div id="mobile" className="scroll-mt-28 mt-14 lg:mt-16" data-reveal>
          <h2 className="text-center text-[1.25rem] font-semibold">Uxnan Mobile</h2>
          <div className="mx-auto mt-8 grid max-w-[56rem] gap-5 md:grid-cols-2 md:gap-6">
            <div className="rounded-2xl border border-border bg-surface-raised p-7 md:p-8">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-xl border border-border bg-surface text-muted-foreground">
                  <Smartphone className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-[1.125rem] font-semibold">Android</h3>
                  {os === "android" && (
                    <span className="text-[13px] font-medium text-accent">Your platform</span>
                  )}
                </div>
              </div>
              <LinkButton
                href={links.playStore}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-6 w-full"
              >
                Get it on Google Play
              </LinkButton>
              <p className="mt-5 text-[14.5px] leading-[1.65] text-muted-foreground">
                <span className="font-medium text-foreground">iOS — coming soon.</span>{" "}
                You can build it yourself; see the{" "}
                <a
                  href={links.mobileReadme}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-accent hover:underline"
                >
                  mobile docs
                </a>
                .
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface-raised p-7 md:p-8">
              <h3 className="text-[1.125rem] font-semibold">The bridge</h3>
              <p className="mt-3 text-[15px] leading-[1.7] text-muted-foreground">
                One small daemon on your PC — the only thing Mobile needs. Not Uxnan
                Desktop. Unlocks all {PHONE_AGENT_COUNT} agents under the projects you
                start it from.
              </p>
              <CopyCommand command={BRIDGE_INSTALL_COMMAND} className="mt-5" />
              <a
                href={links.bridgeInstall}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-block text-[14px] font-medium text-accent hover:underline"
              >
                Installation &amp; autostart guide →
              </a>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-14 max-w-[48ch] text-center text-[14px] leading-[1.65] text-faint-foreground">
          Installers are served from{" "}
          <a
            href={links.releases}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-accent"
          >
            GitHub Releases
          </a>{" "}
          with checksums. Desktop can update itself on the channel you pick.
        </p>
      </div>

      <MacAuthDialog open={macDialog} onClose={() => setMacDialog(false)} />
    </SiteShell>
  );
}

/* -------------------------------------------------------------------------- */

function DesktopPlatformCard({
  id,
  title,
  icon: Icon,
  detected,
  experimental,
  experimentalNote,
  stable,
  nightly,
  state,
  stableVersion,
  nightlyVersion,
  onDownload,
}: {
  id: string;
  title: string;
  icon: typeof Monitor;
  detected: boolean;
  experimental?: boolean;
  experimentalNote?: string;
  stable: DownloadOption[];
  nightly: DownloadOption[];
  state: "loading" | "ready" | "failed";
  stableVersion?: string;
  nightlyVersion?: string;
  /** Fired when an installer link is activated (macOS → auth dialog). */
  onDownload?: () => void;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-28 flex flex-col rounded-2xl border border-border bg-surface-raised p-6 md:p-7",
        detected && "border-accent/40",
      )}
      data-reveal
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted-foreground">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <h3 className="text-[1.125rem] font-semibold">{title}</h3>
        {detected && (
          <span className="rounded-full bg-accent-tint px-2.5 py-0.5 text-[11.5px] font-medium text-accent">
            Your platform
          </span>
        )}
        {experimental && (
          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[11.5px] font-medium text-warning">
            Experimental
          </span>
        )}
      </div>

      {experimentalNote && (
        <p className="mt-3 text-[13.5px] leading-[1.6] text-muted-foreground">
          {experimentalNote}
        </p>
      )}

      <div className="mt-5 flex flex-1 flex-col gap-5">
        <ChannelBlock
          label="Stable"
          version={stableVersion}
          options={stable}
          state={state}
          onDownload={onDownload}
        />
        <ChannelBlock
          label="Nightly"
          version={nightlyVersion}
          options={nightly}
          state={state}
          onDownload={onDownload}
        />
      </div>
    </section>
  );
}

function ChannelBlock({
  label,
  version,
  options,
  state,
  onDownload,
}: {
  label: string;
  version?: string;
  options: DownloadOption[];
  state: "loading" | "ready" | "failed";
  onDownload?: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-faint-foreground">
          {label}
        </span>
        {version && (
          <span className="truncate font-mono text-[12px] text-faint-foreground" title={version}>
            v{version.split("-")[0]}
          </span>
        )}
      </div>

      {state === "loading" ? (
        <p className="flex items-center gap-2 text-[14px] text-faint-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Looking up…
        </p>
      ) : options.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-[13.5px] text-muted-foreground">
          No build on this channel yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {options.map((option) => (
            <li key={option.id}>
              <a
                href={option.url}
                download=""
                onClick={() => onDownload?.()}
                className="group flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent/40 hover:bg-accent-tint"
              >
                <Download
                  className="size-4 shrink-0 text-muted-foreground group-hover:text-accent"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium leading-snug">
                    {option.hint}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-faint-foreground">
                  {formatBytes(option.size)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
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
        "flex items-center gap-2 rounded-lg border border-border bg-surface p-2",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-[13px]">
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
