import { HugeiconsIcon } from "@hugeicons/react";
import DownloadIcon from "@hugeicons/core-free-icons/Download01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import { DownloadButton } from "@/components/download-button";
import { DesktopWindow } from "@/components/mockups/desktop";
import { Phone, PhoneConversations } from "@/components/mockups/phone";
import { formatCount, getRepoStats } from "@/lib/github";
import { LICENSE, LINKS, PLATFORM_LINE } from "@/lib/site";

export async function Hero() {
  const stats = await getRepoStats();

  return (
    <section id="top" className="relative isolate overflow-hidden pt-14 sm:pt-20">
      {/* ambient light */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[620px] opacity-70"
        style={{
          background:
            "radial-gradient(58% 52% at 50% 40%, rgba(27,110,243,0.16), transparent 70%), radial-gradient(38% 40% at 78% 12%, rgba(0,200,150,0.10), transparent 70%)",
        }}
      />
      {/* grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-[0.055]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(70% 70% at 50% 0%, black 10%, transparent 75%)",
        }}
      />

      <div className="wrap relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/60 px-3 py-1.5 text-[12px] text-muted">
          Free and Open Source · {LICENSE}
        </span>

        {stats ? (
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
        ) : null}

        <h1 className="display mx-auto mt-7 max-w-[17ch] text-[clamp(2.4rem,6.4vw,4.5rem)]">
          Your agents don&apos;t need you watching.
        </h1>

        <p className="mx-auto mt-6 max-w-[62ch] text-[clamp(1rem,1.5vw,1.175rem)] leading-relaxed text-muted">
          Uxnan Desktop runs Claude Code, Codex, OpenCode and four more side by
          side — each in its own worktree, on a machine you can still use. Uxnan
          Mobile puts all of them in your pocket.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <DownloadButton />
          <a
            href={LINKS.play}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-line px-5 py-3 text-[15px] text-muted transition-colors hover:border-line-2 hover:text-fg"
          >
            Get the phone app
            <span aria-hidden>→</span>
          </a>
        </div>

        <a
          href={LINKS.releasesAll}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-block text-[13px] text-dim underline decoration-line-2 underline-offset-4 transition-colors hover:text-fg"
        >
          Other platforms
        </a>

        <p className="mt-2.5 text-[12.5px] text-faint">{PLATFORM_LINE}</p>
      </div>

      {/* ── The product, drawn in the browser ─────────────────────────── */}
      <div className="relative mt-14 sm:mt-20">
        <div
          className="wrap relative pb-12"
          style={{
            maskImage:
              "linear-gradient(to bottom, black 90%, rgba(0,0,0,0.4) 97%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 90%, rgba(0,0,0,0.4) 97%, transparent 100%)",
          }}
        >
          <div className="relative mx-auto max-w-[1000px]">
            <DesktopWindow />

            <Phone
              width={200}
              className="absolute -right-5 -bottom-4 hidden lg:block xl:-right-12"
            >
              <PhoneConversations />
            </Phone>
          </div>
        </div>
      </div>
    </section>
  );
}
