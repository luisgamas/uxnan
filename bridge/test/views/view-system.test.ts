import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ViewStore, prepareViewHtml } from '../../src/views/view-store.js';
import { VIEW_BOOTSTRAP } from '../../src/views/view-bootstrap.js';
import { startViewMcpServer } from '../../src/views/mcp-server.js';
import { convertViewToolBlock } from '../../src/views/convert-view-block.js';
import { HandlerRouter } from '../../src/handler-router.js';
import { registerViewHandlers } from '../../src/handlers/view-handler.js';
import {
  makeRequest,
  JsonRpcErrorCode,
  VIEW_PAGE_VARIABLES,
  VIEW_THEME_EVENT,
  VIEW_THEME_VARIABLES,
} from '@uxnan/shared';
import { VIEW_BASE_CSS, VIEW_BASE_VARIABLES } from '../../src/views/view-base-css.js';

test('view preparation puts the CSP before anything the agent wrote', () => {
  for (const source of [
    '<p>fragment</p>',
    '<html><body>body</body></html>',
    '<!DOCTYPE HTML><HTML><HEAD><title>x</title></HEAD><BODY>x</BODY></HTML>',
    '\uFEFF  <!doctype html><script>fetch("https://x")</script><html><head></head></html>',
  ]) {
    const html = prepareViewHtml(source, 'window.boot=true');
    assert.ok(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'), source);
    assert.ok(html.includes("connect-src 'none'"));
    assert.ok(html.includes('<meta charset="utf-8">'));
    assert.ok(html.includes('<meta name="viewport"'));
    assert.ok(html.indexOf('<script>window.boot=true</script>') > html.indexOf('viewport'));
    assert.equal(html.match(/<!doctype/gi)?.length, 1, 'one doctype');
    // Everything the agent wrote follows the policy and the bootstrap, intact.
    const agentPart = html.slice(html.indexOf('</script>') + '</script>'.length);
    assert.equal(agentPart, source.replace(/^\uFEFF/, '').replace(/^\s*<!doctype[^>]*>/i, ''));
  }
});

test('ViewStore bounds source size, confines paths, stores pages and reads metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-views-'));
  const cwd = join(root, 'work');
  await mkdir(cwd);
  await writeFile(join(cwd, 'page.html'), '<p>from file</p>');
  await writeFile(join(cwd, 'large.html'), 'x'.repeat(512 * 1024 + 1));
  const store = new ViewStore({
    directory: join(root, 'views'),
    bootstrap: 'window.boot=true',
    now: () => 42,
  });
  try {
    await assert.rejects(
      store.create({ title: 'bad', path: '../outside.html', cwd }),
      /working folder/,
    );
    await assert.rejects(store.create({ title: 'bad', html: 'x'.repeat(512 * 1024 + 1) }), /limit/);
    await assert.rejects(store.create({ title: 'large', path: 'large.html', cwd }), /limit/);
    const { viewId, meta } = await store.create({
      title: 'A title',
      path: 'page.html',
      cwd,
      height: 10,
    });
    assert.equal(meta.createdAt, 42);
    assert.equal(meta.height, 80);
    assert.equal(store.claim(viewId)?.bytes, Buffer.byteLength('<p>from file</p>'));
    assert.equal(store.claim(viewId), undefined, 'a view is claimed once');
    const read = await store.read(viewId);
    assert.equal(read?.title, 'A title');
    assert.match(read?.html ?? '', /Content-Security-Policy/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('view tool conversion strips HTML while running and replaces only a stored successful call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-view-convert-'));
  const store = new ViewStore({ directory: root, bootstrap: '' });
  try {
    const { viewId, meta } = await store.create({ title: 'Probe', html: '<p>hi</p>' });
    const running = convertViewToolBlock(
      {
        type: 'tool',
        blockId: 'b1',
        toolName: 'mcp__uxnan__view_show',
        status: 'running',
        input: { html: '<p>hi</p>' },
      },
      store,
    ) as Record<string, any>;
    assert.equal(running.input.html, undefined);
    assert.equal(running.input.htmlBytes, Buffer.byteLength('<p>hi</p>'));
    const done = convertViewToolBlock(
      {
        type: 'tool',
        blockId: 'b1',
        toolName: 'uxnan_view_show',
        input: { html: '<p>hi</p>' },
        output: `uxnan-view:${viewId}`,
        isError: false,
      },
      store,
    );
    assert.deepEqual(done, {
      type: 'view',
      blockId: 'b1',
      viewId,
      title: meta.title,
      bytes: meta.bytes,
    });
    const unknown = convertViewToolBlock(
      {
        type: 'tool',
        toolName: 'view_show',
        input: { html: '<p>hi</p>' },
        output: `uxnan-view:${'f'.repeat(32)}`,
        isError: false,
      },
      store,
    ) as Record<string, any>;
    assert.equal(unknown.type, 'tool');
    assert.equal(unknown.input.html, undefined);
    // Shown once: a later step that prints the same marker stays a step.
    const again = convertViewToolBlock(
      { type: 'tool', toolName: 'Bash', input: {}, output: `uxnan-view:${viewId}`, isError: false },
      store,
    ) as Record<string, any>;
    assert.equal(again.type, 'tool');
    // Wrappers: OpenCode's code-mode `execute`, Grok's `UseTool`.
    const second = await store.create({ title: 'Wrapped', html: '<p>w</p>' });
    const viaExecute = convertViewToolBlock(
      {
        type: 'tool',
        blockId: 'e1',
        toolName: 'execute',
        input: { code: 'await tools.uxnan.view_show({})' },
        output: `Shown. uxnan-view:${second.viewId}`,
        isError: false,
      },
      store,
    ) as Record<string, any>;
    assert.deepEqual(
      { type: viaExecute.type, viewId: viaExecute.viewId, blockId: viaExecute.blockId },
      { type: 'view', viewId: second.viewId, blockId: 'e1' },
    );
    const wrapped = convertViewToolBlock(
      {
        type: 'tool',
        toolName: 'UseTool',
        status: 'running',
        input: { tool_name: 'uxnan__view_show', tool_input: { title: 't', html: '<p>big</p>' } },
      },
      store,
    ) as Record<string, any>;
    assert.equal(wrapped.input.tool_input.html, undefined);
    assert.equal(wrapped.input.tool_input.htmlBytes, Buffer.byteLength('<p>big</p>'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge MCP server authenticates, initializes, lists and creates a view', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-view-mcp-'));
  const store = new ViewStore({ directory: root, bootstrap: VIEW_BOOTSTRAP });
  const server = await startViewMcpServer({ store });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const unauth = await fetch(server.url, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    assert.equal(unauth.status, 401);
    const send = async (id: number, method: string, params?: unknown) =>
      fetch(server.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          ...(params === undefined ? {} : { params }),
        }),
      });
    const init = (await (
      await send(1, 'initialize', { protocolVersion: '2025-06-18' })
    ).json()) as any;
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /view_show/);
    const list = (await (await send(2, 'tools/list')).json()) as any;
    assert.equal(list.result.tools[0].name, 'view_show');
    const called = (await (
      await send(3, 'tools/call', {
        name: 'view_show',
        arguments: { title: 'Probe', html: '<p>hi</p>' },
      })
    ).json()) as any;
    assert.match(called.result.content[0].text, /uxnan-view:[0-9a-f]{32}/);
    const bad = (await (
      await send(4, 'tools/call', {
        name: 'view_show',
        arguments: { title: 'Probe', html: '<p>x</p>', path: 'x.html' },
      })
    ).json()) as any;
    assert.equal(bad.result.isError, true);
    assert.equal(
      (
        await fetch(server.url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${server.token}` },
        })
      ).status,
      405,
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('view/read returns the prepared page and reports an unknown id as not found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-view-read-'));
  const store = new ViewStore({ directory: root, bootstrap: 'window.boot=true' });
  const { viewId } = await store.create({ title: 'Read me', html: '<p>hello</p>' });
  const router = new HandlerRouter({ viewStore: store } as never);
  registerViewHandlers(router);
  try {
    const found = await router.dispatch(makeRequest('1', 'view/read', { viewId }));
    assert.ok(
      'result' in found && (found.result as { html: string }).html.includes('window.boot=true'),
    );
    const missing = await router.dispatch(
      makeRequest('2', 'view/read', { viewId: 'f'.repeat(32) }),
    );
    assert.ok('error' in missing && missing.error.code === JsonRpcErrorCode.ResourceNotFound);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ViewStore prunes oldest views after the 500 view cap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-view-prune-'));
  const store = new ViewStore({ directory: root, bootstrap: '' });
  await mkdir(root, { recursive: true });
  try {
    for (let i = 0; i < 501; i++) {
      const id = i.toString(16).padStart(32, '0');
      await writeFile(join(root, `${id}.html`), '<p>x</p>');
      await writeFile(
        join(root, `${id}.json`),
        JSON.stringify({ title: 'x', bytes: 8, createdAt: i }),
      );
    }
    await store.prune();
    await assert.rejects(access(join(root, `${'0'.repeat(32)}.html`)));
    await access(join(root, `${(500).toString(16).padStart(32, '0')}.html`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every prepared page carries the base stylesheet, before the bootstrap and the agent', () => {
  const html = prepareViewHtml('<style>body{padding:0}</style><p>x</p>', 'window.boot=true');
  const base = html.indexOf('<style id="uxnan-base">');
  assert.ok(base > html.indexOf('viewport') && base < html.indexOf('<script>window.boot'));
  assert.ok(html.indexOf('<style>body{padding:0}</style>') > html.indexOf('</script>'));
  // Every variable a page may use has a light and a dark value.
  for (const name of [...VIEW_THEME_VARIABLES, ...VIEW_PAGE_VARIABLES]) {
    assert.ok(VIEW_BASE_VARIABLES.includes(name), `${name} has a default`);
  }
  for (const name of ['--color-chart-1', '--color-text-success', '--color-background-primary']) {
    assert.equal(VIEW_BASE_CSS.split(`${name}:`).length - 1, 3, `${name}: light, dark and OS-dark`);
  }
  // Specificity zero: everything is inside :where(), so the agent's own rules win.
  for (const rule of VIEW_BASE_CSS.split('\n')) {
    const selector = rule.replace(/^@media[^{]*\{/, '');
    assert.ok(selector.startsWith(':where('), rule.slice(0, 60));
  }
});

test('the bootstrap marks the theme on :root and announces it with uxnan-theme', () => {
  assert.ok(VIEW_BOOTSTRAP.includes("root.setAttribute('data-uxnan-theme', c.theme)"));
  assert.ok(VIEW_BOOTSTRAP.includes(`new CustomEvent('${VIEW_THEME_EVENT}'`));
  assert.ok(VIEW_BASE_CSS.includes(':where(:root[data-uxnan-theme=dark])'));
});

test('view_show draws blocks, sizes them, and returns a block error the agent can fix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uxnan-view-blocks-'));
  const store = new ViewStore({ directory: root, bootstrap: VIEW_BOOTSTRAP });
  try {
    const blocks = [
      { type: 'stats', items: [{ label: 'Total', value: '18,000' }] },
      {
        type: 'breakdown',
        unit: 'MXN',
        items: [
          { label: 'Renta', value: 8500 },
          { label: 'Comida', value: 4200 },
        ],
      },
    ];
    const { viewId, meta } = await store.create({ title: 'Gasto', blocks });
    assert.ok(meta.height !== undefined && meta.height >= 80);
    const page = await readFile(join(root, `${viewId}.html`), 'utf8');
    assert.ok(page.includes('ux-breakdown') && page.includes('<style id="uxnan-base">'));
    // A CLI that sends the array as text gets the same page.
    const again = await store.prepare({ blocks: JSON.stringify(blocks) });
    assert.ok(again.html.includes('ux-breakdown'));
    await assert.rejects(
      store.create({ title: 'x', blocks: [{ type: 'pie', items: [] }] }),
      /Invalid blocks: blocks\[0\]\.type/,
    );
    await assert.rejects(
      store.prepare({ blocks, html: '<p>x</p>' }),
      /exactly one of blocks, html or path/,
    );
    await assert.rejects(store.prepare({ blocks: 'not json' }), /array of block objects/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('view tool conversion keeps blocks off the stream', () => {
  const converted = convertViewToolBlock({
    type: 'tool',
    toolName: 'mcp__uxnan__view_show',
    input: {
      title: 't',
      blocks: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    },
    status: 'running',
  }) as { input: Record<string, unknown> };
  assert.equal(converted.input['blocks'], undefined);
  assert.equal(converted.input['blockCount'], 2);
});
