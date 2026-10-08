import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acpMcpServers, acpSupportsHttpMcp } from '../../src/adapters/acp-mcp.js';
import { codexDeveloperInstructions, codexMcpConfig } from '../../src/adapters/codex-adapter.js';
import { openCodeMcpEnv } from '../../src/adapters/opencode-adapter.js';

// How each agent is handed Uxnan Desktop's MCP server (architecture/02a
// §5.8.15): same server name, same bearer token, and the conversation's folder
// percent-encoded in `x-uxnan-cwd` so the desktop scopes the caller to it.
const desktop = { name: 'uxnan-browser', url: 'http://127.0.0.1:51234/mcp', token: 't'.repeat(43) };
const bridge = { name: 'uxnan', url: 'http://127.0.0.1:51235/mcp', token: 'b'.repeat(43) };
const servers = [bridge, desktop];
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

  assert.deepEqual(acpMcpServers(servers, cwd, false), []);
  assert.deepEqual(acpMcpServers([], cwd, true), []);
  assert.deepEqual(acpMcpServers(servers, cwd, true), [
    {
      type: 'http',
      name: bridge.name,
      url: bridge.url,
      headers: [
        { name: 'Authorization', value: `Bearer ${bridge.token}` },
        { name: 'x-uxnan-cwd', value: encoded },
      ],
    },
    {
      type: 'http',
      name: 'uxnan-browser',
      url: desktop.url,
      headers: [
        { name: 'Authorization', value: `Bearer ${desktop.token}` },
        { name: 'x-uxnan-cwd', value: encoded },
      ],
    },
  ]);
});

test('Codex gets a per-thread config override, and nothing without desktop tools', () => {
  assert.deepEqual(codexMcpConfig([], cwd), {});
  assert.deepEqual(codexMcpConfig(servers, cwd), {
    config: {
      'mcp_servers.uxnan': {
        url: bridge.url,
        http_headers: { Authorization: `Bearer ${bridge.token}`, 'x-uxnan-cwd': encoded },
      },
      'mcp_servers.uxnan-browser': {
        url: desktop.url,
        http_headers: { Authorization: `Bearer ${desktop.token}`, 'x-uxnan-cwd': encoded },
      },
    },
  });
});

test('OpenCode gets the server in its config env, the token only by reference', () => {
  assert.deepEqual(openCodeMcpEnv([], cwd), {});
  const env = openCodeMcpEnv(servers, cwd);
  assert.equal(env['UXNAN_MCP_TOKEN_0'], bridge.token);
  assert.equal(env['UXNAN_MCP_TOKEN_1'], desktop.token);
  const content = env['OPENCODE_CONFIG_CONTENT'];
  assert.ok(content);
  assert.ok(!content.includes(desktop.token), 'the token is never inlined in the config');
  assert.deepEqual(JSON.parse(content), {
    mcp: {
      uxnan: {
        type: 'remote',
        url: bridge.url,
        headers: { Authorization: 'Bearer {env:UXNAN_MCP_TOKEN_0}', 'x-uxnan-cwd': encoded },
      },
      'uxnan-browser': {
        type: 'remote',
        url: desktop.url,
        headers: { Authorization: 'Bearer {env:UXNAN_MCP_TOKEN_1}', 'x-uxnan-cwd': encoded },
      },
    },
  });
});

test("Codex gets the run's server instructions as the thread's developer instructions", () => {
  assert.deepEqual(codexDeveloperInstructions(undefined), {});
  assert.deepEqual(
    codexDeveloperInstructions([
      { name: 'uxnan-browser', url: 'http://127.0.0.1:1/mcp', token: 't' },
    ]),
    {},
  );
  assert.deepEqual(
    codexDeveloperInstructions([
      { name: 'uxnan', url: 'http://127.0.0.1:1/mcp', token: 't', instructions: ' Show views. ' },
      { name: 'other', url: 'http://127.0.0.1:2/mcp', token: 'u', instructions: 'Be brief.' },
    ]),
    { developerInstructions: 'Show views.\n\nBe brief.' },
  );
});
