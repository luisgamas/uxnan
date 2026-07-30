// Resume-command registry for agent CLI sessions — the single place that knows
// how each supported CLI reopens a captured session id. Every entry is
// verified against the CLI's real interface before being wired here; an agent
// without one returns `null` (its sessions are still captured, but no resume is
// offered). Two are `null` for a reason, not for want of checking: **Gemini CLI**
// exposes no session resume and is deprecated anyway, and **Zero** only resumes
// in its headless one-shot mode (`zero exec --resume [id]`) — its interactive
// TUI, which is what a terminal tab runs, rejects the flag outright. A session that was still live when its tab went away
// is auto-run on the way back; an exited one is only PRE-TYPED, so a
// stale/expired session fails visibly in the CLI itself with nothing lost.

/** The agent session persisted on a terminal tab (`SavedTab.agentSession`). */
export interface CapturedAgentSession {
  /** The reporting agent type from the hook server (`claude`, `codex`, …). */
  agent: string;
  id: string;
  /** Session/transcript file path, when the provider reports one (Pi resumes
   *  by file). */
  file?: string;
  /** Whether the agent's TUI was still running at capture/close time (from
   *  process detection; `undefined` = assumed live — a hook just fired).
   *  Live → the restored/woken tab auto-relaunches the TUI; exited → the
   *  resume command is only pre-typed. */
  live?: boolean;
  /** True while this is an id **we** named at launch that the provider has not
   *  reported back yet — i.e. the CLI has not written the conversation, because
   *  nothing was ever sent to it. It matters because the two flags are exact
   *  complements: verified against the real CLI, `claude --resume <unused-id>`
   *  answers "No conversation found", and `claude --session-id <used-id>`
   *  answers "Session ID … is already in use". So an untouched session is
   *  reopened by re-pinning its id, and a used one by resuming it.
   *
   *  Absent means reported-by-the-provider — the only shape sessions had before
   *  ids were named at launch, so an already-persisted one keeps working. */
  pending?: boolean;
  capturedAt: number;
}

/** Ids were sanitized at ingestion (backend), but the command line is built
 *  here — re-validate so no unchecked value can ever reach a shell. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** Control characters (C0 range), spelled with escapes on purpose. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp("[\\u0000-\\u001F]");

/** Whether a session file path is safe to quote as a single argument. */
function safeFile(file: string | undefined): string | null {
  const f = file?.trim();
  if (!f || f.length > 512) return null;
  // Reject quotes and control characters outright — never escape-and-hope.
  if (f.includes('"') || CONTROL_RE.test(f)) return null;
  return f;
}

/** The type a since-removed reporter wrote when its (no-longer-injected) env var
 *  was unset. Sessions captured under it are already on disk. */
const PLACEHOLDER_AGENT = "agent";

/** Where each CLI keeps its sessions, as it appears in the transcript path the
 *  hook reports. Only consulted to repair a session whose agent is unusable. */
const HOME_DIR_AGENTS: [marker: string, agent: string][] = [
  ["/.codex/", "codex"],
  ["/.claude/", "claude"],
  ["/.gemini/", "gemini"],
  ["/.grok/", "grok"],
  ["/.pi/", "pi"],
];

/** Repair a session persisted with an unusable agent type.
 *
 *  An older build shipped a reporter that named every agent `"agent"` — the
 *  ingestion side rejects that now, but tabs captured while it was installed
 *  still carry it, and a type with no entry in the table below means no resume
 *  is ever offered (this is exactly how Codex silently stopped coming back).
 *  The transcript path the same report carried says which CLI it really was, so
 *  read it back from there. A session we can't place keeps whatever it had —
 *  guessing an agent would run the wrong CLI's command line. */
export function repairedSession(s: CapturedAgentSession): CapturedAgentSession {
  if (s.agent !== PLACEHOLDER_AGENT) return s;
  const path = s.file?.toLowerCase().replace(/\\/g, "/");
  const found = path && HOME_DIR_AGENTS.find(([marker]) => path.includes(marker));
  return found ? { ...s, agent: found[1] } : s;
}

/** The shell command that reopens this session, or `null` when the agent has
 *  no verified resume entry point. */
export function resumeCommand(s: CapturedAgentSession): string | null {
  if (!ID_RE.test(s.id)) return null;
  switch (s.agent) {
    // Claude and Grok take the same shape: `--resume` reopens a conversation
    // that exists, `--session-id` claims one that doesn't, and each rejects the
    // other's case (see `pending`). Grok spells the rule out in its own help:
    // "must not already exist under the target session directory".
    case "claude":
      return s.pending ? `claude --session-id ${s.id}` : `claude --resume ${s.id}`;
    case "grok":
      return s.pending ? `grok --session-id ${s.id}` : `grok --resume ${s.id}`;
    case "codex":
      return `codex resume ${s.id}`;
    case "opencode":
      return `opencode --session ${s.id}`;
    // Antigravity reopens a *conversation*, and its one flag both creates and
    // resumes one — so this is also the command that restores a conversation id
    // we chose ourselves at launch (see `agentSessionId.ts`).
    case "antigravity":
      return `agy --conversation ${s.id}`;
    case "pi": {
      // Pi resumes by session file when one was reported, else by (partial) id.
      // For an id we named that Pi hasn't written yet, `--session-id` is the one
      // that "creates it if missing" (its own help), so it covers both cases.
      const file = safeFile(s.file);
      if (s.pending) return `pi --session-id ${s.id}`;
      return file ? `pi --session "${file}"` : `pi --session ${s.id}`;
    }
    default:
      return null;
  }
}
