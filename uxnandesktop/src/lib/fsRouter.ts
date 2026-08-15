// Which machine a file read goes to.
//
// One place decides, so no caller has to remember: a path plus the machine it
// belongs to, and the routing follows. Local paths keep exactly the calls they
// always had; a host's go over SFTP — a subsystem, so it behaves the same
// whatever shell that machine starts and needs nothing installed there.
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
  fsReadFile,
  fsRename,
  fsSearchContent,
  fsSearchFiles,
  fsWriteFile,
  sshFsCreateDir,
  sshFsCreateFile,
  sshFsDelete,
  sshFsDuplicate,
  sshFsList,
  sshFsRead,
  sshFsRename,
  sshFsSearchContent,
  sshFsSearchFiles,
  sshFsWrite,
} from "$lib/api";
import { expectation, sshHostId, type TargetId } from "$lib/target";
import type {
  ContentQuery,
  ContentSearch,
  FileContent,
  FileSearch,
  FsEntry,
  SearchFilters,
} from "$lib/types";

/** List a directory on the machine `target` names. */
export function listDirOn(target: TargetId | undefined | null, path: string): Promise<FsEntry[]> {
  const host = sshHostId(target);
  return host ? sshFsList(host, path) : fsListDir(path);
}

/** Read a text file from the machine `target` names, with the same guards on
 *  either side: binary and over-cap files come back flagged, never mangled. */
export function readFileOn(
  target: TargetId | undefined | null,
  path: string,
): Promise<FileContent> {
  const host = sshHostId(target);
  return host ? sshFsRead(host, path) : fsReadFile(path);
}

/** Save a text file to the machine `target` names.
 *
 *  A write is a mutation, so the remote path carries an expectation naming the
 *  machine and the connection it was prepared for; `generation` is what the
 *  caller last saw for that host. Without one it refuses rather than sending a
 *  zero — an expectation nobody issued would either be rejected by the backend
 *  or, worse, satisfied by accident. */
export function writeFileOn(
  target: TargetId | undefined | null,
  path: string,
  content: string,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return fsWriteFile(path, content);
  if (generation === undefined) {
    return Promise.reject(
      new Error(`no live connection to ${host} to save ${path} against`),
    );
  }
  return sshFsWrite(host, path, content, expectation(target, generation));
}

/** A mutation on another machine needs the connection it was prepared against.
 *  Thrown rather than defaulted, for the reason `writeFileOn` gives: sending a
 *  zero is an expectation nobody issued. */
function fence(target: TargetId | undefined | null, host: string, generation?: number) {
  if (generation === undefined) {
    throw new Error(`no live connection to ${host} to act against`);
  }
  return expectation(target, generation);
}

/** Create an empty file inside `dir` on the machine `target` names. `rel` may be
 *  an intercalated path (`sub/leaf.ts`); its parent folders are created. */
export async function createFileOn(
  target: TargetId | undefined | null,
  dir: string,
  rel: string,
  generation?: number,
): Promise<string> {
  const host = sshHostId(target);
  if (!host) return fsCreateFile(dir, rel);
  return sshFsCreateFile(host, dir, rel, fence(target, host, generation));
}

/** Create a folder inside `dir` on the machine `target` names. */
export async function createDirOn(
  target: TargetId | undefined | null,
  dir: string,
  rel: string,
  generation?: number,
): Promise<string> {
  const host = sshHostId(target);
  if (!host) return fsCreateDir(dir, rel);
  return sshFsCreateDir(host, dir, rel, fence(target, host, generation));
}

/** Rename an entry within its folder on the machine `target` names. */
export async function renameOn(
  target: TargetId | undefined | null,
  path: string,
  newName: string,
  generation?: number,
): Promise<string> {
  const host = sshHostId(target);
  if (!host) return fsRename(path, newName);
  return sshFsRename(host, path, newName, fence(target, host, generation));
}

/** Delete an entry on the machine `target` names.
 *
 *  **The two machines do different things here, and the caller has to say so.**
 *  Locally this moves the entry to the OS trash, which is recoverable; a host
 *  has no trash, so there it is an unlink and nothing brings it back. The
 *  confirm dialog reads the target for exactly this reason. */
export async function deleteOn(
  target: TargetId | undefined | null,
  path: string,
  generation?: number,
): Promise<void> {
  const host = sshHostId(target);
  if (!host) return fsDelete(path);
  return sshFsDelete(host, path, fence(target, host, generation));
}

/** Copy a file next to itself under a free "… copy" name. */
export async function duplicateOn(
  target: TargetId | undefined | null,
  path: string,
  generation?: number,
): Promise<string> {
  const host = sshHostId(target);
  if (!host) return fsDuplicate(path);
  return sshFsDuplicate(host, path, fence(target, host, generation));
}

/** Search a project by file name on the machine `target` names.
 *
 *  The two sides get there differently, and the difference is the whole reason
 *  this feature waited: locally it is a threaded walk that reads `.gitignore`;
 *  on a host it asks git for the same list in one command, because a walk over
 *  SFTP is one request per folder across a network. Same answer, one round trip
 *  instead of thousands. */
export function searchFilesOn(
  target: TargetId | undefined | null,
  root: string,
  query: string,
  includeHidden: boolean,
  filters: SearchFilters,
  limit: number,
): Promise<FileSearch> {
  const host = sshHostId(target);
  return host
    ? sshFsSearchFiles(host, root, query, includeHidden, filters, limit)
    : fsSearchFiles(root, query, includeHidden, filters, limit);
}

/** Search a project by content on the machine `target` names — `git grep` there,
 *  the threaded walk here. */
export function searchContentOn(
  target: TargetId | undefined | null,
  root: string,
  query: ContentQuery,
  includeHidden: boolean,
  filters: SearchFilters,
  limit: number,
): Promise<ContentSearch> {
  const host = sshHostId(target);
  return host
    ? sshFsSearchContent(host, root, query, includeHidden, filters, limit)
    : fsSearchContent(root, query, includeHidden, filters, limit);
}
