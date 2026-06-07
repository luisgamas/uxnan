/**
 * Workspace models exchanged over JSON-RPC (workspace/* methods).
 *
 * Source: architecture/02a-system-architecture.md §5.8.7.
 */

export interface FileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

export interface ImageContent {
  path: string;
  base64Data: string;
  mimeType: string;
}

export type WorkspaceEntryType = 'file' | 'dir';

export interface WorkspaceEntry {
  name: string;
  type: WorkspaceEntryType;
  size?: number;
}

export interface WorkspaceListing {
  cwd: string;
  entries: WorkspaceEntry[];
}

export interface Checkpoint {
  id: string;
  threadId?: string;
  label?: string;
  createdAt: number;
}

export type CheckpointFileStatus = 'added' | 'modified' | 'deleted';

export interface CheckpointDiff {
  diff: string;
  files: { path: string; status: CheckpointFileStatus }[];
}

export type PatchOp = 'add' | 'modify' | 'delete';

export interface PatchChange {
  op: PatchOp;
  path: string;
  content?: string;
}

export interface ApplyResult {
  success: boolean;
  applied: number;
}
