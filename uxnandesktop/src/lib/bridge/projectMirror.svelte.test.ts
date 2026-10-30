/**
 * The desktop's projects and the bridge's registry as one list: united on
 * connect (never pruned by absence), additions and removals mirrored both
 * ways as explicit events, and a removal made offline sent on reconnect.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$shared/models/project';

type Repo = { id: string; name: string; path: string; target?: string };
type Listener = (repo: Repo, origin: 'local' | 'bridge') => void;

const state = vi.hoisted(() => ({
  repos: [] as Repo[],
  added: [] as Listener[],
  removedListeners: [] as Listener[],
  calls: [] as { method: string; params: unknown }[],
  connected: true,
  addedPaths: [] as string[],
  removedIds: [] as string[],
  replica: [] as ((change: unknown) => void)[],
  registry: new Map<string, Project>(),
}));

/** The bridge resolves a folder to the id its registry uses. */
const idOf = (path: string) => `proj_${path.replace(/\W/g, '')}`;

vi.mock('$lib/state/app.svelte', () => ({ app: { get repos() { return state.repos; } } }));
vi.mock('$lib/state/projects.svelte', () => ({
  projects: {
    onRepoAdded: (l: Listener) => state.added.push(l),
    onRepoRemoved: (l: Listener) => state.removedListeners.push(l),
    addProjectPath: async (path: string) => {
      state.addedPaths.push(path);
      state.repos.push({ id: `r-${path}`, name: path, path });
      return true;
    },
    removeProject: async (id: string) => {
      state.removedIds.push(id);
      state.repos = state.repos.filter((r) => r.id !== id);
    },
  },
}));
vi.mock('./client.svelte', () => ({
  bridge: {
    get connected() {
      return state.connected;
    },
    call: async (method: string, params: { cwd?: string; projectId?: string }) => {
      state.calls.push({ method, params });
      if (!state.connected) throw new Error('not connected');
      if (method === 'project/resolve' || method === 'project/add') {
        return { id: idOf(params.cwd ?? ''), name: 'x', cwd: params.cwd ?? '' } satisfies Project;
      }
      return {};
    },
  },
}));
vi.mock('./chat.svelte', () => ({
  normalizeCwd: (p: string) => p.replace(/\/+$/, ''),
  chat: {
    projects: state.registry,
    onReplicaChange: (l: (change: unknown) => void) => state.replica.push(l),
  },
}));

async function mirror() {
  const { ProjectMirror } = await import('./projectMirror.svelte');
  const m = new ProjectMirror();
  m.start();
  return m;
}

const project = (path: string): Project => ({ id: idOf(path), name: path, cwd: path });

beforeEach(() => {
  state.repos = [];
  state.added = [];
  state.removedListeners = [];
  state.calls = [];
  state.connected = true;
  state.addedPaths = [];
  state.removedIds = [];
  state.replica = [];
  state.registry.clear();
  localStorage.clear();
});

describe('ProjectMirror', () => {
  it('unites both lists on a full sync and removes nothing for being absent', async () => {
    const m = await mirror();
    state.repos = [{ id: 'r1', name: 'desk', path: '/w/desk' }];
    state.registry.set(idOf('/w/phone'), project('/w/phone'));
    await m.reconcile();
    // The desktop's project was published, the phone's added here.
    expect(state.calls.some((c) => c.method === 'project/add')).toBe(true);
    expect(state.addedPaths).toEqual(['/w/phone']);
    expect(state.removedIds).toEqual([]);
    expect(state.calls.some((c) => c.method === 'project/remove')).toBe(false);
  });

  it('never mirrors an SSH project', async () => {
    const m = await mirror();
    state.repos = [{ id: 'r2', name: 'remote', path: '/srv/app', target: 'ssh:box' }];
    await m.reconcile();
    expect(state.calls.some((c) => c.method === 'project/add')).toBe(false);
  });

  it('mirrors a removal made on another device, and one made here', async () => {
    await mirror();
    state.repos = [{ id: 'r1', name: 'a', path: '/w/a' }];
    state.replica[0]!({
      type: 'projects',
      projects: [],
      removed: [project('/w/a')],
      reset: false,
      source: 'notification',
    });
    await vi.waitFor(() => expect(state.removedIds).toEqual(['r1']));

    state.removedListeners[0]!({ id: 'r9', name: 'b', path: '/w/b' }, 'local');
    await vi.waitFor(() =>
      expect(state.calls.find((c) => c.method === 'project/remove')?.params).toEqual({
        projectId: idOf('/w/b'),
      }),
    );
    // A removal that came from the bridge is not sent back.
    const before = state.calls.length;
    state.removedListeners[0]!({ id: 'r8', name: 'c', path: '/w/c' }, 'bridge');
    await new Promise((r) => setTimeout(r, 10));
    expect(state.calls.length).toBe(before);
  });

  it('remembers a removal made offline and sends it on the next sync', async () => {
    const m = await mirror();
    state.connected = false;
    state.removedListeners[0]!({ id: 'r1', name: 'gone', path: '/w/gone' }, 'local');
    await new Promise((r) => setTimeout(r, 10));
    expect(localStorage.getItem('uxnan.bridge.projectMirror')).toContain('/w/gone');
    state.connected = true;
    // Still in the registry when the sync came: it must not come back here.
    state.registry.set(idOf('/w/gone'), project('/w/gone'));
    await m.reconcile('store-1');
    expect(state.calls.find((c) => c.method === 'project/remove')?.params).toEqual({
      projectId: idOf('/w/gone'),
    });
    expect(state.addedPaths).toEqual([]);
    expect(JSON.parse(localStorage.getItem('uxnan.bridge.projectMirror') ?? '{}').pendingRemovals).toEqual([]);
  });

  // The maintainer's report (plan 045 §14.1): a project removed on the phone
  // while the desktop was closed came back — the desktop's first sync is a
  // reset, and uniting published it again. What was mirrored is remembered.
  it('a project removed elsewhere while this window was closed is removed here, not published again', async () => {
    state.repos = [
      { id: 'r1', name: 'kept', path: '/w/kept' },
      { id: 'r2', name: 'gone', path: '/w/gone' },
    ];
    state.registry.set(idOf('/w/kept'), project('/w/kept'));
    state.registry.set(idOf('/w/gone'), project('/w/gone'));
    const first = await mirror();
    await first.reconcile('store-1');
    expect(state.calls.some((c) => c.method === 'project/add')).toBe(false);

    // The phone removes /w/gone; this window hears nothing (it is closed).
    state.registry.delete(idOf('/w/gone'));
    state.calls = [];
    // Next start: a new mirror, the same durable record, a reset sync.
    state.replica = [];
    state.removedListeners = [];
    state.added = [];
    const next = await mirror();
    state.replica[0]!({
      type: 'projects',
      projects: [...state.registry.values()],
      removed: [],
      reset: true,
      source: 'sync',
      storeId: 'store-1',
    });
    await vi.waitFor(() => expect(state.removedIds).toEqual(['r2']));
    await next.reconcile('store-1');
    expect(state.calls.some((c) => c.method === 'project/add')).toBe(false);
  });

  it('a project added here while the bridge was away is published, not removed', async () => {
    state.registry.set(idOf('/w/kept'), project('/w/kept'));
    state.repos = [{ id: 'r1', name: 'kept', path: '/w/kept' }];
    const m = await mirror();
    await m.reconcile('store-1');
    state.repos.push({ id: 'r3', name: 'new', path: '/w/new' });
    await m.reconcile('store-1');
    expect(state.calls.find((c) => c.method === 'project/add')?.params).toMatchObject({ cwd: '/w/new' });
    expect(state.removedIds).toEqual([]);
  });

  it('another bridge state (a new storeId) knows nothing mirrored: it unites', async () => {
    state.registry.set(idOf('/w/kept'), project('/w/kept'));
    state.repos = [{ id: 'r1', name: 'kept', path: '/w/kept' }];
    const m = await mirror();
    await m.reconcile('store-1');
    state.registry.clear();
    await m.reconcile('store-2');
    expect(state.removedIds).toEqual([]);
    expect(state.calls.find((c) => c.method === 'project/add')?.params).toMatchObject({ cwd: '/w/kept' });
  });
});
