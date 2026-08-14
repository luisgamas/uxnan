import { describe, expect, it } from 'vitest';

import {
  launchDelayMs,
  REMOTE_FALLBACK_MS,
  REMOTE_QUIET_MS,
  RUN_COMMAND_FALLBACK_MS,
  RUN_COMMAND_QUIET_MS,
} from './launchTiming';

describe('launchDelayMs', () => {
  it('leaves a local shell exactly as it was', () => {
    // Local behaviour is load-bearing and unrelated to hosts: debounce on
    // output, with a fallback for shells whose profile prints nothing.
    expect(launchDelayMs({ sawOutput: true, requested: RUN_COMMAND_QUIET_MS })).toBe(
      RUN_COMMAND_QUIET_MS,
    );
    expect(
      launchDelayMs({ target: 'local', sawOutput: false, requested: RUN_COMMAND_FALLBACK_MS }),
    ).toBe(RUN_COMMAND_FALLBACK_MS);
  });

  it('will not type into a host that has not said a word yet', () => {
    // The bug this exists for: the SSH channel opens seconds before the remote
    // shell finishes starting, so the launch command was typed into a shell
    // that was not there. The front of it was eaten and the tail — including
    // the session id uxnan had just minted — appeared inside the agent's TUI.
    expect(
      launchDelayMs({ target: 'ssh:h1', sawOutput: false, requested: RUN_COMMAND_QUIET_MS }),
    ).toBe(REMOTE_FALLBACK_MS);
    expect(
      launchDelayMs({ target: 'ssh:h1', sawOutput: false, requested: RUN_COMMAND_FALLBACK_MS }),
    ).toBe(REMOTE_FALLBACK_MS);
  });

  it('still types eventually into a host that never prints anything', () => {
    // A silent remote profile is possible, and an agent that never launches is
    // a dead tab — worse than typing a moment early.
    expect(REMOTE_FALLBACK_MS).toBeGreaterThan(RUN_COMMAND_FALLBACK_MS);
    expect(Number.isFinite(REMOTE_FALLBACK_MS)).toBe(true);
  });

  it('gives a host a wider quiet window once it is talking', () => {
    // One remote round trip costs more than the local window, so the local one
    // would call a shell ready while its banner is still arriving.
    expect(launchDelayMs({ target: 'ssh:h1', sawOutput: true, requested: RUN_COMMAND_QUIET_MS })).toBe(
      REMOTE_QUIET_MS,
    );
    // …and never shortens a longer wait the caller asked for.
    expect(launchDelayMs({ target: 'ssh:h1', sawOutput: true, requested: 5_000 })).toBe(5_000);
  });
});
