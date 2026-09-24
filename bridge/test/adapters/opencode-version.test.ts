import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectOpenCodeMajor,
  openCodeRunArgs,
  parseOpenCodeMajor,
  protocolFor,
} from '../../src/index.js';
import { fakeOpenCode } from '../helpers/fake-opencode.js';

test('parseOpenCodeMajor reads either spelling OpenCode prints', () => {
  // Both captured from the real CLIs.
  assert.equal(parseOpenCodeMajor('1.18.32\n'), 1);
  assert.equal(parseOpenCodeMajor('opencode v2.0.16\n'), 2);
  assert.equal(parseOpenCodeMajor('V10.0.0-beta.3'), 10);
  // A bare number, prose or nothing is no version.
  assert.equal(parseOpenCodeMajor('2'), undefined);
  assert.equal(parseOpenCodeMajor('version unknown'), undefined);
  assert.equal(parseOpenCodeMajor(''), undefined);
});

test('protocolFor: 2 and later speak V2; 1 and an unreadable version speak V1', () => {
  assert.equal(protocolFor(2), 2);
  assert.equal(protocolFor(3), 2);
  assert.equal(protocolFor(1), 1);
  assert.equal(protocolFor(undefined), 1);
});

test('openCodeRunArgs keeps an OpenCode 2 one-shot off the shared service', () => {
  assert.deepEqual(openCodeRunArgs(2, 'name it'), ['run', '--standalone', 'name it']);
  // OpenCode 1 rejects the flag.
  assert.deepEqual(openCodeRunArgs(1, 'name it'), ['run', 'name it']);
});

test('detectOpenCodeMajor asks the binary', async () => {
  assert.equal(await detectOpenCodeMajor(fakeOpenCode(2).spawnFn, 'opencode', process.cwd()), 2);
  assert.equal(await detectOpenCodeMajor(fakeOpenCode(1).spawnFn, 'opencode', process.cwd()), 1);
  const broken = (): never => {
    throw new Error('ENOENT');
  };
  assert.equal(await detectOpenCodeMajor(broken, 'opencode', process.cwd()), undefined);
});
