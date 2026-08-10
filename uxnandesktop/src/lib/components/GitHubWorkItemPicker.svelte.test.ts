import { describe, expect, it } from 'vitest';

import { mount } from '../../test/render';
import GitHubWorkItemPicker from './GitHubWorkItemPicker.svelte';

const commands = {
  github_repo_context: () => ({
    nameWithOwner: 'team/sample',
    host: 'github.com',
    owner: 'team',
    repo: 'sample',
    branch: 'main',
    pr: null,
  }),
  github_pr_list: () => [
    {
      number: 42,
      title: 'Improve project import',
      url: 'https://github.com/team/sample/pull/42',
      state: 'OPEN',
      draft: false,
      author: 'developer',
      headRefName: 'feature/import',
      baseRefName: 'main',
      updatedAt: '2026-08-08T12:00:00Z',
    },
    {
      number: 7,
      title: 'Polish workspace cards',
      url: 'https://github.com/team/sample/pull/7',
      state: 'OPEN',
      draft: false,
      author: 'maintainer',
      headRefName: 'feature/cards',
      baseRefName: 'main',
      updatedAt: '2026-08-07T12:00:00Z',
    },
  ],
};

describe('GitHubWorkItemPicker', () => {
  it('loads and selects an open pull request', async () => {
    const { screen, user } = mount(GitHubWorkItemPicker, {
      props: { active: true, repoPath: 'C:/projects/sample', kind: 'pr' },
      commands,
    });

    await user.click(await screen.findByRole('option', { name: /#42 · Improve project import/ }));

    expect(screen.getByText(/Selected #42/)).toBeInTheDocument();
  });

  it('rejects a pasted URL that belongs to another project', async () => {
    const { screen, user } = mount(GitHubWorkItemPicker, {
      props: { active: true, repoPath: 'C:/projects/sample', kind: 'pr' },
      commands,
    });
    const search = await screen.findByPlaceholderText('Search pull requests or paste a reference…');

    await user.type(search, 'https://github.com/team/other/pull/9{Enter}');

    expect(await screen.findByText('That URL belongs to a different project.')).toBeInTheDocument();
  });

  it('keeps a lone hash broad and resolves numeric searches to one match', async () => {
    const { screen, user } = mount(GitHubWorkItemPicker, {
      props: { active: true, repoPath: 'C:/projects/sample', kind: 'pr' },
      commands,
    });
    const search = await screen.findByPlaceholderText('Search pull requests or paste a reference…');

    await user.type(search, '#');
    expect(screen.getAllByRole('option')).toHaveLength(2);

    await user.type(search, '42');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveAccessibleName(/#42 · Improve project import/);
  });
});
