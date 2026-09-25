import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acpDesktopMcpServers, acpSupportsHttpMcp } from '../../src/adapters/acp-mcp.js';
import { codexDesktopConfig } from '../../src/adapters/codex-adapter.js';
import { openCodeDesktopEnv } from '../../src/adapters/opencode-adapter.js';

// How each agent is handed Uxnan Desktop's MCP server (architecture/02a
// §5.8.15): same server name, same bearer token, and the conversation's folder
// percent-encoded in `x-uxnan-cwd` so the desktop scopes the caller to it.
const desktop = { mcpUrl: 'http://127.0.0.1:51234/mcp', token: 't'.repeat(43) };
const cwd = '/work/my repo';
const encoded = encodeURIComponent(cwd);

test('ACP agents get the server only when they advertise HTTP MCP support', () => {
  assert.equal(
    acpSupportsHttpMcp({ agentCapabilities: { mcpCapabilities: { http: true } } }),
    true,
  );
  assert.equal(
    acpSupportsHttpMcp({ agentCapabilities: { mcpCapabilities: { sse: true } } }),
    false,
  );
  assert.equal(acpSupportsHttpMcp({ protocolVersion: 1 }), false);
  assert.equal(acpSupportsHttpMcp(null), false);

  assert.deepEqual(acpDesktopMcpServers(desktop, cwd, false), []);
  assert.deepEqual(acpDesktopMcpServers(undefined, cwd, true), []);
  assert.deepEqual(acpDesktopMcpServers(desktop, cwd, true), [
    {
      type: 'http',
      name: 'uxnan-browser',
      url: desktop.mcpUrl,
      headers: [
        { name: 'Authorization', value: `Bearer ${desktop.token}` },
        { name: 'x-uxnan-cwd', value: encoded },
      ],
    },
  ]);
});

test('Codex gets a per-thread config override, and nothing without desktop tools', () => {
  assert.deepEqual(codexDesktopConfig(undefined, cwd), {});
  assert.deepEqual(codexDesktopConfig(desktop, cwd), {
    config: {
      'mcp_servers.uxnan-browser': {
        url: desktop.mcpUrl,
        http_headers: { Authorization: `Bearer ${desktop.token}`, 'x-uxnan-cwd': encoded },
      },
    },
  });
});

test('OpenCode gets the server in its config env, the token only by reference', () => {
  assert.deepEqual(openCodeDesktopEnv(undefined, cwd), {});
  const env = openCodeDesktopEnv(desktop, cwd);
  assert.equal(env['UXNAN_MCP_TOKEN'], desktop.token);
  const content = env['OPENCODE_CONFIG_CONTENT'];
  assert.ok(content);
  assert.ok(!content.includes(desktop.token), 'the token is never inlined in the config');
  assert.deepEqual(JSON.parse(content), {
    mcp: {
      'uxnan-browser': {
        type: 'remote',
        url: desktop.mcpUrl,
        headers: { Authorization: 'Bearer {env:UXNAN_MCP_TOKEN}', 'x-uxnan-cwd': encoded },
      },
    },
  });
});
