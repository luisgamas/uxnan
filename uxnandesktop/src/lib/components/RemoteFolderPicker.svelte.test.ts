import { beforeEach, describe, expect, it } from 'vitest';

import { mountWithProviders, until } from '../../test/render';
import type { CommandTable } from '../../test/tauri';
import { app } from '$lib/state/app.svelte';
import RemoteFolderPicker from './RemoteFolderPicker.svelte';

const HOME = '/home/dev';
const REPO_PATH = `${HOME}/uxnan`;

beforeEach(() => {
  app.repos = [];
});

describe('RemoteFolderPicker', () => {
  /** A host that answers with a home directory holding one repo and one plain folder. */
  const commands: CommandTable = {
    ssh_browse_dirs: (args) =>
      (args.path as string) === ''
        ? {
            path: HOME,
            parent: '/home',
            isRepo: false,
            entries: [
              { name: 'notes', path: `${HOME}/notes`, isRepo: false },
              { name: 'uxnan', path: REPO_PATH, isRepo: true },
            ],
            truncated: false,
          }
        : {
            path: args.path,
            parent: HOME,
            isRepo: true,
            entries: [],
            truncated: false,
          },
    ssh_repo_add: (args) => ({
      id: 'repo-remote',
      name: 'uxnan',
      path: args.path,
      target: 'ssh:h1',
      worktrees: [],
      isGit: true,
    }),
  };

  const props = { hostId: 'h1', hostLabel: 'workstation', open: true };

  it("opens at the host's home, because only that machine knows where it is", async () => {
    const { screen, backend } = mountWithProviders(RemoteFolderPicker, { props, commands });

    // An empty path is the request for "home" — sending a guess would be wrong
    // on Windows, on macOS, and for anyone whose home has moved.
    await until(() => backend.lastCallTo('ssh_browse_dirs') !== undefined, {
      label: 'the first listing',
    });
    expect(backend.lastCallTo('ssh_browse_dirs')?.args).toEqual({ hostId: 'h1', path: '' });
    expect(await screen.findByDisplayValue(HOME)).toBeInTheDocument();
  });

  it('flags a repository on the host the same way a local one is flagged', async () => {
    const { screen } = mountWithProviders(RemoteFolderPicker, { props, commands });

    // The badge is what tells the user which of the folders is the project, and
    // it has to come from the host: this machine cannot see that filesystem.
    expect(await screen.findByText('uxnan')).toBeInTheDocument();
    expect(await screen.findByText('repo')).toBeInTheDocument();
  });

  it('registers the chosen folder against the host it lives on', async () => {
    const { screen, user, backend } = mountWithProviders(RemoteFolderPicker, { props, commands });

    await user.click(await screen.findByText('uxnan'));
    await until(() => backend.lastCallTo('ssh_browse_dirs')?.args?.path === REPO_PATH, {
      label: 'walking into the repo',
    });

    await user.click(screen.getByRole('button', { name: 'Add this folder' }));
    await until(() => app.repos.length === 1, { label: 'the remote project registration' });

    expect(backend.lastCallTo('ssh_repo_add')?.args).toEqual({ hostId: 'h1', path: REPO_PATH });
    // The target is what makes this project distinct from a local one at the
    // same path — the badge, the terminal's cwd and the fencing all read it.
    expect(app.repos[0].target).toBe('ssh:h1');
  });

  it('never asks a host to watch a directory', async () => {
    const { backend } = mountWithProviders(RemoteFolderPicker, { props, commands });

    await until(() => backend.lastCallTo('ssh_browse_dirs') !== undefined, {
      label: 'the first listing',
    });
    // The shared browser watches the local filesystem; over SSH that would mean
    // holding a process open on the host for every open dialog, and the command
    // is not even implemented there.
    expect(backend.lastCallTo('browse_set_watch')).toBeUndefined();
  });
});
