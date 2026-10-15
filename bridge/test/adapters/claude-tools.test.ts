import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTaskResult,
  claudeQuestions,
  extractToolResults,
  extractToolUses,
  isTaskTool,
  taskListSteps,
  toolUseStartBlock,
  toolUseToBlock,
  type ClaudeTaskList,
  type ClaudeToolResult,
  type ClaudeToolUse,
} from '../../src/adapters/claude-tools.js';

/** A mapped block of a tool that is shown (never the hidden ones). */
function mapTool(...args: Parameters<typeof toolUseToBlock>): Record<string, unknown> {
  const block = toolUseToBlock(...args);
  assert.ok(block, 'expected a block');
  return block;
}

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
  const block = mapTool(
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
  const block = mapTool(
    { id: 'tu_1', name: 'Bash', input: { command: 'bad' } },
    { toolUseId: 'tu_1', text: 'not found', isError: true },
  );
  assert.equal(block['status'], 'error');
});

test('toolUseToBlock maps Edit to a diff block with +/- counts', () => {
  const block = mapTool(
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
  const block = mapTool(
    { id: 'tu_1', name: 'Write', input: { file_path: 'a.txt', content: 'l1\nl2' } },
    { toolUseId: 'tu_1', text: '', isError: false },
  );
  assert.equal(block['type'], 'diff');
  assert.equal(block['additions'], 2);
  assert.equal(block['deletions'], 0);
  assert.equal(block['diff'], '+l1\n+l2');
});

test('toolUseToBlock maps other tools to a classified tool block', () => {
  const block = mapTool(
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
    kind: 'read',
    target: 'a.txt',
  });
});

test('extractToolResults attaches the line tool_use_result to the one call it answers', () => {
  const content = [{ type: 'tool_result', tool_use_id: 'tc_1', content: 'Task #1 created' }];
  assert.deepEqual(extractToolResults(content, { task: { id: '1' } }), [
    {
      toolUseId: 'tc_1',
      text: 'Task #1 created',
      isError: false,
      data: { task: { id: '1' } },
    },
  ]);
  // Several results in one line do not say which one the outcome belongs to.
  const two = [
    { type: 'tool_result', tool_use_id: 'a', content: '' },
    { type: 'tool_result', tool_use_id: 'b', content: '' },
  ];
  assert.equal(extractToolResults(two, { task: { id: '1' } })[0]?.data, undefined);
});

test('toolUseToBlock keeps TodoWrite as a plan, and shows no row for the task tools', () => {
  const todo: ClaudeToolUse = {
    id: 'td_1',
    name: 'TodoWrite',
    input: { todos: [{ content: 'Read the spec', status: 'completed' }] },
  };
  assert.deepEqual(toolUseToBlock(todo, { toolUseId: 'td_1', text: '', isError: false }), {
    type: 'plan',
    state: { steps: [{ description: 'Read the spec', status: 'completed' }] },
  });
  for (const name of ['TaskCreate', 'TaskUpdate', 'AskUserQuestion', 'ExitPlanMode']) {
    const tool: ClaudeToolUse = { id: 'x', name, input: {} };
    assert.equal(toolUseToBlock(tool, { toolUseId: 'x', text: '', isError: false }), null, name);
    assert.equal(toolUseStartBlock(tool), null, name);
  }
});

test('isTaskTool names exactly the two task tools', () => {
  assert.equal(isTaskTool('TaskCreate'), true);
  assert.equal(isTaskTool('TaskUpdate'), true);
  assert.equal(isTaskTool('TodoWrite'), false);
  assert.equal(isTaskTool('Bash'), false);
});

const created = (subject: string, id: string | number = '1', extra: Record<string, unknown> = {}) =>
  [
    { id: 'tc', name: 'TaskCreate', input: { subject, ...extra } },
    { toolUseId: 'tc', text: `Task #${id} created`, isError: false, data: { task: { id } } },
  ] as const;

const updated = (
  input: Record<string, unknown>,
  result: Partial<ClaudeToolResult> = {},
): [ClaudeToolUse, ClaudeToolResult] => [
  { id: 'tu', name: 'TaskUpdate', input },
  { toolUseId: 'tu', text: 'Updated', isError: false, ...result },
];

test('applyTaskResult builds the list from TaskCreate, keyed by the id the CLI gave', () => {
  const list: ClaudeTaskList = new Map();
  const [tool, result] = created('Run the demo', 1, { activeForm: 'Running the demo' });
  assert.equal(applyTaskResult(list, tool, result), true);
  assert.deepEqual(
    [...list],
    [['1', { subject: 'Run the demo', activeForm: 'Running the demo', status: 'pending' }]],
  );
});

test('applyTaskResult changes a task by TaskUpdate, and drops it when deleted', () => {
  const list: ClaudeTaskList = new Map();
  const [tool, result] = created('Write the notes', 2);
  applyTaskResult(list, tool, result);
  const [progress, progressResult] = updated({
    taskId: '2',
    status: 'in_progress',
    activeForm: 'Writing the notes',
  });
  assert.equal(applyTaskResult(list, progress, progressResult), true);
  assert.deepEqual(taskListSteps(list), [
    { description: 'Writing the notes', status: 'in_progress' },
  ]);
  const [done, doneResult] = updated({ taskId: 2, status: 'completed' });
  applyTaskResult(list, done, doneResult);
  assert.deepEqual(taskListSteps(list), [{ description: 'Write the notes', status: 'completed' }]);
  const [gone, goneResult] = updated({ taskId: '2', status: 'deleted' });
  assert.equal(applyTaskResult(list, gone, goneResult), true);
  assert.equal(list.size, 0);
});

test('applyTaskResult changes nothing for a failed call, an unknown task or an unknown status', () => {
  const list: ClaudeTaskList = new Map();
  const [tool, result] = created('Keep me', 1);
  applyTaskResult(list, tool, result);
  const before = JSON.stringify([...list]);
  const [failed, failedResult] = updated({ taskId: '1', status: 'completed' }, { isError: true });
  assert.equal(applyTaskResult(list, failed, failedResult), false);
  const [unknownTask, unknownTaskResult] = updated({ taskId: '9', status: 'completed' });
  assert.equal(applyTaskResult(list, unknownTask, unknownTaskResult), false);
  const [unknownStatus, unknownStatusResult] = updated({ taskId: '1', status: 'blocked' });
  assert.equal(applyTaskResult(list, unknownStatus, unknownStatusResult), true);
  assert.equal(
    JSON.stringify([...list]),
    before,
    'only an unknown status leaves the task as it was',
  );
  // A TaskCreate whose result carries no id cannot be addressed later.
  const idless = applyTaskResult(
    new Map(),
    { id: 'tc', name: 'TaskCreate', input: { subject: 'No id' } },
    { toolUseId: 'tc', text: 'Task created', isError: false },
  );
  assert.equal(idless, false);
});

test('taskListSteps lists tasks in creation order, showing an active one as its activeForm', () => {
  const list: ClaudeTaskList = new Map([
    ['2', { subject: 'Second', status: 'pending' }],
    ['1', { subject: 'First', activeForm: 'Doing first', status: 'in_progress' }],
    ['3', { subject: 'Third', activeForm: 'Doing third', status: 'pending' }],
  ]);
  assert.deepEqual(taskListSteps(list), [
    { description: 'Second', status: 'pending' },
    { description: 'Doing first', status: 'in_progress' },
    { description: 'Third', status: 'pending' },
  ]);
});

test('claudeQuestions maps an AskUserQuestion input to questions the person can answer freely', () => {
  assert.deepEqual(
    claudeQuestions({
      questions: [
        {
          question: 'Which toppings?',
          header: 'Toppings',
          options: [
            { label: 'Ham', description: 'Cured' },
            { label: 'Olives' },
            { description: 'no label' },
          ],
          multiSelect: true,
        },
        { question: '' },
        'not a question',
      ],
    }),
    [
      {
        question: 'Which toppings?',
        header: 'Toppings',
        options: [{ label: 'Ham', description: 'Cured' }, { label: 'Olives' }],
        multiple: true,
        custom: true,
      },
    ],
  );
  assert.deepEqual(claudeQuestions({}), []);
});
