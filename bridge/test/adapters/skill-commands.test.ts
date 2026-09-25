import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFrontMatter } from '../../src/adapters/command-scan.js';
import { parseZeroSkills, zeroSkillPrompt } from '../../src/adapters/zero-adapter.js';

test('extractFrontMatter reads folded and literal blocks as their text', () => {
  const raw = [
    '---',
    'name: demo',
    'description: >-',
    '  Design and scaffold',
    '  Flutter code.',
    'notes: |',
    '  line one',
    '  line two',
    'argument-hint: "<file>"',
    '---',
    'Body',
  ].join('\n');
  const { fields, body } = extractFrontMatter(raw);
  assert.equal(fields['description'], 'Design and scaffold Flutter code.');
  assert.equal(fields['notes'], 'line one\nline two');
  assert.equal(fields['argument-hint'], '<file>');
  assert.equal(fields['name'], 'demo');
  assert.equal(body, 'Body');
});

test('parseZeroSkills keeps only the skills a Zero run can load', () => {
  const files: Record<string, string> = {
    '/home/u/.local/share/zero/skills/folded/SKILL.md':
      '---\nname: folded\ndescription: >\n  Read from\n  the file.\n---\n',
  };
  const commands = parseZeroSkills(
    {
      skills: [
        {
          name: 'shared',
          description: 'In ~/.agents',
          path: '/home/u/.agents/skills/shared/SKILL.md',
        },
        {
          name: 'own',
          description: 'Zero skill',
          path: '/home/u/.local/share/zero/skills/own/SKILL.md',
        },
        {
          name: 'folded',
          description: '>',
          path: '/home/u/.local/share/zero/skills/folded/SKILL.md',
        },
        { name: '', path: '/x' },
      ],
    },
    '/home/u/.agents/skills',
    (path) => files[path],
  );
  assert.deepEqual(commands, [
    { name: 'own', source: 'skill', headlessSupported: true, description: 'Zero skill' },
    {
      name: 'folded',
      source: 'skill',
      headlessSupported: true,
      description: 'Read from the file.',
    },
  ]);
  assert.deepEqual(parseZeroSkills(null, '/home/u/.agents/skills'), []);
});

test('zeroSkillPrompt asks Zero to load the skill, then the task', () => {
  assert.equal(
    zeroSkillPrompt('probe'),
    'Use the "probe" skill: load it with your skill tool and follow its instructions.',
  );
  assert.equal(
    zeroSkillPrompt('probe', ' say it '),
    'Use the "probe" skill: load it with your skill tool and follow its instructions.\n\nsay it',
  );
});
