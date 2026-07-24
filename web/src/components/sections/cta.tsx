import { Coffee, Github, Scale, ShieldCheck } from "lucide-react";

import { DownloadButton } from "@/components/site/download-button";
import { LinkButton } from "@/components/ui/button";
import { links } from "@/lib/site";

const PILLARS = [
  {
    icon: Scale,
    title: "MPL-2.0",
    body: "Apps, bridge, relay, contracts. Fork it, audit it, ship your own build.",
  },
  {
    icon: ShieldCheck,
    title: "Open protocol",
    body: "E2EE and JSON-RPC are written in the public repo — not reverse-engineered from a binary.",
  },
] as const;

export function Cta() {
  return (
    <section
      id="download"
      className="section relative isolate overflow-hidden border-y border-border/70"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-accent-tint"
        style={{
          backgroundImage:
            "linear-gradient(180deg, color-mix(in oklab, var(--accent) 11%, var(--accent-tint)) 0%, var(--accent-tint) 58%, var(--accent-tint) 100%)",
        }}
      />

      <div className="shell text-center">
        <p className="eyebrow justify-center" data-reveal>
          <span className="size-1.5 rounded-full bg-positive" />
          Open source
        </p>

        <h2
          className="mx-auto mt-5 max-w-[18ch] text-[clamp(2rem,4vw,3.25rem)] font-semibold"
          data-reveal
          data-reveal-delay="60"
        >
          Start with the app that hurts less to wait on.
        </h2>

        <p
          className="mx-auto mt-6 max-w-[48ch] text-[clamp(1.0625rem,1.4vw,1.1875rem)] leading-[1.7] text-muted-foreground"
          data-reveal
          data-reveal-delay="120"
        >
          Desktop for a light PC workspace. Mobile for remote control without a vendor
          leash. Same public repository either way — no paid tier at the bottom of the
          page.
        </p>

        <div className="mt-11 flex justify-center" data-reveal data-reveal-delay="180">
          <DownloadButton
            secondary="link"
            extra={
              <LinkButton
                href={links.github}
                target="_blank"
                rel="noreferrer noopener"
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <Github className="size-[18px]" aria-hidden />
                Read the source
              </LinkButton>
            }
          />
        </div>

        <div className="mx-auto mt-16 grid max-w-[40rem] gap-8 text-left sm:grid-cols-2">
          {PILLARS.map((pillar, index) => (
            <div key={pillar.title} data-reveal data-reveal-delay={index * 70}>
              <span className="mb-4 grid size-10 place-items-center rounded-xl border border-accent/20 bg-surface-raised text-accent">
                <pillar.icon className="size-[18px]" aria-hidden />
              </span>
              <h3 className="text-[1.0625rem] font-semibold">{pillar.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.7] text-muted-foreground">
                {pillar.body}
              </p>
            </div>
          ))}
        </div>

        <p
          className="mx-auto mt-14 flex max-w-[52ch] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[15px] text-muted-foreground"
          data-reveal
        >
          <Coffee className="size-4 text-faint-foreground" aria-hidden />
          Built in spare time.
          <a
            href={links.sponsor}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-accent hover:underline"
          >
            Sponsoring
          </a>
          or
          <a
            href={links.coffee}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-accent hover:underline"
          >
            a coffee
          </a>
          keeps it moving.
        </p>
      </div>
    </section>
  );
}
