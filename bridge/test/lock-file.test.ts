import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { LockFile } from '../src/index.js';

async function tmpLockPath(): Promise<string> {
  const dir = join(tmpdir(), `uxnan-lock-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return join(dir, 'bridge.lock');
}

test('acquire succeeds when no lock exists and writes the pid', async () => {
  const path = await tmpLockPath();
  const lock = new LockFile(path);
  assert.equal(await lock.acquire(), true);
  assert.equal((await lock.read())?.pid, process.pid);
  await rm(path, { force: true });
});

test('acquire fails when another live process holds the lock', async () => {
  const path = await tmpLockPath();
  const lockA = new LockFile(path);
  await lockA.acquire(); // held by this (alive) process
  const lockB = new LockFile(path);
  assert.equal(await lockB.acquire(424242), false);
  await rm(path, { force: true });
});

test('a stale lock (dead pid) can be taken over', async () => {
  const path = await tmpLockPath();
  await writeFile(path, JSON.stringify({ pid: 999999, startedAt: 0 }), 'utf-8');
  const lock = new LockFile(path);
  assert.equal(await lock.acquire(), true);
  assert.equal((await lock.read())?.pid, process.pid);
  await rm(path, { force: true });
});

test('release removes the lock when owned', async () => {
  const path = await tmpLockPath();
  const lock = new LockFile(path);
  await lock.acquire();
  await lock.release();
  assert.equal(await lock.read(), null);
});
