// Shell-aware command building for agent launch.
//
// Agents are launched by *typing a command line into an interactive shell* (so
// PATH/PATHEXT shims like `claude.cmd` resolve), then pressing Enter. That means
// the arguments must be quoted with the syntax of the shell they land in —
// PowerShell, cmd.exe and POSIX shells each escape differently. Getting this
// wrong breaks any agent arg with a space or a special character (a path, a
// prompt passed via `-p`, …). These helpers are pure and unit-tested.

export type ShellKind = "powershell" | "cmd" | "posix";

/** Classify a shell executable by its command/path. Unknown shells are treated
 *  as POSIX (the safe default on Unix; on Windows the caller passes cmd/pwsh
 *  explicitly). */
export function shellKind(command: string | undefined | null): ShellKind {
  const base = (command ?? "").trim().toLowerCase().replace(/\\/g, "/");
  const name = base.split("/").pop() ?? base;
  if (/^(pwsh|powershell)(\.exe)?$/.test(name) || name.includes("powershell")) {
    return "powershell";
  }
  if (/^cmd(\.exe)?$/.test(name)) return "cmd";
  return "posix";
}

// Characters that are always safe unquoted across every shell we target.
const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote a single argument for `kind`, returning it verbatim when it needs no
 *  quoting. Best-effort but correct for the common cases (spaces, quotes, paths,
 *  prompts). An empty string becomes an explicit empty quoted token. */
export function quoteArg(arg: string, kind: ShellKind): string {
  if (arg !== "" && SAFE.test(arg)) return arg;
  switch (kind) {
    case "powershell":
      // Single-quoted strings are literal in PowerShell; a literal `'` doubles.
      return `'${arg.replace(/'/g, "''")}'`;
    case "cmd":
      // cmd has no real escaping; double-quote and double any embedded quote so
      // the MSVCRT/MS arg parser the target uses recovers the literal value.
      return `"${arg.replace(/"/g, '""')}"`;
    case "posix":
      // Single quotes are fully literal; close/escape/reopen around a literal `'`.
      return `'${arg.replace(/'/g, `'\\''`)}'`;
  }
}

/** Build the full command line typed into the shell to launch an agent:
 *  the (unquoted) executable followed by its quoted arguments. */
export function buildRunCommand(
  command: string,
  args: readonly string[],
  kind: ShellKind,
): string {
  return [command, ...args.map((a) => quoteArg(a, kind))].join(" ");
}
