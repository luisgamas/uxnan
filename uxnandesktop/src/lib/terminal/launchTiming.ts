// When to type an agent's launch command into a freshly spawned shell.
//
// Its own module, free of xterm, so the rule can be tested on its own — it is a
// rule about *when a shell is ready to be typed into*, and getting it wrong is
// not a cosmetic bug: half the command reaches the shell and the rest lands
// inside whatever starts next. That is exactly how uxnan's own session id ended
// up written in an agent's TUI on a remote host.

/** Quiet window after the last output before typing, on this machine: long
 *  enough for a profile script to finish drawing its prompt. */
export const RUN_COMMAND_QUIET_MS = 160;
/** Fallback for a shell that prints nothing at all locally. */
export const RUN_COMMAND_FALLBACK_MS = 1800;
/** Quiet window on a host. A remote round trip alone costs more than the local
 *  window (a single `echo` through a login shell was measured at ~2.1 s), so
 *  reusing the local one calls a shell ready while its banner is still coming. */
export const REMOTE_QUIET_MS = 400;
/** How long to wait for a host's shell to say *anything* before typing blind.
 *  Never typing at all would be worse: a silent remote profile is possible, and
 *  an agent that never launches is a dead tab. */
export const REMOTE_FALLBACK_MS = 6000;

/** How long to wait before typing the launch command.
 *
 *  Local shells keep the behaviour they always had: debounce on output, with a
 *  fallback for the silent ones. A shell on a host that has **not said a word
 *  yet** is not ready to be typed into — the SSH channel is open long before
 *  the remote shell has finished starting, so the first characters are eaten
 *  and the tail arrives in the agent's own input box. There the wait is
 *  reset to the long fallback until the first byte comes back. */
export function launchDelayMs(input: {
  /** The tab's machine (`ssh:<hostId>`, or absent/`local` for this one). */
  target?: string | null;
  /** Whether this terminal has produced any output yet. */
  sawOutput: boolean;
  /** The delay the caller asked for (quiet window, or its own fallback). */
  requested: number;
}): number {
  const remote = !!input.target && input.target !== 'local';
  if (!remote) return input.requested;
  if (!input.sawOutput) return REMOTE_FALLBACK_MS;
  return Math.max(input.requested, REMOTE_QUIET_MS);
}
