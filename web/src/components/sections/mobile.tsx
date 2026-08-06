import { Reveal } from "@/components/reveal";
import {
  Phone,
  PhoneConversation,
  PhoneDevices,
  PhoneNewConversation,
  PhoneProfile,
} from "@/components/mockups/phone";
import { BRIDGE_INSTALL, BRIDGE_START, CRYPTO } from "@/lib/site";

const CAPABILITIES = [
  {
    title: "It streams, live",
    body: "Watch the answer arrive token by token, leave the app, come back — it is still there, still going.",
  },
  {
    title: "Queue a follow-up",
    body: "Send the next instruction while the agent is still working. On the CLIs that allow it, it lands mid-turn without stopping anything.",
  },
  {
    title: "Review the diff",
    body: "Read what changed and stage it from the phone, before anyone opens a laptop.",
  },
  {
    title: "A push when it's done",
    body: "The moment an agent finishes, your phone tells you — not fifteen minutes later.",
  },
];

export function Mobile() {
  return (
    <section id="mobile" className="relative overflow-hidden py-20 sm:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/4 h-[420px] opacity-60"
        style={{
          background:
            "radial-gradient(46% 46% at 50% 50%, rgba(0,200,150,0.10), transparent 70%)",
        }}
      />

      <div className="wrap relative">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="eyebrow">Away from the keyboard</p>
          <h2 className="display mt-4 text-[clamp(1.9rem,3.6vw,2.9rem)]">
            Then walk away.
          </h2>
          <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
            Uxnan Mobile is a real client, not a status page. Pick the agent and
            the model, start the conversation, and steer it from wherever you
            are — the sofa, the bus, another country.
          </p>
        </Reveal>

        <div className="mt-16 flex items-end justify-center gap-4 sm:gap-8">
          <Reveal delay={60} className="hidden sm:block">
            <Phone width={186} className="mb-10 rotate-[-3deg]">
              <PhoneNewConversation />
            </Phone>
          </Reveal>

          <Reveal delay={0}>
            <Phone width={236}>
              <PhoneConversation />
            </Phone>
          </Reveal>

          <Reveal delay={120} className="hidden sm:block">
            <Phone width={186} className="mb-10 rotate-[3deg]">
              <PhoneProfile />
            </Phone>
          </Reveal>
        </div>

        <div className="mx-auto mt-16 grid max-w-[62rem] gap-x-10 gap-y-8 sm:grid-cols-2">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={i * 60}>
              <h3 className="text-[15px] font-semibold">{c.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
                {c.body}
              </p>
            </Reveal>
          ))}
        </div>

        <Reveal delay={80}>
          <div className="tile mx-auto mt-16 max-w-[62rem] overflow-hidden p-6 sm:p-8">
            <div className="grid items-center gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-12">
              <div>
                <h3 className="text-[16px] font-semibold">
                  It pairs with your PC, not with a cloud.
                </h3>
                <p className="mt-2.5 max-w-[52ch] text-[14.5px] leading-relaxed text-muted">
                  A small daemon runs on your machine and prints a QR code. Scan
                  it once and the phone connects straight over your LAN or
                  Tailscale, falling back to an optional relay only when
                  you&apos;re off the network — which never sees anything but
                  sealed envelopes.
                </p>

                <div className="mt-5 rounded-xl border border-line bg-ink px-4 py-3.5 font-mono text-[12.5px]">
                  <div className="text-faint">
                    <span className="text-live">$</span> {BRIDGE_INSTALL}
                  </div>
                  <div className="mt-1.5 text-faint">
                    <span className="text-live">$</span> {BRIDGE_START}
                  </div>
                  <div className="mt-2 text-dim">
                    ▸ scan the QR from the app <span className="caret" />
                  </div>
                </div>

                <p className="mt-3.5 font-mono text-[11.5px] text-faint">
                  {CRYPTO}
                </p>
              </div>

              <Phone width={190} className="mx-auto shrink-0">
                <PhoneDevices />
              </Phone>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
