import { describe, expect, it } from 'vitest';
import { mentionEntries, MENTION_LIMIT } from './mentions';

function fake(answers: Record<string, unknown>) {
  const calls: { method: string; params: unknown }[] = [];
  const call = async <T,>(method: string, params: unknown): Promise<T> => {
    calls.push({ method, params });
    return answers[method] as T;
  };
  return { call, calls };
}

describe('mentionEntries', () => {
  it('lists the project on a bare @, folders first', async () => {
    const { call, calls } = fake({
      'workspace/list': {
        cwd: '.',
        entries: [
          { name: 'README.md', type: 'file' },
          { name: 'src', type: 'dir' },
        ],
      },
    });
    expect(await mentionEntries(call, '/work/app', '')).toEqual([
      { path: 'src', isDir: true },
      { path: 'README.md', isDir: false },
    ]);
    expect(calls).toEqual([{ method: 'workspace/list', params: { cwd: '/work/app' } }]);
  });

  it('drills into a folder the mention names', async () => {
    const { call, calls } = fake({
      'workspace/list': { cwd: '.', entries: [{ name: 'main.ts', type: 'file' }] },
    });
    expect(await mentionEntries(call, '/work/app/', 'src/lib/')).toEqual([
      { path: 'src/lib/main.ts', isDir: false },
    ]);
    expect(calls[0]?.params).toEqual({ cwd: '/work/app/src/lib' });
  });

  it('keeps Windows separators for a Windows project', async () => {
    const { call, calls } = fake({ 'workspace/list': { cwd: '.', entries: [] } });
    await mentionEntries(call, 'C:\\work\\app', 'src/');
    expect(calls[0]?.params).toEqual({ cwd: 'C:\\work\\app\\src' });
  });

  it('searches the whole project for a name', async () => {
    const { call, calls } = fake({
      'workspace/searchFiles': {
        cwd: '.',
        matches: [{ path: 'src/app.ts', type: 'file' }],
        truncated: false,
      },
    });
    expect(await mentionEntries(call, '/work/app', 'src/ap')).toEqual([
      { path: 'src/app.ts', isDir: false },
    ]);
    expect(calls).toEqual([
      {
        method: 'workspace/searchFiles',
        params: { cwd: '/work/app', query: 'src/ap', limit: MENTION_LIMIT },
      },
    ]);
  });
});
