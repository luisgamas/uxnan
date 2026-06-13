// Clipboard read/write that works inside the Tauri webview (via the
// clipboard-manager plugin) and degrades to the browser Clipboard API in a
// plain web preview. All calls are best-effort and never throw.

import {
  readText,
  writeText,
} from "@tauri-apps/plugin-clipboard-manager";

export async function clipboardWrite(text: string): Promise<void> {
  if (!text) return;
  try {
    await writeText(text);
  } catch {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard available — ignore.
    }
  }
}

export async function clipboardRead(): Promise<string> {
  try {
    return (await readText()) ?? "";
  } catch {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }
}
