/**
 * Discovery + expansion of user-defined "custom" prompt-template commands from
 * disk, shared by the CLI adapters whose headless mode does NOT expand their own
 * slash commands (Codex, Gemini, OpenCode). The bridge scans the command
 * directories, advertises each file as an {@link AgentCommand} (`source:
 * 'custom'`), and — on invocation — expands the template itself (argument
 * substitution) so the final prompt reaches the agent as ordinary text.
 *
 * Parsers are intentionally minimal and dependency-free (the same posture as
 * {@link parseCodexConfigModels}): tolerant of comments/quoting, top-level files
 * only. Limitation: only argument substitution is performed — `@file` includes
 * and `` !`shell` `` placeholders that a CLI's native command processor would
 * resolve are passed through literally (the agent never sees the TUI expander).
 *
 * Source: architecture/02a-system-architecture.md §5.8 (adapters) + AGENTS.md
 * (agent commands).
 */
import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { AgentCommand } from '@uxnan/shared';

/** How a command file encodes its template + metadata. */
export type CommandFormat = 'markdown' | 'toml';

export interface CustomCommandSource {
  /** Directories to scan, highest-priority first (project before user level). */
  dirs: string[];
  /** File extension including the dot (e.g. `.md`, `.toml`). */
  ext: string;
  /** How to parse a matched file. */
  format: CommandFormat;
}

interface ParsedCommand {
  description?: string;
  argumentHint?: string;
  /** The prompt-template body used for expansion. */
  body: string;
}

/**
 * Discover the custom prompt-template commands under `source` as
 * {@link AgentCommand}s. Never throws — a missing directory or unreadable file
 * is skipped so discovery degrades gracefully to fewer commands.
 */
export async function scanCustomCommands(source: CustomCommandSource): Promise<AgentCommand[]> {
  const files = await listCommandFiles(source.dirs, source.ext);
  const out: AgentCommand[] = [];
  for (const { name, path } of files) {
    let parsed: ParsedCommand;
    try {
      parsed = parseCommandFile(await readFile(path, 'utf8'), source.format);
    } catch {
      continue;
    }
    out.push({
      name,
      source: 'custom',
      headlessSupported: true,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.argumentHint ? { argumentHint: parsed.argumentHint } : {}),
    });
  }
  return out;
}

/**
 * Expand the custom command `name` found under `source` to its final prompt
 * text (template body with arguments substituted). Throws when `name` is not a
 * known custom command so the caller can fall back to the native `/name` form.
 */
export async function expandCustomCommand(
  source: CustomCommandSource,
  name: string,
  args?: string,
): Promise<string> {
  const files = await listCommandFiles(source.dirs, source.ext);
  const match = files.find((f) => f.name === name);
  if (!match) throw new Error(`unknown custom command '${name}'`);
  const parsed = parseCommandFile(await readFile(match.path, 'utf8'), source.format);
  return substituteArgs(parsed.body, args);
}

/**
 * List the top-level command files across `dirs` (highest-priority first),
 * de-duplicated by command name so a project-scoped file shadows a user-level
 * one. A directory that does not exist is silently skipped.
 */
async function listCommandFiles(
  dirs: string[],
  ext: string,
): Promise<{ name: string; path: string }[]> {
  const seen = new Set<string>();
  const out: { name: string; path: string }[] = [];
  for (const dir of dirs) {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(ext)) continue;
      const name = entry.name.slice(0, -ext.length);
      if (name.length === 0 || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, path: join(dir, entry.name) });
    }
  }
  return out;
}

function parseCommandFile(raw: string, format: CommandFormat): ParsedCommand {
  return format === 'toml' ? parseTomlCommand(raw) : parseMarkdownCommand(raw);
}

/** Markdown command: YAML-ish front-matter (`description`, `argument-hint`) + body. */
function parseMarkdownCommand(raw: string): ParsedCommand {
  const { fields, body } = extractFrontMatter(raw);
  return {
    body,
    ...(fields['description'] ? { description: fields['description'] } : {}),
    ...(fields['argument-hint'] ? { argumentHint: fields['argument-hint'] } : {}),
  };
}

/** TOML command (Gemini): a required `prompt` string plus optional `description`. */
function parseTomlCommand(raw: string): ParsedCommand {
  const description = extractTomlString(raw, 'description');
  return {
    body: extractTomlString(raw, 'prompt') ?? '',
    ...(description ? { description } : {}),
  };
}

/** Split leading `---\n…\n---` front-matter into `key: value` fields + the body. */
function extractFrontMatter(raw: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { fields, body: raw };
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = stripQuotes(line.slice(idx + 1).trim());
  }
  return { fields, body: raw.slice(match[0].length) };
}

/** Read a TOML string value, honoring `"""…"""`/`'''…'''` and `"…"`/`'…'` forms. */
function extractTomlString(raw: string, key: string): string | undefined {
  const triple = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*("""|''')([\\s\\S]*?)\\1`).exec(raw);
  if (triple) return triple[2]!.replace(/^\r?\n/, '');
  const single = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*"([^"]*)"|(?:^|\\n)\\s*${key}\\s*=\\s*'([^']*)'`).exec(
    raw,
  );
  if (single) return single[1] ?? single[2];
  return undefined;
}

/**
 * Substitute command arguments into a template body: `$ARGUMENTS` / `{{args}}`
 * become the full argument string; `$1`…`$9` become the positional tokens
 * (whitespace-split). Anything else is left intact.
 */
export function substituteArgs(body: string, args?: string): string {
  const full = (args ?? '').trim();
  const parts = full.length > 0 ? full.split(/\s+/) : [];
  return body
    .replace(/\{\{\s*args\s*\}\}/g, full)
    .replace(/\$ARGUMENTS\b/g, full)
    .replace(/\$([1-9])\b/g, (_, d: string) => parts[Number(d) - 1] ?? '');
}

function stripQuotes(value: string): string {
  const first = value[0];
  const last = value.at(-1);
  if (value.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"))) {
    return value.slice(1, -1);
  }
  return value;
}
