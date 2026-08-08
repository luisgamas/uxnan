import { Reveal } from "@/components/reveal";
import { AGENTS_BASIC, AGENTS_PRECISE } from "@/lib/site";

type Agent = { id: string; name: string; icon: string; note?: string };

/** One agent: mark on the left, name on the right — the row shape the rest of
 *  the page uses. Compact on purpose: there are thirty of them. */
function AgentTile({ agent, dim }: { agent: Agent; dim?: boolean }) {
  return (
    <div
      className={`tile group flex items-center gap-3 px-3.5 py-3 transition-colors duration-200 hover:border-line-2 ${
        dim ? "opacity-80" : ""
      }`}
    >
      {/* A light chip, not a dark one: most of these marks are the vendor's own
          favicon, drawn for a white page — half of them (OpenCode, Kimi, Devin,
          MiMo, Command Code…) are dark shapes that disappear on a dark tile.
          On white they all read, and the drawn black marks need no inverting. */}
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-line bg-white/92">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={agent.icon} alt="" className="size-[18px] object-contain" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium">
          {agent.name}
        </span>
        {agent.note ? (
          <span className="block text-[10.5px] text-faint">partial support</span>
        ) : null}
      </span>
    </div>
  );
}

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
            {AGENTS_PRECISE.length} agents report precise status — working,
            waiting, blocked, done — plus session resume, live model discovery
            and per-agent run options. Any other CLI you register launches
            exactly the same way.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <div className="mx-auto mt-12 grid max-w-[56rem] grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {AGENTS_PRECISE.map((a) => (
              <AgentTile key={a.id} agent={a} />
            ))}
          </div>
        </Reveal>

        <Reveal delay={120}>
          <p className="mx-auto mt-12 max-w-[54ch] text-center text-[14.5px] leading-relaxed text-dim">
            These launch and run the same way, and show a working/idle
            indicator — their CLI just has no way to say a turn ended, so uxnan
            doesn&apos;t claim a precise state it can&apos;t know.
          </p>
        </Reveal>

        <Reveal delay={160}>
          <div className="mx-auto mt-6 grid max-w-[56rem] grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {AGENTS_BASIC.map((a) => (
              <AgentTile key={a.id} agent={a} dim />
            ))}
            <div className="flex items-center justify-center rounded-[14px] border border-dashed border-line px-3.5 py-3 text-[13px] text-dim">
              + any CLI agent
            </div>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <p className="mx-auto mt-12 max-w-[54ch] text-center text-[14.5px] leading-relaxed text-dim">
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
