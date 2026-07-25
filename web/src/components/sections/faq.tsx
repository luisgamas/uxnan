import { Plus } from "lucide-react";

import { Section, SectionHeading } from "./shared";
import {
  links,
  PHONE_AGENT_COUNT,
  WIRED_AGENT_COUNT,
} from "@/lib/site";

/**
 * Native `<details>` accordion: free a11y, works before hydration.
 * Only questions that block install — not a second product tour.
 */
const QUESTIONS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is it free?",
    a: (
      <>
        Yes. Both apps, the bridge and the relay are{" "}
        <a href={links.license} target="_blank" rel="noreferrer noopener">
          MPL-2.0
        </a>
        . No paid tier, no account with us, nothing held back.
      </>
    ),
  },
  {
    q: "Do I need an API key for Uxnan?",
    a: (
      <>
        No. Agents launch as their own official CLIs on your machine, under the
        accounts you already signed in with. Uxnan never takes a provider API key.
      </>
    ),
  },
  {
    q: "Do I need Desktop to use Mobile?",
    a: (
      <>
        No. Mobile only needs the <b className="font-medium text-foreground">bridge</b>{" "}
        (<code>npm install -g uxnan-bridge</code>). Desktop is a separate product for
        the PC workspace.
      </>
    ),
  },
  {
    q: "Does my code go through your servers?",
    a: (
      <>
        No servers of ours sit in the path. The phone connects{" "}
        <b className="font-medium text-foreground">directly</b> to your PC when it can.
        Away from home, an optional relay <i>you</i> host forwards sealed envelopes it
        cannot open. Traffic is end-to-end encrypted either way.
      </>
    ),
  },
  {
    q: "Which agents work?",
    a: (
      <>
        {WIRED_AGENT_COUNT} CLIs are wired for the phone path (including Gemini CLI,
        kept wired but hidden in favour of Antigravity).{" "}
        {PHONE_AGENT_COUNT} show in the mobile picker. On Desktop any CLI agent runs in
        a terminal unmodified.
      </>
    ),
  },
  {
    q: "Which platforms?",
    a: (
      <>
        <b className="font-medium text-foreground">Desktop:</b> Windows, Linux, and macOS
        (experimental — unsigned).{" "}
        <b className="font-medium text-foreground">Mobile:</b> Android on Google Play; iOS
        coming soon (you can build from the mobile docs).
      </>
    ),
  },
  {
    q: "Why does macOS block the app?",
    a: (
      <>
        Builds are not notarised (paid Apple Developer ID not taken on yet). Authorise
        once via System Settings → Privacy &amp; Security, or the{" "}
        <a href={links.macosGuide} target="_blank" rel="noreferrer noopener">
          macOS install guide
        </a>
        . You can also{" "}
        <a href={links.buildGuide} target="_blank" rel="noreferrer noopener">
          build from source
        </a>
        .
      </>
    ),
  },
  {
    q: "How finished is this?",
    a: (
      <>
        <b className="font-medium text-foreground">Alpha.</b> The core loops work daily;
        edges are filed in the open. Each project has a status file and changelog —
        read those before you depend on an edge case.
      </>
    ),
  },
];

export function Faq() {
  return (
    <Section id="faq" tone="sunken">
      <div className="shell">
        <SectionHeading
          eyebrow="Questions"
          title="Before you install."
        />

        <div className="mx-auto mt-14 max-w-[52rem] lg:mt-16">
          {QUESTIONS.map((item, index) => (
            <details
              key={item.q}
              data-reveal
              data-reveal-delay={index * 40}
              className="group border-b border-border/70"
            >
              <summary className="flex cursor-pointer list-none items-start gap-5 py-6 text-left [&::-webkit-details-marker]:hidden">
                <span className="flex-1 text-[1.0625rem] font-medium leading-[1.5] md:text-[1.125rem]">
                  {item.q}
                </span>
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-surface-raised text-muted-foreground transition-transform duration-300 group-open:rotate-45">
                  <Plus className="size-4" aria-hidden />
                </span>
              </summary>
              <div className="prose-faq pb-7 pr-12 text-[16px] leading-[1.75] text-muted-foreground">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
