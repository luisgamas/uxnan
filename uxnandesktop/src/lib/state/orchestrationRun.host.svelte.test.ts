/**
 * A headless step on a host's project runs on that host (`02g` §5.18): its
 * folder is a path there, and the same path here names another folder — the
 * run must never land on this machine's.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { installFakeBackend, type FakeBackend } from '../../test/tauri';
import { until } from '../../test/render';
import { app } from './app.svelte';
import { projects } from './projects.svelte';
import { orchestrationRun } from './orchestrationRun.svelte';

let backend: FakeBackend;

function headlessRun(target: Record<string, string>): string {
  const run = orchestrationRun.createDraft('host step');
  orchestrationRun.addStepTo(run.id, {
    kind: 'headless',
    title: 'review',
    prompt: 'Review the code.',
    target: { agent: 'claude', model: '', ...target },
  });
  return run.id;
}

afterEach(() => {
  for (const run of [...orchestrationRun.runs]) orchestrationRun.cancelRun(run.id);
  orchestrationRun.runs = [];
  app.repos = [];
});

describe('a headless step on a host', () => {
  it('runs on the machine its folder is on, named or found from its project', async () => {
    backend = installFakeBackend({
      agent_run_headless: () => ({
        stdout: 'done',
        stderr: '',
        exitCode: 0,
        stdoutBytes: 4,
        stderrBytes: 0,
        truncated: false,
        peakMemoryMb: 0,
      }),
    });
    app.repos = [
      { id: 'r-host', name: 'api', path: '/srv/api', target: 'ssh:h1', worktrees: [], isGit: true },
    ] as never;
    projects.worktreesByRepo = { 'r-host': [{ path: '/srv/api', branch: 'main', head: null, isMain: true }] } as never;

    // Named by the step.
    const named = headlessRun({ workspace: '/srv/api', machine: 'ssh:h1' });
    expect(orchestrationRun.startRun(named)).toEqual([]);
    await until(() => backend.callsTo('agent_run_headless').length >= 1, { label: 'the first dispatch' });
    expect(backend.callsTo('agent_run_headless')[0].args).toMatchObject({ cwd: '/srv/api', target: 'ssh:h1' });

    // Not named (an older run, or one the control surface created): found from
    // the project that owns the folder.
    const found = headlessRun({ workspace: '/srv/api' });
    expect(orchestrationRun.startRun(found)).toEqual([]);
    await until(() => backend.callsTo('agent_run_headless').length >= 2, { label: 'the second dispatch' });
    expect(backend.callsTo('agent_run_headless')[1].args).toMatchObject({ cwd: '/srv/api', target: 'ssh:h1' });
  });

  it('keeps a local folder on this machine', async () => {
    backend = installFakeBackend({ agent_run_headless: () => new Promise(() => {}) });
    const local = headlessRun({ workspace: '/Users/me/code/app' });
    expect(orchestrationRun.startRun(local)).toEqual([]);
    await until(() => backend.called('agent_run_headless'), { label: 'the dispatch' });
    expect(backend.lastCallTo('agent_run_headless')?.args.target).toBeNull();
  });
});
