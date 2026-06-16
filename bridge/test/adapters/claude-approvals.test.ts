import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaudeControlResponse,
  claudeRequestToBlock,
  parseClaudeControlRequest,
} from '../../src/adapters/claude-approvals.js';

test('parseClaudeControlRequest extracts a can_use_tool request', () => {
  const req = parseClaudeControlRequest({
    type: 'control_request',
    request_id: 'r1',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls -la' } },
  });
  assert.deepEqual(req, { requestId: 'r1', toolName: 'Bash', input: { command: 'ls -la' } });
});

test('parseClaudeControlRequest returns null for non-permission lines', () => {
  assert.equal(parseClaudeControlRequest({ type: 'assistant' }), null);
  assert.equal(
    parseClaudeControlRequest({ type: 'control_request', request_id: 'r', request: { subtype: 'initialize' } }),
    null,
  );
  assert.equal(parseClaudeControlRequest('not an object'), null);
  assert.equal(parseClaudeControlRequest(null), null);
});

test('buildClaudeControlResponse allows on approve/approveSession and denies on reject', () => {
  const allow = JSON.parse(buildClaudeControlResponse('r1', 'approve', { command: 'ls' }));
  assert.equal(allow.type, 'control_response');
  assert.equal(allow.response.subtype, 'success');
  assert.equal(allow.response.request_id, 'r1');
  assert.equal(allow.response.response.behavior, 'allow');
  assert.deepEqual(allow.response.response.updatedInput, { command: 'ls' });

  const session = JSON.parse(buildClaudeControlResponse('r2', 'approveSession', {}));
  assert.equal(session.response.response.behavior, 'allow');

  const deny = JSON.parse(buildClaudeControlResponse('r3', 'reject', {}));
  assert.equal(deny.response.response.behavior, 'deny');
  assert.equal(typeof deny.response.response.message, 'string');
});

test('claudeRequestToBlock builds an approval block with risk + detail', () => {
  const block = claudeRequestToBlock(
    { requestId: 'r', toolName: 'Bash', input: { command: 'rm -rf x' } },
    'appr-1',
  );
  assert.equal(block.type, 'approval');
  assert.equal(block.approvalId, 'appr-1');
  assert.equal(block.risk, 'high');
  assert.match(block.action, /Bash/);
  assert.equal(block.detail, 'rm -rf x');

  // A read-ish tool gets a medium risk and no command detail.
  const read = claudeRequestToBlock({ requestId: 'r', toolName: 'Read', input: { file_path: '/a' } }, 'appr-2');
  assert.equal(read.risk, 'medium');
  assert.equal(read.detail, '/a');
});
