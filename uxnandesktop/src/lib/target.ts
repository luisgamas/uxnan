// Execution-target identity — *where* a project, worktree or terminal lives.
//
// Mirror of the Rust `target.rs`: same string forms (`local`, `ssh:<hostId>`),
// same rule that the pair `(target, path)` — never the path alone — is what the
// app keys on, because one absolute path names a different folder on every
// machine. `wsl:<distro>` is reserved for the day WSL stops being detected by
// sniffing UNC paths and becomes a target of its own.

/** The local machine: the target of everything the ADE could reach before
 *  remote hosts existed, and what all persisted data migrates to. */
export const LOCAL_TARGET = "local";

/** Connection generation of the local target. Local can never go stale, so it is
 *  a constant rather than a counter (mirrors Rust `LOCAL_GENERATION`). */
export const LOCAL_GENERATION = 0;

export type TargetId = typeof LOCAL_TARGET | `ssh:${string}`;

/** What a mutating command sends so the backend can refuse to run it against a
 *  machine other than the one the user was looking at (Rust `TargetExpectation`).
 *  Omitting it only ever authorizes local work. */
export interface TargetExpectation {
  targetId: TargetId;
  generation: number;
}

/** Whether `t` is the local machine. Absent/empty counts as local: every record
 *  written before targets existed is local by definition. */
export function isLocalTarget(t: TargetId | null | undefined): boolean {
  return !t || t === LOCAL_TARGET;
}

/** Normalize an optional persisted value to a concrete target id. */
export function targetOf(t: TargetId | null | undefined): TargetId {
  return isLocalTarget(t) ? LOCAL_TARGET : (t as TargetId);
}

/** Parse a target id, or `null` when the string is not one this build knows.
 *  Strict on purpose — the caller decides what to do with an unknown target
 *  instead of it silently degrading to local. */
export function parseTargetId(raw: string): TargetId | null {
  const s = raw.trim();
  if (s === "" || s === LOCAL_TARGET) return LOCAL_TARGET;
  if (s.startsWith("ssh:") && s.length > "ssh:".length) return s as TargetId;
  return null;
}

/** The SSH host id behind an `ssh:` target, or `null` for any other target. */
export function sshHostId(t: TargetId | null | undefined): string | null {
  return typeof t === "string" && t.startsWith("ssh:") ? t.slice("ssh:".length) : null;
}

/** The expectation to send with a mutation on `target`. `generation` is the
 *  connection generation the caller last saw; local is always `LOCAL_GENERATION`. */
export function expectation(
  target: TargetId | null | undefined,
  generation = LOCAL_GENERATION,
): TargetExpectation {
  const t = targetOf(target);
  return { targetId: t, generation: isLocalTarget(t) ? LOCAL_GENERATION : generation };
}
