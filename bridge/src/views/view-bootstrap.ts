/**
 * Dependency-free protocol client injected into every stored view (the page
 * side of `shared/src/views/view-protocol.ts`).
 *
 * - Transport: the phone's `UxnanView` channel when present, else the parent
 *   frame; the host talks back through `window.__uxnanHost` (phone) or a
 *   `message` event whose source must be the parent (desktop).
 * - Size: the document's own box, not `scrollHeight` — that never drops below
 *   the frame it is shown in, so a page could grow but never shrink.
 * - Links never navigate the page: they become `ui/open-link` requests.
 * - Annotating: while picking, an outline follows the pointer; a click picks
 *   the element and HOLDS it — the outline stays on it and stops following —
 *   until the host answers with `uxnan/annotations` (the note was saved or
 *   dropped). Every note the host lists gets a numbered marker on its element;
 *   clicking one sends `uxnan/mark` so the host can edit or delete that note.
 */
export const VIEW_BOOTSTRAP = String.raw`(() => {
'use strict';
const channel = window.UxnanView;
let seq = 0;
const pending = new Map();
let picking = false;
let held = null;
let hoverBox = null;
let layer = null;
let marks = [];
const ACCENT = 'var(--color-ring-primary, #7c5cff)';

const send = (method, params, id) => {
  const m = { jsonrpc: '2.0', method };
  if (params !== undefined) m.params = params;
  if (id !== undefined) m.id = id;
  if (channel && typeof channel.postMessage === 'function') channel.postMessage(JSON.stringify(m));
  else if (window.parent !== window) window.parent.postMessage(m, '*');
};
const request = (method, params) => new Promise((resolve, reject) => {
  const id = 'v' + (++seq);
  pending.set(id, { resolve, reject });
  send(method, params, id);
  setTimeout(() => {
    const p = pending.get(id);
    if (p) { pending.delete(id); reject(Error('Host request timed out')); }
  }, 30000);
});

function receive(m) {
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return; } }
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.id !== undefined && pending.has(String(m.id))) {
    const p = pending.get(String(m.id));
    pending.delete(String(m.id));
    if (m.error) p.reject(Error(String(m.error.message || 'Host error'))); else p.resolve(m.result);
    return;
  }
  const params = m.params || {};
  if (m.method === 'ui/notifications/host-context-changed') applyContext(params);
  else if (m.method === 'uxnan/annotate') setPicking(!!params.on);
  else if (m.method === 'uxnan/annotations') setMarks(Array.isArray(params.marks) ? params.marks : []);
}
window.__uxnanHost = receive;
window.addEventListener('message', (e) => { if (e.source === window.parent) receive(e.data); });

function applyContext(c) {
  if (!c || typeof c !== 'object') return;
  const root = document.documentElement;
  if (c.theme === 'dark' || c.theme === 'light') root.style.colorScheme = c.theme;
  const vars = c.styles && c.styles.variables;
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && v.length < 256) root.style.setProperty(k, v);
    }
  }
}

window.uxnan = {
  sendMessage(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
      return Promise.reject(Error('Message must be 1-20000 characters'));
    }
    return request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
  },
};

function link(url) {
  try {
    const u = new URL(url, location.href);
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return;
    request('ui/open-link', { url: u.href }).catch(() => {});
  } catch {}
}
window.open = (url) => { if (typeof url === 'string') link(url); return null; };

// --- annotating -------------------------------------------------------------
const isOurs = (el) => !!(el && el.closest && el.closest('[data-uxnan-mark]'));

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.setAttribute('data-uxnan-mark', '');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  document.documentElement.appendChild(layer);
  return layer;
}
function boxAt(el, box, solid) {
  const r = el.getBoundingClientRect();
  box.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none;border-radius:4px;' +
    'border:2px ' + (solid ? 'solid' : 'dashed') + ' ' + ACCENT + ';' +
    'background:color-mix(in srgb, ' + ACCENT + ' 12%, transparent);' +
    'left:' + (r.left + scrollX) + 'px;top:' + (r.top + scrollY) + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
}
function find(selector) { try { return document.querySelector(selector); } catch { return null; } }

function setPicking(on) {
  picking = on;
  document.documentElement.style.cursor = on ? 'crosshair' : '';
  if (!on && hoverBox) { hoverBox.remove(); hoverBox = null; }
}
function hover(e) {
  if (!picking || held) return;
  const el = e.target;
  if (!el || isOurs(el) || !el.getBoundingClientRect) return;
  if (!hoverBox) { hoverBox = document.createElement('div'); ensureLayer().appendChild(hoverBox); }
  boxAt(el, hoverBox, false);
}
document.addEventListener('pointermove', hover, true);

function selector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = [];
  while (el && el.nodeType === 1 && el !== document.documentElement) {
    let n = 1;
    for (let p = el.previousElementSibling; p; p = p.previousElementSibling) if (p.tagName === el.tagName) n++;
    parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + n + ')');
    el = el.parentElement;
  }
  return 'html>' + parts.join('>');
}
function pick(el) {
  if (!el || isOurs(el) || !el.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  held = el;
  if (!hoverBox) { hoverBox = document.createElement('div'); ensureLayer().appendChild(hoverBox); }
  boxAt(el, hoverBox, true);
  send('uxnan/annotation', {
    selector: selector(el).slice(0, 300),
    tag: String(el.tagName || 'div').toLowerCase().slice(0, 41),
    text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 500),
    html: el.outerHTML.slice(0, 1000),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
  });
}

function setMarks(list) {
  held = null;
  if (hoverBox) { hoverBox.remove(); hoverBox = null; }
  marks = list.slice(0, 50).filter((m) => m && typeof m.selector === 'string' && typeof m.label === 'string');
  drawMarks();
}
function drawMarks() {
  const root = ensureLayer();
  for (const old of root.querySelectorAll('[data-uxnan-badge],[data-uxnan-box]')) old.remove();
  marks.forEach((m, index) => {
    const el = find(m.selector);
    if (!el) return;
    const box = document.createElement('div');
    box.setAttribute('data-uxnan-box', '');
    boxAt(el, box, true);
    const r = el.getBoundingClientRect();
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.setAttribute('data-uxnan-badge', String(index));
    badge.textContent = m.label.slice(0, 3);
    badge.style.cssText = 'position:absolute;pointer-events:auto;cursor:pointer;min-width:20px;height:20px;padding:0 5px;' +
      'border-radius:10px;border:0;font:600 11px/20px var(--font-sans, system-ui);color:#fff;background:' + ACCENT + ';' +
      'box-shadow:0 1px 3px rgba(0,0,0,.3);transform:translate(-50%,-50%);' +
      'left:' + (r.left + scrollX) + 'px;top:' + (r.top + scrollY) + 'px';
    root.appendChild(box);
    root.appendChild(badge);
  });
}
addEventListener('resize', () => { drawMarks(); if (held && hoverBox) boxAt(held, hoverBox, true); });

document.addEventListener('click', (e) => {
  const badge = e.target && e.target.closest && e.target.closest('[data-uxnan-badge]');
  if (badge) {
    e.preventDefault();
    e.stopImmediatePropagation();
    send('uxnan/mark', { index: Number(badge.getAttribute('data-uxnan-badge')) });
    return;
  }
  if (picking) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!held) pick(e.target);
    return;
  }
  const a = e.target && e.target.closest && e.target.closest('a[href]');
  if (a) { e.preventDefault(); link(a.href); }
}, true);

// --- size and start ---------------------------------------------------------
let resizeQueued = false;
const measure = () => {
  resizeQueued = false;
  const h = Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height, document.body ? document.body.scrollHeight : 0));
  send('ui/notifications/size-changed', { width: document.documentElement.clientWidth, height: h });
  drawMarks();
};
if (window.ResizeObserver) {
  new ResizeObserver(() => {
    if (!resizeQueued) { resizeQueued = true; requestAnimationFrame(measure); }
  }).observe(document.documentElement);
}
addEventListener('load', async () => {
  try {
    const r = await request('ui/initialize', {});
    applyContext(r && r.hostContext);
    send('ui/notifications/initialized');
    measure();
  } catch {}
}, { once: true });
})();`;
