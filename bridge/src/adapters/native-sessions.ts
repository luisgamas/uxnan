/**
 * Listing an agent's sessions in a folder from the CLI's own session store,
 * for the agents whose CLI has no listing surface of its own (Claude Code, pi)
 * or whose listing says too little (Grok: no title, and no way to tell an
 * empty session from a real one). The others list through what they already
 * run: Codex's app-server, OpenCode's server, Zero's ACP `session/list`.
 *
 * Read-only, and never whole transcripts: a Claude Code session can grow past
 * 200 MB, so only the head (where the folder, the entry point and the first
 * prompt are) and the tail (where the latest title is) of each file are read,
 * newest files first, up to {@link MAX_LISTED}.
 */
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeSessionInfo } from '@uxnan/shared';

/** How many sessions one agent lists for a folder. */
export const MAX_LISTED = 30;
/** Bytes read from each end of a session file. */
const CHUNK = 64 * 1024;
/** A title is cut to this many characters. */
const TITLE_MAX = 80;

/**
 * Where Claude Code keeps a folder's sessions: `~/.claude/projects/` plus the
 * folder with every character that is not a letter or digit turned into `-`
 * (`/Users/me/app` → `-Users-me-app`). Lossy, so each file's own `cwd` is
 * checked too.
 */
export function claudeProjectDir(home: string, cwd: string): string {
  return join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/**
 * Where pi keeps a folder's sessions: `<agent dir>/sessions/--<folder, `/` →
 * `-`>--`, the agent dir being `$PI_CODING_AGENT_DIR` or `~/.pi/agent`.
 */
export function piSessionDir(agentDir: string, cwd: string): string {
  const encoded = cwd.replace(/^[/\\]+/, '').replace(/[/\\:]/g, '-');
  return join(agentDir, 'sessions', `--${encoded}--`);
}

/**
 * Claude Code's sessions in [cwd]. `interactive` is the CLI's own word for it:
 * `entrypoint: 'cli'` is its terminal UI; `sdk-cli` is a headless `-p` run.
 */
export async function listClaudeSessions(home: string, cwd: string): Promise<NativeSessionInfo[]> {
  const out: NativeSessionInfo[] = [];
  for (const file of await newestFiles(claudeProjectDir(home, cwd), '.jsonl')) {
    const { head, tail } = await readEnds(file.path);
    let sessionCwd: string | undefined;
    let entrypoint: string | undefined;
    let prompt: string | undefined;
    for (const line of jsonLines(head)) {
      if (sessionCwd === undefined && typeof line['cwd'] === 'string') sessionCwd = line['cwd'];
      if (entrypoint === undefined && typeof line['entrypoint'] === 'string') {
        entrypoint = line['entrypoint'];
      }
      if (prompt === undefined && line['type'] === 'user' && line['isMeta'] !== true) {
        const message = line['message'];
        prompt = promptText(isRecord(message) ? message['content'] : undefined);
      }
      if (sessionCwd !== undefined && entrypoint !== undefined && prompt !== undefined) break;
    }
    if (sessionCwd !== cwd) continue;
    let aiTitle: string | undefined;
    for (const line of jsonLines(tail)) {
      if (line['type'] === 'ai-title' && typeof line['aiTitle'] === 'string') {
        aiTitle = line['aiTitle'];
      }
    }
    const title = cleanTitle(aiTitle) ?? cleanTitle(prompt);
    if (title === undefined) continue; // opened and left without a word
    out.push({
      sessionId: file.name.slice(0, -'.jsonl'.length),
      cwd,
      title,
      updatedAt: file.mtime,
      interactive: entrypoint === 'cli',
    });
  }
  return out;
}

/**
 * pi's sessions in [cwd] (`<time>_<id>.jsonl`, whose first line is
 * `{ type: 'session', id, cwd }`). pi records no entry point, so every session
 * counts as interactive; the bridge's own are recognized by the conversation
 * that continues them.
 */
export async function listPiSessions(agentDir: string, cwd: string): Promise<NativeSessionInfo[]> {
  const out: NativeSessionInfo[] = [];
  for (const file of await newestFiles(piSessionDir(agentDir, cwd), '.jsonl')) {
    const { head } = await readEnds(file.path);
    let header: Record<string, unknown> | undefined;
    let prompt: string | undefined;
    for (const line of jsonLines(head)) {
      if (header === undefined && line['type'] === 'session') header = line;
      if (prompt === undefined && line['type'] === 'message') {
        const message = line['message'];
        if (isRecord(message) && message['role'] === 'user')
          prompt = promptText(message['content']);
      }
      if (header !== undefined && prompt !== undefined) break;
    }
    if (!header || header['cwd'] !== cwd || typeof header['id'] !== 'string') continue;
    const title = cleanTitle(prompt);
    if (title === undefined) continue;
    out.push({ sessionId: header['id'], cwd, title, updatedAt: file.mtime, interactive: true });
  }
  return out;
}

/** Where Grok keeps a folder's sessions: `~/.grok/sessions/<folder, URL-encoded>/<id>/`. */
export function grokSessionDir(home: string, cwd: string): string {
  return join(home, '.grok', 'sessions', encodeURIComponent(cwd));
}

/**
 * Grok's sessions in [cwd]. Each is a folder with a `summary.json`
 * (`info.cwd`, `updated_at`) and an `updates.jsonl` of ACP updates, whose
 * first `user_message_chunk`s are the first thing the person asked. Grok keeps
 * no title and its `session/list` answers without one, which is why the store
 * is read: it also tells an empty session (opened, never prompted — the
 * bridge's own command probe opens those) from a real one.
 */
export async function listGrokSessions(home: string, cwd: string): Promise<NativeSessionInfo[]> {
  const root = grokSessionDir(home, cwd);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const candidates: FileEntry[] = [];
  for (const name of names) {
    const path = join(root, name, 'updates.jsonl');
    try {
      const info = await stat(path);
      if (info.isFile()) candidates.push({ name, path, mtime: info.mtimeMs });
    } catch {
      /* not a session folder */
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const out: NativeSessionInfo[] = [];
  for (const file of candidates.slice(0, MAX_LISTED)) {
    const { head } = await readEnds(file.path);
    let prompt = '';
    let started = false;
    for (const line of jsonLines(head)) {
      const params = line['params'];
      const update = isRecord(params) ? params['update'] : undefined;
      if (!isRecord(update)) continue;
      if (update['sessionUpdate'] === 'user_message_chunk') {
        started = true;
        const content = update['content'];
        if (isRecord(content) && typeof content['text'] === 'string') prompt += content['text'];
      } else if (started) break;
    }
    const title = cleanTitle(promptText(prompt));
    if (title === undefined) continue;
    out.push({ sessionId: file.name, cwd, title, updatedAt: file.mtime, interactive: true });
  }
  return out;
}

/** A person's words from a message's content (a string, or text parts),
 *  skipping what the CLI inserts itself (command wrappers, caveats). */
export function promptText(content: unknown): string | undefined {
  let text: string | undefined;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .filter(
        (part) => isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string',
      )
      .map((part) => (part as { text: string }).text)
      .join(' ');
  }
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('<') || trimmed.startsWith('Caveat:')) return undefined;
  return trimmed;
}

/** One line, at most {@link TITLE_MAX} characters, or nothing. */
export function cleanTitle(text: string | undefined): string | undefined {
  const flat = text?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…` : flat;
}

interface FileEntry {
  name: string;
  path: string;
  mtime: number;
}

/** The newest [ext] files directly in [dir], at most {@link MAX_LISTED}. */
async function newestFiles(dir: string, ext: string): Promise<FileEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: FileEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(ext)) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (info.isFile()) entries.push({ name, path, mtime: info.mtimeMs });
    } catch {
      /* gone meanwhile */
    }
  }
  return entries.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_LISTED);
}

/** The first and last {@link CHUNK} bytes of a file (the whole of a small one). */
async function readEnds(path: string): Promise<{ head: string; tail: string }> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const headBuf = Buffer.alloc(Math.min(CHUNK, size));
    await handle.read(headBuf, 0, headBuf.length, 0);
    if (size <= CHUNK) {
      const all = headBuf.toString('utf8');
      return { head: all, tail: all };
    }
    const tailBuf = Buffer.alloc(CHUNK);
    await handle.read(tailBuf, 0, CHUNK, size - CHUNK);
    return { head: headBuf.toString('utf8'), tail: tailBuf.toString('utf8') };
  } finally {
    await handle.close();
  }
}

/** Whole JSON objects among [text]'s lines; a line cut at a chunk edge is skipped. */
function* jsonLines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) yield parsed;
    } catch {
      /* cut at the chunk edge, or not JSON */
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
