import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { RpcError, type Project } from '@uxnan/shared';
import { ProjectRegistry, projectIdFor } from '../../src/index.js';

test('list exposes configured roots with stable ids', () => {
  const registry = new ProjectRegistry(['/tmp/proj-a', '/tmp/proj-b']);
  const projects = registry.list();
  assert.equal(projects.length, 2);
  assert.equal(projects[0]?.id, projectIdFor('/tmp/proj-a'));
  assert.equal(projects[0]?.cwd, resolve('/tmp/proj-a'));
  assert.equal(projects[0]?.name, 'proj-a');
});

test('empty roots fall back to a single cwd project', () => {
  const registry = new ProjectRegistry([], '/tmp/fallback');
  const projects: Project[] = registry.list();
  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.cwd, resolve('/tmp/fallback'));
});

test('byId resolves a known project and rejects unknown ids', () => {
  const registry = new ProjectRegistry(['/tmp/proj-a']);
  const id = projectIdFor('/tmp/proj-a');
  assert.equal(registry.byId(id).cwd, resolve('/tmp/proj-a'));
  assert.throws(() => registry.byId('proj_does_not_exist'), RpcError);
});

test('resolve synthesizes a project for an unknown cwd', () => {
  const registry = new ProjectRegistry(['/tmp/proj-a']);
  const project = registry.resolve('/tmp/elsewhere');
  assert.equal(project.cwd, resolve('/tmp/elsewhere'));
  assert.equal(project.id, projectIdFor('/tmp/elsewhere'));
});

test('per-project agent/model pin surfaces on the project and via agentConfigFor', () => {
  const registry = new ProjectRegistry(['/tmp/proj-a', '/tmp/proj-b'], process.cwd(), [
    { agentId: 'codex', cwd: '/tmp/proj-a', model: 'gpt-5-codex' },
  ]);
  const [a, b] = registry.list();
  assert.equal(a?.agentId, 'codex');
  assert.equal(a?.model, 'gpt-5-codex');
  // The unpinned project carries no agent/model.
  assert.equal(b?.agentId, undefined);
  assert.equal(b?.model, undefined);

  const pin = registry.agentConfigFor('/tmp/proj-a');
  assert.equal(pin?.agentId, 'codex');
  assert.equal(registry.agentConfigFor('/tmp/proj-b'), undefined);
});
