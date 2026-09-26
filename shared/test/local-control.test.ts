import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCwdHeader,
  isDesktopClientId,
  isDesktopToken,
  isLoopbackMcpUrl,
} from '../src/index.js';

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

test('a folder travels in the cwd header percent-encoded, so any path is a valid header', () => {
  assert.equal(encodeCwdHeader('/work/repo'), '%2Fwork%2Frepo');
  assert.equal(
    encodeCwdHeader('/Users/ana/Proyectos/año 1'),
    '%2FUsers%2Fana%2FProyectos%2Fa%C3%B1o%201',
  );
  assert.equal(decodeURIComponent(encodeCwdHeader('C:\\src\\ñ')), 'C:\\src\\ñ');
});

test('every desktop profile is a desktop client under its own name', () => {
  assert.equal(isDesktopClientId('desktop'), true);
  assert.equal(isDesktopClientId('desktop-3f9a1c2b7d4e'), true);
  assert.equal(isDesktopClientId('cli'), false);
  assert.equal(isDesktopClientId('desktopx'), false);
  assert.equal(isDesktopClientId('desktop-Dev'), false);
  assert.equal(isDesktopClientId(`desktop-${'a'.repeat(40)}`), false);
});
