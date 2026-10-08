import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { cachedView, claimViewFrame, clampViewHeight, createViewHost, formatViewAnnotations, readView, releaseViewFrame, stageView, VIEW_METHODS, type ViewAnnotation } from './views';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'uxnan-view://localhost/staged') }));

function setup() {
  const send = vi.fn();
  const onHeight = vi.fn();
  const onMessage = vi.fn();
  const onAnnotation = vi.fn();
  const openLink = vi.fn(async () => true);
  const host = createViewHost({
    context: () => ({ theme: 'dark', styles: { variables: {} }, displayMode: 'inline', platform: 'desktop', locale: 'en' }),
    send, onHeight, onMessage, onAnnotation, openLink,
  });
  return { host, send, onHeight, onMessage, onAnnotation, openLink };
}

const annotation: ViewAnnotation = { selector: 'button.save', tag: 'button', text: 'Save', rect: { x: 1, y: 2, width: 30, height: 20 } };

describe('desktop agent view protocol host', () => {
  it('answers initialize with the current host context', async () => {
    const { host, send } = setup();
    expect(await host.receive({ jsonrpc: '2.0', id: 2, method: VIEW_METHODS.initialize, params: {} })).toBe(true);
    expect(send).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 2, result: { hostContext: expect.objectContaining({ platform: 'desktop', theme: 'dark' }) } });
  });
  it('accepts bounded size notifications and clamps the reservation', async () => {
    const { host, onHeight } = setup();
    expect(await host.receive({ jsonrpc: '2.0', method: VIEW_METHODS.sizeChanged, params: { width: 500, height: 5000 } })).toBe(true);
    expect(onHeight).toHaveBeenCalledWith(1600);
    expect(await host.receive({ jsonrpc: '2.0', method: VIEW_METHODS.sizeChanged, params: { width: -1, height: 100 } })).toBe(false);
  });
  it('inserts proposed text without sending and validates the content shape', async () => {
    const { host, onMessage, send } = setup();
    expect(await host.receive({ jsonrpc: '2.0', id: 'm', method: VIEW_METHODS.message, params: { role: 'user', content: [{ type: 'text', text: 'Please inspect this' }] } })).toBe(true);
    expect(onMessage).toHaveBeenCalledWith('Please inspect this');
    expect(send).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 'm', result: {} });
    expect(await host.receive({ jsonrpc: '2.0', id: 'm', method: VIEW_METHODS.message, params: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(4001) }] } })).toBe(false);
  });
  it('allows only web and mail links after the host callback', async () => {
    const { host, openLink, send } = setup();
    expect(await host.receive({ jsonrpc: '2.0', id: 1, method: VIEW_METHODS.openLink, params: { url: 'https://example.test/path' } })).toBe(true);
    expect(openLink).toHaveBeenCalledWith('https://example.test/path');
    expect(send).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await host.receive({ jsonrpc: '2.0', id: 1, method: VIEW_METHODS.openLink, params: { url: 'javascript:alert(1)' } })).toBe(true);
    expect(send).toHaveBeenLastCalledWith({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unsupported URL' } });
  });
  it('accepts a valid annotation and rejects malformed messages', async () => {
    const { host, onAnnotation } = setup();
    expect(await host.receive({ jsonrpc: '2.0', method: VIEW_METHODS.annotation, params: annotation })).toBe(true);
    expect(onAnnotation).toHaveBeenCalledWith(annotation);
    expect(await host.receive({ jsonrpc: '1.0', method: VIEW_METHODS.annotation, params: annotation })).toBe(false);
  });
  it('matches the shared height and annotation formatting contract', () => {
    expect(clampViewHeight(40)).toBe(80);
    expect(clampViewHeight(1900)).toBe(1600);
    expect(formatViewAnnotations('Overview', [{ annotation, note: ' Emphasize this ' }])).toBe('On the view "Overview":\n\n1. `button.save` (<button>)\n   Text: Save\n   Note: Emphasize this');
  });
  it('validates bridge reads and stages HTML through the Rust command', async () => {
    const call = vi.fn(async () => ({ viewId: 'v1', title: 'Ready', html: '<h1>Ready</h1>', bytes: 14 }));
    expect(await readView('v1', call)).toEqual({ viewId: 'v1', title: 'Ready', html: '<h1>Ready</h1>', bytes: 14 });
    await expect(readView('v1', vi.fn(async () => ({ viewId: 'other', title: 'bad', html: '', bytes: 0 })))).rejects.toThrow('invalid');
    expect(await stageView('0123456789abcdef0123456789abcdef', '<p>page</p>')).toBe('uxnan-view://localhost/staged');
    expect(invoke).toHaveBeenCalledWith('view_stage', { args: { key: '0123456789abcdef0123456789abcdef', html: '<p>page</p>' } });
  });
  it('caches prepared HTML and evicts the least recently used live frame', async () => {
    const call = vi.fn(async (_method: string, params: unknown) => ({ viewId: (params as { viewId: string }).viewId, title: 'View', html: '<p>x</p>', bytes: 8 }));
    expect(await cachedView('cache-v1', call)).toEqual(expect.objectContaining({ viewId: 'cache-v1' }));
    await cachedView('cache-v1', call);
    expect(call).toHaveBeenCalledTimes(1);
    const evicted = vi.fn();
    const ids = Array.from({ length: 5 }, () => Symbol());
    ids.forEach((id, index) => claimViewFrame(id, index === 0 ? evicted : vi.fn()));
    expect(evicted).toHaveBeenCalledOnce();
    ids.forEach(releaseViewFrame);
  });
});
