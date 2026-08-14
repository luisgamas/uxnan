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

import { fsListDir, fsReadFile, fsWriteFile, sshFsList, sshFsRead, sshFsWrite } from "$lib/api";
import { expectation, sshHostId, type TargetId } from "$lib/target";
import type { FileContent, FsEntry } from "$lib/types";

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
