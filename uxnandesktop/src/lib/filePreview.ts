import { isImagePath } from "$lib/diff";

export type FilePreviewKind = "image" | "markdown" | "pdf";

/** Parent directory in the backend's canonical forward-slash spelling. File
 * paths arrive with native separators on Windows and `/` everywhere else. */
export function fileParentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return null;
  const parent = normalized.slice(0, slash);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent || "/";
}

/** Resolve a README image URL against its document directory. Markdown image
 * references use URL separators on every OS, while file tabs can carry native
 * Windows separators. Query/fragment suffixes describe web delivery rather than
 * an on-disk filename. */
export function resolvePreviewAssetPath(baseDir: string, source: string): string {
  const withoutDeliverySuffix = source.split(/[?#]/, 1)[0];
  let relative: string;
  try {
    relative = decodeURIComponent(withoutDeliverySuffix);
  } catch {
    relative = withoutDeliverySuffix;
  }
  relative = relative.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(relative) || relative.startsWith("/")) return relative;

  const parts = baseDir.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  for (const segment of relative.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // Preserve POSIX `/`, Windows `C:/`, and the `//server/share` UNC root.
      const floor = parts[0] === "" && parts[1] === "" ? 4 : parts[0] === "" ? 1 : 1;
      if (parts.length > floor) parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

/** Preview capability for a file path. Kept in one place so restored tabs and
 * the live file-view shell make the same decision. */
export function filePreviewKind(path: string): FilePreviewKind | null {
  if (isImagePath(path)) return "image";
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.pdf$/i.test(path)) return "pdf";
  return null;
}

/** Binary visual documents should land in Preview; Markdown stays source-first. */
export function opensInPreview(path: string): boolean {
  const kind = filePreviewKind(path);
  return kind === "image" || kind === "pdf";
}
