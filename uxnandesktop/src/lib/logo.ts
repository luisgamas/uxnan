// Custom logos & icons. A user can point an agent, a project or a branch at
// their own image; we read it into a small square PNG `data:` URL so it persists
// inline in the app state (no filesystem path to resolve in the webview) and
// stays tiny + uniform. The same helpers back the agent logo, project icon and
// branch icon pickers.

/** Largest stored custom logo edge, in pixels (the source is contain-fit into a
 *  square of this size and re-encoded as PNG). Agent logos use 64; project/branch
 *  icons pass a larger size so their bigger settings preview stays crisp. */
const LOGO_SIZE = 64;

/** Largest source image the pickers accept before rasterizing (8 MiB). Guards
 *  against inlining a huge original; the output is always a tiny square PNG. */
export const MAX_ICON_SOURCE_BYTES = 8 * 1024 * 1024;

/** Read a user-picked image file into a square PNG `data:` URL (default 64²).
 *  Falls back to the raw file data URL if a canvas isn't available. Rejects
 *  non-images and files over [`MAX_ICON_SOURCE_BYTES`]. */
export async function fileToLogoDataUrl(
  file: File,
  size: number = LOGO_SIZE,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("not an image");
  }
  if (file.size > MAX_ICON_SOURCE_BYTES) {
    throw new Error("image too large");
  }
  const dataUrl = await readAsDataUrl(file);
  return rasterizeToSquarePng(dataUrl, size);
}

/** Contain-fit an image `data:`/URL into a `size`² PNG `data:` URL. Falls back to
 *  the original source if it can't be rasterized (e.g. an exotic SVG). */
export async function rasterizeToSquarePng(
  src: string,
  size: number = LOGO_SIZE,
): Promise<string> {
  try {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx || !img.width || !img.height) return src;
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    // Couldn't rasterize — keep the original inline.
    return src;
  }
}

/** Whether a logo value is a user-supplied custom image (vs a catalog key). */
export function isCustomLogo(logo?: string | null): boolean {
  return !!logo && /^(data:|https?:|\/)/.test(logo);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("invalid image"));
    img.src = src;
  });
}
