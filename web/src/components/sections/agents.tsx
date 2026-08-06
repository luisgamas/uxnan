import { Reveal } from "@/components/reveal";
import { AGENTS, INVERT_ON_DARK } from "@/lib/site";

export function Agents() {
  return (
    <section id="agents" className="relative py-20 sm:py-28">
      <div className="wrap">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="eyebrow">Bring your own agent</p>
          <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.9rem)]">
            If it runs in your terminal, it runs in Uxnan.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
            Seven agents get first-class treatment: precise working / waiting /
            done status, session resume, live model discovery and per-agent run
            options. Any other CLI you register launches exactly the same way.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <div className="mx-auto mt-12 grid max-w-[52rem] grid-cols-2 gap-2.5 sm:grid-cols-4">
            {AGENTS.map((a) => (
              <div
                key={a.id}
                className="tile group flex items-center gap-3 px-3.5 py-3 transition-colors duration-200 hover:border-line-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-line bg-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.icon}
                    alt=""
                    className={`size-4 object-contain ${INVERT_ON_DARK.has(a.id) ? "invert" : ""}`}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium">
                    {a.name}
                  </span>
                  {"note" in a && a.note ? (
                    <span className="block text-[10.5px] text-faint">
                      partial support
                    </span>
                  ) : null}
                </span>
              </div>
            ))}

            <div className="flex items-center justify-center rounded-[14px] border border-dashed border-line px-3.5 py-3 text-[13px] text-dim">
              + any CLI agent
            </div>
          </div>
        </Reveal>

        <Reveal delay={140}>
          <p className="mx-auto mt-10 max-w-[54ch] text-center text-[14.5px] leading-relaxed text-dim">
            Every one of them runs as that vendor&apos;s own official binary,
            under the account you already signed it in with. Uxnan never calls a
            provider API, holds a key, or embeds an SDK — it drives the
            terminal, exactly like you would.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
