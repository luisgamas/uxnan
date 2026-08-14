import { describe, expect, it } from 'vitest';

import { agentsFor, agentsMissingFrom, commandKey } from './agentAvailability';

const AGENTS = [
  { id: 'a', command: 'claude' },
  { id: 'b', command: 'codex' },
  { id: 'c', command: 'C:\\tools\\opencode.cmd' },
];

describe('agentsFor', () => {
  it('offers everything when the machine has not been asked', () => {
    // Absence of an inventory is not absence of agents. Hiding them all would
    // be a claim we cannot support — and would leave a connected host looking
    // like it can run nothing.
    expect(agentsFor(AGENTS, undefined)).toHaveLength(3);
    expect(agentsFor(AGENTS, null)).toHaveLength(3);
  });

  it('offers only what the host reported', () => {
    // The whole point of running the work there: the host's CLIs are the host's,
    // and this machine's list says nothing about them.
    const inventory = { agents: { claude: '2.1.0', git: '2.44' } };
    expect(agentsFor(AGENTS, inventory).map((a) => a.id)).toEqual(['a']);
  });

  it('matches a command however it is written', () => {
    // A profile may hold a bare name, a Windows shim or an absolute path, and
    // the inventory reports the plain command it probed.
    const inventory = { agents: { opencode: '0.4.2' } };
    expect(agentsFor(AGENTS, inventory).map((a) => a.id)).toEqual(['c']);
  });

  it('names what is missing rather than saying "some"', () => {
    const inventory = { agents: { claude: '2.1.0' } };
    expect(agentsMissingFrom(AGENTS, inventory).map((a) => a.id)).toEqual(['b', 'c']);
    // Nothing asked → nothing claimed missing.
    expect(agentsMissingFrom(AGENTS, undefined)).toEqual([]);
  });

  it('normalizes a command to what the inventory calls it', () => {
    expect(commandKey('claude')).toBe('claude');
    expect(commandKey('/usr/local/bin/claude')).toBe('claude');
    expect(commandKey('C:\\Program Files\\tools\\Claude.CMD')).toBe('claude');
    expect(commandKey('  codex.exe  ')).toBe('codex');
  });
});
