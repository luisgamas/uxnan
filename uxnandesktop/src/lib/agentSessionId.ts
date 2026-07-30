// Client-owned agent session ids — naming the session at LAUNCH instead of
// waiting for a hook to report one.
//
// Capture-by-hook only learns a session id once the agent has actually done
// something. A tab you opened and never talked to therefore had nothing to
// bring back, and an agent whose reporter is off or broken never became
// resumable at all. Several of the wired CLIs let the caller name the session up
// front, so uxnan takes them up on it: the id is generated here, rides the launch
// command line, and is stamped on the tab in the same breath — the session is
// restorable from the moment the agent starts, conversation or not.
//
// Every entry is verified against the CLI's own `--help` before being wired here
// (the same rule as `agentResume.ts`, whose table this one feeds — the `agent`
// key below is the hook agent type both sides join on):
//   claude --session-id <uuid>    "Use a specific session ID for the conversation
//                                  (must be a valid UUID)"
//   grok   --session-id <uuid>    "Use a specific session UUID for a **new**
//                                  conversation … Does not resume existing sessions"
//   pi     --session-id <id>      "Use exact project session ID, creating it if missing"
//   agy    --conversation <uuid>  the one flag that both creates and reopens a
//                                 conversation (as the bridge already drives it)
// Codex and OpenCode expose no equivalent, so they stay hook-captured.

/** A session id uxnan chose for a launch it is about to perform. */
export interface OwnedSession {
  /** Hook agent type this session will be reported under — the key
   *  `resumeCommand` switches on, so the two must agree. */
  agent: string;
  /** The id we chose (a UUID: every CLI here either requires or accepts one). */
  id: string;
  /** Extra arguments that pin it, appended to the user's own. */
  args: string[];
}

/** Executable (basename, extension stripped, lowercased) → how that CLI takes a
 *  caller-chosen session id, and the hook type it reports under. */
const PINNABLE: Record<string, { agent: string; flag: string }> = {
  claude: { agent: "claude", flag: "--session-id" },
  grok: { agent: "grok", flag: "--session-id" },
  pi: { agent: "pi", flag: "--session-id" },
  agy: { agent: "antigravity", flag: "--conversation" },
};

/** Arguments that already decide which session the agent opens. If the user's
 *  own profile carries one, the command line is left exactly as configured —
 *  pinning on top would either conflict outright or quietly retarget their
 *  launch. A false positive here costs nothing: that agent simply falls back to
 *  hook capture, which is the behaviour it had before. */
const SESSION_ARGS = new Set([
  "-c",
  "--continue",
  "-r",
  "--resume",
  "-s",
  "--session",
  "--session-id",
  "--session-dir",
  "--no-session",
  "--conversation",
  "--fork",
  "--fork-session",
  "--from-pr",
]);

/** The executable's identity token: basename, minus a launcher extension. Agent
 *  profiles hold anything from `claude` to `C:\tools\claude.cmd`. */
function commandKey(command: string): string {
  const base = command
    .trim()
    .replace(/["']/g, "")
    .split(/[\\/]/)
    .pop();
  if (!base) return "";
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1|js|mjs|cjs)$/, "");
}

/** Whether the configured args already steer the session (see [`SESSION_ARGS`]). */
function argsSteerSession(args: readonly string[]): boolean {
  return args.some((a) => SESSION_ARGS.has(a.trim().split("=")[0].toLowerCase()));
}

/** The session to pin on this launch, or `null` when the CLI can't take one (or
 *  the user's own args already choose a session). `newId` is injectable so tests
 *  don't depend on a random value. */
export function ownedSession(
  command: string,
  args: readonly string[] = [],
  newId: () => string = () => crypto.randomUUID(),
): OwnedSession | null {
  const entry = PINNABLE[commandKey(command)];
  if (!entry || argsSteerSession(args)) return null;
  const id = newId();
  return { agent: entry.agent, id, args: [entry.flag, id] };
}

/** Re-mint the id of a session we named that was never written, for a tab coming
 *  back from a restart or a wake.
 *
 *  The tab is reopened by claiming an id rather than resuming one (see
 *  `CapturedAgentSession.pending`), and Claude and Grok both refuse an id that
 *  already exists. Claiming the SAME id again is therefore a bet on the CLI not
 *  having written it in the meantime — and losing that bet greets you with an
 *  "already in use" error. A fresh id can't collide, and nothing is lost by it:
 *  an empty conversation has no history to keep, only the tab's agent. */
export function renewPendingSession<T extends { id: string; capturedAt: number }>(
  session: T,
  newId: () => string = () => crypto.randomUUID(),
  now: () => number = () => Math.floor(Date.now() / 1000),
): T {
  return { ...session, id: newId(), capturedAt: now() };
}
