// The desktop chat's outbox: every message this window sends is written here
// before `turn/send` goes out and removed once the bridge has it (its
// `stream/turn/created` echo, or the turn in a page it serves). What is left
// when the app closes — a send the bridge refused, one that never reached it,
// one still in flight — comes back as a failed bubble with Retry, so a message
// is never silently dropped (AGENTS.md, "every surface works on its own"; the
// phone keeps the same promise with its stored `sending`/`failed` messages).
//
// Per viewer and best-effort, like the other client-only replays
// (`projectMirror`): the bridge owns the conversation, this holds only what
// has not reached it yet.

import type { AgentCommandInvocation } from '$shared/agents/agent-capabilities';
import type { TurnAttachment } from '$shared/models/workspace';
import { isLocalTarget, type TargetId } from '$lib/target';

const KEY = 'uxnan.chat.outbox';

/** Everything `turn/send` needs to send the message again. */
export interface SendRequest {
  text?: string;
  command?: AgentCommandInvocation;
  options?: Record<string, string | boolean>;
  attachments?: TurnAttachment[];
}

/** One message waiting for the bridge. */
export interface OutboxEntry {
  clientTurnId: string;
  /** What the bubble shows (the command as typed, the text, or the images). */
  text: string;
  request: SendRequest;
  /** Why the last attempt failed; empty when the app closed before an answer. */
  error?: string;
}

type Stored = Record<string, OutboxEntry[]>;

function readAll(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Stored): void {
  const json = (value: Stored) => JSON.stringify(value);
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, json(all));
  } catch {
    // Images can outgrow the storage quota; the words are what must survive,
    // so keep those rather than nothing.
    try {
      const textOnly: Stored = {};
      for (const [threadId, entries] of Object.entries(all)) {
        textOnly[threadId] = entries.map(({ request: { attachments: _, ...request }, ...entry }) => ({
          ...entry,
          request,
        }));
      }
      localStorage.setItem(KEY, json(textOnly));
    } catch {
      /* storage unavailable: the outbox lives in memory only */
    }
  }
}

function isEntry(value: unknown): value is OutboxEntry {
  const e = value as OutboxEntry | null;
  return (
    !!e &&
    typeof e.clientTurnId === 'string' &&
    typeof e.text === 'string' &&
    !!e.request &&
    typeof e.request === 'object'
  );
}

/** Where a thread's messages wait: under its id for this machine's bridge,
 *  under `ssh:<host>/<id>` for a host's own — one machine's outbox is never
 *  replayed into another's bridge, even should two threads share an id. */
export function outboxKey(target: TargetId, threadId: string): string {
  return isLocalTarget(target) ? threadId : `${target}/${threadId}`;
}

/** The messages of `threadId` that the bridge has not confirmed. A message the
 *  app closed on before any answer comes back as failed (`error: ''`). */
export function readOutbox(threadId: string): OutboxEntry[] {
  const entries = readAll()[threadId];
  return Array.isArray(entries)
    ? entries.filter(isEntry).map((e) => ({ ...e, error: e.error ?? '' }))
    : [];
}

/** Replace what `threadId` has waiting (an empty list forgets the thread). */
export function writeOutbox(threadId: string, entries: OutboxEntry[]): void {
  const all = readAll();
  if (entries.length === 0) delete all[threadId];
  else all[threadId] = entries;
  writeAll(all);
}
