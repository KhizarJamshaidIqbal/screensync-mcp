// web_aria_snapshot stopped at maxNodes (at most 700) on a long page with no way to read the rest. It now takes an
// `offset` and, when a page is cut short, returns truncated:true + nextOffset. The default call is unchanged:
// same YAML, same nodeCount, same [index=N] refs, and no new keys unless the snapshot was cut short.
import assert from 'node:assert/strict';
import { El, installLayout } from './layout-mock.js';

const { body } = installLayout({ title: 'Index insights' });
body.append(new El('h1', {}, 'Index insights'));
const nav = new El('nav');
for (let i = 0; i < 4; i++) nav.append(new El('a', { href: `/p${i}` }, `Section ${i}`));
body.append(nav);
const main = new El('main', { class: 'cbm-admin-main' });
for (let i = 0; i < 30; i++) {
  const row = new El('div', {}, `Row ${i}`); // a generic with its own text: one "- text" line
  row.append(new El('button', {}, `Resubmit ${i}`));
  main.append(row);
}
body.append(main);

const { ssWebUnitPerception } = await import('../lib/web-unit-perception.js');
const snap = (args = {}) => ssWebUnitPerception({ __tool: 'web_aria_snapshot', ...args });

const full = await snap({ maxNodes: 700 });
const all = full.data.yaml.split('\n');
assert.equal(full.data.nodeCount, all.length);
assert.equal(all.length, 1 + 1 + 4 + 1 + 30 * 2, 'h1, nav + 4 links, main, 30 x (text + button)');
assert.deepEqual(Object.keys(full.data).sort(), ['nodeCount', 'title', 'url', 'yaml'], 'an uncut snapshot has exactly the old keys');

// Default call on a long page: the first maxNodes lines, as before, now saying where to continue.
const first = await snap({ maxNodes: 25 });
assert.equal(first.data.yaml, all.slice(0, 25).join('\n'), 'the default page is the first maxNodes lines');
assert.equal(first.data.nodeCount, 25);
assert.equal(first.data.truncated, true);
assert.equal(first.data.nextOffset, 25);
assert.equal(first.data.offset, undefined);

// Walk the pages: together they are exactly the full snapshot, refs included.
const pages = [first.data];
while (pages[pages.length - 1].nextOffset !== undefined) {
  const res = await snap({ maxNodes: 25, offset: pages[pages.length - 1].nextOffset });
  assert.equal(res.ok, true);
  pages.push(res.data);
}
assert.equal(pages.length, 3);
assert.equal(pages[1].offset, 25);
assert.equal(pages[2].truncated, undefined, 'the last page is not truncated');
assert.equal(pages[2].nextOffset, undefined);
assert.deepEqual(pages.flatMap((p) => p.yaml.split('\n')), all, 'pages concatenate to the full snapshot');
assert.match(pages[1].yaml, /button "Resubmit 1\d" \[index=1\d\]/, 'refs keep their whole-page numbering on later pages');

// A page that ends exactly at the last node is not "truncated".
const exact = await snap({ maxNodes: 17, offset: all.length - 17 });
assert.equal(exact.data.nodeCount, 17);
assert.equal(exact.data.truncated, undefined);
// Past the end: empty, nothing to continue.
const past = await snap({ offset: all.length + 5 });
assert.equal(past.data.nodeCount, 0);
assert.equal(past.data.yaml, '');
assert.equal(past.data.nextOffset, undefined);

console.log('[test] web_aria_snapshot_paging.test.js: ALL ASSERTIONS PASSED');
