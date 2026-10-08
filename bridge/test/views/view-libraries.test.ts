import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_LIBRARIES,
  describeViewLibraries,
  inlineViewLibraries,
} from '../../src/views/view-libraries.js';

test('a bundled library is put in the page in place of its uxnan: tag', () => {
  const page = `<canvas id="c"></canvas><SCRIPT src='uxnan:Chart.js' defer></SCRIPT><script>new Chart(c, {})</script>`;
  const { html, used } = inlineViewLibraries(page);
  assert.deepEqual(used, ['chart.js']);
  assert.ok(!/uxnan:/i.test(html), 'no tag left');
  assert.ok(html.length > 100_000, 'the code is in the page');
  assert.ok(
    !/<\/script/i.test(
      html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script><script>new Chart')),
    ),
  );
  assert.ok(html.endsWith('<script>new Chart(c, {})</script>'));
});

test('a page without library tags is left as it is', () => {
  const page = '<p>hi</p><script>1</script>';
  assert.deepEqual(inlineViewLibraries(page), { html: page, used: [] });
});

test('an unknown library is refused, naming the ones there are', () => {
  assert.throws(
    () => inlineViewLibraries('<script src="uxnan:d3"></script>'),
    /Available: uxnan:chart\.js/,
  );
});

test('the tool description lists every library with its global', () => {
  const text = describeViewLibraries();
  for (const library of VIEW_LIBRARIES) {
    assert.ok(text.includes(`uxnan:${library.name}`));
    assert.ok(text.includes(library.global));
  }
});
