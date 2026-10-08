import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VIEW_SKILL_MD, VIEW_SKILL_NAME, writeViewSkill } from '../../src/views/view-skill.js';

test('the view skill states when to show a view in its description', () => {
  const front = VIEW_SKILL_MD.split('---')[1] ?? '';
  assert.match(front, new RegExp(`name: ${VIEW_SKILL_NAME}`));
  assert.match(front, /description: .*without being asked/);
  assert.match(VIEW_SKILL_MD, /tools\.uxnan\.view_show/);
});

test('writeViewSkill writes <root>/uxnan-views/SKILL.md and returns the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-skill-'));
  try {
    assert.equal(await writeViewSkill(root), root);
    assert.equal(await readFile(join(root, VIEW_SKILL_NAME, 'SKILL.md'), 'utf8'), VIEW_SKILL_MD);
    // Idempotent: a restart rewrites the same file.
    await writeViewSkill(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
