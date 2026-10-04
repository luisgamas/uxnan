/**
 * The note a panel shows while its host is away. What is on screen is what was
 * read then; the note has to say both halves — which machine, and how old.
 */

import { describe, expect, it } from 'vitest';

import { mountWithProviders } from '../../test/render';
import OfflineNote from './OfflineNote.svelte';

describe('OfflineNote', () => {
  it('names the host and how long ago the panel was read', async () => {
    const { screen } = mountWithProviders(OfflineNote, {
      props: { host: 'build-box', readAt: Date.now() - 3 * 60_000 },
    });

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('build-box is offline — this was read 3 minutes ago.');
    expect(note).toHaveTextContent('Nothing here can change until it is back.');
  });
});
