import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DaemonState,
  InMemorySecretStore,
  MetricsService,
  ThreadStore,
  type SecretStore,
} from '../../src/index.js';
import { rmrf } from '../helpers/fs.js';

interface Harness {
  baseDir: string;
  threadStore: ThreadStore;
  secretStore: SecretStore;
  service: MetricsService;
  setClock: (ms: number) => void;
}

function newHarness(
  deviceId = 'pc-1',
  secretStore: SecretStore = new InMemorySecretStore(),
): Harness {
  const baseDir = join(tmpdir(), `uxnan-metrics-svc-${randomUUID()}`);
  const state = new DaemonState(baseDir);
  const threadStore = new ThreadStore(state);
  let clock = 1000;
  const service = new MetricsService({
    state,
    secretStore,
    threadStore,
    deviceId,
    now: () => clock,
  });
  return { baseDir, threadStore, secretStore, service, setClock: (ms) => (clock = ms) };
}

test('snapshot aggregates conversations, messages, agents, sessions and git actions', async () => {
  const h = newHarness();
  try {
    // Two conversations with distinct agents/models; one carries a turn (2 msgs).
    const t1 = await h.threadStore.startThread(
      { projectId: 'p', agentId: 'claude-code', model: 'opus' },
      1000,
    );
    const turn = await h.threadStore.startTurn(t1.id, 'hi', 1000);
    await h.threadStore.completeTurn(t1.id, turn.turnId, 'hello', 1100);
    await h.threadStore.startThread({ projectId: 'p', agentId: 'codex', model: 'gpt' }, 2000);

    // A relay session with a real 3s duration, plus a git action.
    h.setClock(5000);
    const s = await h.service.startSession('phone-1', 'relay');
    h.setClock(8000);
    await h.service.endSession(s);
    await h.service.recordGitAction('git/commit', t1.id, true);

    const snap = await h.service.getSnapshot();
    assert.equal(snap.deviceId, 'pc-1');
    assert.equal(snap.conversations, 2);
    assert.equal(snap.agentsUsed, 2);
    assert.equal(snap.modelsUsed, 2);
    assert.equal(snap.messages, 2); // one turn → user + assistant
    assert.equal(snap.gitActions, 1);
    assert.equal(snap.sessions, 1);
    assert.equal(snap.relaySessions, 1);
    assert.equal(snap.directSessions, 0);
    assert.equal(snap.totalConnectedMs, 3000);
    assert.equal(snap.longestSessionMs, 3000);
    assert.equal(snap.memberSince, 1000);
    assert.deepEqual(
      [...snap.byAgent].sort((a, b) => a.agentId.localeCompare(b.agentId)),
      [
        { agentId: 'claude-code', conversations: 1 },
        { agentId: 'codex', conversations: 1 },
      ],
    );
    // Activity buckets: sums match the totals (tz-independent assertion).
    const sum = (k: 'conversations' | 'messages' | 'work'): number =>
      snap.activity.reduce((acc, d) => acc + d[k], 0);
    assert.equal(sum('conversations'), 2);
    assert.equal(sum('messages'), 2);
    assert.equal(sum('work'), 1);
  } finally {
    await rmrf(h.baseDir);
  }
});

test('snapshot byAgentDay splits conversations/messages/tokens per agent', async () => {
  const h = newHarness();
  try {
    const t = await h.threadStore.startThread({ projectId: 'p', agentId: 'claude-code' }, 1000);
    const turn1 = await h.threadStore.startTurn(t.id, 'hi', 1000);
    await h.threadStore.setUsage(t.id, turn1.turnId, { tokens: 500 }, 1000);
    await h.threadStore.completeTurn(t.id, turn1.turnId, 'a', 1100);
    const turn2 = await h.threadStore.startTurn(t.id, 'again', 2000);
    await h.threadStore.setUsage(t.id, turn2.turnId, { tokens: 800 }, 2000);
    await h.threadStore.completeTurn(t.id, turn2.turnId, 'b', 2100);
    // A second agent whose turns report NO usage → appears with tokens 0 but
    // real conversation/message counts.
    const t2 = await h.threadStore.startThread({ projectId: 'p', agentId: 'zero' }, 3000);
    const zt = await h.threadStore.startTurn(t2.id, 'x', 3000);
    await h.threadStore.completeTurn(t2.id, zt.turnId, 'y', 3100);

    const snap = await h.service.getSnapshot();
    const claude = snap.byAgentDay.flatMap((d) => d.byAgent).filter((a) => a.agentId === 'claude-code');
    // 500 + 800 across the (same-UTC-day) turns; 1 conversation; 4 messages
    // (2 turns × user+assistant).
    assert.equal(
      claude.reduce((acc, a) => acc + a.tokens, 0),
      1300,
    );
    assert.equal(
      claude.reduce((acc, a) => acc + a.conversations, 0),
      1,
    );
    assert.equal(
      claude.reduce((acc, a) => acc + a.messages, 0),
      4,
    );
    // Zero appears (a conversation + messages) with 0 tokens.
    const zero = snap.byAgentDay.flatMap((d) => d.byAgent).filter((a) => a.agentId === 'zero');
    assert.ok(zero.length > 0);
    assert.equal(
      zero.reduce((acc, a) => acc + a.tokens, 0),
      0,
    );
    assert.ok(zero.reduce((acc, a) => acc + a.conversations, 0) >= 1);
    // Day keys are UTC midnight (a whole-day multiple; `=== 0` treats -0 as 0
    // for pre-epoch days, which `assert.equal` would not).
    for (const d of snap.byAgentDay) {
      assert.ok(d.day % 86_400_000 === 0, 'day key is UTC midnight');
    }
  } finally {
    await rmrf(h.baseDir);
  }
});

test('an open (live) session counts up to now', async () => {
  const h = newHarness();
  try {
    h.setClock(1000);
    await h.service.startSession('phone', 'direct'); // never ended
    h.setClock(4000);
    const snap = await h.service.getSnapshot();
    assert.equal(snap.sessions, 1);
    assert.equal(snap.directSessions, 1);
    assert.equal(snap.totalConnectedMs, 3000); // 1000 → now(4000)
  } finally {
    await rmrf(h.baseDir);
  }
});

test('export → import round-trips, is idempotent, and rejects foreign/wrong-key files', async () => {
  const h = newHarness('pc-1');
  try {
    const s = await h.service.startSession('phone', 'direct');
    await h.service.endSession(s);
    await h.service.recordGitAction('git/push', undefined, true);

    const exported = await h.service.exportBackup();
    assert.ok(exported.blob.length > 0);
    assert.equal(exported.passphraseProtected, false);
    assert.match(exported.filename, /\.uxmetrics$/);

    // Re-importing into the same PC merges nothing new (idempotent).
    const again = await h.service.importBackup(exported.blob);
    assert.equal(again.imported, 0);
    assert.equal(again.snapshot.sessions, 1);

    // A different PC (different deviceId) rejects it — same-PC only.
    const foreign = newHarness('pc-2');
    await assert.rejects(() => foreign.service.importBackup(exported.blob));
    await rmrf(foreign.baseDir);

    // Same deviceId but a different keychain key (a forged file) is rejected too.
    const wrongKey = newHarness('pc-1', new InMemorySecretStore());
    await assert.rejects(() => wrongKey.service.importBackup(exported.blob));
    await rmrf(wrongKey.baseDir);
  } finally {
    await rmrf(h.baseDir);
  }
});

test('passphrase-protected export requires the phrase at import', async () => {
  const h = newHarness();
  try {
    const s = await h.service.startSession('phone', 'relay');
    await h.service.endSession(s);

    const exported = await h.service.exportBackup('my-secret');
    assert.equal(exported.passphraseProtected, true);

    const ok = await h.service.importBackup(exported.blob, 'my-secret');
    assert.equal(ok.imported, 0); // same events already present
    await assert.rejects(() => h.service.importBackup(exported.blob)); // missing phrase
    await assert.rejects(() => h.service.importBackup(exported.blob, 'nope')); // wrong phrase
  } finally {
    await rmrf(h.baseDir);
  }
});

test('imported events from a foreign backup merge into the snapshot', async () => {
  // Simulate restoring a backup made earlier on THIS PC (same deviceId + key).
  const secret = new InMemorySecretStore();
  const first = newHarness('pc-1', secret);
  try {
    const s = await first.service.startSession('phone', 'relay');
    await first.service.endSession(s);
    await first.service.recordGitAction('git/commit', 't', true);
    const exported = await first.service.exportBackup();

    // A fresh store on the same PC (e.g. metrics.json was lost) restores them.
    const restored = newHarness('pc-1', secret);
    try {
      const before = await restored.service.getSnapshot();
      assert.equal(before.sessions, 0);
      assert.equal(before.gitActions, 0);

      const result = await restored.service.importBackup(exported.blob);
      assert.equal(result.imported, 2); // 1 session + 1 git action
      assert.equal(result.snapshot.sessions, 1);
      assert.equal(result.snapshot.gitActions, 1);
    } finally {
      await rmrf(restored.baseDir);
    }
  } finally {
    await rmrf(first.baseDir);
  }
});
