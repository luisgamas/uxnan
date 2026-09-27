/**
 * Plan limits asked of the agent CLIs themselves.
 *
 * Each CLI already holds its own sign-in — Claude Code in the macOS Keychain
 * or its credentials file, Codex in `~/.codex/auth.json` or the OS keyring —
 * and answers for its own account over the headless surface the bridge drives
 * it on. Asking it means the bridge never reads a credential: no token file,
 * no Keychain item, no OS permission prompt (the problem that kept Claude's
 * limits off the phone on macOS).
 *
 * - **Claude Code**: `claude --input-format stream-json --output-format
 *   stream-json`, then the control requests `initialize` (the account: email,
 *   organization, plan) and `get_usage` (the same body as the plan-usage API:
 *   `rate_limits.limits[]` with `percent`/`resets_at`, `extra_usage`, …).
 *   No turn runs and no token is spent (verified on 2.1.283).
 * - **Codex**: `codex app-server`, then `account/read` (email, plan) and
 *   `account/rateLimits/read` (`primary`/`secondary` windows with
 *   `usedPercent`, `windowDurationMins`, `resetsAt`; credits; reset credits).
 *
 * Both processes are short-lived and killed as soon as they answered, or after
 * {@link PROBE_TIMEOUT_MS}.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { agentLocation, locateAgent, type AgentId } from '@uxnan/shared';

/** How long a CLI is given to answer. */
export const PROBE_TIMEOUT_MS = 20_000;

/** What Claude Code says about its account and its limits. */
export interface ClaudeUsageAnswer {
  account?: { email?: string; organization?: string; subscriptionType?: string };
  /** `get_usage`'s `response` (with `rate_limits`, `subscription_type`, …). */
  usage?: Record<string, unknown>;
}

/** What Codex says about its account and its limits. */
export interface CodexUsageAnswer {
  account?: Record<string, unknown>;
  rateLimits?: Record<string, unknown>;
}

/** The CLI's binary, or undefined when it is not installed. */
export function cliBinary(agentId: AgentId): { path: string; prependArgs: string[] } | undefined {
  const location = agentLocation(agentId);
  if (!location) return undefined;
  const located = locateAgent(location);
  return located.available
    ? { path: located.binaryPath, prependArgs: located.prependArgs }
    : undefined;
}

type Json = Record<string, unknown>;

function asObj(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
}

/**
 * Run [binary] with [args], write each request as a JSON line, and resolve
 * with the answers [collect] picks from its stdout lines, once it says it has
 * them all. Rejects on a spawn failure or the timeout.
 */
function converse<T>(
  binary: { path: string; prependArgs: string[] },
  args: string[],
  requests: Json[],
  collect: (
    line: Json,
    done: (value: T) => void,
    fail: (err: Error) => void,
    send: (request: Json) => void,
  ) => void,
  env: NodeJS.ProcessEnv,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary.path, [...binary.prependArgs, ...args], {
      cwd: homedir(),
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('the CLI did not answer in time'))),
      PROBE_TIMEOUT_MS,
    );
    child.on('error', (err) => finish(() => reject(err)));
    child.on('exit', () => finish(() => reject(new Error('the CLI exited without answering'))));
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: Json | undefined;
        try {
          message = asObj(JSON.parse(line));
        } catch {
          continue;
        }
        if (message) {
          collect(
            message,
            (value) => finish(() => resolve(value)),
            (err) => finish(() => reject(err)),
            send,
          );
        }
      }
    });
    function send(request: Json): void {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    for (const request of requests) send(request);
  });
}

/** An environment for a probe: the CLI's own, without this session's markers. */
function probeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  delete env['CLAUDE_CODE_ENTRYPOINT'];
  return env;
}

/** Ask Claude Code for its account and limits. */
export async function askClaudeUsage(): Promise<ClaudeUsageAnswer | undefined> {
  const binary = cliBinary('claude-code');
  if (!binary) return undefined;
  const answer: ClaudeUsageAnswer = {};
  return converse<ClaudeUsageAnswer>(
    binary,
    ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
    [
      { type: 'control_request', request_id: 'uxnan-init', request: { subtype: 'initialize' } },
      { type: 'control_request', request_id: 'uxnan-usage', request: { subtype: 'get_usage' } },
    ],
    (message, done) => {
      if (message['type'] !== 'control_response') return;
      const response = asObj(message['response']);
      const body = asObj(response?.['response']);
      if (response?.['request_id'] === 'uxnan-init') {
        const account = asObj(body?.['account']);
        if (account) answer.account = account as ClaudeUsageAnswer['account'];
      } else if (response?.['request_id'] === 'uxnan-usage') {
        if (body) answer.usage = body;
        done(answer);
      }
    },
    probeEnv(),
  );
}

const CODEX_INITIALIZE: Json = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { clientInfo: { name: 'uxnan-bridge', version: '1' } },
};

/** Ask Codex for its account and limits. */
export async function askCodexUsage(): Promise<CodexUsageAnswer | undefined> {
  const binary = cliBinary('codex');
  if (!binary) return undefined;
  const answer: CodexUsageAnswer = {};
  return converse<CodexUsageAnswer>(
    binary,
    ['app-server'],
    [CODEX_INITIALIZE],
    (message, done, _fail, send) => {
      // The app-server takes requests only once it has answered `initialize`.
      if (message['id'] === 1) {
        send({ jsonrpc: '2.0', method: 'initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'account/read', params: { refreshToken: false } });
        send({ jsonrpc: '2.0', id: 3, method: 'account/rateLimits/read' });
      }
      if (message['id'] === 2) answer.account = asObj(asObj(message['result'])?.['account']);
      if (message['id'] === 3) {
        answer.rateLimits = asObj(message['result']);
        done(answer);
      }
    },
    process.env,
  );
}

/**
 * Redeem one of Codex's rate-limit resets (`account/rateLimitResetCredit/consume`),
 * the soonest-expiring one when [creditId] is omitted. [idempotencyKey] names
 * the attempt, so a retry never redeems twice.
 */
export async function redeemCodexReset(idempotencyKey: string, creditId?: string): Promise<void> {
  const binary = cliBinary('codex');
  if (!binary) throw new Error('Codex is not installed on this PC');
  await converse<void>(
    binary,
    ['app-server'],
    [CODEX_INITIALIZE],
    (message, done, fail, send) => {
      if (message['id'] === 1) {
        send({ jsonrpc: '2.0', method: 'initialized' });
        send({
          jsonrpc: '2.0',
          id: 2,
          method: 'account/rateLimitResetCredit/consume',
          params: { idempotencyKey, ...(creditId ? { creditId } : {}) },
        });
      }
      if (message['id'] !== 2) return;
      const error = asObj(message['error']);
      if (error) fail(new Error(String(error['message'] ?? 'Codex refused the reset')));
      else done(undefined);
    },
    process.env,
  );
}
