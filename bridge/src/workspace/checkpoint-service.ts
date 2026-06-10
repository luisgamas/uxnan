/**
 * Workspace checkpoints: capture / diff / apply a snapshot of the project's
 * working tree, backed by git.
 *
 * A checkpoint is a full snapshot of the working tree (tracked changes AND
 * untracked files) taken WITHOUT touching the user's index: a temporary
 * `GIT_INDEX_FILE` is seeded from HEAD, `git add -A` stages the current tree
 * into it, and `commit-tree` records a snapshot commit parented on HEAD. The
 * commit is anchored under `refs/uxnan/checkpoints/<id>` so git won't GC it, and
 * metadata is persisted in `~/.uxnan/checkpoints.json`.
 *
 * Source: architecture/02a-system-architecture.md §5.8.7.
 *
 * `applyCheckpoint` performs a TRUE worktree restore: it restores the snapshot's
 * file contents (recreating deleted files, overwriting modified ones) AND deletes
 * files created after the checkpoint, so the working tree matches the snapshot
 * exactly (parity with the mobile `AiChangeSet` revert). It is worktree-only —
 * the user's index and HEAD are untouched — and never removes gitignored files
 * (they were excluded from the snapshot).
 *
 * Retention: on each `capture` the service prunes old checkpoints beyond a
 * per-project count cap and/or a TTL, deleting both their `refs/uxnan/checkpoints/*`
 * anchors and their `checkpoints.json` entries, so the set never grows unbounded.
 *
 * Limitation: checkpoint commits use a fixed internal identity (never pushed).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { JsonRpcErrorCode, RpcError } from '@uxnan/shared';
import type { Checkpoint, CheckpointDiff, CheckpointFileStatus } from '@uxnan/shared';
import { DAEMON_FILES, type DaemonState } from '../daemon-state.js';
import { runGit } from '../git/git-runner.js';

interface CheckpointRecord {
  id: string;
  cwd: string;
  baseSha: string;
  commitSha: string;
  label?: string;
  threadId?: string;
  createdAt: number;
}

const SNAPSHOT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'uxnan-bridge',
  GIT_AUTHOR_EMAIL: 'bridge@uxnan.local',
  GIT_COMMITTER_NAME: 'uxnan-bridge',
  GIT_COMMITTER_EMAIL: 'bridge@uxnan.local',
};

export interface CaptureOptions {
  threadId?: string;
  label?: string;
  now: number;
}

/** Bounds on how many checkpoints are retained (per project / by age). */
export interface CheckpointRetention {
  /** Keep at most N newest checkpoints per project `cwd` (0 = unlimited). */
  maxPerProject: number;
  /** Delete checkpoints older than N days (0 = no TTL). */
  ttlDays: number;
}

const DEFAULT_RETENTION: CheckpointRetention = { maxPerProject: 25, ttlDays: 0 };
const MS_PER_DAY = 86_400_000;

export class CheckpointService {
  readonly #state: DaemonState;
  readonly #retention: CheckpointRetention;

  constructor(state: DaemonState, retention: Partial<CheckpointRetention> = {}) {
    this.#state = state;
    this.#retention = { ...DEFAULT_RETENTION, ...retention };
  }

  async capture(cwd: string, options: CaptureOptions): Promise<Checkpoint> {
    const baseSha = (await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim();

    const id = randomUUID();
    const indexFile = join(tmpdir(), `uxnan-ckpt-${id}.index`);
    const env: NodeJS.ProcessEnv = { ...process.env, ...SNAPSHOT_ENV, GIT_INDEX_FILE: indexFile };
    let commitSha: string;
    try {
      await runGit(cwd, ['read-tree', baseSha], { env });
      await runGit(cwd, ['add', '-A'], { env });
      const treeSha = (await runGit(cwd, ['write-tree'], { env })).stdout.trim();
      const label = options.label ?? 'checkpoint';
      commitSha = (
        await runGit(
          cwd,
          ['commit-tree', treeSha, '-p', baseSha, '-m', `uxnan-checkpoint ${label}`],
          {
            env,
          },
        )
      ).stdout.trim();
    } finally {
      await rm(indexFile, { force: true });
    }

    await runGit(cwd, ['update-ref', `refs/uxnan/checkpoints/${id}`, commitSha]);

    const record: CheckpointRecord = {
      id,
      cwd,
      baseSha,
      commitSha,
      createdAt: options.now,
      ...(options.label !== undefined ? { label: options.label } : {}),
      ...(options.threadId !== undefined ? { threadId: options.threadId } : {}),
    };
    const records = await this.#list();
    records.push(record);
    const survivors = await this.#prune(records, options.now);
    await this.#state.writeJson(DAEMON_FILES.checkpoints, survivors);

    return toCheckpoint(record);
  }

  async diff(id: string): Promise<CheckpointDiff> {
    const record = await this.#require(id);
    const range = [record.baseSha, record.commitSha];
    const { stdout: diff } = await runGit(record.cwd, ['diff', ...range]);
    const { stdout: nameStatus } = await runGit(record.cwd, ['diff', '--name-status', ...range]);
    const files = nameStatus
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split('\t');
        const code = parts[0] ?? '';
        const path = parts[parts.length - 1] ?? '';
        return { path, status: mapFileStatus(code) };
      });
    return { diff, files };
  }

  async apply(id: string): Promise<void> {
    const record = await this.#require(id);
    // Files that exist now but NOT in the snapshot — created after the checkpoint.
    // Compute these BEFORE restoring (which only touches snapshot paths).
    const extras = await this.#extrasOf(record);
    // Restore snapshot contents: recreates deleted files, overwrites modified ones.
    await runGit(record.cwd, ['restore', `--source=${record.commitSha}`, '--', '.']);
    // Delete the extras so the worktree matches the snapshot exactly.
    for (const rel of extras) {
      await rm(join(record.cwd, rel), { force: true });
    }
  }

  /**
   * Paths present in the current worktree but absent from the checkpoint snapshot
   * (the files to delete on restore). Snapshots the current tree into a temp index
   * exactly like {@link capture} (HEAD + `add -A`, so .gitignore is respected and
   * the user's real index is untouched), then diffs snapshot → now; `A` entries
   * are the extras.
   */
  async #extrasOf(record: CheckpointRecord): Promise<string[]> {
    const headSha = (await runGit(record.cwd, ['rev-parse', 'HEAD'])).stdout.trim();
    const indexFile = join(tmpdir(), `uxnan-ckpt-apply-${randomUUID()}.index`);
    const env: NodeJS.ProcessEnv = { ...process.env, ...SNAPSHOT_ENV, GIT_INDEX_FILE: indexFile };
    try {
      await runGit(record.cwd, ['read-tree', headSha], { env });
      await runGit(record.cwd, ['add', '-A'], { env });
      const nowTree = (await runGit(record.cwd, ['write-tree'], { env })).stdout.trim();
      const { stdout } = await runGit(record.cwd, [
        'diff',
        '--name-status',
        '--no-renames',
        record.commitSha,
        nowTree,
      ]);
      const extras: string[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const parts = trimmed.split('\t');
        if ((parts[0] ?? '')[0] !== 'A') continue;
        const path = parts[parts.length - 1];
        if (path) extras.push(path);
      }
      return extras;
    } finally {
      await rm(indexFile, { force: true });
    }
  }

  /**
   * Drop checkpoints beyond the retention bounds: those older than the TTL, and
   * the oldest-over-cap per project. Deletes each pruned checkpoint's git ref
   * (best-effort — the repo/ref may be gone) and returns the survivors to persist.
   */
  async #prune(records: CheckpointRecord[], now: number): Promise<CheckpointRecord[]> {
    const { maxPerProject, ttlDays } = this.#retention;
    const ttlCutoff = ttlDays > 0 ? now - ttlDays * MS_PER_DAY : undefined;
    const removeIds = new Set<string>();
    const byCwd = new Map<string, CheckpointRecord[]>();
    for (const record of records) {
      if (ttlCutoff !== undefined && record.createdAt < ttlCutoff) {
        removeIds.add(record.id);
        continue;
      }
      const list = byCwd.get(record.cwd) ?? [];
      list.push(record);
      byCwd.set(record.cwd, list);
    }
    if (maxPerProject > 0) {
      for (const list of byCwd.values()) {
        list.sort((a, b) => b.createdAt - a.createdAt); // newest first
        for (let i = maxPerProject; i < list.length; i += 1) removeIds.add(list[i]!.id);
      }
    }
    if (removeIds.size === 0) return records;
    for (const record of records) {
      if (!removeIds.has(record.id)) continue;
      try {
        await runGit(record.cwd, ['update-ref', '-d', `refs/uxnan/checkpoints/${record.id}`]);
      } catch {
        // The ref or its repo is already gone — nothing to clean up.
      }
    }
    return records.filter((record) => !removeIds.has(record.id));
  }

  async #list(): Promise<CheckpointRecord[]> {
    return (await this.#state.readJson<CheckpointRecord[]>(DAEMON_FILES.checkpoints)) ?? [];
  }

  async #require(id: string): Promise<CheckpointRecord> {
    const record = (await this.#list()).find((r) => r.id === id);
    if (!record) {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `checkpoint not found: ${id}`);
    }
    return record;
  }
}

function toCheckpoint(record: CheckpointRecord): Checkpoint {
  const checkpoint: Checkpoint = { id: record.id, createdAt: record.createdAt };
  if (record.label !== undefined) checkpoint.label = record.label;
  if (record.threadId !== undefined) checkpoint.threadId = record.threadId;
  return checkpoint;
}

function mapFileStatus(code: string): CheckpointFileStatus {
  const c = code[0];
  if (c === 'A') return 'added';
  if (c === 'D') return 'deleted';
  return 'modified';
}
