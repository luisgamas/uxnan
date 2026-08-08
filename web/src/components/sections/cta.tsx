import { HugeiconsIcon } from "@hugeicons/react";
import CoffeeIcon from "@hugeicons/core-free-icons/Coffee02Icon";
import HeartIcon from "@hugeicons/core-free-icons/HeartIcon";
import { DownloadButton } from "@/components/download-button";
import { Reveal } from "@/components/reveal";
import { LICENSE, LINKS, SITE } from "@/lib/site";

export function Cta() {
  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 100%, rgba(27,110,243,0.16), transparent 72%)",
        }}
      />

      <div className="wrap relative text-center">
        <Reveal>
          <h2 className="display mx-auto max-w-[16ch] text-[clamp(2.1rem,5vw,3.6rem)]">
            Give your agents somewhere to work.
          </h2>
          <p className="mx-auto mt-6 max-w-[54ch] text-[1.0625rem] leading-relaxed text-muted">
            Install it, sign your agents in the way you already do, and let them
            run. Your machine stays usable, and your phone keeps the thread.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <DownloadButton />
            <a
              href={LINKS.play}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-line px-5 py-3 text-[15px] text-muted transition-colors hover:border-line-2 hover:text-fg"
            >
              Get it on Google Play
            </a>
          </div>

          <p className="mx-auto mt-8 max-w-[58ch] text-[12.5px] leading-relaxed text-faint">
            Honest heads-up: the Windows and macOS builds aren&apos;t
            code-signed yet, so SmartScreen and Gatekeeper will warn you on first
            run.{" "}
            <a
              href={LINKS.macInstall}
              target="_blank"
              rel="noopener noreferrer"
              className="text-dim underline decoration-line-2 underline-offset-4 transition-colors hover:text-fg"
            >
              How to get past it
            </a>
            . That&apos;s an alpha without a signing certificate, not a sign
            anything is wrong.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const FOOTER_LINKS = [
  { label: "GitHub", href: LINKS.repo },
  { label: "Uxnan Desktop", href: LINKS.releasesAll },
  { label: "Uxnan Mobile (Android)", href: LINKS.play },
  { label: "Bridge", href: LINKS.bridgeNpm },
  { label: "Security", href: LINKS.security },
];

/* Each support link hovers into its own brand colour: GitHub Sponsors pink,
   Buy Me a Coffee yellow. */
const SUPPORT = [
  {
    label: "Sponsor on GitHub",
    href: LINKS.sponsor,
    icon: <HugeiconsIcon icon={HeartIcon} className="size-4" />,
    hover: "#db61a2",
  },
  {
    label: "Buy the maintainer a coffee",
    href: LINKS.coffee,
    icon: <HugeiconsIcon icon={CoffeeIcon} className="size-4" />,
    hover: "#ffdd00",
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line py-12">
      <div className="wrap flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 text-[12.5px] text-faint">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="size-5 rounded-[5px]" />
            <span>
              © {year} {SITE.name} · {LICENSE}
            </span>
          </div>

          <p className="mt-3 max-w-[46ch] text-[12px] text-faint italic">
            {SITE.disclaimer}
          </p>

          <div className="mt-4 flex items-center gap-2">
            {SUPPORT.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                title={s.label}
                className="grid size-9 place-items-center rounded-lg border border-line text-dim transition-colors duration-200 hover:border-[color:var(--hover)] hover:text-[color:var(--hover)]"
                style={{ "--hover": s.hover } as React.CSSProperties}
              >
                {s.icon}
              </a>
            ))}
          </div>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-3 text-[12.5px] text-dim sm:justify-end">
          {FOOTER_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-fg"
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
