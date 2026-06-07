import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { createFileLogger, logFileFor, redactSecrets } from '../src/index.js';

test('redactSecrets masks JWTs, secret key=values and PEM blocks', () => {
  assert.match(redactSecrets('auth aaaaaaaa.bbbbbbbb.cccccccc done'), /\[REDACTED-JWT\]/);
  assert.equal(redactSecrets('token=supersecret123'), 'token=[REDACTED]');
  assert.match(redactSecrets('"notificationSecret":"abc123xyz"'), /\[REDACTED\]/);
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';
  assert.equal(redactSecrets(pem), '[REDACTED-KEY]');
  // ordinary text is untouched
  assert.equal(redactSecrets('git status on branch main'), 'git status on branch main');
});

test('createFileLogger writes a daily-rotated, redacted, level-filtered file', async () => {
  const dir = join(tmpdir(), `uxnan-log-${randomUUID()}`);
  const date = new Date('2026-06-06T12:00:00.000Z');
  const logger = createFileLogger({
    scope: 'test',
    minLevel: 'info',
    logDir: dir,
    toConsole: false,
    now: () => date,
  });

  logger.debug('should be filtered out');
  logger.info('hello world');
  logger.warn('with token=topsecret value');

  const contents = await readFile(logFileFor(dir, date), 'utf-8');
  assert.ok(!contents.includes('should be filtered out'));
  assert.ok(contents.includes('hello world'));
  assert.ok(contents.includes('token=[REDACTED]'));
  assert.ok(!contents.includes('topsecret'));
  assert.ok(contents.includes('2026-06-06'));

  await rm(dir, { recursive: true, force: true });
});
