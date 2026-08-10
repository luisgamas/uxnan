import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  scanCustomCommands,
  expandCustomCommand,
  substituteArgs,
  type CustomCommandSource,
} from '../../src/adapters/command-scan.js';
import { rmrf } from '../helpers/fs.js';

/** Make a unique temp dir and return an absolute path under it. */
async function tempDir(): Promise<string> {
  const dir = join(tmpdir(), `uxnan-cmd-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test('scanCustomCommands parses markdown front-matter (description + argument-hint) → AgentCommand', async () => {
  const dir = await tempDir();
  await writeFile(
    join(dir, 'refactor.md'),
    '---\ndescription: Refactor a file\nargument-hint: <file>\n---\nRefactor $ARGUMENTS carefully.\n',
  );
  const source: CustomCommandSource = { dirs: [dir], ext: '.md', format: 'markdown' };
  const commands = await scanCustomCommands(source);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], {
    name: 'refactor',
    source: 'custom',
    headlessSupported: true,
    description: 'Refactor a file',
    argumentHint: '<file>',
  });
  await rmrf(dir);
});

test('scanCustomCommands de-dupes by name: a project-scoped file shadows the user-level one', async () => {
  const projectDir = await tempDir();
  const userDir = await tempDir();
  await writeFile(
    join(projectDir, 'deploy.md'),
    '---\ndescription: project deploy\n---\nproject body',
  );
  await writeFile(join(userDir, 'deploy.md'), '---\ndescription: user deploy\n---\nuser body');
  // Highest priority (project) first.
  const source: CustomCommandSource = {
    dirs: [projectDir, userDir],
    ext: '.md',
    format: 'markdown',
  };
  const commands = await scanCustomCommands(source);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]!.description, 'project deploy');
  await rmrf(projectDir);
  await rmrf(userDir);
});

test('scanCustomCommands skips a missing directory without throwing', async () => {
  const source: CustomCommandSource = {
    dirs: [join(tmpdir(), `uxnan-missing-${randomUUID()}`)],
    ext: '.md',
    format: 'markdown',
  };
  const commands = await scanCustomCommands(source);
  assert.deepEqual(commands, []);
});

test('expandCustomCommand substitutes $ARGUMENTS / {{args}} / positional $1', async () => {
  const dir = await tempDir();
  await writeFile(
    join(dir, 'fix.md'),
    '---\ndescription: fix\n---\nFix $1 then review $ARGUMENTS.',
  );
  const md: CustomCommandSource = { dirs: [dir], ext: '.md', format: 'markdown' };
  assert.equal(
    await expandCustomCommand(md, 'fix', 'auth.ts high'),
    'Fix auth.ts then review auth.ts high.',
  );
  await rmrf(dir);
});

test('expandCustomCommand throws for an unknown command (caller falls back to native form)', async () => {
  const dir = await tempDir();
  const source: CustomCommandSource = { dirs: [dir], ext: '.md', format: 'markdown' };
  await assert.rejects(() => expandCustomCommand(source, 'nope'), /unknown custom command/);
  await rmrf(dir);
});

test('substituteArgs: empty args clear placeholders; unknown placeholders are left intact', () => {
  assert.equal(substituteArgs('Do $ARGUMENTS now'), 'Do  now');
  assert.equal(substituteArgs('a $1 b $2', 'x'), 'a x b ');
  assert.equal(substituteArgs('keep $FOO literal', 'x'), 'keep $FOO literal');
});
