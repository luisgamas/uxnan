import { Caret } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * A Claude Code session, drawn the way the CLI actually prints it.
 *
 * The shapes here are the real ones: `⏺` for each step, `⎿` for its result,
 * tool calls written as `Read(path)` / `Update(path)` / `Bash(cmd)`, numbered
 * diff lines, and the rounded input box with the permission-mode hint under it.
 * That fidelity matters — the whole point of the product is that it runs the
 * agent's own CLI untouched, so a stylised "AI chat" mockup would misrepresent
 * it.
 */

const DIM = "text-foreground/35";
const BODY = "text-foreground/75";

export function ClaudeTerminal({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-surface-sunken px-3 py-2.5",
        "font-mono text-[9.5px] leading-[1.7]",
        className,
      )}
    >
      {/*
        Bottom-aligned, so a container too short for the whole transcript clips
        the *oldest* lines instead of the newest — which is exactly what a
        terminal looks like once you have scrolled. A top-aligned box would cut a
        line in half at the bottom and read as a rendering bug.
      */}
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        {/*
          The CLI draws these panels with box-drawing characters that stretch to
          the terminal width. A fixed-length string of them would leave a ragged
          right edge in a container that is not exactly that many columns wide,
          so they are drawn as real rounded borders instead — same picture, at
          any size.
        */}
        <div className="rounded-md border border-current/25 px-2 py-1.5 text-foreground/25">
          <div>
            <span className="text-[#D97757]">✻</span>
            <span className="text-foreground/70"> Welcome to Claude Code</span>
          </div>
          <div className="mt-1.5 text-foreground/40">cwd: ~/storefront</div>
        </div>

        <div className="h-2" />

        {/* The prompt the developer typed */}
        <div className="text-foreground/60">
          <span className="text-foreground/40">&gt;</span> add jitter to the retry
          backoff and cap the attempts
        </div>

        <div className="h-2" />

        <Step>I&apos;ll read the retry policy before changing it.</Step>

        <div className="h-1.5" />

        <Step tool="Read" arg="src/billing/retry.ts" />
        <Result>Read 142 lines</Result>

        <div>
          <div className="h-1.5" />

          <Step tool="Update" arg="src/billing/retry.ts" />
          <Result>Updated with 3 additions and 1 removal</Result>
          <div className="pl-4">
            <DiffLine n={41} sign="-">
              {"  const wait = base * 2 ** attempt;"}
            </DiffLine>
            <DiffLine n={41} sign="+">
              {"  const wait = jitter(base * 2 ** attempt, 0.3);"}
            </DiffLine>
            <DiffLine n={42} sign="+">
              {"  if (attempt >= MAX_ATTEMPTS) return deadLetter(job);"}
            </DiffLine>
          </div>

          <div className="h-1.5" />

          <Step tool="Bash" arg="npm test -- billing" />
          <Result>
            <span className="text-positive">24 passed</span>, 0 failed · 1.8s
          </Result>

          <div className="h-2" />

          <Step>
            Backoff now jitters by ±30% and dead-letters after 5 attempts. Want the
            dead-letter path covered by a test too?
          </Step>
        </div>
      </div>

      {/* The input box and the permission-mode hint, exactly where the CLI puts them. */}
      <div className="mt-2 shrink-0">
        <div className="flex items-center rounded-md border border-current/25 px-2 py-1.5 text-foreground/25">
          <span className="text-foreground/45">&gt;</span>
          <Caret />
        </div>
        <div className={cn("pl-1 pt-1", DIM)}>
          ⏵⏵ accept edits on{" "}
          <span className="text-foreground/25">(shift+tab to cycle)</span>
        </div>
      </div>
    </div>
  );
}

/** A `⏺` step: either prose, or a `Tool(argument)` call. */
function Step({
  children,
  tool,
  arg,
}: {
  children?: React.ReactNode;
  tool?: string;
  arg?: string;
}) {
  return (
    <div className={cn("flex gap-1.5", BODY)}>
      <span className="shrink-0 text-foreground/55">⏺</span>
      <span className="min-w-0">
        {tool ? (
          <>
            <span className="font-medium text-foreground/85">{tool}</span>
            <span className="text-foreground/45">({arg})</span>
          </>
        ) : (
          children
        )}
      </span>
    </div>
  );
}

/** The dimmed `⎿` line the CLI prints under a step. */
function Result({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-1.5 pl-[3px]", DIM)}>
      <span className="shrink-0">⎿</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function DiffLine({
  n,
  sign,
  children,
}: {
  n: number;
  sign: "+" | "-";
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-1.5 whitespace-pre">
      <span className="w-5 shrink-0 text-right text-foreground/25 tabular-nums">{n}</span>
      <span
        className={cn(
          "min-w-0 truncate",
          sign === "+" ? "text-positive" : "text-danger/80",
        )}
      >
        {sign}
        {children}
      </span>
    </div>
  );
}
