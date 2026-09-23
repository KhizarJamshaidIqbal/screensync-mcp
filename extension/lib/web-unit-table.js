// ScreenSync Table Unit — self-contained page-side executor for web_table_extract, split out of
// web-unit-perception.js. It is serialized with .toString() and run in the page (AGENTS.md section 3): no
// outer-scope references, every helper is defined inside the function.
//
// innerText is '' for anything that is not rendered, so a table inside a closed <details> came back with every
// cell empty. The text now falls back to textContent (whitespace-normalised), each table reports which columns
// a person can actually see (columnVisible), and openDetails:true opens the closed <details> around the tables
// for the read and closes them again afterwards.

export async function ssWebUnitTable(args = {}) {
  const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  const cellText = (c) => norm(c.innerText) || norm(c.textContent);
  const shown = (el) => {
    try {
      const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    } catch { return false; }
  };

  const format = String(args.format || 'all').toLowerCase();
  const limit = Math.min(Number(args.limit) || 200, 1000);
  let nodes = [];
  if (args.index !== undefined && args.index !== null) {
    const t = document.querySelectorAll('table')[Number(args.index)];
    if (t) nodes = [t];
  } else {
    try { nodes = Array.from(document.querySelectorAll(args.selector || 'table')).slice(0, Number(args.tableLimit) || 5); } catch {}
  }
  if (!nodes.length) return { ok: false, error: 'No <table> elements found' + (args.selector ? ' for selector: ' + args.selector : '') + '.' };

  const opened = [];
  if (args.openDetails === true) {
    for (const table of nodes) {
      let d = table.closest ? table.closest('details') : null;
      while (d) {
        if (!d.open) { d.open = true; opened.push(d); }
        d = d.parentElement && d.parentElement.closest ? d.parentElement.closest('details') : null;
      }
    }
  }

  try {
    const tables = [];
    for (const table of nodes) {
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      const headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th, td')) : [];
      const headers = headerCells.map(cellText);
      const rowEls = Array.from(table.querySelectorAll('tbody tr, tr')).filter((r) => r !== headerRow).slice(0, limit);
      const rowCells = rowEls.map((r) => Array.from(r.querySelectorAll('td, th')));
      const rows = rowCells.map((cells) => cells.map(cellText));
      // A column counts as visible when any of its cells (header or one of the first 50 rows) is rendered.
      const width = Math.max(headerCells.length, ...rowCells.map((c) => c.length), 0);
      const sample = [headerCells, ...rowCells.slice(0, 50)];
      const columnVisible = Array.from({ length: width }, (_, i) => sample.some((cells) => cells[i] && shown(cells[i])));
      const t = { rowCount: rows.length, headers, rows, columnVisible };
      if (format === 'json' || format === 'all') t.json = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h || 'col' + i, r[i] ?? null])));
      if (format === 'markdown' || format === 'all') t.markdown = '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
      if (format === 'csv' || format === 'all') t.csv = [headers].concat(rows).map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      tables.push(t);
    }
    return { ok: true, data: { tables, count: tables.length, ...(opened.length ? { openedDetails: opened.length } : {}) } };
  } finally {
    // Leave the page as it was found.
    for (const d of opened) { try { d.open = false; } catch {} }
  }
}
