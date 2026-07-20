// Resume-command registry for agent CLI sessions — the single place that knows
// how each supported CLI reopens a captured session id. Every entry is
// verified against the CLI's real interface before being wired here; an agent
// without a verified resume entry returns `null` (its sessions are captured
// but no resume is offered — Gemini CLI exposes no session resume today, and
// Zero's is unverified). The built command is PRE-TYPED into the respawned
// shell, never auto-run, so a stale/expired session fails visibly in the CLI
// itself with nothing lost.

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

/** The shell command that reopens this session, or `null` when the agent has
 *  no verified resume entry point. */
export function resumeCommand(s: CapturedAgentSession): string | null {
  if (!ID_RE.test(s.id)) return null;
  switch (s.agent) {
    case "claude":
      return `claude --resume ${s.id}`;
    case "codex":
      return `codex resume ${s.id}`;
    case "opencode":
      return `opencode --session ${s.id}`;
    case "pi": {
      // Pi resumes by session file when one was reported, else by (partial) id.
      const file = safeFile(s.file);
      return file ? `pi --session "${file}"` : `pi --session ${s.id}`;
    }
    default:
      return null;
  }
}
