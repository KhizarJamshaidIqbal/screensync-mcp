// ScreenSync Trace Viewer — Self-Contained Offline HTML Emitter (P7)
// Renders Chrome/CDP trace events into an offline-inspectable HTML document.
// Zero remote scripts, zero remote fonts, zero network images.

/**
 * Escapes HTML entities.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders a self-contained HTML trace viewer from a Chrome trace object.
 * @param {{ traceEvents?: Array<any>, metadata?: Record<string, any> } | Array<any>} trace
 * @returns {string} Fully self-contained HTML string.
 */
export function renderTraceViewerHtml(trace) {
  const events = Array.isArray(trace)
    ? trace
    : Array.isArray(trace?.traceEvents)
      ? trace.traceEvents
      : [];
  const meta = (!Array.isArray(trace) && trace?.metadata) || {};

  let minTs = Infinity;
  let maxTs = -Infinity;
  const categories = {};
  const longEvents = [];

  for (const ev of events) {
    const ts = Number(ev.ts) || 0;
    if (ts > 0) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
    }
    const cat = ev.cat || 'other';
    categories[cat] = (categories[cat] || 0) + 1;
    if (ev.dur && ev.dur > 500) {
      longEvents.push(ev);
    }
  }

  if (minTs === Infinity) { minTs = 0; maxTs = 0; }
  const totalDurationMs = maxTs > minTs ? Math.round((maxTs - minTs) / 1000) : (meta.durationMs || 0);

  // Build SVG timeline buckets
  const bucketCount = 60;
  const buckets = new Array(bucketCount).fill(0);
  const span = maxTs - minTs || 1;
  for (const ev of events) {
    const ts = Number(ev.ts) || 0;
    if (ts >= minTs && ts <= maxTs) {
      const idx = Math.min(bucketCount - 1, Math.floor(((ts - minTs) / span) * bucketCount));
      buckets[idx]++;
    }
  }
  const maxBucket = Math.max(...buckets, 1);
  const svgBars = buckets.map((count, i) => {
    const h = Math.round((count / maxBucket) * 60);
    const x = i * 14;
    const y = 70 - h;
    return `<rect x="${x}" y="${y}" width="11" height="${h}" fill="#8B5CF6" rx="2" opacity="${count ? 0.85 : 0.15}"><title>Bucket ${i + 1}: ${count} events</title></rect>`;
  }).join('');

  // Top 15 longest events
  longEvents.sort((a, b) => (b.dur || 0) - (a.dur || 0));
  const topLong = longEvents.slice(0, 15);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScreenSync Trace Viewer — ${esc(meta.tabId ? 'Tab ' + meta.tabId : 'Session')}</title>
<style>
  :root { --bg:#0B0D13; --panel:#171A23; --line:#2B3040; --text:#E6E9F0; --dim:#9AA3B5; --accent:#8B5CF6; --highlight:#38BDF8; --warn:#F59E0B; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 13px; line-height: 1.5; padding: 24px; }
  header { margin-bottom: 20px; border-bottom: 1px solid var(--line); padding-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 10px; }
  .badge { background: rgba(139,92,246,0.2); color: #C4B5FD; border: 1px solid rgba(139,92,246,0.4); padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  .stats { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
  .stat-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 16px; min-width: 120px; }
  .stat-card small { display: block; color: var(--dim); font-size: 11px; text-transform: uppercase; }
  .stat-card strong { font-size: 18px; color: #fff; }
  .section { margin-top: 24px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
  .section h2 { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--highlight); }
  .timeline-wrap { overflow-x: auto; padding-bottom: 8px; }
  svg { display: block; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--line); }
  th { background: rgba(255,255,255,0.02); color: var(--dim); font-weight: 600; text-transform: uppercase; font-size: 11px; }
  tr:hover td { background: rgba(255,255,255,0.03); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #D9C7FF; background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 4px; }
  .search-box { width: 100%; max-width: 400px; padding: 6px 12px; background: #0B0D13; border: 1px solid var(--line); border-radius: 6px; color: #fff; font-size: 12px; outline: none; margin-bottom: 12px; }
  .search-box:focus { border-color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>⚡ ScreenSync Trace Viewer <span class="badge">Offline Inspect</span></h1>
  <div class="stats">
    <div class="stat-card"><small>Total Events</small><strong>${events.length}</strong></div>
    <div class="stat-card"><small>Duration</small><strong>${totalDurationMs} ms</strong></div>
    <div class="stat-card"><small>Categories</small><strong>${Object.keys(categories).length}</strong></div>
    <div class="stat-card"><small>Long Events (>0.5ms)</small><strong>${longEvents.length}</strong></div>
  </div>
</header>

<div class="section">
  <h2>Activity Timeline (Event Density)</h2>
  <div class="timeline-wrap">
    <svg width="${bucketCount * 14}" height="75" viewBox="0 0 ${bucketCount * 14} 75">
      ${svgBars}
    </svg>
  </div>
</div>

<div class="section">
  <h2>Longest Execution Phases</h2>
  <table>
    <thead><tr><th>Category</th><th>Event Name</th><th>Phase</th><th>Duration (ms)</th><th>PID:TID</th></tr></thead>
    <tbody>
      ${topLong.length ? topLong.map(ev => `<tr><td><code>${esc(ev.cat)}</code></td><td><strong>${esc(ev.name)}</strong></td><td><code>${esc(ev.ph)}</code></td><td>${((ev.dur || 0) / 1000).toFixed(2)} ms</td><td>${ev.pid || 0}:${ev.tid || 0}</td></tr>`).join('') : '<tr><td colspan="5" style="color:var(--dim)">No long execution events captured.</td></tr>'}
    </tbody>
  </table>
</div>

<div class="section">
  <h2>Captured Trace Events (${Math.min(events.length, 250)} previewed)</h2>
  <input type="text" class="search-box" id="search" placeholder="Filter by event name or category..." oninput="filterEvents()">
  <table id="eventTable">
    <thead><tr><th>Offset</th><th>Category</th><th>Name</th><th>Phase</th><th>Duration</th></tr></thead>
    <tbody>
      ${events.slice(0, 250).map(ev => {
        const offsetMs = minTs ? ((ev.ts - minTs) / 1000).toFixed(2) : '0.00';
        const dur = ev.dur ? (ev.dur / 1000).toFixed(2) + ' ms' : '-';
        return `<tr data-row="${esc(ev.name)} ${esc(ev.cat)}"><td>+${offsetMs}ms</td><td><code>${esc(ev.cat)}</code></td><td>${esc(ev.name)}</td><td><code>${esc(ev.ph)}</code></td><td>${dur}</td></tr>`;
      }).join('')}
    </tbody>
  </table>
</div>

<script>
function filterEvents() {
  const query = (document.getElementById('search').value || '').toLowerCase();
  const rows = document.querySelectorAll('#eventTable tbody tr');
  rows.forEach(r => {
    const text = (r.getAttribute('data-row') || '').toLowerCase();
    r.style.display = (!query || text.includes(query)) ? '' : 'none';
  });
}
</script>
</body>
</html>`;
}
