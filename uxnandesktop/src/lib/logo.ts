// Custom agent logos. A user can point an agent at their own image; we read it
// into a small square PNG `data:` URL so it persists inline in the app state
// (no filesystem path to resolve in the webview) and stays tiny + uniform.

/** Largest stored custom logo edge, in pixels (the source is contain-fit into a
 *  square of this size and re-encoded as PNG). */
const LOGO_SIZE = 64;

/** Read a user-picked image file into a `LOGO_SIZE`² PNG `data:` URL. Falls back
 *  to the raw file data URL if a canvas isn't available. Rejects non-images. */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("not an image");
  }
  const dataUrl = await readAsDataUrl(file);
  try {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = LOGO_SIZE;
    canvas.height = LOGO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx || !img.width || !img.height) return dataUrl;
    const scale = Math.min(LOGO_SIZE / img.width, LOGO_SIZE / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (LOGO_SIZE - w) / 2, (LOGO_SIZE - h) / 2, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    // Couldn't rasterize (e.g. exotic SVG) — keep the original inline.
    return dataUrl;
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
