import { Reveal } from "@/components/reveal";
import { ChatHandoff, TerminalHandoff } from "@/components/mockups/handoff";
import { Phone, PhoneHeldConversation } from "@/components/mockups/phone";
import { SESSION_AGENTS, SESSIONS_UNLISTED, CHAT_AGENTS } from "@/lib/site";

const unlisted = CHAT_AGENTS.filter((a) => SESSIONS_UNLISTED.includes(a.id))
  .map((a) => a.name)
  .join(" and ");

const listing = SESSION_AGENTS.map((a) => a.name)
  .join(", ")
  .replace(/, ([^,]*)$/, " and $1");

const STEPS = [
  {
    label: "In a terminal",
    body: "Run the agent with its full interface. When it is idle, Continue as chat closes it there with a signal to its process, never with keystrokes, and the shell stays.",
  },
  {
    label: "As a chat",
    body: "The same session, with everything it already said, in a calm chat on your desktop. Open in terminal takes it back whenever you want the TUI.",
  },
  {
    label: "On your phone",
    body: "Still open in a terminal on your PC? The phone says so, and Continue here asks the PC to hand it over the moment the agent is idle.",
  },
];

export function Continuity() {
  return (
    <section id="continuity" className="relative py-20 sm:py-28">
      <div className="wrap">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="eyebrow">One conversation, every surface</p>
          <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.9rem)]">
            A session goes where you go.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
            An agent&apos;s session isn&apos;t tied to the window you started it
            in. Keep working in a terminal, move to a chat when you would rather
            read than scroll, and take it with you on your phone. The history
            comes along, and so does the agent&apos;s memory.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-8">
          <Reveal>
            <p className="mb-3 font-mono text-[11px] tracking-[0.12em] text-faint">
              01 · {STEPS[0].label.toUpperCase()}
            </p>
            <TerminalHandoff />
            <p className="mt-4 text-[14px] leading-relaxed text-muted">{STEPS[0].body}</p>
          </Reveal>

          <Reveal delay={80}>
            <p className="mb-3 font-mono text-[11px] tracking-[0.12em] text-faint">
              02 · {STEPS[1].label.toUpperCase()}
            </p>
            <ChatHandoff />
            <p className="mt-4 text-[14px] leading-relaxed text-muted">{STEPS[1].body}</p>
          </Reveal>

          <Reveal delay={160} className="lg:w-[200px]">
            <p className="mb-3 font-mono text-[11px] tracking-[0.12em] text-faint">
              03 · {STEPS[2].label.toUpperCase()}
            </p>
            <Phone width={200} className="mx-auto">
              <PhoneHeldConversation />
            </Phone>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">{STEPS[2].body}</p>
          </Reveal>
        </div>

        <div className="mx-auto mt-16 grid max-w-[62rem] gap-x-10 gap-y-8 sm:grid-cols-2">
          <Reveal>
            <h3 className="text-[15px] font-semibold">Pick up any session</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
              A new chat lists the sessions your agents had in that folder, from
              a terminal, their own app or another surface, and continues any of
              them with its history. {listing} list theirs; {unlisted} continues
              from the terminal it runs in.
            </p>
          </Reveal>
          <Reveal delay={60}>
            <h3 className="text-[15px] font-semibold">One writer at a time</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
              While a terminal has a session open, nothing else writes into it,
              so two surfaces never talk over each other. And the agent keeps
              its memory when the bridge restarts or updates itself.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
