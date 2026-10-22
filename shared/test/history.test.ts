import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JsonRpcErrorCode,
  METHOD_NAMES,
  RpcError,
  STEP_COMMAND_PREVIEW_CHARS,
  STEP_OUTPUT_PREVIEW_CHARS,
  STEP_PAGE_MAX_BYTES,
  STEP_THINKING_PREVIEW_CHARS,
  TURN_PAGE_MAX_BYTES,
  appendThinkingSegment,
  isStep,
  isThinkingSegment,
  isStepPreview,
  isWorkRunSegment,
  jsonBytes,
  previewStep,
  previewStepRange,
  stepFailed,
  stepRunning,
  summarizeMessage,
  summarizeSegments,
  summarizeTurn,
  utf8Length,
  type Message,
  type StepPreview,
  type StepType,
  type WorkRunSegment,
} from '../src/index.js';

const text = (t: string) => ({ type: 'text', text: t });
const cmd = (command: string, extra: Record<string, unknown> = {}) => ({
  type: 'command_execution',
  command,
  status: 'completed',
  output: 'ok',
  ...extra,
});
const diff = (filename: string, additions: number, deletions: number) => ({
  type: 'diff',
  filename,
  diff: `+${'x'.repeat(50)}`,
  additions,
  deletions,
  blockId: `d-${filename}`,
});
const tool = (extra: Record<string, unknown> = {}) => ({
  type: 'tool',
  toolName: 'Read',
  toolId: 't1',
  input: { file_path: 'a.ts' },
  output: 'content',
  isError: false,
  kind: 'read',
  ...extra,
});
const thought = (t: string) => ({ type: 'thinking', text: t });
const step = (value: Record<string, unknown>) =>
  value as Record<string, unknown> & { type: StepType };
/** A preview, readable field by field. */
const preview = (value: Record<string, unknown>, index: number) =>
  previewStep(step(value), index) as StepPreview & Record<string, unknown>;

test('the budgets are the documented ones', () => {
  assert.equal(TURN_PAGE_MAX_BYTES, 1024 * 1024);
  assert.equal(STEP_PAGE_MAX_BYTES, 256 * 1024);
  assert.equal(STEP_COMMAND_PREVIEW_CHARS, 400);
  assert.equal(STEP_OUTPUT_PREVIEW_CHARS, 1200);
  assert.equal(STEP_THINKING_PREVIEW_CHARS, 600);
});

test('only commands, edits, tool calls and thoughts are steps', () => {
  assert.ok(isStep(cmd('ls')));
  assert.ok(isStep(diff('a', 1, 0)));
  assert.ok(isStep(tool()));
  assert.ok(isStep(thought('hm')));
  for (const other of [text('x'), { type: 'plan' }, { type: 'subagent' }, null, 'x', []]) {
    assert.ok(!isStep(other));
  }
});

test('a run of steps ends at text, a boundary or any other block', () => {
  const segments = [
    text('a'),
    cmd('ls'),
    tool(),
    text(''),
    cmd('pwd'),
    { type: 'assistant_response_boundary' },
    diff('f', 1, 0),
    { type: 'plan', steps: [] },
    cmd('x'),
    text('done'),
  ];
  const out = summarizeSegments(segments);
  assert.deepEqual(
    out.map((s) => (s as { type: string }).type),
    ['text', 'work', 'text', 'work', 'assistant_response_boundary', 'work', 'plan', 'work', 'text'],
  );
  const runs = out.filter(isWorkRunSegment);
  assert.deepEqual(
    runs.map((r) => [r.from, r.to]),
    [
      [1, 2],
      [4, 4],
      [6, 6],
      [8, 8],
    ],
  );
  // Everything that is not a step is served as stored.
  assert.equal(out[0], segments[0]);
  assert.equal(out[6], segments[7]);
});

test('a run counts its kinds, failures and running steps, and merges its files', () => {
  const [run] = summarizeSegments([
    cmd('a'),
    cmd('b', { status: 'error' }),
    cmd('c', { exitCode: 2, status: 'completed' }),
    diff('x.ts', 3, 1),
    tool({ isError: true }),
    diff('y.ts', 1, 0),
    diff('x.ts', 2, 2),
    tool({ status: 'running' }),
    cmd('d', { status: 'in_progress' }),
  ]) as [WorkRunSegment];
  assert.equal(run.commands, 4);
  assert.equal(run.edits, 3);
  assert.equal(run.tools, 2);
  assert.equal(run.thoughts, 0);
  assert.equal(run.failed, 3);
  assert.equal(run.running, 2);
  assert.deepEqual(run.files, [
    { filename: 'x.ts', additions: 5, deletions: 3 },
    { filename: 'y.ts', additions: 1, deletions: 0 },
  ]);
  assert.equal(run.from, 0);
  assert.equal(run.to, 8);
  assert.equal(run.last.index, 8);
  assert.equal(run.last.type, 'command_execution');
});

test('failed and running follow the desktop rules', () => {
  assert.ok(stepFailed({ status: 'error' }));
  assert.ok(stepFailed({ isError: true }));
  assert.ok(stepFailed({ state: { status: 'error' } }));
  assert.ok(stepFailed({ exitCode: 1 }));
  assert.ok(!stepFailed({ exitCode: 0, status: 'completed' }));
  assert.ok(stepRunning({ status: 'running' }));
  assert.ok(stepRunning({ status: 'in_progress' }));
  assert.ok(stepRunning({ state: { status: 'running' } }));
  assert.ok(stepRunning({ state: { status: 'in_progress' } }));
  assert.ok(!stepRunning({ status: 'completed' }));
});

test('a command preview keeps the head of the command and the tail of the output, with sizes', () => {
  const command = 'c'.repeat(STEP_COMMAND_PREVIEW_CHARS + 10);
  const output = `${'o'.repeat(5000)}END`;
  const p = preview(cmd(command, { output, blockId: 'b1', exitCode: 0 }), 7);
  assert.equal(p.type, 'command_execution');
  assert.equal(p.index, 7);
  assert.equal(p.blockId, 'b1');
  assert.equal(p['command'], 'c'.repeat(STEP_COMMAND_PREVIEW_CHARS));
  assert.equal(p['commandChars'], command.length);
  assert.equal((p['output'] as string).length, STEP_OUTPUT_PREVIEW_CHARS);
  assert.ok((p['output'] as string).endsWith('END'));
  assert.equal(p['outputChars'], output.length);
  assert.equal(p['exitCode'], 0);
});

test('a short command preview is the block plus its index, with no sizes', () => {
  const p = preview(cmd('ls'), 0);
  assert.deepEqual(p, { ...cmd('ls'), index: 0 });
});

test('a diff preview drops the body and reports its size', () => {
  const block = diff('a.ts', 4, 2);
  const p = preview(block, 3);
  assert.deepEqual(p, {
    type: 'diff',
    index: 3,
    filename: 'a.ts',
    additions: 4,
    deletions: 2,
    blockId: 'd-a.ts',
    diffChars: block.diff.length,
  });
  const bodiless = preview(
    { type: 'diff', filename: 'b', diff: '', additions: 0, deletions: 0 },
    1,
  );
  assert.equal('diffChars' in bodiless, false);
});

test('a tool preview bounds its input and its output', () => {
  const big = 'w'.repeat(10_000);
  const input = {
    file_path: 'a.ts',
    content: big,
    list: Array.from({ length: 50 }, (_, i) => i),
    deep: { a: { b: { c: { d: 'gone' } } } },
  };
  const p = preview(tool({ input, output: `${'r'.repeat(3000)}Z` }), 2);
  const bounded = p['input'] as Record<string, unknown>;
  assert.equal(bounded['file_path'], 'a.ts');
  assert.equal((bounded['content'] as string).length, STEP_COMMAND_PREVIEW_CHARS);
  assert.equal((bounded['list'] as unknown[]).length, 20);
  assert.deepEqual(bounded['deep'], { a: { b: { c: {} } } });
  assert.equal(p['inputChars'], JSON.stringify(input).length);
  assert.ok((p['output'] as string).endsWith('Z'));
  assert.equal(p['outputChars'], 3001);
  assert.equal(p['kind'], 'read');
  const small = preview(tool(), 0);
  assert.equal('inputChars' in small, false);
  assert.equal('outputChars' in small, false);
});

test('a cut never splits a surrogate pair', () => {
  const emoji = '😀';
  const command = `${'a'.repeat(STEP_COMMAND_PREVIEW_CHARS - 1)}${emoji}tail`;
  const p = preview(cmd(command), 0);
  assert.equal(p['command'], 'a'.repeat(STEP_COMMAND_PREVIEW_CHARS - 1));
  const output = `${emoji}${'b'.repeat(STEP_OUTPUT_PREVIEW_CHARS - 1)}`;
  const outPreview = preview(cmd('x', { output: `head${output}` }), 0);
  assert.equal(outPreview['output'], 'b'.repeat(STEP_OUTPUT_PREVIEW_CHARS - 1));
});

test('a page message folds its thoughts into the runs they sit in', () => {
  const message: Message = {
    id: 'm',
    turnId: 't',
    role: 'assistant',
    content: 'hi',
    segments: [thought('plan'), cmd('ls'), thought('so'), cmd('pwd'), text('hi'), thought('end')],
    createdAt: 1,
  };
  const page = summarizeMessage(message);
  assert.deepEqual(
    page.segments!.map((s) => (s as { type: string }).type),
    ['work', 'text', 'work'],
  );
  const [first, , last] = page.segments as [WorkRunSegment, unknown, WorkRunSegment];
  // A thought between two commands does not split their run.
  assert.deepEqual([first.from, first.to, first.commands, first.thoughts], [0, 3, 2, 2]);
  assert.equal(first.running, 0);
  assert.equal(first.failed, 0);
  assert.deepEqual([last.from, last.to, last.thoughts], [5, 5, 1]);
  assert.deepEqual(last.last, { type: 'thinking', index: 5, text: 'end' });
  // The stored message is not changed, and nothing of the old message-level
  // reasoning rides a page.
  assert.equal((message.segments![0] as { type: string }).type, 'thinking');
  assert.equal('thinking' in page, false);
  assert.equal('thinkingChars' in page, false);
});

test('a thought preview keeps its head, never splitting a surrogate pair, with its size', () => {
  const long = `${'t'.repeat(STEP_THINKING_PREVIEW_CHARS - 1)}😀more`;
  const p = preview(thought(long), 4);
  assert.deepEqual(p, {
    type: 'thinking',
    index: 4,
    text: 't'.repeat(STEP_THINKING_PREVIEW_CHARS - 1),
    textChars: long.length,
  });
  assert.deepEqual(preview(thought('short'), 0), { type: 'thinking', index: 0, text: 'short' });
  assert.ok(isStepPreview(p));
  // A thought has no status: never failed, never running by itself.
  assert.ok(!stepFailed(thought('x')));
  assert.ok(!stepRunning(thought('x')));
});

test('a reasoning chunk grows the last thought, or opens one at the end', () => {
  const segments: unknown[] = [];
  assert.ok(appendThinkingSegment(segments, 'Let me '));
  assert.ok(appendThinkingSegment(segments, 'look.'));
  assert.deepEqual([...segments], [thought('Let me look.')]);
  segments.push(text('Looking'));
  // After text: a new thought at the end, never slotted before the open run.
  appendThinkingSegment(segments, 'hm');
  segments.push(cmd('ls'));
  appendThinkingSegment(segments, 'ok');
  assert.deepEqual(segments, [
    thought('Let me look.'),
    text('Looking'),
    thought('hm'),
    cmd('ls'),
    thought('ok'),
  ]);
  assert.ok(!appendThinkingSegment(segments, ''));
  assert.equal(segments.length, 5);
  assert.ok(isThinkingSegment(segments[0]));
  assert.ok(!isThinkingSegment(text('x')));
  assert.ok(!isThinkingSegment({ type: 'thinking' }));
});

test('a page turn summarizes every message', () => {
  const turn = summarizeTurn({
    id: 't',
    threadId: 'th',
    status: 'completed',
    createdAt: 1,
    messages: [
      { id: 'u', turnId: 't', role: 'user', content: 'go', createdAt: 1 },
      {
        id: 'a',
        turnId: 't',
        role: 'assistant',
        content: '',
        segments: [tool(), tool()],
        createdAt: 1,
      },
    ],
  });
  assert.equal(turn.messages[0]!.segments, undefined);
  assert.equal(turn.messages[1]!.segments!.length, 1);
});

test('a step range skips what is not a step and stops at the budget', () => {
  const segments = [
    text('a'),
    ...Array.from({ length: 30 }, (_, i) => cmd(`c${i}`, { output: 'o'.repeat(1000) })),
    text('b'),
  ];
  const all = previewStepRange(segments, 0, 100);
  assert.equal(all.steps.length, 30);
  assert.equal(all.next, undefined);
  assert.deepEqual(
    all.steps.map((s) => s.index),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  const one = jsonBytes(all.steps[0]);
  const page = previewStepRange(segments, 1, 30, one * 5 + 10);
  assert.equal(page.steps.length, 5);
  assert.equal(page.next, 6);
  assert.ok(jsonBytes(page.steps) <= one * 5 + 10);
  // Never empty: one step even past the budget.
  const tiny = previewStepRange(segments, 1, 30, 1);
  assert.equal(tiny.steps.length, 1);
  assert.equal(tiny.next, 2);
});

test('the guards accept what the summarizer emits and refuse the rest', () => {
  const [run] = summarizeSegments([cmd('ls')]);
  assert.ok(isWorkRunSegment(run));
  assert.ok(isStepPreview((run as WorkRunSegment).last));
  assert.ok(!isWorkRunSegment({ type: 'work', from: 3, to: 1 }));
  assert.ok(!isWorkRunSegment(cmd('ls')));
  assert.ok(!isStepPreview(cmd('ls')));
  assert.ok(!isStepPreview({ type: 'plan', index: 0 }));
});

test('utf8Length counts like an encoder', () => {
  for (const sample of ['', 'abc', 'ñandú', '漢字', '😀x', 'a\ud800b']) {
    assert.equal(utf8Length(sample), Buffer.byteLength(sample, 'utf8'), sample);
  }
});

test('the detail methods and ResponseTooLarge are part of the contract', () => {
  for (const method of ['turn/steps', 'turn/step']) {
    assert.ok((METHOD_NAMES as readonly string[]).includes(method), method);
  }
  // A thought's whole text is `turn/step`: there is no method of its own.
  assert.ok(!(METHOD_NAMES as readonly string[]).includes('turn/thinking'));
  const err = new RpcError(JsonRpcErrorCode.ResponseTooLarge);
  assert.equal(err.code, -32011);
  assert.equal(err.message, 'Response too large');
});
