import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentStreamEvent } from '@uxnan/shared';
import { ProcessAgentAdapter } from '../../src/index.js';

// A fake agent that speaks the generic bridge IPC: echoes each word as a delta.
const FAKE_AGENT = [
  "let buf='';process.stdin.setEncoding('utf8');",
  "process.stdin.on('data',d=>{buf+=d;let i;",
  'while((i=buf.indexOf(String.fromCharCode(10)))>=0){',
  'const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;',
  'const m=JSON.parse(line);if(m.type!=="turn")continue;',
  'const w=o=>process.stdout.write(JSON.stringify(Object.assign({threadId:m.threadId,turnId:m.turnId},o))+String.fromCharCode(10));',
  'w({type:"started"});for(const c of m.text.split(" "))w({type:"delta",text:c});w({type:"completed",text:m.text});',
  '}});',
].join('');

// 30s default: guards only against CPU starvation under parallel node:test on Windows.
async function waitFor(predicate: () => boolean, timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

test('ProcessAgentAdapter spawns a CLI and maps its stdio to stream events', async () => {
  const adapter = new ProcessAgentAdapter({
    agentId: 'echo',
    capabilities: {
      planMode: false,
      streaming: true,
      approvals: false,
      forking: false,
      images: false,
    },
    binaryPath: process.execPath,
    args: ['-e', FAKE_AGENT],
  });

  const events: AgentStreamEvent[] = [];
  adapter.onEvent((event) => events.push(event));

  await adapter.start({ agentId: 'echo' });
  await adapter.sendTurn({ threadId: 't1', turnId: 'u1', text: 'hi there' });
  await waitFor(() => events.some((e) => e.type === 'turn_completed'));
  await adapter.stop();

  const types = events.map((e) => e.type);
  assert.ok(types.includes('turn_started'));
  assert.ok(types.includes('delta'));
  const completed = events.find((e) => e.type === 'turn_completed');
  assert.equal((completed?.data as { text: string }).text, 'hi there');
});
