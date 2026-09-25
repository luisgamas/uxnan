import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeTool,
  diffLines,
  editDiffBlock,
  fileDiffBlock,
  projectRelative,
  subagentBlock,
  toolBlock,
  unwrapShellCommand,
  withProjectPaths,
} from '../../src/adapters/content-blocks.js';
import { acpToolBlock } from '../../src/adapters/acp-tools.js';
import { codexToolItemBlock } from '../../src/adapters/codex-tools.js';
import { toolUseToBlock } from '../../src/adapters/claude-tools.js';
import { opencodeToolBlock } from '../../src/adapters/opencode-tools.js';
import {
  buildAntigravityToolBlock,
  committedTextOrNull,
} from '../../src/adapters/antigravity-adapter.js';
import { execFileSync } from 'node:child_process';

// Every agent's own name for reading a file, measured on a real turn of each.
test('describeTool gives every agent the same kind for the same act', () => {
  const reads: [string, Record<string, unknown>][] = [
    ['Read', { file_path: 'a.ts' }], // Claude
    ['read', { path: 'a.ts' }], // OpenCode 2, pi
    ['read_file', { path: 'a.ts' }], // Zero
    ['view_file', { AbsolutePath: 'a.ts' }], // Antigravity
    ['Read `a.ts`', { variant: 'ReadFile', target_file: 'a.ts' }], // Grok
  ];
  for (const [name, input] of reads) {
    assert.deepEqual(describeTool(name, input), { kind: 'read', target: 'a.ts' }, name);
  }
  assert.deepEqual(describeTool('grep', { pattern: 'alpha', path: '.' }), {
    kind: 'search',
    target: 'alpha',
  });
  assert.deepEqual(describeTool('Grep', { pattern: 'alpha', path: 'src' }), {
    kind: 'search',
    target: 'alpha · src',
  });
  assert.equal(describeTool('Glob', { pattern: '**/*.ts' }).kind, 'search');
  assert.equal(describeTool('list_dir', { DirectoryPath: '/p' }).kind, 'list');
  assert.deepEqual(describeTool('WebFetch', { url: 'https://example.com', prompt: 'x' }), {
    kind: 'fetch',
    target: 'https://example.com',
  });
  assert.deepEqual(describeTool('WebSearch', { query: 'uxnan' }), {
    kind: 'web_search',
    target: 'uxnan',
  });
  assert.equal(describeTool('mcp__uxnan-browser__browser_open', {}).kind, 'mcp');
  // Unknown tools stay `other`, summarized by their most telling argument.
  assert.deepEqual(describeTool('execute', { code: 'const r = search();\nreturn r;' }), {
    kind: 'other',
    target: 'const r = search();',
  });
  assert.deepEqual(describeTool('mystery', {}), { kind: 'other' });
  // What the agent says itself wins.
  assert.equal(describeTool('anything', {}, { kind: 'web_search' }).kind, 'web_search');
});

test('toolBlock carries the classification and caps the output', () => {
  const block = toolBlock('Read', 'id1', { file_path: 'a.ts' }, 'x'.repeat(5000), false);
  assert.equal(block['kind'], 'read');
  assert.equal(block['target'], 'a.ts');
  assert.match(block['output'] as string, /… \(truncated\)$/);
});

test('diffLines keeps what did not change and aligns the rest', () => {
  const ops = diffLines('a\nb\nc\nd\n', 'a\nB\nc\nd\ne\n');
  assert.deepEqual(
    ops.map((o) => `${o.op}${o.line}`),
    [' a', '-b', '+B', ' c', ' d', '+e'],
  );
});

test('fileDiffBlock emits real hunks with line numbers and context', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const after = before.replace('line 3\n', 'line three\n').replace('line 18\n', 'line eighteen\n');
  const block = fileDiffBlock('f.txt', before, after);
  assert.equal(block['additions'], 2);
  assert.equal(block['deletions'], 2);
  const diff = block['diff'] as string;
  assert.match(diff, /^@@ -1,6 \+1,6 @@\n line 1\n line 2\n-line 3\n\+line three\n line 4/);
  assert.match(diff, /@@ -15,6 \+15,6 @@\n line 15/);
  // A new file is one hunk of additions from line 0.
  assert.deepEqual(fileDiffBlock('n.txt', '', 'hi\n'), {
    type: 'diff',
    filename: 'n.txt',
    diff: '@@ -0,0 +1,1 @@\n+hi',
    additions: 1,
    deletions: 0,
  });
});

test('editDiffBlock shows a snippet edit as its changed lines with context', () => {
  const block = editDiffBlock('a.txt', 'keep\nold\n', 'keep\nnew\n');
  assert.equal(block['diff'], ' keep\n-old\n+new');
  assert.equal(block['additions'], 1);
  assert.equal(block['deletions'], 1);
});

test('unwrapShellCommand shows what a login-shell wrapper ran', () => {
  assert.equal(unwrapShellCommand("/bin/zsh -lc 'ls -la'"), 'ls -la');
  assert.equal(unwrapShellCommand('bash -c "echo \\"hi\\""'), 'echo "hi"');
  assert.equal(
    unwrapShellCommand(`/bin/zsh -lc "rg -n --glob '"'!.git'"' 'alpha'"`),
    `rg -n --glob '!.git' 'alpha'`,
  );
  // Not exactly one wrapped word: left alone.
  assert.equal(unwrapShellCommand('ls -la'), 'ls -la');
  assert.equal(unwrapShellCommand("sh -c 'a' extra"), "sh -c 'a' extra");
});

test('projectRelative and withProjectPaths show paths from the project', () => {
  assert.equal(projectRelative('/p/src/a.ts', '/p'), 'src/a.ts');
  assert.equal(projectRelative('/private/var/x/a.ts', '/var/x'), 'a.ts');
  assert.equal(projectRelative('/elsewhere/a.ts', '/p'), '/elsewhere/a.ts');
  assert.equal(projectRelative('rel.ts', '/p'), 'rel.ts');
  assert.deepEqual(withProjectPaths({ type: 'diff', filename: '/p/a.ts', diff: '' }, '/p'), {
    type: 'diff',
    filename: 'a.ts',
    diff: '',
  });
  assert.deepEqual(withProjectPaths({ type: 'tool', target: 'alpha · /p/src' }, '/p'), {
    type: 'tool',
    target: 'alpha · src',
  });
  const untouched = { type: 'command_execution', command: 'ls' };
  assert.equal(withProjectPaths(untouched, '/p'), untouched);
  assert.equal(withProjectPaths(untouched, undefined), untouched);
});

test('subagentBlock names the task on one line and records how it ended', () => {
  assert.deepEqual(subagentBlock('s1', 'Count lines\nin notes', 'Three.', false), {
    type: 'subagent',
    state: { id: 's1', name: 'Count lines', status: 'completed', output: 'Three.' },
  });
  assert.equal(
    (subagentBlock('s2', '', '', true)['state'] as Record<string, unknown>)['status'],
    'error',
  );
});

test('Claude: Agent is a subagent and ToolSearch is not shown', () => {
  const agent = toolUseToBlock(
    { id: 'a1', name: 'Agent', input: { description: 'Count lines', prompt: 'long' } },
    { toolUseId: 'a1', text: 'Three lines.', isError: false },
  );
  assert.equal(agent?.['type'], 'subagent');
  assert.equal((agent?.['state'] as Record<string, unknown>)['name'], 'Count lines');
  const search = toolUseToBlock(
    { id: 'a2', name: 'ToolSearch', input: { query: 'todo' } },
    { toolUseId: 'a2', text: '', isError: false },
  );
  assert.equal(search, null);
});

test('OpenCode: task is a subagent', () => {
  const block = opencodeToolBlock('task', 'p1', { description: 'Review' }, 'Done.', false);
  assert.equal(block['type'], 'subagent');
});

test('ACP: the tool is named by its variant or its title, and the plan call is hidden', () => {
  // Grok: the title is for people; `variant` names the tool.
  const grok = acpToolBlock({
    toolCallId: 'g1',
    title: 'alpha',
    kind: 'search',
    status: 'completed',
    rawInput: { variant: 'Grep', pattern: 'alpha', path: null },
    content: [{ type: 'content', content: { type: 'text', text: 'found 2 matches' } }],
  });
  assert.equal(grok?.['toolName'], 'Grep');
  assert.equal(grok?.['kind'], 'search');
  assert.equal(grok?.['target'], 'alpha');
  // Zero: the title leads with the tool's name.
  const zero = acpToolBlock({
    toolCallId: 'z1',
    title: 'read_file notes.txt',
    kind: 'read',
    status: 'completed',
    rawInput: { path: 'notes.txt' },
  });
  assert.equal(zero?.['toolName'], 'read_file');
  assert.equal(zero?.['target'], 'notes.txt');
  // The call that wrote the plan: the `plan` update already shows it.
  for (const rawInput of [
    { plan: [{ content: 'a' }] },
    { variant: 'TodoWrite', todos: [{ id: '1', content: 'a', status: 'pending' }] },
  ]) {
    assert.equal(
      acpToolBlock({
        toolCallId: 'p',
        title: 'Updating plan',
        kind: 'think',
        status: 'completed',
        rawInput,
      }),
      null,
    );
  }
});

test('ACP: an ask_user call is shown as readable questions', () => {
  const block = acpToolBlock({
    toolCallId: 't1',
    title: 'ask_user',
    kind: 'other',
    status: 'completed',
    rawInput: {
      questions: [
        { question: 'Which language?', options: ['Python', 'JavaScript'], recommended: 'Python' },
      ],
    },
    content: [
      { type: 'content', content: { type: 'text', text: 'No interactive user is available.' } },
    ],
  });
  assert.equal(block?.['type'], 'tool');
  assert.equal(block?.['toolName'], 'ask_user');
  assert.deepEqual(block?.['input'], {});
  const output = block?.['output'] as string;
  assert.match(output, /Which language\?/);
  assert.match(output, /Python · JavaScript/);
  assert.match(output, /suggested: Python/);
  assert.match(output, /No interactive user is available\./);
});

test('ACP: a whole-file diff gets hunks, a snippet gets its lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-diff-'));
  const path = join(dir, 'notes.txt');
  const before = 'first line\nalpha release\nlast line\n';
  const after = 'first line\nbeta release\nlast line\n';
  writeFileSync(path, after);
  const whole = acpToolBlock({
    toolCallId: 'e1',
    title: 'edit',
    kind: 'edit',
    status: 'completed',
    content: [{ type: 'diff', path, oldText: before, newText: after }],
  });
  assert.equal(
    whole?.['diff'],
    '@@ -1,3 +1,3 @@\n first line\n-alpha release\n+beta release\n last line',
  );
  assert.equal(whole?.['additions'], 1);
  const snippet = acpToolBlock({
    toolCallId: 'e2',
    title: 'edit',
    kind: 'edit',
    status: 'completed',
    content: [{ type: 'diff', path, oldText: 'alpha', newText: 'beta' }],
  });
  assert.equal(snippet?.['diff'], '-alpha\n+beta');
});

test('Codex: MCP, web search, image and subagent items become their blocks', () => {
  const mcp = codexToolItemBlock({
    type: 'mcpToolCall',
    id: 'm1',
    server: 'uxnan-browser',
    tool: 'browser_open',
    arguments: { url: 'http://localhost:3000' },
    status: 'completed',
    result: { content: [{ type: 'text', text: 'opened' }] },
  });
  assert.equal(mcp?.['toolName'], 'uxnan-browser/browser_open');
  assert.equal(mcp?.['kind'], 'mcp');
  assert.equal(mcp?.['output'], 'opened');
  assert.equal(mcp?.['target'], 'http://localhost:3000');
  const failed = codexToolItemBlock({
    type: 'mcpToolCall',
    id: 'm2',
    server: 's',
    tool: 't',
    arguments: {},
    status: 'failed',
    error: { message: 'boom' },
  });
  assert.equal(failed?.['isError'], true);
  assert.equal(failed?.['output'], 'boom');
  const search = codexToolItemBlock({ type: 'webSearch', id: 'w1', query: 'uxnan', action: null });
  assert.equal(search?.['kind'], 'web_search');
  assert.equal(search?.['target'], 'uxnan');
  const open = codexToolItemBlock({
    type: 'webSearch',
    id: 'w2',
    query: '',
    action: { type: 'openPage', url: 'https://example.com' },
  });
  assert.equal(open?.['kind'], 'fetch');
  assert.equal(
    codexToolItemBlock({ type: 'imageView', id: 'i1', path: '/p/a.png' })?.['kind'],
    'read',
  );
  const spawn = codexToolItemBlock({
    type: 'collabAgentToolCall',
    id: 'c1',
    tool: 'spawnAgent',
    prompt: 'Review the diff',
    status: 'completed',
    agentsStates: { t2: { status: 'completed', message: 'Looks good.' } },
  });
  assert.deepEqual(spawn, {
    type: 'subagent',
    state: { id: 'c1', name: 'Review the diff', status: 'completed', output: 'Looks good.' },
  });
  assert.equal(
    codexToolItemBlock({
      type: 'collabAgentToolCall',
      id: 'c2',
      tool: 'wait',
      status: 'completed',
    }),
    null,
  );
});

test('Antigravity: a file step is diffed from the file around it', () => {
  const step = (name: string) => ({
    step_index: 4,
    state: 'DONE',
    step_type: 'tool',
    tool_name: name,
    tool_info: { name, parameters: { TargetFile: '/p/notes.txt' } },
  });
  const edited = buildAntigravityToolBlock(step('replace_file_content'), 0, {
    before: 'a\nalpha\n',
    after: 'a\nbeta\n',
  });
  assert.equal(edited['diff'], '@@ -1,2 +1,2 @@\n a\n-alpha\n+beta');
  const created = buildAntigravityToolBlock(step('write_to_file'), 0, {
    before: null,
    after: 'hi\n',
  });
  assert.equal(created['additions'], 1);
  assert.equal(created['deletions'], 0);
  const subagent = buildAntigravityToolBlock({
    step_index: 7,
    state: 'DONE',
    step_type: 'tool',
    tool_name: 'invoke_subagent',
    tool_info: { name: 'invoke_subagent', parameters: { Task: 'Audit deps' }, output: 'ok' },
  });
  assert.equal(subagent['type'], 'subagent');
});

test('committedTextOrNull reads a file as committed, or null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-head-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'a.txt'), 'committed\n');
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'init');
  writeFileSync(join(dir, 'a.txt'), 'edited\n');
  writeFileSync(join(dir, 'new.txt'), 'new\n');
  assert.equal(committedTextOrNull(join(dir, 'a.txt')), 'committed\n');
  assert.equal(committedTextOrNull(join(dir, 'new.txt')), null);
  assert.equal(committedTextOrNull(join(tmpdir(), 'nowhere', 'x.txt')), null);
});
