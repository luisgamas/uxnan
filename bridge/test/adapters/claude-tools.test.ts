import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractToolResults,
  extractToolUses,
  toolUseToBlock,
} from '../../src/adapters/claude-tools.js';

test('extractToolUses pulls tool_use blocks from assistant content', () => {
  const uses = extractToolUses([
    { type: 'text', text: 'running it' },
    { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
  ]);
  assert.deepEqual(uses, [{ id: 'tu_1', name: 'Bash', input: { command: 'ls' } }]);
});

test('extractToolResults reads string and array tool_result content', () => {
  const results = extractToolResults([
    { type: 'tool_result', tool_use_id: 'tu_1', content: 'file list' },
    {
      type: 'tool_result',
      tool_use_id: 'tu_2',
      is_error: true,
      content: [{ type: 'text', text: 'boom' }],
    },
  ]);
  assert.deepEqual(results, [
    { toolUseId: 'tu_1', text: 'file list', isError: false },
    { toolUseId: 'tu_2', text: 'boom', isError: true },
  ]);
});

test('toolUseToBlock maps Bash to a command_execution block', () => {
  const block = toolUseToBlock(
    { id: 'tu_1', name: 'Bash', input: { command: 'type file.txt' } },
    { toolUseId: 'tu_1', text: 'hello', isError: false },
  );
  assert.deepEqual(block, {
    type: 'command_execution',
    command: 'type file.txt',
    status: 'completed',
    output: 'hello',
  });
});

test('toolUseToBlock maps a failed Bash to error status', () => {
  const block = toolUseToBlock(
    { id: 'tu_1', name: 'Bash', input: { command: 'bad' } },
    { toolUseId: 'tu_1', text: 'not found', isError: true },
  );
  assert.equal(block['status'], 'error');
});

test('toolUseToBlock maps Edit to a diff block with +/- counts', () => {
  const block = toolUseToBlock(
    {
      id: 'tu_1',
      name: 'Edit',
      input: { file_path: 'lib/a.dart', old_string: 'old', new_string: 'new\nmore' },
    },
    { toolUseId: 'tu_1', text: '', isError: false },
  );
  assert.equal(block['type'], 'diff');
  assert.equal(block['filename'], 'lib/a.dart');
  assert.equal(block['additions'], 2);
  assert.equal(block['deletions'], 1);
  assert.equal(block['diff'], '-old\n+new\n+more');
});

test('toolUseToBlock maps Write to an all-additions diff', () => {
  const block = toolUseToBlock(
    { id: 'tu_1', name: 'Write', input: { file_path: 'a.txt', content: 'l1\nl2' } },
    { toolUseId: 'tu_1', text: '', isError: false },
  );
  assert.equal(block['type'], 'diff');
  assert.equal(block['additions'], 2);
  assert.equal(block['deletions'], 0);
  assert.equal(block['diff'], '+l1\n+l2');
});

test('toolUseToBlock maps other tools to a generic tool block', () => {
  const block = toolUseToBlock(
    { id: 'tu_1', name: 'Read', input: { file_path: 'a.txt' } },
    { toolUseId: 'tu_1', text: 'contents', isError: false },
  );
  assert.deepEqual(block, {
    type: 'tool',
    toolName: 'Read',
    toolId: 'tu_1',
    input: { file_path: 'a.txt' },
    output: 'contents',
    isError: false,
  });
});
