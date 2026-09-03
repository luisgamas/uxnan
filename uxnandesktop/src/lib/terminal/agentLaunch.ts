// The one-shot that types an agent's launch command into its shell.
//
// It lives here, apart from the terminal instance, because *when the one-shot is
// claimed* is the whole correctness argument and it is far too easy to get wrong
// in place. `scheduleAgentLaunch` is re-armed by **every** PTY output chunk and
// guards on the instance's `launched` flag. The write itself is not one
// statement: it resolves the MCP catalog (a backend round-trip on a cold start)
// and then writes (another). While those awaits were in flight the flag still
// read false — so the launch's own output, the shell echoing the command line
// and then the agent painting its TUI, armed a second timer. One quiet window
// after the agent settled, that timer typed the whole launch line *into the
// running agent*: session id, MCP flags and all, straight into its prompt box.
//
// So the claim has to happen before the first await, and be given back only when
// the write genuinely failed. Expressing that as a function makes it a contract
// with a test, instead of a comment above a `try` that the next edit can slide
// an `await` past.

/** The slice of a terminal instance this owns: its one-shot launch flag. */
export interface AgentLaunchTarget {
  /** The agent `runCommand` was already typed (never re-type into a live agent). */
  launched: boolean;
}

/**
 * Run `write` at most once for `inst`, claiming the one-shot **before** awaiting
 * anything.
 *
 * A write that throws hands the claim back, because the backend refusing this
 * write (a PTY that is not ready yet) must stay retryable — the next output
 * chunk, or the fallback timer, reschedules.
 */
export async function runAgentLaunch(
  inst: AgentLaunchTarget,
  write: () => Promise<void>,
): Promise<void> {
  if (inst.launched) return;
  inst.launched = true;
  try {
    await write();
  } catch {
    inst.launched = false;
  }
}
