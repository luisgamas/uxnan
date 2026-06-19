/**
 * Writes the bridge's Gemini approval hook to a path passed on argv[2],
 * then exits. Used by the end-to-end smoke test against the real `gemini`
 * CLI to materialize the actual CJS script the bridge ships.
 */
import { writeGeminiApprovalHook } from '../dist/src/hooks/gemini-approval-hook.js';
import { writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: extract-gemini-hook.mjs <output-path>');
  process.exit(2);
}
const written = await writeGeminiApprovalHook(path);
writeFileSync(written + '.sha', 'sentinel', 'utf-8');
console.log(written);
