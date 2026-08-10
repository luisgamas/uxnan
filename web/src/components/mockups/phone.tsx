import { HugeiconsIcon } from "@hugeicons/react";
import ArrowLeftIcon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import CircleDashedIcon from "@hugeicons/core-free-icons/CircleDashedIcon";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronLeftIcon from "@hugeicons/core-free-icons/ChevronLeftIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import CoinsIcon from "@hugeicons/core-free-icons/Coins01Icon";
import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import LayoutGridIcon from "@hugeicons/core-free-icons/Grid2X2Icon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import ListFilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import MicIcon from "@hugeicons/core-free-icons/Mic01Icon";
import MoreVerticalIcon from "@hugeicons/core-free-icons/MoreVerticalIcon";
import PencilIcon from "@hugeicons/core-free-icons/PencilIcon";
import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshIcon";
import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import SquarePenIcon from "@hugeicons/core-free-icons/Edit02Icon";
import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AGENT_ICON, AGENTS } from "@/lib/site";

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
  danger: "#d0666b",
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
                  <span
                    className="ml-auto shrink-0 text-[6.5px]"
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
          <span className="truncate">claude/opus-5</span>
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
        <div className="mb-[6px] px-[2px] text-[8px]">Working directory</div>
        <div
          className="mb-[13px] flex items-center gap-[8px] rounded-[17px] px-[9px] py-[8px]"
          style={{ background: M3.container }}
        >
          <span
            className="grid size-[23px] shrink-0 place-items-center rounded-[7px]"
            style={{ background: M3.mint }}
          >
            <HugeiconsIcon icon={FolderIcon} className="size-[12px]" style={{ color: M3.onMint }} />
          </span>
          <div className="min-w-0">
            <div className="text-[9px]">GitHub</div>
            <div
              className="truncate font-mono text-[6.5px]"
              style={{ color: M3.onSurfaceVar }}
            >
              C:\Users\dev\Documents\GitHub
            </div>
          </div>
          <HugeiconsIcon icon={ChevronRightIcon}
            className="ml-auto size-[11px] shrink-0"
            style={{ color: M3.outline }}
          />
        </div>

        <div className="mb-[6px] px-[2px] text-[8px]">Agent</div>
        <div className="flex flex-col gap-[5px]">
          {AGENTS.map((a) => {
            const off = a.id === "zero";
            return (
              <div
                key={a.id}
                className="flex items-center gap-[8px] rounded-[15px] px-[9px] py-[7px]"
                style={{ background: M3.container, opacity: off ? 0.55 : 1 }}
              >
                <AgentTile icon={a.icon} />
                <span className="text-[9px]">{a.name}</span>
                {off ? (
                  <span
                    className="ml-auto text-[7.5px]"
                    style={{ color: M3.danger }}
                  >
                    Unavailable
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ── Profile / statistics ──────────────────────────────────────────────── */

const STATS = [
  { v: "27h", k: "Time connected" },
  { v: "12h 42m", k: "Longest session" },
  { v: "8", k: "Agents used" },
  { v: "142", k: "Chats" },
  { v: "476", k: "Messages" },
  { v: "189", k: "Connections" },
  { v: "355M", k: "Total tokens" },
  { v: "31", k: "Models" },
  { v: "0", k: "Git actions" },
];

const HEAT = [
  0, 0, 1, 0, 2, 1, 0, 3, 1, 0, 2, 3, 1, 0, 1, 2, 3, 2, 1, 0, 1, 0, 2, 1, 3, 2,
  1, 0, 0, 1, 2, 3, 1, 2, 0, 1, 3, 2, 1, 0, 2, 1, 0, 3, 1, 2, 0, 1, 2, 3, 1, 0,
  1, 2, 0, 1, 3, 2, 1, 0, 2, 1, 3, 0, 1, 2, 1, 0, 2, 3, 1, 2, 0, 1, 3, 1, 0, 2,
];

export function PhoneProfile() {
  return (
    <>
      <div className="flex items-center gap-[7px] px-[10px] pt-[4px] pb-[10px]">
        <RoundBtn>
          <HugeiconsIcon icon={ArrowLeftIcon} className="size-[11px]" />
        </RoundBtn>
        <span className="text-[13px]">Profile</span>
      </div>

      <div className="px-[10px]">
        <div
          className="flex items-center gap-[9px] rounded-[17px] px-[10px] py-[9px]"
          style={{ background: M3.container }}
        >
          <span
            className="grid size-[27px] shrink-0 place-items-center rounded-full text-[9px] font-semibold"
            style={{ background: "#d8def0", color: "#2c4173" }}
          >
            LG
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px]">Luis Gamas</div>
            <div className="text-[7px]" style={{ color: M3.onSurfaceVar }}>
              Member since Jun 2026 · 1 PC
            </div>
            <div className="mt-[2px] flex items-center gap-[3px] text-[7px]">
              <span
                className="size-[3.5px] rounded-full"
                style={{ background: "#3b5bdb" }}
              />
              1 online now
            </div>
          </div>
          <HugeiconsIcon icon={PencilIcon}
            className="ml-auto size-[10px] shrink-0"
            style={{ color: M3.onSurfaceVar }}
          />
        </div>

        <div className="mt-[13px] mb-[7px] flex items-center">
          <span className="text-[13px]">Statistics</span>
          <span
            className="ml-auto grid size-[21px] place-items-center rounded-full"
            style={{ background: M3.mint }}
          >
            <HugeiconsIcon icon={RefreshCwIcon} className="size-[10px]" style={{ color: M3.onMint }} />
          </span>
        </div>

        <div className="grid grid-cols-3 gap-[5px]">
          {STATS.map((s) => (
            <div
              key={s.k}
              className="rounded-[15px] px-[7px] py-[8px]"
              style={{ background: M3.container }}
            >
              <div className="text-[11.5px] tracking-[-0.01em]">{s.v}</div>
              <div
                className="mt-[2px] text-[7px] leading-[1.25]"
                style={{ color: M3.onSurfaceVar }}
              >
                {s.k}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-[13px] mb-[6px] text-[13px]">Activity</div>

        <div
          className="mb-[7px] flex h-[21px] overflow-hidden rounded-full text-[7.5px]"
          style={{ background: M3.container }}
        >
          <span
            className="flex flex-1 items-center justify-center gap-[4px] rounded-full font-medium"
            style={{ background: M3.mint, color: M3.onMint }}
          >
            <HugeiconsIcon icon={LayoutGridIcon} className="size-[8px]" /> Activity
          </span>
          <span
            className="flex flex-1 items-center justify-center gap-[4px]"
            style={{ color: M3.onSurfaceVar }}
          >
            <HugeiconsIcon icon={CoinsIcon} className="size-[8px]" /> Tokens
          </span>
        </div>

        <div
          className="mb-[7px] flex h-[18px] w-[74px] items-center justify-between rounded-full px-[7px] text-[8px]"
          style={{ background: M3.container }}
        >
          <HugeiconsIcon icon={ChevronLeftIcon} className="size-[8px]" style={{ color: M3.onSurfaceVar }} />
          2026
          <HugeiconsIcon icon={ChevronRightIcon} className="size-[8px]" style={{ color: M3.onSurfaceVar }} />
        </div>

        <div className="grid grid-cols-[repeat(13,1fr)] gap-[2.5px]">
          {HEAT.map((level, i) => (
            <span
              key={i}
              className="aspect-square rounded-[2px]"
              style={{
                background:
                  level === 0
                    ? "#e4e5ea"
                    : `color-mix(in srgb, #3b5bdb ${level * 28}%, #e4e5ea)`,
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Devices (pairing) ─────────────────────────────────────────────────── */

export function PhoneDevices() {
  return (
    <>
      <div className="flex items-center px-[12px] pt-[6px] pb-[12px]">
        <span className="text-[15px] tracking-[-0.01em]">Devices</span>
      </div>

      <div className="flex flex-col gap-[6px] px-[10px]">
        <div
          className="rounded-[17px] px-[10px] py-[9px]"
          style={{ background: M3.container }}
        >
          <div className="flex items-center gap-[8px]">
            <span
              className="grid size-[25px] shrink-0 place-items-center rounded-[8px]"
              style={{ background: M3.mint }}
            >
              <HugeiconsIcon icon={LaptopIcon} className="size-[12px]" style={{ color: M3.onMint }} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[9.5px]">DESKTOP-4RO76Q2</div>
              <div className="text-[7px]" style={{ color: M3.onSurfaceVar }}>
                Last seen 13:00
              </div>
            </div>
            <HugeiconsIcon icon={MoreVerticalIcon}
              className="ml-auto size-[10px] shrink-0"
              style={{ color: M3.onSurfaceVar }}
            />
          </div>
          <div className="mt-[7px] flex gap-[5px]">
            <span
              className="flex items-center gap-[3px] rounded-full px-[6px] py-[2px] text-[6.5px] font-medium"
              style={{ background: M3.mint, color: M3.onMint }}
            >
              <span
                className="size-[3.5px] rounded-full"
                style={{ background: M3.live }}
              />
              Connected
            </span>
            <span
              className="rounded-full bg-white px-[6px] py-[2px] text-[6.5px] font-medium"
              style={{ color: M3.onSurfaceVar, border: `1px solid ${M3.hairline}` }}
            >
              LAN
            </span>
          </div>
        </div>

        <div
          className="flex items-center gap-[8px] rounded-[17px] px-[10px] py-[9px] opacity-60"
          style={{ background: M3.container }}
        >
          <span
            className="grid size-[25px] shrink-0 place-items-center rounded-[8px] bg-white"
            style={{ border: `1px solid ${M3.hairline}` }}
          >
            <HugeiconsIcon icon={LaptopIcon} className="size-[12px]" style={{ color: M3.onSurfaceVar }} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[9.5px]">MBP-DEV</div>
            <div className="text-[7px]" style={{ color: M3.onSurfaceVar }}>
              Last seen Jul 30
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-[18px] flex flex-col items-center gap-[5px] opacity-60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" className="size-[20px] rounded-[5px]" />
        <span className="text-[6.5px] tracking-[0.16em]" style={{ color: M3.outline }}>
          ALPHA
        </span>
      </div>
    </>
  );
}
