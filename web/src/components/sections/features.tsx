import { Section } from "./shared";
import { MockupMarquee, type MockupMarqueeItem } from "./mockup-marquee";
import {
  AgentView,
  BrowserPanel,
  DragCard,
  LauncherCard,
  MemoryCard,
  Phone,
  ProjectCards,
  PullRequestPanel,
  UsageCard,
} from "@/components/mockups/satellites";
import { PHONE_AGENT_COUNT, RAM_FOOTPRINT } from "@/lib/site";

/**
 * Home “see it first” strip — Desktop + Mobile surfaces in one marquee.
 * Product pages were removed; this is the full visual tour.
 */
const FEATURES: MockupMarqueeItem[] = [
  {
    key: "light",
    product: "Desktop",
    title: "RAM for agents, not chrome",
    body: `Measured at ${RAM_FOOTPRINT} on the OS webview — no second browser bundled in.`,
    visual: <MemoryCard className="w-[260px]" />,
  },
  {
    key: "worktrees",
    product: "Desktop",
    title: "One task, one worktree",
    body: "Branch, terminal and agent per task — switch without stashing.",
    visual: <ProjectCards className="w-[260px]" />,
  },
  {
    key: "status",
    product: "Desktop",
    title: "Who needs you, at a glance",
    body: "Working, needs you, done, idle — dots and notifications included.",
    visual: <AgentView className="w-[280px]" />,
  },
  {
    key: "pr",
    product: "Desktop",
    title: "Diff, commit, merge here",
    body: "Hunk staging and gh-backed PRs without leaving the window.",
    visual: <PullRequestPanel className="w-[260px]" />,
  },
  {
    key: "browser",
    product: "Desktop",
    title: "Real browser, docked",
    body: "System webview + DevTools for whatever the agents just built.",
    visual: <BrowserPanel className="w-[260px]" />,
  },
  {
    key: "launch",
    product: "Desktop",
    title: "Launch, resume, keep going",
    body: "One click into the worktree; sessions come back resumed, not restarted.",
    visual: <LauncherCard className="w-[250px]" />,
  },
  {
    key: "drag",
    product: "Desktop",
    title: "Drop a path into the prompt",
    body: "File-tree rows land in the terminal so the sentence never breaks.",
    visual: <DragCard className="w-[270px]" />,
  },
  {
    key: "usage",
    product: "Desktop",
    title: "Quota before you burn it",
    body: "Provider usage from each CLI’s own token — never a pasted key.",
    visual: <UsageCard className="w-[240px]" />,
  },
  {
    key: "phone",
    product: "Mobile",
    title: "Steer agents from the pocket",
    body: `${PHONE_AGENT_COUNT} CLIs, your accounts — no vendor phone stack required.`,
    visual: <Phone className="h-[230px] w-[114px]" />,
  },
  {
    key: "stream",
    product: "Mobile",
    title: "Live turns, real approvals",
    body: "Stream the run, answer the agent, ship or stop from the train.",
    visual: <Phone variant="conversation" className="h-[230px] w-[114px]" />,
  },
  {
    key: "picker",
    product: "Mobile",
    title: "Pick the agent per conversation",
    body: "Compare available agents, then choose the model for that conversation.",
    visual: <Phone variant="picker" className="h-[230px] w-[114px]" />,
  },
  {
    key: "git",
    product: "Mobile",
    title: "Review and commit without a laptop",
    body: "Status, diffs, stage, commit, push and pull on the conversation’s worktree.",
    visual: <Phone variant="git" className="h-[230px] w-[114px]" />,
  },
  {
    key: "files",
    product: "Mobile",
    title: "Browse the whole project",
    body: "Searchable workspace over any project under the bridge — repo or folder.",
    visual: <Phone variant="files" className="h-[230px] w-[114px]" />,
  },
  {
    key: "threads",
    product: "Mobile",
    title: "Every conversation, every PC",
    body: "Threads across paired machines with truthful per-device status.",
    visual: <Phone variant="threads" className="h-[230px] w-[114px]" />,
  },
  {
    key: "activity",
    product: "Mobile",
    title: "Your activity, kept by you",
    body: "Heatmap and stats aggregated locally across every paired PC.",
    visual: <Phone variant="profile" className="h-[230px] w-[114px]" />,
  },
];

export function Features() {
  return (
    <Section id="features" className="overflow-hidden">
      <div className="shell">
        <div className="mx-auto max-w-[48rem] text-center">
          <p className="eyebrow justify-center" data-reveal>
            See it first
          </p>
          <h2
            className="mt-5 text-[clamp(2rem,3.6vw,3rem)] font-semibold"
            data-reveal
            data-reveal-delay="60"
          >
            The surface, not a screenshot.
          </h2>
          <p
            className="mt-6 text-[clamp(1.0625rem,1.35vw,1.1875rem)] leading-[1.7] text-muted-foreground"
            data-reveal
            data-reveal-delay="120"
          >
            Live interface recreations of Desktop and Mobile — sharp at any resolution,
            theme-aware. Scroll sideways, pause on hover.
          </p>
        </div>
      </div>

      <div className="mt-14 lg:mt-16">
        <MockupMarquee items={FEATURES} />
      </div>
    </Section>
  );
}
