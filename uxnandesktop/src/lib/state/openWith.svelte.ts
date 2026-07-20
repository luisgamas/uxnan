// "Open with" — the external-editor list shared by every menu that offers it
// (project cards, worktree rows, file-tree entries) and by the Settings pane.
//
// The auto-detected editors are a live probe (`editors_detect`: a PATH scan plus
// a per-OS install-location scan), loaded once and cached for the session. The
// menu list merges those (minus the ones the user hid) with the user's custom
// editors, both read reactively from `app.settings.openWith`. Launching a path
// funnels through the one backend command (`open_in_editor`), so a detected and a
// custom editor open exactly the same way. A native plain-text editor (Notepad /
// TextEdit / a Linux editor) is offered for text files.
//
// Icons: a per-editor override wins (a builtin glyph or an uploaded image, from
// the Settings IconPicker — `settings.openWith.detectedIcons[id]` for a detected
// editor, `ExternalEditor.icon` for a custom one). Otherwise we best-effort fetch
// the editor's **favicon** from its known website (a small session cache keyed by
// domain), and fall back to a generic glyph when there's nothing.

import { editorsDetect, imageFetchDataUrl, nativeTextEditor, openInEditor } from "$lib/api";
import { app } from "$lib/state/app.svelte";
import { rasterizeToSquarePng } from "$lib/logo";
import { toastError } from "$lib/toast";
import type { DetectedEditor, NativeEditor } from "$lib/types";

/** A menu-ready editor entry — a detected or a custom one, normalized. */
export interface MenuEditor {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** True for a user-added editor (vs an auto-detected one). */
  custom: boolean;
  /** Explicit icon override (builtin key / data URL), or null → favicon/glyph. */
  icon: string | null;
}

/** Editor id / launch-command → website domain, for the best-effort favicon.
 *  Keyed by both the catalog id and the base command name (no path/extension), so
 *  it resolves whether the editor is launched via a CLI, an `.exe` path, or macOS
 *  `open`. The JetBrains IDEs share the jetbrains.com favicon (per-product marks
 *  aren't on a domain favicon) — a user can always override any icon. */
const DOMAINS: Record<string, string> = {
  vscode: "code.visualstudio.com",
  code: "code.visualstudio.com",
  "vscode-insiders": "code.visualstudio.com",
  "code-insiders": "code.visualstudio.com",
  vscodium: "vscodium.com",
  codium: "vscodium.com",
  cursor: "cursor.com",
  windsurf: "windsurf.com",
  zed: "zed.dev",
  zeditor: "zed.dev",
  sublime: "sublimetext.com",
  subl: "sublimetext.com",
  sublime_text: "sublimetext.com",
  fleet: "jetbrains.com",
  intellij: "jetbrains.com",
  idea: "jetbrains.com",
  pycharm: "jetbrains.com",
  webstorm: "jetbrains.com",
  phpstorm: "jetbrains.com",
  rubymine: "jetbrains.com",
  goland: "jetbrains.com",
  clion: "jetbrains.com",
  rider: "jetbrains.com",
  rustrover: "jetbrains.com",
  datagrip: "jetbrains.com",
  "android-studio": "developer.android.com",
  studio: "developer.android.com",
  nova: "nova.app",
};

/** The base command name (drop any directory + `.exe`/`.cmd`/`.bat`), lowercased. */
function baseCommand(command: string): string {
  return (command.replace(/\\/g, "/").split("/").pop() ?? command)
    .replace(/\.(exe|cmd|bat|com)$/i, "")
    .toLowerCase();
}

/** The website domain to source a favicon from, for an editor (id then command). */
function domainFor(e: { id?: string; command: string }): string | undefined {
  return (e.id ? DOMAINS[e.id] : undefined) ?? DOMAINS[baseCommand(e.command)];
}

class OpenWithStore {
  /** Auto-detected editors present on this machine (cached for the session). */
  detected = $state<DetectedEditor[]>([]);
  /** Whether the one-shot detection has completed (so the UI can stop showing a
   *  "detecting…" state and settle on the real result — even the empty one). */
  loaded = $state(false);
  #loading = false;

  /** The platform's native plain-text editor (Notepad / TextEdit / …), or null. */
  nativeText = $state<NativeEditor | null>(null);
  #nativeLoaded = false;

  /** Best-effort favicon data URLs keyed by website domain. `""` = tried and
   *  failed (so we never re-fetch a dead one). */
  #favicons = $state<Record<string, string>>({});

  /** Detect installed editors + the native text editor once. Idempotent. Cheap
   *  (a PATH walk + a few `stat`s), so it's kicked off eagerly at startup and
   *  again on first menu hover. */
  async ensureLoaded(): Promise<void> {
    void this.#ensureNative();
    if (this.loaded || this.#loading) return;
    await this.refresh();
  }

  /** Re-run editor detection (Settings → Open with "Refresh"). */
  async refresh(): Promise<void> {
    this.#loading = true;
    try {
      this.detected = await editorsDetect();
    } catch {
      // A failed probe leaves the previous list; custom editors still work.
    } finally {
      this.loaded = true;
      this.#loading = false;
    }
    void this.ensureIcons();
  }

  async #ensureNative(): Promise<void> {
    if (this.#nativeLoaded) return;
    this.#nativeLoaded = true;
    try {
      this.nativeText = await nativeTextEditor();
    } catch {
      this.nativeText = null;
    }
  }

  /** The editors to show in an "Open with" menu: detected (minus the hidden set)
   *  followed by the user's custom ones. Reactive to both the detection cache and
   *  `settings.openWith`. */
  get menuEditors(): MenuEditor[] {
    const cfg = app.settings.openWith;
    const hidden = new Set(cfg?.hiddenDetected ?? []);
    const detectedIcons = cfg?.detectedIcons ?? {};
    const detected: MenuEditor[] = this.detected
      .filter((e) => !hidden.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        command: e.command,
        args: e.args ?? [],
        custom: false,
        icon: detectedIcons[e.id] ?? null,
      }));
    const custom: MenuEditor[] = (cfg?.customEditors ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      command: e.command,
      args: e.args ?? [],
      custom: true,
      icon: e.icon ?? null,
    }));
    return [...detected, ...custom];
  }

  /** The best-effort favicon (a data URL) for an editor, or null. */
  favicon(e: { id?: string; command: string }): string | null {
    const domain = domainFor(e);
    return domain ? this.#favicons[domain] || null : null;
  }

  /** Warm the favicon cache for every current menu editor that has no explicit
   *  icon override and a known website. Idempotent per domain. */
  async ensureIcons(): Promise<void> {
    await Promise.all(
      this.menuEditors.filter((e) => !e.icon).map((e) => this.#warmFavicon(e)),
    );
  }

  async #warmFavicon(e: { id?: string; command: string }): Promise<void> {
    const domain = domainFor(e);
    if (!domain || domain in this.#favicons) return; // unknown, or already tried
    this.#favicons[domain] = ""; // reserve so a concurrent call doesn't re-fetch
    try {
      const raw = await imageFetchDataUrl(
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
      );
      this.#favicons[domain] = await rasterizeToSquarePng(raw, 32);
    } catch {
      // Leave `""` — a generic glyph shows instead; the user can set an icon.
    }
  }

  /** Open `path` (a folder or file) in `editor`. Errors surface as a toast so a
   *  misconfigured command never fails silently. */
  async open(path: string, editor: { command: string; args?: string[] }): Promise<void> {
    try {
      await openInEditor(editor.command, editor.args ?? [], path);
    } catch (e) {
      toastError(e);
    }
  }

  /** Open a text file in the platform's native text editor (a no-op if none). */
  async openNative(path: string): Promise<void> {
    if (this.nativeText) await this.open(path, this.nativeText);
  }
}

/** Singleton shared across the menus and the Settings pane. */
export const openWith = new OpenWithStore();
