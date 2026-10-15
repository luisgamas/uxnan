import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ViewStore } from '../../src/views/view-store.js';
import { VIEW_BOOTSTRAP } from '../../src/views/view-bootstrap.js';
import { startViewMcpServer } from '../../src/views/mcp-server.js';
import {
  fixedColors,
  viewCheckReport,
  viewFindings,
  type ViewRender,
} from '../../src/views/view-check.js';

test('viewFindings names what the no-network policy blocks, and a page off the theme', () => {
  const page = `<img src="https://x.test/a.png"><a href="https://docs.test">docs</a>
    <style>@import url("https://fonts.test/f.css")</style><script>fetch('/api')</script>`;
  const findings = viewFindings(page);
  assert.ok(findings.some((f) => f.includes('https://x.test/a.png')));
  assert.ok(!findings.some((f) => f.includes('docs.test')), 'a link is fine');
  assert.ok(findings.some((f) => f.includes('@import')));
  assert.ok(findings.some((f) => f.includes('fetch')));
  assert.ok(findings.some((f) => f.startsWith('Theme:')));
  // Twice in a row: no regex state leaks between calls.
  assert.deepEqual(viewFindings(page), findings);
  assert.deepEqual(viewFindings('<p style="color: var(--color-text-primary, #222)">ok</p>'), []);
});

test('viewCheckReport says what it could and could not see', () => {
  const render: ViewRender = {
    png: 'AAAA',
    width: 720,
    height: 900,
    contentHeight: 310,
    console: [
      { level: 'error', text: 'x is not defined' },
      { level: 'log', text: 'hi' },
    ],
    timedOut: false,
  };
  const full = viewCheckReport([], render);
  assert.match(String(full.content[0]?.['text']), /310px tall[\s\S]*x is not defined/);
  assert.deepEqual(full.content[1], { type: 'image', mimeType: 'image/png', data: 'AAAA' });
  const sourceOnly = viewCheckReport(['Theme: …'], undefined);
  assert.equal(sourceOnly.content.length, 1);
  assert.match(String(sourceOnly.content[0]?.['text']), /No desktop is connected/);
  assert.match(
    String(viewCheckReport([], undefined, 'boom').content[0]?.['text']),
    /could not be rendered: boom/,
  );
});

test('view_check over MCP prepares the page, renders it when it can, and stores nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-view-check-'));
  const store = new ViewStore({ directory: root, bootstrap: VIEW_BOOTSTRAP });
  const seen: { html: string; width: number }[] = [];
  const server = await startViewMcpServer({
    store,
    renderer: async (html, width) => {
      seen.push({ html, width });
      return { png: 'PNG', width, height: 900, contentHeight: 120, console: [], timedOut: false };
    },
  });
  const call = async (args: unknown) => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'view_check', arguments: args },
      }),
    });
    return (
      (await res.json()) as { result: { content: Record<string, unknown>[]; isError?: boolean } }
    ).result;
  };
  try {
    const listed = await fetch(server.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const names = (
      (await listed.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((t) => t.name);
    assert.deepEqual(names, ['view_show', 'view_check']);
    const ok = await call({ html: '<p>hi</p>', width: 400 });
    assert.equal(seen[0]?.width, 400);
    assert.ok(
      seen[0]?.html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'),
    );
    assert.deepEqual(ok.content[1], { type: 'image', mimeType: 'image/png', data: 'PNG' });
    const bad = await call({ html: '<script src="uxnan:nope"></script>' });
    assert.equal(bad.isError, true);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(root).catch(() => []), [], 'a check stores nothing');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('viewFindings names fixed colors and heights that keep growing, and spares fallbacks', () => {
  const page = `<style>.a{color:#1b1c1e;background:rgb(10, 20, 30)}.b{fill:var(--color-chart-1, #2a78d6)}
    html,body{height:100%}</style><p>PR #357 and <a href="#abc123">a link</a></p>
    <svg><rect fill="#e11d48"/></svg><img src="data:image/svg+xml,%3Csvg fill='%23ffffff'/%3E">`;
  const findings = viewFindings(page);
  const colors = findings.find((f) => f.startsWith('Colors:'));
  assert.ok(colors);
  assert.match(colors, /3 fixed colors/);
  assert.ok(
    colors.includes('#1b1c1e') && colors.includes('#e11d48') && colors.includes('rgb(10, 20, 30)'),
  );
  assert.ok(!colors.includes('#2a78d6'), 'a var() fallback is fine');
  assert.ok(findings.some((f) => f.startsWith('Height:')));
  assert.ok(
    viewFindings('<div style="min-height: 100vh; color: var(--color-text-primary)">').some((f) =>
      f.startsWith('Height:'),
    ),
  );
  assert.equal(fixedColors('<p>Issue #123, see <a href="#fff">x</a></p>').length, 0);
});

test('viewFindings flags a colored stripe on one edge of a box, not a hairline', () => {
  assert.ok(
    viewFindings('<div style="border-left: 3px solid var(--color-chart-1)">x</div>').some((f) =>
      f.startsWith('Design:'),
    ),
  );
  assert.ok(
    viewFindings('<style>.c{border-top-width:4px}</style>').some((f) => f.startsWith('Design:')),
  );
  assert.equal(
    viewFindings('<div style="border-bottom:1px solid var(--color-border-primary)">x</div>').some(
      (f) => f.startsWith('Design:'),
    ),
    false,
  );
});
