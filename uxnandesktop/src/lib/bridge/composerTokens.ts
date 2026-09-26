// What the chat composer is being typed into: a `/command` at the start of the
// message, or an `@file` mention anywhere — the two things its suggestion panel
// completes — and, when a message is sent, whether it is one of the agent's
// commands. The same rules as the phone's composer, so one message reads the
// same on both.

import type { AgentCommand, AgentCommandInvocation } from '$shared/agents/agent-capabilities';

/** The token the caret is in, when it is one the panel completes. */
export type ComposerToken =
  | { kind: 'command'; query: string; start: number; end: number }
  | { kind: 'mention'; query: string; start: number; end: number };

/**
 * The token at [caret] in [text]: a `/name` that is the message's first word
 * (a command is the whole message, never mid-sentence), or an `@path` that
 * starts a word. `undefined` otherwise.
 */
export function tokenAt(text: string, caret: number): ComposerToken | undefined {
  const before = text.slice(0, caret);
  const command = /^\/(\S*)$/.exec(before);
  if (command) {
    return { kind: 'command', query: command[1] ?? '', start: 0, end: wordEnd(text, caret) };
  }
  const mention = /(^|\s)@([^\s@]*)$/.exec(before);
  if (mention) {
    const start = before.length - (mention[2]?.length ?? 0) - 1;
    return { kind: 'mention', query: mention[2] ?? '', start, end: wordEnd(text, caret) };
  }
  return undefined;
}

function wordEnd(text: string, caret: number): number {
  const rest = /^\S*/.exec(text.slice(caret));
  return caret + (rest?.[0].length ?? 0);
}

/** [text] with [token] replaced by [replacement] and a space, and where the caret goes. */
export function complete(
  text: string,
  token: ComposerToken,
  replacement: string,
): { text: string; caret: number } {
  const after = text.slice(token.end).replace(/^ /, '');
  const inserted = `${replacement} `;
  return {
    text: `${text.slice(0, token.start)}${inserted}${after}`,
    caret: token.start + inserted.length,
  };
}

/** The order the palette groups commands in: skills, the user's own, the agent's, built-ins. */
const GROUP_ORDER: Record<AgentCommand['source'], number> = {
  skill: 0,
  custom: 1,
  acp: 2,
  builtin: 3,
};

/**
 * The agent's commands that match [query], grouped (skills, the user's own
 * commands, the agent's, built-ins) and best first within each group: a name
 * that starts with it, then one that contains it, then a description that does.
 */
export function matchCommands(commands: AgentCommand[], query: string): AgentCommand[] {
  const q = query.toLowerCase();
  const runnable = commands.filter((c) => c.headlessSupported !== false);
  const group = (c: AgentCommand): number => GROUP_ORDER[c.source] ?? GROUP_ORDER.custom;
  const rank = (c: AgentCommand): number => {
    if (q.length === 0) return 0;
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (c.description?.toLowerCase().includes(q)) return 2;
    return 3;
  };
  return runnable
    .map((c) => ({ c, r: rank(c) }))
    .filter(({ r }) => r < 3)
    .sort((a, b) => group(a.c) - group(b.c) || a.r - b.r || a.c.name.localeCompare(b.c.name))
    .map(({ c }) => c);
}

/**
 * [text] as a command invocation when it is `/name args` for one of the
 * agent's runnable commands — sent as `turn/send { command }`, as the phone
 * does — and `undefined` for anything else (plain text, an unknown `/word`).
 */
export function asCommand(
  text: string,
  commands: AgentCommand[],
): AgentCommandInvocation | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return undefined;
  const name = match[1] ?? '';
  const known = commands.some((c) => c.name === name && c.headlessSupported !== false);
  if (!known) return undefined;
  const args = match[2]?.trim();
  return args ? { name, args } : { name };
}
