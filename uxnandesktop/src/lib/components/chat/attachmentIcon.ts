// The glyph a file attachment's chip carries: what kind of file it is, from
// its name (and its MIME type when the name says nothing) — a PDF, a sheet, an
// archive, code, text, audio, video, an image, or just a file.

import type { IconNode } from "$lib/components/ui/icon/icon.svelte";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FileCodeIcon from "@hugeicons/core-free-icons/FileCodeIcon";
import FileMusicIcon from "@hugeicons/core-free-icons/FileMusicIcon";
import FileVideoIcon from "@hugeicons/core-free-icons/FileVideoIcon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import Pdf01Icon from "@hugeicons/core-free-icons/Pdf01Icon";
import Csv01Icon from "@hugeicons/core-free-icons/Csv01Icon";
import Xls01Icon from "@hugeicons/core-free-icons/Xls01Icon";
import Ppt01Icon from "@hugeicons/core-free-icons/Ppt01Icon";
import Doc01Icon from "@hugeicons/core-free-icons/Doc01Icon";
import Txt01Icon from "@hugeicons/core-free-icons/Txt01Icon";
import Zip01Icon from "@hugeicons/core-free-icons/Zip01Icon";
import { isTextFile } from "$lib/fileType";

const BY_EXTENSION: Record<string, IconNode> = {
  pdf: Pdf01Icon,
  csv: Csv01Icon,
  tsv: Csv01Icon,
  xls: Xls01Icon,
  xlsx: Xls01Icon,
  ods: Xls01Icon,
  ppt: Ppt01Icon,
  pptx: Ppt01Icon,
  odp: Ppt01Icon,
  doc: Doc01Icon,
  docx: Doc01Icon,
  odt: Doc01Icon,
  rtf: Doc01Icon,
  txt: Txt01Icon,
  md: Txt01Icon,
  markdown: Txt01Icon,
  log: Txt01Icon,
  zip: Zip01Icon,
  tar: Zip01Icon,
  gz: Zip01Icon,
  tgz: Zip01Icon,
  bz2: Zip01Icon,
  xz: Zip01Icon,
  "7z": Zip01Icon,
  rar: Zip01Icon,
};

/** The glyph for an attachment named [name] of [mimeType]. */
export function attachmentIcon(name: string, mimeType = ""): IconNode {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  const known = BY_EXTENSION[ext];
  if (known) return known;
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return Image01Icon;
  if (mime.startsWith("audio/")) return FileMusicIcon;
  if (mime.startsWith("video/")) return FileVideoIcon;
  if (mime === "application/pdf") return Pdf01Icon;
  if (mime === "application/zip") return Zip01Icon;
  if (isTextFile(name)) return FileCodeIcon;
  if (mime.startsWith("text/") || mime === "application/json") return Txt01Icon;
  return File01Icon;
}

/** Whether a file of [name] / [mimeType] reads as text (its preview can show it). */
export function isTextAttachment(name: string, mimeType = ""): boolean {
  const mime = mimeType.toLowerCase();
  return mime.startsWith("text/") || mime === "application/json" || isTextFile(name);
}
