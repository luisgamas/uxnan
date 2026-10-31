/**
 * Plan limits asked of the agent CLIs themselves.
 *
 * Each CLI already holds its own sign-in — Claude Code in the macOS Keychain
 * or its credentials file, Codex in `~/.codex/auth.json` or the OS keyring,
 * Antigravity in the OS keyring, `gh` in its own store — and answers for its
 * own account over a headless surface. Asking it means the bridge never reads
 * a credential: no token file, no Keychain item, no OS permission prompt (the
 * problem that kept Claude's limits off the phone on macOS). Every provider is
 * read this way; none is read from a token.
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
 * - **Grok**: `grok agent stdio` (the ACP surface the bridge drives it on),
 *   then `initialize` and the `_x.ai/billing` extension request — the billing
 *   config (`currentPeriod`, `creditUsagePercent`, the `{val}` USD amounts) and
 *   the account's `subscription_tier`, fetched by Grok with its own sign-in.
 * - **GitHub Copilot**: `gh api /copilot_internal/user` — GitHub's CLI calls
 *   the Copilot user endpoint with the sign-in it keeps, and the bridge reads
 *   only the answer (`quota_snapshots`, `copilot_plan`, `access_type_sku`,
 *   `login`); the token never leaves `gh`.
 * - **Antigravity**: `agy -p /usage --output-format json` and `agy -p /credits
 *   --output-format json` — print-mode answers for read-only slash commands
 *   (agy 1.1.11 and later) that start no agent turn, spend no quota and leave
 *   no conversation behind. Each answer is checked for exactly that before it
 *   is believed (see {@link askAntigravityUsage}).
 * - **OpenCode 2**: `opencode api --standalone GET /api/experimental/usage/limits`
 *   — its own server's answer for the OpenCode Console workspace it is signed
 *   in to (OpenCode Go meters and Console budgets), on a private server that
 *   exits with the request.
 *
 * Every process is short-lived and killed as soon as it answered, or after
 * {@link PROBE_TIMEOUT_MS}.
 */
import { execFile, spawn } from 'node:child_process';
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

/** The CLI to ask: its binary and any leading arguments (tests pass a fake). */
export type CliBinary = { path: string; prependArgs: string[] };

/** Ask Claude Code for its account and limits. */
export async function askClaudeUsage(
  binary: CliBinary | undefined = cliBinary('claude-code'),
): Promise<ClaudeUsageAnswer | undefined> {
  if (!binary) return undefined;
  const answer: ClaudeUsageAnswer = {};
  // Both answers are awaited, in whatever order they come (see Codex below).
  const answered = new Set<string>();
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
      const id = response?.['request_id'];
      if (id === 'uxnan-init') {
        const account = asObj(body?.['account']);
        if (account) answer.account = account as ClaudeUsageAnswer['account'];
      } else if (id === 'uxnan-usage') {
        if (body) answer.usage = body;
      } else {
        return;
      }
      answered.add(id);
      if (answered.has('uxnan-init') && answered.has('uxnan-usage')) done(answer);
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
export async function askCodexUsage(
  binary: CliBinary | undefined = cliBinary('codex'),
): Promise<CodexUsageAnswer | undefined> {
  if (!binary) return undefined;
  const answer: CodexUsageAnswer = {};
  // Both answers are awaited, in whatever order they come: the app-server
  // answers concurrent requests as each finishes, and resolving on the limits
  // alone read a signed-in account as signed out whenever they came first.
  const answered = new Set<number>();
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
        return;
      }
      if (message['id'] === 2) {
        answer.account = asObj(asObj(message['result'])?.['account']);
        answered.add(2);
      }
      if (message['id'] === 3) {
        answer.rateLimits = asObj(message['result']);
        answered.add(3);
      }
      if (answered.has(2) && answered.has(3)) done(answer);
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

// ── One-shot CLIs (Antigravity, OpenCode) ───────────────────────────────────

/** The most a one-shot answer may print before it is cut off (bytes). */
const ONE_SHOT_MAX_OUTPUT = 512 * 1024;

/** What a one-shot CLI printed, and how it ended. */
export interface OneShotResult {
  stdout: string;
  stderr: string;
  /** The exit code; `null` when it was killed (timeout) or never ran. */
  code: number | null;
  /** The binary was not found at all. */
  missing?: boolean;
}

/** Runs [binary] once with [args] (no stdin) and collects what it prints. */
export type RunOnce = (
  binary: CliBinary,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<OneShotResult>;

/** The default {@link RunOnce}: `execFile` from the home folder, capped and timed out. */
export const runOnce: RunOnce = (binary, args, env) =>
  new Promise((resolve) => {
    execFile(
      binary.path,
      [...binary.prependArgs, ...args],
      {
        cwd: homedir(),
        env,
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: ONE_SHOT_MAX_OUTPUT,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' && !error.killed ? error.code : null;
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code,
          ...(error?.code === 'ENOENT' ? { missing: true } : {}),
        });
      },
    );
  });

/** The JSON objects among [output]'s lines (anything else is skipped). */
export function jsonLines(output: string): Json[] {
  const out: Json[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      const value = asObj(JSON.parse(line));
      if (value) out.push(value);
    } catch {
      // Not JSON: a progress line, a banner.
    }
  }
  return out;
}

/** What Antigravity says about its limits and AI credits. */
export interface AntigravityUsageAnswer {
  /** `/usage`'s `command.data` (`groups[].buckets[]`). */
  usage?: Json;
  /** `/credits`'s `command.data` (`remaining_credits`). */
  credits?: Json;
  /** Why the limits could not be read, when they could not. */
  failure?: AntigravityFailure;
}

/** Why Antigravity did not answer with its limits. */
export type AntigravityFailure =
  /** It is not signed in. */
  | { kind: 'signedOut' }
  /** Too old for headless slash commands (`version` is what it reported). */
  | { kind: 'tooOld'; version: string }
  /** It ran the command as a model turn, so it is never asked again. */
  | { kind: 'ranTurn' }
  /** Anything else (`message` is safe to show: no output is quoted). */
  | { kind: 'error'; message: string };

/** The first agy whose print mode answers read-only slash commands headless. */
export const ANTIGRAVITY_MIN_VERSION: readonly [number, number, number] = [1, 1, 11];

/** The `X.Y.Z` an `agy --version` printed, or undefined. */
export function parseSemver(output: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function atLeast(
  version: [number, number, number],
  min: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    const have = version[i] ?? 0;
    const need = min[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

/**
 * Set once an agy answered a usage command with a model turn: from then on this
 * process never asks it again, whatever it is upgraded to, because each ask
 * would spend the user's quota. A bridge restart clears it.
 */
let antigravityRanTurn = false;

/** Test seam: forget that an agy ran a turn. */
export function resetAntigravityLatch(): void {
  antigravityRanTurn = false;
}

/** The environment agy runs with: its own, without an update check mid-probe. */
function antigravityEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
}

/**
 * The `command.data` of agy's answer to the read-only slash command [name], or
 * the reason there is none. An answer is believed only when it says it ran the
 * command (`status: SUCCESS`, `command.name`) **and** that no turn ran
 * (`num_turns` 0, no conversation id): anything else latches
 * {@link antigravityRanTurn} if a turn ran, and fails.
 */
export function readAntigravityAnswer(
  result: OneShotResult,
  name: string,
): { data: Json } | { failure: AntigravityFailure } {
  const lines = jsonLines(result.stdout);
  const answer = lines.find((line) => asObj(line['command']) !== undefined) ?? lines[0];
  if (answer) {
    const turns = typeof answer['num_turns'] === 'number' ? answer['num_turns'] : 0;
    const conversation = answer['conversation_id'];
    if (turns > 0 || (typeof conversation === 'string' && conversation.length > 0)) {
      antigravityRanTurn = true;
      return { failure: { kind: 'ranTurn' } };
    }
    const command = asObj(answer['command']);
    const data = asObj(command?.['data']);
    if (answer['status'] === 'SUCCESS' && command?.['name'] === name && data) return { data };
  }
  const printed = `${result.stdout}\n${result.stderr}`;
  if (
    /UNAUTHENTICATED|Authentication required|not (?:logged|signed) in|please (?:log|sign) in/i.test(
      printed,
    )
  ) {
    return { failure: { kind: 'signedOut' } };
  }
  if (/RESOURCE_EXHAUSTED/.test(printed)) {
    return {
      failure: { kind: 'error', message: 'Antigravity is rate-limited right now; try again later' },
    };
  }
  return {
    failure: {
      kind: 'error',
      message:
        result.code === null
          ? 'Antigravity did not answer in time'
          : 'Antigravity did not answer its usage request',
    },
  };
}

/**
 * Ask Antigravity for its limits (`/usage`) and AI credits (`/credits`). Its
 * version is checked first: a build older than {@link ANTIGRAVITY_MIN_VERSION}
 * sends slash text to the model as a prompt, so it is never asked. The two
 * commands run side by side; a credits failure only drops the credits.
 */
export async function askAntigravityUsage(
  binary: CliBinary | undefined = cliBinary('antigravity-cli'),
  run: RunOnce = runOnce,
): Promise<AntigravityUsageAnswer | undefined> {
  if (!binary) return undefined;
  if (antigravityRanTurn) return { failure: { kind: 'ranTurn' } };
  const env = antigravityEnv();
  const versionOut = await run(binary, ['--version'], env);
  const version = parseSemver(versionOut.stdout);
  if (!version) {
    return { failure: { kind: 'error', message: 'Antigravity did not report its version' } };
  }
  if (!atLeast(version, ANTIGRAVITY_MIN_VERSION)) {
    return { failure: { kind: 'tooOld', version: version.join('.') } };
  }
  // Never `--disable-slash-commands`: with it, the command is sent as a prompt.
  const ask = (command: string) =>
    run(binary, ['-p', command, '--output-format', 'json', '--print-timeout', '20s'], env);
  const [usageOut, creditsOut] = await Promise.all([ask('/usage'), ask('/credits')]);
  const usage = readAntigravityAnswer(usageOut, 'usage');
  if ('failure' in usage) return { failure: usage.failure };
  const credits = readAntigravityAnswer(creditsOut, 'credits');
  if ('failure' in credits && credits.failure.kind === 'ranTurn') {
    return { usage: usage.data, failure: credits.failure };
  }
  return { usage: usage.data, ...('data' in credits ? { credits: credits.data } : {}) };
}

/** What OpenCode's server says about its Console workspace's limits. */
export interface OpenCodeUsageAnswer {
  /** The response's `data`: `null` when not signed in to a Console workspace. */
  data?: Json | null;
  /** Why it could not be read, when it could not. */
  failure?: string;
}

/**
 * Ask OpenCode 2 for the usage limits of the Console workspace it is signed in
 * to, on a private (`--standalone`) server that exits with the request — the
 * background service a person may run is never started or touched.
 */
export async function askOpenCodeUsage(
  binary: CliBinary | undefined = cliBinary('opencode'),
  run: RunOnce = runOnce,
): Promise<OpenCodeUsageAnswer | undefined> {
  if (!binary) return undefined;
  const result = await run(
    binary,
    ['api', '--standalone', 'GET', '/api/experimental/usage/limits'],
    process.env,
  );
  return readOpenCodeAnswer(result);
}

/** The `{location, data}` an `opencode api` call printed, or why there is none. */
export function readOpenCodeAnswer(result: OneShotResult): OpenCodeUsageAnswer {
  let body: Json | undefined;
  try {
    body = asObj(JSON.parse(result.stdout.trim()));
  } catch {
    body = jsonLines(result.stdout).at(-1);
  }
  if (body && 'data' in body && 'location' in body) {
    const data = body['data'];
    return { data: data === null ? null : (asObj(data) ?? null) };
  }
  const tag = typeof body?.['_tag'] === 'string' ? body['_tag'] : undefined;
  if (tag === 'ServiceUnavailableError') {
    return { failure: 'the OpenCode Console did not answer; try again later' };
  }
  if (result.code === null) return { failure: 'OpenCode did not answer in time' };
  return {
    failure:
      'OpenCode did not answer its usage-limits request (it needs OpenCode 2 signed in to an OpenCode Console workspace)',
  };
}

/** What Grok says about its billing. */
export interface GrokUsageAnswer {
  /** `_x.ai/billing`'s result: `{ config, subscription_tier }`. */
  billing?: Json;
  /** The error Grok answered with instead (its message is shown as is). */
  error?: string;
}

/** Ask Grok for its billing over its own ACP surface (`_x.ai/billing`). */
export async function askGrokUsage(
  binary: CliBinary | undefined = cliBinary('grok'),
): Promise<GrokUsageAnswer | undefined> {
  if (!binary) return undefined;
  return converse<GrokUsageAnswer>(
    binary,
    ['agent', 'stdio'],
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {} },
      },
    ],
    (message, done, _fail, send) => {
      if (message['id'] === 1) {
        send({ jsonrpc: '2.0', id: 2, method: '_x.ai/billing', params: {} });
        return;
      }
      if (message['id'] !== 2) return;
      const error = asObj(message['error']);
      if (error) done({ error: String(error['message'] ?? 'Grok refused the billing request') });
      else done({ billing: asObj(message['result']) ?? {} });
    },
    process.env,
  );
}

/** What GitHub says about the signed-in account's Copilot. */
export interface CopilotUsageAnswer {
  /** `/copilot_internal/user`'s body. */
  user?: Json;
  /** `gh` is installed but not signed in. */
  signedOut?: boolean;
  /** Why it could not be read otherwise. */
  failure?: string;
}

/** The `gh` to ask: the one on PATH. */
const GH: CliBinary = { path: 'gh', prependArgs: [] };

/** Ask `gh` for the Copilot user record; undefined when `gh` is not installed. */
export async function askCopilotUsage(
  binary: CliBinary = GH,
  run: RunOnce = runOnce,
): Promise<CopilotUsageAnswer | undefined> {
  const result = await run(
    binary,
    ['api', '/copilot_internal/user', '-H', 'X-GitHub-Api-Version: 2025-04-01'],
    process.env,
  );
  if (result.missing) return undefined;
  return readCopilotAnswer(result);
}

/** What a `gh api /copilot_internal/user` run printed, read. */
export function readCopilotAnswer(result: OneShotResult): CopilotUsageAnswer {
  let body: Json | undefined;
  try {
    body = asObj(JSON.parse(result.stdout));
  } catch {
    body = undefined;
  }
  if (result.code === 0 && body) return { user: body };
  if (/gh auth login|not logged in|authentication/i.test(result.stderr)) return { signedOut: true };
  const message = typeof body?.['message'] === 'string' ? body['message'] : undefined;
  if (message === 'Not Found') {
    return { failure: 'this GitHub account has no Copilot access' };
  }
  if (message === 'Bad credentials' || message === 'Requires authentication') {
    return { signedOut: true };
  }
  if (result.code === null) return { failure: 'GitHub did not answer in time' };
  return { failure: message ? `GitHub answered: ${message}` : 'gh could not read Copilot usage' };
}
