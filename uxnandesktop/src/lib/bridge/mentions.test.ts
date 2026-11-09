import { describe, expect, it } from 'vitest';
import { mentionEntries, mentionFor, mentionText, MENTION_LIMIT } from './mentions';

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

describe('mentionText', () => {
  it('writes a path as it is, and quotes one with spaces', () => {
    expect(mentionText('src/main.ts')).toBe('@src/main.ts');
    expect(mentionText('My Docs/notes v2.md')).toBe('@"My Docs/notes v2.md"');
  });

  it('leaves a browsed folder open, keeping its quote', () => {
    expect(mentionText('src', { folder: true })).toBe('@src/');
    expect(mentionText('My Docs', { folder: true })).toBe('@"My Docs/');
    expect(mentionText('My Docs/notes.md', { quoted: true })).toBe('@"My Docs/notes.md"');
  });
});

describe('mentionFor', () => {
  it('mentions a file inside the project by its relative path', () => {
    expect(mentionFor('/Users/me/app', '/Users/me/app/src/main.ts')).toBe('@src/main.ts');
    expect(mentionFor('/Users/me/app/', '/Users/me/app/README.md')).toBe('@README.md');
  });

  it('leaves anything outside the project (or the folder itself) to be attached', () => {
    expect(mentionFor('/Users/me/app', '/Users/me/other/a.ts')).toBeNull();
    expect(mentionFor('/Users/me/app', '/Users/me/app-old/a.ts')).toBeNull();
    expect(mentionFor('/Users/me/app', '/Users/me/app')).toBeNull();
  });

  it('quotes a dropped file whose path has spaces', () => {
    expect(mentionFor('/Users/me/app', '/Users/me/app/My Docs/a b.md')).toBe('@"My Docs/a b.md"');
  });

  it('writes a Windows path with forward slashes and matches its drive case-insensitively', () => {
    expect(mentionFor('C:\\Code\\app', 'c:\\code\\app\\src\\Main.ts')).toBe('@src/Main.ts');
  });
});
