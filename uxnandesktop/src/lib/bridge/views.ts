/** Desktop mirror of `shared/src/models/view.ts` and `shared/src/views/view-protocol.ts`.
 * Keep protocol names, limits, and annotation formatting byte-for-byte aligned. */
import { invoke } from '@tauri-apps/api/core';

export const VIEW_MIN_HEIGHT = 80;
export const VIEW_MAX_HEIGHT = 1600;
export const VIEW_DEFAULT_HEIGHT = 320;
export const VIEW_THEME_VARIABLES = [
  '--color-background-primary', '--color-background-secondary', '--color-text-primary',
  '--color-text-secondary', '--color-border-primary', '--color-ring-primary',
  '--color-background-info', '--color-background-danger', '--color-background-success',
  '--color-background-warning', '--font-sans', '--font-mono', '--border-radius-sm',
  '--border-radius-md', '--border-radius-lg',
] as const;
export const VIEW_METHODS = {
  initialize: 'ui/initialize', initialized: 'ui/notifications/initialized',
  sizeChanged: 'ui/notifications/size-changed', openLink: 'ui/open-link',
  message: 'ui/message', annotation: 'uxnan/annotation',
} as const;
export const VIEW_HOST_METHODS = {
  hostContextChanged: 'ui/notifications/host-context-changed', annotate: 'uxnan/annotate',
} as const;

export interface ViewAnnotation {
  selector: string; tag: string; text?: string; html?: string;
  rect: { x: number; y: number; width: number; height: number };
}
export interface ViewHostContext {
  theme: 'light' | 'dark'; styles: { variables: Record<string, string> };
  displayMode: 'inline' | 'fullscreen'; platform: 'desktop'; locale: string;
}
export function clampViewHeight(height: number): number {
  if (!Number.isFinite(height)) return VIEW_DEFAULT_HEIGHT;
  return Math.min(VIEW_MAX_HEIGHT, Math.max(VIEW_MIN_HEIGHT, Math.round(height)));
}
export function formatViewAnnotations(title: string, notes: { annotation: ViewAnnotation; note: string }[]): string {
  const lines = [`On the view "${title}":`];
  notes.forEach(({ annotation, note }, index) => {
    lines.push('', `${index + 1}. \`${annotation.selector}\` (<${annotation.tag}>)`);
    if (annotation.text) lines.push(`   Text: ${annotation.text.replace(/\s+/g, ' ')}`);
    if (note.trim()) lines.push(`   Note: ${note.trim()}`);
  });
  return lines.join('\n');
}

export async function readView(viewId: string, call: (method: string, params: unknown) => Promise<unknown>): Promise<{ viewId: string; title: string; html: string; bytes: number }> {
  return call('view/read', { viewId }).then((result: unknown) => {
    const value = result as Record<string, unknown>;
    if (value?.viewId !== viewId || typeof value.html !== 'string' || new TextEncoder().encode(value.html).byteLength > 512 * 1024 || typeof value.title !== 'string') {
      throw new Error('The view response was invalid.');
    }
    return { viewId, title: value.title.slice(0, 120), html: value.html, bytes: typeof value.bytes === 'number' ? value.bytes : 0 };
  });
}

const fetchedViews = new Map<string, { value: { viewId: string; title: string; html: string; bytes: number }; bytes: number }>();
let fetchedBytes = 0;
/** Reuse fetched HTML while keeping this process cache under 4 MiB. */
export async function cachedView(viewId: string, call: (method: string, params: unknown) => Promise<unknown>) {
  const cached = fetchedViews.get(viewId);
  if (cached) { fetchedViews.delete(viewId); fetchedViews.set(viewId, cached); return cached.value; }
  const value = await readView(viewId, call);
  const bytes = new TextEncoder().encode(value.html).byteLength;
  fetchedViews.set(viewId, { value, bytes });
  fetchedBytes += bytes;
  while (fetchedBytes > 4 * 1024 * 1024 && fetchedViews.size > 1) {
    const first = fetchedViews.keys().next().value as string | undefined;
    if (!first) break;
    fetchedBytes -= fetchedViews.get(first)?.bytes ?? 0;
    fetchedViews.delete(first);
  }
  return value;
}

const liveFrames = new Map<symbol, () => void>();
/** Claim one of four app-wide frame slots; oldest mounted frame is suspended. */
export function claimViewFrame(id: symbol, suspend: () => void): void {
  liveFrames.delete(id);
  liveFrames.set(id, suspend);
  while (liveFrames.size > 4) {
    const oldest = liveFrames.keys().next().value as symbol | undefined;
    if (!oldest) break;
    const evict = liveFrames.get(oldest);
    liveFrames.delete(oldest);
    evict?.();
  }
}
export function releaseViewFrame(id: symbol): void { liveFrames.delete(id); }

export async function stageView(viewId: string, html: string): Promise<string> {
  return invoke<string>('view_stage', { args: { key: viewId, html } });
}

type RpcId = string | number;
export interface ViewHostCallbacks {
  context(): ViewHostContext;
  send(message: Record<string, unknown>): void;
  onHeight(height: number): void;
  onMessage(text: string): void;
  onAnnotation(annotation: ViewAnnotation): void;
  openLink(url: string): Promise<boolean>;
}

function boundedString(value: unknown, max: number, nonempty = false): value is string {
  return typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0);
}
function validId(value: unknown): value is RpcId {
  return (typeof value === 'string' && value.length > 0 && value.length <= 64) ||
    (typeof value === 'number' && Number.isSafeInteger(value));
}
function validAnnotation(value: unknown): value is ViewAnnotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  const rect = a.rect as Record<string, unknown> | undefined;
  return boundedString(a.selector, 300, true) && typeof a.tag === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(a.tag) &&
    (a.text === undefined || boundedString(a.text, 500)) && (a.html === undefined || boundedString(a.html, 1000)) &&
    !!rect && ['x', 'y', 'width', 'height'].every((k) => typeof rect[k] === 'number' && Number.isFinite(rect[k]));
}

/** Create a source-agnostic protocol dispatcher. The component verifies the iframe source first. */
export function createViewHost(callbacks: ViewHostCallbacks) {
  async function receive(raw: unknown): Promise<boolean> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const msg = raw as Record<string, unknown>;
    if (msg.jsonrpc !== '2.0' || !boundedString(msg.method, 80, true)) return false;
    const params = msg.params === undefined ? {} : msg.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
    const p = params as Record<string, unknown>;
    const request = validId(msg.id);
    const answer = (result: unknown) => callbacks.send({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code: number, message: string) => callbacks.send({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
    switch (msg.method) {
      case VIEW_METHODS.initialize:
        if (!request) return false;
        answer({ hostContext: callbacks.context() });
        return true;
      case VIEW_METHODS.initialized:
        return !request;
      case VIEW_METHODS.sizeChanged:
        if (request || typeof p.height !== 'number' || !Number.isFinite(p.height) || p.height < 0 || p.height > 100_000 ||
          typeof p.width !== 'number' || !Number.isFinite(p.width) || p.width < 0 || p.width > 100_000) return false;
        callbacks.onHeight(clampViewHeight(p.height));
        return true;
      case VIEW_METHODS.openLink: {
        if (!request || !boundedString(p.url, 2048, true)) return false;
        let url: URL;
        try { url = new URL(p.url); } catch { fail(-32602, 'Invalid URL'); return true; }
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) { fail(-32602, 'Unsupported URL'); return true; }
        try {
          if (await callbacks.openLink(url.href)) answer({}); else fail(-32000, 'Link was not opened');
        } catch {
          fail(-32000, 'Link was not opened');
        }
        return true;
      }
      case VIEW_METHODS.message: {
        const content = p.content;
        if (!request || p.role !== 'user' || !Array.isArray(content) || content.length !== 1 || !content[0] || typeof content[0] !== 'object') return false;
        const item = content[0] as Record<string, unknown>;
        if (item.type !== 'text' || !boundedString(item.text, 4000, true)) return false;
        callbacks.onMessage(item.text);
        answer({});
        return true;
      }
      case VIEW_METHODS.annotation:
        if (request || !validAnnotation(p)) return false;
        callbacks.onAnnotation(p);
        return true;
      default:
        return false;
    }
  }
  return {
    receive,
    send(method: string, params: Record<string, unknown>) { callbacks.send({ jsonrpc: '2.0', method, params }); },
  };
}
