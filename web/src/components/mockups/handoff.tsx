import { HugeiconsIcon } from "@hugeicons/react";
import ArrowDownIcon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import StopIcon from "@hugeicons/core-free-icons/StopIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import UnlockIcon from "@hugeicons/core-free-icons/SquareUnlock02Icon";
import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AGENT_ICON } from "@/lib/site";

/* ───────────────────────────────────────────────────────────────────────────
   Two panes of Uxnan Desktop, drawn for the hand-off: one session, first in a
   terminal and then as a chat. Wording is the app's own (`sessions.*` in the
   desktop's locale): the tab menu's *Continue as chat* and the chat menu's
   *Open in terminal*. Same materials as `desktop.tsx`, cut down to one pane.
   ─────────────────────────────────────────────────────────────────────────── */

function Pane({
  tab,
  icon,
  children,
}: {
  tab: string;
  icon: "terminal" | "chat";
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line-2 bg-ink-soft text-[11px] shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex h-8 items-stretch border-b border-line bg-panel">
        <div className="relative flex items-center gap-2 px-3 text-fg">
          {icon === "terminal" ? (
            <HugeiconsIcon icon={TerminalIcon} className="size-3 text-dim" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={AGENT_ICON.claudecode} alt="" className="size-3" />
          )}
          <span className="whitespace-nowrap">{tab}</span>
          <HugeiconsIcon icon={XIcon} className="size-2.5 opacity-40" />
          <span className="absolute inset-x-0 bottom-0 h-[2px] bg-fg/85" />
        </div>
        <span className="grid place-items-center px-2">
          <HugeiconsIcon icon={PlusIcon} className="size-3.5 text-faint" />
        </span>
      </div>
      {children}
    </div>
  );
}

function MenuItem({
  label,
  chord,
  active = false,
  danger = false,
}: {
  label: string;
  chord?: string;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-md px-2.5 py-[5px] whitespace-nowrap ${
        active ? "bg-raise text-fg" : danger ? "text-[#f87171]" : "text-muted"
      }`}
    >
      <span>{label}</span>
      {chord ? <span className="ml-auto text-[9.5px] text-faint">{chord}</span> : null}
    </div>
  );
}

/** A Claude Code TUI in a terminal tab, the terminal's context menu open on
 *  *Continue as chat*: the agent is idle, so the item is on offer. */
export function TerminalHandoff() {
  return (
    <Pane tab="Claude Code" icon="terminal">
      <div className="h-[252px] bg-ink px-4 py-3.5 font-mono text-[10.5px] leading-[1.75] text-muted">
        <div className="text-[#d97757]">✻ Claude Code</div>
        <div className="mt-2">
          <span className="text-fg/90">❯</span> Give me a short tour
        </div>
        <div className="pl-3">of this repository.</div>
        <div className="mt-1.5 text-fg/80">⏺ Here&apos;s the tour:</div>
        <div className="pl-3">· uxnandesktop/ the app</div>
        <div className="pl-3">· bridge/ the daemon</div>
        <div className="pl-3">· relay/ optional</div>
        <div className="mt-2 text-faint">✻ done</div>
        <div className="mt-1 border-t border-line pt-1.5">
          <span className="text-fg/90">❯</span> <span className="caret" />
        </div>
      </div>

      {/* the terminal's context menu, where it was right-clicked */}
      <div className="absolute top-[92px] right-4 w-[176px] rounded-lg border border-line-2 bg-panel p-1 text-[10.5px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)]">
        <MenuItem label="Copy" chord="Ctrl C" />
        <MenuItem label="Paste" chord="Ctrl V" />
        <div className="my-1 h-px bg-line" />
        <MenuItem label="Continue as chat" active />
        <MenuItem label="Rename…" />
        <div className="my-1 h-px bg-line" />
        <MenuItem label="Split right" />
        <MenuItem label="Split down" />
      </div>
    </Pane>
  );
}

/** The same session as a chat: its history came along, and the chat's menu
 *  can take it back to a terminal (*Open in terminal*). */
export function ChatHandoff() {
  return (
    <Pane tab="Repository tour" icon="chat">
      <div className="flex h-[252px] flex-col bg-ink">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-1.5">
          <span className="truncate text-[10.5px] font-medium text-fg">Repository tour</span>
          <span className="ml-auto text-[10px] text-dim">Claude Code</span>
          <HugeiconsIcon icon={MoreHorizontalIcon} className="size-3 text-fg/80" />
        </div>

        <div className="flex-1 overflow-hidden px-4 py-3">
          <div className="ml-auto w-fit max-w-[85%] rounded-xl bg-raise px-3 py-1.5 text-[10.5px] leading-relaxed text-fg/90">
            Give me a short tour of this repository.
          </div>
          <p className="mt-2.5 max-w-[56%] text-[10.5px] leading-relaxed text-fg/85">
            Here&apos;s the tour: the desktop app, the bridge on your PC and an
            optional relay, all speaking the contracts in shared/.
          </p>
        </div>

        <div className="px-4 pb-3">
          <div className="rounded-xl border border-line-2 bg-panel/70 px-3 pt-2 pb-1.5">
            <div className="text-[10.5px] text-faint">
              Message the agent… <span className="caret" />
            </div>
            <div className="mt-2 flex items-center gap-3 text-[9.5px] text-dim">
              <HugeiconsIcon icon={PlusIcon} className="size-3" />
              <span className="flex items-center gap-1">
                Opus 5.5
                <HugeiconsIcon icon={ArrowDownIcon} className="size-2.5 opacity-60" />
              </span>
              <span className="flex items-center gap-1">
                <HugeiconsIcon icon={UnlockIcon} className="size-2.5" />
                Full access
              </span>
              <span className="ml-auto grid size-5 place-items-center rounded-full bg-raise">
                <HugeiconsIcon icon={StopIcon} className="size-2.5 text-fg/80" />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* the chat's menu */}
      <div className="absolute top-[62px] right-3 w-[152px] rounded-lg border border-line-2 bg-panel p-1 text-[10.5px] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.9)]">
        <MenuItem label="Open in terminal" active />
        <div className="my-1 h-px bg-line" />
        <MenuItem label="Rename…" />
        <MenuItem label="Archive" />
        <div className="my-1 h-px bg-line" />
        <MenuItem label="Delete…" danger />
      </div>
    </Pane>
  );
}
