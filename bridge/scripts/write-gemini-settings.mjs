import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.argv[2];
const hookPath = process.argv[3];
if (!cwd || !hookPath) {
  console.error('usage: write-gemini-settings.mjs <cwd> <hook-path>');
  process.exit(2);
}

const settings = {
  hooks: {
    BeforeTool: [
      {
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            name: 'uxnan-approval',
            command: `node "${hookPath}"`,
          },
        ],
      },
    ],
  },
};

mkdirSync(join(cwd, '.gemini'), { recursive: true });
const out = join(cwd, '.gemini', 'settings.json');
writeFileSync(out, JSON.stringify(settings, null, 2), 'utf-8');
console.log(out);
