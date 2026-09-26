import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import CloudOffIcon from "@hugeicons/core-free-icons/CloudOffIcon";
import LinkIcon from "@hugeicons/core-free-icons/Link05Icon";
import PodcastIcon from "@hugeicons/core-free-icons/PodcastIcon";
import RobotIcon from "@hugeicons/core-free-icons/Robot01Icon";
import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
import SmartPhoneIcon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import WifiConnectedIcon from "@hugeicons/core-free-icons/WifiConnected01Icon";
import AddIcon from "@hugeicons/core-free-icons/Add01Icon";
import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CheckCircleIcon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import CircleDashedIcon from "@hugeicons/core-free-icons/CircleDashedIcon";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import ListFilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import MicIcon from "@hugeicons/core-free-icons/Mic01Icon";
import MoreVerticalIcon from "@hugeicons/core-free-icons/MoreVerticalIcon";
import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import SquarePenIcon from "@hugeicons/core-free-icons/Edit02Icon";
import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AGENT_ICON, CHAT_AGENTS } from "@/lib/site";

/* ───────────────────────────────────────────────────────────────────────────
   DOM recreations of Uxnan Mobile.

   Every screen is drawn once at a canonical 260 × 563 (a 1080 × 2340 phone at
   0.24 scale) and the frame scales it down, so a 176 px phone and a 244 px one
   show the same proportions the real app does — the way a screenshot would.
   Sizes below are the app's own dp values mapped through that factor.
   ─────────────────────────────────────────────────────────────────────────── */

const BASE_W = 260;
const BASE_H = 563;

/** Material 3 surfaces the app actually renders (light scheme). */
const M3 = {
  bg: "#f7f7fb",
  container: "#ecedf1",
  containerSoft: "#f1f2f6",
  onSurface: "#1a1b20",
  onSurfaceVar: "#5f6068",
  outline: "#8b8d95",
  hairline: "#e3e4e9",
  mint: "#b8e9c6",
  onMint: "#0b4d2c",
  periwinkle: "#dce3f7",
  onPeriwinkle: "#26365f",
  live: "#12a150",
} as const;

export function Phone({
  width,
  children,
  className = "",
}: {
  width: number;
  children: React.ReactNode;
  className?: string;
}) {
  const pad = width * 0.027;
  const inner = width - pad * 2;
  const scale = inner / BASE_W;

  return (
    <div
      className={`border border-line-2 bg-[#0e0e11] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] ${className}`}
      style={{
        width,
        padding: pad,
        borderRadius: width * 0.148,
      }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          width: inner,
          height: (inner * 19.5) / 9,
          borderRadius: width * 0.122,
          background: M3.bg,
        }}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width: BASE_W,
            height: BASE_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            color: M3.onSurface,
          }}
        >
          <StatusBar />
          {children}
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-[14px] pt-[9px] pb-[4px]">
      <span className="text-[9.5px] font-medium">9:41</span>
      <span
        className="absolute top-[7px] left-1/2 size-[7px] -translate-x-1/2 rounded-full"
        style={{ background: "#0e0e11" }}
      />
      <span className="flex items-center gap-[3px]">
        <span
          className="inline-block h-[7px] w-[9px]"
          style={{ background: M3.onSurface, clipPath: "polygon(0 100%,100% 100%,100% 0)" }}
        />
        <span
          className="inline-block h-[7px] w-[13px] rounded-[2px]"
          style={{ background: M3.onSurface }}
        />
      </span>
    </div>
  );
}

/** The app's circular icon buttons in app bars. */
function RoundBtn({
  children,
  filled = true,
}: {
  children: React.ReactNode;
  filled?: boolean;
}) {
  return (
    <span
      className="grid size-[23px] shrink-0 place-items-center rounded-full"
      style={{ background: filled ? M3.container : "transparent" }}
    >
      {children}
    </span>
  );
}

function AgentTile({
  icon,
  size = 23,
}: {
  icon: string;
  size?: number;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden bg-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        border: `1px solid ${M3.hairline}`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon} alt="" style={{ width: size * 0.62, height: size * 0.62 }} />
    </span>
  );
}

/* ── Spaces: projects, folders, conversations ─────────────────────── */

const SPACE_THREADS = [
  {
    title: "Reconnect backoff",
    preview: "The socket now retries with jittered backoff…",
    icon: AGENT_ICON.claudecode,
    time: "17:35",
    // started in Uxnan Desktop: the list marks it with a laptop
    desktop: true,
  },
  {
    title: "Windows CI flake",
    preview: "Three of the five failures share a timeout…",
    icon: AGENT_ICON.opencode,
    time: "17:34",
  },
];

/** One git signal on a folder's second line. Never drawn as a zero. */
function GitSignal({
  glyph,
  count,
  tone,
}: {
  glyph: string;
  count: number;
  tone: string;
}) {
  return (
    <span
      className="flex shrink-0 items-center gap-[1.5px] text-[6.5px]"
      style={{ color: tone }}
    >
      {glyph}
      {count}
    </span>
  );
}

function FolderRow({
  name,
  count,
  open = false,
  signals,
  agents,
  indent = 12,
}: {
  name: string;
  count: string;
  open?: boolean;
  signals?: React.ReactNode;
  agents?: string[];
  indent?: number;
}) {
  return (
    <div
      className="flex flex-col py-[5px]"
      style={{ paddingLeft: indent, paddingRight: 4 }}
    >
      <div className="flex items-center gap-[4px]">
        <HugeiconsIcon
          icon={open ? ChevronDownIcon : ChevronRightIcon}
          className="size-[8px] shrink-0"
          style={{ color: M3.onSurfaceVar }}
        />
        <HugeiconsIcon
          icon={FolderIcon}
          className="size-[11px] shrink-0"
          style={{ color: M3.onSurfaceVar }}
        />
        <span className="truncate text-[9px]">{name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-[4px]">
          {!open && (
            <HugeiconsIcon
              icon={CircleDashedIcon}
              className="size-[8px]"
              style={{ color: M3.live }}
            />
          )}
          <HugeiconsIcon
            icon={PlusIcon}
            className="size-[9px]"
            style={{ color: M3.onSurfaceVar }}
          />
        </span>
      </div>
      <div
        className="mt-[1px] flex items-center gap-[5px]"
        style={{ paddingLeft: 23 }}
      >
        <span className="truncate text-[7px]" style={{ color: M3.onSurfaceVar }}>
          {count}
        </span>
        {signals}
        {!open && agents && (
          <span className="ml-auto flex shrink-0 items-center gap-[2px]">
            {agents.map((icon) => (
              <AgentTile key={icon} icon={icon} size={10} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export function PhoneConversations() {
  return (
    <>
      <div className="flex items-center gap-[6px] px-[10px] pt-[4px] pb-[8px]">
        <RoundBtn>
          <HugeiconsIcon icon={ArrowLeftIcon} className="size-[11px]" />
        </RoundBtn>
        <span className="truncate text-[12px] font-medium">DESKTOP-4RO7…</span>
        <span className="ml-auto flex items-center gap-[5px]">
          <RoundBtn>
            <HugeiconsIcon icon={SearchIcon} className="size-[10px]" />
          </RoundBtn>
          <RoundBtn>
            <HugeiconsIcon icon={ListFilterIcon} className="size-[10px]" />
          </RoundBtn>
          <RoundBtn>
            <HugeiconsIcon icon={MoreVerticalIcon} className="size-[10px]" />
          </RoundBtn>
        </span>
      </div>

      {/* this PC runs Uxnan Desktop: its chats are shared both ways */}
      <div
        className="flex items-center gap-[5px] px-[12px] pb-[6px] text-[7.5px]"
        style={{ color: M3.onSurfaceVar }}
      >
        <HugeiconsIcon
          icon={LaptopIcon}
          className="size-[9px] shrink-0"
          style={{ color: M3.onPeriwinkle }}
        />
        <span className="truncate">Linked with Uxnan Desktop on DESKTOP-4RO76Q2</span>
      </div>

      <div className="flex flex-col px-[10px]">
        {/* A repository, drawn only because git/worktrees relates its folders
            to each other — never guessed from path prefixes. */}
        <div className="flex items-center gap-[4px] py-[5px]">
          <HugeiconsIcon
            icon={ChevronDownIcon}
            className="size-[8px] shrink-0"
            style={{ color: M3.onSurfaceVar }}
          />
          <HugeiconsIcon
            icon={GitBranchIcon}
            className="size-[11px] shrink-0"
            style={{ color: M3.onSurfaceVar }}
          />
          <span className="truncate text-[10px] font-medium">uxnan</span>
          <span
            className="ml-auto shrink-0 text-[7px]"
            style={{ color: M3.onSurfaceVar }}
          >
            3 folders
          </span>
        </div>

        <FolderRow
          name="uxnan"
          count="2 conversations"
          open
          indent={12}
          signals={
            <>
              <GitSignal glyph="●" count={4} tone={M3.onSurfaceVar} />
              <GitSignal glyph="↑" count={2} tone={M3.live} />
            </>
          }
        />

        <div className="flex flex-col gap-[5px] pt-[2px] pb-[4px] pl-[24px]">
          {SPACE_THREADS.map((t) => (
            <div
              key={t.title}
              className="flex items-center gap-[7px] rounded-[15px] px-[8px] py-[7px]"
              style={{ background: M3.container }}
            >
              <AgentTile icon={t.icon} size={16} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[6px]">
                  <span className="truncate text-[8px]">{t.title}</span>
                  {t.desktop ? (
                    <HugeiconsIcon
                      icon={LaptopIcon}
                      className="ml-auto size-[8px] shrink-0"
                      style={{ color: M3.onSurfaceVar }}
                    />
                  ) : null}
                  <span
                    className={`${t.desktop ? "" : "ml-auto "}shrink-0 text-[6.5px]`}
                    style={{ color: M3.onSurfaceVar }}
                  >
                    {t.time}
                  </span>
                </div>
                <div className="mt-[2px] flex items-center gap-[3px]">
                  <span
                    className="size-[3.5px] shrink-0 rounded-full"
                    style={{ background: M3.live }}
                  />
                  <span
                    className="truncate text-[6.5px]"
                    style={{ color: M3.onSurfaceVar }}
                  >
                    {t.preview}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Closed: the row still has to report what is inside it, so it adds
            the agent marks and the most urgent status. */}
        <FolderRow
          name="uxnan--pets"
          count="3 conversations"
          indent={12}
          agents={[AGENT_ICON.codex, AGENT_ICON.grok]}
          signals={<GitSignal glyph="↓" count={1} tone={M3.onSurfaceVar} />}
        />
        <FolderRow
          name="uxnan--hooks"
          count="1 conversation"
          indent={12}
          agents={[AGENT_ICON.pi]}
        />

        {/* A folder that relates to nothing stays where it is — no "others". */}
        <FolderRow
          name="notes"
          count="2 conversations"
          indent={0}
          agents={[AGENT_ICON.antigravity]}
        />
      </div>

      <div className="absolute right-[12px] bottom-[14px]">
        <span
          className="flex h-[30px] items-center gap-[6px] rounded-[11px] px-[12px] text-[9px] font-medium"
          style={{ background: M3.periwinkle, color: M3.onPeriwinkle }}
        >
          <HugeiconsIcon icon={SquarePenIcon} className="size-[11px]" /> New
          conversation
        </span>
      </div>
    </>
  );
}

/* ── A live conversation ───────────────────────────────────────────────── */

const BULLETS = [
  { code: "shared/", rest: "— JSON-RPC + E2EE contracts" },
  { code: "relay/", rest: "— optional, self-hosted" },
  { code: "bridge/", rest: "— the daemon on your PC" },
];

export function PhoneConversation() {
  return (
    <>
      <div className="flex items-center gap-[5px] px-[9px] pt-[4px] pb-[8px]">
        <RoundBtn>
          <HugeiconsIcon icon={ArrowLeftIcon} className="size-[11px]" />
        </RoundBtn>

        {/* the agent / model chip the app puts in the app bar */}
        <span
          className="flex h-[23px] min-w-0 flex-1 items-center gap-[4px] rounded-full px-[8px] text-[8.5px]"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={SparklesIcon} className="size-[9px] shrink-0" />
          <span className="truncate">Claude Code</span>
          <HugeiconsIcon icon={ChevronDownIcon} className="ml-auto size-[8px] shrink-0" />
        </span>

        <RoundBtn>
          <HugeiconsIcon icon={FolderIcon} className="size-[10px]" />
        </RoundBtn>
        <RoundBtn>
          <HugeiconsIcon icon={GitBranchIcon} className="size-[10px]" />
        </RoundBtn>
        <RoundBtn>
          <HugeiconsIcon icon={MoreVerticalIcon} className="size-[10px]" />
        </RoundBtn>
      </div>

      {/* the response, rendered as markdown straight on the surface */}
      <div className="px-[13px] text-[9px] leading-[1.5]">
        <p style={{ color: M3.onSurface }}>
          It pairs with a small daemon on your PC so the phone can stream a
          conversation, approve the next step and review a diff.
        </p>

        <p className="mt-[9px] text-[12.5px] font-semibold tracking-[-0.01em]">
          Architecture
        </p>

        <p className="mt-[5px]">Monorepo with:</p>

        <ul className="mt-[4px] flex flex-col gap-[4px]">
          {BULLETS.map((b) => (
            <li key={b.code} className="flex gap-[6px]">
              <span style={{ color: M3.outline }}>•</span>
              <span>
                <span
                  className="rounded-[3px] px-[3px] py-[1px] font-mono text-[8px]"
                  style={{ background: M3.container }}
                >
                  {b.code}
                </span>{" "}
                {b.rest}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-[8px]">
          The phone connects <b>directly</b> over LAN or Tailscale first, and
          only falls back to the relay when you are off that network
          <span className="caret ml-[1px] inline-block align-baseline" />
        </p>

        <p className="mt-[8px]">
          <b>Status:</b> ALPHA. Android is in open testing on Google Play, and
          the desktop ships stable and nightly builds.
        </p>

        <div
          className="mt-[10px] flex items-center gap-[5px] text-[8.5px]"
          style={{ color: M3.onSurfaceVar }}
        >
          <HugeiconsIcon icon={CopyIcon} className="size-[9px]" />
          Copy response
        </div>
      </div>

      {/* turn meta: jump-to-latest, tokens spent, context left */}
      <div className="absolute inset-x-[11px] bottom-[46px] flex items-center gap-[6px]">
        <span
          className="grid size-[21px] place-items-center rounded-full"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={ChevronRightIcon} className="size-[10px]" />
        </span>
        <span
          className="ml-auto flex items-center gap-[4px] rounded-full px-[8px] py-[3px] text-[8px]"
          style={{ background: M3.container, color: M3.onSurfaceVar }}
        >
          <HugeiconsIcon icon={CircleDashedIcon} className="size-[8px]" /> 17.9k
        </span>
        <span
          className="grid size-[21px] place-items-center rounded-full border-[1.5px] text-[7.5px] font-medium"
          style={{ borderColor: M3.mint, color: M3.onSurfaceVar }}
        >
          9
        </span>
      </div>

      {/* the composer */}
      <div className="absolute inset-x-[11px] bottom-[11px]">
        <div
          className="flex h-[29px] items-center gap-[8px] rounded-full px-[10px]"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={PlusIcon} className="size-[12px] shrink-0" />
          <span className="truncate text-[9px]" style={{ color: M3.outline }}>
            Message…
          </span>
          <HugeiconsIcon icon={MicIcon}
            className="ml-auto size-[11px] shrink-0"
            style={{ color: M3.onSurfaceVar }}
          />
        </div>
      </div>
    </>
  );
}


/* ── The desktop's conversation, live on the phone ─────────────────────── */

/** The same turn the desktop window in the hero is showing: the prompt, the
 *  agent's first line, and its steps folded into the work log — collapsed to
 *  a count and the step running now, as the app draws it. */
export function PhoneLiveChat() {
  return (
    <>
      <div className="flex items-center gap-[5px] px-[9px] pt-[4px] pb-[8px]">
        <RoundBtn>
          <HugeiconsIcon icon={ArrowLeftIcon} className="size-[11px]" />
        </RoundBtn>
        <span
          className="flex h-[23px] min-w-0 flex-1 items-center gap-[4px] rounded-full px-[8px] text-[8.5px]"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={SparklesIcon} className="size-[9px] shrink-0" />
          <span className="truncate">Claude Code</span>
          <HugeiconsIcon icon={ChevronDownIcon} className="ml-auto size-[8px] shrink-0" />
        </span>
        <RoundBtn>
          <HugeiconsIcon icon={FolderIcon} className="size-[10px]" />
        </RoundBtn>
        <RoundBtn>
          <HugeiconsIcon icon={GitBranchIcon} className="size-[10px]" />
        </RoundBtn>
        <RoundBtn>
          <HugeiconsIcon icon={MoreVerticalIcon} className="size-[10px]" />
        </RoundBtn>
      </div>

      <div className="px-[11px] text-[9px] leading-[1.5]">
        <div
          className="ml-auto w-fit max-w-[85%] rounded-[12px] px-[9px] py-[6px]"
          style={{ background: M3.periwinkle, color: M3.onPeriwinkle }}
        >
          Add a reconnect backoff to the zero adapter and cover it with a test.
        </div>

        <p className="mt-[10px]">
          I&apos;ll read the adapter first, then add the backoff where the
          socket closes.
        </p>

        {/* the work log, collapsed: a count and the step running now */}
        <div
          className="mt-[8px] flex h-[24px] items-center gap-[5px] rounded-full px-[9px]"
          style={{ background: M3.containerSoft, color: M3.onSurfaceVar }}
        >
          <HugeiconsIcon icon={TerminalIcon} className="size-[9px] shrink-0" />
          <span className="shrink-0 text-[7.5px] font-medium">Work log</span>
          <span
            className="grid h-[11px] min-w-[11px] shrink-0 place-items-center rounded-full px-[3px] text-[6.5px]"
            style={{ background: M3.container }}
          >
            4
          </span>
          <span className="min-w-0 truncate font-mono text-[6.8px]">
            $ npm test -w uxnan-bridge
          </span>
          <HugeiconsIcon icon={ChevronDownIcon} className="ml-auto size-[9px] shrink-0" />
        </div>

        <div
          className="mt-[9px] flex items-center gap-[5px] text-[8px] italic"
          style={{ color: M3.onSurfaceVar }}
        >
          <span
            className="size-[4px] rounded-full"
            style={{ background: "#3b5bdb", animation: "ux-pulse 2.4s ease-out infinite" }}
          />
          Agent responding…
        </div>
      </div>

      <div className="absolute inset-x-[11px] bottom-[46px] flex items-center gap-[6px]">
        <span
          className="grid size-[21px] place-items-center rounded-full"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={ChevronRightIcon} className="size-[10px]" />
        </span>
        <span
          className="ml-auto grid size-[21px] place-items-center rounded-full border-[1.5px] text-[7.5px] font-medium"
          style={{ borderColor: M3.mint, color: M3.onSurfaceVar }}
        >
          12
        </span>
      </div>

      <div className="absolute inset-x-[11px] bottom-[11px]">
        <div
          className="flex h-[29px] items-center gap-[8px] rounded-full px-[10px]"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={PlusIcon} className="size-[12px] shrink-0" />
          <span className="truncate text-[9px]" style={{ color: M3.outline }}>
            Message…
          </span>
          <HugeiconsIcon
            icon={MicIcon}
            className="ml-auto size-[11px] shrink-0"
            style={{ color: M3.onSurfaceVar }}
          />
        </div>
      </div>
    </>
  );
}

/* ── New conversation (agent picker) ───────────────────────────────────── */

export function PhoneNewConversation() {
  return (
    <>
      <div className="flex items-center px-[10px] pt-[4px] pb-[10px]">
        <RoundBtn>
          <HugeiconsIcon icon={XIcon} className="size-[11px]" />
        </RoundBtn>
        <span className="ml-auto text-[9px]" style={{ color: M3.outline }}>
          Start conversation
        </span>
      </div>

      <div className="px-[12px] pb-[11px] text-[15px] tracking-[-0.01em]">
        New conversation
      </div>

      <div className="px-[10px]">
        {/* The PC's project registry — the same list Uxnan Desktop shows —
            one card group, the chosen project filled, and adding one last. */}
        <div className="mb-[6px] px-[2px] text-[8px]">Project</div>
        <div className="mb-[13px] flex flex-col gap-[2px]">
          {[
            { name: "uxnan", path: "C:\\Users\\dev\\GitHub\\uxnan", on: true },
            { name: "website", path: "C:\\Users\\dev\\GitHub\\website", on: false },
          ].map((p, i) => (
            <div
              key={p.name}
              className="flex items-center gap-[8px] px-[9px] py-[7px]"
              style={{
                background: p.on ? M3.periwinkle : M3.container,
                borderRadius: i === 0 ? "15px 15px 5px 5px" : "5px",
              }}
            >
              <HugeiconsIcon icon={FolderIcon}
                className="size-[12px] shrink-0"
                style={{ color: p.on ? M3.onPeriwinkle : M3.onSurface }}
              />
              <div className="min-w-0">
                <div className="text-[9px]" style={{ color: p.on ? M3.onPeriwinkle : undefined }}>
                  {p.name}
                </div>
                <div
                  className="truncate font-mono text-[6.5px]"
                  style={{ color: p.on ? M3.onPeriwinkle : M3.onSurfaceVar, opacity: p.on ? 0.75 : 1 }}
                >
                  {p.path}
                </div>
              </div>
              {p.on ? (
                <HugeiconsIcon icon={CheckCircleIcon}
                  className="ml-auto size-[11px] shrink-0"
                  style={{ color: M3.onPeriwinkle }}
                />
              ) : null}
            </div>
          ))}
          <div
            className="flex items-center gap-[8px] px-[9px] py-[7px]"
            style={{ background: M3.container, borderRadius: "5px 5px 15px 15px" }}
          >
            <HugeiconsIcon icon={AddIcon} className="size-[12px] shrink-0" style={{ color: M3.onPeriwinkle }} />
            <div className="min-w-0">
              <div className="text-[9px]" style={{ color: M3.onPeriwinkle }}>Add a project</div>
              <div className="truncate text-[6.5px]" style={{ color: M3.onSurfaceVar }}>
                Pick a folder on your PC. It shows in Uxnan Desktop too.
              </div>
            </div>
          </div>
        </div>

        <div className="mb-[6px] px-[2px] text-[8px]">Agent</div>
        <div className="flex flex-col gap-[5px]">
          {/* the agents the bridge drives — the phone offers no other */}
          {CHAT_AGENTS.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-[8px] rounded-[15px] px-[9px] py-[7px]"
              style={{ background: M3.container }}
            >
              <AgentTile icon={a.icon} />
              <span className="text-[9px]">{a.name}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Home: your PCs ────────────────────────────────────────────────────── */

/** An M3 badge as the app draws it (`NeBadge`): a small pill with an optional
 *  glyph, mint when it reports something live. */
function Badge({
  icon,
  label,
  live = false,
}: {
  icon?: IconSvgElement;
  label: string;
  live?: boolean;
}) {
  return (
    <span
      className="flex h-[13px] items-center gap-[3px] rounded-full px-[6px] text-[6.5px] font-medium"
      style={{
        background: live ? M3.mint : M3.containerSoft,
        color: live ? M3.onMint : M3.onSurfaceVar,
      }}
    >
      {icon ? <HugeiconsIcon icon={icon} className="size-[7px]" /> : null}
      {label}
    </span>
  );
}

/** One paired PC (`_DeviceCard`): the laptop avatar with its status dot, the
 *  name, the address blurred until tapped, the last connection; then how it is
 *  connected, what is running there, and how many conversations it holds. */
function PcCard({
  name,
  address,
  last,
  connected,
  working,
  threads,
}: {
  name: string;
  address: string;
  last: string;
  connected: boolean;
  working?: number;
  threads: number;
}) {
  return (
    <div className="rounded-[17px] px-[10px] py-[10px]" style={{ background: M3.container }}>
      <div className="flex items-start gap-[8px]">
        <span
          className="relative grid size-[27px] shrink-0 place-items-center rounded-[9px]"
          style={{ background: M3.containerSoft, border: `1px solid ${M3.hairline}` }}
        >
          <HugeiconsIcon
            icon={LaptopIcon}
            className="size-[13px]"
            style={{ color: connected ? M3.live : M3.onSurfaceVar }}
          />
          <span
            className="absolute -right-[1px] -bottom-[1px] size-[7px] rounded-full"
            style={{
              background: connected ? M3.live : M3.outline,
              border: `1.5px solid ${M3.container}`,
            }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px]">{name}</div>
          <div className="mt-[1px] flex items-center gap-[3px]">
            <span
              className="truncate font-mono text-[6.5px]"
              style={{ color: M3.onSurfaceVar, filter: "blur(2px)" }}
            >
              {address}
            </span>
            <HugeiconsIcon icon={ViewIcon} className="size-[7px] shrink-0" style={{ color: M3.onSurfaceVar }} />
          </div>
          <div className="mt-[1px] text-[6.5px]" style={{ color: M3.onSurfaceVar }}>
            Last connection: {last}
          </div>
        </div>
        <HugeiconsIcon
          icon={MoreVerticalIcon}
          className="size-[10px] shrink-0"
          style={{ color: M3.onSurfaceVar }}
        />
      </div>

      <div className="mt-[8px] flex flex-wrap gap-[4px]">
        {connected ? (
          <Badge icon={WifiConnectedIcon} label="LAN" live />
        ) : (
          <Badge icon={CloudOffIcon} label="Disconnected" />
        )}
        {working ? <Badge icon={RobotIcon} label={`${working} working`} live /> : null}
      </div>

      <div className="mt-[8px] flex items-center">
        {connected ? null : (
          <span
            className="rounded-full px-[9px] py-[4px] text-[7.5px] font-medium"
            style={{ background: M3.periwinkle, color: M3.onPeriwinkle }}
          >
            Connect
          </span>
        )}
        <span className="ml-auto text-[6.5px]" style={{ color: M3.onSurfaceVar }}>
          {threads} conversations
        </span>
      </div>
    </div>
  );
}

export function PhoneDevices() {
  return (
    <>
      {/* the bar carries the product, not the screen: the mark on the left,
          pairing, settings and your avatar on the right */}
      <div className="flex items-center gap-[5px] px-[10px] pt-[4px] pb-[8px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="size-[24px] rounded-[6px]" />
        <span className="ml-auto flex items-center gap-[5px]">
          <RoundBtn>
            <HugeiconsIcon icon={LinkIcon} className="size-[10px]" />
          </RoundBtn>
          <RoundBtn>
            <HugeiconsIcon icon={SettingsIcon} className="size-[10px]" />
          </RoundBtn>
          <span
            className="grid size-[23px] place-items-center rounded-full text-[8px] font-semibold"
            style={{ background: "#d8def0", color: "#2c4173" }}
          >
            LG
          </span>
        </span>
      </div>

      <div className="px-[12px] pb-[10px]">
        <div className="text-[13px] tracking-[-0.01em]" style={{ color: M3.onSurfaceVar }}>
          Welcome back
        </div>
        <div className="text-[24px] leading-[1.15] tracking-[-0.02em]">Luis</div>
        <div className="mt-[7px] flex flex-wrap gap-[4px]">
          <Badge icon={PodcastIcon} label="1 online now" live />
          <Badge label="Member since Jun 2026" />
        </div>
      </div>

      <div className="flex flex-col gap-[6px] px-[10px]">
        <div
          className="flex items-center gap-[8px] rounded-[17px] px-[10px] py-[8px]"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={SmartPhoneIcon} className="size-[13px] shrink-0" style={{ color: "#3b5bdb" }} />
          <div className="min-w-0 flex-1 leading-[1.3]">
            <div className="text-[6.5px] font-medium" style={{ color: M3.onSurfaceVar }}>
              This phone
            </div>
            <div className="truncate text-[9px]">Pixel 9</div>
            <div className="text-[6.5px]" style={{ color: M3.onSurfaceVar }}>
              Android 16
            </div>
          </div>
          <HugeiconsIcon icon={SquarePenIcon} className="size-[10px] shrink-0" style={{ color: M3.onSurfaceVar }} />
        </div>

        <PcCard
          name="DESKTOP-4RO76Q2"
          address="192.168.1.20:8765"
          last="13:00"
          connected
          working={2}
          threads={14}
        />
        <PcCard
          name="MBP-DEV"
          address="100.88.12.4:8765"
          last="Jul 30, 18:42"
          connected={false}
          threads={3}
        />
      </div>
    </>
  );
}
