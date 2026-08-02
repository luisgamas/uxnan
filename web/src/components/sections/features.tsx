import { Section, SectionHeading } from "./shared";
import { FeatureVideo } from "@/components/mockups/feature-video";

/**
 * Three real clips instead of a scrolling wall of feature cards — the
 * DOM recreations elsewhere on the page make the point that this *is* the
 * interface; these three make the point that it moves the way it says it
 * does. One idea each, in the order the loop actually happens: start an
 * agent, watch it work as a team, ship the result.
 *
 * `objectPosition` is an X% into the source's fixed 1280×720 frame — the card
 * crops a 4:3 slice out of that 16:9 capture, which only ever trims width
 * (25% of it, split left/right by this value; height always matches exactly,
 * so a Y offset here would be inert). Each value was picked by seeking the
 * real file frame by frame to the moment the clip is named for, not guessed,
 * and confirmed by screenshotting the actual rendered card (desktop + mobile):
 * - `launch-agent`: low X keeps the worktree row + the right-click "Launch
 *   agent" menu in frame — that menu opens left-of-centre, not at the edge.
 * - `agent-subagents`: a bit higher than `launch-agent` so the sidebar's full
 *   sub-agent list stays in frame while still showing a slice of the
 *   terminal's `Task(...)` calls to its right.
 * - `create-pr`: the highest X (100% — the source's true right edge) so the
 *   GitHub panel (branch picker, PR form, the checks + Review button) shows
 *   in full instead of losing its last few characters off-frame.
 */
const CLIPS = [
  {
    slug: "launch-agent",
    title: "Start an agent in seconds",
    body: "Pick a worktree, pick a CLI you already use, and it is already working — no chat window to set up first.",
    objectPosition: "20% 50%",
  },
  {
    slug: "agent-subagents",
    title: "Watch the whole team, not one chat",
    body: "Sub-agents show up under the agent that spawned them, live, so a fanned-out task stays legible instead of scrolling past.",
    objectPosition: "35% 50%",
  },
  {
    slug: "create-pr",
    title: "Ship it without leaving the window",
    body: "Stage, commit and open a real, gh-backed pull request — reviewed, checked and merged from the same pane.",
    objectPosition: "100% 50%",
  },
] as const;

export function Features() {
  return (
    <Section id="features">
      <div className="shell">
        <SectionHeading
          eyebrow="See it work"
          title="The real interface, not a demo reel."
          lead="Three clips captured from the actual app — nothing staged for this page."
        />

        <div className="mt-14 grid gap-6 lg:mt-16 lg:grid-cols-3 lg:gap-6">
          {CLIPS.map((clip, i) => (
            <article
              key={clip.slug}
              data-reveal
              data-reveal-delay={i * 90}
              className="card-wash overflow-hidden rounded-2xl border border-border/70"
            >
              {/*
                An inset bezel, not a bare video tag: the same layering the
                DOM mockups use for depth (a sunken surface behind a hairline
                frame) instead of a box-shadow — this site drops elevation on
                purpose (`--shadow-*: none`).
              */}
              <div className="bg-surface-sunken p-3 pb-2.5">
                <div className="hairline aspect-[4/3] overflow-hidden rounded-lg bg-black">
                  <FeatureVideo slug={clip.slug} objectPosition={clip.objectPosition} />
                </div>
              </div>
              <div className="p-6 md:p-7">
                <h3 className="text-[1.0625rem] font-semibold leading-snug">
                  {clip.title}
                </h3>
                <p className="mt-2.5 text-[15px] leading-[1.65] text-muted-foreground">
                  {clip.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
