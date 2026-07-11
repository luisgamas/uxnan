import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPlanSteps, planBlock } from '../../src/adapters/content-blocks.js';
import { toolUseToBlock } from '../../src/adapters/claude-tools.js';
import { opencodeToolBlock, mergePlanSteps } from '../../src/adapters/opencode-tools.js';
import { piToolBlock } from '../../src/adapters/pi-tools.js';
import { codexItemBlocks } from '../../src/adapters/codex-tools.js';
import { zeroToolBlock, zeroPlanSteps } from '../../src/adapters/zero-tools.js';
import { grokToolBlock, grokPlanSteps } from '../../src/adapters/grok-tools.js';

test('extractPlanSteps reads the Claude/OpenCode `todos` shape', () => {
  const steps = extractPlanSteps({
    todos: [
      { content: 'Read the spec', status: 'completed', activeForm: 'Reading the spec' },
      { content: 'Write the code', status: 'in_progress' },
      { content: 'Test it', status: 'pending' },
    ],
  });
  assert.deepEqual(steps, [
    { description: 'Read the spec', status: 'completed' },
    { description: 'Write the code', status: 'in_progress' },
    { description: 'Test it', status: 'pending' },
  ]);
});

test('extractPlanSteps reads the Codex `plan` shape + normalizes status', () => {
  const steps = extractPlanSteps({
    plan: [
      { step: 'Investigate', status: 'in-progress' },
      { step: 'Fix', status: 'done' },
    ],
  });
  assert.deepEqual(steps, [
    { description: 'Investigate', status: 'in_progress' },
    { description: 'Fix', status: 'completed' },
  ]);
});

test('extractPlanSteps tolerates a bare string array and unknown statuses', () => {
  assert.deepEqual(extractPlanSteps(['a', 'b']), [
    { description: 'a', status: 'pending' },
    { description: 'b', status: 'pending' },
  ]);
  assert.deepEqual(extractPlanSteps({ steps: [{ text: 'x', status: 'weird' }] }), [
    { description: 'x', status: 'pending' },
  ]);
});

test('extractPlanSteps returns [] for unparseable input (no false plan)', () => {
  assert.deepEqual(extractPlanSteps({ foo: 'bar' }), []);
  assert.deepEqual(extractPlanSteps(null), []);
  assert.deepEqual(extractPlanSteps('nope'), []);
});

test('planBlock matches the phone PlanContent wire shape', () => {
  assert.deepEqual(planBlock([{ description: 'a', status: 'pending' }], 'My plan'), {
    type: 'plan',
    state: { title: 'My plan', steps: [{ description: 'a', status: 'pending' }] },
  });
  // No title → omitted.
  assert.deepEqual(planBlock([]), { type: 'plan', state: { steps: [] } });
});

test('Claude TodoWrite maps to a plan block; other tools stay generic', () => {
  const block = toolUseToBlock(
    { id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Step 1', status: 'pending' }] } },
    { toolUseId: 't1', text: '', isError: false },
  );
  assert.equal(block['type'], 'plan');
  assert.deepEqual(block['state'], { steps: [{ description: 'Step 1', status: 'pending' }] });

  // A TodoWrite with no parseable steps falls back to a generic tool block.
  const empty = toolUseToBlock(
    { id: 't2', name: 'TodoWrite', input: {} },
    { toolUseId: 't2', text: 'ok', isError: false },
  );
  assert.equal(empty['type'], 'tool');
});

test('OpenCode todowrite maps to a plan block', () => {
  const block = opencodeToolBlock(
    'todowrite',
    'p1',
    { todos: [{ content: 'A', status: 'completed' }] },
    '',
    false,
  );
  assert.equal(block['type'], 'plan');
  assert.deepEqual(block['state'], { steps: [{ description: 'A', status: 'completed' }] });
});

test('mergePlanSteps collapses OpenCode double todowrite emit into one ordered step list', () => {
  // OpenCode emits todowrite up to twice per turn. The second emit must not
  // duplicate steps; statuses must advance (pending -> in_progress -> completed).
  const first = extractPlanSteps({
    todos: [
      { content: 'Read the spec', status: 'pending' },
      { content: 'Write the code', status: 'pending' },
    ],
  });
  const second = extractPlanSteps({
    todos: [
      { content: 'Read the spec', status: 'in_progress' },
      { content: 'Write the code', status: 'pending' },
      { content: 'Test it', status: 'pending' },
    ],
  });
  const merged = mergePlanSteps(mergePlanSteps([], first), second);
  assert.deepEqual(merged, [
    { description: 'Read the spec', status: 'in_progress' },
    { description: 'Write the code', status: 'pending' },
    { description: 'Test it', status: 'pending' },
  ]);
});

test('mergePlanSteps only advances status forward, never backward', () => {
  const a = mergePlanSteps([], [{ description: 'X', status: 'completed' }]);
  const b = mergePlanSteps(a, [{ description: 'X', status: 'pending' }]);
  assert.deepEqual(b, [{ description: 'X', status: 'completed' }]);
});

test('mergePlanSteps is order-stable for unchanged steps', () => {
  const a = mergePlanSteps(
    [],
    [
      { description: 'first', status: 'pending' },
      { description: 'second', status: 'pending' },
    ],
  );
  const b = mergePlanSteps(a, [
    { description: 'second', status: 'in_progress' },
    { description: 'first', status: 'in_progress' },
  ]);
  assert.deepEqual(b, [
    { description: 'first', status: 'in_progress' },
    { description: 'second', status: 'in_progress' },
  ]);
});

test('pi todo tool maps to a plan block', () => {
  const block = piToolBlock(
    { id: 'p1', name: 'todo', input: { todos: [{ content: 'A', status: 'in_progress' }] } },
    '',
    false,
  );
  assert.equal(block['type'], 'plan');
  assert.deepEqual(block['state'], { steps: [{ description: 'A', status: 'in_progress' }] });
});

test('Codex update_plan item maps to a plan block', () => {
  const blocks = codexItemBlocks({
    type: 'update_plan',
    explanation: 'Doing the work',
    plan: [
      { step: 'One', status: 'completed' },
      { step: 'Two', status: 'in_progress' },
    ],
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.['type'], 'plan');
  assert.deepEqual(blocks[0]?.['state'], {
    title: 'Doing the work',
    steps: [
      { description: 'One', status: 'completed' },
      { description: 'Two', status: 'in_progress' },
    ],
  });
});

// The ACP agents (Zero, Grok) report their plan via `session/update`'s `plan`
// entries, which the adapter turns into a plan block. Both must produce the SAME
// canonical `plan` shape as the CLI agents above, so the phone renders one
// PlanCard widget regardless of which agent (or tool name) produced it.
test('Zero plan entries map to the same plan block', () => {
  const steps = zeroPlanSteps([
    { content: 'One', priority: 'high', status: 'completed' },
    { content: 'Two', priority: 'medium', status: 'in_progress' },
  ]);
  assert.deepEqual(planBlock(steps), {
    type: 'plan',
    state: {
      steps: [
        { description: 'One', status: 'completed' },
        { description: 'Two', status: 'in_progress' },
      ],
    },
  });
});

test('Grok plan entries map to the same plan block', () => {
  const steps = grokPlanSteps([
    { content: 'One', priority: 'high', status: 'completed' },
    { content: 'Two', priority: 'medium', status: 'in_progress' },
  ]);
  assert.deepEqual(planBlock(steps), {
    type: 'plan',
    state: {
      steps: [
        { description: 'One', status: 'completed' },
        { description: 'Two', status: 'in_progress' },
      ],
    },
  });
});

// A shell/execute tool must normalize to the SAME `command_execution` block for
// every agent, regardless of the agent's own tool name (Claude `Bash`, OpenCode
// `bash`, ACP `execute`), so the phone renders one CommandCard for all of them.
test('execute/bash tools normalize to a command_execution block across agents', () => {
  const claude = toolUseToBlock(
    { id: 'c1', name: 'Bash', input: { command: 'ls' } },
    { toolUseId: 'c1', text: 'a.txt', isError: false },
  );
  const opencode = opencodeToolBlock('bash', 'o1', { command: 'ls' }, 'a.txt', false);
  const zero = zeroToolBlock({
    toolCallId: 'z1',
    title: 'shell',
    kind: 'execute',
    status: 'completed',
    rawInput: { cmd: 'ls' },
    content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
  });
  const grok = grokToolBlock({
    toolCallId: 'g1',
    title: 'shell',
    kind: 'execute',
    status: 'completed',
    rawInput: { command: 'ls' },
    content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
  });
  const expected = {
    type: 'command_execution',
    command: 'ls',
    status: 'completed',
    output: 'a.txt',
  };
  assert.deepEqual(claude, expected);
  assert.deepEqual(opencode, expected);
  assert.deepEqual(zero, expected);
  assert.deepEqual(grok, expected);
});
