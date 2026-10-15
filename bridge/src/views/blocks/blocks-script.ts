/**
 * The dependency-free behaviour of a block view, injected once per page. It
 * only adds what a static page cannot: hover and touch readouts on charts,
 * `choices` buttons that propose a message, and the locale re-format when the
 * host reports one. Every lookup tolerates a missing element, so a page with
 * no charts runs it without errors.
 *
 * Numbers are re-formatted from `data-num` (raw value), `data-digits` (decimals,
 * default 2) and the optional `data-prefix` / `data-suffix` kept around them.
 * Tooltips read `data-tip-*` attributes at hover time, so they follow the
 * locale too. Written with string concatenation only: it sits inside a
 * `String.raw` template in the bridge.
 */
export const VIEW_BLOCKS_SCRIPT = String.raw`(function () {
'use strict';

var locale = '';

function formatter(digits, lang) {
  try {
    return new Intl.NumberFormat(lang || 'en-US', { maximumFractionDigits: digits });
  } catch (error) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits });
  }
}

function fmt(value, digits) {
  var text = formatter(digits, locale).format(value);
  return text === '-0' ? '0' : text;
}

function digitsOf(text, fallback) {
  var digits = parseInt(text, 10);
  return digits >= 0 && digits <= 20 ? digits : fallback;
}

function element(tag, className, text) {
  var node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function reformat() {
  var nodes = document.querySelectorAll('[data-num]');
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var value = Number(node.getAttribute('data-num'));
    if (!isFinite(value)) continue;
    node.textContent =
      (node.getAttribute('data-prefix') || '') +
      fmt(value, digitsOf(node.getAttribute('data-digits'), 2)) +
      (node.getAttribute('data-suffix') || '');
  }
}

window.addEventListener('uxnan-theme', function (event) {
  var detail = event && event.detail;
  if (!detail || typeof detail.locale !== 'string' || detail.locale === '') return;
  locale = detail.locale;
  reformat();
});

// --- one tooltip for every chart --------------------------------------------

var tip = element('div', 'ux-tip');
tip.hidden = true;
document.body.appendChild(tip);

function showTip(nodes, x, y, above, midX) {
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  for (var i = 0; i < nodes.length; i++) tip.appendChild(nodes[i]);
  tip.hidden = false;
  var width = tip.offsetWidth;
  var height = tip.offsetHeight;
  var viewport = window.innerWidth || document.documentElement.clientWidth || 0;
  var middle = midX === undefined ? viewport / 2 : midX;
  var left = x > middle ? x - width - 12 : x + 12;
  if (left + width > viewport - 4) left = viewport - width - 4;
  if (left < 4) left = 4;
  var top = above ? y - height - 12 : y;
  if (above && top < 4) top = y + 16;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function hideTip() {
  tip.hidden = true;
}

// --- line charts -------------------------------------------------------------

function hasValue(value) {
  return typeof value === 'number' && isFinite(value);
}

function setupLine(plot) {
  var data;
  try {
    data = JSON.parse(plot.getAttribute('data-series') || 'null');
  } catch (error) {
    return;
  }
  if (!data || !Array.isArray(data.labels) || !Array.isArray(data.series)) return;
  var count = data.labels.length;
  if (count < 1) return;
  var span = data.hi - data.lo || 1;
  var layer = element('div', 'ux-hover');
  plot.appendChild(layer);

  function clear() {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  function readout(event) {
    var rect = plot.getBoundingClientRect();
    if (!rect.width) return;
    var x = event.clientX - rect.left;
    var index = count > 1 ? Math.round((x / rect.width) * (count - 1)) : 0;
    if (index < 0) index = 0;
    if (index > count - 1) index = count - 1;
    var px = count > 1 ? (index / (count - 1)) * rect.width : 0;

    clear();
    var cross = element('div', 'ux-cross');
    cross.style.left = px + 'px';
    layer.appendChild(cross);

    var nodes = [element('div', 'ux-tip-title', String(data.labels[index]))];
    for (var s = 0; s < data.series.length; s++) {
      var series = data.series[s];
      var value = series.values ? series.values[index] : null;
      var found = hasValue(value);
      if (found) {
        var dot = element('span', 'ux-hdot');
        dot.style.left = px + 'px';
        dot.style.top = (1 - (value - data.lo) / span) * 200 + 'px';
        dot.style.background = series.color;
        layer.appendChild(dot);
      }
      var row = element('div', 'ux-tip-row');
      var swatch = element('span', 'ux-tip-swatch');
      swatch.style.background = series.color;
      row.appendChild(swatch);
      row.appendChild(element('span', 'ux-tip-name', String(series.name)));
      row.appendChild(
        element('span', 'ux-tip-value', found ? fmt(value, 2) + (data.suffix || '') : '—'),
      );
      nodes.push(row);
    }
    showTip(nodes, rect.left + px, rect.top + 8, false, rect.left + rect.width / 2);
  }

  plot.addEventListener('pointermove', readout);
  plot.addEventListener('pointerdown', readout);
  plot.addEventListener('pointerleave', function () {
    clear();
    hideTip();
  });
  plot.addEventListener('pointercancel', function () {
    clear();
    hideTip();
  });
}

// --- bars and breakdown segments --------------------------------------------

function tipTarget(event) {
  var target = event.target;
  return target && target.closest ? target.closest('[data-tip-label]') : null;
}

function barNodes(node) {
  var digits = digitsOf(node.getAttribute('data-tip-digits'), 2);
  var suffix = node.getAttribute('data-tip-suffix') || '';
  var value = Number(node.getAttribute('data-tip-value'));
  var nodes = [element('div', 'ux-tip-title', node.getAttribute('data-tip-label') || '')];
  var from = node.getAttribute('data-tip-from');
  if (from !== null && isFinite(Number(from))) {
    var fromLabel = node.getAttribute('data-tip-from-label');
    var toLabel = node.getAttribute('data-tip-to-label');
    if (fromLabel || toLabel) {
      nodes.push(element('div', 'ux-tip-row', (fromLabel ? fromLabel + ': ' : '') + fmt(Number(from), digits) + suffix));
      nodes.push(element('div', 'ux-tip-row', (toLabel ? toLabel + ': ' : '') + fmt(value, digits) + suffix));
    } else {
      nodes.push(element('div', 'ux-tip-row', fmt(Number(from), digits) + suffix + ' \u2192 ' + fmt(value, digits) + suffix));
    }
  } else {
    nodes.push(element('div', 'ux-tip-row', fmt(value, digits) + suffix));
  }
  var change = node.getAttribute('data-tip-change');
  if (change !== null && isFinite(Number(change))) {
    var changed = Number(change);
    nodes.push(
      element('div', 'ux-tip-row', (changed > 0 ? '+' : '') + fmt(changed, 1) + '%'),
    );
  }
  var share = node.getAttribute('data-tip-share');
  if (share !== null && isFinite(Number(share))) {
    nodes.push(element('div', 'ux-tip-row', fmt(Number(share), 0) + '%'));
  }
  return nodes;
}

document.addEventListener('pointerover', function (event) {
  var target = tipTarget(event);
  if (!target) return;
  showTip(barNodes(target), event.clientX, event.clientY, true);
});
document.addEventListener('pointermove', function (event) {
  var target = tipTarget(event);
  if (!target) return;
  showTip(barNodes(target), event.clientX, event.clientY, true);
});
document.addEventListener('pointerout', function (event) {
  var next = event.relatedTarget;
  if (next && next.closest && next.closest('[data-tip-label]')) return;
  hideTip();
});

// --- choices -----------------------------------------------------------------

document.addEventListener('click', function (event) {
  var target = event.target;
  var button = target && target.closest ? target.closest('.ux-choice') : null;
  if (!button) return;
  var message = button.getAttribute('data-message');
  if (!message || !window.uxnan || typeof window.uxnan.sendMessage !== 'function') return;
  try {
    Promise.resolve(window.uxnan.sendMessage(message)).catch(function () {});
  } catch (error) {
    return;
  }
});

// --- start -------------------------------------------------------------------

var plots = document.querySelectorAll('.ux-plot[data-series]');
for (var p = 0; p < plots.length; p++) setupLine(plots[p]);
})();`;
