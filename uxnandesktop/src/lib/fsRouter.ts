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

import { fsListDir, fsReadFile, sshFsList, sshFsRead } from "$lib/api";
import { sshHostId, type TargetId } from "$lib/target";
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
