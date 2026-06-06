/**
 * Minimal leveled logger for the bridge daemon.
 *
 * Security: callers MUST NOT pass secrets (keys, tokens) to the logger — see the
 * "Security" rules in AGENTS.md. File-based logging with rotation under
 * `~/.uxnan/logs/` is deferred.
 *
 * FOR-DEV: write logs to `~/.uxnan/logs/bridge-YYYY-MM-DD.log` with rotation and
 * a redaction pass (src/logger.ts) — unblocked once the daemon runs persistently.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export function createLogger(scope: string, minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, message: string, rest: unknown[]): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = `[${level.toUpperCase()}] (${scope}) ${message}`;
    if (level === 'error' || level === 'warn') {
      console.error(line, ...rest);
    } else {
      console.error(line, ...rest); // all logs go to stderr; stdout is reserved for IPC
    }
  };
  return {
    debug: (m, ...r) => emit('debug', m, r),
    info: (m, ...r) => emit('info', m, r),
    warn: (m, ...r) => emit('warn', m, r),
    error: (m, ...r) => emit('error', m, r),
  };
}
