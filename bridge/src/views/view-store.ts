import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  VIEW_MAX_HTML_BYTES,
  VIEW_MAX_TITLE_LENGTH,
  clampViewHeight,
  isViewId,
  type ViewReadResult,
} from '@uxnan/shared';
import { resolveWithinRoot } from '../workspace/path-guard.js';
import { inlineViewLibraries } from './view-libraries.js';

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
const MAX_VIEWS = 500;
const MAX_STORE_BYTES = 256 * 1024 * 1024;

export interface ViewMeta {
  title: string;
  bytes: number;
  height?: number;
  createdAt: number;
}

export class ViewStore {
  readonly directory: string;
  readonly bootstrap: string;
  readonly now: () => number;
  /** Views made since start that no step has shown yet (see {@link claim}). */
  readonly #unclaimed = new Map<string, ViewMeta>();

  constructor(options: { directory?: string; bootstrap: string; now?: () => number }) {
    this.directory = options.directory ?? join(homedir(), '.uxnan', 'views');
    this.bootstrap = options.bootstrap;
    this.now = options.now ?? Date.now;
  }

  /**
   * The page as clients would get it, without storing it: the agent's HTML
   * (inline or read from [input.path] in [input.cwd]) checked, its bundled
   * libraries put in, and the CSP and bootstrap added. `view_show` stores it;
   * `view_check` renders it.
   */
  async prepare(input: {
    html?: string;
    path?: string;
    cwd?: string;
  }): Promise<{ source: string; html: string; bytes: number }> {
    if ((typeof input.html === 'string') === (typeof input.path === 'string'))
      throw new Error('Provide exactly one of html or path.');
    let source: string;
    if (input.html !== undefined) source = input.html;
    else {
      if (!input.cwd)
        throw new Error('A working folder is required to use path; provide html instead.');
      if (input.cwd.length > 4096 || !isAbsolute(input.cwd))
        throw new Error(
          'The conversation working folder is invalid; provide html instead of path.',
        );
      if (input.path!.length > 4096)
        throw new Error('The view path is too long; keep it under 4096 characters.');
      let file: string;
      try {
        file = resolveWithinRoot(input.cwd, input.path!);
      } catch (e) {
        throw new Error(`The view path must stay inside the working folder: ${String(e)}`);
      }
      const fileSize = (await stat(file)).size;
      if (fileSize > VIEW_MAX_HTML_BYTES)
        throw new Error(
          `View HTML is ${fileSize} bytes; the limit is ${VIEW_MAX_HTML_BYTES} bytes.`,
        );
      source = await readFile(file, 'utf8');
    }
    const bytes = Buffer.byteLength(source, 'utf8');
    if (bytes > VIEW_MAX_HTML_BYTES)
      throw new Error(`View HTML is ${bytes} bytes; the limit is ${VIEW_MAX_HTML_BYTES} bytes.`);
    const html = prepareViewHtml(inlineViewLibraries(source).html, this.bootstrap);
    return { source, html, bytes };
  }

  async create(input: {
    title: string;
    html?: string;
    path?: string;
    height?: number;
    cwd?: string;
  }): Promise<{ viewId: string; meta: ViewMeta }> {
    const { html, bytes } = await this.prepare(input);
    const title = Array.from(input.title).slice(0, VIEW_MAX_TITLE_LENGTH).join('');
    const height = input.height === undefined ? undefined : clampViewHeight(input.height);
    await mkdir(this.directory, { recursive: true });
    const viewId = randomBytes(16).toString('hex');
    const meta: ViewMeta = {
      title,
      bytes,
      ...(height !== undefined ? { height } : {}),
      createdAt: this.now(),
    };
    await writeFile(join(this.directory, `${viewId}.html`), html, { flag: 'wx', mode: 0o600 });
    await writeFile(join(this.directory, `${viewId}.json`), JSON.stringify(meta), {
      flag: 'wx',
      mode: 0o600,
    });
    this.#unclaimed.set(viewId, meta);
    await this.prune();
    return { viewId, meta };
  }

  async read(viewId: string): Promise<ViewReadResult | undefined> {
    if (!isViewId(viewId)) return undefined;
    try {
      const [html, raw] = await Promise.all([
        readFile(join(this.directory, `${viewId}.html`), 'utf8'),
        readFile(join(this.directory, `${viewId}.json`), 'utf8'),
      ]);
      const meta = JSON.parse(raw) as ViewMeta;
      return { viewId, title: meta.title, html, bytes: meta.bytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async metadata(viewId: string): Promise<ViewMeta | undefined> {
    if (!isViewId(viewId)) return undefined;
    try {
      return JSON.parse(await readFile(join(this.directory, `${viewId}.json`), 'utf8')) as ViewMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /**
   * The metadata of a view made since this bridge started that no step has
   * shown yet, marking it shown — or undefined. A view is shown once: by the
   * step that made it (see `convert-view-block.ts`).
   */
  claim(viewId: string): ViewMeta | undefined {
    const meta = this.#unclaimed.get(viewId);
    this.#unclaimed.delete(viewId);
    return meta;
  }

  async prune(): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const records: { id: string; createdAt: number; bytes: number }[] = [];
    for (const e of entries)
      if (e.isFile() && e.name.endsWith('.json') && isViewId(e.name.slice(0, -5))) {
        const id = e.name.slice(0, -5);
        try {
          const meta = JSON.parse(await readFile(join(this.directory, e.name), 'utf8')) as ViewMeta;
          const page = await stat(join(this.directory, `${id}.html`));
          records.push({
            id,
            createdAt: meta.createdAt,
            bytes: page.size + (await stat(join(this.directory, e.name))).size,
          });
        } catch {
          await rm(join(this.directory, e.name), { force: true });
        }
      }
    records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    let total = records.reduce((n, r) => n + r.bytes, 0);
    while (records.length > MAX_VIEWS || total > MAX_STORE_BYTES) {
      const old = records.shift()!;
      total -= old.bytes;
      this.#unclaimed.delete(old.id);
      await Promise.all([
        rm(join(this.directory, `${old.id}.html`), { force: true }),
        rm(join(this.directory, `${old.id}.json`), { force: true }),
      ]);
    }
  }
}

/**
 * The page a client renders: the agent's HTML with the no-network CSP, the
 * charset, the viewport and the view bootstrap put FIRST — right after a
 * doctype, before anything the agent wrote. A `<meta>` policy only governs
 * what follows it, so placing it inside the agent's `<head>` would let a
 * script written before that `<head>` run unrestricted (the phone has no
 * other policy than this one). The HTML parser files these leading elements
 * into the document's head and ignores the agent's own `<html>`/`<head>`
 * tags as duplicates, keeping their contents.
 */
export function prepareViewHtml(source: string, bootstrap: string): string {
  const body = source.replace(/^\uFEFF/, '');
  const doctype = /^\s*<!doctype[^>]*>/i.exec(body);
  const rest = doctype ? body.slice(doctype[0].length) : body;
  const security = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;
  return `<!doctype html>${security}<script>${bootstrap}</script>${rest}`;
}
