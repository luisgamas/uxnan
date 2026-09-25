import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockIdOf,
  isRunning,
  runningBlock,
  settleBlock,
  withBlockId,
} from '../../src/adapters/content-blocks.js';
import { toolUseStartBlock } from '../../src/adapters/claude-tools.js';
import { codexItemStartBlock } from '../../src/adapters/codex-tools.js';
import { opencodeToolStartBlock } from '../../src/adapters/opencode-tools.js';
import { piToolStartBlock } from '../../src/adapters/pi-tools.js';
import { acpToolKind, acpToolStartBlock } from '../../src/adapters/acp-tools.js';

test('runningBlock, withBlockId and settleBlock mark a step and close it', () => {
  const cmd = runningBlock({ type: 'command_execution', command: 'ls', status: 'completed' }, 'c1');
  assert.deepEqual(cmd, {
    type: 'command_execution',
    command: 'ls',
    status: 'running',
    blockId: 'c1',
  });
  assert.equal(isRunning(cmd), true);
  assert.equal(blockIdOf(cmd), 'c1');
  assert.equal(settleBlock(cmd, true)['status'], 'completed');
  assert.equal(settleBlock(cmd, false)['status'], 'error');
  const sub = runningBlock(
    { type: 'subagent', state: { id: 's', name: 'x', status: 'completed' } },
    's',
  );
  assert.equal(isRunning(sub), true);
  assert.deepEqual(settleBlock(sub, true)['state'], { id: 's', name: 'x', status: 'completed' });
  const tool = runningBlock({ type: 'tool', toolName: 'Read', isError: false }, 't');
  assert.deepEqual(settleBlock(tool, true), {
    type: 'tool',
    toolName: 'Read',
    isError: false,
    blockId: 't',
  });
  assert.equal(settleBlock(tool, false)['isError'], true);
  assert.deepEqual(withBlockId({ type: 'diff' }, 'd'), { type: 'diff', blockId: 'd' });
  assert.equal(isRunning({ type: 'diff' }), false);
  assert.equal(blockIdOf({ type: 'diff' }), undefined);
});

test('Claude: a tool shows as it starts, except what shows only once done', () => {
  const bash = toolUseStartBlock({ id: 'tu', name: 'Bash', input: { command: 'ls' } });
  assert.deepEqual(bash, {
    type: 'command_execution',
    command: 'ls',
    status: 'running',
    blockId: 'tu',
  });
  const agent = toolUseStartBlock({ id: 'ag', name: 'Agent', input: { description: 'Audit' } });
  assert.equal((agent?.['state'] as Record<string, unknown>)['status'], 'running');
  assert.equal(
    toolUseStartBlock({ id: 'r', name: 'Read', input: { file_path: 'a' } })?.['kind'],
    'read',
  );
  for (const name of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'TodoWrite', 'ToolSearch']) {
    assert.equal(toolUseStartBlock({ id: 'x', name, input: {} }), null, name);
  }
});

test('Codex: a started item shows as running, a file change waits for its diff', () => {
  assert.deepEqual(
    codexItemStartBlock({ type: 'commandExecution', id: 'i1', command: "/bin/zsh -lc 'ls'" }),
    { type: 'command_execution', command: 'ls', status: 'running', blockId: 'i1' },
  );
  const mcp = codexItemStartBlock({
    type: 'mcpToolCall',
    id: 'i2',
    server: 's',
    tool: 't',
    arguments: {},
  });
  assert.equal(mcp?.['status'], 'running');
  assert.equal(mcp?.['isError'], false);
  assert.equal(codexItemStartBlock({ type: 'fileChange', id: 'i3', changes: [] }), null);
});

test('OpenCode and pi: a tool shows as it starts, an edit only once done', () => {
  assert.equal(opencodeToolStartBlock('shell', 'p1', { command: 'ls' })?.['status'], 'running');
  assert.equal(opencodeToolStartBlock('read', 'p2', { path: 'a' })?.['kind'], 'read');
  assert.equal(opencodeToolStartBlock('edit', 'p3', {}), null);
  assert.equal(
    piToolStartBlock({ id: 'b1', name: 'bash', input: { command: 'ls' } })?.['blockId'],
    'b1',
  );
  assert.equal(piToolStartBlock({ id: 'w1', name: 'write', input: {} }), null);
});

test('ACP: a call shows as it starts, from Grok’s meta kind when the call has none', () => {
  assert.equal(
    acpToolKind({ title: 'run_terminal_command', _meta: { 'x.ai/tool': { kind: 'execute' } } }),
    'execute',
  );
  const started = acpToolStartBlock({
    toolCallId: 'g1',
    title: 'run_terminal_command',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'ls' },
  });
  assert.deepEqual(started, {
    type: 'command_execution',
    command: 'ls',
    status: 'running',
    blockId: 'g1',
  });
  assert.equal(
    acpToolStartBlock({ toolCallId: 'e', title: 'edit', kind: 'edit', status: 'pending' }),
    null,
  );
  assert.equal(
    acpToolStartBlock({
      toolCallId: 'p',
      title: 'update_plan',
      kind: 'think',
      status: 'pending',
      rawInput: { plan: [{ content: 'a' }] },
    }),
    null,
  );
});
