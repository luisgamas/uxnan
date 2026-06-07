/**
 * Leveled logger for the bridge daemon, with optional file output (daily
 * rotation under `~/.uxnan/logs/`) and a secret-redaction pass.
 *
 * Security (AGENTS.md): callers should not pass secrets to the logger, and
 * {@link redactSecrets} is a defense-in-depth net that masks obvious secrets
 * (JWTs, `key=…`/`token=…`/`secret=…` values, PEM key blocks) before they are
 * written anywhere. All log output goes to stderr; stdout is reserved for IPC.
 *
 * Source: architecture/02a-system-architecture.md §5.8.3.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

/** Mask obvious secrets in a log line. Best-effort defense-in-depth. */
export function redactSecrets(text: string): string {
  return (
    text
      // JWT-like a.b.c
      .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED-JWT]')
      // key=value / "token": "value" for secret-ish keys
      .replace(
        /\b(token|secret|password|passwd|api[_-]?key|authorization|bearer|notificationSecret|privateKey|private_key)\b(["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi,
        (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`,
      )
      // PEM blocks
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        '[REDACTED-KEY]',
      )
  );
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface FormatInput {
  level: LogLevel;
  scope: string;
  message: string;
  rest: unknown[];
  timestamp?: string;
}

function formatLine(input: FormatInput): string {
  const prefix = input.timestamp ? `[${input.timestamp}] ` : '';
  const extra = input.rest.length > 0 ? ` ${input.rest.map(stringify).join(' ')}` : '';
  return redactSecrets(
    `${prefix}[${input.level.toUpperCase()}] (${input.scope}) ${input.message}${extra}`,
  );
}

/** Console-only logger (stderr). */
export function createLogger(scope: string, minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, message: string, rest: unknown[]): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    console.error(formatLine({ level, scope, message, rest }));
  };
  return {
    debug: (m, ...r) => emit('debug', m, r),
    info: (m, ...r) => emit('info', m, r),
    warn: (m, ...r) => emit('warn', m, r),
    error: (m, ...r) => emit('error', m, r),
  };
}

export interface FileLoggerOptions {
  scope: string;
  minLevel?: LogLevel;
  /** Directory for daily log files (`bridge-YYYY-MM-DD.log`). */
  logDir: string;
  /** Also write to stderr (default true). */
  toConsole?: boolean;
  /** Injected clock for the timestamp + rotation filename (default `new Date()`). */
  now?: () => Date;
}

/**
 * Logger that writes to stderr and appends to a daily-rotated file. Logging never
 * throws: file errors are swallowed so a logging failure can't crash the daemon.
 */
export function createFileLogger(options: FileLoggerOptions): Logger {
  const threshold = LEVEL_ORDER[options.minLevel ?? 'info'];
  const now = options.now ?? ((): Date => new Date());
  const toConsole = options.toConsole !== false;
  let ensured = false;

  const emit = (level: LogLevel, message: string, rest: unknown[]): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const date = now();
    const line = formatLine({
      level,
      scope: options.scope,
      message,
      rest,
      timestamp: date.toISOString(),
    });
    if (toConsole) console.error(line);
    try {
      if (!ensured) {
        mkdirSync(options.logDir, { recursive: true });
        ensured = true;
      }
      appendFileSync(logFileFor(options.logDir, date), `${line}\n`);
    } catch {
      // logging must never throw
    }
  };

  return {
    debug: (m, ...r) => emit('debug', m, r),
    info: (m, ...r) => emit('info', m, r),
    warn: (m, ...r) => emit('warn', m, r),
    error: (m, ...r) => emit('error', m, r),
  };
}

/** `<dir>/bridge-YYYY-MM-DD.log` for the given date. */
export function logFileFor(dir: string, date: Date): string {
  return join(dir, `bridge-${date.toISOString().slice(0, 10)}.log`);
}
