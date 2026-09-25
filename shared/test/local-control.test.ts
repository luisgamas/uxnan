import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDesktopToken, isLoopbackMcpUrl } from '../src/index.js';

test('desktop tools are only accepted at a loopback MCP endpoint', () => {
  assert.equal(isLoopbackMcpUrl('http://127.0.0.1:51234/mcp'), true);
  assert.equal(isLoopbackMcpUrl('http://localhost:8/mcp'), true);
  assert.equal(isLoopbackMcpUrl('http://[::1]:9000/mcp'), true);
  assert.equal(isLoopbackMcpUrl('https://127.0.0.1:51234/mcp'), false);
  assert.equal(isLoopbackMcpUrl('http://10.0.0.5:51234/mcp'), false);
  assert.equal(isLoopbackMcpUrl('http://127.0.0.1.evil.com:80/mcp'), false);
  assert.equal(isLoopbackMcpUrl('http://127.0.0.1:51234/mcp/../x'), false);
});

test('a desktop token is a base64url-ish string of a sane length', () => {
  assert.equal(isDesktopToken('a'.repeat(32)), true);
  assert.equal(isDesktopToken('abc_DEF-123456789'), true);
  assert.equal(isDesktopToken('short'), false);
  assert.equal(isDesktopToken('has space in it....'), false);
  assert.equal(isDesktopToken('x'.repeat(600)), false);
});
