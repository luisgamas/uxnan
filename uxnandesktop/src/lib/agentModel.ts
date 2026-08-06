// Reading the model a launch was pinned to, straight off the agent profile's
// argument list.
//
// Scope, deliberately narrow: this reports **what the launch command asked for**,
// not what the agent ended up running. A CLI can ignore the flag, fall back on
// its own default, or let the user switch models mid-session — none of which is
// visible from here. That is why the sidebar chip only appears when a profile
// actually pins a model, and never guesses a default.
//
// Every agent CLI uxnan drives spells this the same way (`--model <id>`, or the
// `=` form), and `-m` is the common short flag, so one parser covers them all
// without a per-agent table that would rot.

/** Flags that carry a model id, longest-first so `--model` wins over `-m`. */
const MODEL_FLAGS = ["--model", "-m"] as const;

/**
 * The model id an agent profile's `args` pin, or `null` when it pins none.
 *
 * Handles both `["--model", "opus"]` and `["--model=opus"]`. A flag with no
 * value after it (a truncated profile) yields `null` rather than swallowing the
 * next unrelated argument.
 */
export function modelFromArgs(args: readonly string[] | undefined): string | null {
  if (!args?.length) return null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]?.trim();
    if (!arg) continue;
    for (const flag of MODEL_FLAGS) {
      if (arg === flag) {
        const value = args[i + 1]?.trim();
        // A value that looks like another flag means this one was left dangling.
        return value && !value.startsWith("-") ? value : null;
      }
      if (arg.startsWith(`${flag}=`)) {
        const value = arg.slice(flag.length + 1).trim();
        return value || null;
      }
    }
  }
  return null;
}
