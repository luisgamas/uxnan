/**
 * Generic agent adapter that drives an external CLI over stdio, exchanging
 * newline-delimited JSON ("the bridge agent IPC").
 *
 *   bridge → agent (stdin):  {"type":"turn","threadId","turnId","text"}
 *                            {"type":"cancel","threadId","turnId"}
 *   agent → bridge (stdout): {"type":"started"|"delta"|"completed"|"error",
 *                             "threadId","turnId","text"?}
 *
 * Real CLIs (Codex, OpenCode, …) do NOT speak this protocol natively — a
 * concrete subclass overrides {@link formatTurn}/{@link parseLine} to translate
 * the real CLI's flags and stream format. See codex-adapter.ts / opencode-adapter.ts.
 *
 * Source: architecture/02a-system-architecture.md §5.8.2.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type {
  AgentCapabilities,
  AgentConfig,
  AgentId,
  AgentStreamEvent,
  SendTurnOptions,
} from '@uxnan/shared';
import { BaseAgentAdapter } from './base-adapter.js';

export interface ProcessAdapterOptions {
  agentId: AgentId;
  capabilities: AgentCapabilities;
  /** Executable to spawn (resolved from PATH unless absolute). */
  binaryPath: string;
  /** Static args passed before any per-turn input. */
  args?: string[];
}

export class ProcessAgentAdapter extends BaseAgentAdapter {
  readonly agentId: AgentId;
  readonly capabilities: AgentCapabilities;
  readonly #binaryPath: string;
  readonly #args: string[];
  #child: ChildProcessWithoutNullStreams | undefined;
  #reader: Interface | undefined;

  constructor(options: ProcessAdapterOptions) {
    super();
    this.agentId = options.agentId;
    this.capabilities = options.capabilities;
    this.#binaryPath = options.binaryPath;
    this.#args = options.args ?? [];
  }

  start(config: AgentConfig): Promise<void> {
    if (this.#child) return Promise.resolve();
    const child = spawn(this.#binaryPath, this.#args, {
      cwd: config.cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;
    this.#reader = createInterface({ input: child.stdout });
    this.#reader.on('line', (line) => {
      const event = this.parseLine(line);
      if (event) this.emit(event);
    });
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.#reader?.close();
    this.#reader = undefined;
    if (this.#child) {
      this.#child.kill();
      this.#child = undefined;
    }
    return Promise.resolve();
  }

  sendTurn(options: SendTurnOptions): Promise<void> {
    this.#write(this.formatTurn(options));
    return Promise.resolve();
  }

  cancelTurn(threadId: string, turnId: string): Promise<void> {
    this.#write(JSON.stringify({ type: 'cancel', threadId, turnId }));
    return Promise.resolve();
  }

  /** Format the stdin payload for a turn. Override for real CLIs. */
  protected formatTurn(options: SendTurnOptions): string {
    return JSON.stringify({
      type: 'turn',
      threadId: options.threadId,
      turnId: options.turnId,
      text: options.text,
    });
  }

  /** Parse one stdout line into an event, or null to ignore. Override for real CLIs. */
  protected parseLine(line: string): AgentStreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
    const threadId = String(parsed['threadId'] ?? '');
    const turnId = String(parsed['turnId'] ?? '');
    const text = typeof parsed['text'] === 'string' ? parsed['text'] : undefined;
    switch (parsed['type']) {
      case 'started':
        return { type: 'turn_started', threadId, turnId };
      case 'delta':
        return { type: 'delta', threadId, turnId, data: { text: text ?? '' } };
      case 'completed':
        return { type: 'turn_completed', threadId, turnId, data: { text: text ?? '' } };
      case 'error':
        return { type: 'turn_error', threadId, turnId, data: { text: text ?? 'agent error' } };
      default:
        return null;
    }
  }

  #write(payload: string): void {
    if (!this.#child) {
      throw new Error(`agent '${this.agentId}' is not started`);
    }
    this.#child.stdin.write(`${payload}\n`);
  }
}
