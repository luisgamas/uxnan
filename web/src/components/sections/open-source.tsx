import { Reveal } from "@/components/reveal";
import { LICENSE, LINKS } from "@/lib/site";

const PITCH = [
  {
    title: "Change the interface",
    body: "Every surface is Svelte and Rust, and the design tokens live in one file.",
  },
  {
    title: "Teach it a new agent",
    body: "Register any CLI by hand, or wire a real adapter and get status and resume too.",
  },
  {
    title: "Ship your own build",
    body: `${LICENSE}. Build it, patch it, run it on your own machines.`,
  },
];

export function OpenSource() {
  return (
    <section id="open-source" className="relative py-20 sm:py-24">
      <div className="wrap">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="eyebrow">Open source</p>
          <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.9rem)]">
            Free, open, and yours.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
            No paid tier, no key to hand over, no API of ours in the middle.
            Uxnan is built in the open and released under the {LICENSE} — if
            something is missing, the source is right there.
          </p>
        </Reveal>

        <div className="mt-14 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <Reveal>
            <div className="tile h-full overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="size-2.5 rounded-full bg-white/12" />
                <span className="ml-2 font-mono text-[11px] text-faint">
                  ~/code
                </span>
              </div>
              <div className="p-4 font-mono text-[12.5px] leading-[2] sm:p-5">
                <div>
                  <span className="text-live">$</span>{" "}
                  <span className="text-muted">
                    git clone github.com/luisgamas/uxnan
                  </span>
                </div>
                <div className="text-faint">✓ cloned in 3.1s</div>
                <div>
                  <span className="text-live">$</span>{" "}
                  <span className="text-muted">cd uxnandesktop &amp;&amp; npm ci</span>
                </div>
                <div className="text-faint">✓ dependencies installed</div>
                <div>
                  <span className="text-live">$</span>{" "}
                  <span className="text-muted">npm run tauri dev</span>
                </div>
                <div className="text-faint">
                  ▲ Uxnan Desktop <span className="text-brand-lit">dev</span>{" "}
                  running
                </div>
                <div className="text-dim">
                  <span className="text-live">$</span> <span className="caret" />
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <div className="tile flex h-full flex-col justify-between p-6 sm:p-7">
              <ul className="flex flex-col gap-6">
                {PITCH.map((p) => (
                  <li key={p.title}>
                    <h3 className="text-[15px] font-semibold">{p.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                      {p.body}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={LINKS.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-fg px-4 py-2.5 text-[14px] font-semibold text-ink transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                    <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 007.86 10.93c.58.1.79-.25.79-.56v-2c-3.2.69-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.33.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.67 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.18a10.96 10.96 0 015.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.83 1.18 3.08 0 4.41-2.7 5.38-5.27 5.66.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" />
                  </svg>
                  Star it on GitHub
                </a>
                <a
                  href={LINKS.coffee}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13.5px] text-dim underline decoration-line-2 underline-offset-4 transition-colors hover:text-fg"
                >
                  or buy the maintainer a coffee
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
