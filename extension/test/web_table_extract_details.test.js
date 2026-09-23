// web_table_extract returned every cell empty for a table inside a closed <details>: innerText is '' for
// anything that is not rendered. Cells now fall back to textContent (whitespace-normalised), each table says
// which columns a person can see (columnVisible), and openDetails:true (default false) opens the closed
// <details> around the table for the read and closes them again.
import assert from 'node:assert/strict';
import { El, installLayout, table } from './layout-mock.js';

const { body } = installLayout();

// A visible pricing table, and the same kind of table folded away in two nested closed <details>.
const shown = table(['Plan', 'Price'], [['Basic', '$10'], ['Pro', '$25']]);
body.append(shown);
const outer = new El('details').append(new El('summary', {}, 'Coverage'));
const inner = new El('details').append(new El('summary', {}, 'Not indexed'));
const folded = table(['URL', 'Status', 'Internal note'], [['/tours/  night-trip', 'Crawled -   not indexed', 'n1'], ['/blog/a', 'Discovered', 'n2']]);
// The third column is display:none even when open (a responsive "hide on small screens" column).
for (const cell of folded.querySelectorAll('th, td')) if (cell.parentElement.children.indexOf(cell) === 2) cell.style.display = 'none';
inner.append(folded);
outer.append(inner);
body.append(outer);

const { ssWebUnitTable } = await import('../lib/web-unit-table.js');
const { ssWebUnitAgent } = await import('../lib/web-unit-agent.js');
const extract = (args) => ssWebUnitTable({ __tool: 'web_table_extract', ...args });

// 1. Default: the folded table's cells are read (textContent, whitespace-normalised), nothing is opened, and
//    columnVisible says no column is on screen.
{
  const res = await extract({ index: 1 });
  assert.equal(res.ok, true, JSON.stringify(res));
  const t = res.data.tables[0];
  assert.deepEqual(t.headers, ['URL', 'Status', 'Internal note']);
  assert.deepEqual(t.rows, [['/tours/ night-trip', 'Crawled - not indexed', 'n1'], ['/blog/a', 'Discovered', 'n2']]);
  assert.deepEqual(t.columnVisible, [false, false, false]);
  assert.equal(res.data.openedDetails, undefined);
  assert.equal(outer.open, false);
  assert.equal(inner.open, false);
  assert.match(t.csv, /"Crawled - not indexed"/);
  console.log('[test] web_table_extract_details: closed <details> -> cells read from textContent - PASSED');
}

// 2. openDetails:true opens both levels for the read, reports real column visibility, and restores the page.
{
  const res = await extract({ index: 1, openDetails: true });
  const t = res.data.tables[0];
  assert.deepEqual(t.rows[0], ['/tours/ night-trip', 'Crawled - not indexed', 'n1']);
  assert.deepEqual(t.columnVisible, [true, true, false], 'the display:none column is flagged');
  assert.equal(res.data.openedDetails, 2);
  assert.equal(outer.open, false, 'outer <details> closed again');
  assert.equal(inner.open, false, 'inner <details> closed again');
  console.log('[test] web_table_extract_details: openDetails -> read open, flags per column, page restored - PASSED');
}

// 3. A <details> the person already opened stays open.
{
  outer.open = true; inner.open = true;
  const res = await extract({ index: 1, openDetails: true });
  assert.equal(res.data.openedDetails, undefined);
  assert.equal(outer.open, true);
  assert.equal(inner.open, true);
  outer.open = false; inner.open = false;
}

// 4. A visible table is unchanged, plus all-true flags; the agent facade routes to the table unit.
{
  const res = await ssWebUnitAgent({ __tool: 'web_table_extract', index: 0 });
  const t = res.data.tables[0];
  assert.deepEqual(t.headers, ['Plan', 'Price']);
  assert.deepEqual(t.rows, [['Basic', '$10'], ['Pro', '$25']]);
  assert.deepEqual(t.columnVisible, [true, true]);
  assert.equal(t.markdown, '| Plan | Price |\n| --- | --- |\n| Basic | $10 |\n| Pro | $25 |');
  assert.deepEqual(t.json, [{ Plan: 'Basic', Price: '$10' }, { Plan: 'Pro', Price: '$25' }]);
  console.log('[test] web_table_extract_details: visible table unchanged - PASSED');
}

// 5. innerText still wins when it has text (it leaves out what CSS hides inside a rendered cell).
{
  const cell = shown.querySelectorAll('td')[0];
  Object.defineProperty(cell, 'innerText', { get: () => 'Basic' });
  cell.childNodes.push({ nodeType: 3, textContent: '(screen-reader only)' });
  const res = await extract({ index: 0 });
  assert.equal(res.data.tables[0].rows[0][0], 'Basic');
}

// 6. No table: the old error.
{
  const res = await extract({ selector: '.nope' });
  assert.equal(res.ok, false);
  assert.match(res.error, /No <table> elements found for selector: \.nope/);
}

console.log('[test] web_table_extract_details.test.js: ALL ASSERTIONS PASSED');
