// A project's files, on the machine they are on.
//
// There is one set of file commands, and each takes the machine it is for: this
// one, or a host, whose files its engine serves with the same code this app
// runs on its own disk. The backend decides where a call goes; what is left
// here is the one thing a caller must not have to remember — that a mutation on
// a host carries the expectation it was prepared against (`02a` §2.9), built
// from the connection generation the caller last saw.
//
// This exists because the alternative is every call site asking "is this
// remote?", which is the shape that already cost us: the launcher, the terminal
// and the git panels each answered that question separately, and one of them
// answered it wrong.

import {
  fsCreateDir,
  fsCreateFile,
  fsDelete,
  fsDuplicate,
  fsListDir,
  fsReadDataUrl,
  fsReadFile,
  fsRename,
  fsSearchContent,
  fsSearchFiles,
  fsWriteFile,
} from "$lib/api";
import { expectation, sshHostId, type TargetExpectation, type TargetId } from "$lib/target";
import type {
  ContentQuery,
  ContentSearch,
  FileContent,
  FileSearch,
  FsEntry,
  SearchFilters,
} from "$lib/types";

type Target = TargetId | undefined | null;

/** The expectation a mutation on `target` is sent with: none for this machine;
 *  for a host, the connection the caller last saw. Without one it throws rather
 *  than sending a zero — an expectation nobody issued would either be rejected
 *  by the backend or, worse, satisfied by accident. */
function fence(target: Target, generation?: number): TargetExpectation | undefined {
  const host = sshHostId(target);
  if (!host) return undefined;
  if (generation === undefined) {
    throw new Error(`no live connection to ${host} to act against`);
  }
  return expectation(target, generation);
}

/** List a directory on the machine `target` names. */
export function listDirOn(target: Target, path: string): Promise<FsEntry[]> {
  return fsListDir(path, target);
}

/** Read a text file from the machine `target` names, with the same guards on
 *  either side: binary and over-cap files come back flagged, never mangled. */
export function readFileOn(target: Target, path: string): Promise<FileContent> {
  return fsReadFile(path, target);
}

/** Read an image or PDF from the machine `target` names as an inline `data:`
 *  URL — what the preview pane draws, and what a Markdown document's images
 *  resolve to. Routed like every other read: a viewer that always read this
 *  machine's disk at a path from another one showed the failure instead of the
 *  picture. */
export function readDataUrlOn(target: Target, path: string): Promise<string> {
  return fsReadDataUrl(path, target);
}

/** Save a text file to the machine `target` names. `generation` is what the
 *  caller last saw for that host. */
export async function writeFileOn(
  target: Target,
  path: string,
  content: string,
  generation?: number,
): Promise<void> {
  return fsWriteFile(path, content, target, fence(target, generation));
}

/** Create an empty file inside `dir` on the machine `target` names. `rel` may be
 *  an intercalated path (`sub/leaf.ts`); its parent folders are created. */
export async function createFileOn(
  target: Target,
  dir: string,
  rel: string,
  generation?: number,
): Promise<string> {
  return fsCreateFile(dir, rel, target, fence(target, generation));
}

/** Create a folder inside `dir` on the machine `target` names. */
export async function createDirOn(
  target: Target,
  dir: string,
  rel: string,
  generation?: number,
): Promise<string> {
  return fsCreateDir(dir, rel, target, fence(target, generation));
}

/** Rename an entry within its folder on the machine `target` names. */
export async function renameOn(
  target: Target,
  path: string,
  newName: string,
  generation?: number,
): Promise<string> {
  return fsRename(path, newName, target, fence(target, generation));
}

/** Delete an entry on the machine `target` names.
 *
 *  **The two machines do different things here, and the caller has to say so.**
 *  Locally this moves the entry to the OS trash, which is recoverable; a host
 *  has no trash, so there it is an unlink and nothing brings it back. The
 *  confirm dialog reads the target for exactly this reason. */
export async function deleteOn(target: Target, path: string, generation?: number): Promise<void> {
  return fsDelete(path, target, fence(target, generation));
}

/** Copy a file next to itself under a free "… copy" name. */
export async function duplicateOn(
  target: Target,
  path: string,
  generation?: number,
): Promise<string> {
  return fsDuplicate(path, target, fence(target, generation));
}

/** Search a project by file name on the machine `target` names — the same
 *  walk, reading `.gitignore`, on whichever machine the project is. */
export function searchFilesOn(
  target: Target,
  root: string,
  query: string,
  includeHidden: boolean,
  filters: SearchFilters,
  limit: number,
): Promise<FileSearch> {
  return fsSearchFiles(root, query, includeHidden, filters, limit, target);
}

/** Search a project by content on the machine `target` names. */
export function searchContentOn(
  target: Target,
  root: string,
  query: ContentQuery,
  includeHidden: boolean,
  filters: SearchFilters,
  limit: number,
): Promise<ContentSearch> {
  return fsSearchContent(root, query, includeHidden, filters, limit, target);
}
